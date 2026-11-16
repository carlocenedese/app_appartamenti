/**
 * The class of a movement (plan 3c): its exclusion, by hand and with a confirmation only (the
 * call is the confirmation: no exclusion is born anywhere else), undone with `undoOperation`.
 */
import { imuDependents } from './imu';
import { checkConsistency, commitChange, readJournal } from './journal';
import {
  AccountSchema,
  BankTransactionSchema,
  BillMatchSchema,
  ImuYearSchema,
  MovementClassSchema,
  PayableSchema,
  PaymentSchema,
  StatementSchema,
  TransferSchema,
} from './model';
import type {
  Account,
  BankTransaction,
  BillMatch,
  ExcludeReason,
  MovementClass,
  Payment,
  Statement,
  Transfer,
} from './model';
import { payablesRepeatedFrom, payablesUsing } from './payable-store';
import { parseOrThrow } from './parse';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { compareText } from './text';

/** The movements of the live exclusions: every phase of the reconciliation skips them. */
export function excludedIds(classes: MovementClass[]): Set<string> {
  return new Set(
    classes.filter((c) => c.deleted !== true && c.kind === 'escluso').map((c) => c.transactionId),
  );
}

/** The movements of a transfer: its outgoing and incoming legs, when there. */
export const legsOf = (t: Pick<Transfer, 'outTransactionId' | 'inTransactionId'>): string[] =>
  [t.outTransactionId, t.inTransactionId].filter((id) => id !== undefined);

/** What a movement is used for: one use at most per movement (plan 3c, «Mie scelte» 1, D2). */
export type MovementUse = 'escluso' | 'abbinato' | 'pagamento' | 'classificato' | 'giroconto';

/**
 * The uses of each movement from the live records: a class (`escluso` or `classificato`), a
 * confirmed `BillMatch` that is not `assumed` (`abbinato`), a payment (`pagamento`), a leg of a
 * transfer (`giroconto`); each use once per movement, in that order.
 */
export function movementUses(state: {
  classes: MovementClass[];
  payments: Payment[];
  matches: BillMatch[];
  transfers: Transfer[];
}): Map<string, MovementUse[]> {
  const uses = new Map<string, MovementUse[]>();
  const add = (id: string, use: MovementUse) => {
    const list = uses.get(id) ?? [];
    if (!list.includes(use)) uses.set(id, [...list, use]);
  };
  for (const c of state.classes.filter((r) => r.deleted !== true)) {
    add(c.transactionId, c.kind === 'escluso' ? 'escluso' : 'classificato');
  }
  for (const m of state.matches) {
    if (m.deleted !== true && m.confirmed && m.by !== 'assumed') add(m.transactionId, 'abbinato');
  }
  for (const p of state.payments) {
    if (p.deleted !== true && p.transactionId !== undefined) add(p.transactionId, 'pagamento');
  }
  for (const t of state.transfers.filter((r) => r.deleted !== true)) {
    for (const id of legsOf(t)) add(id, 'giroconto');
  }
  return uses;
}

/**
 * The live records that give the movements `transactionIds` a use: their class, payments,
 * confirmed matches that are not `assumed` and transfers; ids sorted.
 */
async function liveUsesOf(store: Store, transactionIds: readonly string[]): Promise<string[]> {
  const of = (id: string | undefined) => id !== undefined && transactionIds.includes(id);
  return [
    ...(await loadAll(store, 'movementClass', MovementClassSchema)).records.filter((c) =>
      of(c.transactionId),
    ),
    ...(await loadAll(store, 'payment', PaymentSchema)).records.filter((p) => of(p.transactionId)),
    ...(await loadAll(store, 'match', BillMatchSchema)).records.filter(
      (m) => of(m.transactionId) && m.confirmed && m.by !== 'assumed',
    ),
    ...(await loadAll(store, 'transfer', TransferSchema)).records.filter((t) => legsOf(t).some(of)),
  ]
    .map((r) => r.id)
    .sort(compareText);
}

/** The operations whose undo brings back the use of a movement they took away by itself. */
const CANCEL_KINDS = ['income.cancel-payment', 'outgoing.cancel-auto'];

/**
 * What stops the undo of the operation `operationId` (I2 of the final review of plan 3c): for an
 * `income.cancel-payment` or an `outgoing.cancel-auto`, the live records that give its movement
 * another use since (sorted ids: undo those first, as `has-dependents`); empty otherwise, and
 * for an unknown operation (`undoOperation` says so). The journal only sees paths, so these
 * records on other paths are no dependents of it: every undo of such an operation asks here.
 * For an `imu.expected` (plan 3d), the live classes assigned to a rate of its year that the undo
 * would take away or change in group or number of rates (`imuDependents`). For any operation
 * that wrote a live class (plan 9), the live payables paid by its movement; for one that created a
 * payable, the live payables repeated from it.
 */
