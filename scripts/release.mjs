// Checks and files of a published version (docs/distribuzione.md, plan 16).
//
//   node scripts/release.mjs preflight <tag>
//     Before a tagged build: the tag is vX.Y.Z and equals the version of tauri.conf.json,
//     Cargo.toml, Cargo.lock, package.json and apps/desktop/package.json; the updater public key
//     is not the placeholder and requireSignedVersion is true; tauri-plugin-updater and
//     tauri-plugin-process are in Cargo.toml and registered in lib.rs, and capabilities/default.json
//     grants updater:allow-check, updater:allow-download-and-install and process:allow-restart;
//     both plugins are in Cargo.lock at the version of Cargo.toml. An installer without all of them could never update
//     itself, and user2 would need a manual reinstall. Prints every problem. (The signing key is
//     a secret of the `release` environment, invisible here: the sign job checks it.)
//
//   node scripts/release.mjs environment <owner/name>
//     Before the signing key is used or sent: the environment `release` exists, has at least one
//     required reviewer, no administrator bypass and admits only v* tags (read with `gh api`, GET only). GitHub would create
//     a missing environment by itself, without reviewers, the first time a job names it, so the
//     job guard of build.yml runs this outside that environment, and setup-updater.mjs before
//     sending the key. Anyone who can change the workflow can also drop this check: it catches a
//     missing or half-made setting, it does not replace the settings themselves.
//
//   node scripts/release.mjs manifest <folder> <tag> <base url>
//     After signing, in the folder of the files to publish: checks that the Windows installer
//     and the macOS update archive are there with a .sig that the public key of tauri.conf.json
//     verifies, that there are only files and none is over the size limit, then writes
//     latest.json (the updater manifest) and SHA256SUMS.
//
// Only Node built-ins: no npm dependencies.

import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
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
export function preflightProblems(root, tag) {
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
  const updater = config.plugins?.updater;
  const pubkey = updater?.pubkey;
  if (typeof pubkey !== 'string' || pubkey === '' || pubkey === PUBKEY_PLACEHOLDER) {
    problems.push(
      'La chiave pubblica degli aggiornamenti in tauri.conf.json è ancora il segnaposto: vedi docs/distribuzione.md.',
    );
  }
  if (updater?.requireSignedVersion !== true) {
    problems.push(
      'plugins.updater.requireSignedVersion non è true in tauri.conf.json: latest.json non è firmato, e solo così la firma lega anche la versione.',
    );
  }
  const cargo = readFileSync(join(root, TAURI_DIR, 'Cargo.toml'), 'utf8');
  const lib = readFileSync(join(root, TAURI_DIR, 'src', 'lib.rs'), 'utf8');
  const plugins = ['tauri-plugin-updater', 'tauri-plugin-process'].filter(
    (crate) =>
      !new RegExp(`^${crate}\\s*=`, 'm').test(cargo) || !lib.includes(crate.replaceAll('-', '_')),
  );
  if (plugins.length > 0) {
    problems.push(
      `${plugins.join(' e ')} non è in Cargo.toml o non è registrato in lib.rs: l'app non saprebbe aggiornarsi.`,
    );
  }
  // build.yml builds with --locked: a plugin missing from Cargo.lock, or at another version,
  // stops the build halfway (cargo-lock.yml prepares the lock, docs/distribuzione.md, point 3).
  const lock = readFileSync(join(root, TAURI_DIR, 'Cargo.lock'), 'utf8');
  const stale = ['tauri-plugin-updater', 'tauri-plugin-process'].filter((crate) => {
    const wanted = new RegExp(`^${crate}\\s*=\\s*"=?([^"]+)"`, 'm').exec(cargo)?.[1];
    const locked = new RegExp(`^name = "${crate}"\\nversion = "([^"]*)"`, 'm').exec(lock)?.[1];
    return wanted !== undefined && locked !== wanted;
  });
  if (stale.length > 0) {
    problems.push(
      `${stale.join(' e ')} manca in Cargo.lock o ha un'altra versione che in Cargo.toml: vedi docs/distribuzione.md, punto 3.`,
    );
  }
  const capabilities = join(root, TAURI_DIR, 'capabilities', 'default.json');
  const granted = existsSync(capabilities)
    ? (readJson(capabilities).permissions ?? []).map((p) =>
        typeof p === 'string' ? p : p.identifier,
      )
    : [];
  const missing = [
    'updater:allow-check',
    'updater:allow-download-and-install',
    'process:allow-restart',
  ].filter((p) => !granted.includes(p));
  if (missing.length > 0) {
    problems.push(
      `Mancano i permessi ${missing.join(', ')} in capabilities/default.json: l'app non potrebbe controllare o installare gli aggiornamenti.`,
    );
  }
  return problems;
}

