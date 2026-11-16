/**
 * The confirmation policy and the registration of what a PDF proposes (section 22, steps 5 and 7,
 * and the "politica di conferma"): after the owner has confirmed the first reading of a layout,
 * the next bills of that supplier that pass every check are registered without asking and shown
 * as "registrata automaticamente", with an undo. Anything doubtful goes to a person.
 *
 * - `decideRegistration` says whether a reading can be registered by itself, with the reasons
 *   (in Italian) when it cannot.
 * - `registerProposal` writes the bill, or the TARI instalments of a notice, with one operation of
 *   the journal, so `undoOperation` always takes it back.
 * - `confirmProfile` and `setProfileAutoRegister` change a supplier profile through the journal.
 *
 * Pure: no clock and no random source. The ids of the records come from the proposal, and the id
 * of each operation is derived from them and from the time of the attempt (see `operationId`),
 * so the functions take no `newId`.
 */
import { findBillDuplicate, hashBytes, registerBill, samePages } from './dedupe';
import { hasOcrReading } from './extraction';
import type { ExtractedField, ExtractionResult } from './extraction';
import { commitChange } from './journal';
import { BillSchema, InstalmentSchema, SupplierProfileSchema } from './model';
import type { Instalment, SupplierProfile } from './model';
import { parseOrThrow } from './parse';
import { FIELD_LABELS } from './proposal';
import type { Proposal } from './proposal';
import { loadAll } from './store/load';
import { compactTimestamp } from './time';
import { recordPath } from './store/records';
import { MalformedJsonError } from './store/store';
import type { Store } from './store/store';

/**
 * The id of an operation made at `at`: `<prefix>-<at as YYYYMMDDTHHmmssSSSZ>`. The time makes it
 * unique per attempt: a write retried after the journal file of a failed attempt was written gets
 * another id, so the journal never has two files with one id (which `readJournal` would drop
 * both of as `duplicate-id`, leaving the retried operation impossible to undo). The caller then
 * gives `commitChange` a clock that returns that same `at`.
 */
function operationId(prefix: string, at: string): string {
  return `${prefix}-${compactTimestamp(at)}`;
}

export type RegistrationDecision = { action: 'auto-register' | 'review'; reasons: string[] };

/** The messages of the checks that failed, for a proposal that has nothing to register. */
function noneReason(proposal: Proposal): string {
  const failed = proposal.checks.filter((c) => c.severity === 'fail').map((c) => c.message);
  return ['Nessun documento da registrare.', ...failed].join(' ');
}

/**
 * What in the reading and the proposal stops an automatic registration: a reading that is not
 * `riconosciuta`, a field that is not `high` (a `medium` field has no check of its own, so it is
 * looked at here; an optional field that was not read counts too), a check that is `warn` or
 * `fail`. Empty when the proposal can go by itself.
 */
function proposalReasons(proposal: Proposal, result: ExtractionResult): string[] {
  if (proposal.kind === 'none') return [noneReason(proposal)];
  const reasons: string[] = [];
  // A text PDF with a scanned page is decided by the fields read from that page, not by the page.
  if (result.textSource === 'ocr' || (result.textSource === 'mixed' && hasOcrReading(result))) {
    reasons.push('Il testo è stato letto con la scansione (OCR): va controllato a mano.');
  }
  if (result.status !== 'riconosciuta') {
    reasons.push(`La lettura è «${result.status}», non «riconosciuta».`);
  }
  for (const [name, field] of Object.entries(result.fields) as [
    keyof typeof FIELD_LABELS,
    ExtractedField<unknown> | undefined,
  ][]) {
    if (field === undefined) continue;
    const label = FIELD_LABELS[name];
    if (field.confidence === 'missing' || field.value === null) {
      reasons.push(`Il campo «${label}» non è stato letto.`);
    } else if (field.confidence !== 'high') {
      reasons.push(`Il campo «${label}» è dubbio.`);
    }
  }
  for (const check of proposal.checks) {
    if (check.severity !== 'ok') reasons.push(check.message);
  }
  return reasons;
}

