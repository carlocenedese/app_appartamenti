/**
 * `TauriStore`: the `Store` of the core on the folder the user picked, through the official Tauri
 * file plugin. It does what `FsStore` (packages/store-fs) does with `node:fs`, which the webview
 * does not have. The file operations come in as an `FsBackend`, so tests use an in-memory one.
 *
 * Permissions (see docs/rules/disco-app.md): the app has no static file scope. The folder dialog
 * adds the picked folder, recursively, to the file plugin's scope at runtime, and the
 * persisted-scope plugin restores it after a restart.
 */
import { open } from '@tauri-apps/plugin-dialog';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import {
  FILE_ACCESS_CODES,
  FileAccessError,
  MalformedJsonError,
  assertSafeRelPath,
} from '@bollette/core';
import type { FileAccessCode, Store } from '@bollette/core';

/** The file operations `TauriStore` uses, on absolute paths. Nothing deletes: the app never does. */
export interface FsBackend {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  /** Replaces `to` when it exists (Rust's `std::fs::rename` does, on Windows too). */
  rename(from: string, to: string): Promise<void>;
  readDir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Creates the folder and its missing parents. */
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** The real backend: the Tauri file plugin. */
export const tauriFsBackend: FsBackend = {
  readText: (path) => readTextFile(path),
  writeText: (path, text) => writeTextFile(path, text),
  rename: (from, to) => rename(from, to),
  readDir: (path) => readDir(path),
  readBytes: (path) => readFile(path),
  mkdir: (path) => mkdir(path, { recursive: true }),
  exists: (path) => exists(path),
};

/**
 * Asks the user for a folder. `recursive: true` makes the dialog plugin add the whole folder, not
 * just its top level, to the file plugin's scope. `null` when the user cancels.
 */
export async function pickFolder(): Promise<string | null> {
  return open({ directory: true, recursive: true, multiple: false });
}

const TEMP_PREFIX = '.tmp-';

/** The waits before each new attempt of a rename that failed (Windows: a busy target). */
const RENAME_RETRY_MS = [20, 50, 100, 200, 400];

/**
 * The code of a failure of the file plugin. Its errors are strings with the OS error number:
 * 13 (Unix) and 5 (Windows) are a refused access, 32 and 33 a file held open by another program
 * on Windows (sharing or lock violation). shortcut: matched on the message text; to be checked on
 * a real Windows machine (revisione 2026-11-18).
 */
function accessCode(error: unknown): FileAccessCode {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (FILE_ACCESS_CODES as readonly string[]).includes(code)) {
    return code as FileAccessCode;
  }
  const text = String(error);
  if (/os error (?:32|33)\b/.test(text)) return 'EBUSY';
  if (/os error (?:5|13)\b/.test(text)) return 'EACCES';
  return 'unknown';
}
const BYTE_ORDER_MARK = '﻿';

/**
 * A `Store` on the folder `root` (an absolute path as the dialog gives it). Same rules as
 * `FsStore`: NFC paths checked with `assertSafeRelPath`, names found in either spelling (NFC or
 * NFD), writes to a `.tmp-<uuid>` file in the same folder renamed over the target.
 *
 * shortcut: the file plugin has no fsync, so a power cut right after the rename may leave an
 * empty or old file on some file systems; a Rust command with `sync_all` would close that.
 * A failed rename leaves its `.tmp-*` file (the app has no permission to delete); `list` hides it.
 */
export class TauriStore implements Store {
  private readonly root: string;
  private readonly sep: string;

  constructor(
    root: string,
    private readonly fs: FsBackend,
  ) {
    // A Windows path (drive or UNC) gets backslashes, like the dialog returns it.
    this.sep = /^(?:[A-Za-z]:\\|\\\\)/.test(root) ? '\\' : '/';
    this.root = root.length > 1 && root.endsWith(this.sep) ? root.slice(0, -1) : root;
  }

  async readJson(path: string): Promise<unknown | undefined> {
    const { rel, file } = await this.locate(path);
    if (!(await this.fs.exists(file))) return undefined;
    let text: string;
    try {
      text = await this.fs.readText(file);
    } catch (error) {
      // The file is there but cannot be read now (permissions, held open, offline Dropbox file).
      throw new FileAccessError(rel, accessCode(error), { cause: error });
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
    const dir = file.slice(0, file.lastIndexOf(this.sep));
    await this.fs.mkdir(dir);
    const temp = `${dir}${this.sep}${TEMP_PREFIX}${crypto.randomUUID()}`;
    await this.fs.writeText(temp, `${json}\n`);
    // Windows refuses a rename over a file that Dropbox, an antivirus or Excel holds open: try
    // again a few times over about a second before giving up (revisione 2026-11-18, G8).
    for (let attempt = 0; ; attempt++) {
      try {
        await this.fs.rename(temp, file);
        return;
      } catch (error) {
        const wait = RENAME_RETRY_MS[attempt];
        if (wait === undefined) throw new FileAccessError(rel, accessCode(error), { cause: error });
        await new Promise((done) => setTimeout(done, wait));
      }
    }
  }

  async list(dir: string): Promise<string[]> {
    const { file } = await this.locate(dir);
    if (!(await this.fs.exists(file))) return [];
    // `file` is below the root, so it has a parent; a file instead of a folder gives [].
    const cut = file.lastIndexOf(this.sep);
    const self = (await this.fs.readDir(file.slice(0, cut))).find(
      (entry) => entry.name === file.slice(cut + 1),
    );
    if (!self?.isDirectory) return [];
    const names = (await this.fs.readDir(file))
      .filter((entry) => entry.isFile)
      .map((entry) => entry.name.normalize('NFC'))
      .filter((name) => !name.startsWith(TEMP_PREFIX));
    return [...new Set(names)].sort();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const { file } = await this.locate(path);
    return this.fs.readBytes(file);
  }

  /** As `FsStore.locate`: existing names in whatever spelling, then the rest as requested. */
  private async locate(path: string): Promise<{ rel: string; file: string }> {
    const rel = path.normalize('NFC');
    assertSafeRelPath(rel);

    const segments = rel.split('/');
    let current = this.root;
    for (const [index, segment] of segments.entries()) {
      const exact = `${current}${this.sep}${segment}`;
      if (await this.fs.exists(exact)) {
        current = exact;
        continue;
      }
      const onDisk = await this.findByNfcName(current, segment);
      if (onDisk === undefined) {
        // Nothing of this segment exists, so nothing below it does either.
        return { rel, file: [current, ...segments.slice(index)].join(this.sep) };
      }
      current = `${current}${this.sep}${onDisk}`;
    }
    return { rel, file: current };
  }

  private async findByNfcName(dir: string, name: string): Promise<string | undefined> {
    // A folder that is missing or is a file has no entries to match. A path outside the scope
    // has already failed in `exists`, so the catch below only meets "not a folder".
    if (!(await this.fs.exists(dir))) return undefined;
    let entries;
    try {
      entries = await this.fs.readDir(dir);
    } catch {
      return undefined;
    }
    return entries
      .map((entry) => entry.name)
      .sort()
      .find((entry) => entry.normalize('NFC') === name);
  }
}
