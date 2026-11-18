// End-to-end review of the whole life cycle (production readiness): the real command lines
// (`main()` of estratti, excel and moduli, in process as the newer CLI tests do) drive one
// invented data folder from empty to a settlement, the Excel files and a Word form, then undo
// everything in reverse order. Invented data only: «Appartamento A» and «Appartamento B», invented
// tenants, suppliers, amounts and IBANs (ibanEndingWith).
//
// The lifecycle runs in ordered phases that record every step (arguments, exit code, JSON, whether
// the folder changed, `checkConsistency`, the rerun of the same line); the cross-checks read that
// state. A check that fails for a real defect is `it.fails` and names its finding (E1, E2...) in
// the review report.

import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  billFileMove,
  calcConguaglio,
  checkConsistency,
  commitChange,
  hashBytes,
  linkSupply,
  planMatch,
  loadExcelInput,
  readJournal,
  readZip,
  recordPath,
  recordSchemas,
} from '../packages/core/src/index.ts';
import { ibanEndingWith } from '../packages/core/test/helpers/iban-build.ts';
import { inflateRaw } from '../packages/core/test/helpers/docx.ts';
import { scanText } from './check-personal-data.mjs';
import { main as estratti } from './estratti.mjs';
import { main as excel } from './excel.mjs';
import { main as moduli } from './moduli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT = 300_000;
const PROFILE = {
  ...JSON.parse(readFileSync(join(ROOT, 'fixtures', 'bank', 'profilo-sintetico.json'), 'utf8')),
  id: 'bp-e2e',
  f24Pattern: '^PAGAMENTO F24\\b',
};

// Invented people and suppliers: none of these may reach stdout without --dettagli.
const TENANTS = {
  't-uno': 'Tizio Fittizio',
  't-due': 'Caio Inventato',
  't-tre': 'Sempronio Prova',
  't-quattro': 'Mevia Esempio',
};
const IBAN_A = ibanEndingWith('7100001');
const IBAN_B = ibanEndingWith('7100002');
const IBAN_SUPPLIER = ibanEndingWith('7100009');
const SECRETS = [
  'Tizio',
  'Caio',
  'Sempronio',
  'Mevia',
  IBAN_A,
  IBAN_B,
  IBAN_SUPPLIER,
  '7100001',
  '7100002',
  'Gas-Inventato',
  'Luce-Inventata',
  'Acqua-Inventata',
  'Comune-Inventato',
  'Ferramenta',
  'Locatore-Inventato',
  'Etichetta-conto',
  'XXXINVENTATO',
  'Bonifico',
  'ADDEBITO',
  'Appartamento A',
  'Appartamento-A',
];
// Distinctive invented amounts in cents (rents 400,00/410,00/460,00, bills, F24...).
const AMOUNTS =
  /(?<![0-9a-f-])(40000|41000|46000|50000|12000|9000|4500|8000|18600|10075|8471|10104|8496|19800|15000|4800|100000|60000|40000|3500|2000|1500|35000|36000|5000|6000|70000|10000|6700|120000|80000|30000)(?![0-9a-f-])/;

let root;
let dir;
let clock = '2025-10-01T08:00:00.000Z';
let idCounter = 0;
const newId = () => `e2e-${String((idCounter += 1)).padStart(4, '0')}`;
/** Every recorded step, in order. */
const steps = [];
/** What can be undone, by operation id: how (`estratto`, `bolletta`) and with what. */
const undoHow = new Map();
const publicOut = [];
const detailOut = [];
/** Findings met while driving (a work-around was needed); the report lists them as E-ids. */
const notes = [];
const shared = {};

/** Every file of the data folder with its bytes (journal included). */
function snapshot(base = dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[f.slice(base.length)] = readFileSync(f, 'latin1');
    }
  };
  walk(base);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The live records of the data folder, as `kind/id` (deleted ones left out). */
function liveRecords() {
  const out = [];
  const data = join(dir, '_app', 'dati');
  if (!existsSync(data)) return out;
  for (const kind of readdirSync(data)) {
    for (const f of readdirSync(join(data, kind))) {
      const r = JSON.parse(readFileSync(join(data, kind, f), 'utf8'));
      if (r.deleted !== true) out.push(`${kind}/${r.id}`);
    }
  }
  return out.sort();
}
const records = (kind, { all = false } = {}) => {
  try {
    return readdirSync(join(dir, '_app', 'dati', kind))
      .map((f) => JSON.parse(readFileSync(join(dir, '_app', 'dati', kind, f), 'utf8')))
      .filter((r) => all || r.deleted !== true);
  } catch {
    return [];
  }
};
/** The live transaction of `apartmentId` with `text` in its description on `date`. */
const tx = (apartmentId, date, text) => {
  const found = records('transaction').filter(
    (t) => t.apartmentId === apartmentId && t.date === date && t.description.includes(text),
  );
  if (found.length !== 1) throw new Error(`transaction ${date} ${text}: ${String(found.length)}`);
  return found[0].id;
};

/**
 * Runs one command line of `tool` and records it; with `rerun` the same line again, recording
 * whether the second run changed any file. `--cartella` (and `--ora` for estratti) are added.
 */
async function step(tool, name, args, { rerun = true, label = name } = {}) {
  const argv =
    tool === 'estratti'
      ? [name, '--cartella', dir, '--ora', clock, ...args]
      : tool === 'excel'
        ? ['--cartella', dir, ...args]
        : args;
  const main = { estratti, excel, moduli }[tool];
  const io =
    tool === 'estratti'
      ? { now: () => clock, newId }
      : { newId, link: linkSync, today: () => clock.slice(0, 10) };
  const before = snapshot();
  const r = await main(argv, io);
  const after = snapshot();
  const problems = await checkConsistency(new FsStore(dir));
  const record = {
    label,
    tool,
    name,
    args,
    code: r.code,
    json: JSON.parse(r.output),
    out: r.output,
    wrote: !same(before, after),
    problems: problems.length,
  };
  const bucket = args.includes('--dettagli') ? detailOut : publicOut;
  bucket.push(r.output);
  if (rerun) {
    const again = await main(argv, io);
    record.rerun = {
      code: again.code,
      json: JSON.parse(again.output),
      wrote: !same(after, snapshot()),
    };
    bucket.push(again.output);
  }
  steps.push(record);
  return record;
}
/** A step that must succeed for the lifecycle to go on. */
async function ok(tool, name, args, options) {
  const r = await step(tool, name, args, options);
  if (r.code !== 0) throw new Error(`${r.label} ${JSON.stringify(args)} -> ${r.out}`);
  return r;
}
const run = (name, args, options) => ok('estratti', name, args, options);
const writeFile = (name, content) => {
  const file = join(root, name);
  writeFileSync(file, content);
  return file;
};

