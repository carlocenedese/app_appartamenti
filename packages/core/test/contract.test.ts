import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  PaymentSchema,
  TenancySchema,
  cedolareExpected,
  cedolareRateForYear,
  cents,
  contractChecks,
  rentForMonth,
  yearMonth,
} from '../src/index';
import type { Contract, Payment, Tenancy } from '../src/index';

// Invented amounts only (plan 7).
const contract = ContractSchema.parse({
  id: 'ctr-berchet',
  v: 1,
  rev: 1,
  apartmentId: 'berchet',
  type: '1+1',
  start: '2025-10',
  end: '2027-09',
  settlement: 'annuale',
  rent: [
    { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
    { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 },
  ],
});
const [first, second] = contract.rent ?? [];

describe('rentForMonth (plan 7, task 1)', () => {
  it.each([
    ['2025-09', undefined],
    ['2025-10', first],
    ['2026-09', first],
    ['2026-10', second],
    ['2027-09', second],
  ])('%s', (month, expected) => {
    expect(rentForMonth(contract, yearMonth(month))).toEqual(expected);
  });

  it('no history, no rent', () => {
    expect(rentForMonth({}, yearMonth('2026-01'))).toBeUndefined();
  });
});

// --- Checks (plan 7, task 3); invented tenants Anna Prova (ten-anna), Bruno Esempio (ten-bruno).

const base = { v: 1, rev: 1 };
const makeContract = (id: string, extra: Record<string, unknown> = {}) =>
  ContractSchema.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    type: '1+1',
    start: '2025-10',
    end: '2027-09',
    settlement: 'annuale',
    ...extra,
  });
const makeTenancy = (id: string, extra: Record<string, unknown> = {}) =>
  TenancySchema.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    tenantId: 'ten-anna',
    from: '2025-10',
    to: '2026-09',
    monthlyRent: 35000,
    monthlyForfait: 3000,
    ...extra,
  });
const makePayment = (id: string, extra: Record<string, unknown> = {}) =>
  PaymentSchema.parse({
    ...base,
    id,
    apartmentId: 'berchet',
    tenantId: 'ten-anna',
    date: '2025-09-25',
    amount: 50000,
    confirmed: true,
    kind: 'caparra',
    source: 'manual',
    ...extra,
  });
const asOf = yearMonth('2026-11');
const checks = (
  contracts: Contract[],
  tenancies: Tenancy[] = [],
  payments: Payment[] = [],
  month = asOf,
) => contractChecks({ contracts, tenancies, payments, asOf: month });

