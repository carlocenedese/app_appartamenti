import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PUBKEY_PLACEHOLDER,
  buildRelease,
  preflightProblems,
  releaseEnvironmentProblems,
  readVersions,
  verifyUpdateSignature,
} from './release.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('release.mjs', import.meta.url));
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeRoot({
  version = '1.2.3',
  pubkey = 'dW50cnVzdGVkIGNvbW1lbnQ=',
  plugin = true,
  registered = true,
  requireSignedVersion = true,
  permissions = [
    'core:default',
    'updater:allow-check',
    'updater:allow-download-and-install',
    'process:allow-restart',
  ],
  locked = { updater: '2.14.0', process: '2.4.0' },
} = {}) {
  const tauri = join(dir, 'apps', 'desktop', 'src-tauri');
  mkdirSync(join(tauri, 'src'), { recursive: true });
  writeFileSync(
    join(tauri, 'tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey, requireSignedVersion } } }),
  );
  writeFileSync(
    join(tauri, 'Cargo.toml'),
    `[package]\nname = "x"\nversion = "${version}"\n\n[dependencies]\ntauri = { version = "=2.12.5" }\n` +
      (plugin ? 'tauri-plugin-updater = "=2.14.0"\ntauri-plugin-process = "=2.4.0"\n' : ''),
  );
  writeFileSync(
    join(tauri, 'Cargo.lock'),
    `[[package]]\nname = "app-bollette"\nversion = "${version}"\n\n[[package]]\nname = "tauri"\nversion = "2.12.5"\n` +
      Object.entries(locked)
        .map(([name, v]) => `\n[[package]]\nname = "tauri-plugin-${name}"\nversion = "${v}"\n`)
        .join(''),
  );
  writeFileSync(
    join(tauri, 'src', 'lib.rs'),
    registered
      ? '.plugin(tauri_plugin_updater::Builder::new().build())\n.plugin(tauri_plugin_process::init())\n'
      : '\n',
  );
  mkdirSync(join(tauri, 'capabilities'), { recursive: true });
  writeFileSync(join(tauri, 'capabilities', 'default.json'), JSON.stringify({ permissions }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(dir, 'apps', 'desktop', 'package.json'), JSON.stringify({ version }));
  return dir;
}

describe('readVersions', () => {
  it('reads the five versions of the repository, all equal today', () => {
    const versions = Object.values(readVersions(repoRoot));
    expect(versions).toHaveLength(5);
    expect(versions).not.toContain(undefined);
    expect(new Set(versions).size).toBe(1);
  });
});

describe('preflightProblems', () => {
  it('passes with matching versions, a real public key, signed versions and the plugin', () => {
    expect(preflightProblems(fakeRoot(), 'v1.2.3')).toEqual([]);
  });

  it('finds nothing missing in the repository except, until user1 writes it, the public key', () => {
    const tag = `v${readVersions(repoRoot)['tauri.conf.json']}`;
    const problems = preflightProblems(repoRoot, tag).filter((p) => !/segnaposto/.test(p));
    expect(problems).toEqual([]);
  });

  it('lists every problem at once', () => {
    const root = fakeRoot({
      pubkey: PUBKEY_PLACEHOLDER,
      plugin: false,
      requireSignedVersion: false,
    });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.2' }));
    const lock = join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.lock');
    writeFileSync(lock, readFileSync(lock, 'utf8').replace('"1.2.3"', '"1.2.1"'));
    const problems = preflightProblems(root, 'v1.2.3');
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/Cargo\.lock.*1\.2\.1/);
    expect(problems.join('\n')).toMatch(/package\.json.*1\.2\.2/);
    expect(problems.join('\n')).toMatch(/segnaposto/);
    expect(problems.join('\n')).toMatch(/requireSignedVersion/);
    expect(problems.join('\n')).toMatch(/tauri-plugin-updater/);
  });

  it('wants the plugin registered in lib.rs, not only in Cargo.toml', () => {
    expect(preflightProblems(fakeRoot({ registered: false }), 'v1.2.3')).toEqual([
      expect.stringMatching(/lib\.rs/),
    ]);
  });

  it('wants the permissions to check and install in the capabilities', () => {
    const problems = preflightProblems(
      fakeRoot({ permissions: ['core:default', { identifier: 'fs:allow-read-file' }] }),
      'v1.2.3',
    );
    expect(problems).toEqual([
      expect.stringMatching(
        /updater:allow-check, updater:allow-download-and-install, process:allow-restart/,
      ),
    ]);
    const restartOnly = fakeRoot({
      permissions: ['updater:allow-check', { identifier: 'updater:allow-download-and-install' }],
    });
    expect(preflightProblems(restartOnly, 'v1.2.3')).toEqual([
      expect.stringMatching(/^Mancano i permessi process:allow-restart /),
    ]);
  });

  it('wants both plugins in Cargo.lock at the version of Cargo.toml', () => {
    expect(preflightProblems(fakeRoot({ locked: { process: '2.4.0' } }), 'v1.2.3')).toEqual([
      expect.stringMatching(/^tauri-plugin-updater manca in Cargo\.lock/),
    ]);
    const old = fakeRoot({ locked: { updater: '2.13.3', process: '2.3.1' } });
    expect(preflightProblems(old, 'v1.2.3')).toEqual([
      expect.stringMatching(/^tauri-plugin-updater e tauri-plugin-process manca in Cargo\.lock/),
    ]);
  });

  it('handles a tauri.conf.json without plugins: no key, no signed versions', () => {
    const root = fakeRoot();
    const conf = join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
    writeFileSync(conf, JSON.stringify({ version: '1.2.3' }));
    expect(preflightProblems(root, 'v1.2.3')).toHaveLength(2);
  });

  it('rejects a tag that is not vX.Y.Z', () => {
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-prova', 'v01.2.3']) {
      expect(preflightProblems(fakeRoot(), tag)).toEqual([expect.stringMatching(/etichetta/)]);
    }
  });
});

