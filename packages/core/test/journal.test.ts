import { describe, expect, it } from 'vitest';
import {
  JOURNAL_DIR,
  OperationSchema,
  StaleWriteError,
  checkConsistency,
  commitChange,
  dependentsOf,
  notesFor,
  readJournal,
  recordPath,
  repairDiverged,
  undoOperation,
} from '../src/index';
import type { Operation } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const BILL_PATH = recordPath('bill', 'bill-1');
const BILL_2_PATH = recordPath('bill', 'bill-2');

/** A store that remembers the order of its writes and can fail the writes of records. */
class TestStore extends MemoryStore {
  readonly writes: string[] = [];
  /** How many of the next writes under `_app/dati/` fail, as a disk error would. */
  failRecordWrites = 0;
  /** A path whose reads fail, as a disk error would (not as a file that is not valid JSON). */
  failReadsOf: string | undefined;

  override async readJson(path: string): Promise<unknown> {
    if (path === this.failReadsOf) throw new Error('I/O error');
    return super.readJson(path);
  }

  override async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    if (path.startsWith('_app/dati/') && this.failRecordWrites > 0) {
      this.failRecordWrites -= 1;
      throw new Error('disk error');
    }
    this.writes.push(path);
    await super.writeJsonAtomic(path, value);
  }
}

/** A clock that moves one millisecond at each call, so later operations are really later. */
function tickingClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 10, 20, 0, 0, tick++)).toISOString();
}

/** Ids that sort in the order they are handed out ("op-001", "op-002", ...). */
function idSequence(prefix = 'op'): () => string {
  let count = 0;
  return () => `${prefix}-${String(++count).padStart(3, '0')}`;
}

/** Ids handed out in the given order, to make ids that sort against the order of creation. */
function idList(...ids: string[]): () => string {
  let next = 0;
  return () => ids[next++] ?? `extra-${String(next)}`;
}

/** A clock that does not move: every operation made with it is at the same instant. */
const FROZEN = '2026-11-10T21:00:00.000Z';
const frozen = (): string => FROZEN;

function bill(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    fileHash: 'abc123',
    filePath: 'bollette/2026-02-luce.pdf',
    ...extra,
  };
}

function note(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    v: 1,
    rev: 1,
    targetType: 'bill',
    targetId: 'bill-1',
    text: 'Controllare il contatore',
    profileId: 'prof-a',
    at: '2026-11-10T20:00:00.000Z',
    visibleToTenants: false,
    ...extra,
  };
}

type Input = Omit<Operation, 'id' | 'v' | 'at'>;

/** An operation that creates a bill (no `before`). */
function createBill(id = 'bill-1', extra: Record<string, unknown> = {}): Input {
  return {
    profileId: 'prof-a',
    kind: 'bill.create',
    apartmentId: 'apt-1',
    summary: `Registrata la bolletta ${id}`,
    changes: [{ path: recordPath('bill', id), after: bill(id, extra) }],
  };
}

/** An operation that moves a bill from `before` (what is on disk) to `after`. */
function changeBill(
  before: unknown,
  after: Record<string, unknown> | undefined,
  id = 'bill-1',
): Input {
  return {
    profileId: 'prof-a',
    kind: 'bill.update',
    apartmentId: 'apt-1',
    summary: `Modificata la bolletta ${id}`,
    changes: [{ path: recordPath('bill', id), before, after }],
  };
}

/** A store, a ticking clock and an id sequence, with a shortcut for `commitChange`. */
function setup() {
  const store = new TestStore();
  const clock = tickingClock();
  const newId = idSequence();
  return {
    store,
    clock,
    newId,
    commit: (input: Input) => commitChange(store, input, clock, newId),
    undo: (opId: string, opts?: { cascade?: boolean }) =>
      undoOperation(store, opId, 'prof-b', clock, newId, opts),
  };
}

const journalNames = (store: MemoryStore) => store.list(JOURNAL_DIR);

/** A new store with the journal of `from` and none of its records. */
async function copyJournal(from: MemoryStore): Promise<TestStore> {
  const copy = new TestStore();
  for (const name of await journalNames(from)) {
    copy.putRaw(`${JOURNAL_DIR}/${name}`, from.getRaw(`${JOURNAL_DIR}/${name}`) ?? '');
  }
  return copy;
}