describe('contractChecks: tenancies and deposits (plan 7, task 3)', () => {
  const linked = (tenancyIds: string[], extra: Record<string, unknown> = {}) =>
    makeContract('ctr-berchet', { tenancyIds, ...extra });

  it('a clean contract has no checks', () => {
    expect(
      checks(
        [linked(['tcy-a'], { end: '2026-09', depositPaymentIds: ['pay-c1'] })],
        [makeTenancy('tcy-a')],
        [makePayment('pay-c1')],
      ),
    ).toEqual([]);
  });

  it('unknown-tenancy: deleted after linking', () => {
    expect(
      checks([linked(['tcy-a'], { end: '2026-09' })], [makeTenancy('tcy-a', { deleted: true })]),
    ).toEqual([{ code: 'unknown-tenancy', contractId: 'ctr-berchet', tenancyId: 'tcy-a' }]);
  });

  it('tenancy-other-apartment', () => {
    expect(
      checks(
        [linked(['tcy-l'], { end: '2026-09' })],
        [makeTenancy('tcy-l', { apartmentId: 'lovarini' })],
      ),
    ).toEqual([{ code: 'tenancy-other-apartment', contractId: 'ctr-berchet', tenancyId: 'tcy-l' }]);
  });

  it.each([
    ['starts before', { from: '2025-09' }],
    ['ends after', { to: '2027-10' }],
    ['has no end', { to: undefined }],
  ])('tenancy-outside-contract: %s', (_name, extra) => {
    expect(checks([linked(['tcy-a'])], [makeTenancy('tcy-a', extra)])).toEqual([
      { code: 'tenancy-outside-contract', contractId: 'ctr-berchet', tenancyId: 'tcy-a' },
    ]);
  });

  it('tenancy-linked-twice: one entry per contract', () => {
    const tenancy = makeTenancy('tcy-a');
    expect(
      checks(
        [
          makeContract('ctr-2', { tenancyIds: ['tcy-a'], end: '2026-09' }),
          makeContract('ctr-1', { tenancyIds: ['tcy-a'], end: '2026-09' }),
        ],
        [tenancy],
      ),
    ).toEqual([
      // Two live contracts on the same months also overlap (R181).
      {
        code: 'contract-overlap',
        contractId: 'ctr-1',
        otherContractId: 'ctr-2',
        from: '2025-10',
        to: '2026-09',
      },
      { code: 'tenancy-linked-twice', contractId: 'ctr-1', tenancyId: 'tcy-a' },
      { code: 'tenancy-linked-twice', contractId: 'ctr-2', tenancyId: 'tcy-a' },
    ]);
  });

  it('unlinked-tenancy only where a contract of the apartment uses links', () => {
    const tenancies = [
      makeTenancy('tcy-a'),
      makeTenancy('tcy-b', { tenantId: 'ten-bruno' }),
      makeTenancy('tcy-old', { from: '2024-10', to: '2025-09' }),
    ];
    expect(checks([linked(['tcy-a'], { end: '2026-09' })], tenancies)).toEqual([
      { code: 'unlinked-tenancy', contractId: 'ctr-berchet', tenancyId: 'tcy-b' },
    ]);
    expect(checks([linked([], { end: '2026-09' })], tenancies)).toEqual([
      { code: 'unlinked-tenancy', contractId: 'ctr-berchet', tenancyId: 'tcy-a' },
      { code: 'unlinked-tenancy', contractId: 'ctr-berchet', tenancyId: 'tcy-b' },
    ]);
    expect(checks([makeContract('ctr-berchet', { end: '2026-09' })], tenancies)).toEqual([]);
  });

  it('unlinked-tenancy names the first contract by id', () => {
    expect(
      checks(
        [
          makeContract('ctr-b', { tenancyIds: [], end: '2026-09' }),
          makeContract('ctr-a', { tenancyIds: [], end: '2026-09' }),
        ],
        [makeTenancy('tcy-a')],
      ),
    ).toEqual([
      {
        code: 'contract-overlap',
        contractId: 'ctr-a',
        otherContractId: 'ctr-b',
        from: '2025-10',
        to: '2026-09',
      },
      { code: 'unlinked-tenancy', contractId: 'ctr-a', tenancyId: 'tcy-a' },
    ]);
  });

  it.each([
    ['deleted', makePayment('pay-c1', { deleted: true })],
    ['no longer a caparra', makePayment('pay-c1', { kind: 'altro' })],
    ['of another apartment', makePayment('pay-c1', { apartmentId: 'lovarini' })],
  ])('unknown-deposit: %s', (_name, payment) => {
    expect(
      checks(
        [linked(['tcy-a'], { end: '2026-09', depositPaymentIds: ['pay-c1'] })],
        [makeTenancy('tcy-a')],
        [payment],
      ),
    ).toEqual([{ code: 'unknown-deposit', contractId: 'ctr-berchet', paymentId: 'pay-c1' }]);
  });

  it('deposit-other-tenant: the deposit of Bruno Esempio with only Anna Prova linked', () => {
    expect(
      checks(
        [linked(['tcy-a'], { end: '2026-09', depositPaymentIds: ['pay-b'] })],
        [makeTenancy('tcy-a')],
        [makePayment('pay-b', { tenantId: 'ten-bruno' })],
      ),
    ).toEqual([{ code: 'deposit-other-tenant', contractId: 'ctr-berchet', paymentId: 'pay-b' }]);
  });

  it('a tenancy linked to the contract of another apartment (actual behaviour)', () => {
    // Only tenancy-other-apartment: no tenancy-outside-contract, and no unlinked-tenancy in its
    // own apartment, since it is linked to a live contract; its tenant still counts for the
    // deposits of that contract, so the deposit of Anna Prova gives no deposit-other-tenant.
    expect(
      checks(
        [
          linked(['tcy-l'], { end: '2026-09', depositPaymentIds: ['pay-c1'] }),
          makeContract('ctr-lov', { apartmentId: 'lovarini', tenancyIds: [], end: '2026-09' }),
        ],
        [makeTenancy('tcy-l', { apartmentId: 'lovarini', from: '2025-09' })],
        [makePayment('pay-c1')],
      ),
    ).toEqual([{ code: 'tenancy-other-apartment', contractId: 'ctr-berchet', tenancyId: 'tcy-l' }]);
  });

  it('a deleted contract gives nothing and does not count for links', () => {
    const tenancies = [makeTenancy('tcy-a'), makeTenancy('tcy-b', { tenantId: 'ten-bruno' })];
    const gone = makeContract('ctr-gone', {
      deleted: true,
      tenancyIds: ['tcy-a', 'tcy-x'],
      end: '2026-09',
    });
    expect(checks([gone, linked(['tcy-a', 'tcy-b'], { end: '2026-09' })], tenancies)).toEqual([]);
    expect(checks([gone], tenancies)).toEqual([]);
  });

  it('shuffled input gives the same result and nothing is changed', () => {
    const contracts = [
      linked(['tcy-a', 'tcy-x'], { depositPaymentIds: ['pay-b', 'pay-c1'] }),
      makeContract('ctr-2', { tenancyIds: ['tcy-a'], end: '2026-09' }),
    ];
    const tenancies = [makeTenancy('tcy-a'), makeTenancy('tcy-b', { tenantId: 'ten-bruno' })];
    const payments = [
      makePayment('pay-c1', { kind: 'altro' }),
      makePayment('pay-b', { tenantId: 'ten-bruno' }),
    ];
    const deepFreeze = <T>(items: T[]): T[] =>
      Object.freeze(items.map((i) => Object.freeze(i))) as T[];
    const forward = checks(deepFreeze(contracts), deepFreeze(tenancies), deepFreeze(payments));
    const backward = checks(
      deepFreeze([...contracts].reverse()),
      deepFreeze([...tenancies].reverse()),
      deepFreeze([...payments].reverse()),
    );
    expect(backward).toEqual(forward);
    expect(forward.map((c) => [c.contractId, c.code])).toEqual([
      ['ctr-2', 'contract-overlap'],
      ['ctr-2', 'tenancy-linked-twice'],
      ['ctr-2', 'unlinked-tenancy'], // the first contract by id
      ['ctr-berchet', 'deposit-other-tenant'],
      ['ctr-berchet', 'tenancy-linked-twice'],
      ['ctr-berchet', 'unknown-deposit'],
      ['ctr-berchet', 'unknown-tenancy'],
    ]);
  });
});

