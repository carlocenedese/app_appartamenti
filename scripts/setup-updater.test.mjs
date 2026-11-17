import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBKEY_PLACEHOLDER } from './release.mjs';
import { setupUpdater } from './setup-updater.mjs';

const PRIVATE = 'cHJpdmF0YSBmaW50YQ==';
const PUBLIC = 'cHViYmxpY2EgZmludGE=';
let dir;
let root;
let keys;
let conf;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'setup-updater-'));
  root = join(dir, 'repo');
  keys = join(dir, 'chiavi');
  mkdirSync(join(root, 'apps', 'desktop', 'src-tauri'), { recursive: true });
  mkdirSync(keys);
  conf = join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
  writeFileSync(conf, `{\n  "plugins": { "updater": { "pubkey": "${PUBKEY_PLACEHOLDER}" } }\n}\n`);
  writeFileSync(join(keys, 'app.key'), `${PRIVATE}\n`);
  writeFileSync(join(keys, 'app.key.pub'), `${PUBLIC}\n`);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeGh(fail = false) {
  const calls = [];
  const run = (command, args, input) => {
    calls.push({ command, args, input });
    if (fail) throw new Error('gh: non autenticato');
  };
  return { calls, run };
}

describe('setupUpdater', () => {
  it('sends the private key on stdin only, then writes the public key in place of the placeholder', () => {
    const gh = fakeGh();
    setupUpdater(root, keys, gh.run);
    expect(gh.calls).toEqual([
      { command: 'gh', args: ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY'], input: PRIVATE },
    ]);
    const text = readFileSync(conf, 'utf8');
    expect(JSON.parse(text).plugins.updater.pubkey).toBe(PUBLIC);
    expect(text).not.toContain(PRIVATE);
  });

  it('can run again with the same key', () => {
    setupUpdater(root, keys, fakeGh().run);
    const gh = fakeGh();
    setupUpdater(root, keys, gh.run);
    expect(gh.calls).toHaveLength(1);
    expect(JSON.parse(readFileSync(conf, 'utf8')).plugins.updater.pubkey).toBe(PUBLIC);
  });

  it('leaves tauri.conf.json as it was when gh fails', () => {
    const before = readFileSync(conf, 'utf8');
    expect(() => setupUpdater(root, keys, fakeGh(true).run)).toThrow(/gh/);
    expect(readFileSync(conf, 'utf8')).toBe(before);
  });

  it('refuses a different public key already in tauri.conf.json, before calling gh', () => {
    writeFileSync(conf, '{ "plugins": { "updater": { "pubkey": "YWx0cmE=" } } }\n');
    const gh = fakeGh();
    expect(() => setupUpdater(root, keys, gh.run)).toThrow(/altra chiave pubblica/);
    expect(gh.calls).toEqual([]);
  });

  it('refuses a folder without exactly one key pair, before calling gh', () => {
    const gh = fakeGh();
    rmSync(join(keys, 'app.key.pub'));
    expect(() => setupUpdater(root, keys, gh.run)).toThrow(/coppia/);
    writeFileSync(join(keys, 'app.key.pub'), PUBLIC);
    writeFileSync(join(keys, 'altra.key'), PRIVATE);
    writeFileSync(join(keys, 'altra.key.pub'), PUBLIC);
    expect(() => setupUpdater(root, keys, gh.run)).toThrow(/coppia/);
    expect(() => setupUpdater(root, join(dir, 'manca'), gh.run)).toThrow(/cartella/);
    expect(gh.calls).toEqual([]);
  });

  it('never puts the private key in an error message', () => {
    writeFileSync(join(keys, 'app.key.pub'), 'non è base64!');
    let message = '';
    try {
      setupUpdater(root, keys, fakeGh().run);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/chiave pubblica/);
    expect(message).not.toContain(PRIVATE);
  });
});
