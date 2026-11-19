/**
 * The import of one read PDF as a procedure of the core (section 22, steps 3 to 8; plan 15): the
 * context of the proposal is read from the store, the proposal is made, and the confirmation policy
 * decides between registering it and leaving it «da rivedere» as a `pendingDocument` (R260). The
 * pieces are those of plans 2a and 2b (`proposalFromExtraction`, `decideRegistration`,
 * `registerProposal`, `undoFile`); here they are put together, after `checkConsistency`.
 *
 * Pure: the clock and the ids come from the caller.
 */
import {
  decideRegistration,
  fileDocumentOf,
  findProposalDuplicate,
  readSupplierProfile,
  registerProposal,
} from './confirmation';
import { compareConsumption, worstLevel } from './consumption';
import { withContractEnds } from './contract';
import type { ConsumptionComparison, ConsumptionMetric } from './consumption';
import { consumptionThresholdsFor } from './consumption-store';
import { hashBytes, samePages } from './dedupe';
import type { ExtractionResult } from './extraction';
import { commitChange, writesBlocked } from './journal';
import type { Operation } from './journal';
import {
  ApartmentSchema,
  BillMatchSchema,
  BillSchema,
  ConsumptionSettingsSchema,
  ContractSchema,
  InstalmentSchema,
  OriginalFileNameSchema,
  PendingDocumentSchema,
  SupplySchema,
  TenancySchema,
  TenantRecoverySchema,
} from './model';
import type { Apartment, PendingDocument } from './model';
import { apartmentFolder } from './accounts';
import { parseOrThrow } from './parse';
import { proposalFromExtraction, tariNoticePath } from './proposal';
import type { Proposal, ProposalCheck } from './proposal';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { undoFile } from './undo-file';

/**
 * The consumption alarm of a bill proposal (plan 19, R330): `compareConsumption` with the
 * thresholds of the apartment (`consumptionThresholdsFor`); `thresholds` false when none is set,
 * and then no level.
 */
export type ConsumptionAlarm = ConsumptionComparison & { thresholds: boolean };

export type ImportBillResult =
  | {
      status: 'registrata-automaticamente' | 'confermata';
      ids: string[];
      operationId: string;
      checks: ProposalCheck[];
      consumption?: ConsumptionAlarm;
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
      consumption?: ConsumptionAlarm;
    }
  | { status: 'duplicate' | 'possible-duplicate'; existingId: string }
  | { status: 'rejected'; reason: string; checks: ProposalCheck[] }
  | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' };

/**
 * Where the PDF of a registered bill goes, and where an undo brings it back (answer of user1, 17
 * November 2026, R315): `filed` is `<Appartamento>/<bill.filePath>`, `inbox` the `Da_smistare`
 * of the apartment with the same name. Paths relative to the shared folder; the caller moves the
 * file, never over another one.
 */
export function billFileMove(
  apartment: Pick<Apartment, 'name'>,
  filePath: string,
  /** F9 c (plan 25): the name the PDF had before; the undo gives it back. */
  originalName?: string,
): { filed: string; inbox: string } {
  const folder = apartmentFolder(apartment.name);
  const name = originalName ?? filePath.split('/').pop() ?? filePath;
  return { filed: `${folder}/${filePath}`, inbox: `${folder}/Da_smistare/${name}` };
}

export interface ImportBillInput {
  result: ExtractionResult;
  bytes: Uint8Array;
  apartmentId: string;
  /**
   * POD, PDR and customer codes of the apartment (R261) given by the caller; absent, those kept
   * in `Apartment.supplyCodes` (plan 17, R314).
   */
  knownCodes?: string[];
  /**
   * The old check `consumption-anomaly` (R262), only when the caller gives it; the alarm reads the
   * thresholds of `consumptionSettings` (plan 19, R330).
   */
  thresholds?: { consumptionAnomalyPercent: number };
  /** `auto`: the policy decides; `manual`: a person confirmed the proposal. */
  mode: 'auto' | 'manual';
}

const METRIC_LABELS: Record<ConsumptionMetric, string> = {
  consumption: 'consumo',
  amount: 'importo',
  unitPrice: 'prezzo unitario',
};

