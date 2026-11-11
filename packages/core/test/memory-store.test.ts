import { describe, expect, it } from 'vitest';
import { MalformedJsonError } from '../src/store/store';
import { MemoryStore } from './helpers/memory-store';

// The helper stands in for FsStore in the core tests, so its behaviour is pinned here: if it
// drifted from what FsStore promises, the core tests would pass for the wrong reasons.

describe('MemoryStore', () => {
  it('reads back what writeJsonAtomic stored, as indented JSON with a trailing newline', async () => {
    const store = new MemoryStore();
    await store.writeJsonAtomic('_app/dati/bill/a.json', { id: 'a', amount: 100 });
    expect(await store.readJson('_app/dati/bill/a.json')).toEqual({ id: 'a', amount: 100 });
    expect(store.getRaw('_app/dati/bill/a.json')).toBe('{\n  "id": "a",\n  "amount": 100\n}\n');
  });

  it('gives undefined for a file that does not exist', async () => {
    const store = new MemoryStore();
    expect(await store.readJson('_app/dati/bill/none.json')).toBeUndefined();
    expect(store.getRaw('_app/dati/bill/none.json')).toBeUndefined();
  });

  it('throws MalformedJsonError, carrying the path, for text that is not JSON', async () => {
    const store = new MemoryStore();
    store.putRaw('_app/dati/bill/broken.json', '{"id": "a", "amou');
    const error: unknown = await store.readJson('_app/dati/bill/broken.json').catch((e) => e);
    expect(error).toBeInstanceOf(MalformedJsonError);
    expect(error).toMatchObject({ path: '_app/dati/bill/broken.json' });
  });

  it('refuses a value that JSON cannot represent', async () => {
    const store = new MemoryStore();
    await expect(store.writeJsonAtomic('a.json', undefined)).rejects.toThrow(TypeError);
    expect(store.getRaw('a.json')).toBeUndefined();
  });

  it('lists the files directly inside a folder: sorted, without folders and temporary files', async () => {
    const store = new MemoryStore();
    store.putRaw('dir/b.json', '1');
    store.putRaw('dir/a.json', '2');
    store.putRaw('dir/.tmp-1234', 'partial');
    store.putRaw('dir/sub/deep.json', '3');
    store.putRaw('other/c.json', '4');
    store.putRaw('dir2/d.json', '5');
    expect(await store.list('dir')).toEqual(['a.json', 'b.json']);
  });

  it('lists nothing for a folder that does not exist', async () => {
    const store = new MemoryStore();
    store.putRaw('dir/a.json', '1');
    expect(await store.list('missing')).toEqual([]);
  });

  it('treats NFC and NFD spellings of a path as the same file and lists NFC names', async () => {
    const store = new MemoryStore();
    const nfc = 'dir/Perch\u00e9.json';
    const nfd = 'dir/Perche\u0301.json';
    await store.writeJsonAtomic(nfc, { ok: true });
    expect(await store.readJson(nfd)).toEqual({ ok: true });
    store.putRaw(nfd, '{"ok": false}');
    expect(await store.list('dir')).toEqual(['Perch\u00e9.json']);
    expect(store.getRaw(nfc)).toBe('{"ok": false}');
  });

  it('reads bytes, as a copy, and rejects when the file does not exist', async () => {
    const store = new MemoryStore();
    store.putBytes('docs/a.pdf', new Uint8Array([1, 2, 3]));
    const bytes = await store.readBytes('docs/a.pdf');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    bytes[0] = 9;
    expect(await store.readBytes('docs/a.pdf')).toEqual(new Uint8Array([1, 2, 3]));
    await expect(store.readBytes('docs/none.pdf')).rejects.toThrow('No such file');
  });

  it.each(['../x.json', '/abs.json', 'a\\b.json', 'a:b.json', 'dir/nul.json'])(
    'rejects the unsafe path %s',
    async (path) => {
      const store = new MemoryStore();
      await expect(store.readJson(path)).rejects.toThrow(RangeError);
      await expect(store.writeJsonAtomic(path, {})).rejects.toThrow(RangeError);
      await expect(store.list(path)).rejects.toThrow(RangeError);
      await expect(store.readBytes(path)).rejects.toThrow(RangeError);
      expect(() => {
        store.putRaw(path, '{}');
      }).toThrow(RangeError);
    },
  );
});
