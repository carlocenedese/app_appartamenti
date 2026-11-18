import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillSchema,
  CORE_VERSION,
  DATA_FORMAT,
  FileAccessError,
  MalformedJsonError,
  assessWorkspace,
  commitChange,
  damagedJournalFiles,
  StaleWriteError,
  findWorkspace,
  loadAll,
  recordPath,
  writeRecord,
} from '@bollette/core';
import { FsStore, moveFileNoOverwrite } from '../src/fs-store';

// Real folders in the system temp folder: these tests run on Linux, macOS and Windows in CI, so
// they also cover how each file system treats accented names and renames over an existing file.
// `rename` is wrapped so that a test can make it fail; everything else in node:fs/promises is real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    readFile: vi.fn(actual.readFile),
    link: vi.fn(actual.link),
    unlink: vi.fn(actual.unlink),
  };
});

const NFC = 'Perch\u00e9.json';
const NFD = 'Perche\u0301.json';

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

let root: string;
let store: FsStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bollette-store-fs-'));
  store = new FsStore(root);
});

afterEach(async () => {
  vi.mocked(rename).mockReset();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** The names in a real folder, NFC-normalised so that the check does not depend on the platform. */
async function namesIn(...segments: string[]): Promise<string[]> {
  return (await readdir(join(root, ...segments))).map((name) => name.normalize('NFC')).sort();
}

describe('FsStore: JSON files', () => {
  it('writes a Bill and reads it back', async () => {
    await store.writeJsonAtomic('_app/dati/bill/bill-1.json', bill);
    expect(await store.readJson('_app/dati/bill/bill-1.json')).toEqual(bill);
    const { records, problems } = await loadAll(store, 'bill', BillSchema);
    expect(problems).toEqual([]);
    expect(records).toEqual([bill]);
  });

  it('writes two-space indented JSON with a trailing newline, as UTF-8, and leaves no temporary file', async () => {
    await store.writeJsonAtomic('dati/a.json', {
      id: 'a',
      name: 'Perch\u00e9 \u20ac',
      list: [1, 2],
    });
    const text = await readFile(join(root, 'dati', 'a.json'), 'utf8');
    expect(text).toBe(
      '{\n  "id": "a",\n  "name": "Perch\u00e9 \u20ac",\n  "list": [\n    1,\n    2\n  ]\n}\n',
    );
    expect(await readdir(join(root, 'dati'))).toEqual(['a.json']);
  });

  it('creates the folders it needs, even below a root that does not exist yet', async () => {
    const fresh = new FsStore(join(root, 'not', 'there', 'yet'));
    await fresh.writeJsonAtomic('_app/dati/bill/a.json', { id: 'a' });
    expect(await fresh.readJson('_app/dati/bill/a.json')).toEqual({ id: 'a' });
  });

  it('replaces the content of an existing file', async () => {
    await store.writeJsonAtomic('a.json', { id: 'a', rev: 1 });
    await store.writeJsonAtomic('a.json', { id: 'a', rev: 2 });
    expect(await store.readJson('a.json')).toEqual({ id: 'a', rev: 2 });
    expect(await readdir(root)).toEqual(['a.json']);
  });

  it('reads JSON values of every shape', async () => {
    await store.writeJsonAtomic('null.json', null);
    await store.writeJsonAtomic('list.json', [1, 'a']);
    expect(await store.readJson('null.json')).toBeNull();
    expect(await store.readJson('list.json')).toEqual([1, 'a']);
  });

  it('gives undefined for a file, a folder or a parent that does not exist', async () => {
    await store.writeJsonAtomic('dati/a.json', { id: 'a' });
    await writeFile(join(root, 'plain.txt'), 'text');
    expect(await store.readJson('dati/none.json')).toBeUndefined();
    expect(await store.readJson('none/a.json')).toBeUndefined();
    expect(await store.readJson('plain.txt/a.json')).toBeUndefined();
  });

  it('throws MalformedJsonError, with the path and the parse error, for a file that is not JSON', async () => {
    await mkdir(join(root, 'dati'));
    await writeFile(join(root, 'dati', 'cut.json'), '{"id": "a", "amou');
    await writeFile(join(root, 'dati', 'empty.json'), '');
    const error: unknown = await store.readJson('dati/cut.json').catch((e) => e);
    expect(error).toBeInstanceOf(MalformedJsonError);
    expect(error).toMatchObject({ path: 'dati/cut.json' });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    await expect(store.readJson('dati/empty.json')).rejects.toBeInstanceOf(MalformedJsonError);
  });

  it('reads a file that starts with a byte order mark, as some Windows editors write it', async () => {
    await writeFile(join(root, 'bom.json'), '\uFEFF{"id": "a"}');
    expect(await store.readJson('bom.json')).toEqual({ id: 'a' });
  });

  it('does not hide an error that is not about a missing file: a folder is not a JSON file', async () => {
    await mkdir(join(root, 'dati'));
    const error: unknown = await store.readJson('dati').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MalformedJsonError);
  });

  it('refuses a value JSON cannot represent without creating anything', async () => {
    await expect(store.writeJsonAtomic('new/dir/a.json', undefined)).rejects.toThrow(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.writeJsonAtomic('new/dir/b.json', circular)).rejects.toThrow(TypeError);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('FsStore: bytes', () => {
  it('reads the bytes of a file as they are', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
    await mkdir(join(root, 'bollette'));
    await writeFile(join(root, 'bollette', 'luce.pdf'), pdf);
    const bytes = await store.readBytes('bollette/luce.pdf');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
  });

  it('rejects when the file does not exist', async () => {
    await expect(store.readBytes('bollette/none.pdf')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('FsStore: list', () => {
  it('gives the names of the files in a folder, sorted, without folders and temporary files', async () => {
    await mkdir(join(root, 'dati', 'sub'), { recursive: true });
    await writeFile(join(root, 'dati', 'b.json'), '{}');
    await writeFile(join(root, 'dati', 'a.json'), '{}');
    await writeFile(join(root, 'dati', 'C.json'), '{}');
    await writeFile(join(root, 'dati', 'note.txt'), 'x');
    await writeFile(join(root, 'dati', '.tmp-0190e5c6-1f2a'), '{"partial');
    await writeFile(join(root, 'dati', 'sub', 'deep.json'), '{}');
    expect(await store.list('dati')).toEqual(['C.json', 'a.json', 'b.json', 'note.txt']);
  });

  it('gives [] for a folder that does not exist, or that is a file', async () => {
    await writeFile(join(root, 'plain.txt'), 'text');
    expect(await store.list('missing')).toEqual([]);
    expect(await store.list('missing/deeper')).toEqual([]);
    expect(await store.list('plain.txt')).toEqual([]);
  });

  it('gives NFC names whatever the file system stored', async () => {
    await mkdir(join(root, 'dati'));
    await writeFile(join(root, 'dati', NFD), '{}');
    expect(await store.list('dati')).toEqual([NFC]);
  });
});

describe('FsStore: paths', () => {
  it.each([
    '../outside.json',
    'a/../../outside.json',
    '/etc/outside.json',
    'a\\b.json',
    'C:\\outside.json',
    'a:b.json',
    'dir/nul.json',
    'a?.json',
    'a/',
    '',
  ])('refuses the unsafe path %j for every operation, touching nothing', async (path) => {
    // The store root is inside the test folder, so a write that escaped it would show up there.
    const inner = new FsStore(join(root, 'inner'));
    await expect(inner.readJson(path)).rejects.toThrow(RangeError);
    await expect(inner.writeJsonAtomic(path, { id: 'a' })).rejects.toThrow(RangeError);
    await expect(inner.list(path)).rejects.toThrow(RangeError);
    await expect(inner.readBytes(path)).rejects.toThrow(RangeError);
    expect(await readdir(root)).toEqual([]);
  });

  it('resolves an NFD request for a file written under its NFC name, and the other way round', async () => {
    await store.writeJsonAtomic(`dati/${NFC}`, { ok: true });
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ ok: true });
    expect(await store.readJson(`dati/${NFD}`)).toEqual({ ok: true });
    expect(await store.list('dati')).toEqual([NFC]);

    await store.writeJsonAtomic(`dati/${NFD}`, { ok: 'again' });
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ ok: 'again' });
    expect(await namesIn('dati')).toEqual([NFC]);
  });

  it('finds a file that was created on disk with an NFD name when asked with the NFC name', async () => {
    await mkdir(join(root, 'dati'));
    await writeFile(join(root, 'dati', NFD), '{"ok": true}');
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ ok: true });
    expect(await store.readJson(`dati/${NFD}`)).toEqual({ ok: true });
    expect(new TextDecoder().decode(await store.readBytes(`dati/${NFC}`))).toBe('{"ok": true}');
    expect(await store.list('dati')).toEqual([NFC]);
  });

  it('overwrites the file that is on disk under the other spelling instead of creating a twin', async () => {
    await mkdir(join(root, 'dati'));
    await writeFile(join(root, 'dati', NFD), '{"ok": "old"}');
    await store.writeJsonAtomic(`dati/${NFC}`, { ok: 'new' });
    expect(await namesIn('dati')).toEqual([NFC]);
    expect(await store.readJson(`dati/${NFD}`)).toEqual({ ok: 'new' });
  });

  it('resolves a folder that is on disk with an NFD name', async () => {
    const folderNfc = 'Citt\u00e0';
    const folderNfd = 'Citta\u0300';
    await mkdir(join(root, folderNfd));
    await writeFile(join(root, folderNfd, 'a.json'), '{"id": "a"}');

    expect(await store.readJson(`${folderNfc}/a.json`)).toEqual({ id: 'a' });
    expect(await store.list(folderNfc)).toEqual(['a.json']);

    await store.writeJsonAtomic(`${folderNfc}/b.json`, { id: 'b' });
    expect(await namesIn()).toEqual([folderNfc]);
    expect(await store.list(folderNfc)).toEqual(['a.json', 'b.json']);
  });

  it('prefers the exact name when both spellings exist as separate files, and lists the name once', async () => {
    // Only a file system that tells the two spellings apart (Linux, Windows) keeps two files; on
    // macOS the second write replaces the first, and the assertions still hold.
    await mkdir(join(root, 'dati'));
    await writeFile(join(root, 'dati', NFD), '{"which": "nfd"}');
    await writeFile(join(root, 'dati', NFC), '{"which": "nfc"}');
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ which: 'nfc' });
    expect(await store.list('dati')).toEqual([NFC]);
  });
});

describe('FsStore: an interrupted write never leaves a partial .json file', () => {
  it('ignores the temporary file of a process that stopped before the rename', async () => {
    await store.writeJsonAtomic('_app/dati/bill/bill-1.json', bill);
    // What is left on disk if the process stops after writing the temporary file.
    const crashed = join(root, '_app', 'dati', 'bill', '.tmp-0190e5c6-1f2a-7c3b-9d4e-5f6a7b8c9d0e');
    await writeFile(crashed, '{"id": "bill-2", "v": 1, "rev": 1, "amount": 98');

    expect(await store.list('_app/dati/bill')).toEqual(['bill-1.json']);
    expect(await store.readJson('_app/dati/bill/bill-2.json')).toBeUndefined();
    const { records, problems } = await loadAll(store, 'bill', BillSchema);
    expect(records).toEqual([bill]);
    expect(problems).toEqual([]);
  });

  it('writes the temporary file in the same folder as the target, under a .tmp- name, then renames it', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const calls: { from: string; to: string; folder: string[] }[] = [];
    vi.mocked(rename).mockImplementation(async (from, to) => {
      // What is on disk at the moment of the rename: the complete temporary file, not the target.
      calls.push({
        from: String(from),
        to: String(to),
        folder: await actual.readdir(join(root, 'dati')),
      });
      await actual.rename(from, to);
    });

    await store.writeJsonAtomic('dati/a.json', { id: 'a' });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.to).toBe(join(root, 'dati', 'a.json'));
    expect(call?.from.startsWith(join(root, 'dati', '.tmp-'))).toBe(true);
    expect(call?.folder).toEqual([expect.stringMatching(/^\.tmp-/)]);
    expect(await readdir(join(root, 'dati'))).toEqual(['a.json']);
  });

  it('leaves no .json file and no temporary file when the rename fails on a new file', async () => {
    vi.mocked(rename).mockRejectedValue(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
    );
    await expect(store.writeJsonAtomic('dati/a.json', bill)).rejects.toMatchObject({
      name: 'FileAccessError',
      code: 'EPERM',
      path: 'dati/a.json',
    });
    vi.mocked(rename).mockReset();
    expect(await readdir(join(root, 'dati'))).toEqual([]);
    expect(await store.readJson('dati/a.json')).toBeUndefined();
    expect(await store.list('dati')).toEqual([]);
  });

  it('keeps the previous content intact when the rename over an existing file fails', async () => {
    await store.writeJsonAtomic('dati/a.json', { id: 'a', rev: 1 });
    const before = await readFile(join(root, 'dati', 'a.json'), 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));
    await expect(store.writeJsonAtomic('dati/a.json', { id: 'a', rev: 2 })).rejects.toThrow(
      'disk full',
    );
    expect(await readFile(join(root, 'dati', 'a.json'), 'utf8')).toBe(before);
    expect(await readdir(join(root, 'dati'))).toEqual(['a.json']);
  });

  it('writes again normally after a failure', async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error('boom'));
    await expect(store.writeJsonAtomic('a.json', { id: 'a' })).rejects.toThrow('boom');
    await store.writeJsonAtomic('a.json', { id: 'a' });
    expect(await store.readJson('a.json')).toEqual({ id: 'a' });
    expect(await readdir(root)).toEqual(['a.json']);
  });
});

