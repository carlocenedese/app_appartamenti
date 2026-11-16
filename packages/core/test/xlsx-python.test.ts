/**
 * The `.xlsx` of `writeXlsx` read back by the strict Python reader (`python -I -m bollette_pdf
 * table`, R103): it is the validity check of the generated file (R152). Skipped without a Python
 * that runs `bollette_pdf`, except with REQUIRE_PYTHON=1 (the CI), where it fails with the reason.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StatementTableSchema, cents, isoDate, writeXlsx } from '../src/index';
import type { XlsxCell, XlsxWorkbook } from '../src/index';
import { pythonAvailability, runPython } from './helpers/python-extract';

const TIMEOUT = 60_000;
const availability = pythonAvailability();
const required = process.env.REQUIRE_PYTHON === '1';

if (!availability.available && required) {
  describe('the xlsx writer and the Python reader', () => {
    it('needs Python with bollette_pdf (REQUIRE_PYTHON=1)', () => {
      throw new Error(
        `REQUIRE_PYTHON=1 ma Python non è disponibile: ${availability.reason} ` +
          'Installare python/requirements.txt, poi «pnpm python:dev-install».',
      );
    });
  });
}

const t = (value: string): XlsxCell => ({ kind: 'text', value });
const WORKBOOK: XlsxWorkbook = {
  sheets: [
    {
      name: 'Bollette',
      rows: [
        [t('Tipo'), t('Importo'), t('Commissione'), t('Data')],
        [
          t('Elettricità è & co'),
          { kind: 'euro', value: cents(123456) },
          { kind: 'euro', value: cents(-6300) },
          { kind: 'date', value: isoDate('2026-03-16') },
        ],
        [],
        [t('Gas'), null, { kind: 'int', value: 7 }],
      ],
    },
    { name: 'Conguagli', rows: [[t('Inquilino')], [t('Anna Prova')]] },
  ],
};

describe.skipIf(!availability.available)('the xlsx writer and the Python reader', () => {
  let root = '';
  let file = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bollette-excel-'));
    file = join(root, 'Città è.xlsx'.normalize('NFC'));
    writeFileSync(file, writeXlsx(WORKBOOK));
  });

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it(
    'reads back every sheet, text, amount, date and hole',
    async () => {
      const output = await runPython(['-I', '-m', 'bollette_pdf', 'table', file], { cwd: root });
      const table = StatementTableSchema.parse(JSON.parse(output));
      expect(table.sheets.map((s) => s.name)).toEqual(['Bollette', 'Conguagli']);
      const [bollette, conguagli] = table.sheets;
      const rows = bollette?.rows ?? [];
      // Row N of the table is row N of Excel: the empty third row is `[]`.
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual([
        { t: 's', v: 'Tipo' },
        { t: 's', v: 'Importo' },
        { t: 's', v: 'Commissione' },
        { t: 's', v: 'Data' },
      ]);
      const [label, amount, negative, date] = rows[1] ?? [];
      expect(label).toEqual({ t: 's', v: 'Elettricità è & co' });
      const centsOf = (cell: typeof amount) => {
        expect(cell?.t).toBe('n');
        return Math.round(Number(cell?.v) * 100);
      };
      expect(centsOf(amount)).toBe(123456);
      expect(centsOf(negative)).toBe(-6300);
      expect(date).toEqual({ t: 'd', v: '2026-03-16' });
      expect(rows[2]).toEqual([]);
      const [gas, hole, count] = rows[3] ?? [];
      expect(gas).toEqual({ t: 's', v: 'Gas' });
      expect(hole).toBeNull();
      expect(count?.t).toBe('n');
      expect(Number(count?.v)).toBe(7);
      expect(conguagli?.rows).toEqual([
        [{ t: 's', v: 'Inquilino' }],
        [{ t: 's', v: 'Anna Prova' }],
      ]);
    },
    TIMEOUT,
  );
});
