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
 * of each operation is derived from them (`op-<first record id>`; for a profile, the profile id
 * and the `rev` it gets), so the functions take no `newId`.
 */
import { findBillDuplicate, hashBytes, registerBill } from './dedupe';
import type { ExtractedField, ExtractionResult } from './extraction';
import { commitChange } from './journal';
import { BillSchema, InstalmentSchema, SupplierProfileSchema } from './model';
import type { Instalment, SupplierProfile } from './model';
import { parseOrThrow } from './parse';
import { FIELD_LABELS } from './proposal';
import type { Proposal } from './proposal';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

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
  const sameFile = existing.find((e) =>
    records.some(
      (r) =>
        e.fileHash === r.fileHash && e.apartmentId === r.apartmentId && e.rateIndex === r.rateIndex,
    ),
  );
  if (sameFile !== undefined) return { status: 'duplicate', existingId: sameFile.id };
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
    clock,
    () => `op-${first.id}`,
  );
  return { status: 'registered', ids: records.map((r) => r.id), operationId: operation.id };
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
 * `mode: 'auto'`, a proposal that a person must see (a reading that is not `riconosciuta`, a field that is not `high`, a check `warn` or
 * `fail`). The profile side of the policy is `decideRegistration`'s: the caller asks it first. In
 * `mode: 'manual'` a person has confirmed the proposal, so the checks do not stop it, but the
 * duplicate checks still do.
 *
 * The operation id is `op-<id of the first record>`: a proposal registered once cannot be
 * registered again after an undo (its record ids are taken); a new reading makes new ids.
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
  const suffix = mode === 'auto' ? '-auto' : '';
  const autoReasons = mode === 'auto' ? proposalReasons(proposal, result) : [];

  if (proposal.kind === 'tari') {
    const records = proposal.instalments.map((instalment) =>
      parseOrThrow(InstalmentSchema, { ...instalment, v: 1, rev: 1, fileHash }, 'instalment'),
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

  const record = parseOrThrow(BillSchema, { ...proposal.bill, v: 1, rev: 1, fileHash }, 'bill');
  const known = await findBillDuplicate(store, record);
  if (known !== undefined) return known;
  if (autoReasons.length > 0) return { status: 'rejected', reason: autoReasons.join(' ') };
  const operationId = `op-${proposal.bill.id}`;
  const registered = await registerBill(
    store,
    proposal.bill,
    bytes,
    profileId,
    clock,
    () => operationId,
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
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: op.kind,
      summary: op.summary,
      changes: [{ path: recordPath('supplierProfile', profile.id), before: profile, after }],
    },
    clock,
    () => `${op.idPrefix}-${profile.id}-r${String(profile.rev + 1)}`,
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
