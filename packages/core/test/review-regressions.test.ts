// Second review of the data reliability fixes (revisione 2026-11-18): two silent losses found in
// the first round, kept here as regression tests. Invented data.
import { describe, expect, it } from 'vitest';
import {
  BillSchema,
  InconsistentRecordError,
  JOURNAL_DIR,
  StaleWriteError,
  UnreadableRecordsError,
  checkConsistency,
  commitChange,
  loadAll,
  recordPath,
  forkVersions,
  repairDiverged,
  resolveFork,
  undoOperation,
} from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const P = recordPath('bill', 'bill-1');
const bill = (extra: Record<string, unknown> = {}) => ({
  id: 'bill-1',
  v: 1,
  rev: 1,
  apartmentId: 'apt-1',
  category: 'elettricita',
  supplier: 'F',
  periodStart: '2025-12-01',
  periodEnd: '2026-01-31',
  amount: 100,
  includedInConguaglio: true,
  sharedWithTenants: true,
  fileHash: 'abc',
  filePath: 'b/x.pdf',
  ...extra,
});
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 10, 20, 0, 0, tick++)).toISOString();
let count = 0;
const id = () => `op-${String(++count).padStart(3, '0')}`;
const op = (profileId: string, before: unknown, after: Record<string, unknown>) => ({
  profileId,
  kind: 'bill.update',
  apartmentId: 'apt-1',
  summary: 's',
  changes: [{ path: P, ...(before === undefined ? {} : { before }), after }],
});
async function copyJournal(from: MemoryStore, to: MemoryStore): Promise<void> {
  for (const name of await from.list(JOURNAL_DIR)) {
    to.putRaw(`${JOURNAL_DIR}/${name}`, from.getRaw(`${JOURNAL_DIR}/${name}`) ?? '');
  }
}

/** Two computers of the same person: A's change went through, its journal reached B first. */
async function sameProfileTwoComputers() {
  const a = new MemoryStore();
  const b = new MemoryStore();
  await commitChange(a, op('pa', undefined, bill()), clock, id);
  await copyJournal(a, b);
  b.putRaw(P, a.getRaw(P) ?? '');
  const r1 = await a.readJson(P);
  await commitChange(a, op('pa', r1, bill({ supplier: 'G' })), clock, id);
  await copyJournal(a, b); // the record of A has not arrived yet
  return { a, b, r1 };
}

describe('a journal ahead of the record is never written over (critical 1)', () => {
  it('refuses the other computer of the same person, and «ripara» applies the change', async () => {
    const { b, r1 } = await sameProfileTwoComputers();
    const names = await b.list(JOURNAL_DIR);
    await expect(
      commitChange(b, op('pa', r1, bill({ amount: 300 })), clock, id),
    ).rejects.toBeInstanceOf(InconsistentRecordError);
    expect(await b.list(JOURNAL_DIR)).toEqual(names);
    await repairDiverged(b, P);
    expect(await b.readJson(P)).toMatchObject({ supplier: 'G', rev: 2 });
    expect(await checkConsistency(b)).toEqual([]);
  });

  it('refuses the profile `cli` used by every machine as well', async () => {
    const a = new MemoryStore();
    const b = new MemoryStore();
    await commitChange(a, op('cli', undefined, bill()), clock, id);
    await copyJournal(a, b);
    b.putRaw(P, a.getRaw(P) ?? '');
    const r1 = await a.readJson(P);
    await commitChange(a, op('cli', r1, bill({ amount: 200 })), clock, id);
    await copyJournal(a, b);
    await expect(
      commitChange(b, op('cli', r1, bill({ amount: 300 })), clock, id),
    ).rejects.toMatchObject({ name: 'InconsistentRecordError', reason: 'diverged' });
  });

  it('goes on top only of a write that failed through the same store', async () => {
    class Failing extends MemoryStore {
      fail = false;
      override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
        if (this.fail && path.startsWith('_app/dati/')) {
          this.fail = false;
          throw new Error('EIO');
        }
        await super.writeJsonAtomic(path, value);
      }
    }
    const store = new Failing();
    await commitChange(store, op('pa', undefined, bill()), clock, id);
    const r1 = await store.readJson(P);
    store.fail = true;
    await expect(commitChange(store, op('pa', r1, bill({ amount: 2 })), clock, id)).rejects.toThrow(
      'EIO',
    );
    await commitChange(store, op('pa', r1, bill({ amount: 3 })), clock, id);
    expect(await store.readJson(P)).toMatchObject({ amount: 3, rev: 3 });
    expect(await checkConsistency(store)).toEqual([]);
    // Another store on the same files (another process) does not know that write failed.
    const other = new MemoryStore();
    await copyJournal(store, other);
    other.putRaw(P, store.getRaw(P) ?? '');
    store.fail = true;
    await expect(
      commitChange(store, op('pa', await store.readJson(P), bill({ amount: 4 })), clock, id),
    ).rejects.toThrow('EIO');
    await copyJournal(store, other);
    await expect(
      commitChange(other, op('pa', await other.readJson(P), bill({ amount: 5 })), clock, id),
    ).rejects.toBeInstanceOf(InconsistentRecordError);
  });

  it('a change that lands during a retry is never overwritten by «ripara» (the race)', async () => {
    class Racing extends MemoryStore {
      failNext = false;
      onJournal: (() => void) | undefined;
      override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
        if (this.failNext && path.startsWith('_app/dati/')) {
          this.failNext = false;
          throw new Error('EIO');
        }
        await super.writeJsonAtomic(path, value);
        if (path.startsWith(JOURNAL_DIR) && this.onJournal !== undefined) {
          const land = this.onJournal;
          this.onJournal = undefined;
          land();
        }
      }
    }
    const b = new Racing();
    const a = new MemoryStore();
    await commitChange(b, op('pb', undefined, bill()), clock, id);
    await copyJournal(b, a);
    a.putRaw(P, b.getRaw(P) ?? '');
    const r1 = await b.readJson(P);
    await commitChange(a, op('pa', r1, bill({ supplier: 'A' })), clock, id); // A: rev 2
    b.failNext = true;
    await expect(commitChange(b, op('pb', r1, bill({ amount: 300 })), clock, id)).rejects.toThrow();
    // B retries; A's journal and record land between B's journal write and its record write.
    b.onJournal = () => {
      void copyJournal(a, b);
      b.putRaw(P, a.getRaw(P) ?? '');
    };
    await expect(
      commitChange(b, op('pb', r1, bill({ amount: 400 })), clock, id),
    ).rejects.toBeInstanceOf(StaleWriteError);
    await expect(repairDiverged(b, P)).rejects.toThrow(/not a state/);
    expect(await b.readJson(P)).toMatchObject({ supplier: 'A', rev: 2 });
  });
});

