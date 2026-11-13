import { describe, expect, it } from 'vitest';
import {
  UserSchema,
  commitChange,
  createUser,
  liveUsers,
  readJournal,
  recordPath,
  undoOperation,
} from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const clock = () => '2026-11-13T09:00:00.000Z';
function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${String(++n)}`;
}
const journalFiles = async (store: MemoryStore) => store.list('_app/journal');

describe('UserSchema', () => {
  const base = { id: 'u1', v: 1, rev: 1 };
  it('accepts a name and rejects an empty or blank one', () => {
    expect(UserSchema.safeParse({ ...base, name: 'Anna' }).success).toBe(true);
    expect(UserSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(UserSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
  });
});

describe('createUser', () => {
  it('writes one operation and one file, without the name in the summary', async () => {
    const store = new MemoryStore();
    const user = await createUser(store, { id: 'u1', name: 'Anna Rossi' }, 'u1', clock, ids());
    expect(user).toMatchObject({ id: 'u1', name: 'Anna Rossi', v: 1, rev: 1 });
    expect(await store.readJson(recordPath('user', 'u1'))).toMatchObject({ name: 'Anna Rossi' });
    const { operations } = await readJournal(store);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'users.create', summary: 'Utente creato' });
    expect(operations[0]?.summary).not.toContain('Anna');
  });

  it('returns the existing record and writes nothing when the id exists', async () => {
    const store = new MemoryStore();
    const first = await createUser(store, { id: 'u1', name: 'Anna' }, 'u1', clock, ids());
    const filesBefore = await journalFiles(store);
    const again = await createUser(store, { id: 'u1', name: 'Altro' }, 'u1', clock, ids('x'));
    expect(again).toEqual(first);
    expect(await journalFiles(store)).toEqual(filesBefore);
  });

  it('returns a deleted record untouched too', async () => {
    const store = new MemoryStore();
    const user = await createUser(store, { id: 'u1', name: 'Anna' }, 'u1', clock, ids());
    await commitChange(
      store,
      {
        profileId: 'u1',
        kind: 'users.remove',
        summary: 'x',
        changes: [{ path: recordPath('user', 'u1'), before: user, after: undefined }],
      },
      clock,
      ids('r'),
    );
    const before = await journalFiles(store);
    expect(
      await createUser(store, { id: 'u1', name: 'Altro' }, 'u1', clock, ids('y')),
    ).toMatchObject({
      deleted: true,
    });
    expect(await journalFiles(store)).toEqual(before);
    expect(await liveUsers(store)).toEqual([]);
  });

  it('refuses an unsafe id or a blank name before writing, without naming the user', async () => {
    const store = new MemoryStore();
    for (const id of ['a/b', '..', '']) {
      await expect(
        createUser(store, { id, name: 'Anna' }, 'p', clock, ids()),
      ).rejects.toBeInstanceOf(RangeError);
    }
    const blank = createUser(store, { id: 'u1', name: '  ' }, 'p', clock, ids());
    await expect(blank).rejects.toThrow();
    await blank.catch((e: unknown) => expect(String(e)).not.toContain('Anna'));
    expect(await journalFiles(store)).toEqual([]);
    expect(await store.list('_app/dati/user')).toEqual([]);
  });

  it('can be undone', async () => {
    const store = new MemoryStore();
    await createUser(store, { id: 'u1', name: 'Anna' }, 'u1', clock, ids());
    const { operations } = await readJournal(store);
    await undoOperation(store, operations[0]?.id ?? '', 'u1', clock, ids('u'));
    expect(await liveUsers(store)).toEqual([]);
  });
});

describe('liveUsers', () => {
  it('lists the users that are not deleted', async () => {
    const store = new MemoryStore();
    await createUser(store, { id: 'u1', name: 'Anna' }, 'u1', clock, ids());
    await createUser(store, { id: 'u2', name: 'Bruno' }, 'u1', clock, ids('b'));
    expect((await liveUsers(store)).map((u) => u.id)).toEqual(['u1', 'u2']);
  });
});
