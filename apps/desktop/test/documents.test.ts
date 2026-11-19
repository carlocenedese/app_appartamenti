import { beforeEach, describe, expect, it } from 'vitest';
import { DOCX_LIMITS, crc32, hashBytes, readZip, recordPath, writeRecord } from '@bollette/core';
import fixtureText from '../../../fixtures/excel/anno-esempio.json?raw';
import {
  inflateRawStream,
  writeConguaglioExcel,
  writeModulo,
  writeTaxExcel,
} from '../src/documents';
import { TauriStore } from '../src/tauri-store';
import { MemoryFs } from './helpers/memory-fs';

const ROOT = '/Dropbox/Appartamenti';
// The SHA-256 of what `pnpm excel` and `pnpm moduli` write for the same records (plan 26).
const CONGUAGLIO = '41a4743cbd81e2a82f9f2ddd36e9327f9c1b2c68233e3e4f35b8eb4059f5ae70';
const OWNERS = '4d6a3defadead27fbd27d2f6692644ed1f997e6c5607e44d21bb84da107ba555';
const TAX = '5e188fb9dbbb927fcccdbb78cf8ad180316d0ba0ac4ae5c897c593fbe4f94ce6';
const MODULE = '87139f3bb07240ef18d1b88a3eb72aa4f3d50a76f86e1443f5d2ee84e0ce126b';

type Rec = { id: string; rev: number; [key: string]: unknown };

/**
 * A copy of `fixtureRecords` of `packages/core/test/helpers/excel-fixture.ts` (that file needs
 * `node:fs`): the pins above depend on it, so a change there shows here as a hash mismatch.
 */
function fixtureRecords(): Record<string, Rec[]> {
  const f = JSON.parse(fixtureText) as Record<string, Rec[]>;
  const statement = (id: string, from: string, to: string) => ({
    id,
    v: 1,
    rev: 1,
    accountId: 'acc-nord',
    bankProfileId: 'bp-sintetico',
    fileName: `${id}.xlsx`,
    suggestedPath: `Nord/Estratti/${id}.xlsx`,
    from,
    to,
    periodSource: 'file',
    rowCount: 0,
    transactionIds: [],
    held: [],
  });
  return {
    apartment: f.apartments ?? [],
    contract: f.contracts ?? [],
    tenant: f.tenants ?? [],
    tenancy: f.tenancies ?? [],
    bill: f.bills ?? [],
    instalment: f.instalments ?? [],
    match: f.matches ?? [],
    payment: f.payments ?? [],
    account: [
      {
        id: 'acc-nord',
        v: 1,
        rev: 1,
        apartmentId: 'apt-nord',
        label: 'Conto Nord',
        bankProfileId: 'bp-sintetico',
      },
    ],
    statement: [
      statement('st-1', '2026-10-01', '2026-12-31'),
      statement('st-2', '2027-07-01', '2027-09-30'),
    ],
  };
}

