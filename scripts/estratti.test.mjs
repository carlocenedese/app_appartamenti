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
import { ibanEndingWith } from '../packages/core/test/helpers/iban-build.ts';
import { main } from './estratti.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'bank', 'profilo-sintetico.json'), 'utf8'),
);
const REAL = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'bank', 'profilo-banca-lista-operazioni.json'), 'utf8'),
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
    'annulla con un pagamento dipendente rifiuta con id e conteggi, senza dati personali',
    async () => {
      const s = await setup();
      const id = importFile(s, write('e.csv', csvText())).json.statementId;
      const store = new FsStore(s.dir);
      const tx = readdirSync(join(s.dir, '_app', 'dati', 'transaction'))[0].replace('.json', '');
      const payment = {
        id: 'pay-dip',
        v: 1,
        rev: 1,
        apartmentId: apartment().id,
        tenantId: 't1',
        date: '2026-10-05',
        amount: 1000,
        confirmed: true,
        kind: 'canone',
        source: 'csv',
        transactionId: tx,
      };
      await commitChange(
        store,
        {
          profileId: 'p1',
          kind: 'income.confirm',
          summary: 'x',
          changes: [{ path: recordPath('payment', 'pay-dip'), before: undefined, after: payment }],
        },
        () => ORA,
        () => 'op-pay',
      );
      const journal = journalCount(s.dir);
      const undone = cli(['annulla', ...s.common, '--estratto', id]);
      expect(undone.code).toBe(1);
      expect(undone.json).toEqual({
        status: 'rejected',
        reason: 'dependent-payments',
        message: 'Rifiutato: dei pagamenti dipendono dai movimenti di questo estratto.',
        paymentIds: ['pay-dip'],
      });
      expect(scanText(undone.out)).toEqual([]);
      expect(journalCount(s.dir)).toBe(journal);
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

describe.skipIf(!availability.available)('pnpm estratti con il profilo della banca', () => {
  it(
    'importa il file sintetico della stessa forma: 16 righe, periodo dal preambolo, conto riconosciuto',
    async () => {
      const folder = join(root, 'lista');
      mkdirSync(folder);
      const built = spawnSync(
        pythonInterpreter(),
        ['-I', join(ROOT, 'python', 'tests', 'xlsx_builder.py'), folder],
        { encoding: 'utf8' },
      );
      expect(built.status).toBe(0);
      const file = join(folder, 'lista-operazioni.xlsx');
      const s = await setup({ profile: REAL, iban: ibanEndingWith('7654321') });
      const run = importFile(s, file, []); // no --dal/--al: the period is in the file
      expect(run.code).toBe(0);
      expect(run.json).toMatchObject({ status: 'imported', added: 16, alreadyKnown: 0, held: 0 });
      expect(scanText(run.out)).toEqual([]);
      // The period is the one of the preamble.
      const saved = JSON.parse(
        readFileSync(
          join(s.dir, '_app', 'dati', 'statement', `${run.json.statementId}.json`),
          'utf8',
        ),
      );
      expect([saved.from, saved.to, saved.periodSource]).toEqual([
        '2026-10-01',
        '2026-10-31',
        'file',
      ]);
      // Without the period lines the file needs --dal and --al.
      const bare = join(folder, 'lista-senza-periodo.xlsx');
      const t = await setup({ profile: REAL, iban: ibanEndingWith('7654321') });
      const needs = importFile(t, bare, []);
      expect(needs.code).toBe(1);
      expect(needs.json).toMatchObject({
        status: 'rejected',
        reason: 'needs-period',
        message: 'Rifiutato: serve il periodo (--dal e --al).',
      });
      expect(importFile(t, bare).json).toMatchObject({ status: 'imported', added: 16 });
      const other = await setup({ profile: REAL, iban: ibanEndingWith('1234567') });
      const wrong = importFile(other, file, []);
      expect(wrong.code).toBe(1);
      expect(wrong.json.reason).toBe('wrong-account');
    },
    TIMEOUT,
  );
});

// Piano 3b, task 8: inquilino, riconcilia, conferma, ripara.
const NAME = 'Tizio Fittizio';
const CAUSALE = 'Causale-inventata-AFFITTO';
const incomeHeader = 'Data contabile;Descrizione;Causale;Importo;Segno;Codice;Stato';
const incomeCsv = (rows) =>
  [incomeHeader, ...rows.map(([d, amount]) => `${d};Bonifico da ${NAME};${CAUSALE};${amount};A;;`)]
    .join('\n')
    .concat('\n');

/** An apartment with a tenant `t1` (rent 850,00, no flat charge) present from October 2026. */
async function incomeSetup() {
  const s = await setup();
  let n = 0;
  await commitChange(
    new FsStore(s.dir),
    {
      profileId: 'p1',
      kind: 'tenancy.create',
      summary: 'x',
      changes: [
        {
          path: recordPath('tenancy', 'tcy-t1'),
          before: undefined,
          after: {
            id: 'tcy-t1',
            v: 1,
            rev: 1,
            apartmentId: 'apt',
            tenantId: 't1',
            from: '2026-10',
            monthlyRent: 85000,
            monthlyForfait: 0,
          },
        },
      ],
    },
    () => ORA,
    () => `seed-t-${String((n += 1))}`,
  );
  const t = cli(['inquilino', ...s.common, '--id', 't1', '--nome', NAME, '--lingua', 'it']);
  expect(t.code).toBe(0);
  return { ...s, outputs: [...s.outputs, t.out] };
}
const month = (s, name, rows, from, to) =>
  importFile(s, write(name, incomeCsv(rows)), ['--dal', from, '--al', to]);
/** Every file of the data folder with its bytes: nothing may change when nothing is written. */
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[f] = readFileSync(f, 'utf8');
    }
  };
  walk(dir);
  return out;
};
const registerSize = (dir) => {
  try {
    return readdirSync(join(dir, '_app', 'dati', 'payment')).length;
  } catch {
    return 0; // no payment written yet: no folder
  }
};

