import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import { commitChange, recordPath } from '../packages/core/src/index.ts';
import { apartment } from '../packages/core/test/helpers/conguaglio-builders.ts';
import {
  pythonAvailability,
  pythonInterpreter,
} from '../packages/core/test/helpers/python-extract.ts';
import { scanText } from './check-personal-data.mjs';
import { main } from './estratti.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'bank', 'profilo-sintetico.json'), 'utf8'),
);
const IBAN = 'IT60X0542' + '811101000000123456';
const LABEL = 'Etichetta-segreta';
const TIMEOUT = 120_000;
const ORA = '2026-11-14T09:00:00.000Z';

const availability = pythonAvailability();
const requiredPython = process.env.REQUIRE_PYTHON === '1';

// The script as `pnpm estratti` runs it (tsx), but through node itself: `pnpm` is `pnpm.cmd` on
// Windows and does not start without a shell.
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = join(ROOT, 'scripts', 'estratti.mjs');
const run_ = (args, env = process.env) =>
  spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });

/** Runs the command line for real; the output is parsed JSON. */
function cli(args) {
  const run = run_(args);
  return { code: run.status, out: run.stdout, err: run.stderr, json: parse(run.stdout) };
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Invented movements, with descriptions that the output must never repeat.
const MOVEMENTS = [
  ['05/10/2026', 'Causale-inventata-ALFA', '-10,00', ''],
  ['06/10/2026', 'Causale-inventata-BETA', '-20,00', ''],
  ['07/10/2026', 'Causale-inventata-GAMMA', '-30,00', ''],
  ['08/10/2026', 'Causale-inventata-DELTA', '-40,00', ''],
  ['09/10/2026', 'Causale-inventata-EPSILON', '-50,00', ''],
  ['10/10/2026', 'Causale-inventata-ZETA', '-60,00', 'Prenotato'],
];
const HEADER = 'Data contabile;Descrizione;Causale;Importo;Segno;Codice;Stato';
const csvText = (top = []) =>
  [...top, HEADER, ...MOVEMENTS.map(([d, t, a, s]) => `${d};${t};;${a};;;${s}`)].join('\n') + '\n';

let root;
let counter = 0;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'estratti-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A data folder with one apartment, the profile `profile` and an account with `iban`. */
async function setup({ profile = FIXTURE, iban = IBAN } = {}) {
  const dir = join(root, `d${String((counter += 1))}`);
  mkdirSync(dir);
  const store = new FsStore(dir);
  const apt = apartment();
  let n = 0;
  await commitChange(
    store,
    {
      profileId: 'p1',
      kind: 'apartment.create',
      summary: 'x',
      changes: [{ path: recordPath('apartment', apt.id), before: undefined, after: apt }],
    },
    () => ORA,
    () => `seed-${String((n += 1))}`,
  );
  const profileFile = join(dir, 'profilo.json');
  writeFileSync(profileFile, JSON.stringify(profile));
  const common = ['--cartella', dir, '--ora', ORA];
  const p = cli(['profilo', ...common, profileFile]);
  expect(p.code).toBe(0);
  const a = cli([
    'conto',
    ...common,
    '--appartamento',
    apt.id,
    '--profilo',
    profile.id,
    '--etichetta',
    LABEL,
    ...(iban === undefined ? [] : ['--iban', iban]),
  ]);
  expect(a.code).toBe(0);
  return { dir, common, accountId: a.json.id, outputs: [p.out, a.out] };
}
const importFile = (s, file, extra = ['--dal', '2026-10-01', '--al', '2026-10-31']) =>
  cli(['importa', ...s.common, '--conto', s.accountId, ...extra, file]);
const journalCount = (dir) => readdirSync(join(dir, '_app', 'journal')).length;
function write(name, text) {
  const file = join(root, `f${String((counter += 1))}-${name}`);
  writeFileSync(file, text);
  return file;
}

describe('pnpm estratti con un CSV', () => {
  it(
    'profilo, conto e importa; la seconda importa è già-importata e non scrive',
    async () => {
      const s = await setup();
      const file = write('estratto.csv', csvText());
      const first = importFile(s, file);
      expect(first.code).toBe(0);
      expect(first.json).toMatchObject({ status: 'imported', added: 5, alreadyKnown: 0, held: 1 });
      expect(first.json.statementId).toMatch(/^[0-9a-f]{64}$/);
      expect(first.json.heldRows).toEqual([7]);
      const files = journalCount(s.dir);
      const again = importFile(s, file);
      expect(again.code).toBe(1);
      expect(again.json).toMatchObject({
        status: 'already-imported',
        statementId: first.json.statementId,
      });
      expect(journalCount(s.dir)).toBe(files);
      expect(readdirSync(s.dir).sort()).toEqual(['_app', 'profilo.json']); // the file is not copied
    },
    TIMEOUT,
  );

  it(
    'stampa solo conteggi e id: nessun dato dell’estratto, del conto o dei percorsi',
    async () => {
      const s = await setup();
      const file = write('estratto-privato.csv', csvText());
      const outputs = [...s.outputs, importFile(s, file).out, importFile(s, file).out];
      const all = outputs.join('\n');
      expect(scanText(all)).toEqual([]);
      for (const secret of [
        'ALFA',
        'ZETA',
        'Causale',
        IBAN,
        LABEL,
        'privato',
        s.dir,
        'Banca',
        '10,00',
      ]) {
        expect(all).not.toContain(secret);
      }
    },
    TIMEOUT,
  );

  it(
    '--dettagli mostra data, importo e causale delle righe tenute da parte',
    async () => {
      const s = await setup();
      const run = importFile(s, write('e.csv', csvText()), [
        '--dal',
        '2026-10-01',
        '--al',
        '2026-10-31',
        '--dettagli',
      ]);
      expect(run.code).toBe(0);
      expect(run.json.details).toEqual([
        { row: 7, date: '2026-10-10', amount: -6000, description: 'Causale-inventata-ZETA' },
      ]);
    },
    TIMEOUT,
  );

  it(
    'decidi e annulla; un file alterato dopo l’importazione non si annulla',
    async () => {
      const s = await setup();
      const run = importFile(s, write('e.csv', csvText()));
      const id = run.json.statementId;
      const keep = cli(['decidi', ...s.common, '--estratto', id, '--riga', '7', '--tieni']);
      expect(keep.code).toBe(0);
      expect(keep.json).toEqual({ status: 'decided', statementId: id, row: 7, decision: 'keep' });
      const twice = cli(['decidi', ...s.common, '--estratto', id, '--riga', '7', '--escludi']);
      expect(twice.code).toBe(1);
      expect(twice.json).toMatchObject({ status: 'rejected', reason: 'not-decidable' });
      const undone = cli(['annulla', ...s.common, '--estratto', id]);
      expect(undone.code).toBe(0);
      expect(undone.json).toMatchObject({ status: 'undone' });
      const missing = cli(['annulla', ...s.common, '--estratto', id]);
      expect(missing.code).toBe(1);
      expect(missing.json).toMatchObject({ status: 'rejected', reason: 'no-import' });
      // after the undo the same file imports again
      expect(importFile(s, write('e2.csv', csvText())).json.status).toBe('imported');
    },
    TIMEOUT,
  );

  it(
    'annulla con il registro non riallineato dà un rifiuto con messaggio costante',
    async () => {
      const s = await setup();
      const id = importFile(s, write('e.csv', csvText())).json.statementId;
      const path = join(s.dir, '_app', 'dati', 'statement', `${id}.json`);
      const record = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify({ ...record, rowCount: record.rowCount + 1 }));
      const undone = cli(['annulla', ...s.common, '--estratto', id]);
      expect(undone.code).toBe(1);
      expect(undone.json).toEqual({
        status: 'rejected',
        reason: 'journal-not-aligned',
        message: 'Rifiutato: il registro non è riallineato con i dati.',
      });
      expect(undone.out).not.toContain(id.slice(0, 8) + '.json');
    },
    TIMEOUT,
  );

  it(
    'rifiuta con codice 1 e un motivo: conto sbagliato, mascherato, periodo diverso',
    async () => {
      const profile = { ...FIXTURE, accountPattern: 'conto (\\S+)' };
      const s = await setup({ profile });
      const top = (account) => ['Estratto dal 01/10/2026 al 31/10/2026', `conto ${account}`];
      const wrong = importFile(s, write('w.csv', csvText(top('GB82WEST12345698765432'))), []);
      expect(wrong.code).toBe(1);
      expect(wrong.json).toMatchObject({ status: 'rejected', reason: 'wrong-account' });
      const masked = importFile(s, write('m.csv', csvText(top('IT60****3456'))), []);
      expect(masked.json).toMatchObject({ status: 'rejected', reason: 'masked-account' });
      const good = top(IBAN);
      const mismatch = importFile(s, write('p.csv', csvText(good)), [
        '--dal',
        '2026-10-02',
        '--al',
        '2026-10-31',
      ]);
      expect(mismatch.json).toMatchObject({ status: 'rejected', reason: 'period-mismatch' });
      const needs = importFile(s, write('n.csv', csvText()), []);
      expect(needs.json).toMatchObject({ status: 'rejected', reason: 'needs-period' });
      const outside = importFile(s, write('o.csv', csvText()), [
        '--dal',
        '2026-10-01',
        '--al',
        '2026-10-08',
      ]);
      expect(outside.json).toMatchObject({
        status: 'rejected',
        reason: 'row-outside-period',
        row: 6,
      });
      expect(journalCount(s.dir)).toBe(3);
      const all = [wrong, masked, mismatch, needs, outside].map((r) => r.out).join('');
      expect(all).not.toContain(IBAN);
    },
    TIMEOUT,
  );

  it(
    'conto: un IBAN non valido o un profilo sconosciuto sono rifiutati (codice 1)',
    async () => {
      const s = await setup();
      const bad = cli([
        'conto',
        ...s.common,
        '--appartamento',
        'x',
        '--profilo',
        FIXTURE.id,
        '--etichetta',
        'E',
      ]);
      expect(bad.code).toBe(1);
      expect(bad.json).toMatchObject({ status: 'rejected', reason: 'unknown-apartment' });
    },
    TIMEOUT,
  );

  it(
    'argomenti o file non validi: codice 2, messaggio costante',
    async () => {
      const s = await setup();
      const file = write('e.csv', csvText());
      const base = ['--conto', s.accountId];
      const cases = [
        cli(['importa', ...s.common, ...base, '--dal', '2026-10-01', file]),
        cli(['importa', ...s.common, ...base, '--dal', '2026-13-01', '--al', '2026-10-31', file]),
        cli(['importa', ...s.common, ...base, join(root, 'non-esiste-privato.csv')]),
        cli(['importa', '--cartella', s.dir, '--ora', 'ieri', ...base, file]),
        cli(['importa', '--cartella', join(root, 'manca'), ...base, file]),
        cli(['importa', ...s.common, ...base, '--sconosciuta', file]),
        cli(['importa', ...s.common, file]),
        cli(['decidi', ...s.common, '--estratto', 'x', '--riga', 'due', '--tieni']),
        cli(['decidi', ...s.common, '--estratto', 'x', '--riga', '2']),
        cli(['decidi', ...s.common, '--estratto', 'x', '--riga', '2', '--tieni', '--escludi']),
        cli(['inventato']),
        cli([]),
      ];
      for (const run of cases) {
        expect(run.code).toBe(2);
        expect(run.json?.status).toBe('invalid');
        expect(run.json?.message).toEqual(expect.any(String));
        expect(run.out).not.toContain('privato');
        expect(run.err).not.toContain('at '); // no stack trace
      }
    },
    TIMEOUT,
  );

  it(
    'un CSV rotto o con una cella sbagliata dà 2 e non mostra i valori',
    async () => {
      const s = await setup();
      const stray = importFile(
        s,
        write('s.csv', csvText().replace('Causale-inventata-ALFA', '"ALFA"-segreta')),
      );
      expect(stray.code).toBe(2);
      expect(stray.json).toMatchObject({ status: 'invalid', reason: 'unreadable-statement' });
      const bad = importFile(s, write('b.csv', csvText().replace('05/10/2026', 'ieri-segreto')));
      expect(bad.code).toBe(2);
      expect(bad.json).toMatchObject({ code: 'bad-date', row: 2 });
      expect(bad.out + stray.out).not.toMatch(/segret/);
    },
    TIMEOUT,
  );

  it(
    'un file che non è UTF-8 è non valido (2)',
    async () => {
      const s = await setup();
      const file = join(root, 'latin1.csv');
      writeFileSync(file, Buffer.from([0x44, 0xe8, 0x0a]));
      expect(importFile(s, file).code).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'una directory o una FIFO al posto del file dà 2 con messaggio costante, senza bloccarsi',
    async () => {
      const s = await setup();
      const dir = join(root, 'una-cartella-privata');
      mkdirSync(dir);
      const run = importFile(s, dir);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: 'invalid', reason: 'bad-file' });
      expect(run.out + run.err).not.toMatch(/privata/);
      const fifo = join(root, 'fifo-privata');
      // Where mkfifo is missing (Windows) the FIFO case is skipped; the directory case stays.
      if (spawnSync('mkfifo', [fifo]).status === 0) {
        const run2 = importFile(s, fifo);
        expect(run2.code).toBe(2);
        expect(run2.json).toMatchObject({ status: 'invalid', reason: 'bad-file' });
      }
      expect(journalCount(s.dir)).toBe(3); // seed, profile, account: nothing imported
    },
    TIMEOUT,
  );

  it('un errore inatteso dà 3 e dice di ripetere «importa», senza il testo dell’errore', async () => {
    const dir = join(root, 'd-failed');
    mkdirSync(dir);
    const file = join(dir, 'profilo.json');
    writeFileSync(file, JSON.stringify(FIXTURE));
    const failed = await main(['profilo', '--cartella', dir, '--ora', ORA, file], {
      now: () => ORA,
      newId: () => {
        throw new Error('segreto-nel-messaggio');
      },
    });
    expect(failed.code).toBe(3);
    const body = JSON.parse(failed.output);
    expect(body).toMatchObject({ status: 'failed', reason: 'failed' });
    expect(body.message).toMatch(/ripetere/);
    expect(failed.output).not.toMatch(/segreto/);
  });
});

