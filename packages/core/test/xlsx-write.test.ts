import { describe, expect, it } from 'vitest';
import { cents } from '../src/money';
import { isoDate } from '../src/period';
import {
  MAX_WIDTH,
  MIN_WIDTH,
  centsToDecimal,
  columnName,
  columnWidth,
  displayLength,
  excelSerial,
  writeXlsx,
} from '../src/xlsx-write';
import type { XlsxCell, XlsxWorkbook } from '../src/xlsx-write';

/** The members of a stored zip, read through its central directory. */
function unzip(zip: Uint8Array): Map<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const members = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const size = v.getUint32(at + 20, true);
    const nameLength = v.getUint16(at + 28, true);
    const offset = v.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    const local = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    members.set(name, decoder.decode(zip.subarray(local, local + size)));
    at += 46 + nameLength;
  }
  return members;
}

const t = (value: string): XlsxCell => ({ kind: 'text', value });
const one = (name: string, cell: XlsxCell): XlsxWorkbook => ({
  sheets: [{ name, rows: [[cell]] }],
});

describe('columnName', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702, 16383].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
      'XFD',
    ]);
    expect(() => columnName(-1)).toThrow(RangeError);
    expect(() => columnName(16384)).toThrow(RangeError);
    expect(() => columnName(1.5)).toThrow(RangeError);
  });
});

describe('centsToDecimal', () => {
  it('writes two decimals with integers only', () => {
    expect(centsToDecimal(cents(123456))).toBe('1234.56');
    expect(centsToDecimal(cents(-6300))).toBe('-63.00');
    expect(centsToDecimal(cents(5))).toBe('0.05');
    expect(centsToDecimal(cents(-5))).toBe('-0.05');
    expect(centsToDecimal(cents(0))).toBe('0.00');
  });
});

describe('excelSerial', () => {
  it('counts the days from 1899-12-30, from 1900-03-01 on', () => {
    expect(excelSerial(isoDate('1900-03-01'))).toBe(61);
    expect(excelSerial(isoDate('2026-03-16'))).toBe(46097);
    expect(() => excelSerial(isoDate('1900-02-28'))).toThrow(RangeError);
  });
});

