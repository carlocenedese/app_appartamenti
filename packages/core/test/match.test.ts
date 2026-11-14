import { describe, expect, it } from 'vitest';
import {
  BillMatchSchema,
  cents,
  expectedDebit,
  isoDate,
  matchToTransactions,
  splitSharedDebit,
  tariNote,
  validateMatches,
  yearMonth,
} from '../src/index';
import type { BankTransaction, Bill, BillMatch, Instalment } from '../src/index';

type MatchInput = Parameters<typeof matchToTransactions>[0];

const WINDOW = { daysBefore: 5, daysAfter: 10 };
// A period covers one account only, so the tests cover the three apartments of the fixtures.
function covering(from: string, to: string): MatchInput['statementPeriods'] {
  return ['berchet', 'lovarini', 'pulci'].map((apartmentId) => ({
    apartmentId,
    from: isoDate(from),
    to: isoDate(to),
  }));
}

const ALL_OF_2026 = covering('2026-01-01', '2026-12-31');

function bill(id: string, extra: Partial<Bill> = {}): Bill {
  return {
    id,
    v: 1,
    rev: 1,
    apartmentId: 'berchet',
    category: 'elettricita',
    supplier: 'Luce Srl',
    dueDate: isoDate('2026-11-10'),
    periodStart: isoDate('2026-07-01'),
    periodEnd: isoDate('2026-09-30'),
    amount: cents(21460),
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash: `hash-${id}`,
    filePath: `bollette/${id}.pdf`,
    ...extra,
  };
}

function tx(id: string, date: string, amount: number, extra: Partial<BankTransaction> = {}) {
  const transaction: BankTransaction = {
    id,
    v: 1,
    rev: 1,
    apartmentId: 'berchet',
    date: isoDate(date),
    amount: cents(amount),
    description: 'ADDEBITO DIRETTO SDD LUCE SRL',
    statementHash: 'statement-1',
    ...extra,
  };
  return transaction;
}

function instalment(id: string, extra: Partial<Instalment> = {}): Instalment {
  return {
    id,
    v: 1,
    rev: 1,
    apartmentId: 'berchet',
    kind: 'condominio',
    esercizio: '2026-27',
    rateIndex: 1,
    rateCount: 3,
    dueDate: isoDate('2026-10-10'),
    rata: cents(15000),
    quotaProprieta: cents(2400),
    conguaglioPrec: cents(4800),
    coversFrom: yearMonth('2026-10'),
    coversTo: yearMonth('2027-01'),
    ...extra,
  };
}

function recorded(
  itemId: string,
  transactionId: string,
  amount: number,
  extra: Partial<BillMatch> = {},
): BillMatch {
  return {
    id: `rec-${itemId}-${transactionId}`,
    v: 1,
    rev: 1,
    itemType: 'bill',
    itemId,
    transactionId,
    transactionDate: isoDate('2026-11-12'),
    amount: cents(amount),
    part: 'amount',
    confirmed: true,
    by: 'manual',
    ...extra,
  };
}

function run(input: Partial<MatchInput>): ReturnType<typeof matchToTransactions> {
  return matchToTransactions({
    bills: [],
    instalments: [],
    transactions: [],
    window: WINDOW,
    statementPeriods: ALL_OF_2026,
    existing: [],
    ...input,
  });
}

// The common TARI notice of Berchet and Lovarini, paid from Berchet's account.
function tariShared(): Instalment[] {
  const common = {
    kind: 'tari' as const,
    esercizio: '2026',
    rateIndex: 1,
    rateCount: 3,
    dueDate: isoDate('2026-03-16'),
    quotaProprieta: cents(0),
    conguaglioPrec: cents(0),
    coversFrom: yearMonth('2026-01'),
    coversTo: yearMonth('2026-04'),
  };
  return [
    instalment('tari-berchet', {
      ...common,
      apartmentId: 'berchet',
      rata: cents(10075),
      shared: { groupId: 'avviso-89064', groupTotal: cents(18600), weight: cents(10075) },
    }),
    instalment('tari-lovarini', {
      ...common,
      apartmentId: 'lovarini',
      paidFromApartmentId: 'berchet',
      rata: cents(8471),
      shared: { groupId: 'avviso-89064', groupTotal: cents(18600), weight: cents(8471) },
    }),
  ];
}

