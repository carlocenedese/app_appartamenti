/** "Undo the whole file": takes back every registration that created a record from one PDF. */
import { readJournal, undoOperation, undoTargetOf } from './journal';
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
  const targets = operations.flatMap((op) => {
    if (
      op.undoes !== undefined ||
      !op.changes.some(
        ({ before, after }) =>
          before === undefined &&
          typeof after === 'object' &&
          after !== null &&
          (after as { fileHash?: unknown }).fileHash === fileHash,
      )
    )
      return [];
    // A document that was undone and brought back is taken back by undoing the redo in force.
    const target = undoTargetOf(operations, op);
    return target === undefined ? [] : [target];
  });
  const undone: Operation[] = [];
  for (const op of targets.reverse()) {
    undone.push(await undoOperation(store, op.id, profileId, clock, newId));
  }
  return undone;
}
