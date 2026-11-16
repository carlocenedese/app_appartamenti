import { describe, expect, it } from 'vitest';
import {
  TaxEstimateSchema,
  TaxPaymentSchema,
  assignImuF24,
  assignTaxPayment,
  commitChange,
  copyPreviousTaxYear,
  isoDate,
  loadAll,
  loadTaxTable,
  savePayable,
  readJournal,
  recordPath,
  recordSchemas,
  setTaxEstimate,
  undoBlockedBy,
  undoOperation,
} from '../src/index';
import type { RecordKind } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartments, taxpayers and amounts only (plan 10).
const base = { v: 1, rev: 1 };
const apartment = (id: string, locatore = 'user1') => ({
  ...base,
  id,
  name: id,
  locatore,
  posti: 4,
  annualitaStart: { month: 10, day: 1 },
});
const tx = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  apartmentId: 'nord',
  accountId: 'acc-nord',
  date: '2026-06-16',
  amount,
  description: 'F24',
  statementHash: 'h1',
  ...extra,
});
const cls = (transactionId: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id: `mc-${transactionId}`,
  transactionId,
  kind: 'tasse',
  apartmentId: 'nord',
  f24: true,
  ...extra,
});

async function seed(
  store: MemoryStore,
  kind: RecordKind,
  records: ({ id: string } & Record<string, unknown>)[],
  prefix: string,
) {
  await commitChange(
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
}

async function fixtureStore() {
  const store = new MemoryStore();
  await seed(store, 'apartment', [apartment('nord'), apartment('sud', 'user2')], 's1');
  await seed(
    store,
    'transaction',
    [
      tx('tx-ced', -100000),
      tx('tx-in', 5000),
      tx('tx-imu', -60000),
      tx('tx-util', -3000),
      tx('tx-pend', -100, { booked: false }),
    ],
    's2',
  );
  await seed(
    store,
    'movementClass',
    [
      cls('tx-ced'),
      cls('tx-in'),
      cls('tx-imu', { imu: { f24Group: 'g', year: '2026', rateIndex: 1 } }),
      cls('tx-util', { kind: 'utenze', f24: undefined }),
      cls('tx-pend'),
    ],
    's3',
  );
  return store;
}

const refused = (reason: string) => ({ status: 'refused', reason });

describe('setTaxEstimate (plan 10, task 2)', () => {
  const write = (
    store: MemoryStore,
    amount: number,
    extra: Partial<{ apartmentId: string; year: string; voce: string }> = {},
    prefix = 'e',
  ) =>
    setTaxEstimate(
      store,
      {
        apartmentId: 'nord',
        year: '2026',
        voce: 'cedolare',
        amount: Number.isSafeInteger(amount) ? cents(amount) : amount,
        ...extra,
      } as Parameters<typeof setTaxEstimate>[1],
      'p1',
      clock,
      ids(prefix),
    );

  it('saves the amount typed by user1, then writes nothing for the same amount', async () => {
    const store = await fixtureStore();
    expect(await write(store, 180000)).toEqual({
      status: 'saved',
      operationId: 'e-1',
      estimateId: 'tax-nord-2026-cedolare',
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'e-1');
    expect(op).toMatchObject({ kind: 'tax.estimate', apartmentId: 'nord' });
    expect(op?.summary).toBe('Aggiornata una stima delle tasse.');
    const before = await snapshot(store);
    expect(await write(store, 180000, {}, 'z')).toEqual({
      status: 'unchanged',
      estimateId: 'tax-nord-2026-cedolare',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('takes zero, replaces with a new rev, comes back after an undo', async () => {
    const store = await fixtureStore();
    await write(store, 0);
    await write(store, 6700, {}, 'w');
    const [record] = (await loadAll(store, 'taxEstimate', TaxEstimateSchema)).records;
    expect(record).toMatchObject({ amount: 6700, rev: 2 });
    await undoOperation(store, 'w-1', 'p1', clock, ids('u'));
    await undoOperation(store, 'e-1', 'p1', clock, ids('v'));
    expect((await loadAll(store, 'taxEstimate', TaxEstimateSchema)).records).toEqual([]);
    expect(await write(store, 100, {}, 'x')).toMatchObject({ status: 'saved' });
  });

  it('refuses without writing', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    expect(await write(store, 1, { apartmentId: 'est' })).toEqual(refused('unknown-apartment'));
    expect(await write(store, 1, { year: '26' })).toEqual(refused('bad-year'));
    expect(await write(store, 1, { voce: 'irpef' })).toEqual(refused('bad-voce'));
    expect(await write(store, -1)).toEqual(refused('bad-amount'));
    expect(await write(store, 1.5)).toEqual(refused('bad-amount'));
    expect(await snapshot(store)).toEqual(before);
    const path = recordPath('apartment', 'nord');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('user1', 'user9'));
    expect(await write(store, 1)).toEqual(refused('inconsistent-store'));
  });
});

describe('copyPreviousTaxYear (plan 10, task 2)', () => {
  const estimate = (apartmentId: string, voce: string, year = '2025', amount = 1000) => ({
    ...base,
    id: `tax-${apartmentId}-${year}-${voce}`,
    apartmentId,
    year,
    voce,
    amount,
  });

  it('copies the live estimates of the year before in one operation, never on its own', async () => {
    const store = await fixtureStore();
    await seed(
      store,
      'taxEstimate',
      [
        estimate('nord', 'cedolare'),
        estimate('nord', 'imu', '2025', 0),
        estimate('sud', 'tari'),
        estimate('nord', 'tari', '2025', 5),
      ].map((e, i) => (i === 3 ? { ...e, deleted: true } : e)),
      's4',
    );
    expect(await copyPreviousTaxYear(store, { year: '2026' }, 'p1', clock, ids('c'))).toEqual({
      status: 'copied',
      operationId: 'c-1',
      estimateIds: ['tax-nord-2026-cedolare', 'tax-nord-2026-imu', 'tax-sud-2026-tari'],
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'c-1');
    expect(op).toMatchObject({ kind: 'tax.copy', summary: 'Copiate le stime dell’anno prima.' });
    const copied = (await loadAll(store, 'taxEstimate', TaxEstimateSchema)).records.filter(
      (e) => e.year === '2026',
    );
    expect(copied.map((e) => [e.id, e.amount, e.rev])).toEqual([
      ['tax-nord-2026-cedolare', 1000, 1],
      ['tax-nord-2026-imu', 0, 1],
      ['tax-sud-2026-tari', 1000, 1],
    ]);
    // The same copy again writes nothing; after a change it would overwrite: refused.
    const same = await snapshot(store);
    expect(await copyPreviousTaxYear(store, { year: '2026' }, 'p1', clock, ids('d'))).toEqual({
      status: 'unchanged',
      estimateIds: ['tax-nord-2026-cedolare', 'tax-nord-2026-imu', 'tax-sud-2026-tari'],
    });
    expect(await snapshot(store)).toEqual(same);
    await setTaxEstimate(
      store,
      { apartmentId: 'nord', year: '2026', voce: 'imu', amount: cents(5) },
      'p1',
      clock,
      ids('g'),
    );
    expect(await copyPreviousTaxYear(store, { year: '2026' }, 'p1', clock, ids('h'))).toEqual(
      refused('year-not-empty'),
    );
    await undoOperation(store, 'g-1', 'p1', clock, ids('k'));
    // After the undo the records come back with a new rev.
    await undoOperation(store, 'c-1', 'p1', clock, ids('u'));
    expect(
      await copyPreviousTaxYear(store, { year: '2026', apartmentId: 'sud' }, 'p1', clock, ids('f')),
    ).toMatchObject({ status: 'copied', estimateIds: ['tax-sud-2026-tari'] });
    const sud = (await loadAll(store, 'taxEstimate', TaxEstimateSchema)).records.find(
      (e) => e.id === 'tax-sud-2026-tari',
    );
    expect(sud?.rev).toBe(3);
  });

  it('refuses without writing', async () => {
    const store = await fixtureStore();
    await seed(store, 'taxEstimate', [estimate('nord', 'cedolare', '2026')], 's4');
    const before = await snapshot(store);
    const copy = (input: { year: string; apartmentId?: string }) =>
      copyPreviousTaxYear(store, input, 'p1', clock, ids('c'));
    expect(await copy({ year: '2026' })).toEqual(refused('year-not-empty'));
    expect(await copy({ year: '2026', apartmentId: 'sud' })).toEqual(refused('nothing-to-copy'));
    expect(await copy({ year: '2027', apartmentId: 'est' })).toEqual(refused('unknown-apartment'));
    expect(await copy({ year: 'x' })).toEqual(refused('bad-year'));
    expect(await copy({ year: '0000' })).toEqual(refused('bad-year'));
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('assignTaxPayment (plan 10, task 2)', () => {
  const assign = (
    store: MemoryStore,
    transactionId: string,
    parts: { voce: string; year: string; amount: number }[],
    prefix = 'a',
  ) =>
    assignTaxPayment(
      store,
      {
        transactionId,
        parts: parts.map((p) => ({ ...p, amount: cents(p.amount) })),
      } as Parameters<typeof assignTaxPayment>[1],
      'p1',
      clock,
      ids(prefix),
    );

  it('assigns a «tasse» debit to tax years in parts that add up to the debit', async () => {
    const store = await fixtureStore();
    const parts = [
      { voce: 'cedolare', year: '2025', amount: 60000 },
      { voce: 'cedolare', year: '2026', amount: 40000 },
    ];
    expect(await assign(store, 'tx-ced', parts)).toEqual({
      status: 'assigned',
      operationId: 'a-1',
      taxPaymentId: 'taxp-tx-ced',
    });
    const op = (await readJournal(store)).operations.find((o) => o.id === 'a-1');
    expect(op).toMatchObject({
      kind: 'tax.assign',
      apartmentId: 'nord',
      summary: 'Assegnato un movimento a una tassa.',
    });
    const before = await snapshot(store);
    expect(await assign(store, 'tx-ced', parts, 'z')).toEqual({
      status: 'unchanged',
      taxPaymentId: 'taxp-tx-ced',
    });
    // Same parts in another order: the same assignment.
    expect(await assign(store, 'tx-ced', [...parts].reverse(), 'z')).toEqual({
      status: 'unchanged',
      taxPaymentId: 'taxp-tx-ced',
    });
    // The class cannot be undone, nor the movement assigned to an IMU rate, while it is there.
    expect(await undoBlockedBy(store, 's3-1')).toEqual(['taxp-tx-ced']);
    expect(
      await assignImuF24(
        store,
        { transactionId: 'tx-ced', f24Group: 'g', year: '2026', rateIndex: 1 },
        'p1',
        clock,
        ids('i'),
      ),
    ).toEqual(refused('tax-assigned'));
    expect(await snapshot(store)).toEqual(before);
    expect(
      await assign(store, 'tx-ced', [{ voce: 'registro', year: '2026', amount: 100000 }], 'r'),
    ).toMatchObject({ status: 'assigned' });
    const [record] = (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records;
    expect(record).toMatchObject({ rev: 2, parts: [{ voce: 'registro' }] });
  });

  it('refuses without writing', async () => {
    const store = await fixtureStore();
    const before = await snapshot(store);
    const one = (amount: number, voce = 'cedolare', year = '2026') => [{ voce, year, amount }];
    expect(await assign(store, 'tx-ced', one(99999))).toEqual(refused('sum-mismatch'));
    expect(await assign(store, 'tx-ced', [])).toEqual(refused('bad-parts'));
    expect(await assign(store, 'tx-ced', one(100000, 'imu'))).toEqual(refused('bad-parts'));
    expect(await assign(store, 'tx-ced', one(100000, 'cedolare', '26'))).toEqual(
      refused('bad-parts'),
    );
    expect(await assign(store, 'tx-ced', [...one(50000), ...one(50000)])).toEqual(
      refused('bad-parts'),
    );
    expect(await assign(store, 'tx-nessuno', one(1))).toEqual(refused('unknown-transaction'));
    expect(await assign(store, 'tx-in', one(5000))).toEqual(refused('not-tax-debit'));
    expect(await assign(store, 'tx-pend', one(100))).toEqual(refused('not-tax-debit'));
    expect(await assign(store, 'tx-util', one(3000))).toEqual(refused('not-tax-debit'));
    expect(await assign(store, 'tx-imu', one(60000))).toEqual(refused('imu-assigned'));
    expect(await snapshot(store)).toEqual(before);
  });
});

describe('loadTaxTable (plan 10, task 3)', () => {
  it('reads the tables of the year and the January warnings, with the payables source', async () => {
    const store = await fixtureStore();
    // Plan 13: the payables with a reference year are the expected of cedolare and registro.
    await savePayable(
      store,
      {
        apartmentId: 'nord',
        kind: 'registro',
        dueDate: isoDate('2026-12-16'),
        expected: cents(6700),
        taxYear: 2026,
      },
      'p1',
      clock,
      ids('scad'),
    );
    await savePayable(
      store,
      { apartmentId: 'sud', kind: 'cedolare', dueDate: isoDate('2026-11-30') },
      'p1',
      clock,
      ids('scad2'),
    );
    await setTaxEstimate(
      store,
      { apartmentId: 'nord', year: '2026', voce: 'registro', amount: cents(0) },
      'p1',
      clock,
      ids('e'),
    );
    await assignTaxPayment(
      store,
      {
        transactionId: 'tx-ced',
        parts: [{ voce: 'registro', year: '2026', amount: cents(100000) }],
      },
      'p1',
      clock,
      ids('a'),
    );
    const result = await loadTaxTable(store, { year: '2026', today: isoDate('2026-01-10') });
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    expect(result.tables.map((t) => [t.taxpayer, t.apartmentIds])).toEqual([
      ['user1', ['nord']],
      ['user2', ['sud']],
    ]);
    expect(result.tables[0]?.rows.find((r) => r.voce === 'registro')).toEqual({
      voce: 'registro',
      // The payable still to pay beside the assigned payment: never linked by itself (R246).
      state: 'da-verificare',
      reasons: ['payable-and-payment'],
      estimate: 0,
      paid: 100000,
      expected: 6700,
    });
    // No payable for the voce and year: the expected is unknown, never zero (R243).
    expect(result.tables[0]?.rows.find((r) => r.voce === 'cedolare')?.reasons).toEqual([
      'missing-estimate',
      'no-expected-source',
    ]);
    expect(result.tables[1]?.rows.find((r) => r.voce === 'cedolare')?.reasons).toEqual([
      'missing-estimate',
      'no-expected-source',
    ]);
    expect(result.warnings).toEqual([{ apartmentId: 'sud', year: '2026', canCopy: false }]);
    expect(await loadTaxTable(store, { year: '26', today: isoDate('2026-01-10') })).toEqual(
      refused('bad-year'),
    );
    const path = recordPath('apartment', 'nord');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('user1', 'user9'));
    expect(await loadTaxTable(store, { year: '2026', today: isoDate('2026-01-10') })).toEqual(
      refused('inconsistent-store'),
    );
  });
});
