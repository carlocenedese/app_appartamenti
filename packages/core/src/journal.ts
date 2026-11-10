/**
 * The journal of operations: one small file per operation in `_app/journal/`, written before the
 * records it changes. It is append-only (a file is never rewritten or removed) and one file per
 * operation means two people working at once never write the same file, which is what Dropbox
 * cannot merge. The journal gives the app an undo, a history that anyone can read, and a check
 * that tells a record that was left behind by an interrupted write.
 *
 * An operation lists its `changes`: for each record file the content before (`before`, absent when
 * the operation created the record) and the content after (`after`). The `after` stored in the
 * journal is exactly what `commitChange` writes to the record file, `rev` included, so for a record
 * whose last operation went through the file on disk is equal to that `after`.
 */
import { z } from 'zod';
import { NoteSchema, TimestampSchema } from './model';
import type { Note } from './model';
import { compareText, isSafePath, loadAll, loadDir } from './store/load';
import { StaleWriteError, currentRev, writeRecord } from './store/records';
import { MalformedJsonError, assertSafeRelPath, assertSafeSegment } from './store/store';
import type { Problem, Store } from './store/store';

/** Folder with the operation files, relative to the workspace root. */
export const JOURNAL_DIR = '_app/journal';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A record as stored: an object with an integer `rev` of at least 1. */
function hasRev(value: unknown): value is JsonRecord & { rev: number } {
  return isRecord(value) && Number.isSafeInteger(value.rev) && (value.rev as number) >= 1;
}

const NonEmptyString = z.string().min(1);

