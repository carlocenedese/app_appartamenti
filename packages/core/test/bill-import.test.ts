import { describe, expect, it } from 'vitest';
import {
  apartmentFolder,
  billFileMove,
  BillSchema,
  ExtractionResultSchema,
  PendingDocumentSchema,
  SupplierProfileSchema,
  hashBytes,
  importBill,
  isoDate,
  loadAll,
  loadDashboard,
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

  it('without codes from the caller, takes those kept in the apartment (R314)', async () => {
    const { store, input, clock } = await setup();
    const withoutCodes = { ...input };
    delete withoutCodes.knownCodes;
    const none = await importBill(store, withoutCodes, 'user1', clock, ids('a'));
    expect(none).toMatchObject({ status: 'da-rivedere', codes: ['apartment-codes-unknown'] });
    const path = recordPath('apartment', 'apt-1');
    const apartment = (await store.readJson(path)) as Record<string, unknown>;
    await store.writeJsonAtomic(path, { ...apartment, rev: 2, supplyCodes: [POD] });
    const kept = await importBill(store, withoutCodes, 'user1', clock, ids('b'));
    expect(kept).toMatchObject({ status: 'registrata-automaticamente' });
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
  it('keeps a whole file waiting when only a part of it is registered', async () => {
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
    expect(await pendingDocuments(store)).toHaveLength(1);
  });

  it('reports a possible duplicate in auto mode and writes no document to review', async () => {
    const { store, input, clock } = await setup({ autoRegister: false });
    await importBill(store, { ...input, mode: 'manual' }, 'u', clock, ids('a'));
    const again = new TextEncoder().encode('%PDF-1.7 bolletta sintetica, riscaricata');
    const result = await importBill(
      store,
      { ...input, bytes: again, result: reading(await hashBytes(again)) },
      'u',
      clock,
      ids('b'),
    );
    expect(result).toEqual({ status: 'possible-duplicate', existingId: 'a-1' });
    expect((await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records).toEqual([]);
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
    expect(undone).toMatchObject({ status: 'undone', records: 2 });
  });

  it('refuses the undo while a live recovery uses an instalment', async () => {
    const { store, clock } = await setup();
    const bytes = new TextEncoder().encode('%PDF-1.7 avviso con recupero');
    await store.writeJsonAtomic(recordPath('supply', 'sup-a'), {
      id: 'sup-a',
      v: 1,
      rev: 1,
      label: 'Uno',
      apartments: [{ apartmentId: 'apt-1', weight: 10000 }],
    });
    const tari = reading(await hashBytes(bytes), {
      kind: 'tari',
      documentKind: 'tari',
      category: null,
      fields: {
        supplier: field('Comune di Esempio'),
        number: field('2026/1/00002'),
        issueDate: field('2026-02-20'),
        dueDate: field('2026-03-16'),
        periodStart: field('2026-01-01'),
        periodEnd: field('2026-04-30'),
        amount: field(10075),
      },
      parts: [{ label: 'Uno', amount: 10075, source }],
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
    const done = await importBill(store, input, 'u', clock, ids('r'));
    const [instalmentId = ''] = done.status === 'confermata' ? done.ids : [];
    await store.writeJsonAtomic(recordPath('tenantRecovery', 'rec-1'), {
      id: 'rec-1',
      v: 1,
      rev: 1,
      apartmentId: 'apt-1',
      instalmentId,
      amount: 100,
      shares: [{ tenantId: 't-1', amount: 100 }],
      status: 'da-recuperare',
    });
    expect(await undoBillImport(store, tari.fileHash, 'u', clock, ids('u'))).toEqual({
      status: 'refused',
      reason: 'has-dependents',
      recordIds: ['rec-1'],
    });
  });
});

describe('undoBillImport of a file with two documents', () => {
  it('asks which one, then takes back only that one', async () => {
    const { store, input, clock } = await setup();
    const part = (first: number, number: string) =>
      reading(input.result.fileHash, {
        pageRange: [first, first],
        fields: Object.fromEntries(
          Object.entries({ ...input.result.fields, number: field(number) }).map(([k, f]) => [
            k,
            { ...f, source: { ...source, page: first } },
          ]),
        ),
      });
    await importBill(
      store,
      { ...input, result: part(1, 'A-1'), mode: 'manual' },
      'u',
      clock,
      ids('a'),
    );
    await importBill(
      store,
      { ...input, result: part(2, 'A-2'), mode: 'manual' },
      'u',
      clock,
      ids('b'),
    );
    const hash = input.result.fileHash;
    expect(await undoBillImport(store, hash, 'u', clock, ids('u'))).toEqual({
      status: 'refused',
      reason: 'several-documents',
      documents: 2,
    });
    expect(
      await undoBillImport(store, hash, 'u', clock, ids('v'), { pages: [1, 1] }),
    ).toMatchObject({ status: 'undone', records: 1 });
    expect((await loadAll(store, 'bill', BillSchema)).records.map((b) => b.id)).toEqual(['b-1']);
    expect(await undoBillImport(store, hash, 'u', clock, ids('w'))).toMatchObject({
      status: 'undone',
      records: 1,
    });
  });
});

describe('undoBillImport', () => {
  it('takes back the bill and the document to review, and can be repeated', async () => {
    const { store, input, result, clock } = await setup({ autoRegister: false });
    await importBill(store, input, 'u', clock, ids('a'));
    await importBill(store, { ...input, mode: 'manual' }, 'u', clock, ids('c'));
    const undone = await undoBillImport(store, result.fileHash, 'u', clock, ids('u'));
    expect(undone).toMatchObject({ status: 'undone', records: 2 });
    expect(undone.status === 'undone' && undone.operations).toHaveLength(2);
    expect((await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records).toEqual([]);
    expect(await undoBillImport(store, result.fileHash, 'u', clock, ids('v'))).toEqual({
      status: 'undone',
      operations: [],
      records: 0,
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

describe('billFileMove (plan 17, R315)', () => {
  it('files the PDF under the apartment, and brings it back to its Da_smistare', () => {
    expect(billFileMove({ name: 'Casa Nord' }, 'Bollette/Gas/2026/2026-10-05_Gas_X.pdf')).toEqual({
      filed: `${apartmentFolder('Casa Nord')}/Bollette/Gas/2026/2026-10-05_Gas_X.pdf`,
      inbox: `${apartmentFolder('Casa Nord')}/Da_smistare/2026-10-05_Gas_X.pdf`,
    });
  });
});

describe('importBill and the consumption alarm (plan 19, R330)', () => {
  // The bill read: 2025-12-01..2026-01-31, 140.0 kWh; the year before 100 kWh, same amount.
  async function withHistory() {
    const ready = await setup();
    await ready.store.writeJsonAtomic(
      recordPath('bill', 'prev'),
      BillSchema.parse({
        id: 'prev',
        v: 1,
        rev: 1,
        apartmentId: 'apt-1',
        category: 'elettricita',
        supplier: 'Fornitore Luce',
        periodStart: '2024-12-01',
        periodEnd: '2025-01-31',
        amount: 9846,
        consumption: { quantity: '100', unit: 'kWh' },
        includedInConguaglio: true,
        sharedWithTenants: true,
        filePath: 'prev.pdf',
        fileHash: 'h-prev',
      }),
    );
    const input = { ...ready.input };
    delete input.thresholds;
    return { ...ready, input };
  }
  const settings = (id: string, extra: Record<string, unknown>) => ({ id, v: 1, rev: 1, ...extra });

  it('without thresholds: no alarm, no error, registered, the comparison without levels', async () => {
    const { store, input, clock } = await withHistory();
    const result = await importBill(store, input, 'user1', clock, ids('a'));
    expect(result).toMatchObject({ status: 'registrata-automaticamente' });
    if (result.status !== 'registrata-automaticamente') return;
    expect(result.checks.map((c) => c.code)).not.toContain('consumption-alarm');
    expect(result.checks.map((c) => c.code)).not.toContain('consumption-anomaly');
    expect(result.consumption?.thresholds).toBe(false);
    expect(result.consumption?.yearBefore?.differences).toEqual([
      { metric: 'consumption', differenceBp: 4000 },
      { metric: 'amount', differenceBp: 0 },
      { metric: 'unitPrice', differenceBp: -2857 },
    ]);
  });

  it('a level of the settings sends the bill to review; the apartment’s own win', async () => {
    const { store, input, clock } = await withHistory();
    await store.writeJsonAtomic(
      recordPath('consumptionSettings', 'soglie-consumi'),
      settings('soglie-consumi', { giallo: { consumption: 3000 }, rosso: { consumption: 5000 } }),
    );
    const flagged = await importBill(store, input, 'user1', clock, ids('a'));
    expect(flagged).toMatchObject({ status: 'da-rivedere', codes: ['consumption-alarm'] });
    if (flagged.status !== 'da-rivedere') return;
    expect(flagged.consumption?.thresholds).toBe(true);
    expect(flagged.consumption?.yearBefore?.differences[0]).toEqual({
      metric: 'consumption',
      differenceBp: 4000,
      level: 'giallo',
    });
    expect(flagged.checks.find((c) => c.code === 'consumption-alarm')).toEqual({
      code: 'consumption-alarm',
      severity: 'warn',
      message:
        "Allarme consumi: consumo +40,00 % rispetto allo stesso periodo dell'anno prima " +
        '(giallo); consumo +40,00 % rispetto alla media dei mesi prima (giallo).',
    });
    // The same file again: the document waiting is found, nothing written, the alarm still there.
    const again = await importBill(store, input, 'user1', clock, ids('w'));
    expect(again).toMatchObject({ status: 'da-rivedere', pendingId: flagged.pendingId });
    expect(again.status === 'da-rivedere' && again.operationId).toBeUndefined();
    expect(again.status === 'da-rivedere' && again.consumption?.thresholds).toBe(true);
    const confirmed = await importBill(
      store,
      { ...input, mode: 'manual' },
      'user1',
      clock,
      ids('m'),
    );
    expect(confirmed).toMatchObject({ status: 'confermata', ids: ['m-1'] });
    const alarms = async () => {
      const r = await loadDashboard(store, { today: isoDate('2026-11-17') });
      return r.status === 'computed' ? r.apartments[0]?.counts : undefined;
    };
    expect(await alarms()).toMatchObject({ 'consumi:giallo': 1 });
    await undoBillImport(store, input.result.fileHash, 'user1', clock, ids('u'));
    expect(Object.keys((await alarms()) ?? {}).filter((c) => c.startsWith('consumi:'))).toEqual([]);

    await store.writeJsonAtomic(
      recordPath('consumptionSettings', 'soglie-consumi-apt-1'),
      settings('soglie-consumi-apt-1', { apartmentId: 'apt-1', rosso: { consumption: 6000 } }),
    );
    const own = await importBill(store, input, 'user1', clock, ids('b'));
    expect(own).toMatchObject({ status: 'registrata-automaticamente' });
    expect(own.status === 'registrata-automaticamente' && own.consumption?.thresholds).toBe(true);
  });

  it('with thresholds, the percentage of the caller adds no second warning', async () => {
    const { store, input, clock } = await withHistory();
    await store.writeJsonAtomic(
      recordPath('consumptionSettings', 'soglie-consumi'),
      settings('soglie-consumi', { giallo: { consumption: 3000 } }),
    );
    const result = await importBill(
      store,
      { ...input, thresholds: { consumptionAnomalyPercent: 30 } },
      'user1',
      clock,
      ids('a'),
    );
    expect(result).toMatchObject({ status: 'da-rivedere', codes: ['consumption-alarm'] });
    expect(result.status === 'da-rivedere' && result.checks.map((c) => c.code)).not.toContain(
      'consumption-anomaly',
    );
  });

  it('a credit note and a first year without history are registered, with no level', async () => {
    const { store, input, clock } = await withHistory();
    await store.writeJsonAtomic(
      recordPath('consumptionSettings', 'soglie-consumi'),
      settings('soglie-consumi', {
        giallo: { consumption: 1, amount: 1, unitPrice: 1 },
        rosso: { consumption: 1, amount: 1, unitPrice: 1 },
      }),
    );
    const credit = reading(input.result.fileHash, {
      fields: {
        ...input.result.fields,
        amount: field(-9846),
        consumption: field({ quantity: '0', unit: 'kWh' }),
      },
    });
    const note = await importBill(store, { ...input, result: credit }, 'user1', clock, ids('a'));
    expect(note).toMatchObject({ status: 'registrata-automaticamente' });
    expect(
      note.status === 'registrata-automaticamente' && note.consumption?.yearBefore?.differences,
    ).toEqual([]);

    const fresh = await setup();
    await fresh.store.writeJsonAtomic(
      recordPath('consumptionSettings', 'soglie-consumi'),
      settings('soglie-consumi', { rosso: { consumption: 1 } }),
    );
    const input2 = { ...fresh.input };
    delete input2.thresholds;
    const first = await importBill(fresh.store, input2, 'user1', fresh.clock, ids('f'));
    expect(first).toMatchObject({ status: 'registrata-automaticamente' });
    if (first.status !== 'registrata-automaticamente') return;
    expect([first.consumption?.thresholds, first.consumption?.yearBefore]).toEqual([
      true,
      undefined,
    ]);
    expect(first.consumption?.recent).toBeUndefined();
  });

  it('only a bill proposal has a comparison', async () => {
    const { store, input, clock } = await withHistory();
    const unknown = reading(input.result.fileHash, { category: null });
    const result = await importBill(store, { ...input, result: unknown }, 'user1', clock, ids('a'));
    expect(result.status).toBe('da-rivedere');
    expect('consumption' in result).toBe(false);
  });
});
