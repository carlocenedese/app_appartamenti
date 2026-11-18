/**
 * The balance between accounts (plan 3c, task 9; section 24, R131): for each pair of apartments,
 * who owes whom and the items behind it. An item says that `forApartmentId` owes `amount` to
 * `payerApartmentId`:
 *
 * - `rata` / `bolletta` / `commissione`: a live confirmed match (never `assumed`) of a live
 *   instalment or bill of Y on a live movement of an account of X (the apartment of the account,
 *   else that of the movement; never `paidFromApartmentId`), with its share `m.amount`; the
 *   commission follows it (R7, question 10);
 * - `uscita` / `f24`: a class that passes `inBalance` on a movement of an account of X with an
 *   `apartmentId` Y ≠ X, for `-tx.amount` (a refund lowers the debt); an F24 of X itself is
 *   listed in `toSplit`, with no amount (decision 9, question 5), and with the reason of its IMU
 *   rate when it has one;
 * - `imu`: an F24 of X assigned to a `pagata` IMU rate of a group with X (plan 3d, task 4):
 *   the share (`imuShares`) of each other apartment Y of the group, and no `toSplit`;
 * - `giroconto`: a live «saldo» transfer from an account of F to one of T, for `-amount` owed by F
 *   to T, dated on the record (the first leg), never computed again from the legs.
 *
 * Items with no statement and no debit («da verificare», B1) are listed in `unverified`, never
 * in the net (question 11); the income of the tenants never counts. Nothing depends on the input order.
 */
import { imuRateKey, imuRates, imuShares } from './imu';
import type { ImuRate } from './imu';
import type { MatchItemRef, MatchItemType } from './match';
import { writesBlocked } from './journal';
import { planMatch } from './match-store';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  ImuYearSchema,
  InstalmentSchema,
  MovementClassSchema,
  TaxPaymentSchema,
  TransferSchema,
} from './model';
import type {
  Account,
  BankTransaction,
  Bill,
  BillMatch,
  ImuYear,
  Instalment,
  MovementClass,
  TaxPayment,
  Transfer,
} from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';
import { loadSettings } from './settings-store';

export interface BalanceItem {
  date: ISODate;
  kind: 'rata' | 'bolletta' | 'commissione' | 'uscita' | 'f24' | 'giroconto' | 'imu';
  payerApartmentId: string;
  forApartmentId: string;
  /** Positive: what `forApartmentId` owes to `payerApartmentId`. */
  amount: Cents;
  /** The instalment, the bill, the movement or the transfer. */
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
  bills: Bill[];
  instalments: Instalment[];
  matches: BillMatch[];
  /** The items to verify of the matching (B1). */
  unverified: MatchItemRef[];
  transactions: BankTransaction[];
  classes: MovementClass[];
  transfers: Transfer[];
  imuYears: ImuYear[];
  /** The other voci of a mixed F24 (plan 17, R307); absent: none. */
  taxPayments?: TaxPayment[];
  /** The IMU tolerance of the workspace settings (I9); the default when absent. */
  imuToleranceBp?: number;
}

export type ImuSplitReason = 'imu-da-ripartire' | 'imu-importo-mancante' | 'imu-da-riconciliare';

export interface ToSplit {
  transactionId: string;
  apartmentId: string;
  date: ISODate;
  /** An F24 assigned to an IMU rate: the rate and why it is not split yet. */
  imu?: { f24Group: string; year: string; rateIndex: number; reason: ImuSplitReason };
}

export interface AccountBalances {
  pairs: BalancePair[];
  toSplit: ToSplit[];
  unverified: {
    itemType: MatchItemType;
    itemId: string;
    payerApartmentId: string;
    forApartmentId: string;
  }[];
  /**
   * The part of a mixed F24 that is no IMU (plan 17, R307): left out of the balance, to be
   * checked (how it is shared between the apartments is a question for user1).
   */
  mixedF24: { transactionId: string; apartmentId: string; amount: Cents }[];
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
  const bills = new Map(live(input.bills).map((b) => [b.id, b]));
  const transactions = new Map(live(input.transactions).map((t) => [t.id, t]));
  /** Who paid a movement: the apartment of its account, else its own (I4 of the final review). */
  const payerOf = (tx: BankTransaction): string =>
    (tx.accountId === undefined ? undefined : apartmentOfAccount.get(tx.accountId)) ??
    tx.apartmentId;
  const items: BalanceItem[] = [];
  const toSplit: ToSplit[] = [];
  const rates = new Map<string, ImuRate>(
    imuRates({
      years: input.imuYears,
      classes: input.classes,
      transactions: input.transactions,
      ...(input.taxPayments === undefined ? {} : { taxPayments: input.taxPayments }),
      ...(input.imuToleranceBp === undefined ? {} : { toleranceBp: input.imuToleranceBp }),
    }).map((r) => [imuRateKey(r), r]),
  );
  const otherVoci = new Map(
    live(input.taxPayments ?? []).map((p) => [
      p.transactionId,
      p.parts.reduce((sum, part) => sum + part.amount, 0),
    ]),
  );
  const mixedF24: AccountBalances['mixedF24'] = [];
  /** A rate gone (its year undone) has no expected either. */
  const reasonOf = (rate: ImuRate | undefined): ImuSplitReason =>
    rate?.status === 'pagata'
      ? 'imu-da-ripartire'
      : rate?.status === 'da-riconciliare'
        ? 'imu-da-riconciliare'
        : 'imu-importo-mancante';

