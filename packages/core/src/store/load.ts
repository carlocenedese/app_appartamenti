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
} from './store';
import type { Problem, Store } from './store';

// The markers Dropbox puts in the name of a conflict copy: English "conflicted copy" and Italian
// "Copia in conflitto di <name>". To be checked on a real Italian Dropbox (spec section 36).
const CONFLICT_MARKER = /conflicted copy|copia in conflitto/i;
// The parenthesised group with the marker, with the space before it and the " (1)" Dropbox adds
// when the same conflict repeats; several groups when a conflict copy was itself in conflict.
const CONFLICT_GROUP = / ?\([^()]*(?:conflicted copy|copia in conflitto)[^()]*\)(?: \([0-9]+\))?/gi;

const JSON_EXTENSION = '.json';
const TEMP_PREFIX = '.tmp-';

type LoadOptions = {
  /** Include records marked `deleted: true`, which are left out by default. */
  includeDeleted?: boolean;
};

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
 * The problem for a conflict copy at `dir/name`. `originalPath` is the file the copy was made from
 * (the same name without the conflict group), left out when the name has no such group or nothing
 * would remain of it.
 */
function conflictProblem(dir: string, name: string): Problem {
  const problem: Problem = { path: `${dir}/${name}`, reason: 'conflicted-copy' };
  const stem = name.slice(0, -JSON_EXTENSION.length);
  const originalStem = stem.replace(CONFLICT_GROUP, '');
  if (originalStem !== stem && originalStem !== '') {
    problem.originalPath = `${dir}/${originalStem}${JSON_EXTENSION}`;
  }
  return problem;
}

/**
 * Reads every record of one kind from `_app/dati/<kind>/` and returns the records and the
 * problems, without throwing for a file that is not right. Only `*.json` files are looked at
 * (temporary `.tmp-*` files and anything else are ignored). Each file is sorted into exactly one
 * of these, in this order:
 *
 * 1. a name with `conflicted copy` or `copia in conflitto` in it (any case): a Dropbox conflict
 *    copy. Reported as `conflicted-copy` with `originalPath`, and never loaded as a record, even
 *    if its content is valid: which of the two files is right is for the user to decide;
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
 * 8. otherwise a record. One with `deleted: true` is left out unless `includeDeleted` is set.
 *
 * Records come back sorted by `id`, problems by path, both by code unit, so the result does not depend on the order the store lists files in. Records are what
 * `schema` returns, so keys it does not know are dropped (see the notes in `model.ts`).
 *
 * Failures of the store itself are not per-file problems and are not swallowed: if the folder
 * cannot be listed or a file cannot be read (permissions, I/O), the error goes up. A file that
 * disappears between the listing and the read is skipped, because it no longer exists.
 */
export async function loadAll<T extends { id: string }>(
  store: Store,
  kind: string,
  schema: ZodType<T>,
  opts: LoadOptions = {},
): Promise<{ records: T[]; problems: Problem[] }> {
  assertSafeSegment(kind);
  const naming = { stemOf: (record: T) => record.id, strict: true };
  return loadDir(store, `${DATA_DIR}/${kind}`, schema, naming, opts);
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
): Promise<{ records: T[]; problems: Problem[] }> {
  const names = (await store.list(dir)).map((name) => name.normalize('NFC'));

  const loaded: { path: string; stem: string; record: T; deleted: boolean }[] = [];
  const problems: Problem[] = [];

  for (const name of names) {
    if (!name.endsWith(JSON_EXTENSION) || name.startsWith(TEMP_PREFIX)) continue;
    const path = `${dir}/${name}`;

    if (CONFLICT_MARKER.test(name)) {
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
    }
  }

  const records = kept.filter(({ deleted }) => opts.includeDeleted === true || !deleted);
  records.sort((a, b) => compareText(a.record.id, b.record.id));
  problems.sort((a, b) => compareText(a.path, b.path));
  return { records: records.map(({ record }) => record), problems };
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