describe('pnpm estratti: inquilino, riconcilia, conferma', () => {
  it(
    'riconcilia propone, conferma scrive, poi un automatico: --prova non scrive, senza non dà dati',
    async () => {
      const s = await incomeSetup();
      expect(month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31').code).toBe(
        0,
      );
      const first = cli(['riconcilia', ...s.common]);
      expect(first.code).toBe(0);
      expect(first.json).toMatchObject({ status: 'reconciled', written: 0, skipped: 0 });
      expect(first.json.proposals).toHaveLength(1);
      const [proposal] = first.json.proposals;
      expect(proposal).toMatchObject({ step: 'chi', reason: 'new-payer', tenantCount: 1 });
      expect(proposal.tenantIds).toBeUndefined();
      expect(registerSize(s.dir)).toBe(0);

      const ok = cli([
        'conferma',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't1',
        '--parte',
        'canone:2026-10:850,00',
      ]);
      expect(ok.code).toBe(0);
      expect(ok.json.payerId).toBe(proposal.id.replace('p-chi-', 'payer-'));
      expect(ok.json).toMatchObject({
        status: 'confirmed',
        paymentIds: [`${proposal.id.replace('p-chi-', 'pay-')}-1`],
      });
      expect(registerSize(s.dir)).toBe(1);

      expect(month(s, 'nov.csv', [['05/11/2026', '850,00']], '2026-11-01', '2026-11-30').code).toBe(
        0,
      );
      const before = journalCount(s.dir);
      const snap = snapshot(s.dir);
      const dry = cli(['riconcilia', ...s.common, '--prova']);
      expect(snapshot(s.dir)).toEqual(snap);
      expect(dry.json).toMatchObject({ status: 'reconciled', written: 1, proposals: [] });
      expect(journalCount(s.dir)).toBe(before);
      expect(registerSize(s.dir)).toBe(1);
      const real = cli(['riconcilia', ...s.common]);
      expect(real.json).toMatchObject({ written: 1 });
      expect(registerSize(s.dir)).toBe(2);
      expect(journalCount(s.dir)).toBe(before + 1);

      const all = [...s.outputs, first.out, ok.out, dry.out, real.out].join('');
      for (const secret of [NAME, CAUSALE, LABEL, IBAN]) expect(all).not.toContain(secret);
      // The amount as a whole number: not a part of a random hexadecimal id (flaky on a chance match).
      expect(all).not.toMatch(/(?<![0-9a-f])850(?![0-9a-f])/);
      expect(scanText(all)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '--dettagli aggiunge data, importo, causale e nomi',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const run = cli(['riconcilia', ...s.common, '--dettagli']);
      expect(run.code).toBe(0);
      expect(run.json.proposals[0]).toMatchObject({
        date: '2026-10-05',
        amount: 85000,
        tenantNames: [NAME],
        tenantIds: ['t1'],
      });
      expect(run.json.proposals[0].description).toContain(CAUSALE);
    },
    TIMEOUT,
  );

  it(
    'conferma: parte malformata, tipo o mese non validi = 2; somma sbagliata = 1; solo questa volta',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const confirm = (...parts) =>
        cli(['conferma', ...s.common, '--proposta', proposal.id, '--inquilino', 't1', ...parts]);
      for (const bad of [
        'canone:2026-13:850,00',
        'affitto:2026-10:850,00',
        'canone:2026-10',
        'canone:2026-10:abc',
        'canone:2026-10:850,00:x',
      ]) {
        const r = confirm('--parte', bad);
        expect([bad, r.code]).toEqual([bad, 2]);
        expect(r.json).toMatchObject({ status: 'invalid', reason: 'bad-arguments' });
      }
      expect(confirm().code).toBe(2);
      const sum = confirm('--parte', 'canone:2026-10:800,00');
      expect(sum.code).toBe(1);
      expect(sum.json).toMatchObject({ status: 'rejected', reason: 'sum-mismatch' });
      const unknown = cli([
        'conferma',
        ...s.common,
        '--proposta',
        'nessuna',
        '--inquilino',
        't1',
        '--parte',
        'canone:2026-10:850,00',
      ]);
      expect(unknown.json).toMatchObject({ status: 'rejected', reason: 'unknown-proposal' });
      expect(registerSize(s.dir)).toBe(0);

      const once = confirm(
        '--solo-questa-volta',
        '--parte',
        'canone:2026-10:500,00',
        '--parte',
        'altro:2026-10:350,00',
      );
      expect(once.code).toBe(0);
      expect(once.json.paymentIds).toHaveLength(2);
      expect(once.json.payerId).toBeUndefined();
      expect(registerSize(s.dir)).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'argomenti mancanti o --lingua non valida = 2; un registro non coerente rifiuta e ripara si ripara',
    async () => {
      const s = await incomeSetup();
      expect(cli(['inquilino', ...s.common, '--id', 't2']).code).toBe(2);
      expect(
        cli(['inquilino', ...s.common, '--id', 't2', '--nome', 'X', '--lingua', 'fr']).code,
      ).toBe(2);
      expect(cli(['riconcilia', ...s.common, '--prova', 'x']).code).toBe(2);

      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      cli([
        'conferma',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't1',
        '--parte',
        'canone:2026-10:850,00',
      ]);
      const file = join(
        s.dir,
        '_app',
        'dati',
        'payment',
        readdirSync(join(s.dir, '_app', 'dati', 'payment'))[0],
      );
      const record = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...record, amount: record.amount + 1 }));

      const refused = cli(['riconcilia', ...s.common]);
      expect(refused.code).toBe(1);
      expect(refused.json).toMatchObject({ status: 'rejected', reason: 'inconsistent-store' });
      const repaired = cli(['ripara', ...s.common]);
      expect(repaired.code).toBe(0);
      expect(repaired.json).toMatchObject({ status: 'repaired', repaired: 1 });
      expect(JSON.parse(readFileSync(file, 'utf8')).amount).toBe(record.amount);
      expect(cli(['ripara', ...s.common]).json).toMatchObject({ repaired: 0 });
      expect(cli(['riconcilia', ...s.common]).code).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'le opzioni di un altro comando sono rifiutate (2, nulla scritto); --id non valido = 2; errore inatteso = 3',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const snap = snapshot(s.dir);
      const part = ['--parte', 'canone:2026-10:850,00'];
      for (const args of [
        ['conferma', '--proposta', proposal.id, '--inquilino', 't1', ...part, '--prova'],
        ['inquilino', '--id', 't2', '--nome', 'X', '--prova'],
        ['ripara', '--prova'],
        ['riconcilia', '--solo-questa-volta'],
        ['riconcilia', ...part],
        ['inquilino', '--id', 't2', '--nome', 'X', '--dettagli'],
      ]) {
        const r = cli([args[0], ...s.common, ...args.slice(1)]);
        expect([args, r.code]).toEqual([args, 2]);
        expect(r.json).toMatchObject({ status: 'invalid', reason: 'bad-arguments' });
      }
      for (const id of ['../x', 'a b', 'x'.repeat(65), 'CON', 'nul', 'COM1', 'a/b', 'a.']) {
        const r = cli(['inquilino', ...s.common, '--id', id, '--nome', 'X']);
        expect([id, r.code]).toEqual([id, 2]);
      }
      expect(snapshot(s.dir)).toEqual(snap);

      const failed = await main(
        ['inquilino', '--cartella', s.dir, '--ora', ORA, '--id', 't9', '--nome', 'Y'],
        {
          now: () => ORA,
          newId: () => {
            throw new Error('segreto-nel-messaggio');
          },
        },
      );
      expect(failed.code).toBe(3);
      expect(failed.output).not.toMatch(/segreto/);
    },
    TIMEOUT,
  );

  it(
    'annulla-incassi: dependent-payments si risolve (incassi, poi estratto); altre operazioni rifiutate; --prova = 2',
    async () => {
      const s = await incomeSetup();
      const imp = month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const conf = cli([
        'conferma',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't1',
        '--parte',
        'canone:2026-10:850,00',
      ]);
      const blocked = cli(['annulla', ...s.common, '--estratto', imp.json.statementId]);
      expect(blocked.code).toBe(1);
      expect(blocked.json.reason).toBe('dependent-payments');

      const undo = (args) => cli(['annulla-incassi', ...s.common, ...args]);
      expect(undo([]).code).toBe(2);
      expect(undo(['--operazione', conf.json.operationId, '--prova']).code).toBe(2);
      const unknown = undo(['--operazione', 'nessuna']);
      expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-operation']);
      // The apartment of the setup (`seed-1`): an operation annulla-incassi never undoes.
      const other = undo(['--operazione', 'seed-1']);
      expect(other.json).toMatchObject({ status: 'rejected', reason: 'not-income-operation' });
      expect(other.code).toBe(1);
      const imported = readdirSync(join(s.dir, '_app', 'journal'))
        .map((f) => JSON.parse(readFileSync(join(s.dir, '_app', 'journal', f), 'utf8')))
        .find((o) => o.kind === 'statement.import');
      const refused = undo(['--operazione', imported.id]);
      expect(refused.json).toMatchObject({ status: 'rejected', reason: 'not-income-operation' });
      expect(refused.code).toBe(1);

      const snap = snapshot(s.dir);
      const done = undo(['--operazione', conf.json.operationId]);
      expect(done.code).toBe(0);
      expect(done.json).toMatchObject({ status: 'undone' });
      expect(snapshot(s.dir)).not.toEqual(snap);
      const again = undo(['--operazione', conf.json.operationId]);
      expect([again.code, again.json.reason]).toEqual([1, 'already-undone']);
      // The payment is deleted and the payer with it: the statement can be undone now.
      const gone = cli(['annulla', ...s.common, '--estratto', imp.json.statementId]);
      expect(gone.code).toBe(0);
      const all = [done.out, refused.out, again.out].join('');
      for (const secret of [NAME, CAUSALE, IBAN]) expect(all).not.toContain(secret);
      // The amount as a whole number: not a part of a random hexadecimal id (flaky on a chance match).
      expect(all).not.toMatch(/(?<![0-9a-f])850(?![0-9a-f])/);
    },
    TIMEOUT,
  );

  it(
    'annulla-incassi: una conferma con un’operazione dipendente = 1, has-dependents, nulla scritto',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const conf = cli([
        'conferma',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't1',
        '--parte',
        'canone:2026-10:850,00',
      ]);
      expect(conf.code).toBe(0);
      // A later operation that changes the payment of the confirmation.
      const [paymentId] = conf.json.paymentIds;
      const file = join(s.dir, '_app', 'dati', 'payment', `${paymentId}.json`);
      const payment = JSON.parse(readFileSync(file, 'utf8'));
      await commitChange(
        new FsStore(s.dir),
        {
          profileId: 'p1',
          kind: 'payment.edit',
          summary: 'x',
          changes: [
            {
              path: recordPath('payment', paymentId),
              before: payment,
              after: { ...payment, rev: payment.rev + 1, confirmed: false },
            },
          ],
        },
        () => ORA,
        () => 'dep-1',
      );
      const snap = snapshot(s.dir);
      const refused = cli(['annulla-incassi', ...s.common, '--operazione', conf.json.operationId]);
      expect(refused.code).toBe(1);
      expect(refused.json).toEqual({
        status: 'rejected',
        reason: 'has-dependents',
        message: 'Rifiutato: operazioni successive dipendono da questa: annullarle prima.',
      });
      expect(snapshot(s.dir)).toEqual(snap);
    },
    TIMEOUT,
  );

  it(
    'annullo l’intera riconciliazione per reimportare un estratto, poi riconcilio: di nuovo automatici, nessun undone',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const part = ['--parte', 'canone:2026-10:850,00'];
      cli(['conferma', ...s.common, '--proposta', proposal.id, '--inquilino', 't1', ...part]);
      const rows = [
        ['03/11/2026', '850,00'],
        ['02/12/2026', '850,00'],
      ];
      const nov = month(s, 'nov-dic.csv', rows, '2026-11-01', '2026-12-31');
      const first = cli(['riconcilia', ...s.common]);
      expect(first.json).toMatchObject({ written: 2, proposals: [], arrears: [] });

      expect(
        cli(['annulla-incassi', ...s.common, '--operazione', first.json.operationId]).code,
      ).toBe(0);
      expect(cli(['annulla', ...s.common, '--estratto', nov.json.statementId]).code).toBe(0);
      const again = month(s, 'nov-dic.csv', rows, '2026-11-01', '2026-12-31');
      expect(again.json).toMatchObject({ status: 'imported', statementId: nov.json.statementId });
      const second = cli(['riconcilia', ...s.common]);
      expect(second.code).toBe(0);
      expect(second.json).toMatchObject({ written: 2, proposals: [], arrears: [] });
    },
    TIMEOUT,
  );

  it(
    'riconcilia elenca gli arretrati: solo mesi senza --dettagli, id e nomi con --dettagli',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const part = ['--parte', 'canone:2026-10:850,00'];
      cli(['conferma', ...s.common, '--proposta', proposal.id, '--inquilino', 't1', ...part]);
      // December first, then November without a transfer: November is in arrears, December paid.
      month(s, 'dic.csv', [['02/12/2026', '850,00']], '2026-12-01', '2026-12-31');
      expect(cli(['riconcilia', ...s.common]).json).toMatchObject({ written: 1, arrears: [] });
      month(s, 'nov.csv', [], '2026-11-01', '2026-11-30');
      const plain = cli(['riconcilia', ...s.common, '--prova']);
      expect(plain.json).toMatchObject({ written: 0, proposals: [] });
      expect(plain.json.arrears).toEqual([{ month: '2026-11' }]);
      const detailed = cli(['riconcilia', ...s.common, '--prova', '--dettagli']);
      expect(detailed.json.arrears).toEqual([
        { month: '2026-11', apartmentId: 'apt', tenantId: 't1', tenantName: NAME },
      ]);
      expect(plain.out).not.toContain('t1');
      expect(scanText(plain.out)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'annulla-pagamento: un solo automatico, il movimento resta da rivedere (undone); rifiuti 1, argomenti 2',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      const part = ['--parte', 'canone:2026-10:850,00'];
      const conf = cli([
        'conferma',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't1',
        ...part,
      ]);
      month(s, 'nov.csv', [['03/11/2026', '850,00']], '2026-11-01', '2026-11-30');
      const run = cli(['riconcilia', ...s.common]);
      expect(run.json).toMatchObject({ written: 1, proposals: [] });
      // The automatic one is the payment that the confirmation did not write.
      const paymentId = readdirSync(join(s.dir, '_app', 'dati', 'payment'))
        .map((f) => f.replace(/\.json$/, ''))
        .find((id) => !conf.json.paymentIds.includes(id));
      const cancel = (args) => cli(['annulla-pagamento', ...s.common, ...args]);

      const snap = snapshot(s.dir);
      expect(cancel([]).code).toBe(2);
      expect(cancel(['--pagamento', paymentId, '--prova']).code).toBe(2);
      expect(cancel(['--pagamento', paymentId, 'x']).code).toBe(2);
      const unknown = cancel(['--pagamento', 'nessuno']);
      expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-payment']);
      const manual = cancel(['--pagamento', conf.json.paymentIds[0]]);
      expect(manual.code).toBe(1);
      expect(manual.json).toEqual({
        status: 'rejected',
        reason: 'not-automatic',
        message: 'Rifiutato: non è un pagamento automatico di una riconciliazione.',
      });
      expect(snapshot(s.dir)).toEqual(snap);

      const done = cancel(['--pagamento', paymentId]);
      expect(done.code).toBe(0);
      expect(done.json).toEqual({ status: 'cancelled', operationId: done.json.operationId });
      const after = cli(['riconcilia', ...s.common]);
      expect(after.json).toMatchObject({
        written: 0,
        proposals: [{ step: 'cosa', reason: 'undone' }],
      });
      expect([cancel(['--pagamento', paymentId]).json.reason]).toEqual(['unknown-payment']);
      // The cancellation is an income operation: annulla-incassi takes it back.
      const back = cli(['annulla-incassi', ...s.common, '--operazione', done.json.operationId]);
      expect(back.code).toBe(0);
      expect(cli(['riconcilia', ...s.common]).json).toMatchObject({ written: 0, proposals: [] });

      const all = [unknown.out, manual.out, done.out, after.out, back.out].join('');
      for (const secret of [NAME, CAUSALE, IBAN, LABEL]) expect(all).not.toContain(secret);
      // The amount as a whole number: not a part of a random hexadecimal id (flaky on a chance match).
      expect(all).not.toMatch(/(?<![0-9a-f])850(?![0-9a-f])/);
      expect(scanText(all)).toEqual([]);
    },
    TIMEOUT,
  );
});
