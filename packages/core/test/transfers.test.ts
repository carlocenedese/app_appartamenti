import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  BankTransactionSchema,
  TRANSFER_LEG_DAYS,
  TransferSchema,
  cents,
  reconcileTransfers,
} from '../src/index';
import type { Account, BankTransaction, Transfer } from '../src/index';

// Synthetic records only: the test IBANs of fixtures/README.md (own accounts …0301, …0302, a
// supplier …0401).
const BERCHET = 'IT85X0542811101000000000301';
const LOVARINI = 'IT58X0542811101000000000302';
const SUPPLIER = 'IT04X0542811101000000000401';
const base = { v: 1 as const, rev: 1 };

const account = (id: string, iban: string | undefined, extra = {}): Account =>
  AccountSchema.parse({
    ...base,
    id,
    apartmentId: id.replace('acc-', ''),
    label: 'Conto',
    bankProfileId: 'bp',
    ...(iban === undefined ? {} : { iban }),
    ...extra,
  });
const accounts = [account('acc-berchet', BERCHET), account('acc-lovarini', LOVARINI)];

/** A movement of `accountId`; `iban` is the counterparty's, as the statement writes it. */
const tx = (
  id: string,
  accountId: string,
  date: string,
  amount: number,
  iban?: string,
  extra = {},
): BankTransaction =>
  BankTransactionSchema.parse({
    ...base,
    id,
    apartmentId: accountId.replace('acc-', ''),
    accountId,
    date,
    amount,
    description: 'BONIFICO',
    statementHash: 's',
    ...(iban === undefined ? {} : { counterparty: { name: 'Conto', iban } }),
    ...extra,
  });

const transfer = (id: string, extra: Record<string, unknown> = {}): Transfer =>
  TransferSchema.parse({
    ...base,
    id,
    fromAccountId: 'acc-lovarini',
    toAccountId: 'acc-berchet',
    amount: 20000,
    date: '2027-03-01',
    outTransactionId: id.replace('tr-', ''),
    purpose: 'saldo',
    source: 'confirmed',
    ...extra,
  });

const run = (transactions: BankTransaction[], transfers: Transfer[] = [], used: string[] = []) =>
  reconcileTransfers({ accounts, transactions, transfers, used: new Set(used) });

// −200,00 € from the account of Lovarini, the IBAN of Berchet written with spaces and small letters.
const out = (date = '2027-04-02', id = 'o') =>
  tx(id, 'acc-lovarini', date, -20000, 'it85 x054 2811 1010 0000 0000 301');
const inn = (date: string, id = 'i') => tx(id, 'acc-berchet', date, 20000);

