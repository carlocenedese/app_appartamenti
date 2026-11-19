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
import { refuseClosedPeriodChanges } from './closed-period-guard';
import { isoDate } from './period';
import { TimestampSchema, WorkspaceSchema, recordSchemas } from './model';
import {
  DEFAULT_CONFLICT_RULES,
  compareText,
  conflictProblem,
  isSafePath,
  dropsKeys,
  loadDir,
  noteForkedPaths,
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
    /**
     * The operations whose `after` at this path this change also replaces, besides `before`: the
     * versions a choice (`fork.resolve`) merged, or the write that failed under a retry. Absent in
     * every other change, and in the operations written before it existed (see `replacedBy`).
     */
    supersedes: z.array(NonEmptyString).optional(),
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
      'absolute path, no `..`, none of the characters Windows forbids in names. `supersedes` ' +
      'lists the operations whose `after` at this path the change also replaces: the versions a ' +
      '`fork.resolve` merged, or a write that failed under its retry.',
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
  return commitOperation(store, input, clock, newId);
}

/**
 * `commitChange`, and with `resolving` the write of `resolveFork`: each change then keeps the
 * `before` and `supersedes` it is given (the versions merged, whatever is on disk: one of them, a
 * file cut short or missing), its `after` gets the `rev` given, and the record is written without
 * the `rev` checks.
 */
async function commitOperation(
  store: Store,
  input: Omit<Operation, 'id' | 'v' | 'at'>,
  clock: () => string,
  newId: () => string,
  resolving?: { rev: number; supersedes: string[] },
): Promise<Operation> {
  assertSafeSegment(input.profileId);
  const id = newId();
  assertSafeSegment(id);
  const changes = input.changes.map(normaliseChange).map((change) =>
    resolving === undefined
      ? change
      : {
          ...change,
          after: { ...change.after, rev: resolving.rev },
          supersedes: resolving.supersedes,
        },
  );
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
  const parsedOperation = parsed.data;

  const file = journalPath(parsedOperation);
  if ((await store.readJson(file)) !== undefined) {
    throw new Error(`The journal already has ${file}: an operation file is never overwritten`);
  }
  await refuseNewerFormat(store);
  if (resolving !== undefined) {
    for (const { path } of changes) refuseNewerRecord(path, await readTolerant(store, path));
    await store.writeJsonAtomic(file, parsedOperation);
    for (const { path, after } of changes) await store.writeJsonAtomic(path, after);
    return parsedOperation;
  }
  const { operations } = await readJournal(store);
  // F5: what a closed period counted does not change until it is reopened.
  await refuseClosedPeriodChanges(store, operations, changes, forkedPaths(operations));
  const touches = touchesByPath(operations);
  /** For each path written on top of the head of the journal rather than on the disk. */
  const realigned = new Map<string, { rev: number; supersedes: string[] }>();
  /** What is on disk, which the operation stores as its `before`: the version it builds on. */
  const found = new Map<string, unknown>();
  for (const { path, before } of changes) {
    const expected = before?.rev ?? null;
    const actual = await currentRev(store, path);
    if (actual !== expected) throw new StaleWriteError(path, expected, actual);
    const onDisk = await store.readJson(path);
    found.set(path, onDisk);
    refuseNewerRecord(path, onDisk);
    const state = stateOf(touches.get(path) ?? []);
    if (state.forked) throw new InconsistentRecordError(path, 'forked');
    if (
      (touches.get(path) ?? []).length === 0 ||
      (state.head !== undefined && jsonEqual(onDisk, state.head.after))
    ) {
      continue;
    }
    // The record is not the one head of the journal. Only when that head is an operation whose
    // record write failed through this very store, and the record is still as that operation
    // found it, is it known that the change never landed: this one replaces it (`supersedes`), on
    // top of its rev. Anything else (the same person on another computer, a record still on its
    // way through Dropbox) is refused: `repairDiverged` applies what the journal says.
    const head = state.head;
    const failed =
      head !== undefined && failedOperations.get(store)?.has(head.operation.id) === true;
    if (head === undefined || !failed || !jsonEqual(onDisk, head.before)) {
      throw new InconsistentRecordError(path, 'diverged');
    }
    realigned.set(path, { rev: head.after.rev + 1, supersedes: [head.operation.id] });
  }
  const operation: Operation = {
    ...parsedOperation,
    changes: parsedOperation.changes.map((change) => {
      const stored =
        change.before === undefined ? change : { ...change, before: found.get(change.path) };
      const again = realigned.get(change.path);
      return again === undefined
        ? stored
        : {
            ...stored,
            after: { ...(change.after as JsonRecord), rev: again.rev },
            supersedes: again.supersedes,
          };
    }),
  };

  await store.writeJsonAtomic(file, operation);
  try {
    for (const { path, before, after } of changes) {
      const expectedRev = before?.rev ?? null;
      const again = realigned.get(path);
      if (again === undefined) {
        await writeRecord(store, path, after, { expectedRev });
        continue;
      }
      const actual = await currentRev(store, path);
      if (actual !== expectedRev) throw new StaleWriteError(path, expectedRev, actual);
      await store.writeJsonAtomic(path, { ...after, rev: again.rev });
    }
  } catch (error) {
    // The operation is in the journal but its records are not (all) written: a retry through this
    // store may go on top of it (see above).
    const failed = failedOperations.get(store) ?? new Set<string>();
    failed.add(operation.id);
    failedOperations.set(store, failed);
    throw error;
  }
  return operation;
}

