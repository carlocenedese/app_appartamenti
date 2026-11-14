/**
 * Calendar dates and months, as plain strings with integer-only arithmetic: nothing here goes
 * through a time zone, so results are the same everywhere (daylight saving included).
 */

/** A calendar date, `YYYY-MM-DD`. Build one with `isoDate`. */
export type ISODate = string & { readonly __brand: 'ISODate' };
/** A calendar month, `YYYY-MM`. Build one with `yearMonth`. */
export type YearMonth = string & { readonly __brand: 'YearMonth' };

/** The day of the year on which a lease year (annualità) starts, e.g. `{ month: 10, day: 1 }`. */
export interface AnnualitaStart {
  month: number;
  day: number;
}

/** How a contract is settled: one period per lease year, or one for the whole contract. */
export type SettlementMode = 'annuale' | 'intero-contratto';

/** A settlement period (periodo di conguaglio), in whole months, both ends included. */
export interface SettlementPeriod {
  label: string;
  from: YearMonth;
  to: YearMonth;
}

const MIN_YEAR = 0;
const MAX_YEAR = 9999;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function assertYearInRange(year: number, what: string): void {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`${what} falls in year ${year}, outside ${MIN_YEAR}-${MAX_YEAR}`);
  }
}

function assertInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be an integer, got ${String(value)}`);
  }
}

/** Builds a date from parts the caller already knows to be a real calendar day. */
function formatDate(year: number, month: number, day: number): ISODate {
  assertYearInRange(year, 'Date');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as ISODate;
}

function dateParts(date: ISODate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's days_from_civil). */
function toEpochDay(date: ISODate): number {
  const { year, month, day } = dateParts(date);
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date `epochDay` days after 1970-01-01 (Hinnant's civil_from_days). */
function fromEpochDay(epochDay: number): ISODate {
  const shifted = epochDay + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return formatDate(year, month, day);
}

/** Months since year 0000 January, so that month arithmetic is plain integer arithmetic. */
function toMonthNumber(month: YearMonth): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function fromMonthNumber(monthNumber: number): YearMonth {
  const year = Math.floor(monthNumber / 12);
  assertYearInRange(year, 'Month');
  return `${pad(year, 4)}-${pad(monthNumber - year * 12 + 1, 2)}` as YearMonth;
}

function monthOf(date: ISODate): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

/**
 * Validates and brands a `YYYY-MM-DD` string. Throws a `RangeError` for anything else,
 * including days that do not exist such as `2026-02-30`.
 */
export function isoDate(s: string): ISODate {
  if (!ISO_DATE.test(s)) {
    throw new RangeError(`Not a date in YYYY-MM-DD format: ${JSON.stringify(s)}`);
  }
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not an existing calendar date: ${s}`);
  }
  return s as ISODate;
}

/** Validates and brands a `YYYY-MM` string. Throws a `RangeError` for anything else. */
export function yearMonth(s: string): YearMonth {
  if (!YEAR_MONTH.test(s)) {
    throw new RangeError(`Not a month in YYYY-MM format: ${JSON.stringify(s)}`);
  }
  const month = Number(s.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new RangeError(`Not an existing calendar month: ${s}`);
  }
  return s as YearMonth;
}

/** The date `n` days after `d` (before it if `n` is negative). `n` must be an integer. */
export function addDays(d: ISODate, n: number): ISODate {
  assertInteger(n, 'Number of days');
  return fromEpochDay(toEpochDay(d) + n);
}

/**
 * The signed number of days from `b` to `a`, that is `a - b`: positive when `a` is later.
 * `daysBetween('2026-03-29', '2026-03-28')` is `1` and the reversed call is `-1`.
 * Whole days on the calendar, so daylight saving changes make no difference.
 */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/**
 * The months touched by the period from `start` to `end`, both days included, in order.
 * Throws a `RangeError` if `end` is before `start`.
 */
export function monthsInPeriod(start: ISODate, end: ISODate): YearMonth[] {
  if (daysBetween(end, start) < 0) {
    throw new RangeError(`Period ends before it starts: ${start} to ${end}`);
  }
  const first = toMonthNumber(monthOf(start));
  const last = toMonthNumber(monthOf(end));
  return Array.from({ length: last - first + 1 }, (_, offset) => fromMonthNumber(first + offset));
}

/** The month `n` months after `m` (before it if `n` is negative). `n` must be an integer. */
export function addMonths(m: YearMonth, n: number): YearMonth {
  assertInteger(n, 'Number of months');
  return fromMonthNumber(toMonthNumber(m) + n);
}

/** The last day of a month. */
export function lastDayOfMonth(month: YearMonth): ISODate {
  return addDays(`${addMonths(month, 1)}-01` as ISODate, -1);
}

/** A lease year start must exist every year, so February 29 is not allowed. */
function assertAnnualitaStart({ month, day }: AnnualitaStart): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid lease year start month: ${String(month)}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(2001, month)) {
    throw new RangeError(`Invalid lease year start day: ${String(day)} (month ${month})`);
  }
}

function leaseYearLabel(startYear: number, endYear: number): string {
  return `${pad(startYear, 4)}-${pad(endYear % 100, 2)}`;
}

