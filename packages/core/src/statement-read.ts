import type { BankProfile } from './model';
import { cents, parseEuro, type Cents } from './money';
import { normaliseIban } from './iban';
import { isoDate, type ISODate } from './period';
import type { StatementCell, StatementTable } from './statement-table';
import { foldText } from './text';

export type StatementRow = {
  row: number;
  date: ISODate;
  amount: Cents;
  description: string;
  dispCode?: string;
  counterparty?: { name?: string; iban?: string };
  booked: boolean;
};
export type StatementRead = {
  rows: StatementRow[];
  declaredPeriod?: { from: ISODate; to: ISODate };
  declaredAccount?: string;
};

type ErrorCode =
  | 'no-header'
  | 'missing-column'
  | 'bad-date'
  | 'bad-amount'
  | 'ambiguous-number'
  | 'unknown-sign'
  | 'debit-and-credit'
  | 'no-amount'
  | 'zero-amount'
  | 'bad-period'
  | 'unsafe-pattern'
  | 'bad-disp-code';

/** Never carries the cell value: statements hold personal data. `column` is a profile field name. */
export class StatementReadError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly row: number,
    readonly column?: string,
  ) {
    super(`Statement ${code} at row ${row}${column === undefined ? '' : ` (${column})`}`);
    this.name = 'StatementReadError';
  }
}

/** Profile patterns run only on text up to this long (a longer text is skipped). */
const MAX_PATTERN_INPUT = 300;
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

function safePattern(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  // Row 0: the profile is at fault, not a row of the file.
  if (!isSafePattern(pattern)) throw new StatementReadError('unsafe-pattern', 0);
  try {
    return new RegExp(pattern);
  } catch {
    throw new StatementReadError('unsafe-pattern', 0); // e.g. `*a`, `a**`, `a{2}{3}`
  }
}

function exec(re: RegExp | undefined, text: string): RegExpExecArray | null {
  // The cell is trimmed first: a profile writes `(\\d+)`, not `^\\s*(\\d+)\\s*$`.
  const input = text.trim();
  return re === undefined || input.length > MAX_PATTERN_INPUT ? null : re.exec(input);
}

const text = (cell: StatementCell | undefined): string =>
  cell === null || cell === undefined ? '' : cell.v;

function toDate(value: string, format: BankProfile['dateFormat']): ISODate | undefined {
  const m = (
    format === 'DD/MM/YYYY' ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{4})-(\d{2})-(\d{2})$/
  ).exec(value.trim());
  if (m === null) return undefined;
  try {
    return isoDate(format === 'DD/MM/YYYY' ? `${m[3]}-${m[2]}-${m[1]}` : value.trim());
  } catch {
    return undefined;
  }
}

