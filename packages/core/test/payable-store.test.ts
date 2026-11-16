import { describe, expect, it } from 'vitest';
import {
  PayableSchema,
  assignImuF24,
  commitChange,
  isoDate,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  repeatPayable,
  savePayable,
  setPayablePaid,
  undoBlockedBy,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { cents } from '../src/money';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartment, landlord, amounts and dates only (plan 9).
const base = { v: 1, rev: 1 };
const tx = (id: string, amount = -6700) => ({
  ...base,
  id,
  apartmentId: 'pulci',
  date: '2026-11-10',
  amount,
  description: 'x',
  statementHash: 'h',
});
const cls = (transactionId: string, extra: object = {}) => ({
  ...base,
  id: `mc-${transactionId}`,
  transactionId,
  kind: 'tasse',
  apartmentId: 'pulci',
  ...extra,
});

async function seed(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
  prefix: string = kind,
) {
  const op = await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'Dati di prova.',
      changes: records.map((r) => ({
        path: recordPath(kind, r.id),
        after: recordSchemas[kind].parse(r),
      })),
    },
    clock,
    ids(prefix),
  );
  return op.id;
}

async function setup() {
  const store = new MemoryStore();
  await seed(store, 'apartment', [
    {
      ...base,
      id: 'pulci',
      name: 'pulci',
      locatore: 'Locatore Due',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
    },
  ]);
  await seed(store, 'transaction', [
    tx('t-hand'),
    tx('t-auto'),
    tx('t-none'),
    tx('t-imu'),
    tx('t-out'),
    tx('t-credit', 6700),
  ]);
  await seed(store, 'movementClass', [
    cls('t-auto', { ruleId: 'rule-x' }),
    cls('t-imu', { f24: true, imu: { f24Group: 'g', year: '2026', rateIndex: 1 } }),
    cls('t-out', { kind: 'escluso', apartmentId: undefined, excludeReason: 'doppione' }),
  ]);
  const handClassOp = await seed(store, 'movementClass', [cls('t-hand')], 'hand');
  return { store, handClassOp };
}

const op = (result: { status: string; operationId?: string }) =>
  'operationId' in result ? result.operationId : undefined;
const payables = async (store: MemoryStore) =>
  (await loadAll(store, 'payable', PayableSchema, { includeDeleted: true })).records;
const input = {
  apartmentId: 'pulci',
  kind: 'registro' as const,
  dueDate: isoDate('2026-11-16'),
};

describe('savePayable (plan 9, task 3)', () => {
  it('creates scad-<id> in one payable.save operation, then updates keeping the payment', async () => {
    const { store } = await setup();
    const created = await savePayable(store, input, 'user1', clock, ids('n'));
    expect(created).toEqual({
      status: 'saved',
      operationId: expect.any(String),
      payableId: 'scad-n-1',
    });
    const journal = await readJournal(store);
    expect(journal.operations.find((o) => o.id === op(created))).toMatchObject({
      kind: 'payable.save',
      summary: 'Salvata una scadenza.',
      apartmentId: 'pulci',
    });
    await setPayablePaid(
      store,
      { payableId: 'scad-n-1', date: isoDate('2026-11-12') },
      'user1',
      clock,
      ids('p'),
    );
    const updated = await savePayable(
      store,
      { ...input, id: 'scad-n-1', expected: cents(6700), repeatYearly: true },
      'user1',
      clock,
      ids('u'),
    );
    expect(updated.status).toBe('saved');
    expect(await payables(store)).toEqual([
      {
        ...base,
        id: 'scad-n-1',
        rev: 3,
        ...input,
        expected: 6700,
        repeatYearly: true,
        paid: { date: '2026-11-12' },
      },
    ]);
    expect(
      await savePayable(
        store,
        { ...input, id: 'scad-n-1', expected: cents(6700), repeatYearly: true },
        'user1',
        clock,
        ids('u'),
      ),
    ).toEqual({ status: 'unchanged', payableId: 'scad-n-1' });
  });

  it('refuses an unknown apartment or item and an amount not positive, writing nothing', async () => {
    const { store } = await setup();
    const before = (await readJournal(store)).operations.length;
    const refused = async (changes: object) =>
      savePayable(store, { ...input, ...changes }, 'user1', clock, ids('n'));
    expect(await refused({ apartmentId: 'nessuno' })).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    expect(await refused({ id: 'scad-x' })).toEqual({
      status: 'refused',
      reason: 'unknown-payable',
    });
    expect(await refused({ expected: 0 })).toEqual({ status: 'refused', reason: 'bad-amount' });
    expect(await refused({ expected: 1.5 })).toEqual({ status: 'refused', reason: 'bad-amount' });
    expect((await readJournal(store)).operations).toHaveLength(before);
  });
});

