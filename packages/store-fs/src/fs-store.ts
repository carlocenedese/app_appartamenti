/**
 * `FsStore`: the `Store` of the core on a real folder, with `node:fs`. Used by tests and tools; the
 * core itself never touches `node:fs`, and the desktop app will have a Tauri-based store (plan 4).
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  FileAccessError,
  MalformedJsonError,
  assertSafeRelPath,
  isFileAccessError,
} from '@bollette/core';
import type { FileAccessCode } from '@bollette/core';
import type { Store } from '@bollette/core';

/** Temporary files of a write in progress. They have no `.json` extension, so a reader of the data
 * folder never takes a half-written one for a record. */
const TEMP_PREFIX = '.tmp-';
const BYTE_ORDER_MARK = '\ufeff';

/** Whether `error` says that a file or a folder is not there (or a parent is not a folder). */
function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `error` as a `FileAccessError` on `rel` when it is one (see `isFileAccessError`), else as is. */
function asAccessError(error: unknown, rel: string): unknown {
  if (!isFileAccessError(error) || error instanceof FileAccessError) return error;
  return new FileAccessError(rel, (error as { code: FileAccessCode }).code, { cause: error });
}

/** The waits before each new attempt of a rename that a busy file refused (Windows). */
const RENAME_RETRY_MS = [20, 50, 100, 200, 400];

/**
 * `rename`, tried again a few times when Windows refuses it because another program holds the
 * target open (`EBUSY`, `EPERM`, `EACCES`: Dropbox, an antivirus, Excel), as is common there.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const wait = RENAME_RETRY_MS[attempt];
      const code = (error as { code?: unknown } | null)?.code;
      const busy = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      if (!busy || wait === undefined) throw error;
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * The entry of `dir` whose NFC-normalised name is `name`, if there is one (the first in sorted
 * order when several spellings exist side by side).
 */
async function findByNfcName(dir: string, name: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  return entries.sort().find((entry) => entry.normalize('NFC') === name);
}

/**
 * Flushes the folder entry of a rename to disk, so that a power cut does not bring back the old
 * file. Best effort: Windows cannot open a folder this way, and there NTFS journals the rename.
 */
