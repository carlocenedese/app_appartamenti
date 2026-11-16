import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  buildConguaglioWorkbook,
  loadExcelInput,
  recordPath,
  writeRecord,
  writeXlsx,
} from '../packages/core/src/index.ts';
import { fixtureRecords } from '../packages/core/test/helpers/excel-fixture.ts';
import { scanText } from './check-personal-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = join(ROOT, 'scripts', 'excel.mjs');
const TIMEOUT = 120_000;

/** Runs `pnpm excel` for real (tsx through node, as in estratti.test.mjs). */
function cli(args) {
  const run = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  let json;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    json = undefined;
  }
  return { code: run.status, out: run.stdout, json };
}

let root;
let data;
let out;
const outputs = [];
const excel = (extra) => {
  const run = cli(['--cartella', data, '--appartamento', 'apt-nord', ...extra]);
  outputs.push(run.out);
  return run;
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'excel-'));
  data = join(root, 'dati');
  out = join(root, 'uscita');
  const store = new FsStore(data);
  for (const [kind, list] of Object.entries(fixtureRecords())) {
    for (const record of list) {
      await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
    }
  }
  mkdirSync(out);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('pnpm excel', () => {
  it(
    'writes the file once and never over an existing one',
    async () => {
      const file = join(out, 'Conguaglio.xlsx');
      const first = excel(['--periodo', '2026-27', '--uscita', file]);
      expect(first.code).toBe(0);
      expect(first.json).toEqual({
        status: 'written',
        apartmentId: 'apt-nord',
        period: '2026-27',
        sheets: 4,
        tenants: 5,
        items: 5,
        pending: 1,
      });
      const loaded = await loadExcelInput(new FsStore(data), {
        apartmentId: 'apt-nord',
        periodLabel: '2026-27',
      });
      const bytes = readFileSync(file);
      expect(new Uint8Array(bytes)).toEqual(writeXlsx(buildConguaglioWorkbook(loaded.input)));

      const second = excel(['--periodo', '2026-27', '--uscita', file]);
      expect(second.code).toBe(1);
      expect(second.json).toMatchObject({ status: 'rejected', reason: 'file-exists' });
      expect(readFileSync(file)).toEqual(bytes);
      expect(readdirSync(out).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'refuses an output that is not a safe .xlsx in an existing folder',
    () => {
      for (const target of [
        join(out, 'x.csv'),
        join(out, 'CON.xlsx'),
        join(out, 'a:b.xlsx'),
        join(out, 'manca', 'x.xlsx'),
      ]) {
        const run = excel(['--periodo', '2026-27', '--uscita', target]);
        expect(run.code).toBe(2);
        expect(run.json).toMatchObject({ status: 'invalid', reason: 'bad-output' });
        expect(existsSync(target)).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    'refuses an unknown period, a missing folder and arguments that are not valid',
    () => {
      const unknown = excel(['--periodo', '2030-31', '--uscita', join(out, 'P.xlsx')]);
      expect(unknown.code).toBe(1);
      expect(unknown.json).toMatchObject({ status: 'rejected', reason: 'unknown-period' });
      const extra = excel(['--periodo', '2026-27', '--uscita', join(out, 'Q.xlsx'), 'in-piu']);
      expect(extra.code).toBe(2);
      expect(extra.json).toMatchObject({ reason: 'bad-arguments' });
      const missing = excel(['--uscita', join(out, 'R.xlsx')]);
      expect(missing.code).toBe(2);
      const folder = cli([
        '--cartella',
        join(root, 'nessuna'),
        '--appartamento',
        'apt-nord',
        '--periodo',
        '2026-27',
        '--uscita',
        join(out, 'S.xlsx'),
      ]);
      outputs.push(folder.out);
      expect(folder.code).toBe(2);
      expect(folder.json).toMatchObject({ reason: 'bad-folder' });
      expect(readdirSync(out).sort()).toEqual(['Conguaglio.xlsx']);
    },
    TIMEOUT,
  );

  it('never prints names, amounts, IBANs or paths', () => {
    const all = outputs.join('');
    expect(outputs.length).toBeGreaterThan(5);
    expect(scanText(all)).toEqual([]);
    expect(all).not.toContain(root);
    expect(all).not.toMatch(/Prova|€|\d+[.,]\d\d/);
  });
});
