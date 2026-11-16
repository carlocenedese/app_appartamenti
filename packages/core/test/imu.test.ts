import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  IMU_TOLERANCE_PERCENT,
  InstalmentSchema,
  PaymentSchema,
  TenancySchema,
  calcConguaglio,
  loadAll,
  ImuYearSchema,
  MovementClassSchema,
  assignImuF24,
  imuRates,
  imuShares,
  loadImuRates,
  readJournal,
  recordPath,
  recordSchemas,
  setImuYear,
} from '../src/index';
import type {
  BankTransaction,
  ConguaglioInput,
  ImuRate,
  ImuYear,
  MovementClass,
} from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';
import * as builders from './helpers/conguaglio-builders';

// Invented amounts only (plan 3d, decision 1).
const base = { v: 1 as const, rev: 1 };
const year = (
  apartmentId: string,
  rates: { index: number; expected?: number; dueDate?: string }[],
) =>
  ImuYearSchema.parse({
    ...base,
    id: `imu-${apartmentId}-2026`,
    apartmentId,
    year: '2026',
    f24Group: 'berchet-lovarini',
    rates,
  });
const tx = (id: string, amount: number, extra: Record<string, unknown> = {}): BankTransaction =>
  BankTransactionSchema.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    accountId: 'acc-berchet',
    date: '2026-06-14',
    amount,
    description: 'PAGAMENTO F24 DELEGA 0001',
    statementHash: 's',
    ...extra,
  });
const assigned = (transactionId: string, rateIndex = 1, extra: Record<string, unknown> = {}) =>
  MovementClassSchema.parse({
    ...base,
    id: `mc-${transactionId}`,
    transactionId,
    kind: 'tasse',
    apartmentId: 'berchet',
    f24: true,
    imu: { f24Group: 'berchet-lovarini', year: '2026', rateIndex },
    ...extra,
  });
const years = [
  year('lovarini', [{ index: 1, expected: 40000 }, { index: 2 }]),
  year('berchet', [
    { index: 1, expected: 60000 },
    { index: 2, expected: 60000 },
  ]),
];
const status = (paid: number, ys: ImuYear[] = years) =>
  imuRates({ years: ys, classes: [assigned('f')], transactions: [tx('f', -paid)] })[0]?.status;

describe('imuRates (plan 3d, task 3)', () => {
  it('the 1% on the expected of the group, integers only (Review Focus 1)', () => {
    expect(IMU_TOLERANCE_PERCENT).toBe(1);
    for (const paid of [100000, 101000, 99000])
      expect([paid, status(paid)]).toEqual([paid, 'pagata']);
    for (const paid of [101001, 98999]) {
      expect([paid, status(paid)]).toEqual([paid, 'da-riconciliare']);
    }
    const one = [year('berchet', [{ index: 1, expected: 1 }])];
    expect(status(1, one)).toBe('pagata');
    expect(status(2, one)).toBe('da-riconciliare');
  });

  it('gives the rates of the group with the F24, sorted, apartments sorted', () => {
    expect(imuRates({ years, classes: [assigned('f')], transactions: [tx('f', -101001)] })).toEqual(
      [
        {
          f24Group: 'berchet-lovarini',
          year: '2026',
          rateIndex: 1,
          apartmentIds: ['berchet', 'lovarini'],
          status: 'da-riconciliare',
          expected: 100000,
          paid: 101001,
          transactionId: 'f',
        },
        {
          f24Group: 'berchet-lovarini',
          year: '2026',
          rateIndex: 2,
          apartmentIds: ['berchet', 'lovarini'],
          status: 'attesa',
        },
      ],
    );
  });

  it('an amount missing for one apartment: importo-mancante with an F24, attesa without (question 4)', () => {
    const ys = [
      year('lovarini', [{ index: 1 }, { index: 2 }]),
      year('berchet', [{ index: 1, expected: 60000 }, { index: 2 }]),
    ];
    const [withF24] = imuRates({
      years: ys,
      classes: [assigned('f')],
      transactions: [tx('f', -100000)],
    });
    expect(withF24).toMatchObject({ status: 'importo-mancante', paid: 100000 });
    expect(withF24).not.toHaveProperty('expected');
    expect(imuRates({ years: ys, classes: [], transactions: [] })[0]?.status).toBe('attesa');
  });

  it('the due date only when the same in every year of the rate, never a state (question 6)', () => {
    const due = (b: string, l: string) =>
      imuRates({
        years: [
          year('berchet', [{ index: 1, dueDate: b }]),
          year('lovarini', [{ index: 1, dueDate: l }]),
        ],
        classes: [],
        transactions: [],
      })[0];
    expect(due('2026-06-16', '2026-06-16')).toMatchObject({
      status: 'attesa',
      dueDate: '2026-06-16',
    });
    expect(due('2026-06-16', '2026-06-17')).not.toHaveProperty('dueDate');
  });

  it('a deleted class, movement or year counts as none; any order gives the same', () => {
    const live = { years, classes: [assigned('f')], transactions: [tx('f', -100000)] };
    expect(imuRates(live)[0]?.status).toBe('pagata');
    expect(imuRates({ ...live, classes: [assigned('f', 1, { deleted: true })] })[0]?.status).toBe(
      'attesa',
    );
    expect(
      imuRates({ ...live, transactions: [tx('f', -100000, { deleted: true })] })[0]?.status,
    ).toBe('attesa');
    const deletedYear = ImuYearSchema.parse({ ...years[0], deleted: true });
    expect(imuRates({ ...live, years: [deletedYear, years[1] as ImuYear] })[0]).toMatchObject({
      apartmentIds: ['berchet'],
      expected: 60000,
      status: 'da-riconciliare',
    });
    const other = tx('g', -60000);
    const mixed = {
      years: [...years].reverse(),
      classes: [assigned('g', 2), assigned('f')] as MovementClass[],
      transactions: [other, tx('f', -100000)],
    };
    const reversed = {
      years,
      classes: [...mixed.classes].reverse(),
      transactions: [...mixed.transactions].reverse(),
    };
    expect(imuRates(mixed)).toEqual(imuRates(reversed));
  });
});