/**
 * The operations whose record writes failed through each store, in this session. Only those are
 * known not to have landed; a journal ahead of the records for any other reason is never written
 * over (revisione 2026-11-18, second review).
 */
const failedOperations = new WeakMap<Store, Set<string>>();

/**
 * Thrown by `commitChange`, writing nothing, when a record it would change is not as the journal
 * leaves it: `forked` (two versions to choose from with `resolveFork`) or `diverged` (to repair
 * with `repairDiverged` first). The message, in Italian, names only the relative path.
 */
export class InconsistentRecordError extends Error {
  readonly path: string;
  readonly reason: 'forked' | 'diverged';

  constructor(path: string, reason: 'forked' | 'diverged') {
    super(
      reason === 'forked'
        ? `${path}: il dato è stato modificato in due posti; scegli prima la versione da tenere`
        : `${path}: il dato non è come dice il registro; ripara la cartella prima di modificarlo`,
    );
    this.name = 'InconsistentRecordError';
    this.path = path;
    this.reason = reason;
  }
}

/**
 * Whether the stores must refuse to write: `checkConsistency` reports a problem other than a
 * fork. A fork blocks only the writes to its own record (`commitChange` refuses them) and the
 * reads of its kind (`loadAll`), so the rest of the folder stays usable while the person chooses.
 */
export async function writesBlocked(store: Store): Promise<boolean> {
  return (await checkConsistency(store)).some(({ reason }) => reason !== 'forked');
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
type Touch = {
  operation: Operation;
  before: unknown;
  after: JsonRecord & { rev: number };
  supersedes: string[] | undefined;
};

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
    for (const { path, before, after, supersedes } of operation.changes) {
      if (!hasRev(after)) continue; // not in a file that passed the schema
      const touches = byPath.get(path) ?? [];
      touches.push({ operation, before, after, supersedes });
      byPath.set(path, touches);
    }
  }
  for (const touches of byPath.values()) touches.sort(compareTouches);
  return byPath;
}

// --- Versions and heads of a record --------------------------------------------------------

/** The identity of a version of a record: its whole content, `rev` included, as canonical JSON. */
function versionKey(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : isRecord(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort(compareText)
              .map((key) => [key, canonical(item[key])]),
          )
        : item;
  return JSON.stringify(canonical(value)) ?? '';
}

