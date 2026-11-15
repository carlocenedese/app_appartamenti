/**
 * The class of a movement (plan 3c): its exclusion, by hand and with a confirmation only (the
 * call is the confirmation: no exclusion is born anywhere else), undone with `undoOperation`.
 */
import { checkConsistency, commitChange } from './journal';
import {
  BankTransactionSchema,
  BillMatchSchema,
  MovementClassSchema,
  PaymentSchema,
} from './model';
import type { ExcludeReason, MovementClass } from './model';
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
 * that first), or a live payment or a live confirmed match that is not `assumed` points to it
 * (`has-dependents`, their ids sorted: undo those first, no cascade).
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
  const recordIds = [
    ...(await loadAll(store, 'payment', PaymentSchema)).records.filter(
      (p) => p.transactionId === tx.id,
    ),
    ...(await loadAll(store, 'match', BillMatchSchema)).records.filter(
      (m) => m.transactionId === tx.id && m.confirmed && m.by !== 'assumed',
    ),
  ]
    .map((r) => r.id)
    .sort(compareText);
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
