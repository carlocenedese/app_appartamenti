/**
 * The safe subset of regular expressions for profile patterns (R102), shared by the statement
 * reader and the profile schema.
 */
/** Profile patterns run only on text up to this long. */
export const MAX_PATTERN_INPUT = 300;
const MAX_PATTERN_LENGTH = 200;
/** Largest `m` of a `{n,m}` quantifier. */
const MAX_BOUNDED = 40;
/**
 * Largest product of the choices of `{n,m}` (m-n+1), `?` (2) and `|` (2), by the number of
 * unbounded quantifiers: they multiply, so one unbounded quantifier leaves little room and two
 * leave none. Measured on 300 hostile characters (see R102).
 */
const BOUNDED_CHOICES = [2000, 44, 1] as const;
/**
 * Largest `bounded x (1 + fixed)`, `fixed` being the sum of the `{n}` repeats: a fixed repeat is a
 * longer comparison at every position the unbounded quantifiers try, so it multiplies the rest.
 */
const WORK = [10000, 80, 2] as const;

/**
 * Whether `pattern` is in a subset that is cheap by construction, found by parsing it (not by
 * matching text against it); everything else is refused. The rules:
 * 1. at most two unbounded quantifiers (`*`, `+`, `{n,}`) in the whole pattern;
 * 2. no quantifier of any kind on a group that holds a quantifier or an alternation `|`;
 * 3. `{n,m}` only with m <= 40, and only the canonical writing of a brace quantifier (no leading
 *    zero, no space, at most three digits): anything else that starts like one is refused; `{n,}`
 *    only with n <= 1;
 * 4. no backreference and no lookaround (only `(...)` and `(?:...)`);
 * 5. the product of the choices of `{n,m}`, `?` and `|` stays within `BOUNDED_CHOICES[unbounded]`
 *    (2000, 44 or 1), so alternations stay out of repeated groups and cannot pile up;
 * 6. that product times (1 + the sum of the `{n}` repeats) stays within `WORK[unbounded]`
 *    (10000, 80 or 2);
 * 7. the pattern is at most 200 characters.
 * The limits were set by measurement, not by proof: 58575 accepted patterns built on `a`, `\w`,
 * `.`, `[a-z]`, `\d`, run on four hostile 300-character inputs, took at worst 80 ms with six
 * processes in parallel and 58 ms alone (R102). A linear-time engine (RE2) or a worker with a
 * timeout would lift the limits: a future decision, since the patterns come from profiles we
 * write, not from hostile files.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  const groups: { quantified: boolean; alternation: boolean }[] = [
    { quantified: false, alternation: false },
  ];
  let unbounded = 0;
  let fixed = 0; // sum of the `{n}` repeats
  let bounded = 1; // product of the choices of `{n,m}`, `?` and `|`
  let i = 0;
  const top = (): { quantified: boolean; alternation: boolean } =>
    groups[groups.length - 1] as { quantified: boolean; alternation: boolean };

  const within = (): boolean =>
    unbounded <= 2 &&
    bounded <= (BOUNDED_CHOICES[unbounded] as number) &&
    bounded * (1 + fixed) <= (WORK[unbounded] as number);

  /** Reads a quantifier at `i`; `undefined` when none, `false` when it is not allowed. */
  const quantifier = (): boolean | undefined => {
    const c = pattern[i];
    let factor: number;
    if (c === '*' || c === '+') {
      unbounded += 1;
      factor = 1;
      i += 1;
    } else if (c === '?') {
      factor = 2;
      i += 1;
    } else if (c === '{') {
      // Only the canonical forms {n}, {n,} and {n,m} (no leading zero, at most 3 digits, no space);
      // anything else that starts like a quantifier is refused, never read leniently.
      const m = /^\{(0|[1-9]\d{0,2})(?:(,)([1-9]\d{0,2})?)?\}/.exec(pattern.slice(i, i + 12));
      if (m === null) return /^\{[\d, ]/.test(pattern.slice(i, i + 2)) ? false : undefined; // else a literal brace
      const low = Number(m[1]);
      i += m[0].length;
      if (m[2] === undefined) {
        if (low > MAX_BOUNDED) return false;
        fixed += low;
        factor = 1;
      } else if (m[3] === undefined) {
        if (low > 1) return false; // `{5,}` repeats five atoms before it loops: measured 3x slower
        unbounded += 1;
        factor = 1;
      } else {
        const high = Number(m[3]);
        if (high > MAX_BOUNDED || high < low) return false;
        factor = high - low + 1;
      }
    } else return undefined;
    if (pattern[i] === '?') i += 1; // lazy
    bounded *= factor;
    return within();
  };

  while (i < pattern.length) {
    const c = pattern[i] as string;
    let group: { quantified: boolean; alternation: boolean } | undefined;
    if (c === '\\') {
      const next = pattern[i + 1];
      if (next === undefined || /[1-9kK]/.test(next)) return false; // backreference
      i += 2;
    } else if (c === '[') {
      i += 1;
      if (pattern[i] === '^') i += 1;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      if (i >= pattern.length) return false;
      i += 1;
    } else if (c === '(') {
      if (pattern[i + 1] === '?') {
        if (pattern[i + 2] !== ':') return false; // lookaround, named group, flags
        i += 3;
      } else i += 1;
      groups.push({ quantified: false, alternation: false });
      continue;
    } else if (c === ')') {
      group = groups.pop();
      if (groups.length === 0 || group === undefined) return false; // unbalanced
      i += 1;
    } else if (c === '|') {
      top().alternation = true;
      bounded *= 2;
      if (bounded > BOUNDED_CHOICES[0]) return false;
      i += 1;
      continue;
    } else i += 1;

    const q = quantifier();
    if (q === false) return false;
    if (q === true) {
      if (group !== undefined && (group.quantified || group.alternation)) return false;
      top().quantified = true;
    }
    if (group !== undefined) {
      top().quantified ||= group.quantified;
      top().alternation ||= group.alternation;
    }
  }
  return groups.length === 1 && within();
}
