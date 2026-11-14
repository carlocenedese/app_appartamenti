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
  | 'unsafe-pattern';

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

/** Profile patterns run only on text up to this long: bounds the work of any pattern. */
const MAX_PATTERN_INPUT = 1000;

/**
 * Whether `pattern` nests a quantifier in a group that is itself repeated with `+`, `*` or `{n,}`
 * (`(a+)+$`), the classic catastrophic-backtracking shape.
 * shortcut: overlapping alternations such as `(a|a)*` are not detected; the input cap bounds them.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const bare = pattern.replace(/\\./gs, '_').replace(/\[[^\]]*\]/g, '_');
  const repeat = (at: number): number => {
    const c = bare[at];
    if (c === '+' || c === '*') return 1;
    if (c === '{') return /^\{\d*,\d*\}/.test(bare.slice(at)) ? 1 : 0;
    return 0;
  };
  const stack: boolean[] = [];
  for (let i = 0; i < bare.length; i += 1) {
    if (bare[i] === '(') stack.push(false);
    else if (bare[i] === ')') {
      const inner = stack.pop() ?? false;
      if (inner && repeat(i + 1) === 1) return true;
      if (inner && stack.length > 0) stack[stack.length - 1] = true;
      if (repeat(i + 1) === 1 && stack.length > 0) stack[stack.length - 1] = true;
    } else if (repeat(i) === 1 && stack.length > 0) stack[stack.length - 1] = true;
  }
  return false;
}

function safePattern(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  if (hasNestedQuantifier(pattern)) throw new StatementReadError('unsafe-pattern', 0);
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
      if (/^-?[0-9]+(\.[0-9]{1,2})?$/.test(cell.v)) return parseEuro(cell.v);
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
      // An empty Segno cell leaves the sign the amount already has.
      if (signCol === undefined || empty(cells[signCol])) amount = value;
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
    if (code !== '') entry.dispCode = code;

    const name = exec(nameRe, description)?.[1]?.trim();
    const iban = normaliseIban(exec(ibanRe, description)?.[1] ?? '');
    if (name !== undefined && name !== '') entry.counterparty = { name };
    if (iban !== undefined) entry.counterparty = { ...entry.counterparty, iban };
    result.rows.push(entry);
  }
  return result;
}
