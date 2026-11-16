import { describe, expect, it } from 'vitest';
import {
  CondoDocumentSchema,
  documentQuotaConduttore,
  loadAll,
  readJournal,
  recordPath,
  recordSchemas,
  saveCondoDocument,
} from '../src/index';
import type { CondoDocument, SaveCondoDocumentInput } from '../src/index';
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
