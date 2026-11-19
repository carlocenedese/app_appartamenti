import { describe, expect, it } from 'vitest';
import {
  PaymentSchema,
  PeriodCloseSchema,
  buildConguaglioWorkbook,
  buildOwnersWorkbook,
  loadDashboard,
  loadDepositReturn,
  saveLegalRate,
  loadExcelInput,
  closePeriod,
  commitChange,
  markPeriodSent,
  markTenantSettled,
  reopenPeriod,
  loadAll,
  loadPeriodClosing,
  readJournal,
  recordPath,
  tariDecembers,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate, yearMonth } from '../src/period';
import {
  apartment,
  bill,
  instalment,
  match,
  payment,
  tenancy,
} from './helpers/conguaglio-builders';
import { cents } from '../src/money';
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
    expect(await dashboard()).toMatchObject({ row: { closed: true, step: 'chiuso', pending: 0 } });
    expect((await dashboard()).counts?.['conguaglio:da-inviare']).toBe(1);
    expect((await dashboard()).counts?.['conguaglio:supplementare']).toBeUndefined();
    const late = bill('b-tardiva', '2026-07-01', '2026-09-30', 9000, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late);
    await put(store, 'match', match(late, 9000));
    // The owners' file says it too (review, point 5).
    const sup = {
      kind: 'text',
      value: `Conguaglio chiuso il ${day}: dopo la chiusura c'è un conguaglio supplementare`,
    };
    expect(await firstRow()).toEqual([sup, sup]);
    // F2 (unchanged): after the closing the files show today's calculation, late bill included;
    // only the first row differs from the same input without the closing.
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const open = { ...loaded.input, closing: undefined };
    const rows = (input: typeof loaded.input) =>
      buildConguaglioWorkbook(input).sheets.map((sheet) => sheet.rows.slice(1));
    expect(rows(loaded.input)).toEqual(rows(open));
    expect(JSON.stringify(rows(loaded.input))).toContain('b-tardiva');
    expect((await dashboard()).counts?.['conguaglio:supplementare']).toBe(1);
  });

  it('a recovery after the closing is a cost: supplementary; the action of no difference is «nessuna»', async () => {
    const store = await setUp();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    const none = await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'));
    expect(none).toMatchObject({ changed: false, tenants: [{ delta: 0, action: 'nessuna' }] });
    // The tenant paid 15,00 for the owners in August: a credit of the tenant.
    await put(store, 'tenantRecovery', {
      id: 'rec-1',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      amount: -1500,
      shares: [{ tenantId: 't-a', amount: -1500 }],
      status: 'da-recuperare',
      date: '2026-08-10',
    });
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toMatchObject({
      changed: true,
      dataChanged: false,
      tenants: [{ tenantId: 't-a', delta: -1500, action: 'da-rimborsare' }],
    });
  });

  it('F11: after a reopening a flat charge cancelled is asked in the supplementary as its own line', async () => {
    const store = await setUp();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    await reopenPeriod(
      store,
      { ...QUERY, on: '2026-11-20', reason: 'Bonifico di ottobre respinto' },
      'p1',
      clock,
      ids('r'),
    );
    const [first] = (await loadAll(store, 'payment', PaymentSchema)).records;
    if (first === undefined) throw new Error('payment');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          {
            path: recordPath('payment', first.id),
            before: first,
            after: { ...first, rev: 2, deleted: true },
          },
        ],
      },
      clock,
      ids('del'),
    );
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toMatchObject({
      status: 'reopened',
      reopened: { on: '2026-11-20', reason: 'Bonifico di ottobre respinto' },
      changed: true,
      dataChanged: false,
      tenants: [{ tenantId: 't-a', delta: 0, forfaitDelta: 3000, action: 'da-pagare' }],
    });
    // Reopened: the files and the dashboard show the period as open again.
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    expect(loaded.input.closing).toBeUndefined();
    expect(buildConguaglioWorkbook(loaded.input).sheets[0]?.rows[0]?.[0]).toEqual({
      kind: 'text',
      value: 'Conguaglio provvisorio: voci in attesa 0',
    });
    // A new closing waits for the flat charge (R5).
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('c2'))).toMatchObject({
      status: 'refused',
      reason: 'cannot-close',
    });
  });

  it('F1: sent and settled are marked by user1, settled per tenant and never automatic', async () => {
    const store = await setUp();
    const sent = { ...QUERY, on: '2026-11-20' };
    expect(await markPeriodSent(store, sent, 'p1', clock, ids('s'))).toEqual({
      status: 'refused',
      reason: 'not-closed',
    });
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    const record = async () => (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0];
    // The step and the tenants left, from the one computation (`loadPeriodClosing`, fifth round).
    const closing = async () => {
      const c = await loadPeriodClosing(store, QUERY, isoDate('2026-12-02'));
      if (c.status !== 'closed') throw new Error(c.status);
      return c;
    };
    const state = async () => (await closing()).state;
    const unsettled = async () => (await closing()).unsettled;
    expect(await state()).toBe('chiuso');
    expect(await markPeriodSent(store, sent, 'p1', clock, ids('s'))).toMatchObject({
      status: 'saved',
    });
    expect(await markPeriodSent(store, sent, 'p1', clock, ids('s2'))).toMatchObject({
      status: 'unchanged',
    });
    // 90,00 of the bill against 360,00 of flat charge: a credit of 270,00 to settle.
    expect(await state()).toBe('inviato');
    expect(await unsettled()).toEqual(['t-a']);
    const sentBoard = await loadDashboard(store, {
      today: isoDate('2026-11-21'),
      settlements: [QUERY],
    });
    expect(sentBoard.status === 'computed' && sentBoard.apartments[0]?.counts).toMatchObject({
      'conguaglio:da-saldare': 1,
    });
    const settle = { ...QUERY, tenantId: 't-a', on: '2026-12-01' };
    expect(
      await markTenantSettled(store, { ...settle, tenantId: 't-x' }, 'p1', clock, ids('x')),
    ).toEqual({ status: 'refused', reason: 'unknown-tenant' });
    expect(
      await markTenantSettled(store, { ...settle, transactionId: 'tx-no' }, 'p1', clock, ids('x')),
    ).toEqual({ status: 'refused', reason: 'unknown-movement' });
    await put(store, 'transaction', {
      id: 'tx-1',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      date: '2026-12-01',
      amount: -27000,
      description: 'Bonifico a inquilino',
      statementHash: 'h',
    });
    expect(
      await markTenantSettled(store, { ...settle, transactionId: 'tx-1' }, 'p1', clock, ids('t')),
    ).toMatchObject({ status: 'saved' });
    expect(await record()).toMatchObject({
      sentOn: '2026-11-20',
      settled: [{ tenantId: 't-a', on: '2026-12-01', transactionId: 'tx-1' }],
    });
    expect(await state()).toBe('saldato');
    // The first row of the files and the dashboard show the steps.
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const day = `${clock().slice(8, 10)}/${clock().slice(5, 7)}/${clock().slice(0, 4)}`;
    expect(buildOwnersWorkbook(loaded.input).sheets[0]?.rows[0]?.[0]).toEqual({
      kind: 'text',
      value: `Conguaglio chiuso il ${day}, inviato il 20/11/2026, saldato`,
    });
    const board = await loadDashboard(store, {
      today: isoDate('2026-12-02'),
      settlements: [QUERY],
    });
    expect(board.status === 'computed' && board.settlements[0]?.step).toBe('saldato');
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-12-02'))).toMatchObject({
      status: 'closed',
      sentOn: '2026-11-20',
      settled: [{ tenantId: 't-a' }],
    });
    const kinds = (await readJournal(store)).operations.map((o) => o.kind);
    expect(kinds.filter((k) => k.startsWith('period.'))).toEqual([
      'period.close',
      'period.send',
      'period.settle',
    ]);
  });

  it('F3: a reopening needs a reason, keeps the snapshot, and a second closing moves it into history', async () => {
    const store = await setUp();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    await markPeriodSent(store, { ...QUERY, on: '2026-11-20' }, 'p1', clock, ids('s'));
    const reopen = { ...QUERY, on: '2026-11-25', reason: '  ' };
    expect(await reopenPeriod(store, reopen, 'p1', clock, ids('r'))).toEqual({
      status: 'refused',
      reason: 'missing-reason',
    });
    const done = await reopenPeriod(
      store,
      { ...reopen, reason: 'Bolletta corretta dal fornitore' },
      'p1',
      clock,
      ids('r'),
    );
    expect(done).toMatchObject({ status: 'saved', operationId: 'r-1' });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'r-1');
    expect(op).toMatchObject({
      kind: 'period.reopen',
      profileId: 'p1',
      reason: 'Bolletta corretta dal fornitore',
    });
    // Open again: no second reopening, no marks, a new closing.
    expect(await reopenPeriod(store, { ...reopen, reason: 'x' }, 'p1', clock, ids('r2'))).toEqual({
      status: 'refused',
      reason: 'not-closed',
    });
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('c2'))).status).toBe('closed');
    const [record] = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records;
    expect(record?.reopened).toBeUndefined();
    expect(record?.sentOn).toBeUndefined();
    expect(record?.history).toEqual([
      {
        closedAt: clock(),
        engineVersion: record?.engineVersion,
        snapshot: record?.snapshot,
        sentOn: '2026-11-20',
        reopened: { on: '2026-11-25', reason: 'Bolletta corretta dal fornitore' },
      },
    ]);
  });

  const decemberNotice = (year: string) =>
    instalment(`tari-dic-${year}`, {
      kind: 'tari',
      esercizio: year,
      rateIndex: 3,
      rateCount: 3,
      dueDate: isoDate(`${year}-12-16`),
      rata: cents(3000),
      coversFrom: yearMonth(`${year}-09`),
      coversTo: yearMonth(`${year}-12`),
    });

  it('R3, F4: an apartment of the shared TARI notice closes only after the December inside the period is debited', async () => {
    // Period October 2025 – September 2026: the December that counts is December 2025.
    const store = await setUp();
    await put(store, 'supply', {
      id: 'sup-a',
      v: 1,
      rev: 1,
      label: 'UTENZA-A',
      apartments: [{ apartmentId: 'apt', weight: 10000 }],
    });
    const refused = {
      status: 'refused',
      reason: 'tari-december-missing',
      month: '2025-12',
    };
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('c'))).toEqual(refused);
    // The December of the year the period ends in no longer counts (decision of 18 Nov 2026).
    const later = decemberNotice('2026');
    await put(store, 'instalment', later);
    await put(store, 'match', match(later, 3000, { transactionDate: isoDate('2026-12-16') }));
    expect(await closePeriod(store, QUERY, 'p1', clock, ids('d'))).toEqual(refused);
    const december = decemberNotice('2025');
    await put(store, 'instalment', december);
    // Registered but not debited yet: still refused (an item of the period without a debit).
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('e'))).status).toBe('refused');
    await put(store, 'match', match(december, 3000, { transactionDate: isoDate('2025-12-16') }));
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('f'))).status).toBe('closed');
  });
});

