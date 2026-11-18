// B4, F10 (decided by user1 on 18 Nov 2026): the deposit statement keeps, one labelled line each,
// the settlement of an older closed period not marked settled and the supplementary settlement of
// a closed period; a deposit already returned flags them «da richiedere». Invented data: a one-bed
// apartment, flat charge 30,00 a month (360,00 a year), deposit 500,00.
import { describe, expect, it } from 'vitest';
import {
  PaymentSchema,
  PeriodCloseSchema,
  buildOwnersWorkbook,
  closePeriod,
  commitChange,
  loadAll,
  loadDashboard,
  loadDepositReturn,
  loadExcelInput,
  loadPeriodClosing,
  markPeriodSent,
  markTenantSettled,
  recordPath,
  reopenPeriod,
  saveLegalRate,
  tenantBalance,
} from '../src/index';
import type { PeriodClose, RecordKind } from '../src/index';
import { isoDate } from '../src/period';
import { apartment, bill, match, payment, tenancy } from './helpers/conguaglio-builders';
import { clock, ids } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

const later = () => '2027-05-02T09:00:00.000Z';
const QUERY = { apartmentId: 'apt', periodLabel: '2025-26' };
const depositBack = (date: string) => ({
  id: 'dep-back',
  v: 1,
  rev: 1,
  apartmentId: 'apt',
  tenantId: 't-a',
  date,
  amount: -50000,
  confirmed: true,
  kind: 'caparra',
  source: 'manual',
});

const months = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const [y, m] = from.split('-').map(Number) as [number, number];
    const n = y * 12 + m - 1 + i;
    return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
  });

async function put(
  store: MemoryStore,
  kind: RecordKind,
  record: { id: string } & Record<string, unknown>,
  when: () => string = clock,
) {
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [{ path: recordPath(kind, record.id), after: record }],
    },
    when,
    ids(`seed-${kind}-${record.id}`),
  );
}

/** Tenant t-a from October 2025 to `exit`; the 2025-26 bill gives a debt of `debt` cents. */
async function setUp(exit: string, debt: number, contractEnd = '2027-09', close = true) {
  const store = new MemoryStore();
  await put(store, 'apartment', apartment({ posti: 1 }));
  await put(store, 'contract', {
    id: 'ctr',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    type: '1+1',
    start: '2025-10',
    end: contractEnd,
    settlement: 'annuale',
  });
  await put(store, 'tenancy', tenancy('t-a', '2025-10', exit));
  await put(store, 'tenant', { id: 't-a', v: 1, rev: 1, name: 'Nome Inventato' });
  const presentIn2025 = months('2025-10', 12).filter((m) => m <= exit);
  const year = bill('b-anno', '2025-10-01', '2026-06-30', presentIn2025.length * 3000 + debt);
  await put(store, 'bill', year);
  await put(store, 'match', match(year, year.amount));
  for (const m of months('2025-10', 18).filter((x) => x <= exit)) {
    await put(store, 'payment', payment('t-a', m, 48000));
  }
  await put(store, 'payment', {
    id: 'dep',
    v: 1,
    rev: 1,
    apartmentId: 'apt',
    tenantId: 't-a',
    date: '2025-09-25',
    amount: 50000,
    confirmed: true,
    kind: 'caparra',
    source: 'manual',
  });
  for (const y of ['2025', '2026', '2027']) {
    await saveLegalRate(store, { year: y, rateBp: 200 }, 'p1', clock, ids(`rate-${y}`));
  }
  if (!close) return store;
  expect(
    (
      await closePeriod(
        store,
        { apartmentId: 'apt', periodLabel: '2025-26' },
        'p1',
        clock,
        ids('c'),
      )
    ).status,
  ).toBe('closed');
  return store;
}

const statement = async (store: MemoryStore) => {
  const r = await loadDepositReturn(store, {
    apartmentId: 'apt',
    tenantId: 't-a',
    extraCharges: [],
  });
  if (r.status !== 'computed') throw new Error(r.reason);
  return r.statement.lines;
};

