import { describe, expect, it } from 'vitest';
import {
  PaymentSchema,
  TenancySchema,
  commitChange,
  continuousStays,
  depositChecks,
  loadContractStatus,
  loadDepositReturn,
  recordPath,
  recordSchemas,
  saveLegalRate,
  withheldRecoveries,
  yearMonth,
} from '../src/index';
import type { DepositReturnInput, RecordKind } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented names and amounts only (plan 11).
const base = { v: 1, rev: 1 };
const tenancy = (id: string, extra: Record<string, unknown> = {}) =>
  TenancySchema.parse({
    ...base,
    id,
    apartmentId: 'pulci',
    tenantId: 'ten-anna',
    room: 'A',
    from: '2025-10',
    to: '2026-09',
    monthlyRent: 35000,
    monthlyForfait: 3000,
    expectedDeposit: 50000,
    ...extra,
  });
const payment = (id: string, extra: Record<string, unknown> = {}) =>
  PaymentSchema.parse({
    ...base,
    id,
    apartmentId: 'pulci',
    tenantId: 'ten-anna',
    date: '2025-09-25',
    amount: 50000,
    confirmed: true,
    kind: 'caparra',
    source: 'manual',
    ...extra,
  });

describe('depositChecks (plan 11, task 3)', () => {
  it('one status per tenant and apartment', () => {
    const tenancies = [
      tenancy('t-anna'),
      tenancy('t-bruno', { tenantId: 'ten-bruno', room: 'B' }),
      tenancy('t-carla', { tenantId: 'ten-carla', room: 'C' }),
      tenancy('t-dario', { tenantId: 'ten-dario', room: 'D', expectedDeposit: undefined }),
      tenancy('t-del', { tenantId: 'ten-elena', deleted: true }),
    ];
    const payments = [
      payment('p-anna'),
      payment('p-anna-back', { amount: -50000, date: '2026-10-05' }),
      payment('p-bruno', { tenantId: 'ten-bruno', amount: 30000 }),
      payment('p-carla-unconfirmed', { tenantId: 'ten-carla', confirmed: false }),
      payment('p-carla-rent', { tenantId: 'ten-carla', kind: 'canone' }),
      payment('p-carla-del', { tenantId: 'ten-carla', deleted: true }),
      payment('p-carla-other', { tenantId: 'ten-carla', apartmentId: 'berchet' }),
    ];
    expect(depositChecks({ tenancies, payments })).toEqual([
      {
        apartmentId: 'pulci',
        tenantId: 'ten-anna',
        expected: 50000,
        paid: 50000,
        returned: 50000,
        status: 'versata',
      },
      {
        apartmentId: 'pulci',
        tenantId: 'ten-bruno',
        expected: 50000,
        paid: 30000,
        returned: 0,
        status: 'diversa',
      },
      {
        apartmentId: 'pulci',
        tenantId: 'ten-carla',
        expected: 50000,
        paid: 0,
        returned: 0,
        status: 'mancante',
      },
      {
        apartmentId: 'pulci',
        tenantId: 'ten-dario',
        paid: 0,
        returned: 0,
        status: 'non-impostata',
      },
    ]);
  });

  it('a renewal uses the expected deposit of the latest tenancy, and one deposit', () => {
    const tenancies = [
      tenancy('t-2', { from: '2026-10', to: '2027-09', expectedDeposit: 60000 }),
      tenancy('t-1'),
    ];
    expect(depositChecks({ tenancies, payments: [payment('p')] })).toEqual([
      {
        apartmentId: 'pulci',
        tenantId: 'ten-anna',
        expected: 60000,
        paid: 50000,
        returned: 0,
        status: 'diversa',
      },
    ]);
  });
});

async function seed(
  store: MemoryStore,
  records: [RecordKind, Record<string, unknown> & { id: string }][],
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'Dati di prova.',
      changes: records.map(([kind, r]) => ({
        path: recordPath(kind, r.id),
        after: recordSchemas[kind].parse(r),
      })),
    },
    clock,
    ids(`s${String(records.length)}`),
  );
}

const returnInput = (extra: Partial<DepositReturnInput> = {}): DepositReturnInput => ({
  apartmentId: 'pulci',
  tenantId: 'ten-anna',
  extraCharges: [{ label: 'Zanzariera', amount: cents(2500) }],
  ...extra,
});