describe('commitChange', () => {
  it('writes the operation file first, then the record, and returns the operation', async () => {
    const { store, commit } = setup();

    const op = await commit(createBill());

    expect(op).toMatchObject({
      id: 'op-001',
      v: 1,
      at: '2026-11-10T20:00:00.000Z',
      profileId: 'prof-a',
      kind: 'bill.create',
      apartmentId: 'apt-1',
      summary: 'Registrata la bolletta bill-1',
    });
    expect(store.writes).toEqual([
      `${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`,
      BILL_PATH,
    ]);
    expect(await store.readJson(`${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`)).toEqual(
      op,
    );
    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1'));
  });

  it('stores for each change the `after` that is written to disk, with the new rev', async () => {
    const { store, commit } = setup();
    await commit(createBill('bill-1', { rev: 99 }));
    const before = await store.readJson(BILL_PATH);

    const op = await commit(changeBill(before, bill('bill-1', { rev: 7, amount: 12000 })));

    const onDisk = await store.readJson(BILL_PATH);
    expect(onDisk).toEqual(bill('bill-1', { rev: 2, amount: 12000 }));
    expect(op.changes).toEqual([{ path: BILL_PATH, before, after: onDisk }]);
  });

  it('marks the record deleted when `after` is absent, and the journal says so', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const before = await store.readJson(BILL_PATH);

    const op = await commit(changeBill(before, undefined));

    const expected = bill('bill-1', { rev: 2, deleted: true });
    expect(await store.readJson(BILL_PATH)).toEqual(expected);
    expect(op.changes[0]?.after).toEqual(expected);
    // Nothing is removed from the disk, and the record is only hidden from the normal load.
    expect(await store.list('_app/dati/bill')).toEqual(['bill-1.json']);
  });

  it('refuses to delete a record that does not exist, writing nothing', async () => {
    const { store, commit } = setup();
    await expect(commit(changeBill(undefined, undefined))).rejects.toThrow(/does not exist/);
    expect(store.writes).toEqual([]);
  });

  it('keeps the file names free of ":" and fixes the time part to milliseconds', async () => {
    const store = new TestStore();
    const stamps = [
      '2026-11-10T20:15:30.123Z',
      '2026-11-10T20:15:30Z',
      '2026-11-10T20:15:30.5Z',
      '2026-11-10T20:15:30.123456Z',
    ];
    const newId = idSequence();
    for (const [index, at] of stamps.entries()) {
      await commitChange(store, createBill(`bill-${String(index)}`), () => at, newId);
    }

    const names = await journalNames(store);
    // `list` is sorted by name: seconds and ".000" first, then ".123" (twice), then ".500".
    expect(names).toEqual([
      '20261110T201530000Z-prof-a-op-002.json',
      '20261110T201530123Z-prof-a-op-001.json',
      '20261110T201530123Z-prof-a-op-004.json',
      '20261110T201530500Z-prof-a-op-003.json',
    ]);
    for (const name of names) {
      expect(name).not.toContain(':');
      expect(name).toMatch(/^[0-9]{8}T[0-9]{9}Z-prof-a-op-[0-9]{3}\.json$/);
    }
  });

  it('refuses a stale `before` without writing the journal or any record', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    await commit(createBill('bill-2'));
    const staleBefore = await store.readJson(BILL_PATH);
    await commit(changeBill(staleBefore, bill('bill-1', { amount: 1 })));
    store.writes.length = 0;
    const bill2 = await store.readJson(BILL_2_PATH);

    const input: Input = {
      profileId: 'prof-a',
      kind: 'bill.update',
      summary: 'Due bollette',
      changes: [
        { path: BILL_2_PATH, before: bill2, after: bill('bill-2', { amount: 2 }) },
        { path: BILL_PATH, before: staleBefore, after: bill('bill-1', { amount: 3 }) },
      ],
    };
    const error: unknown = await commit(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error).toMatchObject({ path: BILL_PATH, expected: 1, actual: 2 });
    expect(store.writes).toEqual([]);
    expect(await journalNames(store)).toHaveLength(3);
    expect(await store.readJson(BILL_2_PATH)).toEqual(bill2);
  });

  it('refuses to create a record that already exists, and a missing one to be changed', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    await expect(commit(createBill())).rejects.toBeInstanceOf(StaleWriteError);
    await expect(
      commit(changeBill(bill('bill-9'), bill('bill-9'), 'bill-9')),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(await journalNames(store)).toHaveLength(1);
  });

  it('refuses to reuse an operation file name, so the journal is never overwritten', async () => {
    const store = new TestStore();
    const clock = () => '2026-11-10T20:00:00.000Z';
    const sameId = () => 'op-001';
    await commitChange(store, createBill(), clock, sameId);
    const text = store.getRaw(`${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`);

    await expect(commitChange(store, createBill('bill-2'), clock, sameId)).rejects.toThrow(
      /already/,
    );

    expect(store.getRaw(`${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`)).toBe(text);
    expect(await store.readJson(BILL_2_PATH)).toBeUndefined();
  });

  const refusals: [label: string, patch: Partial<Input>][] = [
    ['a profile id with a slash', { profileId: 'a/b' }],
    ['a profile id that Windows refuses', { profileId: 'con' }],
    ['an empty summary', { summary: '' }],
    ['an empty kind', { kind: '' }],
    ['a path that climbs out of the folder', { changes: [{ path: '../x.json', after: {} }] }],
    ['a path with a colon', { changes: [{ path: '_app/dati/a:b.json', after: {} }] }],
    [
      'a `before` that is not a record',
      { changes: [{ path: BILL_PATH, before: 'text', after: bill('bill-1') }] },
    ],
    [
      'a `before` without a rev',
      { changes: [{ path: BILL_PATH, before: { id: 'bill-1' }, after: bill('bill-1') }] },
    ],
    ['an `after` that is not a record', { changes: [{ path: BILL_PATH, after: [1, 2] }] }],
    [
      'the same path twice',
      {
        changes: [
          { path: BILL_PATH, after: bill('bill-1') },
          { path: BILL_PATH, after: bill('bill-1') },
        ],
      },
    ],
  ];
  it.each(refusals)('refuses %s and writes nothing', async (_label, patch) => {
    const { store, commit } = setup();
    await expect(commit({ ...createBill(), ...patch })).rejects.toThrow();
    expect(store.writes).toEqual([]);
  });

  it.each([
    ['an id with a slash', () => 'a/b', () => '2026-11-10T20:00:00.000Z'],
    ['a time that is not ISO 8601 UTC', () => 'op-1', () => '10/11/2026'],
    ['a time with an offset', () => 'op-1', () => '2026-11-10T20:00:00+01:00'],
  ])('refuses %s from the id generator or the clock, writing nothing', async (_l, newId, clock) => {
    const store = new TestStore();
    await expect(commitChange(store, createBill(), clock, newId)).rejects.toThrow();
    expect(store.writes).toEqual([]);
  });

  it('normalises the path to NFC, as the store does', async () => {
    const { store, commit } = setup();
    const nfd = '_app/dati/bill/Perché.json';
    const op = await commit({ ...createBill(), changes: [{ path: nfd, after: bill('Perché') }] });
    expect(op.changes[0]?.path).toBe('_app/dati/bill/Perché.json');
    expect(await store.readJson('_app/dati/bill/Perché.json')).toBeDefined();
  });

  it('writes two operations launched together with the same time to two distinct files', async () => {
    const store = new TestStore();
    const clock = () => '2026-11-10T20:00:00.000Z';
    const ids = ['op-b', 'op-a'];

    await Promise.all([
      commitChange(store, createBill('bill-1'), clock, () => ids[0] ?? ''),
      commitChange(store, createBill('bill-2'), clock, () => ids[1] ?? ''),
    ]);

    expect(await journalNames(store)).toEqual([
      '20261110T200000000Z-prof-a-op-a.json',
      '20261110T200000000Z-prof-a-op-b.json',
    ]);
    const { operations, problems } = await readJournal(store);
    expect(problems).toEqual([]);
    expect(operations.map((op) => op.id)).toEqual(['op-a', 'op-b']);
  });

  it('leaves a journal that is ahead of the record when the record write is interrupted', async () => {
    const { store, commit, clock, newId } = setup();
    await commit(createBill());
    const before = await store.readJson(BILL_PATH);
    store.failRecordWrites = 1;

    await expect(commit(changeBill(before, bill('bill-1', { amount: 5 })))).rejects.toThrow(
      'disk error',
    );

    expect(await journalNames(store)).toHaveLength(2);
    expect(await store.readJson(BILL_PATH)).toEqual(before);
    expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);

    await repairDiverged(store, BILL_PATH);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 2, amount: 5 }));
    expect(await checkConsistency(store)).toEqual([]);
    // After the repair the record can be changed again from its new state.
    const repaired = await store.readJson(BILL_PATH);
    await commitChange(store, changeBill(repaired, bill('bill-1', { amount: 6 })), clock, newId);
    expect(await checkConsistency(store)).toEqual([]);
  });
});