// --- R4 on the rent history (plan 7, task 4): the example of the design, section 3.

describe('contractChecks: rent-differs (plan 7, task 4)', () => {
  const initial = { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 };
  const renewal = { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 };
  const berchet = (rent?: unknown[]) =>
    makeContract('ctr-berchet', rent === undefined ? {} : { rent });
  // Anna Prova, Bruno Esempio, Carla Finta, Dario Inventato 350 + 30; Elena Fittizia 330 + 30.
  const year = [
    ...['anna', 'bruno', 'carla', 'dario'].map((n) => makeTenancy(`tcy-${n}`, { tenantId: n })),
    makeTenancy('tcy-elena', { tenantId: 'elena', monthlyRent: 33000 }),
  ];
  const rentChecks = (contract: Contract, tenancies: Tenancy[], month: string = asOf) =>
    checks([contract], tenancies, [], yearMonth(month)).filter((c) => c.code === 'rent-differs');

  it('the example: one interval per equal months, the month of asOf included', () => {
    expect(rentChecks(berchet([initial]), year)).toEqual([
      {
        code: 'rent-differs',
        contractId: 'ctr-berchet',
        from: '2025-10',
        to: '2026-09',
        expected: 175000,
        actual: 188000,
      },
      {
        code: 'rent-differs',
        contractId: 'ctr-berchet',
        from: '2026-10',
        to: '2026-11',
        expected: 175000,
        actual: 0,
      },
    ]);
  });

  it('the renewal with new tenancies that add up: nothing from 2026-10', () => {
    const next = ['anna', 'bruno', 'carla', 'dario'].map((n) =>
      makeTenancy(`tcy-${n}-2`, {
        tenantId: n,
        from: '2026-10',
        to: '2027-09',
        monthlyRent: 33000,
        monthlyForfait: 3000,
      }),
    );
    const extra = makeTenancy('tcy-elena-2', {
      tenantId: 'elena',
      from: '2026-10',
      to: '2027-09',
      monthlyRent: 33000,
      monthlyForfait: 3000,
    });
    expect(rentChecks(berchet([initial, renewal]), [...year, ...next, extra])).toEqual([
      expect.objectContaining({ from: '2025-10', to: '2026-09' }),
    ]);
  });

  it('no month after asOf, none before the first entry, none without rent', () => {
    expect(rentChecks(berchet([initial]), year, '2026-09').map((c) => c.to)).toEqual(['2026-09']);
    const late = makeContract('ctr-berchet', { rent: [{ ...initial, from: '2026-01' }] });
    expect(rentChecks(late, year).map((c) => c.from)).toEqual(['2026-01', '2026-10']);
    expect(rentChecks(berchet(), year)).toEqual([]);
    expect(rentChecks(berchet([initial]), year, '2025-09')).toEqual([]);
  });

  it('a tenancy that leaves in 2026-03 opens a new interval from 2026-04', () => {
    const leaving = year.map((t) =>
      t.id === 'tcy-elena' ? { ...t, to: yearMonth('2026-03') } : t,
    );
    expect(
      rentChecks(berchet([initial]), leaving, '2026-09').map((c) => [c.from, c.to, c.actual]),
    ).toEqual([
      ['2025-10', '2026-03', 188000],
      ['2026-04', '2026-09', 152000],
    ]);
  });

  it('months that add up exactly give nothing, deleted tenancies do not count', () => {
    const exact = makeContract('ctr-berchet', {
      end: '2026-09',
      rent: [{ from: '2025-10', monthlyRent: 172000, monthlyAdvance: 16000 }],
    });
    const gone = makeTenancy('tcy-gone', { deleted: true });
    expect(rentChecks(exact, [...year, gone])).toEqual([]);
  });
});

