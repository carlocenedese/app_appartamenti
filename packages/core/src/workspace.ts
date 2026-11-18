/**
 * First start of a workspace folder: the user, the bundled supplier profiles and, last,
 * `_app/workspace.json`. Names are personal data, so no error message or operation summary has them.
 */
import { JOURNAL_DIR, readJournal } from './journal';
import { WorkspaceSchema, recordSchemas } from './model';
import type { User, Workspace } from './model';
import { parseOrThrow } from './parse';
import { findWorkspace } from './store/load';
import { seedProfiles } from './seed-profiles';
import { DATA_DIR, WORKSPACE_PATH } from './store/store';
import type { Store } from './store/store';
import { createUser } from './users';
import { CORE_VERSION, DATA_FORMAT } from './version';

/**
 * Creates the user, seeds the profiles, then writes `workspace.json` LAST, so the folder counts as
 * a workspace only when everything else is there. Throws `RangeError`, before any write, if
 * `workspace.json` already exists (valid or not) or the folder holds journal files or records that
 * are not an interrupted creation of this same group (a group that has not fully synchronised yet).
 *
 * Resumable: after an interruption, call it again with the same `workspaceId` and `user.id`. The
 * user is returned as is, profiles already on disk are skipped and `workspace.json` is written.
 * The retry must pass a fresh `newId`: operation ids must not repeat. `seeded` counts the profiles
 * written by this call only.
 */
export async function createWorkspace(
  store: Store,
  input: { workspaceId: string; name: string; user: { id: string; name: string } },
  seeds: unknown[],
  clock: () => string,
  newId: () => string,
): Promise<{ workspace: Workspace; user: User; seeded: number }> {
  if ((await store.list('_app')).includes('workspace.json')) {
    throw new RangeError('La cartella contiene già un workspace');
  }
  if (!(await isEmptyOrOurs(store, input.user.id))) {
    throw new RangeError('La cartella contiene già dei dati di un gruppo');
  }
  // Validated up front, so a bad name fails before anything is written.
  const workspace = parseOrThrow(
    WorkspaceSchema,
    {
      workspaceId: input.workspaceId,
      name: input.name,
      schemaVersion: DATA_FORMAT,
      minAppVersion: CORE_VERSION,
      createdAt: clock(),
    },
    'workspace',
  );
  const user = await createUser(store, input.user, input.user.id, clock, newId);
  const { written } = await seedProfiles(store, seeds, input.user.id, clock, newId);
  await store.writeJsonAtomic(WORKSPACE_PATH, workspace);
  return { workspace, user, seeded: written.length };
}

/**
 * Raises the data format of the folder (`schemaVersion` in `workspace.json`) to `DATA_FORMAT`
 * when it is lower, so that an older app opens it read-only from then on (`checkCompat`). It is
 * what `checkCompat` calls `upgrade-needed`: the app calls it, with the person's consent, before
 * writing. Only additive schema changes raise `DATA_FORMAT` without a migration (see
 * `version.ts`), so the records stay as they are and nothing else is rewritten. The other keys of
 * `workspace.json` are kept as they are on disk. Throws when the folder has no valid workspace.
 */
export async function raiseDataFormat(store: Store): Promise<'raised' | 'unchanged'> {
  const workspace = await findWorkspace(store);
  if (workspace === undefined) throw new RangeError('La cartella non contiene un workspace');
  if (workspace.schemaVersion >= DATA_FORMAT) return 'unchanged';
  const raw = (await store.readJson(WORKSPACE_PATH)) as Record<string, unknown>;
  await store.writeJsonAtomic(WORKSPACE_PATH, { ...raw, schemaVersion: DATA_FORMAT });
  return 'raised';
}

/**
 * True when `_app/journal` and `_app/dati` are empty, or hold only what an interrupted run of this
 * creation writes: operations of `userId` (the user and the profiles are both written as it) and
 * no other user. A file that cannot be read counts as someone else's.
 */
async function isEmptyOrOurs(store: Store, userId: string): Promise<boolean> {
  const files = [JOURNAL_DIR, ...Object.keys(recordSchemas).map((k) => `${DATA_DIR}/${k}`)];
  if ((await Promise.all(files.map((d) => store.list(d)))).every((names) => names.length === 0)) {
    return true;
  }
  const { operations, problems } = await readJournal(store);
  if (problems.length > 0 || operations.length === 0) return false;
  if (!operations.every((o) => o.profileId === userId)) return false;
  return (await store.list(`${DATA_DIR}/user`)).every((n) => n === `${userId}.json`);
}
