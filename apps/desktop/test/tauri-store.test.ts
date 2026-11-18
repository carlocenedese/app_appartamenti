import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillSchema,
  MalformedJsonError,
  StaleWriteError,
  createWorkspace,
  findWorkspace,
  loadAll,
  recordPath,
  writeRecord,
} from '@bollette/core';
import { open } from '@tauri-apps/plugin-dialog';
import { TauriStore, pickFolder } from '../src/tauri-store';
import { MemoryFs } from './helpers/memory-fs';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const NFC = 'Perch\u00e9.json';
const NFD = 'Perche\u0301.json';
const ROOT = '/Dropbox/Appartamenti';

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

let fs: MemoryFs;
let store: TauriStore;

beforeEach(() => {
  fs = new MemoryFs();
  fs.dirs.add('/Dropbox');
  fs.dirs.add(ROOT);
  store = new TauriStore(ROOT, fs);
  vi.mocked(open).mockReset();
});

describe('TauriStore: JSON files', () => {
  it('writes a Bill and reads it back', async () => {
    await store.writeJsonAtomic('_app/dati/bill/bill-1.json', bill);
    expect(await store.readJson('_app/dati/bill/bill-1.json')).toEqual(bill);
    const { records, problems } = await loadAll(store, 'bill', BillSchema);
    expect(problems).toEqual([]);
    expect(records).toEqual([bill]);
  });

  it('writes two-space indented JSON with a trailing newline and leaves no temporary file', async () => {
    await store.writeJsonAtomic('dati/a.json', {
      id: 'a',
      name: 'Perch\u00e9 \u20ac',
      list: [1, 2],
    });
    expect(await fs.readText(`${ROOT}/dati/a.json`)).toBe(
      '{\n  "id": "a",\n  "name": "Perch\u00e9 \u20ac",\n  "list": [\n    1,\n    2\n  ]\n}\n',
    );
    expect(fs.names(`${ROOT}/dati`)).toEqual(['a.json']);
  });

  it('creates the folders it needs, even below a root that does not exist yet', async () => {
    const fresh = new TauriStore(`${ROOT}/not/there`, fs);
    await fresh.writeJsonAtomic('_app/dati/bill/a.json', { id: 'a' });
    expect(await fresh.readJson('_app/dati/bill/a.json')).toEqual({ id: 'a' });
  });

  it('replaces the content of an existing file', async () => {
    await store.writeJsonAtomic('a.json', { id: 'a', rev: 1 });
    await store.writeJsonAtomic('a.json', { id: 'a', rev: 2 });
    expect(await store.readJson('a.json')).toEqual({ id: 'a', rev: 2 });
    expect(fs.names(ROOT)).toEqual(['a.json']);
  });

  it('reads JSON values of every shape', async () => {
    await store.writeJsonAtomic('null.json', null);
    await store.writeJsonAtomic('list.json', [1, 'a']);
    expect(await store.readJson('null.json')).toBeNull();
    expect(await store.readJson('list.json')).toEqual([1, 'a']);
  });

  it('gives undefined for a file, a folder or a parent that does not exist', async () => {
    await store.writeJsonAtomic('dati/a.json', { id: 'a' });
    fs.put(`${ROOT}/plain.txt`, 'text');
    expect(await store.readJson('dati/none.json')).toBeUndefined();
    expect(await store.readJson('none/a.json')).toBeUndefined();
    expect(await store.readJson('plain.txt/a.json')).toBeUndefined();
  });

  it('throws MalformedJsonError, with the path and the parse error, for a file that is not JSON', async () => {
    fs.put(`${ROOT}/dati/cut.json`, '{"id": "a", "amou');
    fs.put(`${ROOT}/dati/empty.json`, '');
    const error: unknown = await store.readJson('dati/cut.json').catch((e) => e);
    expect(error).toBeInstanceOf(MalformedJsonError);
    expect(error).toMatchObject({ path: 'dati/cut.json' });
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
    await expect(store.readJson('dati/empty.json')).rejects.toBeInstanceOf(MalformedJsonError);
  });

  it('reads a file that starts with a byte order mark, whoever decodes it', async () => {
    fs.put(`${ROOT}/bom.json`, '{"id": "a"}');
    vi.spyOn(fs, 'readText').mockResolvedValueOnce('\uFEFF{"id": "a"}');
    expect(await store.readJson('bom.json')).toEqual({ id: 'a' });
  });

  it('does not hide an error that is not about a missing file: a folder is not a JSON file', async () => {
    fs.dirs.add(`${ROOT}/dati`);
    const error: unknown = await store.readJson('dati').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MalformedJsonError);
  });

  it('refuses a value JSON cannot represent without creating anything', async () => {
    await expect(store.writeJsonAtomic('new/dir/a.json', undefined)).rejects.toThrow(TypeError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.writeJsonAtomic('new/dir/b.json', circular)).rejects.toThrow(TypeError);
    expect(fs.names(ROOT)).toEqual([]);
  });
});

