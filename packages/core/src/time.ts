/**
 * Timestamps of the journal and of the notes: the ISO 8601 UTC strings the clock passed in by the
 * caller gives (`2026-11-10T20:15:30.123Z`, see `TimestampSchema`). Plain string work, no dates.
 * Internal, not exported from `index.ts`.
 */
import { compareText } from './store/load';

/** The timestamp without its closing `Z`, split into the part up to the seconds and the fraction. */
function splitTimestamp(at: string): [whole: string, fraction: string] {
  const [whole = '', fraction = ''] = at.slice(0, -1).split('.');
  return [whole, fraction];
}

/** `2026-11-10T20:15:30.123Z` as `20261110T201530123Z`: no `-` or `:`, which Windows refuses. */
export function compactTimestamp(at: string): string {
  const [whole, fraction] = splitTimestamp(at);
  const stamp = whole.replaceAll('-', '').replaceAll(':', '');
  return `${stamp}${fraction.padEnd(3, '0').slice(0, 3)}Z`;
}

/**
 * Orders two timestamps by instant, as text, whatever the number of fraction digits: `...:01Z`
 * and `...:01.000Z` are the same instant (comparing the strings would put the first after the
 * second, because `Z` sorts after `.`).
 */
export function compareTimestamps(a: string, b: string): number {
  const [wholeA, fractionA] = splitTimestamp(a);
  const [wholeB, fractionB] = splitTimestamp(b);
  return (
    compareText(wholeA, wholeB) || compareText(fractionA.padEnd(9, '0'), fractionB.padEnd(9, '0'))
  );
}

/**
 * Orders by time, then by id, so that two things made at the same instant keep a fixed order. It
 * orders lists for display. It does not say which of two changes to one record came first: the
 * journal uses the `rev` of the record for that (see `compareTouches` in `journal.ts`), because
 * clocks disagree and with random ids the order of ids is not the order of making.
 */
export function compareByTime(
  a: { at: string; id: string },
  b: { at: string; id: string },
): number {
  return compareTimestamps(a.at, b.at) || compareText(a.id, b.id);
}
