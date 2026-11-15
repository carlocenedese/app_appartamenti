/**
 * The balance between accounts (plan 3c, task 9; section 24, R131): for each pair of apartments,
 * who owes whom and the items behind it. An item says that `forApartmentId` owes `amount` to
 * `payerApartmentId`:
 *
 * - `rata` / `commissione`: a live confirmed match (never `assumed`) of a live instalment of Y
 *   paid from the account of X (`paidFromApartmentId`), with its share `m.amount`; the commission
 *   follows it (R7, question 10);
 * - `uscita` / `f24`: a class that passes `inBalance` on a movement of an account of X with an
 *   `apartmentId` Y ≠ X, for `-tx.amount` (a refund lowers the debt); an F24 of X itself is
 *   listed in `toSplit`, with no amount (decision 9, question 5);
 * - `giroconto`: a live «saldo» transfer from an account of F to one of T, for `-amount` owed by F
 *   to T, dated on the record (the first leg), never computed again from the legs.
 *
 * Items taken as paid with no statement (`assumed`) are listed in `unverified`, never in the net
 * (question 11); the income of the tenants never counts. Nothing depends on the input order.
 */
import type { MatchItemRef, MatchItemType } from './match';
import { checkConsistency } from './journal';
import { planMatch } from './match-store';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  InstalmentSchema,
  MovementClassSchema,
  TransferSchema,
} from './model';
import type {
  Account,
  BankTransaction,
  BillMatch,
  Instalment,
  MovementClass,
  Transfer,
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';

export interface BalanceItem {
  date: ISODate;
  kind: 'rata' | 'commissione' | 'uscita' | 'f24' | 'giroconto';
  payerApartmentId: string;
  forApartmentId: string;
  /** Positive: what `forApartmentId` owes to `payerApartmentId`. */
  amount: Cents;
  /** The instalment, the movement or the transfer. */
  refId: string;
}

export interface BalancePair {
  creditorApartmentId: string;
  debtorApartmentId: string;
  /** Never negative; at 0 the creditor is the first by `compareText`. */
  amount: Cents;
  items: BalanceItem[];
}

export interface BalanceInput {
  accounts: Account[];
  instalments: Instalment[];
  matches: BillMatch[];
  assumed: MatchItemRef[];
  transactions: BankTransaction[];
  classes: MovementClass[];
  transfers: Transfer[];
}

export interface AccountBalances {
  pairs: BalancePair[];
  toSplit: { transactionId: string; apartmentId: string; date: ISODate }[];
  unverified: {
    itemType: MatchItemType;
    itemId: string;
    payerApartmentId: string;
    forApartmentId: string;
  }[];
}

/**
 * The one rule on which classes count (user1, 15 November 2026): every live class that is no
 * exclusion, the automatic ones (from a confirmed rule) too. «Only by hand» would add
 * `&& c.ruleId === undefined` here and nowhere else.
 */
export const inBalance = (c: MovementClass): boolean => c.deleted !== true && c.kind !== 'escluso';

const live = <T extends { deleted?: boolean }>(records: T[]): T[] =>
  records.filter((r) => r.deleted !== true);

export function accountBalances(input: BalanceInput): AccountBalances {
  // Deleted accounts too: the money did move.
  const apartmentOfAccount = new Map(input.accounts.map((a) => [a.id, a.apartmentId]));
  const instalments = new Map(live(input.instalments).map((i) => [i.id, i]));
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  const items: BalanceItem[] = [];
  const toSplit: AccountBalances['toSplit'] = [];

  // By match id first: two parts of one instalment on the same day then follow their movement.
  for (const m of live(input.matches).sort((a, b) => compareText(a.id, b.id))) {
    const item = m.itemType === 'instalment' ? instalments.get(m.itemId) : undefined;
    const payer = item?.paidFromApartmentId;
    if (item === undefined || payer === undefined || payer === item.apartmentId) continue;
    if (!m.confirmed || m.by === 'assumed') continue;
    items.push({
      date: m.transactionDate,
      kind: m.part === 'commission' ? 'commissione' : 'rata',
      payerApartmentId: payer,
      forApartmentId: item.apartmentId,
      amount: m.amount,
      refId: item.id,
    });
  }

  for (const c of input.classes.filter(inBalance)) {
    const tx = transactions.get(c.transactionId);
    if (tx === undefined || c.apartmentId === undefined) continue;
    const payer =
      (tx.accountId === undefined ? undefined : apartmentOfAccount.get(tx.accountId)) ??
      tx.apartmentId;
    if (c.apartmentId === payer) {
      if (c.f24 === true) toSplit.push({ transactionId: tx.id, apartmentId: payer, date: tx.date });
      continue;
    }
    items.push({
      date: tx.date,
      kind: c.f24 === true ? 'f24' : 'uscita',
      payerApartmentId: payer,
      forApartmentId: c.apartmentId,
      amount: cents(-tx.amount),
      refId: tx.id,
    });
  }

  for (const t of live(input.transfers)) {
    const from = apartmentOfAccount.get(t.fromAccountId);
    const to = apartmentOfAccount.get(t.toAccountId);
    if (t.purpose !== 'saldo' || from === undefined || to === undefined || from === to) continue;
    items.push({
      date: t.date,
      kind: 'giroconto',
      payerApartmentId: to,
      forApartmentId: from,
      amount: cents(-t.amount),
      refId: t.id,
    });
  }

  items.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      compareText(a.kind, b.kind) ||
      compareText(a.refId, b.refId) ||
      compareText(a.payerApartmentId, b.payerApartmentId),
  );
  const byPair = new Map<string, { first: string; second: string; items: BalanceItem[] }>();
  for (const item of items) {
    const [first, second] = [item.payerApartmentId, item.forApartmentId].sort(compareText) as [
      string,
      string,
    ];
    const key = `${first}\u0000${second}`;
    const pair = byPair.get(key) ?? { first, second, items: [] };
    pair.items.push(item);
    byPair.set(key, pair);
  }
  const pairs = [...byPair.values()]
    .map(({ first, second, items: pairItems }): BalancePair => {
      // What `second` owes to `first`.
      const owed = pairItems.reduce(
        (sum, i) => sum + (i.payerApartmentId === first ? i.amount : -i.amount),
        0,
      );
      return owed >= 0
        ? {
            creditorApartmentId: first,
            debtorApartmentId: second,
            amount: cents(owed),
            items: pairItems,
          }
        : {
            creditorApartmentId: second,
            debtorApartmentId: first,
            amount: cents(-owed),
            items: pairItems,
          };
    })
    .sort(
      (a, b) =>
        compareText(a.creditorApartmentId, b.creditorApartmentId) ||
        compareText(a.debtorApartmentId, b.debtorApartmentId),
    );

  const unverified = input.assumed
    .flatMap(({ itemType, itemId }) => {
      const item = itemType === 'instalment' ? instalments.get(itemId) : undefined;
      const payer = item?.paidFromApartmentId;
      return item === undefined || payer === undefined || payer === item.apartmentId
        ? []
        : [{ itemType, itemId, payerApartmentId: payer, forApartmentId: item.apartmentId }];
    })
    .sort((a, b) => compareText(a.itemType, b.itemType) || compareText(a.itemId, b.itemId));

  toSplit.sort(
    (a, b) => compareText(a.date, b.date) || compareText(a.transactionId, b.transactionId),
  );
  return { pairs, toSplit, unverified };
}

export type LoadAccountBalancesResult =
  ({ status: 'computed' } & AccountBalances) | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The balance on the records of the store, with the items assumed paid by the matching computed
 * as `runMatch` with `dryRun` would (`planMatch`, the same calculation). Writes nothing. Refused
 * while `checkConsistency` reports a problem: a write left half done could count a movement twice.
 */
export async function loadAccountBalances(store: Store): Promise<LoadAccountBalancesResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const all = { includeDeleted: true };
  const balances = accountBalances({
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    instalments: (await loadAll(store, 'instalment', InstalmentSchema, all)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema, all)).records,
    assumed: (await planMatch(store)).run.assumed,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema, all)).records,
  });
  return { status: 'computed', ...balances };
}
