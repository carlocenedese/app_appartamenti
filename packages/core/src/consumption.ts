/**
 * The comparison behind the «allarme consumi anomali» (section 21): a bill against the bill of the
 * same months a year before and against the bills of the months just before it. Only the
 * differences: no level, no colour and no default threshold. Exact integer arithmetic on the
 * decimal quantities, never a float.
 *
 * Answers of user1 (17 November 2026, R313): by kind of bill (category), average of the 12
 * months before, normalised per day; the thresholds and the yellow and red levels are settings
 * typed by user1 (the same for all, an apartment may have its own), never a default here. The
 * unit price and the window rule of R263 stay as they were (question 8 of R265).
 */
import type { Bill, Consumption } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { addMonths, daysBetween, monthsInPeriod } from './period';
import type { YearMonth } from './period';
import { foldText } from './text';

/** Number of decimals of a quantity `"123.4"`. */
export const decimals = (quantity: string): number => quantity.split('.')[1]?.length ?? 0;

/** A decimal quantity `"123.4"` as an integer scaled by 10^scale. */
export function scaled(quantity: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0'));
}

/**
 * True when `current` exceeds `previous` by more than `percent` %. Computed on integers, so the
 * threshold itself is never flagged by a rounding error; the percentage keeps 4 decimals.
 */
export function exceeds(current: string, previous: string, percent: number): boolean {
  const scale = Math.max(decimals(current), decimals(previous));
  const base = 1_000_000n; // 100 % with 4 decimals
  const threshold = BigInt(Math.round(percent * 10_000));
  return scaled(current, scale) * base > scaled(previous, scale) * (base + threshold);
}

/** What the comparison reads of a bill. */
export type Comparable = Pick<
  Bill,
  'id' | 'apartmentId' | 'periodStart' | 'periodEnd' | 'amount' | 'consumption'
> & { category: string; deleted?: boolean };