describe('FsStore with the engine', () => {
  async function seed(name: string, text: string): Promise<void> {
    await mkdir(join(root, '_app', 'dati', 'bill'), { recursive: true });
    await writeFile(join(root, '_app', 'dati', 'bill', name), text);
  }

  it('loadAll reads a real folder with a good file, broken files and conflict copies without throwing', async () => {
    await seed('bill-1.json', JSON.stringify(bill));
    await seed('truncated.json', '{"id": "truncated", "v": 1, "rev": 1, "amou');
    await seed('future.json', JSON.stringify({ ...bill, id: 'future', v: 2 }));
    await seed('x (conflicted copy 2026-11-05).json', JSON.stringify(bill));
    await seed('x (Copia in conflitto di user2 2026-11-05).json', JSON.stringify(bill));
    await seed('.tmp-0190e5c6-1f2a', '{"partial');
    await seed('notes.txt', 'hello');

    const { records, problems } = await loadAll(store, 'bill', BillSchema);

    const dir = '_app/dati/bill';
    expect(records).toEqual([bill]);
    expect(problems).toEqual([
      { path: `${dir}/future.json`, reason: 'future-version' },
      { path: `${dir}/truncated.json`, reason: 'malformed-json' },
      {
        path: `${dir}/x (Copia in conflitto di user2 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${dir}/x.json`,
      },
      {
        path: `${dir}/x (conflicted copy 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${dir}/x.json`,
      },
    ]);
  });

  it('loadAll reports a hand copy of a record file as duplicate-id and loads the original', async () => {
    await seed('bill-1.json', JSON.stringify(bill));
    await seed('bill-1 - Copia.json', JSON.stringify({ ...bill, supplier: 'Copia' }));
    await seed('renamed.json', JSON.stringify({ ...bill, id: 'bill-9' }));

    const { records, problems } = await loadAll(store, 'bill', BillSchema);

    const dir = '_app/dati/bill';
    expect(records).toEqual([bill]);
    expect(problems).toEqual([
      { path: `${dir}/bill-1 - Copia.json`, reason: 'duplicate-id' },
      { path: `${dir}/renamed.json`, reason: 'id-mismatch' },
    ]);
  });

  it('loadAll leaves out deleted records unless asked', async () => {
    await seed('a.json', JSON.stringify({ ...bill, id: 'a' }));
    await seed('b.json', JSON.stringify({ ...bill, id: 'b', deleted: true }));
    const visible = await loadAll(store, 'bill', BillSchema);
    const all = await loadAll(store, 'bill', BillSchema, { includeDeleted: true });
    expect(visible.records.map((record) => record.id)).toEqual(['a']);
    expect(all.records.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('writeRecord creates, updates and refuses a stale write, on disk', async () => {
    const path = recordPath('bill', bill.id);
    expect(await writeRecord(store, path, bill, { expectedRev: null })).toBe(1);
    expect(await writeRecord(store, path, { ...bill, amount: 100 }, { expectedRev: 1 })).toBe(2);

    const before = await readFile(join(root, ...path.split('/')), 'utf8');
    await expect(
      writeRecord(store, path, { ...bill, amount: 999 }, { expectedRev: 1 }),
    ).rejects.toBeInstanceOf(StaleWriteError);
    await expect(writeRecord(store, path, bill, { expectedRev: null })).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect(await readFile(join(root, ...path.split('/')), 'utf8')).toBe(before);
    expect(await store.readJson(path)).toEqual({ ...bill, amount: 100, rev: 2 });
  });

  it('findWorkspace reads _app/workspace.json', async () => {
    expect(await findWorkspace(store)).toBeUndefined();
    const workspace = {
      workspaceId: 'ws-1',
      name: 'Appartamenti',
      schemaVersion: 1,
      minAppVersion: '0.1.0',
      createdAt: '2026-11-10T20:15:00.000Z',
    };
    await store.writeJsonAtomic('_app/workspace.json', workspace);
    expect(await findWorkspace(store)).toEqual(workspace);
  });
});

describe('moveFileNoOverwrite (plan 17, R315)', () => {
  it('moves into new folders, never over a file, and says when the source is missing', async () => {
    await mkdir(join(root, 'Casa', 'Da_smistare'), { recursive: true });
    await writeFile(join(root, 'Casa', 'Da_smistare', 'a.pdf'), 'uno');
    const to = 'Casa/Bollette/Gas/2026/a.pdf';
    expect(await moveFileNoOverwrite(root, 'Casa/Da_smistare/a.pdf', to)).toBe('moved');
    expect(await readFile(join(root, ...to.split('/')), 'utf8')).toBe('uno');
    expect(await moveFileNoOverwrite(root, 'Casa/Da_smistare/a.pdf', to)).toBe('missing');
    await writeFile(join(root, 'Casa', 'Da_smistare', 'a.pdf'), 'due');
    expect(await moveFileNoOverwrite(root, 'Casa/Da_smistare/a.pdf', to)).toBe('target-exists');
    expect(await readFile(join(root, ...to.split('/')), 'utf8')).toBe('uno');
    await expect(moveFileNoOverwrite(root, '../fuori.pdf', to)).rejects.toThrow(RangeError);
  });

  it('copies exclusively where hard links are not allowed', async () => {
    await writeFile(join(root, 'a.pdf'), 'uno');
    vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'EPERM' }));
    expect(await moveFileNoOverwrite(root, 'a.pdf', 'b/a.pdf')).toBe('moved');
    expect(await readFile(join(root, 'b', 'a.pdf'), 'utf8')).toBe('uno');
    expect(await namesIn()).toEqual(['b']);
  });
});

