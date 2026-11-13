/**
 * Store writes for supplies (shared TARI notices): link, atomic update, logical delete, list.
 * Each write is one operation of the journal, so `undoOperation` takes it back. The draft is
 * checked with `draftProblem` and the final record with `SupplySchema` before anything is written.
 */
import { commitChange } from './journal';
import { NoteSchema, SupplySchema } from './model';
import type { Note, Supply } from './model';
import { parseOrThrow } from './parse';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';
import { draftProblem } from './supply-link';
import { foldText } from './text';
import type { SupplyDraft } from './supply-link';

function checkedDraft(draft: SupplyDraft): Pick<Supply, 'label' | 'apartments'> {
  const problem = draftProblem(draft);
  if (problem !== undefined) throw new RangeError(problem);
  return {
    label: draft.label,
    apartments: draft.rows.map((r) => ({ apartmentId: r.apartmentId, weight: r.basisPoints })),
  };
}

/** Writes a new supply and, when the draft has a note, the note, all in one `supply.link`. */
export async function linkSupply(
  store: Store,
  draft: SupplyDraft,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Supply> {
  const supply = parseOrThrow(
    SupplySchema,
    { ...checkedDraft(draft), id: newId(), v: 1, rev: 1 },
    'supply',
  );
  const key = foldText(supply.label);
  if ((await liveSupplies(store)).some((s) => foldText(s.label) === key)) {
    throw new RangeError("Esiste già un'utenza con questa etichetta.");
  }
  const at = clock();
  const text = draft.note.trim();
  const note =
    text === ''
      ? undefined
      : parseOrThrow(
          NoteSchema,
          {
            id: newId(),
            v: 1,
            rev: 1,
            targetType: 'supply',
            targetId: supply.id,
            text,
            profileId,
            at,
            visibleToTenants: false,
          },
          'note',
        );
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'supply.link',
      summary: `Collegata l'utenza ${supply.label}`,
      changes: [
        { path: recordPath('supply', supply.id), before: undefined, after: supply },
        ...(note === undefined
          ? []
          : [{ path: recordPath('note', note.id), before: undefined, after: note }]),
      ],
    },
    () => at,
    newId,
  );
  return parseOrThrow(SupplySchema, operation.changes[0]?.after, 'supply');
}

/** Replaces label and apartments with the draft's, one `supply.update`; `StaleWriteError` if changed. */
export async function updateSupply(
  store: Store,
  supply: Supply,
  draft: SupplyDraft,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Supply> {
  const after = parseOrThrow(SupplySchema, { ...supply, ...checkedDraft(draft) }, 'supply');
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'supply.update',
      summary: `Modificata l'utenza ${after.label}`,
      changes: [{ path: recordPath('supply', supply.id), before: supply, after }],
    },
    clock,
    newId,
  );
  return parseOrThrow(SupplySchema, operation.changes[0]?.after, 'supply');
}

/** Marks the supply `deleted: true` (never removed from the disk), one `supply.remove`. */
export async function removeSupply(
  store: Store,
  supply: Supply,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Supply> {
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'supply.remove',
      summary: `Scollegata l'utenza ${supply.label}`,
      changes: [{ path: recordPath('supply', supply.id), before: supply, after: undefined }],
    },
    clock,
    newId,
  );
  return parseOrThrow(SupplySchema, operation.changes[0]?.after, 'supply');
}

/** The supplies that are not deleted; broken files are left out, as with `loadAll`. */
export async function liveSupplies(store: Store): Promise<Supply[]> {
  return (await loadAll(store, 'supply', SupplySchema)).records;
}

/** Writes a private note on a supply, one `supply.note`; refuses an empty or over-long text first. */
export async function addSupplyNote(
  store: Store,
  supply: Supply,
  text: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Note> {
  const trimmed = text.trim();
  if (trimmed === '') throw new RangeError('La nota è vuota.');
  if (trimmed.length > 2000) throw new RangeError('La nota supera i 2000 caratteri.');
  const at = clock();
  const note = parseOrThrow(
    NoteSchema,
    {
      id: newId(),
      v: 1,
      rev: 1,
      targetType: 'supply',
      targetId: supply.id,
      text: trimmed,
      profileId,
      at,
      visibleToTenants: false,
    },
    'note',
  );
  await commitChange(
    store,
    {
      profileId,
      kind: 'supply.note',
      summary: `Nota sull'utenza ${supply.label}`,
      changes: [{ path: recordPath('note', note.id), before: undefined, after: note }],
    },
    () => at,
    newId,
  );
  return note;
}