describe('OperationSchema', () => {
  const valid = {
    id: 'op-1',
    v: 1,
    at: '2026-11-10T20:00:00.000Z',
    profileId: 'prof-a',
    kind: 'bill.create',
    summary: 'Registrata',
    changes: [{ path: BILL_PATH, after: bill('bill-1') }],
  };

  it('accepts an operation with and without the optional fields', () => {
    expect(OperationSchema.safeParse(valid).success).toBe(true);
    const full = {
      ...valid,
      apartmentId: 'apt-1',
      reason: 'Errore di battitura',
      undoes: 'op-0',
      changes: [{ path: BILL_PATH, before: bill('bill-1'), after: bill('bill-1', { rev: 2 }) }],
    };
    expect(OperationSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['another version', { v: 2 }],
    ['a time without Z', { at: '2026-11-10T20:00:00' }],
    ['an empty id', { id: '' }],
    ['an empty summary', { summary: '' }],
    ['a change without `after`', { changes: [{ path: BILL_PATH }] }],
    [
      'a change whose `after` has no rev',
      { changes: [{ path: BILL_PATH, after: { id: 'bill-1' } }] },
    ],
    [
      'a change whose `before` has no rev',
      { changes: [{ path: BILL_PATH, before: {}, after: bill('bill-1') }] },
    ],
    ['an unsafe path', { changes: [{ path: '../x.json', after: bill('bill-1') }] }],
  ])('rejects %s', (_label, patch) => {
    expect(OperationSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('readJournal', () => {
  it('returns the operations by time, then by id', async () => {
    const store = new TestStore();
    const at = (time: string) => () => `2026-11-10T${time}Z`;
    await commitChange(store, createBill('b1'), at('20:00:02.000'), () => 'op-a');
    await commitChange(store, createBill('b2'), at('20:00:01.000'), () => 'op-z');
    await commitChange(store, createBill('b3'), at('20:00:01.000'), () => 'op-y');
    // "01Z" is the same instant as "01.000Z": the tie goes to the id, not to the letter Z.
    await commitChange(store, createBill('b4'), at('20:00:01'), () => 'op-x');

    const { operations, problems } = await readJournal(store);

    expect(problems).toEqual([]);
    expect(operations.map((op) => op.id)).toEqual(['op-x', 'op-y', 'op-z', 'op-a']);
  });

  it('is empty when there is no journal yet', async () => {
    expect(await readJournal(new MemoryStore())).toEqual({ operations: [], problems: [] });
  });

  it('reports the files it cannot use without throwing, like the record loader', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const good = store.getRaw(`${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`) ?? '';
    store.putRaw(`${JOURNAL_DIR}/truncated.json`, '{"id": "op-9", "v": 1, "at": "2026');
    store.putRaw(`${JOURNAL_DIR}/future.json`, JSON.stringify({ ...JSON.parse(good), v: 2 }));
    store.putRaw(`${JOURNAL_DIR}/other.json`, '{"hello": "world"}');
    store.putRaw(`${JOURNAL_DIR}/x (conflicted copy 2026-11-05).json`, good);
    store.putRaw(`${JOURNAL_DIR}/.tmp-1234`, 'half');

    const { operations, problems } = await readJournal(store);

    expect(operations.map((op) => op.id)).toEqual(['op-001']);
    expect(problems).toEqual([
      { path: `${JOURNAL_DIR}/future.json`, reason: 'future-version' },
      { path: `${JOURNAL_DIR}/other.json`, reason: 'schema-mismatch' },
      {
        path: `${JOURNAL_DIR}/truncated.json`,
        reason: 'malformed-json',
      },
      {
        path: `${JOURNAL_DIR}/x (conflicted copy 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${JOURNAL_DIR}/x.json`,
      },
    ]);
  });
  it('keeps the file named as the journal names it and reports a hand copy as duplicate-id', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const name = `${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`;
    store.putRaw(
      `${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001 - Copia.json`,
      store.getRaw(name) ?? '',
    );

    const { operations, problems } = await readJournal(store);

    expect(operations.map((op) => op.id)).toEqual(['op-001']);
    expect(problems).toEqual([
      {
        path: `${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001 - Copia.json`,
        reason: 'duplicate-id',
      },
    ]);
  });

  it('reads an operation whose file has another name, as long as its id is not repeated', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const name = `${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`;
    const raw = store.getRaw(name) ?? '';
    store.putRaw(`${JOURNAL_DIR}/renamed.json`, raw.replace('"op-001"', '"op-777"'));

    const { operations, problems } = await readJournal(store);

    expect(operations.map((op) => op.id)).toEqual(['op-001', 'op-777']);
    expect(problems).toEqual([]);
  });

  it('uses none of two operation files with the same id when neither has the journal name', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const raw = store.getRaw(`${JOURNAL_DIR}/20261110T200000000Z-prof-a-op-001.json`) ?? '';
    const copy = raw.replace('"op-001"', '"op-777"');
    store.putRaw(`${JOURNAL_DIR}/a.json`, copy);
    store.putRaw(`${JOURNAL_DIR}/b.json`, copy);

    const { operations, problems } = await readJournal(store);

    expect(operations.map((op) => op.id)).toEqual(['op-001']);
    expect(problems).toEqual([
      { path: `${JOURNAL_DIR}/a.json`, reason: 'duplicate-id' },
      { path: `${JOURNAL_DIR}/b.json`, reason: 'duplicate-id' },
    ]);
  });
});

describe('dependentsOf', () => {
  it('throws for an operation that is not in the journal', async () => {
    const { store } = setup();
    await expect(dependentsOf(store, 'nope')).rejects.toThrow(/Unknown operation/);
  });

  it('gives the later operations that touch the same record, and not the others', async () => {
    const { store, commit } = setup();
    const first = await commit(createBill());
    await commit(createBill('bill-2'));
    const second = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );

    expect((await dependentsOf(store, first.id)).map((op) => op.id)).toEqual([second.id]);
    expect(await dependentsOf(store, second.id)).toEqual([]);
    expect(await dependentsOf(store, 'op-002')).toEqual([]);
  });

  it('follows the dependents of dependents, but not operations that came before them', async () => {
    const { store, commit } = setup();
    const a = await commit(createBill('bill-1'));
    // `c` touches bill-2 before `b` brings bill-2 into the chain: it is not a dependent of `a`.
    const c = await commit(createBill('bill-2'));
    const b = await commit({
      profileId: 'prof-a',
      kind: 'bill.update',
      summary: 'Due bollette',
      changes: [
        {
          path: BILL_PATH,
          before: await store.readJson(BILL_PATH),
          after: bill('bill-1', { amount: 1 }),
        },
        {
          path: BILL_2_PATH,
          before: await store.readJson(BILL_2_PATH),
          after: bill('bill-2', { amount: 1 }),
        },
      ],
    });
    const d = await commit(
      changeBill(await store.readJson(BILL_2_PATH), bill('bill-2', { amount: 2 }), 'bill-2'),
    );

    expect((await dependentsOf(store, a.id)).map((op) => op.id)).toEqual([b.id, d.id]);
    expect((await dependentsOf(store, c.id)).map((op) => op.id)).toEqual([b.id, d.id]);
    expect((await dependentsOf(store, b.id)).map((op) => op.id)).toEqual([d.id]);
  });

  it('leaves out an operation that was undone and the undo that cancelled it', async () => {
    const { store, commit, undo } = setup();
    const a = await commit(createBill());
    const b = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    await undo(b.id);

    expect(await dependentsOf(store, a.id)).toEqual([]);
  });
});

describe('undoOperation', () => {
  it('puts back the `before` of an operation without dependents and journals an undo', async () => {
    const { store, commit, undo } = setup();
    await commit(createBill());
    const before = await store.readJson(BILL_PATH);
    const update = await commit(changeBill(before, bill('bill-1', { amount: 1 })));
    const current = await store.readJson(BILL_PATH);

    const undone = await undo(update.id);

    expect(undone).toMatchObject({
      kind: 'undo',
      undoes: update.id,
      profileId: 'prof-b',
      apartmentId: 'apt-1',
      summary: `Annullata: ${update.summary}`,
    });
    expect(undone.changes).toEqual([
      { path: BILL_PATH, before: current, after: { ...(before as object), rev: 3 } },
    ]);
    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 3 }));
    expect((await readJournal(store)).operations).toHaveLength(3);
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('marks as deleted a record that the operation created', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());

    const undone = await undo(create.id);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 2, deleted: true }));
    expect(undone.changes[0]?.after).toEqual(bill('bill-1', { rev: 2, deleted: true }));
    expect(await store.list('_app/dati/bill')).toEqual(['bill-1.json']);
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('brings back a record that the operation deleted', async () => {
    const { store, commit, undo } = setup();
    await commit(createBill());
    const del = await commit(changeBill(await store.readJson(BILL_PATH), undefined));

    await undo(del.id);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 3 }));
  });

  it('undoes every change of an operation', async () => {
    const { store, commit, undo } = setup();
    await commit(createBill('bill-1'));
    const op = await commit({
      profileId: 'prof-a',
      kind: 'bill.import',
      summary: 'Una modifica e una creazione',
      changes: [
        {
          path: BILL_PATH,
          before: await store.readJson(BILL_PATH),
          after: bill('bill-1', { amount: 1 }),
        },
        { path: BILL_2_PATH, after: bill('bill-2') },
      ],
    });

    await undo(op.id);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 3 }));
    expect(await store.readJson(BILL_2_PATH)).toEqual(bill('bill-2', { rev: 2, deleted: true }));
  });

  it('refuses, writing nothing, when the record on disk is ahead of the journal', async () => {
    const { store, commit, undo } = setup();
    await commit(createBill());
    const update = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    // Another machine changed the record to rev 3; its journal file has not arrived yet.
    await store.writeJsonAtomic(BILL_PATH, bill('bill-1', { amount: 2, rev: 3 }));
    const text = store.getRaw(BILL_PATH);
    const names = await journalNames(store);

    await expect(undo(update.id)).rejects.toThrow(/not as the journal leaves it.*rev 3.*rev 2/);

    expect(store.getRaw(BILL_PATH)).toBe(text);
    expect(await journalNames(store)).toEqual(names);
  });

  it('refuses when the record on disk has the rev of the journal but other content', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());
    await store.writeJsonAtomic(BILL_PATH, bill('bill-1', { amount: 2 }));
    const names = await journalNames(store);

    await expect(undo(create.id)).rejects.toThrow(/not as the journal leaves it/);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { amount: 2 }));
    expect(await journalNames(store)).toEqual(names);
  });

  it('checks every record of a cascade before undoing any of them', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill('bill-1'));
    await commit({
      profileId: 'prof-a',
      kind: 'bill.import',
      summary: 'Modifica e creazione',
      changes: [
        {
          path: BILL_PATH,
          before: await store.readJson(BILL_PATH),
          after: bill('bill-1', { amount: 1 }),
        },
        { path: BILL_2_PATH, after: bill('bill-2') },
      ],
    });
    await store.writeJsonAtomic(BILL_2_PATH, bill('bill-2', { rev: 2, amount: 7 }));
    const bill1 = store.getRaw(BILL_PATH);
    const names = await journalNames(store);

    await expect(undo(create.id, { cascade: true })).rejects.toThrow(/bill-2/);

    expect(store.getRaw(BILL_PATH)).toBe(bill1);
    expect(await journalNames(store)).toEqual(names);
  });

  it('throws for an unknown operation', async () => {
    const { undo } = setup();
    await expect(undo('nope')).rejects.toThrow(/Unknown operation/);
  });

  it('refuses to undo the same operation twice', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());
    await undo(create.id);
    const text = store.getRaw(BILL_PATH);
    const names = await journalNames(store);

    await expect(undo(create.id)).rejects.toThrow(/already undone/);

    expect(store.getRaw(BILL_PATH)).toBe(text);
    expect(await journalNames(store)).toEqual(names);
  });

  it('refuses when later operations depend on it, unless asked to undo them too', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());
    const update = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    const text = store.getRaw(BILL_PATH);
    const names = await journalNames(store);

    await expect(undo(create.id)).rejects.toThrow(new RegExp(`depend.*${update.id}`));
    await expect(undo(create.id, { cascade: false })).rejects.toThrow(/depend/);

    expect(store.getRaw(BILL_PATH)).toBe(text);
    expect(await journalNames(store)).toEqual(names);
  });

  it('with `cascade` undoes the dependents newest first, then the operation itself', async () => {
    const { store, commit, undo } = setup();
    const a = await commit(createBill());
    const b = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    const c = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 2 })),
    );

    const last = await undo(a.id, { cascade: true });

    const { operations } = await readJournal(store);
    expect(operations.slice(3).map((op) => op.undoes)).toEqual([c.id, b.id, a.id]);
    expect(last.id).toBe(operations[5]?.id);
    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 6, deleted: true }));
    expect(await checkConsistency(store)).toEqual([]);
    // All of them are undone now, so none can be undone again.
    for (const op of [a, b, c]) await expect(undo(op.id)).rejects.toThrow(/already undone/);
  });

  it('can undo an undo, which brings the change back, but only once', async () => {
    const { store, commit, undo } = setup();
    await commit(createBill());
    const update = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    const undoOfUpdate = await undo(update.id);

    const redo = await undo(undoOfUpdate.id);

    expect(redo).toMatchObject({ kind: 'undo', undoes: undoOfUpdate.id });
    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 4, amount: 1 }));
    await expect(undo(undoOfUpdate.id)).rejects.toThrow(
      `Operation ${undoOfUpdate.id} was already undone by ${redo.id}`,
    );
    // The update is back in force through the redo: the message says what to undo instead.
    await expect(undo(update.id)).rejects.toThrow(
      `Operation ${update.id} was undone by ${undoOfUpdate.id} and brought back by ${redo.id}`,
    );
  });

  it('does not undo a change that a redo brought back unless its dependents go too', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());
    const update = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })),
    );
    const undoOfUpdate = await undo(update.id);
    await undo(undoOfUpdate.id);
    const text = store.getRaw(BILL_PATH);
    const names = await journalNames(store);

    // The update is in force again, so the create has a dependent once more.
    expect((await dependentsOf(store, create.id)).map((op) => op.id)).toEqual([update.id]);
    await expect(undo(create.id)).rejects.toThrow(new RegExp(`depend.*${update.id}`));
    expect(store.getRaw(BILL_PATH)).toBe(text);
    expect(await journalNames(store)).toEqual(names);

    await undo(create.id, { cascade: true });

    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 9846, deleted: true });
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('terminates on a journal where two undos undo each other', async () => {
    const { store, commit } = setup();
    const create = await commit(createBill());
    const loop = (id: string, undoes: string) => ({
      ...create,
      id,
      kind: 'undo',
      undoes,
      at: id === 'loop-a' ? '2026-11-10T21:00:00.000Z' : '2026-11-10T21:00:01.000Z',
    });
    for (const op of [loop('loop-a', 'loop-b'), loop('loop-b', 'loop-a')]) {
      store.putRaw(`${JOURNAL_DIR}/loop-${op.id}.json`, JSON.stringify(op));
    }

    await expect(
      undoOperation(store, 'loop-a', 'prof-b', tickingClock(), idSequence('un')),
    ).rejects.toThrow(/already undone/);
  });

  it('refuses to undo an undo when a later change depends on it', async () => {
    const { store, commit, undo } = setup();
    const create = await commit(createBill());
    const undoOfCreate = await undo(create.id);
    // The record is deleted now; someone brings it back with a new operation.
    const revive = await commit(
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 9 })),
    );

    expect((await dependentsOf(store, undoOfCreate.id)).map((op) => op.id)).toEqual([revive.id]);
    await expect(undo(undoOfCreate.id)).rejects.toThrow(/depend/);
  });

  it('refuses an unsafe profile id before touching anything', async () => {
    const { store, commit, clock, newId } = setup();
    const create = await commit(createBill());
    const names = await journalNames(store);

    await expect(undoOperation(store, create.id, 'a/b', clock, newId)).rejects.toThrow(RangeError);

    expect(await journalNames(store)).toEqual(names);
  });

  it('refuses to undo a creation when the record file is gone', async () => {
    const { store, commit } = setup();
    const create = await commit(createBill());
    const journalOnly = await copyJournal(store);

    await expect(
      undoOperation(journalOnly, create.id, 'prof-b', tickingClock(), idSequence('un')),
    ).rejects.toThrow(/not as the journal leaves it \(on disk no readable record/);

    expect(await journalNames(journalOnly)).toHaveLength(1);
  });
});