// Minisign keys and signatures in the format `tauri signer` writes, with a key made by the test.
const keyId = Buffer.from('0123456789abcdef', 'hex');
function minisignKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const line = Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64');
  const file = `untrusted comment: minisign public key\n${line}\n`;
  return { privateKey, pubkey: Buffer.from(file).toString('base64') };
}
function minisignSign(bytes, privateKey, { id = keyId, comment = 'timestamp:1\tfile:x' } = {}) {
  const sig = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey);
  const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey);
  const file =
    'untrusted comment: signature from tauri secret key\n' +
    `${Buffer.concat([Buffer.from('ED'), id, sig]).toString('base64')}\n` +
    `trusted comment: ${comment}\n${global.toString('base64')}\n`;
  return Buffer.from(file).toString('base64');
}

describe('verifyUpdateSignature', () => {
  const keys = minisignKeys();
  const bytes = Buffer.from('installer');

  it('accepts a good signature', () => {
    const good = minisignSign(bytes, keys.privateKey);
    expect(() => verifyUpdateSignature(bytes, good, keys.pubkey)).not.toThrow();
  });

  it('refuses another file, another key, a broken comment and garbage', () => {
    const good = minisignSign(bytes, keys.privateKey);
    expect(() => verifyUpdateSignature(Buffer.from('altro'), good, keys.pubkey)).toThrow(
      /non corrisponde al file/,
    );
    expect(() => verifyUpdateSignature(bytes, good, minisignKeys().pubkey)).toThrow(
      /non corrisponde/,
    );
    const otherId = minisignSign(bytes, keys.privateKey, { id: Buffer.alloc(8) });
    expect(() => verifyUpdateSignature(bytes, otherId, keys.pubkey)).toThrow(/key id/);
    const text = Buffer.from(good, 'base64').toString('utf8').replace('file:x', 'file:y');
    const forged = Buffer.from(text).toString('base64');
    expect(() => verifyUpdateSignature(bytes, forged, keys.pubkey)).toThrow(/commento fidato/);
    expect(() => verifyUpdateSignature(bytes, 'xx', keys.pubkey)).toThrow(/formato/);
    expect(() => verifyUpdateSignature(bytes, good, PUBKEY_PLACEHOLDER)).toThrow(/formato/);
  });
});

