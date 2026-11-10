/** Notes written by people on a bill, a payment or another item. */
import { NoteSchema } from './model';
import type { Note } from './model';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareByTime } from './time';

/**
 * The notes of one item (a bill, a payment, ...) that are not deleted, by time and then by `id`.
 * Notes are records like the others, written with `commitChange`, so two people who write a note
 * on the same item at the same time make two files. A note file that cannot be read is left out,
 * as with `loadAll`.
 */
export async function notesFor(
  store: Store,
  targetType: Note['targetType'],
  targetId: string,
): Promise<Note[]> {
  const { records } = await loadAll(store, 'note', NoteSchema);
  return records
    .filter((note) => note.targetType === targetType && note.targetId === targetId)
    .sort(compareByTime);
}
