/**
 * Store writes for the user profile: create (resumable) and list. The name is personal data, so
 * neither the operation summary nor any error message carries it.
 */
import { commitChange } from './journal';
import { UserSchema } from './model';
import type { User } from './model';
import { parseOrThrow } from './parse';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

/**
 * Writes the user `input.id` in one `users.create`. The caller supplies the id, so a retry after
 * an interruption finds the record already there (live or deleted) and gets it back untouched.
 * An unsafe id throws `RangeError` and a blank name fails `UserSchema`, both before any write.
 */
export async function createUser(
  store: Store,
  input: { id: string; name: string },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<User> {
  const path = recordPath('user', input.id); // RangeError for an unsafe id
  const existing = await store.readJson(path);
  if (existing !== undefined) return parseOrThrow(UserSchema, existing, 'user');
  const user = parseOrThrow(UserSchema, { id: input.id, v: 1, rev: 1, name: input.name }, 'user');
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'users.create',
      summary: 'Utente creato',
      changes: [{ path, before: undefined, after: user }],
    },
    clock,
    newId,
  );
  return parseOrThrow(UserSchema, operation.changes[0]?.after, 'user');
}

/** The users that are not deleted; broken files are left out, as with `loadAll`. */
export async function liveUsers(store: Store): Promise<User[]> {
  return (await loadAll(store, 'user', UserSchema)).records;
}