describe('TauriStore: bytes', () => {
  it('reads the bytes of a file as they are', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
    fs.put(`${ROOT}/bollette/luce.pdf`, pdf);
    const bytes = await store.readBytes('bollette/luce.pdf');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(pdf));
  });

  it('rejects when the file does not exist', async () => {
    await expect(store.readBytes('bollette/none.pdf')).rejects.toThrow();
  });
});

describe('TauriStore: list', () => {
  it('gives the names of the files in a folder, sorted, without folders and temporary files', async () => {
    fs.put(`${ROOT}/dati/b.json`, '{}');
    fs.put(`${ROOT}/dati/a.json`, '{}');
    fs.put(`${ROOT}/dati/C.json`, '{}');
    fs.put(`${ROOT}/dati/note.txt`, 'x');
    fs.put(`${ROOT}/dati/.tmp-0190e5c6-1f2a`, '{"partial');
    fs.put(`${ROOT}/dati/sub/deep.json`, '{}');
    expect(await store.list('dati')).toEqual(['C.json', 'a.json', 'b.json', 'note.txt']);
  });

  it('gives [] for a folder that does not exist, or that is a file', async () => {
    fs.put(`${ROOT}/plain.txt`, 'text');
    expect(await store.list('missing')).toEqual([]);
    expect(await store.list('missing/deeper')).toEqual([]);
    expect(await store.list('plain.txt')).toEqual([]);
  });

  it('lets createWorkspace start in an empty folder (its refusal check lists the missing _app)', async () => {
    expect(await store.list('_app')).toEqual([]);
    let n = 0;
    const r = await createWorkspace(
      store,
      { workspaceId: 'ws-1', name: 'Gruppo', user: { id: 'u-1', name: 'Utente' } },
      [],
      () => '2026-11-13T10:00:00.000Z',
      () => `op-${String(n++)}`,
    );
    expect(r.user.id).toBe('u-1');
    expect(await store.list('_app')).toEqual(['workspace.json']);
  });

  it('gives NFC names whatever the file system stored', async () => {
    fs.put(`${ROOT}/dati/${NFD}`, '{}');
    expect(await store.list('dati')).toEqual([NFC]);
  });
});

