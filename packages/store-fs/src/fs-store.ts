/**
 * `FsStore`: the `Store` of the core on a real folder, with `node:fs`. Used by tests and tools; the
 * core itself never touches `node:fs`, and the desktop app will have a Tauri-based store (plan 4).
 */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MalformedJsonError, assertSafeRelPath } from '@bollette/core';
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
 * - Writes go to a `.tmp-<uuid>` file in the same folder, are flushed to disk, and then replace
 *   the target with a rename, so a reader never sees a partly written `.json` file and a process
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
      throw error;
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

    const { file } = await this.locate(path);
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
      await rename(temp, file);
    } catch (error) {
      // A failed write leaves the target as it was and no temporary file behind.
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
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
    const { file } = await this.locate(path);
    const bytes = await readFile(file);
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
