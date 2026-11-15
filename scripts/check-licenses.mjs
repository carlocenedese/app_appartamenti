// Fails (exit code 1) when a dependency uses a licence outside the allowed list.
//
// The list comes from the global constraints (spec section 40): only permissive licences, so that
// the code can stay private, become open source or be sold. GPL, AGPL and LGPL are out. Anything
// that is not on the list is out too, which includes weak copyleft such as MPL-2.0 and packages
// with a missing or unreadable licence ("Unknown", "UNLICENSED", "SEE LICENSE IN ...").
//
// Input is `pnpm -r licenses list --json`. The -r flag matters: without it pnpm only reports the
// dependencies of the root package and skips every workspace package. The licence field of a
// package may be an SPDX expression, handled by isLicenseAllowed():
//   A OR B   allowed when at least one option is allowed (we can pick the permissive one)
//   A AND B  allowed only when every part is allowed (we must comply with all of them)
//   A WITH X an exception to licence A: judged by its base licence A
//   A+       "or any later version": judged by its base licence A
// AND binds tighter than OR, as in the SPDX specification. Operators and identifiers are
// compared without regard to case.
//
// Rust crates of the Tauri app are checked separately with cargo-deny (Task 11).

import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  // Added by user1 on 11 November 2026: permissive, and the Rust crates of Tauri need them (see
  // deny.toml). Kept here so that the npm and the Rust checks apply one and the same list.
  'Unicode-3.0',
  'Zlib',
]);

const ALLOWED_LOWER_CASE = new Set([...ALLOWED_LICENSES].map((id) => id.toLowerCase()));
const OPERATORS = new Set(['and', 'or', 'with']);

/** Splits an SPDX expression into parentheses and whitespace-separated words. */
function tokenize(expression) {
  return expression.match(/\(|\)|[^\s()]+/g) ?? [];
}

/**
 * Evaluates an SPDX licence expression against the allowed list.
 * Grammar: or := and ('OR' and)*; and := primary ('AND' primary)*;
 * primary := '(' or ')' | id ['WITH' exception]. Throws on a malformed expression.
 */
function evaluate(expression) {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => tokens[position];
  const peekOperator = () => {
    const token = peek();
    return token === undefined ? undefined : token.toLowerCase();
  };
  const next = () => tokens[position++];

  function parseOr() {
    let allowed = parseAnd();
    while (peekOperator() === 'or') {
      next();
      const right = parseAnd(); // always parse both sides, so malformed input is detected
      allowed = allowed || right;
    }
    return allowed;
  }

  function parseAnd() {
    let allowed = parsePrimary();
    while (peekOperator() === 'and') {
      next();
      const right = parsePrimary();
      allowed = allowed && right;
    }
    return allowed;
  }

  function parsePrimary() {
    const token = next();
    if (token === undefined) throw new Error('unexpected end of expression');
    if (token === '(') {
      const allowed = parseOr();
      if (next() !== ')') throw new Error('missing closing parenthesis');
      return allowed;
    }
    if (token === ')' || OPERATORS.has(token.toLowerCase())) {
      throw new Error(`unexpected "${token}"`);
    }
    const base = token.replace(/\+$/, '').toLowerCase();
    if (peekOperator() === 'with') {
      next();
      const exception = next();
      if (exception === undefined || exception === '(' || exception === ')') {
        throw new Error('missing exception after WITH');
      }
      if (OPERATORS.has(exception.toLowerCase())) throw new Error(`unexpected "${exception}"`);
    }
    return ALLOWED_LOWER_CASE.has(base);
  }

  const allowed = parseOr();
  if (position < tokens.length) throw new Error(`unexpected "${tokens[position]}"`);
  return allowed;
}

/** True when the SPDX expression is acceptable. Anything unknown or malformed is rejected. */
export function isLicenseAllowed(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') return false;
  try {
    return evaluate(expression);
  } catch {
    return false;
  }
}

/**
 * Takes the parsed output of `pnpm -r licenses list --json` (licence expression -> packages)
 * and returns the packages whose licence is not allowed, grouped by licence expression.
 */
export function findDisallowedLicenses(report) {
  const entries = Object.entries(report);
  if (entries.every(([, packages]) => packages.length === 0)) {
    throw new Error('pnpm reported no packages: refusing to pass an empty licence report');
  }
  const disallowed = [];
  for (const [license, packages] of entries) {
    if (isLicenseAllowed(license)) continue;
    disallowed.push({
      license,
      packages: packages.flatMap(({ name, versions }) =>
        (versions.length > 0 ? versions : ['?']).map((version) => `${name}@${version}`),
      ),
    });
  }
  return disallowed;
}

function readPnpmReport() {
  // A fixed command string: no user input reaches the shell. `pnpm` resolves to pnpm.cmd on Windows.
  const output = execSync('pnpm -r licenses list --json', {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(output);
}

function main() {
  const report = readPnpmReport();
  const packageCount = Object.values(report).reduce((sum, packages) => sum + packages.length, 0);
  const disallowed = findDisallowedLicenses(report);
  if (disallowed.length === 0) {
    console.log(`Licence check passed: ${packageCount} packages, all licences allowed.`);
    return;
  }
  console.error(`Licence check failed. Allowed: ${[...ALLOWED_LICENSES].join(', ')}.`);
  for (const { license, packages } of disallowed) {
    console.error(`  ${license}`);
    for (const name of packages) console.error(`    ${name}`);
  }
  process.exitCode = 1;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) main();