describe('reconcileTransfers: the legs (plan 3c, task 5)', () => {
  it('pairs the outgoing with the incoming of the other account within 5 days', () => {
    expect(TRANSFER_LEG_DAYS).toBe(5);
    expect(run([out(), inn('2027-04-07')])).toEqual({
      transfers: [],
      completed: [],
      proposals: [
        {
          id: 'p-giro-o',
          transactionId: 'o',
          fromAccountId: 'acc-lovarini',
          toAccountId: 'acc-berchet',
          legIds: ['i'],
          reason: 'new-pair',
        },
      ],
    });
  });

  it.each([
    ['2027-04-07', ['i']],
    ['2027-04-08', []],
    ['2027-03-28', ['i']],
    ['2027-03-27', []],
  ])('an incoming on %s: legs %j (5 days yes, 6 no, both ways)', (date, legIds) => {
    expect(run([out(), inn(date)]).proposals).toMatchObject([{ id: 'p-giro-o', legIds }]);
  });

  it.each([
    ['2027-12-30', '2028-01-03', ['i']],
    ['2027-12-30', '2028-01-04', ['i']],
    ['2027-12-30', '2028-01-05', []],
    ['2028-01-03', '2027-12-29', ['i']],
    ['2028-01-03', '2027-12-28', []],
  ])('across the year: out %s, in %s: legs %j', (outDate, inDate, legIds) => {
    expect(run([out(outDate), inn(inDate)]).proposals).toMatchObject([{ legIds }]);
  });

  it('several candidate legs: several-legs, sorted, never linked by themselves', () => {
    const result = run([out(), inn('2027-04-04', 'i2'), inn('2027-04-03', 'i1')]);
    expect(result.transfers).toEqual([]);
    expect(result.proposals).toEqual([
      expect.objectContaining({ id: 'p-giro-o', legIds: ['i1', 'i2'], reason: 'several-legs' }),
    ]);
  });

  it('the same amount with the same sign, another amount or the same account is no leg', () => {
    const result = run([
      out(),
      tx('same-sign', 'acc-berchet', '2027-04-03', -20000),
      tx('other-amount', 'acc-berchet', '2027-04-03', 20001),
      tx('same-account', 'acc-lovarini', '2027-04-03', 20000),
    ]);
    expect(result.proposals).toMatchObject([{ id: 'p-giro-o', legIds: [] }]);
  });

  it('an incoming with the IBAN of the other account: from the other account, one leg is enough', () => {
    expect(run([tx('i', 'acc-berchet', '2027-04-07', 20000, LOVARINI)]).proposals).toEqual([
      {
        id: 'p-giro-i',
        transactionId: 'i',
        fromAccountId: 'acc-lovarini',
        toAccountId: 'acc-berchet',
        legIds: [],
        reason: 'new-pair',
      },
    ]);
  });

  it('outgoings first: a movement taken as a leg is no candidate any more', () => {
    // Both legs name the other account; the incoming comes first by date, the outgoing first by sign.
    const result = run([tx('i', 'acc-berchet', '2027-04-01', 20000, LOVARINI), out()]);
    expect(result.proposals.map((p) => [p.id, p.legIds])).toEqual([['p-giro-o', ['i']]]);
  });

  it('two outgoings and one incoming: the earlier outgoing takes it, by date then id', () => {
    const result = run([out('2027-04-03', 'o2'), out('2027-04-02', 'o1'), inn('2027-04-04')]);
    expect(result.proposals.map((p) => [p.id, p.legIds])).toEqual([
      ['p-giro-o1', ['i']],
      ['p-giro-o2', []],
    ]);
  });

  it('never a transfer: a supplier, a wrong check digit, a name alone, its own account', () => {
    const result = run([
      tx('supplier', 'acc-lovarini', '2027-04-02', -20000, SUPPLIER),
      // The IBAN of Berchet with a check digit changed: not valid, so never an own account.
      tx('wrong-check', 'acc-lovarini', '2027-04-02', -20000, BERCHET.replace('IT85', 'IT86')),
      tx('name-only', 'acc-lovarini', '2027-04-02', -20000, undefined, {
        counterparty: { name: 'Conto Berchet' },
      }),
      // The spaced form of the brief has one 0 too many (28 characters): not the same IBAN.
      tx('extra-zero', 'acc-lovarini', '2027-04-02', -20000, 'it85 x054 2811 1010 0000 0000 0301'),
      tx('own', 'acc-lovarini', '2027-04-02', -20000, LOVARINI),
      tx('zero', 'acc-lovarini', '2027-04-02', 0, BERCHET),
      inn('2027-04-03'),
    ]);
    expect(result).toEqual({ transfers: [], completed: [], proposals: [] });
  });

  it('skips deleted or used movements, movements without a live account and deleted accounts', () => {
    expect(run([out('2027-04-02', 'gone')].map((t) => ({ ...t, deleted: true })))).toEqual({
      transfers: [],
      completed: [],
      proposals: [],
    });
    expect(run([out()], [], ['o']).proposals).toEqual([]);
    expect(run([out(), inn('2027-04-03')], [], ['i']).proposals).toMatchObject([{ legIds: [] }]);
    expect(run([out(), { ...inn('2027-04-03', 'i-gone'), deleted: true }]).proposals).toMatchObject(
      [{ legIds: [] }],
    );
    expect(run([{ ...out(), accountId: undefined }]).proposals).toEqual([]);
    const closed = [accounts[0] as Account, { ...(accounts[1] as Account), deleted: true }];
    expect(
      reconcileTransfers({
        accounts: closed,
        transactions: [out(), tx('to-closed', 'acc-berchet', '2027-04-02', -100, LOVARINI)],
        transfers: [],
        used: new Set(),
      }).proposals,
    ).toEqual([]);
  });
});

