// Checks and files of a published version (docs/distribuzione.md, plan 16).
//
//   node scripts/release.mjs preflight <tag>
//     Before a tagged build: the tag is vX.Y.Z and equals the version of tauri.conf.json,
//     Cargo.toml, Cargo.lock, package.json and apps/desktop/package.json; the updater public key is not the
//     placeholder; tauri-plugin-updater is in Cargo.toml; the signing key secret is there
//     (HAS_SIGNING_KEY=true, set by build.yml from secrets). An installer without all of them
//     could never update itself, and user2 would need a manual reinstall. Prints every problem.
//
//   node scripts/release.mjs manifest <folder> <tag> <base url>
//     After the build, in the folder of the files to publish: checks that the Windows installer
//     and the macOS update archive are there with their .sig, that no file is over the size
//     limit, then writes latest.json (the updater manifest) and SHA256SUMS.
//
// Only Node built-ins: no npm dependencies.

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The value of plugins.updater.pubkey until user1 runs scripts/setup-updater.mjs. */
export const PUBKEY_PLACEHOLDER = 'SEGNAPOSTO-CHIAVE-PUBBLICA-vedi-docs-distribuzione.md';

/** Ruling R272: a sanity limit, far above the expected size and below GitHub's 2 GiB. */
export const MAX_FILE_BYTES = 400 * 1024 * 1024;

const TAURI_DIR = join('apps', 'desktop', 'src-tauri');
const TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The version in each of the five files that carry it, by file name. */
export function readVersions(root) {
  const cargo = readFileSync(join(root, TAURI_DIR, 'Cargo.toml'), 'utf8');
  const lock = readFileSync(join(root, TAURI_DIR, 'Cargo.lock'), 'utf8');
  return {
    // `cargo --locked` refuses a lock whose app version differs from Cargo.toml.
    'Cargo.lock': /^name = "app-bollette"\nversion = "([^"]*)"/m.exec(lock)?.[1],
    'tauri.conf.json': readJson(join(root, TAURI_DIR, 'tauri.conf.json')).version,
    // The first `version =` at the start of a line is the one of [package], the first section.
    'Cargo.toml': /^version\s*=\s*"([^"]*)"/m.exec(cargo)?.[1],
    'package.json': readJson(join(root, 'package.json')).version,
    'apps/desktop/package.json': readJson(join(root, 'apps', 'desktop', 'package.json')).version,
  };
}

/** Every reason why `tag` must not be built and published; empty when all is ready. */
export function preflightProblems(root, tag, hasSigningKey) {
  const match = TAG.exec(tag);
  if (match === null) {
    return [`L'etichetta «${tag}» non è nella forma vX.Y.Z (per una prova: Run workflow a mano).`];
  }
  const problems = [];
  for (const [file, version] of Object.entries(readVersions(root))) {
    if (version !== match[1]) {
      problems.push(`${file} ha la versione ${version}, l'etichetta ${match[1]}.`);
    }
  }
  const config = readJson(join(root, TAURI_DIR, 'tauri.conf.json'));
  const pubkey = config.plugins?.updater?.pubkey;
  if (typeof pubkey !== 'string' || pubkey === '' || pubkey === PUBKEY_PLACEHOLDER) {
    problems.push(
      'La chiave pubblica degli aggiornamenti in tauri.conf.json è ancora il segnaposto: vedi docs/distribuzione.md.',
    );
  }
  const cargo = readFileSync(join(root, TAURI_DIR, 'Cargo.toml'), 'utf8');
  if (!/^tauri-plugin-updater\s*=/m.test(cargo)) {
    problems.push("tauri-plugin-updater non è in Cargo.toml: l'app non saprebbe aggiornarsi.");
  }
  if (!hasSigningKey) {
    problems.push('Manca il secret TAURI_SIGNING_PRIVATE_KEY: vedi docs/distribuzione.md.');
  }
  return problems;
}

/**
 * Checks the files of `folder` and writes latest.json and SHA256SUMS there; returns the
 * manifest. Names as build.yml writes them: App-Bollette_<version>_x64-setup.exe and
 * App-Bollette_<version>_universal.app.tar.gz, each with its .sig.
 */
export function buildRelease(folder, tag, baseUrl, maxBytes = MAX_FILE_BYTES) {
  const match = TAG.exec(tag);
  if (match === null) throw new Error(`L'etichetta «${tag}» non è nella forma vX.Y.Z.`);
  const version = match[1];
  // Ruling R271: only these two; macOS Intel has no Python (open question 5).
  const updates = {
    'windows-x86_64': `App-Bollette_${version}_x64-setup.exe`,
    'darwin-aarch64': `App-Bollette_${version}_universal.app.tar.gz`,
  };
  const missing = Object.values(updates)
    .flatMap((name) => [name, `${name}.sig`])
    .filter((name) => !existsSync(join(folder, name)));
  if (missing.length > 0) throw new Error(`Nella release mancano: ${missing.join(', ')}.`);

  const names = readdirSync(folder)
    .filter((name) => name !== 'latest.json' && name !== 'SHA256SUMS')
    .sort();
  for (const name of names) {
    const size = statSync(join(folder, name)).size;
    if (size > maxBytes) throw new Error(`${name} è troppo grande: ${size} byte.`);
    console.log(`${name}: ${(size / 1024 / 1024).toFixed(1)} MB`);
  }

  const manifest = { version, notes: `App Bollette ${version}`, platforms: {} };
  for (const [platform, name] of Object.entries(updates)) {
    manifest.platforms[platform] = {
      signature: readFileSync(join(folder, `${name}.sig`), 'utf8'),
      url: `${baseUrl}/${encodeURIComponent(name)}`,
    };
  }
  writeFileSync(join(folder, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const sums = [...names, 'latest.json'].sort().map((name) => {
    const sha = createHash('sha256')
      .update(readFileSync(join(folder, name)))
      .digest('hex');
    return `${sha}  ${name}\n`;
  });
  writeFileSync(join(folder, 'SHA256SUMS'), sums.join(''));
  return manifest;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  const [command, ...args] = process.argv.slice(2);
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    if (command === 'preflight' && args.length === 1) {
      const problems = preflightProblems(root, args[0], process.env.HAS_SIGNING_KEY === 'true');
      for (const problem of problems) console.error(problem);
      if (problems.length > 0) process.exitCode = 1;
      else console.log(`Pronta per la pubblicazione: ${args[0]}.`);
    } else if (command === 'manifest' && args.length === 3) {
      buildRelease(args[0], args[1], args[2]);
    } else {
      console.error(
        'Uso: release.mjs preflight <etichetta> | manifest <cartella> <etichetta> <indirizzo>',
      );
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
