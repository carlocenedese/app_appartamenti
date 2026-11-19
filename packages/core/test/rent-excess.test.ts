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
  loadPeriodClosing,
  loadRentExcesses,
  planIncome,
  recordPath,
  recordSchemas,
  rentExcesses,
  reopenPeriod,
  undoOperationCommand,
  UnreadableRecordsError,
  isoDate,
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

async function excessStore(payments: Payment[] = [january, february], presence = stay) {
  const store = new MemoryStore();
  await write(store, 'apartment', apartment({ posti: 1 }));
  await write(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' } as never);
  await write(store, 'tenancy', presence);
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
        targets: [{ month: '2026-01', amount: 4000 }],
        credit: 0,
      },
    ]);
  });

  it('a month never paid before counts only if covered; else the next month (an advance)', () => {
    const only = [february];
    expect(
      rentExcesses({ tenancies: [stay], payments: only, covered: noCover })[0]?.targets,
    ).toEqual([{ month: '2026-03', amount: 4000 }]);
    const covered = () => new Set([yearMonth('2025-11')]);
    expect(rentExcesses({ tenancies: [stay], payments: only, covered })[0]?.targets).toEqual([
      { month: '2025-11', amount: 4000 },
    ]);
  });

  it('several months at once, earlier first then later; never the same shortfall twice', () => {
    const small = payment('t-a', '2026-01', 47000, { id: 'pay-jan-small' });
    const big = payment('t-a', '2026-02', 60000, { id: 'pay-feb-big' });
    const march = payment('t-a', '2026-03', 50000, { id: 'pay-mar' });
    const april = payment('t-a', '2026-04', 40000, { id: 'pay-apr' });
    const found = rentExcesses({
      tenancies: [stay],
      payments: [small, big, march, april],
      covered: noCover,
    });
    expect(found.map((e) => [e.paymentId, e.excess, e.targets, e.credit])).toEqual([
      [
        'pay-feb-big',
        12000,
        [
          { month: '2026-01', amount: 1000 },
          { month: '2026-04', amount: 8000 },
          { month: '2026-05', amount: 3000 },
        ],
        0,
      ],
      ['pay-mar', 2000, [{ month: '2026-05', amount: 2000 }], 0],
    ]);
  });

  it('an excess in the last month with nothing short is a credit to give back', () => {
    const last = payment('t-a', '2026-09', 52000, { id: 'pay-sep' });
    expect(rentExcesses({ tenancies: [stay], payments: [last], covered: noCover })).toEqual([
      expect.objectContaining({ excess: 4000, targets: [], credit: 4000 }),
    ]);
  });

  it('takes the latest payment of a positive amount, at most its amount', () => {
    const fix = payment('t-a', '2026-02', -1000, { id: 'pay-z-fix', date: '2026-02-28' as never });
    const two = payment('t-a', '2026-02', 3000, { id: 'pay-feb-2', date: '2026-02-20' as never });
    const found = rentExcesses({
      tenancies: [stay],
      payments: [january, payment('t-a', '2026-02', 52000, { id: 'pay-feb-1' }), two, fix],
      covered: noCover,
    });
    // 520 + 30 − 10 = 540 against 480: 60 of excess, at most the 30 of pay-feb-2.
    expect(found.map((e) => [e.paymentId, e.excess, e.targets, e.credit])).toEqual([
      ['pay-feb-2', 6000, [{ month: '2026-01', amount: 3000 }], 3000],
    ]);
  });
});