describe('operations made at the same instant', () => {
  const ids = ['c-1', 'b-2', 'a-3'];

  /** A bill created and changed twice at one instant, with ids that sort against that order. */
  async function chain(store: TestStore): Promise<Operation[]> {
    const next = idList(...ids);
    const operations: Operation[] = [];
    for (const amount of [1, 2, 3]) {
      const before = await store.readJson(BILL_PATH);
      const input =
        before === undefined
          ? createBill('bill-1', { amount })
          : changeBill(before, bill('bill-1', { amount }));
      operations.push(await commitChange(store, input, frozen, next));
    }
    return operations;
  }

  it('takes the highest rev as the latest, not the highest id', async () => {
    const store = new TestStore();
    await chain(store);

    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 3, rev: 3 });
    expect(await checkConsistency(store)).toEqual([]);
    // Repairing a record that is right changes nothing.
    await repairDiverged(store, BILL_PATH);
    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 3, rev: 3 });
  });

  it('still reports a record that is not as the highest rev says', async () => {
    const store = new TestStore();
    await chain(store);
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1', { amount: 2, rev: 2 })));
    expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);
    await repairDiverged(store, BILL_PATH);
    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 3, rev: 3 });
  });

  it('finds the dependents by the rev chain, whatever the ids', async () => {
    const store = new TestStore();
    const [create, second, third] = await chain(store);

    expect((await dependentsOf(store, create?.id ?? '')).map((op) => op.id).sort()).toEqual([
      'a-3',
      'b-2',
    ]);
    expect((await dependentsOf(store, second?.id ?? '')).map((op) => op.id)).toEqual(['a-3']);
    expect(await dependentsOf(store, third?.id ?? '')).toEqual([]);
  });

  it('does not let an undo drop a change made at the same instant', async () => {
    const store = new TestStore();
    const next = idList('z1', 'a2');
    const create = await commitChange(store, createBill(), frozen, next);
    await commitChange(
      store,
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 2 })),
      frozen,
      next,
    );
    const text = store.getRaw(BILL_PATH);

    expect((await dependentsOf(store, create.id)).map((op) => op.id)).toEqual(['a2']);
    await expect(undoOperation(store, create.id, 'prof-b', frozen, idList('m3'))).rejects.toThrow(
      /depend.*a2/,
    );
    expect(store.getRaw(BILL_PATH)).toBe(text);
  });

  it('undoes a cascade in the order of the rev chain and stays consistent', async () => {
    const store = new TestStore();
    const [create] = await chain(store);
    // The ids of the undo operations also sort against the order they are made in.
    const undoIds = idList('z-1', 'y-1', 'x-1');

    await undoOperation(store, create?.id ?? '', 'prof-b', frozen, undoIds, { cascade: true });

    expect(await store.readJson(BILL_PATH)).toEqual(
      bill('bill-1', { amount: 1, rev: 6, deleted: true }),
    );
    expect(await checkConsistency(store)).toEqual([]);
    const { operations } = await readJournal(store);
    const undos = operations.filter((op) => op.kind === 'undo');
    const byRev = (op: Operation) => (op.changes[0]?.after as { rev: number }).rev;
    expect(undos.sort((a, b) => byRev(a) - byRev(b)).map((op) => op.undoes)).toEqual([
      'a-3',
      'b-2',
      'c-1',
    ]);
  });

  it('keeps a cascade undo consistent when the undo operations sort against their order', async () => {
    const store = new TestStore();
    const clock = tickingClock();
    const a = await commitChange(store, createBill(), clock, () => 'm-a');
    await commitChange(
      store,
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 2 })),
      clock,
      () => 'm-b',
    );

    await undoOperation(store, a.id, 'prof-b', frozen, idList('z-undo-b', 'a-undo-a'), {
      cascade: true,
    });

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 4, deleted: true }));
    expect(await checkConsistency(store)).toEqual([]);
  });
});

