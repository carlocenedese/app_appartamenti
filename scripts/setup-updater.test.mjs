import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBKEY_PLACEHOLDER } from './release.mjs';
import { repositoryOf, setupUpdater } from './setup-updater.mjs';

const PRIVATE = 'cHJpdmF0YSBmaW50YQ==';
// The shape of a Tauri public key: base64 of a minisign public key file (42 bytes of key data).
const minisignPub = (byte) =>
  Buffer.from(
    `untrusted comment: minisign public key\n${Buffer.alloc(42, byte).toString('base64')}\n`,
  ).toString('base64');
const PUBLIC = minisignPub(1);
const ORIGIN = 'https://github.com/proprietario/repository.git';
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
  const logs = [];
  const options = {
    origin: ORIGIN,
    log: (line) => logs.push(line),
    run: (command, args, input) => {
      calls.push({ command, args, input });
      if (fail) throw new Error('gh: non autenticato');
    },
  };
  return { calls, logs, options };
}

describe('repositoryOf', () => {
  it('reads owner/name from https and ssh remotes', () => {
    expect(repositoryOf(ORIGIN)).toBe('proprietario/repository');
    expect(repositoryOf('https://github.com/proprietario/repository\n')).toBe(
      'proprietario/repository',
    );
    expect(repositoryOf('git@github.com:proprietario/repo.nome.git')).toBe(
      'proprietario/repo.nome',
    );
  });

  it('refuses a remote that is not GitHub', () => {
    expect(() => repositoryOf('https://example.com/a/b.git')).toThrow(/GitHub/);
  });
});

describe('setupUpdater', () => {
  it('shows the repository, sends the private key on stdin to the release environment, then writes the public key', () => {
    const gh = fakeGh();
    setupUpdater(root, keys, gh.options);
    expect(gh.logs.join('\n')).toContain('proprietario/repository');
    expect(gh.calls).toEqual([
      {
        command: 'gh',
        args: [
          'secret',
          'set',
          'TAURI_SIGNING_PRIVATE_KEY',
          '--env',
          'release',
          '--repo',
          'proprietario/repository',
        ],
        input: PRIVATE,
      },
    ]);
    const text = readFileSync(conf, 'utf8');
    expect(JSON.parse(text).plugins.updater.pubkey).toBe(PUBLIC);
    expect(text).not.toContain(PRIVATE);
    expect(gh.logs.join('\n')).not.toContain(PRIVATE);
  });

  it('can run again with the same key', () => {
    setupUpdater(root, keys, fakeGh().options);
    const gh = fakeGh();
    setupUpdater(root, keys, gh.options);
    expect(gh.calls).toHaveLength(1);
    expect(JSON.parse(readFileSync(conf, 'utf8')).plugins.updater.pubkey).toBe(PUBLIC);
  });

  it('leaves tauri.conf.json as it was when gh fails', () => {
    const before = readFileSync(conf, 'utf8');
    expect(() => setupUpdater(root, keys, fakeGh(true).options)).toThrow(/gh/);
    expect(readFileSync(conf, 'utf8')).toBe(before);
  });

  it('refuses a different public key already in tauri.conf.json, before calling gh', () => {
    writeFileSync(conf, `{ "plugins": { "updater": { "pubkey": "${minisignPub(2)}" } } }\n`);
    const gh = fakeGh();
    expect(() => setupUpdater(root, keys, gh.options)).toThrow(/altra chiave pubblica/);
    expect(gh.calls).toEqual([]);
  });

  it('refuses a folder without exactly one key pair, before calling gh', () => {
    const gh = fakeGh();
    rmSync(join(keys, 'app.key.pub'));
    expect(() => setupUpdater(root, keys, gh.options)).toThrow(/coppia/);
    writeFileSync(join(keys, 'app.key.pub'), PUBLIC);
    writeFileSync(join(keys, 'altra.key'), PRIVATE);
    writeFileSync(join(keys, 'altra.key.pub'), PUBLIC);
    expect(() => setupUpdater(root, keys, gh.options)).toThrow(/coppia/);
    expect(() => setupUpdater(root, join(dir, 'manca'), gh.options)).toThrow(/cartella/);
    expect(gh.calls).toEqual([]);
  });

  it('refuses an empty private key and a remote that is not GitHub, before calling gh', () => {
    const gh = fakeGh();
    writeFileSync(join(keys, 'app.key'), '\n');
    expect(() => setupUpdater(root, keys, gh.options)).toThrow(/vuoto/);
    writeFileSync(join(keys, 'app.key'), PRIVATE);
    const other = { ...gh.options, origin: 'https://example.com/a/b.git' };
    expect(() => setupUpdater(root, keys, other)).toThrow(/GitHub/);
    expect(gh.calls).toEqual([]);
  });

  it('refuses a public key that is not a Tauri key, and never prints the private key', () => {
    for (const bad of ['non è base64!', Buffer.from('testo qualsiasi').toString('base64')]) {
      writeFileSync(join(keys, 'app.key.pub'), bad);
      let message = '';
      try {
        setupUpdater(root, keys, fakeGh().options);
      } catch (error) {
        message = error.message;
      }
      expect(message).toMatch(/chiave pubblica/);
      expect(message).not.toContain(PRIVATE);
    }
  });
});
