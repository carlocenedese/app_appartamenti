/**
 * Reading the folder tolerantly. The folder is shared through Dropbox, which can leave a file cut
 * short, make a conflict copy when two people save at once, or deliver a record written by a newer
 * app. None of that may stop the app from reading what is fine, and none of it may be dropped
 * without a trace: every file that is not loaded as a record shows up as a `Problem`.
 */
import type { ZodType } from 'zod';
import { WorkspaceSchema } from '../model';
import type { Workspace } from '../model';
import {
  DATA_DIR,
  MalformedJsonError,
  WORKSPACE_PATH,
  assertSafeRelPath,
  assertSafeSegment,
  isFileAccessError,
} from './store';
import type { Problem, Store } from './store';

/**
 * How one sync service names the copy it makes when two people save the same file at once. A name
 * is a conflict copy when any rule in use says so; another service is supported by adding a rule.
 */
export type ConflictNameRule = { service: string; isConflictName(name: string): boolean };

/**
 * Dropbox: "conflicted copy" in English, "Copia in conflitto di <name>" in Italian, any case, and
 * the "Case Conflict" and "Selective Sync Conflict" copies. To be checked on a real Italian
 * Dropbox (spec section 36).
 */
export const DROPBOX_CONFLICT_RULE: ConflictNameRule = {
  service: 'dropbox',
  isConflictName: (name) => DROPBOX_MARKER.test(name),
};
const DROPBOX_MARKER = /conflicted copy|copia in conflitto|case conflict|selective sync conflict/i;
// The parenthesised group with the marker, with the space before it and the " (1)" Dropbox adds
// when the same conflict repeats; several groups when a conflict copy was itself in conflict.
const CONFLICT_GROUP =
  / ?\([^()]*(?:conflicted copy|copia in conflitto|case conflict|selective sync conflict)[^()]*\)(?: \([0-9]+\))?/gi;

/**
 * iCloud Drive: a second copy of `x.json` is named `x 2.json` (a space and a number before the
 * extension). No id and no journal file the app writes has a space, so the rule cannot hit them.
 */
export const ICLOUD_CONFLICT_RULE: ConflictNameRule = {
  service: 'icloud',
  isConflictName: (name) => ICLOUD_SUFFIX.test(name.replace(/\.json$/i, '')),
};
const ICLOUD_SUFFIX = / [0-9]+$/;

/** The rules used when the caller gives none: Dropbox and iCloud. */
export const DEFAULT_CONFLICT_RULES: readonly ConflictNameRule[] = [
  DROPBOX_CONFLICT_RULE,
  ICLOUD_CONFLICT_RULE,
];

const JSON_EXTENSION = '.json';
const TEMP_PREFIX = '.tmp-';

type LoadOptions = {
  /** Include records marked `deleted: true`, which are left out by default. */
  includeDeleted?: boolean;
  /**
   * Return the files that hold no usable record as problems instead of throwing
   * `UnreadableRecordsError`: for the checks of the folder (`assessWorkspace`), never for a
   * calculation or a write, which would otherwise go on without that record.
   */
  tolerant?: boolean;
};

/**
 * The problems that mean a record of the kind is there but not loaded: its file is cut short,
 * cannot be read now, has another shape or a newer `v`, is not named after its id, or shares its
 * id with other files of which none is named after it.
 */
const MISSING_RECORD: ReadonlySet<Problem['reason']> = new Set([
  'malformed-json',
  'schema-mismatch',
  'future-version',
  'unreadable',
  'id-mismatch',
]);

/**
 * Thrown by `loadAll` (unless `tolerant`) when some files of the kind hold a record it cannot
 * use: a calculation or an Excel made without them would be wrong without saying so. `records`
 * gives, for each, the id (the file name without `.json`), the relative path and the reason; ids
 * only, no personal data. The message is in Italian, for the screen.
 */
export class UnreadableRecordsError extends Error {
  readonly kind: string;
  readonly records: { id: string; path: string; reason: Problem['reason'] }[];