describe('reference year of a payable (plan 13)', () => {
  it('is written at creation, changed or removed only by a new save, never copied by a repeat', async () => {
    const { store } = await setup();
    await savePayable(
      store,
      { ...input, repeatYearly: true, taxYear: 2025 },
      'user1',
      clock,
      ids('n'),
    );
    const year = async (id: string) => (await payables(store)).find((p) => p.id === id)?.taxYear;
    expect(await year('scad-n-1')).toBe(2025);
    expect(
      await savePayable(
        store,
        { ...input, id: 'scad-n-1', repeatYearly: true, taxYear: 2025 },
        'user1',
        clock,
        ids('u'),
      ),
    ).toEqual({ status: 'unchanged', payableId: 'scad-n-1' });
    await savePayable(
      store,
      { ...input, id: 'scad-n-1', repeatYearly: true, taxYear: 2026 },
      'user1',
      clock,
      ids('u'),
    );
    expect((await payables(store))[0]).toMatchObject({ rev: 2, taxYear: 2026 });
    await repeatPayable(
      store,
      { payableId: 'scad-n-1', dueDate: isoDate('2027-11-16') },
      'user1',
      clock,
      ids('r'),
    );
    expect(await year('scad-r-1')).toBeUndefined();
    await repeatPayable(
      store,
      { payableId: 'scad-r-1', dueDate: isoDate('2028-11-16'), taxYear: 2027 },
      'user1',
      clock,
      ids('r2'),
    );
    expect(await year('scad-r2-1')).toBe(2027);
    await savePayable(
      store,
      { ...input, id: 'scad-n-1', repeatYearly: true },
      'user1',
      clock,
      ids('u2'),
    );
    expect(await year('scad-n-1')).toBeUndefined();
  });

  it('refuses a year that is not a whole number from 1 to 9999, writing nothing', async () => {
    const { store } = await setup();
    const before = (await readJournal(store)).operations.length;
    for (const taxYear of [0, 10000, 2026.5]) {
      expect(await savePayable(store, { ...input, taxYear }, 'user1', clock, ids('n'))).toEqual({
        status: 'refused',
        reason: 'bad-year',
      });
    }
    await savePayable(store, { ...input, repeatYearly: true }, 'user1', clock, ids('n'));
    expect(
      await repeatPayable(
        store,
        { payableId: 'scad-n-1', dueDate: isoDate('2027-11-16'), taxYear: 0 },
        'user1',
        clock,
        ids('r'),
      ),
    ).toEqual({ status: 'refused', reason: 'bad-year' });
    expect((await readJournal(store)).operations).toHaveLength(before + 1);
  });
});

describe('repeatPayable', () => {
  it('makes the next item with the due date given by the user, once', async () => {
    const { store } = await setup();
    await savePayable(
      store,
      { ...input, kind: 'bollo', expected: cents(1600), repeatYearly: true },
      'user1',
      clock,
      ids('n'),
    );
    const next = await repeatPayable(
      store,
      { payableId: 'scad-n-1', dueDate: isoDate('2027-11-15') },
      'user1',
      clock,
      ids('r'),
    );
    expect(next).toEqual({
      status: 'saved',
      operationId: expect.any(String),
      payableId: 'scad-r-1',
    });
    expect((await payables(store)).find((p) => p.id === 'scad-r-1')).toEqual({
      ...base,
      id: 'scad-r-1',
      apartmentId: 'pulci',
      kind: 'bollo',
      dueDate: '2027-11-15',
      repeatYearly: true,
      previousId: 'scad-n-1',
    });
    expect((await readJournal(store)).operations.find((o) => o.id === op(next))?.kind).toBe(
      'payable.repeat',
    );
    expect(
      await repeatPayable(
        store,
        { payableId: 'scad-n-1', dueDate: isoDate('2027-11-15') },
        'user1',
        clock,
        ids('r2'),
      ),
    ).toEqual({ status: 'refused', reason: 'already-repeated' });
  });

  it('refuses an unknown item, one not marked yearly and a bad amount', async () => {
    const { store } = await setup();
    await savePayable(store, input, 'user1', clock, ids('n'));
    const repeat = (payableId: string, expected?: number) =>
      repeatPayable(
        store,
        {
          payableId,
          dueDate: isoDate('2027-11-16'),
          ...(expected === undefined ? {} : { expected: cents(expected) }),
        },
        'user1',
        clock,
        ids('r'),
      );
    expect(await repeat('scad-x')).toEqual({ status: 'refused', reason: 'unknown-payable' });
    expect(await repeat('scad-n-1')).toEqual({ status: 'refused', reason: 'not-repeating' });
    await savePayable(
      store,
      { ...input, id: 'scad-n-1', repeatYearly: true },
      'user1',
      clock,
      ids('u'),
    );
    expect(await repeat('scad-n-1', 0)).toEqual({ status: 'refused', reason: 'bad-amount' });
  });
});

