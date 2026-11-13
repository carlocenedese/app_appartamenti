/**
 * First start of a workspace folder: the user, the bundled supplier profiles and, last,
 * `_app/workspace.json`. Names are personal data, so no error message or operation summary has them.
 */
import { WorkspaceSchema } from './model';
import type { User, Workspace } from './model';
import { parseOrThrow } from './parse';
import { seedProfiles } from './seed-profiles';
import { WORKSPACE_PATH } from './store/store';
import type { Store } from './store/store';
import { createUser } from './users';
import { CORE_SCHEMA_VERSION, CORE_VERSION } from './version';

/**
 * Creates the user, seeds the profiles, then writes `workspace.json` LAST, so the folder counts as
 * a workspace only when everything else is there. Throws `RangeError` if `workspace.json` already
 * exists (valid or not), before any write.
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
  // Validated up front, so a bad name fails before anything is written.
  const workspace = parseOrThrow(
    WorkspaceSchema,
    {
      workspaceId: input.workspaceId,
      name: input.name,
      schemaVersion: CORE_SCHEMA_VERSION,
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
