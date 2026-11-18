import { MalformedJsonError, assertSafeRelPath } from '../../src/store/store';
import type { Store } from '../../src/store/store';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Temporary files of an interrupted write: the real stores keep them out of `list`. */
const TEMP_PREFIX = '.tmp-';

/**
 * An in-memory `Store` for tests, faithful to what `FsStore` promises:
 *
 * - paths are POSIX-style relative paths, NFC-normalised on the way in (so an NFD name finds the
 *   file written under its NFC name) and checked with `assertSafeRelPath`;
 * - `readJson` gives `undefined` for a missing file and throws `MalformedJsonError` for text that
 *   is not JSON, which is what lets `loadAll` report a broken file instead of failing;
 * - `list` gives the names of the files directly inside a folder: sorted, NFC, without temporary
 *   `.tmp-*` files, and `[]` for a folder that does not exist;
 * - `writeJsonAtomic` stores JSON with two-space indentation and a trailing newline.
 *
 * Test seams: `putRaw` and `putBytes` store content exactly as given (a truncated JSON, a
 * conflict copy, a temporary file) and `getRaw` reads the stored text back, to check that a
 * refused write left a file untouched.
 */
export class MemoryStore implements Store {
  private readonly files = new Map<string, Uint8Array>();

  /** Stores `text` as the content of `path`, whatever it is (valid JSON or not). */
  putRaw(path: string, text: string): void {
    this.putBytes(path, encoder.encode(text));
  }

  /** Stores `bytes` as the content of `path`. */
  putBytes(path: string, bytes: Uint8Array): void {
    this.files.set(key(path), bytes.slice());
  }

  /** Removes the file at `path`, as a file that never arrived. */
  delete(path: string): void {
    this.files.delete(key(path));
  }

  /** The text stored at `path`, or `undefined` when there is no such file. */
  getRaw(path: string): string | undefined {
    const bytes = this.files.get(key(path));
    return bytes === undefined ? undefined : decoder.decode(bytes);
  }

  async readJson(path: string): Promise<unknown> {
    const text = this.getRaw(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new MalformedJsonError(path.normalize('NFC'), { cause: error });
    }
  }

  async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) throw new TypeError('Value cannot be written as JSON');
    this.putRaw(path, `${text}\n`);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${key(dir)}/`;
    const names = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const name = path.slice(prefix.length);
      if (name.includes('/') || name.startsWith(TEMP_PREFIX)) continue;
      names.add(name);
    }
    return [...names].sort();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(key(path));
    if (bytes === undefined) throw new Error(`No such file: ${path.normalize('NFC')}`);
    return bytes.slice();
  }
}

function key(path: string): string {
  const normalised = path.normalize('NFC');
  assertSafeRelPath(normalised);
  return normalised;
}
