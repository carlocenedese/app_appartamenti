// The one command user1 runs on their own computer, once, from the root of the repository:
//
//   node scripts/setup-updater.mjs "<folder of the update signing key>"
//
// The folder holds the key pair made with `tauri signer generate` (R31): one `<name>.key`
// (private) and `<name>.key.pub` (public). The script
//   0. stops, before reading the key, unless the environment `release` exists, has a required
//      reviewer and admits only v* tags (`release.mjs environment`, read with `gh api` GET);
//   1. sends the private key to `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release --repo
//      <owner/name of git remote origin, printed first>` on stdin: never as an argument, never
//      printed, never written anywhere else. A secret of the `release` environment reaches only
//      the job that signs, after user1 approves it (docs/distribuzione.md, step 1);
//   2. writes the public key in tauri.conf.json in place of the placeholder (it is not a secret
//      and is committed).
// It never makes a key. Needs the GitHub CLI logged in (`gh auth login`) with admin rights on the
// repository and the `release` environment already made and protected. See docs/distribuzione.md. Only Node built-ins.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBKEY_PLACEHOLDER, ghApiGet, releaseEnvironmentProblems } from './release.mjs';

const BASE64 = /^[A-Za-z0-9+/]+=*$/;

/** owner/name of a GitHub remote address (https or ssh); throws for anything else. */
export function repositoryOf(url) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (match === null) throw new Error('Il remote origin non è un repository di GitHub.');
  return match[1];
}

function originOf(root) {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Nessun remote origin: serve una copia del repository.');
  return result.stdout;
}

function runGh(command, args, input) {
  const result = spawnSync(command, args, { input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error !== undefined) throw new Error(`gh non si avvia: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh è uscito con il codice ${result.status}.`);
}

/**
 * Sets the signing secret and writes the public key. `run(command, args, stdin)` runs gh,
 * `api(path)` is a GET of the GitHub API (null on failure), `origin` is the address of git remote
 * origin, `log` prints.
 */
export function setupUpdater(
  root,
  folder,
  { run = runGh, api = ghApiGet, origin = originOf(root), log = console.log } = {},
) {
  const repository = repositoryOf(origin);
  const unprotected = releaseEnvironmentProblems(repository, api);
  if (unprotected.length > 0) throw new Error(unprotected.join('\n'));
  if (!existsSync(folder)) throw new Error(`La cartella ${folder} non esiste.`);
  const keys = readdirSync(folder).filter((name) => name.endsWith('.key'));
  if (keys.length !== 1 || !existsSync(join(folder, `${keys[0]}.pub`))) {
    throw new Error(
      'Nella cartella serve una sola coppia <nome>.key e <nome>.key.pub (vedi docs/distribuzione.md).',
    );
  }
  const privateKey = readFileSync(join(folder, keys[0]), 'utf8').trim();
  const publicKey = readFileSync(join(folder, `${keys[0]}.pub`), 'utf8').trim();
  const decoded = BASE64.test(publicKey) ? Buffer.from(publicKey, 'base64').toString('utf8') : '';
  if (!/^untrusted comment: .*\n[A-Za-z0-9+/]{56}\s*$/.test(decoded)) {
    throw new Error('La chiave pubblica non sembra una chiave di Tauri.');
  }
  if (privateKey === '') throw new Error('Il file della chiave privata è vuoto.');

  const conf = join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
  const text = readFileSync(conf, 'utf8');
  const current = JSON.parse(text).plugins?.updater?.pubkey;
  if (current !== PUBKEY_PLACEHOLDER && current !== publicKey) {
    throw new Error(
      "tauri.conf.json ha già un'altra chiave pubblica: le app installate non accetterebbero gli aggiornamenti firmati con questa.",
    );
  }
  log(`Repository: ${repository}, environment «release».`);
  const args = ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '--env', 'release'];
  run('gh', [...args, '--repo', repository], privateKey);
  writeFileSync(conf, text.replace(PUBKEY_PLACEHOLDER, publicKey));
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Uso: node scripts/setup-updater.mjs "<cartella della chiave>"');
    process.exitCode = 2;
  } else {
    try {
      setupUpdater(fileURLToPath(new URL('..', import.meta.url)), args[0]);
      console.log(
        "Fatto: secret TAURI_SIGNING_PRIVATE_KEY impostato nell'environment release e chiave pubblica scritta in apps/desktop/src-tauri/tauri.conf.json (da committare).",
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
