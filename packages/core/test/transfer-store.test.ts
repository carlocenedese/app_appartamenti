import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
  TransferSchema,
  cents,
  confirmTransfer,
  excludeMovement,
  isoDate,
  loadAll,
  movementUses,
  readJournal,
  recordManualTransfer,
  recordPath,
  recordSchemas,
  runTransfers,
  undoOperation,
} from '../src/index';
import type { RecordKind, TransferPurpose } from '../src/index';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Synthetic records only: the own accounts of fixtures/README.md (…0301 Appartamento A, …0302 Appartamento B).
const APT_A = 'IT85X0542811101000000000301';
const APT_B = 'IT58X0542811101000000000302';
const base = { v: 1, rev: 1 };
const account = (id: string, iban: string) => ({
  ...base,
  id,
  apartmentId: id.replace('acc-', ''),
  label: 'Conto',
  bankProfileId: 'bp',
  iban,
});
const tx = (id: string, accountId: string, date: string, amount: number, iban?: string) => ({
  ...base,
  id,
  apartmentId: accountId.replace('acc-', ''),
  accountId,
  date,
  amount,
  description: 'BONIFICO',
  statementHash: 's',
  ...(iban === undefined ? {} : { counterparty: { name: 'Conto', iban } }),
});
/** Appartamento B → Appartamento A: −200,00 € on the account of Appartamento B, +200,00 € on Appartamento A. */
const april = [
  tx('o', 'acc-app-b', '2027-04-02', -20000, APT_A),
  tx('i', 'acc-app-a', '2027-04-07', 20000),
];
const may = [
  tx('o2', 'acc-app-b', '2027-05-03', -15000, APT_A),
  tx('i2', 'acc-app-a', '2027-05-05', 15000),
];

async function put(store: MemoryStore, kind: RecordKind, records: { id: string }[]) {
  for (const r of records) {
    await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
  }
}
async function storeWith(...transactions: ReturnType<typeof tx>[]) {
  const store = new MemoryStore();
  await put(store, 'account', [account('acc-app-a', APT_A), account('acc-app-b', APT_B)]);
  await put(store, 'transaction', transactions);
  return store;
}

const run = (store: MemoryStore, prefix = 'r', dryRun = false) =>
  runTransfers(store, 'p1', clock, ids(prefix), { dryRun });
const confirm = (
  store: MemoryStore,
  proposalId: string,
  purpose: TransferPurpose = 'saldo',
  extra: { otherLegId?: string; rememberPair?: boolean; legIds?: string[] } = {},
  prefix = 'c',
) =>
  confirmTransfer(
    store,
    { proposalId, purpose, rememberPair: true, ...extra },
    'p1',
    clock,
    ids(prefix),
  );
const transfers = async (store: MemoryStore) =>
  (await loadAll(store, 'transfer', TransferSchema, { includeDeleted: true })).records;
async function usesOf(store: MemoryStore) {
  return movementUses({
    classes: (await loadAll(store, 'movementClass', MovementClassSchema)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema)).records,
  });
}
/** A store the journal no longer explains: a manual transfer edited by hand. */
async function diverge(store: MemoryStore) {
  await recordManualTransfer(
    store,
    {
      fromAccountId: 'acc-app-a',
      toAccountId: 'acc-app-b',
      amount: cents(100),
      date: isoDate('2027-01-01'),
      purpose: 'saldo',
    },
    'p1',
    clock,
    ids('m'),
  );
  const path = recordPath('transfer', 'tr-m-1');
  store.putRaw(path, (store.getRaw(path) ?? '').replace('100', '200'));
}

