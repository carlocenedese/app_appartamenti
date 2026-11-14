import { addMonths, daysBetween, lastDayOfMonth } from './period';
import type { ISODate, YearMonth } from './period';

export type RentMonthChoice =
  { status: 'auto'; month: YearMonth } | { status: 'review'; reason: 'late' | 'month-paid' };

/**
 * Picks the rent month a payment on `date` covers. `unpaid` are the months still to pay up to
 * the month of `date` included, oldest first. Anything but the current month, or the previous
 * one within `lateDays` of its end, needs a human.
 */
export function chooseRentMonth(input: {
  date: ISODate;
  unpaid: YearMonth[];
  lateDays: number;
}): RentMonthChoice {
  const oldest = input.unpaid[0];
  if (oldest === undefined) return { status: 'review', reason: 'month-paid' };
  const dateMonth = input.date.slice(0, 7) as YearMonth;
  if (oldest === dateMonth) return { status: 'auto', month: oldest };
  if (
    oldest === addMonths(dateMonth, -1) &&
    daysBetween(input.date, lastDayOfMonth(oldest)) <= input.lateDays
  ) {
    return { status: 'auto', month: oldest };
  }
  return { status: 'review', reason: 'late' };
}
