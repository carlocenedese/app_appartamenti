import { describe, expect, it } from 'vitest';
import {
  ExtractionResultSchema,
  PendingDocumentSchema,
  SupplierProfileSchema,
  hashBytes,
  importBill,
  loadAll,
  pendingDocuments,
  readJournal,
  recordPath,
  undoBillImport,
} from '../src/index';
import type { ExtractionResult, ImportBillInput } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

// Synthetic data only: suppliers, numbers and codes are invented (the POD is the fictitious one
// listed in fixtures/README.md).
const POD = 'IT001E12345678';
const PDF = new TextEncoder().encode('%PDF-1.7 bolletta sintetica');
const source = { page: 1, box: [10, 20, 110, 40], text: 'testo' };
const field = (value: unknown, confidence = 'high') => ({ value, confidence, source });

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 17, 9, 0, 0, tick++)).toISOString();
}
function ids(prefix: string): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count)}`;
}

function reading(fileHash: string, overrides: Record<string, unknown> = {}): ExtractionResult {
  return ExtractionResultSchema.parse({
    v: 1,
    engineVersion: '0.1.0',
    fileHash,
    fileName: 'bolletta.pdf',
    pages: 2,
    pageRange: [1, 2],
    status: 'riconosciuta',
    profileId: 'prof-luce',
    profileRev: 1,
    kind: 'bill',
    documentKind: 'bill',
    category: 'elettricita',
    fields: {
      supplier: field('Fornitore Luce'),
      number: field('2026/0042'),
      issueDate: field('2026-02-05'),
      dueDate: field('2026-02-25'),
      periodStart: field('2025-12-01'),
      periodEnd: field('2026-01-31'),
      amount: field(9846),
      consumption: field({ quantity: '140.0', unit: 'kWh' }),
    },
    parts: [],
    identifiers: [{ kind: 'pod', value: POD }],
    checks: [{ code: 'total-matches-items', ok: true, message: 'Il totale torna.' }],
    warnings: [],
    textSource: 'pdf',
    ocrPages: [],
    ...overrides,
  });
}

async function setup(profile: Record<string, unknown> = {}) {
  const store = new MemoryStore();
  await store.writeJsonAtomic(recordPath('apartment', 'apt-1'), {
    id: 'apt-1',
    v: 1,
    rev: 1,
    name: 'Appartamento Uno',
    locatore: 'user1',
    posti: 2,
    annualitaStart: { month: 10, day: 1 },
  });
  await store.writeJsonAtomic(recordPath('tenancy', 'ten-1'), {
    id: 'ten-1',
    v: 1,
    rev: 1,
    apartmentId: 'apt-1',
    tenantId: 't-1',
    from: '2025-01',
    monthlyRent: 40000,
    monthlyForfait: 5000,
  });
  await store.writeJsonAtomic(
    recordPath('supplierProfile', 'prof-luce'),
    SupplierProfileSchema.parse({
      id: 'prof-luce',
      v: 1,
      rev: 1,
      supplier: 'Fornitore Luce',
      kind: 'bill',
      category: 'elettricita',
      status: 'confermato',
      autoRegister: true,
      validFrom: '2025-01-01',
      recognise: { allOf: ['Fornitore Luce'], noneOf: [] },
      fields: {},
      identifiers: [],
      ...profile,
    }),
  );
  const result = reading(await hashBytes(PDF));
  const input: ImportBillInput = {
    result,
    bytes: PDF,
    apartmentId: 'apt-1',
    knownCodes: [POD],
    thresholds: { consumptionAnomalyPercent: 30 },
    mode: 'auto',
  };
  return { store, result, input, clock: tickingClock() };
}

describe('importBill', () => {
  it('registers by itself what passes every check, once', async () => {
    const { store, input, clock } = await setup();
    const first = await importBill(store, input, 'user1', clock, ids('a'));
    expect(first).toMatchObject({ status: 'registrata-automaticamente', ids: ['a-1'] });
    const again = await importBill(store, input, 'user1', clock, ids('b'));
    expect(again).toEqual({ status: 'duplicate', existingId: 'a-1' });
  });

  it('leaves a doubtful reading da rivedere, written once, then a person confirms it', async () => {
    const { store, input, clock } = await setup({ autoRegister: false });
    const first = await importBill(store, input, 'user1', clock, ids('a'));
    expect(first).toMatchObject({
      status: 'da-rivedere',
      pendingId: 'doc-a-2',
      codes: ['profile'],
    });
    expect(first.status === 'da-rivedere' && first.operationId).toBeTruthy();
    const second = await importBill(store, input, 'user1', clock, ids('b'));
    expect(second).toMatchObject({ status: 'da-rivedere', pendingId: 'doc-a-2' });
    expect(second.status === 'da-rivedere' && second.operationId).toBeUndefined();
    expect((await pendingDocuments(store)).map((d) => d.id)).toEqual(['doc-a-2']);

    const confirmed = await importBill(
      store,
      { ...input, mode: 'manual' },
      'user1',
      clock,
      ids('c'),
    );
    expect(confirmed).toMatchObject({ status: 'confermata', ids: ['c-1'] });
    expect(await pendingDocuments(store)).toEqual([]);
  });

  it('never registers by itself without the codes of the apartment (R261)', async () => {
    const { store, input, clock } = await setup();
    const result = await importBill(store, { ...input, knownCodes: [] }, 'user1', clock, ids('a'));
    expect(result).toMatchObject({ status: 'da-rivedere', codes: ['apartment-codes-unknown'] });
  });

  it('gives codes for doubtful fields, a wrong apartment code and the reading status', async () => {
    const { store, clock, input } = await setup();
    const doubtful = reading(input.result.fileHash, {
      status: 'da-confermare',
      fields: { ...input.result.fields, number: field('2026/0042', 'medium') },
    });
    const result = await importBill(
      store,
      { ...input, result: doubtful, knownCodes: ['CODICE-INVENTATO-ALTRO'] },
      'user1',
      clock,
      ids('a'),
    );
    expect(result).toMatchObject({
      status: 'da-rivedere',
      codes: ['apartment-codes', 'field:number', 'reading-status', 'status'],
    });
  });

  it('refuses an unknown apartment and an inconsistent store, rejects other bytes', async () => {
    const { store, input, clock } = await setup();
    expect(await importBill(store, { ...input, apartmentId: 'x' }, 'u', clock, ids('a'))).toEqual({
      status: 'refused',
      reason: 'unknown-apartment',
    });
    const other = new TextEncoder().encode('altro');
    expect(await importBill(store, { ...input, bytes: other }, 'u', clock, ids('a'))).toMatchObject(
      { status: 'rejected' },
    );
    await importBill(store, input, 'u', clock, ids('a'));
    await store.writeJsonAtomic(recordPath('bill', 'a-1'), { broken: true });
    expect(await importBill(store, input, 'u', clock, ids('b'))).toEqual({
      status: 'refused',
      reason: 'inconsistent-store',
    });
  });

  it('rejects a manual confirmation of a reading with nothing to register', async () => {
    const { store, input, clock } = await setup();
    const none = reading(input.result.fileHash, { status: 'non-riconosciuta' });
    const result = await importBill(
      store,
      { ...input, result: none, mode: 'manual' },
      'u',
      clock,
      ids('a'),
    );
    expect(result).toMatchObject({ status: 'rejected' });
    expect((await readJournal(store)).operations).toEqual([]);
  });
});

describe('pendingDocuments', () => {
  it('counts a whole file waiting as resolved once a part of it is registered', async () => {
    const { store, input, clock } = await setup({ autoRegister: false });
    await importBill(store, input, 'u', clock, ids('a'));
    expect(await pendingDocuments(store)).toHaveLength(1);
    const part = reading(input.result.fileHash, { pageRange: [1, 1] });
    const result = await importBill(
      store,
      { ...input, result: part, mode: 'manual' },
      'u',
      clock,
      ids('p'),
    );
    expect(result).toMatchObject({ status: 'confermata' });
    expect(await pendingDocuments(store)).toEqual([]);
  });
});

describe('importBill of a TARI notice', () => {
  it('writes one instalment per supply read from the store, and takes them back', async () => {
    const { store, clock } = await setup();
    const bytes = new TextEncoder().encode('%PDF-1.7 avviso TARI sintetico');
    for (const [id, label, apartmentId] of [
      ['sup-a', 'Uno', 'apt-1'],
      ['sup-b', 'Due', 'apt-2'],
    ] as const) {
      await store.writeJsonAtomic(recordPath('supply', id), {
        id,
        v: 1,
        rev: 1,
        label,
        apartments: [{ apartmentId, weight: 10000 }],
      });
    }
    const tari = reading(await hashBytes(bytes), {
      kind: 'tari',
      documentKind: 'tari',
      category: null,
      profileId: 'prof-tari',
      fields: {
        supplier: field('Comune di Esempio'),
        number: field('2026/1/00001'),
        issueDate: field('2026-02-20'),
        dueDate: field('2026-03-16'),
        periodStart: field('2026-01-01'),
        periodEnd: field('2026-04-30'),
        amount: field(18546),
      },
      parts: [
        { label: 'Uno', amount: 10075, source },
        { label: 'Due', amount: 8471, source },
      ],
      identifiers: [],
    });
    const input: ImportBillInput = {
      result: tari,
      bytes,
      apartmentId: 'apt-1',
      knownCodes: [],
      thresholds: { consumptionAnomalyPercent: 30 },
      mode: 'manual',
    };
    const result = await importBill(store, input, 'u', clock, ids('t'));
    expect(result.status === 'confermata' && result.ids).toHaveLength(2);
    const undone = await undoBillImport(store, tari.fileHash, 'u', clock, ids('u'));
    expect(undone.status === 'undone' && undone.operations).toHaveLength(1);
  });
});

describe('undoBillImport', () => {
  it('takes back the bill and the document to review, and can be repeated', async () => {
    const { store, input, result, clock } = await setup({ autoRegister: false });
    await importBill(store, input, 'u', clock, ids('a'));
    await importBill(store, { ...input, mode: 'manual' }, 'u', clock, ids('c'));
    const undone = await undoBillImport(store, result.fileHash, 'u', clock, ids('u'));
    expect(undone.status === 'undone' && undone.operations).toHaveLength(2);
    expect((await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records).toEqual([]);
    expect(await undoBillImport(store, result.fileHash, 'u', clock, ids('v'))).toEqual({
      status: 'undone',
      operations: [],
    });
    // A new reading registers again with new ids.
    expect(
      await importBill(store, { ...input, mode: 'manual' }, 'u', clock, ids('d')),
    ).toMatchObject({ status: 'confermata', ids: ['d-1'] });
  });

  it('refuses while a live match uses the bill', async () => {
    const { store, input, result, clock } = await setup();
    await importBill(store, input, 'u', clock, ids('a'));
    await store.writeJsonAtomic(recordPath('match', 'm-1'), {
      id: 'm-1',
      v: 1,
      rev: 1,
      itemType: 'bill',
      itemId: 'a-1',
      transactionId: 'tx-1',
      transactionDate: '2026-02-25',
      amount: 9846,
      part: 'amount',
      confirmed: true,
      by: 'manual',
    });
    expect(await undoBillImport(store, result.fileHash, 'u', clock, ids('u'))).toEqual({
      status: 'refused',
      reason: 'has-dependents',
      recordIds: ['m-1'],
    });
  });
});