describe('confirmRentExcess (B5)', () => {
  it('C1: a second confirmation for the same payment and month adds to it, no money lost', async () => {
    // The stay ends in February: no later month to take the rest.
    const store = await excessStore([], tenancy('t-a', '2025-10', '2026-02'));
    const jan = payment('t-a', '2026-01', 44000, { id: 'pay-jan', transactionId: 'tx-jan' });
    const feb = payment('t-a', '2026-02', 60000, { id: 'pay-feb', transactionId: 'tx-feb' });
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'income.confirm',
        summary: 'x',
        changes: [{ path: recordPath('payment', jan.id), after: recordSchemas.payment.parse(jan) }],
      },
      clock,
      ids('cj'),
    );
    await write(store, 'payment', feb);
    const ofFeb = async () =>
      (await payments(store))
        .filter((p) => p.deleted !== true && p.transactionId === 'tx-feb')
        .map((p) => [p.id, p.amount, p.forMonth]);
    // 120,00 more in February: 40,00 to January, 80,00 left as a credit.
    await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('x'));
    expect(await ofFeb()).toEqual([
      ['pay-feb', 56000, '2026-02'],
      ['pay-feb-2026-01', 4000, '2026-01'],
    ]);
    // January's own payment is undone: January is short again and the 80,00 go to it too.
    await undoOperationCommand(store, 'cj-1', { who: 'p1', clock, newId: ids('u') });
    expect((await planIncome(store)).result.excesses.map((e) => e.targets)).toEqual([
      [{ month: '2026-01', amount: 8000 }],
    ]);
    await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('y'));
    // The movement still holds 600,00 (the review's case lost 40,00 here).
    expect(await ofFeb()).toEqual([
      ['pay-feb', 48000, '2026-02'],
      ['pay-feb-2026-01', 12000, '2026-01'],
    ]);
    // Undoing the first confirmation while the second stands is refused: the second builds on it.
    await expect(
      undoOperationCommand(store, 'x-1', { who: 'p1', clock, newId: ids('v') }),
    ).rejects.toMatchObject({ reason: 'has-dependents' });
  });

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

  it('a chain of advances keeps the total of every movement', async () => {
    const store = await excessStore([february]);
    await confirmRentExcess(store, 'p-eccedenza-pay-feb', 'p1', clock, ids('x'));
    // March's own transfer arrives: March now has 40,00 more, an advance to April.
    await write(
      store,
      'payment',
      payment('t-a', '2026-03', 48000, { id: 'pay-mar', transactionId: 'tx-mar' }),
    );
    const next = (await planIncome(store)).result.excesses;
    expect(next.map((e) => [e.month, e.targets])).toEqual([
      ['2026-03', [{ month: '2026-04', amount: 4000 }]],
    ]);
    await confirmRentExcess(store, next[0]?.id ?? '', 'p1', clock, ids('y'));
    const byTx = new Map<string, number>();
    for (const p of await payments(store)) {
      if (p.deleted === true || p.transactionId === undefined) continue;
      byTx.set(p.transactionId, (byTx.get(p.transactionId) ?? 0) + p.amount);
    }
    expect(Object.fromEntries(byTx)).toEqual({ 'tx-feb': 52000, 'tx-mar': 48000 });
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
    const store = await excessStore([payment('t-a', '2026-09', 52000, { id: 'pay-sep' })]);
    const before = await snapshot(store);
    expect(await confirmRentExcess(store, 'p-eccedenza-nessuno', 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'unknown-proposal',
    });
    expect(await confirmRentExcess(store, 'p-eccedenza-pay-sep', 'p1', clock, ids('x'))).toEqual({
      status: 'refused',
      reason: 'no-month-to-cover',
    });
    expect(await snapshot(store)).toEqual(before);
    // Not confirmed: still flagged, as a credit.
    expect((await planIncome(store)).result.excesses).toEqual([
      expect.objectContaining({ targets: [], credit: 4000 }),
    ]);
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

  it('R391: an excess in an open period may cover a month of a closed period', async () => {
    // The whole lease year 2025-26 paid and closed; then a payment of September 2026 with more.
    const months = Array.from({ length: 12 }, (_, i) => {
      const n = 2025 * 12 + 9 + i;
      return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
    });
    const longStay = tenancy('t-a', '2025-10', '2027-09');
    const store = await excessStore(
      months.map((m) => payment('t-a', m, 48000, { id: `p-${m}` })),
      longStay,
    );
    await write(store, 'contract', {
      id: 'ctr',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      type: '1+1',
      start: '2025-10',
      end: '2027-09',
      settlement: 'annuale',
      tenancyIds: [longStay.id],
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
    expect((await closePeriod(store, query, 'p1', clock, ids('d'))).status).toBe('closed');
    // October 2026 (open period 2026-27) paid 10,00 more: it proposes January 2026 (closed).
    await write(store, 'payment', payment('t-a', '2026-10', 49000, { id: 'p-2026-10' }));
    expect((await planIncome(store)).result.excesses).toEqual([
      expect.objectContaining({ targets: [{ month: '2026-01', amount: 1000 }], credit: 0 }),
    ]);
    const row = async () => {
      const closing = await loadPeriodClosing(store, query, isoDate('2026-12-31'));
      if (closing.status !== 'closed') throw new Error(closing.status);
      const [t] = closing.tenants;
      return t === undefined
        ? undefined
        : {
            forfaitPaid: t.forfaitPaid,
            toCheck: t.toCheck,
            total: t.total,
            mainRemaining: t.mainRemaining,
          };
    };
    const before = await row();
    const result = await confirmRentExcess(store, 'p-eccedenza-p-2026-10', 'p1', clock, ids('x'));
    expect(result).toMatchObject({ status: 'confirmed' });
    // B5 (a), decided by user1 on 19 Nov 2026: the 10,00 now in January is a line of the
    // supplementary settlement of 2025-26 (a credit), not the flat charge of the month.
    expect(await row()).toEqual({ ...before, total: (before?.total ?? 0) - 1000 });
    const closing = await loadPeriodClosing(store, query, isoDate('2026-12-31'));
    expect(closing).toMatchObject({
      tenants: [{ excessMoved: 1000, action: 'da-rimborsare' }],
    });
  });
});

describe('B5 at the closing (c, d)', () => {
  const months = Array.from({ length: 12 }, (_, i) => {
    const n = 2025 * 12 + 9 + i;
    return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
  });
  const query = { apartmentId: 'apt', periodLabel: '2025-26' };
  async function yearPaid(presence: ReturnType<typeof tenancy>, end: string) {
    const store = await excessStore(
      months.map((m) => payment('t-a', m, m === '2026-09' ? 52000 : 48000, { id: `p-${m}` })),
      presence,
    );
    await write(store, 'contract', {
      id: 'ctr',
      v: 1,
      rev: 1,
      apartmentId: 'apt',
      type: '1+1',
      start: '2025-10',
      end,
      settlement: 'annuale',
      tenancyIds: [presence.id],
    } as never);
    return store;
  }

  it('d: an open proposal does not block the closing, it gives a warning', async () => {
    const store = await yearPaid(tenancy('t-a', '2025-10', '2027-09'), '2027-09');
    expect(await closePeriod(store, query, 'p1', clock, ids('c'))).toMatchObject({
      status: 'closed',
      rentExcesses: ['p-eccedenza-p-2026-09'],
    });
  });

  it('c: an excess that covers no month is a credit to give back on the closing row', async () => {
    const store = await yearPaid(stay, '2026-09');
    const closed = await closePeriod(store, query, 'p1', clock, ids('c'));
    expect(closed).toMatchObject({ status: 'closed' });
    expect(closed).not.toHaveProperty('rentExcesses');
    const closing = await loadPeriodClosing(store, query, isoDate('2026-12-31'));
    expect(closing).toMatchObject({ tenants: [{ tenantId: 't-a', rentCredit: 4000, total: 0 }] });
  });

  it('c (G2-I3): a refund recorded with uscita-inquilino closes the credit, never paid twice', async () => {
    const store = await yearPaid(stay, '2026-09');
    await write(
      store,
      'payment',
      payment('t-a', '2026-10', -4000, {
        id: 'refund',
        kind: 'altro',
        forMonth: undefined,
        date: '2026-10-20' as never,
      }),
    );
    expect(await closePeriod(store, query, 'p1', clock, ids('c'))).toMatchObject({
      status: 'closed',
    });
    expect((await loadRentExcesses(store))[0]).toMatchObject({ credit: 0 });
    const closing = await loadPeriodClosing(store, query, isoDate('2026-12-31'));
    expect(closing).toMatchObject({ tenants: [{ tenantId: 't-a', rentCredit: 0 }] });
  });
});
