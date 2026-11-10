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
//
// Fictitious example codes are allowed: list them in backticks in the section
// "Codici d'esempio fittizi" of fixtures/README.md. Nothing else is ever allowed.
// The pnpm lockfile (hashes only) and binary files are not scanned.
//
// The output never prints a whole code, not even inside a file name: logs must not carry
// personal data. Codes are masked ("IT***KL") wherever they appear, paths included.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_CODES_FILE = 'fixtures/README.md';
const ALLOWED_CODES_HEADING = /^##\s+Codici d['’]esempio fittizi\b.*$/im;
const SKIPPED_FILES = new Set(['pnpm-lock.yaml']);

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
];

function lineOf(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/**
 * Looks for personal-data lookalikes in a piece of text. `allowed` holds the normalised
 * fictitious example codes that must be ignored. Returns `{ kind, line, value }` in text order.
 */
export function scanText(text, allowed = new Set()) {
  const found = new Map(); // "kind:index" -> finding, so two detectors never report the same hit twice
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
 * with line 0 for a hit in the file name.
 */
export function scanFiles(rootDir, files) {
  const allowedCodesPath = join(rootDir, ALLOWED_CODES_FILE);
  const allowed = existsSync(allowedCodesPath)
    ? parseAllowedCodes(readFileSync(allowedCodesPath, 'utf8'))
    : new Set();
  const findings = [];
  let scannedFiles = 0;
  for (const file of files) {
    for (const hit of scanText(file, allowed)) findings.push({ file, ...hit, line: 0 });
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
    for (const hit of scanText(content.toString('utf8'), allowed)) findings.push({ file, ...hit });
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