/**
 * Whether the proposal made from `result` is registered without asking (`auto-register`) or goes
 * to a person (`review`, with the reasons in Italian). It is `auto-register` only when the profile
 * is the one the reading was made with (same id and `rev`), is `confermato` and has
 * `autoRegister`, the reading is `riconosciuta`, every field it has is `high` and no check is
 * `warn` or `fail`. A proposal `none` always goes to review.
 */
export function decideRegistration(input: {
  proposal: Proposal;
  result: ExtractionResult;
  profile: SupplierProfile | undefined;
}): RegistrationDecision {
  const { proposal, result, profile } = input;
  const reasons: string[] = [];
  if (profile === undefined) {
    reasons.push('Nessun profilo di fornitore confermato: la prima lettura va confermata a mano.');
  } else {
    if (profile.status !== 'confermato') {
      reasons.push('Il profilo del fornitore è in bozza: va confermato con la prima lettura.');
    }
    if (!profile.autoRegister) {
      reasons.push('Per questo fornitore è impostato «conferma sempre».');
    }
    if (result.profileId !== profile.id) {
      reasons.push('La lettura non è stata fatta con il profilo di questo fornitore.');
    } else if (result.profileRev !== profile.rev) {
      reasons.push('Il profilo del fornitore è cambiato dopo la lettura.');
    }
  }
  reasons.push(...proposalReasons(proposal, result));
  return { action: reasons.length === 0 ? 'auto-register' : 'review', reasons };
}

export type RegisterProposalResult =
  | { status: 'registered'; ids: string[]; operationId: string }
  /** The same file is already registered, as the record `existingId`. Nothing was written. */
  | { status: 'duplicate'; existingId: string }
  /** Another file says the same as the record `existingId`. Nothing was written. */
  | { status: 'possible-duplicate'; existingId: string }
  /** Nothing to register, or not something to register without a person. Nothing was written. */
  | { status: 'rejected'; reason: string };

/**
 * The registered TARI instalment (not deleted) that one of `records` repeats: one with the same
 * file, apartment and `rateIndex` is a `duplicate`; one of the same apartment with the same kind,
 * `esercizio` and `rateIndex`, from another file or entered by hand, a `possible-duplicate`.
 * With several matches, the smallest `id`. Writes nothing.
 */
async function findInstalmentDuplicate(
  store: Store,
  records: Instalment[],
): Promise<{ status: 'duplicate' | 'possible-duplicate'; existingId: string } | undefined> {
  // `loadAll` sorts by id, so `find` gives the smallest id among the matches.
  const { records: existing } = await loadAll(store, 'instalment', InstalmentSchema);
  const pagesOf = (e: Instalment) =>
    records
      .filter(
        (r) =>
          e.fileHash === r.fileHash &&
          e.apartmentId === r.apartmentId &&
          e.rateIndex === r.rateIndex,
      )
      .map((r) => samePages(e.fileDocument, r.fileDocument));
  const sameFile = existing.find((e) => pagesOf(e).includes('same'));
  if (sameFile !== undefined) return { status: 'duplicate', existingId: sameFile.id };
  // Pages that overlap without being the same: a person decides (an old record has no range).
  const overlap = existing.find((e) => pagesOf(e).includes('overlap'));
  if (overlap !== undefined) return { status: 'possible-duplicate', existingId: overlap.id };
  const sameRate = existing.find((e) =>
    records.some(
      (r) =>
        e.kind === r.kind &&
        e.apartmentId === r.apartmentId &&
        e.esercizio === r.esercizio &&
        e.rateIndex === r.rateIndex,
    ),
  );
  if (sameRate !== undefined) return { status: 'possible-duplicate', existingId: sameRate.id };
  return undefined;
}

/** Writes the instalments of a TARI notice, one per supply, all in one operation. */
async function writeInstalments(
  store: Store,
  records: [Instalment, ...Instalment[]],
  profileId: string,
  kind: string,
  clock: () => string,
): Promise<RegisterProposalResult> {
  const [first] = records;
  const at = clock();
  const apartments = new Set(records.map((r) => r.apartmentId));
  const operation = await commitChange(
    store,
    {
      profileId,
      kind,
      ...(apartments.size === 1 ? { apartmentId: first.apartmentId } : {}),
      summary:
        `Registrat${records.length === 1 ? 'a 1 rata' : `e ${String(records.length)} rate`} ` +
        `TARI ${first.esercizio} (rata ${String(first.rateIndex)} di ${String(first.rateCount)})`,
      changes: records.map((record) => ({
        path: recordPath('instalment', record.id),
        before: undefined,
        after: record,
      })),
    },
    () => at,
    () => operationId(`op-${first.id}`, at),
  );
  return { status: 'registered', ids: records.map((r) => r.id), operationId: operation.id };
}