describe('reconcileTransfers: completing a transfer with one leg (fix round 1)', () => {
  // Confirmed with the incoming of Berchet only; the statement of Lovarini comes in later.
  const half = (extra: Record<string, unknown> = {}) =>
    transfer('tr-i', {
      outTransactionId: undefined,
      inTransactionId: 'i',
      date: '2027-04-07',
      ...extra,
    });
  const later = (transactions: BankTransaction[], transfers: Transfer[] = [half()]) =>
    run([inn('2027-04-07'), ...transactions], transfers, ['i']);

  it('the missing outgoing completes it: no new transfer, no proposal', () => {
    expect(later([out('2027-04-02')])).toEqual({
      transfers: [],
      completed: [
        {
          id: 'tr-i',
          v: 1,
          rev: 1,
          fromAccountId: 'acc-lovarini',
          toAccountId: 'acc-berchet',
          amount: 20000,
          date: '2027-04-07',
          outTransactionId: 'o',
          inTransactionId: 'i',
          purpose: 'saldo',
          source: 'confirmed',
        },
      ],
      proposals: [],
    });
  });

  it('a missing incoming completes a transfer with the outgoing only, one-off too', () => {
    const outOnly = transfer('tr-o', { oneOff: true, date: '2027-04-02' });
    const result = run(
      [out(), tx('i', 'acc-berchet', '2027-04-07', 20000, LOVARINI)],
      [outOnly],
      ['o'],
    );
    expect(result.completed).toEqual([
      expect.objectContaining({ id: 'tr-o', outTransactionId: 'o', inTransactionId: 'i' }),
    ]);
    expect(result.transfers).toEqual([]);
    expect(result.proposals).toEqual([]);
  });

  it.each([
    ['6 days before', [out('2027-04-01')], [half()]],
    ['another amount', [{ ...out('2027-04-02'), amount: cents(-20001) }], [half()]],
    [
      'the other direction',
      [out('2027-04-02')],
      [half({ fromAccountId: 'acc-berchet', toAccountId: 'acc-lovarini' })],
    ],
    ['a transfer with both legs', [out('2027-04-02')], [half({ outTransactionId: 'x' })]],
    ['a deleted transfer', [out('2027-04-02')], [half({ deleted: true })]],
  ])('not completed with %s', (_, transactions, transfers) => {
    expect(later(transactions as BankTransaction[], transfers as Transfer[]).completed).toEqual([]);
  });

  it('5 days is still the window, across the year too', () => {
    const across = half({ date: '2028-01-03' });
    const result = run([{ ...inn('2028-01-03'), id: 'i' }, out('2027-12-29')], [across], ['i']);
    expect(result.completed).toHaveLength(1);
  });

  it('one transfer is completed once: a second outgoing is a candidate as usual', () => {
    const result = later([out('2027-04-02', 'o1'), out('2027-04-03', 'o2')]);
    expect(result.completed.map((t) => t.outTransactionId)).toEqual(['o1']);
    expect(result.transfers.map((t) => t.id)).toEqual(['tr-o2']);
  });
});

