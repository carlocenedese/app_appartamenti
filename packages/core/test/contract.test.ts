import { describe, expect, it } from 'vitest';
import {
  ContractSchema,
  PaymentSchema,
  TenancySchema,
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
    ).toEqual([{ code: 'unlinked-tenancy', contractId: 'ctr-a', tenancyId: 'tcy-a' }]);
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
      ['ctr-2', 'tenancy-linked-twice'],
      ['ctr-2', 'unlinked-tenancy'], // the first contract by id
      ['ctr-berchet', 'deposit-other-tenant'],
      ['ctr-berchet', 'tenancy-linked-twice'],
      ['ctr-berchet', 'unknown-deposit'],
      ['ctr-berchet', 'unknown-tenancy'],
    ]);
  });
});