/**
 * The supplier profile the reading was made with, as stored (`result.profileId`), or `undefined`
 * when the reading names none, there is no such record, it is deleted, or its file is not a valid
 * profile: `decideRegistration` then sends the reading to a person.
 */
export async function readSupplierProfile(
  store: Store,
  result: ExtractionResult,
): Promise<SupplierProfile | undefined> {
  if (result.profileId === null) return undefined;
  let raw: unknown;
  try {
    raw = await store.readJson(recordPath('supplierProfile', result.profileId));
  } catch (error) {
    // An id that is not a safe file name, or a file that is not JSON: no usable profile.
    if (error instanceof RangeError || error instanceof MalformedJsonError) return undefined;
    throw error;
  }
  const parsed = SupplierProfileSchema.safeParse(raw);
  if (!parsed.success || parsed.data.deleted === true || parsed.data.id !== result.profileId) {
    return undefined;
  }
  return parsed.data;
}

/**
 * Registers what `proposal` proposes for the PDF `bytes`, read as `result`, with one operation of
 * the journal (undone with `undoOperation`, which leaves the records `deleted`).
 *
 * - A bill goes through `registerBill` (`duplicate` for the same file, `possible-duplicate` for
 *   the same bill in other bytes), with the operation `bill.register`, or `bill.register-auto`
 *   with `mode: 'auto'`.
 * - A TARI notice writes one instalment per supply, all in one operation (`instalment.register`
 *   or `instalment.register-auto`), with the same kind of duplicate checks (see
 *   `findInstalmentDuplicate`).
 *
 * The duplicate checks come before the policy, so a PDF downloaded again is reported as
 * `possible-duplicate` (and the same file as `duplicate`) in both modes, never written twice.
 * `rejected`, writing nothing: a proposal `none` in either mode (there is nothing to write), or a
 * TARI proposal without instalments; bytes that are not the file that was read; with
 * `mode: 'auto'`, anything `decideRegistration` does not call `auto-register`, with its reasons
 * joined: the supplier profile `result.profileId` is loaded from the store and must exist (not
 * deleted), be `confermato`, have `autoRegister` and the `rev` of the reading; the reading must
 * be `riconosciuta`, every field `high`, no check `warn` or `fail`. The policy is enforced here
 * (ruling R73), so the caller need not ask `decideRegistration` first. In `mode: 'manual'` a
 * person has confirmed the proposal, so neither the profile nor the checks stop it, but the
 * duplicate checks still do.
 *
 * In a batch, build the `ProposalContext` again after each registration: a proposal made from a
 * context that does not know the bills just registered misses its duplicate and anomaly checks
 * (the store's duplicate check still catches the same bill).
 *
 * The operation id is `op-<id of the first record>-<time of the attempt>` (see `operationId`), so
 * a retry after a failed write is a new operation. A proposal registered and then undone cannot
 * be registered again (its record ids are taken); a new reading makes new ids.
 */
