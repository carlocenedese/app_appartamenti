import { describe, expect, it } from 'vitest';
import { collectedForfait, SettlementInputError } from '../src/conguaglio';
import { coveredMonths, reconcileIncome, rentArrears } from '../src/income';
import { OperationSchema } from '../src/journal';
import { cents } from '../src/money';
import { recordPath } from '../src/store/records';
import type { IncomeContext } from '../src/income';
import {
  AccountSchema,
  BankTransactionSchema,
  PayerSchema,
  PaymentSchema,
  StatementSchema,
  TenancySchema,
  TenantSchema,
} from '../src/model';
import type { BankTransaction, Statement } from '../src/model';
import type { YearMonth } from '../src/period';
import { apartment } from './helpers/conguaglio-builders';
import { ibanEndingWith } from './helpers/iban-build';

const base = { v: 1, rev: 1 };
const OWN_A = ibanEndingWith('1');
const OWN_B = ibanEndingWith('2');
const OWN_C = ibanEndingWith('3');
const PAYER_IBAN = ibanEndingWith('77');
const OTHER_IBAN = ibanEndingWith('78');
// One digit changed at run time: never a whole invented IBAN in the file.
const BAD_IBAN = PAYER_IBAN.replace(/\d$/, (d) => String((Number(d) + 1) % 10));

const account = (id: string, apartmentId: string, iban: string) =>
  AccountSchema.parse({ ...base, id, apartmentId, label: 'Conto', bankProfileId: 'bp1', iban });

const tenancy = (over: Record<string, unknown>) =>
  TenancySchema.parse({
    ...base,
    id: 'ten1',
    apartmentId: 'a1',
    tenantId: 't1',
    from: '2026-01',
    monthlyRent: 40000,
    monthlyForfait: 5000,
    ...over,
  });

const payer = (over: Record<string, unknown> = {}) =>
  PayerSchema.parse({
    ...base,
    id: 'pr1',
    key: `iban:${PAYER_IBAN}`,
    tenantId: 't1',
    validFrom: '2026-01-01',
    source: 'confirmed',
    ...over,
  });

const payment = (over: Record<string, unknown>) =>
  PaymentSchema.parse({
    ...base,
    apartmentId: 'a1',
    tenantId: 't1',
    date: '2026-01-05',
    amount: 45000,
    confirmed: true,
    kind: 'canone',
    source: 'manual',
    ...over,
  });

const statement = (over: Record<string, unknown> = {}): Statement =>
  StatementSchema.parse({
    ...base,
    id: 's1',
    accountId: 'c1',
    bankProfileId: 'bp1',
    fileName: 'estratto.csv',
    suggestedPath: 'estratti/estratto.csv',
    from: '2026-01-01',
    to: '2026-12-31',
    periodSource: 'file',
    rowCount: 0,
    transactionIds: [],
    held: [],
    ...over,
  });

const tx = (id: string, date: string, amount = 45000, iban = PAYER_IBAN): BankTransaction =>
  BankTransactionSchema.parse({
    ...base,
    id,
    apartmentId: 'a1',
    accountId: 'c1',
    date,
    amount,
    description: 'Bonifico a vostro favore',
    statementHash: 'h1',
    counterparty: { iban },
  });

type Input = Parameters<typeof reconcileIncome>[0];

const input = (over: Partial<Input> = {}): Input => ({
  accounts: [account('c1', 'a1', OWN_A), account('c2', 'a2', OWN_B), account('c3', 'a1', OWN_C)],
  apartments: [apartment({ id: 'a1' })],
  tenancies: [tenancy({})],
  tenants: [],
  payers: [payer()],
  payments: [],
  transactions: [],
  statements: [statement()],
  operations: [],
  ...over,
});

/** A journal operation that leaves each payment as given (the `after` of its change). */
const op = (id: string, kind: string, after: object[], undoes?: string) =>
  OperationSchema.parse({
    id,
    v: 1,
    at: '2026-11-14T09:00:00.000Z',
    profileId: 'p1',
    kind,
    summary: 'x',
    changes: after.map((a) => ({
      path: recordPath('payment', (a as { id: string }).id),
      after: a,
    })),
    ...(undoes === undefined ? {} : { undoes }),
  });

