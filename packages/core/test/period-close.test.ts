import { describe, expect, it } from 'vitest';
import {
  PeriodCloseSchema,
  buildConguaglioWorkbook,
  buildOwnersWorkbook,
  loadDashboard,
  loadExcelInput,
  closePeriod,
  commitChange,
  loadAll,
  loadPeriodClosing,
  readJournal,
  recordPath,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, match, payment, tenancy } from './helpers/conguaglio-builders';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Review of 18 Nov 2026 (I2, R5). Invented: a one-bed apartment, one tenant all year (rent 450,00
// and flat charge 30,00 a month), a bill of 90,00 for July–September.
const QUERY = { apartmentId: 'apt', periodLabel: '2025-26' };
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const n = 2025 * 12 + 9 + i;
  return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
});
const contract = {
  id: 'ctr',
  v: 1,
  rev: 1,
  apartmentId: 'apt',
  type: '1+1',
  start: '2025-10',
  end: '2026-09',
  settlement: 'annuale',
};
const luglio = bill('b-lug', '2026-07-01', '2026-09-30', 9000, { dueDate: isoDate('2026-10-10') });

async function put(
  store: MemoryStore,
  kind: RecordKind,
  record: { id: string } & Record<string, unknown>,
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, record.id), after: record }],
    },
    clock,
    ids(`seed-${kind}-${record.id}`),
  );
}

async function setUp(months = MONTHS) {
  const store = new MemoryStore();
  await put(store, 'apartment', apartment({ posti: 1 }));
  await put(store, 'contract', contract);
  await put(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
  await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  await put(store, 'bill', luglio);
  await put(store, 'match', match(luglio, 9000));
  for (const m of months) await put(store, 'payment', payment('t-a', m, 48000));
  return store;
}

describe('closePeriod and loadPeriodClosing (R5)', () => {
  it('refuses while a rent is missing, listing it; writes nothing', async () => {
    const store = await setUp(MONTHS.slice(0, 11));
    const before = await snapshot(store);
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('c'))).toEqual({
      status: 'refused',
      reason: 'cannot-close',
      missing: [
        { tenantId: 't-a', month: '2026-09', kind: 'rent', amount: 45000 },
        { tenantId: 't-a', month: '2026-09', kind: 'forfait', amount: 3000 },
      ],
    });
    expect(await snapshot(store)).toEqual(before);
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toEqual({
      status: 'open',
    });
  });

  it('closes with the snapshot, refuses a second close, and the undo opens it again', async () => {
    const store = await setUp();
    const closed = await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    expect(closed).toEqual({
      status: 'closed',
      operationId: 'c-1',
      closeId: 'chiusura-apt-2025-26',
    });
    const [record] = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records;
    expect(record).toMatchObject({
      from: '2025-10',
      to: '2026-09',
      snapshot: {
        tenants: [{ tenantId: 't-a', spese: 9000, rata: 0, commissione: 0 }],
        emptyBeds: 0,
      },
    });
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('d'))).toEqual({
      status: 'refused',
      reason: 'already-closed',
    });
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toMatchObject({
      status: 'closed',
      changed: false,
      tenants: [{ tenantId: 't-a', delta: 0 }],
    });
    const op = (await readJournal(store)).operations.find((o) => o.kind === 'period.close');
    expect(op?.kind).toBe('period.close');
    await undoOperation(store, op?.id ?? '', 'p1', clock, ids('u'));
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toEqual({
      status: 'open',
    });
  });

  it('a late bill after the closing gives the supplementary settlement of the tenant still there', async () => {
    const store = await setUp();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    // The bill of the spec example, 90,00 for July–September, arrives and is paid in November.
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 9000, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late);
    await put(store, 'match', match(late, 9000));
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toMatchObject({
      status: 'closed',
      changed: true,
      unassignedDelta: 0,
      tenants: [{ tenantId: 't-a', delta: 9000, departed: false, action: 'da-pagare' }],
    });
  });

  it('refuses an unknown period and a store that is not consistent', async () => {
    const store = await setUp();
    expect(
      await closePeriod(store, { ...QUERY, periodLabel: '2030-31' }, 'p1', clock, ids('c')),
    ).toEqual({ status: 'refused', reason: 'unknown-period' });
    await store.writeJsonAtomic(recordPath('bill', 'b-lug'), { ...luglio, rev: 9 });
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('c'))).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });

  it('Excel, owners file and dashboard say «chiuso», and the supplementary after a late bill', async () => {
    const store = await setUp();
    const firstRow = async () => {
      const loaded = await loadExcelInput(store, QUERY);
      if (loaded.status !== 'ok') throw new Error(loaded.reason);
      return [
        buildConguaglioWorkbook(loaded.input).sheets[0]?.rows[0]?.[0],
        buildOwnersWorkbook(loaded.input).sheets[0]?.rows[0]?.[0],
      ];
    };
    const dashboard = async () => {
      const d = await loadDashboard(store, { today: isoDate('2026-11-18'), settlements: [QUERY] });
      if (d.status !== 'computed') throw new Error(d.reason);
      return { row: d.settlements[0], counts: d.apartments[0]?.counts };
    };
    const provisional = { kind: 'text', value: 'Conguaglio provvisorio: voci in attesa 0' };
    expect(await firstRow()).toEqual([provisional, provisional]);
    expect((await dashboard()).row?.closed).toBeUndefined();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    const day = `${clock().slice(8, 10)}/${clock().slice(5, 7)}/${clock().slice(0, 4)}`;
    const closed = { kind: 'text', value: `Conguaglio chiuso il ${day}` };
    expect(await firstRow()).toEqual([closed, closed]);
    expect(await dashboard()).toMatchObject({ row: { closed: true, pending: 0 } });
    expect((await dashboard()).counts?.['conguaglio:supplementare']).toBeUndefined();
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 9000, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late);
    await put(store, 'match', match(late, 9000));
    expect((await firstRow())[0]).toEqual({
      kind: 'text',
      value: `Conguaglio chiuso il ${day}: dopo la chiusura c'è un conguaglio supplementare`,
    });
    expect((await dashboard()).counts?.['conguaglio:supplementare']).toBe(1);
  });
});
