import { describe, expect, it } from 'vitest';
import { commitChange, readJournal, recordPath, undoOperation, undoFile } from '../src/index';
import type { Operation } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

let tick = 0;
const clock = (): string => new Date(Date.UTC(2026, 10, 14, 9, 0, 0, tick++)).toISOString();
let n = 0;
const newId = (): string => `op-${String(++n).padStart(3, '0')}`;
const P = 'prof-a';

function bill(id: string, fileHash: string): Record<string, unknown> {
  return {
    id,
    v: 1,
    rev: 1,
    apartmentId: 'apt-1',
    category: 'elettricita',
    supplier: 'Fornitore Luce',
    periodStart: '2025-12-01',
    periodEnd: '2026-01-31',
    amount: 9846,
    includedInConguaglio: true,
    sharedWithTenants: true,
    fileHash,
    filePath: 'x.pdf',
  };
}

/** Registers a record (no `before`) and returns the operation. */
function register(store: MemoryStore, type: 'bill' | 'instalment', id: string, hash: string) {
  return commitChange(
    store,
    {
      profileId: P,
      kind: 'register-bill',
      summary: `Registrato ${id}`,
      changes: [{ path: recordPath(type, id), after: bill(id, hash) }],
    },
    clock,
    newId,
  );
}

async function undoneIds(store: MemoryStore): Promise<string[]> {
  const { operations } = await readJournal(store);
  return operations.flatMap((o) => (o.undoes === undefined ? [] : [o.undoes])).sort();
}

describe('undoFile', () => {
  it('undoes the registrations of the file, most recent first, and only those', async () => {
    const store = new MemoryStore();
    const a = await register(store, 'bill', 'b1', 'H1');
    const other = await register(store, 'bill', 'b9', 'H2');
    const b = await register(store, 'bill', 'b2', 'H1');
    const c = await register(store, 'instalment', 'i1', 'H1');

    const result = await undoFile(store, 'H1', P, clock, newId);

    expect(result.map((o) => o.undoes)).toEqual([c.id, b.id, a.id]);
    expect(await undoneIds(store)).toEqual([a.id, b.id, c.id].sort());
    expect(await undoneIds(store)).not.toContain(other.id);
  });

  it('is repeatable: a second call returns an empty list', async () => {
    const store = new MemoryStore();
    await register(store, 'bill', 'b1', 'H1');
    expect(await undoFile(store, 'H1', P, clock, newId)).toHaveLength(1);
    expect(await undoFile(store, 'H1', P, clock, newId)).toEqual([]);
    expect(await undoFile(store, 'unknown-hash', P, clock, newId)).toEqual([]);
  });

  it('does not undo again a document that was undone on its own', async () => {
    const store = new MemoryStore();
    const a = await register(store, 'bill', 'b1', 'H1');
    const b = await register(store, 'bill', 'b2', 'H1');
    await undoOperation(store, a.id, P, clock, newId);
    const result = await undoFile(store, 'H1', P, clock, newId);
    expect(result.map((o) => o.undoes)).toEqual([b.id]);
  });

  it('stops at a dependency and, once it is gone, undoes only what is left', async () => {
    const store = new MemoryStore();
    const a = await register(store, 'bill', 'b1', 'H1');
    const b = await register(store, 'bill', 'b2', 'H1');
    const other = await register(store, 'bill', 'b9', 'H2');
    const edit: Operation = await commitChange(
      store,
      {
        profileId: P,
        kind: 'edit',
        summary: 'Modifica',
        changes: [
          {
            path: recordPath('bill', 'b1'),
            before: { ...bill('b1', 'H1'), rev: 1 },
            after: { ...bill('b1', 'H1'), amount: 1 },
          },
        ],
      },
      clock,
      newId,
    );

    await expect(undoFile(store, 'H1', P, clock, newId)).rejects.toThrow(/depend/);
    expect(await undoneIds(store)).toEqual([b.id]);

    await undoOperation(store, edit.id, P, clock, newId);
    const result = await undoFile(store, 'H1', P, clock, newId);
    expect(result.map((o) => o.undoes)).toEqual([a.id]);
    expect(await undoneIds(store)).not.toContain(other.id);
  });

  describe('with documents that were restored (undo, then redo)', () => {
    it('undoes the redo of a restored document and the others, then is repeatable', async () => {
      const store = new MemoryStore();
      const a = await register(store, 'bill', 'b1', 'H1');
      const b = await register(store, 'bill', 'b2', 'H1');
      const u1 = await undoOperation(store, b.id, P, clock, newId);
      const redo = await undoOperation(store, u1.id, P, clock, newId);

      const result = await undoFile(store, 'H1', P, clock, newId);

      expect(result.map((o) => o.undoes)).toEqual([redo.id, a.id]);
      expect(await store.readJson(recordPath('bill', 'b1'))).toMatchObject({ deleted: true });
      expect(await store.readJson(recordPath('bill', 'b2'))).toMatchObject({ deleted: true });
      expect(await undoFile(store, 'H1', P, clock, newId)).toEqual([]);
    });

    it('survives several undo and redo cycles', async () => {
      const store = new MemoryStore();
      const a = await register(store, 'bill', 'b1', 'H1');
      let last = await undoOperation(store, a.id, P, clock, newId);
      for (let i = 0; i < 3; i++) last = await undoOperation(store, last.id, P, clock, newId);
      // undo, redo, undo, redo: a is in force through the last redo
      const result = await undoFile(store, 'H1', P, clock, newId);
      expect(result.map((o) => o.undoes)).toEqual([last.id]);
      expect(await undoFile(store, 'H1', P, clock, newId)).toEqual([]);
    });

    it('works when every operation has the same timestamp', async () => {
      const store = new MemoryStore();
      const same = (): string => '2026-11-14T09:00:00.000Z';
      const a = await commitChange(
        store,
        {
          profileId: P,
          kind: 'register-bill',
          summary: 'a',
          changes: [{ path: recordPath('bill', 'b1'), after: bill('b1', 'H1') }],
        },
        same,
        newId,
      );
      const u = await undoOperation(store, a.id, P, same, newId);
      const redo = await undoOperation(store, u.id, P, same, newId);
      const result = await undoFile(store, 'H1', P, same, newId);
      expect(result.map((o) => o.undoes)).toEqual([redo.id]);
    });
  });
});
