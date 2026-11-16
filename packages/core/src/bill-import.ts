/**
 * The import of one read PDF as a procedure of the core (section 22, steps 3 to 8; plan 15): the
 * context of the proposal is read from the store, the proposal is made, and the confirmation policy
 * decides between registering it and leaving it «da rivedere» as a `pendingDocument` (R260). The
 * pieces are those of plans 2a and 2b (`proposalFromExtraction`, `decideRegistration`,
 * `registerProposal`, `undoFile`); here they are put together, after `checkConsistency`.
 *
 * Pure: the clock and the ids come from the caller.
 */
import { decideRegistration, readSupplierProfile, registerProposal } from './confirmation';
import { hashBytes } from './dedupe';
import { hasOcrReading } from './extraction';
import type { ExtractionResult } from './extraction';
import { checkConsistency, commitChange } from './journal';
import type { Operation } from './journal';
import {
  ApartmentSchema,
  BillMatchSchema,
  BillSchema,
  InstalmentSchema,
  PendingDocumentSchema,
  SupplySchema,
  TenancySchema,
  TenantRecoverySchema,
} from './model';
import type { FileDocument, PendingDocument } from './model';
import { parseOrThrow } from './parse';
import { proposalFromExtraction } from './proposal';
import type { ProposalCheck } from './proposal';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { undoFile } from './undo-file';

export type ImportBillResult =
  | {
      status: 'registrata-automaticamente' | 'confermata';
      ids: string[];
      operationId: string;
      checks: ProposalCheck[];
    }
  | {
      status: 'da-rivedere';
      pendingId: string;
      /** Absent when the same document was already waiting: nothing was written. */
      operationId?: string;
      /** Sorted codes of what sends it to a person; `reasons` are the Italian messages. */
      codes: string[];
      reasons: string[];
      checks: ProposalCheck[];
    }
  | { status: 'duplicate' | 'possible-duplicate'; existingId: string }
  | { status: 'rejected'; reason: string; checks: ProposalCheck[] }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' };

export interface ImportBillInput {
  result: ExtractionResult;
  bytes: Uint8Array;
  apartmentId: string;
  /** POD, PDR and customer codes of the apartment (R261): no record keeps them yet. */
  knownCodes: string[];
  /** From the user's configuration, never from the code (R262). */
  thresholds: { consumptionAnomalyPercent: number };
  /** `auto`: the policy decides; `manual`: a person confirmed the proposal. */
  mode: 'auto' | 'manual';
}

/** The part of the file read, as `registerProposal` writes it: absent for the whole file. */
function fileDocumentOf(result: ExtractionResult): FileDocument | undefined {
  const range = result.pageRange;
  return range !== null && !(range[0] === 1 && range[1] === result.pages)
    ? { pages: range, documentKind: result.documentKind }
    : undefined;
}

const samePages = (a?: readonly number[], b?: readonly number[]): boolean =>
  a?.[0] === b?.[0] && a?.[1] === b?.[1];

/** The live bills and instalments registered from `fileHash`. */
async function registeredFrom(store: Store, fileHash: string) {
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records;
  return [...bills, ...instalments].filter((r) => r.fileHash === fileHash);
}

/** Why the policy sends the reading to a person, as codes (the messages are the reasons). */
function reviewCodes(
  input: ImportBillInput,
  checks: ProposalCheck[],
  profileOk: boolean,
): string[] {
  const { result } = input;
  const codes = checks.filter((c) => c.severity !== 'ok').map((c) => c.code);
  if (!profileOk) codes.push('profile');
  if (result.textSource === 'ocr' || (result.textSource === 'mixed' && hasOcrReading(result))) {
    codes.push('ocr');
  }
  if (result.status !== 'riconosciuta') codes.push('reading-status');
  for (const [name, field] of Object.entries(result.fields)) {
    if (field !== undefined && (field.confidence !== 'high' || field.value === null)) {
      codes.push(`field:${name}`);
    }
  }
  if (input.knownCodes.length === 0) codes.push('apartment-codes-unknown');
  return [...new Set(codes)].sort();
}

/**
 * Imports the PDF `bytes`, read as `input.result`, for `input.apartmentId`:
 *
 * - `refused` while `checkConsistency` reports a problem, or for an apartment that is not live;
 * - `rejected` for bytes that are not the file read, or with `manual` for a proposal with nothing
 *   to register; nothing is written;
 * - with `auto`, when `decideRegistration` calls it `auto-register` and `knownCodes` is not empty
 *   (R261), the registration of `registerProposal` (`registrata-automaticamente`); otherwise, unless
 *   the same file and pages are already registered (`duplicate`), `da-rivedere`: a
 *   `pendingDocument` is created with one operation `document.review`, or, when a live one of the
 *   same file and pages is there, nothing is written (idempotent);
 * - with `manual`, `registerProposal` in mode `manual` (`confermata`).
 *
 * `duplicate` and `possible-duplicate` are those of `registerProposal`. Undo with
 * `undoBillImport`.
 */