/** Basis points as an Italian percentage with sign, `+40,00 %`. */
function percentText(bp: number): string {
  const abs = Math.abs(bp);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${bp < 0 ? '-' : '+'}${String(Math.trunc(abs / 100))},${fraction} %`;
}

/** The warning of the alarm: every difference with a level, by side. */
function alarmMessage(comparison: ConsumptionComparison): string {
  const sides = [
    ["rispetto allo stesso periodo dell'anno prima", comparison.yearBefore],
    ['rispetto alla media dei mesi prima', comparison.recent],
  ] as const;
  const parts = sides.flatMap(([where, side]) =>
    (side?.differences ?? [])
      .filter((d) => d.level !== undefined)
      .map(
        (d) =>
          `${METRIC_LABELS[d.metric]} ${percentText(d.differenceBp)} ${where} (${d.level ?? ''})`,
      ),
  );
  return `Allarme consumi: ${parts.join('; ')}.`;
}

/** How two page ranges of one file compare (`samePages` of `dedupe.ts`; absent = whole file). */
const pagesCompare = (a?: [number, number], b?: [number, number]) =>
  samePages(
    a === undefined ? undefined : { pages: a, documentKind: 'unknown' },
    b === undefined ? undefined : { pages: b, documentKind: 'unknown' },
  );

/** The live bills and instalments registered from `fileHash`. */
async function registeredFrom(store: Store, fileHash: string) {
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records;
  return [...bills, ...instalments].filter((r) => r.fileHash === fileHash);
}

/**
 * Imports the PDF `bytes`, read as `input.result`, for `input.apartmentId`:
 *
 * - `refused` while `checkConsistency` reports a problem, or for an apartment that is not live;
 * - `rejected` for bytes that are not the file read, or with `manual` for a proposal with nothing
 *   to register; nothing is written;
 * - with `auto`, when `decideRegistration` calls it `auto-register` and `knownCodes` is not empty
 *   (R261), the registration of `registerProposal` (`registrata-automaticamente`); otherwise the
 *   duplicate `registerProposal` would report (`findProposalDuplicate`: `duplicate` or
 *   `possible-duplicate`, nothing written), else `da-rivedere` with the codes of
 *   `decideRegistration` (plus `apartment-codes-unknown`): a `pendingDocument` is created with one
 *   operation `document.review`, or, when a live one of the same file, pages and apartment is
 *   there, nothing is written (idempotent);
 * - with `manual`, `registerProposal` in mode `manual` (`confermata`).
 *
 * Undo with `undoBillImport`.
 */
export async function importBill(
  store: Store,
  input: ImportBillInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ImportBillResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const { result, bytes, apartmentId, mode } = input;
  const apartment = (await loadAll(store, 'apartment', ApartmentSchema)).records.find(
    (a) => a.id === apartmentId,
  );
  if (apartment === undefined) return { status: 'refused', reason: 'unknown-apartment' };
  const knownCodes = input.knownCodes ?? apartment.supplyCodes ?? [];
  if ((await hashBytes(bytes)) !== result.fileHash) {
    return {
      status: 'rejected',
      reason: 'Il file non è quello letto: va letto di nuovo.',
      checks: [],
    };
  }

  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const thresholds = consumptionThresholdsFor(
    (await loadAll(store, 'consumptionSettings', ConsumptionSettingsSchema)).records,
    apartmentId,
  );
  // With thresholds set, one warning only: the alarm, not the old check of the caller (R330).
  const legacy = thresholds === undefined ? input.thresholds : undefined;
  const proposal = proposalFromExtraction(
    result,
    {
      apartment: { id: apartmentId, knownCodes },
      bills,
      instalments: (await loadAll(store, 'instalment', InstalmentSchema)).records,
      // F9 a: a stay without end lasts until the end of its contract (`period-tenancies`).
      tenancies: withContractEnds(
        (await loadAll(store, 'tenancy', TenancySchema)).records,
        (await loadAll(store, 'contract', ContractSchema)).records,
      ),
      supplies: (await loadAll(store, 'supply', SupplySchema)).records,
      ...(legacy === undefined ? {} : { thresholds: legacy }),
    },
    newId,
  );
  // Plan 19, R330: a level of the thresholds typed by user1 sends the bill to a person.
  let consumption: ConsumptionAlarm | undefined;
  if (proposal.kind === 'bill') {
    const comparison = compareConsumption(
      proposal.bill,
      bills,
      thresholds === undefined ? {} : { thresholds },
    );
    consumption = { ...comparison, thresholds: thresholds !== undefined };
    if (worstLevel(comparison) !== undefined) {
      proposal.checks.push({
        code: 'consumption-alarm',
        severity: 'warn',
        message: alarmMessage(comparison),
      });
    }
  }
  const withAlarm = consumption === undefined ? {} : { consumption };
  const { checks } = proposal;
  // F9 c (plan 25): the name the PDF had (a bare safe name only) and, for a TARI notice, where
  // its PDF is filed, on the instalments of this apartment (the folder the file goes to).
  const original = OriginalFileNameSchema.safeParse(result.fileName.normalize('NFC'));
  const named = original.success ? { originalName: original.data } : {};
  // One path per notice, from all the months of this apartment's instalments (R369, round 3).
  const noticePath =
    proposal.kind === 'tari'
      ? tariNoticePath(proposal.instalments.filter((i) => i.apartmentId === apartmentId))
      : undefined;
  const filed: Proposal =
    proposal.kind === 'bill'
      ? { ...proposal, bill: { ...proposal.bill, ...named } }
      : proposal.kind === 'tari'
        ? {
            ...proposal,
            instalments: proposal.instalments.map((i) =>
              i.apartmentId === apartmentId && noticePath !== undefined
                ? { ...i, filePath: noticePath, ...named }
                : i,
            ),
          }
        : proposal;
  const register = async (how: 'auto' | 'manual'): Promise<ImportBillResult> => {
    const written = await registerProposal(
      store,
      { proposal: filed, result, bytes, profileId, mode: how },
      clock,
    );
    if (written.status === 'rejected') return { ...written, checks };
    if (written.status !== 'registered') return written;
    return {
      status: how === 'auto' ? 'registrata-automaticamente' : 'confermata',
      ids: written.ids,
      operationId: written.operationId,
      checks,
      ...withAlarm,
    };
  };
  if (mode === 'manual') return register('manual');

  const profile = await readSupplierProfile(store, result);
  const decision = decideRegistration({ proposal, result, profile });
  const noCodes = knownCodes.length === 0;
  if (decision.action === 'auto-register' && !noCodes) return register('auto');

  const known = await findProposalDuplicate(store, proposal, result);
  if (known !== undefined) return known;
  const codes = noCodes ? [...decision.codes, 'apartment-codes-unknown'].sort() : decision.codes;
  const reasons = noCodes
    ? [...decision.reasons, "Nessun codice dell'appartamento noto: la lettura va controllata."]
    : decision.reasons;
  const pages = fileDocumentOf(result)?.pages;
  const waiting = (await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records.find(
    (d) =>
      d.fileHash === result.fileHash &&
      d.apartmentId === apartmentId &&
      pagesCompare(d.pages, pages) === 'same',
  );
  if (waiting !== undefined) {
    return { status: 'da-rivedere', pendingId: waiting.id, codes, reasons, checks, ...withAlarm };
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
    ...withAlarm,
  };
}

/**
 * The live documents still «da rivedere»: a `pendingDocument` with no live bill or instalment
 * of the same file and the same pages (R260), sorted by id. A record of other pages that overlap
 * (a whole file waiting, registered by parts) does not resolve it: a person looks again.
 */
export async function pendingDocuments(store: Store): Promise<PendingDocument[]> {
  const docs = (await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records;
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  const instalments = (await loadAll(store, 'instalment', InstalmentSchema)).records;
  const registered = [...bills, ...instalments];
  return docs.filter(
    (d) =>
      !registered.some(
        (r) => r.fileHash === d.fileHash && pagesCompare(r.fileDocument?.pages, d.pages) === 'same',
      ),
  );
}

export type UndoBillImportResult =
  | { status: 'undone'; operations: Operation[]; records: number }
  | { status: 'refused'; reason: 'inconsistent-store' }
  /** The file holds several documents: say which with `pages` (`null` for the whole file). */
  | { status: 'refused'; reason: 'several-documents'; documents: number }
  /** A live match or recovery uses a record of the file: undo those first. */
  | { status: 'refused'; reason: 'has-dependents'; recordIds: string[] };

const pagesKey = (pages?: readonly number[]) => (pages === undefined ? 'whole' : pages.join('-'));

/**
 * Takes back what the import of `fileHash` created (bills, instalments, the document to review),
 * with `undoFile`; `records` counts the records the undos took back (0 when nothing was left).
 * When the live records and documents to review of the file have more than one page range, the
 * range must be given (`pages`, `null` for the whole file), else `several-documents`; only that
 * document is taken back. Refused while `checkConsistency` reports a problem, and while a live
 * `match` or `tenantRecovery` points at one of the records taken back (the journal only sees
 * paths, so `undoFile` would leave them pointing at a deleted record). Errors of `undoFile` go
 * through.
 */
export async function undoBillImport(
  store: Store,
  fileHash: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
  options: { pages?: [number, number] | null } = {},
): Promise<UndoBillImportResult> {
  if (await writesBlocked(store)) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const registered = await registeredFrom(store, fileHash);
  const waiting = (await loadAll(store, 'pendingDocument', PendingDocumentSchema)).records.filter(
    (d) => d.fileHash === fileHash,
  );
  const keys = new Set([
    ...registered.map((r) => pagesKey(r.fileDocument?.pages)),
    ...waiting.map((d) => pagesKey(d.pages)),
  ]);
  const { pages } = options;
  if (pages === undefined && keys.size > 1) {
    return { status: 'refused', reason: 'several-documents', documents: keys.size };
  }
  const wanted = pages === undefined ? undefined : pagesKey(pages ?? undefined);
  const ids = new Set(
    registered
      .filter((r) => wanted === undefined || pagesKey(r.fileDocument?.pages) === wanted)
      .map((r) => r.id),
  );
  const matches = (await loadAll(store, 'match', BillMatchSchema)).records.filter((m) =>
    ids.has(m.itemId),
  );
  const recoveries = (await loadAll(store, 'tenantRecovery', TenantRecoverySchema)).records.filter(
    (r) => r.instalmentId !== undefined && ids.has(r.instalmentId),
  );
  const recordIds = [...matches, ...recoveries].map((r) => r.id).sort();
  if (recordIds.length > 0) return { status: 'refused', reason: 'has-dependents', recordIds };
  const operations = await undoFile(store, fileHash, profileId, clock, newId, {
    ...(wanted === undefined
      ? {}
      : {
          only: (after: { fileDocument?: { pages: number[] }; pages?: number[] }) =>
            pagesKey(after.fileDocument?.pages ?? after.pages) === wanted,
        }),
  });
  return {
    status: 'undone',
    operations,
    records: operations.reduce((n, op) => n + op.changes.length, 0),
  };
}
