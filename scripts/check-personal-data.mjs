// Fails (exit code 1) when a tracked file contains something that looks like personal data of a
// real apartment, tenant or contract. Real data never enters the repository (spec section 28):
// only anonymised fixtures do. The script reads `git ls-files`, so untracked and ignored files
// are out of scope, and it also looks at the file names.
//
// What counts as a finding:
//   IBAN               Italian IBAN, 27 characters, with or without spaces:
//                      IT + 2 check digits + 1 letter + 10 digits + 12 alphanumerics.
//   codice fiscale     16 characters (omocodia accepted) whose check character is correct.
//                      The check keeps random 16-character strings from being flagged.
//   POD                Electricity supply point: IT + 3 digits + E + 8 digits.
//   PDR                Gas delivery point: 14 digits, optionally grouped with single spaces.
//                      A bare 14-digit number is too common (compact timestamps, ids), so it
//                      only counts when "pdr" (also inside "pdrCode", "gas_pdr") or "punto di
//                      riconsegna" is within 80 characters before or 40 after it.
//   registration code  Identifier of a registered lease (Agenzia delle Entrate, servizio RLI),
//                      17 characters. Structure assumed from the ricevuta di registrazione:
//                      T + 2 alphanumerics (office) + 2 digits (year) + 1 letter (series)
//                      + 9 digits (progressive and sub-number) + 2 alphanumerics. Matched by
//                      structure alone. Because the structure is an assumption, any 17-character
//                      token starting with T, with at least 5 digits and 2 letters, also counts
//                      when "codice identificativo", "registrazione", "RLI" or "TRN" is close.
//   person name        The real owners' names, as whole words in any case. They are not written
//                      here: each word (letters, digits, underscore) is lower-cased, put in NFC
//                      and compared by its salted SHA-256 (NAME_FINGERPRINTS). The repository
//                      uses user1 and user2 instead. The fingerprint only keeps the names out of
//                      plain text: three common first and last names are easy to guess.
//   private path       A path into a real account: macOS iCloud ("Mobile Documents"), or the
//                      home folder of a user (/Users/<name>, /home/<name>, C:\Users\<name>) other
//                      than the placeholders user1, user2, <nome>, x.
//   address            A house number after an apartment name (Berchet, Lovarini, Pulci):
//                      "Berchet 3", "Pulci 2a", "Lovarini_5". Years ("Berchet 2024-25") and
//                      amounts ("Berchet 100,75 €") are not house numbers. The bare names are fine.
//
// Addresses and private paths are not checked in the files that define them (NAME_CHECK_FILES):
// their tests spell examples. Names are checked there too.
// Fictitious example codes are allowed: list them in backticks in the section
// "Codici d'esempio fittizi" of fixtures/README.md. Nothing else is ever allowed.
// The pnpm lockfile (hashes only) and binary files are not scanned.
//
// The output never prints a whole code, not even inside a file name: logs must not carry
// personal data. Codes are masked ("IT***KL") wherever they appear, paths included.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_CODES_FILE = 'fixtures/README.md';
const ALLOWED_CODES_HEADING = /^##\s+Codici d['’]esempio fittizi\b.*$/im;
const SKIPPED_FILES = new Set(['pnpm-lock.yaml']);
// This script and its test spell out the addresses and paths they look for.
const NAME_CHECK_FILES = new Set([
  'scripts/check-personal-data.mjs',
  'scripts/check-personal-data.test.mjs',
]);
const NAME_KINDS = new Set(['address', 'private path']);

const NAME_SALT = 'bollette-check-personal-data/v1:';

/** The salted SHA-256 of a word, lower-cased and in NFC: how the real names are compared. */
export function wordFingerprint(word) {
  return createHash('sha256')
    .update(NAME_SALT + word.normalize('NFC').toLowerCase())
    .digest('hex');
}

/** The three real names of the owners (first names and surname), as fingerprints only. */
export const NAME_FINGERPRINTS = new Set([
  '4ea73838ae48a698eed9bbe4400ff9da77bcc54d393c8fe3b14c54dcebc77f58',
  '43002ef825cd0ca493ed0694dea280f526239f49e0a5cc02c6486ac73e93a46f',
  '92ad87bd7fd9b27f60b470aa5df1f20b8547051d2c5962318b0372d699ba566b',
]);

const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
const fingerprints = new Map(); // word -> fingerprint: the same words come back in every file
function fingerprintOf(word) {
  let value = fingerprints.get(word);
  if (value === undefined) {
    value = wordFingerprint(word);
    fingerprints.set(word, value);
  }
  return value;
}

// The account name after the home folder must start with a letter or digit, so `/Users/…`,
// `/Users/|`, `'/Users/' + x` and `/Users/<nome>` are not paths of an account. Placeholders:
// user, user1, user2, ... and a single letter, also followed by an extension (`C:/Users/x.json`).
const PLACEHOLDER_ACCOUNTS = /^(?:user\d*|\p{L})$/iu;