export async function registerProposal(
  store: Store,
  input: {
    proposal: Proposal;
    result: ExtractionResult;
    bytes: Uint8Array;
    profileId: string;
    mode: 'manual' | 'auto';
  },
  clock: () => string,
): Promise<RegisterProposalResult> {
  const { proposal, result, bytes, profileId, mode } = input;
  if (proposal.kind === 'none') return { status: 'rejected', reason: noneReason(proposal) };
  const fileHash = await hashBytes(bytes);
  if (fileHash !== result.fileHash) {
    return { status: 'rejected', reason: 'Il file non è quello letto: va letto di nuovo.' };
  }
  // Only a part of the file gets a `fileDocument`; the whole file stays as before.
  const fileDocument =
    result.pageRange !== null &&
    !(result.pageRange[0] === 1 && result.pageRange[1] === result.pages)
      ? { pages: result.pageRange, documentKind: result.documentKind }
      : undefined;
  const suffix = mode === 'auto' ? '-auto' : '';
  const autoReasons =
    mode === 'auto'
      ? decideRegistration({ proposal, result, profile: await readSupplierProfile(store, result) })
          .reasons
      : [];

  if (proposal.kind === 'tari') {
    const records = proposal.instalments.map((instalment) =>
      parseOrThrow(
        InstalmentSchema,
        { ...instalment, v: 1, rev: 1, fileHash, ...(fileDocument && { fileDocument }) },
        'instalment',
      ),
    );
    const [first, ...rest] = records;
    if (first === undefined) return { status: 'rejected', reason: 'Nessuna rata da registrare.' };
    const known = await findInstalmentDuplicate(store, records);
    if (known !== undefined) return known;
    if (autoReasons.length > 0) return { status: 'rejected', reason: autoReasons.join(' ') };
    return writeInstalments(
      store,
      [first, ...rest],
      profileId,
      `instalment.register${suffix}`,
      clock,
    );
  }

  const bill = { ...proposal.bill, ...(fileDocument && { fileDocument }) };
  const record = parseOrThrow(BillSchema, { ...bill, v: 1, rev: 1, fileHash }, 'bill');
  const known = await findBillDuplicate(store, record);
  if (known !== undefined) return known;
  if (autoReasons.length > 0) return { status: 'rejected', reason: autoReasons.join(' ') };
  const at = clock();
  const registered = await registerBill(
    store,
    bill,
    bytes,
    profileId,
    () => at,
    () => operationId(`op-${proposal.bill.id}`, at),
    { kind: `bill.register${suffix}` },
  );
  if (registered.status !== 'registered') return registered; // written by someone in between
  return { status: 'registered', ids: [registered.bill.id], operationId: registered.operationId };
}

// --- Supplier profiles -----------------------------------------------------------------------

async function updateProfile(
  store: Store,
  profile: SupplierProfile,
  patch: Partial<Pick<SupplierProfile, 'status' | 'autoRegister'>>,
  op: { kind: string; idPrefix: string; summary: string },
  profileId: string,
  clock: () => string,
): Promise<SupplierProfile> {
  const after = parseOrThrow(SupplierProfileSchema, { ...profile, ...patch }, 'supplier profile');
  const at = clock();
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: op.kind,
      summary: op.summary,
      changes: [{ path: recordPath('supplierProfile', profile.id), before: profile, after }],
    },
    () => at,
    () => operationId(`${op.idPrefix}-${profile.id}-r${String(profile.rev + 1)}`, at),
  );
  return parseOrThrow(SupplierProfileSchema, operation.changes[0]?.after, 'supplier profile');
}

/**
 * Marks the profile `confermato` (the owner confirmed its first reading) with one operation
 * `profile.confirm`, and returns it as stored. A profile already confirmed is returned as it is,
 * with nothing written. `profile` must be the record as it is on disk (`StaleWriteError`).
 */
export async function confirmProfile(
  store: Store,
  profile: SupplierProfile,
  profileId: string,
  clock: () => string,
): Promise<SupplierProfile> {
  if (profile.status === 'confermato') return profile;
  return updateProfile(
    store,
    profile,
    { status: 'confermato' },
    {
      kind: 'profile.confirm',
      idPrefix: 'profile-confirm',
      summary: `Confermato il profilo del fornitore ${profile.supplier}`,
    },
    profileId,
    clock,
  );
}

/**
 * Turns the automatic registration of a supplier on or off («conferma sempre» is off), with one
 * operation `profile.auto-register`. Nothing is written when the setting is already that.
 */
export async function setProfileAutoRegister(
  store: Store,
  profile: SupplierProfile,
  autoRegister: boolean,
  profileId: string,
  clock: () => string,
): Promise<SupplierProfile> {
  if (profile.autoRegister === autoRegister) return profile;
  return updateProfile(
    store,
    profile,
    { autoRegister },
    {
      kind: 'profile.auto-register',
      idPrefix: 'profile-auto',
      summary: autoRegister
        ? `Registrazione automatica attiva per ${profile.supplier}`
        : `Conferma sempre per ${profile.supplier}`,
    },
    profileId,
    clock,
  );
}
