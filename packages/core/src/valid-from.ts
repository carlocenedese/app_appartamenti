/**
 * Plan 22, decision 2 of user1 (19 Nov 2026): the beds of an apartment and the weights of a supply
 * have a start month («valido dal»). The current value is on the record; each earlier value is an
 * entry `{ to, ... }` that holds up to its month `to` included, in increasing order. A record
 * without entries holds from always. Whole months, as the presence (R1).
 */
import type { Apartment, Supply } from './model';
import { addMonths } from './period';
import type { YearMonth } from './period';

type Dated = { to: string };

/** The entry in force in `month`: the first whose `to` is not before it, else the current one. */
function inForce<E extends Dated, T>(
  earlier: readonly E[] | undefined,
  current: T,
  pick: (entry: E) => T,
  month: string,
): T {
  const entry = (earlier ?? []).find((e) => month <= e.to);
  return entry === undefined ? current : pick(entry);
}

/** The values in force over `from..to`, one per stretch, clipped to it (for the F5 guard). */
function stretches<E extends Dated, T>(
  earlier: readonly E[] | undefined,
  current: T,
  pick: (entry: E) => T,
  from: string,
  to: string,
): { from: string; to: string; value: T }[] {
  const out: { from: string; to: string; value: T }[] = [];
  let start = '0000-01';
  for (const entry of [...(earlier ?? []), undefined]) {
    const end = entry?.to ?? '9999-12';
    const a = start > from ? start : from;
    const b = end < to ? end : to;
    if (a <= b) out.push({ from: a, to: b, value: entry === undefined ? current : pick(entry) });
    if (entry !== undefined) start = addMonths(entry.to as YearMonth, 1);
  }
  return out;
}

type Beds = Pick<Apartment, 'posti' | 'rooms'>;
const bedsOf = (e: Beds): Beds =>
  e.rooms === undefined ? { posti: e.posti } : { posti: e.posti, rooms: e.rooms };

/** The beds of the apartment in `month`. */
export const bedsAt = (apartment: Apartment, month: string): Beds =>
  inForce(apartment.earlierBeds, bedsOf(apartment), bedsOf, month);

/** The beds over `from..to`, for what a closed period sees of the apartment. */
export const bedsOver = (
  apartment: Pick<Apartment, 'posti' | 'rooms' | 'earlierBeds'>,
  from: string,
  to: string,
) => stretches(apartment.earlierBeds, bedsOf(apartment), bedsOf, from, to);

/** The apartments and weights of the supply in `month`. */
export const weightsAt = (
  supply: Pick<Supply, 'apartments' | 'earlierApartments'>,
  month: string,
): Supply['apartments'] =>
  inForce(supply.earlierApartments, supply.apartments, (e) => e.apartments, month);

/** The weights over `from..to`, for what a closed period sees of the supply. */
export const weightsOver = (
  supply: Pick<Supply, 'apartments' | 'earlierApartments'>,
  from: string,
  to: string,
) => stretches(supply.earlierApartments, supply.apartments, (e) => e.apartments, from, to);

/**
 * The entries after a change of the current value valid from `validFrom`: the current value is
 * kept up to the month before. In the month the current value starts (the month after the last
 * entry) it is a correction of that value: no entry is added. Before it: `undefined`, refused
 * (`valid-from-order`; undo the later change first).
 */
export function datedChange<E extends Dated>(
  earlier: readonly E[] | undefined,
  validFrom: YearMonth,
  previous: Omit<E, 'to'>,
): E[] | undefined {
  const list = earlier ?? [];
  const last = list.at(-1)?.to;
  if (last !== undefined && validFrom <= last) return undefined;
  if (last !== undefined && validFrom === addMonths(last as YearMonth, 1)) return [...list];
  return [...list, { ...previous, to: addMonths(validFrom, -1) } as unknown as E];
}
