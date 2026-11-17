import { spawnSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  ContractSchema,
  commitChange,
  hashBytes,
  recordPath,
  recordSchemas,
  settlementPeriods,
} from '../packages/core/src/index.ts';
import { apartment } from '../packages/core/test/helpers/conguaglio-builders.ts';
import {
  pythonAvailability,
  pythonInterpreter,
} from '../packages/core/test/helpers/python-extract.ts';
import { scanText } from './check-personal-data.mjs';
import { ibanEndingWith } from '../packages/core/test/helpers/iban-build.ts';
import { main } from './estratti.mjs';
import { main as excelMain } from './excel.mjs';

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
    'scheda-inquilino: dati riservati salvati senza stamparli, mantenuti da «inquilino» (R311)',
    async () => {
      const s = await incomeSetup();
      const card = cli([
        'scheda-inquilino',
        ...s.common,
        '--inquilino',
        't1',
        '--codice-fiscale',
        'CODICE-PROVA',
        '--data-nascita',
        '2005-02-03',
        '--documento',
        'DOC-PROVA',
        '--documento-scadenza',
        '2030-01-31',
      ]);
      expect([card.code, card.json.status]).toEqual([0, 'saved']);
      expect(card.out).not.toMatch(/CODICE-PROVA|DOC-PROVA|2005/);
      const tenantFile = join(s.dir, '_app', 'dati', 'tenant', 't1.json');
      expect(JSON.parse(readFileSync(tenantFile, 'utf8')).personal).toEqual({
        taxCode: 'CODICE-PROVA',
        birthDate: '2005-02-03',
        idDocument: { number: 'DOC-PROVA', expiresOn: '2030-01-31' },
      });
      expect(cli(['inquilino', ...s.common, '--id', 't1', '--nome', NAME]).code).toBe(0);
      expect(JSON.parse(readFileSync(tenantFile, 'utf8')).personal.taxCode).toBe('CODICE-PROVA');
      expect(
        cli(['scheda-inquilino', ...s.common, '--inquilino', 't1', '--documento-ente', 'X']).code,
      ).toBe(2);
      expect(cli(['scheda-inquilino', ...s.common, '--inquilino', 't9']).json.reason).toBe(
        'unknown-tenant',
      );
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
      expect(other.json).toMatchObject({ status: 'rejected', reason: 'not-reconcile-operation' });
      expect(other.code).toBe(1);
      const imported = readdirSync(join(s.dir, '_app', 'journal'))
        .map((f) => JSON.parse(readFileSync(join(s.dir, '_app', 'journal', f), 'utf8')))
        .find((o) => o.kind === 'statement.import');
      const refused = undo(['--operazione', imported.id]);
      expect(refused.json).toMatchObject({ status: 'rejected', reason: 'not-reconcile-operation' });
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
    'riconcilia elenca gli arretrati: mese e appartamento senza --dettagli, inquilino con --dettagli',
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
      // The id of an apartment is always shown (user1, 15 Nov 2026): a name the user chose, no
      // personal data; the tenant stays hidden.
      expect(plain.json.arrears).toEqual([{ month: '2026-11', apartmentId: 'apt' }]);
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

describe('pnpm estratti escludi (piano 3c, task 1)', () => {
  it(
    'escludi: 0 e il movimento sparisce da riconcilia; annulla-incassi lo riporta; rifiuti 1, argomenti 2',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const [txFile] = readdirSync(join(s.dir, '_app', 'dati', 'transaction'));
      const txId = txFile.replace(/\.json$/, '');
      const escludi = (args) => cli(['escludi', ...s.common, ...args]);

      const snap = snapshot(s.dir);
      expect(escludi(['--movimento', txId, '--motivo', 'altro']).code).toBe(2);
      expect(escludi(['--motivo', 'doppione']).code).toBe(2);
      expect(escludi(['--movimento', txId]).code).toBe(2);
      expect(escludi(['--movimento', txId, '--motivo', 'doppione', 'x']).code).toBe(2);
      expect(escludi(['--movimento', txId, '--motivo', 'doppione', '--prova']).code).toBe(2);
      expect(cli(['riconcilia', ...s.common, '--motivo', 'doppione']).code).toBe(2);
      const unknown = escludi(['--movimento', 'nessuno', '--motivo', 'doppione']);
      expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-transaction']);
      expect(snapshot(s.dir)).toEqual(snap);

      const done = escludi(['--movimento', txId, '--motivo', 'doppione']);
      expect(done.code).toBe(0);
      expect(done.json).toEqual({ status: 'excluded', operationId: done.json.operationId });
      expect(cli(['riconcilia', ...s.common]).json).toMatchObject({ written: 0, proposals: [] });
      const again = escludi(['--movimento', txId, '--motivo', 'non-reale']);
      expect([again.code, again.json.reason]).toEqual([1, 'already-classified']);

      const back = cli(['annulla-incassi', ...s.common, '--operazione', done.json.operationId]);
      expect(back.code).toBe(0);
      const [proposal] = cli(['riconcilia', ...s.common]).json.proposals;
      expect(proposal).toMatchObject({ step: 'chi', reason: 'new-payer' });

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
      const snap2 = snapshot(s.dir);
      const blocked = escludi(['--movimento', txId, '--motivo', 'non-contabilizzato']);
      expect(blocked.code).toBe(1);
      expect(blocked.json).toEqual({
        status: 'rejected',
        reason: 'has-dependents',
        message: 'Rifiutato: dei record dipendono da questo movimento: annullarli prima.',
        recordIds: conf.json.paymentIds,
      });
      expect(snapshot(s.dir)).toEqual(snap2);

      const all = [unknown.out, done.out, again.out, back.out, blocked.out].join('');
      for (const secret of [NAME, CAUSALE, IBAN, LABEL]) expect(all).not.toContain(secret);
      expect(all).not.toMatch(/(?<![0-9a-f])850(?![0-9a-f])/);
      expect(scanText(all)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('pnpm estratti riconcilia: esclusioni proposte (piano 3c, task 2)', () => {
  it(
    'exclusions ha solo id e motivo; dopo escludi sparisce',
    async () => {
      const s = await incomeSetup();
      const pending = `${incomeHeader}\n05/10/2026;Bonifico da ${NAME};${CAUSALE};850,00;A;;Prenotato\n`;
      const first = importFile(s, write('pend.csv', pending), [
        '--dal',
        '2026-10-01',
        '--al',
        '2026-10-31',
      ]);
      expect(
        cli(['decidi', ...s.common, '--estratto', first.json.statementId, '--riga', '2', '--tieni'])
          .code,
      ).toBe(0);
      const [txFile] = readdirSync(join(s.dir, '_app', 'dati', 'transaction'));
      const txId = txFile.replace(/\.json$/, '');
      // `decidi --tieni` lists the movement in the old statement: the supersession is real.
      const old = JSON.parse(
        readFileSync(
          join(s.dir, '_app', 'dati', 'statement', `${first.json.statementId}.json`),
          'utf8',
        ),
      );
      expect(old.transactionIds).toEqual([txId]);
      // A newer statement of the same account covers the day and does not list the movement.
      expect(month(s, 'nov.csv', [['06/11/2026', '10,00']], '2026-10-05', '2026-11-30').code).toBe(
        0,
      );

      const run = cli(['riconcilia', ...s.common, '--prova']);
      expect(run.code).toBe(0);
      expect(run.json.exclusions).toEqual([{ id: `p-escl-${txId}`, reason: 'pending-superseded' }]);
      expect(scanText(run.out)).toEqual([]);

      const done = cli([
        'escludi',
        ...s.common,
        '--movimento',
        txId,
        '--motivo',
        'non-contabilizzato',
      ]);
      expect(done.code).toBe(0);
      expect(cli(['riconcilia', ...s.common, '--prova']).json.exclusions).toEqual([]);
    },
    TIMEOUT,
  );
});

const TRE = JSON.parse(
  readFileSync(join(ROOT, 'fixtures', 'reconcile', 'tre-conti.json'), 'utf8'),
).records;
/** Writes `records` ({ kind: [record] }) in the data folder `dir`, without a journal. */
async function putRecords(dir, records) {
  const store = new FsStore(dir);
  for (const [kind, list] of Object.entries(records)) {
    for (const record of list) {
      await store.writeJsonAtomic(recordPath(kind, record.id), recordSchemas[kind].parse(record));
    }
  }
}
/**
 * A data folder holding the records of `tre-conti` and the synthetic bank profile as
 * `bp-sintetico` (the profile of its accounts, so `importa` works); no journal yet.
 */
async function treConti(profile = {}) {
  const dir = join(root, `d${String((counter += 1))}`);
  mkdirSync(dir);
  await putRecords(dir, { ...TRE, bankProfile: [{ ...FIXTURE, id: 'bp-sintetico', ...profile }] });
  return { dir, common: ['--cartella', dir, '--ora', ORA] };
}
const journal = (dir) =>
  readdirSync(join(dir, '_app', 'journal')).map((f) =>
    JSON.parse(readFileSync(join(dir, '_app', 'journal', f), 'utf8')),
  );

describe('pnpm estratti riconcilia, abbina, annulla-riconciliazione (piano 3c, task 4)', () => {
  it(
    'riconcilia: incassi in cima più match, senza dati; abbina e annulla-riconciliazione',
    async () => {
      const s = await treConti();
      const run = cli(['riconcilia', ...s.common]);
      expect(run.code).toBe(0);
      // The leg of a transfer proposal keeps the income's own «chi» (user1, 16 November): it is
      // skipped as an own-account movement, as before the fix finale I3.
      expect(run.json).toMatchObject({ status: 'reconciled', written: 2, skipped: 1 });
      expect(Object.keys(run.json).slice(0, 4)).toEqual([
        'status',
        'written',
        'proposals',
        'skipped',
      ]);
      expect(run.json.exclusions).toEqual([]);
      const matchOp = journal(s.dir).find((o) => o.kind === 'match.reconcile');
      expect(run.json.match).toEqual({
        written: 3,
        yielded: 0,
        proposals: [],
        pending: 0,
        assumed: 1,
        invalidGroups: 0,
        operationId: matchOp.id,
      });
      expect(scanText(run.out)).toEqual([]);
      const secrets = [
        'Mario Inventato',
        'Luisa Inventata',
        'Fornitore Inventato',
        'ADDEBITO',
        'BONIFICO',
        'ACCREDITO',
        'GIROCONTO',
        '0542811101',
        '9999999999',
      ];
      for (const secret of secrets) expect(run.out).not.toContain(secret);
      expect(run.out).not.toMatch(
        /(?<![0-9a-f])(50000|45000|30000|20000|6300|4000|1500)(?![0-9a-f])/,
      );
      expect(run.out).not.toMatch(/[0-9],[0-9]{2}/);

      const abbina = (args) => cli(['abbina', ...s.common, ...args]);
      const snap = snapshot(s.dir);
      for (const bad of [
        [],
        ['--parte', 'bill:bill-hera-gen:tx-b-hera-gen'],
        ['--parte', 'fattura:bill-hera-gen:tx-b-hera-gen:63,00'],
        ['--parte', 'bill:bill-hera-gen:tx-b-hera-gen:sessanta'],
        ['--parte', 'bill:bill-hera-gen:tx-b-hera-gen:63,00:altro'],
        ['--parte', 'bill::tx-b-hera-gen:63,00'],
        ['--parte', 'bill:bill-hera-gen:tx-b-hera-gen:63,00', 'x'],
      ]) {
        expect(abbina(bad).code).toBe(2);
      }
      expect(cli(['riconcilia', ...s.common, '--parte', 'bill:a:b:1,00']).code).toBe(2);
      const used = abbina(['--parte', 'bill:bill-hera-gen:tx-l-cond-doppio:63,00']);
      expect([used.code, used.json.reason]).toEqual([1, 'transaction-used']);
      expect(snapshot(s.dir)).toEqual(snap);

      const undo = cli(['annulla-riconciliazione', ...s.common, '--operazione', matchOp.id]);
      expect(undo.code).toBe(0);
      expect(undo.json).toMatchObject({ status: 'undone' });
      const ok = abbina(['--parte', 'bill:bill-hera-gen:tx-b-hera-gen:63,00']);
      expect(ok.code).toBe(0);
      expect(ok.json).toEqual({
        status: 'confirmed',
        operationId: ok.json.operationId,
        matchIds: ['m-bill-bill-hera-gen-amount-tx-b-hera-gen'],
      });
      const confirmed = cli([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        ok.json.operationId,
      ]);
      expect(confirmed.code).toBe(0);
      const all = [undo.out, ok.out, confirmed.out, used.out].join('');
      for (const secret of secrets) expect(all).not.toContain(secret);
      expect(scanText(all)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'annulla-riconciliazione di un annulla-pagamento dopo un nuovo uso del movimento: 1 has-dependents (I2)',
    async () => {
      const s = await treConti();
      expect(cli(['riconcilia', ...s.common]).code).toBe(0);
      const [payment] = readdirSync(join(s.dir, '_app', 'dati', 'payment')).map((f) =>
        JSON.parse(readFileSync(join(s.dir, '_app', 'dati', 'payment', f), 'utf8')),
      );
      const cancel = cli(['annulla-pagamento', ...s.common, '--pagamento', payment.id]);
      expect(cancel.code).toBe(0);
      const args = ['--movimento', payment.transactionId, '--motivo', 'doppione'];
      expect(cli(['escludi', ...s.common, ...args]).code).toBe(0);
      const snap = snapshot(s.dir);
      const op = ['--operazione', cancel.json.operationId];
      const refused = cli(['annulla-riconciliazione', ...s.common, ...op]);
      expect(refused.code).toBe(1);
      expect(refused.json).toEqual({
        status: 'rejected',
        reason: 'has-dependents',
        message: 'Rifiutato: dei record dipendono da questo movimento: annullarli prima.',
        recordIds: [`mc-${payment.transactionId}`],
      });
      expect(snapshot(s.dir)).toEqual(snap);
    },
    TIMEOUT,
  );

  it(
    'uscita su una regola in conflitto che comincia il giorno del movimento: 1 rule-conflict-dates',
    async () => {
      const s = await treConti();
      const rule = (id, kind, extra = {}) => ({
        v: 1,
        rev: 1,
        id,
        direction: 'out',
        accountId: 'acc-pulci',
        key: 'iban:IT04X0542811101000000000401',
        kind,
        apartmentId: 'pulci',
        ...extra,
      });
      await putRecords(s.dir, {
        movementRule: [
          rule('rule-a', 'altro'),
          rule('rule-b', 'utenze', { validFrom: '2027-02-10' }),
        ],
      });
      const snap = snapshot(s.dir);
      const refused = cli([
        'uscita',
        ...s.common,
        '--proposta',
        'p-uscita-tx-p-fornitore-feb',
        '--categoria',
        'condominio',
        '--appartamento',
        'pulci',
      ]);
      expect(refused.code).toBe(1);
      expect(refused.json).toEqual({
        status: 'rejected',
        reason: 'rule-conflict-dates',
        message:
          'Rifiutato: una regola in conflitto comincia il giorno del movimento o dopo; confermare «solo questa volta».',
      });
      expect(snapshot(s.dir)).toEqual(snap);
    },
    TIMEOUT,
  );

  it(
    'annulla-riconciliazione di uno statement.import: 1 not-reconcile-operation',
    async () => {
      const s = await incomeSetup();
      month(s, 'ott.csv', [['05/10/2026', '850,00']], '2026-10-01', '2026-10-31');
      const imported = journal(s.dir).find((o) => o.kind === 'statement.import');
      const refused = cli(['annulla-riconciliazione', ...s.common, '--operazione', imported.id]);
      expect([refused.code, refused.json.reason]).toEqual([1, 'not-reconcile-operation']);
      const synonym = cli(['annulla-incassi', ...s.common, '--operazione', imported.id]);
      expect([synonym.code, synonym.json.reason]).toEqual([1, 'not-reconcile-operation']);
    },
    TIMEOUT,
  );
});

describe('pnpm estratti uscite, giroconti e saldi (piano 3c, task 10)', () => {
  const SECRETS = [
    'Mario Inventato',
    'Luisa Inventata',
    'Fornitore Inventato',
    'ADDEBITO',
    'BONIFICO',
    'Bonifico',
    'GIROCONTO',
    'Giroconto',
    'Restituzione',
    '0542811101',
    '9999999999',
    'Banca',
  ];
  /** No name, IBAN, description or amount of the fixture in `text` (R107). */
  const noData = (text) => {
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toMatch(
      /(?<![0-9a-f-])(50000|45000|30000|20000|18600|10104|10000|8496|6300|5000|4000|1500|18576)(?![0-9a-f-])/,
    );
    expect(text).not.toMatch(/[0-9],[0-9]{2}/);
    expect(scanText(text)).toEqual([]);
  };
  const statement = (rows) =>
    [incomeHeader, ...rows.map(([d, text, amount]) => `${d};${text};;${amount};D;;`)]
      .join('\n')
      .concat('\n');
  const april = (s, accountId, rows) =>
    cli([
      'importa',
      ...s.common,
      '--conto',
      accountId,
      '--dal',
      '2027-04-01',
      '--al',
      '2027-04-30',
      write('aprile.csv', statement(rows)),
    ]);
  const classes = (dir) =>
    readdirSync(join(dir, '_app', 'dati', 'movementClass')).map((f) =>
      JSON.parse(readFileSync(join(dir, '_app', 'dati', 'movementClass', f), 'utf8')),
    );
  const NOTES = ['acc-berchet', 'acc-lovarini', 'acc-pulci'].map((accountId) => ({
    accountId,
    f24PatternMissing: true,
    message: 'Nota: il profilo della banca non riconosce ancora gli F24 di questo conto.',
  }));

  it(
    'riconcilia propone giroconto e uscita; giroconto e uscita confermati; poi automatici e saldi',
    async () => {
      const s = await treConti();
      const outs = [];
      const run = (args) => {
        const r = cli(args);
        outs.push(r.out);
        return r;
      };
      const first = run(['riconcilia', ...s.common]);
      expect(first.code).toBe(0);
      expect(first.json.match.invalidGroups).toBe(0);
      expect(first.json.transfers).toEqual({
        written: 0,
        completed: 0,
        proposals: [
          { id: 'p-giro-tx-l-giro', reason: 'new-pair', legCount: 1, legIds: ['tx-b-giro'] },
        ],
      });
      expect(first.json.outgoing).toEqual({
        written: 0,
        proposals: [
          { id: 'p-uscita-tx-p-fornitore-feb', step: 'uscita', reason: 'new-counterparty' },
        ],
        missingDocument: 0,
      });
      expect(first.json.notes).toEqual(NOTES);

      const snap = snapshot(s.dir);
      const uscita = ['uscita', ...s.common, '--proposta', 'p-uscita-tx-p-fornitore-feb'];
      for (const bad of [
        [...uscita, '--categoria', 'varie', '--appartamento', 'pulci'],
        [...uscita, '--categoria', 'altro'],
        [...uscita, '--appartamento', 'pulci'],
        [...uscita, '--categoria', 'altro', '--appartamento', 'pulci', 'x'],
        [...uscita, '--categoria', 'altro', '--appartamento', 'pulci', '--scopo', 'saldo'],
        [...uscita, '--categoria', 'altro', '--appartamento', 'pulci', '--tipo', 'altro'],
        ['riconcilia', ...s.common, '--scopo', 'saldo'],
        ['riconcilia', ...s.common, '--f24'],
        ['riconcilia', ...s.common, '--proposta', 'x'],
        ['riconcilia', ...s.common, '--inquilino', 'x'],
        ['riconcilia', ...s.common, '--appartamento', 'x'],
        ['riconcilia', ...s.common, '--gambe', 'tx-b-giro'],
        [
          'giroconto',
          ...s.common,
          '--proposta',
          'p-giro-tx-l-giro',
          '--scopo',
          'saldo',
          '--gambe',
          '',
        ],
        [
          'giroconto',
          ...s.common,
          '--proposta',
          'p-giro-tx-l-giro',
          '--scopo',
          'saldo',
          '--gambe',
          'tx-b-giro,',
        ],
        [
          'giroconto',
          ...s.common,
          '--proposta',
          'p-giro-tx-l-giro',
          '--scopo',
          'saldo',
          '--gambe',
          'tx-b-giro,tx-b-giro',
        ],
        [
          'giroconto',
          ...s.common,
          '--proposta',
          'p-giro-tx-l-giro',
          '--scopo',
          'saldo',
          '--gambe',
          'tx/b',
        ],
        ['saldi', ...s.common, '--categoria', 'altro'],
        ['giroconto', ...s.common, '--proposta', 'p-giro-tx-l-giro', '--scopo', 'boh'],
        ['giroconto', ...s.common, '--proposta', 'p-giro-tx-l-giro'],
        ['giroconto', ...s.common, '--scopo', 'saldo'],
        ['annulla-uscita', ...s.common],
        ['annulla-uscita', ...s.common, '--movimento', 'tx-p-fornitore-mar', 'x'],
      ]) {
        expect([bad.slice(0, 1), run(bad).code]).toEqual([bad.slice(0, 1), 2]);
      }
      const f24 = run([...uscita, '--categoria', 'altro', '--appartamento', 'pulci', '--f24']);
      expect([f24.code, f24.json.reason]).toEqual([1, 'f24-not-tasse']);
      const nobody = run([...uscita, '--categoria', 'altro', '--appartamento', 'nessuno']);
      expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-apartment']);
      const hand = run(['annulla-uscita', ...s.common, '--movimento', 'tx-p-fornitore-mar']);
      expect([hand.code, hand.json.reason]).toEqual([1, 'not-automatic']);
      const none = run(['annulla-uscita', ...s.common, '--movimento', 'tx-l-giro']);
      expect([none.code, none.json.reason]).toEqual([1, 'unknown-class']);
      const shownNone = [
        'giroconto',
        ...s.common,
        '--proposta',
        'p-giro-tx-l-giro',
        '--scopo',
        'saldo',
      ];
      // Without --gambe the legs shown are none: one leg now is the state changed (R127).
      const noLegs = run(shownNone);
      expect([noLegs.code, noLegs.json.reason]).toEqual([1, 'unknown-proposal']);
      const leg = [...shownNone, '--gambe', 'tx-b-giro'];
      const notLeg = run([...leg, '--altra-gamba', 'tx-nessuno']);
      expect([notLeg.code, notLeg.json.reason]).toEqual([1, 'leg-not-allowed']);
      // A movement used since (here a payment of the income): the state changed (R127).
      const used = run([...leg, '--altra-gamba', 'tx-b-affitto-gen']);
      expect([used.code, used.json.reason]).toEqual([1, 'unknown-proposal']);
      const gone = run([
        'giroconto',
        ...s.common,
        '--proposta',
        'p-giro-nessuno',
        '--scopo',
        'saldo',
      ]);
      expect([gone.code, gone.json.reason]).toEqual([1, 'unknown-proposal']);
      expect(snapshot(s.dir)).toEqual(snap);

      const giro = run(leg);
      expect(giro.code).toBe(0);
      expect(giro.json).toEqual({
        status: 'confirmed',
        operationId: giro.json.operationId,
        transferId: 'tr-tx-l-giro',
      });
      const saved = JSON.parse(
        readFileSync(join(s.dir, '_app', 'dati', 'transfer', 'tr-tx-l-giro.json'), 'utf8'),
      );
      expect([saved.inTransactionId, saved.purpose, saved.oneOff]).toEqual([
        'tx-b-giro',
        'saldo',
        undefined,
      ]);
      const out = run([...uscita, '--categoria', 'altro', '--appartamento', 'pulci']);
      expect(out.code).toBe(0);
      expect(out.json).toEqual({
        status: 'confirmed',
        operationId: out.json.operationId,
        classId: 'mc-tx-p-fornitore-feb',
        ruleId: 'rule-tx-p-fornitore-feb',
      });

      // The second statements: the same pair and the same supplier, now automatic.
      const iban = {
        berchet: 'IT85X0542811101000000000301',
        supplier: 'IT04X0542811101000000000401',
      };
      expect(
        april(s, 'acc-lovarini', [['01/04/2027', `Giroconto ${iban.berchet}`, '200,00']]).code,
      ).toBe(0);
      expect(
        april(s, 'acc-pulci', [['10/04/2027', `Bonifico ${iban.supplier}`, '40,00']]).code,
      ).toBe(0);
      const second = run(['riconcilia', ...s.common]);
      expect(second.code).toBe(0);
      expect(second.json.transfers).toMatchObject({ written: 1, proposals: [] });
      expect(second.json.outgoing).toMatchObject({ written: 1, proposals: [], missingDocument: 0 });
      const ops = journal(s.dir);
      const transferOp = ops.find((o) => o.kind === 'transfer.reconcile');
      expect(second.json.transfers.operationId).toBe(transferOp.id);
      expect(second.json.outgoing.operationId).toBe(
        ops.find((o) => o.kind === 'outgoing.reconcile').id,
      );
      expect(run(['riconcilia', ...s.common]).json).toMatchObject({
        transfers: { written: 0 },
        outgoing: { written: 0 },
      });

      const saldi = run(['saldi', ...s.common]);
      expect(saldi.code).toBe(0);
      expect(saldi.json).toEqual({
        status: 'ok',
        pairs: [{ creditorApartmentId: 'lovarini', debtorApartmentId: 'berchet', items: 2 }],
        toSplit: 0,
        toSplitImu: 0,
        unverified: 0,
      });

      // The automatic class is cancelled by itself, and the cancellation undone.
      const auto = classes(s.dir).find((c) => c.ruleId !== undefined && c.deleted !== true);
      const cancel = run(['annulla-uscita', ...s.common, '--movimento', auto.transactionId]);
      expect(cancel.code).toBe(0);
      expect(cancel.json).toEqual({ status: 'cancelled', operationId: cancel.json.operationId });
      for (const id of [cancel.json.operationId, transferOp.id, giro.json.operationId]) {
        const undo = run(['annulla-riconciliazione', ...s.common, '--operazione', id]);
        expect([id, undo.code]).toEqual([id, 0]);
      }
      expect(run(['saldi', ...s.common]).json.pairs).toEqual([]);
      noData(outs.join(''));
    },
    TIMEOUT,
  );

  it(
    'saldi --dettagli dà l’importo e le voci: Lovarini deve a Berchet 185,76 € (esempio del disegno)',
    async () => {
      const dir = join(root, `d${String((counter += 1))}`);
      mkdirSync(dir);
      const base = { v: 1, rev: 1 };
      const account = (id, apartmentId) => ({
        ...base,
        id,
        apartmentId,
        label: 'Conto',
        bankProfileId: 'bp',
      });
      const tx = (id, date, amount) => ({
        ...base,
        id,
        apartmentId: 'berchet',
        accountId: 'acc-berchet',
        date,
        amount,
        description: 'ADDEBITO',
        statementHash: 's',
      });
      const instalment = (id, extra) => ({
        ...base,
        id,
        kind: 'condominio',
        esercizio: '2026-27',
        rateIndex: 1,
        rateCount: 4,
        dueDate: '2027-04-01',
        rata: 30000,
        quotaProprieta: 0,
        conguaglioPrec: 0,
        coversFrom: '2027-04',
        coversTo: '2027-06',
        ...extra,
      });
      const match = (itemId, transactionId, date, amount, part = 'amount') => ({
        ...base,
        id: `m-instalment-${itemId}-${part}-${transactionId}`,
        itemType: 'instalment',
        itemId,
        transactionId,
        transactionDate: date,
        amount,
        part,
        confirmed: true,
        by: 'auto',
      });
      const tari = { kind: 'tari', esercizio: '2027', coversFrom: '2027-01', coversTo: '2027-12' };
      const shared = (weight) => ({ groupId: 'avviso-1', groupTotal: 18600, weight });
      await putRecords(dir, {
        account: [account('acc-berchet', 'berchet'), account('acc-lovarini', 'lovarini')],
        instalment: [
          instalment('tari-b', {
            ...tari,
            apartmentId: 'berchet',
            rata: 10104,
            shared: shared(10104),
          }),
          instalment('tari-l', {
            ...tari,
            apartmentId: 'lovarini',
            paidFromApartmentId: 'berchet',
            rata: 8496,
            shared: shared(8496),
          }),
          instalment('condo-l', { apartmentId: 'lovarini', paidFromApartmentId: 'berchet' }),
        ],
        match: [
          match('tari-b', 't-tari', '2027-03-31', 10104),
          match('tari-l', 't-tari', '2027-03-31', 8496),
          match('condo-l', 't-condo', '2027-04-05', 30000),
          match('condo-l', 't-comm', '2027-04-05', 80, 'commission'),
        ],
        transaction: [
          tx('t-tari', '2027-03-31', -18600),
          tx('t-condo', '2027-04-05', -30000),
          tx('t-comm', '2027-04-05', -80),
          tx('t-forn', '2027-04-10', -5000),
        ],
        movementClass: [
          {
            ...base,
            id: 'mc-t-forn',
            transactionId: 't-forn',
            kind: 'altro',
            apartmentId: 'berchet',
          },
        ],
        transfer: [
          {
            ...base,
            id: 'tr-1',
            fromAccountId: 'acc-lovarini',
            toAccountId: 'acc-berchet',
            amount: 20000,
            date: '2027-04-20',
            purpose: 'saldo',
            source: 'manual',
          },
        ],
      });
      const common = ['--cartella', dir, '--ora', ORA];
      const plain = cli(['saldi', ...common]);
      expect(plain.code).toBe(0);
      expect(plain.json).toEqual({
        status: 'ok',
        pairs: [{ creditorApartmentId: 'berchet', debtorApartmentId: 'lovarini', items: 4 }],
        toSplit: 0,
        toSplitImu: 0,
        unverified: 0,
      });
      noData(plain.out);
      const details = cli(['saldi', ...common, '--dettagli']);
      expect(details.code).toBe(0);
      expect(details.json.pairs).toEqual([
        {
          creditorApartmentId: 'berchet',
          debtorApartmentId: 'lovarini',
          amount: 18576,
          items: [
            expect.objectContaining({ kind: 'rata', amount: 8496, refId: 'tari-l' }),
            expect.objectContaining({ kind: 'commissione', amount: 80, refId: 'condo-l' }),
            expect.objectContaining({ kind: 'rata', amount: 30000, refId: 'condo-l' }),
            expect.objectContaining({ kind: 'giroconto', amount: -20000, refId: 'tr-1' }),
          ],
        },
      ]);
      expect([details.json.toSplit, details.json.unverified]).toEqual([[], []]);
      expect(cli(['saldi', ...common, 'x']).code).toBe(2);
      expect(cli(['saldi', ...common, '--prova']).code).toBe(2);

      // A record changed on disk behind the journal: refused, as every reconciliation (R113).
      await commitChange(
        new FsStore(dir),
        {
          profileId: 'p1',
          kind: 'apartment.create',
          summary: 'x',
          changes: [
            { path: recordPath('apartment', 'apt'), before: undefined, after: apartment() },
          ],
        },
        () => ORA,
        () => 'seed-1',
      );
      const file = join(dir, '_app', 'dati', 'apartment', 'apt.json');
      const changed = { ...JSON.parse(readFileSync(file, 'utf8')), posti: 9 };
      writeFileSync(file, JSON.stringify(changed));
      const refused = cli(['saldi', ...common]);
      expect([refused.code, refused.json.reason]).toEqual([1, 'inconsistent-store']);
    },
    TIMEOUT,
  );

  it(
    'giroconto-manuale e uscita-inquilino: argomenti 2, rifiuti 1, scritture annullabili',
    async () => {
      // A profile that recognises the F24: no note (R129).
      const s = await treConti({ f24Pattern: '^PAGAMENTO F24\\b' });
      const outs = [];
      const run = (args) => {
        const r = cli(args);
        outs.push(r.out);
        return r;
      };
      const manual = (extra) => [
        'giroconto-manuale',
        ...s.common,
        '--da',
        'acc-lovarini',
        '--a',
        'acc-berchet',
        '--data',
        '2027-04-20',
        '--scopo',
        'saldo',
        ...extra,
      ];
      const snap = snapshot(s.dir);
      for (const bad of [
        manual([]),
        manual(['--importo', 'cinquanta']),
        manual(['--importo', '0,00']),
        manual(['--importo', '-50,00']),
        manual(['--importo', '50,00', '--data', '2027-13-01']),
        manual(['--importo', '50,00', '--scopo', 'boh']),
        manual(['--importo', '50,00', 'x']),
        manual(['--importo', '50,00', '--dettagli']),
        ['riconcilia', ...s.common, '--importo', '50,00'],
      ]) {
        expect(run(bad).code).toBe(2);
      }
      const unknown = run(manual(['--importo', '50,00', '--a', 'acc-nessuno']));
      expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-account']);
      const same = run(manual(['--importo', '50,00', '--a', 'acc-lovarini']));
      expect([same.code, same.json.reason]).toEqual([1, 'same-account']);
      expect(snapshot(s.dir)).toEqual(snap);
      const recorded = run(manual(['--importo', '50,00']));
      expect(recorded.code).toBe(0);
      expect(recorded.json).toEqual({
        status: 'recorded',
        operationId: recorded.json.operationId,
        transferId: recorded.json.transferId,
      });
      const saved = JSON.parse(
        readFileSync(
          join(s.dir, '_app', 'dati', 'transfer', `${recorded.json.transferId}.json`),
          'utf8',
        ),
      );
      expect([saved.amount, saved.source, saved.fromAccountId]).toEqual([
        5000,
        'manual',
        'acc-lovarini',
      ]);
      const undo = run([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        recorded.json.operationId,
      ]);
      expect(undo.code).toBe(0);

      // A refund to the tenant of Lovarini, from the account of Lovarini.
      expect(
        april(s, 'acc-lovarini', [
          ['15/04/2027', 'Restituzione IT79X0542811101000000000312', '100,00'],
        ]).code,
      ).toBe(0);
      const rec = run(['riconcilia', ...s.common]);
      const proposal = rec.json.outgoing.proposals.find(
        (p) => p.id !== 'p-uscita-tx-p-fornitore-feb',
      );
      expect(proposal).toMatchObject({ step: 'uscita', reason: 'new-counterparty' });
      const tenant = (extra) => [
        'uscita-inquilino',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't-luisa',
        ...extra,
      ];
      const snap2 = snapshot(s.dir);
      for (const bad of [
        tenant(['--tipo', 'canone', '--mese', '2027-04']),
        tenant(['--tipo', 'regalo', '--mese', '2027-04']),
        tenant(['--tipo', 'caparra', '--mese', '2027-4']),
        tenant(['--tipo', 'caparra', '--mese', '2027-13']),
        tenant(['--tipo', 'caparra']),
        tenant(['--mese', '2027-04']),
        tenant(['--tipo', 'caparra', '--mese', '2027-04', '--solo-questa-volta']),
      ]) {
        expect(run(bad).code).toBe(2);
      }
      const other = run([
        'uscita-inquilino',
        ...s.common,
        '--proposta',
        proposal.id,
        '--inquilino',
        't-mario',
        '--tipo',
        'caparra',
        '--mese',
        '2027-04',
      ]);
      expect([other.code, other.json.reason]).toEqual([1, 'tenant-not-allowed']);
      expect(snapshot(s.dir)).toEqual(snap2);
      const paid = run(tenant(['--tipo', 'caparra', '--mese', '2027-04']));
      expect(paid.code).toBe(0);
      const txId = proposal.id.replace(/^p-uscita-/, '');
      expect(paid.json).toEqual({
        status: 'confirmed',
        operationId: paid.json.operationId,
        paymentId: `pay-${txId}-1`,
      });
      const again = run(tenant(['--tipo', 'caparra', '--mese', '2027-04']));
      expect([again.code, again.json.reason]).toEqual([1, 'unknown-proposal']);
      const back = run([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        paid.json.operationId,
      ]);
      expect(back.code).toBe(0);
      expect(rec.json.notes).toEqual([]);

      // «Solo questa volta»: no rule for the outgoing, a oneOff transfer.
      const once = run([
        'uscita',
        ...s.common,
        '--proposta',
        'p-uscita-tx-p-fornitore-feb',
        '--categoria',
        'altro',
        '--appartamento',
        'pulci',
        '--solo-questa-volta',
      ]);
      expect(once.code).toBe(0);
      expect(once.json).toEqual({
        status: 'confirmed',
        operationId: once.json.operationId,
        classId: 'mc-tx-p-fornitore-feb',
      });
      const giro = ['giroconto', ...s.common, '--proposta', 'p-giro-tx-l-giro', '--scopo', 'saldo'];
      const oneOff = run([...giro, '--gambe', 'tx-b-giro', '--solo-questa-volta']);
      expect(oneOff.code).toBe(0);
      const transferFile = join(s.dir, '_app', 'dati', 'transfer', 'tr-tx-l-giro.json');
      expect(JSON.parse(readFileSync(transferFile, 'utf8')).oneOff).toBe(true);
      expect(
        run(['annulla-riconciliazione', ...s.common, '--operazione', oneOff.json.operationId]).code,
      ).toBe(0);

      // The only leg shown is excluded before the confirmation: the state changed, nothing written.
      expect(
        run(['escludi', ...s.common, '--movimento', 'tx-b-giro', '--motivo', 'doppione']).code,
      ).toBe(0);
      const snap3 = snapshot(s.dir);
      const changed = run([...giro, '--gambe', 'tx-b-giro']);
      expect([changed.code, changed.json.reason]).toEqual([1, 'unknown-proposal']);
      expect(snapshot(s.dir)).toEqual(snap3);
      noData(outs.join(''));
    },
    TIMEOUT,
  );
});

describe('pnpm estratti IMU (piano 3d)', () => {
  /** No invented amount of the IMU fixture in `text` (R107). */
  const noAmounts = (text) => {
    expect(text).not.toMatch(/(?<![0-9a-f-])(60000|40000|100000|101001|1001)(?![0-9a-f-])/);
    expect(text).not.toMatch(/[0-9],[0-9]{2}/);
    expect(scanText(text)).toEqual([]);
  };
  const atteso = (s, apartmentId, ...extra) => [
    'imu-atteso',
    ...s.common,
    '--appartamento',
    apartmentId,
    '--anno',
    '2026',
    '--gruppo',
    'berchet-lovarini',
    ...extra,
  ];

  it(
    'imu-atteso: salva, la seconda volta non scrive, rifiuti 1, argomenti 2, annullabile',
    async () => {
      const s = await treConti();
      const outs = [];
      const run = (args) => {
        const r = cli(args);
        outs.push(r.out);
        return r;
      };
      const snap = snapshot(s.dir);
      for (const bad of [
        atteso(s, 'berchet'),
        atteso(s, 'berchet', '--rata', '1:abc'),
        atteso(s, 'berchet', '--rata', 'x'),
        atteso(s, 'berchet', '--rata', '1:600,00:2026-13-01'),
        atteso(s, 'berchet', '--rata', '1:600,00:2026-06-16:x'),
        atteso(s, 'berchet', '--rata', '1', '--totale', 'abc'),
        atteso(s, 'berchet', '--rata', '1', 'x'),
        atteso(s, 'berchet', '--rata', '1', '--dettagli'),
        [...atteso(s, 'berchet', '--rata', '1'), '--anno', '26'],
        ['imu-atteso', ...s.common, '--appartamento', 'berchet', '--anno', '2026', '--rata', '1'],
        ['riconcilia', ...s.common, '--gruppo', 'x'],
        ['riconcilia', ...s.common, '--rata', '1'],
      ]) {
        expect([bad, run(bad).code]).toEqual([bad, 2]);
      }
      expect(snapshot(s.dir)).toEqual(snap);

      const saved = run(atteso(s, 'berchet', '--rata', '1:600,00', '--rata', '2::2026-12-16'));
      expect(saved.code).toBe(0);
      expect(saved.json).toEqual({
        status: 'saved',
        imuYearId: 'imu-berchet-2026',
        operationId: saved.json.operationId,
      });
      const file = join(s.dir, '_app', 'dati', 'imuYear', 'imu-berchet-2026.json');
      expect(JSON.parse(readFileSync(file, 'utf8')).rates).toEqual([
        { index: 1, expected: 60000 },
        { index: 2, dueDate: '2026-12-16' },
      ]);
      const snap2 = snapshot(s.dir);
      const again = run(atteso(s, 'berchet', '--rata', '1:600,00', '--rata', '2::2026-12-16'));
      expect([again.code, again.json]).toEqual([
        0,
        { status: 'unchanged', imuYearId: 'imu-berchet-2026' },
      ]);
      expect(snapshot(s.dir)).toEqual(snap2);

      const three = run(atteso(s, 'lovarini', '--rata', '1', '--rata', '2', '--rata', '3'));
      expect([three.code, three.json.reason]).toEqual([1, 'rates-mismatch']);
      const nobody = run(atteso(s, 'nessuno', '--rata', '1', '--rata', '2'));
      expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-apartment']);
      const zero = run(atteso(s, 'lovarini', '--rata', '1:0,00', '--rata', '2'));
      expect([zero.code, zero.json.reason]).toEqual([1, 'bad-rates']);
      const total = run(atteso(s, 'lovarini', '--totale', '700,00', '--rata', '1', '--rata', '2'));
      expect(total.code).toBe(0);
      expect(snapshot(s.dir)).not.toEqual(snap2);

      const undo = run([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        total.json.operationId,
      ]);
      expect(undo.code).toBe(0);
      expect(
        JSON.parse(
          readFileSync(join(s.dir, '_app', 'dati', 'imuYear', 'imu-lovarini-2026.json'), 'utf8'),
        ).deleted,
      ).toBe(true);
      noAmounts(outs.join(''));
    },
    TIMEOUT,
  );

  /** treConti with the F24 pattern, the IMU of 2027 for Berchet and Lovarini, two F24 in June. */
  async function imuSetup(outs) {
    const s = await treConti({ f24Pattern: '^PAGAMENTO F24\\b' });
    const run = (args) => {
      const r = cli(args);
      outs.push(r.out);
      return r;
    };
    const rates = ['--rata', '1:600,00', '--rata', '2:600,00'];
    for (const [apartmentId, amounts] of [
      ['berchet', rates],
      ['lovarini', ['--rata', '1:400,00', '--rata', '2:400,00']],
    ]) {
      const args = atteso(s, apartmentId, ...amounts).map((a) => (a === '2026' ? '2027' : a));
      expect(run(args).code).toBe(0);
    }
    const csv = [
      incomeHeader,
      '14/06/2027;PAGAMENTO F24 DELEGA 0001;;1.000,00;D;;',
      '20/06/2027;PAGAMENTO F24 DELEGA 0002;;1.010,01;D;;',
    ].join('\n');
    const imported = run([
      'importa',
      ...s.common,
      '--conto',
      'acc-berchet',
      '--dal',
      '2027-06-01',
      '--al',
      '2027-06-30',
      write('giugno.csv', `${csv}\n`),
    ]);
    expect(imported.code).toBe(0);
    const proposals = run(['riconcilia', ...s.common]).json.outgoing.proposals.filter(
      (p) => p.step === 'f24',
    );
    expect(proposals.map((p) => p.reason)).toEqual(['f24', 'f24']);
    const [first, second] = proposals.map((p) => p.id.replace(/^p-f24-/, ''));
    return { ...s, run, first, second, statementId: imported.json.statementId };
  }
  const f24 = (s, movement, rata, ...extra) => [
    'imu-f24',
    ...s.common,
    '--movimento',
    movement,
    '--gruppo',
    'berchet-lovarini',
    '--anno',
    '2027',
    '--rata',
    rata,
    ...extra,
  ];

  it(
    'imu-f24: assegna, rifiuti 1, argomenti 2, annulla dell’estratto rifiutato, annullabile',
    async () => {
      const outs = [];
      const s = await imuSetup(outs);
      const snap = snapshot(s.dir);
      for (const bad of [
        f24(s, s.first, 'x'),
        f24(s, s.first, '0'),
        f24(s, s.first, '1', '--rata', '2'),
        f24(s, s.first, '1', 'x'),
        f24(s, s.first, '1', '--totale', '1,00'),
        f24(s, s.first, '1').filter((a) => a !== '--gruppo' && a !== 'berchet-lovarini'),
        f24(s, s.first, '1').map((a) => (a === '2027' ? '27' : a)),
      ]) {
        expect([bad, s.run(bad).code]).toEqual([bad, 2]);
      }
      const unknown = s.run(f24(s, s.first, '3'));
      expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-rate']);
      const none = s.run(f24(s, 'tx-nessuno', '1'));
      expect([none.code, none.json.reason]).toEqual([1, 'not-imu-candidate']);
      expect(snapshot(s.dir)).toEqual(snap);

      const assigned = s.run(f24(s, s.first, '1'));
      expect(assigned.code).toBe(0);
      expect(assigned.json).toEqual({
        status: 'assigned',
        operationId: assigned.json.operationId,
        classId: `mc-${s.first}`,
        ruleId: `imur-${s.first}`,
      });
      const snapAssigned = snapshot(s.dir);
      const same = s.run(f24(s, s.first, '1'));
      expect([same.code, same.json]).toEqual([
        0,
        { status: 'unchanged', classId: `mc-${s.first}` },
      ]);
      expect(snapshot(s.dir)).toEqual(snapAssigned);
      const otherRate = s.run(f24(s, s.first, '2'));
      expect([otherRate.code, otherRate.json.reason]).toEqual([1, 'not-imu-candidate']);
      const twice = s.run(f24(s, s.second, '1'));
      expect([twice.code, twice.json.reason]).toEqual([1, 'rate-already-paid']);
      const undoImport = s.run(['annulla', ...s.common, '--estratto', s.statementId]);
      expect([undoImport.code, undoImport.json.reason, undoImport.json.recordIds]).toEqual([
        1,
        'dependent-records',
        [`mc-${s.first}`],
      ]);
      const undo = s.run([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        assigned.json.operationId,
      ]);
      expect(undo.code).toBe(0);
      expect(s.run(f24(s, s.second, '1')).code).toBe(0);
      noAmounts(outs.join(''));
    },
    TIMEOUT,
  );

  it(
    'imu-atteso e annulla-riconciliazione rifiutano di cambiare il gruppo sotto un F24 assegnato',
    async () => {
      const outs = [];
      const s = await imuSetup(outs);
      const lovarini = (group) =>
        atteso(s, 'lovarini', '--rata', '1:400,00', '--rata', '2:400,00').map((a) =>
          a === '2026' ? '2027' : a === 'berchet-lovarini' ? group : a,
        );
      expect(s.run(lovarini('solo-lovarini')).code).toBe(0);
      const back = s.run(lovarini('berchet-lovarini'));
      expect(back.code).toBe(0);
      expect(s.run(f24(s, s.first, '1')).code).toBe(0);
      const snap = snapshot(s.dir);
      const message =
        'Rifiutato: un F24 è assegnato a una rata IMU che cambierebbe: annullare prima l’assegnazione.';
      const changed = s.run(lovarini('altro'));
      expect([
        changed.code,
        changed.json.reason,
        changed.json.message,
        changed.json.recordIds,
      ]).toEqual([1, 'has-dependents', message, [`mc-${s.first}`]]);
      const undo = s.run([
        'annulla-riconciliazione',
        ...s.common,
        '--operazione',
        back.json.operationId,
      ]);
      expect([undo.code, undo.json.reason, undo.json.message, undo.json.recordIds]).toEqual([
        1,
        'has-dependents',
        message,
        [`mc-${s.first}`],
      ]);
      expect(snapshot(s.dir)).toEqual(snap);
      noAmounts(outs.join(''));
    },
    TIMEOUT,
  );

  it(
    'imu-f24: la regola appresa suggerisce gruppo, anno e rata in riconcilia; --solo-questa-volta nessuna',
    async () => {
      const outs = [];
      const s = await imuSetup(outs);
      const once = s.run(f24(s, s.first, '1', '--solo-questa-volta'));
      expect(once.json).toEqual({
        status: 'assigned',
        operationId: once.json.operationId,
        classId: `mc-${s.first}`,
      });
      const proposal = () =>
        s.run(['riconcilia', ...s.common]).json.outgoing.proposals.find((p) => p.step === 'f24');
      expect(proposal()).not.toHaveProperty('imuSuggestion');
      expect(
        s.run(['annulla-riconciliazione', ...s.common, '--operazione', once.json.operationId]).code,
      ).toBe(0);
      const learnt = s.run(f24(s, s.first, '1'));
      expect(learnt.json).toMatchObject({ status: 'assigned', ruleId: `imur-${s.first}` });
      expect(proposal()).toEqual({
        id: `p-f24-${s.second}`,
        step: 'f24',
        reason: 'f24',
        suggestedKind: 'tasse',
        imuSuggestion: { f24Group: 'berchet-lovarini', year: '2027', rateIndex: 2 },
      });
      // Only a suggestion: the second F24 is still to assign.
      expect(s.run(['imu', ...s.common]).json.rates[1]).toMatchObject({ status: 'attesa', f24: 0 });
      noAmounts(outs.join(''));
    },
    TIMEOUT,
  );

  it(
    'imu: una rata pagata e una da riconciliare, importi solo con --dettagli; saldi con la voce imu',
    async () => {
      const outs = [];
      const s = await imuSetup(outs);
      expect(s.run(f24(s, s.first, '1')).code).toBe(0);
      expect(s.run(f24(s, s.second, '2')).code).toBe(0);
      const message = 'Rata IMU da riconciliare: controllare gli importi attesi (imu-atteso).';
      const rate = (rateIndex, status, f24Count = 1) => ({
        f24Group: 'berchet-lovarini',
        year: '2027',
        rateIndex,
        status,
        f24: f24Count,
        ...(status === 'da-riconciliare' ? { message } : {}),
      });
      const plain = s.run(['imu', ...s.common]);
      expect(plain.code).toBe(0);
      expect(plain.json).toEqual({
        status: 'ok',
        rates: [rate(1, 'pagata'), rate(2, 'da-riconciliare')],
        toReconcile: 1,
      });
      expect(s.run(['imu', ...s.common, '--anno', '2026']).json).toEqual({
        status: 'ok',
        rates: [],
        toReconcile: 0,
      });
      for (const bad of [
        ['imu', ...s.common, '--anno', '26'],
        ['imu', ...s.common, 'x'],
        ['imu', ...s.common, '--rata', '1'],
      ]) {
        expect([bad, s.run(bad).code]).toEqual([bad, 2]);
      }
      const saldi = s.run(['saldi', ...s.common]);
      // The paid rate is split (task 4): one imu item; the other stays in toSplit.
      expect(saldi.json).toMatchObject({
        status: 'ok',
        pairs: [{ creditorApartmentId: 'berchet', debtorApartmentId: 'lovarini', items: 1 }],
        toSplit: 1,
        toSplitImu: 1,
      });
      noAmounts(outs.join(''));

      const details = cli(['imu', ...s.common, '--dettagli']);
      expect(details.json.rates).toEqual([
        {
          ...rate(1, 'pagata'),
          expected: 100000,
          paid: 100000,
          difference: 0,
          transactionId: s.first,
        },
        {
          ...rate(2, 'da-riconciliare'),
          expected: 100000,
          paid: 101001,
          difference: 1001,
          transactionId: s.second,
        },
      ]);
      const saldiDetails = cli(['saldi', ...s.common, '--dettagli']).json;
      const reasons = saldiDetails.toSplit.map((t) => [
        t.transactionId,
        t.imu.rateIndex,
        t.imu.reason,
      ]);
      expect(reasons).toEqual([[s.second, 2, 'imu-da-riconciliare']]);
      expect(saldiDetails.pairs[0]).toMatchObject({
        amount: 40000,
        items: [{ kind: 'imu', forApartmentId: 'lovarini', amount: 40000, refId: s.first }],
      });
      // The expected corrected: both paid.
      const fixed = atteso(s, 'lovarini', '--rata', '1:400,00', '--rata', '2:410,01').map((a) =>
        a === '2026' ? '2027' : a,
      );
      expect(cli(fixed).code).toBe(0);
      expect(cli(['imu', ...s.common]).json.toReconcile).toBe(0);
      // 1.010,01 € on 600,00 € and 410,01 €: Lovarini owes 400,00 € + 410,01 €.
      expect(cli(['saldi', ...s.common, '--dettagli']).json).toMatchObject({
        pairs: [{ amount: 81001 }],
        toSplit: [],
      });
      // The whole path again: nothing written.
      const settled = snapshot(s.dir);
      expect(cli(fixed).json.status).toBe('unchanged');
      expect(cli(f24(s, s.first, '1')).json.status).toBe('unchanged');
      expect(cli(f24(s, s.second, '2')).json.status).toBe('unchanged');
      expect(snapshot(s.dir)).toEqual(settled);
    },
    TIMEOUT,
  );
});

describe('pnpm estratti contratti (piano 7, task 5)', () => {
  // Invented tenants, amounts and registration codes (fixtures/README.md); main() in process.
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: ids() });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };
  let idCounter = 0;
  const ids = () => () => `cli-${String((idCounter += 1))}`;
  const tenancy = (id, tenantId, extra = {}) => ({
    id,
    v: 1,
    rev: 1,
    apartmentId: 'berchet',
    tenantId,
    from: '2025-10',
    to: '2026-09',
    monthlyRent: 35000,
    monthlyForfait: 3000,
    ...extra,
  });

  async function contractSetup() {
    const dir = join(root, `c${String((counter += 1))}`);
    mkdirSync(dir);
    const store = new FsStore(dir);
    const records = [
      ['apartment', apartment({ id: 'berchet' })],
      ['apartment', apartment({ id: 'lovarini' })],
      ['tenancy', tenancy('tcy-a', 'ten-anna')],
      ['tenancy', tenancy('tcy-b', 'ten-bruno')],
      [
        'payment',
        {
          id: 'pay-c1',
          v: 1,
          rev: 1,
          apartmentId: 'berchet',
          tenantId: 'ten-anna',
          date: '2025-09-25',
          amount: 50000,
          confirmed: true,
          kind: 'caparra',
          source: 'manual',
        },
      ],
    ];
    let n = 0;
    await commitChange(
      store,
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((n += 1))}`,
    );
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }
  const contratto = (s, ...extra) => [
    'contratto',
    ...s.common,
    '--id',
    'ctr-berchet',
    '--appartamento',
    'berchet',
    '--tipo',
    '1+1',
    '--inizio',
    '2025-10',
    '--fine',
    '2027-09',
    '--conguaglio',
    'annuale',
    ...extra,
  ];
  const full = [
    '--concordato',
    '--studenti',
    '--regime',
    'cedolare',
    '--aliquota-cedolare',
    '10',
    '--codice-registrazione',
    'CODICE-PROVA-0001',
    '--presenze',
    'tcy-a,tcy-b',
  ];
  const canone = (s, ...extra) => [
    'contratto-canone',
    ...s.common,
    '--contratto',
    'ctr-berchet',
    ...extra,
  ];
  const stored = (s) =>
    JSON.parse(readFileSync(join(s.dir, '_app', 'dati', 'contract', 'ctr-berchet.json'), 'utf8'));

  it('contratto: salva, la seconda volta non scrive, aliquota in punti base, argomenti 2', async () => {
    const s = await contractSetup();
    const saved = await run(contratto(s, ...full));
    expect([saved.code, saved.json]).toEqual([
      0,
      { status: 'saved', contractId: 'ctr-berchet', operationId: saved.json.operationId },
    ]);
    expect(stored(s)).toMatchObject({
      agreedRent: true,
      forStudents: true,
      taxRegime: 'cedolare',
      cedolareRateBp: 1000,
      registration: { code: 'CODICE-PROVA-0001' },
      tenancyIds: ['tcy-a', 'tcy-b'],
    });
    const snap = snapshot(s.dir);
    expect((await run(contratto(s, ...full))).json).toEqual({
      status: 'unchanged',
      contractId: 'ctr-berchet',
    });
    expect(snapshot(s.dir)).toEqual(snap);
    const rate = (value) =>
      contratto(s, '--regime', 'cedolare', '--aliquota-cedolare', value, '--durata', '12');
    expect((await run(rate('10,5'))).code).toBe(0);
    expect(stored(s)).toMatchObject({ cedolareRateBp: 1050, durationMonths: 12 });
    expect(stored(s)).not.toHaveProperty('tenancyIds'); // an absent option removes the field
    expect((await run(rate('10,05'))).code).toBe(0);
    expect(stored(s).cedolareRateBp).toBe(1005);
    const snap2 = snapshot(s.dir);
    for (const bad of [
      rate('10.5'),
      rate('abc'),
      rate('0'),
      rate('100,001'),
      rate('100,01'),
      rate(''),
      contratto(s, '--regime', 'ordinario', '--aliquota-cedolare', '10'),
      contratto(s, '--aliquota-cedolare', '10'),
      contratto(s, '--regime', 'misto'),
      contratto(s, '--inizio', '2025-13'),
      contratto(s, '--fine', '2025-09'),
      contratto(s, '--presenze', 'tcy-a,tcy-a'),
      contratto(s, '--presenze', 'tcy-a,'),
      contratto(s, '--caparre', 'pay c1'),
      contratto(s, '--durata', '0'),
      contratto(s, '--firmato', '2025-02-30'),
      contratto(s, '--registrato', '2025-10'),
      contratto(s, '--codice-registrazione', ''),
      contratto(s, 'x'),
      contratto(s).map((a) => (a === '1+1' ? '2+2' : a)),
      contratto(s).map((a) => (a === 'annuale' ? 'mensile' : a)),
      contratto(s).map((a) => (a === 'ctr-berchet' ? 'ctr:berchet' : a)),
      ['contratto', ...s.common, '--id', 'ctr-berchet'],
      ['riconcilia', ...s.common, '--contratto', 'ctr-berchet'],
      ['riconcilia', ...s.common, '--presenze', 'tcy-a'],
      ['imu', ...s.common, '--aliquota-cedolare', '10'],
      ['contratti', ...s.common, '--tipo', '1+1'],
      ['saldi', ...s.common, '--dal', '2026-10-01'],
      ['saldi', ...s.common, '--al', '2026-10-31'],
      ['contratti', ...s.common, '--al', '2026-10'],
    ]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]);
    }
    expect(snapshot(s.dir)).toEqual(snap2);
    const unknown = await run(contratto(s, '--presenze', 'tcy-nessuna'));
    expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-tenancy']);
    expect(unknown.json.message).toMatch(/^Rifiutato: /);
    const deposit = await run(contratto(s, '--caparre', 'pay-nessuno'));
    expect([deposit.code, deposit.json.reason]).toEqual([1, 'unknown-deposit']);
    expect(snapshot(s.dir)).toEqual(snap2);
  });

  it('contratto-canone, contratti senza dati personali, annullamento', async () => {
    const s = await contractSetup();
    const outs = [];
    const go = async (args) => {
      const r = await run(args);
      outs.push(r.out);
      return r;
    };
    const created = await go(
      contratto(s, ...full, '--caparre', 'pay-c1', '--firmato', '2025-09-20'),
    );
    expect(created.code).toBe(0);
    const first = await go(
      canone(s, '--dal', '2025-10', '--canone', '1600,00', '--acconto', '150,00'),
    );
    expect([first.code, first.json]).toEqual([
      0,
      { status: 'saved', contractId: 'ctr-berchet', operationId: first.json.operationId },
    ]);
    expect(stored(s).rent).toEqual([
      { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
    ]);
    for (const bad of [
      canone(s, '--dal', '2025-10', '--canone', '0', '--acconto', '150,00'),
      canone(s, '--dal', '2025-10', '--canone', '-1,00', '--acconto', '150,00'),
      canone(s, '--dal', '2025-10', '--canone', '1600,00', '--acconto', '-1,00'),
      canone(s, '--dal', '2025-10', '--canone', 'abc', '--acconto', '150,00'),
      canone(s, '--dal', '2025-13', '--canone', '1600,00', '--acconto', '150,00'),
      canone(s, '--dal', '2025-10', '--canone', '1600,00'),
    ]) {
      expect([bad, (await go(bad)).code]).toEqual([bad, 2]);
    }
    const outside = await go(
      canone(s, '--dal', '2030-01', '--canone', '1600,00', '--acconto', '0'),
    );
    expect([outside.code, outside.json.reason]).toEqual([1, 'month-outside-contract']);
    const nobody = await go([
      'contratto-canone',
      ...s.common,
      '--contratto',
      'ctr-nessuno',
      '--dal',
      '2025-10',
      '--canone',
      '1,00',
      '--acconto',
      '0',
    ]);
    expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-contract']);
    const renewal = await go(
      canone(s, '--dal', '2026-10', '--canone', '1650,00', '--acconto', '150,00'),
    );
    expect(renewal.code).toBe(0);

    const list = await go(['contratti', ...s.common]);
    expect(list.code).toBe(0);
    const message =
      'Canone del contratto diverso dal totale delle presenze: controllare il contratto o le presenze.';
    expect(list.json).toEqual({
      status: 'ok',
      contracts: [
        {
          id: 'ctr-berchet',
          apartmentId: 'berchet',
          type: '1+1',
          start: '2025-10',
          end: '2027-09',
          settlement: 'annuale',
          agreedRent: true,
          forStudents: true,
          taxRegime: 'cedolare',
          tenancies: 2,
          deposits: 1,
          rentEntries: 2,
        },
      ],
      checks: [
        {
          code: 'rent-differs',
          contractId: 'ctr-berchet',
          from: '2025-10',
          to: '2026-09',
          message,
        },
        {
          code: 'rent-differs',
          contractId: 'ctr-berchet',
          from: '2026-10',
          to: '2026-11',
          message,
        },
      ],
      rentYears: [],
    });
    const text = outs.join('');
    expect(scanText(text)).toEqual([]);
    expect(text).not.toMatch(
      /CODICE-PROVA|tcy-|pay-|2025-09-20|1000|160000|165000|15000|76000|175000|180000/,
    );
    expect(text).not.toMatch(/[0-9],[0-9]{2}/);
    expect((await go(['contratti', ...s.common, '--appartamento', 'lovarini'])).json).toEqual({
      status: 'ok',
      contracts: [],
      checks: [],
      rentYears: [],
    });

    const details = await run(['contratti', ...s.common, '--dettagli']);
    expect(details.json.contracts[0]).toMatchObject({
      registration: { code: 'CODICE-PROVA-0001' },
      signedOn: '2025-09-20',
      cedolareRateBp: 1000,
      tenancyIds: ['tcy-a', 'tcy-b'],
      depositPaymentIds: ['pay-c1'],
      rent: [
        { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
        { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 },
      ],
    });
    expect(details.json.checks[0]).toMatchObject({ expected: 175000, actual: 76000 });

    const underRent = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      created.json.operationId,
    ]);
    expect([underRent.code, underRent.json.reason]).toEqual([1, 'has-dependents']);
    const dependent = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      first.json.operationId,
    ]);
    expect([dependent.code, dependent.json.reason]).toEqual([1, 'has-dependents']);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      renewal.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    const after = await run(['contratti', ...s.common, '--dettagli']);
    expect(after.json.contracts[0].rent).toEqual([
      { from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 },
    ]);
  });

  it('contratti: due contratti vivi sovrapposti danno contract-overlap con i mesi (R181)', async () => {
    const s = await contractSetup();
    expect((await run(contratto(s))).code).toBe(0);
    const renewal = contratto(s, '--inizio', '2026-10', '--fine', '2028-09').map((a) =>
      a === 'ctr-berchet' ? 'ctr-berchet-2' : a,
    );
    expect((await run(renewal)).code).toBe(0);
    const list = await run(['contratti', ...s.common]);
    expect(list.json.checks).toEqual([
      {
        code: 'contract-overlap',
        contractId: 'ctr-berchet',
        otherContractId: 'ctr-berchet-2',
        from: '2026-10',
        to: '2027-09',
        message:
          'Due contratti vivi dello stesso appartamento hanno mesi in comune: controllare le date.',
      },
    ]);
  });

  it('affitti-anno: totale a mano, stima della cedolare solo con --dettagli, annullamento (R182)', async () => {
    const s = await contractSetup();
    expect(
      (await run(contratto(s, '--regime', 'cedolare', '--aliquota-cedolare', '10'))).code,
    ).toBe(0);
    const affitti = (...extra) => [
      'affitti-anno',
      ...s.common,
      '--appartamento',
      'berchet',
      ...extra,
    ];
    const saved = await run(affitti('--anno', '2026', '--totale', '19350,00'));
    expect([saved.code, saved.json]).toEqual([
      0,
      { status: 'saved', rentYearId: 'rent-berchet-2026', operationId: saved.json.operationId },
    ]);
    expect((await run(affitti('--anno', '2026', '--totale', '19350,00'))).json).toEqual({
      status: 'unchanged',
      rentYearId: 'rent-berchet-2026',
    });
    const snap = snapshot(s.dir);
    for (const bad of [
      affitti('--anno', '26', '--totale', '19350,00'),
      affitti('--anno', '2026', '--totale', '0'),
      affitti('--anno', '2026', '--totale', 'abc'),
      affitti('--anno', '2026'),
      affitti('--anno', '2026', '--totale', '1,00', 'x'),
      ['affitti-anno', ...s.common, '--anno', '2026', '--totale', '1,00'],
      ['contratti', ...s.common, '--totale', '1,00'],
      ['imu', ...s.common, '--anno', '2026', '--totale', '1,00'],
    ]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]);
    }
    const nobody = await run([
      'affitti-anno',
      ...s.common,
      '--appartamento',
      'nessuno',
      '--anno',
      '2026',
      '--totale',
      '1,00',
    ]);
    expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-apartment']);
    expect(snapshot(s.dir)).toEqual(snap);

    const list = await run(['contratti', ...s.common]);
    expect(list.json.rentYears).toEqual([{ apartmentId: 'berchet', year: '2026' }]);
    expect(list.out).not.toMatch(/1935000|193500/);
    const details = await run(['contratti', ...s.common, '--dettagli']);
    expect(details.json.rentYears).toEqual([
      {
        apartmentId: 'berchet',
        year: '2026',
        totalRent: 1935000,
        cedolareRateBp: 1000,
        cedolareExpected: 193500,
        message: 'Cedolare stimata: da confermare, non è un pagamento.',
      },
    ]);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      saved.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect((await run(['contratti', ...s.common])).json.rentYears).toEqual([]);
  });

  it('un errore inatteso dà 3', async () => {
    const s = await contractSetup();
    const failed = await main(contratto(s), {
      now: () => ORA,
      newId: () => {
        throw new Error('segreto-nel-messaggio');
      },
    });
    expect(failed.code).toBe(3);
    expect(failed.output).not.toMatch(/segreto/);
  });
});

describe('pnpm estratti contratti sulla fixture di due appartamenti (piano 7, task 6)', () => {
  const FIXTURE_CONTRACTS = JSON.parse(
    readFileSync(join(ROOT, 'fixtures', 'contracts', 'due-appartamenti.json'), 'utf8'),
  );
  let n = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `f6-${String((n += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };

  /** A data folder with the records of the fixture, written through the journal. */
  async function fixtureFolder(extra = []) {
    const dir = join(root, `f6-${String((counter += 1))}`);
    mkdirSync(dir);
    const records = [
      ...Object.entries(FIXTURE_CONTRACTS.records).flatMap(([kind, list]) =>
        list.map((r) => [kind, r]),
      ),
      ...extra,
    ];
    let k = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((k += 1))}`,
    );
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }
  const base = {
    berchet: ['--id', 'ctr-berchet', '--appartamento', 'berchet', '--tipo', '1+1'],
    lovarini: ['--id', 'ctr-lovarini', '--appartamento', 'lovarini', '--tipo', '3+2'],
  };
  const commands = (s) => [
    [
      'contratto',
      ...s.common,
      ...base.berchet,
      '--inizio',
      '2025-10',
      '--fine',
      '2027-09',
      '--conguaglio',
      'annuale',
      '--concordato',
      '--studenti',
      '--regime',
      'cedolare',
      '--aliquota-cedolare',
      '10',
      '--codice-registrazione',
      'CODICE-PROVA-0001',
      '--firmato',
      '2025-09-20',
      '--registrato',
      '2025-10-10',
      '--presenze',
      'tcy-anna,tcy-bruno,tcy-carla,tcy-dario,tcy-elena',
      '--caparre',
      'pay-franco',
    ],
    [
      'contratto',
      ...s.common,
      ...base.lovarini,
      '--inizio',
      '2025-10',
      '--fine',
      '2030-09',
      '--conguaglio',
      'intero-contratto',
      '--concordato',
      '--regime',
      'ordinario',
      '--codice-registrazione',
      'CODICE-PROVA-0002',
    ],
    [
      'contratto-canone',
      ...s.common,
      '--contratto',
      'ctr-berchet',
      '--dal',
      '2025-10',
      '--canone',
      '1600,00',
      '--acconto',
      '150,00',
    ],
    [
      'contratto-canone',
      ...s.common,
      '--contratto',
      'ctr-berchet',
      '--dal',
      '2026-10',
      '--canone',
      '1730,00',
      '--acconto',
      '150,00',
    ],
  ];
  const message =
    'Canone del contratto diverso dal totale delle presenze: controllare il contratto o le presenze.';

  it('il percorso completo: controlli, seconda esecuzione, annullamento, Excel invariato', async () => {
    const s = await fixtureFolder();
    const outs = [];
    const results = [];
    for (const args of commands(s)) {
      const r = await run(args);
      outs.push(r.out);
      results.push(r);
      expect([args[0], r.code, r.json.status]).toEqual([args[0], 0, 'saved']);
    }
    const list = await run(['contratti', ...s.common]);
    outs.push(list.out);
    expect(list.json.checks).toEqual([
      { code: 'deposit-other-tenant', contractId: 'ctr-berchet' },
      { code: 'rent-differs', contractId: 'ctr-berchet', from: '2025-10', to: '2026-09', message },
      { code: 'tenancy-outside-contract', contractId: 'ctr-berchet' },
    ]);
    expect(list.json.contracts.map((c) => [c.id, c.type, c.settlement, c.taxRegime])).toEqual([
      ['ctr-berchet', '1+1', 'annuale', 'cedolare'],
      ['ctr-lovarini', '3+2', 'intero-contratto', 'ordinario'],
    ]);
    const details = await run(['contratti', ...s.common, '--dettagli']);
    expect(details.json.checks).toEqual([
      expect.objectContaining({ code: 'deposit-other-tenant', paymentId: 'pay-franco' }),
      expect.objectContaining({ code: 'rent-differs', expected: 175000, actual: 188000 }),
      expect.objectContaining({ code: 'tenancy-outside-contract', tenancyId: 'tcy-elena' }),
    ]);

    // The same commands again: nothing written.
    const settled = snapshot(s.dir);
    for (const args of commands(s)) {
      const r = await run(args);
      outs.push(r.out);
      expect([args[0], r.code, r.json.status]).toEqual([args[0], 0, 'unchanged']);
    }
    expect(snapshot(s.dir)).toEqual(settled);

    // Without --dettagli no personal data (R107).
    const text = outs.join('');
    expect(scanText(text)).toEqual([]);
    expect(text).not.toMatch(/CODICE-PROVA|tcy-|pay-|ten-|Prova|Esempio|2025-09-20|2025-10-10/);
    expect(text).not.toMatch(/175000|188000|160000|173000|15000|1000\b/);

    // Undoing the renewal: the interval goes on to the month of the clock.
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      results[3].json.operationId,
    ]);
    expect(undo.code).toBe(0);
    const after = await run(['contratti', ...s.common]);
    expect(after.json.checks.filter((c) => c.code === 'rent-differs')).toEqual([
      { code: 'rent-differs', contractId: 'ctr-berchet', from: '2025-10', to: '2026-11', message },
    ]);

    // The Excel and the settlement periods as with a contract of the fields of before.
    const plain = await fixtureFolder([
      [
        'contract',
        {
          id: 'ctr-berchet',
          v: 1,
          rev: 1,
          apartmentId: 'berchet',
          type: '1+1',
          start: '2025-10',
          end: '2027-09',
          settlement: 'annuale',
        },
      ],
    ]);
    const stored = (dir) =>
      ContractSchema.parse(
        JSON.parse(readFileSync(join(dir, '_app', 'dati', 'contract', 'ctr-berchet.json'), 'utf8')),
      );
    const annualita = FIXTURE_CONTRACTS.records.apartment[0].annualitaStart;
    expect(settlementPeriods(stored(s.dir), annualita)).toEqual(
      settlementPeriods(stored(plain.dir), annualita),
    );
    const excelOf = async (dir) => {
      const target = join(dir, 'berchet.xlsx');
      const r = await excelMain(
        [
          '--cartella',
          dir,
          '--appartamento',
          'berchet',
          '--periodo',
          '2025-26',
          '--uscita',
          target,
        ],
        { newId: () => 'tmp-excel', link: linkSync },
      );
      expect(r.code).toBe(0);
      return readFileSync(target);
    };
    expect((await excelOf(s.dir)).equals(await excelOf(plain.dir))).toBe(true);
  });
});

describe('pnpm estratti condominio (piano 8)', () => {
  // Invented apartments, tenants and amounts; main() in process.
  let n8 = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `p8-${String((n8 += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };
  async function setup(records = []) {
    const dir = join(root, `p8-${String((counter += 1))}`);
    mkdirSync(dir);
    if (records.length > 0) {
      let n = 0;
      await commitChange(
        new FsStore(dir),
        {
          profileId: 'p1',
          kind: 'test.seed',
          summary: 'x',
          changes: records.map(([kind, r]) => ({
            path: recordPath(kind, r.id),
            after: recordSchemas[kind].parse(r),
          })),
        },
        () => ORA,
        () => `seed-${String((n += 1))}`,
      );
    }
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }
  const stored = (s, kind, id) =>
    JSON.parse(readFileSync(join(s.dir, '_app', 'dati', kind, `${id}.json`), 'utf8'));

  it('appartamento: crea con la differenza, aggiorna, rifiuta senza, annulla', async () => {
    const s = await setup();
    const base = ['appartamento', ...s.common, '--id', 'apt-a'];
    const create = [
      '--nome',
      'Appartamento A',
      '--locatore',
      'user1',
      '--posti',
      '4',
      '--annualita',
      '10-01',
      '--esercizio-condominio',
      '05-01',
    ];
    expect((await run([...base, ...create])).json).toMatchObject({
      status: 'rejected',
      reason: 'missing-fields',
    });
    const saved = await run([...base, ...create, '--differenza-condominio', 'proprietario']);
    expect([saved.code, saved.json.status]).toEqual([0, 'created']);
    expect(stored(s, 'apartment', 'apt-a')).toMatchObject({
      posti: 4,
      annualitaStart: { month: 10, day: 1 },
      condominioStart: { month: 5, day: 1 },
      condoDifferenceTo: 'owner',
    });
    const update = await run([...base, '--differenza-condominio', 'inquilini']);
    expect(update.json.status).toBe('updated');
    expect(stored(s, 'apartment', 'apt-a')).toMatchObject({
      posti: 4,
      condoDifferenceTo: 'tenants',
    });
    expect((await run([...base, '--differenza-condominio', 'inquilini'])).json.status).toBe(
      'unchanged',
    );
    expect((await run([...base, '--differenza-condominio', 'altro'])).code).toBe(2);
    expect((await run([...base, '--annualita', '13-01'])).code).toBe(2);
    expect((await run([...base, '--posti', '0'])).code).toBe(2);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      update.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect(stored(s, 'apartment', 'apt-a').condoDifferenceTo).toBe('owner');
    const beds = await run([...base, '--posti', '5']);
    expect([beds.code, beds.json.reason]).toEqual([1, 'needs-confirmation']);
    expect((await run([...base, '--posti', '5', '--modifica'])).json.status).toBe('updated');
    expect((await run([...base, '--posti', '4', '--modifica'])).json.status).toBe('updated');
  });

  it('condominio-documento: salva, non riscrive, rifiuta, annulla', async () => {
    const s = await setup([['apartment', apartment({ id: 'apt-a' })]]);
    const doc = [
      'condominio-documento',
      ...s.common,
      '--appartamento',
      'apt-a',
      '--esercizio',
      '2026-27',
      '--tipo',
      'consuntivo',
      '--totale',
      '1.250,00',
      '--quota-conduttore',
      '900,00',
    ];
    const saved = await run(doc);
    expect([saved.code, saved.json.status, saved.json.documentId]).toEqual([
      0,
      'saved',
      'condoc-apt-a-2026-27-consuntivo',
    ]);
    expect(saved.out).not.toContain('1250');
    expect(stored(s, 'condoDocument', 'condoc-apt-a-2026-27-consuntivo')).toMatchObject({
      total: 125000,
      quotaConduttore: 90000,
    });
    expect((await run(doc)).json.status).toBe('unchanged');
    expect(
      (await run([...doc.slice(0, -2)].map((a) => (a === 'consuntivo' ? 'bilancio' : a)))).code,
    ).toBe(2);
    const wrong = await run(doc.map((a) => (a === 'apt-a' ? 'apt-x' : a)));
    expect([wrong.code, wrong.json.reason]).toEqual([1, 'unknown-apartment']);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      saved.json.operationId,
    ]);
    expect(undo.code).toBe(0);
  });

  it('condominio: stati delle rate e differenze, importi solo con --dettagli', async () => {
    const base = { v: 1, rev: 1, apartmentId: 'apt-a', kind: 'condominio', esercizio: '2026-27' };
    const rate = (id, extra) => ({
      ...base,
      id,
      rateIndex: 1,
      rateCount: 3,
      dueDate: '2026-11-13',
      rata: 31415,
      quotaProprieta: 0,
      conguaglioPrec: 0,
      coversFrom: '2026-10',
      coversTo: '2027-01',
      ...extra,
    });
    const s = await setup([
      ['apartment', apartment({ id: 'apt-a', condoDifferenceTo: 'owner' })],
      ['instalment', rate('r-late')],
      ['instalment', rate('r-next', { rateIndex: 2, dueDate: '2026-11-14' })],
      ['instalment', rate('r-str', { straordinaria: true, rateCount: 1 })],
      [
        'condoDocument',
        {
          v: 1,
          rev: 1,
          id: 'condoc-apt-a-2026-27-preventivo',
          apartmentId: 'apt-a',
          esercizio: '2026-27',
          kind: 'preventivo',
          total: 94245,
        },
      ],
      [
        'condoDocument',
        {
          v: 1,
          rev: 1,
          id: 'condoc-apt-a-2026-27-consuntivo',
          apartmentId: 'apt-a',
          esercizio: '2026-27',
          kind: 'consuntivo',
          total: 97245,
        },
      ],
    ]);
    // A statement covering the months, so that nothing is assumed paid (R2).
    await commitChange(
      new FsStore(s.dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          {
            path: recordPath('account', 'acc-a'),
            after: recordSchemas.account.parse({
              id: 'acc-a',
              v: 1,
              rev: 1,
              apartmentId: 'apt-a',
              label: 'Conto',
              bankProfileId: 'bp',
            }),
          },
          {
            path: recordPath('statement', 'st-a'),
            after: recordSchemas.statement.parse({
              id: 'st-a',
              v: 1,
              rev: 1,
              accountId: 'acc-a',
              bankProfileId: 'bp',
              fileName: 'estratto.csv',
              suggestedPath: 'estratto.csv',
              from: '2026-01-01',
              to: '2026-12-31',
              periodSource: 'manual',
              rowCount: 0,
              transactionIds: [],
              held: [],
            }),
          },
        ],
      },
      () => ORA,
      () => 'seed-st',
    );
    const out = await run(['condominio', ...s.common]);
    expect(out.code).toBe(0);
    expect(out.json.rates.map((r) => [r.instalmentId, r.straordinaria, r.status])).toEqual([
      ['r-late', false, 'senza-addebito'],
      ['r-next', false, 'in-programma'],
      ['r-str', true, 'senza-addebito'],
    ]);
    expect(out.json.anomalies).toBe(2);
    expect(out.json.warnings).toEqual([]);
    expect(out.json.differences).toEqual([
      { apartmentId: 'apt-a', esercizio: '2026-27', to: 'owner', conduttore: 0 },
    ]);
    expect(out.out).not.toMatch(/31415|94245|3000|2026-11-1/);
    const details = await run(['condominio', ...s.common, '--dettagli', '--esercizio', '2026-27']);
    expect(details.json.rates[0]).toMatchObject({ expected: 31415, dueDate: '2026-11-13' });
    expect(details.json.differences[0]).toMatchObject({ difference: 3000 });
    expect((await run(['condominio', ...s.common, '--tipo', 'x'])).code).toBe(2);
  });

  it('recupero: quote uguali di default, stato di user1, rifiuti, nessun importo in uscita', async () => {
    const tenancy = (id, tenantId) => ({
      id,
      v: 1,
      rev: 1,
      apartmentId: 'apt-a',
      tenantId,
      from: '2026-10',
      monthlyRent: 30000,
      monthlyForfait: 3000,
    });
    const s = await setup([
      ['apartment', apartment({ id: 'apt-a' })],
      [
        'instalment',
        {
          id: 'str-1',
          v: 1,
          rev: 1,
          apartmentId: 'apt-a',
          kind: 'condominio',
          esercizio: '2026-27',
          rateIndex: 1,
          rateCount: 1,
          dueDate: '2026-11-30',
          rata: 27183,
          quotaProprieta: 0,
          conguaglioPrec: 0,
          straordinaria: true,
          coversFrom: '2026-11',
          coversTo: '2026-11',
        },
      ],
      ['tenancy', tenancy('tcy-1', 'ten-1')],
      ['tenancy', tenancy('tcy-2', 'ten-2')],
    ]);
    const rec = [
      'recupero',
      ...s.common,
      '--id',
      'rec-1',
      '--appartamento',
      'apt-a',
      '--voce',
      'str-1',
      '--importo',
      '150,01',
      '--inquilini',
      'ten-2,ten-1',
      '--periodo',
      '2026-27',
    ];
    const saved = await run(rec);
    expect([saved.code, saved.json.status, saved.json.recoveryId]).toEqual([0, 'saved', 'rec-1']);
    expect(saved.out).not.toMatch(/15001|7501|ten-/);
    expect(stored(s, 'tenantRecovery', 'rec-1')).toMatchObject({
      amount: 15001,
      shares: [
        { tenantId: 'ten-2', amount: 7501 },
        { tenantId: 'ten-1', amount: 7500 },
      ],
      status: 'da-recuperare',
      periodLabel: '2026-27',
    });
    const manual = await run([...rec, '--quote', '100,01;50,00', '--stato', 'non-recuperabile']);
    expect(manual.json.status).toBe('saved');
    expect(stored(s, 'tenantRecovery', 'rec-1').shares[0].amount).toBe(10001);
    const tooMuch = await run(rec.map((a) => (a === '150,01' ? '271,84' : a)));
    expect([tooMuch.code, tooMuch.json.reason]).toEqual([1, 'amount-too-high']);
    expect((await run([...rec, '--quote', '1,00'])).code).toBe(2);
    expect((await run([...rec, '--stato', 'pagata'])).code).toBe(2);
    const listed = await run(['condominio', ...s.common]);
    expect(listed.json.recoveries).toEqual([
      {
        recoveryId: 'rec-1',
        apartmentId: 'apt-a',
        instalmentId: 'str-1',
        status: 'non-recuperabile',
        periodLabel: '2026-27',
        tenants: 2,
      },
    ]);
    expect(listed.out).not.toMatch(/10001|ten-/);
    const detailed = await run(['condominio', ...s.common, '--dettagli']);
    expect(detailed.json.recoveries[0]).toMatchObject({ amount: 15001 });
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      manual.json.operationId,
    ]);
    expect(undo.code).toBe(0);
  });

  it('recupero negativo senza spesa: --data o --periodo, nessun importo in uscita (R300)', async () => {
    const s = await setup([
      ['apartment', apartment({ id: 'apt-a' })],
      [
        'tenancy',
        {
          id: 'tcy-1',
          v: 1,
          rev: 1,
          apartmentId: 'apt-a',
          tenantId: 'ten-1',
          from: '2026-10',
          monthlyRent: 30000,
          monthlyForfait: 3000,
        },
      ],
    ]);
    const rec = [
      'recupero',
      ...s.common,
      '--id',
      'rec-n',
      '--appartamento',
      'apt-a',
      // A negative value goes with `=` (parseArgs).
      '--importo=-40,00',
      '--inquilini',
      'ten-1',
    ];
    const missing = await run(rec);
    expect([missing.code, missing.json.reason]).toEqual([1, 'missing-date']);
    const saved = await run([...rec, '--data', '2026-12-10']);
    expect([saved.code, saved.json.status]).toEqual([0, 'saved']);
    expect(saved.out).not.toMatch(/4000|ten-/);
    expect(stored(s, 'tenantRecovery', 'rec-n')).toMatchObject({
      amount: -4000,
      shares: [{ tenantId: 'ten-1', amount: -4000 }],
      date: '2026-12-10',
    });
    const positive = await run([
      ...rec.map((a) => (a === '--importo=-40,00' ? '--importo=40,00' : a)),
      '--data',
      '2026-12-10',
    ]);
    expect([positive.code, positive.json.reason]).toEqual([1, 'invalid-recovery']);
    const movement = await run([...rec, '--movimento', 'tx-x']);
    expect([movement.code, movement.json.reason]).toEqual([1, 'unknown-expense']);
  });

  it('condominio-stima: copiata dall’esercizio prima, importi solo con --dettagli (R250)', async () => {
    const s = await setup([
      ['apartment', apartment({ id: 'apt-a' })],
      [
        'condoDocument',
        {
          id: 'condoc-apt-a-2025-26-consuntivo',
          v: 1,
          rev: 1,
          apartmentId: 'apt-a',
          esercizio: '2025-26',
          kind: 'consuntivo',
          total: 123456,
        },
      ],
    ]);
    const ask = ['condominio-stima', ...s.common, '--appartamento', 'apt-a', '--esercizio'];
    const copied = await run([...ask, '2026-27']);
    expect([copied.code, copied.json]).toEqual([
      0,
      {
        status: 'ok',
        estimate: {
          apartmentId: 'apt-a',
          esercizio: '2026-27',
          source: 'copiata',
          fromEsercizio: '2025-26',
          fromKind: 'consuntivo',
          message: expect.stringContaining('copiata'),
        },
      },
    ]);
    expect(copied.out).not.toContain('123456');
    const details = await run([...ask, '2026-27', '--dettagli']);
    expect(details.json.estimate).toMatchObject({ total: 123456 });
    expect((await run([...ask, '2024-25'])).json).toEqual({ status: 'ok' });
    const wrong = await run(ask.map((a) => (a === 'apt-a' ? 'apt-x' : a)).concat('2026-27'));
    expect([wrong.code, wrong.json.reason]).toEqual([1, 'unknown-apartment']);
    expect((await run(['condominio-stima', ...s.common, '--appartamento', 'apt-a'])).code).toBe(2);
    expect((await run([...ask, '2026/27'])).code).toBe(2);
    expect((await run([...ask, ''])).code).toBe(2);
  });

  it('contatto e contatti: rubrica, nomi e contatti solo con --dettagli, annulla (R253)', async () => {
    const s = await setup([
      ['apartment', apartment({ id: 'apt-a' })],
      ['apartment', apartment({ id: 'apt-b' })],
    ]);
    const create = [
      'contatto',
      ...s.common,
      '--id',
      'ctc-1',
      '--ruolo',
      'amministratore',
      '--nome',
      'Amministratore Prova',
      '--telefono',
      '+39 000 000 0000',
      '--email',
      'amministratore@example.test',
      '--appartamenti',
      'apt-a,apt-b',
    ];
    const saved = await run(create);
    expect([saved.code, saved.json.status, saved.json.contactId]).toEqual([0, 'saved', 'ctc-1']);
    expect(saved.out).not.toMatch(/Prova|example\.test|000 000/);
    expect((await run(create)).json.status).toBe('unchanged');
    expect(stored(s, 'contact', 'ctc-1')).toMatchObject({
      name: 'Amministratore Prova',
      apartmentIds: ['apt-a', 'apt-b'],
    });
    const listed = await run(['contatti', ...s.common, '--appartamento', 'apt-b']);
    expect(listed.json).toEqual({
      status: 'ok',
      contacts: [
        {
          contactId: 'ctc-1',
          role: 'amministratore',
          apartmentIds: ['apt-a', 'apt-b'],
          supplyIds: [],
          categories: [],
          phone: 1,
          email: 1,
          notes: 0,
        },
      ],
    });
    expect(listed.out).not.toMatch(/Prova|example\.test/);
    const details = await run(['contatti', ...s.common, '--dettagli']);
    expect(details.json.contacts[0]).toMatchObject({
      name: 'Amministratore Prova',
      email: 'amministratore@example.test',
    });
    expect((await run(['contatti', ...s.common, '--ruolo', 'fornitore'])).json.contacts).toEqual(
      [],
    );
    expect((await run(create.map((a) => (a === 'amministratore' ? 'idraulico' : a)))).code).toBe(2);
    expect((await run(['contatti', ...s.common, '--nome', 'x'])).code).toBe(2);
    const noApartment = await run(['contatti', ...s.common, '--appartamento', 'apt-x']);
    expect([noApartment.code, noApartment.json.reason]).toEqual([1, 'unknown-apartment']);
    const unknown = await run(create.map((a) => (a === 'apt-a,apt-b' ? 'apt-x' : a)));
    expect([unknown.code, unknown.json.reason]).toEqual([1, 'unknown-apartment']);
    expect(unknown.out).not.toMatch(/Prova/);
    const supply = await run([...create, '--utenze', 'sup-x']);
    expect([supply.code, supply.json.reason]).toEqual([1, 'unknown-supply']);
    const fornitore = await run([
      'contatto',
      ...s.common,
      '--id',
      'ctc-2',
      '--ruolo',
      'fornitore',
      '--nome',
      'Fornitore Prova',
      '--categorie',
      'gas,acqua',
    ]);
    expect(fornitore.json.status).toBe('saved');
    expect(stored(s, 'contact', 'ctc-2')).toMatchObject({
      apartmentIds: [],
      categories: ['gas', 'acqua'],
    });
    const badCategory = await run([...create, '--categorie', 'tari']);
    expect([badCategory.code, badCategory.json.reason]).toEqual([1, 'invalid-contact']);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      saved.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect((await run(['contatti', ...s.common])).json.contacts.map((c) => c.contactId)).toEqual([
      'ctc-2',
    ]);
  });
});

describe('pnpm estratti scadenze (piano 9, task 4)', () => {
  // Invented apartments, landlords, amounts and dates (fixtures/README.md); main() in process.
  let n = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `p9-${String((n += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };

  async function payableSetup() {
    const dir = join(root, `p9-${String((counter += 1))}`);
    mkdirSync(dir);
    const tx = (id, amount) => ({
      id,
      v: 1,
      rev: 1,
      apartmentId: 'pulci',
      date: '2026-11-10',
      amount,
      description: 'Causale-inventata-F24',
      statementHash: 'h',
    });
    const records = [
      ['apartment', apartment({ id: 'pulci', locatore: 'Locatore-Inventato-Due' })],
      ['transaction', tx('t-f24', -6700)],
      ['transaction', tx('t-free', -1600)],
      [
        'movementClass',
        {
          id: 'mc-t-f24',
          v: 1,
          rev: 1,
          transactionId: 't-f24',
          kind: 'tasse',
          apartmentId: 'pulci',
          f24: true,
        },
      ],
    ];
    let k = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((k += 1))}`,
    );
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }

  it('scadenza-nuova, scadenze con filtri e --dettagli, pagata con un movimento e annullata', async () => {
    const s = await payableSetup();
    const nuova = (...extra) => [
      'scadenza-nuova',
      ...s.common,
      '--appartamento',
      'pulci',
      ...extra,
    ];
    const registro = await run(
      nuova('--tipo', 'registro', '--scadenza', '2026-11-13', '--importo', '67,00'),
    );
    expect([registro.code, registro.json]).toEqual([
      0,
      {
        status: 'saved',
        payableId: registro.json.payableId,
        operationId: registro.json.operationId,
      },
    ]);
    const bollo = await run(nuova('--tipo', 'bollo', '--scadenza', '2026-11-20', '--ogni-anno'));
    expect(bollo.code).toBe(0);
    const same = await run(
      nuova(
        '--tipo',
        'bollo',
        '--scadenza',
        '2026-11-20',
        '--ogni-anno',
        '--id',
        bollo.json.payableId,
      ),
    );
    expect(same.json).toEqual({ status: 'unchanged', payableId: bollo.json.payableId });

    const snap = snapshot(s.dir);
    for (const bad of [
      nuova('--tipo', 'imu', '--scadenza', '2026-11-20'),
      nuova('--tipo', 'bollo', '--scadenza', '2026-02-30'),
      nuova('--tipo', 'bollo'),
      nuova('--tipo', 'bollo', '--scadenza', '2026-11-20', '--importo', 'abc'),
      ['scadenze', ...s.common, '--stato', 'in-scadenza'],
      ['scadenze', ...s.common, '--stato', 'tutte'],
      ['scadenze', ...s.common, '--entro', '-1'],
      ['scadenze', ...s.common, '--oggi', '2026-13-01'],
      ['scadenze', ...s.common, '--tipo', 'nessuno'],
      ['scadenza-pagata', ...s.common, '--id', registro.json.payableId],
      ['scadenza-ripeti', ...s.common, '--id', bollo.json.payableId],
      ['imu', ...s.common, '--entro', '3'],
      ['contratti', ...s.common, '--ogni-anno'],
    ]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]);
    }
    const nobody = await run([
      'scadenza-nuova',
      ...s.common,
      '--appartamento',
      'nessuno',
      '--tipo',
      'bollo',
      '--scadenza',
      '2026-11-20',
    ]);
    expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-apartment']);
    expect(snapshot(s.dir)).toEqual(snap);

    // Today is the UTC date of --ora (2026-11-14): the registro is late from 2026-11-14.
    const list = await run(['scadenze', ...s.common]);
    expect(list.json).toEqual({
      status: 'ok',
      items: [
        {
          source: 'payable',
          id: registro.json.payableId,
          kind: 'registro',
          apartmentIds: ['pulci'],
          state: 'in-ritardo',
        },
        {
          source: 'payable',
          id: bollo.json.payableId,
          kind: 'bollo',
          apartmentIds: ['pulci'],
          // Within the default 15 days (R309).
          state: 'in-scadenza',
          repeatYearly: true,
        },
      ],
      contractEnds: [],
    });
    expect(list.out).not.toMatch(/Locatore|6700|2026-11-1|67,00/);
    expect(scanText(list.out)).toEqual([]);
    const soon = await run(['scadenze', ...s.common, '--entro', '6', '--stato', 'in-scadenza']);
    expect(soon.json.items.map((i) => i.kind)).toEqual(['bollo']);
    expect((await run(['scadenze', ...s.common, '--tipo', 'registro'])).json.items).toHaveLength(1);
    const earlier = await run([
      'scadenze',
      ...s.common,
      '--oggi',
      '2026-11-13',
      '--stato',
      'in-ritardo',
    ]);
    expect(earlier.json.items).toEqual([]);

    const paid = await run([
      'scadenza-pagata',
      ...s.common,
      '--id',
      registro.json.payableId,
      '--movimento',
      't-f24',
    ]);
    expect([paid.code, paid.json.status]).toEqual([0, 'saved']);
    const taken = await run([
      'scadenza-pagata',
      ...s.common,
      '--id',
      bollo.json.payableId,
      '--movimento',
      't-free',
    ]);
    expect([taken.code, taken.json.reason]).toEqual([1, 'transaction-not-classified']);
    const details = await run(['scadenze', ...s.common, '--dettagli', '--stato', 'pagata']);
    expect(details.json.items).toEqual([
      {
        source: 'payable',
        id: registro.json.payableId,
        kind: 'registro',
        apartmentIds: ['pulci'],
        state: 'pagata',
        taxpayers: ['Locatore-Inventato-Due'],
        dueDate: '2026-11-13',
        expected: 6700,
        paidOn: '2026-11-10',
        transactionId: 't-f24',
      },
    ]);
    expect(details.json.estimates).toEqual([]);

    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      paid.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect((await run(['scadenze', ...s.common, '--stato', 'pagata'])).json.items).toEqual([]);
    const byHand = await run([
      'scadenza-pagata',
      ...s.common,
      '--id',
      registro.json.payableId,
      '--data',
      '2026-11-12',
    ]);
    expect(byHand.code).toBe(0);
    const again = await run([
      'scadenza-pagata',
      ...s.common,
      '--id',
      registro.json.payableId,
      '--data',
      '2026-11-12',
    ]);
    expect([again.code, again.json.reason]).toEqual([1, 'already-paid']);
  });

  it('scadenza-ripeti crea la voce successiva con la data data a mano, una volta', async () => {
    const s = await payableSetup();
    const bollo = await run([
      'scadenza-nuova',
      ...s.common,
      '--appartamento',
      'pulci',
      '--tipo',
      'bollo',
      '--scadenza',
      '2026-11-20',
      '--ogni-anno',
    ]);
    const ripeti = [
      'scadenza-ripeti',
      ...s.common,
      '--id',
      bollo.json.payableId,
      '--scadenza',
      '2027-11-19',
    ];
    const next = await run(ripeti);
    expect([next.code, next.json.status]).toEqual([0, 'saved']);
    expect((await run(ripeti)).json.reason).toBe('already-repeated');
    const list = await run(['scadenze', ...s.common]);
    expect(list.json.items).toEqual([
      expect.objectContaining({ id: bollo.json.payableId, repeatYearly: true, repeated: true }),
      expect.objectContaining({ id: next.json.payableId, repeatYearly: true }),
    ]);
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      next.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect((await run(['scadenze', ...s.common])).json.items).toHaveLength(1);
  });
  it('--anno-riferimento (piano 13): anno AAAA scritto da user1, solo in scadenza-nuova e scadenza-ripeti', async () => {
    const s = await payableSetup();
    const nuova = (year, ...extra) => [
      'scadenza-nuova',
      ...s.common,
      '--appartamento',
      'pulci',
      '--tipo',
      'cedolare',
      '--scadenza',
      '2026-11-30',
      '--anno-riferimento',
      year,
      ...extra,
    ];
    const read = (id) =>
      JSON.parse(readFileSync(join(s.dir, '_app', 'dati', 'payable', `${id}.json`), 'utf8'));
    const cedolare = await run(nuova('2026', '--ogni-anno'));
    expect(cedolare.code).toBe(0);
    expect(read(cedolare.json.payableId).taxYear).toBe(2026);
    const snap = snapshot(s.dir);
    for (const bad of [
      nuova('26'),
      nuova('2026.5'),
      nuova('0000'),
      nuova('anno'),
      ['scadenze', ...s.common, '--anno-riferimento', '2026'],
    ]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]);
    }
    expect(snapshot(s.dir)).toEqual(snap);
    const next = await run([
      'scadenza-ripeti',
      ...s.common,
      '--id',
      cedolare.json.payableId,
      '--scadenza',
      '2027-11-30',
      '--anno-riferimento',
      '2027',
    ]);
    expect([next.code, read(next.json.payableId).taxYear]).toEqual([0, 2027]);
    // The year is shown by scadenze, also without --dettagli (not a personal datum).
    expect((await run(['scadenze', ...s.common])).json.items.map((i) => i.taxYear)).toEqual([
      2026, 2027,
    ]);
  });
});

