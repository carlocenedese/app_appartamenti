// B5 (decided by user1 on 18 Nov 2026): rent paid in excess is flagged with the missing month it
// would cover; it moves only when a person confirms it. Invented data: one bed, rent 450,00 plus
// flat charge 30,00 a month; January paid 440,00, February 520,00.
import { describe, expect, it } from 'vitest';
import {
  ClosedPeriodError,
  PaymentSchema,
  checkConsistency,
  closePeriod,
  collectedForfait,
  commitChange,
  confirmRentExcess,
  loadAll,
  planIncome,
  recordPath,
  recordSchemas,
  rentExcesses,
  reopenPeriod,
  undoOperationCommand,
  UnreadableRecordsError,
  yearMonth,
} from '../src/index';
import type { Payment, RecordKind } from '../src/index';
import { apartment, payment, tenancy } from './helpers/conguaglio-builders';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const january = payment('t-a', '2026-01', 44000, { id: 'pay-jan', transactionId: 'tx-jan' });
const february = payment('t-a', '2026-02', 52000, { id: 'pay-feb', transactionId: 'tx-feb' });
const stay = tenancy('t-a', '2025-10', '2026-09');
const noCover = () => new Set<never>();

async function write(store: MemoryStore, kind: RecordKind, after: { id: string }) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, after.id), after: recordSchemas[kind].parse(after) }],
    },
    clock,
    ids(`s-${kind}-${after.id}`),
  );
}