// Plan 17 (R301, R302): rates from the store, dates from the stay, conguaglio from the settlement.
const apartmentRecord = {
  ...base,
  id: 'pulci',
  name: 'pulci',
  locatore: 'user2',
  posti: 2,
  annualitaStart: { month: 10, day: 1 },
};
const contractRecord = (id: string, start: string, end: string, tenancyIds: string[]) => ({
  ...base,
  id,
  apartmentId: 'pulci',
  type: '1+1',
  start,
  end,
  settlement: 'annuale',
  tenancyIds,
});
const rate = (year: string) => ({ ...base, id: `tasso-${year}`, year, rateBp: 200 });
async function depositStore(extra: [RecordKind, Record<string, unknown> & { id: string }][] = []) {
  const store = new MemoryStore();
  await seed(store, [
    ['apartment', apartmentRecord],
    ['contract', contractRecord('ctr-1', '2025-10', '2026-09', ['t-anna'])],
    ['tenancy', tenancy('t-anna', { to: '2026-02' })],
    ['payment', payment('p-anna')],
    ['legalRate', rate('2025')],
    ['legalRate', rate('2026')],
    ...extra,
  ]);
  return store;
}

describe('loadDepositReturn (plan 11, task 3; plan 17, R302)', () => {
  it('interest from entry to exit, conguaglio of the exit period and what is paid apart', async () => {
    const store = await depositStore([
      [
        'bill',
        {
          ...base,
          id: 'luce',
          apartmentId: 'pulci',
          supplier: 'Luce',
          category: 'elettricita',
          periodStart: '2025-10-01',
          periodEnd: '2025-10-31',
          amount: 4000,
          includedInConguaglio: true,
          sharedWithTenants: true,
          filePath: 'luce.pdf',
          fileHash: 'h-luce',
        },
      ],
      [
        'match',
        {
          ...base,
          id: 'm-luce',
          itemType: 'bill',
          itemId: 'luce',
          transactionId: 'tx-luce',
          transactionDate: '2025-11-03',
          amount: 4000,
          part: 'amount',
          confirmed: true,
          by: 'manual',
        },
      ],
      [
        'payment',
        payment('p-cong', {
          kind: 'conguaglio',
          amount: 500,
          date: '2026-03-01',
          forMonth: '2026-01',
        }),
      ],
    ]);
    const before = await snapshot(store);
    // 500,00 € at 2% for October 2025..February 2026 (5 whole months): 4,1666… → 4,17 €. The bill
    // goes half to Anna (two beds): 20,00 €; the 5,00 € already paid on a line of its own.
    expect(await loadDepositReturn(store, returnInput())).toEqual({
      status: 'computed',
      statement: {
        total: 50000 + 417 - 2000 + 500 - 2500,
        lines: [
          { label: 'Caparra', amount: 50000 },
          { label: 'Interessi legali', amount: 417 },
          { label: 'Conguaglio bollette', amount: -2000 },
          { label: 'Conguaglio già versato', amount: 500 },
          { label: 'Zanzariera', amount: -2500 },
        ],
      },
      recoveriesWaiting: 0,
    });
    const typed = await loadDepositReturn(store, returnInput({ conguaglio: cents(4000) }));
    expect(typed.status === 'computed' && typed.statement.lines[2]?.amount).toBe(-4000);
    expect(await snapshot(store)).toEqual(before);
  });

  it('a renewal keeps the deposit: interest over the whole continuous stay, more payments too', async () => {
    const store = await depositStore([
      ['tenancy', tenancy('t-anna-2', { from: '2026-03', to: '2026-09' })],
      ['payment', payment('p-anna-2', { amount: 10000, date: '2026-03-01' })],
    ]);
    // 600,00 € at 2% for 12 months: 12,00 €.
    const result = await loadDepositReturn(store, returnInput({ conguaglio: cents(0) }));
    expect(result.status === 'computed' && result.statement.lines.slice(0, 2)).toEqual([
      { label: 'Caparra', amount: 60000 },
      { label: 'Interessi legali', amount: 1200 },
    ]);
  });

  it('refuses, until user1 answers, a partial return and several separate stays (R302)', async () => {
    const partial = await depositStore([
      ['payment', payment('p-back', { amount: -20000, date: '2026-03-05' })],
    ]);
    expect(await loadDepositReturn(partial, returnInput({ conguaglio: cents(0) }))).toEqual({
      status: 'refused',
      reason: 'partial-return',
    });
    const twice = await depositStore([
      ['tenancy', tenancy('t-anna-2', { from: '2026-06', to: '2026-08' })],
    ]);
    expect(await loadDepositReturn(twice, returnInput({ conguaglio: cents(0) }))).toEqual({
      status: 'refused',
      reason: 'several-stays',
    });
  });

  it('keeps from the deposit a recovery of a tenant gone from the period of the expense', async () => {
    const recovery = (id: string, extra: Record<string, unknown>) => ({
      ...base,
      id,
      apartmentId: 'pulci',
      transactionId: 'tx-x',
      amount: 1500,
      shares: [{ tenantId: 'ten-anna', amount: 1500 }],
      status: 'da-recuperare',
      // Its period (`settlementPeriodOf`, R177) is 2026-27, where Anna is not.
      date: '2027-11-15',
      ...extra,
    });
    const store = await depositStore([
      ['contract', contractRecord('ctr-2', '2026-10', '2028-09', [])],
      [
        'transaction',
        {
          ...base,
          id: 'tx-x',
          apartmentId: 'pulci',
          date: '2026-10-15',
          amount: -1500,
          description: 'Fornitore',
          statementHash: 'h',
        },
      ],
      [
        'movementClass',
        { ...base, id: 'mc-tx-x', transactionId: 'tx-x', kind: 'altro', apartmentId: 'pulci' },
      ],
      [
        'instalment',
        {
          ...base,
          id: 'str-1',
          apartmentId: 'pulci',
          kind: 'condominio',
          esercizio: '2026-27',
          rateIndex: 1,
          rateCount: 1,
          dueDate: '2026-10-20',
          rata: 3000,
          quotaProprieta: 0,
          conguaglioPrec: 0,
          coversFrom: '2026-10',
          coversTo: '2026-10',
          straordinaria: true,
        },
      ],
      // No statement covers its debit: taken as paid (R2), so it is in.
      ['tenantRecovery', recovery('rec-6', { transactionId: undefined, instalmentId: 'str-1' })],
      // A movement that is no expense of the apartment: never counted.
      ['tenantRecovery', recovery('rec-7', { transactionId: 'tx-nessuno' })],
      ['tenantRecovery', recovery('rec-1', {})],
      ['tenantRecovery', recovery('rec-2', { status: 'non-recuperabile' })],
      ['tenantRecovery', recovery('rec-3', { periodLabel: '2026-27' })],
      // In a period where she was there: in that conguaglio, not here.
      ['tenantRecovery', recovery('rec-4', { date: '2026-01-15' })],
      [
        'tenantRecovery',
        recovery('rec-5', {
          transactionId: undefined,
          amount: -700,
          shares: [{ tenantId: 'ten-anna', amount: -700 }],
        }),
      ],
    ]);
    const result = await loadDepositReturn(store, returnInput({ conguaglio: cents(0) }));
    expect(result.status === 'computed' && result.statement.lines.slice(3, 6)).toEqual([
      { label: 'Recupero rec-1', amount: -1500 },
      { label: 'Recupero rec-5', amount: 700 },
      { label: 'Recupero rec-6', amount: -1500 },
    ]);
    // rec-7: the movement is no expense of the apartment.
    expect(result.status === 'computed' && result.statement.lines).toHaveLength(7);
    expect(result.status === 'computed' && result.recoveriesWaiting).toBe(0);
  });

  it('refusals', async () => {
    const store = await depositStore([
      ['tenancy', tenancy('t-bruno', { tenantId: 'ten-bruno', room: 'B', to: '2026-02' })],
      [
        'tenancy',
        tenancy('t-carla', { tenantId: 'ten-carla', room: 'B', from: '2026-03', to: undefined }),
      ],
      ['payment', payment('p-bruno', { tenantId: 'ten-bruno' })],
      ['payment', payment('p-bruno-back', { tenantId: 'ten-bruno', amount: -50000 })],
      ['payment', payment('p-carla', { tenantId: 'ten-carla' })],
      [
        'tenancy',
        tenancy('t-dario', { tenantId: 'ten-dario', room: 'B', from: '2027-01', to: '2027-02' }),
      ],
      ['payment', payment('p-dario', { tenantId: 'ten-dario' })],
    ]);
    const reason = async (extra: Partial<DepositReturnInput>) =>
      ((await loadDepositReturn(store, returnInput(extra))) as { reason?: string }).reason;
    expect(await reason({ tenantId: 'ten-elena' })).toBe('no-deposit');
    expect(await reason({ tenantId: 'ten-bruno' })).toBe('already-returned');
    expect(await reason({ tenantId: 'ten-carla' })).toBe('no-exit');
    expect(await reason({ tenantId: 'ten-dario' })).toBe('missing-rate');
    await seed(store, [['legalRate', rate('2027')]]);
    expect(await reason({ tenantId: 'ten-dario' })).toBe('no-period');
    // A conguaglio typed by user1 needs no settlement period.
    const typed = await loadDepositReturn(
      store,
      returnInput({ tenantId: 'ten-dario', conguaglio: cents(0) }),
    );
    expect(typed.status).toBe('computed');
  });
});

