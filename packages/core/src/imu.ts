/**
 * The check of the IMU rates (plan 3d, task 3): for each rate of a group of apartments, what the
 * assigned F24 paid against the sum of the expected amounts of the group (the F24 does not
 * separate the apartments, «Mie scelte» 2), and the split of a paid F24 between them (task 4,
 * answers of user1 of 16 November 2026). Pure.
 */
import { checkConsistency } from './journal';
import {
  BankTransactionSchema,
  ImuYearSchema,
  MovementClassSchema,
  TaxPaymentSchema,
} from './model';
import type { BankTransaction, ImuYear, MovementClass, TaxPayment } from './model';
import { cents } from './money';
import { splitSharedDebit } from './split';
import type { Cents } from './money';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';

/** Decision 7 of user1: a control threshold, not a tax rate («Mie scelte» 6). */
export const IMU_TOLERANCE_PERCENT = 1;

export type ImuRateStatus = 'attesa' | 'importo-mancante' | 'pagata' | 'da-riconciliare';

export interface ImuRate {
  f24Group: string;
  year: string;
  rateIndex: number;
  /** The apartments of the live years of the group, sorted. */
  apartmentIds: string[];
  status: ImuRateStatus;
  /** Only when every apartment of the group has the amount of the rate (question 4). */
  expected?: Cents;
  /** `-amount` of the assigned F24. */
  paid?: Cents;
  transactionId?: string;
  /** Only when the same in every year of the rate; shown, never used for a state (question 6). */
  dueDate?: ISODate;
  /**
   * Only annual totals in the group and year (question 10): their sum, and the sum of the F24s
   * of the year once every rate has one; the 1% is then checked on the year.
   */
  annual?: { expected: Cents; paid?: Cents };
}

/** Integers only; the expected is the base, 1.00% exactly included (question 11). */
const withinTolerance = (paid: number, expected: number): boolean =>
  100 * Math.abs(paid - expected) <= IMU_TOLERANCE_PERCENT * expected;

/** The key of a rate, as in `MovementClass.imu`. */
export const imuRateKey = (r: { f24Group: string; year: string; rateIndex: number }): string =>
  `${r.f24Group}\u0000${r.year}\u0000${String(r.rateIndex)}`;

/**
 * The rates of the live years, each with the F24 of the live class (on a live movement) that has
 * it in `imu`; sorted by group, year and index. `attesa` without an F24; `importo-mancante` with
 * one and the expected not complete; `pagata` when `100 × |paid − expected| ≤ 1 × expected`
 * (question 11: the expected is the base), `da-riconciliare` otherwise. Integers only.
 */
export function imuRates(input: {
  years: ImuYear[];
  classes: MovementClass[];
  transactions: BankTransaction[];
  /** The other voci of a mixed F24 (plan 17, R307): what is left of the debit is the IMU. */
  taxPayments?: TaxPayment[];
}): ImuRate[] {
  const transactions = new Map(
    input.transactions.filter((t) => t.deleted !== true).map((t) => [t.id, t]),
  );
  const otherVoci = new Map<string, number>();
  for (const p of (input.taxPayments ?? []).filter((p) => p.deleted !== true)) {
    otherVoci.set(
      p.transactionId,
      p.parts.reduce((sum, part) => sum + part.amount, 0),
    );
  }
  /** The IMU part of an F24: the debit less the parts of the other voci. */
  const imuOf = (tx: BankTransaction | undefined): number =>
    tx === undefined ? 0 : -tx.amount - (otherVoci.get(tx.id) ?? 0);
  const f24s = new Map<string, BankTransaction>();
  // By transaction id: one F24 per rate (question 9), the first if ever two.
  for (const c of [...input.classes].sort((a, b) => compareText(a.id, b.id))) {
    const tx = transactions.get(c.transactionId);
    if (c.deleted === true || c.imu === undefined || tx === undefined) continue;
    if (!f24s.has(imuRateKey(c.imu))) f24s.set(imuRateKey(c.imu), tx);
  }
  const groups = new Map<string, ImuYear[]>();
  for (const y of input.years.filter((y) => y.deleted !== true)) {
    const key = `${y.f24Group}\u0000${y.year}`;
    groups.set(key, [...(groups.get(key) ?? []), y]);
  }
  const rates: ImuRate[] = [];
  for (const group of groups.values()) {
    const [{ f24Group, year }] = group as [ImuYear];
    const apartmentIds = group.map((y) => y.apartmentId).sort(compareText);
    const indices = [...new Set(group.flatMap((y) => y.rates.map((r) => r.index)))];
    const f24Of = (rateIndex: number) => f24s.get(imuRateKey({ f24Group, year, rateIndex }));
    const totals = group.map((y) => y.annualTotal);
    const annualOnly =
      group.every((y) => y.rates.every((r) => r.expected === undefined)) &&
      totals.every((t) => t !== undefined);
    const annualPaid = indices.every((i) => f24Of(i) !== undefined)
      ? cents(indices.reduce((sum, i) => sum + imuOf(f24Of(i)), 0))
      : undefined;
    const annual = annualOnly
      ? {
          expected: cents(totals.reduce((sum: number, t) => sum + (t ?? 0), 0)),
          ...(annualPaid === undefined ? {} : { paid: annualPaid }),
        }
      : undefined;
    for (const rateIndex of indices) {
      const entries = group.map((y) => y.rates.find((r) => r.index === rateIndex));
      const amounts = entries.map((r) => r?.expected);
      const expected = amounts.every((a) => a !== undefined)
        ? cents(amounts.reduce((sum, a) => sum + a, 0))
        : undefined;
      const dates = new Set(entries.map((r) => r?.dueDate));
      const [dueDate] = dates;
      const tx = f24Of(rateIndex);
      const paid = tx === undefined ? undefined : cents(imuOf(tx));
      const [checkPaid, checkExpected] =
        annual === undefined ? [paid, expected] : [annual.paid, annual.expected];
      const status: ImuRateStatus =
        paid === undefined
          ? 'attesa'
          : checkPaid === undefined || checkExpected === undefined
            ? 'importo-mancante'
            : withinTolerance(checkPaid, checkExpected)
              ? 'pagata'
              : 'da-riconciliare';
      rates.push({
        f24Group,
        year,
        rateIndex,
        apartmentIds,
        status,
        ...(expected === undefined ? {} : { expected }),
        ...(paid === undefined ? {} : { paid, transactionId: tx?.id }),
        ...(dates.size === 1 && dueDate !== undefined ? { dueDate } : {}),
        ...(annual === undefined ? {} : { annual }),
      });
    }
  }
  return rates.sort(
    (a, b) =>
      compareText(a.f24Group, b.f24Group) ||
      compareText(a.year, b.year) ||
      a.rateIndex - b.rateIndex,
  );
}

