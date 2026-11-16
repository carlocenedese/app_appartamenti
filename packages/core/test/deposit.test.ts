import { describe, expect, it } from 'vitest';
import {
  PaymentSchema,
  TenancySchema,
  commitChange,
  depositChecks,
  isoDate,
  loadContractStatus,
  loadDepositReturn,
  recordPath,
  recordSchemas,
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
  from: isoDate('2025-09-25'),
  to: isoDate('2026-02-28'),
  rates: [
    { year: 2025, rateBp: 200 },
    { year: 2026, rateBp: 200 },
  ],
  conguaglio: cents(4000),
  extraCharges: [{ label: 'Zanzariera', amount: cents(2500) }],
  ...extra,
});

describe('loadDepositReturn (plan 11, task 3)', () => {
  it('caparra, interest from the dates given, minus conguaglio and charges', async () => {
    const store = new MemoryStore();
    await seed(store, [
      ['tenancy', tenancy('t-anna')],
      ['payment', payment('p-anna')],
    ]);
    const before = await snapshot(store);
    // 500,00 € at 2% for October..February (5 whole months): 4,1666… → 4,17 €.
    expect(await loadDepositReturn(store, returnInput())).toEqual({
      status: 'computed',
      statement: {
        total: 50000 + 417 - 4000 - 2500,
        lines: [
          { label: 'Caparra', amount: 50000 },
          { label: 'Interessi legali', amount: 417 },
          { label: 'Conguaglio bollette', amount: -4000 },
          { label: 'Zanzariera', amount: -2500 },
        ],
      },
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refusals', async () => {
    const store = new MemoryStore();
    await seed(store, [
      ['tenancy', tenancy('t-anna')],
      ['tenancy', tenancy('t-bruno', { tenantId: 'ten-bruno', room: 'B' })],
      ['payment', payment('p-anna')],
      ['payment', payment('p-bruno', { tenantId: 'ten-bruno' })],
      ['payment', payment('p-bruno-back', { tenantId: 'ten-bruno', amount: -50000 })],
    ]);
    const reason = async (extra: Partial<DepositReturnInput>) =>
      ((await loadDepositReturn(store, returnInput(extra))) as { reason?: string }).reason;
    expect(await reason({ tenantId: 'ten-carla' })).toBe('no-deposit');
    expect(await reason({ tenantId: 'ten-bruno' })).toBe('already-returned');
    expect(await reason({ to: isoDate('2025-01-01') })).toBe('invalid-dates');
    expect(await reason({ rates: [{ year: 2025, rateBp: 200 }] })).toBe('missing-rate');
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
