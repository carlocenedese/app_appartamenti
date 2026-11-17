/**
 * The whole path from a PDF to a registered bill, with the real Python reader: synthetic PDFs in
 * a temporary folder (with spaces and accents) → `python -I -m bollette_pdf extract` →
 * `proposalFromExtraction` → `decideRegistration` → `registerProposal` → `undoOperation`.
 *
 * Without a Python that runs `bollette_pdf` the tests are skipped, except with REQUIRE_PYTHON=1
 * (set by the CI), where they fail with the reason. Every file is written by
 * python/tests/make_sample.py: invented supplier, numbers, amounts and dates.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BillSchema,
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
import type { ExtractionResult, ProposalContext, SupplierProfile } from '../src/index';
import { MemoryStore } from './helpers/memory-store';
import { pythonAvailability, runExtract, runPython } from './helpers/python-extract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MAKE_SAMPLE = join(REPO, 'python', 'tests', 'make_sample.py');
const PROFILE_ID = 'luce-esempio';
const POD = 'IT001E12345678'; // the fictitious POD of fixtures/README.md
const AT = '2026-11-12T09:00:00Z';
const ACCENTED_NAME = 'bolletta di marzo città.pdf'.normalize('NFC');
const TIMEOUT = 60_000;

const availability = pythonAvailability();
const required = process.env.REQUIRE_PYTHON === '1';

function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 12, 9, 0, 0, tick++)).toISOString();
}

function ids(prefix: string): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count)}`;
}

const tenancy = {
  id: 'ten-1',
  v: 1 as const,
  rev: 1,
  apartmentId: 'apt-1',
  tenantId: 't-1',
  from: '2025-01',
  monthlyRent: 40000,
  monthlyForfait: 5000,
};

async function context(store: MemoryStore): Promise<ProposalContext> {
  return {
    apartment: { id: 'apt-1', knownCodes: [POD] },
    bills: (await loadAll(store, 'bill', BillSchema)).records,
    instalments: [],
    tenancies: [tenancy] as ProposalContext['tenancies'],
    thresholds: { consumptionAnomalyPercent: 30 },
  };
}

if (!availability.available && required) {
  describe('core and the Python reader', () => {
    it('needs Python with bollette_pdf (REQUIRE_PYTHON=1)', () => {
      throw new Error(
        `REQUIRE_PYTHON=1 ma Python non è disponibile: ${availability.reason} ` +
          'Installare python/requirements.txt, poi «pnpm python:dev-install».',
      );
    });
  });
}

describe.skipIf(!availability.available)('core and the Python reader', () => {
  let root = '';
  let folder = '';
  let profiles = '';
  const pdf = (name: string) => join(folder, name);
  const extract = (name: string, options = {}) =>
    runExtract({ pdf: pdf(name), profiles, at: AT }, { cwd: root, ...options });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'bollette-integrazione-'));
    folder = join(root, 'Bollette di prova', 'Città è'.normalize('NFC'));
    mkdirSync(folder, { recursive: true });
    await runPython(['-I', MAKE_SAMPLE, folder], { cwd: root });
    copyFileSync(pdf('bolletta-marzo.pdf'), pdf(ACCENTED_NAME));
    profiles = join(folder, '_app', 'dati', 'supplierProfile');
  }, TIMEOUT);

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  /** Writes the profile as the store holds it to the folder the reader looks in. */
  function mirrorProfile(store: MemoryStore): void {
    const path = recordPath('supplierProfile', PROFILE_ID);
    expect(path).toBe(`_app/dati/supplierProfile/${PROFILE_ID}.json`);
    writeFileSync(join(folder, ...path.split('/')), store.getRaw(path) ?? '', 'utf8');
  }

  async function loadDraft(store: MemoryStore): Promise<SupplierProfile> {
    const raw: unknown = JSON.parse(readFileSync(join(profiles, `${PROFILE_ID}.json`), 'utf8'));
    const draft = SupplierProfileSchema.parse(raw);
    await store.writeJsonAtomic(recordPath('supplierProfile', draft.id), draft);
    return draft;
  }

  it(
    'reads a bill in a folder with spaces and accents, with every field high',
    async () => {
      const result = await extract(ACCENTED_NAME);
      expect(result.fileName).toBe(ACCENTED_NAME);
      expect(result.fileHash).toBe(await hashBytes(readFileSync(pdf(ACCENTED_NAME))));
      expect(result).toMatchObject({
        status: 'riconosciuta',
        profileId: PROFILE_ID,
        profileRev: 1,
        kind: 'bill',
        category: 'elettricita',
        identifiers: [{ kind: 'pod', value: POD }],
      });
      expect(result.fields.amount?.value).toBe(6430);
      expect(result.fields.number?.value).toBe('LE-2026-0101');
      expect(result.fields.periodStart?.value).toBe('2026-01-01');
      expect(result.fields.periodEnd?.value).toBe('2026-02-28');
      const confidences = Object.values(result.fields).map((f) => f?.confidence);
      expect(new Set(confidences)).toEqual(new Set(['high']));
    },
    TIMEOUT,
  );

  it(
    'asks with a draft profile, registers by itself once it is confirmed, undoes, finds duplicates',
    async () => {
      const store = new MemoryStore();
      const clock = tickingClock();
      const draft = await loadDraft(store);

      // First bill: the profile is a draft, so a person confirms the reading.
      const march = await extract('bolletta-marzo.pdf');
      const marchBytes = readFileSync(pdf('bolletta-marzo.pdf'));
      const marchProposal = proposalFromExtraction(march, await context(store), ids('marzo'));
      expect(marchProposal.kind).toBe('bill');
      expect(marchProposal.checks.filter((c) => c.severity !== 'ok')).toEqual([]);
      const first = decideRegistration({ proposal: marchProposal, result: march, profile: draft });
      expect(first.action).toBe('review');
      expect(first.reasons.join(' ')).toMatch(/bozza/);
      expect(first.reasons.join(' ')).toMatch(/conferma sempre/);
      const manual = await registerProposal(
        store,
        {
          proposal: marchProposal,
          result: march,
          bytes: marchBytes,
          profileId: 'user1',
          mode: 'manual',
        },
        clock,
      );
      expect(manual).toMatchObject({ status: 'registered', ids: ['marzo-1'] });

      // The owner confirms the profile and turns automatic registration on.
      const confirmed = await confirmProfile(store, draft, 'user1', clock);
      const automatic = await setProfileAutoRegister(store, confirmed, true, 'user1', clock);
      expect(automatic).toMatchObject({ status: 'confermato', autoRegister: true });
      expect(automatic.rev).toBeGreaterThan(draft.rev);
      // A reading made with the old revision is not enough any more.
      const stale = decideRegistration({
        proposal: marchProposal,
        result: march,
        profile: automatic,
      });
      expect(stale.action).toBe('review');
      expect(stale.reasons.join(' ')).toMatch(/cambiato/);
      mirrorProfile(store);

      // A new bill (new number) read with the confirmed profile goes by itself.
      const may = await extract('bolletta-maggio.pdf');
      const mayBytes = readFileSync(pdf('bolletta-maggio.pdf'));
      expect(may.status).toBe('riconosciuta');
      expect(may.profileRev).toBe(automatic.rev);
      expect(may.fields.number?.value).toBe('LE-2026-0177');
      const mayProposal = proposalFromExtraction(may, await context(store), ids('maggio'));
      expect(mayProposal.checks.filter((c) => c.severity !== 'ok')).toEqual([]);
      expect(
        decideRegistration({ proposal: mayProposal, result: may, profile: automatic }),
      ).toEqual({
        action: 'auto-register',
        reasons: [],
        codes: [],
      });
      const registered = await registerProposal(
        store,
        { proposal: mayProposal, result: may, bytes: mayBytes, profileId: 'user1', mode: 'auto' },
        clock,
      );
      expect(registered).toEqual({
        status: 'registered',
        ids: ['maggio-1'],
        operationId: 'op-maggio-1-20261112T090000003Z',
      });
      const stored = BillSchema.parse(await store.readJson(recordPath('bill', 'maggio-1')));
      expect(stored).toMatchObject({
        apartmentId: 'apt-1',
        amount: 5815,
        issueDate: '2026-05-12',
        dueDate: '2026-06-02',
        periodStart: '2026-03-01',
        periodEnd: '2026-04-30',
        fileHash: may.fileHash,
      });
      const { operations } = await readJournal(store);
      expect(operations.map((o) => o.kind)).toEqual([
        'bill.register',
        'profile.confirm',
        'profile.auto-register',
        'bill.register-auto',
      ]);

      // The same PDF a second time, read again with new ids: duplicate, nothing written.
      const again = await extract('bolletta-maggio.pdf');
      const againProposal = proposalFromExtraction(again, await context(store), ids('ancora'));
      const duplicate = await registerProposal(
        store,
        {
          proposal: againProposal,
          result: again,
          bytes: mayBytes,
          profileId: 'user1',
          mode: 'auto',
        },
        clock,
      );
      expect(duplicate).toEqual({ status: 'duplicate', existingId: 'maggio-1' });
      expect((await readJournal(store)).operations).toHaveLength(4);

      // Undo: the bill is deleted (kept on disk), the other bill stays.
      await undoOperation(
        store,
        'op-maggio-1-20261112T090000003Z',
        'user1',
        clock,
        () => 'annulla-1',
      );
      const undone = BillSchema.parse(await store.readJson(recordPath('bill', 'maggio-1')));
      expect(undone.deleted).toBe(true);
      const live = (await loadAll(store, 'bill', BillSchema)).records;
      expect(live.map((b) => b.id)).toEqual(['marzo-1']);
    },
    TIMEOUT,
  );

  it(
    'gives a proposal none and a review for a broken PDF and one without text',
    async () => {
      const store = new MemoryStore();
      const profile = SupplierProfileSchema.parse({
        ...(await loadDraft(store)),
        status: 'confermato',
        autoRegister: true,
      });
      const cases: [string, ExtractionResult['status']][] = [
        ['guasto.pdf', 'illeggibile'],
        ['senza-testo.pdf', 'senza-testo'],
      ];
      for (const [name, status] of cases) {
        const result = await extract(name);
        expect(result.status).toBe(status);
        expect(result.fileName).toBe(name);
        const proposal = proposalFromExtraction(result, await context(store), ids('x'));
        expect(proposal.kind).toBe('none');
        const decision = decideRegistration({ proposal, result, profile });
        expect(decision.action).toBe('review');
        const outcome = await registerProposal(
          store,
          { proposal, result, bytes: readFileSync(pdf(name)), profileId: 'user1', mode: 'auto' },
          tickingClock(),
        );
        expect(outcome.status).toBe('rejected');
      }
      expect(await store.list('_app/journal')).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'gives the same result in every time zone',
    async () => {
      const results = await Promise.all(
        ['UTC', 'Pacific/Auckland', 'America/Los_Angeles'].map((TZ) =>
          extract('bolletta-marzo.pdf', { env: { ...process.env, TZ } }),
        ),
      );
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    },
    TIMEOUT,
  );

  it(
    'rejects with the first line of stderr, a timeout and an oversized answer',
    async () => {
      await expect(
        runExtract({ pdf: join(folder, 'non-esiste.pdf'), profiles, at: AT }, { cwd: root }),
      ).rejects.toThrow(/^Il file indicato con --pdf non esiste o non è un file\.$/);
      await expect(
        runPython(['-I', '-c', 'import time; time.sleep(20)'], { timeoutMs: 300 }),
      ).rejects.toThrow(/nessuna risposta entro 0\.3 s/);
      await expect(
        runPython(['-I', '-c', "print('x' * 100000)"], { maxStdoutBytes: 1000 }),
      ).rejects.toThrow(/troppo grande/);
      await expect(runPython(['-I', '-c', 'import sys; sys.exit(3)'])).rejects.toThrow(/codice 3/);
      await expect(
        runExtract({ pdf: pdf('bolletta-marzo.pdf'), profiles, at: 'domani' }, { cwd: root }),
      ).rejects.toThrow(/--at/);
    },
    TIMEOUT,
  );
});
