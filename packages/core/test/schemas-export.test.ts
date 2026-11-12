import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ISODateSchema, YearMonthSchema, recordSchemas } from '../src/model';
import { exportJsonSchemas, serializeJsonSchema } from '../src/schemas-json';

// docs/schemas holds one JSON Schema per record kind plus the workspace file and the operations of
// the journal. The Python side (plan 2) validates what it writes against these files, so the two
// languages cannot drift apart.
// A change to the model without `pnpm schemas:export` makes this test fail.

const SCHEMAS_DIR = fileURLToPath(new URL('../../../docs/schemas', import.meta.url));
const REGENERATE = 'Run `pnpm schemas:export` and commit docs/schemas.';

const expectedKinds = [
  ...Object.keys(recordSchemas),
  'workspace',
  'operation',
  'extractionResult',
].sort();

type JsonObject = Record<string, unknown>;

function schemaOf(kind: string): JsonObject {
  const schema = exportJsonSchemas()[kind];
  if (schema === undefined) throw new Error(`No schema exported for ${kind}`);
  return schema as JsonObject;
}

function properties(kind: string): Record<string, JsonObject> {
  return schemaOf(kind)['properties'] as Record<string, JsonObject>;
}

/** The `pattern` of a property, compiled the way a JSON Schema validator would (ECMA 262). */
function patternOf(kind: string, field: string): RegExp {
  const pattern = properties(kind)[field]?.['pattern'];
  if (typeof pattern !== 'string') throw new Error(`${kind}.${field} has no pattern`);
  return new RegExp(pattern);
}

/** Every `pattern` string found anywhere in a JSON Schema, with the path where it sits. */
function collectPatterns(node: unknown, path = '$'): [path: string, pattern: string][] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => collectPatterns(item, `${path}[${index}]`));
  }
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'pattern' && typeof value === 'string'
      ? [[path, value] as [string, string]]
      : collectPatterns(value, `${path}.${key}`),
  );
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
// Arabic-Indic digits for 2026-01-01: `\d` matches them in Python (and in Unicode-aware engines).
const ARABIC_INDIC_MONTH = '\u0662\u0660\u0662\u0666-\u0660\u0661';
const ARABIC_INDIC_DATE = `${ARABIC_INDIC_MONTH}-\u0660\u0661`;

