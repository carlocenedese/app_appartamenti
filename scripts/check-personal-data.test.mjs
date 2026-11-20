import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codiceFiscaleCheckChar,
  isValidCodiceFiscale,
  maskPath,
  parseAllowedCodes,
  NAME_FINGERPRINTS,
  scanFiles,
  scanText,
  wordFingerprint,
} from './check-personal-data.mjs';

// Invented names: the tests never spell the real ones, which the check knows only by fingerprint.
const TEST_NAMES = new Set(['Zorbaldo', 'Quintilia', 'Frasconi'].map(wordFingerprint));

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-personal-data.mjs');

// Fictitious example codes. They are declared in fixtures/README.md, so the check accepts them.
const EXAMPLE_IBAN = 'IT60 X054 2811 1010 0000 0123 456';
const EXAMPLE_IBAN_COMPACT = 'IT60X0542811101000000123456';
const EXAMPLE_CF = 'RSSMRA80A01H501U';
const EXAMPLE_POD = 'IT001E12345678';
const EXAMPLE_PDR = '12345678901234';
const EXAMPLE_REGISTRATION = 'TXX24T123456000AA';

// Codes that are NOT declared anywhere are assembled at run time, so that this very file
// (which the check scans too) never contains them as text.
const parts = (...pieces) => pieces.join('');
const UNLISTED_IBAN = parts('IT', '12', 'A', '0123456789', 'ABCDEFGHIJKL');
const UNLISTED_CF_BASE = parts('BNCLRA', '85', 'M', '41', 'F205');
const UNLISTED_CF = UNLISTED_CF_BASE + codiceFiscaleCheckChar(UNLISTED_CF_BASE);

const README_WITH_EXAMPLES = [
  '# Fixtures',
  '',
  'Altro testo.',
  '',
  "## Codici d'esempio fittizi",
  '',
  `- \`${EXAMPLE_IBAN}\` IBAN`,
  `- \`${EXAMPLE_CF}\` codice fiscale`,
  `- \`${EXAMPLE_POD}\` POD`,
  `- \`${EXAMPLE_PDR}\` PDR`,
  `- \`${EXAMPLE_REGISTRATION}\` codice di registrazione`,
  '',
  '## Altra sezione',
  '',
  `Questo non e' ammesso: \`${UNLISTED_IBAN}\``,
].join('\n');

const kinds = (text, allowed) => scanText(text, allowed, TEST_NAMES).map((finding) => finding.kind);

