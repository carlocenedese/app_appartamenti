import { describe, expect, it } from 'vitest';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  InstalmentSchema,
  MovementClassSchema,
  TransferSchema,
  accountBalances,
  inBalance,
  loadAccountBalances,
  recordPath,
  recordSchemas,
} from '../src/index';
import type {
  Account,
  BankTransaction,
  BillMatch,
  Instalment,
  MatchItemRef,
  MovementClass,
  RecordKind,
  Transfer,
} from '../src/index';
import { snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Synthetic records only, the own accounts of fixtures/README.md and invented amounts (the
// example of section 7 of the design of plan 3c).
const base = { v: 1 as const, rev: 1 };
const account = (id: string, apartmentId: string): Account =>
  AccountSchema.parse({ ...base, id, apartmentId, label: 'Conto', bankProfileId: 'bp' });
const accounts = [
  account('acc-berchet', 'berchet'),
  account('acc-berchet-2', 'berchet'),
  account('acc-lovarini', 'lovarini'),
];

const tx = (id: string, accountId: string, date: string, amount: number): BankTransaction =>
  BankTransactionSchema.parse({
    ...base,
    id,
    apartmentId: accountId === 'acc-lovarini' ? 'lovarini' : 'berchet',
    accountId,
    date,
    amount,
    description: 'ADDEBITO',
    statementHash: 's',
  });

const instalment = (id: string, extra: Record<string, unknown>): Instalment =>
  InstalmentSchema.parse({
    ...base,
    id,
    kind: 'condominio',
    esercizio: '2026-27',
    rateIndex: 1,
    rateCount: 4,
    dueDate: '2027-04-01',
    rata: 30000,
    quotaProprieta: 0,
    conguaglioPrec: 0,
    coversFrom: '2027-04',
    coversTo: '2027-06',
    ...extra,
  });

const match = (
  itemId: string,
  transactionId: string,
  date: string,
  amount: number,
  extra: Partial<BillMatch> = {},
): BillMatch =>
  BillMatchSchema.parse({
    ...base,
    id: `m-instalment-${itemId}-${extra.part ?? 'amount'}-${transactionId}`,
    itemType: 'instalment',
    itemId,
    transactionId,
    transactionDate: date,
    amount,
    part: 'amount',
    confirmed: true,
    by: 'auto',
    ...extra,
  });

const cls = (transactionId: string, extra: Record<string, unknown>): MovementClass =>
  MovementClassSchema.parse({ ...base, id: `mc-${transactionId}`, transactionId, ...extra });

const transfer = (id: string, extra: Record<string, unknown> = {}): Transfer =>
  TransferSchema.parse({
    ...base,
    id,
    fromAccountId: 'acc-lovarini',
    toAccountId: 'acc-berchet',
    amount: 20000,
    date: '2027-04-20',
    outTransactionId: `${id}-o`,
    inTransactionId: `${id}-i`,
    purpose: 'saldo',
    source: 'confirmed',
    ...extra,
  });

// The TARI shared by Berchet and Lovarini, paid from the account of Berchet (R3: 84,96 € of
// Lovarini); the condominium instalment of Lovarini (300,00 € plus 0,80 € of commission, R7);
// a bank transfer of 50,00 € to a supplier of Berchet; Lovarini → Berchet 200,00 € «saldo».
const tari = { kind: 'tari', esercizio: '2027', coversFrom: '2027-01', coversTo: '2027-12' };
const shared = (weight: number) => ({ groupId: 'avviso-1', groupTotal: 18600, weight });
const example = {
  accounts,
  instalments: [
    instalment('tari-b', { ...tari, apartmentId: 'berchet', rata: 10104, shared: shared(10104) }),
    instalment('tari-l', {
      ...tari,
      apartmentId: 'lovarini',
      paidFromApartmentId: 'berchet',
      rata: 8496,
      shared: shared(8496),
    }),
    instalment('condo-l', { apartmentId: 'lovarini', paidFromApartmentId: 'berchet' }),
    instalment('condo-b', { apartmentId: 'berchet' }),
  ],
  matches: [
    match('tari-b', 't-tari', '2027-03-31', 10104),
    match('tari-l', 't-tari', '2027-03-31', 8496),
    match('condo-l', 't-condo', '2027-04-05', 30000),
    match('condo-l', 't-comm', '2027-04-05', 80, { part: 'commission' }),
    match('condo-b', 't-condo-b', '2027-04-05', 30000),
  ],
  assumed: [] as MatchItemRef[],
  transactions: [
    tx('t-tari', 'acc-berchet', '2027-03-31', -18600),
    tx('t-condo', 'acc-berchet', '2027-04-05', -30000),
    tx('t-comm', 'acc-berchet', '2027-04-05', -80),
    tx('t-condo-b', 'acc-berchet', '2027-04-05', -30000),
    tx('t-forn', 'acc-berchet', '2027-04-10', -5000),
  ],
  classes: [cls('t-forn', { kind: 'altro', apartmentId: 'berchet' })],
  transfers: [transfer('tr-1')],
};
type Input = Parameters<typeof accountBalances>[0];
const withExtra = (extra: Partial<{ [K in keyof Input]: Input[K] }>): Input => ({
  ...example,
  ...Object.fromEntries(
    Object.entries(extra).map(([k, v]) => [k, [...example[k as keyof Input], ...v]]),
  ),
});

const items = [
  {
    date: '2027-03-31',
    kind: 'rata',
    payerApartmentId: 'berchet',
    forApartmentId: 'lovarini',
    amount: 8496,
    refId: 'tari-l',
  },
  {
    date: '2027-04-05',
    kind: 'commissione',
    payerApartmentId: 'berchet',
    forApartmentId: 'lovarini',
    amount: 80,
    refId: 'condo-l',
  },
  {
    date: '2027-04-05',
    kind: 'rata',
    payerApartmentId: 'berchet',
    forApartmentId: 'lovarini',
    amount: 30000,
    refId: 'condo-l',
  },
  {
    date: '2027-04-20',
    kind: 'giroconto',
    payerApartmentId: 'berchet',
    forApartmentId: 'lovarini',
    amount: -20000,
    refId: 'tr-1',
  },
];
const net = (input: Input) => accountBalances(input).pairs.map((p) => p.amount);

describe('accountBalances (plan 3c, task 9)', () => {
  it('gives the example of the design: Lovarini owes Berchet 185,76 €', () => {
    expect(accountBalances(example)).toEqual({
      pairs: [
        { creditorApartmentId: 'berchet', debtorApartmentId: 'lovarini', amount: 18576, items },
      ],
      toSplit: [],
      unverified: [],
    });
  });

  it('counts the «saldo» transfers both ways, never «mutuo» nor within one apartment', () => {
    const back = transfer('tr-2', {
      fromAccountId: 'acc-berchet',
      toAccountId: 'acc-lovarini',
      amount: 5000,
    });
    const result = accountBalances(withExtra({ transfers: [back] }));
    expect(result.pairs[0]?.amount).toBe(23576);
    expect(result.pairs[0]?.items.at(-1)).toEqual({
      date: '2027-04-20',
      kind: 'giroconto',
      payerApartmentId: 'lovarini',
      forApartmentId: 'berchet',
      amount: -5000,
      refId: 'tr-2',
    });
    const mutuo = transfer('tr-3', { purpose: 'mutuo' });
    const own = transfer('tr-4', { fromAccountId: 'acc-berchet-2' });
    const gone = transfer('tr-5', { deleted: true });
    expect(net(withExtra({ transfers: [mutuo, own, gone] }))).toEqual([18576]);
  });

  it('dates a transfer across the year on its record (first leg), never on the legs', () => {
    const across = transfer('tr-y', { date: '2027-12-29', amount: 100 });
    const legs = [
      tx('tr-y-o', 'acc-lovarini', '2027-12-29', -100),
      tx('tr-y-i', 'acc-berchet', '2028-01-03', 100),
    ];
    const result = accountBalances(withExtra({ transfers: [across], transactions: legs }));
    expect(result.pairs[0]?.items.at(-1)).toMatchObject({ date: '2027-12-29', refId: 'tr-y' });
  });

  it('takes an F24 of another apartment whole and lists the own one to split', () => {
    const f24 = { kind: 'tasse', f24: true };
    const result = accountBalances(
      withExtra({
        transactions: [
          tx('t-f24-l', 'acc-berchet', '2027-05-16', -6700),
          tx('t-f24-b', 'acc-berchet', '2027-06-16', -12000),
        ],
        classes: [
          cls('t-f24-l', { ...f24, apartmentId: 'lovarini' }),
          cls('t-f24-b', { ...f24, apartmentId: 'berchet' }),
        ],
      }),
    );
    expect(result.pairs[0]?.amount).toBe(18576 + 6700);
    expect(result.pairs[0]?.items.at(-1)).toEqual({
      date: '2027-05-16',
      kind: 'f24',
      payerApartmentId: 'berchet',
      forApartmentId: 'lovarini',
      amount: 6700,
      refId: 't-f24-l',
    });
    expect(result.toSplit).toEqual([
      { transactionId: 't-f24-b', apartmentId: 'berchet', date: '2027-06-16' },
    ]);
  });

  it('counts the automatic classes too and a refund lowers the debt (user1, 15 November)', () => {
    const result = accountBalances({
      accounts,
      instalments: [],
      matches: [],
      assumed: [],
      transactions: [
        tx('t-asso', 'acc-berchet', '2027-02-01', -4000),
        tx('t-rimb', 'acc-berchet', '2027-02-10', 1230),
      ],
      classes: [
        cls('t-asso', { kind: 'altro', apartmentId: 'lovarini', ruleId: 'rule-t-0' }),
        cls('t-rimb', { kind: 'utenze', apartmentId: 'lovarini' }),
      ],
      transfers: [],
    });
    expect(result.pairs).toEqual([
      {
        creditorApartmentId: 'berchet',
        debtorApartmentId: 'lovarini',
        amount: 2770,
        items: [
          expect.objectContaining({ kind: 'uscita', amount: 4000, refId: 't-asso' }),
          expect.objectContaining({ kind: 'uscita', amount: -1230, refId: 't-rimb' }),
        ],
      },
    ]);
    expect(inBalance(cls('t-asso', { kind: 'altro', apartmentId: 'lovarini' }))).toBe(true);
  });

  it('lists an assumed instalment paid for another apartment apart, out of the net', () => {
    const presunta = instalment('condo-l-2025', {
      apartmentId: 'lovarini',
      paidFromApartmentId: 'berchet',
      esercizio: '2025-26',
      dueDate: '2025-04-01',
      coversFrom: '2025-04',
      coversTo: '2025-06',
    });
    const ownAssumed = instalment('condo-b-2025', { apartmentId: 'berchet' });
    const result = accountBalances({
      ...withExtra({ instalments: [presunta, ownAssumed] }),
      assumed: [
        { itemType: 'instalment', itemId: 'condo-l-2025' },
        { itemType: 'instalment', itemId: 'condo-b-2025' },
        { itemType: 'bill', itemId: 'b-1' },
      ],
    });
    expect(result.pairs[0]?.amount).toBe(18576);
    expect(result.unverified).toEqual([
      {
        itemType: 'instalment',
        itemId: 'condo-l-2025',
        payerApartmentId: 'berchet',
        forApartmentId: 'lovarini',
      },
    ]);
  });

  it('leaves out exclusions, deleted classes, unconfirmed or assumed matches and tenants', () => {
    const result = accountBalances(
      withExtra({
        transactions: [
          tx('t-escl', 'acc-berchet', '2027-05-01', -999),
          tx('t-del', 'acc-berchet', '2027-05-02', -999),
          tx('t-prop', 'acc-berchet', '2027-05-03', -30000),
          // A rent paid by a tenant on the account of Berchet: it never counts (question 11).
          tx('t-canone', 'acc-berchet', '2027-05-04', 70000),
        ],
        classes: [
          cls('t-escl', { kind: 'escluso', excludeReason: 'doppione' }),
          cls('t-del', { kind: 'altro', apartmentId: 'lovarini', deleted: true }),
          cls('t-missing', { kind: 'altro', apartmentId: 'lovarini' }),
        ],
        matches: [
          match('condo-l', 't-prop', '2027-05-03', 30000, { confirmed: false }),
          match('condo-l', 't-del', '2027-05-02', 999, { deleted: true }),
        ],
        instalments: [
          instalment('condo-gone', {
            apartmentId: 'lovarini',
            paidFromApartmentId: 'berchet',
            deleted: true,
          }),
        ],
      }),
    );
    expect(result.pairs).toEqual([
      { creditorApartmentId: 'berchet', debtorApartmentId: 'lovarini', amount: 18576, items },
    ]);
    // The class of a deleted movement does not count either.
    const deletedTx = { ...tx('t-gone', 'acc-berchet', '2027-05-03', -999), deleted: true };
    expect(
      net({
        ...example,
        transactions: [...example.transactions, deletedTx],
        classes: [cls('t-gone', { kind: 'altro', apartmentId: 'lovarini' })],
      }),
    ).toEqual([18576]);
  });

  it('nets to zero with the first apartment by compareText as the creditor', () => {
    const back = transfer('tr-z', {
      fromAccountId: 'acc-berchet',
      toAccountId: 'acc-lovarini',
      amount: 1000,
    });
    const result = accountBalances({
      accounts,
      instalments: [],
      matches: [],
      assumed: [],
      transactions: [tx('t-l', 'acc-lovarini', '2027-01-05', -1000)],
      classes: [cls('t-l', { kind: 'altro', apartmentId: 'berchet' })],
      transfers: [back],
    });
    expect(result.pairs).toEqual([
      {
        creditorApartmentId: 'berchet',
        debtorApartmentId: 'lovarini',
        amount: 0,
        items: [
          expect.objectContaining({ kind: 'uscita', payerApartmentId: 'lovarini', amount: 1000 }),
          expect.objectContaining({ kind: 'giroconto', payerApartmentId: 'lovarini' }),
        ],
      },
    ]);
  });

  it('gives the same result in any order of the input', () => {
    const input = withExtra({
      transfers: [transfer('tr-2', { fromAccountId: 'acc-berchet', toAccountId: 'acc-lovarini' })],
      transactions: [tx('t-f24-b', 'acc-berchet', '2027-06-16', -12000)],
      classes: [cls('t-f24-b', { kind: 'tasse', f24: true, apartmentId: 'berchet' })],
    });
    const shuffled = Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, [...(v as unknown[])].reverse()]),
    ) as unknown as Input;
    expect(accountBalances(shuffled)).toEqual(accountBalances(input));
  });
});