describe('writeXlsx', () => {
  const workbook: XlsxWorkbook = {
    sheets: [
      {
        name: 'Prova',
        rows: [
          [t('Tipo'), t('Importo')],
          [t('A&B <x>'), { kind: 'euro', value: cents(123456) }],
          [null, { kind: 'date', value: isoDate('2026-03-16') }],
        ],
      },
      { name: 'Altro "x"', rows: [[], [{ kind: 'int', value: 7 }]] },
    ],
  };

  it('writes the parts in order and the exact XML of a sheet', () => {
    const members = unzip(writeXlsx(workbook));
    expect([...members.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(members.get('xl/worksheets/sheet1.xml')).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<cols><col min="1" max="1" width="9" customWidth="1"/>' +
        '<col min="2" max="2" width="12" customWidth="1"/></cols><sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">Tipo</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t xml:space="preserve">Importo</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">A&amp;B &lt;x&gt;</t></is></c>' +
        '<c r="B2" s="1"><v>1234.56</v></c></row>' +
        '<row r="3"><c r="B3" s="2"><v>46097</v></c></row>' +
        '</sheetData></worksheet>',
    );
    // An empty row has no element; an int is a plain value.
    expect(members.get('xl/worksheets/sheet2.xml')).toContain(
      '<sheetData><row r="2"><c r="A2"><v>7</v></c></row></sheetData>',
    );
  });

  it('lists the sheets in order with coherent ids, relationships and overrides', () => {
    const members = unzip(writeXlsx(workbook));
    const book = members.get('xl/workbook.xml') ?? '';
    expect(book).toContain(
      '<sheets><sheet name="Prova" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Altro &quot;x&quot;" sheetId="2" r:id="rId2"/></sheets>',
    );
    const rels = members.get('xl/_rels/workbook.xml.rels') ?? '';
    expect(rels).toContain(
      'Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"',
    );
    expect(rels).toContain(
      'Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"',
    );
    expect(rels).toContain(
      'Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"',
    );
    const types = members.get('[Content_Types].xml') ?? '';
    for (const n of [1, 2]) {
      expect(types).toContain(
        `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      );
    }
    const styles = members.get('xl/styles.xml') ?? '';
    expect(styles).toContain(
      '<numFmt numFmtId="164" formatCode="&quot;€ &quot;#,##0.00;&quot;- € &quot;#,##0.00"/>',
    );
    expect(styles).toContain('<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>');
    expect(styles).toContain('<cellXfs count="8">');
    // No formula, no document properties, no shared strings.
    const all = [...members.values()].join('');
    expect(all).not.toContain('<f>');
    expect([...members.keys()].some((k) => k.startsWith('docProps') || k.includes('shared'))).toBe(
      false,
    );
  });

  it('keeps an _xHHHH_ sequence and a carriage return as they are (ST_Xstring)', () => {
    const sheet = unzip(writeXlsx(one('a', t('_x0041_ e a\rb\r\nc_x00'))));
    expect(sheet.get('xl/worksheets/sheet1.xml')).toContain(
      '<t xml:space="preserve">_x005F_x0041_ e a_x000D_b_x000D_\nc_x00</t>',
    );
  });

  it('gives the same bytes for the same workbook', () => {
    expect(writeXlsx(workbook)).toEqual(writeXlsx(structuredClone(workbook)));
  });

  it.each([
    ['no sheets', { sheets: [] }],
    ['a sheet name with a slash', one('A/B', t('x'))],
    ['a sheet name of 32 characters', one('x'.repeat(32), t('x'))],
    ['an empty sheet name', one('', t('x'))],
    ['a sheet name starting with a quote', one("'a", t('x'))],
    [
      'two sheet names that differ only in case',
      {
        sheets: [
          { name: 'Foglio', rows: [] },
          { name: 'foglio', rows: [] },
        ],
      },
    ],
    ['a control character', one('a', t('a\u0001b'))],
    ['a lone surrogate', one('a', t('a\uD800b'))],
    ['a text too long', one('a', t('x'.repeat(32768)))],
    ['a non-integer int', one('a', { kind: 'int', value: 1.5 })],
    ['a non-integer euro', one('a', { kind: 'euro', value: 1.5 as never })],
    [
      'too many columns',
      { sheets: [{ name: 'a', rows: [Array.from({ length: 16385 }, () => null)] }] },
    ],
  ])('refuses %s with a constant message', (_, book) => {
    expect(() => writeXlsx(book as XlsxWorkbook)).toThrow(RangeError);
    expect(() => writeXlsx(book as XlsxWorkbook)).not.toThrow(/xxxx|a.b/);
  });
});

describe('readability (R408)', () => {
  const euro = (n: number): XlsxCell => ({ kind: 'euro', value: cents(n) });
  const sheetOf = (workbook: XlsxWorkbook) =>
    unzip(writeXlsx(workbook)).get('xl/worksheets/sheet1.xml') ?? '';
  const widths = (xml: string) =>
    [...xml.matchAll(/<col min="(\d+)" max="\1" width="(\d+)" customWidth="1"\/>/g)].map((m) =>
      Number(m[2]),
    );

  it('measures what a cell shows', () => {
    expect(displayLength(euro(-123456))).toBe('- € 1.234,56'.length);
    expect(displayLength(euro(5))).toBe('€ 0,05'.length);
    expect(displayLength({ kind: 'date', value: isoDate('2026-03-16') })).toBe(10);
    expect(displayLength({ kind: 'int', value: -42 })).toBe(3);
    expect(displayLength(t('due\nrighe lunghe'))).toBe('righe lunghe'.length);
    expect(displayLength(t('città'))).toBe(5);
  });

  it('sizes each column from its longest text, within the bounds', () => {
    expect([0, 6, 7, 30, 58, 59, 500].map(columnWidth)).toEqual([8, 8, 9, 32, 60, 60, 60]);
    expect([MIN_WIDTH, MAX_WIDTH]).toEqual([8, 60]);
    const long = 'Bolletta della luce del bimestre di ottobre e novembre, conguaglio';
    const xml = sheetOf({
      sheets: [
        {
          name: 'S',
          rows: [
            [t('Nota'), t('Importo'), t('x')],
            [t('Fornitore con un nome lungo'), euro(-123456), t(long)],
          ],
        },
      ],
    });
    expect(widths(xml)).toEqual([29, 14, 60]);
    // Only the text over the maximum wraps (style 3).
    expect(xml).toContain('<c r="C2" s="3" t="inlineStr">');
    expect(xml).toContain('<c r="A2" t="inlineStr">');
  });

  it('lets a title alone in its row run over the empty cells', () => {
    const title = 'Conguaglio provvisorio: 2 voci in attesa di pagamento, da rifare alla chiusura';
    const xml = sheetOf({ sheets: [{ name: 'S', rows: [[t(title)], [t('Tipo'), euro(100)]] }] });
    expect(widths(xml)).toEqual([8, 8]);
    expect(xml).toContain('<c r="A1" t="inlineStr">');
  });

  it('writes the views, the columns and the data in the schema order', () => {
    const xml = sheetOf({
      sheets: [
        {
          name: 'S',
          rows: [
            [t('Stato')],
            [t('Nome'), t('Importo')],
            [t('Anna'), euro(100)],
            [t('Totale'), euro(100)],
          ],
          header: 1,
          totals: [3],
          freezeColumns: 1,
        },
      ],
    });
    const at = (part: string) => xml.indexOf(part);
    expect(at('<sheetViews>')).toBeGreaterThan(0);
    expect(at('<sheetViews>')).toBeLessThan(at('<cols>'));
    expect(at('<cols>')).toBeLessThan(at('<sheetData>'));
    expect(xml).toContain(
      '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" ' +
        'activePane="bottomRight" state="frozen"/></sheetView></sheetViews>',
    );
    // The header and the total in bold (4 + base), the other rows not.
    expect(xml).toContain('<c r="B2" s="4" t="inlineStr">');
    expect(xml).toContain('<c r="B4" s="5"><v>1.00</v></c>');
    expect(xml).toContain('<c r="B3" s="1"><v>1.00</v></c>');
    const rowsOnly = sheetOf({ sheets: [{ name: 'S', rows: [[t('a')]], header: 0 }] });
    expect(rowsOnly).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    const columnsOnly = sheetOf({ sheets: [{ name: 'S', rows: [[t('a')]], freezeColumns: 2 }] });
    expect(columnsOnly).toContain(
      '<pane xSplit="2" topLeftCell="C1" activePane="topRight" state="frozen"/>',
    );
    expect(sheetOf({ sheets: [{ name: 'S', rows: [] }] })).toContain(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData>',
    );
  });

  it('declares the bold font, the right-aligned amounts and the view the panes refer to', () => {
    const members = unzip(writeXlsx({ sheets: [{ name: 'S', rows: [[t('a')]] }] }));
    const styles = members.get('xl/styles.xml') ?? '';
    expect(styles).toContain('<font><b/><sz val="11"/><name val="Calibri"/></font>');
    expect(styles).toContain(
      '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" ' +
        'applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf>',
    );
    expect(members.get('xl/workbook.xml')).toContain(
      '<bookViews><workbookView/></bookViews><sheets>',
    );
  });

  it('writes «Generato il» under every sheet, from the given day only', () => {
    const rows = [[t('Nome'), euro(100)]];
    const members = unzip(
      writeXlsx({
        generatedOn: isoDate('2026-11-20'),
        sheets: [
          { name: 'A', rows },
          { name: 'B', rows },
        ],
      }),
    );
    for (const sheet of ['sheet1', 'sheet2']) {
      expect(members.get(`xl/worksheets/${sheet}.xml`)).toContain(
        '<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">Generato il 20/11/2026</t></is></c></row></sheetData>',
      );
    }
    // The line does not widen column A.
    expect(widths(members.get('xl/worksheets/sheet1.xml') ?? '')).toEqual([8, 8]);
    expect(sheetOf({ sheets: [{ name: 'A', rows }] })).not.toContain('Generato');
  });
});
