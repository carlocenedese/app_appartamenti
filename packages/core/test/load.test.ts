import { describe, expect, it } from 'vitest';
import { BillSchema, NoteSchema } from '../src/model';
import { MalformedJsonError, findWorkspace, loadAll } from '../src/index';
import type { Problem, Store } from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const DIR = '_app/dati/bill';

function billJson(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
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

function putBill(store: MemoryStore, name: string, bill: Record<string, unknown>): void {
  store.putRaw(`${DIR}/${name}`, JSON.stringify(bill));
}

const ids = (records: readonly { id: string }[]): string[] => records.map((record) => record.id);

describe('loadAll', () => {
  it('reads a folder with a good file, broken files and two conflict copies without throwing', async () => {
    const store = new MemoryStore();
    putBill(store, 'good.json', billJson('good'));
    store.putRaw(`${DIR}/truncated.json`, '{"id": "truncated", "v": 1, "rev": 1, "amou');
    putBill(store, 'future.json', billJson('future', { v: 2 }));
    putBill(store, 'x (conflicted copy 2026-11-05).json', billJson('x'));
    putBill(store, 'x (Copia in conflitto di Nicola 2026-11-05).json', billJson('x'));

    const { records, problems } = await loadAll(store, 'bill', BillSchema);

    expect(ids(records)).toEqual(['good']);
    expect(problems).toEqual([
      { path: `${DIR}/future.json`, reason: 'future-version' },
      { path: `${DIR}/truncated.json`, reason: 'malformed-json' },
      {
        path: `${DIR}/x (Copia in conflitto di Nicola 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${DIR}/x.json`,
      },
      {
        path: `${DIR}/x (conflicted copy 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${DIR}/x.json`,
      },
    ]);
  });

  it('returns the records parsed by the schema (branded amounts, unknown keys dropped)', async () => {
    const store = new MemoryStore();
    putBill(store, 'good.json', billJson('good', { addedByANewerApp: 'x' }));
    const { records } = await loadAll(store, 'bill', BillSchema);
    expect(records).toHaveLength(1);
    expect(records[0]?.amount).toBe(9846);
    expect(records[0]).not.toHaveProperty('addedByANewerApp');
  });

  it('gives nothing for a folder that does not exist or is empty', async () => {
    const store = new MemoryStore();
    expect(await loadAll(store, 'bill', BillSchema)).toEqual({ records: [], problems: [] });
    store.putRaw('_app/dati/apartment/a.json', '{}');
    expect(await loadAll(store, 'bill', BillSchema)).toEqual({ records: [], problems: [] });
  });

  describe('conflict copies', () => {
    it('reports them and does not load them, even when they hold a valid record', async () => {
      const store = new MemoryStore();
      putBill(store, 'x.json', billJson('x'));
      putBill(store, "x (Carlo's conflicted copy 2026-11-05).json", billJson('x-copy'));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['x']);
      expect(problems).toEqual([
        {
          path: `${DIR}/x (Carlo's conflicted copy 2026-11-05).json`,
          reason: 'conflicted-copy',
          originalPath: `${DIR}/x.json`,
        },
      ]);
    });

    it.each([
      ['x (conflicted copy 2026-11-05).json', 'x.json'],
      ['x (CONFLICTED COPY 2026-11-05).json', 'x.json'],
      ['x (Copia in conflitto di Nicola 2026-11-05).json', 'x.json'],
      ['x (copia in conflitto di Nicola 2026-11-05).json', 'x.json'],
      ['x (COPIA IN CONFLITTO DI NICOLA 2026-11-05).json', 'x.json'],
      ["x (Nicola's conflicted copy 2026-11-05).json", 'x.json'],
      ['x (conflicted copy 2026-11-05) (1).json', 'x.json'],
      ["x (A's conflicted copy 2026-11-05) (B's conflicted copy 2026-11-06).json", 'x.json'],
      ['x (Copia in conflitto di Nicola 2026-11-05) (2).json', 'x.json'],
      ['Perch\u00e9 (conflicted copy 2026-11-05).json', 'Perch\u00e9.json'],
      ['bill 2026 (1) (conflicted copy 2026-11-05).json', 'bill 2026 (1).json'],
    ])('recognises %s and gives %s as the original', async (name, original) => {
      const store = new MemoryStore();
      store.putRaw(`${DIR}/${name}`, '{}');
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual([
        { path: `${DIR}/${name}`, reason: 'conflicted-copy', originalPath: `${DIR}/${original}` },
      ]);
    });

    it.each(['x conflicted copy.json', '(conflicted copy 2026-11-05).json'])(
      'reports %s without an original path when it cannot be worked out',
      async (name) => {
        const store = new MemoryStore();
        store.putRaw(`${DIR}/${name}`, '{}');
        const { problems } = await loadAll(store, 'bill', BillSchema);
        expect(problems).toEqual([{ path: `${DIR}/${name}`, reason: 'conflicted-copy' }]);
        expect(problems[0]).not.toHaveProperty('originalPath');
      },
    );

    it('does not mistake a file that only looks like a conflict copy elsewhere in the folder name', async () => {
      const store = new MemoryStore();
      store.putRaw(`_app/dati/conflicted copy/a.json`, JSON.stringify(billJson('a')));
      const { records, problems } = await loadAll(store, 'conflicted copy', BillSchema);
      expect(ids(records)).toEqual(['a']);
      expect(problems).toEqual([]);
    });
  });

  describe('malformed, future and mismatching files', () => {
    it.each(['', '   ', '{', '{"id": "a"', 'not json', '{"id": "a"}}', "{'id': 'a'}", '\u0000'])(
      'reports the JSON text %j as malformed-json',
      async (text) => {
        const store = new MemoryStore();
        store.putRaw(`${DIR}/a.json`, text);
        const { records, problems } = await loadAll(store, 'bill', BillSchema);
        expect(records).toEqual([]);
        expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'malformed-json' }]);
      },
    );

    it.each([2, 3, 99, 1.5])('reports v %s as future-version', async (v) => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a', { v }));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'future-version' }]);
    });

    it('checks the version on the raw JSON, before the schema: a future record with another shape is future-version', async () => {
      const store = new MemoryStore();
      store.putRaw(`${DIR}/a.json`, '{"v": 2, "id": 7, "somethingNew": [1, 2]}');
      const { problems } = await loadAll(store, 'bill', BillSchema);
      expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'future-version' }]);
    });

    it.each([
      ['a field of the wrong type', billJson('a', { amount: '98,46' })],
      ['a missing field', { ...billJson('a'), supplier: undefined }],
      ['an empty id', billJson('')],
      ['rev 0', billJson('a', { rev: 0 })],
      ['v 0', billJson('a', { v: 0 })],
      ['v as text', billJson('a', { v: '2' })],
      ['v missing', { ...billJson('a'), v: undefined }],
      ['a period that ends before it starts', billJson('a', { periodEnd: '2025-11-30' })],
      ['a date that does not exist', billJson('a', { periodStart: '2026-02-30' })],
      ['deleted of the wrong type', billJson('a', { deleted: 'yes' })],
    ])('reports %s as schema-mismatch', async (_label, content) => {
      const store = new MemoryStore();
      putBill(store, 'a.json', content);
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'schema-mismatch' }]);
    });

    it.each(['[]', 'null', '42', '"text"', 'true', '[{"id": "a"}]'])(
      'reports the JSON value %s, which is not an object, as schema-mismatch',
      async (text) => {
        const store = new MemoryStore();
        store.putRaw(`${DIR}/a.json`, text);
        const { records, problems } = await loadAll(store, 'bill', BillSchema);
        expect(records).toEqual([]);
        expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'schema-mismatch' }]);
      },
    );

    it('keeps reading after a problem and reports every one, not only the first', async () => {
      const store = new MemoryStore();
      store.putRaw(`${DIR}/a.json`, '{');
      putBill(store, 'b.json', billJson('b'));
      putBill(store, 'c.json', billJson('c', { v: 2 }));
      putBill(store, 'd.json', billJson('d', { amount: 'x' }));
      putBill(store, 'e.json', billJson('e'));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['b', 'e']);
      expect(problems.map((problem) => problem.reason)).toEqual([
        'malformed-json',
        'future-version',
        'schema-mismatch',
      ]);
    });
  });

  describe('deleted records', () => {
    it('leaves out records marked deleted', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      putBill(store, 'b.json', billJson('b', { deleted: true }));
      putBill(store, 'c.json', billJson('c', { deleted: false }));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a', 'c']);
      expect(problems).toEqual([]);
    });

    it('includes them with includeDeleted', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      putBill(store, 'b.json', billJson('b', { deleted: true }));
      const { records } = await loadAll(store, 'bill', BillSchema, { includeDeleted: true });
      expect(ids(records)).toEqual(['a', 'b']);
      expect(records[1]?.deleted).toBe(true);
      const withFalse = await loadAll(store, 'bill', BillSchema, { includeDeleted: false });
      expect(ids(withFalse.records)).toEqual(['a']);
    });

    it('still reports a deleted record that is broken', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a', { deleted: true, amount: 'x' }));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual([{ path: `${DIR}/a.json`, reason: 'schema-mismatch' }]);
    });
  });

  describe('files that are not records', () => {
    it('ignores temporary files and every file that does not end in .json', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      store.putRaw(`${DIR}/.tmp-0190e5c6`, '{"id": "tmp", "v": 1, "re');
      store.putRaw(`${DIR}/a.json.bak`, '{');
      store.putRaw(`${DIR}/notes.txt`, 'hello');
      store.putRaw(`${DIR}/a.JSON`, '{');
      store.putRaw(`${DIR}/json`, '{');
      store.putRaw(`${DIR}/x (conflicted copy 2026-11-05).txt`, 'hello');
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a']);
      expect(problems).toEqual([]);
    });

    it('ignores a temporary file even when the store lists it and it ends in .json', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      const listing: Store = {
        readJson: (path) => store.readJson(path),
        writeJsonAtomic: (path, value) => store.writeJsonAtomic(path, value),
        readBytes: (path) => store.readBytes(path),
        list: () => Promise.resolve(['.tmp-1.json', 'a.json']),
      };
      const { records, problems } = await loadAll(listing, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a']);
      expect(problems).toEqual([]);
    });

    it('does not read what is in other folders', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      store.putRaw('_app/dati/bill/sub/b.json', JSON.stringify(billJson('b')));
      store.putRaw('_app/dati/payment/c.json', JSON.stringify(billJson('c')));
      const { records } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a']);
    });
  });

  describe('order', () => {
    it('sorts records by id and problems by path', async () => {
      const store = new MemoryStore();
      putBill(store, 'apple.json', billJson('apple'));
      putBill(store, 'cherry.json', billJson('cherry'));
      putBill(store, 'banana.json', billJson('banana'));
      store.putRaw(`${DIR}/z-broken.json`, '{');
      store.putRaw(`${DIR}/b-broken.json`, '{');
      putBill(store, 'm-future.json', billJson('m', { v: 2 }));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['apple', 'banana', 'cherry']);
      expect(problems.map((problem) => problem.path)).toEqual([
        `${DIR}/b-broken.json`,
        `${DIR}/m-future.json`,
        `${DIR}/z-broken.json`,
      ]);
    });

    it('does not depend on the order the store lists the files in', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('a'));
      putBill(store, 'b.json', billJson('b'));
      store.putRaw(`${DIR}/c.json`, '{');
      store.putRaw(`${DIR}/d.json`, '{');
      const reversed: Store = {
        readJson: (path) => store.readJson(path),
        writeJsonAtomic: (path, value) => store.writeJsonAtomic(path, value),
        readBytes: (path) => store.readBytes(path),
        list: async (dir) => (await store.list(dir)).reverse(),
      };
      const expected = await loadAll(store, 'bill', BillSchema);
      const actual = await loadAll(reversed, 'bill', BillSchema);
      expect(actual).toEqual(expected);
      expect(ids(actual.records)).toEqual(['a', 'b']);
    });

    it('compares ids by code unit, not by locale', async () => {
      const store = new MemoryStore();
      for (const id of ['b', 'B', '\u00e8', 'a', '10', '9'])
        putBill(store, `${id}.json`, billJson(id));
      const { records } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['10', '9', 'B', 'a', 'b', '\u00e8']);
    });
  });

  describe('file names and ids', () => {
    it('reports a file whose name is not its id as id-mismatch and does not load it', async () => {
      const store = new MemoryStore();
      putBill(store, 'good.json', billJson('good'));
      putBill(store, 'renamed.json', billJson('other'));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['good']);
      expect(problems).toEqual<Problem[]>([{ path: `${DIR}/renamed.json`, reason: 'id-mismatch' }]);
    });

    it('keeps the file named after the id and reports a hand copy as duplicate-id', async () => {
      const store = new MemoryStore();
      putBill(store, 'bill-1.json', billJson('bill-1', { supplier: 'Original' }));
      putBill(store, 'bill-1 - Copia.json', billJson('bill-1', { supplier: 'Copy' }));
      putBill(store, 'bill-1 copy.json', billJson('bill-1', { supplier: 'Copy 2' }));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records.map((record) => record.supplier)).toEqual(['Original']);
      expect(problems).toEqual<Problem[]>([
        { path: `${DIR}/bill-1 - Copia.json`, reason: 'duplicate-id' },
        { path: `${DIR}/bill-1 copy.json`, reason: 'duplicate-id' },
      ]);
    });

    it('loads none of the files that share an id when none is named after it', async () => {
      const store = new MemoryStore();
      putBill(store, 'a.json', billJson('same'));
      putBill(store, 'b.json', billJson('same'));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual<Problem[]>([
        { path: `${DIR}/a.json`, reason: 'duplicate-id' },
        { path: `${DIR}/b.json`, reason: 'duplicate-id' },
      ]);
    });

    it('counts deleted records for duplicates, so a copy cannot bring a deleted record back', async () => {
      const store = new MemoryStore();
      putBill(store, 'bill-1.json', billJson('bill-1', { deleted: true, rev: 2 }));
      putBill(store, 'bill-1 - Copia.json', billJson('bill-1'));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(records).toEqual([]);
      expect(problems).toEqual<Problem[]>([
        { path: `${DIR}/bill-1 - Copia.json`, reason: 'duplicate-id' },
      ]);
    });

    it('compares the name with the id in NFC', async () => {
      const store = new MemoryStore();
      store.putRaw(`${DIR}/Perche\u0301.json`, JSON.stringify(billJson('Perch\u00e9')));
      const { records, problems } = await loadAll(store, 'bill', BillSchema);
      expect(ids(records)).toEqual(['Perch\u00e9']);
      expect(problems).toEqual([]);
    });
  });

  describe('paths', () => {
    it('reports problem paths in NFC, with forward slashes', async () => {
      const store = new MemoryStore();
      store.putRaw(`${DIR}/Perche\u0301.json`, '{');
      const { problems } = await loadAll(store, 'bill', BillSchema);
      expect(problems).toEqual([{ path: `${DIR}/Perch\u00e9.json`, reason: 'malformed-json' }]);
    });

    it.each(['', '..', 'a/b', 'bill/..', '/bill', 'a\\b', 'nul', 'a:b'])(
      'refuses the unsafe kind %j',
      async (kind) => {
        await expect(loadAll(new MemoryStore(), kind, BillSchema)).rejects.toThrow(RangeError);
      },
    );

    it('reports a file name that cannot be a store path as schema-mismatch instead of reading it', async () => {
      const read: string[] = [];
      const odd: Store = {
        readJson: (path) => {
          read.push(path);
          return Promise.resolve(billJson('a'));
        },
        writeJsonAtomic: () => Promise.resolve(),
        readBytes: () => Promise.resolve(new Uint8Array()),
        list: () => Promise.resolve(['a.json', 'a:b.json', 'nul.json', 'q?.json']),
      };
      const { records, problems } = await loadAll(odd, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a']);
      expect(read).toEqual([`${DIR}/a.json`]);
      expect(problems).toEqual([
        { path: `${DIR}/a:b.json`, reason: 'schema-mismatch' },
        { path: `${DIR}/nul.json`, reason: 'schema-mismatch' },
        { path: `${DIR}/q?.json`, reason: 'schema-mismatch' },
      ]);
    });
  });

  describe('failures of the store itself', () => {
    it('skips a file that disappears between the listing and the read', async () => {
      const gone: Store = {
        readJson: (path) => Promise.resolve(path.endsWith('gone.json') ? undefined : billJson('a')),
        writeJsonAtomic: () => Promise.resolve(),
        readBytes: () => Promise.resolve(new Uint8Array()),
        list: () => Promise.resolve(['a.json', 'gone.json']),
      };
      const { records, problems } = await loadAll(gone, 'bill', BillSchema);
      expect(ids(records)).toEqual(['a']);
      expect(problems).toEqual([]);
    });

    it('lets an error other than malformed JSON through: the folder itself is unreadable', async () => {
      const denied = new Error('EACCES: permission denied');
      const broken: Store = {
        readJson: () => Promise.reject(denied),
        writeJsonAtomic: () => Promise.resolve(),
        readBytes: () => Promise.resolve(new Uint8Array()),
        list: () => Promise.resolve(['a.json']),
      };
      await expect(loadAll(broken, 'bill', BillSchema)).rejects.toBe(denied);

      const unlistable: Store = { ...broken, list: () => Promise.reject(denied) };
      await expect(loadAll(unlistable, 'bill', BillSchema)).rejects.toBe(denied);
    });

    it('treats a MalformedJsonError from any store as a malformed-json problem', async () => {
      const custom: Store = {
        readJson: (path) => Promise.reject(new MalformedJsonError(path)),
        writeJsonAtomic: () => Promise.resolve(),
        readBytes: () => Promise.resolve(new Uint8Array()),
        list: () => Promise.resolve(['a.json']),
      };
      const { problems } = await loadAll(custom, 'bill', BillSchema);
      expect(problems).toEqual<Problem[]>([{ path: `${DIR}/a.json`, reason: 'malformed-json' }]);
    });
  });

  it('works with the schema of any record kind', async () => {
    const store = new MemoryStore();
    store.putRaw(
      '_app/dati/note/n1.json',
      JSON.stringify({
        id: 'n1',
        v: 1,
        rev: 1,
        targetType: 'bill',
        targetId: 'bill-1',
        text: 'Verificata.',
        profileId: 'carlo',
        at: '2026-11-10T20:15:00.000Z',
      }),
    );
    const { records, problems } = await loadAll(store, 'note', NoteSchema);
    expect(problems).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]?.visibleToTenants).toBe(false);
  });
});