describe('exportJsonSchemas', () => {
  it('exports one schema for each record kind and one for the workspace', () => {
    expect(Object.keys(exportJsonSchemas()).sort()).toEqual(expectedKinds);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(exportJsonSchemas())).toBe(JSON.stringify(exportJsonSchemas()));
  });

  it('writes JSON Schema draft 2020-12 describing objects', () => {
    for (const kind of expectedKinds) {
      expect(schemaOf(kind)['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schemaOf(kind)['type']).toBe('object');
    }
  });

  it('describes the shape that is read from disk: whole numbers and plain strings', () => {
    expect(properties('bill')['amount']).toMatchObject({ type: 'integer' });
    expect(properties('bill')['periodStart']).toMatchObject({ type: 'string', format: 'date' });
    expect(properties('payment')['forMonth']).toMatchObject({ type: 'string' });
    expect(properties('note')['at']).toMatchObject({ type: 'string', format: 'date-time' });
  });

  it('requires id, v and rev on every record but not on the workspace', () => {
    for (const kind of Object.keys(recordSchemas)) {
      expect(schemaOf(kind)['required']).toEqual(expect.arrayContaining(['id', 'v', 'rev']));
      expect(schemaOf(kind)['required']).not.toContain('deleted');
      expect(properties(kind)['v']).toMatchObject({ const: 1 });
    }
    expect(schemaOf('workspace')['required']).not.toEqual(expect.arrayContaining(['id']));
    expect(Object.keys(properties('workspace'))).toEqual([
      'workspaceId',
      'name',
      'schemaVersion',
      'minAppVersion',
      'createdAt',
    ]);
  });

  it('describes an operation of the journal, with the rules of a change in prose', () => {
    expect(schemaOf('operation')['required']).toEqual(
      expect.arrayContaining(['id', 'v', 'at', 'profileId', 'kind', 'summary', 'changes']),
    );
    expect(schemaOf('operation')['required']).not.toContain('undoes');
    expect(properties('operation')['v']).toMatchObject({ const: 1 });
    expect(properties('operation')['at']).toMatchObject({ type: 'string', format: 'date-time' });
    const change = (properties('operation')['changes']?.['items'] ?? {}) as JsonObject;
    expect(change['required']).toEqual(['path', 'after']);
    expect(change['description']).toMatch(/after.*rev/s);
  });

  it('describes the supplier profile and the extraction result', () => {
    expect(schemaOf('supplierProfile')['required']).toEqual(
      expect.arrayContaining(['supplier', 'kind', 'status', 'validFrom', 'recognise', 'fields']),
    );
    expect(schemaOf('supplierProfile')['description']).toMatch(/category/);
    expect(properties('supplierProfile')['kind']).toMatchObject({ enum: ['bill', 'tari'] });
    expect(properties('supplierProfile')['fields']).toBeDefined();
    expect(properties('extractionResult')['v']).toMatchObject({ const: 1 });
    expect(properties('extractionResult')['status']).toMatchObject({
      enum: ['riconosciuta', 'da-confermare', 'non-riconosciuta', 'senza-testo', 'illeggibile'],
    });
    expect(properties('extractionResult')['fileHash']).toMatchObject({ type: 'string' });
  });

  it('lists the allowed values of the enumerations', () => {
    expect(properties('bill')['category']).toMatchObject({
      enum: ['elettricita', 'gas', 'acqua', 'internet', 'altro'],
    });
    expect(properties('instalment')['rateCount']).toMatchObject({ enum: [1, 2, 3, 4, 6, 12] });
  });

  it('makes visibleToTenants optional with a default of false', () => {
    expect(schemaOf('note')['required']).not.toContain('visibleToTenants');
    expect(properties('note')['visibleToTenants']).toMatchObject({ default: false });
  });

  it('does not forbid unknown keys, so that a record can gain fields without breaking readers', () => {
    for (const kind of expectedKinds) {
      expect(schemaOf(kind)).not.toHaveProperty('additionalProperties', false);
    }
  });

  it('explains in prose the rules that JSON Schema cannot express', () => {
    expect(schemaOf('instalment')['description']).toMatch(/rateIndex/);
    expect(schemaOf('bill')['description']).toMatch(/periodStart/);
  });

  it('lists exactly the instalment counts that divide 12', () => {
    const divisors = Array.from({ length: 12 }, (_, index) => index + 1).filter(
      (count) => 12 % count === 0,
    );
    expect(properties('instalment')['rateCount']?.['enum']).toEqual(divisors);
  });
});

describe('patterns in the exported schemas', () => {
  // Python's jsonschema applies `pattern` with re.search, where `\d` also matches non-ASCII
  // digits, so every pattern spells its digits as [0-9].
  it.each(expectedKinds)('%s: no pattern uses \\d', (kind) => {
    const patterns = collectPatterns(schemaOf(kind));
    const offending = patterns.filter(([, pattern]) => pattern.includes('\\d'));
    expect(offending).toEqual([]);
  });

  it('has patterns to inspect', () => {
    expect(collectPatterns(schemaOf('bill')).length).toBeGreaterThan(0);
  });

  it('month pattern accepts exactly the months the model accepts', () => {
    const pattern = patternOf('payment', 'forMonth');
    const disagreements = [];
    for (let month = 0; month < 100; month++) {
      const text = `2026-${pad2(month)}`;
      const parsed = YearMonthSchema.safeParse(text).success;
      if (pattern.test(text) !== parsed) disagreements.push(text);
    }
    expect(disagreements).toEqual([]);
    expect(pattern.test('2026-13')).toBe(false);
    expect(pattern.test('2026-00')).toBe(false);
    expect(pattern.test('2026-1')).toBe(false);
    expect(pattern.test(ARABIC_INDIC_MONTH)).toBe(false);
  });

  it('date pattern checks the month and day ranges, the model also the day of the month', () => {
    const pattern = patternOf('bill', 'periodStart');
    // The pattern may only be looser than the model for days that the month does not have.
    const tooLoose = [];
    const tooStrict = [];
    for (let month = 0; month < 100; month++) {
      for (let day = 0; day < 100; day++) {
        const text = `2026-${pad2(month)}-${pad2(day)}`;
        const matches = pattern.test(text);
        const parsed = ISODateSchema.safeParse(text).success;
        if (parsed && !matches) tooStrict.push(text);
        if (matches && !parsed && day < 29) tooLoose.push(text);
      }
    }
    expect(tooStrict).toEqual([]);
    expect(tooLoose).toEqual([]);
    for (const text of ['2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', '2026-99-99']) {
      expect(pattern.test(text), text).toBe(false);
    }
    expect(pattern.test(ARABIC_INDIC_DATE)).toBe(false);
    expect(pattern.test('2026-02-28')).toBe(true);
  });

  it('timestamp pattern rejects invalid months, days, hours and non-ASCII digits', () => {
    const pattern = patternOf('note', 'at');
    expect(pattern.test('2026-11-10T20:15:00.000Z')).toBe(true);
    expect(pattern.test('2026-11-10T20:15:00Z')).toBe(true);
    for (const text of [
      '2026-13-10T20:15:00Z',
      '2026-00-10T20:15:00Z',
      '2026-11-32T20:15:00Z',
      '2026-11-10T24:00:00Z',
      '2026-11-10T20:60:00Z',
      '2026-11-10T20:15:00+01:00',
      '2026-11-10T20:15:00',
      `${ARABIC_INDIC_DATE}T20:15:00Z`,
    ]) {
      expect(pattern.test(text), text).toBe(false);
    }
  });

  it('version pattern accepts plain MAJOR.MINOR.PATCH only', () => {
    const pattern = patternOf('workspace', 'minAppVersion');
    expect(pattern.test('1.10.0')).toBe(true);
    for (const text of ['1.2', '01.2.3', '1.2.3-beta.1', '\u0661.\u0662.\u0663']) {
      expect(pattern.test(text), text).toBe(false);
    }
  });

  it('tells consumers what the patterns leave to them', () => {
    // Trailing newline: Python's `$` accepts one, ECMA 262's does not.
    for (const [kind, field] of [
      ['bill', 'periodStart'],
      ['payment', 'forMonth'],
      ['note', 'at'],
      ['workspace', 'minAppVersion'],
    ] as const) {
      expect(properties(kind)[field]?.['description'], `${kind}.${field}`).toMatch(/newline/i);
    }
    expect(properties('bill')['periodStart']?.['description']).toMatch(/day/);
  });
});

describe('serializeJsonSchema', () => {
  it('writes two-space indented JSON with a trailing newline', () => {
    expect(serializeJsonSchema({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });
});

describe('docs/schemas', () => {
  it('holds exactly one JSON file for each record kind, the workspace and the operations', () => {
    const files = readdirSync(SCHEMAS_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort();
    expect(files, REGENERATE).toEqual(expectedKinds.map((kind) => `${kind}.json`));
  });

  it.each(expectedKinds)('%s.json matches the schema generated from the model', (kind) => {
    const committed = readFileSync(join(SCHEMAS_DIR, `${kind}.json`), 'utf8');
    expect(committed, REGENERATE).toBe(serializeJsonSchema(schemaOf(kind)));
  });
});
