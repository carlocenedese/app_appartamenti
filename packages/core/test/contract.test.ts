import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  PaymentSchema,
  TenancySchema,
  cedolareExpected,
  cedolareRateForYear,
  cents,
  contractChecks,
  withContractEnds,
  rentForMonth,
  yearMonth,
} from '../src/index';
import type { Contract, Payment, Tenancy } from '../src/index';

// Invented amounts only (plan 7).
const contract = ContractSchema.parse({
  id: 'ctr-app-a',
  v: 1,
  rev: 1,
  apartmentId: 'app-a',
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
    apartmentId: 'app-a',
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
    apartmentId: 'app-a',
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
    apartmentId: 'app-a',
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
    makeContract('ctr-app-a', { tenancyIds, ...extra });

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
    ).toEqual([{ code: 'unknown-tenancy', contractId: 'ctr-app-a', tenancyId: 'tcy-a' }]);
  });

  it('tenancy-other-apartment', () => {
    expect(
      checks(
        [linked(['tcy-l'], { end: '2026-09' })],
        [makeTenancy('tcy-l', { apartmentId: 'app-b' })],
      ),
    ).toEqual([{ code: 'tenancy-other-apartment', contractId: 'ctr-app-a', tenancyId: 'tcy-l' }]);
  });

  it.each([
    ['starts before', { from: '2025-09' }],
    ['ends after', { to: '2027-10' }],
  ])('tenancy-outside-contract: %s', (_name, extra) => {
    expect(checks([linked(['tcy-a'])], [makeTenancy('tcy-a', extra)])).toEqual([
      { code: 'tenancy-outside-contract', contractId: 'ctr-app-a', tenancyId: 'tcy-a' },
    ]);
  });

  it('F9 a: a stay without end ends with its contract, no check', () => {
    expect(checks([linked(['tcy-a'])], [makeTenancy('tcy-a', { to: undefined })])).toEqual([]);
  });

  it('F9 a, renewal as a new contract: the stay goes on in it, no payment is left out', () => {
    // The stay is linked only to the first contract; the renewal follows on and links nothing.
    const first = linked(['tcy-a'], { end: '2026-09' });
    const renewal = makeContract('ctr-2', { start: '2026-10', end: '2027-09' });
    const stay = makeTenancy('tcy-a', { to: undefined });
    const pay = makePayment('pay-1', {
      kind: 'canone',
      amount: 38000,
      forMonth: '2027-03',
      date: '2027-03-05',
    });
    const found = checks([first, renewal], [stay], [pay]);
    // The stay is past the first contract (link it to the renewal); no payment after its end.
    expect(found).toEqual([
      { code: 'tenancy-outside-contract', contractId: 'ctr-app-a', tenancyId: 'tcy-a' },
    ]);
    // Without the renewal the stay ends in 2026-09: the March 2027 rent is after its end.
    expect(checks([first], [stay], [pay]).map((c) => c.code)).toEqual(['payment-after-end']);
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
      { code: 'unlinked-tenancy', contractId: 'ctr-app-a', tenancyId: 'tcy-b' },
    ]);
    expect(checks([linked([], { end: '2026-09' })], tenancies)).toEqual([
      { code: 'unlinked-tenancy', contractId: 'ctr-app-a', tenancyId: 'tcy-a' },
      { code: 'unlinked-tenancy', contractId: 'ctr-app-a', tenancyId: 'tcy-b' },
    ]);
    expect(checks([makeContract('ctr-app-a', { end: '2026-09' })], tenancies)).toEqual([]);
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
    ['of another apartment', makePayment('pay-c1', { apartmentId: 'app-b' })],
  ])('unknown-deposit: %s', (_name, payment) => {
    expect(
      checks(
        [linked(['tcy-a'], { end: '2026-09', depositPaymentIds: ['pay-c1'] })],
        [makeTenancy('tcy-a')],
        [payment],
      ),
    ).toEqual([{ code: 'unknown-deposit', contractId: 'ctr-app-a', paymentId: 'pay-c1' }]);
  });

  it('deposit-other-tenant: the deposit of Bruno Esempio with only Anna Prova linked', () => {
    expect(
      checks(
        [linked(['tcy-a'], { end: '2026-09', depositPaymentIds: ['pay-b'] })],
        [makeTenancy('tcy-a')],
        [makePayment('pay-b', { tenantId: 'ten-bruno' })],
      ),
    ).toEqual([{ code: 'deposit-other-tenant', contractId: 'ctr-app-a', paymentId: 'pay-b' }]);
  });

  it('a tenancy linked to the contract of another apartment (actual behaviour)', () => {
    // Only tenancy-other-apartment: no tenancy-outside-contract, and no unlinked-tenancy in its
    // own apartment, since it is linked to a live contract; its tenant still counts for the
    // deposits of that contract, so the deposit of Anna Prova gives no deposit-other-tenant.
    expect(
      checks(
        [
          linked(['tcy-l'], { end: '2026-09', depositPaymentIds: ['pay-c1'] }),
          makeContract('ctr-lov', { apartmentId: 'app-b', tenancyIds: [], end: '2026-09' }),
        ],
        [makeTenancy('tcy-l', { apartmentId: 'app-b', from: '2025-09' })],
        [makePayment('pay-c1')],
      ),
    ).toEqual([{ code: 'tenancy-other-apartment', contractId: 'ctr-app-a', tenancyId: 'tcy-l' }]);
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
      ['ctr-app-a', 'deposit-other-tenant'],
      ['ctr-app-a', 'tenancy-linked-twice'],
      ['ctr-app-a', 'unknown-deposit'],
      ['ctr-app-a', 'unknown-tenancy'],
    ]);
  });
});

