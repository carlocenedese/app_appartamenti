import type { BankProfile } from './model';
import { cents, parseEuro, type Cents } from './money';
import { normaliseIban } from './iban';
import { MAX_PATTERN_INPUT, isSafePattern } from './safe-pattern';
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
  | 'bad-disp-code'
  | 'sign-conflict'
  | 'bad-account'
  | 'bad-row-count'
  | 'row-count-mismatch'
  | 'ambiguous-profile';

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

export { isSafePattern } from './safe-pattern';

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
const empty = (cell: StatementCell | undefined): boolean => text(cell).trim() === '';

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
  const pre = profile.preamble;
  if (
    profile.periodPattern !== undefined &&
    (pre?.periodFrom !== undefined || pre?.periodTo !== undefined)
  ) {
    throw new StatementReadError('ambiguous-profile', 0, 'periodPattern');
  }
  if (profile.accountPattern !== undefined && pre?.account !== undefined) {
    throw new StatementReadError('ambiguous-profile', 0, 'accountPattern');
  }
  const preambleAccountRe = safePattern(pre?.account?.pattern);
  // The cell to the right of the first label `label` above the header: its text, its row (1-based).
  const afterLabel = (
    label: string | undefined,
  ): { cell: StatementCell; row: number } | undefined => {
    if (label === undefined) return undefined;
    const wanted = foldText(label);
    for (let r = 0; r < headerAt; r += 1) {
      const cells = rows[r] ?? [];
      const at = cells.findIndex((cell) => cell?.t === 's' && foldText(cell.v) === wanted);
      if (at >= 0) return { cell: cells.slice(at + 1).find((x) => !empty(x)) ?? null, row: r + 1 };
    }
    return undefined;
  };
  const periodFrom = afterLabel(pre?.periodFrom?.label);
  const periodTo = afterLabel(pre?.periodTo?.label);
  if (periodFrom !== undefined || periodTo !== undefined) {
    const day = (found: typeof periodFrom, column: string): ISODate => {
      const cell = found?.cell;
      const date =
        cell?.t === 'd' ? cell.v : cell?.t === 's' ? toDate(cell.v, profile.dateFormat) : undefined;
      if (date === undefined) throw new StatementReadError('bad-period', found?.row ?? 0, column);
      return date;
    };
    const from = day(periodFrom, 'periodFrom');
    const to = day(periodTo, 'periodTo');
    if (from > to) throw new StatementReadError('bad-period', periodTo?.row ?? 0, 'periodTo');
    result.declaredPeriod = { from, to };
  }
  const accountLine = afterLabel(pre?.account?.label);
  if (accountLine !== undefined) {
    const a = accountLine.cell?.t === 's' ? exec(preambleAccountRe, accountLine.cell.v) : null;
    if (a?.[1] === undefined)
      throw new StatementReadError('bad-account', accountLine.row, 'account');
    result.declaredAccount = normaliseIban(a[1]) ?? a[1].trim();
  }
  const countLine = afterLabel(pre?.rowCount?.label);
  let declaredCount: number | undefined;
  if (countLine !== undefined) {
    const raw =
      countLine.cell?.t === 'n' || countLine.cell?.t === 's' ? countLine.cell.v.trim() : '';
    // A number cell comes as `16` or `16.0`; anything else (a decimal, a sign, a word) is not a count.
    if (!/^[0-9]{1,9}(\.0+)?$/.test(raw)) {
      throw new StatementReadError('bad-row-count', countLine.row, 'rowCount');
    }
    declaredCount = Number(raw);
  }
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
        else if (among(sign, profile.signValues?.credit)) {
          // A negative amount with a credit sign contradicts itself: never read it as a credit.
          if (value < 0) throw new StatementReadError('sign-conflict', row, 'sign');
          amount = value;
        } else throw new StatementReadError('unknown-sign', row, 'sign');
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
    // An IBAN that is not valid is kept as read, so `whoPaid` gives `invalid-iban` (user1,
    // 15 Nov 2026, R102, R120); the identity of the movement never depends on it (R100).
    const readIban = exec(ibanRe, description)?.[1]?.trim() ?? '';
    const iban = readIban === '' ? undefined : (normaliseIban(readIban) ?? readIban);
    if (name !== undefined && name !== '') entry.counterparty = { name };
    if (iban !== undefined) entry.counterparty = { ...entry.counterparty, iban };
    result.rows.push(entry);
  }
  if (declaredCount !== undefined && declaredCount !== result.rows.length) {
    throw new StatementReadError('row-count-mismatch', countLine?.row ?? 0, 'rowCount');
  }
  return result;
}