describe('runTransfers and confirmTransfer (plan 3c, task 5)', () => {
  it('a first transfer is a proposal and writes nothing', async () => {
    const store = await storeWith(...april);
    const empty = await snapshot(store);
    expect(await run(store)).toEqual({
      status: 'reconciled',
      written: 0,
      completed: 0,
      proposals: [
        {
          id: 'p-giro-o',
          transactionId: 'o',
          fromAccountId: 'acc-app-b',
          toAccountId: 'acc-app-a',
          legIds: ['i'],
          reason: 'new-pair',
        },
      ],
    });
    expect(await snapshot(store)).toEqual(empty);
  });

  it('confirming saldo writes one transfer with both legs; the next month is automatic', async () => {
    const store = await storeWith(...april);
    expect(await confirm(store, 'p-giro-o')).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      transferId: 'tr-o',
    });
    expect(await transfers(store)).toEqual([
      {
        id: 'tr-o',
        v: 1,
        rev: 1,
        fromAccountId: 'acc-app-b',
        toAccountId: 'acc-app-a',
        amount: 20000,
        date: '2027-04-02',
        outTransactionId: 'o',
        inTransactionId: 'i',
        purpose: 'saldo',
        source: 'confirmed',
      },
    ]);
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.summary])).toEqual([
      ['transfer.confirm', 'Confermato un giroconto.'],
    ]);
    expect(Object.fromEntries(await usesOf(store))).toEqual({ o: ['giroconto'], i: ['giroconto'] });
    expect(await run(store)).toMatchObject({ written: 0, proposals: [] });

    await put(store, 'transaction', [
      ...may,
      // Appartamento A → Appartamento B: the other direction is a new pair.
      tx('b', 'acc-app-a', '2027-05-10', -8000, APT_B),
    ]);
    const result = await run(store);
    expect(result).toEqual({
      status: 'reconciled',
      written: 1,
      completed: 0,
      proposals: [expect.objectContaining({ id: 'p-giro-b', reason: 'new-pair', legIds: [] })],
      operationId: 'r-1',
    });
    const auto = (await transfers(store)).find((t) => t.id === 'tr-o2');
    expect(auto).toMatchObject({ source: 'auto', purpose: 'saldo', inTransactionId: 'i2' });
    expect((await readJournal(store)).operations.at(-1)).toMatchObject({
      kind: 'transfer.reconcile',
      summary: 'Riconciliati i giroconti: 1 automatico, 1 da rivedere.',
    });

    // The second run writes nothing.
    const once = await snapshot(store);
    expect(await run(store, 's')).toEqual({
      status: 'reconciled',
      written: 0,
      completed: 0,
      proposals: [expect.objectContaining({ id: 'p-giro-b' })],
    });
    expect(await snapshot(store)).toEqual(once);
  });

  it('a dry run writes nothing and says what a real run writes', async () => {
    const store = await storeWith(...april, ...may);
    await confirm(store, 'p-giro-o');
    const before = await snapshot(store);
    const dry = await run(store, 'd', true);
    expect(await snapshot(store)).toEqual(before);
    expect(dry).toEqual({ status: 'reconciled', written: 1, completed: 0, proposals: [] });
  });

  it('rememberPair false: a one-off, the next one is not automatic', async () => {
    const store = await storeWith(...april, ...may);
    expect(await confirm(store, 'p-giro-o', 'saldo', { rememberPair: false })).toMatchObject({
      status: 'confirmed',
    });
    expect((await transfers(store))[0]).toMatchObject({ id: 'tr-o', oneOff: true });
    expect(await run(store)).toMatchObject({
      written: 0,
      proposals: [{ id: 'p-giro-o2', reason: 'new-pair' }],
    });
  });

  it('two confirmations with different purposes: purpose-conflict', async () => {
    // May has two candidate legs, so it stays a proposal (with the purpose of the pair) even
    // though the pair is known; confirmed as mutuo, the pair has two purposes.
    const store = await storeWith(
      ...april,
      ...may,
      tx('i2b', 'acc-app-a', '2027-05-06', 15000),
      tx('o3', 'acc-app-b', '2027-06-01', -5000, APT_A),
    );
    await confirm(store, 'p-giro-o', 'saldo', {}, 'c');
    expect(await run(store, 'd', true)).toMatchObject({
      written: 1,
      proposals: [{ id: 'p-giro-o2', reason: 'several-legs', purpose: 'saldo' }],
    });
    await confirm(store, 'p-giro-o2', 'mutuo', { otherLegId: 'i2' }, 'k');
    expect(await run(store)).toEqual({
      status: 'reconciled',
      written: 0,
      completed: 0,
      proposals: [expect.objectContaining({ id: 'p-giro-o3', reason: 'purpose-conflict' })],
    });
  });

  it('several legs: the person picks one; an id outside the legs is refused', async () => {
    const store = await storeWith(...april, tx('i-bis', 'acc-app-a', '2027-04-03', 20000));
    expect(await run(store)).toMatchObject({
      proposals: [{ id: 'p-giro-o', legIds: ['i', 'i-bis'], reason: 'several-legs' }],
    });
    const before = await snapshot(store);
    expect(await confirm(store, 'p-giro-o', 'saldo', { otherLegId: 'x' })).toEqual({
      status: 'refused',
      reason: 'leg-not-allowed',
    });
    expect(await snapshot(store)).toEqual(before);
    expect(await confirm(store, 'p-giro-o', 'altro', { otherLegId: 'i-bis' })).toMatchObject({
      status: 'confirmed',
    });
    expect((await transfers(store))[0]).toMatchObject({
      inTransactionId: 'i-bis',
      purpose: 'altro',
    });
  });

  it('several legs without a choice: only the movement of the proposal', async () => {
    const store = await storeWith(...april, tx('i-bis', 'acc-app-a', '2027-04-03', 20000));
    await confirm(store, 'p-giro-o');
    expect((await transfers(store))[0]).not.toHaveProperty('inTransactionId');
  });

  it('one leg without a statement of the other account is enough', async () => {
    const store = await storeWith(tx('i', 'acc-app-a', '2027-04-07', 20000, APT_B));
    expect(await confirm(store, 'p-giro-i', 'saldo')).toMatchObject({ transferId: 'tr-i' });
    expect((await transfers(store))[0]).toEqual({
      id: 'tr-i',
      v: 1,
      rev: 1,
      fromAccountId: 'acc-app-b',
      toAccountId: 'acc-app-a',
      amount: 20000,
      date: '2027-04-07',
      inTransactionId: 'i',
      purpose: 'saldo',
      source: 'confirmed',
    });
  });

  it('one leg confirmed, then the other statement: the transfer is completed, never doubled', async () => {
    const store = await storeWith(tx('i', 'acc-app-a', '2027-04-07', 20000, APT_B));
    await confirm(store, 'p-giro-i');
    await put(store, 'transaction', [april[0] as ReturnType<typeof tx>]);
    expect(await run(store, 'd', true)).toEqual({
      status: 'reconciled',
      written: 0,
      completed: 1,
      proposals: [],
    });
    const result = await run(store);
    expect(result).toMatchObject({ written: 0, completed: 1, proposals: [], operationId: 'r-1' });
    expect(await transfers(store)).toEqual([
      {
        id: 'tr-i',
        v: 1,
        rev: 2,
        fromAccountId: 'acc-app-b',
        toAccountId: 'acc-app-a',
        amount: 20000,
        date: '2027-04-07',
        outTransactionId: 'o',
        inTransactionId: 'i',
        purpose: 'saldo',
        source: 'confirmed',
      },
    ]);
    expect((await readJournal(store)).operations.at(-1)).toMatchObject({
      kind: 'transfer.reconcile',
      summary: 'Riconciliati i giroconti: 1 automatico, 0 da rivedere.',
    });
    expect(Object.fromEntries(await usesOf(store))).toEqual({ i: ['giroconto'], o: ['giroconto'] });
    const once = await snapshot(store);
    expect(await run(store, 's')).toMatchObject({ written: 0, completed: 0 });
    expect(await snapshot(store)).toEqual(once);

    // Undone, the transfer has its one leg again.
    await undoOperation(store, 'r-1', 'p1', clock, ids('u'));
    const [back] = await transfers(store);
    expect(back).toMatchObject({ id: 'tr-i', inTransactionId: 'i' });
    expect(back).not.toHaveProperty('outTransactionId');
    expect(Object.fromEntries(await usesOf(store))).toEqual({ i: ['giroconto'] });
  });

  it('the state changed after the proposal: unknown-proposal or leg-not-allowed, nothing written', async () => {
    // The movement of the proposal excluded.
    const excluded = await storeWith(...april);
    await run(excluded, 'd', true);
    await excludeMovement(
      excluded,
      { transactionId: 'o', reason: 'doppione' },
      'p1',
      clock,
      ids('x'),
    );
    let before = await snapshot(excluded);
    expect(await confirm(excluded, 'p-giro-o')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await snapshot(excluded)).toEqual(before);

    // The movement of the proposal became a leg of another transfer: the statement of the
    // other account came in later, and its outgoing was confirmed with it.
    const linked = await storeWith(tx('i', 'acc-app-a', '2027-04-07', 20000, APT_B));
    expect(await run(linked, 'd', true)).toMatchObject({ proposals: [{ id: 'p-giro-i' }] });
    await put(linked, 'transaction', [april[0] as ReturnType<typeof tx>]);
    expect(await confirm(linked, 'p-giro-o', 'saldo', { otherLegId: 'i' })).toMatchObject({
      transferId: 'tr-o',
    });
    before = await snapshot(linked);
    expect(await confirm(linked, 'p-giro-i', 'saldo', {}, 'k')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await snapshot(linked)).toEqual(before);

    // The other leg excluded after the proposal: unknown-proposal, with or without otherLegId
    // (fix round 1, Minor 3); an id that never was a leg stays leg-not-allowed.
    const leg = await storeWith(...april);
    await excludeMovement(leg, { transactionId: 'i', reason: 'doppione' }, 'p1', clock, ids('x'));
    before = await snapshot(leg);
    expect(await confirm(leg, 'p-giro-o', 'saldo', { otherLegId: 'i' })).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(leg, 'p-giro-o', 'saldo', { legIds: ['i'] })).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirm(leg, 'p-giro-o', 'saldo', { otherLegId: 'x' })).toEqual({
      status: 'refused',
      reason: 'leg-not-allowed',
    });
    expect(await snapshot(leg)).toEqual(before);
    // The legs shown are the legs now: confirmed.
    expect(await confirm(leg, 'p-giro-o', 'saldo', { legIds: [] }, 'k')).toMatchObject({
      status: 'confirmed',
    });
    expect(await confirm(leg, 'p-giro-nessuna')).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
  });

  it('a leg cannot be excluded while its transfer is live: has-dependents', async () => {
    const store = await storeWith(...april);
    await confirm(store, 'p-giro-o');
    for (const transactionId of ['o', 'i']) {
      expect(
        await excludeMovement(store, { transactionId, reason: 'doppione' }, 'p1', clock, ids('x')),
      ).toEqual({ status: 'refused', reason: 'has-dependents', recordIds: ['tr-o'] });
    }
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect(
      await excludeMovement(
        store,
        { transactionId: 'i', reason: 'doppione' },
        'p1',
        clock,
        ids('x'),
      ),
    ).toMatchObject({ status: 'excluded' });
  });

  it('refuses a diverged store and writes nothing', async () => {
    const store = await storeWith(...april);
    await diverge(store);
    const diverged = await snapshot(store);
    const refused = { status: 'refused', reason: 'inconsistent-store' };
    expect(await run(store)).toEqual(refused);
    expect(await confirm(store, 'p-giro-o')).toEqual(refused);
    expect(
      await recordManualTransfer(
        store,
        {
          fromAccountId: 'acc-app-a',
          toAccountId: 'acc-app-b',
          amount: cents(100),
          date: isoDate('2027-01-01'),
          purpose: 'saldo',
        },
        'p1',
        clock,
        ids('z'),
      ),
    ).toEqual(refused);
    expect(await snapshot(store)).toEqual(diverged);
  });
});