/**
 * The versions that `touch` replaces besides its `before`: the operations in its `supersedes`.
 * An operation written before `supersedes` existed says it in its shape, and only two kinds wrote
 * over more than their `before`: a `fork.resolve`, which merged every version at the rev below
 * its own, and the retry of a failed write, which jumped the rev over the failed write of the same
 * profile from the same `before` rev.
 */
function replacedBy(touch: Touch, touches: readonly Touch[]): Touch[] {
  if (touch.supersedes !== undefined) {
    const ids = new Set(touch.supersedes);
    return touches.filter(({ operation }) => ids.has(operation.id));
  }
  if (touch.operation.kind === 'fork.resolve') {
    return touches.filter((other) => other.after.rev === touch.after.rev - 1);
  }
  const from = hasRev(touch.before) ? touch.before.rev : 0;
  if (touch.after.rev === from + 1) return [];
  return touches.filter(
    (other) =>
      other.operation.profileId === touch.operation.profileId &&
      (hasRev(other.before) ? other.before.rev : 0) === from &&
      other.after.rev > from &&
      other.after.rev < touch.after.rev,
  );
}

/**
 * The state of one record in the journal. Every change is an edge from the versions it replaces
 * (its `before` and what it `supersedes`) to its `after`; an undo is one more edge. The heads are
 * the versions that nothing replaces, one touch each (the earliest that left it).
 *
 * - `forked`: two heads or more, so two computers changed the record and neither saw the other;
 * - `head`: the one head, when there is one: the record must be equal to it;
 * - `top`: `head`, or, while `incomplete`, the one head at the highest rev: a record equal to it
 *   is not reported (the folder stays writable), but it cannot be written, repaired or chosen
 *   until the missing operation file arrives;
 * - `incomplete`: the changes start from more than one place (nothing, for a creation, or a
 *   version no operation here left, as a record older than the journal), or one supersedes an
 *   operation that is not here: an operation file has not arrived yet, and more heads then mean
 *   waiting, not a fork;
 * - `builtOn(record)`: whether the head was built on `record`, through `before`s and explicit
 *   `supersedes`.
 */