// No word boundary on "pdr": keys such as "pdrCode", "gasPdr" and "pdr_code" must count too. A
// 14-digit run with this substring within reach is rare enough in ordinary text.
const PDR_KEYWORD = /pdr|punto\s+di\s+riconsegna/i;
const REGISTRATION_KEYWORD = /codice\s+identificativo|registrazione|\bRLI\b|\bTRN\b/i;

/** Removes spaces and upper-cases, so that "IT60 X054 ..." and "it60x054..." compare equal. */
function normalizeCode(value) {
  return value.replace(/\s+/g, '').toUpperCase();
}

// --- Codice fiscale -------------------------------------------------------------------------

const ODD_POSITION_VALUES = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];
const ODD_POSITION_LETTER_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

function characterValue(character, isOddPosition) {
  const isDigit = character >= '0' && character <= '9';
  const index = isDigit ? Number(character) : character.charCodeAt(0) - 'A'.charCodeAt(0);
  if (!isOddPosition) return index;
  return isDigit ? ODD_POSITION_VALUES[index] : ODD_POSITION_LETTER_VALUES[index];
}

/** The 16th character of a codice fiscale, computed from the first 15. */
export function codiceFiscaleCheckChar(first15) {
  const characters = first15.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += characterValue(characters[i], i % 2 === 0);
  return String.fromCharCode('A'.charCodeAt(0) + (sum % 26));
}

/** True for a 16-character codice fiscale whose check character is correct. */
export function isValidCodiceFiscale(value) {
  const code = value.toUpperCase();
  return (
    /^[A-Z]{6}[0-9LMNP-V]{2}[ABCDEHLMPRST][0-9LMNP-V]{2}[A-Z][0-9LMNP-V]{3}[A-Z]$/.test(code) &&
    codiceFiscaleCheckChar(code.slice(0, 15)) === code[15]
  );
}

// --- Detectors ------------------------------------------------------------------------------

function near(text, index, length, keyword) {
  return keyword.test(text.slice(Math.max(0, index - 80), index + length + 40));
}

const DETECTORS = [
  {
    kind: 'IBAN',
    pattern: /(?<![A-Z0-9])IT[^\S\r\n]?\d{2}(?:[^\S\r\n]?[0-9A-Z]){23}(?![A-Z0-9])/gi,
    accept: ([match]) => /^IT\d{2}[A-Z]\d{10}[0-9A-Z]{12}$/.test(normalizeCode(match)),
  },
  {
    kind: 'codice fiscale',
    pattern:
      /(?<![A-Z0-9])[A-Z]{6}[0-9LMNP-V]{2}[ABCDEHLMPRST][0-9LMNP-V]{2}[A-Z][0-9LMNP-V]{3}[A-Z](?![A-Z0-9])/gi,
    accept: ([match]) => isValidCodiceFiscale(match),
  },
  {
    kind: 'POD',
    pattern: /(?<![A-Z0-9])IT\d{3}E\d{8}(?![A-Z0-9])/gi,
  },
  {
    kind: 'PDR',
    // 14 digits, optionally grouped with single spaces (in fours, fives, ...), not part of a
    // longer run of digits.
    pattern: /(?<!\d[^\S\r\n]?)\d(?:[^\S\r\n]?\d){13}(?![^\S\r\n]?\d)/g,
    accept: ([match], text, index) => near(text, index, match.length, PDR_KEYWORD),
  },
  {
    kind: 'registration code',
    pattern: /(?<![A-Z0-9])T[A-Z0-9]{2}\d{2}[A-Z]\d{9}[A-Z0-9]{2}(?![A-Z0-9])/g,
  },
  {
    kind: 'registration code',
    pattern: /(?<![A-Z0-9])T[A-Z0-9]{16}(?![A-Z0-9])/g,
    accept: ([match], text, index) =>
      (match.match(/\d/g) ?? []).length >= 5 &&
      (match.match(/[A-Z]/g) ?? []).length >= 2 &&
      near(text, index, match.length, REGISTRATION_KEYWORD),
  },
  {
    kind: 'private path',
    pattern: /Mobile Documents/gi,
  },
  {
    kind: 'private path',
    pattern: /(?:\/Users\/|\/home\/|\b[A-Za-z]:[\\/]+Users[\\/]+)([\p{L}\p{N}][\p{L}\p{N}._-]*)/giu,
    accept: ([, account]) => !PLACEHOLDER_ACCOUNTS.test(account.split('.')[0]),
  },
  {
    kind: 'address',
    // 1-3 digits and an optional letter, not the start of a year or of an amount.
    pattern: /\b(?:Berchet|Lovarini|Pulci)[ _]\d{1,3}[a-z]?\b(?![.,]\d)/gi,
  },
];

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * Looks for personal-data lookalikes in a piece of text. `allowed` holds the normalised
 * fictitious example codes that must be ignored, `names` the fingerprints of the names to flag.
 * Returns `{ kind, line, value }` in text order.
 */
