import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  MovementClassSchema,
  cents,
  confirmMatch,
  excludeMovement,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  runMatch,
  undoOperation,
} from '../src/index';
import type { ConfirmMatchInput, RecordKind } from '../src/index';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Synthetic records only: one account of Berchet with the statements of January and March 2027.
const base = { v: 1, rev: 1 };
const account = {
  ...base,
  id: 'acc-b',
  apartmentId: 'berchet',
  label: 'Conto',
  bankProfileId: 'bp',
};
const statement = (id: string, from: string, to: string) => ({
  ...base,
  id,
  accountId: 'acc-b',
  bankProfileId: 'bp',
  fileName: `${id}.csv`,
  suggestedPath: `estratti/${id}.csv`,
  from,
  to,
  periodSource: 'file',
  rowCount: 0,
  transactionIds: [],
  held: [],
});
const instalment = (id: string, dueDate: string, rata = 15000, extra = {}) => ({
  ...base,
  id,
  apartmentId: 'berchet',
  kind: 'condominio',
  esercizio: '2026-27',
  rateIndex: 1,
  rateCount: 3,
  dueDate,
  rata,
  quotaProprieta: 0,
  conguaglioPrec: 0,
  coversFrom: '2027-01',
  coversTo: '2027-04',
  ...extra,
});
const bill = (id: string, amount: number, dueDate: string, supplier = 'Hera') => ({
  ...base,
  id,
  apartmentId: 'berchet',
  category: 'gas',
  supplier,
  dueDate,
  periodStart: '2026-11-01',
  periodEnd: '2026-12-31',
  amount,
  includedInConguaglio: true,
  sharedWithTenants: true,
  fileHash: `hash-${id}`,
  filePath: `bollette/${id}.pdf`,
});
const tx = (id: string, date: string, amount: number, description = 'ADDEBITO CONDOMINIO') => ({
  ...base,
  id,
  apartmentId: 'berchet',
  accountId: 'acc-b',
  date,
  amount,
  description,
  statementHash: 'st-1',
});

type Rec = { id: string } & Record<string, unknown>;
async function build(records: Partial<Record<RecordKind, Rec[]>>) {
  const store = new MemoryStore();
  const all: Partial<Record<RecordKind, Rec[]>> = {
    account: [account],
    statement: [
      statement('s-jan', '2027-01-01', '2027-01-31'),
      statement('s-mar', '2027-03-01', '2027-03-31'),
    ],
    ...records,
  };
  for (const [kind, list] of Object.entries(all) as [RecordKind, Rec[]][]) {
    for (const record of list) {
      await store.writeJsonAtomic(recordPath(kind, record.id), recordSchemas[kind].parse(record));
    }
  }
  return store;
}

const instalments = () => [
  instalment('i-jan', '2027-01-20'),
  instalment('i-feb', '2027-02-15'),
  instalment('i-mar', '2027-03-10'),
];
const run = (store: MemoryStore, prefix = 'r', dryRun = false) =>
  runMatch(store, 'p1', clock, ids(prefix), { dryRun });
const matches = async (store: MemoryStore) =>
  (await loadAll(store, 'match', BillMatchSchema, { includeDeleted: true })).records;
const classes = async (store: MemoryStore) =>
  (await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })).records;
const hera = (extra = {}) => ({
  ...base,
  id: 'mc-tx-hera',
  transactionId: 'tx-hera',
  kind: 'utenze',
  apartmentId: 'berchet',
  ...extra,
});

