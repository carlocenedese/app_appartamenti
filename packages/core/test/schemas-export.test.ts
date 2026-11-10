import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordSchemas } from '../src/model';
import { exportJsonSchemas, serializeJsonSchema } from '../src/schemas-json';

// docs/schemas holds one JSON Schema per record kind plus the workspace file. The Python side
// (plan 2) validates what it writes against these files, so the two languages cannot drift apart.
// A change to the model without `pnpm schemas:export` makes this test fail.

const SCHEMAS_DIR = fileURLToPath(new URL('../../../docs/schemas', import.meta.url));
const REGENERATE = 'Run `pnpm schemas:export` and commit docs/schemas.';

const expectedKinds = [...Object.keys(recordSchemas), 'workspace'].sort();

type JsonObject = Record<string, unknown>;

function schemaOf(kind: string): JsonObject {
  const schema = exportJsonSchemas()[kind];
  if (schema === undefined) throw new Error(`No schema exported for ${kind}`);
  return schema as JsonObject;
}

function properties(kind: string): Record<string, JsonObject> {
  return schemaOf(kind)['properties'] as Record<string, JsonObject>;
}

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
});

describe('serializeJsonSchema', () => {
  it('writes two-space indented JSON with a trailing newline', () => {
    expect(serializeJsonSchema({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });
});

describe('docs/schemas', () => {
  it('holds exactly one file for each record kind and the workspace', () => {
    const files = readdirSync(SCHEMAS_DIR).sort();
    expect(files, REGENERATE).toEqual(expectedKinds.map((kind) => `${kind}.json`));
  });

  it.each(expectedKinds)('%s.json matches the schema generated from the model', (kind) => {
    const committed = readFileSync(join(SCHEMAS_DIR, `${kind}.json`), 'utf8');
    expect(committed, REGENERATE).toBe(serializeJsonSchema(schemaOf(kind)));
  });
});