describe('TauriStore: paths', () => {
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
    const calls = vi.spyOn(fs, 'exists');
    await expect(store.readJson(path)).rejects.toThrow(RangeError);
    await expect(store.writeJsonAtomic(path, { id: 'a' })).rejects.toThrow(RangeError);
    await expect(store.list(path)).rejects.toThrow(RangeError);
    await expect(store.readBytes(path)).rejects.toThrow(RangeError);
    expect(calls).not.toHaveBeenCalled();
    expect(fs.names('/Dropbox')).toEqual(['Appartamenti']);
    expect(fs.names(ROOT)).toEqual([]);
  });

  it('resolves an NFD request for a file written under its NFC name, and the other way round', async () => {
    await store.writeJsonAtomic(`dati/${NFC}`, { ok: true });
    expect(await store.readJson(`dati/${NFD}`)).toEqual({ ok: true });
    await store.writeJsonAtomic(`dati/${NFD}`, { ok: 'again' });
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ ok: 'again' });
    expect([...fs.files.keys()]).toEqual([`${ROOT}/dati/${NFC}`]);
  });

  it('finds a file that was created on disk with an NFD name when asked with the NFC name', async () => {
    fs.put(`${ROOT}/dati/${NFD}`, '{"ok": true}');
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ ok: true });
    expect(new TextDecoder().decode(await store.readBytes(`dati/${NFC}`))).toBe('{"ok": true}');
    expect(await store.list('dati')).toEqual([NFC]);
  });

  it('overwrites the file that is on disk under the other spelling instead of creating a twin', async () => {
    fs.put(`${ROOT}/dati/${NFD}`, '{"ok": "old"}');
    await store.writeJsonAtomic(`dati/${NFC}`, { ok: 'new' });
    expect([...fs.files.keys()]).toEqual([`${ROOT}/dati/${NFD}`]);
    expect(await store.readJson(`dati/${NFD}`)).toEqual({ ok: 'new' });
  });

  it('resolves a folder that is on disk with an NFD name', async () => {
    fs.put(`${ROOT}/Citta\u0300/a.json`, '{"id": "a"}');
    expect(await store.readJson('Citt\u00e0/a.json')).toEqual({ id: 'a' });
    expect(await store.list('Citt\u00e0')).toEqual(['a.json']);
    await store.writeJsonAtomic('Citt\u00e0/b.json', { id: 'b' });
    expect(fs.names(ROOT)).toEqual(['Citt\u00e0']);
    expect(await store.list('Citt\u00e0')).toEqual(['a.json', 'b.json']);
  });

  it('prefers the exact name when both spellings exist as separate files, and lists the name once', async () => {
    fs.put(`${ROOT}/dati/${NFD}`, '{"which": "nfd"}');
    fs.put(`${ROOT}/dati/${NFC}`, '{"which": "nfc"}');
    expect(await store.readJson(`dati/${NFC}`)).toEqual({ which: 'nfc' });
    expect(await store.list('dati')).toEqual([NFC]);
  });

  it('joins with backslashes below a Windows root, and ignores a trailing separator', async () => {
    const windows = new TauriStore('C:\\Users\\user2\\Dropbox\\Appartamenti\\', fs);
    const exists = vi.spyOn(fs, 'exists');
    await windows.readJson('_app/workspace.json');
    expect(exists).toHaveBeenCalledWith('C:\\Users\\user2\\Dropbox\\Appartamenti\\_app');
  });
});

describe('TauriStore: an interrupted write never leaves a partial .json file', () => {
  it('ignores the temporary file of a process that stopped before the rename', async () => {
    await store.writeJsonAtomic('_app/dati/bill/bill-1.json', bill);
    fs.put(
      `${ROOT}/_app/dati/bill/.tmp-0190e5c6-1f2a-7c3b-9d4e-5f6a7b8c9d0e`,
      '{"id": "bill-2", "v": 1, "rev": 1, "amount": 98',
    );
    expect(await store.list('_app/dati/bill')).toEqual(['bill-1.json']);
    expect(await store.readJson('_app/dati/bill/bill-2.json')).toBeUndefined();
    const { records, problems } = await loadAll(store, 'bill', BillSchema);
    expect(records).toEqual([bill]);
    expect(problems).toEqual([]);
  });

  it('writes the temporary file in the same folder as the target, under a .tmp- name, then renames it', async () => {
    const calls: { from: string; to: string; folder: string[] }[] = [];
    const real = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      // What is on disk at the moment of the rename: the complete temporary file, not the target.
      calls.push({ from, to, folder: fs.names(`${ROOT}/dati`) });
      await real(from, to);
    });

    await store.writeJsonAtomic('dati/a.json', { id: 'a' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe(`${ROOT}/dati/a.json`);
    expect(calls[0]?.from.startsWith(`${ROOT}/dati/.tmp-`)).toBe(true);
    expect(calls[0]?.folder).toEqual([expect.stringMatching(/^\.tmp-/)]);
    expect(fs.names(`${ROOT}/dati`)).toEqual(['a.json']);
  });

  it('leaves no .json file when the rename fails on a new file (the temporary file stays hidden)', async () => {
    const spy = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('operation not permitted'));
    await expect(store.writeJsonAtomic('dati/a.json', bill)).rejects.toMatchObject({
      name: 'FileAccessError',
      path: 'dati/a.json',
      cause: new Error('operation not permitted'),
    });
    expect(spy).toHaveBeenCalledTimes(6);
    spy.mockRestore();
    expect(await store.readJson('dati/a.json')).toBeUndefined();
    expect(await store.list('dati')).toEqual([]);
  });

  it('keeps the previous content intact when the rename over an existing file fails', async () => {
    await store.writeJsonAtomic('dati/a.json', { id: 'a', rev: 1 });
    const before = await fs.readText(`${ROOT}/dati/a.json`);
    const spy = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('disk full'));
    await expect(store.writeJsonAtomic('dati/a.json', { id: 'a', rev: 2 })).rejects.toMatchObject({
      cause: new Error('disk full'),
    });
    spy.mockRestore();
    expect(await fs.readText(`${ROOT}/dati/a.json`)).toBe(before);
    expect(await store.list('dati')).toEqual(['a.json']);
  });

  it('tries a refused rename again: a target held open on Windows (G8)', async () => {
    const real = fs.rename.bind(fs);
    const spy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('Access is denied. (os error 32)'))
      .mockImplementation(real);
    await store.writeJsonAtomic('dati/a.json', { id: 'a' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await store.readJson('dati/a.json')).toEqual({ id: 'a' });
    spy.mockRestore();
  });

  it('reports a file it cannot read with its relative path (G5)', async () => {
    fs.put(`${ROOT}/dati/a.json`, '{}');
    const spy = vi
      .spyOn(fs, 'readText')
      .mockRejectedValueOnce(new Error('The process cannot access the file (os error 32)'));
    await expect(store.readJson('dati/a.json')).rejects.toMatchObject({
      name: 'FileAccessError',
      code: 'EBUSY',
      path: 'dati/a.json',
    });
    spy.mockRestore();
  });

  it('writes again normally after a failure', async () => {
    const spy = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('boom'));
    await expect(store.writeJsonAtomic('a.json', { id: 'a' })).rejects.toMatchObject({
      cause: new Error('boom'),
    });
    spy.mockRestore();
    await store.writeJsonAtomic('a.json', { id: 'a' });
    expect(await store.readJson('a.json')).toEqual({ id: 'a' });
    expect(fs.names(ROOT).filter((name) => !name.startsWith('.tmp-'))).toEqual(['a.json']);
  });
});

