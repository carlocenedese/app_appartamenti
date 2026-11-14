/**
 * The XLSX reader of bank statements with the real Python (`python -I -m bollette_pdf table`): a
 * synthetic workbook written by python/tests/xlsx_builder.py (invented account, amounts, dates)
 * → the table → `StatementTableSchema`. Skipped without a Python that runs `bollette_pdf`, except
 * with REQUIRE_PYTHON=1 (the CI), where it fails with the reason.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StatementTableSchema } from '../src/index';
import { pythonAvailability, runPython } from './helpers/python-extract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BUILDER = join(REPO, 'python', 'tests', 'xlsx_builder.py');
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
      expect(parsed.sheets[0]?.rows.slice(1)).toEqual([
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
});
