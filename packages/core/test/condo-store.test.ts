import { describe, expect, it } from 'vitest';
import {
  CondoDocumentSchema,
  TenantRecoverySchema,
  documentQuotaConduttore,
  equalShares,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  saveCondoDocument,
  saveTenantRecovery,
} from '../src/index';
import type { CondoDocument, SaveCondoDocumentInput, SaveTenantRecoveryInput } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartment and amounts (plan 8).
async function withApartment() {
  const store = new MemoryStore();
  await store.writeJsonAtomic(
    recordPath('apartment', 'apt-a'),
    recordSchemas.apartment.parse({
      id: 'apt-a',
      v: 1,
      rev: 1,
      name: 'Appartamento A',
      locatore: 'user1',
      posti: 4,
      annualitaStart: { month: 10, day: 1 },
    }),
  );
  return store;
}
const budget: SaveCondoDocumentInput = {
  apartmentId: 'apt-a',
  esercizio: '2026-27',
  kind: 'preventivo',
  total: cents(120000),
  quotaConduttore: cents(80000),
};
const save = (store: MemoryStore, input: SaveCondoDocumentInput, prefix = 'e') =>
  saveCondoDocument(store, input, 'p1', clock, ids(prefix));

describe('saveCondoDocument (plan 8, task 3)', () => {
  it('saves condoc-<apartment>-<esercizio>-<kind>, then unchanged, then a new rev', async () => {
    const store = await withApartment();
    expect(await save(store, budget)).toEqual({
      status: 'saved',
      operationId: 'e-1',
      documentId: 'condoc-apt-a-2026-27-preventivo',
    });
    const [op] = (await readJournal(store)).operations;
    expect(op).toMatchObject({
      kind: 'condo.document',
      apartmentId: 'apt-a',
      summary: 'Documento del condominio salvato.',
    });
    expect(await save(store, budget, 'f')).toEqual({
      status: 'unchanged',
      documentId: 'condoc-apt-a-2026-27-preventivo',
    });
    await save(store, { ...budget, total: cents(125000) }, 'g');
    const docs = (await loadAll(store, 'condoDocument', CondoDocumentSchema)).records;
    expect(docs).toEqual([
      expect.objectContaining({ rev: 2, total: 125000, quotaConduttore: 80000 }),
    ]);
  });

  it('refuses an unknown apartment and an invalid document, writing nothing', async () => {
    const store = await withApartment();
    const before = await snapshot(store);
    expect(await save(store, { ...budget, apartmentId: 'apt-x' })).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    expect(
      await save(store, { ...budget, lines: [{ label: 'Pulizia scale', amount: cents(1) }] }),
    ).toEqual({ status: 'refused', reason: 'invalid-document' });
    expect(await save(store, { ...budget, esercizio: '2026/27' })).toEqual({
      status: 'refused',
      reason: 'invalid-document',
    });
    expect(await snapshot(store)).toEqual(before);
  });

  it('refuses a document whose id is already another apartment and year (id-collision)', async () => {
    const store = await withApartment();
    await store.writeJsonAtomic(
      recordPath('apartment', 'apt-a-2026'),
      recordSchemas.apartment.parse({
        id: 'apt-a-2026',
        v: 1,
        rev: 1,
        name: 'Appartamento B',
        locatore: 'user1',
        posti: 2,
        annualitaStart: { month: 10, day: 1 },
      }),
    );
    await save(store, budget);
    expect(
      await save(store, { ...budget, apartmentId: 'apt-a-2026', esercizio: '27' }, 'f'),
    ).toEqual({
      status: 'refused',
      reason: 'id-collision',
    });
  });

  it('a diverged store is inconsistent-store', async () => {
    const store = await withApartment();
    await save(store, budget);
    const path = recordPath('condoDocument', 'condoc-apt-a-2026-27-preventivo');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('120000', '1'));
    expect(await save(store, { ...budget, total: cents(2) }, 'f')).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});

describe('documentQuotaConduttore (plan 8, task 3)', () => {
  const doc = (extra: Partial<CondoDocument>): CondoDocument =>
    CondoDocumentSchema.parse({
      id: 'condoc-apt-a-2026-27-consuntivo',
      v: 1,
      rev: 1,
      apartmentId: 'apt-a',
      esercizio: '2026-27',
      kind: 'consuntivo',
      total: 10000,
      ...extra,
    });

  it('the document field wins; else the lines when they all give it; else none', () => {
    expect(documentQuotaConduttore(doc({ quotaConduttore: cents(7000) }))).toBe(7000);
    const lines = [
      { label: 'Scale', amount: cents(6000), quotaConduttore: cents(6000) },
      { label: 'Ascensore', amount: cents(4000), quotaConduttore: cents(1000) },
    ];
    expect(documentQuotaConduttore(doc({ lines }))).toBe(7000);
    expect(
      documentQuotaConduttore(
        doc({
          lines: [
            lines[0] as (typeof lines)[number],
            { label: 'Assicurazione', amount: cents(4000) },
          ],
        }),
      ),
    ).toBeUndefined();
    expect(documentQuotaConduttore(doc({}))).toBeUndefined();
  });
});

describe('tenant recoveries (plan 8, task 7)', () => {
  // An extraordinary instalment of 200,00 € advanced by the owners; two invented tenants.
  async function recoveryStore() {
    const store = await withApartment();
    const put = async (
      kind: 'instalment' | 'tenancy',
      r: { id: string } & Record<string, unknown>,
    ) => store.writeJsonAtomic(recordPath(kind, r.id), recordSchemas[kind].parse(r));
    const inst = {
      v: 1,
      rev: 1,
      apartmentId: 'apt-a',
      kind: 'condominio',
      esercizio: '2026-27',
      rateIndex: 1,
      rateCount: 1,
      dueDate: '2026-11-30',
      rata: 20000,
      quotaProprieta: 0,
      conguaglioPrec: 0,
      coversFrom: '2026-11',
      coversTo: '2026-11',
    };
    await put('instalment', { ...inst, id: 'str-1', straordinaria: true });
    await put('instalment', { ...inst, id: 'ord-1' });
    const tenancy = { v: 1, rev: 1, apartmentId: 'apt-a', from: '2026-10', monthlyRent: 30000 };
    await put('tenancy', { ...tenancy, id: 'tcy-1', tenantId: 'ten-1', monthlyForfait: 3000 });
    await put('tenancy', { ...tenancy, id: 'tcy-2', tenantId: 'ten-2', monthlyForfait: 3000 });
    return store;
  }
  const recovery = (extra: Partial<SaveTenantRecoveryInput> = {}): SaveTenantRecoveryInput => ({
    id: 'rec-1',
    apartmentId: 'apt-a',
    instalmentId: 'str-1',
    amount: cents(15001),
    shares: equalShares(cents(15001), ['ten-2', 'ten-1']),
    status: 'da-recuperare',
    periodLabel: '2026-27',
    ...extra,
  });
  const saveR = (store: MemoryStore, input: SaveTenantRecoveryInput, prefix = 'r') =>
    saveTenantRecovery(store, input, 'p1', clock, ids(prefix));

  it('equalShares splits like splitCents, leftover to the first tenants in the order given', () => {
    expect(equalShares(cents(15001), ['ten-2', 'ten-1'])).toEqual([
      { tenantId: 'ten-2', amount: 7501 },
      { tenantId: 'ten-1', amount: 7500 },
    ]);
  });

  it('saves a part of the expense, then unchanged, then a status set by user1', async () => {
    const store = await recoveryStore();
    expect(await saveR(store, recovery())).toEqual({
      status: 'saved',
      operationId: 'r-1',
      recoveryId: 'rec-1',
    });
    const operations = (await readJournal(store)).operations;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      kind: 'recovery.save',
      summary: 'Recupero da un inquilino salvato.',
    });
    expect(await saveR(store, recovery(), 's')).toEqual({
      status: 'unchanged',
      recoveryId: 'rec-1',
    });
    expect(await saveR(store, recovery({ status: 'non-recuperabile' }), 't')).toMatchObject({
      status: 'saved',
    });
    const records = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records;
    expect(records).toEqual([expect.objectContaining({ rev: 2, status: 'non-recuperabile' })]);
  });

  it('refuses what the design refuses, writing nothing', async () => {
    const store = await recoveryStore();
    const before = await snapshot(store);
    const refused = (reason: string) => ({ status: 'refused', reason });
    expect(await saveR(store, recovery({ apartmentId: 'apt-x' }))).toEqual(
      refused('unknown-apartment'),
    );
    expect(await saveR(store, recovery({ instalmentId: 'ord-1' }))).toEqual(
      refused('not-extraordinary'),
    );
    expect(await saveR(store, recovery({ instalmentId: 'nessuna' }))).toEqual(
      refused('not-extraordinary'),
    );
    expect(
      await saveR(
        store,
        recovery({ amount: cents(20001), shares: [{ tenantId: 'ten-1', amount: cents(20001) }] }),
      ),
    ).toEqual(refused('amount-too-high'));
    expect(
      await saveR(store, recovery({ shares: [{ tenantId: 'ten-1', amount: cents(15000) }] })),
    ).toEqual(refused('bad-shares'));
    expect(
      await saveR(store, recovery({ shares: [{ tenantId: 'ten-9', amount: cents(15001) }] })),
    ).toEqual(refused('bad-shares'));
    expect(await saveR(store, recovery({ id: 'a/b' }))).toEqual(refused('invalid-recovery'));
    expect(await snapshot(store)).toEqual(before);
  });

  it('two recoveries on one expense never go above it', async () => {
    const store = await recoveryStore();
    await saveR(store, recovery());
    const second = recovery({
      id: 'rec-2',
      amount: cents(5000),
      shares: [{ tenantId: 'ten-1', amount: cents(5000) }],
    });
    expect(await saveR(store, second, 's')).toEqual({
      status: 'refused',
      reason: 'amount-too-high',
    });
    expect(
      await saveR(
        store,
        { ...second, amount: cents(4999), shares: [{ tenantId: 'ten-1', amount: cents(4999) }] },
        't',
      ),
    ).toMatchObject({ status: 'saved' });
  });
});
