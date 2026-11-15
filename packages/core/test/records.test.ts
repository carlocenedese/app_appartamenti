import { describe, expect, it } from 'vitest';
import { BillSchema } from '../src/model';
import {
  MalformedJsonError,
  StaleWriteError,
  assertSafeRelPath,
  loadAll,
  recordPath,
  writeRecord,
} from '../src/index';
import { MemoryStore } from './helpers/memory-store';

const BILL_PATH = '_app/dati/bill/bill-1.json';

const bill = {
  id: 'bill-1',
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
};

/** The text of a file, for checking that a refused write left it byte for byte as it was. */
function textOf(store: MemoryStore, path: string): string | undefined {
  return store.getRaw(path);
}

describe('assertSafeRelPath', () => {
  it.each([
    'workspace.json',
    '_app/dati/bill/bill-1.json',
    '_app/dati/bill/x (conflicted copy 2026-11-05).json',
    '_app/dati/bill/x (Copia in conflitto di user2 2026-11-05).json',
    'Perch\u00e9.json',
    'Perche\u0301.json',
    'bollette/2026-02 luce \u2013 acqua.pdf',
    'a.b.c/d.e',
    '.tmp-1234',
    'con-tratto.json',
    'console.json',
    'nulla.json',
    'com10.json',
  ])('accepts %s', (path) => {
    expect(() => {
      assertSafeRelPath(path);
    }).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['/', 'absolute'],
    ['C:/Users/x.json', 'colon'],
    ['C:\\Users\\x.json', 'backslash'],
    ['\\\\server\\share\\x.json', 'backslash'],
    ['a\\b.json', 'backslash'],
    ['..', 'parent segment'],
    ['../x.json', 'parent segment'],
    ['a/../b.json', 'parent segment'],
    ['a/..', 'parent segment'],
    ['./x.json', 'current-folder segment'],
    ['a/./b.json', 'current-folder segment'],
    ['a//b.json', 'empty segment'],
    ['a/', 'empty segment'],
    ['a:b.json', 'colon'],
    ['a<b.json', 'forbidden character'],
    ['a>b.json', 'forbidden character'],
    ['a"b.json', 'forbidden character'],
    ['a|b.json', 'forbidden character'],
    ['a?b.json', 'forbidden character'],
    ['a*b.json', 'forbidden character'],
    ['a\u0000b.json', 'control character'],
    ['a\u001fb.json', 'control character'],
    ['a\nb.json', 'control character'],
    ['a\tb.json', 'control character'],
    ['CON', 'reserved name'],
    ['con.json', 'reserved name'],
    ['dir/NUL', 'reserved name'],
    ['dir/nul.json', 'reserved name'],
    ['PRN.txt', 'reserved name'],
    ['aux.tar.gz', 'reserved name'],
    ['COM1', 'reserved name'],
    ['com9.json', 'reserved name'],
    ['lpt1.json', 'reserved name'],
    ['LPT9.json', 'reserved name'],
    ['com\u00b9.json', 'reserved name'],
    ['CONIN$', 'reserved name'],
    ['conout$.json', 'reserved name'],
    ['nul .json', 'reserved name'],
    ['dir/trailing dot.', 'trailing dot or space'],
    ['dir/trailing space ', 'trailing dot or space'],
    ['dir /x.json', 'trailing dot or space'],
  ])('rejects %j (%s)', (path) => {
    expect(() => {
      assertSafeRelPath(path);
    }).toThrow(RangeError);
  });

  it('names the problem and the path in the message', () => {
    expect(() => {
      assertSafeRelPath('a/../b.json');
    }).toThrow(/"a\/\.\.\/b\.json".*"\.\."/);
    expect(() => {
      assertSafeRelPath('a\nb.json');
    }).toThrow('"a\\nb.json"');
  });
});

describe('recordPath', () => {
  it('builds the path of a record file in the data folder of its kind', () => {
    expect(recordPath('bill', 'bill-1')).toBe('_app/dati/bill/bill-1.json');
    expect(recordPath('apartment', '0190e5c6-1f2a-7c3b-9d4e-5f6a7b8c9d0e')).toBe(
      '_app/dati/apartment/0190e5c6-1f2a-7c3b-9d4e-5f6a7b8c9d0e.json',
    );
  });

  it.each(['', '..', '../x', 'a/b', 'a\\b', 'x:y', 'con', 'NUL', 'name.', 'a\nb'])(
    'rejects the unsafe id %j',
    (id) => {
      expect(() => recordPath('bill', id)).toThrow(RangeError);
    },
  );

  it.each(['', '..', 'a/b', 'bill/../apartment', '/bill'])('rejects the unsafe kind %j', (kind) => {
    expect(() => recordPath(kind, 'bill-1')).toThrow(RangeError);
  });
});

