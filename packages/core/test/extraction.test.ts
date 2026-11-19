import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ExtractionResultSchema, parseExtractionResult } from '../src/extraction';
import { DocumentKindSchema } from '../src/model';
import type { ExtractedField, ExtractionResult } from '../src/extraction';
import type { Cents } from '../src/money';

const source = { page: 1, box: [10, 20, 110.5, 40], text: 'Totale 98,46' };
const field = (value: unknown, confidence = 'high') => ({ value, confidence, source });

const full: Record<string, unknown> = {
  v: 1,
  engineVersion: '0.1.0',
  fileHash: 'a'.repeat(64),
  fileName: 'bolletta.pdf',
  pages: 3,
  pageRange: [1, 3],
  status: 'riconosciuta',
  profileId: 'prof-1',
  profileRev: 2,
  kind: 'bill',
  documentKind: 'bill',
  category: 'elettricita',
  fields: {
    supplier: field('Fornitore Luce'),
    number: field('2026/123'),
    issueDate: field('2026-02-01'),
    dueDate: field('2026-02-20'),
    periodStart: field('2025-12-01'),
    periodEnd: field('2026-01-31'),
    amount: field(9846),
    consumption: field({ quantity: '123.4', unit: 'kWh' }, 'medium'),
  },
  parts: [{ label: 'Quota fissa', amount: 1200, source }],
  identifiers: [{ kind: 'pod', value: 'IT001E12345678' }],
  checks: [{ code: 'total-matches-items', ok: true, message: 'Il totale torna.' }],
  warnings: ['Due corrispondenze per la scadenza.'],
  textSource: 'pdf',
  ocrPages: [],
};

const empty: Record<string, unknown> = {
  v: 1,
  engineVersion: '0.1.0',
  fileHash: 'b'.repeat(64),
  fileName: 'scansione.pdf',
  pages: 2,
  pageRange: [1, 2],
  status: 'senza-testo',
  profileId: null,
  profileRev: null,
  kind: null,
  documentKind: 'unknown',
  category: null,
  fields: {},
  parts: [],
  identifiers: [],
  checks: [],
  warnings: [],
  textSource: 'pdf',
  ocrPages: [],
};

const changed = (base: Record<string, unknown>, changes: Record<string, unknown>) => ({
  ...base,
  ...changes,
});
const ok = (value: unknown): boolean => ExtractionResultSchema.safeParse(value).success;