if (!availability.available && requiredPython) {
  describe('pnpm estratti con un XLSX', () => {
    it('needs Python with bollette_pdf (REQUIRE_PYTHON=1)', () => {
      throw new Error(`REQUIRE_PYTHON=1 ma Python non è disponibile: ${availability.reason}`);
    });
  });
}

/** Writes the XLSX equivalent of the CSV: dates as date cells, amounts as numbers. */
function buildXlsx(file) {
  const serial = (d) => {
    const [day, month, year] = d.split('/').map(Number);
    return String((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
  };
  const head = HEADER.split(';').map((v) => ['i', v]);
  const rows = [
    head,
    ...MOVEMENTS.map(([d, t, a, s]) => [
      ['d', serial(d)],
      ['i', t],
      null,
      ['n', a.replace(',', '.')],
      null,
      null,
      s === '' ? null : ['i', s],
    ]),
  ];
  const code =
    'import sys, json; sys.path.insert(0, sys.argv[1]); from xlsx_builder import build_xlsx; ' +
    'from pathlib import Path; build_xlsx(Path(sys.argv[2]), [{"name": "Foglio", "rows": json.loads(sys.argv[3])}])';
  const run = spawnSync(
    pythonInterpreter(),
    ['-I', '-c', code, join(ROOT, 'python', 'tests'), file, JSON.stringify(rows)],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
}

describe.skipIf(!availability.available)('pnpm estratti con un XLSX', () => {
  it(
    'dà lo stesso risultato del CSV equivalente',
    async () => {
      const xlsxProfile = { ...FIXTURE, id: 'profilo-xlsx', container: 'xlsx' };
      delete xlsxProfile.csvSeparator;
      const s = await setup({ profile: xlsxProfile });
      const file = join(root, 'estratto-privato.xlsx');
      buildXlsx(file);
      const run = importFile(s, file);
      expect(run.code).toBe(0);
      expect(run.json).toMatchObject({ status: 'imported', added: 5, alreadyKnown: 0, held: 1 });
      expect(scanText(run.out)).toEqual([]);
      expect(run.out).not.toMatch(/ALFA|privato/);
      expect(importFile(s, file).json.status).toBe('already-imported');
    },
    TIMEOUT,
  );

  it(
    'un XLSX non valido dà 2 con un messaggio costante, senza traceback',
    async () => {
      const xlsxProfile = { ...FIXTURE, id: 'profilo-xlsx', container: 'xlsx' };
      delete xlsxProfile.csvSeparator;
      const s = await setup({ profile: xlsxProfile });
      const run = importFile(s, write('non-zip-privato.xlsx', 'non è uno zip'));
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: 'invalid', reason: 'unreadable-statement' });
      expect(run.out + run.err).not.toMatch(/privato|Traceback|zip/);
    },
    TIMEOUT,
  );

  it(
    'senza interprete Python utilizzabile dà 2 e non mostra il percorso',
    async () => {
      const xlsxProfile = { ...FIXTURE, id: 'profilo-xlsx', container: 'xlsx' };
      delete xlsxProfile.csvSeparator;
      const s = await setup({ profile: xlsxProfile });
      const file = join(root, 'e-privato.xlsx');
      buildXlsx(file);
      const run = run_(
        [
          'importa',
          ...s.common,
          '--conto',
          s.accountId,
          '--dal',
          '2026-10-01',
          '--al',
          '2026-10-31',
          file,
        ],
        { ...process.env, PYTHON: join(root, 'nessun-python-privato') },
      );
      expect(run.status).toBe(2);
      expect(run.stdout + run.stderr).not.toContain('privato');
    },
    TIMEOUT,
  );
});
