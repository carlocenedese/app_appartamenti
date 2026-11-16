import { describe, expect, it } from 'vitest';
import {
  commitChange,
  isoDate,
  loadScadenzario,
  payableState,
  recordPath,
  recordSchemas,
  scadenzario,
} from '../src/index';
import type { RecordKind, ScadenzarioInput } from '../src/index';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartments, landlords, amounts and dates only (plan 9).
const base = { v: 1, rev: 1 };
const apartment = (id: string, locatore: string) =>
  recordSchemas.apartment.parse({
    ...base,
    id,
    name: id,
    locatore,
    posti: 3,
    annualitaStart: { month: 10, day: 1 },
  });
const apartments = [
  apartment('berchet', 'Locatore Uno'),
  apartment('lovarini', 'Locatore Uno'),
  apartment('pulci', 'Locatore Due'),
];
const imuYear = (apartmentId: string, rates: unknown[]) =>
  recordSchemas.imuYear.parse({
    ...base,
    id: `imu-${apartmentId}-2026`,
    apartmentId,
    year: '2026',
    f24Group: apartmentId === 'pulci' ? 'pulci' : 'bl',
    rates,
  });
const tx = (id: string, amount: number, date = '2026-06-15') =>
  recordSchemas.transaction.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    date,
    amount,
    description: 'x',
    statementHash: 'h',
  });
const f24Class = (transactionId: string, rateIndex: number, extra: object = {}) =>
  recordSchemas.movementClass.parse({
    ...base,
    id: `mc-${transactionId}`,
    transactionId,
    kind: 'tasse',
    apartmentId: 'berchet',
    f24: true,
    imu: { f24Group: 'bl', year: '2026', rateIndex },
    ...extra,
  });
const instalment = (id: string, extra: object = {}) =>
  recordSchemas.instalment.parse({
    ...base,
    id,
    apartmentId: 'lovarini',
    kind: 'condominio',
    esercizio: '2026',
    rateIndex: 1,
    rateCount: 4,
    dueDate: '2026-03-31',
    rata: 30000,
    quotaProprieta: 0,
    conguaglioPrec: 0,
    coversFrom: '2026-01',
    coversTo: '2026-03',
    ...extra,
  });
const match = (itemId: string, transactionId: string, amount: number, extra: object = {}) =>
  recordSchemas.match.parse({
    ...base,
    id: `m-${itemId}-${transactionId}`,
    itemType: 'instalment',
    itemId,
    transactionId,
    transactionDate: '2026-03-30',
    amount,
    part: 'amount',
    confirmed: true,
    by: 'manual',
    ...extra,
  });
const payable = (id: string, extra: object = {}) =>
  recordSchemas.payable.parse({
    ...base,
    id,
    apartmentId: 'pulci',
    kind: 'registro',
    dueDate: '2026-11-16',
    ...extra,
  });
const contract = (id: string, end: string) =>
  recordSchemas.contract.parse({
    ...base,
    id,
    apartmentId: 'pulci',
    type: '3+2',
    start: '2022-10',
    end,
    settlement: 'annuale',
  });

const empty: ScadenzarioInput = {
  today: isoDate('2026-11-16'),
  apartments,
  imuYears: [],
  classes: [],
  transactions: [],
  instalments: [],
  matches: [],
  payables: [],
  contracts: [],
  statementPeriods: [],
};

describe('payableState (plan 9, decision 1 of user1)', () => {
  const due = isoDate('2026-11-16');
  it('is late from the day after the due date, never on it, and paid wins', () => {
    expect(payableState(due, false, isoDate('2026-11-16'))).toBe('da-pagare');
    expect(payableState(due, false, isoDate('2026-11-17'))).toBe('in-ritardo');
    expect(payableState(due, true, isoDate('2027-01-01'))).toBe('pagata');
    expect(payableState(undefined, false, isoDate('2027-01-01'))).toBe('da-pagare');
  });

  it('counts whole days across a leap February', () => {
    const leap = isoDate('2028-02-29');
    expect(payableState(leap, false, isoDate('2028-02-29'))).toBe('da-pagare');
    expect(payableState(leap, false, isoDate('2028-03-01'))).toBe('in-ritardo');
    expect(payableState(isoDate('2026-02-28'), false, isoDate('2026-03-01'))).toBe('in-ritardo');
  });

  it('is in-scadenza only with an explicit window', () => {
    expect(payableState(due, false, isoDate('2026-11-06'))).toBe('da-pagare');
    expect(payableState(due, false, isoDate('2026-11-06'), 10)).toBe('in-scadenza');
    expect(payableState(due, false, isoDate('2026-11-05'), 10)).toBe('da-pagare');
    expect(payableState(due, false, isoDate('2026-11-16'), 0)).toBe('in-scadenza');
    expect(payableState(due, false, isoDate('2026-11-17'), 10)).toBe('in-ritardo');
    expect(() => payableState(due, false, due, -1)).toThrow(RangeError);
    expect(() => payableState(due, false, due, 1.5)).toThrow(RangeError);
  });
});