const ChangeSchema = z
  .object({
    path: z.string().refine(isSafePath, { message: 'Not a safe store path' }),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .refine(({ before, after }) => (before === undefined || hasRev(before)) && isRecord(after), {
    message: 'A stored change needs an `after` record, and a `before` that is a record with a rev',
  });

/**
 * An operation as stored in `_app/journal/`. `before` and `after` are whole records (any content,
 * `rev` included): `before` is absent when the operation created the record. The schema describes
 * what is stored, so it asks for an `after` in every change; the `Operation` type is also the
 * input of `commitChange`, which accepts a change without `after` to delete the record and fills
 * it in. A file that does not pass is reported by `readJournal` and never used.
 */
export const OperationSchema = z.object({
  id: NonEmptyString,
  v: z.literal(1),
  /** ISO 8601 UTC, from the clock the caller passes in. */
  at: TimestampSchema,
  profileId: NonEmptyString,
  /** What kind of operation it is, e.g. `bill.create`; `undo` for an undo. */
  kind: NonEmptyString,
  apartmentId: NonEmptyString.optional(),
  /** One line for the history, in Italian. */
  summary: NonEmptyString,
  reason: z.string().optional(),
  changes: z.array(ChangeSchema),
  /** The id of the operation this one undoes. */
  undoes: NonEmptyString.optional(),
});
export type Operation = z.infer<typeof OperationSchema>;

type Change = Operation['changes'][number];

/** A change as `commitChange` writes it: both sides are records, and `after.rev` is the new `rev`. */
type NormalisedChange = {
  path: string;
  before: (JsonRecord & { rev: number }) | undefined;
  after: JsonRecord & { rev: number };
};

// --- Time ------------------------------------------------------------------------------------

/** The timestamp without its closing `Z`, split into the part up to the seconds and the fraction. */
function splitTimestamp(at: string): [whole: string, fraction: string] {
  const [whole = '', fraction = ''] = at.slice(0, -1).split('.');
  return [whole, fraction];
}

/** `2026-11-10T20:15:30.123Z` as `20261110T201530123Z`: no `-` or `:`, which Windows refuses. */
function compactTimestamp(at: string): string {
  const [whole, fraction] = splitTimestamp(at);
  const stamp = whole.replaceAll('-', '').replaceAll(':', '');
  return `${stamp}${fraction.padEnd(3, '0').slice(0, 3)}Z`;
}

/** A key that orders timestamps by instant as text, whatever the number of fraction digits. */
function timeKey(at: string): string {
  const [whole, fraction] = splitTimestamp(at);
  return `${whole}.${fraction.padEnd(9, '0')}`;
}

/**
 * Orders by time, then by id, so that two things made at the same instant keep a fixed order. The
 * order of two operations on the same record at the same millisecond is then the order of their
 * ids, which is not their order in time when the ids are random.
 */
function compareByTime(a: { at: string; id: string }, b: { at: string; id: string }): number {
  return compareText(timeKey(a.at), timeKey(b.at)) || compareText(a.id, b.id);
}

function journalPath({ at, profileId, id }: Pick<Operation, 'at' | 'profileId' | 'id'>): string {
  return `${JOURNAL_DIR}/${compactTimestamp(at)}-${profileId}-${id}.json`;
}

// --- Writing ---------------------------------------------------------------------------------

/**
 * Checks one change of an operation about to be written and fills in its `after` as it will be on
 * disk: `{...after, rev}` with `rev` one above the one in `before` (1 for a new record), or, when
 * `after` is absent, the `before` marked `deleted: true` with the next `rev`. A record is never
 * removed from the disk, so deleting one that does not exist is an error.
 */
function normaliseChange(change: {
  path: string;
  before?: unknown;
  after?: unknown;
}): NormalisedChange {
  const path = change.path.normalize('NFC');
  assertSafeRelPath(path);
  const { before, after } = change;
  if (before !== undefined && !hasRev(before)) {
    throw new TypeError(`The "before" of ${path} must be a record with an integer "rev"`);
  }
  if (after !== undefined && !isRecord(after)) {
    throw new TypeError(`The "after" of ${path} must be a record`);
  }
  if (after === undefined) {
    if (before === undefined) {
      throw new Error(`Cannot delete ${path}: it does not exist`);
    }
    return { path, before, after: { ...before, deleted: true, rev: before.rev + 1 } };
  }
  return { path, before, after: { ...after, rev: (before?.rev ?? 0) + 1 } };
}

/**
 * Records an operation: writes its file in `_app/journal/` and then changes the records. The
 * journal goes first, so an interruption leaves at worst a journal ahead of the records
 * (`checkConsistency` reports it, `repairDiverged` finishes the job) and never a record that no
 * operation explains.
 *
 * `input` is the operation without the fields the function fills in. The `id` comes from `newId`
 * and the time `at` from `clock` (ISO 8601 UTC): the core has no clock or random source of its
 * own. The file is `_app/journal/<at as YYYYMMDDTHHmmssSSSZ>-<profileId>-<id>.json`, so two
 * operations at the same instant are two files; `profileId` and `id` must each be one safe path
 * segment. An existing operation file is never overwritten.
 *
 * Each change gives the record `path`, what is on disk now (`before`, absent when the record must
 * not exist yet) and what it becomes (`after`, absent to mark the record `deleted: true`). The
 * `rev` in `after` is ignored: the record is written with the `rev` after the one in `before`,
 * and the operation stored in the journal and returned has that same `after`, which `before`
 * leaves as given. Changes must be on different paths. Whatever is wrong with the input (an
 * unsafe name, a `before` or `after` that is not a record, a time that is not ISO 8601 UTC, a
 * deletion of a record that does not exist) throws before anything is written.
 *
 * Before the journal is written every path is read and its `rev` must be the one in `before`
 * (`null`, no file, when `before` is absent): otherwise a `StaleWriteError` is thrown and nothing
 * is written, so someone saving from a copy that is out of date leaves no trace in the journal.
 * Records are then written with `writeRecord`, with the same expectation. The check and the writes
 * are separate steps and a shared folder has no lock, so two people committing to the same record
 * at the same instant can both pass the check: the second record write then fails with a
 * `StaleWriteError`, after its operation file is already in the journal. That file is a journal
 * ahead of the record, which `checkConsistency` reports as `diverged`. A failure while writing
 * several records likewise leaves the ones before it written.
 */
export async function commitChange(
  store: Store,
  input: Omit<Operation, 'id' | 'v' | 'at'>,
  clock: () => string,
  newId: () => string,
): Promise<Operation> {
  assertSafeSegment(input.profileId);
  const id = newId();
  assertSafeSegment(id);
  const changes = input.changes.map(normaliseChange);
  if (new Set(changes.map((change) => change.path)).size !== changes.length) {
    throw new RangeError('An operation cannot change the same path twice');
  }

  const parsed = OperationSchema.safeParse({ ...input, id, v: 1, at: clock(), changes });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Not a valid operation (${issues})`, { cause: parsed.error });
  }
  const operation = parsed.data;

  const file = journalPath(operation);
  if ((await store.readJson(file)) !== undefined) {
    throw new Error(`The journal already has ${file}: an operation file is never overwritten`);
  }
  for (const { path, before } of changes) {
    const expected = before?.rev ?? null;
    const actual = await currentRev(store, path);
    if (actual !== expected) throw new StaleWriteError(path, expected, actual);
  }

  await store.writeJsonAtomic(file, operation);
  for (const { path, before, after } of changes) {
    await writeRecord(store, path, after, { expectedRev: before?.rev ?? null });
  }
  return operation;
}

// --- Reading ---------------------------------------------------------------------------------

/**
 * Every operation in `_app/journal/`, by time and then by `id`, with the files that could not be
 * used as `problems` (cut short, a conflict copy, written by a newer app, not an operation): a bad
 * file is reported and never stops the others from being read, as with `loadAll`.
 */
export async function readJournal(
  store: Store,
): Promise<{ operations: Operation[]; problems: Problem[] }> {
  const { records, problems } = await loadDir(store, JOURNAL_DIR, OperationSchema, {
    includeDeleted: true,
  });
  return { operations: [...records].sort(compareByTime), problems };
}

/** The ids of the operations that were undone and of the undo operations that did it. */
function cancelledIds(operations: readonly Operation[]): Set<string> {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.undoes === undefined) continue;
    ids.add(operation.id);
    ids.add(operation.undoes);
  }
  return ids;
}

/** The operation with id `opId` and its place in `operations`; throws if there is none. */
function locate(
  operations: readonly Operation[],
  opId: string,
): { index: number; operation: Operation } {
  const index = operations.findIndex((operation) => operation.id === opId);
  const operation = operations[index];
  if (operation === undefined) throw new Error(`Unknown operation ${opId}`);
  return { index, operation };
}

/**
 * The operations after `target`, which is `operations[index]`, that depend on it, by time: those
 * that touch one of its paths, and, going on in time, those that touch a path of a dependent
 * already found (so a dependent of a dependent counts). An operation that was undone and the undo
 * that did it cancel each other out, so neither counts.
 */
function dependentsAfter(
  operations: readonly Operation[],
  index: number,
  target: Operation,
): Operation[] {
  const cancelled = cancelledIds(operations);
  const paths = new Set(target.changes.map((change) => change.path));
  const dependents: Operation[] = [];
  for (const operation of operations.slice(index + 1)) {
    if (cancelled.has(operation.id)) continue;
    if (!operation.changes.some((change) => paths.has(change.path))) continue;
    dependents.push(operation);
    for (const change of operation.changes) paths.add(change.path);
  }
  return dependents;
}

/**
 * The operations that depend on `opId`, by time: later operations that touch a record it changed,
 * and, transitively, later ones that touch a record those changed. An operation that was already
 * undone and the undo operation that did it cancel each other out and are left out. Throws if
 * `opId` is not in the journal.
 */
export async function dependentsOf(store: Store, opId: string): Promise<Operation[]> {
  const { operations } = await readJournal(store);
  const { index, operation } = locate(operations, opId);
  return dependentsAfter(operations, index, operation);
}

// --- Undo ------------------------------------------------------------------------------------

/**
 * Undoes one operation: a new operation of kind `undo` that puts each record back as the
 * operation found it (`before`), or marks it deleted if the operation created it. What is on disk
 * now becomes the `before` of the undo, whatever it is; the check for later operations is the
 * caller's.
 */
async function undoOne(
  store: Store,
  operation: Operation,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation> {
  const changes: Change[] = [];
  for (const change of operation.changes) {
    changes.push({
      path: change.path,
      before: await store.readJson(change.path),
      after: change.before,
    });
  }
  return commitChange(
    store,
    {
      profileId,
      kind: 'undo',
      ...(operation.apartmentId === undefined ? {} : { apartmentId: operation.apartmentId }),
      summary: `Annullata: ${operation.summary}`,
      changes,
      undoes: operation.id,
    },
    clock,
    newId,
  );
}

/**
 * Undoes the operation `opId` for the profile `profileId`: writes a new operation (kind `undo`,
 * with `undoes` set to `opId`) that puts every record it changed back as it was before, with a
 * `rev` that goes on from the current one. A record the operation created is marked `deleted`.
 * Returns the undo operation.
 *
 * Throws, and changes nothing, if `opId` is not in the journal, if it was already undone (an
 * undo operation can be undone too, which brings the change back, but only once), or if later
 * operations depend on it (see `dependentsOf`) and `opts.cascade` is not `true`. With `cascade`
 * the dependents are undone first, newest first, and `opId` last, each with an undo operation of
 * its own; the one returned is the last, the undo of `opId`. The cascade is a series of
 * `commitChange` calls and not one step: if one fails (a record changed in the meantime), the
 * undo operations before it stay in the journal, and undoing again continues from there.
 */
export async function undoOperation(
  store: Store,
  opId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
  opts: { cascade?: boolean } = {},
): Promise<Operation> {
  assertSafeSegment(profileId);
  const { operations } = await readJournal(store);
  const { index, operation: target } = locate(operations, opId);

  const undoer = operations.find((operation) => operation.undoes === opId);
  if (undoer !== undefined) {
    throw new Error(`Operation ${opId} was already undone by ${undoer.id}`);
  }
  const dependents = dependentsAfter(operations, index, target);
  if (dependents.length > 0 && opts.cascade !== true) {
    const ids = dependents.map((operation) => operation.id).join(', ');
    throw new Error(
      `Cannot undo ${opId}: ${String(dependents.length)} later operation(s) depend on it (${ids}); ` +
        'undo them too with cascade',
    );
  }

  for (const dependent of [...dependents].reverse()) {
    await undoOne(store, dependent, profileId, clock, newId);
  }
  return undoOne(store, target, profileId, clock, newId);
}

// --- Consistency -----------------------------------------------------------------------------

/** For every path in the journal, the `after` of the latest operation that touches it. */
async function latestAfterByPath(store: Store): Promise<Map<string, JsonRecord>> {
  const { operations } = await readJournal(store);
  const latest = new Map<string, JsonRecord>();
  for (const operation of operations) {
    for (const change of operation.changes) {
      if (isRecord(change.after)) latest.set(change.path, change.after);
    }
  }
  return latest;
}

/** Structural equality of two JSON values; the order of the keys of an object does not matter. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonEqual(item, b[index]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
    );
  }
  return false;
}

/** Whether the file at `path` holds `expected`; a file that is not valid JSON does not. */
async function fileHolds(store: Store, path: string, expected: unknown): Promise<boolean> {
  try {
    return jsonEqual(await store.readJson(path), expected);
  } catch (error) {
    if (error instanceof MalformedJsonError) return false;
    throw error;
  }
}

/**
 * Compares every record in the journal with its latest operation (by time, then by `id`) and
 * reports each one that is not as that operation's `after` says as `diverged`, by path. A record
 * is also `diverged` when its file is missing or cut short. This is what an interruption between
 * the journal and the record leaves, or an edit by hand. Only these problems are returned: the
 * files of the journal that cannot be read are in `readJournal`'s `problems`.
 */
export async function checkConsistency(store: Store): Promise<Problem[]> {
  const latest = await latestAfterByPath(store);
  const problems: Problem[] = [];
  for (const [path, after] of [...latest].sort(([a], [b]) => compareText(a, b))) {
    if (!(await fileHolds(store, path, after))) problems.push({ path, reason: 'diverged' });
  }
  return problems;
}

/**
 * Writes the record at `path` as its latest operation in the journal says (its `after`),
 * whatever is on disk, without the `rev` check of `writeRecord`: the journal is the authority
 * here. Throws if no operation in the journal touches `path`.
 */
export async function repairDiverged(store: Store, path: string): Promise<void> {
  const normalised = path.normalize('NFC');
  const after = (await latestAfterByPath(store)).get(normalised);
  if (after === undefined) throw new Error(`No operation in the journal touches ${path}`);
  await store.writeJsonAtomic(normalised, after);
}

// --- Notes -----------------------------------------------------------------------------------

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
