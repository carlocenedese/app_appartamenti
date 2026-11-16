/**
 * A minimal SpreadsheetML writer (plan 5, R151): typed cells → the bytes of an `.xlsx`, the same
 * bytes for the same workbook. Only the parts Excel needs (content types, relationships,
 * workbook, styles, one part per sheet), text as inline strings, values only (no formula:
 * question 1), no `docProps` (author and dates would live there), stored in `zipStored`.
 */
import { cents } from './money';
import type { Cents } from './money';
import { daysBetween, isoDate } from './period';
import type { ISODate } from './period';
import { zipStored } from './zip';

export type XlsxCell =
  | { kind: 'text'; value: string }
  | { kind: 'euro'; value: Cents }
  | { kind: 'int'; value: number }
  | { kind: 'date'; value: ISODate };

export interface XlsxSheet {
  name: string;
  rows: readonly (readonly (XlsxCell | null)[])[];
}

export interface XlsxWorkbook {
  sheets: readonly XlsxSheet[];
}

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_TEXT = 32_767;
const FIRST_SERIAL = 61; // 1900-03-01: before it Excel counts a 29 February 1900 that never was
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
// Characters XML 1.0 does not allow, and surrogates without their pair.
const NOT_XML =
  // eslint-disable-next-line no-control-regex -- the control characters are what it looks for
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const BAD_SHEET_NAME = /[[\]:*?/\\]/;

/** `A` for 0, `Z` for 25, `AA` for 26, up to `XFD` for 16 383. */
export function columnName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COLUMNS) {
    throw new RangeError('Column out of range');
  }
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** Cents as decimal text with two decimals, integers only: `-6300` → `-63.00`. */
export function centsToDecimal(amount: Cents): string {
  const absolute = Math.abs(cents(amount));
  const fraction = absolute % 100;
  const units = (absolute - fraction) / 100;
  return `${amount < 0 ? '-' : ''}${String(units)}.${String(fraction).padStart(2, '0')}`;
}

/** The Excel serial number of a date (system 1900), from 1900-03-01 on. */
export function excelSerial(date: ISODate): number {
  const serial = daysBetween(date, isoDate('1899-12-30'));
  if (serial < FIRST_SERIAL) throw new RangeError('Date before 1900-03-01');
  return serial;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Cell text as SpreadsheetML reads it back (ST_Xstring): an `_` that starts `_xHHHH_` becomes
 * `_x005F_`, or Excel would decode it; a carriage return becomes `_x000D_`, which XML would
 * otherwise turn into a line feed.
 */
function escapeCellText(text: string): string {
  return escapeXml(text.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_').replaceAll('\r', '_x000D_'));
}

function assertSheetNames(sheets: readonly XlsxSheet[]): void {
  const seen = new Set<string>();
  for (const { name } of sheets) {
    if (
      name.length === 0 ||
      name.length > 31 ||
      BAD_SHEET_NAME.test(name) ||
      NOT_XML.test(name) ||
      name.startsWith("'") ||
      name.endsWith("'")
    ) {
      throw new RangeError('Invalid sheet name');
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new RangeError('Duplicate sheet name');
    seen.add(key);
  }
}

function cellXml(cell: XlsxCell, ref: string): string {
  switch (cell.kind) {
    case 'text':
      if (cell.value.length > MAX_TEXT || NOT_XML.test(cell.value)) {
        throw new RangeError('Invalid cell text');
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeCellText(cell.value)}</t></is></c>`;
    case 'euro':
      return `<c r="${ref}" s="1"><v>${centsToDecimal(cell.value)}</v></c>`;
    case 'int':
      if (!Number.isSafeInteger(cell.value)) throw new RangeError('Invalid integer cell');
      return `<c r="${ref}"><v>${String(cell.value)}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="2"><v>${String(excelSerial(cell.value))}</v></c>`;
  }
}

function sheetXml(sheet: XlsxSheet): string {
  if (sheet.rows.length > MAX_ROWS) throw new RangeError('Too many rows');
  const rows = sheet.rows.map((row, r) => {
    if (row.length > MAX_COLUMNS) throw new RangeError('Too many columns');
    const cells = row
      .map((cell, c) => (cell === null ? '' : cellXml(cell, `${columnName(c)}${String(r + 1)}`)))
      .join('');
    return cells === '' ? '' : `<row r="${String(r + 1)}">${cells}</row>`;
  });
  return `${XML_HEAD}<worksheet xmlns="${MAIN}"><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${MAIN}">` +
  '<numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="&quot;€ &quot;#,##0.00;&quot;- € &quot;#,##0.00"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * The `.xlsx` bytes of `workbook`. Throws a `RangeError` with a constant message (never the text
 * of a cell) for no sheets, an invalid or repeated sheet name, text XML 1.0 does not allow or
 * longer than 32 767 characters, an `int` that is not a safe integer, too many rows or columns.
 */
export function writeXlsx(workbook: XlsxWorkbook): Uint8Array {
  const { sheets } = workbook;
  if (sheets.length === 0) throw new RangeError('A workbook needs at least one sheet');
  assertSheetNames(sheets);
  const numbers = sheets.map((_, i) => String(i + 1));
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
    numbers
      .map(
        (n) =>
          `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${CT}.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>';
  const rootRels =
    `${XML_HEAD}<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>';
  const book =
    `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>` +
    sheets
      .map(
        (s, i) =>
          `<sheet name="${escapeXml(s.name)}" sheetId="${numbers[i] ?? ''}" r:id="rId${numbers[i] ?? ''}"/>`,
      )
      .join('') +
    '</sheets></workbook>';
  const bookRels =
    `${XML_HEAD}<Relationships xmlns="${PKG_REL}">` +
    numbers
      .map(
        (n) =>
          `<Relationship Id="rId${n}" Type="${REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${String(sheets.length + 1)}" Type="${REL}/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const encoder = new TextEncoder();
  return zipStored([
    { path: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { path: '_rels/.rels', data: encoder.encode(rootRels) },
    { path: 'xl/workbook.xml', data: encoder.encode(book) },
    { path: 'xl/_rels/workbook.xml.rels', data: encoder.encode(bookRels) },
    { path: 'xl/styles.xml', data: encoder.encode(STYLES) },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${numbers[i] ?? ''}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ]);
}
