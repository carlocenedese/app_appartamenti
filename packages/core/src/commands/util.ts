import { ISODateSchema, YearMonthSchema } from '../model';
import { invalidCommand } from './stop';

/** The UTC day of the clock; a clock that is no timestamp is not valid input. */
export function clockDay(clock: () => string) {
  const parsed = ISODateSchema.safeParse(clock().slice(0, 10));
  if (!parsed.success) throw invalidCommand('bad-arguments');
  return parsed.data;
}

/** The UTC month of the clock, as `clockDay`. */
export function clockMonth(clock: () => string) {
  const parsed = YearMonthSchema.safeParse(clock().slice(0, 7));
  if (!parsed.success) throw invalidCommand('bad-arguments');
  return parsed.data;
}

/** `{ [key]: value }`, or nothing when the value is `undefined` (spread into a result). */
export const optional = <K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> => (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
