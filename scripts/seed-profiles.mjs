// The supplier profiles that ship with the app: python/seed-profiles/*.json, copied into
// apps/desktop/src-tauri/resources/seed-profiles/ (bundled by tauri.conf.json, next to python/).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Destination, relative to the root of the repository. */
export const SEED_PROFILES_DIR = join('apps', 'desktop', 'src-tauri', 'resources', 'seed-profiles');

/**
 * The sorted names of the .json files in `dir`. Throws an Error (in Italian, never with file
 * content) when the folder is missing, has fewer than `expectedMin` files, or a file is not JSON.
 */
export function checkSeedProfiles(dir, expectedMin) {
  if (!existsSync(dir)) {
    throw new Error('Mancano i profili iniziali dei fornitori: cartella non trovata.');
  }
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (names.length < expectedMin) {
    throw new Error(
      `Mancano i profili iniziali dei fornitori: trovati ${names.length} file, ne servono almeno ${expectedMin}.`,
    );
  }
  for (const name of names) {
    try {
      JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      throw new Error(`Un profilo iniziale non è un JSON valido: ${name}.`);
    }
  }
  return names;
}

/** Checks python/seed-profiles/ (at least 10 files) and copies it into the app resources. */
export function bundleSeedProfiles(root) {
  const source = join(root, 'python', 'seed-profiles');
  checkSeedProfiles(source, 10);
  const target = join(root, SEED_PROFILES_DIR);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