const auto = (transactionId: string, date: string, forMonth: string, amount = 45000) => ({
  id: `pay-${transactionId}`,
  apartmentId: 'a1',
  tenantId: 't1',
  date,
  amount,
  confirmed: true,
  kind: 'canone',
  forMonth,
  source: 'csv',
  transactionId,
});

const cosa = (transactionId: string, reason: string, month?: string) => ({
  id: `p-cosa-${transactionId}`,
  transactionId,
  step: 'cosa',
  reason,
  tenantIds: ['t1'],
  key: `iban:${PAYER_IBAN}`,
  ...(month === undefined ? {} : { month }),
});

/** January paid, so that a February transaction looks only at February. */
const janPaid = payment({ id: 'pm-jan', forMonth: '2026-01' });

describe('coveredMonths', () => {
  const ctx = (
    statements: Statement[],
  ): Pick<IncomeContext, 'accounts'> & {
    statements: Statement[];
  } => ({ accounts: input().accounts, statements });

  it('counts only months covered from the first to the last day (user1, 14 Nov 2026)', () => {
    const months = coveredMonths(
      ctx([
        statement({ id: 's1', from: '2026-01-31', to: '2026-02-01' }),
        statement({ id: 's2', from: '2026-03-01', to: '2026-03-31' }),
        statement({ id: 's3', from: '2026-04-01', to: '2026-04-30' }),
      ]),
      'a1',
    );
    expect([...months].sort()).toEqual(['2026-03', '2026-04']);
  });

  it('joins the statements of two accounts of the apartment, and a gap leaves the month out', () => {
    const months = coveredMonths(
      ctx([
        statement({ id: 's1', from: '2026-01-01', to: '2026-01-15' }),
        statement({ id: 's2', accountId: 'c3', from: '2026-01-16', to: '2026-02-28' }),
        statement({ id: 's3', from: '2026-03-01', to: '2026-03-20' }),
        statement({ id: 's4', from: '2026-03-22', to: '2026-03-31' }),
      ]),
      'a1',
    );
    expect([...months].sort()).toEqual(['2026-01', '2026-02']);
  });

  it('ignores deleted statements and statements of another apartment or unknown account', () => {
    const months = coveredMonths(
      ctx([
        statement({ id: 's1', deleted: true }),
        statement({ id: 's2', accountId: 'c2' }),
        statement({ id: 's3', accountId: 'c9' }),
        statement({ id: 's4', from: '2026-05-01', to: '2026-06-02' }),
      ]),
      'a1',
    );
    expect([...months].sort()).toEqual(['2026-05']);
  });
});