/** The rows of the first sheet, read with the bank profile. */
export function readStatementTable(table: StatementTable, profile: BankProfile): StatementRead {
  const rows = table.sheets[0]?.rows ?? [];
  const accountRe = safePattern(profile.accountPattern);
  const periodRe = safePattern(profile.periodPattern);
  const dispCodeRe = safePattern(profile.dispCodePattern);
  const nameRe = safePattern(profile.counterparty?.name);
  const ibanRe = safePattern(profile.counterparty?.iban);

  const labels = profile.header.allOf.map(foldText);
  const headerAt = rows.findIndex((r) => {
    const folded = new Set(r.map((c) => (c?.t === 's' ? foldText(c.v) : '')));
    return labels.every((l) => folded.has(l));
  });
  if (headerAt < 0) throw new StatementReadError('no-header', 0);
  const headerRow = rows[headerAt] ?? [];
  const col = (label: string | undefined, key: string): number | undefined => {
    if (label === undefined) return undefined;
    const at = headerRow.findIndex((c) => c?.t === 's' && foldText(c.v) === foldText(label));
    if (at < 0) throw new StatementReadError('missing-column', headerAt + 1, key);
    return at;
  };
  const c = profile.columns;
  const dateCol = col(c.date, 'date') as number;
  const descCols = c.description.map((l) => col(l, 'description') as number);
  const amountCol = col(c.amount, 'amount');
  const debitCol = col(c.debit, 'debit');
  const creditCol = col(c.credit, 'credit');
  const signCol = col(c.sign, 'sign');
  const codeCol = col(c.dispCode, 'dispCode');
  const pendingCol = col(c.pending, 'pending');

  const result: StatementRead = { rows: [] };
  for (let r = 0; r < headerAt; r += 1) {
    for (const cell of rows[r] ?? []) {
      if (cell?.t !== 's') continue;
      const p = exec(periodRe, cell.v);
      if (p !== null && result.declaredPeriod === undefined) {
        const from = toDate(p[1] ?? '', profile.dateFormat);
        const to = toDate(p[2] ?? '', profile.dateFormat);
        if (from === undefined || to === undefined || from > to) {
          throw new StatementReadError('bad-period', r + 1);
        }
        result.declaredPeriod = { from, to };
      }
      const a = exec(accountRe, cell.v);
      if (a?.[1] !== undefined && result.declaredAccount === undefined) {
        result.declaredAccount = normaliseIban(a[1]) ?? a[1].trim();
      }
    }
  }

  const magnitude = (cell: StatementCell | undefined, row: number, column: string): Cents => {
    if (cell?.t === 'n') {
      if (/^-?[0-9]+(\.[0-9]{1,2})?$/.test(cell.v)) {
        try {
          return parseEuro(cell.v); // throws on a number beyond the safe integers, with the value
        } catch {
          throw new StatementReadError('bad-amount', row, column);
        }
      }
      // `1.234` could be one euro and a bit or one thousand two hundred: never guess.
      throw new StatementReadError(
        /^-?[0-9]+\.[0-9]{3}$/.test(cell.v) ? 'ambiguous-number' : 'bad-amount',
        row,
        column,
      );
    }
    try {
      return parseEuro(text(cell));
    } catch {
      throw new StatementReadError('bad-amount', row, column);
    }
  };
  const empty = (cell: StatementCell | undefined): boolean => text(cell).trim() === '';
  const among = (cell: StatementCell | undefined, values: string[] | undefined): boolean =>
    values?.map(foldText).includes(foldText(text(cell))) ?? false;

  for (let r = headerAt + 1; r < rows.length; r += 1) {
    const cells = rows[r] ?? [];
    if (cells.every(empty)) continue;
    const row = r + 1;

    // Footer rows (totals, balance) have neither date nor amount; text in the date cell is not skipped.
    const noAmount =
      amountCol !== undefined
        ? empty(cells[amountCol])
        : empty(cells[debitCol as number]) && empty(cells[creditCol as number]);
    if (empty(cells[dateCol]) && noAmount) continue;
    const dateCell = cells[dateCol];
    const date =
      dateCell?.t === 'd'
        ? dateCell.v
        : dateCell?.t === 's'
          ? toDate(dateCell.v, profile.dateFormat)
          : undefined;
    if (date === undefined) throw new StatementReadError('bad-date', row, 'date');

    let amount: number;
    if (amountCol !== undefined) {
      const cell = cells[amountCol];
      if (empty(cell)) throw new StatementReadError('no-amount', row, 'amount');
      const value = magnitude(cell, row, 'amount');
      // An empty Segno cell is fine only for a negative amount: a positive one would be a silent credit.
      if (signCol === undefined || (empty(cells[signCol]) && value <= 0)) amount = value;
      else {
        const sign = cells[signCol];
        if (among(sign, profile.signValues?.debit)) amount = -Math.abs(value);
        else if (among(sign, profile.signValues?.credit)) amount = Math.abs(value);
        else throw new StatementReadError('unknown-sign', row, 'sign');
      }
    } else {
      const debit = cells[debitCol as number];
      const credit = cells[creditCol as number];
      if (!empty(debit) && !empty(credit)) throw new StatementReadError('debit-and-credit', row);
      if (empty(debit) && empty(credit)) throw new StatementReadError('no-amount', row);
      amount = empty(debit)
        ? Math.abs(magnitude(credit, row, 'credit'))
        : -Math.abs(magnitude(debit, row, 'debit'));
    }
    if (amount === 0) throw new StatementReadError('zero-amount', row);

    const description = descCols
      .map((i) => text(cells[i]).trim())
      .filter((t) => t !== '')
      .join(' - ');
    const entry: StatementRow = {
      row,
      date,
      amount: cents(amount),
      description,
      booked: !(pendingCol !== undefined && among(cells[pendingCol], profile.pendingValues)),
    };
    const code = codeCol === undefined ? '' : text(cells[codeCol]).trim();
    if (code !== '') {
      if (dispCodeRe !== undefined && exec(dispCodeRe, code) === null) {
        throw new StatementReadError('bad-disp-code', row, 'dispCode');
      }
      entry.dispCode = code;
    }

    const name = exec(nameRe, description)?.[1]?.trim();
    const iban = normaliseIban(exec(ibanRe, description)?.[1] ?? '');
    if (name !== undefined && name !== '') entry.counterparty = { name };
    if (iban !== undefined) entry.counterparty = { ...entry.counterparty, iban };
    result.rows.push(entry);
  }
  return result;
}
