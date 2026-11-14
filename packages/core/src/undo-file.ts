/** "Undo the whole file": takes back every registration that created a record from one PDF. */
import { readJournal, undoOperation } from './journal';
import type { Operation } from './journal';
import type { Store } from './store/store';

/**
 * Undoes, most recent first, each operation in force that created a record (a change without
 * `before`) whose `fileHash` is `fileHash`, with `undoOperation` and no cascade. Returns the undo
 * operations; an empty list when there is nothing left to undo, so it can be repeated. An error
 * of `undoOperation` (e.g. a dependent operation) is thrown and the undos already made stay: a
 * second call undoes only what is left. Operations of other files are never touched.
 */
export async function undoFile(
  store: Store,
  fileHash: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation[]> {
  const { operations } = await readJournal(store);
  // An operation is undone when an undo of it is itself in force (a redo brings it back).
  const undoersOf = new Map<string, Operation[]>();
  for (const op of operations) {
    if (op.undoes !== undefined)
      undoersOf.set(op.undoes, [...(undoersOf.get(op.undoes) ?? []), op]);
  }
  const inForce = (id: string, seen: ReadonlySet<string> = new Set()): boolean =>
    seen.has(id) || !(undoersOf.get(id) ?? []).some((u) => inForce(u.id, new Set(seen).add(id)));

  const targets = operations.filter(
    (op) =>
      op.undoes === undefined &&
      inForce(op.id) &&
      op.changes.some(
        ({ before, after }) =>
          before === undefined &&
          typeof after === 'object' &&
          after !== null &&
          (after as { fileHash?: unknown }).fileHash === fileHash,
      ),
  );
  const undone: Operation[] = [];
  for (const op of targets.reverse()) {
    undone.push(await undoOperation(store, op.id, profileId, clock, newId));
  }
  return undone;
}
