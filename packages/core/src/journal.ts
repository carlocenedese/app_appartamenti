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
import type { ZodType } from 'zod';
import { TimestampSchema, WorkspaceSchema, recordSchemas } from './model';
import {
  DEFAULT_CONFLICT_RULES,
  compareText,
  conflictProblem,
  isSafePath,
  dropsKeys,
  loadDir,
} from './store/load';
import type { ConflictNameRule } from './store/load';
import { StaleWriteError, currentRev, writeRecord } from './store/records';
import {
  DATA_DIR,
  MalformedJsonError,
  NewerDataError,
  WORKSPACE_PATH,
  assertSafeRelPath,
  assertSafeSegment,
  isFileAccessError,
} from './store/store';
import type { Problem, Store } from './store/store';
import { compactTimestamp, compareByTime, compareTimestamps } from './time';
import { DATA_FORMAT } from './version';

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
    after: z.unknown(),
  })
  .refine(({ before, after }) => (before === undefined || hasRev(before)) && hasRev(after), {
    message: 'A stored change needs an `after` record, and a `before` that is a record with a rev',
  })
  .meta({
    description:
      'One record file changed by the operation, as whole records with their rev. `after` is the ' +
      'record as written to disk: its rev is the one after the rev of `before` (1 when the ' +
      'operation created the record), and a record is deleted by writing it with `deleted: ' +
      'true`, never by removing the file. `before` is the record as it was, and is absent when ' +
      'the operation created the record. `path` is a safe path below the workspace root: no ' +
      'absolute path, no `..`, none of the characters Windows forbids in names.',
  });

/**
 * An operation as stored in `_app/journal/`. `before` and `after` are whole records (any content,
 * `rev` included): `before` is absent when the operation created the record. The schema describes
 * what is stored, so it asks for an `after` record in every change; the `Operation` type is also
 * the input of `commitChange`, which accepts an `after` that is `undefined` to delete the record
 * and fills it in. A file that does not pass is reported by `readJournal` and never used.
 */
export const OperationSchema = z
  .object({
    id: NonEmptyString,
    v: z.literal(1),
    /** ISO 8601 UTC, from the clock the caller passes in. */
    at: TimestampSchema,
    profileId: NonEmptyString,
    /** What kind of operation it is, e.g. `register-bill` (see `registerBill`); `undo` for an undo. */
    kind: NonEmptyString,
    apartmentId: NonEmptyString.optional(),
    /** One line for the history, in Italian. */
    summary: NonEmptyString,
    reason: z.string().optional(),
    changes: z.array(ChangeSchema),
    /** The id of the operation this one undoes. */
    undoes: NonEmptyString.optional(),
  })
  .meta({
    description:
      'An operation of the journal: one file in _app/journal/, named <at as YYYYMMDDTHHmmssSSSZ>-' +
      '<profileId>-<id>.json, written before the records it changes and never changed or removed. ' +
      'An undo has kind `undo` and `undoes` set to the id of the operation it undoes.',
  });
export type Operation = z.infer<typeof OperationSchema>;

type Change = Operation['changes'][number];

/** A change as `commitChange` writes it: both sides are records, and `after.rev` is the new `rev`. */
type NormalisedChange = {
  path: string;
  before: (JsonRecord & { rev: number }) | undefined;
  after: JsonRecord & { rev: number };
};

/** The name of the file of an operation, without `.json`: `<at>-<profileId>-<id>`. */
function journalStem({ at, profileId, id }: Pick<Operation, 'at' | 'profileId' | 'id'>): string {
  return `${compactTimestamp(at)}-${profileId}-${id}`;
}

function journalPath(operation: Pick<Operation, 'at' | 'profileId' | 'id'>): string {
  return `${JOURNAL_DIR}/${journalStem(operation)}.json`;
}

// --- Writing ---------------------------------------------------------------------------------

/** Throws `NewerDataError` when `workspace.json` says the folder has a newer data format. */
async function refuseNewerFormat(store: Store): Promise<void> {
  let raw: unknown;
  try {
    raw = await store.readJson(WORKSPACE_PATH);
  } catch (error) {
    if (error instanceof MalformedJsonError) return; // assessWorkspace reports it as invalid
    throw error;
  }
  const workspace = WorkspaceSchema.safeParse(raw);
  if (workspace.success && workspace.data.schemaVersion > DATA_FORMAT) {
    throw new NewerDataError(WORKSPACE_PATH);
  }
}