describe('moveFileNoOverwrite, the edges (plan 17, R315)', () => {
  it('finds names in the other Unicode spelling, refuses links and what is no file', async () => {
    await mkdir(join(root, 'Perche\u0301'), { recursive: true });
    await writeFile(join(root, 'Perche\u0301', 'a.pdf'), 'uno');
    expect(await moveFileNoOverwrite(root, 'Perch\u00e9/a.pdf', 'b/a.pdf')).toBe('moved');
    await mkdir(join(root, 'cartella'));
    expect(await moveFileNoOverwrite(root, 'cartella', 'c/x')).toBe('missing');
    await mkdir(join(root, 'vera'));
    await writeFile(join(root, 'vera', 'f.pdf'), 'x');
    try {
      await symlink(join(root, 'vera'), join(root, 'collegata'));
    } catch {
      return; // no symbolic links on this machine (Windows without rights)
    }
    expect(await moveFileNoOverwrite(root, 'collegata/f.pdf', 'd/f.pdf')).toBe('unsafe-path');
    expect(await moveFileNoOverwrite(root, 'vera/f.pdf', 'collegata/g.pdf')).toBe('unsafe-path');
  });

  it('puts the file back when the old name cannot be removed', async () => {
    await writeFile(join(root, 'a.pdf'), 'uno');
    vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'EBUSY' }));
    await expect(moveFileNoOverwrite(root, 'a.pdf', 'b/a.pdf')).rejects.toThrow('no');
    expect(await namesIn()).toEqual(['a.pdf', 'b']);
    expect(await namesIn('b')).toEqual([]);
  });
});