const COMPLETE = [
  'App-Bollette_1.2.3_x64-setup.exe',
  'App-Bollette_1.2.3_x64-setup.exe.sig',
  'App-Bollette_1.2.3_universal.app.tar.gz',
  'App-Bollette_1.2.3_universal.app.tar.gz.sig',
  'App-Bollette_1.2.3_universal.dmg',
];
const BASE = 'https://github.com/proprietario/repository/releases/download/v1.2.3';
const KEYS = minisignKeys();

function writeArtifacts(names) {
  const out = join(dir, 'out');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const name of names) {
    const content = name.endsWith('.sig')
      ? minisignSign(Buffer.from(`contenuto di ${name.slice(0, -4)}`), KEYS.privateKey)
      : `contenuto di ${name}`;
    writeFileSync(join(out, name), content);
  }
  return out;
}

describe('buildRelease', () => {
  it('writes latest.json and SHA256SUMS for the two platforms', () => {
    const out = writeArtifacts(COMPLETE);
    const manifest = buildRelease(out, 'v1.2.3', BASE, KEYS.pubkey);
    expect(JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'))).toEqual(manifest);
    expect(manifest).toEqual({
      version: '1.2.3',
      notes: 'App Bollette 1.2.3',
      platforms: {
        'windows-x86_64': {
          signature: readFileSync(join(out, COMPLETE[1]), 'utf8'),
          url: `${BASE}/App-Bollette_1.2.3_x64-setup.exe`,
        },
        'darwin-aarch64': {
          signature: readFileSync(join(out, COMPLETE[3]), 'utf8'),
          url: `${BASE}/App-Bollette_1.2.3_universal.app.tar.gz`,
        },
      },
    });
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
    expect(sums).toHaveLength(COMPLETE.length + 1); // latest.json too
    const sha = createHash('sha256').update(`contenuto di ${COMPLETE[4]}`).digest('hex');
    expect(sums).toContain(`${sha}  ${COMPLETE[4]}`);
  });

  it('refuses a release without a platform or a signature, and writes nothing', () => {
    for (const missing of COMPLETE.slice(0, 4)) {
      const out = writeArtifacts(COMPLETE.filter((name) => name !== missing));
      expect(() => buildRelease(out, 'v1.2.3', BASE, KEYS.pubkey)).toThrow(/mancano/);
      expect(() => readFileSync(join(out, 'latest.json'))).toThrow();
    }
  });

  it('refuses an empty .sig, a signature of another key and a folder inside', () => {
    let out = writeArtifacts(COMPLETE);
    writeFileSync(join(out, COMPLETE[1]), '\n');
    expect(() => buildRelease(out, 'v1.2.3', BASE, KEYS.pubkey)).toThrow(/vuoto/);
    out = writeArtifacts(COMPLETE);
    expect(() => buildRelease(out, 'v1.2.3', BASE, minisignKeys().pubkey)).toThrow(
      /x64-setup\.exe: .*non corrisponde/,
    );
    out = writeArtifacts(COMPLETE);
    mkdirSync(join(out, 'sottocartella'));
    expect(() => buildRelease(out, 'v1.2.3', BASE, KEYS.pubkey)).toThrow(/non è un file/);
    expect(() => readFileSync(join(out, 'latest.json'))).toThrow();
  });

  it('refuses a file bigger than the limit', () => {
    const out = writeArtifacts(COMPLETE);
    expect(() => buildRelease(out, 'v1.2.3', BASE, KEYS.pubkey, 10)).toThrow(/troppo grande/);
  });

  it('refuses a malformed tag and an artifact whose version is not the tag', () => {
    const out = writeArtifacts(COMPLETE);
    expect(() => buildRelease(out, '1.2.3', BASE, KEYS.pubkey)).toThrow(/etichetta/);
    expect(() => buildRelease(out, 'v1.2.4', BASE, KEYS.pubkey)).toThrow(/mancano/);
  });
});

describe('command line', { timeout: 30_000 }, () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('exits with 2 on a wrong use', () => {
    expect(run().status).toBe(2);
    expect(run('preflight').status).toBe(2);
    expect(run('manifest', 'a', 'b').status).toBe(2);
  });

  it('exits with 1 and prints the problems when a version cannot be published', () => {
    const result = run('preflight', 'v0.0.0-prova');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/etichetta/);
    expect(run('manifest', join(dir, 'manca'), 'v1.2.3', BASE).status).toBe(1);
  });
});