/**
 * Throws `NewerDataError` when the record on disk at `path` was written by a newer app: a `v`
 * above 1, or keys its schema does not know (writing over it would drop them). Only records of a
 * kind in `recordSchemas` are checked by schema; the `v` check holds for every record.
 */
function refuseNewerRecord(path: string, raw: unknown): void {
  if (!isRecord(raw)) return;
  if (typeof raw.v === 'number' && raw.v > 1) throw new NewerDataError(path);
  const kind = path.startsWith(`${DATA_DIR}/`) ? path.split('/')[2] : undefined;
  const schemas: Record<string, ZodType> = recordSchemas;
  const schema = kind !== undefined && Object.hasOwn(schemas, kind) ? schemas[kind] : undefined;
  const parsed = schema?.safeParse(raw);
  if (parsed?.success === true && dropsKeys(raw, parsed.data)) throw new NewerDataError(path);
}

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
  await refuseNewerFormat(store);
  for (const { path, before } of changes) {
    const expected = before?.rev ?? null;
    const actual = await currentRev(store, path);
    if (actual !== expected) throw new StaleWriteError(path, expected, actual);
    refuseNewerRecord(path, await store.readJson(path));
  }

  await store.writeJsonAtomic(file, operation);
  for (const { path, before, after } of changes) {
    await writeRecord(store, path, after, { expectedRev: before?.rev ?? null });
  }
  return operation;
}

/**
 * Every operation in `_app/journal/`, by time and then by `id`, with the files that could not be
 * used as `problems` (cut short, a conflict copy, written by a newer app, not an operation): a bad
 * file is reported and never stops the others from being read, as with `loadAll`. A file may have
 * any name, but an id in more than one file is a copy: only the file with the name the journal
 * gives it (`<at>-<profileId>-<id>.json`) is used, none when no single file has it, and the
 * others are reported as `duplicate-id`.
 */
export async function readJournal(
  store: Store,
  conflictRules: readonly ConflictNameRule[] = DEFAULT_CONFLICT_RULES,
): Promise<{ operations: Operation[]; problems: Problem[] }> {
  const naming = { stemOf: journalStem, strict: false };
  const { records, problems } = await loadDir(
    store,
    JOURNAL_DIR,
    OperationSchema,
    naming,
    { includeDeleted: true },
    conflictRules,
  );
  return { operations: [...records].sort(compareByTime), problems };
}

// --- Order of the operations on a record -----------------------------------------------------

/** What one operation leaves in one record file: the `after` of its change to that path. */
type Touch = { operation: Operation; after: JsonRecord & { rev: number } };

/**
 * Orders what two operations did to the same record: by the `rev` they leave in it, then by time,
 * then by `id`. For one record the chain of `rev`s is the order of the changes: `writeRecord`
 * only writes on top of the `rev` it expects, so every change builds on the one before. Time is
 * not that order, because the clocks of two machines sharing the folder can disagree by minutes
 * and operations made in the same millisecond tie. Time and `id` only order changes that leave
 * the same `rev` (a fork that Dropbox made, where nothing is right and the order is only fixed).
 */
function compareTouches(a: Touch, b: Touch): number {
  return (
    a.after.rev - b.after.rev ||
    compareTimestamps(a.operation.at, b.operation.at) ||
    compareText(a.operation.id, b.operation.id)
  );
}

/** For each path, what the operations did to it, in order (see `compareTouches`). */
function touchesByPath(operations: readonly Operation[]): Map<string, Touch[]> {
  const byPath = new Map<string, Touch[]>();
  for (const operation of operations) {
    for (const { path, after } of operation.changes) {
      if (!hasRev(after)) continue; // not in a file that passed the schema
      const touches = byPath.get(path) ?? [];
      touches.push({ operation, after });
      byPath.set(path, touches);
    }
  }
  for (const touches of byPath.values()) touches.sort(compareTouches);
  return byPath;
}

/** For every path, the operation of its latest change (see `compareTouches`): what left it so. */
export function latestOperationByPath(operations: readonly Operation[]): Map<string, Operation> {
  const latest = new Map<string, Operation>();
  for (const [path, touches] of touchesByPath(operations)) {
    const last = touches.at(-1);
    if (last !== undefined) latest.set(path, last.operation);
  }
  return latest;
}