/** Fourth round: closing 2 of a reopened period, with 30,00 of the May flat charge missing. */
const reclosed = async () => {
  const store = await setUp('2026-08', 0, '2026-09');
  await reopenPeriod(
    store,
    { ...QUERY, on: '2026-11-20', reason: 'Forfait di maggio' },
    'p1',
    later,
    ids('r'),
  );
  const may = (await loadAll(store, 'payment', PaymentSchema)).records.find(
    (p) => p.forMonth === '2026-05',
  );
  if (may === undefined) throw new Error('payment');
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'test.seed',
      summary: 'x',
      changes: [
        { path: recordPath('payment', may.id), before: may, after: { ...may, amount: 45000 } },
      ],
    },
    later,
    ids('fix'),
  );
  expect((await closePeriod(store, QUERY, 'p1', later, ids('c2'))).status).toBe('closed');
  return store;
};
const paysLate = (store: MemoryStore, amount = 3000) =>
  put(
    store,
    'payment',
    payment('t-a', '2026-05', amount, { id: 'pay-late', date: isoDate('2026-12-05') }),
    later,
  );

describe('deposit statement and closed periods (B4, F10)', () => {
  it('an older closed period not marked settled is withheld on its own line', async () => {
    // The tenant leaves in March 2027 with 120,00 of the 2025-26 settlement unpaid.
    const store = await setUp('2027-03', 12000);
    const lines = await statement(store);
    expect(lines).toContainEqual({ label: 'Conguaglio 2025-26 non saldato', amount: -12000 });
    // Marked settled by user1: no line any more.
    await markTenantSettled(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('s'),
    );
    expect((await statement(store)).map((l) => l.label)).not.toContain(
      'Conguaglio 2025-26 non saldato',
    );
  });

  it('finding 6: a closing written without inputs (an older app) still gives the statement', async () => {
    const store = await setUp('2027-03', 12000);
    const close = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0];
    if (close === undefined) throw new Error('close');
    // Through the journal, so the folder stays consistent.
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          {
            path: recordPath('periodClose', close.id),
            before: close,
            after: { ...close, inputs: undefined },
          },
        ],
      },
      later,
      ids('old'),
    );
    expect(
      (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0]?.inputs,
    ).toBeUndefined();
    expect(await statement(store)).toContainEqual({
      label: 'Conguaglio 2025-26 non saldato',
      amount: -12000,
    });
  });

  it('C: the whole due is withheld until marked settled, payments do not offset it; a credit is added', async () => {
    const store = await setUp('2027-03', 12000);
    await put(
      store,
      'payment',
      payment('t-a', '2026-09', 4000, { kind: 'conguaglio', date: isoDate('2026-11-15') }),
      later,
    );
    const lines = await statement(store);
    expect(lines).toContainEqual({ label: 'Conguaglio 2025-26 non saldato', amount: -12000 });
    expect(lines.map((l) => l.label)).not.toContain('Conguaglio 2025-26 già versato');
    const credit = await setUp('2027-03', -5000);
    expect(await statement(credit)).toContainEqual({
      label: 'Conguaglio 2025-26 non saldato',
      amount: 5000,
    });
  });

  it('the supplementary of the closed exit period is one line of its own, also when settled', async () => {
    // The tenant left in August 2026, the period is closed; a late bill of 12,00 for July.
    const store = await setUp('2026-08', 0, '2026-09');
    const late = bill('b-tardiva', '2026-07-01', '2026-07-31', 1200, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late, later);
    await put(store, 'match', match(late, 1200), later);
    const supplementary = { label: 'Conguaglio supplementare 2025-26', amount: -1200 };
    const before = await statement(store);
    expect(before.filter((l) => l.label.includes('supplementare'))).toEqual([supplementary]);
    // Nothing was due at the closing; the conguaglio line is that, never today's 12,00 again.
    expect(before).toContainEqual({ label: 'Conguaglio bollette', amount: 0 });
    await markTenantSettled(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', tenantId: 't-a', on: '2026-10-20' },
      'p1',
      later,
      ids('s'),
    );
    const after = await statement(store);
    expect(after.filter((l) => l.amount === -1200)).toEqual([supplementary]);
  });

  it('a deposit already returned is not changed: the lines are «da richiedere», debts negative', async () => {
    const store = await setUp('2027-03', 12000);
    await put(store, 'payment', depositBack('2027-04-10'), later);
    expect(
      await loadDepositReturn(store, { apartmentId: 'apt', tenantId: 't-a', extraCharges: [] }),
    ).toEqual({
      status: 'refused',
      reason: 'already-returned',
      toRequest: [{ label: 'Conguaglio 2025-26 non saldato', amount: -12000 }],
    });
  });

  it('I: returned on an open calculation, the exit period closed later: its due is «da verificare»', async () => {
    // The tenant left in August 2026; the deposit went back while the period was open (due
    // 100,00), then a bill of 30,00 arrived and the period closed with 130,00 due.
    const store = await setUp('2026-08', 10000, '2026-09', false);
    await put(store, 'payment', depositBack('2026-09-20'), clock);
    const late = bill('b-30', '2026-06-01', '2026-06-30', 3000, { dueDate: isoDate('2026-10-10') });
    await put(store, 'bill', late);
    await put(store, 'match', match(late, 3000));
    expect((await closePeriod(store, QUERY, 'p1', clock, ids('c'))).status).toBe('closed');
    const r = await loadDepositReturn(store, {
      apartmentId: 'apt',
      tenantId: 't-a',
      extraCharges: [],
    });
    expect(r).toEqual({
      status: 'refused',
      reason: 'already-returned',
      toRequest: [{ label: 'Conguaglio 2025-26 alla chiusura (da verificare)', amount: -13000 }],
    });
  });

  it('G: settled on the first closing, reopened, 10,00 more, closed again: only 10,00 is withheld', async () => {
    const store = await setUp('2027-03', 12000);
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('s'),
    );
    await reopenPeriod(
      store,
      { ...QUERY, on: '2026-12-10', reason: 'Bolletta tardiva' },
      'p1',
      later,
      ids('r'),
    );
    const late = bill('b-10', '2026-03-01', '2026-03-31', 1000, { dueDate: isoDate('2026-12-05') });
    await put(store, 'bill', late, later);
    await put(store, 'match', match(late, 1000), later);
    expect((await closePeriod(store, QUERY, 'p1', later, ids('c2'))).status).toBe('closed');
    const close = (await loadAll(store, 'periodClose', PeriodCloseSchema))
      .records[0] as PeriodClose;
    expect(tenantBalance(close, 't-a', { due: 13000, forfaitIncassato: 30000 })).toMatchObject({
      status: 'differenza',
      due: 13000,
      remaining: 1000,
    });
    const lines = await statement(store);
    expect(lines.filter((l) => l.label.startsWith('Conguaglio 2025-26'))).toEqual([
      { label: 'Conguaglio 2025-26 non saldato', amount: -1000 },
    ]);
    // The files and the dashboard say it, not «da saldare» from zero.
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    expect(buildOwnersWorkbook(loaded.input).sheets[0]?.rows[0]?.[0]).toMatchObject({
      value: expect.stringContaining(
        'saldato fino alla chiusura precedente, differenza da saldare 1',
      ) as unknown,
    });
    const board = await loadDashboard(store, {
      today: isoDate('2027-05-02'),
      settlements: [QUERY],
    });
    expect(board.status === 'computed' && board.apartments[0]?.counts).toMatchObject({
      'conguaglio:differenza-da-saldare': 1,
    });
    // Finding 5: sent, the tenant with only a difference is counted once, not also «da saldare».
    await markPeriodSent(store, { ...QUERY, on: '2027-01-05' }, 'p1', later, ids('sent'));
    const sentInput = await loadExcelInput(store, QUERY);
    if (sentInput.status !== 'ok') throw new Error(sentInput.reason);
    expect(buildOwnersWorkbook(sentInput.input).sheets[0]?.rows[0]?.[0]).toMatchObject({
      value: expect.stringMatching(
        /, inviato il 05\/01\/2027, saldato fino alla chiusura precedente, differenza da saldare 1$/,
      ) as unknown,
    });
    const sentBoard = await loadDashboard(store, {
      today: isoDate('2027-05-02'),
      settlements: [QUERY],
    });
    const counts = sentBoard.status === 'computed' ? sentBoard.apartments[0]?.counts : undefined;
    expect(counts?.['conguaglio:differenza-da-saldare']).toBe(1);
    expect(counts?.['conguaglio:da-saldare']).toBeUndefined();
    // Marking it settled again settles the difference.
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2027-01-10' },
      'p1',
      later,
      ids('s2'),
    );
    expect((await statement(store)).map((l) => l.label)).not.toContain(
      'Conguaglio 2025-26 non saldato',
    );
  });

  it('H: reopened for a flat charge no longer collected, closed again; the statement shows it', async () => {
    // The tenant left in August 2026; the period is closed, then a payment turns out to be 30,00
    // short (the flat charge of May).
    const store = await setUp('2026-08', 0, '2026-09');
    await reopenPeriod(
      store,
      { ...QUERY, on: '2026-11-20', reason: 'Forfait di maggio respinto' },
      'p1',
      later,
      ids('r'),
    );
    expect(
      await loadDepositReturn(store, { apartmentId: 'apt', tenantId: 't-a', extraCharges: [] }),
    ).toEqual({ status: 'refused', reason: 'period-reopened' });
    const may = (await loadAll(store, 'payment', PaymentSchema)).records.find(
      (p) => p.forMonth === '2026-05',
    );
    if (may === undefined) throw new Error('payment');
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          { path: recordPath('payment', may.id), before: may, after: { ...may, amount: 45000 } },
        ],
      },
      later,
      ids('fix'),
    );
    // A period never closed would refuse; this one closes, with the flat charge on its own line.
    expect((await closePeriod(store, QUERY, 'p1', later, ids('c2'))).status).toBe('closed');
    const close = (await loadAll(store, 'periodClose', PeriodCloseSchema)).records[0];
    expect(close?.snapshot.tenants[0]).toMatchObject({ forfaitNonIncassato: 3000 });
    const lines = await statement(store);
    expect(lines).toContainEqual({ label: 'Forfait non incassato 2025-26', amount: -3000 });
    expect(lines).toContainEqual({ label: 'Conguaglio bollette', amount: 0 });
  });

  it('finding 3: the missing flat charge paid after the new closing is nothing to refund; settled first, da verificare', async () => {
    const store = await reclosed();
    // Before the payment: the missing flat charge is in the main due, not in the supplementary.
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-12-01'))).toMatchObject({
      tenants: [{ tenantId: 't-a', forfaitDelta: 0, action: 'nessuna' }],
    });
    await paysLate(store);
    expect(await loadPeriodClosing(store, QUERY, isoDate('2026-12-10'))).toMatchObject({
      tenants: [{ tenantId: 't-a', forfaitDelta: -3000, action: 'nessuna' }],
    });
    expect(
      (await statement(store)).filter((l) => l.amount !== 0 && l.label.includes('2025-26')),
    ).toEqual([]);
    // Settled with the flat charge in it, then paid again: more than due, «da verificare» (answer
    // F; fourth round A replaced «da-rimborsare»).
    const settled = await reclosed();
    await markTenantSettled(
      settled,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('s'),
    );
    await paysLate(settled);
    expect(await loadPeriodClosing(settled, QUERY, isoDate('2026-12-10'))).toMatchObject({
      tenants: [{ tenantId: 't-a', forfaitDelta: -3000, action: 'da-verificare', toCheck: 3000 }],
    });
  });

  it('D: a supplementary marked settled is not withheld; a later difference is', async () => {
    const store = await setUp('2026-08', 0, '2026-09');
    const late = bill('b-tardiva', '2026-07-01', '2026-07-31', 1200, {
      dueDate: isoDate('2026-11-10'),
    });
    await put(store, 'bill', late, later);
    await put(store, 'match', match(late, 1200), later);
    expect(
      await markTenantSettled(
        store,
        { ...QUERY, tenantId: 't-a', on: '2026-11-25', supplementary: true },
        'p1',
        later,
        ids('sup'),
      ),
    ).toMatchObject({ status: 'saved' });
    expect((await statement(store)).filter((l) => l.label.includes('supplementare'))).toEqual([]);
    const more = bill('b-tardiva-2', '2026-06-01', '2026-06-30', 500, {
      dueDate: isoDate('2026-11-12'),
    });
    await put(store, 'bill', more, later);
    await put(store, 'match', match(more, 500), later);
    expect((await statement(store)).filter((l) => l.label.includes('supplementare'))).toEqual([
      { label: 'Conguaglio supplementare 2025-26 da saldare', amount: -500 },
    ]);
  });

  it('a reopened period of the tenant refuses the statement (prudent)', async () => {
    const store = await setUp('2027-03', 12000);
    await reopenPeriod(
      store,
      { apartmentId: 'apt', periodLabel: '2025-26', on: '2027-05-01', reason: 'Correzione' },
      'p1',
      later,
      ids('r'),
    );
    expect(
      await loadDepositReturn(store, { apartmentId: 'apt', tenantId: 't-a', extraCharges: [] }),
    ).toEqual({ status: 'refused', reason: 'period-reopened' });
  });

  // Fourth round, findings A and B: what the closing says and what the deposit withholds agree.
  // Columns: main settled, flat charge paid after closing 2 (cents), closing action and amount
  // «da verificare», deposit lines of the period, deposit «da verificare» amount.
  const matrix: [boolean, number, string, number, { label: string; amount: number }[], number][] = [
    [false, 0, 'nessuna', 0, [{ label: 'Forfait non incassato 2025-26', amount: -3000 }], 0],
    [false, 1500, 'nessuna', 0, [{ label: 'Forfait non incassato 2025-26', amount: -1500 }], 0],
    [false, 3000, 'nessuna', 0, [], 0],
    // Only 30,00 of a 40,00 payment is flat charge (the month's due): as 30,00.
    [false, 4000, 'nessuna', 0, [], 0],
    [true, 0, 'nessuna', 0, [], 0],
    [true, 1500, 'da-verificare', 1500, [], 1500],
    [true, 3000, 'da-verificare', 3000, [], 3000],
    [true, 4000, 'da-verificare', 3000, [], 3000],
  ];
  for (const [settledMain, paid, action, toCheck, lines, depositToCheck] of matrix) {
    it(`A, B: main ${settledMain ? 'settled' : 'not settled'}, ${String(paid / 100)} paid after: closing and deposit agree`, async () => {
      const store = await reclosed();
      if (settledMain) {
        await markTenantSettled(
          store,
          { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
          'p1',
          later,
          ids('s'),
        );
      }
      if (paid > 0) await paysLate(store, paid);
      const closing = await loadPeriodClosing(store, QUERY, isoDate('2026-12-10'));
      expect(closing).toMatchObject({ tenants: [{ action, toCheck, total: 0 }] });
      const r = await loadDepositReturn(store, {
        apartmentId: 'apt',
        tenantId: 't-a',
        extraCharges: [],
      });
      if (r.status !== 'computed') throw new Error(r.reason);
      expect(
        r.statement.lines.filter((l) => l.label.includes('2025-26') || l.label.includes('Forfait')),
      ).toEqual(lines);
      expect(r.toCheck.reduce((sum, l) => sum + l.amount, 0)).toBe(depositToCheck);
    });
  }

  it('A: the files say «da verificare» for the flat charge collected beyond what was due', async () => {
    const store = await reclosed();
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('s'),
    );
    await paysLate(store);
    const loaded = await loadExcelInput(store, QUERY);
    if (loaded.status !== 'ok') throw new Error(loaded.reason);
    expect(buildOwnersWorkbook(loaded.input).sheets[0]?.rows[0]?.[0]).toMatchObject({
      value: expect.stringContaining('forfait incassato in più, da verificare') as unknown,
    });
  });

  it('B: 30,00 paid, nothing to settle: the supplementary mark is refused and nothing is withheld', async () => {
    const store = await reclosed();
    await paysLate(store);
    expect(
      await markTenantSettled(
        store,
        { ...QUERY, tenantId: 't-a', on: '2026-12-10', supplementary: true },
        'p1',
        later,
        ids('sup'),
      ),
    ).toEqual({ status: 'refused', reason: 'no-supplementary' });
    expect((await statement(store)).filter((l) => l.label.includes('Forfait'))).toEqual([]);
  });

  it("fifth round: the reviewer's mixed scenario S0–S6 (one computation, no automatic credit)", async () => {
    const store = await reclosed();
    const step = async () => {
      const closing = await loadPeriodClosing(store, QUERY, isoDate('2026-12-10'));
      const row = closing.status === 'closed' ? closing.tenants[0] : undefined;
      const r = await loadDepositReturn(store, {
        apartmentId: 'apt',
        tenantId: 't-a',
        extraCharges: [],
      });
      if (r.status !== 'computed') throw new Error(r.reason);
      const lines = r.statement.lines.filter(
        (l) => l.label !== 'Caparra' && l.label !== 'Interessi legali' && l.amount !== 0,
      );
      return {
        action: row?.action,
        remaining: row?.remaining,
        toCheck: r.toCheck.reduce((sum, l) => sum + l.amount, 0),
        lines,
      };
    };
    const seen = [];
    seen.push(await step()); // S0: closing 2 with 30,00 of the May flat charge missing
    const late = (id: string, amount: number, month: string) => [
      bill(id, `${month}-01`, `${month}-28`, amount, { dueDate: isoDate('2026-11-10') }),
    ];
    for (const b of late('b-12', 1200, '2026-07')) {
      await put(store, 'bill', b, later);
      await put(store, 'match', match(b, 1200, { transactionId: 'tx-12' }), later);
    }
    seen.push(await step()); // S1: late bill 12,00
    await paysLate(store);
    seen.push(await step()); // S2: the tenant pays the missing 30,00
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('m'),
    );
    seen.push(await step()); // S3: main marked settled
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2026-12-02', supplementary: true },
      'p1',
      later,
      ids('s'),
    );
    seen.push(await step()); // S4: supplementary marked settled (12,00)
    for (const b of late('b-5', 500, '2026-06')) {
      await put(store, 'bill', b, later);
      await put(store, 'match', match(b, 500, { transactionId: 'tx-5' }), later);
    }
    seen.push(await step()); // S5: late bill 5,00
    await reopenPeriod(
      store,
      { ...QUERY, on: '2026-12-20', reason: 'Prova' },
      'p1',
      later,
      ids('r-s6'),
    );
    expect((await closePeriod(store, QUERY, 'p1', later, ids('c3'))).status).toBe('closed');
    seen.push(await step()); // S6: reopened and closed again, nothing changed
    console.log(seen.map((x, i) => `S${String(i)} ${JSON.stringify(x)}`).join('\n'));
    expect(seen.map((x) => [x.remaining, x.toCheck])).toEqual([
      [3000, 0],
      [4200, 0],
      [1200, 0],
      [1200, 0],
      [0, 0],
      [500, 0],
      [500, 0],
    ]);
    expect(seen[6]?.lines).toEqual([{ label: 'Conguaglio bollette', amount: -500 }]);
  });

  it('final review: with flat charge to check, the owner can still mark the supplementary and the main settled', async () => {
    const store = await reclosed();
    await markTenantSettled(
      store,
      { ...QUERY, tenantId: 't-a', on: '2026-12-01' },
      'p1',
      later,
      ids('m'),
    );
    await paysLate(store); // the missing 30,00 again: «da verificare»
    const b = bill('b-10', '2026-07-01', '2026-07-28', 1000, { dueDate: isoDate('2026-11-10') });
    await put(store, 'bill', b, later);
    await put(store, 'match', match(b, 1000, { transactionId: 'tx-10' }), later);
    const row = async () => {
      const c = await loadPeriodClosing(store, QUERY, isoDate('2026-12-10'));
      return c.status === 'closed' ? c.tenants[0] : undefined;
    };
    expect(await row()).toMatchObject({ remaining: 1000, toCheck: 3000 });
    // The tenant pays the 10,00; the owner marks the supplementary settled.
    expect(
      await markTenantSettled(
        store,
        { ...QUERY, tenantId: 't-a', on: '2026-12-12', supplementary: true },
        'p1',
        later,
        ids('s'),
      ),
    ).toMatchObject({ status: 'saved' });
    expect(await row()).toMatchObject({ remaining: 0, toCheck: 3000 });
    // A main mark again is allowed too, and the extra stays to check (never folded in).
    expect(
      await markTenantSettled(
        store,
        { ...QUERY, tenantId: 't-a', on: '2026-12-13' },
        'p1',
        later,
        ids('m2'),
      ),
    ).toMatchObject({ status: 'saved' });
    expect(await row()).toMatchObject({ remaining: 0, toCheck: 3000 });
    const r = await loadDepositReturn(store, {
      apartmentId: 'apt',
      tenantId: 't-a',
      extraCharges: [],
    });
    if (r.status !== 'computed') throw new Error(r.reason);
    expect(r.statement.lines.filter((l) => l.label.includes('2025-26') && l.amount !== 0)).toEqual(
      [],
    );
    expect(r.toCheck.reduce((sum, l) => sum + l.amount, 0)).toBe(3000);
  });
});
