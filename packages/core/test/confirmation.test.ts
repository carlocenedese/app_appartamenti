import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  ExtractionResultSchema,
  InstalmentSchema,
  SupplierProfileSchema,
  confirmProfile,
  decideRegistration,
  hashBytes,
  loadAll,
  proposalFromExtraction,
  readJournal,
  recordPath,
  registerProposal,
  setProfileAutoRegister,
  undoOperation,
} from '../src/index';
import type { ExtractionResult, Proposal, ProposalContext, SupplierProfile } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

// Synthetic data only: suppliers, numbers and codes are invented (the POD is the fictitious one
// listed in fixtures/README.md).
const POD = 'IT001E12345678';
const encoder = new TextEncoder();
const source = { page: 1, box: [10, 20, 110, 40], text: 'testo' };
const field = (value: unknown, confidence = 'high') => ({ value, confidence, source });

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 12, 9, 0, 0, tick++)).toISOString();
}

function ids(prefix = 'id'): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count)}`;
}

const PDF = encoder.encode('%PDF-1.7 bolletta sintetica');
const PDF_AGAIN = encoder.encode('%PDF-1.7 bolletta sintetica, riscaricata');
const TARI_PDF = encoder.encode('%PDF-1.7 avviso TARI sintetico');

function billResult(fileHash: string, overrides: Record<string, unknown> = {}): ExtractionResult {
  const { fields, ...rest } = overrides;
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
      ...(fields as Record<string, unknown> | undefined),
    },
    parts: [],
    identifiers: [{ kind: 'pod', value: POD }],
    checks: [{ code: 'total-matches-items', ok: true, message: 'Il totale torna.' }],
    warnings: [],
    textSource: 'pdf',
    ocrPages: [],
    ...rest,
  });
}

function tariResult(fileHash: string): ExtractionResult {
  return billResult(fileHash, {
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
      consumption: undefined,
    },
    parts: [
      { label: 'Berchet', amount: 10075, source },
      { label: 'Lovarini', amount: 8471, source },
    ],
    identifiers: [],
  });
}

const tenancy = (id: string, apartmentId: string) => ({
  id,
  v: 1 as const,
  rev: 1,
  apartmentId,
  tenantId: `t-${id}`,
  from: '2025-01',
  monthlyRent: 40000,
  monthlyForfait: 5000,
});

function context(extra: Partial<ProposalContext> = {}): ProposalContext {
  return {
    apartment: { id: 'apt-1', knownCodes: [] },
    bills: [],
    instalments: [],
    tenancies: [tenancy('ten-1', 'apt-1')] as ProposalContext['tenancies'],
    thresholds: { consumptionAnomalyPercent: 30 },
    ...extra,
  };
}

const tariContext = () =>
  context({
    apartment: { id: 'apt-b', knownCodes: [] },
    tenancies: [tenancy('b', 'apt-b'), tenancy('l', 'apt-l')] as ProposalContext['tenancies'],
    supplies: [
      {
        id: 'sup-berchet',
        label: 'Berchet',
        apartments: [{ apartmentId: 'apt-b', weight: 10000 }],
      },
      {
        id: 'sup-lovarini',
        label: 'Lovarini',
        apartments: [{ apartmentId: 'apt-l', weight: 10000 }],
      },
    ],
  });

function profile(extra: Partial<SupplierProfile> = {}): SupplierProfile {
  return SupplierProfileSchema.parse({
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
    ...extra,
  });
}

function tariProfile(extra: Partial<SupplierProfile> = {}): SupplierProfile {
  return SupplierProfileSchema.parse({
    id: 'prof-tari',
    v: 1,
    rev: 1,
    supplier: 'Comune di Esempio',
    kind: 'tari',
    status: 'confermato',
    autoRegister: true,
    validFrom: '2025-01-01',
    recognise: { allOf: ['Avviso TARI'], noneOf: [] },
    fields: {},
    identifiers: [],
    ...extra,
  });
}

/** `store` with the supplier profiles written as records (default: the confirmed luce one). */
async function withProfiles<S extends MemoryStore>(
  store: S,
  ...profiles: SupplierProfile[]
): Promise<S> {
  for (const p of profiles.length > 0 ? profiles : [profile()]) {
    await store.writeJsonAtomic(recordPath('supplierProfile', p.id), p);
  }
  return store;
}

async function billCase(bytes: Uint8Array = PDF, overrides: Record<string, unknown> = {}) {
  const result = billResult(await hashBytes(bytes), overrides);
  const proposal = proposalFromExtraction(result, context(), ids('bill'));
  return { result, proposal };
}

/** A store whose next write of a record fails with EIO, after the journal file is written. */
class FailingRecordStore extends MemoryStore {
  failNext = true;
  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (this.failNext && path.startsWith('_app/dati/')) {
      this.failNext = false;
      throw Object.assign(new Error(`EIO: i/o error, write ${path}`), { code: 'EIO' });
    }
    return super.writeJsonAtomic(path, value);
  }
}

const withCheck = (proposal: Proposal, severity: 'warn' | 'fail'): Proposal =>
  ({
    ...proposal,
    checks: [...proposal.checks, { code: 'extra', severity, message: `Controllo ${severity}.` }],
  }) as Proposal;

describe('decideRegistration', () => {
  it('registers automatically only with a confirmed profile, autoRegister, all high, all ok', async () => {
    const { result, proposal } = await billCase();
    expect(proposal.checks.every((c) => c.severity === 'ok')).toBe(true);
    expect(decideRegistration({ proposal, result, profile: profile() })).toEqual({
      action: 'auto-register',
      reasons: [],
    });
  });

  it('never registers by itself a scan (textSource ocr)', async () => {
    const { result, proposal } = await billCase();
    // Forged on purpose: the schema refuses it, the decision must not depend on that.
    const forged = { ...result, textSource: 'ocr', ocrPages: [1, 2] } as ExtractionResult;
    const decision = decideRegistration({ proposal, result: forged, profile: profile() });
    expect(decision.action).toBe('review');
    expect(decision.reasons.join(' ')).toMatch(/OCR|scansion/i);
    const parsed = billResult(result.fileHash, {
      textSource: 'ocr',
      ocrPages: [1, 2],
      status: 'da-confermare',
      fields: Object.fromEntries(
        Object.entries(result.fields).map(([name, f]) => [name, { ...f, confidence: 'medium' }]),
      ),
    });
    const built = proposalFromExtraction(parsed, context(), ids('ocr'));
    expect(built.kind).not.toBe('none');
    expect(decideRegistration({ proposal: built, result: parsed, profile: profile() }).action).toBe(
      'review',
    );
  });

  it('decides a mixed result as a text one when no field was read from an OCR page', async () => {
    // fields come from page 1; page 2 (a back page, say) was read with OCR
    const { result, proposal } = await billCase();
    const mixed = billResult(result.fileHash, { textSource: 'mixed', ocrPages: [2] });
    expect(mixed.status).toBe('riconosciuta');
    expect(decideRegistration({ proposal, result: mixed, profile: profile() })).toEqual({
      action: 'auto-register',
      reasons: [],
    });
  });

  it('sends a mixed result to review when a field with a value was read from an OCR page', async () => {
    const { result, proposal } = await billCase();
    // Forged on purpose: the schema refuses it, the decision must not depend on that.
    const forged = { ...result, textSource: 'mixed', ocrPages: [1] } as ExtractionResult;
    const decision = decideRegistration({ proposal, result: forged, profile: profile() });
    expect(decision.action).toBe('review');
    expect(decision.reasons.join(' ')).toMatch(/OCR|scansion/i);
    const parsed = billResult(result.fileHash, {
      textSource: 'mixed',
      ocrPages: [1],
      status: 'da-confermare',
      fields: Object.fromEntries(
        Object.entries(result.fields).map(([name, f]) => [name, { ...f, confidence: 'medium' }]),
      ),
    });
    const built = proposalFromExtraction(parsed, context(), ids('mixed'));
    expect(built.kind).not.toBe('none');
    expect(decideRegistration({ proposal: built, result: parsed, profile: profile() }).action).toBe(
      'review',
    );
  });

  it('sends a mixed TARI result to review when the parts were read from an OCR page', async () => {
    const base = tariResult(await hashBytes(TARI_PDF));
    // fields from the text page 1; the parts of the notice from the scanned page 2
    const parts = base.parts.map((part) => ({ ...part, source: { ...part.source, page: 2 } }));
    const proposal = proposalFromExtraction({ ...base, parts }, tariContext(), ids('parts'));
    const confirmed = tariProfile({ status: 'confermato', autoRegister: true });
    const scanned = { ...base, parts, textSource: 'mixed', ocrPages: [2] } as ExtractionResult;
    const decision = decideRegistration({ proposal, result: scanned, profile: confirmed });
    expect(decision.action).toBe('review');
    expect(decision.reasons.join(' ')).toMatch(/OCR|scansion/i);
    const onText = { ...scanned, ocrPages: [3] } as ExtractionResult;
    expect(
      decideRegistration({ proposal, result: onText, profile: confirmed }).reasons.join(' '),
    ).not.toMatch(/OCR|scansion/i);
  });

  it('always asks with a draft profile, or a confirmed one with autoRegister false (RF 7)', async () => {
    const { result, proposal } = await billCase();
    const draft = decideRegistration({ proposal, result, profile: profile({ status: 'bozza' }) });
    expect(draft.action).toBe('review');
    expect(draft.reasons.join(' ')).toMatch(/bozza/);
    const always = decideRegistration({
      proposal,
      result,
      profile: profile({ autoRegister: false }),
    });
    expect(always.action).toBe('review');
    expect(always.reasons.join(' ')).toMatch(/conferma sempre/);
    const none = decideRegistration({ proposal, result, profile: undefined });
    expect(none.action).toBe('review');
    expect(none.reasons.join(' ')).toMatch(/profilo/);
  });

  it('asks when a single field is medium, naming it', async () => {
    const { result, proposal } = await billCase(PDF, { fields: { amount: field(9846, 'medium') } });
    const decision = decideRegistration({ proposal, result, profile: profile() });
    expect(decision.action).toBe('review');
    expect(decision.reasons).toContain('Il campo «importo» è dubbio.');
  });

  it('asks when an optional field is missing, naming it', async () => {
    const { result, proposal } = await billCase(PDF, {
      fields: { consumption: field(null, 'missing') },
    });
    expect(proposal.kind).toBe('bill');
    const decision = decideRegistration({ proposal, result, profile: profile() });
    expect(decision.action).toBe('review');
    expect(decision.reasons).toContain('Il campo «consumo» non è stato letto.');
  });

  it('asks for a warn or a fail among the checks, with its message', async () => {
    const { result, proposal } = await billCase();
    for (const severity of ['warn', 'fail'] as const) {
      const decision = decideRegistration({
        proposal: withCheck(proposal, severity),
        result,
        profile: profile(),
      });
      expect(decision).toEqual({ action: 'review', reasons: [`Controllo ${severity}.`] });
    }
  });

  it('asks for a reading that is not recognised, and for a proposal of kind none', async () => {
    const { result, proposal } = await billCase(PDF, { status: 'da-confermare' });
    const decision = decideRegistration({ proposal, result, profile: profile() });
    expect(decision.action).toBe('review');
    expect(decision.reasons.join(' ')).toMatch(/da-confermare/);

    const missing = await billCase(PDF, { fields: { amount: field(null, 'missing') } });
    expect(missing.proposal.kind).toBe('none');
    const none = decideRegistration({ ...missing, profile: profile() });
    expect(none.action).toBe('review');
    expect(none.reasons[0]).toMatch(/Nessun documento da registrare/);
  });

  it('asks when the reading was made with another profile, or another revision of it', async () => {
    const { result, proposal } = await billCase();
    const other = decideRegistration({ proposal, result, profile: profile({ id: 'prof-gas' }) });
    expect(other.action).toBe('review');
    const changed = decideRegistration({ proposal, result, profile: profile({ rev: 3 }) });
    expect(changed.action).toBe('review');
    expect(changed.reasons.join(' ')).toMatch(/cambiato/);
  });
});

describe('registerProposal: bills', () => {
  it('registers an automatic bill with one bill.register-auto operation, and can undo it', async () => {
    const store = await withProfiles(new MemoryStore());
    const clock = tickingClock();
    const { result, proposal } = await billCase();
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: PDF, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    const operationId = 'op-bill-1-20261112T090000000Z';
    expect(outcome).toEqual({ status: 'registered', ids: ['bill-1'], operationId });

    const { records } = await loadAll(store, 'bill', BillSchema);
    expect(records.map((b) => b.id)).toEqual(['bill-1']);
    expect(records[0]?.fileHash).toBe(result.fileHash);
    const { operations } = await readJournal(store);
    expect(operations.map((o) => o.kind)).toEqual(['bill.register-auto']);

    await undoOperation(store, operationId, 'carlo', clock, () => 'undo-1');
    const stored = BillSchema.parse(await store.readJson(recordPath('bill', 'bill-1')));
    expect(stored.deleted).toBe(true);
    expect((await loadAll(store, 'bill', BillSchema)).records).toEqual([]);
  });

  it('writes bill.register in manual mode', async () => {
    const store = new MemoryStore();
    const { result, proposal } = await billCase();
    await registerProposal(
      store,
      { proposal, result, bytes: PDF, profileId: 'carlo', mode: 'manual' },
      tickingClock(),
    );
    const { operations } = await readJournal(store);
    expect(operations.map((o) => o.kind)).toEqual(['bill.register']);
  });

  it('reports the same PDF twice as duplicate, with one record', async () => {
    const store = await withProfiles(new MemoryStore());
    const clock = tickingClock();
    const first = await billCase();
    await registerProposal(
      store,
      { ...first, bytes: PDF, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    const again = await billCase();
    const second = proposalFromExtraction(again.result, context(), ids('other'));
    const outcome = await registerProposal(
      store,
      { proposal: second, result: again.result, bytes: PDF, profileId: 'carlo', mode: 'manual' },
      clock,
    );
    expect(outcome).toEqual({ status: 'duplicate', existingId: 'bill-1' });
    expect((await loadAll(store, 'bill', BillSchema)).records).toHaveLength(1);
    expect((await readJournal(store)).operations).toHaveLength(1);
  });

  it('reports the PDF downloaded again as possible-duplicate, even in auto mode (RF 5)', async () => {
    const store = await withProfiles(new MemoryStore());
    const clock = tickingClock();
    const first = await billCase();
    await registerProposal(
      store,
      { ...first, bytes: PDF, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    const result = billResult(await hashBytes(PDF_AGAIN));
    // A context that does not know the first bill: the check cannot catch it, the store must.
    const proposal = proposalFromExtraction(result, context(), ids('again'));
    expect(proposal.checks.every((c) => c.severity === 'ok')).toBe(true);
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: PDF_AGAIN, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    expect(outcome).toEqual({ status: 'possible-duplicate', existingId: 'bill-1' });
    expect((await loadAll(store, 'bill', BillSchema)).records).toHaveLength(1);
    expect((await readJournal(store)).operations).toHaveLength(1);

    // The duplicate checks come before the profile policy: still a duplicate with a draft profile.
    await store.writeJsonAtomic(
      recordPath('supplierProfile', 'prof-luce'),
      profile({ status: 'bozza' }),
    );
    const later = await registerProposal(
      store,
      { proposal, result, bytes: PDF_AGAIN, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    expect(later).toEqual({ status: 'possible-duplicate', existingId: 'bill-1' });
  });

  it('rejects in auto mode a proposal none, a fail, a warn or a field that is not high', async () => {
    const store = await withProfiles(new MemoryStore());
    const clock = tickingClock();
    const base = await billCase();
    const missing = await billCase(PDF, { fields: { amount: field(null, 'missing') } });
    const medium = await billCase(PDF, { fields: { number: field('2026/0042', 'medium') } });
    const cases = [
      { proposal: missing.proposal, result: missing.result },
      { proposal: withCheck(base.proposal, 'fail'), result: base.result },
      { proposal: withCheck(base.proposal, 'warn'), result: base.result },
      medium,
    ];
    for (const c of cases) {
      const outcome = await registerProposal(
        store,
        { ...c, bytes: PDF, profileId: 'carlo', mode: 'auto' },
        clock,
      );
      expect(outcome.status).toBe('rejected');
    }
    expect(await store.list('_app/journal')).toEqual([]);
    expect(await store.list('_app/dati/bill')).toEqual([]);
  });

  it('applies the profile policy in auto mode: rejected unless decideRegistration says auto-register', async () => {
    const clock = tickingClock();
    const { result, proposal } = await billCase();
    const cases: [string, MemoryStore, ExtractionResult, RegExp][] = [
      [
        'draft',
        await withProfiles(new MemoryStore(), profile({ status: 'bozza' })),
        result,
        /bozza/,
      ],
      [
        'autoRegister false',
        await withProfiles(new MemoryStore(), profile({ autoRegister: false })),
        result,
        /conferma sempre/,
      ],
      [
        'rev mismatch',
        await withProfiles(new MemoryStore(), profile({ rev: 2 })),
        result,
        /cambiato dopo la lettura/,
      ],
      ['no profile record', new MemoryStore(), result, /Nessun profilo/],
      [
        'profileId null',
        await withProfiles(new MemoryStore()),
        { ...result, profileId: null, profileRev: null },
        /Nessun profilo/,
      ],
      [
        'deleted profile',
        await withProfiles(new MemoryStore(), profile({ deleted: true })),
        result,
        /Nessun profilo/,
      ],
    ];
    for (const [name, store, read, reason] of cases) {
      const outcome = await registerProposal(
        store,
        { proposal, result: read, bytes: PDF, profileId: 'carlo', mode: 'auto' },
        clock,
      );
      expect(outcome.status, name).toBe('rejected');
      if (outcome.status === 'rejected') expect(outcome.reason, name).toMatch(reason);
      expect(await store.list('_app/journal'), name).toEqual([]);
      expect(await store.list('_app/dati/bill'), name).toEqual([]);
    }
  });

  it('uses the profile only in auto mode: manual mode registers with a draft profile', async () => {
    const store = await withProfiles(new MemoryStore(), profile({ status: 'bozza' }));
    const { result, proposal } = await billCase();
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: PDF, profileId: 'carlo', mode: 'manual' },
      tickingClock(),
    );
    expect(outcome.status).toBe('registered');
  });

  it('rejects a proposal none in manual mode too: there is nothing to write', async () => {
    const store = new MemoryStore();
    const missing = await billCase(PDF, { fields: { amount: field(null, 'missing') } });
    const outcome = await registerProposal(
      store,
      { ...missing, bytes: PDF, profileId: 'carlo', mode: 'manual' },
      tickingClock(),
    );
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toMatch(/importo/);
  });

  it('registers in manual mode a proposal with a fail the person confirmed', async () => {
    const store = new MemoryStore();
    const { result, proposal } = await billCase();
    const outcome = await registerProposal(
      store,
      {
        proposal: withCheck(proposal, 'fail'),
        result,
        bytes: PDF,
        profileId: 'carlo',
        mode: 'manual',
      },
      tickingClock(),
    );
    expect(outcome.status).toBe('registered');
  });

  it('rejects bytes that are not the file that was read', async () => {
    const store = new MemoryStore();
    const { result, proposal } = await billCase();
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: PDF_AGAIN, profileId: 'carlo', mode: 'manual' },
      tickingClock(),
    );
    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'Il file non è quello letto: va letto di nuovo.',
    });
    expect(await store.list('_app/journal')).toEqual([]);
  });
});

describe('registerProposal: retry after a failed write (R68)', () => {
  it('gives the retry its own operation, listed in the journal and undoable', async () => {
    const store = new FailingRecordStore();
    store.failNext = false;
    await withProfiles(store);
    store.failNext = true;
    const clock = tickingClock();
    const { result, proposal } = await billCase();
    const input = { proposal, result, bytes: PDF, profileId: 'carlo', mode: 'auto' as const };
    await expect(registerProposal(store, input, clock)).rejects.toThrow(/EIO/);
    expect(await store.list('_app/journal')).toHaveLength(1);
    expect(await store.readJson(recordPath('bill', 'bill-1'))).toBeUndefined();

    const retry = await registerProposal(store, input, clock);
    if (retry.status !== 'registered') throw new Error(`expected registered, got ${retry.status}`);
    const { operations, problems } = await readJournal(store);
    expect(problems.filter((p) => p.reason === 'duplicate-id')).toEqual([]);
    expect(operations.map((o) => o.id)).toContain(retry.operationId);
    expect(new Set(operations.map((o) => o.id)).size).toBe(operations.length);

    await undoOperation(store, retry.operationId, 'carlo', clock, () => 'undo-1');
    const stored = BillSchema.parse(await store.readJson(recordPath('bill', 'bill-1')));
    expect(stored.deleted).toBe(true);
  });

  it('does the same for confirmProfile', async () => {
    const store = new FailingRecordStore();
    store.failNext = false;
    const clock = tickingClock();
    const draft = profile({ status: 'bozza' });
    await store.writeJsonAtomic(recordPath('supplierProfile', draft.id), draft);
    store.failNext = true;
    await expect(confirmProfile(store, draft, 'carlo', clock)).rejects.toThrow(/EIO/);
    const confirmed = await confirmProfile(store, draft, 'carlo', clock);
    expect(confirmed.status).toBe('confermato');

    const { operations, problems } = await readJournal(store);
    expect(problems.filter((p) => p.reason === 'duplicate-id')).toEqual([]);
    expect(operations).toHaveLength(2);
    expect(new Set(operations.map((o) => o.id)).size).toBe(2);
    const retryOp = operations.at(-1);
    await undoOperation(store, retryOp?.id ?? '', 'carlo', clock, () => 'undo-1');
    const undone = SupplierProfileSchema.parse(
      await store.readJson(recordPath('supplierProfile', draft.id)),
    );
    expect(undone.status).toBe('bozza');
  });
});

describe('registerProposal: TARI', () => {
  async function tariCase(prefix = 'i') {
    const result = tariResult(await hashBytes(TARI_PDF));
    const proposal = proposalFromExtraction(result, tariContext(), ids(prefix));
    if (proposal.kind !== 'tari') throw new Error('expected tari');
    return { result, proposal };
  }

  it('writes one instalment per apartment in one operation, and one undo removes both', async () => {
    const store = new MemoryStore();
    const clock = tickingClock();
    const { result, proposal } = await tariCase();
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: TARI_PDF, profileId: 'carlo', mode: 'manual' },
      clock,
    );
    const newIds = proposal.instalments.map((i) => i.id);
    const operationId = `op-${String(newIds[0])}-20261112T090000000Z`;
    expect(outcome).toEqual({ status: 'registered', ids: newIds, operationId });

    const { records } = await loadAll(store, 'instalment', InstalmentSchema);
    expect(records.map((i) => i.apartmentId).sort()).toEqual(['apt-b', 'apt-l']);
    expect(records.every((i) => i.fileHash === result.fileHash)).toBe(true);
    const { operations } = await readJournal(store);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe('instalment.register');
    expect(operations[0]?.changes).toHaveLength(2);
    expect(operations[0]?.apartmentId).toBeUndefined();

    await undoOperation(store, operationId, 'carlo', clock, () => 'undo-1');
    expect((await loadAll(store, 'instalment', InstalmentSchema)).records).toEqual([]);
    const all = await loadAll(store, 'instalment', InstalmentSchema, { includeDeleted: true });
    expect(all.records.map((i) => i.deleted)).toEqual([true, true]);
  });

  it('reports the same notice registered again as duplicate', async () => {
    const store = new MemoryStore();
    const clock = tickingClock();
    const first = await tariCase();
    await registerProposal(
      store,
      { ...first, bytes: TARI_PDF, profileId: 'carlo', mode: 'manual' },
      clock,
    );
    const again = await tariCase('j');
    const outcome = await registerProposal(
      store,
      { ...again, bytes: TARI_PDF, profileId: 'carlo', mode: 'manual' },
      clock,
    );
    expect(outcome).toEqual({ status: 'duplicate', existingId: first.proposal.instalments[0]?.id });
    expect((await loadAll(store, 'instalment', InstalmentSchema)).records).toHaveLength(2);
    expect((await readJournal(store)).operations).toHaveLength(1);
  });

  it('reports the notice downloaded again as possible-duplicate, and auto writes instalment.register-auto', async () => {
    const store = await withProfiles(new MemoryStore(), tariProfile());
    const clock = tickingClock();
    const first = await tariCase();
    const auto = await registerProposal(
      store,
      { ...first, bytes: TARI_PDF, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    expect(auto.status).toBe('registered');
    expect((await readJournal(store)).operations[0]?.kind).toBe('instalment.register-auto');

    const other = encoder.encode('%PDF-1.7 avviso TARI sintetico, riscaricato');
    const result = tariResult(await hashBytes(other));
    const proposal = proposalFromExtraction(result, tariContext(), ids('k'));
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: other, profileId: 'carlo', mode: 'auto' },
      clock,
    );
    expect(outcome.status).toBe('possible-duplicate');
    expect((await loadAll(store, 'instalment', InstalmentSchema)).records).toHaveLength(2);
  });

  it('rejects an automatic TARI notice when its profile asks to confirm', async () => {
    const store = await withProfiles(new MemoryStore(), tariProfile({ autoRegister: false }));
    const { result, proposal } = await tariCase();
    const outcome = await registerProposal(
      store,
      { proposal, result, bytes: TARI_PDF, profileId: 'carlo', mode: 'auto' },
      tickingClock(),
    );
    expect(outcome.status).toBe('rejected');
    expect(await store.list('_app/dati/instalment')).toEqual([]);
  });

  it('rejects a TARI proposal without instalments', async () => {
    const store = new MemoryStore();
    const { result, proposal } = await tariCase();
    const outcome = await registerProposal(
      store,
      {
        proposal: { ...proposal, instalments: [] },
        result,
        bytes: TARI_PDF,
        profileId: 'carlo',
        mode: 'manual',
      },
      tickingClock(),
    );
    expect(outcome.status).toBe('rejected');
  });

  it('sets the apartment of the operation for a notice of a single apartment', async () => {
    const store = new MemoryStore();
    const { result, proposal } = await tariCase();
    const single = { ...proposal, instalments: proposal.instalments.slice(0, 1) };
    await registerProposal(
      store,
      { proposal: single, result, bytes: TARI_PDF, profileId: 'carlo', mode: 'manual' },
      tickingClock(),
    );
    expect((await readJournal(store)).operations[0]?.apartmentId).toBe('apt-b');
  });
});

describe('confirmProfile and setProfileAutoRegister', () => {
  async function storedProfile(store: MemoryStore, extra: Partial<SupplierProfile> = {}) {
    const p = profile({ status: 'bozza', autoRegister: true, ...extra });
    await store.writeJsonAtomic(recordPath('supplierProfile', p.id), p);
    return p;
  }

  it('confirms a draft profile with one profile.confirm operation, once', async () => {
    const store = new MemoryStore();
    const clock = tickingClock();
    const draft = await storedProfile(store);
    const confirmed = await confirmProfile(store, draft, 'carlo', clock);
    expect(confirmed).toMatchObject({ status: 'confermato', rev: 2 });
    expect(
      SupplierProfileSchema.parse(await store.readJson(recordPath('supplierProfile', draft.id))),
    ).toEqual(confirmed);
    const again = await confirmProfile(store, confirmed, 'carlo', clock);
    expect(again).toBe(confirmed);
    const { operations } = await readJournal(store);
    expect(operations.map((o) => o.kind)).toEqual(['profile.confirm']);
  });

  it('sets «conferma sempre» per supplier, and writes nothing when it does not change', async () => {
    const store = new MemoryStore();
    const clock = tickingClock();
    const p = await storedProfile(store, { status: 'confermato' });
    const always = await setProfileAutoRegister(store, p, false, 'carlo', clock);
    expect(always).toMatchObject({ autoRegister: false, rev: 2 });
    expect(await setProfileAutoRegister(store, always, false, 'carlo', clock)).toBe(always);
    const back = await setProfileAutoRegister(store, always, true, 'carlo', clock);
    expect(back).toMatchObject({ autoRegister: true, rev: 3 });
    const { operations, problems } = await readJournal(store);
    expect(problems).toEqual([]);
    expect(operations.map((o) => o.kind)).toEqual([
      'profile.auto-register',
      'profile.auto-register',
    ]);
    expect(new Set(operations.map((o) => o.id)).size).toBe(2);
  });

  it('can undo a confirmation and confirm again', async () => {
    const store = new MemoryStore();
    const clock = tickingClock();
    const draft = await storedProfile(store);
    await confirmProfile(store, draft, 'carlo', clock);
    const [op] = (await readJournal(store)).operations;
    await undoOperation(store, op?.id ?? '', 'carlo', clock, () => 'undo-1');
    const undone = SupplierProfileSchema.parse(
      await store.readJson(recordPath('supplierProfile', draft.id)),
    );
    expect(undone.status).toBe('bozza');
    const again = await confirmProfile(store, undone, 'carlo', clock);
    expect(again.status).toBe('confermato');
    const { operations, problems } = await readJournal(store);
    expect(problems).toEqual([]);
    expect(operations).toHaveLength(3);
  });
});
