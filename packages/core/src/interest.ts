import { cents } from './money';
import type { Cents } from './money';
import { addDays, monthsInPeriod } from './period';
import type { ISODate } from './period';

/**
 * The legal interest rate of one calendar year, in basis points (200 means 2%). The values come
 * from the user's configuration, never from the code.
 */
export interface RatePeriod {
  year: number;
  rateBp: number;
}

// Interest = principal * (rateBp / 10 000) * (months / 12), over a common denominator.
const DENOMINATOR = 120_000n;

function assertRates(rates: readonly RatePeriod[]): Map<number, number> {
  const rateByYear = new Map<number, number>();
  for (const { year, rateBp } of rates) {
    if (!Number.isSafeInteger(year)) {
      throw new RangeError(`Rate year must be an integer, got ${String(year)}`);
    }
    if (!Number.isSafeInteger(rateBp) || rateBp < 0) {
      throw new RangeError(
        `Rate for ${year} must be a non-negative integer in basis points, got ${String(rateBp)}`,
      );
    }
    if (rateByYear.has(year)) throw new RangeError(`Duplicate rate for year ${year}`);
    rateByYear.set(year, rateBp);
  }
  return rateByYear;
}

/** The calendar months fully inside `from`..`to` (both days included), counted per year. */
function wholeMonthsPerYear(from: ISODate, to: ISODate): Map<number, number> {
  const touched = monthsInPeriod(from, to);
  // Only the first and the last touched month can be partial. `to` closes its month when the next
  // day opens a new one.
  const firstIsWhole = from.slice(8) === '01';
  const lastIsWhole = addDays(to, 1).slice(8) === '01';
  const monthsPerYear = new Map<number, number>();
  touched.forEach((month, index) => {
    if (index === 0 && !firstIsWhole) return;
    if (index === touched.length - 1 && !lastIsWhole) return;
    const year = Number(month.slice(0, 4));
    monthsPerYear.set(year, (monthsPerYear.get(year) ?? 0) + 1);
  });
  return monthsPerYear;
}

/**
 * Legal interest on a deposit (caparra) held from `from` to `to`, both days included, counted in
 * whole calendar months: a month counts only if the period covers all of it, so a partial first or
 * last month does not.
 *
 * Each year's interest is principal x rate x months / 12. The years are added up exactly and the
 * total is rounded to the cent once (half up), never year by year. The arithmetic is on integers
 * only (basis points and `BigInt`), so there is no floating point rounding at any size.
 *
 * A rate is needed only for the years with at least one counted month. Throws a `RangeError` if
 * `to` is before `from`, if the principal is negative, if a rate is missing for one of those years
 * (the message names the year), if `rates` repeats a year or holds a rate that is not a
 * non-negative integer, or if the result is not a safe integer.
 */
export function legalInterest(
  principal: Cents,
  rates: readonly RatePeriod[],
  from: ISODate,
  to: ISODate,
): Cents {
  if (!Number.isSafeInteger(principal) || principal < 0) {
    throw new RangeError(`Principal must be a non-negative amount in cents, got ${principal}`);
  }
  const rateByYear = assertRates(rates);
  const monthsPerYear = wholeMonthsPerYear(from, to);

  let numerator = 0n;
  for (const [year, months] of monthsPerYear) {
    const rateBp = rateByYear.get(year);
    if (rateBp === undefined) {
      throw new RangeError(`Missing legal interest rate for year ${year}`);
    }
    numerator += BigInt(principal) * BigInt(rateBp) * BigInt(months);
  }
  // Half up: add half the denominator before the (floor) division, all values being non-negative.
  const rounded = (2n * numerator + DENOMINATOR) / (2n * DENOMINATOR);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Legal interest is out of range: not a safe integer amount of cents');
  }
  return cents(Number(rounded));
}