function stateOf(touches: readonly Touch[]): {
  heads: Touch[];
  head: Touch | undefined;
  top: Touch | undefined;
  forked: boolean;
  incomplete: boolean;
  builtOn: (record: unknown) => boolean;
} {
  const keys = new Map(touches.map((touch) => [touch, versionKey(touch.after)]));
  const left = new Set(keys.values());
  const parents = new Map<string, string[]>();
  let incomplete = false;
  /** Where the changes start: nothing (a creation) or a version that no operation here left. */
  const starts = new Set<string>();
  const ids = new Set(touches.map(({ operation }) => operation.id));
  /** Versions some change was made on: they are not heads. */
  const builtUpon = new Set<string>();
  const superseded = new Set<Touch>();
  for (const touch of touches) {
    if (touch.supersedes?.some((id) => !ids.has(id)) === true) incomplete = true;
    const others = replacedBy(touch, touches);
    for (const other of others) superseded.add(other);
    // Only `before` and an explicit `supersedes` make a version an ancestor that «Ripara» may write
    // over. What an old operation is read to replace only stops being a head: a branch it never
    // saw (a third computer's, arrived later) stays hidden as before, but is never overwritten.
    const replaced =
      touch.supersedes === undefined ? [] : others.map((other) => keys.get(other) ?? '');
    if (touch.before !== undefined) {
      const before = versionKey(touch.before);
      replaced.push(before);
      builtUpon.add(before);
      if (!left.has(before)) starts.add(before);
    } else {
      starts.add('');
    }
    const key = keys.get(touch) ?? '';
    parents.set(key, [...(parents.get(key) ?? []), ...replaced]);
  }
  // A superseded version stops being a head only when every change that left it is superseded:
  // the same content left by another operation (another computer's) was not replaced.
  const standing = new Map<string, number>();
  for (const [touch, key] of keys) {
    if (!superseded.has(touch)) standing.set(key, (standing.get(key) ?? 0) + 1);
  }
  const replacedKeys = new Set(builtUpon);
  for (const key of left) if (!standing.has(key)) replacedKeys.add(key);
  const heads: Touch[] = [];
  const seen = new Set<string>();
  for (const touch of [...touches].sort((a, b) => compareByTime(a.operation, b.operation))) {
    const key = keys.get(touch) ?? '';
    if (replacedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    heads.push(touch);
  }
  const head = heads.length === 1 ? heads[0] : undefined;
  const builtOn = (record: unknown): boolean => {
    if (head === undefined) return false;
    const wanted = versionKey(record);
    const visited = new Set<string>();
    const pending = [...(parents.get(keys.get(head) ?? '') ?? [])];
    for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
      if (key === wanted) return true;
      if (visited.has(key)) continue;
      visited.add(key);
      pending.push(...(parents.get(key) ?? []));
    }
    return false;
  };
  if (starts.size > 1) incomplete = true;
  const topRev = Math.max(...heads.map(({ after }) => after.rev));
  const atTop = heads.filter(({ after }) => after.rev === topRev);
  const top = incomplete && atTop.length === 1 ? atTop[0] : head;
  return { heads, head, top, forked: heads.length > 1 && !incomplete, incomplete, builtOn };
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
  const touches = touchesByPath(operations);
  const paths = [...new Set(toUndo.flatMap(({ changes }) => changes.map(({ path }) => path)))];
  for (const path of paths.sort(compareText)) {
    const { heads, head } = stateOf(touches.get(path) ?? []);
    const onDisk = await readTolerant(store, path);
    if (head !== undefined && jsonEqual(onDisk, head.after)) continue;
    const diskRev = hasRev(onDisk) ? `rev ${String(onDisk.rev)}` : 'no readable record';
    const revs = heads.map(({ after }) => `rev ${String(after.rev)}`).join(' and ');
    throw new Error(
      `Cannot undo: ${path} is not as the journal leaves it (on disk ${diskRev}, in the journal ` +
        `${revs}). Wait until the shared folder has finished syncing, or check it with ` +
        'checkConsistency, then try again',
    );
  }
}

/**
 * F5: throws `ClosedPeriodError`, writing nothing, if undoing any of `toUndo` would change what a
 * closed period counted. For a caller that undoes several operations one by one (`undoFile`).
 */