// The answers of `gh api` for a release environment protected as docs/distribuzione.md asks.
const ENV_PATH = 'repos/o/r/environments/release';
const POLICIES_PATH = `${ENV_PATH}/deployment-branch-policies`;
function protectedRelease() {
  return {
    [ENV_PATH]: {
      name: 'release',
      protection_rules: [
        { type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 1 } }] },
        { type: 'branch_policy' },
      ],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      can_admins_bypass: false,
    },
    [POLICIES_PATH]: { total_count: 1, branch_policies: [{ name: 'v*', type: 'tag' }] },
  };
}
const fakeApi = (answers) => (path) => answers[path] ?? null;

describe('releaseEnvironmentProblems', () => {
  it('accepts an environment with a reviewer that admits only v* tags', () => {
    expect(releaseEnvironmentProblems('o/r', fakeApi(protectedRelease()))).toEqual([]);
  });

  it('refuses a missing or unreadable environment', () => {
    expect(releaseEnvironmentProblems('o/r', fakeApi({}))).toEqual([
      expect.stringMatching(/environment «release» non esiste o non si può leggere/),
    ]);
  });

  it('refuses an environment without a required reviewer', () => {
    for (const rules of [[], [{ type: 'required_reviewers', reviewers: [] }]]) {
      const answers = protectedRelease();
      answers[ENV_PATH].protection_rules = rules;
      expect(releaseEnvironmentProblems('o/r', fakeApi(answers))).toEqual([
        expect.stringMatching(/revisore/),
      ]);
    }
  });

  it('refuses an environment that administrators can bypass', () => {
    for (const bypass of [true, undefined]) {
      const answers = protectedRelease();
      answers[ENV_PATH].can_admins_bypass = bypass;
      expect(releaseEnvironmentProblems('o/r', fakeApi(answers))).toEqual([
        expect.stringMatching(/amministratori/),
      ]);
    }
  });

  it('refuses any deployment policy other than v* tags only', () => {
    const cases = [
      (a) => (a[ENV_PATH].deployment_branch_policy = null),
      (a) => (a[ENV_PATH].deployment_branch_policy.custom_branch_policies = false),
      (a) => (a[POLICIES_PATH] = null),
      (a) => (a[POLICIES_PATH] = { total_count: 0, branch_policies: [] }),
      (a) => a[POLICIES_PATH].branch_policies.push({ name: 'main', type: 'branch' }),
      (a) => (a[POLICIES_PATH].branch_policies = [{ name: 'v*' }]),
      (a) => (a[POLICIES_PATH].branch_policies = [{ name: '*', type: 'tag' }]),
      (a) => (a[POLICIES_PATH].total_count = 2),
    ];
    for (const change of cases) {
      const answers = protectedRelease();
      change(answers);
      expect(releaseEnvironmentProblems('o/r', fakeApi(answers))).toEqual([
        expect.stringMatching(/solo le etichette v\*/),
      ]);
    }
  });
});