describe('setPayablePaid', () => {
  it('marks paid by a movement classified by hand, with its date; undo takes it back', async () => {
    const { store } = await setup();
    await savePayable(store, input, 'user1', clock, ids('n'));
    const paid = await setPayablePaid(
      store,
      { payableId: 'scad-n-1', transactionId: 't-hand' },
      'user1',
      clock,
      ids('p'),
    );
    expect(paid).toEqual({
      status: 'saved',
      operationId: expect.any(String),
      payableId: 'scad-n-1',
    });
    expect((await payables(store))[0]?.paid).toEqual({
      date: '2026-11-10',
      transactionId: 't-hand',
    });
    expect((await readJournal(store)).operations.find((o) => o.id === op(paid))).toMatchObject({
      kind: 'payable.paid',
      summary: 'Segnata pagata una scadenza.',
    });
    expect(
      await setPayablePaid(
        store,
        { payableId: 'scad-n-1', date: isoDate('2026-11-11') },
        'user1',
        clock,
        ids('p2'),
      ),
    ).toEqual({ status: 'refused', reason: 'already-paid' });
    if (paid.status !== 'saved') throw new Error('not saved');
    await undoOperation(store, paid.operationId, 'user1', clock, ids('undo'));
    expect((await payables(store))[0]?.paid).toBeUndefined();
  });

  it('refuses a movement that is unknown, a credit, unclassified, automatic, IMU or taken', async () => {
    const { store } = await setup();
    await savePayable(store, input, 'user1', clock, ids('n'));
    await savePayable(store, input, 'user1', clock, ids('m'));
    await setPayablePaid(
      store,
      { payableId: 'scad-m-1', transactionId: 't-hand' },
      'user1',
      clock,
      ids('p'),
    );
    const before = (await readJournal(store)).operations.length;
    const pay = (transactionId?: string) =>
      setPayablePaid(
        store,
        { payableId: 'scad-n-1', ...(transactionId === undefined ? {} : { transactionId }) },
        'user1',
        clock,
        ids('q'),
      );
    const reason = async (transactionId?: string) => {
      const result = await pay(transactionId);
      return result.status === 'refused' ? result.reason : result.status;
    };
    expect(await reason('t-missing')).toBe('unknown-transaction');
    expect(await reason('t-credit')).toBe('unknown-transaction');
    expect(await reason('t-none')).toBe('transaction-not-classified');
    expect(await reason('t-auto')).toBe('transaction-not-classified');
    expect(await reason('t-out')).toBe('transaction-not-classified');
    expect(await reason('t-imu')).toBe('transaction-used');
    expect(await reason('t-hand')).toBe('transaction-used');
    expect(await reason(undefined)).toBe('bad-date');
    expect(
      await setPayablePaid(
        store,
        { payableId: 'scad-x', date: isoDate('2026-11-11') },
        'user1',
        clock,
        ids('q'),
      ),
    ).toEqual({ status: 'refused', reason: 'unknown-payable' });
    expect((await readJournal(store)).operations).toHaveLength(before);
  });

  it('refuses both a date and a movement, writing nothing', async () => {
    const { store } = await setup();
    await savePayable(store, input, 'user1', clock, ids('n'));
    expect(
      await setPayablePaid(
        store,
        { payableId: 'scad-n-1', date: isoDate('2026-11-11'), transactionId: 't-hand' },
        'user1',
        clock,
        ids('q'),
      ),
    ).toEqual({ status: 'refused', reason: 'date-and-transaction' });
    expect((await payables(store))[0]?.paid).toBeUndefined();
  });

  it('blocks the undo of the creation of an item that has a live successor', async () => {
    const { store } = await setup();
    const created = await savePayable(
      store,
      { ...input, repeatYearly: true },
      'user1',
      clock,
      ids('n'),
    );
    const createdOp = op(created) ?? '';
    expect(await undoBlockedBy(store, createdOp)).toEqual([]);
    const next = await repeatPayable(
      store,
      { payableId: 'scad-n-1', dueDate: isoDate('2027-11-16') },
      'user1',
      clock,
      ids('r'),
    );
    expect(await undoBlockedBy(store, createdOp)).toEqual(['scad-r-1']);
    await undoOperation(store, op(next) ?? '', 'user1', clock, ids('undo'));
    expect(await undoBlockedBy(store, createdOp)).toEqual([]);
  });

  it('keeps the movement to one use: no IMU assignment, no undo of its class', async () => {
    const { store, handClassOp } = await setup();
    await savePayable(store, input, 'user1', clock, ids('n'));
    expect(await undoBlockedBy(store, handClassOp)).toEqual([]);
    await setPayablePaid(
      store,
      { payableId: 'scad-n-1', transactionId: 't-hand' },
      'user1',
      clock,
      ids('p'),
    );
    expect(await undoBlockedBy(store, handClassOp)).toEqual(['scad-n-1']);
    expect(
      await assignImuF24(
        store,
        { transactionId: 't-hand', f24Group: 'g', year: '2026', rateIndex: 1 },
        'user1',
        clock,
        ids('i'),
      ),
    ).toEqual({ status: 'refused', reason: 'payable-linked' });
  });
});