// --- Undo state and dependents ---------------------------------------------------------------

/**
 * Which operations are in force. An operation was undone when another operation has `undoes` set
 * to its id, but that undo can be undone in turn (a redo), which brings the operation back. So
 * an operation is in force unless one of the operations that undo it is itself in force; this is
 * followed along the chain of undos. (A journal where undos undo each other in a loop is damaged;
 * the loop is cut so that reading it still ends.)
 */
function undoState(operations: readonly Operation[]): {
  undoers: Map<string, Operation[]>;
  isEffective: (id: string) => boolean;
} {
  const undoers = new Map<string, Operation[]>();
  for (const operation of operations) {
    if (operation.undoes === undefined) continue;
    undoers.set(operation.undoes, [...(undoers.get(operation.undoes) ?? []), operation]);
  }
  const known = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isEffective = (id: string): boolean => {
    const cached = known.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const effective = !(undoers.get(id) ?? []).some((undoer) => isEffective(undoer.id));
    visiting.delete(id);
    known.set(id, effective);
    return effective;
  };
  return { undoers, isEffective };
}

/**
 * What to undo to take `operation` back: `operation` itself when it is in force and was never
 * undone, the redo in force when it was undone and brought back, `undefined` when it is not in
 * force (it was undone and not brought back). It is the calculation `undoOperation` needs.
 */
export function undoTargetOf(
  operations: readonly Operation[],
  operation: Operation,
): Operation | undefined {
  const { undoers, isEffective } = undoState(operations);
  if (!isEffective(operation.id)) return undefined;
  // A redo can itself have been undone and brought back: follow the chain (cut on a damaged loop).
  const seen = new Set<string>();
  let target = operation;
  for (;;) {
    const [first] = undoers.get(target.id) ?? [];
    if (first === undefined || seen.has(target.id)) return target;
    seen.add(target.id);
    const redo = (undoers.get(first.id) ?? []).find((undoer) => isEffective(undoer.id));
    if (redo === undefined) return target;
    target = redo;
  }
}

/** The operation with id `opId`; throws if there is none. */
function locate(operations: readonly Operation[], opId: string): Operation {
  const operation = operations.find((candidate) => candidate.id === opId);
  if (operation === undefined) throw new Error(`Unknown operation ${opId}`);
  return operation;
}

/**
 * The operations that depend on `target`, by time. A later change to a record `target` changed
 * depends on it, and so does a later change to a record that a dependent changed. "Later" is
 * decided for each record by `compareTouches`: a higher `rev`, whatever the clocks say. Only
 * changes in force count: an operation that was undone does not, and neither do the undo
 * operations, which cancel the operation they undo (a redo brings that operation back into force,
 * and then it counts).
 */
function dependentsAfter(operations: readonly Operation[], target: Operation): Operation[] {
  const { isEffective } = undoState(operations);
  const byPath = touchesByPath(
    operations.filter(
      (operation) =>
        operation === target || (operation.undoes === undefined && isEffective(operation.id)),
    ),
  );
  const reached = new Set<Operation>([target]);
  const pending = [target];
  for (let operation = pending.pop(); operation !== undefined; operation = pending.pop()) {
    for (const { path } of operation.changes) {
      const touches = byPath.get(path) ?? [];
      const own = touches.findIndex((touch) => touch.operation === operation);
      for (const { operation: later } of touches.slice(own + 1)) {
        if (reached.has(later)) continue;
        reached.add(later);
        pending.push(later);
      }
    }
  }
  reached.delete(target);
  return [...reached].sort(compareByTime);
}

/**
 * The operations that depend on `opId`: later changes to a record it changed and, transitively,
 * later changes to a record those changed. Later means a higher `rev` of that record, so it holds
 * also when the clock of the machine that made the change is behind. The list is by time, then by
 * `id`, as `readJournal` is. An operation that was undone and the undo that did it cancel each
 * other out and are left out, unless a redo brought the operation back. Throws if `opId` is not
 * in the journal.
 */