describe('TauriStore with the engine', () => {
  const dir = '_app/dati/bill';
  const seed = (name: string, text: string): void => fs.put(`${ROOT}/${dir}/${name}`, text);

  it('loadAll reads a folder with a good file, broken files and conflict copies without throwing', async () => {
    seed('bill-1.json', JSON.stringify(bill));
    seed('truncated.json', '{"id": "truncated", "v": 1, "rev": 1, "amou');
    seed('future.json', JSON.stringify({ ...bill, id: 'future', v: 2 }));
    seed('x (conflicted copy 2026-11-05).json', JSON.stringify(bill));
    seed('.tmp-0190e5c6-1f2a', '{"partial');
    seed('notes.txt', 'hello');

    const { records, problems } = await loadAll(store, 'bill', BillSchema);

    expect(records).toEqual([bill]);
    expect(problems).toEqual([
      { path: `${dir}/future.json`, reason: 'future-version' },
      { path: `${dir}/truncated.json`, reason: 'malformed-json' },
      {
        path: `${dir}/x (conflicted copy 2026-11-05).json`,
        reason: 'conflicted-copy',
        originalPath: `${dir}/x.json`,
      },
    ]);
  });

  it('writeRecord creates, updates and refuses a stale write', async () => {
    const path = recordPath('bill', bill.id);
    expect(await writeRecord(store, path, bill, { expectedRev: null })).toBe(1);
    expect(await writeRecord(store, path, { ...bill, amount: 100 }, { expectedRev: 1 })).toBe(2);
    await expect(
      writeRecord(store, path, { ...bill, amount: 999 }, { expectedRev: 1 }),
    ).rejects.toBeInstanceOf(StaleWriteError);
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

describe('pickFolder', () => {
  it('opens the folder dialog, recursive so that the whole folder enters the file permissions', async () => {
    vi.mocked(open).mockResolvedValueOnce('/Users/user2/Dropbox/Appartamenti');
    expect(await pickFolder()).toBe('/Users/user2/Dropbox/Appartamenti');
    expect(open).toHaveBeenCalledWith({ directory: true, recursive: true, multiple: false });
  });

  it('gives null when the user cancels', async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    expect(await pickFolder()).toBeNull();
  });
});