describe('reconcileIncome, phase «che cosa»', () => {
  it('records the exact rent of the month by itself', () => {
    const result = reconcileIncome(
      input({ payments: [janPaid], transactions: [tx('x1', '2026-02-03')] }),
    );
    expect(result).toEqual({
      payments: [auto('x1', '2026-02-03', '2026-02')],
      proposals: [],
      skipped: [],
    });
  });

  it('500 euro and two months in one transfer are amount-differs with the proposed month', () => {
    const result = reconcileIncome(
      input({
        payments: [janPaid],
        transactions: [tx('x1', '2026-02-03', 50000), tx('x2', '2026-01-03', 90000, OTHER_IBAN)],
        payers: [payer(), payer({ id: 'pr2', key: `iban:${OTHER_IBAN}`, tenantId: 't2' })],
        tenancies: [tenancy({}), tenancy({ id: 'ten2', tenantId: 't2', room: 'B' })],
      }),
    );
    expect(result.payments).toEqual([]);
    expect(result.proposals).toEqual([
      cosa('x1', 'amount-differs', '2026-02'),
      {
        ...cosa('x2', 'amount-differs', '2026-01'),
        tenantIds: ['t2'],
        key: `iban:${OTHER_IBAN}`,
      },
    ]);
  });

  it('a month already paid is month-paid', () => {
    const result = reconcileIncome(
      input({
        payments: [janPaid, payment({ id: 'pm-feb', forMonth: '2026-02', confirmed: false })],
        transactions: [tx('x1', '2026-02-20')],
      }),
    );
    expect(result.proposals).toEqual([cosa('x1', 'month-paid')]);
  });

  it('a rent payment of another apartment does not pay the month here', () => {
    const result = reconcileIncome(
      input({
        payments: [janPaid, payment({ id: 'pm-feb', forMonth: '2026-02', apartmentId: 'a2' })],
        transactions: [tx('x1', '2026-02-20')],
      }),
    );
    expect(result.payments).toEqual([auto('x1', '2026-02-20', '2026-02')]);
  });

  it('10 days late is automatic for the month before, 11 is late', () => {
    expect(reconcileIncome(input({ transactions: [tx('x1', '2026-02-10')] })).payments).toEqual([
      auto('x1', '2026-02-10', '2026-01'),
    ]);
    expect(reconcileIncome(input({ transactions: [tx('x1', '2026-02-11')] })).proposals).toEqual([
      cosa('x1', 'late'),
    ]);
  });

  it('rentLateDays of the apartment moves the boundary', () => {
    const apartments = [apartment({ id: 'a1', rentLateDays: 5 })];
    expect(
      reconcileIncome(input({ apartments, transactions: [tx('x1', '2026-02-05')] })).payments,
    ).toEqual([auto('x1', '2026-02-05', '2026-01')]);
    expect(
      reconcileIncome(input({ apartments, transactions: [tx('x1', '2026-02-06')] })).proposals,
    ).toEqual([cosa('x1', 'late')]);
  });

  it('an open October blocks the exact rent of 3 November (decision C)', () => {
    const payments = [
      ...['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) =>
        payment({ id: `pm-${m}`, forMonth: `2026-${m}` }),
      ),
    ];
    const blocked = reconcileIncome(
      input({
        payments,
        transactions: [tx('x-oct', '2026-10-05', 50000), tx('x-nov', '2026-11-03')],
      }),
    );
    expect(blocked.payments).toEqual([]);
    expect(blocked.proposals).toEqual([
      cosa('x-nov', 'earlier-open'),
      cosa('x-oct', 'amount-differs', '2026-10'),
    ]);

    // With October exact, both are automatic: the run's own payments count as paid.
    const free = reconcileIncome(
      input({ payments, transactions: [tx('x-nov', '2026-11-03'), tx('x-oct', '2026-10-05')] }),
    );
    expect(free.payments).toEqual([
      auto('x-nov', '2026-11-03', '2026-11'),
      auto('x-oct', '2026-10-05', '2026-10'),
    ]);
    expect(free.proposals).toEqual([]);
  });

  it('a used (excluded) movement gives no payment, no proposal, and blocks nothing (plan 3c)', () => {
    const payments = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((m) =>
      payment({ id: `pm-${m}`, forMonth: `2026-${m}` }),
    );
    // October paid by hand: the October transfer is a duplicate, not a payment.
    const transactions = [tx('x-oct', '2026-10-05', 50000), tx('x-nov', '2026-11-03')];
    const kept = reconcileIncome(input({ payments, transactions }));
    expect(kept.proposals.map((p) => [p.id, p.reason])).toContainEqual([
      'p-cosa-x-nov',
      'earlier-open',
    ]);
    const result = reconcileIncome(
      input({ payments, transactions, usedTransactionIds: new Set(['x-oct']) }),
    );
    expect(result.payments).toEqual([auto('x-nov', '2026-11-03', '2026-11')]);
    expect(result.proposals).toEqual([]);
    expect(result.skipped).toEqual([]);
    // An exact credit that is used gives nothing either.
    const exact = reconcileIncome(
      input({
        payments,
        transactions: [tx('x-nov', '2026-11-03')],
        usedTransactionIds: new Set(['x-nov']),
      }),
    );
    expect([exact.payments, exact.proposals]).toEqual([[], []]);
  });

  it('a room change uses the presence of the chosen month', () => {
    const tenancies = [
      tenancy({ id: 'ten1', to: '2026-03' }),
      tenancy({ id: 'ten2', from: '2026-04', room: 'B', monthlyRent: 50000 }),
    ];
    const payments = ['01', '02', '03'].map((m) =>
      payment({ id: `pm-${m}`, forMonth: `2026-${m}` }),
    );
    const result = reconcileIncome(
      input({
        tenancies,
        payments,
        transactions: [tx('x1', '2026-04-02', 55000), tx('x2', '2026-05-02', 45000)],
      }),
    );
    expect(result.payments).toEqual([auto('x1', '2026-04-02', '2026-04', 55000)]);
    expect(result.proposals).toEqual([cosa('x2', 'amount-differs', '2026-05')]);
  });

  it('after leaving in October: 5 November pays October, 20 December is not-present', () => {
    const tenancies = [tenancy({ to: '2026-10' })];
    const payments = ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) =>
      payment({ id: `pm-${m}`, forMonth: `2026-${m}` }),
    );
    const result = reconcileIncome(
      input({
        tenancies,
        payments,
        transactions: [tx('x1', '2026-11-05'), tx('x2', '2026-12-20', 12000)],
      }),
    );
    expect(result.payments).toEqual([auto('x1', '2026-11-05', '2026-10')]);
    expect(result.proposals).toEqual([cosa('x2', 'not-present')]);
  });

  it('a month outside the covered months is not to pay', () => {
    const transactions = [tx('x1', '2026-02-15')];
    expect(
      reconcileIncome(input({ transactions, statements: [statement({ from: '2026-02-01' })] }))
        .payments,
    ).toEqual([auto('x1', '2026-02-15', '2026-02')]);
    expect(reconcileIncome(input({ transactions })).proposals).toEqual([cosa('x1', 'late')]);
  });

  it('two overlapping presences of the tenant throw tenant-overlap', () => {
    const tenancies = [tenancy({}), tenancy({ id: 'ten2', from: '2026-02', room: 'B' })];
    const run = () => reconcileIncome(input({ tenancies, transactions: [tx('x1', '2026-03-03')] }));
    expect(run).toThrow(SettlementInputError);
    expect(run).toThrow(expect.objectContaining({ code: 'tenant-overlap' }) as Error);
  });

  it('collectedForfait on the drafts gives the expected flat charge', () => {
    const { payments } = reconcileIncome(
      input({ transactions: [tx('x1', '2026-01-05'), tx('x2', '2026-02-04')] }),
    );
    const rows = collectedForfait({
      tenancies: input().tenancies,
      payments: payments.map((p) => ({ ...p, v: 1 as const, rev: 1 })),
      months: ['2026-01', '2026-02', '2026-03'] as YearMonth[],
    });
    expect(rows.map((r) => [r.month, r.forfaitCollected])).toEqual([
      ['2026-01', 5000],
      ['2026-02', 5000],
      ['2026-03', 0],
    ]);
  });

  it('who-proposals, skips, debits and transactions with a live payment', () => {
    const result = reconcileIncome(
      input({
        payers: [],
        payments: [payment({ id: 'pm1', transactionId: 'x-paid' })],
        transactions: [
          tx('x-new', '2026-02-03'),
          tx('x-own', '2026-02-03', 45000, OWN_B),
          { ...tx('x-acc', '2026-02-04'), accountId: 'c9' },
          tx('x-debit', '2026-02-03', -45000),
          { ...tx('x-gone', '2026-02-03'), deleted: true },
          tx('x-paid', '2026-02-03'),
        ],
      }),
    );
    expect(result).toEqual({
      payments: [],
      proposals: [
        {
          id: 'p-chi-x-new',
          transactionId: 'x-new',
          step: 'chi',
          reason: 'new-payer',
          tenantIds: ['t1'],
          key: `iban:${PAYER_IBAN}`,
        },
      ],
      skipped: [
        { transactionId: 'x-acc', reason: 'no-account' },
        { transactionId: 'x-own', reason: 'own-account' },
      ],
    });
  });

  it('a statement from 15 January: February and March automatic, April partial, no January', () => {
    const result = reconcileIncome(
      input({
        tenancies: [tenancy({ from: '2025-06' })],
        statements: [statement({ from: '2026-01-15', to: '2026-04-15' })],
        transactions: [tx('x2', '2026-02-03'), tx('x3', '2026-03-03'), tx('x4', '2026-04-03')],
      }),
    );
    expect(result.payments).toEqual([
      auto('x2', '2026-02-03', '2026-02'),
      auto('x3', '2026-03-03', '2026-03'),
    ]);
    expect(result.proposals).toEqual([cosa('x4', 'not-covered', '2026-04')]);
  });

  it('the month before, partial and within the late days, goes to review', () => {
    const result = reconcileIncome(
      input({
        payments: [payment({ id: 'pm-feb', forMonth: '2026-02' })],
        statements: [statement({ from: '2026-01-15', to: '2026-02-28' })],
        transactions: [tx('x1', '2026-02-03')],
      }),
    );
    expect(result.proposals).toEqual([cosa('x1', 'not-covered', '2026-01')]);
    const later = reconcileIncome(
      input({
        payments: [payment({ id: 'pm-feb', forMonth: '2026-02' })],
        statements: [statement({ from: '2026-01-15', to: '2026-02-28' })],
        transactions: [tx('x1', '2026-02-11')],
      }),
    );
    expect(later.proposals).toEqual([cosa('x1', 'month-paid')]);
  });

  it('statements of another account of the apartment count', () => {
    const result = reconcileIncome(
      input({
        payments: [janPaid],
        statements: [statement({ accountId: 'c3', from: '2026-02-01', to: '2026-02-28' })],
        transactions: [tx('x1', '2026-02-03')],
      }),
    );
    expect(result.payments).toEqual([auto('x1', '2026-02-03', '2026-02')]);
  });

  it('5 January pays December across the year', () => {
    const result = reconcileIncome(
      input({
        statements: [statement({ from: '2026-12-01', to: '2027-01-31' })],
        transactions: [tx('x1', '2027-01-05'), tx('x2', '2027-01-06')],
      }),
    );
    expect(result.payments).toEqual([
      auto('x1', '2027-01-05', '2026-12'),
      auto('x2', '2027-01-06', '2027-01'),
    ]);
  });

  it('a zero flat charge: the rent alone is exact', () => {
    const tenancies = [tenancy({ monthlyForfait: 0 })];
    const { payments } = reconcileIncome(
      input({ tenancies, payments: [janPaid], transactions: [tx('x1', '2026-02-03', 40000)] }),
    );
    expect(payments).toEqual([auto('x1', '2026-02-03', '2026-02', 40000)]);
    const rows = collectedForfait({
      tenancies,
      payments: payments.map((p) => ({ ...p, v: 1 as const, rev: 1 })),
      months: ['2026-02'] as YearMonth[],
    });
    expect(rows.map((r) => r.forfaitCollected)).toEqual([0]);
  });

  it('an open «chi» proposal blocks the later months of its candidates in the apartment', () => {
    const payments = ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) =>
      payment({ id: `pm-${m}`, forMonth: `2026-${m}` }),
    );
    const result = reconcileIncome(
      input({
        payments,
        transactions: [tx('x-oct', '2026-10-05', 45000, OTHER_IBAN), tx('x-nov', '2026-11-03')],
      }),
    );
    expect(result.payments).toEqual([]);
    expect(result.proposals.map((p) => [p.id, p.reason])).toEqual([
      ['p-chi-x-oct', 'new-payer'],
      ['p-cosa-x-nov', 'earlier-open'],
    ]);

    // A «chi» proposal on an account of another apartment does not block here.
    const elsewhere = reconcileIncome(
      input({
        payments,
        tenancies: [tenancy({}), tenancy({ id: 'ten9', apartmentId: 'a2', room: 'Z' })],
        transactions: [
          { ...tx('x-oct', '2026-10-05', 45000, OTHER_IBAN), accountId: 'c2', apartmentId: 'a2' },
          tx('x-nov', '2026-11-03'),
        ],
      }),
    );
    expect(elsewhere.payments).toEqual([auto('x-nov', '2026-11-03', '2026-10')]);
  });

  it('an undone confirmation makes only that transaction undone, never automatic again', () => {
    const t2 = [payer(), payer({ id: 'pr2', key: `iban:${OTHER_IBAN}`, tenantId: 't2' })];
    const result = reconcileIncome(
      input({
        payers: t2,
        tenancies: [tenancy({}), tenancy({ id: 'ten2', tenantId: 't2', room: 'B' })],
        payments: [
          payment({
            ...auto('x2', '2026-02-03', '2026-02'),
            id: 'pay-x2-1',
            rev: 2,
            deleted: true,
          }),
          payment({ id: 'pm-y2', transactionId: 'y2', deleted: true }),
        ],
        transactions: [
          tx('x1', '2026-01-05'),
          tx('x2', '2026-02-03'),
          tx('y1', '2026-01-05', 45000, OTHER_IBAN),
          tx('y2', '2026-02-03', 45000, OTHER_IBAN),
        ],
      }),
    );
    expect(result.payments.map((p) => p.id)).toEqual(['pay-x1', 'pay-y1', 'pay-y2']);
    expect(result.proposals).toEqual([cosa('x2', 'undone')]);
  });

  it('an undone transaction blocks the later ones of the same tenant (earlier-open), not other tenants', () => {
    const t2 = [payer(), payer({ id: 'pr2', key: `iban:${OTHER_IBAN}`, tenantId: 't2' })];
    const result = reconcileIncome(
      input({
        payers: t2,
        tenancies: [tenancy({}), tenancy({ id: 'ten2', tenantId: 't2', room: 'B' })],
        payments: [
          payment({
            ...auto('x2', '2026-02-03', '2026-02'),
            id: 'pay-x2-1',
            rev: 2,
            deleted: true,
          }),
        ],
        transactions: [
          tx('x1', '2026-01-05'),
          tx('x2', '2026-02-03'),
          tx('x3', '2026-03-03'),
          tx('y1', '2026-01-05', 45000, OTHER_IBAN),
          tx('y2', '2026-02-03', 45000, OTHER_IBAN),
          tx('y3', '2026-03-03', 45000, OTHER_IBAN),
        ],
      }),
    );
    expect(result.payments.map((p) => p.id)).toEqual(['pay-x1', 'pay-y1', 'pay-y2', 'pay-y3']);
    expect(result.proposals.map((p) => [p.id, p.reason])).toEqual([
      ['p-cosa-x2', 'undone'],
      ['p-cosa-x3', 'earlier-open'],
    ]);
  });

  describe('which deletion makes a transaction undone (R118, user1, 15 Nov 2026)', () => {
    const transactions = [tx('x1', '2026-01-05'), tx('x2', '2026-02-03'), tx('x3', '2026-03-03')];
    const first = reconcileIncome(input({ transactions }));
    const live = first.payments.map((p) => payment({ ...p }));
    const gone = live.map((p) => payment({ ...p, rev: 2, deleted: true }));
    const reconcile = op('r1', 'income.reconcile', live);

    it('undoing the whole reconciliation: back to automatic, never undone', () => {
      expect(first.payments.map((p) => p.id)).toEqual(['pay-x1', 'pay-x2', 'pay-x3']);
      const operations = [reconcile, op('u1', 'undo', gone, 'r1')];
      expect(reconcileIncome(input({ transactions, payments: gone, operations }))).toEqual(first);
    });

    it('a reconciliation of one payment undone whole: back to automatic', () => {
      const one = [tx('x1', '2026-01-05')];
      const [p1] = reconcileIncome(input({ transactions: one })).payments;
      if (p1 === undefined) throw new Error('none');
      const deleted = payment({ ...p1, rev: 2, deleted: true });
      const operations = [
        op('r1', 'income.reconcile', [payment({ ...p1 })]),
        op('u1', 'undo', [deleted], 'r1'),
      ];
      expect(
        reconcileIncome(input({ transactions: one, payments: [deleted], operations })).payments,
      ).toEqual([p1]);
    });

    it('one automatic payment cancelled by itself: undone, the others stay', () => {
      const [, x2] = gone;
      if (x2 === undefined) throw new Error('none');
      const payments = [live[0], x2, live[2]].filter((p) => p !== undefined);
      const operations = [reconcile, op('c1', 'income.cancel-payment', [x2])];
      const result = reconcileIncome(input({ transactions, payments, operations }));
      expect(result.payments).toEqual([]);
      expect(result.proposals).toEqual([cosa('x2', 'undone')]);
    });

    it('a deleted csv payment that no operation explains is undone (the safe side)', () => {
      const result = reconcileIncome(input({ transactions, payments: gone }));
      expect(result.payments).toEqual([]);
      expect(result.proposals.map((p) => [p.id, p.reason])).toEqual([
        ['p-cosa-x1', 'undone'],
        ['p-cosa-x2', 'undone'],
        ['p-cosa-x3', 'undone'],
      ]);
    });
  });

  it('a payer of a deleted tenant does not count: once automatic, now a «chi» (user1, 15 Nov 2026)', () => {
    const transactions = [tx('x1', '2026-01-05')];
    expect(reconcileIncome(input({ transactions })).payments).toEqual([
      auto('x1', '2026-01-05', '2026-01'),
    ]);
    const tenants = [
      TenantSchema.parse({ ...base, id: 't1', name: 'Nome Inventato', deleted: true }),
    ];
    const result = reconcileIncome(input({ transactions, tenants }));
    expect(result.payments).toEqual([]);
    expect(result.proposals).toEqual([
      {
        id: 'p-chi-x1',
        transactionId: 'x1',
        step: 'chi',
        reason: 'new-payer',
        tenantIds: ['t1'],
        key: `iban:${PAYER_IBAN}`,
      },
    ]);
  });

  it('an invalid IBAN is never automatic, also with a name payer: invalid-iban (user1, 15 Nov 2026)', () => {
    const named = {
      ...tx('x1', '2026-01-05'),
      counterparty: { iban: BAD_IBAN, name: 'Nome Inventato' },
    };
    const payers = [payer({ key: 'name:nome inventato' })];
    // Without the IBAN the name payer is enough.
    const plain = { ...named, counterparty: { name: 'Nome Inventato' } };
    expect(reconcileIncome(input({ payers, transactions: [plain] })).payments).toHaveLength(1);
    const result = reconcileIncome(input({ payers, transactions: [named] }));
    expect(result.payments).toEqual([]);
    expect(result.proposals).toEqual([
      {
        id: 'p-chi-x1',
        transactionId: 'x1',
        step: 'chi',
        reason: 'invalid-iban',
        tenantIds: ['t1'],
      },
    ]);
  });

  it('shuffled input gives the same result, and rerunning with the drafts adds nothing', () => {
    const tenancies = [
      tenancy({ id: 'ten1', to: '2026-03' }),
      tenancy({ id: 'ten2', from: '2026-04', room: 'B' }),
      tenancy({ id: 'ten3', tenantId: 't2', room: 'C' }),
    ];
    const payers = [payer(), payer({ id: 'pr2', key: `iban:${OTHER_IBAN}`, tenantId: 't2' })];
    const transactions = [
      tx('x1', '2026-01-05'),
      tx('x2', '2026-02-05', 50000),
      tx('x3', '2026-03-05'),
      tx('y1', '2026-01-06', 45000, OTHER_IBAN),
      tx('y2', '2026-02-06', 45000, OTHER_IBAN),
      tx('z1', '2026-02-07', 45000, ibanEndingWith('79')),
    ];
    const ordered = reconcileIncome(input({ tenancies, payers, transactions }));
    const shuffled = reconcileIncome(
      input({
        tenancies: [...tenancies].reverse(),
        payers: [...payers].reverse(),
        transactions: [
          transactions[4],
          transactions[0],
          transactions[5],
          transactions[2],
          transactions[1],
          transactions[3],
        ].filter((t): t is BankTransaction => t !== undefined),
      }),
    );
    expect(shuffled).toEqual(ordered);
    expect(ordered.payments.map((p) => p.id)).toEqual(['pay-x1', 'pay-y1', 'pay-y2']);
    expect(ordered.proposals.map((p) => [p.id, p.reason])).toEqual([
      ['p-chi-z1', 'new-payer'],
      ['p-cosa-x2', 'amount-differs'],
      ['p-cosa-x3', 'earlier-open'],
    ]);

    const again = reconcileIncome(
      input({
        tenancies,
        payers,
        transactions,
        payments: ordered.payments.map((p) => ({ ...p, v: 1 as const, rev: 1 })),
      }),
    );
    expect(again.payments).toEqual([]);
    expect(again.proposals).toEqual(ordered.proposals);
  });
});