describe('ExtractionResultSchema', () => {
  it('reads the page range and the document kind', () => {
    expect(DocumentKindSchema.options).toEqual(['bill', 'tari', 'unknown']);
    expect(ok(changed(full, { pageRange: [1, 3] }))).toBe(true);
    expect(ok(changed(full, { pageRange: [2, 3], fields: { amount: field(1, 'high') } }))).toBe(
      false,
    );
    expect(ok(changed(empty, { pages: 0, pageRange: null }))).toBe(true);
    expect(ok(changed(full, { documentKind: 'tari', kind: 'tari', category: null }))).toBe(true);
  });

  it('agrees with the cases shared with the Python tests', () => {
    const file = new URL('../../../python/tests/data/extraction-cases.json', import.meta.url);
    const { cases } = JSON.parse(readFileSync(file, 'utf8')) as {
      cases: { name: string; result: unknown; zod: boolean; reason?: string }[];
    };
    expect(cases.length).toBeGreaterThan(10);
    for (const { name, result, zod, reason } of cases) {
      const parsed = ExtractionResultSchema.safeParse(result);
      expect([name, parsed.success]).toEqual([name, zod]);
      // A refusal by a refine says why: its message names the reason.
      if (reason !== undefined && !parsed.success) {
        expect([name, parsed.error.issues.map((issue) => issue.message).join(' ')]).toEqual([
          name,
          expect.stringContaining(reason),
        ]);
      }
    }
  });

  it('reads a complete result and parses amounts to cents', () => {
    const parsed = ExtractionResultSchema.parse(full);
    expect(parsed.fields.amount?.value).toBe(9846);
    expectTypeOf(parsed).toEqualTypeOf<ExtractionResult>();
    expectTypeOf(parsed.fields.amount).toEqualTypeOf<ExtractedField<Cents> | undefined>();
  });

  it('accepts the three text sources and refuses another one, or none', () => {
    const medium = { amount: field(9846, 'medium') };
    // a scan: every page read with OCR, nothing sure; a mixed one: a text page 1, OCR page 2
    const scan = { textSource: 'ocr', ocrPages: [1, 2], status: 'da-confermare', fields: medium };
    expect(ok(changed(full, { textSource: 'pdf', ocrPages: [] }))).toBe(true);
    expect(ok(changed(full, scan))).toBe(true);
    expect(ok(changed(full, { textSource: 'mixed', ocrPages: [2] }))).toBe(true);
    expect(ok(changed(full, { textSource: 'scan' }))).toBe(false);
    expect(ok(changed(full, { textSource: undefined }))).toBe(false);
    expect(ok(changed(full, { ocrPages: undefined }))).toBe(false);
    expect(ok(changed(full, { ocrPages: [0] }))).toBe(false);
  });

  it('refuses pages read with OCR when the text is all from the PDF', () => {
    expect(ok(changed(full, { textSource: 'pdf', ocrPages: [2] }))).toBe(false);
  });

  it('refuses a high field or riconosciuta for a scan (textSource ocr)', () => {
    const scan = { textSource: 'ocr', ocrPages: [1, 2] };
    const medium = { amount: field(9846, 'medium') };
    expect(ok(changed(full, { ...scan, status: 'da-confermare', fields: medium }))).toBe(true);
    expect(ok(changed(full, { ...scan, status: 'da-confermare' }))).toBe(false);
    expect(ok(changed(full, { ...scan, status: 'riconosciuta', fields: medium }))).toBe(false);
  });

  it('judges a mixed result field by field, by the page the field was read from', () => {
    const mixed = { textSource: 'mixed' };
    const onPage = (page: number, confidence: string) => ({
      amount: { value: 9846, confidence, source: { ...source, page } },
    });
    // read from the text page: high and riconosciuta stay
    expect(ok(changed(full, { ...mixed, ocrPages: [2] }))).toBe(true);
    expect(ok(changed(full, { ...mixed, ocrPages: [2], fields: onPage(1, 'high') }))).toBe(true);
    // read from the OCR page: never high, never riconosciuta
    expect(ok(changed(full, { ...mixed, ocrPages: [1] }))).toBe(false);
    expect(ok(changed(full, { ...mixed, ocrPages: [2], fields: onPage(2, 'high') }))).toBe(false);
    const doubtful = { ...mixed, ocrPages: [2], fields: onPage(2, 'medium') };
    expect(ok(changed(full, { ...doubtful, status: 'riconosciuta' }))).toBe(false);
    expect(ok(changed(full, { ...doubtful, status: 'da-confermare' }))).toBe(true);
    // a field with no value on the OCR page does not stop riconosciuta
    const none = { value: null, confidence: 'missing', source: null };
    expect(ok(changed(full, { ...mixed, ocrPages: [2], fields: { dueDate: none } }))).toBe(true);
  });

  it('judges the parts by the page they were read from too', () => {
    const mixed = { textSource: 'mixed', ocrPages: [2] };
    const parts = (page: number) => [{ label: 'Quota', amount: 1200, source: { ...source, page } }];
    expect(ok(changed(full, { ...mixed, parts: parts(1) }))).toBe(true);
    expect(ok(changed(full, { ...mixed, parts: parts(2) }))).toBe(false);
    expect(ok(changed(full, { ...mixed, parts: parts(2), status: 'da-confermare' }))).toBe(true);
  });

  it('does not throw on a scanned result with an optional field set to undefined', () => {
    const scan = { textSource: 'ocr', ocrPages: [1], status: 'da-confermare' };
    const fields = { supplier: undefined, amount: field(9846, 'medium') };
    expect(() => ok(changed(full, { ...scan, fields }))).not.toThrow();
    expect(ok(changed(full, { ...scan, fields }))).toBe(true);
  });

  it('reads a result without text and no fields', () => {
    expect(ExtractionResultSchema.parse(empty)).toEqual(empty);
  });

  it('reads a field with no value, confidence missing and no source', () => {
    const missing = { value: null, confidence: 'missing', source: null };
    expect(ok(changed(full, { fields: { dueDate: missing } }))).toBe(true);
  });

  it('accepts every status and refuses an unknown one', () => {
    for (const status of [
      'riconosciuta',
      'da-confermare',
      'non-riconosciuta',
      'senza-testo',
      'illeggibile',
    ]) {
      expect(ok(changed(full, { status })), status).toBe(true);
    }
    expect(ok(changed(full, { status: 'boh' }))).toBe(false);
  });

  it.each(['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), ''])(
    'refuses the file hash %j',
    (fileHash) => {
      expect(ok(changed(full, { fileHash }))).toBe(false);
    },
  );

  it.each([98.46, '9846', null])('refuses the amount %j', (value) => {
    expect(ok(changed(full, { fields: { amount: field(value) } }))).toBe(value === null);
  });

  it('refuses a date that is not a calendar date and a value of the wrong kind', () => {
    expect(ok(changed(full, { fields: { dueDate: field('2026-02-30') } }))).toBe(false);
    expect(ok(changed(full, { fields: { number: field(5) } }))).toBe(false);
    expect(
      ok(changed(full, { fields: { consumption: field({ quantity: '1,5', unit: 'm3' }) } })),
    ).toBe(false);
  });

  it('refuses an unknown confidence and a malformed source', () => {
    expect(ok(changed(full, { fields: { amount: field(1, 'certain') } }))).toBe(false);
    const badBox = { value: 1, confidence: 'high', source: { ...source, box: [1, 2, 3] } };
    expect(ok(changed(full, { fields: { amount: badBox } }))).toBe(false);
    const badPage = { value: 1, confidence: 'high', source: { ...source, page: 0 } };
    expect(ok(changed(full, { fields: { amount: badPage } }))).toBe(false);
  });

  it('refuses a missing field key such as confidence, and a wrong version', () => {
    expect(ok(changed(full, { fields: { amount: { value: 1, source: null } } }))).toBe(false);
    expect(ok(changed(full, { v: 2 }))).toBe(false);
  });

  it('refuses a part with fractional cents and an unknown identifier kind', () => {
    expect(ok(changed(full, { parts: [{ label: 'x', amount: 1.5, source }] }))).toBe(false);
    expect(ok(changed(full, { identifiers: [{ kind: 'iban', value: 'x' }] }))).toBe(false);
  });

  it('refuses an unknown kind or category', () => {
    expect(ok(changed(full, { kind: 'imu' }))).toBe(false);
    expect(ok(changed(full, { category: 'telefono' }))).toBe(false);
  });

  it('drops unknown keys', () => {
    expect(ExtractionResultSchema.parse(changed(empty, { later: 1 }))).not.toHaveProperty('later');
  });
});

describe('parseExtractionResult', () => {
  it('gives the validated result of the JSON text', () => {
    expect(parseExtractionResult(JSON.stringify(full))).toEqual(ExtractionResultSchema.parse(full));
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseExtractionResult('{')).toThrow('La risposta di Python non è JSON.');
  });

  it('names only the paths of an invalid result, never its values', () => {
    const bad = JSON.stringify({ ...full, fileName: 12345, pages: 'segreto' });
    expect(() => parseExtractionResult(bad)).toThrow(
      /^La risposta di Python non è un ExtractionResult valido \(.*fileName.*\)\.$/,
    );
    expect(() => parseExtractionResult(bad)).not.toThrow(/segreto/);
  });
});
