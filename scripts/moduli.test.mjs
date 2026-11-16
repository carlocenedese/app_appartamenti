import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import { docxPlaceholders, readZip, recordPath, writeRecord } from '../packages/core/src/index.ts';
import { docx, inflateRaw } from '../packages/core/test/helpers/docx.ts';
import { scanText } from './check-personal-data.mjs';
import { main } from './moduli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = join(ROOT, 'scripts', 'moduli.mjs');

// Invented records: no real person, contract or amount.
const base = { v: 1, rev: 1 };
const RECORDS = [
  [
    'apartment',
    {
      ...base,
      id: 'apt-nord',
      name: 'Casa Nord',
      locatore: 'user1',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
    },
  ],
  ['tenant', { ...base, id: 'ten-1', name: 'Anna Prova' }],
  [
    'tenancy',
    {
      ...base,
      id: 'pres-1',
      apartmentId: 'apt-nord',
      tenantId: 'ten-1',
      from: '2026-08',
      monthlyRent: 30000,
      monthlyForfait: 8000,
    },
  ],
];

let root;
let data;
let out;
let template;
let values;
const outputs = [];
let counter = 0;
const io = {
  newId: () => `id${String((counter += 1))}`,
  link: linkSync,
  today: () => '2026-11-16',
};
const run = async (args) => {
  const result = await main(args, io);
  outputs.push(result.output);
  return { code: result.code, json: JSON.parse(result.output) };
};
const generate = (extra = []) =>
  run([
    '--cartella',
    data,
    '--tipo',
    'promessa',
    '--presenza',
    'pres-1',
    '--modello',
    template,
    ...extra,
  ]);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'moduli-'));
  data = join(root, 'dati');
  out = join(root, 'out');
  const store = new FsStore(data);
  for (const [kind, record] of RECORDS) {
    await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
  }
  mkdirSync(out);
  template = join(root, 'modello.docx');
  writeFileSync(template, docx([['{{inquilino}} {{canone_camera}} {{codice_fiscale}}']]));
  values = join(root, 'valori.json');
  writeFileSync(values, JSON.stringify({ codice_fiscale: 'XXXINVENTATO' }));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pnpm moduli', () => {
  it('writes the document in the tenant folder, with counts only on stdout', async () => {
    const result = await generate(['--valori', values]);
    expect(result).toEqual({
      code: 0,
      json: {
        status: 'written',
        kind: 'promessa',
        tenancyId: 'pres-1',
        fields: 3,
        appFields: 2,
        askedFields: 1,
      },
    });
    const file = join(data, 'Casa-Nord', 'Contratti', 'Anna-Prova', '2026-11-16_promessa.docx');
    const body = readZip(new Uint8Array(readFileSync(file)), inflateRaw).find(
      (e) => e.path === 'word/document.xml',
    );
    expect(new TextDecoder().decode(body?.data)).toContain('Anna Prova € 380,00 XXXINVENTATO');
    // Never over an existing file.
    expect(await generate(['--valori', values])).toMatchObject({
      code: 1,
      json: { reason: 'file-exists' },
    });
  });

  it('writes to --uscita with --oggi', async () => {
    const target = join(out, 'promessa.docx');
    expect(
      (await generate(['--valori', values, '--oggi', '2026-12-01', '--uscita', target])).code,
    ).toBe(0);
    expect(existsSync(target)).toBe(true);
  });

  it('refuses missing values with the field names only', async () => {
    expect(await generate(['--uscita', join(out, 'x.docx')])).toMatchObject({
      code: 1,
      json: { status: 'rejected', reason: 'missing-fields', fields: ['codice_fiscale'] },
    });
    expect(existsSync(join(out, 'x.docx'))).toBe(false);
  });

  it('refuses an unknown tenancy and passes the core refusals', async () => {
    expect(
      await run([
        '--cartella',
        data,
        '--tipo',
        'promessa',
        '--presenza',
        'nessuna',
        '--modello',
        template,
      ]),
    ).toMatchObject({ code: 1, json: { reason: 'unknown-tenancy' } });
    const bad = join(root, 'valori-inquilino.json');
    writeFileSync(bad, JSON.stringify({ inquilino: 'Altra Persona' }));
    expect(await generate(['--valori', bad])).toMatchObject({
      code: 1,
      json: { reason: 'field-from-app', fields: ['inquilino'] },
    });
  });

  it('gives 2 for arguments, a values file or a template that are not valid', async () => {
    expect((await run(['--tipo', 'nessuno'])).code).toBe(2);
    expect((await run(['--cartella', data, '--tipo', 'promessa'])).code).toBe(2);
    expect((await generate(['--oggi', '2026-02-30'])).code).toBe(2);
    expect((await generate(['--uscita', join(out, 'x.txt')])).json.reason).toBe('bad-output');
    const notObject = join(root, 'lista.json');
    writeFileSync(notObject, '["a"]');
    expect((await generate(['--valori', notObject])).json.reason).toBe('bad-values');
    const number = join(root, 'numero.json');
    writeFileSync(number, '{"codice_fiscale": 1}');
    expect((await generate(['--valori', number])).json.reason).toBe('bad-values');
    expect(
      (
        await run([
          '--cartella',
          data,
          '--tipo',
          'promessa',
          '--presenza',
          'pres-1',
          '--modello',
          join(root, 'manca.docx'),
        ])
      ).json.reason,
    ).toBe('bad-template-file');
    expect(
      (
        await run([
          '--cartella',
          join(root, 'manca'),
          '--tipo',
          'promessa',
          '--presenza',
          'p',
          '--modello',
          template,
        ])
      ).json.reason,
    ).toBe('bad-folder');
    expect((await run(['--vuoto', '--tipo', 'promessa'])).code).toBe(2);
    expect(
      (
        await run([
          '--vuoto',
          '--tipo',
          'promessa',
          '--cartella',
          data,
          '--uscita',
          join(out, 'v.docx'),
        ])
      ).code,
    ).toBe(2);
  });

  it('writes the starter template with --vuoto, for real through tsx', () => {
    const target = join(out, 'vuoto.docx');
    const real = spawnSync(
      process.execPath,
      [TSX, SCRIPT, '--vuoto', '--tipo', 'restituzione', '--uscita', target],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    outputs.push(real.stdout);
    expect(real.status).toBe(0);
    expect(JSON.parse(real.stdout)).toEqual({ status: 'written', kind: 'restituzione' });
    const fields = docxPlaceholders(new Uint8Array(readFileSync(target)), inflateRaw);
    expect(fields.status === 'ok' && fields.fields).toContain('saldo');
  }, 120_000);

  it('never prints a name, a value or a path', () => {
    const all = outputs.join('');
    for (const secret of ['Anna', 'Prova', 'XXXINVENTATO', '380', root, 'Casa']) {
      expect(all).not.toContain(secret);
    }
    expect(scanText(all)).toEqual([]);
  });
});