describe('a damaged operation file set aside (revisione 2026-11-18, G4)', () => {
  it('unblocks the folder only when it left no effect', async () => {
    await store.writeJsonAtomic('_app/workspace.json', {
      workspaceId: 'ws-1',
      name: 'Casa',
      schemaVersion: DATA_FORMAT,
      minAppVersion: CORE_VERSION,
      createdAt: '2026-11-18T09:00:00.000Z',
    });
    await commitChange(
      store,
      {
        profileId: 'u1',
        kind: 'k',
        summary: 's',
        changes: [{ path: recordPath('bill', 'bill-1'), after: bill }],
      },
      () => '2026-11-18T09:00:00.000Z',
      () => 'op-1',
    );
    await mkdir(join(root, '_app/journal'), { recursive: true });
    await writeFile(join(root, '_app/journal/20261118T090100000Z-u9-zzz.json'), '');
    const app = { version: CORE_VERSION, schemaVersion: DATA_FORMAT };
    expect((await assessWorkspace(store, app)).reasons.map(({ code }) => code)).toEqual([
      'damaged-journal',
    ]);
    const [file] = await damagedJournalFiles(store);
    expect(file?.safeToSetAside).toBe(true);
    expect(await moveFileNoOverwrite(root, file?.path ?? '', file?.setAsideTo ?? '')).toBe('moved');
    expect(await assessWorkspace(store, app)).toMatchObject({ writable: true, reasons: [] });
  });
});