export function scanText(rawText, allowed = new Set(), names = NAME_FINGERPRINTS) {
  const text = rawText.normalize('NFC'); // NFC never touches line breaks: lines stay the same
  const found = new Map(); // "kind:index" -> finding, so two detectors never report the same hit twice
  for (const match of text.matchAll(WORD)) {
    if (!names.has(fingerprintOf(match[0]))) continue;
    const index = match.index;
    found.set(`person name:${index}`, {
      index,
      kind: 'person name',
      line: lineOf(text, index),
      value: match[0],
    });
  }
  for (const { kind, pattern, accept } of DETECTORS) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index;
      if (accept && !accept(match, text, index)) continue;
      const value = match[0];
      if (allowed.has(normalizeCode(value))) continue;
      found.set(`${kind}:${index}`, { index, kind, line: lineOf(text, index), value });
    }
  }
  return [...found.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ kind, line, value }) => ({ kind, line, value }));
}

/** Reads the fictitious example codes from the text of fixtures/README.md. */
export function parseAllowedCodes(readmeText) {
  const heading = ALLOWED_CODES_HEADING.exec(readmeText);
  if (!heading) return new Set();
  const afterHeading = readmeText.slice(heading.index + heading[0].length);
  const nextHeading = afterHeading.search(/^##\s/m);
  const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  return new Set([...section.matchAll(/`([^`\n]+)`/g)].map(([, code]) => normalizeCode(code)));
}

// --- Files ----------------------------------------------------------------------------------

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

/**
 * Scans the given files (paths relative to `rootDir`, as printed by `git ls-files`) and their
 * names. Returns `{ scannedFiles, findings }`, each finding being `{ file, line, kind, value }`
 * with line 0 for a hit in the file name. `names` as in `scanText`.
 */
export function scanFiles(rootDir, files, names = NAME_FINGERPRINTS) {
  const allowedCodesPath = join(rootDir, ALLOWED_CODES_FILE);
  const allowed = existsSync(allowedCodesPath)
    ? parseAllowedCodes(readFileSync(allowedCodesPath, 'utf8'))
    : new Set();
  const findings = [];
  let scannedFiles = 0;
  for (const file of files) {
    for (const hit of scanText(file, allowed, names)) findings.push({ file, ...hit, line: 0 });
    if (SKIPPED_FILES.has(file)) continue;
    let content;
    try {
      content = readFileSync(join(rootDir, file));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') continue; // staged for removal
      throw error;
    }
    if (isBinary(content)) continue;
    scannedFiles++;
    for (const hit of scanText(content.toString('utf8'), allowed, names)) {
      if (NAME_CHECK_FILES.has(file) && NAME_KINDS.has(hit.kind)) continue;
      findings.push({ file, ...hit });
    }
  }
  return { scannedFiles, findings };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Root of the git repository that contains `cwd`. */
export function repositoryRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

/** Every file tracked by git under `rootDir`, with forward-slash paths. */
export function listTrackedFiles(rootDir) {
  return git(['ls-files', '-z'], rootDir).split('\0').filter(Boolean);
}

function mask(value) {
  const compact = normalizeCode(value);
  return `${compact.slice(0, 2)}***${compact.slice(-2)}`;
}

/** The path with every code found in it masked, so a file name can be printed safely. */
export function maskPath(path) {
  const values = scanText(path).map(({ value }) => value);
  // Longest first, so a code that contains another one is masked as a whole.
  values.sort((a, b) => b.length - a.length);
  return values.reduce((masked, value) => masked.replaceAll(value, mask(value)), path);
}

function main() {
  let rootDir;
  let files;
  try {
    rootDir = repositoryRoot(process.cwd());
    files = listTrackedFiles(rootDir);
  } catch {
    console.error(
      'Personal data check: cannot list tracked files. Run it inside the git repository.',
    );
    process.exitCode = 2;
    return;
  }
  const { scannedFiles, findings } = scanFiles(rootDir, files);
  if (findings.length === 0) {
    console.log(`Personal data check passed: ${scannedFiles} tracked files scanned.`);
    return;
  }
  console.error(
    `Personal data check failed: ${findings.length} possible personal data in tracked files.`,
  );
  for (const { file, line, kind, value } of findings) {
    const safeFile = maskPath(file);
    const where = line === 0 ? `${safeFile} (file name)` : `${safeFile}:${line}`;
    console.error(`  ${where}: ${kind} ${mask(value)}`);
  }
  console.error(
    `Use anonymised values (spec section 28). A fictitious example may be declared in ${ALLOWED_CODES_FILE}.`,
  );
  process.exitCode = 1;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) main();