async function syncDir(dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // not supported on this platform (EISDIR, EPERM on Windows)
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * A `Store` on a folder: every path is relative to `root`, with `/` separators.
 *
 * - Every incoming path is NFC-normalised and checked with `assertSafeRelPath` (a `RangeError`
 *   for a path that is absolute, climbs out with `..`, or holds what Windows forbids).
 * - A name is found whichever way the file system stored it. macOS and Windows write accented
 *   names differently (NFD and NFC); APFS treats both spellings as one file, but ext4 and NTFS do
 *   not. When a path does not exist as given, each missing segment is looked up among the
 *   NFC-normalised names of its folder, so a file saved by a Mac is found by a Windows machine
 *   and the other way round. Writing to a name that exists in the other spelling replaces that
 *   file instead of creating a twin. Names listed come back in NFC.
 * - A file that exists but cannot be used now (`EACCES`, `EPERM`, `EBUSY`, `EIO`) gives a
 *   `FileAccessError` with the relative path. A rename that a busy target refuses is tried again
 *   a few times over about a second first (Windows: Dropbox, an antivirus or Excel holding it).
 * - Writes go to a `.tmp-<uuid>` file in the same folder, are flushed to disk, and then replace
 *   the target with a rename (the folder is flushed too where the platform allows), so a reader never sees a partly written `.json` file and a process
 *   that stops half way leaves only a `.tmp-*` file, which `list` hides.
 */
export class FsStore implements Store {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async readJson(path: string): Promise<unknown | undefined> {
    const { rel, file } = await this.locate(path);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw asAccessError(error, rel);
    }
    try {
      return JSON.parse(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);
    } catch (error) {
      throw new MalformedJsonError(rel, { cause: error });
    }
  }

  async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    // Serialise first: a value that cannot be written must not create folders or files.
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) throw new TypeError('Value cannot be written as JSON');

    const { rel, file } = await this.locate(path);
    const dir = dirname(file);
    await mkdir(dir, { recursive: true });

    const temp = join(dir, `${TEMP_PREFIX}${randomUUID()}`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(temp, 'wx');
      await handle.writeFile(`${json}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await renameWithRetry(temp, file);
      await syncDir(dir);
    } catch (error) {
      // A failed write leaves the target as it was and no temporary file behind.
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw asAccessError(error, rel);
    }
  }

  async list(dir: string): Promise<string[]> {
    const { file } = await this.locate(dir);
    let entries;
    try {
      entries = await readdir(file, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.normalize('NFC'))
      .filter((name) => !name.startsWith(TEMP_PREFIX));
    return [...new Set(names)].sort();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const { rel, file } = await this.locate(path);
    const bytes = await readFile(file).catch((error: unknown) => {
      throw asAccessError(error, rel);
    });
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /**
   * The normalised relative path and the absolute path to use on disk for it: the names that
   * already exist (in whatever spelling), then the rest as requested, in NFC. The path need not
   * exist.
   */
  private async locate(path: string): Promise<{ rel: string; file: string }> {
    const rel = path.normalize('NFC');
    assertSafeRelPath(rel);

    const segments = rel.split('/');
    let current = this.root;
    for (const [index, segment] of segments.entries()) {
      const exact = join(current, segment);
      if (await exists(exact)) {
        current = exact;
        continue;
      }
      const onDisk = await findByNfcName(current, segment);
      if (onDisk === undefined) {
        // Nothing of this segment exists, so nothing below it does either.
        return { rel, file: join(current, ...segments.slice(index)) };
      }
      current = join(current, onDisk);
    }
    return { rel, file: current };
  }
}

/**
 * The path on disk of `rel` under `root`, each existing segment found in whatever Unicode spelling
 * (as `FsStore`); `undefined` when an existing segment is a symbolic link (never followed).
 */
async function locateNoLinks(root: string, rel: string): Promise<string | undefined> {
  let current = root;
  const segments = rel.split('/');
  for (const [index, segment] of segments.entries()) {
    const name = (await exists(join(current, segment)))
      ? segment
      : await findByNfcName(current, segment);
    if (name === undefined) return join(current, ...segments.slice(index));
    current = join(current, name);
    if ((await lstat(current)).isSymbolicLink()) return undefined;
  }
  return current;
}

/**
 * Moves the regular file `from` to `to`, both relative to `root` (NFC, checked with
 * `assertSafeRelPath`, names found in any Unicode spelling, no symbolic link on the way:
 * `unsafe-path`), creating the folders of `to`; never over an existing file (plan 17, R315):
 * `target-exists` leaves both where they are; `missing` when `from` is no regular file. A hard
 * link then the removal of the old name; where links are not allowed, an exclusive copy. If the
 * old name cannot be removed, or the copy fails, the new name is removed again and the error
 * goes up: the file is never in two places, nor half copied.
 */
export async function moveFileNoOverwrite(
  root: string,
  from: string,
  to: string,
): Promise<'moved' | 'target-exists' | 'missing' | 'unsafe-path'> {
  const [fromPath, toPath] = [from.normalize('NFC'), to.normalize('NFC')];
  assertSafeRelPath(fromPath);
  assertSafeRelPath(toPath);
  const source = await locateNoLinks(root, fromPath);
  const target = await locateNoLinks(root, toPath);
  if (source === undefined || target === undefined) return 'unsafe-path';
  if (!(await exists(source)) || !(await lstat(source)).isFile()) return 'missing';
  if (await exists(target)) return 'target-exists';
  await mkdir(dirname(target), { recursive: true });
  try {
    await link(source, target);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'EEXIST') return 'target-exists';
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV') throw error;
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
    } catch (copyError) {
      if ((copyError as { code?: unknown } | null)?.code === 'EEXIST') return 'target-exists';
      await rm(target, { force: true });
      throw copyError;
    }
  }
  try {
    await unlink(source);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
  return 'moved';
}
