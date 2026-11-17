// The one command user1 runs on their own computer, once, from the root of the repository:
//
//   node scripts/setup-updater.mjs "<folder of the update signing key>"
//
// The folder holds the key pair made with `tauri signer generate` (R31): one `<name>.key`
// (private) and `<name>.key.pub` (public). The script
//   1. sends the private key to `gh secret set TAURI_SIGNING_PRIVATE_KEY` on stdin: never as an
//      argument, never printed, never written anywhere else;
//   2. writes the public key in tauri.conf.json in place of the placeholder (it is not a secret
//      and is committed).
// It never makes a key. Needs the GitHub CLI logged in (`gh auth login`) with admin rights on the
// repository. See docs/distribuzione.md. Only Node built-ins.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBKEY_PLACEHOLDER } from './release.mjs';

const BASE64 = /^[A-Za-z0-9+/]+=*$/;

function runGh(command, args, input, cwd) {
  const result = spawnSync(command, args, { cwd, input, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error !== undefined) throw new Error(`gh non si avvia: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh è uscito con il codice ${result.status}.`);
}

/** Sets the signing secret and writes the public key; `run(command, args, stdin)` runs gh. */
export function setupUpdater(root, folder, run = runGh) {
  if (!existsSync(folder)) throw new Error(`La cartella ${folder} non esiste.`);
  const keys = readdirSync(folder).filter((name) => name.endsWith('.key'));
  if (keys.length !== 1 || !existsSync(join(folder, `${keys[0]}.pub`))) {
    throw new Error(
      'Nella cartella serve una sola coppia <nome>.key e <nome>.key.pub (vedi docs/distribuzione.md).',
    );
  }
  const privateKey = readFileSync(join(folder, keys[0]), 'utf8').trim();
  const publicKey = readFileSync(join(folder, `${keys[0]}.pub`), 'utf8').trim();
  if (!BASE64.test(publicKey))
    throw new Error('La chiave pubblica non sembra una chiave di Tauri.');
  if (privateKey === '') throw new Error('Il file della chiave privata è vuoto.');

  const conf = join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
  const text = readFileSync(conf, 'utf8');
  const current = JSON.parse(text).plugins?.updater?.pubkey;
  if (current !== PUBKEY_PLACEHOLDER && current !== publicKey) {
    throw new Error(
      "tauri.conf.json ha già un'altra chiave pubblica: le app installate non accetterebbero gli aggiornamenti firmati con questa.",
    );
  }
  run('gh', ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY'], privateKey, root); // gh finds the repository from cwd
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
        'Fatto: secret TAURI_SIGNING_PRIVATE_KEY impostato e chiave pubblica scritta in apps/desktop/src-tauri/tauri.conf.json (da committare).',
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