describe('loadImuRates and the IMU writes (plan 3d, task 3)', () => {
  const apartment = (id: string) => ({
    ...base,
    id,
    name: id,
    locatore: 'Locatore fittizio',
    posti: 2,
    annualitaStart: { month: 1, day: 1 },
  });
  async function store() {
    const s = new MemoryStore();
    const put = async (
      kind: keyof typeof recordSchemas,
      records: ({ id: string } & Record<string, unknown>)[],
    ) => {
      for (const r of records)
        await s.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
    };
    await put('apartment', [apartment('berchet'), apartment('lovarini')]);
    await put('account', [
      { ...base, id: 'acc-berchet', apartmentId: 'berchet', label: 'Conto', bankProfileId: 'bp' },
    ]);
    await put('transaction', [tx('f', -101001)]);
    await put('movementClass', [
      MovementClassSchema.parse({
        ...base,
        id: 'mc-f',
        transactionId: 'f',
        kind: 'tasse',
        apartmentId: 'berchet',
        f24: true,
      }),
    ]);
    return s;
  }
  const save = (s: MemoryStore, apartmentId: string, expected: number, prefix: string) =>
    setImuYear(
      s,
      {
        apartmentId,
        year: '2026',
        f24Group: 'berchet-lovarini',
        rates: [{ index: 1, expected: cents(expected) }],
      },
      'p1',
      clock,
      ids(prefix),
    );

  it('a new expected of Lovarini brings the rate from da-riconciliare to pagata; writes nothing', async () => {
    const s = await store();
    await save(s, 'berchet', 60000, 'a');
    await save(s, 'lovarini', 40000, 'b');
    await assignImuF24(
      s,
      { transactionId: 'f', f24Group: 'berchet-lovarini', year: '2026', rateIndex: 1 },
      'p1',
      clock,
      ids('c'),
    );
    const before = await snapshot(s);
    expect(await loadImuRates(s)).toMatchObject({
      status: 'computed',
      rates: [{ status: 'da-riconciliare', expected: 100000, paid: 101001 }],
    });
    expect(await loadImuRates(s, { year: '2027' })).toEqual({ status: 'computed', rates: [] });
    expect(await snapshot(s)).toEqual(before);
    await save(s, 'lovarini', 41001, 'd');
    expect(await loadImuRates(s)).toMatchObject({
      rates: [{ status: 'pagata', expected: 101001 }],
    });

    // Review Focus 5: the IMU writes touch only imuYear and movementClass, never what the
    // settlement of the tenants reads (its input has neither).
    const paths = (await readJournal(s)).operations.flatMap((o) => o.changes.map((c) => c.path));
    expect(paths.every((p) => /^_app\/dati\/(imuYear|movementClass)\//.test(p))).toBe(true);
    expectTypeOf<Extract<keyof ConguaglioInput, 'classes' | 'imuYears'>>().toBeNever();
  });

  it('refuses a diverged store', async () => {
    const s = await store();
    await save(s, 'berchet', 60000, 'a');
    const path = recordPath('imuYear', 'imu-berchet-2026');
    s.putRaw(path, (s.getRaw(path) ?? '').replace('60000', '1'));
    expect(await loadImuRates(s)).toEqual({ status: 'refused', reason: 'inconsistent-store' });
  });
});

describe('the settlement of the tenants with and without the IMU (plan 3d, Review Focus 5)', () => {
  it('gives the same result and keeps its records after setImuYear and assignImuF24', async () => {
    const s = new MemoryStore();
    const put = async (
      kind: keyof typeof recordSchemas,
      records: ({ id: string } & Record<string, unknown>)[],
    ) => {
      for (const r of records) {
        await s.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
      }
    };
    // Invented records: one bill, one tenant, one payment; an F24 from the account of the apartment.
    const luce = builders.bill('luce', '2026-01-01', '2026-03-31', 9000);
    await put('apartment', [builders.apartment()]);
    await put('bill', [luce]);
    await put('match', [builders.match(luce, 9000)]);
    await put('tenancy', [builders.tenancy('t1', '2025-10', undefined)]);
    await put('payment', [builders.payment('t1', '2026-01', 48000)]);
    await put('account', [
      { ...base, id: 'acc-apt', apartmentId: builders.APT, label: 'Conto', bankProfileId: 'bp' },
    ]);
    await put('bankProfile', [
      {
        ...base,
        id: 'bp',
        bank: 'Banca inventata',
        validFrom: '2020-01-01',
        container: 'csv',
        header: { allOf: ['Data'] },
        columns: { date: 'Data', description: ['Descrizione'], amount: 'Importo' },
        dateFormat: 'DD/MM/YYYY',
        f24Pattern: '^PAGAMENTO F24\\b',
      },
    ]);
    await put('transaction', [
      tx('f', -50000, { apartmentId: builders.APT, accountId: 'acc-apt' }),
    ]);
    const settle = async () => {
      const all = { includeDeleted: false };
      return calcConguaglio({
        apartment:
          (await loadAll(s, 'apartment', ApartmentSchema, all)).records[0] ?? builders.apartment(),
        period: builders.period('2025-10', '2026-09'),
        bills: (await loadAll(s, 'bill', BillSchema, all)).records,
        instalments: (await loadAll(s, 'instalment', InstalmentSchema, all)).records,
        matches: (await loadAll(s, 'match', BillMatchSchema, all)).records,
        tenancies: (await loadAll(s, 'tenancy', TenancySchema, all)).records,
        payments: (await loadAll(s, 'payment', PaymentSchema, all)).records,
      });
    };
    const settlementFiles = async () =>
      (await snapshot(s)).filter((f) =>
        /^_app\/dati\/(apartment|bill|match|tenancy|payment|instalment)\//.test(f),
      );
    const before = await settle();
    expect(before.tenants.map((t) => t.tenantId)).toEqual(['t1']);
    const files = await settlementFiles();
    expect(
      await setImuYear(
        s,
        {
          apartmentId: builders.APT,
          year: '2026',
          f24Group: 'g',
          rates: [{ index: 1, expected: cents(50000) }],
        },
        'p1',
        clock,
        ids('a'),
      ),
    ).toMatchObject({ status: 'saved' });
    expect(
      await assignImuF24(
        s,
        { transactionId: 'f', f24Group: 'g', year: '2026', rateIndex: 1 },
        'p1',
        clock,
        ids('b'),
      ),
    ).toMatchObject({ status: 'assigned' });
    expect((await loadImuRates(s)).status).toBe('computed');
    expect(await settle()).toEqual(before);
    expect(await settlementFiles()).toEqual(files);
  });
});

describe('imuShares and the annual check (plan 3d, task 4; answers of user1, 16 Nov 2026)', () => {
  const rate = (ys: ImuYear[], f24s: [string, number, number][]) =>
    imuRates({
      years: ys,
      classes: f24s.map(([id, , index]) => assigned(id, index)),
      transactions: f24s.map(([id, paid]) => tx(id, -paid)),
    });
  const sharesOf = (ys: ImuYear[], paid: number) => {
    const [r] = rate(ys, [['f', paid, 1]]);
    return r === undefined ? undefined : imuShares(r, ys, cents(-paid));
  };

  it('splits the actual debit in proportion to the expected of the same rate', () => {
    expect(sharesOf(years, 100500)).toEqual([
      { apartmentId: 'berchet', amount: 60300 },
      { apartmentId: 'lovarini', amount: 40200 },
    ]);
    const half = [
      year('lovarini', [{ index: 1, expected: 50000 }]),
      year('berchet', [{ index: 1, expected: 50000 }]),
    ];
    // Largest remainders, a tie to the first apartment; the sum is the debit.
    expect(sharesOf(half, 100001)).toEqual([
      { apartmentId: 'berchet', amount: 50001 },
      { apartmentId: 'lovarini', amount: 50000 },
    ]);
  });

  it('no split out of the 1% or with the expected of one apartment only', () => {
    expect(sharesOf(years, 101001)).toBeUndefined();
    const one = [
      year('lovarini', [{ index: 1 }]),
      year('berchet', [{ index: 1, expected: 60000 }]),
    ];
    expect(sharesOf(one, 60000)).toBeUndefined();
  });

  const annual = (b: number | undefined, l: number | undefined) =>
    ['berchet', 'lovarini'].map((apartmentId, i) =>
      ImuYearSchema.parse({
        ...base,
        id: `imu-${apartmentId}-2026`,
        apartmentId,
        year: '2026',
        f24Group: 'berchet-lovarini',
        ...([b, l][i] === undefined ? {} : { annualTotal: [b, l][i] }),
        rates: [{ index: 1 }, { index: 2 }],
      }),
    );

  it('only annual totals: the 1% on the sum of the F24s of the year, split on the totals', () => {
    const ys = annual(130000, 70000);
    const both = rate(ys, [
      ['f', 100000, 1],
      ['g', 101000, 2],
    ]);
    expect(both.map((r) => r.status)).toEqual(['pagata', 'pagata']);
    expect(both[0]).toMatchObject({ annual: { expected: 200000, paid: 201000 } });
    expect(both[0]).not.toHaveProperty('expected');
    expect(imuShares(both[0] as ImuRate, ys, cents(-100000))).toEqual([
      { apartmentId: 'berchet', amount: 65000 },
      { apartmentId: 'lovarini', amount: 35000 },
    ]);
    // 2.000,00 € expected: 2.020,00 € is in line, 2.020,01 € is not.
    expect(
      rate(ys, [
        ['f', 100000, 1],
        ['g', 102000, 2],
      ]).map((r) => r.status),
    ).toEqual(['pagata', 'pagata']);
    expect(
      rate(ys, [
        ['f', 100000, 1],
        ['g', 102001, 2],
      ]).map((r) => r.status),
    ).toEqual(['da-riconciliare', 'da-riconciliare']);
    // One F24 of two: the annual check waits, nothing split.
    const first = rate(ys, [['f', 100000, 1]]);
    expect(first.map((r) => r.status)).toEqual(['importo-mancante', 'attesa']);
    expect(first[0]).toMatchObject({ annual: { expected: 200000 } });
    expect(first[0]?.annual).not.toHaveProperty('paid');
    expect(imuShares(first[0] as ImuRate, ys, cents(-100000))).toBeUndefined();
    // The total of one apartment only: no check.
    expect(
      rate(annual(130000, undefined), [
        ['f', 100000, 1],
        ['g', 100000, 2],
      ])[0],
    ).toMatchObject({ status: 'importo-mancante' });
    // An amount of a rate known: the rates count, not the totals.
    const mixed = [
      ImuYearSchema.parse({ ...ys[0], rates: [{ index: 1, expected: 60000 }, { index: 2 }] }),
      ys[1] as ImuYear,
    ];
    const [r1] = rate(mixed, [
      ['f', 100000, 1],
      ['g', 100000, 2],
    ]);
    expect(r1).toMatchObject({ status: 'importo-mancante' });
    expect(r1).not.toHaveProperty('annual');
  });
});