describe('rentArrears (user1, 15 Nov 2026)', () => {
  it('lists the months covered in full, with a presence, without a live rent payment', () => {
    // Feb-Mar imported and reconciled first, January afterwards without a transfer (I2).
    const later = [statement({ from: '2026-02-01', to: '2026-03-31' })];
    const transactions = [tx('x2', '2026-02-03'), tx('x3', '2026-03-02')];
    const first = reconcileIncome(input({ statements: later, transactions }));
    expect(first.payments.map((p) => p.forMonth)).toEqual(['2026-02', '2026-03']);
    const payments = first.payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }));
    const all = [...later, statement({ id: 's0', from: '2026-01-01', to: '2026-01-31' })];
    expect(rentArrears(input({ statements: later, payments }))).toEqual([]);
    expect(rentArrears(input({ statements: all, payments }))).toEqual([
      { apartmentId: 'a1', tenantId: 't1', month: '2026-01' },
    ]);
    // Only a list: the automatic payments do not change.
    expect(reconcileIncome(input({ statements: all, transactions, payments })).payments).toEqual(
      [],
    );
  });

  it('a month refunded in full (a negative canone, B5 c) is an arrear again and not automatic', () => {
    const later = [statement({ from: '2026-02-01', to: '2026-03-31' })];
    const transactions = [tx('x2', '2026-02-03'), tx('x3', '2026-03-02')];
    const first = reconcileIncome(input({ statements: later, transactions }));
    const paid = first.payments.map((p) => ({ ...p, v: 1 as const, rev: 1 }));
    const feb = paid.find((p) => p.forMonth === '2026-02');
    if (feb === undefined) throw new Error('february');
    const refund = { ...feb, id: 'refund', amount: cents(-feb.amount), transactionId: 'out-1' };
    expect(rentArrears(input({ statements: later, payments: [...paid, refund] }))).toEqual([
      { apartmentId: 'a1', tenantId: 't1', month: '2026-02' },
    ]);
    // A new transfer of the full amount in February pays it automatically again.
    const again = reconcileIncome(
      input({
        statements: later,
        transactions: [...transactions, tx('x4', '2026-02-20')],
        payments: [...paid, refund],
      }),
    );
    expect(again.payments.map((p) => [p.transactionId, p.forMonth])).toEqual([['x4', '2026-02']]);
  });

  it('skips a tenant whose record is deleted, even with a live presence (user1, 15 Nov 2026)', () => {
    const tenants = [
      TenantSchema.parse({ ...base, id: 't1', name: 'Nome Inventato', rev: 2, deleted: true }),
      TenantSchema.parse({ ...base, id: 't2', name: 'Altro Nome' }),
    ];
    const tenancies = [tenancy({}), tenancy({ id: 'ten2', tenantId: 't2', room: 'B' })];
    const statements = [statement({ from: '2026-01-01', to: '2026-01-31' })];
    expect(rentArrears(input({ tenants, tenancies, statements }))).toEqual([
      { apartmentId: 'a1', tenantId: 't2', month: '2026-01' },
    ]);
  });

  it('skips partial months, deleted presences and statements, other rent, months outside a presence', () => {
    const result = rentArrears(
      input({
        tenancies: [
          tenancy({ to: '2026-02' }),
          tenancy({ id: 'ten2', tenantId: 't2', room: 'B', from: '2026-02' }),
          tenancy({ id: 'ten3', tenantId: 't3', room: 'C', deleted: true }),
          tenancy({ id: 'ten4', tenantId: 't4', apartmentId: 'a2', room: 'D' }),
        ],
        statements: [
          statement({ from: '2026-01-01', to: '2026-03-15' }),
          statement({ id: 's2', from: '2026-04-01', to: '2026-04-30', deleted: true }),
          statement({ id: 's3', accountId: 'c2', from: '2026-01-01', to: '2026-01-31' }),
        ],
        payments: [
          payment({ id: 'pm1', forMonth: '2026-01' }),
          payment({ id: 'pm2', tenantId: 't2', kind: 'altro', forMonth: '2026-02' }),
          payment({ id: 'pm3', tenantId: 't2', forMonth: '2026-02', apartmentId: 'a2' }),
          payment({ id: 'pm4', forMonth: '2026-02', deleted: true }),
          payment({ id: 'pm5', tenantId: 't4', apartmentId: 'a2', date: '2026-01-31' }),
        ],
      }),
    );
    expect(result).toEqual([
      { apartmentId: 'a1', tenantId: 't1', month: '2026-02' },
      { apartmentId: 'a1', tenantId: 't2', month: '2026-02' },
    ]);
  });
});
