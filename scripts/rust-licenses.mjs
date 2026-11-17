// Fails (exit code 1) when a Rust crate whose licence is outside the list of CLAUDE.md (the same
// list as scripts/check-licenses.mjs: no MPL-2.0) is new compared with a base.
//
//   node scripts/rust-licenses.mjs <base metadata.json> <new metadata.json>
//
// Both files are the output of `cargo metadata --format-version 1 --filter-platform <target>...`
// with the targets of deny.toml: only crates in `resolve` count, so a crate that is in Cargo.lock
// for another platform only (webpki-root-certs, CDLA-Permissive-2.0, wasm32 only) is not
// reported, as cargo-deny does not report it. deny.toml allows MPL-2.0 for
// every crate because Tauri's own tree carries it (user1, 11 November 2026); this check keeps
// that from silently covering crates added later: a new one is user1's decision (plan 16b, R287).
// Crates are compared by name, so a new version of a known crate is not reported.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLicenseAllowed } from './check-licenses.mjs';

/** Cargo's old licence format uses «/» for OR («MIT/Apache-2.0»); SPDX needs « OR ». */
export const toSpdx = (license) =>
  typeof license === 'string' ? license.replace(/\s*\/\s*/g, ' OR ') : license;

/** Name -> licence of the registry crates whose licence is not allowed (missing counts too). */
export function disallowedCrates(metadata) {
  const out = new Map();
  const resolved = new Set((metadata.resolve?.nodes ?? []).map((node) => node.id));
  for (const p of metadata.packages ?? []) {
    if (metadata.resolve && !resolved.has(p.id)) continue;
    // source null: the app's own crate, never published.
    if (p.source !== null && !isLicenseAllowed(toSpdx(p.license)))
      out.set(p.name, p.license ?? '(nessuna)');
  }
  return out;
}

/** The disallowed crates of `after` that `before` did not have, as «name (licence)». */
export function newDisallowedCrates(before, after) {
  const known = disallowedCrates(before);
  return [...disallowedCrates(after)]
    .filter(([name]) => !known.has(name))
    .map(([name, license]) => `${name} (${license})`)
    .sort();
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (beforePath === undefined || afterPath === undefined) {
    console.error('Uso: node scripts/rust-licenses.mjs <base metadata.json> <nuovo metadata.json>');
    process.exitCode = 2;
    return;
  }
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const added = newDisallowedCrates(read(beforePath), read(afterPath));
  if (added.length === 0) {
    console.log('Nessun crate nuovo con una licenza fuori elenco.');
    return;
  }
  console.error('Crate nuovi con una licenza fuori elenco (decide user1, deny.toml non si tocca):');
  for (const line of added) console.error(`    ${line}`);
  process.exitCode = 1;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) main();