/** The records of `scripts/moduli.test.mjs` for `pres-1`. */
const MODULE_RECORDS: Record<string, Rec[]> = {
  apartment: [
    {
      id: 'apt-nord',
      v: 1,
      rev: 1,
      name: 'Casa Nord',
      locatore: 'user1',
      posti: 2,
      annualitaStart: { month: 10, day: 1 },
    },
  ],
  tenant: [{ id: 'ten-1', v: 1, rev: 1, name: 'Anna Prova' }],
  tenancy: [
    {
      id: 'pres-1',
      v: 1,
      rev: 1,
      apartmentId: 'apt-nord',
      tenantId: 'ten-1',
      from: '2026-08',
      monthlyRent: 30000,
      monthlyForfait: 8000,
    },
  ],
};

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A template as Word saves it (every entry deflated), with the entries of the core's `docx`. */
async function wordTemplate(paragraph: string): Promise<Uint8Array> {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = `<w:p><w:r><w:rPr/><w:t>${paragraph}</w:t></w:r></w:p>`;
  const entries = [
    ['[Content_Types].xml', '<Types/>'],
    ['_rels/.rels', '<Relationships/>'],
    [
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    ],
  ] as const;
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const raw = new TextEncoder().encode(text);
    const packed = await deflate(raw);
    const name = new TextEncoder().encode(path);
    const local = new Uint8Array(30 + name.length + packed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    parts.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const size = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...parts, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

let fs: MemoryFs;
let store: TauriStore;

async function seed(records: Record<string, Rec[]>) {
  for (const [kind, list] of Object.entries(records)) {
    for (const record of list) {
      await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
    }
  }
}

const file = (rel: string) => fs.files.get(`${ROOT}/${rel}`);
const query = { apartmentId: 'apt-nord', periodLabel: '2026-27' };

beforeEach(() => {
  fs = new MemoryFs();
  fs.dirs.add('/Dropbox');
  fs.dirs.add(ROOT);
  store = new TauriStore(ROOT, fs);
});

describe('the Excel files from the app (plan 26)', () => {
  beforeEach(() => seed(fixtureRecords()));

  it('writes the bytes of the command line to the default paths', async () => {
    const path = 'Nord/2026-27/Excel/Conguaglio_Nord_2026-27.xlsx';
    expect(await writeConguaglioExcel(store, query)).toEqual({
      status: 'written',
      path,
      apartmentId: 'apt-nord',
      period: '2026-27',
      sheets: 4,
      tenants: 5,
      items: 4,
      pending: 2,
    });
    expect(await hashBytes(file(path) as Uint8Array)).toBe(CONGUAGLIO);

    const owners = await writeConguaglioExcel(store, { ...query, owners: true });
    expect(owners).toMatchObject({ status: 'written', sheets: 1, items: 1, pending: 0 });
    expect(
      await hashBytes(file(owners.status === 'written' ? owners.path : '') as Uint8Array),
    ).toBe(OWNERS);

    const tax = await writeTaxExcel(store, { year: '2026' });
    expect(tax).toMatchObject({ status: 'written', year: '2026', apartments: 2, contracts: 1 });
    expect(await hashBytes(file(tax.status === 'written' ? tax.path : '') as Uint8Array)).toBe(TAX);
    expect([...fs.files.keys()].filter((p) => p.includes('.tmp-'))).toEqual([]);
  });

  it('never writes over an existing file, in either spelling', async () => {
    const first = await writeConguaglioExcel(store, query);
    const path = first.status === 'written' ? first.path : '';
    const bytes = file(path);
    expect(await writeConguaglioExcel(store, query)).toEqual({
      status: 'rejected',
      reason: 'file-exists',
    });
    expect(file(path)).toBe(bytes);

    // Another program put the file there between the check and the write.
    let target = '';
    const raced: MemoryFs = Object.create(fs);
    raced.writeNew = async (at, data) => {
      target = at;
      fs.put(at, 'altro');
      await fs.writeNew(at, data);
    };
    expect(await writeTaxExcel(new TauriStore(ROOT, raced), { year: '2026' })).toEqual({
      status: 'rejected',
      reason: 'file-exists',
    });
    expect(new TextDecoder().decode(fs.files.get(target))).toBe('altro');

    // The same name in NFD (a Mac copy) counts as the file.
    const other = new MemoryFs();
    other.put(`${ROOT}/Casa\u0300/a.xlsx`, 'x');
    const nfd = new TauriStore(ROOT, other);
    expect(await nfd.newFileProblem('Casa\u0300/a.xlsx'.normalize('NFC'))).toBe('file-exists');
    expect(await nfd.newFileProblem('Casa\u0300/b.xlsx'.normalize('NFC'))).toBeUndefined();
  });

  it('tells an interrupted write from an existing file, and keeps other failures', async () => {
    // The disk filled up after the file was created: the partial file stays, to be deleted.
    let target = '';
    const full: MemoryFs = Object.create(fs);
    full.writeNew = async (at, data) => {
      target = at;
      await fs.writeNew(at, data.slice(0, 10));
      throw new Error('No space left on device (os error 28)');
    };
    expect(await writeConguaglioExcel(new TauriStore(ROOT, full), query)).toEqual({
      status: 'rejected',
      reason: 'write-interrupted',
      paths: ['Nord/2026-27/Excel/Conguaglio_Nord_2026-27.xlsx'],
    });
    expect(fs.files.get(target)?.length).toBe(10);

    // Refused before anything was created: a file access failure, with the relative path only.
    const locked: MemoryFs = Object.create(fs);
    locked.writeNew = () => Promise.reject(new Error('Permission denied (os error 13)'));
    expect(await writeTaxExcel(new TauriStore(ROOT, locked), { year: '2026' })).toEqual({
      status: 'rejected',
      reason: 'file-access',
      paths: ['Riservato_proprietari/Tasse/2026/Tasse_2026.xlsx'],
    });

    // EEXIST from the plugin (another spelling the check did not see): the file exists.
    const clash: MemoryFs = Object.create(fs);
    clash.writeNew = () => Promise.reject(new Error('File exists (os error 183)'));
    expect(await writeTaxExcel(new TauriStore(ROOT, clash), { year: '2027' })).toEqual({
      status: 'rejected',
      reason: 'file-exists',
    });
  });

  it('refuses data in a newer format, writing nothing', async () => {
    await store.writeJsonAtomic('_app/workspace.json', { schemaVersion: 999 });
    const before = [...fs.files.keys()];
    expect(await writeConguaglioExcel(store, query)).toEqual({
      status: 'rejected',
      reason: 'newer-data',
    });
    expect(await writeTaxExcel(store, { year: '2026' })).toMatchObject({ reason: 'newer-data' });
    expect([...fs.files.keys()]).toEqual(before);
  });

  it('refuses a file in place of a folder of the default path', async () => {
    fs.put(`${ROOT}/Nord/2026-27`, 'un file');
    expect(await writeConguaglioExcel(store, query)).toEqual({
      status: 'rejected',
      reason: 'bad-default-folder',
    });
  });

  it('gives the reasons of the core, without messages', async () => {
    expect(await writeConguaglioExcel(store, { ...query, periodLabel: '1999-00' })).toEqual({
      status: 'rejected',
      reason: 'unknown-period',
    });
    expect(await writeTaxExcel(store, { year: 'anno' })).toEqual({
      status: 'invalid',
      reason: 'bad-arguments',
    });
    fs.put(`${ROOT}/_app/dati/tenant/ten-x.json`, '{ non json');
    const unreadable = await writeConguaglioExcel(store, query);
    expect(unreadable).toMatchObject({ status: 'rejected', reason: 'unreadable-records' });
    expect(unreadable).not.toHaveProperty('message');
  });
});

describe('the default names', () => {
  it('are safe for Windows and in NFC', async () => {
    const records = fixtureRecords();
    const apartments = records.apartment ?? [];
    records.apartment = apartments.map((a) =>
      a.id === 'apt-nord' ? { ...a, name: 'Città: è Nord' } : a,
    );
    await seed(records);
    expect(await writeConguaglioExcel(store, query)).toMatchObject({
      status: 'written',
      path: 'Citta-e-Nord/2026-27/Excel/Conguaglio_Citta-e-Nord_2026-27.xlsx',
    });
    const reserved = fixtureRecords();
    reserved.apartment = apartments.map((a) => (a.id === 'apt-nord' ? { ...a, name: 'con' } : a));
    fs = new MemoryFs();
    fs.dirs.add(ROOT);
    store = new TauriStore(ROOT, fs);
    await seed(reserved);
    expect(await writeConguaglioExcel(store, query)).toMatchObject({
      path: 'Appartamento_con/2026-27/Excel/Conguaglio_Appartamento_con_2026-27.xlsx',
    });
  });
});

describe('writeModulo (plan 26)', () => {
  const args = {
    kind: 'promessa' as const,
    tenancyId: 'pres-1',
    templatePath: 'Modelli/promessa.docx',
    values: { codice_fiscale: 'XXXINVENTATO' },
    today: '2026-11-16',
  };

  beforeEach(async () => {
    await seed(MODULE_RECORDS);
    fs.put(
      `${ROOT}/Modelli/promessa.docx`,
      await wordTemplate('{{inquilino}} {{canone_camera}} {{codice_fiscale}}'),
    );
  });

  it('fills a deflated template with the bytes of the command line', async () => {
    const path = 'Casa-Nord/Contratti/Anna-Prova/2026-11-16_promessa.docx';
    expect(await writeModulo(store, args)).toEqual({
      status: 'written',
      path,
      kind: 'promessa',
      tenancyId: 'pres-1',
      fields: 3,
      appFields: 2,
      askedFields: 1,
    });
    expect(await hashBytes(file(path) as Uint8Array)).toBe(MODULE);
    expect(await writeModulo(store, args)).toEqual({ status: 'rejected', reason: 'file-exists' });
  });

  it('refuses a template path that is not allowed or not a .docx', async () => {
    for (const templatePath of [
      '../fuori.docx',
      'Modelli/con:due.docx',
      'Modelli/x.txt',
      'no.docx',
    ]) {
      expect(await writeModulo(store, { ...args, templatePath })).toEqual({
        status: 'invalid',
        reason: 'bad-template-file',
      });
    }
    fs.put(`${ROOT}/Modelli/rotto.docx`, 'non è uno zip');
    expect(await writeModulo(store, { ...args, templatePath: 'Modelli/rotto.docx' })).toEqual({
      status: 'rejected',
      reason: 'bad-template',
      fields: [],
    });
  });

  it('gives the refusals of the core with field names or counts only', async () => {
    expect(await writeModulo(store, { ...args, values: {} })).toEqual({
      status: 'rejected',
      reason: 'missing-fields',
      fields: ['codice_fiscale'],
    });
    expect(await writeModulo(store, { ...args, values: { X: 'a' } })).toEqual({
      status: 'invalid',
      reason: 'bad-values',
    });
    await store.writeJsonAtomic('_app/workspace.json', { schemaVersion: 999 });
    expect(await writeModulo(store, args)).toEqual({ status: 'rejected', reason: 'newer-data' });
    await store.writeJsonAtomic('_app/workspace.json', { schemaVersion: 1 });
    expect(await writeModulo(store, { ...args, tenancyId: 'nessuna' })).toEqual({
      status: 'rejected',
      reason: 'unknown-tenancy',
    });
  });

  it('refuses a template over the size limit', async () => {
    fs.put(`${ROOT}/Modelli/grande.docx`, new Uint8Array(DOCX_LIMITS.templateBytes + 1));
    expect(await writeModulo(store, { ...args, templatePath: 'Modelli/grande.docx' })).toEqual({
      status: 'invalid',
      reason: 'template-too-large',
    });
  });

  it('asks for another path when the tenant name gives no folder', async () => {
    await writeRecord(
      store,
      recordPath('tenant', 'ten-1'),
      { id: 'ten-1', v: 1, rev: 2, name: '李 明' },
      { expectedRev: 1 },
    );
    expect(await writeModulo(store, args)).toEqual({
      status: 'rejected',
      reason: 'no-tenant-folder',
    });
  });
});

describe('inflateRawStream (R404)', () => {
  it('inflates raw deflate and refuses more than the limit', async () => {
    const raw = new TextEncoder().encode('x'.repeat(5000));
    const packed = await deflate(raw);
    expect(await inflateRawStream(packed, 5000)).toEqual(raw);
    await expect(inflateRawStream(packed, 4999)).rejects.toThrow(RangeError);
    await expect(inflateRawStream(new Uint8Array([0xff, 0xff]), 10)).rejects.toThrow();
  });

  it('gives readZip the entries of a template', async () => {
    const template = await wordTemplate('{{x}}');
    const { inflateAhead } = await import('@bollette/core');
    const entries = readZip(template, await inflateAhead(template, inflateRawStream));
    expect(entries.map((e) => e.path)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);
  });
});