describe('operations from machines whose clocks disagree', () => {
  // Two machines share the folder. The second one makes the later change on the record (rev 2),
  // but its clock is a minute behind: the rev chain, enforced by `writeRecord`, is the order.
  const first = () => '2026-11-10T10:00:00.000Z';
  const second = () => '2026-11-10T09:59:00.000Z';

  async function skewed(store: TestStore): Promise<[Operation, Operation]> {
    const create = await commitChange(store, createBill(), first, idList('op1'));
    const update = await commitChange(
      store,
      changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 2 })),
      second,
      idList('op2'),
    );
    return [create, update];
  }

  it('is consistent: the latest operation is the one with the highest rev, not the latest time', async () => {
    const store = new TestStore();
    await skewed(store);

    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 2, rev: 2 });
    expect(await checkConsistency(store)).toEqual([]);
    // The list of the journal is still by time, then by id.
    expect((await readJournal(store)).operations.map((op) => op.id)).toEqual(['op2', 'op1']);
  });

  it('reports a record left at the older rev, and repairs it to the higher rev', async () => {
    const store = new TestStore();
    await skewed(store);
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1')));

    expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);
    await repairDiverged(store, BILL_PATH);
    expect(await store.readJson(BILL_PATH)).toMatchObject({ amount: 2, rev: 2 });
  });

  it('finds the change with the earlier clock but the higher rev as a dependent', async () => {
    const store = new TestStore();
    const [create, update] = await skewed(store);
    const text = store.getRaw(BILL_PATH);

    expect((await dependentsOf(store, create.id)).map((op) => op.id)).toEqual(['op2']);
    expect(await dependentsOf(store, update.id)).toEqual([]);
    await expect(undoOperation(store, create.id, 'prof-b', first, idList('un-1'))).rejects.toThrow(
      /depend.*op2/,
    );
    expect(store.getRaw(BILL_PATH)).toBe(text);
  });

  it('undoes them in the order of the rev chain with a cascade', async () => {
    const store = new TestStore();
    const [create] = await skewed(store);

    await undoOperation(store, create.id, 'prof-b', first, idList('un-1', 'un-2'), {
      cascade: true,
    });

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 4, deleted: true }));
    expect(await checkConsistency(store)).toEqual([]);
  });
});