/** Live bills of the same apartment and category; with a consumption, the same unit (R263). */
function sameKind<T extends Comparable>(bill: Comparable, bills: readonly T[]): T[] {
  const unit = bill.consumption === undefined ? undefined : foldText(bill.consumption.unit);
  return bills.filter(
    (b) =>
      b.deleted !== true &&
      b.id !== bill.id &&
      b.apartmentId === bill.apartmentId &&
      b.category === bill.category &&
      b.periodStart <= b.periodEnd &&
      (unit === undefined ||
        (b.consumption !== undefined && foldText(b.consumption.unit) === unit)),
  );
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The bill of the same apartment and category whose months are those of `bill` a year before
 * (with the smallest id when several), with the same unit when `bill` has a consumption. The rule
 * of the anomaly check of the proposal (`consumption-anomaly`), shared.
 */
export function yearBeforeBill<T extends Comparable>(
  bill: Comparable,
  bills: readonly T[],
): T | undefined {
  const months = monthsInPeriod(bill.periodStart, bill.periodEnd)
    .map((month) => `${String(Number(month.slice(0, 4)) - 1)}${month.slice(4)}`)
    .join(',');
  return sameKind(bill, bills)
    .filter((b) => monthsInPeriod(b.periodStart, b.periodEnd).join(',') === months)
    .sort(byId)[0];
}

/** The months of the average of the recent bills (answer of user1, 17 November 2026). */
export const CONSUMPTION_AVERAGE_MONTHS = 12;

/** One side of a comparison: totals and the number of days of competence they cover. */
export interface ConsumptionSide {
  billIds: string[];
  days: number;
  amount: Cents;
  /** Only when every bill of the side has one, in the unit of the bill compared. */
  consumption?: Consumption;
}

export type ConsumptionMetric = 'consumption' | 'amount' | 'unitPrice';

export interface MetricDifference {
  metric: ConsumptionMetric;
  /**
   * (current − reference) / reference in basis points: consumption and amount per day of
   * competence, the unit price as amount / consumption. Rounded half away from zero, only to show.
   */
  differenceBp: number;
  /** Only with thresholds for the metric: |difference| above red, else above yellow (exact). */
  level?: 'giallo' | 'rosso';
}

export interface ConsumptionComparison {
  current: ConsumptionSide;
  yearBefore?: { reference: ConsumptionSide; differences: MetricDifference[] };
  recent?: { reference: ConsumptionSide; differences: MetricDifference[] };
}

/**
 * Thresholds in basis points (whole, ≥ 0) of the two levels, typed by user1: none is decided in
 * the code.
 */
export interface ConsumptionThresholds {
  giallo?: Partial<Record<ConsumptionMetric, number>>;
  rosso?: Partial<Record<ConsumptionMetric, number>>;
}

function sideOf(bills: readonly Comparable[], withConsumption: boolean): ConsumptionSide {
  const days = bills.reduce((n, b) => n + daysBetween(b.periodEnd, b.periodStart) + 1, 0);
  const amount = cents(bills.reduce((sum, b) => sum + b.amount, 0));
  const side: ConsumptionSide = { billIds: bills.map((b) => b.id).sort(), days, amount };
  const [first] = bills;
  if (!withConsumption || first?.consumption === undefined) return side;
  const quantities = bills.map((b) => b.consumption?.quantity ?? '0');
  const scale = Math.max(...quantities.map(decimals));
  const total = quantities.reduce((sum, q) => sum + scaled(q, scale), 0n);
  return {
    ...side,
    consumption: { quantity: unscaled(total, scale), unit: first.consumption.unit },
  };
}

function unscaled(value: bigint, scale: number): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return scale === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** `num / den` × 10000, rounded half away from zero; `den` > 0. */
function basisPoints(num: bigint, den: bigint): number {
  const scaledNum = num * 20_000n;
  const q = (scaledNum < 0n ? -scaledNum : scaledNum) / den;
  const rounded = (q + 1n) / 2n;
  return Number(num < 0n ? -rounded : rounded);
}

/**
 * The difference of `metric` as the fraction `num / den` (den > 0), or `undefined` when the
 * reference is zero or negative (a credit note) and no ratio means anything.
 */
function ratio(
  metric: ConsumptionMetric,
  current: ConsumptionSide,
  reference: ConsumptionSide,
): { num: bigint; den: bigint } | undefined {
  const cm = BigInt(current.days);
  const rm = BigInt(reference.days);
  if (metric === 'amount') {
    const [c, r] = [BigInt(current.amount), BigInt(reference.amount)];
    return r > 0n && cm > 0n ? { num: c * rm - r * cm, den: r * cm } : undefined;
  }
  if (current.consumption === undefined || reference.consumption === undefined) return undefined;
  const scale = Math.max(
    decimals(current.consumption.quantity),
    decimals(reference.consumption.quantity),
  );
  const qc = scaled(current.consumption.quantity, scale);
  const qr = scaled(reference.consumption.quantity, scale);
  if (metric === 'consumption') {
    return qr > 0n && cm > 0n ? { num: qc * rm - qr * cm, den: qr * cm } : undefined;
  }
  const [ac, ar] = [BigInt(current.amount), BigInt(reference.amount)];
  // price_c / price_r − 1 = (ac·qr − ar·qc) / (ar·qc)
  return ar > 0n && qc > 0n && qr > 0n ? { num: ac * qr - ar * qc, den: ar * qc } : undefined;
}

function differences(
  current: ConsumptionSide,
  reference: ConsumptionSide,
  thresholds: ConsumptionThresholds | undefined,
): MetricDifference[] {
  const metrics: ConsumptionMetric[] = ['consumption', 'amount', 'unitPrice'];
  return metrics.flatMap((metric) => {
    const r = ratio(metric, current, reference);
    if (r === undefined) return [];
    const abs = r.num < 0n ? -r.num : r.num;
    const above = (bp: number | undefined) =>
      bp !== undefined && abs * 10_000n > BigInt(bp) * r.den;
    const level = above(thresholds?.rosso?.[metric])
      ? 'rosso'
      : above(thresholds?.giallo?.[metric])
        ? 'giallo'
        : undefined;
    return [
      {
        metric,
        differenceBp: basisPoints(r.num, r.den),
        ...(level === undefined ? {} : { level }),
      },
    ];
  });
}

/**
 * The comparison of `bill` with the bill of the same months a year before (`yearBeforeBill`) and
 * with the live bills of the same kind whose months all fall in the `recentMonths` months before
 * the first month of `bill` (R263; `CONSUMPTION_AVERAGE_MONTHS` unless given). A side without
 * bills is absent; a metric without a positive reference is left out. `recentMonths` and
 * `thresholds` must be whole numbers ≥ 0 (else `RangeError`).
 */
export function compareConsumption(
  bill: Comparable,
  bills: readonly Comparable[],
  options: { recentMonths?: number; thresholds?: ConsumptionThresholds } = {},
): ConsumptionComparison {
  const { recentMonths = CONSUMPTION_AVERAGE_MONTHS, thresholds } = options;
  const values = [
    recentMonths,
    ...Object.values(thresholds?.giallo ?? {}),
    ...Object.values(thresholds?.rosso ?? {}),
  ];
  if (values.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new RangeError('Months and thresholds must be whole numbers, not negative');
  }
  if (bill.periodEnd < bill.periodStart) throw new RangeError('The period ends before it starts');
  const withConsumption = bill.consumption !== undefined;
  const current = sideOf([bill], withConsumption);
  const comparison: ConsumptionComparison = { current };
  const previous = yearBeforeBill(bill, bills);
  if (previous !== undefined) {
    const reference = sideOf([previous], withConsumption);
    comparison.yearBefore = { reference, differences: differences(current, reference, thresholds) };
  }
  const first = monthsInPeriod(bill.periodStart, bill.periodEnd)[0] as YearMonth;
  const from = addMonths(first, -recentMonths);
  const window = sameKind(bill, bills).filter((b) => {
    const months = monthsInPeriod(b.periodStart, b.periodEnd);
    return months.every((m) => from <= m && m < first);
  });
  if (window.length > 0) {
    const reference = sideOf(window, withConsumption);
    comparison.recent = { reference, differences: differences(current, reference, thresholds) };
  }
  return comparison;
}