describe('contractChecks: contract-overlap (user1, question 9 of plan 7, R181)', () => {
  it('the example: a renewal saved as a new contract, months in common 2026-10 – 2027-09', () => {
    const renewal = makeContract('ctr-berchet-2', { start: '2026-10', end: '2028-09' });
    expect(checks([renewal, makeContract('ctr-berchet')])).toEqual([
      {
        code: 'contract-overlap',
        contractId: 'ctr-berchet',
        otherContractId: 'ctr-berchet-2',
        from: '2026-10',
        to: '2027-09',
      },
    ]);
  });

  it('one entry per pair; none for contracts that touch, other apartments or deleted ones', () => {
    const contracts = [
      makeContract('ctr-a', { start: '2025-10', end: '2026-09' }),
      makeContract('ctr-b', { start: '2026-10', end: '2027-09' }),
      makeContract('ctr-c', { start: '2026-09', end: '2026-10' }),
      makeContract('ctr-l', { apartmentId: 'lovarini' }),
      makeContract('ctr-gone', { deleted: true }),
    ];
    expect(checks(contracts).map((c) => [c.contractId, c.otherContractId, c.from, c.to])).toEqual([
      ['ctr-a', 'ctr-c', '2026-09', '2026-09'],
      ['ctr-b', 'ctr-c', '2026-10', '2026-10'],
    ]);
  });
});

describe('cedolare estimate (user1, question 1 of plan 7, R182)', () => {
  it.each([
    [1935000, 1000, 193500], // the rents of the year 19.350,00 at 10%
    [12345, 1000, 1235], // 1234,5 cents: half up
    [12344, 1000, 1234],
    [100001, 2100, 21000], // 21000,21 cents
    [100001, 10000, 100001],
  ])('%i cents at %i bp is %i cents, one rounding', (total, rate, expected) => {
    expect(cedolareExpected(cents(total), rate)).toBe(expected);
  });

  it('the rate of the year: the one rate of the live cedolare contracts touching the year', () => {
    const cedolare = (id: string, extra: Record<string, unknown> = {}) =>
      makeContract(id, { taxRegime: 'cedolare', cedolareRateBp: 1000, ...extra });
    expect(cedolareRateForYear([cedolare('a')], 'berchet', '2026')).toBe(1000);
    // 2025-10 to 2027-09 touches 2025, 2026 and 2027, not 2024 or 2028.
    expect(cedolareRateForYear([cedolare('a')], 'berchet', '2024')).toBeUndefined();
    expect(cedolareRateForYear([cedolare('a')], 'berchet', '2028')).toBeUndefined();
    expect(cedolareRateForYear([cedolare('a')], 'lovarini', '2026')).toBeUndefined();
    expect(
      cedolareRateForYear(
        [
          cedolare('a'),
          cedolare('b', { start: '2026-10', end: '2028-09' }),
          cedolare('gone', { cedolareRateBp: 2100, deleted: true }),
          makeContract('ord', { taxRegime: 'ordinario' }),
        ],
        'berchet',
        '2026',
      ),
    ).toBe(1000);
    // Two different rates in the year: no estimate (R182).
    expect(
      cedolareRateForYear(
        [cedolare('a'), cedolare('b', { cedolareRateBp: 2100 })],
        'berchet',
        '2026',
      ),
    ).toBeUndefined();
  });
});