describe('runMatch (plan 3c, task 3)', () => {
  it('matches inside a statement, assumes outside, leaves pending without a debit', async () => {
    const store = await build({
      instalment: instalments(),
      transaction: [tx('tx-jan', '2027-01-22', -15000)],
    });
    expect(await run(store)).toEqual({
      status: 'matched',
      written: 1,
      yielded: 0,
      proposals: [],
      pending: [{ itemType: 'instalment', itemId: 'i-mar' }],
      ambiguous: [],
      assumed: [{ itemType: 'instalment', itemId: 'i-feb' }],
      invalidGroups: [],
      operationId: 'r-1',
    });
    expect(await matches(store)).toEqual([
      {
        ...base,
        id: 'm-instalment-i-jan-amount-tx-jan',
        itemType: 'instalment',
        itemId: 'i-jan',
        transactionId: 'tx-jan',
        transactionDate: '2027-01-22',
        amount: 15000,
        part: 'amount',
        confirmed: true,
        by: 'auto',
      },
    ]);
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.summary, o.apartmentId])).toEqual([
      ['match.reconcile', 'Abbinate le voci: 1 automatica, 0 da rivedere.', 'berchet'],
    ]);
  });

  it('an excluded debit is not matched: its instalment stays pending', async () => {
    const store = await build({
      instalment: instalments(),
      transaction: [tx('tx-jan', '2027-01-22', -15000)],
    });
    await excludeMovement(
      store,
      { transactionId: 'tx-jan', reason: 'doppione' },
      'p1',
      clock,
      ids('x'),
    );
    expect(await run(store)).toMatchObject({
      written: 0,
      pending: [
        { itemType: 'instalment', itemId: 'i-jan' },
        { itemType: 'instalment', itemId: 'i-mar' },
      ],
    });
    expect(await matches(store)).toEqual([]);
  });

  it('proposals, never written: no supplier in the description, or another amount', async () => {
    const noSupplier = await build({
      bill: [bill('b-hera', 6300, '2027-03-10')],
      transaction: [tx('tx-hera', '2027-03-12', -6300, 'ADDEBITO DIRETTO SDD')],
    });
    const before = await snapshot(noSupplier);
    expect(await run(noSupplier)).toMatchObject({
      written: 0,
      proposals: [
        {
          id: 'p-abb-b-hera',
          itemType: 'bill',
          itemId: 'b-hera',
          transactionId: 'tx-hera',
          reason: 'no-supplier',
        },
      ],
      pending: [],
    });
    expect(await snapshot(noSupplier)).toEqual(before);

    const other = await build({
      bill: [bill('b-hera', 6300, '2027-03-10')],
      transaction: [tx('tx-hera', '2027-03-12', -6500, 'ADDEBITO SDD HERA COMM')],
    });
    expect(await run(other)).toMatchObject({
      written: 0,
      proposals: [{ id: 'p-abb-b-hera', transactionId: 'tx-hera', reason: 'amount-differs' }],
    });
    expect(await matches(other)).toEqual([]);
  });

  it('question 6: an automatic class yields to the bill in the same operation, undone together', async () => {
    const store = await build({
      bill: [bill('b-hera', 6300, '2027-03-10')],
      transaction: [tx('tx-hera', '2027-03-12', -6300, 'ADDEBITO SDD HERA COMM')],
      movementClass: [hera({ ruleId: 'rule-tx-old' })],
    });
    expect(await run(store)).toMatchObject({ written: 1, yielded: 1, proposals: [] });
    const [operation] = (await readJournal(store)).operations;
    expect(operation?.kind).toBe('match.reconcile');
    expect(operation?.changes.map((c) => c.path).sort()).toEqual([
      recordPath('match', 'm-bill-b-hera-amount-tx-hera'),
      recordPath('movementClass', 'mc-tx-hera'),
    ]);
    expect(await classes(store)).toMatchObject([{ id: 'mc-tx-hera', deleted: true }]);

    await undoOperation(store, 'r-1', 'p1', clock, ids('u'));
    const [cls] = await classes(store);
    expect(cls).toMatchObject({ id: 'mc-tx-hera', ruleId: 'rule-tx-old' });
    expect(cls).not.toHaveProperty('deleted');
    expect(await matches(store)).toMatchObject([
      { id: 'm-bill-b-hera-amount-tx-hera', deleted: true },
    ]);
  });

  it('question 6: a class confirmed by hand stays, the match becomes a proposal', async () => {
    const store = await build({
      bill: [bill('b-hera', 6300, '2027-03-10')],
      transaction: [tx('tx-hera', '2027-03-12', -6300, 'ADDEBITO SDD HERA COMM')],
      movementClass: [hera()],
    });
    const before = await snapshot(store);
    expect(await run(store)).toMatchObject({
      written: 0,
      yielded: 0,
      proposals: [
        {
          id: 'p-abb-b-hera',
          itemType: 'bill',
          itemId: 'b-hera',
          transactionId: 'tx-hera',
          reason: 'classified',
        },
      ],
      pending: [],
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('a debit with a live payment is not matched', async () => {
    const store = await build({
      instalment: [instalment('i-jan', '2027-01-20')],
      transaction: [tx('tx-jan', '2027-01-22', -15000)],
      payment: [
        {
          ...base,
          id: 'pay-tx-jan-1',
          apartmentId: 'berchet',
          tenantId: 't1',
          date: '2027-01-22',
          amount: -15000,
          confirmed: true,
          kind: 'altro',
          forMonth: '2027-01',
          source: 'csv',
          transactionId: 'tx-jan',
        },
      ],
    });
    expect(await run(store)).toMatchObject({
      written: 0,
      pending: [{ itemType: 'instalment', itemId: 'i-jan' }],
    });
  });

  it('a second run writes nothing; dryRun writes nothing; a diverged store is refused', async () => {
    const records = {
      instalment: instalments(),
      transaction: [tx('tx-jan', '2027-01-22', -15000)],
    };
    const dry = await build(records);
    const empty = await snapshot(dry);
    expect(await run(dry, 'd', true)).toMatchObject({ status: 'matched', written: 1 });
    expect(await run(dry, 'd', true)).not.toHaveProperty('operationId');
    expect(await snapshot(dry)).toEqual(empty);

    const store = await build(records);
    await run(store);
    const once = await snapshot(store);
    expect(await run(store, 's')).toMatchObject({ written: 0, yielded: 0 });
    expect(await run(store, 's')).not.toHaveProperty('operationId');
    expect(await snapshot(store)).toEqual(once);

    const path = recordPath('match', 'm-instalment-i-jan-amount-tx-jan');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('15000', '14000'));
    const diverged = await snapshot(store);
    expect(await run(store, 'z')).toEqual({ status: 'refused', reason: 'inconsistent-store' });
    expect(await snapshot(store)).toEqual(diverged);
  });
});

describe('confirmMatch (plan 3c, task 3)', () => {
  const records = () => ({
    bill: [bill('b100', 10000, '2027-01-15')],
    transaction: [
      tx('tx-a', '2027-01-10', -6000, 'BONIFICO'),
      tx('tx-b', '2027-01-12', -4000, 'BONIFICO'),
    ],
  });
  const part = (
    transactionId: string,
    amount: number,
    itemId = 'b100',
  ): ConfirmMatchInput['parts'][number] => ({
    itemType: 'bill',
    itemId,
    transactionId,
    amount: cents(amount),
    part: 'amount',
  });
  const confirm = (store: MemoryStore, parts: ConfirmMatchInput['parts']) =>
    confirmMatch(store, { parts }, 'p1', clock, ids('c'));

  it('one bill over two debits: manual confirmed matches in one match.confirm', async () => {
    const store = await build(records());
    expect(await confirm(store, [part('tx-a', 6000), part('tx-b', 4000)])).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      matchIds: ['m-bill-b100-amount-tx-a', 'm-bill-b100-amount-tx-b'],
    });
    expect(await matches(store)).toMatchObject([
      { id: 'm-bill-b100-amount-tx-a', amount: 6000, by: 'manual', confirmed: true },
      { id: 'm-bill-b100-amount-tx-b', amount: 4000, by: 'manual', confirmed: true },
    ]);
    const { operations } = await readJournal(store);
    expect(operations.map((o) => [o.kind, o.summary])).toEqual([
      ['match.confirm', 'Confermato un abbinamento: 1 voce.'],
    ]);
    // The run after keeps them and writes nothing.
    expect(await run(store)).toMatchObject({ written: 0, pending: [], proposals: [] });
  });

  it('refuses without writing', async () => {
    const store = await build({
      ...records(),
      transaction: [...records().transaction, tx('tx-c', '2027-01-13', -4000, 'BONIFICO')],
      movementClass: [
        {
          ...base,
          id: 'mc-tx-c',
          transactionId: 'tx-c',
          kind: 'altro',
          apartmentId: 'berchet',
        },
      ],
    });
    await excludeMovement(
      store,
      { transactionId: 'tx-b', reason: 'doppione' },
      'p1',
      clock,
      ids('x'),
    );
    const before = await snapshot(store);
    expect(await confirm(store, [part('tx-a', 6000), part('tx-c', 3000)])).toEqual({
      status: 'refused',
      reason: 'transaction-used',
    });
    expect(await confirm(store, [part('tx-a', 6000), part('tx-b', 4000)])).toEqual({
      status: 'refused',
      reason: 'transaction-used',
    });
    expect(await confirm(store, [])).toEqual({ status: 'refused', reason: 'empty-parts' });
    expect(await confirm(store, [part('tx-a', 6000, 'b-none')])).toEqual({
      status: 'refused',
      reason: 'unknown-item',
    });
    expect(await confirm(store, [part('tx-none', 6000)])).toEqual({
      status: 'refused',
      reason: 'unknown-transaction',
    });
    expect(await snapshot(store)).toEqual(before);

    const short = await build({
      bill: [bill('b100', 10000, '2027-01-15')],
      transaction: [tx('tx-a', '2027-01-10', -6000), tx('tx-b', '2027-01-12', -3000)],
    });
    const untouched = await snapshot(short);
    expect(await confirm(short, [part('tx-a', 6000), part('tx-b', 3000)])).toEqual({
      status: 'refused',
      reason: 'invalid-matches',
      errors: [{ code: 'item-under', id: 'b100' }],
    });
    expect(await snapshot(short)).toEqual(untouched);
  });

  it('an automatic class yields; a shared instalment is checked on its share of the notice', async () => {
    const shared = (id: string, apartmentId: string, weight: number) =>
      instalment(id, '2027-01-20', weight, {
        kind: 'tari',
        esercizio: '2027',
        apartmentId,
        paidFromApartmentId: 'berchet',
        shared: { groupId: 'avviso-1', groupTotal: 18600, weight },
      });
    const store = await build({
      instalment: [shared('tari-b', 'berchet', 10075), shared('tari-l', 'lovarini', 8525)],
      transaction: [tx('tx-t', '2027-01-21', -18600, 'BONIFICO')],
      movementClass: [
        {
          ...base,
          id: 'mc-tx-t',
          transactionId: 'tx-t',
          kind: 'utenze',
          apartmentId: 'berchet',
          ruleId: 'rule-x',
        },
      ],
    });
    const tari = (itemId: string, amount: number): ConfirmMatchInput['parts'][number] => ({
      ...part('tx-t', amount, itemId),
      itemType: 'instalment',
    });
    expect(await confirm(store, [tari('tari-b', 10074), tari('tari-l', 8526)])).toEqual({
      status: 'refused',
      reason: 'invalid-matches',
      errors: [
        { code: 'item-over', id: 'tari-l' },
        { code: 'item-under', id: 'tari-b' },
      ],
    });
    expect(await confirm(store, [tari('tari-b', 10075), tari('tari-l', 8525)])).toMatchObject({
      status: 'confirmed',
    });
    expect(await classes(store)).toMatchObject([{ id: 'mc-tx-t', deleted: true }]);
    const [operation] = (await readJournal(store)).operations;
    expect(operation?.summary).toBe('Confermato un abbinamento: 2 voci.');
  });

  it('fix round 1: duplicate parts, a live payment, a part already saved, an invalid notice', async () => {
    const store = await build({
      bill: [bill('b100', 10000, '2027-01-15')],
      transaction: [tx('tx-a', '2027-01-10', -10000, 'BONIFICO'), tx('tx-p', '2027-01-11', -10000)],
      payment: [
        {
          ...base,
          id: 'pay-tx-p-1',
          apartmentId: 'berchet',
          tenantId: 't1',
          date: '2027-01-11',
          amount: -10000,
          confirmed: true,
          kind: 'altro',
          forMonth: '2027-01',
          source: 'csv',
          transactionId: 'tx-p',
        },
      ],
    });
    const before = await snapshot(store);
    expect(await confirm(store, [part('tx-a', 5000), part('tx-a', 5000)])).toEqual({
      status: 'refused',
      reason: 'duplicate-part',
    });
    expect(await confirm(store, [part('tx-p', 10000)])).toEqual({
      status: 'refused',
      reason: 'transaction-used',
    });
    expect(await snapshot(store)).toEqual(before);
    // A part with the id of a confirmed match already saved counts twice: refused, never replaced.
    await confirm(store, [part('tx-a', 10000)]);
    const saved = await snapshot(store);
    expect(await confirm(store, [part('tx-a', 10000)])).toEqual({
      status: 'refused',
      reason: 'invalid-matches',
      errors: [
        { code: 'item-over', id: 'b100' },
        { code: 'transaction-over', id: 'tx-a' },
      ],
    });
    expect(await snapshot(store)).toEqual(saved);

    const notice = (id: string, apartmentId: string, weight: number, groupTotal = 18600) =>
      instalment(id, '2027-01-20', weight, {
        kind: 'tari',
        esercizio: '2027',
        apartmentId,
        paidFromApartmentId: 'berchet',
        shared: { groupId: 'avviso-1', groupTotal, weight },
      });
    const tari = (itemId: string, amount: number): ConfirmMatchInput['parts'][number] => ({
      ...part('tx-t', amount, itemId),
      itemType: 'instalment',
    });
    const cases = [
      [notice('tari-b', 'berchet', 10075)],
      [notice('tari-b', 'berchet', 10075), notice('tari-l', 'lovarini', 8525, 18700)],
      [notice('tari-b', 'berchet', 10075), notice('tari-l', 'lovarini', 0)],
    ];
    for (const group of cases) {
      const s = await build({
        instalment: group,
        transaction: [tx('tx-t', '2027-01-21', -18600, 'BONIFICO')],
      });
      const untouched = await snapshot(s);
      // The run shows the invalid notice (its instalments stay pending), R125 and task 10.
      expect(await run(s, 'g', true)).toMatchObject({
        invalidGroups: [
          { groupId: 'avviso-1', reason: group.length === 1 ? 'incomplete' : 'inconsistent' },
        ],
      });
      expect(await confirm(s, [tari('tari-b', 18600)])).toEqual({
        status: 'refused',
        reason: 'invalid-group',
      });
      expect(await snapshot(s)).toEqual(untouched);
    }
  });

  it('refuses a diverged store', async () => {
    const store = await build(records());
    await confirm(store, [part('tx-a', 6000), part('tx-b', 4000)]);
    const path = recordPath('match', 'm-bill-b100-amount-tx-a');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('6000', '5000'));
    const diverged = await snapshot(store);
    expect(await confirm(store, [part('tx-a', 6000)])).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
    expect(await snapshot(store)).toEqual(diverged);
  });

  it('I1: a bill confirmed for its whole, different debit (R2), never an instalment', async () => {
    const store = await build({
      bill: [bill('b100', 10000, '2027-01-15')],
      instalment: [instalment('i-x', '2027-01-20')],
      transaction: [
        tx('tx-a', '2027-01-16', -10500, 'ADDEBITO HERA'),
        tx('tx-c', '2027-01-20', -15500),
      ],
    });
    // Part of the debit, or more than it: still refused as before.
    expect(await confirm(store, [part('tx-a', 10400)])).toMatchObject({
      reason: 'invalid-matches',
    });
    expect(
      await confirm(store, [
        {
          itemType: 'instalment',
          itemId: 'i-x',
          transactionId: 'tx-c',
          amount: cents(15500),
          part: 'amount',
        },
      ]),
    ).toMatchObject({ reason: 'invalid-matches', errors: [{ code: 'item-over', id: 'i-x' }] });
    expect(await confirm(store, [part('tx-a', 10500)])).toEqual({
      status: 'confirmed',
      operationId: 'c-1',
      matchIds: ['m-bill-b100-amount-tx-a'],
      amountDiffers: ['b100'],
    });
    expect(await matches(store)).toMatchObject([{ amount: 10500, by: 'manual' }]);
  });
});
