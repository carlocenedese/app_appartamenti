/**
 * The storage seam of the engine. The core only knows this interface; the files themselves are
 * handled elsewhere: `FsStore` in `packages/store-fs` for tests and tools, a Tauri-based store in
 * the desktop app (plan 4). That keeps the core free of `node:fs`, which does not exist in the
 * Tauri webview or on the phone.
 *
 * Data lives as one JSON file per record in a folder shared through Dropbox, so reading has to
 * cope with what Dropbox can leave behind: files cut short, conflict copies, records written by a
 * newer app. `loadAll` reports those as `Problem`s instead of failing (see `./load`).
 *
 * Paths are always POSIX-style relative paths (`/` separators) below the workspace root, e.g.
 * `_app/dati/bill/<id>.json`. A store NFC-normalises every incoming path (macOS writes accented
 * names in NFD, Windows in NFC) and returns NFC names, and rejects a path that
 * `assertSafeRelPath` rejects.
 */

/** Folder with one sub-folder per record kind, relative to the workspace root. */
export const DATA_DIR = '_app/dati';

/** The workspace file, relative to the workspace root. */
export const WORKSPACE_PATH = '_app/workspace.json';

export interface Store {
  /**
   * The parsed JSON at `path`, or `undefined` when there is no such file. Throws a
   * `MalformedJsonError` when the file exists but does not hold valid JSON (so that `loadAll` can
   * tell a broken file from a missing one) and any other error as it is.
   */
  readJson(path: string): Promise<unknown | undefined>;

  /**
   * Writes `value` as JSON to `path`, creating the folders it needs. A reader never sees a
   * partly written file: the content goes to a temporary `.tmp-*` file first, which replaces the
   * target in one step.
   */
  writeJsonAtomic(path: string, value: unknown): Promise<void>;

  /**
   * The names of the files (not folders) directly inside `dir`: sorted, NFC-normalised, without
   * temporary `.tmp-*` files. `[]` when the folder does not exist.
   */
  list(dir: string): Promise<string[]>;

  /** The bytes of the file at `path` (documents such as PDFs). Rejects when it does not exist. */
  readBytes(path: string): Promise<Uint8Array>;
}

/** Why a file in the data folder was not loaded as a record, or why a record cannot be trusted. */
export type Problem = {
  /** Path of the file, relative to the workspace root, NFC, with `/` separators. */
  path: string;
  /**
   * - `malformed-json`: the file is not valid JSON (cut short by a sync, edited by hand).
   * - `schema-mismatch`: valid JSON, but not a record of the expected kind.
   * - `future-version`: a record with `v` above what this app understands (written by a newer app).
   * - `conflicted-copy`: a conflict copy made by Dropbox; it is reported, never loaded.
   * - `diverged`: the record differs from what the last operation in the journal says (a crash
   *   between journal and record); reported by the journal checks, not by `loadAll`.
   */
  reason: 'malformed-json' | 'schema-mismatch' | 'future-version' | 'conflicted-copy' | 'diverged';
  /** For `conflicted-copy`: the file the copy was made from, when its name can be worked out. */
  originalPath?: string;
};

/**
 * Thrown by `Store.readJson` for a file that exists but is not valid JSON. It is its own class so
 * that code that only knows the `Store` interface (`loadAll`) can tell it from other failures.
 */
export class MalformedJsonError extends Error {
  /** Path of the file that could not be parsed. */
  readonly path: string;

  constructor(path: string, options?: { cause?: unknown }) {
    super(`Malformed JSON in ${path}`, options);
    this.name = 'MalformedJsonError';
    this.path = path;
  }
}

// Names Windows reserves for devices, with or without an extension ("nul.json" is the device).
const RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)$/i;
const WINDOWS_FORBIDDEN = '<>:"|?*';

/**
 * Throws a `RangeError` unless `path` is a safe path relative to the workspace root. The check is
 * the same on every platform, because the folder is shared between macOS and Windows: a name that
 * only Windows refuses must not be written by the Mac either.
 *
 * Refused: an empty path; an absolute one (leading `/`, or a drive such as `C:`); backslashes;
 * empty, `.` and `..` segments; characters Windows forbids in names (`< > : " | ? *` and control
 * characters); a segment ending in a dot or a space (Windows drops it); and the device names
 * `CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9`, `CONIN$`, `CONOUT$`, with or without an extension.
 * Accents, spaces and parentheses are fine ("Perché.json", "x (conflicted copy 2026-11-05).json").
 *
 * It looks at the path as given: normalise to NFC first if that matters to the caller.
 */
export function assertSafeRelPath(path: string): void {
  const fail = (reason: string): never => {
    throw new RangeError(`Unsafe store path ${JSON.stringify(path)}: ${reason}`);
  };

  if (path === '') fail('it is empty');
  if (path.startsWith('/')) fail('it is absolute');
  if (path.includes('\\')) fail('it contains a backslash');

  for (const segment of path.split('/')) {
    if (segment === '') fail('it has an empty segment');
    if (segment === '.' || segment === '..') fail(`it has a ${JSON.stringify(segment)} segment`);
    for (const char of segment) {
      if (WINDOWS_FORBIDDEN.includes(char) || (char.codePointAt(0) ?? 0) < 0x20) {
        fail(`it has a character that Windows forbids in names (${JSON.stringify(char)})`);
      }
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      fail('a name ending in a dot or a space is changed by Windows');
    }
    const stem = (segment.split('.')[0] ?? '').trimEnd();
    if (RESERVED_NAME.test(stem)) fail(`${JSON.stringify(stem)} is a reserved name on Windows`);
  }
}

/**
 * Throws a `RangeError` unless `name` is one safe path segment: a record kind or id, which must
 * not reach into another folder.
 */
export function assertSafeSegment(name: string): void {
  assertSafeRelPath(name);
  if (name.includes('/')) {
    throw new RangeError(`Unsafe store name ${JSON.stringify(name)}: it contains a slash`);
  }
}