async function excessStore(payments: Payment[] = [january, february]) {
  const store = new MemoryStore();
  await write(store, 'apartment', apartment({ posti: 1 }));
  await write(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' } as never);
  await write(store, 'tenancy', stay);
  for (const p of payments) await write(store, 'payment', p);
  return store;
}

const payments = async (store: MemoryStore) =>
  (await loadAll(store, 'payment', PaymentSchema, { includeDeleted: true })).records;

describe('rentExcesses (B5)', () => {
  it('flags the excess on its payment and proposes the oldest short month before it', () => {
    expect(
      rentExcesses({ tenancies: [stay], payments: [january, february], covered: noCover }),
    ).toEqual([
      {
        id: 'p-eccedenza-pay-feb',
        apartmentId: 'apt',
        tenantId: 't-a',
        paymentId: 'pay-feb',
        month: '2026-02',
        excess: 4000,
        proposedMonth: '2026-01',
        amount: 4000,
      },
    ]);
  });

  it('flags an excess with no month to cover; a month never paid counts only if covered', () => {
    const only = [february];
    expect(rentExcesses({ tenancies: [stay], payments: only, covered: noCover })).toEqual([
      expect.not.objectContaining({ proposedMonth: expect.anything() }),
    ]);
    const covered = () => new Set([yearMonth('2025-11')]);
    expect(rentExcesses({ tenancies: [stay], payments: only, covered })).toEqual([
      expect.objectContaining({ proposedMonth: '2025-11', amount: 4000 }),
    ]);
  });

  it('moves at most the shortfall, never the same shortfall twice, never a later month', () => {
    const small = payment('t-a', '2026-01', 47000, { id: 'pay-jan-small' });
    const march = payment('t-a', '2026-03', 50000, { id: 'pay-mar' });
    const april = payment('t-a', '2026-04', 40000, { id: 'pay-apr' });
    const found = rentExcesses({
      tenancies: [stay],
      payments: [small, february, march, april],
      covered: noCover,
    });
    expect(found.map((e) => [e.paymentId, e.excess, e.proposedMonth, e.amount])).toEqual([
      ['pay-feb', 4000, '2026-01', 1000],
      ['pay-mar', 2000, undefined, undefined],
    ]);
  });
});

describe('confirmRentExcess (B5)', () => {
  it('splits the payment: the movement total stays, January is paid in full; undo puts it back', async () => {
    const store = await excessStore();
    const plan = await planIncome(store);
    expect(plan.result.excesses.map((e) => e.id)).toEqual(['p-eccedenza-pay-feb']);
    const done = await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('x'));
    expect(done).toEqual({
      status: 'confirmed',
      operationId: 'x-1',
      paymentIds: ['pay-feb', 'pay-feb-2026-01'],
    });
    const all = await payments(store);
    expect(all.find((p) => p.id === 'pay-feb')).toMatchObject({ amount: 48000, rev: 2 });
    expect(all.find((p) => p.id === 'pay-feb-2026-01')).toMatchObject({
      amount: 4000,
      forMonth: '2026-01',
      transactionId: 'tx-feb',
      date: february.date,
      kind: 'canone',
    });
    const rows = collectedForfait({
      tenancies: [stay],
      payments: all,
      months: [yearMonth('2026-01'), yearMonth('2026-02')],
    });
    expect(rows.map((r) => [r.month, r.paid, r.forfaitCollected])).toEqual([
      ['2026-01', 48000, 3000],
      ['2026-02', 48000, 3000],
    ]);
    expect((await planIncome(store)).result.excesses).toEqual([]);

    await undoOperationCommand(store, 'x-1', { who: 'p1', clock, newId: ids('u') });
    const back = await payments(store);
    expect(back.find((p) => p.id === 'pay-feb')).toMatchObject({ amount: 52000 });
    expect(back.find((p) => p.id === 'pay-feb-2026-01')).toMatchObject({ deleted: true });
    expect((await planIncome(store)).result.excesses.map((e) => e.id)).toEqual([
      'p-eccedenza-pay-feb',
    ]);
    // Confirmed again after the undo: the deleted split comes back with a new rev.
    await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('y'));
    expect((await payments(store)).find((p) => p.id === 'pay-feb-2026-01')).toMatchObject({
      amount: 4000,
      rev: 3,
    });
  });

  it('moves the whole payment to the month when the excess is all of it', async () => {
    const extra = payment('t-a', '2026-02', 3000, { id: 'pay-feb-extra', date: february.date });
    const full = payment('t-a', '2026-02', 48000, { id: 'pay-feb-a', date: '2026-02-01' as never });
    const store = await excessStore([january, full, extra]);
    expect(
      await confirmRentExcess(store, 'p-eccedenza-pay-feb-extra', 'p1', clock, ids('x')),
    ).toMatchObject({ status: 'confirmed', paymentIds: ['pay-feb-extra'] });
    expect((await payments(store)).find((p) => p.id === 'pay-feb-extra')).toMatchObject({
      amount: 3000,
      forMonth: '2026-01',
    });
  });

  it('refuses, writing nothing, an unknown proposal and an excess with no month to cover', async () => {
    const store = await excessStore([february]);
    const before = await snapshot(store);
    expect(await confirmRentExcess(store, 'p-eccedenza-nessuno', 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'no-month-to-cover',
    });
    expect(await snapshot(store)).toEqual(before);
    // Not confirmed: still flagged.
    expect((await planIncome(store)).result.excesses).toHaveLength(1);
  });

  it('a fork (confirmed here, the payment changed on another computer) blocks the writes', async () => {
    const a = await excessStore();
    const b = new MemoryStore();
    for (const dir of [
      '_app/journal',
      ...Object.keys(recordSchemas).map((k) => `_app/dati/${k}`),
    ]) {
      for (const name of await a.list(dir))
        b.putRaw(`${dir}/${name}`, a.getRaw(`${dir}/${name}`) ?? '');
    }
    await confirmRentExcess(a, 'p-eccedenza-pay-feb', 'p1', clock, ids('x'));
    // The same confirmation on both computers writes the same records: no fork. Another change is.
    await commitChange(
      b,
      {
        profileId: 'p2',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          {
            path: recordPath('payment', february.id),
            before: february,
            after: { ...february, amount: 51000 },
          },
        ],
      },
      clock,
      ids('z'),
    );
    for (const name of await b.list('_app/journal')) {
      a.putRaw(`_app/journal/${name}`, b.getRaw(`_app/journal/${name}`) ?? '');
    }
    expect((await checkConsistency(a)).map((p) => p.reason)).toContain('forked');
    // The forked payment cannot be read until a version is chosen (`scegli-versione`).
    await expect(
      confirmRentExcess(a, 'p-eccedenza-pay-feb', 'p1', clock, ids('w')),
    ).rejects.toThrow(UnreadableRecordsError);
  });

  it('follows the closed-period guard: a closed month of the payment is refused (F5)', async () => {
    // The whole lease year 2025-26 paid and closed; then a payment of September 2026 with more.
    const months = Array.from({ length: 12 }, (_, i) => {
      const n = 2025 * 12 + 9 + i;
      return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
    });
    const store = await excessStore(months.map((m) => payment('t-a', m, 48000, { id: `p-${m}` })));
    await write(store, 'contract', {
      id: 'ctr',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      type: '1+1',
      start: '2025-10',
      end: '2026-09',
      settlement: 'annuale',
      tenancyIds: [stay.id],
    } as never);
    const query = { apartmentId: 'apt', periodLabel: '2025-26' };
    expect((await closePeriod(store, query, 'p1', clock, ids('c'))).status).toBe('closed');
    await reopenPeriod(
      store,
      { ...query, on: '2026-11-15', reason: 'prova' },
      'p1',
      clock,
      ids('r'),
    );
    // January short by 10,00 while reopened, then closed again (R364); September paid 10,00 more.
    const [jan] = (await payments(store)).filter((p) => p.id === 'p-2026-01');
    if (jan === undefined) throw new Error('january');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          { path: recordPath('payment', jan.id), before: jan, after: { ...jan, amount: 47000 } },
        ],
      },
      clock,
      ids('j'),
    );
    const [sep] = (await payments(store)).filter((p) => p.id === 'p-2026-09');
    if (sep === undefined) throw new Error('september');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          { path: recordPath('payment', sep.id), before: sep, after: { ...sep, amount: 49000 } },
        ],
      },
      clock,
      ids('k'),
    );
    expect((await closePeriod(store, query, 'p1', clock, ids('d'))).status).toBe('closed');
    const before = await snapshot(store);
    await expect(
      confirmRentExcess(store, 'p-eccedenza-p-2026-09', 'p1', clock, ids('x')),
    ).rejects.toThrow(ClosedPeriodError);
    expect(await snapshot(store)).toEqual(before);
  });
});
