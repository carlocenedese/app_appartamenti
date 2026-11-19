// Item 6 of plan 25 (decided by user1 on 19 Nov 2026): the items «da verificare» of a past year,
// confirmed paid by hand in one operation that can be undone; refused for a closed period.
// Invented data: one bed, rent 450,00 plus flat charge 30,00; no bank statement at all.
import { describe, expect, it } from 'vitest';
import {
  ClosedPeriodError,
  HandConfirmationSchema,
  calcConguaglio,
  closePeriod,
  commitChange,
  confirmPastYear,
  loadAll,
  loadExcelInput,
  planMatch,
  recordPath,
  recordSchemas,
  undoOperationCommand,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, payment, tenancy } from './helpers/conguaglio-builders';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const TODAY = '2026-11-19';
const QUERY = { apartmentId: 'apt', periodLabel: '2023-24' };
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const n = 2023 * 12 + 9 + i;
  return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
});

async function write(store: MemoryStore, kind: RecordKind, after: { id: string }, prefix = 's') {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, after.id), after: recordSchemas[kind].parse(after) }],
    },
    clock,
    ids(`${prefix}-${kind}-${after.id}`),
  );
}

/** A lease year 2023-24 paid in full; `bills` without any statement, so «da verificare». */
async function pastYear(bills: ReturnType<typeof bill>[]) {
  const store = new MemoryStore();
  await write(store, 'apartment', apartment({ posti: 1 }));
  await write(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' } as never);
  const stay = tenancy('t-a', '2023-10', '2024-09');
  await write(store, 'tenancy', stay);
  await write(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2023-10',
    end: '2024-09',
    settlement: 'annuale',
    tenancyIds: [stay.id],
  } as never);
  for (const m of MONTHS) await write(store, 'payment', payment('t-a', m, 48000, { id: `p-${m}` }));
  for (const b of bills) await write(store, 'bill', b);
  return store;
}

const luce = bill('b-luce', '2024-01-01', '2024-02-29', 9000, { dueDate: isoDate('2024-03-15') });
const gas = bill('b-gas', '2023-11-01', '2023-12-31', 6000, { dueDate: isoDate('2024-01-20') });
const later = bill('b-2025', '2025-01-01', '2025-01-31', 3000, { dueDate: isoDate('2025-02-15') });

describe('confirmPastYear (item 6)', () => {
  it('confirms every item of the year, with the count and the total; the undo takes them back', async () => {
    const store = await pastYear([luce, gas, later]);
    expect((await planMatch(store)).run.unverified.map((r) => r.itemId)).toEqual([
      'b-2025',
      'b-gas',
      'b-luce',
    ]);
    const done = await confirmPastYear(
      store,
      { year: '2024', today: TODAY },
      'p1',
      clock,
      ids('h'),
    );
    expect(done).toEqual({ status: 'confirmed', operationId: 'h-1', count: 2, total: 15000 });
    expect((await loadAll(store, 'handConfirmation', HandConfirmationSchema)).records).toEqual([
      expect.objectContaining({ id: 'hc-bill-b-gas', amount: 6000, date: '2024-01-20' }),
      expect.objectContaining({ id: 'hc-bill-b-luce', amount: 9000, date: '2024-03-15' }),
    ]);
    // Neither to verify nor pending any more: paid in the settlement of the period.
    expect((await planMatch(store)).run.unverified.map((r) => r.itemId)).toEqual(['b-2025']);
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    const result = calcConguaglio(loaded.input);
    expect(result.pending).toEqual([]);
    expect(result.tenants[0]?.spese).toBe(15000);

    await undoOperationCommand(store, 'h-1', { who: 'p1', clock, newId: ids('u') });
    expect((await loadAll(store, 'handConfirmation', HandConfirmationSchema)).records).toEqual([]);
    expect((await planMatch(store)).run.unverified).toHaveLength(3);
  });

  it('refuses, writing nothing, the current year and a year with nothing to verify', async () => {
    const store = await pastYear([luce]);
    const before = await snapshot(store);
    const confirm = (year: string) =>
      confirmPastYear(store, { year, today: TODAY }, 'p1', clock, ids('h'));
    expect(await confirm('2026')).toEqual({ status: 'refused', reason: 'not-past-year' });
    expect(await confirm('2023')).toEqual({ status: 'refused', reason: 'nothing-to-confirm' });
    expect(await snapshot(store)).toEqual(before);
  });

  it('is refused for a closed period, through the guard (F5)', async () => {
    const store = await pastYear([]);
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('c'))).status).toBe('closed');
    // A bill of the closed months arrives after the closing (accepted, as a late bill).
    await write(store, 'bill', luce, 'late');
    const before = await snapshot(store);
    await expect(
      confirmPastYear(store, { year: '2024', today: TODAY }, 'p1', clock, ids('h')),
    ).rejects.toThrow(ClosedPeriodError);
    expect(await snapshot(store)).toEqual(before);
  });
});
