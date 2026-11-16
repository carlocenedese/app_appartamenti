import { describe, expect, it } from 'vitest';
import {
  condoEstimate,
  loadCondoEstimate,
  recordPath,
  recordSchemas,
  saveCondoDocument,
} from '../src/index';
import type { CondoDocument } from '../src/index';
import { cents } from '../src/money';
import { clock, ids, snapshot } from './helpers/income-year';
import { MemoryStore } from './helpers/memory-store';

// Invented apartment, fiscal years and amounts (plan 14, R250).
const doc = (
  esercizio: string,
  kind: CondoDocument['kind'],
  total: number,
  extra: Partial<CondoDocument> = {},
): CondoDocument =>
  recordSchemas.condoDocument.parse({
    id: `condoc-${extra.apartmentId ?? 'apt-a'}-${esercizio}-${kind}`,
    v: 1,
    rev: 1,
    apartmentId: 'apt-a',
    esercizio,
    kind,
    total,
    ...extra,
  });

describe('condoEstimate (plan 14, R250)', () => {
  it('the fiscal year with its own documents: the consuntivo, else the preventivo', () => {
    const budget = doc('2026-27', 'preventivo', 120000, { quotaConduttore: cents(80000) });
    expect(condoEstimate([budget], 'apt-a', '2026-27')).toEqual({
      apartmentId: 'apt-a',
      esercizio: '2026-27',
      source: 'preventivo',
      fromEsercizio: '2026-27',
      fromKind: 'preventivo',
      total: 120000,
      quotaConduttore: 80000,
    });
    const final = doc('2026-27', 'consuntivo', 131000);
    expect(condoEstimate([budget, final], 'apt-a', '2026-27')).toMatchObject({
      source: 'consuntivo',
      fromKind: 'consuntivo',
      total: 131000,
    });
  });

  it('a year without documents copies the nearest earlier one, lines and amounts unchanged', () => {
    const lines = [
      { label: 'Pulizia scale', amount: cents(30000), quotaConduttore: cents(30000) },
      { label: 'Assicurazione', amount: cents(90000) },
    ];
    const docs = [
      doc('2023-24', 'consuntivo', 99000),
      doc('2024-25', 'preventivo', 120000, { lines }),
      doc('2027-28', 'preventivo', 150000),
    ];
    expect(condoEstimate(docs, 'apt-a', '2026-27')).toEqual({
      apartmentId: 'apt-a',
      esercizio: '2026-27',
      source: 'copiata',
      fromEsercizio: '2024-25',
      fromKind: 'preventivo',
      total: 120000,
      lines,
    });
  });

  it('no estimate without an earlier document; deleted documents and other apartments ignored', () => {
    const docs = [
      doc('2025-26', 'preventivo', 1000, { deleted: true }),
      doc('2025-26', 'consuntivo', 2000, { apartmentId: 'apt-b' }),
      doc('2027-28', 'preventivo', 3000),
    ];
    expect(condoEstimate(docs, 'apt-a', '2026-27')).toBeUndefined();
  });
});

describe('loadCondoEstimate (plan 14, R250)', () => {
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

  it('computes from the store and writes nothing; the estimate follows the documents', async () => {
    const store = await withApartment();
    const input = { apartmentId: 'apt-a', esercizio: '2026-27' };
    expect(await loadCondoEstimate(store, input)).toEqual({ status: 'computed' });
    const base = { apartmentId: 'apt-a', kind: 'preventivo', total: cents(50000) } as const;
    await saveCondoDocument(store, { ...base, esercizio: '2025-26' }, 'p1', clock, ids('a'));
    const before = await snapshot(store);
    expect(await loadCondoEstimate(store, input)).toMatchObject({
      status: 'computed',
      estimate: { source: 'copiata', fromEsercizio: '2025-26', total: 50000 },
    });
    expect(await snapshot(store)).toEqual(before);
    await saveCondoDocument(store, { ...base, esercizio: '2026-27' }, 'p1', clock, ids('b'));
    expect(await loadCondoEstimate(store, input)).toMatchObject({
      estimate: { source: 'preventivo', fromEsercizio: '2026-27' },
    });
  });

  it('refuses an unknown apartment and an inconsistent store', async () => {
    const store = await withApartment();
    expect(await loadCondoEstimate(store, { apartmentId: 'apt-x', esercizio: '2026-27' })).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    const base = { apartmentId: 'apt-a', kind: 'preventivo', total: cents(120000) } as const;
    await saveCondoDocument(store, { ...base, esercizio: '2025-26' }, 'p1', clock, ids('a'));
    const path = recordPath('condoDocument', 'condoc-apt-a-2025-26-preventivo');
    store.putRaw(path, (store.getRaw(path) ?? '').replace('120000', '1'));
    expect(await loadCondoEstimate(store, { apartmentId: 'apt-a', esercizio: '2026-27' })).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });
});
