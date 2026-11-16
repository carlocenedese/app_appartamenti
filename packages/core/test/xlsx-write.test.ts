import { describe, expect, it } from 'vitest';
import { cents } from '../src/money';
import { isoDate } from '../src/period';
import { centsToDecimal, columnName, excelSerial, writeXlsx } from '../src/xlsx-write';
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
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
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
    expect(styles).toContain('<cellXfs count="3">');
    // No formula, no document properties, no shared strings.
    const all = [...members.values()].join('');
    expect(all).not.toContain('<f>');
    expect([...members.keys()].some((k) => k.startsWith('docProps') || k.includes('shared'))).toBe(
      false,
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