describe('writeRecord', () => {
  it('creates a file that must not exist yet (expectedRev null) with rev 1', async () => {
    const store = new MemoryStore();
    const newRev = await writeRecord(store, BILL_PATH, { ...bill, rev: 0 }, { expectedRev: null });
    expect(newRev).toBe(1);
    expect(await store.readJson(BILL_PATH)).toEqual({ ...bill, rev: 1 });
  });

  it('increments the rev on disk and returns it', async () => {
    const store = new MemoryStore();
    await writeRecord(store, BILL_PATH, bill, { expectedRev: null });
    const second = await writeRecord(
      store,
      BILL_PATH,
      { ...bill, amount: 10000 },
      { expectedRev: 1 },
    );
    const third = await writeRecord(
      store,
      BILL_PATH,
      { ...bill, amount: 10100 },
      { expectedRev: 2 },
    );
    expect([second, third]).toEqual([2, 3]);
    expect(await store.readJson(BILL_PATH)).toEqual({ ...bill, amount: 10100, rev: 3 });
  });

  it('writes whatever fields the record has, so a caller that merges keeps unknown ones', async () => {
    const store = new MemoryStore();
    await writeRecord(
      store,
      BILL_PATH,
      { ...bill, fromNewerApp: { keep: true } },
      { expectedRev: null },
    );
    expect(await store.readJson(BILL_PATH)).toMatchObject({ fromNewerApp: { keep: true } });
  });

  it('refuses a stale write with StaleWriteError and leaves the file untouched', async () => {
    const store = new MemoryStore();
    await writeRecord(store, BILL_PATH, bill, { expectedRev: null });
    await writeRecord(store, BILL_PATH, { ...bill, amount: 20000 }, { expectedRev: 1 });
    const before = textOf(store, BILL_PATH);

    const error: unknown = await writeRecord(
      store,
      BILL_PATH,
      { ...bill, amount: 30000 },
      { expectedRev: 1 },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'StaleWriteError',
      path: BILL_PATH,
      expected: 1,
      actual: 2,
    });
    expect((error as Error).message).toContain(BILL_PATH);
    expect(textOf(store, BILL_PATH)).toBe(before);
  });

  it('refuses expectedRev null when the file already exists', async () => {
    const store = new MemoryStore();
    await writeRecord(store, BILL_PATH, bill, { expectedRev: null });
    const before = textOf(store, BILL_PATH);

    const error: unknown = await writeRecord(store, BILL_PATH, bill, { expectedRev: null }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error).toMatchObject({ path: BILL_PATH, expected: null, actual: 1 });
    expect((error as Error).message).toMatch(/new file/);
    expect(textOf(store, BILL_PATH)).toBe(before);
  });

  it('refuses an expected rev when the file does not exist', async () => {
    const store = new MemoryStore();
    const error: unknown = await writeRecord(store, BILL_PATH, bill, { expectedRev: 3 }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error).toMatchObject({ path: BILL_PATH, expected: 3, actual: null });
    expect((error as Error).message).toMatch(/no file/);
    expect(textOf(store, BILL_PATH)).toBeUndefined();
  });

  it('does not overwrite a file it cannot read the rev of', async () => {
    const store = new MemoryStore();
    store.putRaw(BILL_PATH, '{"id": "bill-1", "v": 1, "rev": 1, "amou');
    await expect(writeRecord(store, BILL_PATH, bill, { expectedRev: 1 })).rejects.toBeInstanceOf(
      MalformedJsonError,
    );
    expect(textOf(store, BILL_PATH)).toBe('{"id": "bill-1", "v": 1, "rev": 1, "amou');

    for (const content of [
      '[]',
      'null',
      '42',
      '{"id": "bill-1"}',
      '{"rev": "2"}',
      '{"rev": 1.5}',
    ]) {
      store.putRaw(BILL_PATH, content);
      await expect(writeRecord(store, BILL_PATH, bill, { expectedRev: 1 })).rejects.toThrow(
        /no integer "rev"/,
      );
      expect(textOf(store, BILL_PATH)).toBe(content);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the expected rev %s',
    async (expectedRev) => {
      const store = new MemoryStore();
      await expect(writeRecord(store, BILL_PATH, bill, { expectedRev })).rejects.toThrow(
        RangeError,
      );
      expect(textOf(store, BILL_PATH)).toBeUndefined();
    },
  );

  it.each(['../bill-1.json', '/bill-1.json', '_app\\dati\\bill-1.json', '_app/dati/con.json'])(
    'rejects the unsafe path %s without writing',
    async (path) => {
      const store = new MemoryStore();
      await expect(writeRecord(store, path, bill, { expectedRev: null })).rejects.toThrow(
        RangeError,
      );
      expect(await store.list('_app/dati')).toEqual([]);
    },
  );

  it('writes a record that loadAll reads back as the same Bill', async () => {
    const store = new MemoryStore();
    await writeRecord(store, recordPath('bill', bill.id), bill, { expectedRev: null });
    const { records, problems } = await loadAll(store, 'bill', BillSchema);
    expect(problems).toEqual([]);
    expect(records).toEqual([{ ...bill, rev: 1 }]);
  });
});
