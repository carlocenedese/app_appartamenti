import { describe, expect, it } from 'vitest';
import {
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  cents,
  commitChange,
  confirmIncome,
  excludeMovement,
  excludedIds,
  loadAll,
  readJournal,
  recordPath,
  runReconcile,
  saveTenant,
  undoOperation,
  yearMonth,
} from '../src/index';
import type { MovementClass } from '../src/index';
import { clock, ids, snapshot, year, yearStore } from './helpers/income-year';

/** The year, plus `t1`: a second copy of the exact January rent of `t-anna` (a duplicate). */
async function duplicateStore() {
  const store = await yearStore();
  const original = (year.records.transaction ?? []).find((t) => t.id === 'tx-anna-2026-01');
  const t1 = BankTransactionSchema.parse({ ...original, id: 't1' });
  await store.writeJsonAtomic(recordPath('transaction', 't1'), t1);
  return store;
}
const dryRun = async (store: Awaited<ReturnType<typeof duplicateStore>>) => {
  const r = await runReconcile(store, 'p1', clock, ids('dry'), { dryRun: true });
  if (r.status !== 'reconciled') throw new Error('refused');
  return r;
};
const exclude = (
  store: Awaited<ReturnType<typeof duplicateStore>>,
  transactionId = 't1',
  prefix = 'x',
) => excludeMovement(store, { transactionId, reason: 'doppione' }, 'p1', clock, ids(prefix));
const classes = async (store: Awaited<ReturnType<typeof duplicateStore>>) =>
  (await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })).records;

describe('excludedIds', () => {
  it('lists the movements of the live exclusions only', () => {
    const c = (over: Partial<MovementClass> & { transactionId: string }): MovementClass => ({
      id: `mc-${over.transactionId}`,
      v: 1,
      rev: 1,
      kind: 'escluso',
      excludeReason: 'doppione',
      ...over,
    });
    expect(
      excludedIds([
        c({ transactionId: 'a' }),
        c({ transactionId: 'b', deleted: true }),
        c({ transactionId: 'c', kind: 'utenze', excludeReason: undefined, apartmentId: 'a1' }),
      ]),
    ).toEqual(new Set(['a']));
  });
});