describe('findWorkspace', () => {
  const workspace = {
    workspaceId: 'ws-1',
    name: 'Appartamenti',
    schemaVersion: 1,
    minAppVersion: '0.1.0',
    createdAt: '2026-11-10T20:15:00.000Z',
  };

  it('gives undefined when the folder has no workspace file', async () => {
    expect(await findWorkspace(new MemoryStore())).toBeUndefined();
  });

  it('reads and parses _app/workspace.json', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic('_app/workspace.json', workspace);
    expect(await findWorkspace(store)).toEqual(workspace);
  });

  it('throws a clear error, naming the file and the field, when the file is not a valid workspace', async () => {
    const store = new MemoryStore();
    store.putRaw('_app/workspace.json', JSON.stringify({ ...workspace, schemaVersion: 0 }));
    const error: unknown = await findWorkspace(store).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('_app/workspace.json');
    expect((error as Error).message).toContain('schemaVersion');
    expect((error as Error).cause).toBeDefined();
  });

  it.each(['[]', 'null', '{}', '"ws"'])(
    'throws for the valid JSON %s that is not a workspace, instead of reporting no workspace',
    async (text) => {
      const store = new MemoryStore();
      store.putRaw('_app/workspace.json', text);
      await expect(findWorkspace(store)).rejects.toThrow(/_app\/workspace\.json/);
    },
  );

  it('lets MalformedJsonError through when the file is not JSON', async () => {
    const store = new MemoryStore();
    store.putRaw('_app/workspace.json', '{"workspaceId": "ws-1", "na');
    await expect(findWorkspace(store)).rejects.toBeInstanceOf(MalformedJsonError);
  });
});
