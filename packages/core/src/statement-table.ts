import { z } from 'zod';
import { ISODateSchema } from './model';

// A bank statement as a neutral table: one sheet per CSV or Excel sheet.
// Numbers are decimal text with a dot (never exponent), so no float is involved.
export const StatementCellSchema = z.union([
  z.object({ t: z.literal('s'), v: z.string() }),
  z.object({ t: z.literal('n'), v: z.string().regex(/^-?\d+(\.\d+)?$/) }),
  z.object({ t: z.literal('d'), v: ISODateSchema }),
  z.null(),
]);
export type StatementCell = z.infer<typeof StatementCellSchema>;

export const StatementTableSchema = z.object({
  v: z.literal(1),
  sheets: z
    .array(z.object({ name: z.string(), rows: z.array(z.array(StatementCellSchema)) }))
    .min(1),
});
export type StatementTable = z.infer<typeof StatementTableSchema>;

/** Never carries the cell value: statements hold personal data. */
export class CsvError extends Error {
  constructor(
    readonly code: 'unclosed-quote',
    readonly row: number,
  ) {
    super(`CSV ${code} at row ${row}`);
    this.name = 'CsvError';
  }
}

/** Hand-written reader: quotes with "", ; or , separator, CRLF/LF, UTF-8 BOM, line breaks in quotes. */
export function parseCsv(text: string, separator: ';' | ','): StatementTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: StatementCell[][] = [];
  let row: StatementCell[] = [];
  let field = '';
  let rowNo = 1; // 1-based number of the row being read
  let quoteRow = 0; // row where the open quote started, 0 when none
  let inQuotes = false;
  let touched = false; // the current row has content or a separator

  const endField = (): void => {
    row.push(field === '' ? null : { t: 's', v: field });
    field = '';
  };
  const endRow = (): void => {
    if (touched) {
      endField();
      rows.push(row);
    }
    row = [];
    touched = false;
    rowNo += 1;
  };

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        field += c;
        if (c === '\n') rowNo += 1;
      }
    } else if (c === '"') {
      inQuotes = true;
      quoteRow = rowNo;
      touched = true;
    } else if (c === separator) {
      endField();
      touched = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += c;
      touched = true;
    }
  }
  if (inQuotes) throw new CsvError('unclosed-quote', quoteRow);
  if (touched) endRow();
  return { v: 1, sheets: [{ name: 'Foglio 1', rows }] };
}