describe('loadAccountBalances (plan 3c, task 9)', () => {
  async function put(store: MemoryStore, kind: RecordKind, records: { id: string }[]) {
    for (const r of records) {
      await store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
    }
  }

  it('reads the records, lists the assumed items apart and writes nothing', async () => {
    const store = new MemoryStore();
    await put(store, 'account', accounts);
    // No statement at all: the instalment of Lovarini paid from Berchet is assumed paid.
    await put(store, 'instalment', [
      instalment('condo-l', { apartmentId: 'lovarini', paidFromApartmentId: 'berchet' }),
    ]);
    await put(store, 'transaction', [tx('t-f24-l', 'acc-berchet', '2027-05-16', -6700)]);
    await put(store, 'movementClass', [
      cls('t-f24-l', { kind: 'tasse', f24: true, apartmentId: 'lovarini' }),
    ]);
    await put(store, 'transfer', [
      transfer('tr-1', {
        source: 'manual',
        outTransactionId: undefined,
        inTransactionId: undefined,
      }),
    ]);
    const before = await snapshot(store);
    const result = await loadAccountBalances(store);
    expect(result.pairs.map((p) => [p.creditorApartmentId, p.amount])).toEqual([
      ['lovarini', 20000 - 6700],
    ]);
    expect(result.unverified).toEqual([
      {
        itemType: 'instalment',
        itemId: 'condo-l',
        payerApartmentId: 'berchet',
        forApartmentId: 'lovarini',
      },
    ]);
    expect(await snapshot(store)).toEqual(before);
  });
});
