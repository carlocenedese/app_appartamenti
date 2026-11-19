import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CommandStop,
  conguaglioExcelCommand,
  inflateAhead,
  moduleCommand,
  readZip,
  recordPath,
  refuseNewerData,
  suppliedValues,
  taxExcelCommand,
  writeRecord,
} from '../src/index';
import { fixtureRecords } from './helpers/excel-fixture';
import { docx, inflateRaw } from './helpers/docx';
import { MemoryStore } from './helpers/memory-store';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixtureStore(records = fixtureRecords()) {
  const store = new MemoryStore();
  for (const [kind, list] of Object.entries(records)) {
    for (const record of list) {
      await writeRecord(store, recordPath(kind, record.id), record, { expectedRev: null });
    }
  }
  return store;
}

const stopOf = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandStop)
      return { status: error.status, reason: error.reason, ...error.extra };
    throw error;
  }
  throw new Error('no stop');
};

const query = { apartmentId: 'apt-nord', periodLabel: '2026-27' };

describe('the Excel commands (plan 26)', () => {
  it('build the bytes the command line writes', async () => {
    const store = await fixtureStore();
    const tenants = await conguaglioExcelCommand(store, query);
    expect(tenants.path).toBe('Nord/2026-27/Excel/Conguaglio_Nord_2026-27.xlsx');
    const built = tenants.build();
    expect(sha(built.bytes)).toBe(
      '41a4743cbd81e2a82f9f2ddd36e9327f9c1b2c68233e3e4f35b8eb4059f5ae70',
    );
    expect(built.body).toEqual({
      status: 'written',
      apartmentId: 'apt-nord',
      period: '2026-27',
      sheets: 4,
      tenants: 5,
      items: 4,
      pending: 2,
    });
    const owners = (await conguaglioExcelCommand(store, { ...query, owners: true })).build();
    expect(sha(owners.bytes)).toBe(
      '4d6a3defadead27fbd27d2f6692644ed1f997e6c5607e44d21bb84da107ba555',
    );
    expect(owners.body).toMatchObject({ sheets: 1, items: 1, pending: 0 });
    const tax = await taxExcelCommand(store, { year: '2026' });
    expect(sha(tax.build().bytes)).toBe(
      '5e188fb9dbbb927fcccdbb78cf8ad180316d0ba0ac4ae5c897c593fbe4f94ce6',
    );
    expect(tax.build().body).toEqual({
      status: 'written',
      year: '2026',
      sheets: 3,
      apartments: 2,
      contracts: 1,
    });
  });

  it('refuse with the reasons of the command line', async () => {
    const store = await fixtureStore();
    expect(
      await stopOf(() => conguaglioExcelCommand(store, { ...query, apartmentId: 'x' })),
    ).toEqual({ status: 'rejected', reason: 'unknown-apartment' });
    expect(await stopOf(() => taxExcelCommand(store, { year: '26' }))).toEqual({
      status: 'invalid',
      reason: 'bad-arguments',
    });
    const records = fixtureRecords();
    const noTenants = await fixtureStore({ ...records, tenant: [] });
    const prepared = await conguaglioExcelCommand(noTenants, query);
    expect(await stopOf(() => prepared.build())).toMatchObject({
      status: 'rejected',
      reason: 'missing-tenant',
    });
  });

  it('refuses data in a newer format, and not a workspace file it cannot read', async () => {
    const store = new MemoryStore();
    await expect(refuseNewerData(store)).resolves.toBeUndefined();
    store.putRaw('_app/workspace.json', '{"schemaVer');
    await expect(refuseNewerData(store)).resolves.toBeUndefined();
    store.putRaw('_app/workspace.json', '{"schemaVersion": 999}');
    expect(await stopOf(() => refuseNewerData(store))).toEqual({
      status: 'rejected',
      reason: 'newer-data',
    });
  });
});

