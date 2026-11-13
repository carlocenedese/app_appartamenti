import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  MalformedJsonError,
  PRESENCE_DIR,
  UserSchema,
  loadAll,
  othersActive,
  readPresence,
  writePresence,
} from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const now = '2026-11-13T10:00:00.000Z';
const entry = (userId: string, at: string) => ({ userId, at });

describe('othersActive', () => {
  it('counts a signal inside the window and not one outside it', () => {
    const entries = [
      entry('a', '2026-11-13T09:58:00.000Z'),
      entry('b', '2026-11-13T09:55:00.000Z'),
    ];
    expect(othersActive(now, entries, 'me', 3)).toEqual(['a']);
  });
  it('never includes me and sorts and deduplicates', () => {
    const entries = [
      entry('z', '2026-11-13T09:59:00Z'),
      entry('me', '2026-11-13T09:59:00Z'),
      entry('a', '2026-11-13T09:59:30.5Z'),
      entry('z', '2026-11-13T09:58:00Z'),
    ];
    expect(othersActive(now, entries, 'me', 3)).toEqual(['a', 'z']);
  });
  it('gives no notice for a three-day-old file', () => {
    expect(othersActive(now, [entry('a', '2026-11-10T10:00:00.000Z')], 'me', 3)).toEqual([]);
  });
  it('ignores a time in the future beyond the tolerance but not within it', () => {
    expect(othersActive(now, [entry('a', '2026-11-13T10:00:30.000Z')], 'me', 3)).toEqual(['a']);
    expect(othersActive(now, [entry('a', '2026-11-13T10:02:00.000Z')], 'me', 3)).toEqual([]);
    expect(othersActive(now, [entry('a', '2026-11-13T10:02:00.000Z')], 'me', 3, 5)).toEqual(['a']);
  });
  it('works across midnight and month ends', () => {
    expect(
      othersActive('2026-12-01T00:01:00Z', [entry('a', '2026-11-30T23:59:00Z')], 'me', 3),
    ).toEqual(['a']);
  });
  it('rejects a window that is not a positive finite number', () => {
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => othersActive(now, [], 'me', w)).toThrow(RangeError);
    }
  });
});

describe('writePresence and readPresence', () => {
  it('writes only userId and at, and reads them back', async () => {
    const store = new MemoryStore();
    await writePresence(store, 'u1', now);
    expect(await store.readJson(`${PRESENCE_DIR}/u1.json`)).toEqual({ userId: 'u1', at: now });
    expect(await store.list('_app/journal')).toEqual([]);
    expect(await readPresence(store)).toEqual([{ userId: 'u1', at: now }]);
  });
  it('returns [] when the folder does not exist', async () => {
    expect(await readPresence(new MemoryStore())).toEqual([]);
  });
  it('ignores invalid JSON, wrong shapes and files not named after the user', async () => {
    const store = new MemoryStore();
    await writePresence(store, 'ok', now);
    await store.writeJsonAtomic(`${PRESENCE_DIR}/bad-shape.json`, {
      userId: 'bad-shape',
      at: 'yesterday',
    });
    await store.writeJsonAtomic(`${PRESENCE_DIR}/empty.json`, { userId: '', at: now });
    await store.writeJsonAtomic(`${PRESENCE_DIR}/other.json`, { userId: 'someone', at: now });
    await store.writeJsonAtomic(`${PRESENCE_DIR}/null.json`, null);
    await store.writeJsonAtomic(`${PRESENCE_DIR}/notes.txt`, { userId: 'notes', at: now });
    expect(await readPresence(store)).toEqual([{ userId: 'ok', at: now }]);
  });
  it('ignores a file that is not valid JSON', async () => {
    const store = new MemoryStore();
    await writePresence(store, 'ok', now);
    const real = store.readJson.bind(store);
    store.readJson = async (p: string) => {
      if (p.endsWith('broken.json')) throw new MalformedJsonError(p);
      return real(p);
    };
    await store.writeJsonAtomic(`${PRESENCE_DIR}/broken.json`, {});
    expect(await readPresence(store)).toEqual([{ userId: 'ok', at: now }]);
  });
  it('throws before writing for an unsafe userId', async () => {
    const store = new MemoryStore();
    for (const id of ['', '../x', 'a/b', '.', '..']) {
      await expect(writePresence(store, id, now)).rejects.toThrow(RangeError);
    }
    expect(await store.list(PRESENCE_DIR)).toEqual([]);
  });
  it('is not seen by loadAll', async () => {
    const store = new MemoryStore();
    await writePresence(store, 'u1', now);
    expect(await loadAll(store, 'bill', BillSchema)).toEqual({ records: [], problems: [] });
    expect(await loadAll(store, 'user', UserSchema)).toEqual({ records: [], problems: [] });
  });
});