describe('files held open or without permission (revisione 2026-11-18, G5, G8)', () => {
  const busy = () => Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });

  it('tries a refused rename again, and the write goes through', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename)
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockImplementation(actual.rename);
    await store.writeJsonAtomic('dati/a.json', { id: 'a' });
    expect(await store.readJson('dati/a.json')).toEqual({ id: 'a' });
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(3);
  });

  it('gives up with a FileAccessError on the relative path, leaving no temporary file', async () => {
    vi.mocked(rename).mockRejectedValue(busy());
    const failure = store.writeJsonAtomic('dati/a.json', { id: 'a' });
    await expect(failure).rejects.toBeInstanceOf(FileAccessError);
    await expect(failure).rejects.toMatchObject({ code: 'EBUSY', path: 'dati/a.json' });
    vi.mocked(rename).mockReset();
    expect(await readdir(join(root, 'dati'))).toEqual([]);
  });

  it('does not try again a rename that failed for another reason', async () => {
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENOSPC' }));
    await expect(store.writeJsonAtomic('dati/a.json', { id: 'a' })).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(vi.mocked(rename)).toHaveBeenCalledTimes(1);
  });

  it('reports a file it cannot read as unreadable, and the folder still opens (T5b)', async () => {
    await store.writeJsonAtomic('_app/dati/bill/bill-1.json', bill);
    await store.writeJsonAtomic('_app/dati/bill/bill-2.json', { ...bill, id: 'bill-2' });
    const denied = Object.assign(new Error(`EACCES: ${root}`), { code: 'EACCES' });
    vi.mocked(readFile).mockImplementation(async (file, options) => {
      if (String(file).endsWith('bill-2.json')) throw denied;
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return actual.readFile(file, options as 'utf8');
    });
    try {
      await expect(store.readJson('_app/dati/bill/bill-2.json')).rejects.toMatchObject({
        name: 'FileAccessError',
        path: '_app/dati/bill/bill-2.json',
      });
      const { records, problems } = await loadAll(store, 'bill', BillSchema, {}, []);
      expect(records.map(({ id }) => id)).toEqual(['bill-1']);
      expect(problems).toEqual([{ path: '_app/dati/bill/bill-2.json', reason: 'unreadable' }]);
      const app = { version: CORE_VERSION, schemaVersion: DATA_FORMAT };
      expect((await assessWorkspace(store, app)).reasons).toContainEqual({
        code: 'unreadable-files',
        paths: ['_app/dati/bill/bill-2.json'],
      });
    } finally {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      vi.mocked(readFile).mockImplementation(actual.readFile);
    }
  });
});
