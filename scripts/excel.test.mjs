import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  buildConguaglioWorkbook,
  buildOwnersWorkbook,
  buildTaxWorkbook,
  loadExcelInput,
  loadTaxExport,
  recordPath,
  writeRecord,
  writeXlsx,
} from '../packages/core/src/index.ts';
import { fixtureRecords } from '../packages/core/test/helpers/excel-fixture.ts';
import { scanText } from './check-personal-data.mjs';
import { main } from './excel.mjs';

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
    'refuses a folder written by a newer app and writes nothing',
    async () => {
      const store = new FsStore(data);
      await store.writeJsonAtomic('_app/workspace.json', { schemaVersion: 999 });
      try {
        const file = join(out, 'Nuovo.xlsx');
        const run = excel(['--periodo', '2026-27', '--uscita', file]);
        expect(run.code).toBe(1);
        expect(run.json).toMatchObject({ status: 'rejected', reason: 'newer-data' });
        expect(existsSync(file)).toBe(false);
      } finally {
        rmSync(join(data, '_app', 'workspace.json'));
      }
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
        join(out, '.xlsx'),
        join(out, 'D.xlsx') + '/',
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

  it('refuses a folder without hard links, leaving no file', async () => {
    const target = join(out, 'Senza-link.xlsx');
    const args = ['--cartella', data, '--appartamento', 'apt-nord', '--periodo', '2026-27'];
    for (const code of ['EPERM', 'ENOTSUP', 'EXDEV']) {
      const run = await main([...args, '--uscita', target], {
        newId: () => `prova-${code}`,
        link: () => {
          throw Object.assign(new Error('no link'), { code });
        },
      });
      outputs.push(run.output);
      expect(run.code).toBe(1);
      expect(JSON.parse(run.output)).toMatchObject({
        status: 'rejected',
        reason: 'link-unsupported',
      });
    }
    expect(readdirSync(out).sort()).toEqual(['Conguaglio.xlsx']);
  });

  it('writes to <Appartamento>/<periodo>/Excel/ under the data folder without --uscita', async () => {
    const args = ['--cartella', data, '--appartamento', 'apt-nord', '--periodo', '2026-27'];
    const first = await main(args);
    outputs.push(first.output);
    expect(first.code).toBe(0);
    const folder = join(data, 'Nord', '2026-27', 'Excel');
    expect(readdirSync(folder)).toEqual(['Conguaglio_Nord_2026-27.xlsx']);
    const second = await main(args);
    outputs.push(second.output);
    expect(second.code).toBe(1);
    expect(JSON.parse(second.output)).toMatchObject({ reason: 'file-exists' });
    expect(readdirSync(folder)).toEqual(['Conguaglio_Nord_2026-27.xlsx']);
  });

  it('writes the owners file with --proprietari, to --uscita or the default path', async () => {
    const args = ['--cartella', data, '--appartamento', 'apt-nord', '--periodo', '2026-27'];
    const file = join(out, 'Proprietari.xlsx');
    const first = await main([...args, '--proprietari', '--uscita', file]);
    outputs.push(first.output);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.output)).toEqual({
      status: 'written',
      apartmentId: 'apt-nord',
      period: '2026-27',
      sheets: 1,
      items: 1,
      pending: 0,
    });
    const loaded = await loadExcelInput(new FsStore(data), {
      apartmentId: 'apt-nord',
      periodLabel: '2026-27',
    });
    expect(new Uint8Array(readFileSync(file))).toEqual(
      writeXlsx(buildOwnersWorkbook(loaded.input)),
    );
    const again = await main([...args, '--proprietari', '--uscita', file]);
    outputs.push(again.output);
    expect(again.code).toBe(1);
    expect(JSON.parse(again.output)).toMatchObject({ reason: 'file-exists' });
    rmSync(file);
    // Without --uscita: the default path under the data folder (5b, D2).
    const byDefault = await main([...args, '--proprietari']);
    outputs.push(byDefault.output);
    expect(byDefault.code).toBe(0);
    const folder = join(data, 'Riservato_proprietari', 'Excel', 'Nord', '2026-27');
    expect(readdirSync(folder)).toEqual(['Proprietari_Nord_2026-27.xlsx']);
    const twice = await main([...args, '--proprietari']);
    outputs.push(twice.output);
    expect(JSON.parse(twice.output)).toMatchObject({ reason: 'file-exists' });
    rmSync(join(data, 'Riservato_proprietari'), { recursive: true });
  });

  it('refuses a default folder that is a link or a file, writing nothing', async () => {
    const base = mkdtempSync(join(tmpdir(), 'excel-default-'));
    try {
      for (const kind of ['link', 'file']) {
        const root = join(base, kind);
        cpSync(data, root, { recursive: true });
        rmSync(join(root, 'Nord'), { recursive: true, force: true });
        if (kind === 'link') {
          mkdirSync(join(base, 'altrove'), { recursive: true });
          symlinkSync(join(base, 'altrove'), join(root, 'Nord'));
        } else {
          mkdirSync(join(root, 'Nord'));
          writeFileSync(join(root, 'Nord', '2026-27'), '');
        }
        const run = await main([
          '--cartella',
          root,
          '--appartamento',
          'apt-nord',
          '--periodo',
          '2026-27',
        ]);
        outputs.push(run.output);
        expect(run.code).toBe(1);
        expect(JSON.parse(run.output)).toMatchObject({ reason: 'bad-default-folder' });
      }
      expect(readdirSync(join(base, 'altrove'))).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it(
    'writes the file for the commercialista with --tasse, once, to the default path (plan 10)',
    async () => {
      const tasse = (...extra) => {
        const run = cli(['--cartella', data, ...extra]);
        outputs.push(run.out);
        return run;
      };
      const first = tasse('--tasse', '2026');
      const store = new FsStore(data);
      const loaded = await loadTaxExport(store);
      expect([first.code, first.json]).toEqual([
        0,
        {
          status: 'written',
          year: '2026',
          sheets: 3,
          apartments: loaded.apartments.length,
          contracts: loaded.contracts.length,
        },
      ]);
      const file = join(data, 'Riservato_proprietari', 'Tasse', '2026', 'Tasse_2026.xlsx');
      expect(new Uint8Array(readFileSync(file))).toEqual(writeXlsx(buildTaxWorkbook(loaded)));
      const again = tasse('--tasse', '2026');
      expect([again.code, again.json.reason]).toEqual([1, 'file-exists']);
      const other = join(out, 'Tasse-altro.xlsx');
      expect(tasse('--tasse', '2026', '--uscita', other).code).toBe(0);
      expect(existsSync(other)).toBe(true);
      for (const bad of [
        ['--tasse', '26'],
        ['--tasse', '2026', '--appartamento', 'apt-nord'],
        ['--tasse', '2026', '--periodo', '2026-27'],
        ['--tasse', '2026', '--proprietari'],
        ['--tasse', '2026', '--uscita', ''],
      ]) {
        expect([bad, tasse(...bad).code]).toEqual([bad, 2]);
      }
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