export async function refuseClosedPeriodUndo(
  store: Store,
  toUndo: readonly Operation[],
  journal?: readonly Operation[],
): Promise<void> {
  const operations = journal ?? (await readJournal(store)).operations;
  for (const operation of toUndo) {
    const back = await Promise.all(
      operation.changes.map(async (change) => ({
        path: change.path,
        before: await readTolerant(store, change.path),
        after: change.before,
      })),
    );
    await refuseClosedPeriodChanges(store, operations, back, forkedPaths(operations));
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
  // A fork blocks the undo only where it writes: commitChange refuses its paths.
  const blocking = (await checkConsistency(store)).filter(
    ({ reason }) => reason !== 'diverged' && reason !== 'forked',
  );
  if (blocking.length > 0) {
    throw new Error(
      `Cannot undo: the folder has ${String(blocking.length)} problem(s) to resolve first ` +
        `(${[...new Set(blocking.map(({ reason }) => reason))].join(', ')})`,
    );
  }
  await refuseIfDiverged(store, operations, [target, ...dependents]);
  // F5: refused before the first undo of a cascade, so that none is left half done.
  await refuseClosedPeriodUndo(store, [target, ...dependents], operations);
  // Finding 9: no undo closes a period without a new snapshot. Imported here, when needed, because
  // `period-close.ts` reads the settlement, which imports this module.
  if (
    [target, ...dependents].some((o) =>
      o.changes.some((c) => c.path.startsWith('_app/dati/periodClose/')),
    )
  ) {
    const { refuseClosingUndo } = await import('./period-close');
    await refuseClosingUndo(store, [target, ...dependents], isoDate(clock().slice(0, 10)));
  }

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
 * The paths with two heads or more (see `stateOf`): a fork. Two machines (or two windows) changed
 * the same record and neither saw the other's change, and both operation files reached the
 * journal. Which one is right is for the person to decide (`resolveFork`); the clock does not.
 */
function forkedPaths(operations: readonly Operation[]): Set<string> {
  const forked = new Set<string>();
  for (const [path, touches] of touchesByPath(operations)) {
    if (stateOf(touches).forked) forked.add(path);
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
 * Checks every record in the journal against the one invariant: its changes leave exactly one
 * head (see `stateOf`) and the record on disk is that head. A record with one head and something
 * else on disk is `diverged`, by path: its file is behind (an interruption between the journal and
 * the record), missing, cut short, edited by hand, or ahead (its operation file has not arrived).
 * Two heads or more while an operation file is still missing are `diverged` too: synchronisation
 * is not over. The clocks play no part: two machines can disagree.
 *
 * A record with two heads or more is `forked` instead, whatever is on disk: `repairDiverged` refuses it and the person
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
  const touches = touchesByPath(operations);
  const forked = forkedPaths(operations);
  noteForkedPaths(store, forked);
  const problems: Problem[] = await conflictCopies(store, touches.keys(), conflictRules);
  // A conflict copy of an operation file, or one that cannot be read now, is reported by
  // readJournal; it blocks as the others do.
  problems.push(
    ...journalProblems.filter(
      ({ reason }) => reason === 'conflicted-copy' || reason === 'unreadable',
    ),
  );
  for (const [path, list] of [...touches].sort(([a], [b]) => compareText(a, b))) {
    if (forked.has(path)) {
      problems.push({ path, reason: 'forked' });
      continue;
    }
    const { top } = stateOf(list);
    const onDisk = await readOrMark(store, path);
    if (onDisk === UNREADABLE) problems.push({ path, reason: 'unreadable' });
    else if (top === undefined || !jsonEqual(onDisk, top.after)) {
      problems.push({ path, reason: 'diverged' });
    }
  }
  return problems.sort((a, b) => compareText(a.path, b.path));
}

/**
 * Writes the record at `path` as the one head of its changes in the journal (see `stateOf`),
 * without the `rev` check of `writeRecord`: the journal is the authority here. It finishes what an
 * interruption between the journal and the record left, which always leaves the record at a
 * version the head builds on (or missing, or cut short). Throws, writing nothing:
 *
 * - if no operation in the journal touches `path`;
 * - if the record is `forked`: the person chooses with `resolveFork`, the clock never does;
 * - if it has two heads while an operation file has not arrived yet: wait for the synchronisation;
 * - if the record on disk is a version the head does not build on (a `rev` at or above it, or a
 *   change it knew nothing of): writing over it could lose a change, so it is left to the person.
 */
export async function repairDiverged(store: Store, path: string): Promise<void> {
  const normalised = path.normalize('NFC');
  const { operations } = await readJournal(store);
  const touches = touchesByPath(operations).get(normalised);
  if (touches === undefined) throw new Error(`No operation in the journal touches ${path}`);
  const { head, forked, builtOn } = stateOf(touches);
  if (forked) {
    throw new Error(
      `Refusing to repair ${path}: it was changed in two places; choose the version to keep ` +
        'with resolveFork',
    );
  }
  if (head === undefined) {
    throw new Error(
      `Refusing to repair ${path}: an operation file has not arrived yet; wait for the ` +
        'synchronisation',
    );
  }
  const { after } = head;
  const onDisk = await readTolerant(store, normalised);
  if (jsonEqual(onDisk, after)) return;
  if (hasRev(onDisk) && onDisk.rev >= after.rev) {
    throw new Error(
      `Refusing to repair ${path}: the record on disk has rev ${String(onDisk.rev)}, ` +
        `not below rev ${String(after.rev)} of its latest operation in the journal`,
    );
  }
  // A record on disk that the head does not build on is a change it knew nothing of.
  if (hasRev(onDisk) && !builtOn(onDisk)) {
    throw new Error(
      `Refusing to repair ${path}: the record on disk is not a state its latest operation builds on`,
    );
  }
  await store.writeJsonAtomic(normalised, after);
}

/**
 * The versions of a `forked` record to choose from: for each head (see `stateOf`) the operation
 * that left it, by time then `id`. Empty when the record at `path` is not forked.
 */
export async function forkVersions(store: Store, path: string): Promise<Operation[]> {
  return (await forkHeads(store, path)).map(({ operation }) => operation);
}

/** Every operation that left one of `heads` at `path` (the same version can be left by several). */
async function headOperations(
  store: Store,
  path: string,
  heads: readonly Touch[],
): Promise<string[]> {
  const { operations } = await readJournal(store);
  const wanted = new Set(heads.map(({ after }) => versionKey(after)));
  return (touchesByPath(operations).get(path) ?? [])
    .filter(({ after }) => wanted.has(versionKey(after)))
    .map(({ operation }) => operation.id);
}

async function forkHeads(store: Store, path: string): Promise<Touch[]> {
  const { operations } = await readJournal(store);
  const state = stateOf(touchesByPath(operations).get(path.normalize('NFC')) ?? []);
  return state.forked ? state.heads : [];
}

/**
 * Ends a fork with the version the person chose: one new operation (kind `fork.resolve`) that
 * writes the `after` of operation `keepOpId` with a `rev` above every head, and lists in
 * `supersedes` the heads it merged, so the record has one head again. A version that was not
 * there at the choice (a third computer's, still on its way) stays a head: the record is forked
 * again when it arrives. Nothing is lost: the other versions stay in the journal, the one on disk
 * is the `before` of this operation when it was a head, and the operation can be undone. Throws,
 * writing nothing, when `path` is not forked or `keepOpId` is not one of its versions (see
 * `forkVersions`).
 *
 * It does not pass through the closed-period guard (F5, `refuseClosedPeriodChanges`): it writes one
 * of the versions already in the journal, each of which passed the guard when it was written, and
 * refusing it would leave the record forked with no way out. For a `periodClose` the choice can
 * drop the marks of the other version (sent, settled, reopened): `scegli-versione` lists them for
 * each version (`closeMarks`) so the person sees what is lost.
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
  const heads = await forkHeads(store, normalised);
  const keep = heads.find(({ operation }) => operation.id === keepOpId);
  if (keep === undefined) {
    throw new Error(`${path} is not forked, or ${keepOpId} is not one of its versions`);
  }
  const { after } = keep;
  const top = Math.max(...heads.map((head) => head.after.rev));
  const onDisk = await readTolerant(store, normalised);
  // A rev above the versions is a save whose journal has not arrived: choosing now would hide it.
  if (hasRev(onDisk) && onDisk.rev > top) {
    throw new Error(
      `${path}: on disk there is a newer rev than the versions to choose from (another computer ` +
        'saved it, its journal has not arrived): wait for the synchronisation and try again',
    );
  }
  // The `before` is the version on disk when it is a head (an undo then brings it back); otherwise
  // (a file cut short, no file) the chosen one.
  const before = heads.find((head) => jsonEqual(head.after, onDisk))?.after ?? after;
  const operation = await commitOperation(
    store,
    {
      profileId,
      kind: 'fork.resolve',
      ...(keep.operation.apartmentId === undefined
        ? {}
        : { apartmentId: keep.operation.apartmentId }),
      summary: 'Scelta la versione da tenere di un dato modificato in due posti.',
      changes: [{ path: normalised, before, after }],
    },
    clock,
    newId,
    {
      rev: top + 1,
      supersedes: await headOperations(store, normalised, heads),
    },
  );
  await checkConsistency(store); // refreshes what loadAll knows of the forks
  return operation;
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