describe('reconcileTransfers: automatic after the first confirmation (question 4)', () => {
  const may = [out('2027-05-03', 'o2'), inn('2027-05-05', 'i2')].map((t) => ({
    ...t,
    amount: t.amount < 0 ? -15000 : 15000,
  })) as BankTransaction[];

  it('the same pair and direction, one purpose: an automatic transfer with its two legs', () => {
    expect(run(may, [transfer('tr-o')])).toEqual({
      transfers: [
        {
          id: 'tr-o2',
          fromAccountId: 'acc-lovarini',
          toAccountId: 'acc-berchet',
          amount: 15000,
          date: '2027-05-03',
          outTransactionId: 'o2',
          inTransactionId: 'i2',
          purpose: 'saldo',
          source: 'auto',
        },
      ],
      completed: [],
      proposals: [],
    });
  });

  it('an automatic transfer with one leg only, from the incoming: dated on it', () => {
    const only = tx('i3', 'acc-berchet', '2027-06-01', 9000, LOVARINI);
    expect(run([only], [transfer('tr-o', { purpose: 'mutuo' })]).transfers).toEqual([
      {
        id: 'tr-i3',
        fromAccountId: 'acc-lovarini',
        toAccountId: 'acc-berchet',
        amount: 9000,
        date: '2027-06-01',
        inTransactionId: 'i3',
        purpose: 'mutuo',
        source: 'auto',
      },
    ]);
  });

  it('the other direction, a one-off, an automatic or deleted transfer: still new-pair', () => {
    const back = [tx('b', 'acc-berchet', '2027-05-03', -15000, LOVARINI)];
    expect(run(back, [transfer('tr-o')]).proposals).toMatchObject([{ reason: 'new-pair' }]);
    for (const extra of [
      { oneOff: true as const },
      { source: 'auto' as const },
      { deleted: true },
    ]) {
      const result = run(may, [transfer('tr-o', extra)]);
      expect(result.transfers).toEqual([]);
      expect(result.proposals).toMatchObject([{ id: 'p-giro-o2', reason: 'new-pair' }]);
      expect(result.proposals[0]).not.toHaveProperty('purpose');
    }
  });

  it('two purposes for the pair: purpose-conflict, without a purpose', () => {
    const result = run(may, [transfer('tr-o'), transfer('tr-x', { purpose: 'altro' })]);
    expect(result.transfers).toEqual([]);
    expect(result.proposals).toEqual([
      expect.objectContaining({ id: 'p-giro-o2', legIds: ['i2'], reason: 'purpose-conflict' }),
    ]);
    expect(result.proposals[0]).not.toHaveProperty('purpose');
  });

  it('several legs on a known pair: several-legs with the purpose of the pair', () => {
    const extra = tx('i2b', 'acc-berchet', '2027-05-06', 15000);
    expect(run([...may, extra], [transfer('tr-o')])).toEqual({
      transfers: [],
      completed: [],
      proposals: [expect.objectContaining({ reason: 'several-legs', purpose: 'saldo' })],
    });
  });

  it('an automatic transfer takes its leg: no second candidate on it', () => {
    const both = [
      { ...(may[0] as BankTransaction) },
      tx('i2', 'acc-berchet', '2027-05-05', 15000, LOVARINI),
    ];
    const result = run(both, [transfer('tr-o')]);
    expect(result.transfers.map((t) => t.id)).toEqual(['tr-o2']);
    expect(result.proposals).toEqual([]);
  });
});

describe('TransferSchema (plan 3c, task 5)', () => {
  const valid = {
    ...base,
    id: 'tr-o',
    fromAccountId: 'acc-lovarini',
    toAccountId: 'acc-berchet',
    amount: 20000,
    date: '2027-04-02',
    outTransactionId: 'o',
    purpose: 'saldo',
    source: 'confirmed',
  };
  it('accepts a transfer with one or two legs, and a manual one without', () => {
    expect(TransferSchema.safeParse(valid).success).toBe(true);
    expect(TransferSchema.safeParse({ ...valid, inTransactionId: 'i', oneOff: true }).success).toBe(
      true,
    );
    const manual = { ...valid, outTransactionId: undefined, source: 'manual' };
    expect(TransferSchema.safeParse(manual).success).toBe(true);
  });
  it.each([
    ['the same account', { toAccountId: 'acc-lovarini' }],
    ['an amount of zero', { amount: 0 }],
    ['a negative amount', { amount: -1 }],
    ['manual with a movement', { source: 'manual' }],
    ['confirmed without a movement', { outTransactionId: undefined }],
    ['oneOff false', { oneOff: false }],
    ['another purpose', { purpose: 'regalo' }],
  ])('refuses %s', (_, extra) => {
    expect(TransferSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
});