describe('checkConsistency', () => {
  it('is empty when there is no journal, and when every record is as its last operation says', async () => {
    const { store, commit } = setup();
    expect(await checkConsistency(store)).toEqual([]);
    await commit(createBill());
    await commit(changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })));
    await commit(createBill('bill-2'));
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('ignores the order of the keys in the record file', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const onDisk = (await store.readJson(BILL_PATH)) as Record<string, unknown>;
    store.putRaw(BILL_PATH, JSON.stringify(Object.fromEntries(Object.entries(onDisk).reverse())));
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('reports a record that was changed behind the journal, in order of path', async () => {
    const { store, commit } = setup();
    await commit(createBill('bill-2'));
    await commit(createBill('bill-1'));
    await commit(createBill('bill-3'));
    store.putRaw(BILL_2_PATH, JSON.stringify(bill('bill-2', { amount: 5 })));
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1', { extra: { list: [1, 2] } })));

    expect(await checkConsistency(store)).toEqual([
      { path: BILL_PATH, reason: 'diverged' },
      { path: BILL_2_PATH, reason: 'diverged' },
    ]);
  });

  it('compares nested values and arrays exactly', async () => {
    const { store, commit } = setup();
    await commit(createBill('bill-1', { tags: [1, { a: 1, b: [true, null] }], note: 'x' }));
    const same = { tags: [1, { b: [true, null], a: 1 }], note: 'x' };
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1', same)));
    expect(await checkConsistency(store)).toEqual([]);

    for (const other of [
      { tags: [1, { a: 1, b: [true, null] }, 3], note: 'x' },
      { tags: [{ a: 1, b: [true, null] }, 1], note: 'x' },
      { tags: [1, { a: 1, b: [true, 0] }], note: 'x' },
      { tags: [1, { a: 1, b: [true, null], c: 1 }], note: 'x' },
      { tags: [1, { a: 1, c: [true, null] }], note: 'x' },
      { tags: 'x', note: 'x' },
      { tags: [1, { a: 1, b: [true, null] }] },
    ]) {
      store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1', other)));
      expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);
    }
  });

  it('reports a record file that is missing, truncated, or not a record', async () => {
    const { store, commit } = setup();
    await commit(createBill('bill-1'));
    await commit(createBill('bill-2'));
    await commit(createBill('bill-3'));
    const sparse = await copyJournal(store);
    sparse.putRaw(BILL_2_PATH, '{"id": "bill-2", "v": 1, "re');
    sparse.putRaw(recordPath('bill', 'bill-3'), '[1, 2]');

    expect(await checkConsistency(sparse)).toEqual([
      { path: BILL_PATH, reason: 'diverged' },
      { path: BILL_2_PATH, reason: 'diverged' },
      { path: recordPath('bill', 'bill-3'), reason: 'diverged' },
    ]);
  });

  it('looks at the latest operation for each record only', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    await commit(changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })));
    // The record is as the first operation left it, not as the last one did.
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1')));
    expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);
  });

  it('does not hide a failure of the store as a diverged record', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    store.failReadsOf = BILL_PATH;
    await expect(checkConsistency(store)).rejects.toThrow('I/O error');
  });

  it('does not report the problems of the journal files: readJournal does', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    store.putRaw(`${JOURNAL_DIR}/truncated.json`, '{"id"');
    expect(await checkConsistency(store)).toEqual([]);
  });
});