/**
 * The label `YYYY-YY` of the lease year (annualità) that contains `date`: the year in which it
 * starts, then the last two digits of the next. With a start of October 1, `2026-09-30` is in
 * `2025-26` and `2026-10-01` in `2026-27`. The label always names the year of the start, also
 * for a start on January 1.
 */
export function annualitaOf(date: ISODate, start: AnnualitaStart): string {
  assertAnnualitaStart(start);
  const { year, month, day } = dateParts(date);
  const started = month > start.month || (month === start.month && day >= start.day);
  const startYear = started ? year : year - 1;
  assertYearInRange(startYear, 'Lease year start');
  return leaseYearLabel(startYear, startYear + 1);
}

/**
 * The first and last day of the lease year with the given `YYYY-YY` label, the inverse of
 * `annualitaOf`: `annualitaRange('2026-27', { month: 10, day: 1 })` is 2026-10-01 to 2027-09-30.
 * Throws a `RangeError` for a malformed label or a second year that does not follow the first.
 */
export function annualitaRange(
  label: string,
  start: AnnualitaStart,
): { from: ISODate; to: ISODate } {
  assertAnnualitaStart(start);
  if (!/^\d{4}-\d{2}$/.test(label)) {
    throw new RangeError(`Not a lease year label in YYYY-YY format: ${JSON.stringify(label)}`);
  }
  const startYear = Number(label.slice(0, 4));
  if (label !== leaseYearLabel(startYear, startYear + 1)) {
    throw new RangeError(`Inconsistent lease year label: ${label}`);
  }
  const from = formatDate(startYear, start.month, start.day);
  const nextFrom = formatDate(startYear + 1, start.month, start.day);
  return { from, to: addDays(nextFrom, -1) };
}

/**
 * The settlement periods (periodi di conguaglio) of a contract, in whole months.
 *
 * - `'annuale'`: one period per lease year, labelled like `annualitaOf` labels its first day
 *   (`2025-26`). Periods are clipped to the contract, so the first one starts at the contract
 *   start and the last one ends at the contract end, and either may be shorter than a year.
 *   Months are whole, so the lease year must start on day 1.
 * - `'intero-contratto'`: a single period from start to end, labelled with the start year and
 *   the last two digits of the end year (`2024-29`).
 *
 * Throws a `RangeError` if the contract ends before it starts.
 */
export function settlementPeriods(
  contract: { start: YearMonth; end: YearMonth; settlement: SettlementMode },
  annualitaStart: AnnualitaStart,
): SettlementPeriod[] {
  assertAnnualitaStart(annualitaStart);
  const first = toMonthNumber(contract.start);
  const last = toMonthNumber(contract.end);
  if (last < first) {
    throw new RangeError(`Contract ends before it starts: ${contract.start} to ${contract.end}`);
  }

  switch (contract.settlement) {
    case 'intero-contratto':
      return [
        {
          label: leaseYearLabel(Math.floor(first / 12), Math.floor(last / 12)),
          from: contract.start,
          to: contract.end,
        },
      ];
    case 'annuale': {
      if (annualitaStart.day !== 1) {
        throw new RangeError(
          `Settlement periods are whole months: the lease year must start on day 1, not ${annualitaStart.day}`,
        );
      }
      const periods: SettlementPeriod[] = [];
      let cursor = first;
      while (cursor <= last) {
        const year = Math.floor(cursor / 12);
        const leaseYear = (cursor % 12) + 1 >= annualitaStart.month ? year : year - 1;
        assertYearInRange(leaseYear, 'Lease year start');
        const nextLeaseYear = (leaseYear + 1) * 12 + annualitaStart.month - 1;
        const to = Math.min(nextLeaseYear - 1, last);
        periods.push({
          label: leaseYearLabel(leaseYear, leaseYear + 1),
          from: fromMonthNumber(cursor),
          to: fromMonthNumber(to),
        });
        cursor = to + 1;
      }
      return periods;
    }
    default:
      throw new RangeError(`Unknown settlement kind: ${String(contract.settlement)}`);
  }
}

/**
 * The months covered by instalment `rateIndex` (1-based) of `rateCount` equal instalments of a
 * year that starts at `start`. `rateCoverage('2025-10', 3, 1)` is 2025-10 to 2026-01.
 * Throws a `RangeError` unless `rateCount` divides 12 and `rateIndex` is within `1..rateCount`.
 */
export function rateCoverage(
  start: YearMonth,
  rateCount: number,
  rateIndex: number,
): { from: YearMonth; to: YearMonth } {
  if (!Number.isInteger(rateCount) || rateCount < 1 || 12 % rateCount !== 0) {
    throw new RangeError(`The instalment count must divide 12, got ${String(rateCount)}`);
  }
  if (!Number.isInteger(rateIndex) || rateIndex < 1 || rateIndex > rateCount) {
    throw new RangeError(
      `The instalment index must be between 1 and ${rateCount}, got ${String(rateIndex)}`,
    );
  }
  const length = 12 / rateCount;
  const from = addMonths(start, (rateIndex - 1) * length);
  return { from, to: addMonths(from, length - 1) };
}