describe('pnpm estratti tasse (piano 10)', () => {
  // Invented apartments, taxpayers and amounts; main() in process.
  let n10 = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `p10-${String((n10 += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };
  const SECRET = 'Contribuente-inventato';
  async function setup() {
    const dir = join(root, `p10-${String((counter += 1))}`);
    mkdirSync(dir);
    const base = { v: 1, rev: 1 };
    const records = [
      ['apartment', { ...apartment(), id: 'nord', locatore: SECRET }],
      [
        'transaction',
        {
          ...base,
          id: 'tx-ced',
          apartmentId: 'nord',
          date: '2026-06-16',
          amount: -123457,
          description: 'F24',
          statementHash: 'h1',
        },
      ],
      [
        'movementClass',
        {
          ...base,
          id: 'mc-tx-ced',
          transactionId: 'tx-ced',
          kind: 'tasse',
          apartmentId: 'nord',
          f24: true,
        },
      ],
    ];
    let n = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((n += 1))}`,
    );
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }

  it('tasse-stima, tasse-assegna, tasse: importi e contribuente solo con --dettagli; annullamento', async () => {
    const s = await setup();
    const stima = (...extra) => ['tasse-stima', ...s.common, '--appartamento', 'nord', ...extra];
    const saved = await run(stima('--anno', '2026', '--voce', 'cedolare', '--importo', '1234,57'));
    expect([saved.code, saved.json]).toEqual([
      0,
      {
        status: 'saved',
        estimateId: 'tax-nord-2026-cedolare',
        operationId: saved.json.operationId,
      },
    ]);
    expect(
      (await run(stima('--anno', '2026', '--voce', 'cedolare', '--importo', '1234,57'))).json,
    ).toEqual({ status: 'unchanged', estimateId: 'tax-nord-2026-cedolare' });
    expect(
      (await run(stima('--anno', '2026', '--voce', 'registro', '--importo', '0'))).json.status,
    ).toBe('saved');
    const snap = snapshot(s.dir);
    for (const bad of [
      stima('--anno', '26', '--voce', 'cedolare', '--importo', '1,00'),
      stima('--anno', '2026', '--voce', 'irpef', '--importo', '1,00'),
      stima('--anno', '2026', '--voce', 'cedolare', '--importo', '-1,00'),
      stima('--anno', '2026', '--voce', 'cedolare'),
      stima('--anno', '2026', '--voce', 'cedolare', '--importo', '1,00', 'x'),
      ['tasse', ...s.common, '--anno', '2026', '--voce', 'cedolare'],
      ['tasse', ...s.common],
      ['tasse-assegna', ...s.common, '--movimento', 'tx-ced', '--parte', 'imu:2026:1,00'],
      ['tasse-assegna', ...s.common, '--movimento', 'tx-ced', '--parte', 'cedolare:2026'],
      ['tasse-assegna', ...s.common, '--movimento', 'tx-ced'],
      ['tasse-copia', ...s.common, '--anno', '2027', '--importo', '1,00'],
    ]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]);
    }
    const nobody = await run([
      'tasse-stima',
      ...s.common,
      '--appartamento',
      'nessuno',
      '--anno',
      '2026',
      '--voce',
      'imu',
      '--importo',
      '1,00',
    ]);
    expect([nobody.code, nobody.json.reason]).toEqual([1, 'unknown-apartment']);
    const assegna = (...parts) => [
      'tasse-assegna',
      ...s.common,
      '--movimento',
      'tx-ced',
      ...parts.flatMap((p) => ['--parte', p]),
    ];
    for (const bad of [assegna('cedolare:2026:0'), assegna('cedolare:2026:-1,00')]) {
      expect([bad, (await run(bad)).code]).toEqual([bad, 2]); // R214: an amount not positive
    }
    const twice = await run(assegna('cedolare:2026:1,00', 'cedolare:2026:1,00'));
    expect([twice.code, twice.json.reason, twice.json.message]).toEqual([
      1,
      'bad-parts',
      'Rifiutato: parti non valide (importo non positivo, voce e anno ripetuti, voce non ammessa).',
    ]);
    const mismatch = await run(assegna('cedolare:2026:1,00'));
    expect([mismatch.code, mismatch.json.reason]).toEqual([1, 'sum-mismatch']);
    expect(snapshot(s.dir)).toEqual(snap);
    const assigned = await run(assegna('cedolare:2025:234,57', 'cedolare:2026:1000,00'));
    expect([assigned.code, assigned.json]).toEqual([
      0,
      {
        status: 'assigned',
        taxPaymentId: 'taxp-tx-ced',
        operationId: assigned.json.operationId,
      },
    ]);

    const list = await run(['tasse', ...s.common, '--anno', '2026']);
    expect(list.code).toBe(0);
    expect(list.json).toMatchObject({ status: 'ok', year: '2026', warnings: [] });
    expect(list.json.tables).toHaveLength(1);
    expect(list.json.tables[0].apartmentIds).toEqual(['nord']);
    // No payable with a reference year: the expected is unknown (R243), with the hint.
    expect(list.json.tables[0].rows[0]).toEqual({
      voce: 'cedolare',
      state: 'da-verificare',
      reasons: ['no-expected-source'],
      message: expect.stringContaining('--anno-riferimento'),
    });
    expect(list.out).not.toMatch(new RegExp(`${SECRET}|123457|100000|23457`));
    expect(scanText(list.out)).toEqual([]);
    const details = await run(['tasse', ...s.common, '--anno', '2026', '--dettagli']);
    expect(details.json.tables[0].taxpayer).toBe(SECRET);
    expect(details.json.tables[0].rows[0]).toMatchObject({ estimate: 123457, paid: 100000 });

    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      assigned.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    const after = await run(['tasse', ...s.common, '--anno', '2026', '--dettagli']);
    expect(after.json.tables[0].rows[0].reasons).toEqual([
      'no-expected-source',
      'unassigned-tax-movement',
    ]);
  });

  it('tasse: la differenza sul totale annuo IMU solo con --dettagli (piano 13)', async () => {
    const dir = join(root, `p13-${String((counter += 1))}`);
    mkdirSync(dir);
    const base = { v: 1, rev: 1 };
    const records = [
      ['apartment', { ...apartment(), id: 'nord', locatore: SECRET }],
      [
        'transaction',
        {
          ...base,
          id: 'tx-imu',
          apartmentId: 'nord',
          date: '2026-06-16',
          amount: -123457,
          description: 'F24',
          statementHash: 'h1',
        },
      ],
      [
        'movementClass',
        {
          ...base,
          id: 'mc-tx-imu',
          transactionId: 'tx-imu',
          kind: 'tasse',
          apartmentId: 'nord',
          f24: true,
          imu: { f24Group: 'g', year: '2026', rateIndex: 1 },
        },
      ],
      [
        'imuYear',
        {
          ...base,
          id: 'imu-nord-2026',
          apartmentId: 'nord',
          year: '2026',
          f24Group: 'g',
          annualTotal: 123400,
          rates: [{ index: 1 }],
        },
      ],
    ];
    let k = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((k += 1))}`,
    );
    const s = { common: ['--cartella', dir, '--ora', ORA] };
    const estimate = await run([
      'tasse-stima',
      ...s.common,
      '--appartamento',
      'nord',
      '--anno',
      '2026',
      '--voce',
      'imu',
      '--importo',
      '1234,57',
    ]);
    expect(estimate.code).toBe(0);
    const plain = await run(['tasse', ...s.common, '--anno', '2026']);
    const imu = (r) => r.json.tables[0].rows.find((row) => row.voce === 'imu');
    expect(imu(plain)).toEqual({
      voce: 'imu',
      state: 'discrepanza',
      reasons: [],
      message: expect.any(String),
    });
    expect(plain.out).not.toMatch(/annualDifference|57/);
    const details = await run(['tasse', ...s.common, '--anno', '2026', '--dettagli']);
    expect(imu(details)).toMatchObject({ paid: 123457, difference: 0, annualDifference: 57 });
  });

  it('tasse-conferma: una discrepanza confermata con una nota non avvisa più (R304)', async () => {
    const s = await setup();
    await run([
      'tasse-stima',
      ...s.common,
      '--appartamento',
      'nord',
      '--anno',
      '2026',
      '--voce',
      'condominio',
      '--importo',
      '50,00',
    ]);
    const row = async () =>
      (await run(['tasse', ...s.common, '--anno', '2026'])).json.tables[0].rows.find(
        (r) => r.voce === 'condominio',
      );
    expect((await row()).state).toBe('discrepanza');
    const confirm = [
      'tasse-conferma',
      ...s.common,
      '--appartamento',
      'nord',
      '--anno',
      '2026',
      '--voce',
      'condominio',
      '--note',
      'Nota di prova',
    ];
    const done = await run(confirm);
    expect([done.code, done.json.status, done.json.confirmationId]).toEqual([
      0,
      'confirmed',
      'taxc-nord-2026-condominio',
    ]);
    expect(done.out).not.toMatch(/Nota di prova|5000/);
    expect((await row()).state).toBe('confermata');
    expect((await run(confirm.map((a) => (a === 'condominio' ? 'imu' : a)))).json.reason).toBe(
      'no-discrepancy',
    );
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      done.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    expect((await row()).state).toBe('discrepanza');
  });

  it('tasse a gennaio avvisa dell’anno vuoto; tasse-copia copia l’anno prima solo a comando', async () => {
    const s = await setup();
    const january = ['--cartella', s.dir, '--ora', '2027-01-10T09:00:00.000Z'];
    await run([
      'tasse-stima',
      ...s.common,
      '--appartamento',
      'nord',
      '--anno',
      '2026',
      '--voce',
      'imu',
      '--importo',
      '500,00',
    ]);
    const warned = await run(['tasse', ...january, '--anno', '2027']);
    expect(warned.json.warnings).toEqual([
      {
        apartmentIds: ['nord'],
        year: '2027',
        canCopy: true,
        message:
          'Avviso: nessuna stima delle tasse per quest’anno: «tasse-copia» copia l’anno prima.',
      },
    ]);
    // The warning writes nothing.
    expect(warned.json.tables[0].rows[1].reasons).toContain('missing-estimate');
    const copied = await run(['tasse-copia', ...january, '--anno', '2027']);
    expect([copied.code, copied.json]).toEqual([
      0,
      {
        status: 'copied',
        estimateIds: ['tax-nord-2027-imu'],
        operationId: copied.json.operationId,
      },
    ]);
    const again = await run([
      'tasse-copia',
      ...january,
      '--anno',
      '2027',
      '--appartamento',
      'nord',
    ]);
    expect([again.code, again.json]).toEqual([
      0,
      { status: 'unchanged', estimateIds: ['tax-nord-2027-imu'] },
    ]);
    const edited = await run([
      'tasse-stima',
      ...s.common,
      '--appartamento',
      'nord',
      '--anno',
      '2027',
      '--voce',
      'imu',
      '--importo',
      '600,00',
    ]);
    const changed = await run(['tasse-copia', ...january, '--anno', '2027']);
    expect([changed.code, changed.json.reason]).toEqual([1, 'year-not-empty']);
    expect((await run(['tasse', ...january, '--anno', '2027'])).json.warnings).toEqual([]);
    // --oggi gives the day instead of the clock (as scadenze).
    const byDay = await run(['tasse', ...s.common, '--anno', '2028', '--oggi', '2028-01-02']);
    expect(byDay.json.warnings).toMatchObject([
      { apartmentIds: ['nord'], year: '2028', canCopy: true },
    ]);
    expect((await run(['tasse', ...s.common, '--anno', '2028', '--oggi', '2028-13-01'])).code).toBe(
      2,
    );
    for (const operation of [edited.json.operationId, copied.json.operationId]) {
      const undo = await run(['annulla-riconciliazione', ...s.common, '--operazione', operation]);
      expect(undo.code).toBe(0);
    }
  });
});

describe('pnpm estratti presenze, subentro e caparre (piano 11, task 4)', () => {
  // Invented tenants and amounts only; main() in process.
  let idCounter = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `p11-${String((idCounter += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };

  async function setup() {
    const dir = join(root, `p${String((counter += 1))}`);
    mkdirSync(dir);
    const records = [
      ['apartment', apartment({ id: 'pulci', posti: 2, rooms: ['A', 'B'] })],
      ['tenant', { id: 'ten-anna', v: 1, rev: 1, name: 'Anna Prova' }],
      ['tenant', { id: 'ten-bruno', v: 1, rev: 1, name: 'Bruno Esempio' }],
      [
        'contract',
        {
          id: 'ctr-pulci',
          v: 1,
          rev: 1,
          apartmentId: 'pulci',
          type: '1+1',
          start: '2025-10',
          end: '2026-09',
          settlement: 'annuale',
        },
      ],
      [
        'payment',
        {
          id: 'pay-c1',
          v: 1,
          rev: 1,
          apartmentId: 'pulci',
          tenantId: 'ten-anna',
          date: '2025-09-25',
          amount: 50000,
          confirmed: true,
          kind: 'caparra',
          source: 'manual',
        },
      ],
    ];
    let n = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: records.map(([kind, r]) => ({
          path: recordPath(kind, r.id),
          after: recordSchemas[kind].parse(r),
        })),
      },
      () => ORA,
      () => `seed-${String((n += 1))}`,
    );
    return { dir, common: ['--cartella', dir, '--ora', ORA] };
  }
  const presenza = (s, ...extra) => [
    'presenza',
    ...s.common,
    '--id',
    'tcy-anna',
    '--appartamento',
    'pulci',
    '--inquilino',
    'ten-anna',
    '--posto',
    'A',
    '--dal',
    '2025-10',
    '--al',
    '2026-09',
    '--affitto',
    '350,00',
    '--forfait',
    '30,00',
    '--caparra-attesa',
    '500,00',
    '--contratto',
    'ctr-pulci',
    ...extra,
  ];
  const subentro = (s, ...extra) => [
    'subentro',
    ...s.common,
    '--presenza',
    'tcy-anna',
    '--mese',
    '2026-02',
    '--id',
    'tcy-bruno',
    '--inquilino',
    'ten-bruno',
    '--affitto',
    '360,00',
    '--forfait',
    '30,00',
    '--caparra-attesa',
    '500,00',
    ...extra,
  ];
  const restituzione = (s, ...extra) => [
    'caparra-restituzione',
    ...s.common,
    '--appartamento',
    'pulci',
    '--inquilino',
    'ten-anna',
    '--conguaglio',
    '40,00',
    '--addebito',
    'Zanzariera:25,00',
    ...extra,
  ];

  it('presenza, subentro, stato-contratti, caparra-restituzione e annullamento', async () => {
    const s = await setup();
    const outs = [];
    const go = async (args) => {
      const r = await run(args);
      outs.push(r.out);
      return r;
    };
    const saved = await go(presenza(s));
    expect([saved.code, saved.json]).toEqual([
      0,
      { status: 'saved', tenancyId: 'tcy-anna', operationId: saved.json.operationId },
    ]);
    expect((await go(presenza(s))).json).toEqual({ status: 'unchanged', tenancyId: 'tcy-anna' });
    const taken = await go(subentro(s));
    expect([taken.code, taken.json.status]).toEqual([0, 'saved']);
    expect((await go(subentro(s))).json.status).toBe('unchanged');

    const status = await go(['stato-contratti', ...s.common]);
    expect(status.json).toEqual({
      status: 'ok',
      contracts: [
        {
          contractId: 'ctr-pulci',
          apartmentId: 'pulci',
          tenancies: { futura: 0, 'in-corso': 0, uscita: 2 },
          takeovers: 1,
          deposits: { versata: 1, diversa: 0, mancante: 1, 'non-impostata': 0 },
          message: 'Caparra mancante o diversa da quella attesa: controllare i versamenti.',
          checks: [],
        },
      ],
    });
    const detailed = await run(['stato-contratti', ...s.common, '--dettagli']);
    expect(detailed.json.contracts[0].takeoverList).toEqual([
      { month: '2026-03', outTenancyId: 'tcy-anna', inTenancyId: 'tcy-bruno' },
    ]);
    expect(detailed.json.contracts[0].tenancyList[1]).toMatchObject({
      tenancyId: 'tcy-bruno',
      room: 'A',
      from: '2026-03',
      to: '2026-09',
      monthlyRent: 36000,
    });

    for (const year of ['2025', '2026']) {
      const rate = await go(['tasso-legale', ...s.common, '--anno', year, '--tasso', '2']);
      expect([rate.code, rate.json.status, rate.json.rateId]).toEqual([
        0,
        'saved',
        `tasso-${year}`,
      ]);
    }
    const draft = await go(restituzione(s));
    expect([draft.code, draft.json.status, draft.json.lines]).toEqual([0, 'ok', 4]);
    const full = await run(restituzione(s, '--dettagli'));
    expect(full.json.statement.total).toBe(50000 + 417 - 4000 - 2500);

    const text = outs.join('');
    expect(scanText(text)).toEqual([]);
    // The writes echo the tenancy id typed by user1, as `contratto` echoes the contract id.
    expect(text).not.toMatch(/ten-|pay-|Anna|Bruno|Zanzariera|50000|36000|417/);

    // The takeover is undone in one step; the arrival of Anna is blocked by her deposit.
    const undo = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      taken.json.operationId,
    ]);
    expect(undo.code).toBe(0);
    const blocked = await run([
      'annulla-riconciliazione',
      ...s.common,
      '--operazione',
      saved.json.operationId,
    ]);
    expect([blocked.code, blocked.json.reason, blocked.json.recordIds]).toEqual([
      1,
      'has-dependents',
      ['pay-c1'],
    ]);
    expect(blocked.json.message).toMatch(/versamenti, recuperi o presenze/);
  });

  it('rifiuti 1 con messaggi costanti, argomenti 2', async () => {
    const s = await setup();
    await run(presenza(s));
    const conflict = await run(presenza(s, '--id', 'tcy-altra', '--inquilino', 'ten-bruno'));
    expect([conflict.code, conflict.json]).toMatchObject([
      1,
      { reason: 'beds-conflict', code: 'room-overlap', month: '2025-10' },
    ]);
    expect((await run(subentro(s, '--inquilino', 'ten-anna'))).json.reason).toBe('same-tenant');
    expect((await run(restituzione(s, '--inquilino', 'ten-bruno'))).json.reason).toBe('no-deposit');
    expect((await run(restituzione(s))).json.reason).toBe('missing-rate');
    for (const args of [
      presenza(s, '--affitto', '-1,00'),
      presenza(s, '--caparra-attesa', '0'),
      presenza(s, '--dal', '2025-13'),
      presenza(s, '--prova'),
      ['fine-presenza', ...s.common, '--presenza', 'tcy-anna'],
      ['subentro', ...s.common, '--presenza', 'tcy-anna', '--mese', '2026-02'],
      restituzione(s, '--dal', '2025-09-25'),
      restituzione(s, '--tasso', '2'),
      ['tasso-legale', ...s.common, '--anno', '2025', '--tasso', '2', '--tasso', '3'],
      ['tasso-legale', ...s.common, '--anno', '25', '--tasso', '2'],
      restituzione(s, '--addebito', 'senza-importo'),
      ['caparra-restituzione', ...s.common, '--appartamento', 'pulci'],
      ['stato-contratti', ...s.common, '--posto', 'A'],
    ]) {
      expect((await run(args)).code).toBe(2);
    }
    const end = await run([
      'fine-presenza',
      ...s.common,
      '--presenza',
      'tcy-anna',
      '--mese',
      '2026-06',
    ]);
    expect([end.code, end.json.status]).toEqual([0, 'saved']);
    // After a takeover, `contratto` without the tenancies of the takeover is refused.
    expect((await run(subentro(s))).json.status).toBe('saved');
    const contratto = (...extra) => [
      'contratto',
      ...s.common,
      '--id',
      'ctr-pulci',
      '--appartamento',
      'pulci',
      '--tipo',
      '1+1',
      '--inizio',
      '2025-10',
      '--fine',
      '2026-09',
      '--conguaglio',
      'annuale',
      ...extra,
    ];
    const dropped = await run(contratto());
    expect([dropped.code, dropped.json.reason, dropped.json.message]).toEqual([
      1,
      'takeover-unlinked',
      'Rifiutato: il contratto ha un subentro: ripetere --presenze con le presenze del subentro.',
    ]);
    expect((await run(contratto('--presenze', 'tcy-anna,tcy-bruno'))).code).toBe(0);
  });
});