/**
 * The shares of the apartments of a `pagata` rate in the debit of its F24 (answers of user1,
 * 16 November 2026): the actual debit (question 3), in proportion to the expected of the same
 * rate (question 1), or to the annual totals when the year has only those (question 10), with
 * the leftover cents to the largest remainders and on a tie to the first apartment, as the
 * shared TARI (question 2); they always sum to `-debit`. None for any other state: out of the
 * 1% or without every expected it is not split (questions 4 and 5). Apartments sorted.
 */
export function imuShares(
  rate: ImuRate,
  years: ImuYear[],
  debit: Cents,
): { apartmentId: string; amount: Cents }[] | undefined {
  if (rate.status !== 'pagata') return undefined;
  const weights = rate.apartmentIds.map((apartmentId) => {
    const y = years.find(
      (x) =>
        x.deleted !== true &&
        x.apartmentId === apartmentId &&
        x.f24Group === rate.f24Group &&
        x.year === rate.year,
    );
    const weight =
      rate.annual === undefined
        ? y?.rates.find((r) => r.index === rate.rateIndex)?.expected
        : y?.annualTotal;
    return weight === undefined ? undefined : { itemId: apartmentId, weight };
  });
  // `pagata` has every weight; a missing one would be no split (toSplit), never a RangeError.
  if (weights.some((w) => w === undefined)) return undefined;
  return splitSharedDebit(
    debit,
    weights.filter((w) => w !== undefined),
  ).map((s) => ({
    apartmentId: s.itemId,
    amount: s.amount,
  }));
}

/**
 * The live classes assigned to a rate of the group and year of `current` that a change of
 * `current` into `next` would alter (answer of user1, 16 November 2026): `next` absent or
 * deleted, in another group or year, or with another number of rates. Sorted ids; empty when
 * `current` is absent or deleted, or only amounts or dates change. Undo the assignment first.
 */
export function imuDependents(
  classes: MovementClass[],
  current: ImuYear | undefined,
  next: Pick<ImuYear, 'f24Group' | 'year' | 'rates' | 'deleted'> | undefined,
): string[] {
  if (current === undefined || current.deleted === true) return [];
  const same =
    next !== undefined &&
    next.deleted !== true &&
    next.f24Group === current.f24Group &&
    next.year === current.year &&
    next.rates.length === current.rates.length;
  if (same) return [];
  return classes
    .filter(
      (c) =>
        c.deleted !== true && c.imu?.f24Group === current.f24Group && c.imu.year === current.year,
    )
    .map((c) => c.id)
    .sort(compareText);
}

export type LoadImuRatesResult =
  { status: 'computed'; rates: ImuRate[] } | { status: 'refused'; reason: 'inconsistent-store' };

/** The rates on the records of the store, of one `year` if given. Writes nothing. */
export async function loadImuRates(
  store: Store,
  options: { year?: string } = {},
): Promise<LoadImuRatesResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const all = { includeDeleted: true };
  const rates = imuRates({
    years: (await loadAll(store, 'imuYear', ImuYearSchema, all)).records,
    classes: (await loadAll(store, 'movementClass', MovementClassSchema, all)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema, all)).records,
    taxPayments: (await loadAll(store, 'taxPayment', TaxPaymentSchema)).records,
  });
  return {
    status: 'computed',
    rates: options.year === undefined ? rates : rates.filter((r) => r.year === options.year),
  };
}