export async function dependentsOf(store: Store, opId: string): Promise<Operation[]> {
  const { operations } = await readJournal(store);
  return dependentsAfter(operations, locate(operations, opId));
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

/** Throws if `target` was undone and not brought back, or says what to undo if a redo did. */
function refuseIfUndone(operations: readonly Operation[], target: Operation): void {
  const { undoers, isEffective } = undoState(operations);
  const undoneBy = undoers.get(target.id) ?? [];
  const inForce = undoneBy.find((undoer) => isEffective(undoer.id));
  if (inForce !== undefined) {
    throw new Error(`Operation ${target.id} was already undone by ${inForce.id}`);
  }
  const [first] = undoneBy;
  if (first === undefined) return;
  // Every undo of it was undone in turn, so the operation is in force again through a redo.
  const redo = (undoers.get(first.id) ?? []).find((undoer) => isEffective(undoer.id));
  throw new Error(
    redo === undefined
      ? `Operation ${target.id} was already undone by ${first.id}`
      : `Operation ${target.id} was undone by ${first.id} and brought back by ${redo.id}: ` +
          `undo ${redo.id} to undo it again`,
  );
}

/**
 * Throws if a record that `toUndo` changed is not on disk as its latest operation in the journal
 * leaves it: another `rev` or other content. That is a change whose journal file has not arrived
 * yet (another machine saved it and Dropbox is still syncing), or a write that was interrupted;
 * undoing over it would put an older state on top of a change nobody can see in the history.
 */
async function refuseIfDiverged(
  store: Store,
  operations: readonly Operation[],
  toUndo: readonly Operation[],
): Promise<void> {
  const latest = latestAfter(operations);
  const paths = [...new Set(toUndo.flatMap(({ changes }) => changes.map(({ path }) => path)))];
  for (const path of paths.sort(compareText)) {
    const after = latest.get(path);
    const onDisk = await readTolerant(store, path);
    if (after === undefined || jsonEqual(onDisk, after)) continue;
    const diskRev = hasRev(onDisk) ? `rev ${String(onDisk.rev)}` : 'no readable record';
    throw new Error(
      `Cannot undo: ${path} is not as the journal leaves it (on disk ${diskRev}, in the journal ` +
        `rev ${String(after.rev)}). Wait until the shared folder has finished syncing, or check ` +
        'it with checkConsistency, then try again',
    );
  }
}

/**
 * Undoes the operation `opId` for the profile `profileId`: writes a new operation (kind `undo`,
 * with `undoes` set to `opId`) that puts every record it changed back as it was before, with a
 * `rev` that goes on from the current one. A record the operation created is marked `deleted`.
 * Returns the undo operation.
 *
 * Throws, and changes nothing, if `opId` is not in the journal, if it was already undone (an
 * undo operation can be undone too, which brings the change back, but only once; the message
 * names the redo to undo when a redo brought the operation back), or if later operations depend
 * on it (see `dependentsOf`) and `opts.cascade` is not `true`. It also throws, writing nothing,
 * if a record that it would put back is not on disk as its latest operation in the journal leaves
 * it (another `rev` or other content, see `checkConsistency`): that is a change whose journal
 * file has not synced yet, and undoing would overwrite it. With `cascade` the dependents are
 * undone first and `opId` last, each with an undo operation of its own; the one returned is the
 * last, the undo of `opId`. An operation is undone only after everything that depends on it, and
 * of two that are free to go first the later one goes first. The cascade is a series of
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
  const target = locate(operations, opId);
  refuseIfUndone(operations, target);

  const dependents = dependentsAfter(operations, target);
  if (dependents.length > 0 && opts.cascade !== true) {
    const ids = dependents.map((operation) => operation.id).join(', ');
    throw new Error(
      `Cannot undo ${opId}: ${String(dependents.length)} later operation(s) depend on it (${ids}); ` +
        'undo them too with cascade',
    );
  }

  // A fork, a conflict copy or a file that cannot be read blocks an undo as it blocks every store
  // (R113); a diverged record blocks it only when the undo would write it (below).
  const blocking = (await checkConsistency(store)).filter(({ reason }) => reason !== 'diverged');
  if (blocking.length > 0) {
    throw new Error(
      `Cannot undo: the folder has ${String(blocking.length)} problem(s) to resolve first ` +
        `(${[...new Set(blocking.map(({ reason }) => reason))].join(', ')})`,
    );
  }
  await refuseIfDiverged(store, operations, [target, ...dependents]);

  // Each round undoes one dependent that nothing else depends on, then looks again with the new
  // undo in the journal, so a dependent that was brought back by a redo is handled like the rest.
  let journal = operations;
  for (;;) {
    const remaining = dependentsAfter(journal, target);
    const last = remaining.filter((d) => dependentsAfter(journal, d).length === 0).at(-1);
    const next = last ?? remaining.at(-1); // a loop of dependents only in a damaged journal
    if (next === undefined) break;
    journal = [...journal, await undoOne(store, next, profileId, clock, newId)];
  }
  return undoOne(store, target, profileId, clock, newId);
}

// --- Consistency -----------------------------------------------------------------------------

/** For every path in `operations`, the `after` of the latest change to it (see `compareTouches`). */
function latestAfter(operations: readonly Operation[]): Map<string, JsonRecord & { rev: number }> {
  const latest = new Map<string, JsonRecord & { rev: number }>();
  for (const [path, touches] of touchesByPath(operations)) {
    const last = touches.at(-1);
    if (last !== undefined) latest.set(path, last.after);
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

/** The JSON in the file at `path`; `undefined` when there is no file or it is not valid JSON. */
async function readTolerant(store: Store, path: string): Promise<unknown> {
  try {
    return await store.readJson(path);
  } catch (error) {
    if (error instanceof MalformedJsonError) return undefined;
    throw error;
  }
}

/** As `readTolerant`, with `UNREADABLE` for a file that exists but cannot be read now. */
const UNREADABLE = Symbol('unreadable');
async function readOrMark(store: Store, path: string): Promise<unknown> {
  try {
    return await readTolerant(store, path);
  } catch (error) {
    if (isFileAccessError(error)) return UNREADABLE;
    throw error;
  }
}

/**
 * The paths whose latest `rev` is left by two operations or more with different content: a fork.
 * Two machines (or two windows) changed the same record from the same `rev` at once, and both
 * operation files reached the journal. Which one is right is for the person to decide
 * (`resolveFork`); the clock does not decide it.
 */
function forkedPaths(operations: readonly Operation[]): Set<string> {
  const forked = new Set<string>();
  for (const [path, touches] of touchesByPath(operations)) {
    const last = touches.at(-1);
    if (last === undefined) continue;
    const top = touches.filter(({ after }) => after.rev === last.after.rev);
    if (top.some(({ after }) => !jsonEqual(after, last.after))) forked.add(path);
  }
  return forked;
}

/**
 * The conflict copies (see `ConflictNameRule`) next to the records the journal knows and next to
 * `workspace.json`. A record has a conflict copy only if it exists, and it exists only through
 * an operation, so the folders of the paths in the journal are the ones to look in.
 */
async function conflictCopies(
  store: Store,
  paths: Iterable<string>,
  conflictRules: readonly ConflictNameRule[],
): Promise<Problem[]> {
  const dirs = new Set(['_app']);
  for (const path of paths) dirs.add(path.slice(0, path.lastIndexOf('/')));
  const problems: Problem[] = [];
  for (const dir of [...dirs].sort(compareText)) {
    for (const name of await store.list(dir)) {
      if (!name.endsWith('.json') || !conflictRules.some((rule) => rule.isConflictName(name))) {
        continue;
      }
      if (dir === '_app' && !name.includes('workspace')) continue;
      problems.push(conflictProblem(dir, name));
    }
  }
  return problems;
}

/**
 * Compares every record in the journal with its latest operation and reports each one that is not
 * as that operation's `after` says as `diverged`, by path. The latest operation on a record is
 * the one that leaves the highest `rev`, not the one with the latest time: the clocks of two
 * machines can disagree, and the `rev`s of a record are in the order of its changes. A record
 * is also `diverged` when its file is missing or cut short. This is what an interruption
 * between the journal and the record leaves, or an edit by hand.
 *
 * A record whose highest `rev` is left by two operations with different content is `forked`
 * instead (see `forkedPaths`), whatever is on disk: `repairDiverged` refuses it and the person
 * chooses with `resolveFork`. Every conflict copy of a record, of an operation file or of
 * `workspace.json` is reported too (`conflicted-copy`): until the person has compared it and set
 * it aside, nothing is written, since the copy may hold a change that is confirmed nowhere else.
 * The other files of the journal that cannot be read are in `readJournal`'s `problems`, not here.
 */
export async function checkConsistency(
  store: Store,
  conflictRules: readonly ConflictNameRule[] = DEFAULT_CONFLICT_RULES,
): Promise<Problem[]> {
  const { operations, problems: journalProblems } = await readJournal(store, conflictRules);
  const latest = latestAfter(operations);
  const forked = forkedPaths(operations);
  const problems: Problem[] = await conflictCopies(store, latest.keys(), conflictRules);
  // A conflict copy of an operation file, or one that cannot be read now, is reported by
  // readJournal; it blocks as the others do.
  problems.push(
    ...journalProblems.filter(
      ({ reason }) => reason === 'conflicted-copy' || reason === 'unreadable',
    ),
  );
  for (const [path, after] of [...latest].sort(([a], [b]) => compareText(a, b))) {
    if (forked.has(path)) {
      problems.push({ path, reason: 'forked' });
      continue;
    }
    const onDisk = await readOrMark(store, path);
    if (onDisk === UNREADABLE) problems.push({ path, reason: 'unreadable' });
    else if (!jsonEqual(onDisk, after)) problems.push({ path, reason: 'diverged' });
  }
  return problems.sort((a, b) => compareText(a.path, b.path));
}

/**
 * Writes the record at `path` as its latest operation in the journal says (its `after`),
 * without the `rev` check of `writeRecord`: the journal is the authority here. It finishes what an
 * interruption between the journal and the record left, which always leaves the record at a lower
 * `rev` (or missing, or cut short). Throws, writing nothing:
 *
 * - if no operation in the journal touches `path`;
 * - if the record is `forked` (two operations left its latest `rev` with different content): the
 *   person chooses with `resolveFork`, the clock never does;
 * - if the record on disk has a `rev` at or above that `after` with other content: putting the
 *   journal's version over it could replace a change that went through with one that failed, so
 *   that case is left to the person (the journal is then the one that is behind, for instance
 *   because a file of it did not arrive yet).
 */
export async function repairDiverged(store: Store, path: string): Promise<void> {
  const normalised = path.normalize('NFC');
  const { operations } = await readJournal(store);
  const after = latestAfter(operations).get(normalised);
  if (after === undefined) throw new Error(`No operation in the journal touches ${path}`);
  if (forkedPaths(operations).has(normalised)) {
    throw new Error(
      `Refusing to repair ${path}: two operations left rev ${String(after.rev)} with different ` +
        'content; choose the version to keep with resolveFork',
    );
  }
  const onDisk = await readTolerant(store, normalised);
  if (jsonEqual(onDisk, after)) return;
  if (hasRev(onDisk) && onDisk.rev >= after.rev) {
    throw new Error(
      `Refusing to repair ${path}: the record on disk has rev ${String(onDisk.rev)}, ` +
        `not below rev ${String(after.rev)} of its latest operation in the journal`,
    );
  }
  await store.writeJsonAtomic(normalised, after);
}

/**
 * The versions of a `forked` record to choose from: the operations that left its latest `rev`,
 * by time then `id`. Empty when the record at `path` is not forked.
 */
export async function forkVersions(store: Store, path: string): Promise<Operation[]> {
  const normalised = path.normalize('NFC');
  const { operations } = await readJournal(store);
  if (!forkedPaths(operations).has(normalised)) return [];
  const touches = touchesByPath(operations).get(normalised) ?? [];
  const top = touches.at(-1)?.after.rev;
  return touches
    .filter(({ after }) => after.rev === top)
    .map(({ operation }) => operation)
    .sort(compareByTime);
}

/**
 * Ends a fork with the version the person chose: one new operation (kind `fork.resolve`) that
 * writes the `after` of operation `keepOpId` on top of what is on disk, with the next `rev`, so
 * the record has one latest `rev` again. Nothing is lost: the other version stays in the journal
 * and in the `before` of this operation when it was the one on disk, and the operation can be
 * undone. Throws, writing nothing, when `path` is not forked or `keepOpId` is not one of its
 * versions (see `forkVersions`).
 */
export async function resolveFork(
  store: Store,
  path: string,
  keepOpId: string,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<Operation> {
  const normalised = path.normalize('NFC');
  const keep = (await forkVersions(store, normalised)).find(({ id }) => id === keepOpId);
  const after = keep?.changes.find((change) => change.path === normalised)?.after;
  if (keep === undefined || !hasRev(after)) {
    throw new Error(`${path} is not forked, or ${keepOpId} is not one of its versions`);
  }
  const onDisk = await readTolerant(store, normalised);
  return commitChange(
    store,
    {
      profileId,
      kind: 'fork.resolve',
      ...(keep.apartmentId === undefined ? {} : { apartmentId: keep.apartmentId }),
      summary: 'Scelta la versione da tenere di un dato modificato in due posti.',
      changes: [{ path: normalised, ...(hasRev(onDisk) ? { before: onDisk } : {}), after }],
    },
    clock,
    newId,
  );
}

// --- Damaged operation files -----------------------------------------------------------------

/** Where a damaged operation file is set aside, relative to the workspace root. */
export const DAMAGED_JOURNAL_DIR = '_app/journal-danneggiati';

/**
 * An operation file that cannot be read (empty, cut short, not an operation) and what can be done
 * with it. `safeToSetAside` is true only when it is shown that the operation left no effect the
 * rest of the folder does not explain; the platform then moves the file to `setAsideTo` (the core
 * `Store` cannot move files: `moveFileNoOverwrite` in store-fs, a rename on Tauri), never over an
 * existing file. Otherwise `blockedBy` says why, and the file must be restored (for instance from
 * the version history of Dropbox) or the person decides.
 */
export type DamagedJournalFile = {
  path: string;
  setAsideTo: string;
  safeToSetAside: boolean;
  /**
   * - `records-differ`: a record is not as the readable journal says (diverged or forked): the
   *   damaged operation may be what changed it;
   * - `unexplained-record`: a record file that no readable operation wrote;
   * - `broken-chain`: an operation starts from a `rev` that no readable operation left, or undoes
   *   an operation that is not in the journal.
   */
  blockedBy: ('records-differ' | 'unexplained-record' | 'broken-chain')[];
};

/**
 * The operation files of the journal that cannot be read (`malformed-json`, `schema-mismatch`),
 * each with whether it can be set aside safely (see `DamagedJournalFile`). A file from a newer app
 * (`future-version`) or a conflict copy is not damaged and is not listed. `recordKinds` are the
 * folders of `_app/dati` to look in for records no operation explains (default: every kind).
 */
export async function damagedJournalFiles(
  store: Store,
  recordKinds: readonly string[] = Object.keys(recordSchemas),
): Promise<DamagedJournalFile[]> {
  const { operations, problems } = await readJournal(store);
  const damaged = problems.filter(
    ({ reason }) => reason === 'malformed-json' || reason === 'schema-mismatch',
  );
  if (damaged.length === 0) return [];

  const blockedBy = new Set<DamagedJournalFile['blockedBy'][number]>();
  if ((await checkConsistency(store)).some(({ reason }) => reason !== 'conflicted-copy')) {
    blockedBy.add('records-differ');
  }
  const touches = touchesByPath(operations);
  for (const kind of recordKinds) {
    for (const name of await store.list(`${DATA_DIR}/${kind}`)) {
      const copy = DEFAULT_CONFLICT_RULES.some((rule) => rule.isConflictName(name));
      if (name.endsWith('.json') && !copy && !touches.has(`${DATA_DIR}/${kind}/${name}`)) {
        blockedBy.add('unexplained-record');
      }
    }
  }
  const ids = new Set(operations.map(({ id }) => id));
  for (const operation of operations) {
    if (operation.undoes !== undefined && !ids.has(operation.undoes)) blockedBy.add('broken-chain');
    for (const { path, before } of operation.changes) {
      if (!hasRev(before)) continue;
      const left = touches.get(path) ?? [];
      if (!left.some(({ after }) => after.rev === before.rev)) blockedBy.add('broken-chain');
    }
  }
  const reasons = [...blockedBy].sort(compareText);
  return damaged.map(({ path }) => ({
    path,
    setAsideTo: `${DAMAGED_JOURNAL_DIR}/${path.slice(JOURNAL_DIR.length + 1)}`,
    safeToSetAside: reasons.length === 0,
    blockedBy: reasons,
  }));
}