describe('excludeMovement (plan 3c, task 1)', () => {
  it('excludes a duplicate in one operation: the reconciliation no longer sees it', async () => {
    const store = await duplicateStore();
    const baseline = await dryRun(store);
    expect(baseline.proposals.some((p) => p.transactionId === 'tx-anna-2026-01')).toBe(true);
    expect(await exclude(store)).toEqual({ status: 'excluded', operationId: 'x-1' });
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.summary, o.apartmentId])).toEqual([
      ['movement.exclude', 'Movimento escluso.', 'a1'],
    ]);
    expect(await classes(store)).toEqual([
      {
        id: 'mc-t1',
        v: 1,
        rev: 1,
        transactionId: 't1',
        kind: 'escluso',
        excludeReason: 'doppione',
      },
    ]);
    const after = await dryRun(store);
    expect(after.proposals.some((p) => p.transactionId === 't1')).toBe(false);
    // The original is the automatic payment now; the duplicate gives none.
    const run = await runReconcile(store, 'p1', clock, ids('r'));
    expect(run).toMatchObject({ written: 1 });
    const payments = (await readJournal(store)).operations.flatMap((o) =>
      o.changes.map((c) => c.path),
    );
    expect(payments).toContain(recordPath('payment', 'pay-tx-anna-2026-01'));
    expect(payments).not.toContain(recordPath('payment', 'pay-t1'));
  });

  it('undoing the exclusion deletes it: the next run treats the movement as before', async () => {
    const store = await duplicateStore();
    const baseline = await dryRun(store);
    expect(baseline.proposals.some((p) => p.transactionId === 't1')).toBe(false);
    await exclude(store);
    await undoOperation(store, 'x-1', 'p1', clock, ids('u'));
    expect(await classes(store)).toMatchObject([{ id: 'mc-t1', rev: 2, deleted: true }]);
    expect(await dryRun(store)).toEqual(baseline);
    // Excluded again over the deleted record.
    expect(await exclude(store, 't1', 'y')).toMatchObject({ status: 'excluded' });
    expect(await classes(store)).toMatchObject([{ id: 'mc-t1', rev: 3, kind: 'escluso' }]);
    expect((await classes(store))[0]).not.toHaveProperty('deleted');
  });

  it('refuses without writing: unknown or deleted movement, already excluded, inconsistent store', async () => {
    const store = await duplicateStore();
    const t1 = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
      (t) => t.id === 't1',
    );
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test',
        summary: 'x',
        changes: [{ path: recordPath('transaction', 't1'), before: t1, after: undefined }],
      },
      clock,
      ids('d'),
    );
    await exclude(store, 'tx-anna-2026-01');
    const before = await snapshot(store);
    expect(await exclude(store, 'nessuno')).toEqual({
      status: 'refused',
      reason: 'unknown-transaction',
    });
    expect(await exclude(store, 't1')).toEqual({
      status: 'refused',
      reason: 'unknown-transaction',
    });
    expect(await exclude(store, 'tx-anna-2026-01')).toEqual({
      status: 'refused',
      reason: 'already-classified',
    });
    expect(await snapshot(store)).toEqual(before);

    await saveTenant(store, { id: 't-anna', name: 'Anna Verdi' }, 'p1', clock, ids('a'));
    store.putRaw(recordPath('tenant', 't-anna'), '{"id":"t-anna","v":1,"rev":1,"name":"Altro"}\n');
    const diverged = await snapshot(store);
    expect(await exclude(store, 'tx-bruno-2026-01')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(diverged);
  });

  it('refuses a movement with a live payment: has-dependents with its id', async () => {
    const store = await duplicateStore();
    await runReconcile(store, 'p1', clock, ids('r'));
    const before = await snapshot(store);
    expect(await exclude(store)).toEqual({
      status: 'refused',
      reason: 'has-dependents',
      recordIds: ['pay-t1'],
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses a movement with a live confirmed match; assumed or unconfirmed ones do not block', async () => {
    const store = await duplicateStore();
    const match = (id: string, over: Record<string, unknown>) =>
      store.writeJsonAtomic(
        recordPath('match', id),
        BillMatchSchema.parse({
          id,
          v: 1,
          rev: 1,
          itemType: 'bill',
          itemId: 'b1',
          transactionId: 't1',
          transactionDate: '2026-01-03',
          amount: 45000,
          part: 'amount',
          confirmed: true,
          by: 'manual',
          ...over,
        }),
      );
    await match('m-assumed', { by: 'assumed' });
    await match('m-proposed', { confirmed: false, by: 'auto' });
    await match('m-gone', { deleted: true });
    await match('m-1', {});
    const before = await snapshot(store);
    expect(await exclude(store)).toEqual({
      status: 'refused',
      reason: 'has-dependents',
      recordIds: ['m-1'],
    });
    expect(await snapshot(store)).toEqual(before);
    await store.writeJsonAtomic(
      recordPath('match', 'm-1'),
      BillMatchSchema.parse({
        ...(await loadAll(store, 'match', BillMatchSchema)).records.find((m) => m.id === 'm-1'),
        deleted: true,
      }),
    );
    expect(await exclude(store)).toMatchObject({ status: 'excluded' });
  });

  it('a proposal of a movement excluded after it is no longer confirmable', async () => {
    const store = await duplicateStore();
    const proposal = (await dryRun(store)).proposals.find(
      (p) => p.transactionId === 'tx-anna-2026-01',
    );
    expect(proposal).toBeDefined();
    await exclude(store, 'tx-anna-2026-01');
    const input = {
      proposalId: proposal?.id ?? '',
      tenantId: 't-anna',
      parts: [{ kind: 'canone' as const, forMonth: yearMonth('2026-02'), amount: cents(45000) }],
      rememberPayer: true,
    };
    expect(await confirmIncome(store, input, 'p1', clock, ids('k'))).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
  });

  it('a reconciliation never writes an exclusion, even with an evident duplicate', async () => {
    const store = await duplicateStore();
    await runReconcile(store, 'p1', clock, ids('r'));
    await runReconcile(store, 'p1', clock, ids('r2'));
    expect(await classes(store)).toEqual([]);
    const paths = (await readJournal(store)).operations.flatMap((o) =>
      o.changes.map((c) => c.path),
    );
    expect(paths.some((p) => p.includes('movementClass'))).toBe(false);
  });
});
