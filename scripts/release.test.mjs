import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBKEY_PLACEHOLDER, buildRelease, preflightProblems, readVersions } from './release.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeRoot({ version = '1.2.3', pubkey = 'dW50cnVzdGVkIGNvbW1lbnQ=', plugin = true } = {}) {
  const tauri = join(dir, 'apps', 'desktop', 'src-tauri');
  mkdirSync(tauri, { recursive: true });
  writeFileSync(
    join(tauri, 'tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey } } }),
  );
  writeFileSync(
    join(tauri, 'Cargo.toml'),
    `[package]\nname = "x"\nversion = "${version}"\n\n[dependencies]\ntauri = { version = "=2.12.5" }\n` +
      (plugin ? 'tauri-plugin-updater = "=2.10.0"\n' : ''),
  );
  writeFileSync(
    join(tauri, 'Cargo.lock'),
    `[[package]]\nname = "app-bollette"\nversion = "${version}"\n\n[[package]]\nname = "tauri"\nversion = "2.12.5"\n`,
  );
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
  it('passes with matching versions, a real public key, the plugin and the signing key', () => {
    expect(preflightProblems(fakeRoot(), 'v1.2.3', true)).toEqual([]);
  });

  it('lists every problem at once', () => {
    const root = fakeRoot({ pubkey: PUBKEY_PLACEHOLDER, plugin: false });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.2' }));
    const lock = join(root, 'apps', 'desktop', 'src-tauri', 'Cargo.lock');
    writeFileSync(lock, readFileSync(lock, 'utf8').replace('"1.2.3"', '"1.2.1"'));
    const problems = preflightProblems(root, 'v1.2.3', false);
    expect(problems).toHaveLength(5);
    expect(problems.join('\n')).toMatch(/Cargo\.lock.*1\.2\.1/);
    expect(problems.join('\n')).toMatch(/package\.json.*1\.2\.2/);
    expect(problems.join('\n')).toMatch(/segnaposto/);
    expect(problems.join('\n')).toMatch(/tauri-plugin-updater/);
    expect(problems.join('\n')).toMatch(/TAURI_SIGNING_PRIVATE_KEY/);
  });

  it('rejects a tag that is not vX.Y.Z', () => {
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-prova', 'v01.2.3']) {
      expect(preflightProblems(fakeRoot(), tag, true)).toEqual([
        expect.stringMatching(/etichetta/),
      ]);
    }
  });
});

function writeArtifacts(names) {
  const out = join(dir, 'out');
  mkdirSync(out);
  for (const name of names) writeFileSync(join(out, name), `contenuto di ${name}`);
  return out;
}

const COMPLETE = [
  'App-Bollette_1.2.3_x64-setup.exe',
  'App-Bollette_1.2.3_x64-setup.exe.sig',
  'App-Bollette_1.2.3_universal.app.tar.gz',
  'App-Bollette_1.2.3_universal.app.tar.gz.sig',
  'App-Bollette_1.2.3_universal.dmg',
];
const BASE = 'https://github.com/proprietario/repository/releases/download/v1.2.3';

describe('buildRelease', () => {
  it('writes latest.json and SHA256SUMS for the two platforms', () => {
    const out = writeArtifacts(COMPLETE);
    const manifest = buildRelease(out, 'v1.2.3', BASE);
    const written = JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'));
    expect(written).toEqual(manifest);
    expect(manifest).toEqual({
      version: '1.2.3',
      notes: 'App Bollette 1.2.3',
      platforms: {
        'windows-x86_64': {
          signature: 'contenuto di App-Bollette_1.2.3_x64-setup.exe.sig',
          url: `${BASE}/App-Bollette_1.2.3_x64-setup.exe`,
        },
        'darwin-aarch64': {
          signature: 'contenuto di App-Bollette_1.2.3_universal.app.tar.gz.sig',
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
    for (const missing of [COMPLETE[0], COMPLETE[1], COMPLETE[2], COMPLETE[3]]) {
      rmSync(join(dir, 'out'), { recursive: true, force: true });
      const out = writeArtifacts(COMPLETE.filter((name) => name !== missing));
      expect(() => buildRelease(out, 'v1.2.3', BASE)).toThrow(/manca|mancano/);
      expect(() => readFileSync(join(out, 'latest.json'))).toThrow();
    }
  });

  it('refuses a file bigger than the limit', () => {
    const out = writeArtifacts(COMPLETE);
    expect(() => buildRelease(out, 'v1.2.3', BASE, 10)).toThrow(/troppo grande/);
  });

  it('refuses an artifact whose version is not the tag', () => {
    const out = writeArtifacts(COMPLETE);
    expect(() => buildRelease(out, 'v1.2.4', BASE)).toThrow(/manca/);
  });
});
