// Writing a generated file from the command line (plans 5 and 12): the output path, the folders of
// the default path and a write that never overwrites an existing file (section 6, R156, R176).
// Shared by `pnpm excel` and `pnpm moduli`.

import { lstatSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { assertSafeRelPath } from '../packages/core/src/index.ts';

/** Whether something is at `path`, a dangling link included (`existsSync` follows links). */
export function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A refusal (`rejected`, exit 1) or arguments not valid (`invalid`, exit 2). */
export class Stop extends Error {
  constructor(status, reason, extra = {}) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.extra = extra;
  }
}
export const invalid = (reason) => new Stop('invalid', reason);
export const rejected = (reason, extra) => new Stop('rejected', reason, extra);

/** Checks the output path (a name ending in `extension`); returns it with the name in NFC. */
export function outputPath(raw, extension) {
  const name = basename(raw).normalize('NFC');
  const folder = dirname(raw);
  try {
    if (raw.endsWith('/') || raw.endsWith(sep)) throw new Error('a folder');
    if (!name.toLowerCase().endsWith(extension) || name.length === extension.length) {
      throw new Error('not a name');
    }
    assertSafeRelPath(name);
    if (!statSync(folder).isDirectory()) throw new Error('not a folder');
  } catch {
    throw invalid('bad-output');
  }
  return { file: join(folder, name), folder };
}

/**
 * The folders of the default path under `root` must be real folders or missing: a link could send
 * the file outside the shared folder, a file in their place would make the write fail (R176).
 */
export function checkDefaultFolders(root, file) {
  let path = root;
  for (const part of relative(root, dirname(file)).split(sep)) {
    path = join(path, part);
    let stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw rejected('bad-default-folder');
  }
}

/** Errors of a folder (or disk) that has no hard links: refused, never a plain overwrite. */
const NO_LINK = ['EPERM', 'ENOTSUP', 'EXDEV', 'EOPNOTSUPP'];

/** Writes `bytes` to `file` only if it does not exist: a temporary file, then a hard link. */
export function writeNew(file, folder, bytes, { newId, link }) {
  const temporary = join(folder, `.tmp-${newId()}${file.slice(file.lastIndexOf('.'))}`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    link(temporary, file);
  } catch (error) {
    if (error?.code === 'EEXIST' && pathExists(file)) throw rejected('file-exists');
    if (NO_LINK.includes(error?.code)) throw rejected('link-unsupported');
    throw error;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing was written.
    }
  }
}