describe('saveLegalRate (plan 17, R301)', () => {
  it('saves, then unchanged, then replaced; refuses a bad year', async () => {
    const store = new MemoryStore();
    const save = (year: string, rateBp: number, prefix: string) =>
      saveLegalRate(store, { year, rateBp }, 'p1', clock, ids(prefix));
    expect(await save('2026', 160, 'a')).toEqual({
      status: 'saved',
      operationId: 'a-1',
      rateId: 'tasso-2026',
    });
    expect(await save('2026', 160, 'b')).toEqual({ status: 'unchanged', rateId: 'tasso-2026' });
    expect(await save('2026', 250, 'c')).toMatchObject({ status: 'saved' });
    expect(await save('26', 250, 'd')).toEqual({ status: 'refused', reason: 'invalid-rate' });
    expect(await save('2027', -1, 'e')).toEqual({ status: 'refused', reason: 'invalid-rate' });
  });
});

describe('continuousStays (plan 17, R302)', () => {
  it('joins tenancies one month apart or overlapping, and keeps an open end open', () => {
    expect(
      continuousStays([
        tenancy('a', { from: '2025-10', to: '2026-02' }),
        tenancy('b', { from: '2026-03', to: '2026-09' }),
        tenancy('c', { from: '2026-11', to: undefined }),
        tenancy('d', { from: '2027-01', to: '2027-03' }),
        tenancy('e', { from: '2024-01', to: '2024-02', deleted: true }),
      ]),
    ).toEqual([{ from: '2025-10', to: '2026-09' }, { from: '2026-11' }]);
  });
});