describe('scadenzario (plan 9, task 2)', () => {
  it('gives one IMU item per group rate: paid within the tolerance, else unpaid with a check', () => {
    const { items } = scadenzario({
      ...empty,
      imuYears: [
        imuYear('berchet', [
          { index: 1, expected: 40000, dueDate: '2026-06-16' },
          { index: 2, expected: 40000, dueDate: '2026-12-16' },
        ]),
        imuYear('lovarini', [
          { index: 1, expected: 60000, dueDate: '2026-06-16' },
          { index: 2, expected: 60000, dueDate: '2026-12-16' },
        ]),
        imuYear('pulci', [{ index: 1 }]),
      ],
      transactions: [tx('t1', -100000), tx('t2', -150000), tx('t3', -5000)],
      classes: [
        f24Class('t1', 1),
        f24Class('t2', 2),
        f24Class('t3', 1, {
          apartmentId: 'pulci',
          imu: { f24Group: 'pulci', year: '2026', rateIndex: 1 },
        }),
      ],
    });
    expect(items).toEqual([
      {
        source: 'imu',
        id: 'bl/2026/1',
        kind: 'imu',
        apartmentIds: ['berchet', 'lovarini'],
        taxpayers: ['Locatore Uno'],
        dueDate: '2026-06-16',
        expected: 100000,
        state: 'pagata',
        paidOn: '2026-06-15',
        transactionId: 't1',
      },
      {
        source: 'imu',
        id: 'bl/2026/2',
        kind: 'imu',
        apartmentIds: ['berchet', 'lovarini'],
        taxpayers: ['Locatore Uno'],
        dueDate: '2026-12-16',
        expected: 100000,
        state: 'da-pagare',
        check: 'da-riconciliare',
        transactionId: 't2',
      },
      {
        source: 'imu',
        id: 'pulci/2026/1',
        kind: 'imu',
        apartmentIds: ['pulci'],
        taxpayers: ['Locatore Due'],
        state: 'da-pagare',
        check: 'importo-mancante',
        transactionId: 't3',
      },
    ]);
  });

  it('pays an instalment with confirmed real debits summing to the expected debit', () => {
    const { items } = scadenzario({
      ...empty,
      instalments: [
        instalment('i-paid'),
        instalment('i-diff', { dueDate: '2026-06-30' }),
        instalment('i-assumed', { dueDate: '2026-09-30', kind: 'tari', esercizio: '2026' }),
        instalment('i-gone', { dueDate: '2026-12-31', deleted: true }),
      ],
      matches: [
        match('i-paid', 't1', 20000),
        match('i-paid', 't2', 10000, { transactionDate: '2026-04-02' }),
        match('i-paid', 't2', 150, { id: 'm-c', part: 'commission' }),
        match('i-diff', 't3', 29000),
        match('i-assumed', 'assumed-i-assumed', 30000, { by: 'assumed' }),
      ],
    });
    expect(items.map((i) => [i.id, i.kind, i.state, i.check, i.paidOn, i.expected])).toEqual([
      ['i-paid', 'condominio', 'pagata', undefined, '2026-04-02', 30000],
      ['i-diff', 'condominio', 'in-ritardo', 'importo-diverso', undefined, 30000],
      ['i-assumed', 'tari', 'in-ritardo', 'periodo-senza-estratto', undefined, 30000],
    ]);
  });

  it('flags an unpaid instalment whose due date no statement covers, leaving its state (question 7)', () => {
    const { items } = scadenzario({
      ...empty,
      instalments: [
        instalment('i-in', { dueDate: '2026-03-31' }),
        instalment('i-out', { dueDate: '2026-06-30' }),
        instalment('i-other', { dueDate: '2026-03-31', paidFromApartmentId: 'berchet' }),
      ],
      statementPeriods: [
        { apartmentId: 'lovarini', from: isoDate('2026-01-01'), to: isoDate('2026-03-31') },
      ],
    });
    expect(items.map((i) => [i.id, i.state, i.check])).toEqual([
      ['i-in', 'in-ritardo', undefined],
      ['i-other', 'in-ritardo', 'periodo-senza-estratto'],
      ['i-out', 'in-ritardo', 'periodo-senza-estratto'],
    ]);
  });

  it('takes a confirmed debit on a shared notice as paid (sums checked when confirmed)', () => {
    const shared = { groupId: 'g1', groupTotal: 50000, weight: 1 };
    const { items } = scadenzario({
      ...empty,
      instalments: [instalment('i-shared', { kind: 'tari', shared })],
      matches: [match('i-shared', 't1', 12345)],
    });
    expect(items[0]?.state).toBe('pagata');
  });

  it('pays a payable by hand, or by a movement only while it and its class are live', () => {
    const { items } = scadenzario({
      ...empty,
      transactions: [
        tx('t1', -6700, '2026-11-10'),
        tx('t2', -1600, '2026-11-11'),
        tx('t-out', -1600, '2026-11-12'),
      ],
      classes: [
        recordSchemas.movementClass.parse({
          ...base,
          id: 'mc-t1',
          transactionId: 't1',
          kind: 'tasse',
          apartmentId: 'pulci',
        }),
        recordSchemas.movementClass.parse({
          ...base,
          id: 'mc-t-out',
          transactionId: 't-out',
          kind: 'escluso',
          excludeReason: 'doppione',
        }),
        // A class left on a movement that is gone.
        recordSchemas.movementClass.parse({
          ...base,
          id: 'mc-t-missing',
          transactionId: 't-missing',
          kind: 'tasse',
          apartmentId: 'pulci',
        }),
      ],
      payables: [
        payable('scad-a', { expected: 6700, paid: { date: '2026-11-10', transactionId: 't1' } }),
        payable('scad-b', { paid: { date: '2026-11-01' }, kind: 'bollo', repeatYearly: true }),
        payable('scad-c', { paid: { date: '2026-11-11', transactionId: 't2' } }),
        payable('scad-d', { previousId: 'scad-b', dueDate: '2027-11-16', kind: 'bollo' }),
        payable('scad-e', { deleted: true }),
        payable('scad-f', { paid: { date: '2026-11-12', transactionId: 't-out' } }),
        payable('scad-g', { paid: { date: '2026-11-12', transactionId: 't-missing' } }),
      ],
    });
    expect(items).toEqual([
      expect.objectContaining({
        id: 'scad-a',
        source: 'payable',
        state: 'pagata',
        paidOn: '2026-11-10',
        transactionId: 't1',
        expected: 6700,
      }),
      expect.objectContaining({
        id: 'scad-b',
        state: 'pagata',
        paidOn: '2026-11-01',
        repeatYearly: true,
        repeated: true,
      }),
      // The movement has no class any more: not a proof of payment.
      expect.objectContaining({ id: 'scad-c', state: 'da-pagare' }),
      expect.objectContaining({ id: 'scad-f', state: 'da-pagare' }),
      expect.objectContaining({ id: 'scad-g', state: 'da-pagare' }),
      expect.objectContaining({ id: 'scad-d', kind: 'bollo', state: 'da-pagare' }),
    ]);
    expect(items[2]).not.toHaveProperty('paidOn');
    expect(items[1]?.taxpayers).toEqual(['Locatore Due']);
  });

  it('sorts by due date (none last), then source and id', () => {
    const { items } = scadenzario({
      ...empty,
      imuYears: [imuYear('pulci', [{ index: 1 }, { index: 2, dueDate: '2026-11-16' }])],
      instalments: [instalment('i1', { dueDate: '2026-11-16' })],
      payables: [payable('scad-z', { dueDate: '2026-01-01' }), payable('scad-a')],
    });
    expect(items.map((i) => i.id)).toEqual([
      'scad-z',
      'pulci/2026/2',
      'i1',
      'scad-a',
      'pulci/2026/1',
    ]);
  });

  it('lists the live contracts that end from the month of today, without a state', () => {
    const { contractEnds } = scadenzario({
      ...empty,
      contracts: [
        contract('c-old', '2026-10'),
        contract('c-now', '2026-11'),
        contract('c-later', '2027-09'),
        { ...contract('c-del', '2027-09'), deleted: true },
      ],
    });
    expect(contractEnds).toEqual([
      { contractId: 'c-now', apartmentId: 'pulci', end: '2026-11' },
      { contractId: 'c-later', apartmentId: 'pulci', end: '2027-09' },
    ]);
  });
});

describe('loadScadenzario', () => {
  async function seed(store: MemoryStore, kind: RecordKind, records: { id: string }[]) {
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'Dati di prova.',
        changes: records.map((r) => ({ path: recordPath(kind, r.id), after: r })),
      },
      clock,
      ids(kind),
    );
  }

  it('reads the records and computes the list; refuses an inconsistent store', async () => {
    const store = new MemoryStore();
    await seed(store, 'apartment', apartments);
    await seed(store, 'payable', [payable('scad-a', { dueDate: '2026-11-15' })]);
    const result = await loadScadenzario(store, { today: isoDate('2026-11-16') });
    expect(result).toEqual({
      status: 'computed',
      items: [expect.objectContaining({ id: 'scad-a', state: 'in-ritardo' })],
      contractEnds: [],
    });
    await store.writeJsonAtomic(recordPath('payable', 'scad-a'), { ...payable('scad-a'), rev: 5 });
    expect(await loadScadenzario(store, { today: isoDate('2026-11-16') })).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});
