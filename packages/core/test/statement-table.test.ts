import { describe, expect, it } from 'vitest';
import { CsvError, StatementTableSchema, parseCsv } from '../src/statement-table';

const s = (v: string) => ({ t: 's', v });

describe('parseCsv', () => {
  it('strips the BOM and reads CRLF and LF', () => {
    const t = parseCsv('﻿Data;Importo\r\n27/10/2026;"-92,81"\n', ';');
    expect(t.sheets).toHaveLength(1);
    expect(t.sheets[0]?.rows).toEqual([
      [s('Data'), s('Importo')],
      [s('27/10/2026'), s('-92,81')],
    ]);
    expect(StatementTableSchema.parse(t)).toEqual(t);
  });
  it('unescapes doubled quotes', () => {
    expect(parseCsv('"a ""b"""', ';').sheets[0]?.rows).toEqual([[s('a "b"')]]);
  });
  it('does not split on a separator inside quotes, and supports the comma', () => {
    expect(parseCsv('"a;b";c', ';').sheets[0]?.rows).toEqual([[s('a;b'), s('c')]]);
    expect(parseCsv('"a,b",c', ',').sheets[0]?.rows).toEqual([[s('a,b'), s('c')]]);
  });
  it('keeps line breaks inside quotes', () => {
    expect(parseCsv('"a\r\nb";c\nd;e', ';').sheets[0]?.rows).toEqual([
      [s('a\r\nb'), s('c')],
      [s('d'), s('e')],
    ]);
  });
  it('makes empty cells null and skips blank lines', () => {
    expect(parseCsv('a;;c\n\n;\n', ';').sheets[0]?.rows).toEqual([
      [s('a'), null, s('c')],
      [null, null],
    ]);
    expect(parseCsv('"";x', ';').sheets[0]?.rows).toEqual([[null, s('x')]]);
  });
  it('yields one empty sheet for empty text', () => {
    expect(parseCsv('', ';').sheets).toEqual([{ name: 'Foglio 1', rows: [] }]);
  });
  it('throws a typed error with the row for an unclosed quote, without the cell value', () => {
    let err: unknown;
    try {
      parseCsv('Data;Importo\n27/10/2026;"SEGRETO', ';');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CsvError);
    expect((err as CsvError).code).toBe('unclosed-quote');
    expect((err as CsvError).row).toBe(2);
    expect((err as CsvError).message).not.toContain('SEGRETO');
  });
  it('counts line breaks inside quotes when locating an unclosed quote', () => {
    expect(() => parseCsv('a\n"x\ny\nz";b\nc;"d', ';')).toThrow(
      expect.objectContaining({ row: 5 }),
    );
  });
});

describe('StatementTableSchema', () => {
  const table = (cell: unknown) => ({ v: 1, sheets: [{ name: 'x', rows: [[cell]] }] });
  it('accepts valid cells', () => {
    const ok = [
      null,
      s('x'),
      { t: 'n', v: '-12.50' },
      { t: 'n', v: '3' },
      { t: 'd', v: '2026-02-28' },
    ];
    for (const c of ok) expect(StatementTableSchema.safeParse(table(c)).success).toBe(true);
  });
  it('rejects exponent numbers, impossible dates, and no sheets', () => {
    expect(StatementTableSchema.safeParse(table({ t: 'n', v: '1e5' })).success).toBe(false);
    expect(StatementTableSchema.safeParse(table({ t: 'n', v: '1,5' })).success).toBe(false);
    expect(StatementTableSchema.safeParse(table({ t: 'd', v: '2026-02-30' })).success).toBe(false);
    expect(StatementTableSchema.safeParse({ v: 1, sheets: [] }).success).toBe(false);
  });
});