describe('repairDiverged', () => {
  it('writes the record as the latest operation says, whatever is on disk', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    await commit(changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })));
    store.putRaw(BILL_PATH, '{"id": "bill-1", "v"');

    await repairDiverged(store, BILL_PATH);

    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 2, amount: 1 }));
    expect(await checkConsistency(store)).toEqual([]);
  });

  it('creates a record file that is missing', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    const copy = await copyJournal(store);

    await repairDiverged(copy, BILL_PATH);

    expect(await copy.readJson(BILL_PATH)).toEqual(bill('bill-1'));
  });

  it('refuses to put an older rev over a newer record, writing nothing', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    await commit(changeBill(await store.readJson(BILL_PATH), bill('bill-1', { amount: 1 })));
    store.putRaw(BILL_PATH, JSON.stringify(bill('bill-1', { rev: 5, amount: 7 })));
    expect(await checkConsistency(store)).toEqual([{ path: BILL_PATH, reason: 'diverged' }]);
    store.writes.length = 0;

    await expect(repairDiverged(store, BILL_PATH)).rejects.toThrow(/rev 5.*rev 2/);

    expect(store.writes).toEqual([]);
    expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1', { rev: 5, amount: 7 }));
  });

  it('repairs a record that has the same rev with other content, or no usable rev', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    for (const broken of [bill('bill-1', { amount: 7 }), { id: 'bill-1' }, { rev: 'x' }]) {
      store.putRaw(BILL_PATH, JSON.stringify(broken));
      await repairDiverged(store, BILL_PATH);
      expect(await store.readJson(BILL_PATH)).toEqual(bill('bill-1'));
    }
  });

  it('throws for a path that no operation touched, writing nothing', async () => {
    const { store, commit } = setup();
    await commit(createBill());
    store.writes.length = 0;
    await expect(repairDiverged(store, BILL_2_PATH)).rejects.toThrow(/No operation/);
    expect(store.writes).toEqual([]);
  });
});