  constructor(kind: string, records: UnreadableRecordsError['records']) {
    super(
      `Alcuni dati (${kind}: ${records.map(({ id }) => id).join(', ')}) non si possono leggere: ` +
        "il calcolo non si fa senza di loro. Aspetta che Dropbox finisca, aggiorna l'app se sono " +
        'di una versione più nuova, o ripara i file.',
    );
    this.name = 'UnreadableRecordsError';
    this.kind = kind;
    this.records = records;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Orders by UTF-16 code unit: the same on every machine, unlike a locale-aware comparison.
 * Shared with the journal; not part of the public API.
 */
export function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Whether `path` passes `assertSafeRelPath`. Shared with the journal; not part of the public API. */
export function isSafePath(path: string): boolean {
  try {
    assertSafeRelPath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The problem for a conflict copy at `dir/name` (shared with the journal; not public API). `originalPath` is the file the copy was made from
 * (the same name without the conflict group), left out when the name has no such group or nothing
 * would remain of it.
 */
export function conflictProblem(dir: string, name: string): Problem {
  const problem: Problem = { path: `${dir}/${name}`, reason: 'conflicted-copy' };
  const stem = name.slice(0, -JSON_EXTENSION.length);
  const dropbox = stem.replace(CONFLICT_GROUP, '');
  const originalStem = dropbox === stem ? stem.replace(ICLOUD_SUFFIX, '') : dropbox;
  if (originalStem !== stem && originalStem !== '') {
    problem.originalPath = `${dir}/${originalStem}${JSON_EXTENSION}`;
  }
  return problem;
}

/**
 * Whether parsing `raw` into `parsed` dropped a key, at any depth: a key of an object in `raw`
 * that the object at the same place in `parsed` does not have. That is a field written by a newer
 * app (the schemas drop keys they do not know). Keys that `parsed` adds (defaults) do not count.
 * Shared with the journal; not part of the public API.
 */
export function dropsKeys(raw: unknown, parsed: unknown): boolean {
  if (Array.isArray(raw)) {
    return Array.isArray(parsed) && raw.some((item, index) => dropsKeys(item, parsed[index]));
  }
  if (!isObject(raw) || !isObject(parsed)) return false;
  return Object.entries(raw).some(
    ([key, value]) => !Object.hasOwn(parsed, key) || dropsKeys(value, parsed[key]),
  );
}

/**
 * Reads every record of one kind from `_app/dati/<kind>/` and returns the records and the
 * problems, without throwing for a file that is not right. Only `*.json` files are looked at
 * (temporary `.tmp-*` files and anything else are ignored). Each file is sorted into exactly one
 * of these, in this order:
 *
 * 1. a name that one of `conflictRules` (default: Dropbox and iCloud) calls a conflict copy. Reported
 *    as `conflicted-copy`, with `originalPath` when a Dropbox group or an iCloud number can be cut from the name, and
 *    never loaded as a record, even if its content is valid: which of the two files is right is
 *    for the user to decide;
 * 2. a name that is not a safe store path (a stray file that this app did not write and that
 *    Windows could not hold): reported as `schema-mismatch` without being read;
 * 3. not valid JSON (`MalformedJsonError` from the store): `malformed-json`;
 * 4. a raw `v` that is a number above 1: `future-version`. This looks at the raw JSON before the
 *    schema does, because a newer app may also have changed the shape;
 * 5. not accepted by `schema`: `schema-mismatch`;
 * 6. a record whose file is not named after its id (`<id>.json`, compared in NFC): `id-mismatch`,
 *    unless another file holds the same id, see 7. A record is always written to the file named
 *    after its id, so another name is a copy or a rename made by hand (`bill - Copia.json`);
 * 7. a record whose id is also in another file (`deleted` ones count too, so a copy cannot bring
 *    a deleted record back): if exactly one of those files is named after the id, that one is
 *    kept and the others are reported as `duplicate-id`; otherwise all of them are reported as
 *    `duplicate-id` and none is loaded, since which one is right is for the user to decide;
 * 8. otherwise a record. One with `deleted: true` is left out unless `includeDeleted` is set. A
 *    record with keys the schema does not know (at any depth: a field a newer app added) is
 *    loaded and also reported as `unknown-fields`: it can be read, but writing it back would lose
 *    those keys, so `commitChange` refuses to.
 *
 * Records come back sorted by `id`, problems by path, both by code unit, so the result does not depend on the order the store lists files in. Records are what
 * `schema` returns, so keys it does not know are dropped (see the notes in `model.ts`).
 *
 * A file that holds a record of the kind that cannot be used (cut short, unreadable now, another
 * shape, a newer `v`, not named after its id, or an id in several files none named after it) makes
 * `loadAll` throw `UnreadableRecordsError`, unless `opts.tolerant` is set: every calculation, Excel
 * and write reads through `loadAll`, and none of them may go on as if the record did not exist
 * (revisione 2026-11-18, G6). Conflict copies and copies of a record that is loaded do not throw:
 * the record is there, and `checkConsistency` blocks the writes until the copy is set aside.
 *
 * A file that exists but cannot be read now (`FileAccessError`, or an error with one of the codes
 * `FILE_ACCESS_CODES`: permissions, held open on Windows, I/O) is reported as `unreadable`, so
 * one such file does not stop the folder from opening. Other failures of the store are not
 * swallowed: if the folder cannot be listed, the error goes up. A file that
 * disappears between the listing and the read is skipped, because it no longer exists.
 */
export async function loadAll<T extends { id: string }>(
  store: Store,
  kind: string,
  schema: ZodType<T>,
  opts: LoadOptions = {},
  conflictRules: readonly ConflictNameRule[] = DEFAULT_CONFLICT_RULES,
): Promise<{ records: T[]; problems: Problem[] }> {
  assertSafeSegment(kind);
  const naming = { stemOf: (record: T) => record.id, strict: true };
  const loaded = await loadDir(store, `${DATA_DIR}/${kind}`, schema, naming, opts, conflictRules);
  const missing = loaded.problems.filter(
    (problem) => MISSING_RECORD.has(problem.reason) || loaded.orphanDuplicates.has(problem.path),
  );
  if (opts.tolerant !== true && missing.length > 0) {
    throw new UnreadableRecordsError(
      kind,
      missing.map(({ path, reason }) => ({
        id: path.slice(path.lastIndexOf('/') + 1, -JSON_EXTENSION.length),
        path,
        reason,
      })),
    );
  }
  return { records: loaded.records, problems: loaded.problems };
}

/**
 * How `loadDir` checks file names against records. `stemOf` is the name (without `.json`) the
 * app gives the file of a record. With `strict`, a record in a file with another name is not
 * loaded (`id-mismatch`); without it, the name only decides which of several files with the same
 * id is kept (the journal names a file `<at>-<profileId>-<id>`, and reads any name).
 */
export type Naming<T> = { stemOf: (record: T) => string; strict: boolean };

/**
 * What `loadAll` does, for any folder `dir` (a path relative to the workspace root): `loadAll`
 * has the rules and the order of the result, with `naming` for the file names (see `Naming`).
 * The journal reads `_app/journal` with it, so that a broken file is treated the same way there.
 * Not part of the public API.
 */
export async function loadDir<T extends { id: string }>(
  store: Store,
  dir: string,
  schema: ZodType<T>,
  naming: Naming<T>,
  opts: LoadOptions = {},
  conflictRules: readonly ConflictNameRule[] = DEFAULT_CONFLICT_RULES,
): Promise<{ records: T[]; problems: Problem[]; orphanDuplicates: Set<string> }> {
  const names = (await store.list(dir)).map((name) => name.normalize('NFC'));

  const loaded: { path: string; stem: string; record: T; deleted: boolean }[] = [];
  const problems: Problem[] = [];

  for (const name of names) {
    if (!name.endsWith(JSON_EXTENSION) || name.startsWith(TEMP_PREFIX)) continue;
    const path = `${dir}/${name}`;

    if (conflictRules.some((rule) => rule.isConflictName(name))) {
      problems.push(conflictProblem(dir, name));
      continue;
    }
    if (!isSafePath(path)) {
      problems.push({ path, reason: 'schema-mismatch' });
      continue;
    }

    let raw: unknown;
    try {
      raw = await store.readJson(path);
    } catch (error) {
      if (isFileAccessError(error)) {
        problems.push({ path, reason: 'unreadable' });
        continue;
      }
      if (!(error instanceof MalformedJsonError)) throw error;
      problems.push({ path, reason: 'malformed-json' });
      continue;
    }
    if (raw === undefined) continue;

    if (isObject(raw) && typeof raw.v === 'number' && raw.v > 1) {
      problems.push({ path, reason: 'future-version' });
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      problems.push({ path, reason: 'schema-mismatch' });
      continue;
    }
    // A newer app added a field this one does not know: readable, but never to be written over.
    if (dropsKeys(raw, parsed.data)) problems.push({ path, reason: 'unknown-fields' });
    const deleted = isObject(raw) && raw.deleted === true;
    loaded.push({
      path,
      stem: name.slice(0, -JSON_EXTENSION.length),
      record: parsed.data,
      deleted,
    });
  }

  const byId = new Map<string, typeof loaded>();
  for (const entry of loaded)
    byId.set(entry.record.id, [...(byId.get(entry.record.id) ?? []), entry]);
  const kept: typeof loaded = [];
  // Paths of an id in several files of which none is named after it: no record of it is loaded.
  const orphanDuplicates = new Set<string>();
  for (const entries of byId.values()) {
    const named = entries.filter(
      ({ stem, record }) => stem === naming.stemOf(record).normalize('NFC'),
    );
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) {
      if (naming.strict && named.length === 0)
        problems.push({ path: only.path, reason: 'id-mismatch' });
      else kept.push(only);
      continue;
    }
    const [winner] = named.length === 1 ? named : [];
    for (const entry of entries) {
      if (entry === winner) kept.push(entry);
      else problems.push({ path: entry.path, reason: 'duplicate-id' });
      if (winner === undefined) orphanDuplicates.add(entry.path);
    }
  }

  const records = kept.filter(({ deleted }) => opts.includeDeleted === true || !deleted);
  records.sort((a, b) => compareText(a.record.id, b.record.id));
  problems.sort((a, b) => compareText(a.path, b.path));
  return { records: records.map(({ record }) => record), problems, orphanDuplicates };
}

/**
 * Reads the workspace file `_app/workspace.json`. Gives `undefined` when the file does not exist
 * (the folder is not a workspace yet). A file that exists but is not a valid workspace is an
 * error, not `undefined`: the app would otherwise offer to create a new workspace over it, so a
 * `MalformedJsonError` for text that is not JSON and an `Error` naming the fields at fault (with
 * the schema error as its `cause`) for JSON that is not a workspace both go up to the caller.
 */
export async function findWorkspace(store: Store): Promise<Workspace | undefined> {
  const raw = await store.readJson(WORKSPACE_PATH);
  if (raw === undefined) return undefined;
  const parsed = WorkspaceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${WORKSPACE_PATH} is not a valid workspace file (${issues})`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