describe('recordManualTransfer (plan 3c, task 5; section 24)', () => {
  const manual = (store: MemoryStore, extra = {}) =>
    recordManualTransfer(
      store,
      {
        fromAccountId: 'acc-app-a',
        toAccountId: 'acc-app-b',
        amount: cents(6300),
        date: isoDate('2027-04-30'),
        purpose: 'saldo',
        ...extra,
      },
      'p1',
      clock,
      ids('m'),
    );

  it('writes a manual transfer without movements in one transfer.manual operation', async () => {
    const store = await storeWith();
    expect(await manual(store)).toEqual({
      status: 'recorded',
      operationId: 'm-2',
      transferId: 'tr-m-1',
    });
    expect(await transfers(store)).toEqual([
      {
        id: 'tr-m-1',
        v: 1,
        rev: 1,
        fromAccountId: 'acc-app-a',
        toAccountId: 'acc-app-b',
        amount: 6300,
        date: '2027-04-30',
        purpose: 'saldo',
        source: 'manual',
      },
    ]);
    expect((await readJournal(store)).operations.map((o) => [o.kind, o.summary])).toEqual([
      ['transfer.manual', 'Registrata una restituzione a mano.'],
    ]);
  });

  it('E2: the same transfer again is unchanged; a second identical one needs its own id', async () => {
    const store = await storeWith();
    await manual(store);
    expect(await manual(store)).toEqual({ status: 'unchanged', transferId: 'tr-m-1' });
    expect(await manual(store, { id: 'tr-contanti-2' })).toMatchObject({
      status: 'recorded',
      transferId: 'tr-contanti-2',
    });
    expect(await manual(store, { id: 'tr-contanti-2' })).toEqual({
      status: 'unchanged',
      transferId: 'tr-contanti-2',
    });
    expect(await manual(store, { id: 'tr-contanti-2', amount: cents(100) })).toEqual({
      status: 'refused',
      reason: 'id-in-use',
    });
    expect(await transfers(store)).toHaveLength(2);
  });

  it.each([
    ['unknown-account', { toAccountId: 'acc-nessuno' }],
    ['same-account', { toAccountId: 'acc-app-a' }],
    ['invalid-amount', { amount: cents(0) }],
    ['invalid-amount', { amount: cents(-100) }],
  ])('refuses %s and writes nothing', async (reason, extra) => {
    const store = await storeWith();
    expect(await manual(store, extra)).toEqual({ status: 'refused', reason });
    expect(await snapshot(store)).toEqual(await snapshot(await storeWith()));
  });
});