const MODULE_RECORDS = {
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

describe('moduleCommand (plan 26)', () => {
  const template = docx([['{{inquilino}} {{canone_camera}} {{codice_fiscale}}']]);
  const input = {
    kind: 'promessa' as const,
    tenancyId: 'pres-1',
    template,
    supplied: { codice_fiscale: 'XXXINVENTATO' },
    today: '2026-11-16',
    inflateRaw,
  };

  it('builds the document the command line writes, with its default path', async () => {
    const store = await fixtureStore(MODULE_RECORDS);
    const result = await moduleCommand(store, input);
    expect(sha(result.bytes)).toBe(
      '87139f3bb07240ef18d1b88a3eb72aa4f3d50a76f86e1443f5d2ee84e0ce126b',
    );
    expect(result.path).toBe('Casa-Nord/Contratti/Anna-Prova/2026-11-16_promessa.docx');
    expect(result.body).toEqual({
      status: 'written',
      kind: 'promessa',
      tenancyId: 'pres-1',
      fields: 3,
      appFields: 2,
      askedFields: 1,
    });
  });

  it('refuses with the reason and the field names or the count', async () => {
    const store = await fixtureStore(MODULE_RECORDS);
    expect(await stopOf(() => moduleCommand(store, { ...input, supplied: {} }))).toEqual({
      status: 'rejected',
      reason: 'missing-fields',
      fields: ['codice_fiscale'],
    });
    expect(
      await stopOf(() =>
        moduleCommand(store, { ...input, supplied: { ...input.supplied, x: 'a' } }),
      ),
    ).toEqual({ status: 'rejected', reason: 'unknown-values', count: 1 });
    expect(await stopOf(() => moduleCommand(store, { ...input, tenancyId: 'nope' }))).toEqual({
      status: 'rejected',
      reason: 'unknown-tenancy',
    });
    expect(await stopOf(() => moduleCommand(store, { ...input, today: '2026-13-01' }))).toEqual({
      status: 'invalid',
      reason: 'bad-arguments',
    });
    const advance = docx([['{{inquilino}} {{acconto_spese_mensile}}']]);
    expect(
      await stopOf(() =>
        moduleCommand(store, {
          ...input,
          template: advance,
          supplied: { acconto_spese_mensile: '€ 30,00' },
        }),
      ),
    ).toMatchObject({ status: 'rejected' });
  });

  it('gives no path when the tenant name gives no folder', async () => {
    const store = await fixtureStore({
      ...MODULE_RECORDS,
      tenant: [{ id: 'ten-1', v: 1, rev: 1, name: '李 明' }],
    });
    expect((await moduleCommand(store, input)).path).toBeUndefined();
  });

  it('checks the supplied values', () => {
    expect(suppliedValues({ a_1: 'x' })).toEqual({ a_1: 'x' });
    for (const bad of [null, [], 'x', { A: 'x' }, { a: 1 }]) {
      expect(() => suppliedValues(bad)).toThrow(CommandStop);
    }
  });
});

describe('inflateAhead (R404)', () => {
  const template = docx([['{{inquilino}}']], { header: 'Intestazione' });
  const async = (data: Uint8Array, max: number) => Promise.resolve(inflateRaw(data, max));

  it('gives readZip the same entries as the synchronous inflate', async () => {
    expect(readZip(template, await inflateAhead(template, async))).toEqual(
      readZip(template, inflateRaw),
    );
  });

  it('leaves bytes that are not a zip, or an entry that fails, to readZip', async () => {
    const notZip = new Uint8Array([1, 2, 3]);
    expect(() => readZip(notZip, () => new Uint8Array())).toThrow(RangeError);
    const sync = await inflateAhead(notZip, async);
    expect(() => sync(notZip, 1)).toThrow(RangeError);
    const failing = await inflateAhead(template, () => Promise.reject(new Error('no')));
    expect(() => readZip(template, failing)).toThrow(RangeError);
  });
});