/** mulberry32: a tiny seeded generator, so the permutations are the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('matchToTransactions: exact matches', () => {
  it('matches a bill with the debit of the same amount inside the window', () => {
    const result = run({ bills: [bill('b1')], transactions: [tx('t1', '2026-11-12', -21460)] });
    expect(result.matches).toEqual([
      {
        id: 'm-bill-b1-amount-t1',
        v: 1,
        rev: 1,
        itemType: 'bill',
        itemId: 'b1',
        transactionId: 't1',
        transactionDate: '2026-11-12',
        amount: 21460,
        part: 'amount',
        confirmed: true,
        by: 'auto',
      },
    ]);
    expect(result.pending).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([]);
    for (const match of result.matches) expect(() => BillMatchSchema.parse(match)).not.toThrow();
  });

  it('leaves a bill without debit in pending', () => {
    const result = run({ bills: [bill('b1')] });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
  });

  it('uses the due date, not the end of the period, when the bill has one', () => {
    const result = run({
      bills: [bill('b1', { dueDate: isoDate('2026-11-10'), periodEnd: isoDate('2026-09-30') })],
      transactions: [tx('t1', '2026-11-12', -21460)],
    });
    expect(result.matches.map((m) => m.transactionId)).toEqual(['t1']);
  });

  it('uses the end of the period when the bill has no due date', () => {
    const withoutDue: Bill = { ...bill('b1') };
    delete withoutDue.dueDate;
    const near = run({ bills: [withoutDue], transactions: [tx('t1', '2026-10-03', -21460)] });
    expect(near.matches).toHaveLength(1);
    const far = run({ bills: [withoutDue], transactions: [tx('t1', '2026-11-12', -21460)] });
    expect(far.matches).toEqual([]);
  });

  it('matches a credit note with an incoming credit, never with a debit', () => {
    const note = bill('nc1', { amount: cents(-3000) });
    const credited = run({ bills: [note], transactions: [tx('t1', '2026-11-10', 3000)] });
    expect(credited.matches).toHaveLength(1);
    expect(credited.matches[0]?.amount).toBe(-3000);
    const debited = run({ bills: [note], transactions: [tx('t1', '2026-11-10', -3000)] });
    expect(debited.matches).toEqual([]);
    expect(debited.pending).toEqual([{ itemType: 'bill', itemId: 'nc1' }]);
    expect(debited.unmatchedTransactions).toEqual(['t1']);
  });

  it('expects rata + conguaglioPrec for a condominium instalment, never net of the owner share', () => {
    const rata = instalment('cond-1');
    const whole = run({ instalments: [rata], transactions: [tx('t1', '2026-10-10', -19800)] });
    expect(whole.matches).toHaveLength(1);
    expect(whole.matches[0]).toMatchObject({ itemType: 'instalment', itemId: 'cond-1' });
    expect(whole.matches[0]?.amount).toBe(19800);
    for (const amount of [-19200, -15000]) {
      const other = run({ instalments: [rata], transactions: [tx('t1', '2026-10-10', amount)] });
      expect(other.matches).toEqual([]);
      expect(other.pending).toEqual([{ itemType: 'instalment', itemId: 'cond-1' }]);
    }
  });

  it('expects rata alone for a TARI instalment', () => {
    const tari = instalment('tari-pulci', {
      kind: 'tari',
      apartmentId: 'pulci',
      rata: cents(13772),
      conguaglioPrec: cents(0),
    });
    const result = run({
      instalments: [tari],
      transactions: [tx('t1', '2026-10-11', -13772, { apartmentId: 'pulci' })],
    });
    expect(result.matches).toHaveLength(1);
  });

  it('looks for a debit only on the paying account', () => {
    const rata = instalment('cond-1', { apartmentId: 'lovarini', paidFromApartmentId: 'berchet' });
    const onLovarini = run({
      instalments: [rata],
      transactions: [tx('t1', '2026-10-10', -19800, { apartmentId: 'lovarini' })],
    });
    expect(onLovarini.matches).toEqual([]);
    const onBerchet = run({ instalments: [rata], transactions: [tx('t1', '2026-10-10', -19800)] });
    expect(onBerchet.matches).toHaveLength(1);
  });

  it('never assigns one debit compatible with two bills of the same amount', () => {
    const result = run({
      bills: [bill('b1', { amount: cents(8830) }), bill('b2', { amount: cents(8830) })],
      transactions: [tx('t1', '2026-11-11', -8830)],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([
      { itemId: 'b1', transactionIds: ['t1'] },
      { itemId: 'b2', transactionIds: ['t1'] },
    ]);
    expect(result.pending).toEqual([
      { itemType: 'bill', itemId: 'b1' },
      { itemType: 'bill', itemId: 'b2' },
    ]);
    expect(result.unmatchedTransactions).toEqual(['t1']);
  });

  it('matches two bills of the same amount when the dates allow one combination only', () => {
    const result = run({
      bills: [
        bill('b1', { amount: cents(8830), dueDate: isoDate('2026-03-10') }),
        bill('b2', { amount: cents(8830), dueDate: isoDate('2026-06-10') }),
      ],
      transactions: [tx('t-june', '2026-06-12', -8830), tx('t-march', '2026-03-11', -8830)],
    });
    expect(result.matches.map((m) => [m.itemId, m.transactionId])).toEqual([
      ['b1', 't-march'],
      ['b2', 't-june'],
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it('does not assign a group where one item has two candidates, even if one pairing fits', () => {
    // b1 can take t1 or t2, b2 only t2: a single perfect pairing exists, but it is a choice.
    const result = run({
      bills: [
        bill('b1', { amount: cents(8830), dueDate: isoDate('2026-03-10') }),
        bill('b2', { amount: cents(8830), dueDate: isoDate('2026-03-20') }),
      ],
      transactions: [tx('t1', '2026-03-08', -8830), tx('t2', '2026-03-17', -8830)],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([
      { itemId: 'b1', transactionIds: ['t1', 't2'] },
      { itemId: 'b2', transactionIds: ['t2'] },
    ]);
  });

  it('leaves a bill in pending and the debit unmatched when the debit is outside the window', () => {
    const result = run({ bills: [bill('b1')], transactions: [tx('t1', '2026-11-21', -21460)] });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
    expect(result.unmatchedTransactions).toEqual(['t1']);
  });

  it('includes both ends of the window', () => {
    const b = bill('b1');
    expect(
      run({ bills: [b], transactions: [tx('t1', '2026-11-05', -21460)] }).matches,
    ).toHaveLength(1);
    expect(
      run({ bills: [b], transactions: [tx('t1', '2026-11-20', -21460)] }).matches,
    ).toHaveLength(1);
    expect(run({ bills: [b], transactions: [tx('t1', '2026-11-04', -21460)] }).matches).toEqual([]);
  });

  it('gives the same result for 20 seeded permutations of the input', () => {
    const input: MatchInput = {
      bills: [
        bill('b1'),
        bill('b2', { amount: cents(8830), dueDate: isoDate('2026-03-10') }),
        bill('b3', { amount: cents(8830), dueDate: isoDate('2026-06-10') }),
        bill('b4', { amount: cents(4500), dueDate: isoDate('2026-05-01') }),
        bill('b5', { amount: cents(4500), dueDate: isoDate('2026-05-02') }),
        bill('b6', { amount: cents(21460), dueDate: isoDate('2026-08-01') }),
        bill('b7', { amount: cents(3000), dueDate: isoDate('2026-09-01') }),
      ],
      instalments: [instalment('cond-1'), ...tariShared()],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D1' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D1' }),
        tx('t2', '2026-03-11', -8830),
        tx('t3', '2026-06-12', -8830),
        tx('t4', '2026-05-03', -4500),
        tx('t5', '2026-08-02', -21406),
        tx('t6', '2026-10-10', -19800),
        tx('t7', '2026-03-16', -18600),
        tx('t8', '2026-09-02', -3000, { dispCode: 'D8' }),
        tx('t8c', '2026-09-03', -80, { dispCode: 'D8' }),
        tx('bollo', '2026-12-31', -200, { description: 'IMPOSTA DI BOLLO' }),
      ],
      window: WINDOW,
      statementPeriods: [
        ...covering('2026-01-01', '2026-06-30'),
        ...covering('2026-06-01', '2026-12-31'),
      ],
      existing: [
        recorded('b7', 't8', 3000),
        recorded('b1', 't-old', 21000, { confirmed: false, by: 'auto' }),
        recorded('b6', 'assumed-b6', 21460, { by: 'assumed' }),
      ],
    };
    const expected = matchToTransactions(input);
    expect(expected.matches.length).toBeGreaterThan(0);
    expect(expected.ambiguous.length).toBeGreaterThan(0);
    const next = mulberry32(20261110);
    for (let i = 0; i < 20; i += 1) {
      const permuted: MatchInput = {
        ...input,
        bills: shuffled(input.bills, next),
        instalments: shuffled(input.instalments, next),
        transactions: shuffled(input.transactions, next),
        statementPeriods: shuffled(input.statementPeriods, next),
        existing: shuffled(input.existing, next),
      };
      expect(matchToTransactions(permuted)).toEqual(expected);
    }
  });
});

describe('matchToTransactions: supplier in the description of an exact match', () => {
  const enel = () => bill('b-enel', { supplier: 'Enel Energia', amount: cents(2990) });

  it('proposes, unconfirmed, a debit of the right amount whose description lacks the supplier', () => {
    const result = run({
      bills: [enel()],
      transactions: [tx('t1', '2026-11-12', -2990, { description: 'ADDEBITO SDD FASTWEB' })],
    });
    expect(result.matches).toEqual([
      {
        id: 'm-bill-b-enel-amount-t1',
        v: 1,
        rev: 1,
        itemType: 'bill',
        itemId: 'b-enel',
        transactionId: 't1',
        transactionDate: '2026-11-12',
        amount: 2990,
        part: 'amount',
        confirmed: false,
        by: 'auto',
      },
    ]);
    // A proposal to confirm by hand is neither pending nor ambiguous, and it uses the movement.
    expect(result.pending).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([]);
  });

  it('confirms the same debit when the supplier is in the description', () => {
    const result = run({
      bills: [enel()],
      transactions: [tx('t1', '2026-11-12', -2990, { description: 'ADDEBITO SDD ENEL ENERGIA' })],
    });
    expect(result.matches).toEqual([
      expect.objectContaining({
        itemId: 'b-enel',
        transactionId: 't1',
        confirmed: true,
        by: 'auto',
      }),
    ]);
    expect(result.pending).toEqual([]);
  });

  it('finds the supplier whatever its case, spaces and non-breaking spaces', () => {
    const result = run({
      bills: [bill('b-enel', { supplier: '  enel   ENERGIA ', amount: cents(2990) })],
      transactions: [
        tx('t1', '2026-11-12', -2990, { description: 'ADDEBITO SDD Enel\u00a0\u00a0Energia SpA' }),
      ],
    });
    expect(result.matches.map((m) => m.confirmed)).toEqual([true]);
  });

  it('confirms an instalment and a shared notice whatever their description says', () => {
    const rata = run({
      instalments: [instalment('cond-1')],
      transactions: [tx('t1', '2026-10-10', -19800, { description: 'BONIFICO A CONDOMINIO' })],
    });
    expect(rata.matches.map((m) => m.confirmed)).toEqual([true]);
    const tari = run({
      instalments: tariShared(),
      transactions: [tx('t1', '2026-03-16', -18600, { description: 'PAGOPA' })],
    });
    expect(tari.matches.map((m) => m.confirmed)).toEqual([true, true]);
  });

  it('keeps an ambiguous component ambiguous, supplier or not', () => {
    const result = run({
      bills: [enel(), bill('b-enel-2', { supplier: 'Enel Energia', amount: cents(2990) })],
      transactions: [tx('t1', '2026-11-12', -2990, { description: 'ADDEBITO SDD FASTWEB' })],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguous.map((entry) => entry.itemId)).toEqual(['b-enel', 'b-enel-2']);
  });

  it('keeps a proposal out of the commission until a person confirms it', () => {
    const transactions = [
      tx('t1', '2026-11-12', -2990, { description: 'ADDEBITO SDD FASTWEB', dispCode: 'D1' }),
      tx('t1c', '2026-11-12', -80, { description: 'COMMISSIONI E SPESE', dispCode: 'D1' }),
    ];
    const proposed = run({ bills: [enel()], transactions });
    expect(proposed.matches.map((m) => [m.part, m.confirmed])).toEqual([['amount', false]]);
    const confirmed = run({
      bills: [enel()],
      transactions,
      existing: [recorded('b-enel', 't1', 2990)],
    });
    expect(confirmed.matches.map((m) => `${m.part}:${m.confirmed}`).sort()).toEqual([
      'amount:true',
      'commission:true',
    ]);
  });
});

describe('matchToTransactions: unconfirmed proposals', () => {
  it('proposes a debit of another amount with the supplier in the description, unconfirmed', () => {
    const result = run({
      bills: [bill('b1', { supplier: '  luce   SRL ' })],
      transactions: [tx('t1', '2026-11-12', -21406)],
    });
    expect(result.matches).toEqual([
      expect.objectContaining({
        itemId: 'b1',
        transactionId: 't1',
        amount: 21406,
        part: 'amount',
        confirmed: false,
        by: 'auto',
      }),
    ]);
    expect(result.pending).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([]);
  });

  it('proposes nothing when the supplier is not in the description', () => {
    const result = run({
      bills: [bill('b1', { supplier: 'Gas Spa' })],
      transactions: [tx('t1', '2026-11-12', -21406)],
    });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
  });

  it('proposes nothing for a debit outside the window or with the wrong direction', () => {
    expect(
      run({ bills: [bill('b1')], transactions: [tx('t1', '2026-12-30', -21406)] }).matches,
    ).toEqual([]);
    expect(
      run({ bills: [bill('b1')], transactions: [tx('t1', '2026-11-12', 21406)] }).matches,
    ).toEqual([]);
  });

  it('keeps an item in pending when two debits could be the different-amount one', () => {
    const result = run({
      bills: [bill('b1')],
      transactions: [tx('t1', '2026-11-12', -21406), tx('t2', '2026-11-13', -21000)],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
    expect(result.unmatchedTransactions).toEqual(['t1', 't2']);
  });

  it('recomputes unconfirmed existing matches instead of keeping them', () => {
    const stale: BillMatch = {
      id: 'm-bill-b1-amount-t-old',
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'b1',
      transactionId: 't-old',
      transactionDate: isoDate('2026-11-12'),
      amount: cents(21000),
      part: 'amount',
      confirmed: false,
      by: 'auto',
    };
    const result = run({
      bills: [bill('b1')],
      transactions: [tx('t1', '2026-11-12', -21460)],
      existing: [stale],
    });
    expect(result.matches.map((m) => m.id)).toEqual(['m-bill-b1-amount-t1']);
  });
});

describe('matchToTransactions: existing matches', () => {
  it('changes nothing when run again with the confirmed matches as existing', () => {
    const input: Partial<MatchInput> = {
      bills: [bill('b1'), bill('b2', { amount: cents(4500), dueDate: isoDate('2026-05-01') })],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D1' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D1' }),
      ],
    };
    const first = run(input);
    expect(first.matches).toHaveLength(2);
    const second = run({ ...input, existing: first.matches });
    expect(second).toEqual(first);
  });

  it('returns confirmed existing matches unchanged and never reuses their debit', () => {
    const manual: BillMatch = {
      id: 'manual-1',
      v: 1,
      rev: 3,
      itemType: 'bill',
      itemId: 'b-other',
      transactionId: 't1',
      transactionDate: isoDate('2026-11-12'),
      amount: cents(21460),
      part: 'amount',
      confirmed: true,
      by: 'manual',
    };
    const result = run({
      bills: [bill('b1'), bill('b-other')],
      transactions: [tx('t1', '2026-11-12', -21460)],
      existing: [manual],
    });
    expect(result.matches).toEqual([manual]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
    expect(result.unmatchedTransactions).toEqual([]);
  });

  it('skips an item already covered by confirmed existing matches', () => {
    const halves: BillMatch[] = ['t1', 't2'].map((id) => ({
      id: `manual-${id}`,
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'b1',
      transactionId: id,
      transactionDate: isoDate('2026-11-12'),
      amount: cents(10730),
      part: 'amount',
      confirmed: true,
      by: 'manual',
    }));
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -10730),
        tx('t2', '2026-11-12', -10730),
        tx('t3', '2026-11-12', -21460),
      ],
      existing: halves,
    });
    expect(result.matches).toEqual(halves);
    expect(result.unmatchedTransactions).toEqual(['t3']);
  });
});

describe('matchToTransactions: periods without a statement', () => {
  const firstHalf = covering('2026-01-01', '2026-06-30');

  it('keeps a bill due in a covered period without debit in pending', () => {
    const result = run({
      bills: [bill('b1', { dueDate: isoDate('2026-03-10') })],
      statementPeriods: firstHalf,
    });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
  });

  it('assumes a bill due outside every covered period as paid, for the document amount', () => {
    const result = run({ bills: [bill('b1')], statementPeriods: firstHalf });
    expect(result.matches).toEqual([
      {
        id: 'm-bill-b1-amount-assumed-b1',
        v: 1,
        rev: 1,
        itemType: 'bill',
        itemId: 'b1',
        transactionId: 'assumed-b1',
        transactionDate: '2026-11-10',
        amount: 21460,
        part: 'amount',
        confirmed: true,
        by: 'assumed',
      },
    ]);
    expect(result.pending).toEqual([]);
  });

  it('assumes each member of a shared notice for its share', () => {
    const result = run({ instalments: tariShared(), statementPeriods: [] });
    expect(result.matches.map((m) => [m.itemId, m.amount, m.by, m.transactionId])).toEqual([
      ['tari-berchet', 10104, 'assumed', 'assumed-tari-berchet'],
      ['tari-lovarini', 8496, 'assumed', 'assumed-tari-lovarini'],
    ]);
  });

  it('verifies an assumed match again once a statement covers its period', () => {
    const b = bill('b1');
    const first = run({ bills: [b], statementPeriods: [] });
    expect(first.matches.map((m) => m.by)).toEqual(['assumed']);
    const second = run({
      bills: [b],
      transactions: [tx('t1', '2026-11-12', -21460)],
      existing: first.matches,
    });
    expect(second.matches.map((m) => [m.by, m.transactionId])).toEqual([['auto', 't1']]);
    expect(second.unmatchedTransactions).toEqual([]);
    const unpaid = run({ bills: [b], existing: first.matches });
    expect(unpaid.matches).toEqual([]);
    expect(unpaid.pending).toEqual([{ itemType: 'bill', itemId: 'b1' }]);
    expect(run({ bills: [b], statementPeriods: [], existing: first.matches })).toEqual(first);
  });

  it('counts a movement only once when two statements overlap', () => {
    const overlapping = [
      ...covering('2026-10-01', '2026-11-30'),
      ...covering('2026-11-01', '2026-12-31'),
    ];
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { statementHash: 'statement-oct-nov' }),
        tx('t1', '2026-11-12', -21460, { statementHash: 'statement-nov-dec' }),
      ],
      statementPeriods: overlapping,
    });
    expect(result.matches.map((m) => m.id)).toEqual(['m-bill-b1-amount-t1']);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([]);
  });
});

describe('matchToTransactions: periods per account', () => {
  const berchetOnly = [
    { apartmentId: 'berchet', from: isoDate('2026-01-01'), to: isoDate('2026-12-31') },
  ];

  it("assumes Pulci's bill as paid when only Berchet's account has a statement", () => {
    const result = run({
      bills: [
        bill('b-pulci', { apartmentId: 'pulci' }),
        bill('b-berchet', { fileHash: 'hash-other' }),
      ],
      statementPeriods: berchetOnly,
    });
    expect(result.matches.map((m) => [m.itemId, m.by])).toEqual([['b-pulci', 'assumed']]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'b-berchet' }]);
  });

  it('covers an instalment paid from another account with the period of that account', () => {
    const [berchet, lovarini] = tariShared() as [Instalment, Instalment];
    const result = run({ instalments: [berchet, lovarini], statementPeriods: berchetOnly });
    expect(result.matches).toEqual([]);
    expect(result.pending.map((ref) => ref.itemId)).toEqual(['tari-berchet', 'tari-lovarini']);
    const lovariniOnly = [{ ...berchetOnly[0], apartmentId: 'lovarini' }] as typeof berchetOnly;
    expect(
      run({ instalments: [berchet, lovarini], statementPeriods: lovariniOnly }).matches,
    ).toHaveLength(2);
  });
});

describe('matchToTransactions: commissions', () => {
  it('never makes a commission of an unrelated debit that shares the disposition code', () => {
    const result = run({
      bills: [
        bill('jan', { amount: cents(5000), dueDate: isoDate('2026-01-10') }),
        bill('feb', { amount: cents(6000), dueDate: isoDate('2026-02-10') }),
      ],
      transactions: [
        tx('tjan', '2026-01-12', -5000, { dispCode: 'M' }),
        tx('tfeb', '2026-02-12', -6000, { dispCode: 'M' }),
      ],
    });
    expect(result.matches.map((m) => [m.itemId, m.part, m.transactionId, m.amount])).toEqual([
      ['feb', 'amount', 'tfeb', 6000],
      ['jan', 'amount', 'tjan', 5000],
    ]);
    expect(result.pending).toEqual([]);
  });

  it('does not tie a row more than two days away from the debit', () => {
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t2', '2026-11-14', -80, { dispCode: 'D42' }),
        tx('t3', '2026-11-15', -80, { dispCode: 'D42' }),
      ],
    });
    expect(result.matches.map((m) => [m.part, m.transactionId])).toEqual([
      ['amount', 't1'],
      ['commission', 't2'],
    ]);
    expect(result.unmatchedTransactions).toEqual(['t3']);
  });

  it('does not tie a row when two larger debits with the code are close to it', () => {
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t2', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D42' }),
      ],
    });
    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toEqual([{ itemId: 'b1', transactionIds: ['t1', 't2'] }]);
    expect(result.unmatchedTransactions).toEqual(['t1', 't1c', 't2']);
  });

  it('keeps a refund with the code of a debit as a candidate for a credit note', () => {
    const result = run({
      bills: [
        bill('b1', { dueDate: isoDate('2026-03-10') }),
        bill('nc', { amount: cents(-3000), dueDate: isoDate('2026-03-10') }),
      ],
      transactions: [
        tx('d', '2026-03-11', -21460, { dispCode: 'X' }),
        tx('r', '2026-03-12', 3000, { dispCode: 'X' }),
      ],
    });
    expect(result.matches.map((m) => [m.itemId, m.part, m.transactionId])).toEqual([
      ['b1', 'amount', 'd'],
      ['nc', 'amount', 'r'],
    ]);
    expect(result.unmatchedTransactions).toEqual([]);
  });

  it('splits the commission of a debit split by hand in proportion to its parts', () => {
    const result = run({
      bills: [bill('a', { amount: cents(3000) }), bill('b', { amount: cents(1000) })],
      transactions: [
        tx('d', '2026-11-12', -4000, { dispCode: 'D1' }),
        tx('dc', '2026-11-12', -80, { dispCode: 'D1' }),
      ],
      existing: [recorded('a', 'd', 3000), recorded('b', 'd', 1000)],
    });
    expect(
      result.matches.filter((m) => m.part === 'commission').map((m) => [m.itemId, m.amount]),
    ).toEqual([
      ['a', 60],
      ['b', 20],
    ]);
  });

  it('ties a commission with the same disposition code to the bill of the debit', () => {
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D42', description: 'COMMISSIONI E SPESE' }),
      ],
    });
    expect(result.matches).toEqual([
      expect.objectContaining({ itemId: 'b1', transactionId: 't1', part: 'amount', amount: 21460 }),
      expect.objectContaining({
        id: 'm-bill-b1-commission-t1c',
        itemId: 'b1',
        transactionId: 't1c',
        part: 'commission',
        amount: 80,
        confirmed: true,
        by: 'auto',
      }),
    ]);
    expect(result.unmatchedTransactions).toEqual([]);
  });

  it('never matches a commission row as the amount of an item of the same value', () => {
    const result = run({
      bills: [bill('b1'), bill('small', { amount: cents(80) })],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D42' }),
      ],
    });
    expect(result.matches.map((m) => [m.itemId, m.part, m.transactionId])).toEqual([
      ['b1', 'amount', 't1'],
      ['b1', 'commission', 't1c'],
    ]);
    expect(result.pending).toEqual([{ itemType: 'bill', itemId: 'small' }]);
  });

  it('ties a commission to the item of a confirmed existing match', () => {
    const manual: BillMatch = {
      id: 'manual-1',
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'b1',
      transactionId: 't1',
      transactionDate: isoDate('2026-11-12'),
      amount: cents(21460),
      part: 'amount',
      confirmed: true,
      by: 'manual',
    };
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('t1c', '2026-11-12', -80, { dispCode: 'D42' }),
      ],
      existing: [manual],
    });
    expect(result.matches.map((m) => m.id)).toEqual(['m-bill-b1-commission-t1c', 'manual-1']);
  });

  it('leaves a commission without linked debit and the stamp duty unmatched', () => {
    const result = run({
      bills: [bill('b1')],
      transactions: [
        tx('t1', '2026-11-12', -21460, { dispCode: 'D42' }),
        tx('orphan', '2026-11-12', -80, { dispCode: 'D99' }),
        tx('bollo', '2026-12-31', -200, { description: 'IMPOSTA DI BOLLO' }),
      ],
    });
    expect(result.matches.map((m) => m.transactionId)).toEqual(['t1']);
    expect(result.unmatchedTransactions).toEqual(['bollo', 'orphan']);
  });
});

describe('splitSharedDebit', () => {
  it('splits the TARI debit by supply totals, with the sign of the items', () => {
    const shares = splitSharedDebit(cents(-18600), [
      { itemId: 'tari-berchet', weight: cents(10075) },
      { itemId: 'tari-lovarini', weight: cents(8471) },
    ]);
    expect(shares).toEqual([
      { itemId: 'tari-berchet', amount: 10104 },
      { itemId: 'tari-lovarini', amount: 8496 },
    ]);
    expect(shares.reduce((sum, { amount }) => sum + amount, 0)).toBe(18600);
  });

  it('gives the odd cent to the first item when the weights are equal', () => {
    expect(
      splitSharedDebit(cents(-1001), [
        { itemId: 'a', weight: cents(500) },
        { itemId: 'b', weight: cents(500) },
      ]),
    ).toEqual([
      { itemId: 'a', amount: 501 },
      { itemId: 'b', amount: 500 },
    ]);
  });

  it('splits an incoming credit into negative shares', () => {
    expect(
      splitSharedDebit(cents(300), [
        { itemId: 'a', weight: cents(1) },
        { itemId: 'b', weight: cents(2) },
      ]),
    ).toEqual([
      { itemId: 'a', amount: -100 },
      { itemId: 'b', amount: -200 },
    ]);
  });

  it('rejects weights that are not positive', () => {
    expect(() => splitSharedDebit(cents(-100), [{ itemId: 'a', weight: cents(0) }])).toThrow(
      RangeError,
    );
    expect(() => splitSharedDebit(cents(-100), [{ itemId: 'a', weight: cents(-5) }])).toThrow(
      RangeError,
    );
    expect(() => splitSharedDebit(cents(-100), [])).toThrow(RangeError);
  });
});

describe('matchToTransactions: shared TARI notice', () => {
  it('matches the single debit on Berchet to both instalments, split by supply', () => {
    const result = run({
      instalments: tariShared(),
      transactions: [tx('t-tari', '2026-03-16', -18600, { description: 'PAGOPA TARI' })],
    });
    expect(result.matches).toEqual([
      expect.objectContaining({
        id: 'm-instalment-tari-berchet-amount-t-tari',
        itemId: 'tari-berchet',
        amount: 10104,
        confirmed: true,
        by: 'auto',
      }),
      expect.objectContaining({
        id: 'm-instalment-tari-lovarini-amount-t-tari',
        itemId: 'tari-lovarini',
        amount: 8496,
        confirmed: true,
        by: 'auto',
      }),
    ]);
    expect(result.pending).toEqual([]);
  });

  it('never matches the instalment of Lovarini to a debit on the account of Lovarini', () => {
    const result = run({
      instalments: tariShared(),
      transactions: [
        tx('t-lov', '2026-03-16', -18600, { apartmentId: 'lovarini' }),
        tx('t-lov-share', '2026-03-16', -8496, { apartmentId: 'lovarini' }),
        tx('t-lov-weight', '2026-03-16', -8471, { apartmentId: 'lovarini' }),
      ],
    });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([
      { itemType: 'instalment', itemId: 'tari-berchet' },
      { itemType: 'instalment', itemId: 'tari-lovarini' },
    ]);
  });

  it('reports a shared notice compatible with two debits under its group id', () => {
    const result = run({
      instalments: tariShared(),
      transactions: [tx('t1', '2026-03-16', -18600), tx('t2', '2026-03-17', -18600)],
    });
    expect(result.ambiguous).toEqual([{ itemId: 'avviso-89064', transactionIds: ['t1', 't2'] }]);
  });

  it('splits the commission of a shared debit over the group by weight', () => {
    const result = run({
      instalments: tariShared(),
      transactions: [
        tx('t1', '2026-03-16', -18600, { dispCode: 'D7' }),
        tx('t1c', '2026-03-16', -80, { dispCode: 'D7' }),
      ],
    });
    const expected = splitSharedDebit(cents(-80), [
      { itemId: 'tari-berchet', weight: cents(10075) },
      { itemId: 'tari-lovarini', weight: cents(8471) },
    ]);
    expect(expected.map(({ amount }) => amount)).toEqual([43, 37]);
    expect(
      result.matches
        .filter((m) => m.part === 'commission')
        .map((m) => ({ itemId: m.itemId, amount: m.amount })),
    ).toEqual(expected);
  });

  it('leaves a shared notice with one instalment only pending, never matched nor assumed', () => {
    const [berchet] = tariShared() as [Instalment, Instalment];
    const debit = tx('t-tari', '2026-03-16', -18600);
    const result = run({ instalments: [berchet], transactions: [debit] });
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([{ itemType: 'instalment', itemId: 'tari-berchet' }]);
    expect(result.invalidGroups).toEqual([{ groupId: 'avviso-89064', reason: 'incomplete' }]);
    expect(result.unmatchedTransactions).toEqual(['t-tari']);
    // Outside every statement it is not taken as paid either.
    const outside = run({ instalments: [berchet], statementPeriods: [] });
    expect(outside.matches).toEqual([]);
    expect(outside.pending).toEqual([{ itemType: 'instalment', itemId: 'tari-berchet' }]);
  });

  it('leaves an inconsistent group pending and reports it', () => {
    const [berchet, lovarini] = tariShared() as [Instalment, Instalment];
    const ownAccount: Instalment = { ...lovarini };
    delete ownAccount.paidFromApartmentId;
    const otherDay: Instalment = { ...lovarini, dueDate: isoDate('2026-03-20') };
    const otherTotal: Instalment = {
      ...lovarini,
      shared: { groupId: 'avviso-89064', groupTotal: cents(18700), weight: cents(8471) },
    };
    const zeroWeight: Instalment = {
      ...lovarini,
      shared: { groupId: 'avviso-89064', groupTotal: cents(18600), weight: cents(0) },
    };
    const debit = tx('t-tari', '2026-03-16', -18600);
    for (const broken of [ownAccount, otherDay, otherTotal, zeroWeight]) {
      for (const statementPeriods of [ALL_OF_2026, []]) {
        const result = run({
          instalments: [berchet, broken],
          transactions: [debit],
          statementPeriods,
        });
        expect(result.matches).toEqual([]);
        expect(result.pending).toEqual([
          { itemType: 'instalment', itemId: 'tari-berchet' },
          { itemType: 'instalment', itemId: 'tari-lovarini' },
        ]);
        expect(result.invalidGroups).toEqual([{ groupId: 'avviso-89064', reason: 'inconsistent' }]);
      }
    }
  });

  it('still matches the other items when a group is invalid, and sorts the groups', () => {
    const [berchet] = tariShared() as [Instalment, Instalment];
    const lone: Instalment = {
      ...berchet,
      id: 'tari-other',
      shared: { groupId: 'avviso-00001', groupTotal: cents(5000), weight: cents(5000) },
    };
    const result = run({
      bills: [bill('b-lov', { apartmentId: 'lovarini' })],
      instalments: [berchet, lone, instalment('i-pulci', { apartmentId: 'pulci' })],
      transactions: [
        tx('t-lov', '2026-11-12', -21460, { apartmentId: 'lovarini' }),
        tx('t-pulci', '2026-10-10', -19800, { apartmentId: 'pulci' }),
      ],
    });
    expect(result.matches.map((m) => m.id)).toEqual([
      'm-bill-b-lov-amount-t-lov',
      'm-instalment-i-pulci-amount-t-pulci',
    ]);
    expect(result.invalidGroups).toEqual([
      { groupId: 'avviso-00001', reason: 'incomplete' },
      { groupId: 'avviso-89064', reason: 'incomplete' },
    ]);
    expect(result.pending).toEqual([
      { itemType: 'instalment', itemId: 'tari-berchet' },
      { itemType: 'instalment', itemId: 'tari-other' },
    ]);
  });

  it('reports no invalid group when every notice is complete', () => {
    expect(run({ instalments: tariShared() }).invalidGroups).toEqual([]);
  });
});

describe('expectedDebit', () => {
  it('is the amount of a bill', () => {
    expect(expectedDebit(bill('b1', { amount: cents(21460) }))).toBe(21460);
    expect(expectedDebit(bill('credit', { amount: cents(-1500) }))).toBe(-1500);
  });

  it("is the whole condominium instalment plus last year's settlement, not the owner's share", () => {
    expect(expectedDebit(instalment('i1'))).toBe(19800);
    expect(expectedDebit(instalment('i2', { conguaglioPrec: cents(-4800) }))).toBe(10200);
  });

  it('is the instalment of a TARI notice, also when the notice is shared', () => {
    const [berchet] = tariShared() as [Instalment, Instalment];
    expect(expectedDebit(berchet)).toBe(10075);
    expect(expectedDebit({ ...berchet, conguaglioPrec: cents(999) })).toBe(10075);
  });
});

describe('validateMatches', () => {
  const tariItem = { itemType: 'instalment' as const, itemId: 'tari-1', expected: cents(13772) };
  const transactions = [
    tx('t1', '2026-03-16', -6886),
    tx('t2', '2026-05-16', -6886),
    tx('t3', '2026-07-16', -10000),
    tx('t4', '2026-09-16', -10000),
  ];
  const part = (id: string, amount: number, extra: Partial<BillMatch> = {}): BillMatch => ({
    id: `m-${id}`,
    v: 1,
    rev: 1,
    itemType: 'instalment',
    itemId: 'tari-1',
    transactionId: id,
    transactionDate: isoDate('2026-03-16'),
    amount: cents(amount),
    part: 'amount',
    confirmed: true,
    by: 'manual',
    ...extra,
  });

  it('accepts a TARI covered by two confirmed parts', () => {
    const matches = [part('t1', 6886), part('t2', 6886)];
    expect(validateMatches({ items: [tariItem], transactions, matches })).toEqual({ errors: [] });
  });

  it('reports item-under with one part only, or none, and ignores unconfirmed parts', () => {
    expect(
      validateMatches({ items: [tariItem], transactions, matches: [part('t1', 6886)] }).errors,
    ).toEqual([{ code: 'item-under', id: 'tari-1' }]);
    expect(validateMatches({ items: [tariItem], transactions, matches: [] }).errors).toEqual([
      { code: 'item-under', id: 'tari-1' },
    ]);
    const unconfirmed = [part('t1', 6886), part('t2', 6886, { confirmed: false })];
    expect(
      validateMatches({ items: [tariItem], transactions, matches: unconfirmed }).errors,
    ).toEqual([{ code: 'item-under', id: 'tari-1' }]);
  });

  it('reports item-over with two parts of 100,00 € on an item of 137,72 €', () => {
    const matches = [part('t3', 10000), part('t4', 10000)];
    expect(validateMatches({ items: [tariItem], transactions, matches }).errors).toEqual([
      { code: 'item-over', id: 'tari-1' },
    ]);
  });

  it('compares a credit note by its magnitude', () => {
    const note = { itemType: 'bill' as const, itemId: 'nc', expected: cents(-3000) };
    const credit = [tx('c1', '2026-03-16', 5000)];
    const match = (amount: number): BillMatch =>
      part('c1', amount, { itemType: 'bill', itemId: 'nc' });
    expect(
      validateMatches({ items: [note], transactions: credit, matches: [match(-3000)] }),
    ).toEqual({ errors: [] });
    expect(
      validateMatches({ items: [note], transactions: credit, matches: [match(-4000)] }).errors,
    ).toEqual([{ code: 'item-over', id: 'nc' }]);
    expect(
      validateMatches({ items: [note], transactions: credit, matches: [match(-1000)] }).errors,
    ).toEqual([{ code: 'item-under', id: 'nc' }]);
  });

  it('reports transaction-over when the parts of a debit, commission included, exceed it', () => {
    const items = [
      { itemType: 'bill' as const, itemId: 'a', expected: cents(5000) },
      { itemType: 'bill' as const, itemId: 'b', expected: cents(5000) },
    ];
    const debit = [tx('d1', '2026-03-16', -10000)];
    const matches = [
      part('d1', 5000, { id: 'm1', itemType: 'bill', itemId: 'a' }),
      part('d1', 5000, { id: 'm2', itemType: 'bill', itemId: 'b' }),
    ];
    expect(validateMatches({ items, transactions: debit, matches })).toEqual({ errors: [] });
    const withCommission = [
      ...matches,
      part('d1', 80, { id: 'm3', itemType: 'bill', itemId: 'a', part: 'commission' }),
    ];
    expect(validateMatches({ items, transactions: debit, matches: withCommission }).errors).toEqual(
      [{ code: 'transaction-over', id: 'd1' }],
    );
  });

  it('does not let a part with the wrong sign make room on a movement', () => {
    const items = [
      { itemType: 'bill' as const, itemId: 'a', expected: cents(10000) },
      { itemType: 'bill' as const, itemId: 'nc', expected: cents(-2000) },
    ];
    const debit = [tx('d1', '2026-03-16', -10000)];
    const matches = [
      part('d1', 10000, { id: 'm1', itemType: 'bill', itemId: 'a' }),
      part('d1', -2000, { id: 'm2', itemType: 'bill', itemId: 'nc' }),
    ];
    expect(validateMatches({ items, transactions: debit, matches }).errors).toEqual([
      { code: 'transaction-over', id: 'd1' },
    ]);
  });

  it('counts an item listed twice once, and rejects it with two amounts', () => {
    const matches = [part('t1', 6886), part('t2', 6886)];
    expect(validateMatches({ items: [tariItem, tariItem], transactions, matches })).toEqual({
      errors: [],
    });
    const other = { ...tariItem, expected: cents(100) };
    expect(() => validateMatches({ items: [tariItem, other], transactions, matches })).toThrow(
      RangeError,
    );
  });

  it('sorts the errors', () => {
    const items = [
      { itemType: 'bill' as const, itemId: 'z', expected: cents(100) },
      { itemType: 'bill' as const, itemId: 'a', expected: cents(100) },
    ];
    const debit = [tx('d1', '2026-03-16', -50)];
    const matches = [part('d1', 200, { itemType: 'bill', itemId: 'z' })];
    expect(validateMatches({ items, transactions: debit, matches }).errors).toEqual([
      { code: 'item-over', id: 'z' },
      { code: 'item-under', id: 'a' },
      { code: 'transaction-over', id: 'd1' },
    ]);
  });
});

describe('tariNote', () => {
  const avviso = {
    number: '2026/1/89064',
    periodLabel: 'gennaio–aprile 2026',
    dueDate: isoDate('2026-03-16'),
  };
  const months = { from: yearMonth('2026-01'), to: yearMonth('2026-04') };

  it('explains the common notice of Berchet and Lovarini, with the transfer between accounts', () => {
    const note = tariNote({
      avviso,
      months,
      transaction: tx('t-tari', '2026-03-16', -18600),
      parts: [
        {
          apartmentName: 'Berchet',
          utenzaTotal: cents(10075),
          share: cents(10104),
          paidFromOtherAccount: false,
        },
        {
          apartmentName: 'Lovarini',
          utenzaTotal: cents(8471),
          share: cents(8496),
          paidFromOtherAccount: true,
        },
      ],
    });
    expect(note).toBe(
      'Avviso 2026/1/89064, periodo gennaio–aprile 2026, mesi assegnati gennaio–aprile 2026. ' +
        'Addebito 186,00 € il 16/03/2026 sul conto di Berchet. ' +
        "Utenze: Berchet 100,75 €, Lovarini 84,71 €; riparto dell'addebito in proporzione: " +
        'Berchet 101,04 €, Lovarini 84,96 €. Storno: Lovarini deve 84,96 € a Berchet.',
    );
  });

  it('writes the issue date of the notice after its number when it is known', () => {
    const note = tariNote({
      avviso: { ...avviso, issueDate: isoDate('2026-02-05') },
      months,
      transaction: tx('t-tari', '2026-03-16', -18600),
      parts: [
        {
          apartmentName: 'Berchet',
          utenzaTotal: cents(18600),
          share: cents(18600),
          paidFromOtherAccount: false,
        },
      ],
    });
    expect(note).toMatch(/^Avviso 2026\/1\/89064 del 05\/02\/2026, periodo gennaio–aprile 2026, /);
    // The due date is the date of the debit, not of the notice: it never replaces the issue date.
    expect(note).not.toContain('16/03/2026, periodo');
  });

  it('has no transfer for a notice of Pulci', () => {
    const note = tariNote({
      avviso: {
        number: '2026/1/12345',
        periodLabel: 'settembre–dicembre 2026',
        dueDate: isoDate('2026-11-16'),
      },
      months: { from: yearMonth('2026-09'), to: yearMonth('2026-12') },
      transaction: tx('t-pulci', '2026-11-16', -123456, { apartmentId: 'pulci' }),
      parts: [
        {
          apartmentName: 'Pulci',
          utenzaTotal: cents(123456),
          share: cents(123456),
          paidFromOtherAccount: false,
        },
      ],
    });
    expect(note).toBe(
      'Avviso 2026/1/12345, periodo settembre–dicembre 2026, mesi assegnati settembre–dicembre 2026. ' +
        'Addebito 1.234,56 € il 16/11/2026 sul conto di Pulci. Utenze: Pulci 1.234,56 €.',
    );
    expect(note).not.toContain('Storno');
  });

  it('names both years when the months span two years, and one month alone', () => {
    const base = {
      avviso,
      transaction: tx('t', '2026-01-05', -500),
      parts: [
        {
          apartmentName: 'Pulci',
          utenzaTotal: cents(500),
          share: cents(500),
          paidFromOtherAccount: false,
        },
      ],
    };
    expect(
      tariNote({ ...base, months: { from: yearMonth('2025-12'), to: yearMonth('2026-01') } }),
    ).toContain('mesi assegnati dicembre 2025–gennaio 2026.');
    expect(
      tariNote({ ...base, months: { from: yearMonth('2026-05'), to: yearMonth('2026-05') } }),
    ).toContain('mesi assegnati maggio 2026.');
  });

  it('requires exactly one part paid from its own account', () => {
    const transaction = tx('t', '2026-03-16', -100);
    const other = {
      apartmentName: 'Lovarini',
      utenzaTotal: cents(50),
      share: cents(50),
      paidFromOtherAccount: true,
    };
    expect(() => tariNote({ avviso, months, transaction, parts: [other] })).toThrow(RangeError);
    const own = { ...other, apartmentName: 'Berchet', paidFromOtherAccount: false };
    expect(() => tariNote({ avviso, months, transaction, parts: [own, own] })).toThrow(RangeError);
  });
});
