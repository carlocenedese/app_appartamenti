/**
 * Version compatibility between the app and a shared workspace folder. Two numbers are at play:
 * `schemaVersion` describes the layout of the whole folder, `minAppVersion` is the oldest app
 * allowed to write to it. The record `v` (the shape of a single record) is separate and is
 * handled by the store.
 */
import type { Workspace } from './model';

/** Version of the engine; a settlement records it so that a snapshot can be reproduced. */
export const CORE_VERSION = '0.1.0';

/** Layout version of the workspace folder this core writes (`Workspace.schemaVersion`). */
export const CORE_SCHEMA_VERSION = 1;

/**
 * A plain `MAJOR.MINOR.PATCH` version: three numbers without leading zeros, digits `0-9` only
 * (the pattern also goes into the JSON Schema, where `\d` would match other scripts in Python).
 * Pre-release tags (`1.2.3-beta.1`) and build metadata (`1.2.3+5`) are rejected on purpose: the
 * app and the workspace both carry released versions only, and guessing how a pre-release ranks
 * against a release is how a read-only guard goes wrong.
 */
export const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function parseSemver(version: string): [major: number, minor: number, patch: number] {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) {
    throw new RangeError(`Not a MAJOR.MINOR.PATCH version: ${JSON.stringify(version)}`);
  }
  const [, major, minor, patch] = match;
  const parts: [number, number, number] = [Number(major), Number(minor), Number(patch)];
  if (!parts.every((part) => Number.isSafeInteger(part))) {
    throw new RangeError(`Version number out of range: ${version}`);
  }
  return parts;
}

/**
 * Compares two `MAJOR.MINOR.PATCH` versions numerically, so `1.10.0` is after `1.9.0`.
 * Returns `-1` when `a` is older, `1` when it is newer and `0` when they are equal.
 * Throws a `RangeError` for anything that is not exactly three plain numbers (see
 * `SEMVER_PATTERN`).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** What this app may do with a workspace folder. */
export type Compat = 'ok' | 'readonly' | 'upgrade-needed';

/**
 * Whether this app can work on the workspace.
 *
 * - `'readonly'`: the folder was written by a newer app. Its schema is newer than the app's
 *   (`ws.schemaVersion > app.schemaVersion`) or it asks for a newer app than this one
 *   (`ws.minAppVersion > app.version`). Checked first: writing could damage data this app does not
 *   understand, and an upgrade is not offered to an app that is too old.
 * - `'upgrade-needed'`: the schema is older than the app's, so the folder must be migrated.
 * - `'ok'`: same schema, and the app is at least `minAppVersion`.
 *
 * Only the two compatibility fields of the workspace are read. Throws a `RangeError` if
 * `minAppVersion` or `app.version` is not a `MAJOR.MINOR.PATCH` version.
 */
export function checkCompat(
  ws: Pick<Workspace, 'schemaVersion' | 'minAppVersion'>,
  app: { version: string; schemaVersion: number },
): Compat {
  if (ws.schemaVersion > app.schemaVersion || compareSemver(ws.minAppVersion, app.version) > 0) {
    return 'readonly';
  }
  if (ws.schemaVersion < app.schemaVersion) return 'upgrade-needed';
  return 'ok';
}
