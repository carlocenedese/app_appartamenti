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
/** Largest product of the choices the quantifiers and alternations can make (see `isSafePattern`). */
const MAX_CHOICES = MAX_PATTERN_INPUT * MAX_PATTERN_INPUT * 2;

/**
 * Whether `pattern` is in a subset that is cheap by construction, found by parsing it (not by
 * matching text against it); everything else is refused. The rules:
 * 1. at most two unbounded quantifiers (`*`, `+`, `{n,}`) in the whole pattern;
 * 2. no quantifier of any kind on a group that holds a quantifier or an alternation `|`;
 * 3. `{n,m}` only with m <= 40;
 * 4. no backreference and no lookaround (only `(...)` and `(?:...)`);
 * 5. the product of the choices (an unbounded quantifier counts 300, `{n,m}` m-n+1, `?` 2, each
 *    `|` 2) is at most 300 x 300 x 2, so alternations stay out of repeated groups and cannot pile up.
 * Backtracking then takes at most 300 (start positions) x that product steps on an input of at
 * most 300 characters, and the typical patterns of a bank profile are well inside. The measured
 * worst cases are under 100 ms. A linear-time engine (RE2) or a worker with a timeout would lift
 * the limits: a future decision, since the patterns come from profiles we write, not from files.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  const groups: { quantified: boolean; alternation: boolean }[] = [
    { quantified: false, alternation: false },
  ];
  let unbounded = 0;
  let choices = 1;
  let i = 0;
  const top = (): { quantified: boolean; alternation: boolean } =>
    groups[groups.length - 1] as { quantified: boolean; alternation: boolean };

  /** Reads a quantifier at `i`; `undefined` when none, `false` when it is not allowed. */
  const quantifier = (): boolean | undefined => {
    const c = pattern[i];
    let factor: number;
    if (c === '*' || c === '+') {
      unbounded += 1;
      factor = MAX_PATTERN_INPUT;
      i += 1;
    } else if (c === '?') {
      factor = 2;
      i += 1;
    } else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i, i + 12));
      if (m === null) return undefined; // not a quantifier: a literal brace
      const low = Number(m[1]);
      i += m[0].length;
      if (m[2] === undefined) {
        if (low > MAX_BOUNDED) return false;
        factor = 1;
      } else if (m[3] === '') {
        unbounded += 1;
        factor = MAX_PATTERN_INPUT;
      } else {
        const high = Number(m[3]);
        if (high > MAX_BOUNDED || high < low) return false;
        factor = high - low + 1;
      }
    } else return undefined;
    if (pattern[i] === '?') i += 1; // lazy
    choices *= factor;
    return unbounded <= 2 && choices <= MAX_CHOICES;
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
      choices *= 2;
      if (choices > MAX_CHOICES) return false;
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
  return groups.length === 1;
}

function safePattern(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  // Row 0: the profile is at fault, not a row of the file.
  if (!isSafePattern(pattern)) throw new StatementReadError('unsafe-pattern', 0);
  return new RegExp(pattern);
}

function exec(re: RegExp | undefined, text: string): RegExpExecArray | null {
  return re === undefined || text.length > MAX_PATTERN_INPUT ? null : re.exec(text);
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