/** `gh api <path>` parsed, or null when gh fails (missing, not readable, not logged in). */
export function ghApiGet(path) {
  const result = spawnSync('gh', ['api', '--method', 'GET', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Every reason why the environment `release` of `repository` does not protect the signing key;
 * empty when it has a required reviewer and admits only v* tags. `api(path)` is a GET of the
 * GitHub API, null on any failure: a failure is a refusal (fail closed).
 */
export function releaseEnvironmentProblems(repository, api = ghApiGet) {
  const path = `repos/${repository}/environments/release`;
  const environment = api(path);
  if (environment === null || typeof environment !== 'object') {
    return [
      `L'environment «release» non esiste o non si può leggere su ${repository}: va creato con un revisore e solo le etichette v* (docs/distribuzione.md, punto 1) prima di caricare la chiave o firmare.`,
    ];
  }
  const problems = [];
  const reviewers = (environment.protection_rules ?? []).some(
    (rule) =>
      rule?.type === 'required_reviewers' &&
      Array.isArray(rule.reviewers) &&
      rule.reviewers.length > 0,
  );
  if (!reviewers) {
    problems.push(
      "L'environment «release» non ha un revisore obbligatorio: chiunque spinga un'etichetta firmerebbe senza approvazione (docs/distribuzione.md, punto 1).",
    );
  }
  if (environment.can_admins_bypass !== false) {
    problems.push(
      "L'environment «release» lascia che gli amministratori saltino le regole: va tolto «Allow administrators to bypass configured protection rules» (docs/distribuzione.md, punto 1).",
    );
  }
  const custom = environment.deployment_branch_policy?.custom_branch_policies === true;
  const list = custom ? api(`${path}/deployment-branch-policies`) : null;
  const policies = Array.isArray(list?.branch_policies) ? list.branch_policies : [];
  const onlyTags =
    policies.length > 0 &&
    list.total_count === policies.length &&
    policies.every((policy) => policy?.type === 'tag' && policy.name === 'v*');
  if (!onlyTags) {
    problems.push(
      "L'environment «release» non ammette solo le etichette v*: va impostato «Selected branches and tags» con la sola regola di etichetta v* (docs/distribuzione.md, punto 1).",
    );
  }
  return problems;
}

/**
 * Throws unless `signature` (a Tauri .sig: base64 of a minisign signature file) is a valid
 * signature of `bytes` by `publicKey` (base64 of a minisign public key file, as in
 * tauri.conf.json). Both the file signature and the global one over the trusted comment.
 */
export function verifyUpdateSignature(bytes, signature, publicKey) {
  const lines = (text) => text.split(/\r?\n/).filter((line) => line !== '');
  const decode = (text) => Buffer.from(text, 'base64');
  const pub = decode(lines(decode(publicKey).toString('utf8'))[1] ?? '');
  const sig = lines(decode(signature).toString('utf8'));
  const head = decode(sig[1] ?? '');
  const comment = sig[2]?.startsWith('trusted comment: ') ? sig[2].slice(17) : undefined;
  const global = decode(sig[3] ?? '');
  if (pub.length !== 42 || head.length !== 74 || comment === undefined || global.length !== 64) {
    throw new Error('Firma o chiave pubblica non nel formato minisign.');
  }
  if (!head.subarray(2, 10).equals(pub.subarray(2, 10))) {
    throw new Error("La firma è di un'altra chiave (key id diverso).");
  }
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: pub.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  const algorithm = head.subarray(0, 2).toString('latin1');
  // "ED": the file is hashed first with BLAKE2b-512 (minisign prehashed); "Ed": the file itself.
  const message =
    algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : Buffer.from(bytes);
  if (!['ED', 'Ed'].includes(algorithm) || !verify(null, message, key, head.subarray(10))) {
    throw new Error('La firma non corrisponde al file.');
  }
  const trusted = Buffer.concat([head.subarray(10), Buffer.from(comment, 'utf8')]);
  if (!verify(null, trusted, key, global)) {
    throw new Error('La firma del commento fidato non corrisponde.');
  }
}

/**
 * Checks the files of `folder` and writes latest.json and SHA256SUMS there; returns the
 * manifest. Names as build.yml writes them: App-Bollette_<version>_x64-setup.exe and
 * App-Bollette_<version>_universal.app.tar.gz, each with its .sig.
 */
export function buildRelease(folder, tag, baseUrl, publicKey, maxBytes = MAX_FILE_BYTES) {
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
    const stat = statSync(join(folder, name));
    if (!stat.isFile()) throw new Error(`${name} non è un file: la release contiene solo file.`);
    const size = stat.size;
    if (size > maxBytes) throw new Error(`${name} è troppo grande: ${size} byte.`);
    console.log(`${name}: ${(size / 1024 / 1024).toFixed(1)} MB`);
  }

  const manifest = { version, notes: `App Bollette ${version}`, platforms: {} };
  for (const [platform, name] of Object.entries(updates)) {
    const signature = readFileSync(join(folder, `${name}.sig`), 'utf8').trim();
    if (signature === '') throw new Error(`${name}.sig è vuoto.`);
    try {
      verifyUpdateSignature(readFileSync(join(folder, name)), signature, publicKey);
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    }
    manifest.platforms[platform] = {
      signature,
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
      const problems = preflightProblems(root, args[0]);
      for (const problem of problems) console.error(problem);
      if (problems.length > 0) process.exitCode = 1;
      else console.log(`Pronta per la pubblicazione: ${args[0]}.`);
    } else if (command === 'environment' && args.length === 1) {
      const problems = releaseEnvironmentProblems(args[0]);
      for (const problem of problems) console.error(problem);
      if (problems.length > 0) process.exitCode = 1;
      else console.log("L'environment «release» è protetto.");
    } else if (command === 'manifest' && args.length === 3) {
      const conf = readJson(join(root, TAURI_DIR, 'tauri.conf.json'));
      buildRelease(args[0], args[1], args[2], conf.plugins?.updater?.pubkey ?? '');
    } else {
      console.error(
        'Uso: release.mjs preflight <etichetta> | environment <proprietario/nome> | manifest <cartella> <etichetta> <indirizzo>',
      );
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
