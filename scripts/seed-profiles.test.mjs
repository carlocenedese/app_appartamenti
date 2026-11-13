import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_PROFILES_DIR, bundleSeedProfiles, checkSeedProfiles } from './seed-profiles.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seed-profiles-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fill(count) {
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `p${i}.json`), '{"id":"x"}');
}

describe('checkSeedProfiles', () => {
  it('returns the sorted names of the JSON files', () => {
    fill(11);
    writeFileSync(join(dir, 'note.txt'), 'non un profilo');
    const names = checkSeedProfiles(dir, 10);
    expect(names).toHaveLength(11);
    expect(names).toEqual([...names].sort());
  });

  it('throws when the folder is missing', () => {
    expect(() => checkSeedProfiles(join(dir, 'manca'), 10)).toThrow(
      'Mancano i profili iniziali dei fornitori: cartella non trovata.',
    );
  });

  it('throws when there are too few files', () => {
    fill(3);
    expect(() => checkSeedProfiles(dir, 10)).toThrow(
      'Mancano i profili iniziali dei fornitori: trovati 3 file, ne servono almeno 10.',
    );
  });

  it('names a file that is not JSON, never its content', () => {
    fill(2);
    writeFileSync(join(dir, 'rotto.json'), 'SEGRETO {');
    let message = '';
    try {
      checkSeedProfiles(dir, 1);
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe('Un profilo iniziale non è un JSON valido: rotto.json.');
    expect(message).not.toContain('SEGRETO');
  });

  it('accepts the real python/seed-profiles folder', () => {
    expect(
      checkSeedProfiles(join(root, 'python', 'seed-profiles'), 11).length,
    ).toBeGreaterThanOrEqual(11);
  });
});

describe('bundleSeedProfiles', () => {
  it('copies the folder next to the interpreter resources, replacing what was there', () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'python', 'seed-profiles'), { recursive: true });
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(repo, 'python', 'seed-profiles', `p${i}.json`), '{}');
    }
    const target = join(repo, SEED_PROFILES_DIR);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'vecchio.json'), '{}');
    bundleSeedProfiles(repo);
    expect(checkSeedProfiles(target, 10)).toHaveLength(10);
  });
});

describe('tauri.conf.json', () => {
  it('bundles the seed profiles', () => {
    const conf = JSON.parse(
      readFileSync(join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
    );
    expect(conf.bundle.resources['resources/seed-profiles/']).toBe('seed-profiles/');
  });
});