describe('pnpm estratti bolletta, annulla-bolletta e cruscotto (piano 15)', () => {
  // Invented supplier, amounts and codes (fixtures/README.md); main() in process.
  let n = 0;
  const run = async (args) => {
    const r = await main(args, { now: () => ORA, newId: () => `p15-${String((n += 1))}` });
    return { code: r.code, out: r.output, json: JSON.parse(r.output) };
  };
  const field = (value) => ({
    value,
    confidence: 'high',
    source: { page: 1, box: [0, 0, 1, 1], text: 'x' },
  });

  it('da rivedere, confermata, doppione, annullata, contata nel cruscotto', async () => {
    const dir = join(root, `p15-${String((counter += 1))}`);
    mkdirSync(dir);
    let k = 0;
    await commitChange(
      new FsStore(dir),
      {
        profileId: 'p1',
        kind: 'test.seed',
        summary: 'x',
        changes: [{ path: recordPath('apartment', 'pulci'), after: apartment({ id: 'pulci' }) }],
      },
      () => ORA,
      () => `seed-${String((k += 1))}`,
    );
    const pdf = join(dir, 'bolletta.pdf');
    writeFileSync(pdf, '%PDF-1.7 bolletta inventata');
    const reading = {
      v: 1,
      engineVersion: '0.1.0',
      fileHash: await hashBytes(readFileSync(pdf)),
      fileName: 'bolletta.pdf',
      pages: 1,
      pageRange: [1, 1],
      status: 'riconosciuta',
      profileId: 'prof-inventato',
      profileRev: 1,
      kind: 'bill',
      documentKind: 'bill',
      category: 'gas',
      fields: {
        supplier: field('Fornitore-Inventato-Gas'),
        number: field('2026/0099'),
        issueDate: field('2026-10-05'),
        dueDate: field('2026-10-25'),
        periodStart: field('2026-08-01'),
        periodEnd: field('2026-09-30'),
        amount: field(4321),
      },
      parts: [],
      identifiers: [],
      checks: [],
      warnings: [],
      textSource: 'pdf',
      ocrPages: [],
    };
    const lettura = join(dir, 'lettura.json');
    writeFileSync(lettura, JSON.stringify(reading));
    const common = ['--cartella', dir, '--ora', ORA];
    const args = [...common, '--appartamento', 'pulci', '--lettura', lettura, pdf];

    expect((await run(['bolletta', ...args])).code).toBe(2); // no threshold: not decided (R262)
    const first = await run(['bolletta', ...args, '--soglia-consumi', '30']);
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({ status: 'da-rivedere' });
    expect(first.json.codes).toContain('apartment-codes-unknown');
    expect(first.json.codes).toContain('profile');
    expect(first.json.operationId).toBeDefined();
    for (const secret of ['Fornitore-Inventato-Gas', '43,21', '4321', '2026-08']) {
      expect(first.out).not.toContain(secret);
    }
    const again = await run(['bolletta', ...args, '--soglia-consumi', '30']);
    expect(again.json).toMatchObject({ status: 'da-rivedere', pendingId: first.json.pendingId });
    expect(again.json.operationId).toBeUndefined();

    const board = await run(['cruscotto', ...common, '--oggi', '2026-11-17']);
    expect(board.code).toBe(0);
    expect(board.json.apartments).toEqual([
      { apartmentId: 'pulci', counts: { 'documento-da-rivedere': 1 } },
    ]);

    const confirmed = await run(['bolletta', ...args, '--soglia-consumi', '30', '--conferma']);
    expect(confirmed.json).toMatchObject({ status: 'confermata' });
    const duplicate = await run(['bolletta', ...args, '--soglia-consumi', '30', '--conferma']);
    expect(duplicate.code).toBe(1);
    expect(duplicate.json).toMatchObject({ reason: 'duplicate-bill' });

    const undone = await run(['annulla-bolletta', ...common, pdf]);
    expect(undone.json.status).toBe('undone');
    expect(undone.json.operationIds).toHaveLength(2);
    expect(undone.json.records).toBe(2);
    expect((await run(['annulla-bolletta', ...common, '--pagine', '2-1', pdf])).code).toBe(2);
    const empty = await run(['cruscotto', ...common, '--oggi', '2026-11-17']);
    expect(empty.json.apartments).toEqual([{ apartmentId: 'pulci', counts: {} }]);
    expect((await run(['cruscotto', ...common, '--lettura', lettura])).code).toBe(2);
  });
});