describe('notes', () => {
  /** An operation that writes a note, as every other record is written. */
  function addNote(id: string, profileId: string, extra: Record<string, unknown> = {}): Input {
    return {
      profileId,
      kind: 'note.create',
      apartmentId: 'apt-1',
      summary: 'Aggiunta una nota',
      changes: [{ path: recordPath('note', id), after: note(id, { profileId, ...extra }) }],
    };
  }

  it('keeps two notes written together on the same bill by two profiles, one file each', async () => {
    const store = new TestStore();
    const clock = () => '2026-11-10T20:00:00.000Z';

    await Promise.all([
      commitChange(store, addNote('note-1', 'prof-a'), clock, () => 'op-a'),
      commitChange(store, addNote('note-2', 'prof-b', { text: 'Pagata' }), clock, () => 'op-b'),
    ]);

    expect(await store.list('_app/dati/note')).toEqual(['note-1.json', 'note-2.json']);
    expect(await journalNames(store)).toHaveLength(2);
    const notes = await notesFor(store, 'bill', 'bill-1');
    expect(notes.map((n) => [n.id, n.profileId, n.text])).toEqual([
      ['note-1', 'prof-a', 'Controllare il contatore'],
      ['note-2', 'prof-b', 'Pagata'],
    ]);
  });

  it('gives the notes of one item by time, then by id, and not those of others', async () => {
    const { store, commit } = setup();
    await commit(addNote('note-c', 'prof-a', { at: '2026-11-10T20:00:05.000Z' }));
    await commit(addNote('note-b', 'prof-a', { at: '2026-11-10T20:00:01.000Z' }));
    await commit(addNote('note-a', 'prof-a', { at: '2026-11-10T20:00:01.000Z' }));
    await commit(addNote('note-d', 'prof-a', { targetId: 'bill-2' }));
    await commit(addNote('note-e', 'prof-a', { targetType: 'payment' }));

    expect((await notesFor(store, 'bill', 'bill-1')).map((n) => n.id)).toEqual([
      'note-a',
      'note-b',
      'note-c',
    ]);
    expect((await notesFor(store, 'bill', 'bill-2')).map((n) => n.id)).toEqual(['note-d']);
    expect((await notesFor(store, 'payment', 'bill-1')).map((n) => n.id)).toEqual(['note-e']);
    expect(await notesFor(store, 'contract', 'bill-1')).toEqual([]);
  });

  it('marks the note deleted when the operation that created it is undone', async () => {
    const { store, commit, undo } = setup();
    const op = await commit(addNote('note-1', 'prof-a'));
    expect(await notesFor(store, 'bill', 'bill-1')).toHaveLength(1);

    await undo(op.id);

    expect(await store.readJson(recordPath('note', 'note-1'))).toMatchObject({
      id: 'note-1',
      deleted: true,
      rev: 2,
    });
    expect(await notesFor(store, 'bill', 'bill-1')).toEqual([]);
  });

  it('skips a note file that is broken instead of failing', async () => {
    const { store, commit } = setup();
    await commit(addNote('note-1', 'prof-a'));
    store.putRaw('_app/dati/note/broken.json', '{"id"');
    expect((await notesFor(store, 'bill', 'bill-1')).map((n) => n.id)).toEqual(['note-1']);
  });
});