describe('scanText', () => {
  it('flags an Italian IBAN, spaced or compact', () => {
    expect(kinds(`conto ${EXAMPLE_IBAN}`)).toEqual(['IBAN']);
    expect(kinds(`conto ${EXAMPLE_IBAN_COMPACT}`)).toEqual(['IBAN']);
    expect(kinds(`conto ${UNLISTED_IBAN.toLowerCase()}`)).toEqual(['IBAN']);
  });

  it('does not flag strings that only look like part of an IBAN', () => {
    expect(kinds('IT60X05428')).toEqual([]);
    expect(kinds(`${EXAMPLE_IBAN_COMPACT}9`)).toEqual([]);
    expect(kinds('DE89 3704 0044 0532 0130 00')).toEqual([]);
  });

  it('flags a valid codice fiscale and reports the line', () => {
    expect(scanText(`prima riga\nCF: ${EXAMPLE_CF}`)).toEqual([
      { kind: 'codice fiscale', line: 2, value: EXAMPLE_CF },
    ]);
  });

  it('flags a codice fiscale written with omocodia substitutions', () => {
    const base = parts('RSSMRA', '80', 'A', '01', 'H50') + 'M';
    expect(kinds(base + codiceFiscaleCheckChar(base))).toEqual(['codice fiscale']);
  });

  it('does not flag codice fiscale lookalikes with a wrong check character', () => {
    expect(kinds('RSSMRA80A01H501X')).toEqual([]);
    expect(kinds('ABCDEF12G34H567I')).toEqual([]);
  });

  it('flags a POD and ignores lookalikes', () => {
    expect(kinds(`POD ${EXAMPLE_POD}`)).toEqual(['POD']);
    expect(kinds('IT001X12345678')).toEqual([]);
    expect(kinds('IT001E1234567')).toEqual([]);
  });

  it('flags a 14-digit PDR only next to the PDR keyword', () => {
    expect(kinds(`PDR: ${EXAMPLE_PDR}`)).toEqual(['PDR']);
    expect(kinds(`{ "pdr": "${EXAMPLE_PDR}" }`)).toEqual(['PDR']);
    expect(kinds(`Punto di riconsegna (PDR)\n${EXAMPLE_PDR}`)).toEqual(['PDR']);
    // A compact timestamp (14 digits) or a longer number is not a PDR.
    expect(kinds(`generated=${parts('2026', '1110', '123456')}`)).toEqual([]);
    expect(kinds(`id ${EXAMPLE_PDR}0`)).toEqual([]);
  });

  it('recognises the PDR keyword inside camelCase and snake_case keys', () => {
    expect(kinds(`{ "pdrCode": "${EXAMPLE_PDR}" }`)).toEqual(['PDR']);
    expect(kinds(`{ "gasPdr": "${EXAMPLE_PDR}" }`)).toEqual(['PDR']);
    expect(kinds(`pdr_code = ${EXAMPLE_PDR}`)).toEqual(['PDR']);
    expect(kinds(`GAS_PDR_CODE=${EXAMPLE_PDR}`)).toEqual(['PDR']);
  });

  it('flags a PDR whose digits are grouped with spaces', () => {
    const inFours = EXAMPLE_PDR.replace(/(\d{4})(?=\d)/g, '$1 ');
    const inFives = [0, 5, 10].map((i) => EXAMPLE_PDR.slice(i, i + 5)).join(' ');
    expect(kinds(`PDR ${inFours}`)).toEqual(['PDR']);
    expect(kinds(`{ "pdrCode": "${inFives}" }`)).toEqual(['PDR']);
    // Still needs the keyword, and must not be a slice of a longer run of digits.
    expect(kinds(`ref ${inFours}`)).toEqual([]);
    expect(kinds(`PDR ${inFours} 5`)).toEqual([]);
    expect(kinds(`PDR 5 ${inFours}`)).toEqual([]);
    // A spaced variant of a declared example is as acceptable as the plain one.
    expect(kinds(`PDR ${inFours}`, new Set([EXAMPLE_PDR]))).toEqual([]);
  });

  it('flags a contract registration code by its structure', () => {
    expect(kinds(`ricevuta ${EXAMPLE_REGISTRATION}`)).toEqual(['registration code']);
  });

  it('flags a 17-character code next to a registration keyword, whatever its structure', () => {
    const code = parts('T', '0123456789', 'ABCDEF');
    expect(kinds(`Codice identificativo del contratto: ${code}`)).toEqual(['registration code']);
    expect(kinds(`Prossimo identificativo: ${code}`)).toEqual([]);
    expect(kinds(`Registrazione ${parts('T', 'ESTUTILITIES', 'BASE')}`)).toEqual([]);
  });

  it('does not flag ordinary code and prose', () => {
    expect(
      kinds(
        [
          'export class TestUtilitiesBase {}',
          'const TOTALE_ANNUALITA_2026 = 1;',
          'sha512-3tTi78MAKhVk9h+YZVXMQ8POmneJuE97QUPAWtJghHzhH7BAyiqQOC2KZh1DWOsu/USB2cRXhznPByaabvYXfw==',
          'IBAN, codice fiscale, POD e PDR non vanno nel repository.',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('flags the names of the fingerprint list as whole words, in any case and in NFC', () => {
    expect(kinds('chiedere a Zorbaldo\nQUINTILIA e frasconi')).toEqual([
      'person name',
      'person name',
      'person name',
    ]);
    expect(kinds("profileId: 'zorbaldo'")).toEqual(['person name']);
    expect(kinds('non zorbaldone; user1 e user2; Quintilias, _frasconi')).toEqual([]);
    expect(wordFingerprint('Zòrbaldo')).toBe(wordFingerprint('Zo\u0300rbaldo'.toUpperCase()));
  });

  it('knows the real names only as three salted SHA-256 fingerprints', () => {
    expect(NAME_FINGERPRINTS.size).toBe(3);
    for (const fingerprint of NAME_FINGERPRINTS) expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(wordFingerprint('user1')).not.toBe(wordFingerprint('user2'));
    expect(kinds('user1 e user2')).toEqual([]);
  });

  it('flags private paths of a real account, not placeholders', () => {
    const home = parts('/Users/', 'pinco', '/Dropbox');
    const icloud = parts('~/Library/Mobile', ' Documents/com~apple~CloudDocs/x');
    const windows = parts('C:', '\\Users\\', 'pinco\\Desktop');
    expect(kinds(`${home}\n${icloud}\n${windows}\n/home/pinco/x\n/Users/pinco.rossi`)).toEqual([
      'private path',
      'private path',
      'private path',
      'private path',
      'private path',
    ]);
    expect(
      kinds(
        "/Users/user2/Dropbox, /Users/<nome>/x, C:\\Users\\user1, C:/Users/x.json, /Users/…, '/Users/' + x, (?:/Users/|/home/), https://github.com/users/pinco, https://example.com/home/pinco",
      ),
    ).toEqual([]);
  });

  it('scans a long single-line file quickly, still telling URLs from folders', () => {
    // A 200 000-character run with no spaces (an embedded image) took minutes with a lookbehind.
    const run = 'Ab1+/'.repeat(40_000);
    const started = performance.now();
    expect(
      kinds(`${run} https://x.org/${run.slice(0, 1000)}/home/pinco ${run}/Users/pinco`),
    ).toEqual(['private path']);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('flags a house number after an apartment name, not years or amounts', () => {
    expect(kinds('Berchet 3, Pulci 2a, Lovarini_5, GAL. G. BERCHET 3')).toEqual([
      'address',
      'address',
      'address',
      'address',
    ]);
    expect(
      kinds(
        'Berchet 2024-25, Pulci 2020-21, Berchet 100,75 €, Pulci 1.234,56 €, Berchet: 5, Berchet_Nord',
      ),
    ).toEqual([]);
  });

  it('skips the codes in the allowed set, compared without spaces and ignoring case', () => {
    const allowed = new Set([EXAMPLE_IBAN_COMPACT, EXAMPLE_CF, EXAMPLE_POD, EXAMPLE_PDR]);
    expect(
      kinds(`${EXAMPLE_IBAN} ${EXAMPLE_CF} ${EXAMPLE_POD} PDR ${EXAMPLE_PDR}`, allowed),
    ).toEqual([]);
    expect(kinds(`${UNLISTED_IBAN} ${UNLISTED_CF}`, allowed)).toEqual(['IBAN', 'codice fiscale']);
  });
});

describe('codice fiscale check character', () => {
  it('computes the check character of the example code', () => {
    expect(codiceFiscaleCheckChar(EXAMPLE_CF.slice(0, 15))).toBe(EXAMPLE_CF.slice(15));
  });

  it('validates well-formed codes only', () => {
    expect(isValidCodiceFiscale(EXAMPLE_CF)).toBe(true);
    expect(isValidCodiceFiscale(EXAMPLE_CF.toLowerCase())).toBe(true);
    expect(isValidCodiceFiscale('RSSMRA80A01H501X')).toBe(false);
    expect(isValidCodiceFiscale('RSSMRA80A01H501')).toBe(false);
  });
});

describe('parseAllowedCodes', () => {
  it('reads the codes quoted in the example-codes section only', () => {
    const allowed = parseAllowedCodes(README_WITH_EXAMPLES);
    expect(allowed).toEqual(
      new Set([EXAMPLE_IBAN_COMPACT, EXAMPLE_CF, EXAMPLE_POD, EXAMPLE_PDR, EXAMPLE_REGISTRATION]),
    );
    expect(allowed.has(UNLISTED_IBAN)).toBe(false);
  });

  it('returns an empty set when the section is missing', () => {
    expect(parseAllowedCodes('# Fixtures\n\nNiente da vedere.')).toEqual(new Set());
  });
});

describe('maskPath', () => {
  it('leaves a clean path alone and masks codes anywhere in the path', () => {
    expect(maskPath('docs/spec.md')).toBe('docs/spec.md');
    expect(maskPath(`a/${UNLISTED_IBAN}/b.txt`)).toBe('a/IT***KL/b.txt');
    expect(maskPath(`${UNLISTED_CF}.pdf`)).toBe(
      `${UNLISTED_CF.slice(0, 2)}***${UNLISTED_CF.slice(-2)}.pdf`,
    );
    expect(maskPath(`${UNLISTED_IBAN} e ${UNLISTED_CF}.txt`)).not.toMatch(/[A-Z0-9]{10}/);
  });
});

// These tests start the real command line on temporary git repositories: under the load of the
// whole suite they took more than the default 5 s (seen twice on 18 Nov 2026).
describe('scanFiles and the command line', { timeout: 60_000 }, () => {
  const folders = [];

  function makeRepo(files) {
    const root = mkdtempSync(join(tmpdir(), 'data-check-'));
    folders.push(root);
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return root;
  }

  function trackedRepo(files) {
    const root = makeRepo(files);
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    return root;
  }

  function runCheck(root) {
    return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
  }

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  it('reports the file and line of an IBAN and of a codice fiscale', () => {
    const root = makeRepo({
      'a.txt': `uno\ndue ${UNLISTED_IBAN}\n`,
      'sub/b.json': JSON.stringify({ cf: UNLISTED_CF }),
      'clean.txt': 'niente\n',
    });
    const { findings, scannedFiles } = scanFiles(root, ['a.txt', 'sub/b.json', 'clean.txt']);
    expect(scannedFiles).toBe(3);
    expect(findings.map(({ file, line, kind }) => ({ file, line, kind }))).toEqual([
      { file: 'a.txt', line: 2, kind: 'IBAN' },
      { file: 'sub/b.json', line: 1, kind: 'codice fiscale' },
    ]);
  });

  it('accepts the codes declared in fixtures/README.md and nothing else', () => {
    const root = makeRepo({
      'fixtures/README.md': README_WITH_EXAMPLES,
      'fixtures/golden/case.json': JSON.stringify({
        iban: EXAMPLE_IBAN,
        cf: EXAMPLE_CF,
        pod: EXAMPLE_POD,
        pdr: EXAMPLE_PDR,
        registration: EXAMPLE_REGISTRATION,
      }),
    });
    const files = ['fixtures/README.md', 'fixtures/golden/case.json'];
    // The README itself quotes an undeclared IBAN in another section: it must be caught.
    expect(scanFiles(root, files).findings.map((f) => [f.file, f.kind])).toEqual([
      ['fixtures/README.md', 'IBAN'],
    ]);
    writeFileSync(join(root, 'fixtures/README.md'), README_WITH_EXAMPLES.split('\n## Altra')[0]);
    expect(scanFiles(root, files).findings).toEqual([]);
  });

  it('does not check addresses and paths in the files of the check itself, but does check names', () => {
    const text = `Zorbaldo, Berchet 3, ${parts('/Users/', 'pinco')}\n`;
    const root = makeRepo({
      'scripts/check-personal-data.mjs': text,
      'scripts/check-personal-data.test.mjs': `${text}${UNLISTED_IBAN}\n`,
      'docs/a.md': text,
    });
    const files = [
      'scripts/check-personal-data.mjs',
      'scripts/check-personal-data.test.mjs',
      'docs/a.md',
    ];
    expect(scanFiles(root, files, TEST_NAMES).findings.map((f) => [f.file, f.kind])).toEqual([
      ['scripts/check-personal-data.mjs', 'person name'],
      ['scripts/check-personal-data.test.mjs', 'person name'],
      ['scripts/check-personal-data.test.mjs', 'IBAN'],
      ['docs/a.md', 'person name'],
      ['docs/a.md', 'address'],
      ['docs/a.md', 'private path'],
    ]);
  });

  it('also looks at file names', () => {
    const root = makeRepo({ [`estratto ${UNLISTED_IBAN}.txt`]: 'vuoto' });
    const { findings } = scanFiles(root, [`estratto ${UNLISTED_IBAN}.txt`]);
    expect(findings.map((f) => f.kind)).toEqual(['IBAN']);
  });

  it('skips binary files, the lockfile and files that no longer exist', () => {
    const root = makeRepo({
      'image.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(UNLISTED_IBAN)]),
      'pnpm-lock.yaml': `x: ${UNLISTED_IBAN}`,
    });
    const { findings, scannedFiles } = scanFiles(root, ['image.bin', 'pnpm-lock.yaml', 'gone.txt']);
    expect(findings).toEqual([]);
    expect(scannedFiles).toBe(0);
  });

  it('fails with exit code 1 on a tracked file with an IBAN, without echoing the whole code', () => {
    const root = trackedRepo({ 'notes.txt': `bonifico su ${UNLISTED_IBAN}\n` });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('notes.txt:1');
    expect(result.stderr + result.stdout).toContain('IBAN');
    expect(result.stderr + result.stdout).not.toContain(UNLISTED_IBAN);
  });

  it('never prints a whole code, not even when it is part of a file or folder name', () => {
    const spacedIban = UNLISTED_IBAN.replace(/(.{4})/g, '$1 ').trim();
    const root = trackedRepo({
      [`estratto ${UNLISTED_IBAN}.txt`]: `riga con ${UNLISTED_IBAN}\n`,
      [`cartella ${spacedIban}/nota.txt`]: 'niente\n',
      'dir/ok.txt': 'niente\n',
    });
    const result = runCheck(root);
    const output = result.stderr + result.stdout;
    expect(result.status).toBe(1);
    expect(output).toContain('(file name)');
    expect(output).toContain('estratto IT***KL.txt:1: IBAN');
    expect(output).toContain('cartella IT***KL/nota.txt (file name)');
    expect(output).not.toContain(UNLISTED_IBAN);
    expect(output).not.toContain(spacedIban);
    expect(output).not.toContain(UNLISTED_IBAN.slice(2, -2));
  });

  it('fails with exit code 1 on a tracked file with a valid codice fiscale', () => {
    const root = trackedRepo({ 'tenant.json': JSON.stringify({ taxCode: UNLISTED_CF }) });
    const result = runCheck(root);
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).not.toContain(UNLISTED_CF);
  });

  it('ignores untracked files: only what git tracks can reach the repository', () => {
    const root = trackedRepo({ 'ok.txt': 'niente\n' });
    writeFileSync(join(root, 'untracked.txt'), UNLISTED_IBAN);
    expect(runCheck(root).status).toBe(0);
  });

  it('passes with exit code 0 when only the declared example codes are present', () => {
    const root = trackedRepo({
      'fixtures/README.md': README_WITH_EXAMPLES.split('\n## Altra')[0],
      'fixtures/example.json': JSON.stringify({ iban: EXAMPLE_IBAN, cf: EXAMPLE_CF }),
    });
    const result = runCheck(root);
    expect(result.status).toBe(0);
  });

  it('fails when run outside a git repository', () => {
    const root = makeRepo({ 'a.txt': 'niente' });
    const result = runCheck(root);
    expect(result.status).not.toBe(0);
  });
});