export async function undoBlockedBy(store: Store, operationId: string): Promise<string[]> {
  const operation = (await readJournal(store)).operations.find((o) => o.id === operationId);
  if (operation?.kind === 'imu.expected') {
    // The undo puts `before` back in place of `after` (plan 3d, answer of user1, 16 Nov 2026).
    const classes = (await loadAll(store, 'movementClass', MovementClassSchema)).records;
    const year = (r: unknown) => (r === undefined ? undefined : ImuYearSchema.parse(r));
    return operation.changes
      .flatMap((c) => imuDependents(classes, year(c.after), year(c.before)))
      .sort(compareText);
  }
  // Plan 9: an undo that would take away or change a class whose movement pays a payable.
  const classed = (operation?.changes ?? []).flatMap(({ path, after }) => {
    const parsed = path.includes('/movementClass/')
      ? MovementClassSchema.safeParse(after)
      : undefined;
    return parsed?.success === true && parsed.data.deleted !== true
      ? [parsed.data.transactionId]
      : [];
  });
  const linked = await payablesUsing(store, classed);
  if (linked.length > 0) return linked;
  // Plan 9: an undo that would take away an item a live item was repeated from.
  const created = (operation?.changes ?? []).flatMap(({ path, before, after }) => {
    if (!path.includes('/payable/')) return [];
    const was = PayableSchema.safeParse(before);
    const is = PayableSchema.safeParse(after);
    return is.success && is.data.deleted !== true && !(was.success && was.data.deleted !== true)
      ? [is.data.id]
      : [];
  });
  const successors = await payablesRepeatedFrom(store, created);
  if (successors.length > 0) return successors;
  if (operation === undefined || !CANCEL_KINDS.includes(operation.kind)) return [];
  const movements = operation.changes.flatMap(({ before }) =>
    typeof before === 'object' &&
    before !== null &&
    'transactionId' in before &&
    typeof before.transactionId === 'string'
      ? [before.transactionId]
      : [],
  );
  return liveUsesOf(store, movements);
}

export type ExcludeMovementResult =
  | { status: 'excluded'; operationId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-transaction' | 'already-classified';
    }
  | { status: 'refused'; reason: 'has-dependents'; recordIds: string[] };

/**
 * Excludes the live movement `transactionId` in one `movement.exclude` operation, which writes
 * `mc-<transactionId>` (a deleted one comes back). Refused without writing when the store is not
 * as the journal leaves it, the movement is unknown or deleted, it already has a live class (undo
 * that first), or a live payment, a live confirmed match that is not `assumed` or a live transfer
 * points to it (`has-dependents`, their ids sorted: undo those first, no cascade).
 */
export async function excludeMovement(
  store: Store,
  input: { transactionId: string; reason: ExcludeReason },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<ExcludeMovementResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const tx = (await loadAll(store, 'transaction', BankTransactionSchema)).records.find(
    (t) => t.id === input.transactionId,
  );
  if (tx === undefined) return { status: 'refused', reason: 'unknown-transaction' };
  const id = `mc-${tx.id}`;
  const stored = (
    await loadAll(store, 'movementClass', MovementClassSchema, { includeDeleted: true })
  ).records.find((c) => c.id === id);
  if (stored !== undefined && stored.deleted !== true) {
    return { status: 'refused', reason: 'already-classified' };
  }
  const recordIds = await liveUsesOf(store, [tx.id]);
  if (recordIds.length > 0) return { status: 'refused', reason: 'has-dependents', recordIds };

  const after = parseOrThrow(
    MovementClassSchema,
    { id, v: 1, rev: 1, transactionId: tx.id, kind: 'escluso', excludeReason: input.reason },
    'movementClass',
  );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'movement.exclude',
      apartmentId: tx.apartmentId,
      summary: 'Movimento escluso.',
      changes: [{ path: recordPath('movementClass', id), before: stored, after }],
    },
    clock,
    newId,
  );
  return { status: 'excluded', operationId: operation.id };
}

/** A proposal to exclude a pending movement a later statement left out: never written by itself. */
export interface ExclusionProposal {
  id: string;
  transactionId: string;
  reason: 'pending-superseded';
  suggestedReason: 'non-contabilizzato';
}

/**
 * The live not-booked movements, of a live account and without a live class, that a newer live
 * statement of the same account covers (`from <= date <= to`) without listing them: "newer" means
 * its `to` is after the `to` of every live statement that lists it (at least one must). Sorted by `id`.
 */
export function supersededPending(input: {
  accounts: Account[];
  statements: Statement[];
  transactions: BankTransaction[];
  classes: MovementClass[];
}): ExclusionProposal[] {
  const accounts = new Set(input.accounts.filter((a) => a.deleted !== true).map((a) => a.id));
  const statements = input.statements.filter((s) => s.deleted !== true);
  const classified = new Set(
    input.classes.filter((c) => c.deleted !== true).map((c) => c.transactionId),
  );
  return input.transactions
    .filter(
      (t) =>
        t.deleted !== true &&
        t.booked === false &&
        t.accountId !== undefined &&
        accounts.has(t.accountId) &&
        !classified.has(t.id),
    )
    .filter((t) => {
      const same = statements.filter((s) => s.accountId === t.accountId);
      const listing = same.filter((s) => s.transactionIds.includes(t.id));
      return (
        listing.length > 0 &&
        same.some(
          (s) =>
            !s.transactionIds.includes(t.id) &&
            s.from <= t.date &&
            t.date <= s.to &&
            listing.every((l) => s.to > l.to),
        )
      );
    })
    .map((t) => ({
      id: `p-escl-${t.id}`,
      transactionId: t.id,
      reason: 'pending-superseded' as const,
      suggestedReason: 'non-contabilizzato' as const,
    }))
    .sort((a, b) => compareText(a.id, b.id));
}

/** The exclusion proposals of the store, read only. */
export async function listExclusionProposals(store: Store): Promise<ExclusionProposal[]> {
  return supersededPending({
    accounts: (await loadAll(store, 'account', AccountSchema)).records,
    statements: (await loadAll(store, 'statement', StatementSchema)).records,
    transactions: (await loadAll(store, 'transaction', BankTransactionSchema)).records,
    classes: (await loadAll(store, 'movementClass', MovementClassSchema)).records,
  });
}