describe('R363: a period closed before plan 21 keeps the split over the beds', () => {
  // Invented: 3 beds, A all year, B until August (departed), a bill of 90,00 for July only.
  const july = bill('b-luglio', '2026-07-01', '2026-07-31', 9000, {
    dueDate: isoDate('2026-08-10'),
  });
  async function twoOfThree() {
    const store = new MemoryStore();
    await put(store, 'apartment', apartment({ posti: 3 }));
    await put(store, 'contract', contract);
    await put(store, 'tenancy', tenancy('t-a', '2025-10', undefined));
    await put(store, 'tenancy', tenancy('t-b', '2025-10', '2026-08'));
    await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
    await put(store, 'tenant', { id: 't-b', v: 1, rev: 1, name: 'Altro Nome Inventato' });
    await put(store, 'bill', july);
    await put(store, 'match', match(july, 9000));
    for (const m of MONTHS) await put(store, 'payment', payment('t-a', m, 48000));
    for (const m of MONTHS.slice(0, 11)) await put(store, 'payment', payment('t-b', m, 48000));
    await put(store, 'payment', {
      ...payment('t-b', '2025-09', 50000),
      id: 'dep-b',
      kind: 'caparra',
      forMonth: undefined,
      source: 'manual',
    });
    for (const year of ['2025', '2026']) {
      await saveLegalRate(store, { year, rateBp: 200 }, 'p1', clock, ids(`rate-${year}`));
    }
    return store;
  }
  const spese = (record: { snapshot: { tenants: { spese: number }[]; emptyBeds: number } }) => [
    ...record.snapshot.tenants.map((t) => t.spese),
    record.snapshot.emptyBeds,
  ];
  /** The closing as an app before plan 21 wrote it: 30,00 each and 30,00 to the empty bed. */
  async function closedBeforePlan21() {
    const store = await twoOfThree();
    await closePeriod(store, QUERY, 'p1', clock, ids('c'));
    const [now] = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records;
    if (now === undefined) throw new Error('not closed');
    expect([now.engineVersion, ...spese(now)]).toEqual(['0.2.0', 4500, 4500, 0]);
    const old = {
      ...now,
      engineVersion: '0.1.0',
      snapshot: {
        ...now.snapshot,
        tenants: now.snapshot.tenants.map((t) => ({ ...t, spese: cents(3000) })),
        emptyBeds: cents(3000),
      },
    };
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath('periodClose', now.id), before: now, after: old }],
      },
      clock,
      ids('old'),
    );
    return store;
  }

  it('an old snapshot 30/30/30 shows no supplementary and no action for the tenant who left', async () => {
    const store = await closedBeforePlan21();
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-18'))).toMatchObject({
      status: 'closed',
      changed: false,
      unassignedDelta: 0,
      tenants: [
        { tenantId: 't-a', delta: 0, departed: false },
        { tenantId: 't-b', delta: 0, departed: true, action: 'nessuna' },
      ],
    });
  });

  it('the deposit of the tenant who left keeps the old due, 30,00 of the bill', async () => {
    const store = await closedBeforePlan21();
    const result = await loadDepositReturn(store, {
      apartmentId: 'apt',
      tenantId: 't-b',
      extraCharges: [],
    });
    // B's due by the old split: 30,00 − 330,00 of flat charge = 300,00 back (by the new split it
    // would be 285,00); 500,00 at 2% for 11 months = 9,17.
    expect(result).toEqual({
      status: 'computed',
      statement: {
        total: 50000 + 917 + 30000,
        lines: [
          { label: 'Caparra', amount: 50000 },
          { label: 'Interessi legali', amount: 917 },
          { label: 'Conguaglio bollette', amount: 30000 },
        ],
      },
      recoveriesWaiting: 0,
      toCheck: [],
    });
  });

  it('the Excel of an old closing shows 30,00 each and the row of the empty beds', async () => {
    const store = await closedBeforePlan21();
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const sheet = buildConguaglioWorkbook(loaded.input).sheets.find((x) => x.name === 'Conguagli');
    const rows = (sheet?.rows ?? [])
      .slice(2)
      .map((r) => [(r[0] ?? r[1]) as { value: unknown } | null, r[4] as { value: unknown } | null]);
    expect(rows.map(([who, spese]) => [who?.value, spese?.value])).toEqual([
      ['Nome Inventato', 3000],
      ['Altro Nome Inventato', 3000],
      ['Posti vuoti (proprietà)', 3000],
      ['Totale', 9000],
    ]);
  });

  it('reopened and closed again, the period uses the split among the tenants present: 45/45', async () => {
    const store = await closedBeforePlan21();
    const reopen = { ...QUERY, on: '2026-11-25', reason: 'Correzione inventata' };
    expect((await reopenPeriod(store, reopen, 'p1', clock, ids('r'))).status).toBe('saved');
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('c2'))).status).toBe('closed');
    const [record] = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records;
    if (record === undefined) throw new Error('not closed');
    expect([record.engineVersion, ...spese(record)]).toEqual(['0.2.0', 4500, 4500, 0]);
    expect(record.history?.map((h) => [h.engineVersion, h.snapshot.emptyBeds])).toEqual([
      ['0.1.0', 3000],
    ]);
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-11-26'))).toMatchObject({
      status: 'closed',
      changed: false,
      tenants: [
        { tenantId: 't-a', delta: 0 },
        { tenantId: 't-b', delta: 0 },
      ],
    });
  });
});

describe('tariDecembers (F4)', () => {
  it('is the December inside the period, every one when there are several', () => {
    expect(tariDecembers('2025-04', '2026-03')).toEqual(['2025-12']);
    expect(tariDecembers('2025-09', '2026-08')).toEqual(['2025-12']);
    expect(tariDecembers('2026-01', '2026-12')).toEqual(['2026-12']);
    expect(tariDecembers('2024-04', '2026-03')).toEqual(['2024-12', '2025-12']);
  });

  it('without a December inside, no TARI debit is required (answer of user1, 18 Nov 2026)', () => {
    expect(tariDecembers('2026-01', '2026-06')).toEqual([]);
    expect(tariDecembers('2026-02', '2026-07')).toEqual([]);
  });
});