describe('loadContractStatus (plan 11, task 3)', () => {
  it('tenancies with their state, takeovers, deposits and checks of each contract', async () => {
    const store = new MemoryStore();
    await seed(store, [
      [
        'apartment',
        {
          ...base,
          id: 'pulci',
          name: 'pulci',
          locatore: 'user2',
          posti: 2,
          annualitaStart: { month: 10, day: 1 },
        },
      ],
      ['tenancy', tenancy('t-anna', { to: '2026-02' })],
      ['tenancy', tenancy('t-bruno', { tenantId: 'ten-bruno', from: '2026-03' })],
      [
        'tenancy',
        tenancy('t-carla', { tenantId: 'ten-carla', room: 'B', from: '2027-01', to: undefined }),
      ],
      ['payment', payment('p-anna')],
      [
        'contract',
        {
          ...base,
          id: 'ctr-pulci',
          apartmentId: 'pulci',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
          tenancyIds: ['t-anna', 't-bruno', 't-carla'],
          takeovers: [{ month: '2026-03', outTenancyId: 't-anna', inTenancyId: 't-bruno' }],
        },
      ],
    ]);
    const result = await loadContractStatus(store, { asOf: yearMonth('2026-04') });
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') return;
    const [status] = result.contracts;
    expect(status?.tenancies.map((t) => [t.tenancy.id, t.state])).toEqual([
      ['t-anna', 'uscita'],
      ['t-bruno', 'in-corso'],
      ['t-carla', 'futura'],
    ]);
    expect(status?.contract.takeovers).toHaveLength(1);
    expect(status?.deposits.map((d) => [d.tenantId, d.status])).toEqual([
      ['ten-anna', 'versata'],
      ['ten-bruno', 'mancante'],
      ['ten-carla', 'mancante'],
    ]);
    expect(status?.checks.map((c) => c.code)).toEqual(['tenancy-outside-contract']);
  });
});

describe('withheldRecoveries (plan 17, R300)', () => {
  it('counts as waiting a recovery whose instalment is not paid yet', () => {
    const r = recordSchemas.tenantRecovery.parse({
      ...base,
      id: 'rec-w',
      apartmentId: 'pulci',
      instalmentId: 'str-1',
      amount: 1000,
      shares: [{ tenantId: 'ten-anna', amount: 1000 }],
      status: 'da-recuperare',
      date: '2027-01-10',
    });
    const input = {
      recoveries: [r],
      tenantId: 'ten-anna',
      tenancies: [tenancy('t-anna', { to: '2026-02' })],
      periods: [],
      recoverableMovements: new Set<string>(),
    };
    expect(withheldRecoveries({ ...input, paidInstalments: new Set() })).toEqual({
      withheld: [],
      waiting: 1,
    });
    expect(withheldRecoveries({ ...input, paidInstalments: new Set(['str-1']) })).toEqual({
      withheld: [{ label: 'Recupero rec-w', amount: 1000 }],
      waiting: 0,
    });
  });
});
