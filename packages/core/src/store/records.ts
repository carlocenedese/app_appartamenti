/**
 * Writing record files. Every record has a `rev` that starts at 1 and grows with each change, and
 * a write only goes through when the file on disk still has the `rev` the caller started from:
 * someone who saves a record read before another person changed it is refused instead of
 * overwriting that change.
 */
import { DATA_DIR, assertSafeRelPath, assertSafeSegment } from './store';
import type { Store } from './store';

/** Thrown by `writeRecord` when the `rev` on disk is not the one the caller expected. */
export class StaleWriteError extends Error {
  /** Path of the record file. */
  readonly path: string;
  /** The `rev` the caller expected on disk: `null` meant "the file must not exist yet". */
  readonly expected: number | null;
  /** The `rev` found on disk: `null` when there is no file. */
  readonly actual: number | null;

  constructor(path: string, expected: number | null, actual: number | null) {
    const show = (rev: number | null, none: string): string =>
      rev === null ? none : `rev ${String(rev)}`;
    super(
      `Stale write to ${path}: expected ${show(expected, 'a new file')}, ` +
        `found ${show(actual, 'no file')}`,
    );
    this.name = 'StaleWriteError';
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The path of a record file: `_app/dati/<kind>/<id>.json`. `kind` and `id` must each be one safe
 * path segment (see `assertSafeRelPath`), so an id can never point outside its folder or name
 * something Windows refuses; otherwise a `RangeError` is thrown.
 */
export function recordPath(kind: string, id: string): string {
  assertSafeSegment(kind);
  assertSafeSegment(id);
  return `${DATA_DIR}/${kind}/${id}.json`;
}

/**
 * The `rev` stored in the file at `path`, or `null` when there is no such file. Throws when the
 * file exists but has no integer `rev` (and `MalformedJsonError` when it is not JSON). Shared with
 * the journal; not part of the public API.
 */
export async function currentRev(store: Store, path: string): Promise<number | null> {
  const raw = await store.readJson(path);
  if (raw === undefined) return null;
  const rev = typeof raw === 'object' && raw !== null ? (raw as { rev?: unknown }).rev : undefined;
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev)) {
    throw new Error(`${path} exists but has no integer "rev": refusing to overwrite it`);
  }
  return rev;
}

/**
 * Writes `record` to `path` if the file still has `opts.expectedRev`, and returns the new `rev`.
 *
 * - `expectedRev: null`: the file must not exist; the record is written with `rev` 1.
 * - `expectedRev: n`: the file must exist with `rev` `n`; the record is written with `rev` `n + 1`.
 *
 * Otherwise nothing is written and a `StaleWriteError` is thrown. The `rev` inside `record` is
 * ignored: the file gets `{ ...record, rev: newRev }`. Other failures leave the file as it was:
 * a file that is not valid JSON (`MalformedJsonError`), or one without an integer `rev`, is never
 * overwritten, and neither is anything at an unsafe path (`RangeError`, see `assertSafeRelPath`).
 *
 * The check and the write are two steps, not one: a folder shared through Dropbox has no lock, so
 * two people saving at the same instant can still both pass. Dropbox then keeps both files as a
 * conflict copy, which `loadAll` reports. The check catches the usual case, saving from a stale
 * copy.
 *
 * Callers that read a record, change it and write it back must start from the raw JSON they read
 * and carry its unknown fields over: the schemas drop keys they do not know when parsing, and a
 * newer app may have added some. `writeRecord` writes exactly the object it is given.
 */
export async function writeRecord<T extends { rev: number }>(
  store: Store,
  path: string,
  record: T,
  opts: { expectedRev: number | null },
): Promise<number> {
  assertSafeRelPath(path);
  const { expectedRev } = opts;
  if (expectedRev !== null && (expectedRev < 1 || !Number.isSafeInteger(expectedRev + 1))) {
    throw new RangeError(
      `expectedRev must be null or a positive integer, got ${String(expectedRev)}`,
    );
  }

  const actual = await currentRev(store, path);
  if (actual !== expectedRev) throw new StaleWriteError(path, expectedRev, actual);

  const newRev = (expectedRev ?? 0) + 1;
  await store.writeJsonAtomic(path, { ...record, rev: newRev });
  return newRev;
}