export async function importBill(
  store: Store,
  input: ImportBillInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ImportBillResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const { result, bytes, apartmentId, mode } = input;
  const apartment = (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
    (a) => a.id === apartmentId,
  );
  if (apartment === undefined) return { status: 'refused', reason: 'unknown-apartment' };
  if ((await hashBytes(bytes)) !== result.fileHash) {
    return {
      status: 'rejected',
      reason: 'Il file non è quello letto: va letto di nuovo.',
      checks: [],
    };
  }

  const proposal = proposalFromExtraction(
    result,
    {
      apartment: { id: apartmentId, knownCodes: input.knownCodes },
      bills: (await loadAll(store, 'bill', BillSchema)).records,
      instalments: (await loadAll(store, 'instalment', InstalmentSchema)).records,
      tenancies: (await loadAll(store, 'tenancy', TenancySchema)).records,
      supplies: (await loadAll(store, 'supply', SupplySchema)).records,
      thresholds: input.thresholds,
    },
    newId,
  );
  const { checks } = proposal;
  const register = async (how: 'auto' | 'manual'): Promise<ImportBillResult> => {
    const written = await registerProposal(
      store,
      { proposal, result, bytes, profileId, mode: how },
      clock,
    );
    if (written.status === 'rejected') return { ...written, checks };
    if (written.status !== 'registered') return written;
    return {
      status: how === 'auto' ? 'registrata-automaticamente' : 'confermata',
      ids: written.ids,
      operationId: written.operationId,
      checks,
    };
  };
  if (mode === 'manual') return register('manual');

  const profile = await readSupplierProfile(store, result);
  const decision = decideRegistration({ proposal, result, profile });
  if (decision.action === 'auto-register' && input.knownCodes.length > 0) return register('auto');

  const pages = fileDocumentOf(result)?.pages;
  const known = (await registeredFrom(store, result.fileHash)).find((r) =>
    samePages(r.fileDocument?.pages, pages),
  );
  if (known !== undefined) return { status: 'duplicate', existingId: known.id };
  const profileOk =
    profile !== undefined &&
    profile.status === 'confermato' &&
    profile.autoRegister &&
    result.profileId === profile.id &&
    result.profileRev === profile.rev;
  const codes = reviewCodes(input, checks, profileOk);
  const reasons =
    input.knownCodes.length === 0
      ? [...decision.reasons, "Nessun codice dell'appartamento noto: la lettura va controllata."]
      : decision.reasons;
  const waiting = (await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records.find(
    (d) =>
      d.fileHash === result.fileHash && d.apartmentId === apartmentId && samePages(d.pages, pages),
  );
  if (waiting !== undefined) {
    return { status: 'da-rivedere', pendingId: waiting.id, codes, reasons, checks };
  }
  const record = parseOrThrow(
    PendingDocumentSchema,
    {
      id: `doc-${newId()}`,
      v: 1,
      rev: 1,
      apartmentId,
      fileHash: result.fileHash,
      ...(pages === undefined ? {} : { pages }),
      documentKind: result.documentKind,
      codes,
    },
    'pending document',
  );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'document.review',
      apartmentId,
      summary: 'Documento da rivedere',
      changes: [
        { path: recordPath('pendingDocument', record.id), before: undefined, after: record },
      ],
    },
    clock,
    newId,
  );
  return {
    status: 'da-rivedere',
    pendingId: record.id,
    operationId: operation.id,
    codes,
    reasons,
    checks,
  };
}

/**
 * The live documents still «da rivedere»: a `pendingDocument` with no live bill or instalment
 * of the same file and pages (R260), sorted by id.
 */
export async function pendingDocuments(store: Store): Promise<PendingDocument[]> {
  const docs = (await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records;
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records;
  const registered = [...bills, ...instalments];
  return docs.filter(
    (d) =>
      !registered.some(
        (r) => r.fileHash === d.fileHash && samePages(r.fileDocument?.pages, d.pages),
      ),
  );
}

export type UndoBillImportResult =
  | { status: 'undone'; operations: Operation[] }
  | { status: 'refused'; reason: 'inconsistent-store' }
  /** A live match or recovery uses a record of the file: undo those first. */
  | { status: 'refused'; reason: 'has-dependents'; recordIds: string[] };

/**
 * Takes back everything the import of `fileHash` created (bills, instalments, the document to
 * review), with `undoFile`; an empty list when nothing is left. Refused while `checkConsistency`
 * reports a problem, and while a live `match` or `tenantRecovery` points at one of its records
 * (the journal only sees paths, so `undoFile` would leave them pointing at a deleted record).
 */
export async function undoBillImport(
  store: Store,
  fileHash: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<UndoBillImportResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const ids = new Set((await registeredFrom(store, fileHash)).map((r) => r.id));
  const matches = (await loadAll(store, 'match', BillMatchSchema)).records.filter((m) =>
    ids.has(m.itemId),
  );
  const recoveries = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records.filter(
    (r) => ids.has(r.instalmentId),
  );
  const recordIds = [...matches, ...recoveries].map((r) => r.id).sort();
  if (recordIds.length > 0) return { status: 'refused', reason: 'has-dependents', recordIds };
  return { status: 'undone', operations: await undoFile(store, fileHash, profileId, clock, newId) };
}
