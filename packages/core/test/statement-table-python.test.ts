/**
 * The XLSX reader of bank statements with the real Python (`python -I -m bollette_pdf table`): a
 * synthetic workbook written by python/tests/xlsx_builder.py (invented account, amounts, dates)
 * → the table → `StatementTableSchema`. Skipped without a Python that runs `bollette_pdf`, except
 * with REQUIRE_PYTHON=1 (the CI), where it fails with the reason.
 */
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BankProfileSchema,
  StatementReadError,
  StatementTableSchema,
  readStatementTable,
} from '../src/index';
import { pythonAvailability, runPython } from './helpers/python-extract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BUILDER = join(REPO, 'python', 'tests', 'xlsx_builder.py');
const PROFILE = BankProfileSchema.parse(
  JSON.parse(readFileSync(join(REPO, 'fixtures', 'bank', 'profilo-sintetico.json'), 'utf8')),
);
const REAL = BankProfileSchema.parse(
  JSON.parse(
    readFileSync(join(REPO, 'fixtures', 'bank', 'profilo-banca-lista-operazioni.json'), 'utf8'),
  ),
);
const TIMEOUT = 60_000;
const TABLE_ERROR = 'File non valido o troppo grande: nessun output.';

const availability = pythonAvailability();
const required = process.env.REQUIRE_PYTHON === '1';

if (!availability.available && required) {
  describe('core and the Python XLSX reader', () => {
    it('needs Python with bollette_pdf (REQUIRE_PYTHON=1)', () => {
      throw new Error(
        `REQUIRE_PYTHON=1 ma Python non è disponibile: ${availability.reason} ` +
          'Installare python/requirements.txt, poi «pnpm python:dev-install».',
      );
    });
  });
}

describe.skipIf(!availability.available)('core and the Python XLSX reader', () => {
  let root = '';
  let folder = '';
  const table = (file: string) =>
    runPython(['-I', '-m', 'bollette_pdf', 'table', join(folder, file)], { cwd: root });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bollette-estratto-'));
    folder = join(root, 'Estratti di prova', 'Città è'.normalize('NFC'));
    mkdirSync(folder, { recursive: true });
    await runPython(['-I', BUILDER, folder], { cwd: root });
    writeFileSync(join(folder, 'non-zip.xlsx'), 'non è uno zip', 'utf8');
  }, TIMEOUT);

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it(
    'prints a table that passes StatementTableSchema, with amounts as text',
    async () => {
      const parsed = StatementTableSchema.parse(JSON.parse(await table('estratto.xlsx')));
      expect(parsed.sheets).toHaveLength(1);
      expect(parsed.sheets[0]?.rows.slice(2)).toEqual([
        [
          { t: 's', v: 'Data' },
          { t: 's', v: 'Descrizione' },
          { t: 's', v: 'Importo' },
        ],
        [
          { t: 'd', v: '2026-10-27' },
          { t: 's', v: 'Pagamento città' },
          { t: 'n', v: '-92.81' },
        ],
        [
          { t: 'd', v: '2026-10-28' },
          { t: 's', v: 'Accredito' },
          { t: 'n', v: '1234.5' },
        ],
        [{ t: 'd', v: '2026-10-29' }, null, { t: 'n', v: '10.0' }],
      ]);
    },
    TIMEOUT,
  );

  it(
    'gives the same bytes twice',
    async () => {
      expect(await table('estratto.xlsx')).toBe(await table('estratto.xlsx'));
    },
    TIMEOUT,
  );

  it(
    'rejects a file that is not a workbook with the constant message and no output',
    async () => {
      await expect(table('non-zip.xlsx')).rejects.toThrow(TABLE_ERROR);
    },
    TIMEOUT,
  );

  it(
    'keeps empty rows, so the rows of the table are the rows of Excel and the core cites them',
    async () => {
      const parsed = StatementTableSchema.parse(JSON.parse(await table('righe-vuote.xlsx')));
      expect(parsed.sheets[0]?.rows.map((row) => row.length)).toEqual([1, 0, 0, 7, 0, 4, 4]);
      const read = readStatementTable(parsed, PROFILE);
      expect(read.rows.map((row) => [row.row, row.amount])).toEqual([
        [6, -9281],
        [7, -1250],
      ]);
    },
    TIMEOUT,
  );

  it(
    'hands 1.234 over as text and the core refuses it as ambiguous, at the Excel row',
    async () => {
      const parsed = StatementTableSchema.parse(JSON.parse(await table('ambigua.xlsx')));
      expect(parsed.sheets[0]?.rows[6]?.[3]).toEqual({ t: 'n', v: '-1.234' });
      let failure: unknown;
      try {
        readStatementTable(parsed, PROFILE);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(StatementReadError);
      expect([(failure as StatementReadError).code, (failure as StatementReadError).row]).toEqual([
        'ambiguous-number',
        7,
      ]);
    },
    TIMEOUT,
  );

  it(
    'reads the synthetic list of operations with the profile of the bank: 16 rows, period, account',
    async () => {
      const parsed = StatementTableSchema.parse(JSON.parse(await table('lista-operazioni.xlsx')));
      expect(parsed.sheets[0]?.rows[17]?.[0]).toEqual({ t: 's', v: 'Data' }); // header on row 18
      const read = readStatementTable(parsed, REAL);
      expect(read.rows).toHaveLength(16);
      expect(read.rows[0]).toMatchObject({ row: 19, date: '2026-10-01', amount: 5000 });
      expect(read.rows[1]?.amount).toBe(-1735);
      expect(read.declaredPeriod).toEqual({ from: '2026-10-01', to: '2026-10-31' });
      expect(read.declaredAccount).toBe('7654321');
    },
    TIMEOUT,
  );
});