// --- R4 on the rent history (plan 7, task 4): the example of the design, section 3.

describe('contractChecks: rent-differs (plan 7, task 4)', () => {
  const initial = { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 };
  const renewal = { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 };
  const aptA = (rent?: unknown[]) => makeContract('ctr-app-a', rent === undefined ? {} : { rent });
  // Anna Prova, Bruno Esempio, Carla Finta, Dario Inventato 350 + 30; Elena Fittizia 330 + 30.
  const year = [
    ...['anna', 'bruno', 'carla', 'dario'].map((n) => makeTenancy(`tcy-${n}`, { tenantId: n })),
    makeTenancy('tcy-elena', { tenantId: 'elena', monthlyRent: 33000 }),
  ];
  const rentChecks = (contract: Contract, tenancies: Tenancy[], month: string = asOf) =>
    checks([contract], tenancies, [], yearMonth(month)).filter((c) => c.code === 'rent-differs');

  it('the example: one interval per equal months, the month of asOf included', () => {
    expect(rentChecks(aptA([initial]), year)).toEqual([
      {
        code: 'rent-differs',
        contractId: 'ctr-app-a',
        from: '2025-10',
        to: '2026-09',
        expected: 175000,
        actual: 188000,
      },
      {
        code: 'rent-differs',
        contractId: 'ctr-app-a',
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
    expect(rentChecks(aptA([initial, renewal]), [...year, ...next, extra])).toEqual([
      expect.objectContaining({ from: '2025-10', to: '2026-09' }),
    ]);
  });

  it('no month after asOf, none before the first entry, none without rent', () => {
    expect(rentChecks(aptA([initial]), year, '2026-09').map((c) => c.to)).toEqual(['2026-09']);
    const late = makeContract('ctr-app-a', { rent: [{ ...initial, from: '2026-01' }] });
    expect(rentChecks(late, year).map((c) => c.from)).toEqual(['2026-01', '2026-10']);
    expect(rentChecks(aptA(), year)).toEqual([]);
    expect(rentChecks(aptA([initial]), year, '2025-09')).toEqual([]);
  });

  it('a tenancy that leaves in 2026-03 opens a new interval from 2026-04', () => {
    const leaving = year.map((t) =>
      t.id === 'tcy-elena' ? { ...t, to: yearMonth('2026-03') } : t,
    );
    expect(
      rentChecks(aptA([initial]), leaving, '2026-09').map((c) => [c.from, c.to, c.actual]),
    ).toEqual([
      ['2025-10', '2026-03', 188000],
      ['2026-04', '2026-09', 152000],
    ]);
  });

  it('months that add up exactly give nothing, deleted tenancies do not count', () => {
    const exact = makeContract('ctr-app-a', {
      end: '2026-09',
      rent: [{ from: '2025-10', monthlyRent: 172000, monthlyAdvance: 16000 }],
    });
    const gone = makeTenancy('tcy-gone', { deleted: true });
    expect(rentChecks(exact, [...year, gone])).toEqual([]);
  });
});

describe('contractChecks: contract-overlap (user1, question 9 of plan 7, R181)', () => {
  it('the example: a renewal saved as a new contract, months in common 2026-10 – 2027-09', () => {
    const renewal = makeContract('ctr-app-a-2', { start: '2026-10', end: '2028-09' });
    expect(checks([renewal, makeContract('ctr-app-a')])).toEqual([
      {
        code: 'contract-overlap',
        contractId: 'ctr-app-a',
        otherContractId: 'ctr-app-a-2',
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
      makeContract('ctr-l', { apartmentId: 'app-b' }),
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
    [Number.MAX_SAFE_INTEGER, 10000, Number.MAX_SAFE_INTEGER], // BigInt: no precision lost
    [Number.MAX_SAFE_INTEGER, 1, 900719925474], // 900719925474,0991 cents
  ])('%i cents at %i bp is %i cents, one rounding', (total, rate, expected) => {
    expect(cedolareExpected(cents(total), rate)).toBe(expected);
  });

  it('the rate of the year: the one rate of the live cedolare contracts touching the year', () => {
    const cedolare = (id: string, extra: Record<string, unknown> = {}) =>
      makeContract(id, { taxRegime: 'cedolare', cedolareRateBp: 1000, ...extra });
    expect(cedolareRateForYear([cedolare('a')], 'app-a', '2026')).toBe(1000);
    // 2025-10 to 2027-09 touches 2025, 2026 and 2027, not 2024 or 2028.
    expect(cedolareRateForYear([cedolare('a')], 'app-a', '2024')).toBeUndefined();
    expect(cedolareRateForYear([cedolare('a')], 'app-a', '2028')).toBeUndefined();
    expect(cedolareRateForYear([cedolare('a')], 'app-b', '2026')).toBeUndefined();
    expect(
      cedolareRateForYear(
        [
          cedolare('a'),
          cedolare('b', { start: '2026-10', end: '2028-09' }),
          cedolare('gone', { cedolareRateBp: 2100, deleted: true }),
          makeContract('ord', { taxRegime: 'ordinario', deleted: true }),
          makeContract('old', { taxRegime: 'ordinario', start: '2024-01', end: '2025-12' }),
        ],
        'app-a',
        '2026',
      ),
    ).toBe(1000);
    // Two different rates in the year: no estimate (R182).
    expect(
      cedolareRateForYear(
        [cedolare('a'), cedolare('b', { cedolareRateBp: 2100 })],
        'app-a',
        '2026',
      ),
    ).toBeUndefined();
  });

  it('a mixed year gives no estimate: ordinario or no rate on any live contract (R182)', () => {
    const cedolare = makeContract('ced', {
      start: '2026-10',
      end: '2027-09',
      taxRegime: 'cedolare',
      cedolareRateBp: 1000,
    });
    const before = { start: '2025-10', end: '2026-09' };
    // Ordinario January to September, cedolare October to December.
    expect(
      cedolareRateForYear(
        [makeContract('ord', { ...before, taxRegime: 'ordinario' }), cedolare],
        'app-a',
        '2026',
      ),
    ).toBeUndefined();
    // A contract with no regime or a cedolare one with no rate.
    for (const extra of [{}, { taxRegime: 'cedolare' }]) {
      expect(
        cedolareRateForYear(
          [makeContract('x', { ...before, ...extra }), cedolare],
          'app-a',
          '2026',
        ),
      ).toBeUndefined();
    }
    expect(cedolareRateForYear([cedolare], 'app-a', '2026')).toBe(1000);
  });
});

describe('contractChecks: takeovers and rents after the end (plan 11, review)', () => {
  const anna = makeTenancy('t-a', { to: '2026-02' });
  const bruno = makeTenancy('t-b', { tenantId: 'ten-bruno', from: '2026-03', to: '2026-09' });
  const codes = (contract: Contract, tenancies: Tenancy[], payments: Payment[] = []) =>
    checks([contract], tenancies, payments)
      .filter((c) => c.code.startsWith('takeover') || c.code === 'payment-after-end')
      .map((c) => [c.code, c.tenancyId, c.from]);
  const withTakeover = (extra: Record<string, unknown> = {}) =>
    makeContract('ctr', {
      end: '2026-09',
      tenancyIds: ['t-a', 't-b'],
      takeovers: [{ month: '2026-03', outTenancyId: 't-a', inTenancyId: 't-b' }],
      ...extra,
    });

  it('a coherent takeover gives nothing', () => {
    expect(codes(withTakeover(), [anna, bruno])).toEqual([]);
  });

  it('takeover-unlinked and takeover-dates for data written by hand', () => {
    expect(codes(withTakeover({ tenancyIds: ['t-a'] }), [anna, bruno])).toEqual([
      ['takeover-unlinked', 't-b', '2026-03'],
    ]);
    const late = makeTenancy('t-b', { tenantId: 'ten-bruno', from: '2026-04', to: '2026-09' });
    expect(codes(withTakeover(), [anna, late])).toEqual([['takeover-dates', 't-b', '2026-03']]);
    expect(codes(withTakeover(), [anna])).toEqual([['takeover-dates', 't-b', '2026-03']]);
  });

  it('a confirmed rent for a month after the end of the stay is payment-after-end', () => {
    const rent = (id: string, extra: Record<string, unknown>) =>
      makePayment(id, { kind: 'canone', amount: 38000, ...extra });
    const payments = [
      rent('p-late', { date: '2026-03-05' }),
      rent('p-for', { date: '2026-02-27', forMonth: '2026-04' }),
      rent('p-ok', { date: '2026-02-05' }),
      rent('p-unconfirmed', { date: '2026-03-05', confirmed: false }),
    ];
    expect(codes(withTakeover(), [anna, bruno], payments)).toEqual([
      ['payment-after-end', 't-a', '2026-04'], // sorted by paymentId: p-for, then p-late
      ['payment-after-end', 't-a', '2026-03'],
    ]);
  });
});

describe('withContractEnds (F9 a)', () => {
  const stay = (id: string, extra: Partial<Tenancy> = {}): Tenancy =>
    TenancySchema.parse({
      id,
      v: 1,
      rev: 1,
      apartmentId: 'app-a',
      tenantId: `ten-${id}`,
      from: '2025-10',
      monthlyRent: 30000,
      monthlyForfait: 3000,
      ...extra,
    });
  const ctr = (
    id: string,
    start: string,
    end: string,
    tenancyIds: string[],
    extra = {},
  ): Contract =>
    ContractSchema.parse({ ...contract, id, start, end, rent: undefined, tenancyIds, ...extra });

  it('ends a stay without end with the latest contract of the tenant; leaves the rest', () => {
    const open = stay('open');
    const ended = stay('ended', { to: yearMonth('2026-03') });
    const result = withContractEnds(
      [open, ended],
      [
        ctr('c-1', '2025-10', '2026-09', ['open', 'ended']),
        ctr('c-3', '2026-10', '2029-09', ['open'], { deleted: true }),
      ],
    );
    expect(result).toEqual([{ ...open, to: '2026-09' }, ended]);
  });

  it('follows a renewal written as a new contract, even when it does not link the stay', () => {
    const open = stay('open', { from: yearMonth('2025-04') });
    const result = withContractEnds(
      [open],
      [
        ctr('c-0', '2025-04', '2025-09', ['open']),
        ctr('c-1', '2025-10', '2026-09', []),
        ctr('c-2', '2026-10', '2027-09', []),
        // Not a renewal: a gap of a month.
        ctr('c-4', '2027-11', '2028-09', []),
      ],
    );
    expect(result[0]?.to).toBe('2027-09');
  });

  it('G2-I1: a contract of another tenant never carries the stay on', () => {
    const a = stay('a');
    const b = stay('b', { to: yearMonth('2027-09') });
    const result = withContractEnds(
      [a, b],
      [ctr('cA', '2025-10', '2026-09', ['a']), ctr('cB', '2025-10', '2027-09', ['b'])],
    );
    expect(result.map((t) => [t.id, t.to])).toEqual([
      ['a', '2026-09'],
      ['b', '2027-09'],
    ]);
    // Nor a later contract of another tenant that follows on.
    expect(
      withContractEnds(
        [a],
        [ctr('cA', '2025-10', '2026-09', ['a']), ctr('cC', '2026-10', '2027-09', ['c'])],
      )[0]?.to,
    ).toBe('2026-09');
  });

  it('a returning tenant: an old contract ending before the new stay is not its end', () => {
    const old = stay('old', { from: yearMonth('2023-10'), to: yearMonth('2024-09') });
    const back = stay('back', { tenantId: 'ten-old', from: yearMonth('2025-10') });
    const contracts = [
      ctr('c-old', '2023-10', '2024-09', ['old']),
      ctr('c-new', '2025-10', '2026-09', []),
    ];
    expect(withContractEnds([old, back], contracts)[1]?.to).toBe('2026-09');
  });

  it('without links takes the contract in force at the start; with no contract stays open', () => {
    const open = stay('open', { from: yearMonth('2026-01') });
    expect(withContractEnds([open], [ctr('c-1', '2025-10', '2026-09', [])])[0]?.to).toBe('2026-09');
    expect(withContractEnds([open], [])[0]).toEqual(open);
    // A contract that ends before the stay starts gives no end.
    expect(withContractEnds([open], [ctr('c-0', '2025-01', '2025-09', ['open'])])[0]).toEqual(open);
  });
});