describe('a forked record never drops out of a calculation (critical 2)', () => {
  async function fork(bAfter: Record<string, unknown>) {
    const a = new MemoryStore();
    const b = new MemoryStore();
    await commitChange(a, op('pa', undefined, bill()), clock, id);
    await copyJournal(a, b);
    b.putRaw(P, a.getRaw(P) ?? '');
    const r1 = await a.readJson(P);
    await commitChange(a, op('pa', r1, bill({ supplier: 'G' })), clock, id);
    await commitChange(b, op('pb', r1, bill(bAfter)), clock, id);
    await copyJournal(a, b);
    return b;
  }

  it('with its file missing (P2a) or marked deleted in one version (P2b)', async () => {
    const missing = await fork({ amount: 300 });
    missing.delete(P);
    const deleted = await fork({ amount: 300, deleted: true });
    for (const store of [missing, deleted]) {
      expect(await checkConsistency(store)).toEqual([{ path: P, reason: 'forked' }]);
      const failure = loadAll(store, 'bill', BillSchema);
      await expect(failure).rejects.toBeInstanceOf(UnreadableRecordsError);
      await expect(failure).rejects.toMatchObject({ records: [{ path: P, reason: 'forked' }] });
    }
  });
});

describe('a branch below the latest rev is a fork (third review, S2)', () => {
  async function deepFork() {
    const a = new MemoryStore();
    await commitChange(a, op('pa', undefined, bill()), clock, id);
    const c = new MemoryStore();
    await copyJournal(a, c);
    c.putRaw(P, a.getRaw(P) ?? '');
    const r1 = await a.readJson(P);
    await commitChange(a, op('pa', r1, bill({ supplier: 'G' })), clock, id);
    const a3 = await commitChange(
      a,
      op('pa', await a.readJson(P), bill({ supplier: 'H' })),
      clock,
      id,
    );
    const c2 = await commitChange(c, op('pc', r1, bill({ amount: 777 })), clock, id); // «salvato»
    await copyJournal(a, c);
    await copyJournal(c, a);
    return { a, c, a3, c2 };
  }

  it('is reported on both computers, «ripara» refuses, and the versions are the two heads', async () => {
    const { a, c, a3, c2 } = await deepFork();
    for (const store of [a, c]) {
      expect(await checkConsistency(store)).toEqual([{ path: P, reason: 'forked' }]);
      await expect(repairDiverged(store, P)).rejects.toThrow(/resolveFork/);
      expect((await forkVersions(store, P)).map(({ id: opId }) => opId).sort()).toEqual(
        [a3.id, c2.id].sort(),
      );
    }
    // When A's record reaches C, the fork does not go away: 777 is not lost in silence.
    c.putRaw(P, a.getRaw(P) ?? '');
    expect(await checkConsistency(c)).toEqual([{ path: P, reason: 'forked' }]);
  });

  it('is settled by the choice, which keeps everything in the journal and can be undone', async () => {
    const { c, c2 } = await deepFork();
    const resolved = await resolveFork(c, P, c2.id, 'pc', clock, id);
    expect(await c.readJson(P)).toMatchObject({ amount: 777, rev: 4 });
    expect(await checkConsistency(c)).toEqual([]);
    expect(await forkVersions(c, P)).toEqual([]);
    await undoOperation(c, resolved.id, 'pc', clock, id);
    expect(await c.readJson(P)).toMatchObject({ amount: 777, rev: 5 });
    expect(await checkConsistency(c)).toEqual([]);
  });

  it('refuses the choice when the disk has a rev above the versions (point 3)', async () => {
    const { c, c2 } = await deepFork();
    c.putRaw(P, JSON.stringify(bill({ rev: 9, amount: 1 })));
    await expect(resolveFork(c, P, c2.id, 'pc', clock, id)).rejects.toThrow(/wait for the/);
  });

  it('is not a fork: linear history, undo and redo, a retry through the same store', async () => {
    const store = new MemoryStore();
    await commitChange(store, op('pa', undefined, bill()), clock, id);
    const two = await commitChange(
      store,
      op('pa', await store.readJson(P), bill({ amount: 2 })),
      clock,
      id,
    );
    const undo = await undoOperation(store, two.id, 'pa', clock, id);
    await undoOperation(store, undo.id, 'pa', clock, id);
    await commitChange(store, op('pa', await store.readJson(P), bill({ amount: 3 })), clock, id);
    expect(await checkConsistency(store)).toEqual([]);
  });
});
