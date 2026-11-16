/**
 * The check of the IMU rates (plan 3d, task 3): for each rate of a group of apartments, what the
 * assigned F24 paid against the sum of the expected amounts of the group (the F24 does not
 * separate the apartments, «Mie scelte» 2). Pure; nothing here splits an F24 between apartments
 * (task 4, after the answers of user1).
 */
import { checkConsistency } from './journal';
import { BankTransactionSchema, ImuYearSchema, MovementClassSchema } from './model';
import type { BankTransaction, ImuYear, MovementClass } from './model';
import { cents } from './money';
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
}

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
}): ImuRate[] {
  const transactions = new Map(
    input.transactions.filter((t) => t.deleted !== true).map((t) => [t.id, t]),
  );
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
    for (const rateIndex of indices) {
      const entries = group.map((y) => y.rates.find((r) => r.index === rateIndex));
      const amounts = entries.map((r) => r?.expected);
      const expected = amounts.every((a) => a !== undefined)
        ? cents(amounts.reduce((sum, a) => sum + a, 0))
        : undefined;
      const dates = new Set(entries.map((r) => r?.dueDate));
      const [dueDate] = dates;
      const tx = f24s.get(imuRateKey({ f24Group, year, rateIndex }));
      const paid = tx === undefined ? undefined : cents(-tx.amount);
      const status: ImuRateStatus =
        paid === undefined
          ? 'attesa'
          : expected === undefined
            ? 'importo-mancante'
            : 100 * Math.abs(paid - expected) <= IMU_TOLERANCE_PERCENT * expected
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
  });
  return {
    status: 'computed',
    rates: options.year === undefined ? rates : rates.filter((r) => r.year === options.year),
  };
}