  // By match id first: two parts of one instalment on the same day then follow their movement.
  for (const m of live(input.matches).sort((a, b) => compareText(a.id, b.id))) {
    if (!m.confirmed || m.by === 'assumed') continue;
    const item = m.itemType === 'instalment' ? instalments.get(m.itemId) : bills.get(m.itemId);
    const tx = transactions.get(m.transactionId);
    if (item === undefined || tx === undefined) continue;
    const payer = payerOf(tx);
    if (payer === item.apartmentId) continue;
    items.push({
      date: m.transactionDate,
      kind: m.part === 'commission' ? 'commissione' : m.itemType === 'bill' ? 'bolletta' : 'rata',
      payerApartmentId: payer,
      forApartmentId: item.apartmentId,
      amount: m.amount,
      refId: item.id,
    });
  }

  for (const c of input.classes.filter(inBalance)) {
    const tx = transactions.get(c.transactionId);
    if (tx === undefined || c.apartmentId === undefined) continue;
    const payer = payerOf(tx);
    if (c.apartmentId === payer) {
      if (c.f24 !== true) continue;
      const rate = c.imu === undefined ? undefined : rates.get(imuRateKey(c.imu));
      // Only the F24 the rate counts (a second one on it is to reconcile, question 9), and not
      // while the payer is outside the group (`assignImuF24` refuses both).
      const own = rate !== undefined && rate.transactionId === tx.id;
      // Only the IMU part of a mixed F24 is shared (R307, provisional); the rest stays out.
      const other = c.imu === undefined ? 0 : (otherVoci.get(tx.id) ?? 0);
      const shares =
        own && rate.apartmentIds.includes(payer)
          ? imuShares(rate, input.imuYears, cents(tx.amount + other))
          : undefined;
      if (shares !== undefined && other > 0) {
        mixedF24.push({ transactionId: tx.id, apartmentId: payer, amount: cents(other) });
      }
      if (shares !== undefined) {
        for (const share of shares.filter((s) => s.apartmentId !== payer)) {
          items.push({
            date: tx.date,
            kind: 'imu',
            payerApartmentId: payer,
            forApartmentId: share.apartmentId,
            amount: share.amount,
            refId: tx.id,
          });
        }
        continue;
      }
      const reason: ImuSplitReason =
        rate !== undefined && !own ? 'imu-da-riconciliare' : reasonOf(rate);
      const imu = c.imu === undefined ? {} : { imu: { ...c.imu, reason } };
      toSplit.push({ transactionId: tx.id, apartmentId: payer, date: tx.date, ...imu });
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

  const unverified = input.unverified
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
  return { pairs, toSplit, unverified, mixedF24 };
}

export type LoadAccountBalancesResult =
  ({ status: 'computed' } & AccountBalances) | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The balance on the records of the store, with the items to verify of the matching computed
 * as `runMatch` with `dryRun` would (`planMatch`, the same calculation). Writes nothing. Refused
 * while `checkConsistency` reports a problem: a write left half done could count a movement twice.
 */
export async function loadAccountBalances(store: Store): Promise<LoadAccountBalancesResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const all = { includeDeleted: true };
  const balances = accountBalances({
    accounts: (await loadAll(store, 'account', AccountSchema, all)).records,
    bills: (await loadAll(store, 'bill', BillSchema, all)).records,
    instalments: (await loadAll(store, 'instalment', InstalmentSchema, all)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema, all)).records,
    unverified: (await planMatch(store)).run.unverified,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema, all)).records,
    imuYears: (await loadAll(store, 'imuYear', ImuYearSchema, all)).records,
    taxPayments: (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records,
    imuToleranceBp: (await loadSettings(store)).imuToleranceBp.value,
  });
  return { status: 'computed', ...balances };
}