// --- Statements ------------------------------------------------------------------------------
const HEADER = 'Data contabile;Descrizione;Causale;Importo;Segno;Codice;Stato';
const eu = (cents) => {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${whole},${String(abs % 100).padStart(2, '0')}`;
};
/** [AAAA-MM-GG, description, cents (negative = debit), code?, state?] as a CSV row. */
const row = ([date, text, cents, code = '', state = '']) =>
  [
    `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`,
    text,
    '',
    eu(cents),
    cents < 0 ? 'D' : 'A',
    code,
    state,
  ].join(';');
const csv = (rows) => [HEADER, ...rows.map(row)].join('\n') + '\n';
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const n = 2025 * 12 + 9 + i;
  return `${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`;
});
const rowsA = [
  ['2025-10-02', 'Bonifico da Tizio Fittizio, caparra', 50000],
  ['2025-10-03', 'Bonifico da Caio Inventato, caparra', 50000],
  ...MONTHS.map((m) => [`${m}-05`, 'Bonifico da Tizio Fittizio, affitto', 40000]),
  ...MONTHS.slice(0, 6).map((m) => [`${m}-06`, 'Bonifico da Caio Inventato, affitto', 40000]),
  ...MONTHS.slice(6).map((m) => [`${m}-06`, 'Bonifico da Sempronio Prova, affitto', 41000]),
  ['2025-10-10', 'ADDEBITO CONDOMINIO VIA INVENTATA', -19800],
  ['2026-01-20', 'ADDEBITO SDD Gas-Inventato', -12000],
  ['2026-03-16', 'ADDEBITO TARI Comune-Inventato', -18600],
  ['2026-04-15', 'ADDEBITO SDD Luce-Inventata', -9000, 'A123'],
  ['2026-04-15', 'Commissioni e spese', -80, 'A123'],
  ['2026-04-07', 'Bonifico a Caio Inventato restituzione caparra', -50000],
  ['2026-05-12', `Bonifico a Ferramenta Inventata ${IBAN_SUPPLIER}`, -3500],
  ['2026-05-20', `Giroconto verso ${IBAN_B}`, -30000],
  ['2026-06-16', 'PAGAMENTO F24 DELEGA 0001', -100000],
  ['2026-07-01', 'Prelievo privato inventato', -2000],
  ['2026-09-29', 'Bonifico da Tizio Fittizio, in sospeso', 1500, '', 'Prenotato'],
];
const rowsB = [
  ['2025-10-03', 'Bonifico da Mevia Esempio, caparra', 50000],
  ...MONTHS.slice(0, 9).map((m) => [`${m}-07`, 'Bonifico da Mevia Esempio, affitto', 46000]),
  ['2026-02-20', 'ADDEBITO SDD Gas-Inventato', -8000],
  ['2026-05-20', `Giroconto da ${IBAN_A}`, 30000],
];

// --- Readings of invented PDFs (the JSON of `python -I -m bollette_pdf extract`) --------------
const field = (value) => ({
  value,
  confidence: 'high',
  source: { page: 1, box: [0, 0, 1, 1], text: 'x' },
});
/** Writes an invented PDF in `<Apt>/Da_smistare/` and its reading; returns both paths. */
async function pdfWithReading(folder, name, { kind, category, fields, parts = [] }) {
  const pdf = join(dir, folder, 'Da_smistare', name);
  mkdirSync(dirname(pdf), { recursive: true });
  writeFileSync(pdf, `%PDF-1.7 documento inventato ${name}`);
  const reading = {
    v: 1,
    engineVersion: '0.1.0',
    fileHash: await hashBytes(readFileSync(pdf)),
    fileName: name,
    pages: 1,
    pageRange: [1, 1],
    status: 'riconosciuta',
    profileId: 'prof-inventato',
    profileRev: 1,
    kind,
    documentKind: kind,
    category,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, field(v)])),
    parts: parts.map(([label, amount]) => ({
      label,
      amount,
      source: { page: 1, box: [0, 0, 1, 1], text: 'x' },
    })),
    identifiers: [],
    checks: [],
    warnings: [],
    textSource: 'pdf',
    ocrPages: [],
  };
  const lettura = writeFile(`${name}.json`, JSON.stringify(reading));
  return { pdf, lettura };
}
const BILLS = [
  ['apt-a', 'gas-a.pdf', 'gas', 'Gas-Inventato', '2025-11-01', '2025-12-31', '2026-01-20', 12000],
  [
    'apt-a',
    'luce-a.pdf',
    'elettricita',
    'Luce-Inventata',
    '2026-02-01',
    '2026-03-31',
    '2026-04-15',
    9000,
  ],
  [
    'apt-a',
    'acqua-a.pdf',
    'acqua',
    'Acqua-Inventata',
    '2026-06-01',
    '2026-07-31',
    '2026-09-10',
    4500,
  ],
  ['apt-b', 'gas-b.pdf', 'gas', 'Gas-Inventato', '2025-12-01', '2026-01-31', '2026-02-20', 8000],
];

// --- The XLSX written by excel.mjs, read back (stored zip, inline strings, values only) -------
function readSheets(file) {
  const entries = readZip(new Uint8Array(readFileSync(file)), inflateRaw);
  const text = (path) => new TextDecoder().decode(entries.find((e) => e.path === path)?.data);
  const names = [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(
    (m) => m[1],
  );
  const unescape = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  const sheets = {};
  names.forEach((name, i) => {
    const xml = text(`xl/worksheets/sheet${String(i + 1)}.xml`);
    sheets[unescape(name)] = [...xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((r) =>
      [...r[1].matchAll(/<c r="([A-Z]+)[0-9]+"[^>]*?(?:\/>|>(.*?)<\/c>)/gs)].reduce((cells, c) => {
        const col = [...c[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const body = c[2] ?? '';
        const t = /<t[^>]*>(.*?)<\/t>/s.exec(body);
        const v = /<v>(.*?)<\/v>/s.exec(body);
        cells[col] = t ? unescape(t[1]) : v ? Number(v[1]) : null;
        return cells;
      }, []),
    );
  });
  return sheets;
}
/** Euro in the sheet (a decimal number) as cents. */
const cents = (value) => Math.round(Number(value) * 100);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ciclo-'));
  dir = join(root, 'Condivisa');
  mkdirSync(dir);
});
afterAll(() => {
  if (process.env.E2E_DUMP) {
    writeFileSync(
      process.env.E2E_DUMP,
      JSON.stringify({ notes, steps: steps.map((s) => ({ ...s, out: undefined })) }, null, 1),
    );
  }
  rmSync(root, { recursive: true, force: true });
});

describe.sequential('ciclo completo con la CLI vera', () => {
  it(
    'fase 1: profilo, appartamenti, inquilini, contratti con canone, presenze, subentro, conti',
    async () => {
      shared.initial = liveRecords();
      await run('profilo', [writeFile('profilo.json', JSON.stringify(PROFILE))]);
      for (const [id, name] of [
        ['apt-a', 'Appartamento A'],
        ['apt-b', 'Appartamento B'],
      ]) {
        await run('appartamento', [
          '--id',
          id,
          '--nome',
          name,
          '--locatore',
          'Locatore-Inventato',
          '--posti',
          '2',
          '--annualita',
          '10-01',
          '--esercizio-condominio',
          '10-01',
          '--differenza-condominio',
          'inquilini',
        ]);
      }
      for (const [id, name] of Object.entries(TENANTS)) {
        await run('inquilino', ['--id', id, '--nome', name, '--lingua', 'it']);
      }
      for (const [apt, canone, acconto] of [
        ['apt-a', '700,00', '100,00'],
        ['apt-b', '400,00', '60,00'],
      ]) {
        await run('contratto', [
          '--id',
          `ctr-${apt}`,
          '--appartamento',
          apt,
          '--tipo',
          '1+1',
          '--inizio',
          '2025-10',
          '--fine',
          '2026-09',
          '--conguaglio',
          'annuale',
          '--regime',
          'cedolare',
          '--aliquota-cedolare',
          '21',
        ]);
        await run('contratto-canone', [
          '--contratto',
          `ctr-${apt}`,
          '--dal',
          '2025-10',
          '--canone',
          canone,
          '--acconto',
          acconto,
        ]);
      }
      const tenancy = (id, apt, tenant, rent, forfait, room) =>
        run('presenza', [
          '--id',
          id,
          '--appartamento',
          apt,
          '--inquilino',
          tenant,
          '--dal',
          '2025-10',
          '--affitto',
          rent,
          '--forfait',
          forfait,
          '--caparra-attesa',
          '500,00',
          '--contratto',
          `ctr-${apt}`,
          // No command sets the rooms of an apartment: any --posto is accepted (E19).
          '--posto',
          room,
        ]);
      await tenancy('tcy-uno', 'apt-a', 't-uno', '350,00', '50,00', 'stanza-1');
      await tenancy('tcy-due', 'apt-a', 't-due', '350,00', '50,00', 'stanza-2');
      await tenancy('tcy-quattro', 'apt-b', 't-quattro', '400,00', '60,00', 'stanza-1');
      // A takeover in March: t-due leaves after March, t-tre comes in April.
      clock = '2026-03-25T08:00:00.000Z';
      await run('subentro', [
        '--presenza',
        'tcy-due',
        '--mese',
        '2026-03',
        '--id',
        'tcy-tre',
        '--inquilino',
        't-tre',
        '--affitto',
        '360,00',
        '--forfait',
        '50,00',
        '--caparra-attesa',
        '500,00',
      ]);
      for (const [apt, iban, label] of [
        ['apt-a', IBAN_A, 'Etichetta-conto-A'],
        ['apt-b', IBAN_B, 'Etichetta-conto-B'],
      ]) {
        await step('estratti', 'conto', [
          '--appartamento',
          apt,
          '--profilo',
          'bp-e2e',
          '--etichetta',
          label,
          '--iban',
          iban,
        ]);
      }
      shared.accounts = Object.fromEntries(records('account').map((a) => [a.apartmentId, a.id]));
      expect(Object.keys(shared.accounts).sort()).toEqual(['apt-a', 'apt-b']);
    },
    TIMEOUT,
  );

  it(
    'fase 2: bollette da lettura JSON, TARI condivisa, rata di condominio con documento',
    async () => {
      clock = '2026-04-20T08:00:00.000Z';
      shared.bills = {};
      for (const [apt, name, category, supplier, start, end, due, amount] of BILLS) {
        const folder = apt === 'apt-a' ? 'Appartamento-A' : 'Appartamento-B';
        const { pdf, lettura } = await pdfWithReading(folder, name, {
          kind: 'bill',
          category,
          fields: {
            supplier,
            number: `INV-${name}`,
            issueDate: start.slice(0, 8) + '28',
            dueDate: due,
            periodStart: start,
            periodEnd: end,
            amount,
          },
        });
        const args = ['--appartamento', apt, '--lettura', lettura, '--soglia-consumi', '30'];
        const r = await run('bolletta', [...args, '--conferma', pdf], {
          rerun: false,
          label: `bolletta ${name}`,
        });
        const bill = records('bill').find((b) => r.json.ids.includes(b.id));
        const moved = join(
          dir,
          ...billFileMove({ name: folder.replace('-', ' ') }, bill.filePath).filed.split('/'),
        );
        shared.bills[name] = { id: bill.id, pdf, moved, file: r.json.file };
        undoHow.set(r.json.operationId, { how: 'bolletta', file: moved });
        // The rerun as user1 would type it: the same line (the PDF is gone) and on the new place.
        await step('estratti', 'bolletta', [...args, '--conferma', pdf], {
          rerun: false,
          label: `bolletta ${name} (di nuovo, stesso percorso)`,
        });
        await step('estratti', 'bolletta', [...args, '--conferma', moved], {
          rerun: false,
          label: `bolletta ${name} (di nuovo, nuovo percorso)`,
        });
      }

      // The supplies of the shared TARI: no command of the CLI writes them (finding), so the
      // core function the desktop app uses, `linkSupply`.
      const store = new FsStore(dir);
      for (const [label, apt] of [
        ['UTENZA-A', 'apt-a'],
        ['UTENZA-B', 'apt-b'],
      ]) {
        await linkSupply(
          store,
          { label, rows: [{ apartmentId: apt, basisPoints: 10000 }], note: '' },
          'cli',
          () => clock,
          newId,
        );
      }
      notes.push('supply: linkSupply del core, nessun comando CLI');
      // The TARI notice of January–April 2026 shared by A and B (spec R3 example: 186,00 split
      // as 101,04 / 84,96 by the supplies 100,75 / 84,71).
      const tari = await pdfWithReading('Appartamento-A', 'tari-2026-1.pdf', {
        kind: 'tari',
        category: null,
        fields: {
          supplier: 'Comune-Inventato',
          number: '2026/1/00001',
          issueDate: '2026-02-15',
          dueDate: '2026-03-16',
          periodStart: '2026-01-01',
          periodEnd: '2026-04-30',
          amount: 18600,
        },
        parts: [
          ['UTENZA-A', 10075],
          ['UTENZA-B', 8471],
        ],
      });
      const t = await step(
        'estratti',
        'bolletta',
        [
          '--appartamento',
          'apt-a',
          '--lettura',
          tari.lettura,
          '--soglia-consumi',
          '30',
          '--conferma',
          tari.pdf,
        ],
        { label: 'bolletta tari' },
      );
      shared.tari = t;
      if (t.code === 0) {
        const inst = records('instalment').filter((i) => t.json.ids.includes(i.id));
        const filed = billFileMove(
          { name: 'Appartamento A' },
          inst[0].fileDocument?.filePath ?? '',
        );
        shared.tariFile = t.json.file === 'moved' ? join(dir, ...filed.filed.split('/')) : tari.pdf;
        undoHow.set(t.json.operationId, { how: 'bolletta', file: shared.tariFile });
      }

      // The condominium instalment: no command writes one (finding); seeded with its own operation
      // as the R3 example: rata 150,00 with 18,00 a year of owner share (6,00 a rata of 3), plus a
      // previous settlement of 48,00: debit 198,00.
      const instalment = recordSchemas.instalment.parse({
        id: 'inst-condo-a-1',
        v: 1,
        rev: 1,
        apartmentId: 'apt-a',
        kind: 'condominio',
        esercizio: '2025-26',
        rateIndex: 1,
        rateCount: 3,
        dueDate: '2025-10-10',
        rata: 15000,
        quotaProprieta: 1800,
        conguaglioPrec: 4800,
        coversFrom: '2025-10',
        coversTo: '2026-01',
      });
      await commitChange(
        store,
        {
          profileId: 'cli',
          kind: 'test.seed',
          summary: 'Rata del condominio inventata',
          changes: [{ path: recordPath('instalment', instalment.id), after: instalment }],
        },
        () => clock,
        newId,
      );
      notes.push('instalment condominio: commitChange di prova, nessun comando CLI');
      await run('condominio-documento', [
        '--appartamento',
        'apt-a',
        '--esercizio',
        '2025-26',
        '--tipo',
        'preventivo',
        '--totale',
        '450,00',
      ]);
    },
    TIMEOUT,
  );

  it(
    'fase 3: IMU attesa, importazione degli estratti, riga tenuta da parte',
    async () => {
      clock = '2026-10-05T08:00:00.000Z';
      for (const [apt, amount] of [
        ['apt-a', '600,00'],
        ['apt-b', '400,00'],
      ]) {
        await run('imu-atteso', [
          '--appartamento',
          apt,
          '--anno',
          '2026',
          '--gruppo',
          'gruppo-ab',
          '--rata',
          `1:${amount}:2026-06-16`,
          '--rata',
          `2:${amount}:2026-12-16`,
        ]);
      }
      shared.statements = {};
      for (const [apt, rows] of [
        ['apt-a', rowsA],
        ['apt-b', rowsB],
      ]) {
        const file = writeFile(`estratto-${apt}.csv`, csv(rows));
        const r = await run(
          'importa',
          ['--conto', shared.accounts[apt], '--dal', '2025-10-01', '--al', '2026-09-30', file],
          { label: `importa ${apt}` },
        );
        shared.statements[apt] = r.json;
      }
      // The pending incoming row of A (Prenotato) is excluded.
      const held = shared.statements['apt-a'].heldRows;
      expect(held).toHaveLength(1);
      await run('decidi', [
        '--estratto',
        shared.statements['apt-a'].statementId,
        '--riga',
        String(held[0]),
        '--escludi',
      ]);
      // The plain reconciliation as a dry run: proposals, arrears and outgoing without --dettagli.
      shared.dry = await run('riconcilia', ['--prova'], { label: 'riconcilia --prova' });
    },
    TIMEOUT,
  );

  it(
    'fase 4: riconciliazione di incassi, caparre, bollette, uscite, giroconto, F24, esclusioni',
    async () => {
      const first = await run('riconcilia', ['--dettagli'], {
        rerun: false,
        label: 'riconcilia 1',
      });
      shared.r1 = first.json;
      const proposalOf = (text) =>
        first.json.proposals
          .filter((p) => p.description.includes(text))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
      // The first movement of each payer, confirmed by hand: the caparre and Sempronio's first rent.
      for (const [text, tenant, part] of [
        ['Tizio Fittizio, caparra', 't-uno', 'caparra:2025-10:500,00'],
        ['Caio Inventato, caparra', 't-due', 'caparra:2025-10:500,00'],
        ['Mevia Esempio, caparra', 't-quattro', 'caparra:2025-10:500,00'],
        ['Sempronio Prova', 't-tre', 'canone:2026-04:410,00'],
      ]) {
        const p = proposalOf(text);
        await run('conferma', ['--proposta', p.id, '--inquilino', tenant, '--parte', part], {
          label: `conferma ${tenant}`,
        });
        if (tenant === 't-quattro') {
          // The next proposal of the same payer in the same listing, as user1 would go down it.
          const next = first.json.proposals
            .filter((x) => x.description.includes('Mevia Esempio, affitto'))
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          shared.nextOfList = await step(
            'estratti',
            'conferma',
            [
              '--proposta',
              next.id,
              '--inquilino',
              't-quattro',
              '--parte',
              `canone:${next.date.slice(0, 7)}:460,00`,
            ],
            { rerun: false, label: 'conferma seconda della stessa lista' },
          );
        }
      }
      // What is still proposed is confirmed by hand, one at a time: a confirmation changes the
      // other proposals, so `riconcilia` runs again after each one (finding).
      let second;
      shared.handConfirmations = 0;
      for (let round = 0; round < 60; round += 1) {
        second = await run('riconcilia', ['--dettagli'], {
          rerun: false,
          label: `riconcilia 2.${String(round)}`,
        });
        const [p] = second.json.proposals;
        if (p === undefined) break;
        const tenant = Object.entries(TENANTS).find(([, n]) => p.description.includes(n))?.[0];
        shared.handConfirmations += 1;
        await run(
          'conferma',
          [
            '--proposta',
            p.id,
            '--inquilino',
            tenant,
            '--parte',
            `canone:${p.date.slice(0, 7)}:${eu(p.amount)}`,
          ],
          { rerun: false, label: `conferma resto ${p.date} ${p.step} ${p.reason}` },
        );
      }
      shared.r2 = second.json;
      // The outgoing movements the reconciliation still proposes.
      const out = second.json.outgoing.proposals;
      const byText = (text) => out.find((p) => p.description.includes(text));
      shared.outgoingLeft = out.map((p) => p.description);
      const ferr = byText('Ferramenta');
      await run('uscita', [
        '--proposta',
        ferr.id,
        '--categoria',
        'altro',
        '--appartamento',
        'apt-a',
      ]);
      // The giroconto between the two accounts.
      const giro = second.json.transfers.proposals[0];
      await run('giroconto', [
        '--proposta',
        giro.id,
        '--scopo',
        'saldo',
        '--gambe',
        giro.legIds.join(','),
      ]);
      // A transfer with no movement (cash handed over), typed by hand: A gives 50,00 to B.
      shared.giroManuale = await run('giroconto-manuale', [
        '--da',
        shared.accounts['apt-a'],
        '--a',
        shared.accounts['apt-b'],
        '--importo',
        '50,00',
        '--data',
        '2026-08-01',
        '--scopo',
        'saldo',
      ]);
      // The F24 of June: IMU rate 1 of both apartments.
      const f24 = out.find((p) => p.step === 'f24');
      shared.f24 = f24;
      await run('imu-f24', [
        '--movimento',
        f24.transactionId,
        '--gruppo',
        'gruppo-ab',
        '--anno',
        '2026',
        '--rata',
        '1',
      ]);
      // The private withdrawal: excluded (no reason fits a private movement: «non-reale»).
      await run('escludi', [
        '--movimento',
        tx('apt-a', '2026-07-01', 'Prelievo'),
        '--motivo',
        'non-reale',
      ]);
      const third = await step('estratti', 'riconcilia', ['--dettagli'], {
        label: 'riconcilia 3',
      });
      shared.r3 = third;
      shared.plan = await planMatch(new FsStore(dir));
    },
    TIMEOUT,
  );

  it(
    'fase 5: TARI condivisa abbinata in automatico dalla riconciliazione',
    async () => {
      const tari = records('instalment').filter((i) => i.kind === 'tari');
      shared.tariInstalments = tari;
      const debit = tx('apt-a', '2026-03-16', 'TARI');
      // E1: the notice filed for A is paid from A's account, so the group matches one debit.
      shared.tariMatches = records('match')
        .filter((m) => m.transactionId === debit && tari.some((i) => i.id === m.itemId))
        .map((m) => [tari.find((i) => i.id === m.itemId).apartmentId, m.amount, m.confirmed])
        .sort();
      shared.tariInvalid = shared.plan.run.invalidGroups;
    },
    TIMEOUT,
  );

  it(
    'fase 6: recuperi (positivo e negativo), scadenze manuali, tasse',
    async () => {
      const ferr = tx('apt-a', '2026-05-12', 'Ferramenta');
      await run('recupero', [
        '--id',
        'rec-ferramenta',
        '--appartamento',
        'apt-a',
        '--movimento',
        ferr,
        '--importo',
        '20,00',
        '--inquilini',
        't-uno,t-tre',
      ]);
      const negative = (amount) => [
        '--id',
        'rec-negativo',
        '--appartamento',
        'apt-a',
        ...amount,
        '--inquilini',
        't-uno',
        '--data',
        '2026-02-10',
      ];
      // As the usage of every other amount suggests (E12): saved; the `=` form is then unchanged.
      shared.negativeSpaced = await step(
        'estratti',
        'recupero',
        negative(['--importo', '-15,00']),
        {
          rerun: false,
          label: 'recupero negativo (--importo -15,00)',
        },
      );
      await run('recupero', negative(['--importo=-15,00']), { label: 'recupero negativo' });
      await run('condominio', ['--appartamento', 'apt-a'], { label: 'condominio' });
      await step('estratti', 'condominio', ['--appartamento', 'apt-a', '--dettagli'], {
        rerun: false,
        label: 'condominio dettagli',
      });
      // Manual payables with a reference year.
      shared.scadId = await step(
        'estratti',
        'scadenza-nuova',
        [
          '--id',
          'scad-cedolare-a',
          '--appartamento',
          'apt-a',
          '--tipo',
          'cedolare',
          '--scadenza',
          '2026-06-30',
          '--importo',
          '300,00',
          '--anno-riferimento',
          '2026',
        ],
        { rerun: false, label: 'scadenza-nuova con --id nuovo' },
      );
      const cedolare = await run(
        'scadenza-nuova',
        [
          '--appartamento',
          'apt-a',
          '--tipo',
          'cedolare',
          '--scadenza',
          '2026-06-30',
          '--importo',
          '300,00',
          '--anno-riferimento',
          '2026',
        ],
        { rerun: false, label: 'scadenza-nuova cedolare' },
      );
      shared.cedolare = cedolare;
      shared.noId = await step(
        'estratti',
        'scadenza-nuova',
        [
          '--appartamento',
          'apt-b',
          '--tipo',
          'registro',
          '--scadenza',
          '2026-10-30',
          '--importo',
          '67,00',
          '--anno-riferimento',
          '2026',
        ],
        { label: 'scadenza-nuova senza --id' },
      );
      await run('scadenza-pagata', ['--id', cedolare.json.payableId, '--data', '2026-06-30']);
      for (const [apt, voce, amount] of [
        ['apt-a', 'imu', '1200,00'],
        ['apt-b', 'imu', '800,00'],
        ['apt-a', 'cedolare', '300,00'],
      ]) {
        await run('tasse-stima', [
          '--appartamento',
          apt,
          '--anno',
          '2026',
          '--voce',
          voce,
          '--importo',
          amount,
        ]);
      }
      shared.scadenze = await run('scadenze', ['--oggi', '2026-10-05', '--dettagli'], {
        label: 'scadenze dettagli',
      });
      await run('scadenze', ['--oggi', '2026-10-05'], { label: 'scadenze' });
      shared.imu = await run('imu', ['--anno', '2026', '--dettagli'], { label: 'imu dettagli' });
      await run('imu', ['--anno', '2026'], { label: 'imu' });
      shared.tasse = await run('tasse', ['--anno', '2026', '--oggi', '2026-10-05', '--dettagli'], {
        label: 'tasse dettagli',
      });
      await run('tasse', ['--anno', '2026', '--oggi', '2026-10-05'], { label: 'tasse' });
      shared.saldi = await run('saldi', ['--dettagli'], { label: 'saldi dettagli' });
      await run('saldi', [], { label: 'saldi' });
    },
    TIMEOUT,
  );

  it(
    'fase 7: fine presenza, tasso legale, prospetto caparra, restituzione della caparra',
    async () => {
      await run('fine-presenza', ['--presenza', 'tcy-quattro', '--mese', '2026-06']);
      for (const [year, rate] of [
        ['2025', '2'],
        ['2026', '1,6'],
      ]) {
        await run('tasso-legale', ['--anno', year, '--tasso', rate]);
      }
      shared.caparraB = await step(
        'estratti',
        'caparra-restituzione',
        ['--appartamento', 'apt-b', '--inquilino', 't-quattro', '--dettagli'],
        { label: 'caparra-restituzione t-quattro' },
      );
      shared.caparraA = await step(
        'estratti',
        'caparra-restituzione',
        ['--appartamento', 'apt-a', '--inquilino', 't-due', '--dettagli'],
        { label: 'caparra-restituzione t-due' },
      );
      await step(
        'estratti',
        'caparra-restituzione',
        ['--appartamento', 'apt-a', '--inquilino', 't-due'],
        {
          label: 'caparra-restituzione t-due senza dettagli',
        },
      );
      const refund = shared.r3.json.outgoing.proposals.find((p) => p.description.includes('Caio'));
      await run('uscita-inquilino', [
        '--proposta',
        refund.id,
        '--inquilino',
        't-due',
        '--tipo',
        'caparra',
        '--mese',
        '2026-04',
      ]);
      shared.statoContratti = await run('stato-contratti', ['--dettagli'], {
        label: 'stato-contratti dettagli',
      });
      await run('stato-contratti', [], { label: 'stato-contratti' });
      await run('contratti', [], { label: 'contratti' });
      shared.r4 = await step('estratti', 'riconcilia', [], { label: 'riconcilia 4' });
    },
    TIMEOUT,
  );

  it(
    'fase 8: conguaglio ed Excel (inquilini e proprietari), tasse, cruscotto, modulo Word',
    async () => {
      clock = '2026-10-20T08:00:00.000Z';
      shared.excel = {};
      for (const apt of ['apt-a', 'apt-b']) {
        shared.excel[apt] = await step(
          'excel',
          'excel',
          ['--appartamento', apt, '--periodo', '2025-26'],
          { label: `excel ${apt}` },
        );
        shared.excel[`${apt}-owners`] = await step(
          'excel',
          'excel',
          ['--appartamento', apt, '--periodo', '2025-26', '--proprietari'],
          { label: `excel proprietari ${apt}` },
        );
      }
      shared.excelTax = await step('excel', 'excel', ['--tasse', '2026'], { label: 'excel tasse' });
      shared.cruscotto = await run('cruscotto', ['--oggi', '2026-10-20', '--dettagli'], {
        label: 'cruscotto dettagli',
      });
      await run('cruscotto', ['--oggi', '2026-10-20'], { label: 'cruscotto' });
      shared.cruscottoPeriodo = await run(
        'cruscotto',
        [
          '--oggi',
          '2026-10-20',
          '--periodo-conguaglio',
          'apt-a:2025-26',
          '--periodo-conguaglio',
          'apt-b:2025-26',
          '--dettagli',
        ],
        { label: 'cruscotto periodo dettagli' },
      );
      const template = join(root, 'modello-promessa.docx');
      await ok('moduli', 'moduli', ['--vuoto', '--tipo', 'promessa', '--uscita', template], {
        label: 'moduli vuoto',
      });
      shared.template = template;
      // The reserved card of t-uno (never echoed), then the values the template still asks for.
      const card = writeFile(
        'scheda.json',
        JSON.stringify({
          codice_fiscale: 'XXXINVENTATO',
          documento_numero: 'DOC-INVENTATO-1',
          documento_ente: 'Comune-Inventato',
          documento_rilascio: '2020-01-01',
          documento_scadenza: '2030-01-01',
        }),
      );
      await run('scheda-inquilino', ['--inquilino', 't-uno', '--valori', card]);
      const values = writeFile(
        'valori.json',
        JSON.stringify({
          codice_registrazione: 'REG-INVENTATO',
          dati_catastali: 'Foglio 0 particella 0',
          decorrenza: '2025-10-01',
          durata_contratto_mesi: '12',
          firma_entro: '2025-09-20',
          firmato_il: '2025-09-15',
          indirizzo: 'Via Inventata 1',
          inquilino_uscente: 'nessuno',
          registrato_il: '2025-09-30',
          scadenza_versamento: '2025-09-25',
          tipo_promessa: 'nuovo',
          uscita_prevista: '2026-09-30',
        }),
      );
      shared.modulo = await step(
        'moduli',
        'moduli',
        [
          '--cartella',
          dir,
          '--tipo',
          'promessa',
          '--presenza',
          'tcy-uno',
          '--modello',
          template,
          '--valori',
          values,
          '--oggi',
          '2026-10-20',
        ],
        { label: 'moduli promessa' },
      );
      // The written files, read back.
      const input = async (apt) =>
        (await loadExcelInput(new FsStore(dir), { apartmentId: apt, periodLabel: '2025-26' }))
          .input;
      shared.input = { 'apt-a': await input('apt-a'), 'apt-b': await input('apt-b') };
      shared.calc = {
        'apt-a': calcConguaglio(shared.input['apt-a']),
        'apt-b': calcConguaglio(shared.input['apt-b']),
      };
      const xlsx = (folder, owners) =>
        join(
          dir,
          folder,
          '2025-26',
          'Excel',
          `${owners ? 'Proprietari' : 'Conguaglio'}_${folder}_2025-26.xlsx`,
        );
      shared.files = {};
      for (const folder of ['Appartamento-A', 'Appartamento-B']) {
        const found = [];
        const walk = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) walk(join(d, e.name));
            else if (e.name.endsWith('.xlsx') || e.name.endsWith('.docx'))
              found.push(join(d, e.name));
          }
        };
        walk(join(dir, folder));
        shared.files[folder] = found.map((f) => f.slice(dir.length));
      }
      shared.sheets = {};
      for (const folder of ['Appartamento-A', 'Appartamento-B']) {
        const file = xlsx(folder, false);
        if (existsSync(file)) shared.sheets[folder] = readSheets(file);
      }
      shared.matches = records('match');
      notes.push({ files: shared.files, sheets: shared.sheets, calc: shared.calc });
    },
    TIMEOUT,
  );

  it(
    'fase 9: annulla tutto in ordine inverso, fin dove i comandi lo permettono',
    async () => {
      clock = '2026-11-18T08:00:00.000Z';
      shared.beforeUndo = liveRecords();
      const store = new FsStore(dir);
      const { operations } = await readJournal(store);
      const undone = new Set(operations.filter((o) => o.kind === 'undo').map((o) => o.undoes));
      shared.undo = [];
      for (const op of [...operations].reverse()) {
        if (op.kind === 'undo' || undone.has(op.id)) continue;
        let r = await step('estratti', 'annulla-riconciliazione', ['--operazione', op.id], {
          label: `annulla ${op.kind}`,
        });
        if (r.code !== 0 && r.json.reason === 'not-reconcile-operation') {
          if (op.kind === 'statement.import') {
            const path = op.changes.find((c) => c.path.includes('/statement/')).path;
            const id = path
              .split('/')
              .pop()
              .replace(/\.json$/, '');
            r = await step('estratti', 'annulla', ['--estratto', id], {
              label: `annulla estratto`,
            });
          } else if (undoHow.has(op.id)) {
            r = await step('estratti', 'annulla-bolletta', [undoHow.get(op.id).file], {
              label: `annulla-bolletta`,
            });
          }
        }
        shared.undo.push({ kind: op.kind, id: op.id, code: r.code, reason: r.json.reason });
      }
      shared.afterUndo = liveRecords();
      notes.push({ undo: shared.undo, afterUndo: shared.afterUndo });
    },
    TIMEOUT,
  );
});

// --- Cross-checks over the recorded lifecycle (read only) ------------------------------------

describe.sequential('ciclo completo: verifiche incrociate', () => {
  it('nessun record pendente (checkConsistency) dopo ogni passo e alla fine', async () => {
    expect(steps.length).toBeGreaterThan(100);
    expect(steps.filter((s) => s.problems > 0).map((s) => s.label)).toEqual([]);
    expect(await checkConsistency(new FsStore(dir))).toEqual([]);
  });

  it('nessun crash (codice 3) in tutto il ciclo', () => {
    expect(steps.filter((s) => s.code === 3 || s.rerun?.code === 3).map((s) => s.label)).toEqual(
      [],
    );
  });

  // E2, E3, E8, E9, E10: a rerun of the same line writes nothing.
  it('rilancio di ogni comando = nessuna scrittura (E2, E3, E8)', () => {
    expect(steps.filter((s) => s.rerun?.wrote).map((s) => s.label)).toEqual([]);
  });

  it('nessun dato personale (nomi, importi, IBAN) in stdout senza --dettagli', () => {
    const text = publicOut.join('');
    for (const secret of SECRETS) expect([secret, text.includes(secret)]).toEqual([secret, false]);
    expect(text).not.toMatch(AMOUNTS);
    expect(text).not.toMatch(/[0-9],[0-9]{2}/);
    expect(scanText(text)).toEqual([]);
    // --dettagli does show them (the bucket is not empty and holds a name).
    expect(detailOut.join('')).toContain('Tizio Fittizio');
  });

  it('riconcilia --prova non scrive; la proposta seguente della lista dice di rilanciare riconcilia (E7)', () => {
    expect([shared.dry.wrote, shared.dry.rerun.wrote]).toEqual([false, false]);
    expect(shared.dry.json.proposals.length).toBeGreaterThan(30);
    expect([shared.nextOfList.code, shared.nextOfList.json.reason]).toEqual([1, 'stale-proposal']);
    expect(shared.nextOfList.json.message).toContain('rilanciare riconcilia');
  });

  it('E14: la stessa bolletta rilanciata, dal vecchio o dal nuovo percorso, è «già registrata»', () => {
    const again = steps.filter(
      (s) => s.label.startsWith('bolletta ') && s.label.includes('di nuovo'),
    );
    expect(again).toHaveLength(8);
    expect([...new Set(again.map((s) => `${String(s.code)} ${String(s.json.reason)}`))]).toEqual([
      '1 duplicate-bill',
    ]);
  });

  it('E12: un importo negativo scritto `--importo -15,00` è accettato, come `--importo=-15,00`', () => {
    expect([shared.negativeSpaced.code, shared.negativeSpaced.json.status]).toEqual([0, 'saved']);
  });

  it('E1: l’avviso TARI comune si abbina da solo 101,04 / 84,96 (§42 R3)', () => {
    expect(shared.tariInvalid).toEqual([]);
    expect(shared.tariMatches).toEqual([
      ['apt-a', 10104, true],
      ['apt-b', 8496, true],
    ]);
  });

  it('cruscotto del periodo = conguaglio: voci in attesa e posti vuoti', () => {
    const rows = Object.fromEntries(
      shared.cruscottoPeriodo.json.settlements.map((r) => [r.apartmentId, r]),
    );
    for (const apt of ['apt-a', 'apt-b']) {
      expect([apt, rows[apt].pending, rows[apt].unassigned]).toEqual([
        apt,
        shared.calc[apt].pending.length,
        shared.calc[apt].unassigned,
      ]);
    }
  });

  it('Excel: il posto della presenza, anche quello ereditato dal subentro', () => {
    const rows = shared.sheets['Appartamento-A'].Conguagli;
    const posto = (name) => rows.find((r) => r[1] === name)[0];
    expect([posto('Tizio Fittizio'), posto('Caio Inventato'), posto('Sempronio Prova')]).toEqual([
      'stanza-1',
      'stanza-2',
      'stanza-2',
    ]);
  });

  it('incassi: 4 conferme a mano poi tutto automatico; nessun arretrato a fine ciclo', () => {
    expect(shared.handConfirmations).toBe(0);
    const payments = shared.input['apt-a'].payments.filter((p) => p.deleted !== true);
    const rent = (t) => payments.filter((p) => p.tenantId === t && p.kind === 'canone');
    expect([rent('t-uno').length, rent('t-due').length, rent('t-tre').length]).toEqual([12, 6, 6]);
    expect(payments.filter((p) => p.kind === 'caparra').map((p) => [p.tenantId, p.amount])).toEqual(
      expect.arrayContaining([
        ['t-uno', 50000],
        ['t-due', 50000],
      ]),
    );
    expect(shared.r4.json.arrears).toEqual([]);
    expect(shared.r4.json.proposals).toEqual([]);
  });

  /** The settlement of A as calcConguaglio, the Excel cells and the hand oracle. */
  const conguagliA = () => {
    const rows = shared.sheets['Appartamento-A'].Conguagli;
    const ofTenant = (name) => rows.find((r) => r[1] === name);
    return Object.fromEntries(
      Object.entries(TENANTS)
        .filter(([id]) => id !== 't-quattro')
        .map(([id, name]) => {
          const c = shared.calc['apt-a'].tenants.find((t) => t.tenantId === id);
          const x = ofTenant(name);
          return [
            id,
            {
              calc: {
                spese: c.spese + c.commissione + (c.recupero ?? 0),
                condominio: c.condominio.rata + c.condominio.conguaglioPrec,
                forfait: c.forfaitIncassato,
                due: c.due,
              },
              excel: {
                spese: cents(x[4]),
                condominio: cents(x[5]),
                forfait: cents(x[6]),
                due: cents(x[7]),
              },
            },
          ];
        }),
    );
  };

  it('conguaglio = Excel degli inquilini = somme dei movimenti abbinati, TARI compresa', () => {
    const t = conguagliA();
    for (const id of Object.keys(t)) expect([id, t[id].excel]).toEqual([id, t[id].calc]);
    // Hand oracle (spec §42 R1, R3, R4, R7; posti 2, always two tenants). The TARI share of A,
    // 101,04 over January–April, is 12,63 a tenant and month.
    expect(Object.fromEntries(Object.entries(t).map(([id, v]) => [id, v.calc]))).toEqual({
      't-uno': {
        spese: 10500 + 40 + 1000 - 1500 + 5052,
        condominio: 7200 + 2400,
        forfait: 60000,
        due: -40360 + 5052,
      },
      't-due': {
        spese: 10500 + 40 + 3789,
        condominio: 7200 + 1200,
        forfait: 30000,
        due: -11060 + 3789,
      },
      't-tre': { spese: 1000 + 1263, condominio: 1200, forfait: 30000, due: -27800 + 1263 },
    });
    // The matched debits of A (gas, luce + commission, condominio, TARI share) less the owner share of the rata
    // (18,00 a year / 3) are exactly what the tenants carry, and the «Quota nel periodo» total.
    const items = new Set([
      ...shared.input['apt-a'].bills.map((b) => b.id),
      ...shared.input['apt-a'].instalments.map((i) => i.id),
    ]);
    const matched = shared.matches
      .filter((m) => items.has(m.itemId) && m.confirmed !== false)
      .reduce((sum, m) => sum + m.amount, 0);
    expect(matched).toBe(12000 + 9000 + 80 + 19800 + 10104);
    const carried = shared.calc['apt-a'].tenants.reduce(
      (sum, c) => sum + c.spese + c.commissione + c.condominio.rata + c.condominio.conguaglioPrec,
      shared.calc['apt-a'].unassigned,
    );
    expect(carried).toBe(matched - 600);
    const total = shared.sheets['Appartamento-A'].Bollette.find((r) => r[0] === 'Totale');
    expect(cents(total[9])).toBe(matched - 600);
    const totals = shared.sheets['Appartamento-A'].Conguagli.find((r) => r[0] === 'Totale');
    expect([cents(totals[4]) + cents(totals[5])]).toEqual([carried + 1000 + 1000 - 1500]);
    // B: one tenant on two beds, the empty bed to the owners; TARI 84,96 = 10,62 a bed and month.
    expect(shared.calc['apt-b'].tenants[0]).toMatchObject({
      spese: 4000 + 4248,
      forfaitIncassato: 54000,
      due: -50000 + 4248,
    });
    expect(shared.calc['apt-b'].unassigned).toBe(4000 + 4248);
  });

  it('saldi: F24, giroconto, un solo giroconto a mano e lo storno della TARI comune (E1, E2)', () => {
    const [pair] = shared.saldi.json.pairs;
    expect([pair.creditorApartmentId, pair.debtorApartmentId]).toEqual(['apt-a', 'apt-b']);
    // B's IMU share of the F24 paid by A (400,00 of 1.000,00) + 300,00 sent by A to B + 50,00 by
    // hand + B's share of the shared TARI paid by A (84,96).
    expect(pair.amount).toBe(40000 + 30000 + 5000 + 8496);
  });

  it('tabella tasse coerente con le stime, le scadenze e il F24', () => {
    const rows = Object.fromEntries(shared.tasse.json.tables[0].rows.map((r) => [r.voce, r]));
    const imuRates = shared.imu.json.rates;
    expect(rows.imu).toMatchObject({
      state: 'in-linea',
      estimate: 120000 + 80000,
      paid: imuRates.find((r) => r.rateIndex === 1).paid,
      expected: imuRates.find((r) => r.rateIndex === 2).expected,
    });
    expect(imuRates[0]).toMatchObject({
      status: 'pagata',
      paid: 100000,
      transactionId: shared.f24.transactionId,
    });
    const cedolare = shared.scadenze.json.items.find((i) => i.kind === 'cedolare');
    expect(rows.cedolare.paid).toBe(cedolare.expected);
  });

  it('tasse: il registro atteso è quello di una scadenza, non del suo doppione (E3)', () => {
    const rows = Object.fromEntries(shared.tasse.json.tables[0].rows.map((r) => [r.voce, r]));
    expect(rows.registro.expected).toBe(6700);
  });

  it('tasse e scadenze: la TARI pagata con l’addebito comune non è «in ritardo» (E1)', () => {
    const rows = Object.fromEntries(shared.tasse.json.tables[0].rows.map((r) => [r.voce, r]));
    expect(rows.tari.paid).toBe(18600);
    expect(shared.scadenze.json.items.filter((i) => i.kind === 'tari').map((i) => i.state)).toEqual(
      ['pagata', 'pagata'],
    );
  });

  it('prospetti delle caparre: interessi al tasso legale e conguaglio del periodo', () => {
    // 3 months of 2025 at 2% and 3 (t-due) or 6 (t-quattro) of 2026 at 1,6% on 500,00.
    expect(shared.caparraA.json.statement.lines).toEqual([
      { label: 'Caparra', amount: 50000 },
      { label: 'Interessi legali', amount: 450 },
      { label: 'Conguaglio bollette', amount: 11060 - 3789 },
    ]);
    expect(shared.caparraB.json.statement.total).toBe(50000 + 650 + 50000 - 4248);
  });

  it('modulo Word scritto nella cartella dell’inquilino con i valori della scheda', () => {
    expect(shared.modulo.code).toBe(0);
    const file = join(
      dir,
      'Appartamento-A',
      'Contratti',
      'Tizio-Fittizio',
      '2026-10-20_promessa.docx',
    );
    const body = readZip(new Uint8Array(readFileSync(file)), inflateRaw).find(
      (e) => e.path === 'word/document.xml',
    );
    const text = new TextDecoder().decode(body.data);
    expect(text).toContain('Tizio Fittizio');
    expect(text).toContain('XXXINVENTATO');
  });

  it('dopo gli annulli restano solo i record che nessun comando annulla (E11, E4, E5)', () => {
    const failed = shared.undo.filter((u) => u.code !== 0).map((u) => u.kind);
    expect([...new Set(failed)].sort()).toEqual([
      'account.save',
      'bank-profile.save',
      'statement.resolve',
      'supply.link',
      'tenant.save',
      'test.seed',
    ]);
    expect(shared.initial).toEqual([]);
    expect(shared.afterUndo.map((r) => r.split('/')[0])).toEqual([
      'account',
      'account',
      'bankProfile',
      'instalment',
      'supply',
      'supply',
      'tenant',
      'tenant',
      'tenant',
      'tenant',
    ]);
    // The PDFs are back in Da_smistare, under the name the registration gave them (E13).
    const inbox = (folder) => readdirSync(join(dir, folder, 'Da_smistare')).sort();
    expect(inbox('Appartamento-A')).toEqual([
      '2025-11-28_Gas_Gas-Inventato_20251101-20251231.pdf',
      '2026-02-28_Elettricita_Luce-Inventata_20260201-20260331.pdf',
      '2026-06-28_Acqua_Acqua-Inventata_20260601-20260731.pdf',
      'tari-2026-1.pdf',
    ]);
    expect(inbox('Appartamento-B')).toEqual(['2025-12-28_Gas_Gas-Inventato_20251201-20260131.pdf']);
  });

  it.fails('stato finale dopo gli annulli = stato iniziale (E11)', () => {
    expect(shared.afterUndo).toEqual(shared.initial);
  });
});

// --- Probes outside the lifecycle: one small folder each --------------------------------------
describe('sonde fuori dal ciclo', () => {
  async function probeFolder() {
    const probe = mkdtempSync(join(tmpdir(), 'sonda-'));
    let k = 0;
    const io = { now: () => '2026-11-18T08:00:00.000Z', newId: () => `s-${String((k += 1))}` };
    const cli = async (name, ...args) => {
      const r = await estratti([name, '--cartella', probe, ...args], io);
      return { code: r.code, json: JSON.parse(r.output) };
    };
    writeFileSync(join(probe, 'p.json'), JSON.stringify(PROFILE));
    await cli('profilo', join(probe, 'p.json'));
    return { probe, cli };
  }

  it('conto senza IBAN rilanciato: lo stesso conto, unchanged (E9)', async () => {
    const { probe, cli } = await probeFolder();
    const apt = ['--id', 'x', '--nome', 'X', '--locatore', 'L', '--posti', '2'];
    await cli(
      'appartamento',
      ...apt,
      '--annualita',
      '10-01',
      '--differenza-condominio',
      'inquilini',
    );
    const conto = ['--appartamento', 'x', '--profilo', 'bp-e2e', '--etichetta', 'E'];
    const first = await cli('conto', ...conto);
    const second = await cli('conto', ...conto);
    expect([first.code, second.code]).toEqual([0, 0]);
    expect([second.json.status, second.json.id]).toEqual(['unchanged', first.json.id]);
    rmSync(probe, { recursive: true, force: true });
  });

  it('E15: una lettura non valida dice quali campi, solo con --dettagli', async () => {
    const { probe, cli } = await probeFolder();
    const pdf = join(probe, 'x.pdf');
    writeFileSync(pdf, '%PDF-1.7 inventato');
    const lettura = join(probe, 'l.json');
    writeFileSync(lettura, JSON.stringify({ v: 1, kind: 'tari', category: 'tari' }));
    const args = ['--appartamento', 'x', '--lettura', lettura, pdf];
    const plain = await cli('bolletta', ...args);
    const detailed = await cli('bolletta', ...args, '--dettagli');
    rmSync(probe, { recursive: true, force: true });
    expect([plain.code, plain.json.reason, plain.json.fields]).toEqual([
      2,
      'bad-reading',
      undefined,
    ]);
    expect(detailed.json.fields).toEqual(expect.arrayContaining(['category', 'fileHash']));
  });

  /** Apartment and contract with the lease year from `day`, then the Excel: the exit codes. */
  async function yearFrom(day) {
    const { probe, cli } = await probeFolder();
    const saved = await cli(
      'appartamento',
      ...['--id', 'x', '--nome', 'X', '--locatore', 'L', '--posti', '2', '--annualita', day],
      ...['--differenza-condominio', 'proprietario'],
    );
    await cli(
      'contratto',
      ...['--id', 'c1', '--appartamento', 'x', '--tipo', '1+1', '--inizio', '2025-10'],
      ...['--fine', '2026-09', '--conguaglio', 'annuale'],
    );
    const r = await excel(['--cartella', probe, '--appartamento', 'x', '--periodo', '2025-26'], {
      newId: () => 'tmp',
      link: linkSync,
    });
    rmSync(probe, { recursive: true, force: true });
    return [saved.code, r.code];
  }
  const yearProbe = {};

  it('annualità dal 1° ottobre: Excel scritto; dal 15 ottobre: rifiutata subito (E6)', async () => {
    yearProbe.first = await yearFrom('10-01');
    yearProbe.fifteenth = await yearFrom('10-15');
    expect(yearProbe.first).toEqual([0, 0]);
    // The apartment is refused (2), so the Excel finds no apartment (1): never a crash (3).
    expect(yearProbe.fifteenth).toEqual([2, 1]);
  });

  it('annualità dal 15 già salvata (dati di prima): Excel rifiuta con un motivo, mai 3 (E6)', async () => {
    const { probe, cli } = await probeFolder();
    await cli(
      'appartamento',
      ...['--id', 'x', '--nome', 'X', '--locatore', 'L', '--posti', '2', '--annualita', '10-01'],
      ...['--differenza-condominio', 'proprietario'],
    );
    await cli(
      'contratto',
      ...['--id', 'c1', '--appartamento', 'x', '--tipo', '1+1', '--inizio', '2025-10'],
      ...['--fine', '2026-09', '--conguaglio', 'annuale'],
    );
    const store = new FsStore(probe);
    const path = recordPath('apartment', 'x');
    const apt = JSON.parse(readFileSync(join(probe, ...path.split('/')), 'utf8'));
    await commitChange(
      store,
      {
        profileId: 'cli',
        kind: 'test.seed',
        summary: 'x',
        changes: [
          {
            path,
            before: apt,
            after: { ...apt, rev: apt.rev + 1, annualitaStart: { month: 10, day: 15 } },
          },
        ],
      },
      () => '2026-11-18T08:00:00.000Z',
      () => 'seed-1',
    );
    const r = await excel(['--cartella', probe, '--appartamento', 'x', '--periodo', '2025-26'], {
      newId: () => 'tmp',
      link: linkSync,
    });
    rmSync(probe, { recursive: true, force: true });
    expect([r.code, JSON.parse(r.output).reason]).toEqual([1, 'bad-periods']);
  });
});
