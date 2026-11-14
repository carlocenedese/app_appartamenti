import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonSchemas } from './export-schemas.mjs';

// The content of the generated files is checked against the model by
// packages/core/test/schemas-export.test.ts; this covers what the script does to the folder.

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'export-schemas-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('writeJsonSchemas', () => {
  it('creates the folder and writes one JSON file per record kind, the workspace and the operations', () => {
    const outDir = join(root, 'nested', 'schemas');
    const written = writeJsonSchemas(outDir);
    const expected = [
      'account',
      'apartment',
      'bankProfile',
      'bill',
      'contract',
      'extractionResult',
      'instalment',
      'match',
      'note',
      'operation',
      'payment',
      'statement',
      'supplierProfile',
      'supply',
      'tenancy',
      'transaction',
      'user',
      'workspace',
    ].map((kind) => `${kind}.json`);
    expect(readdirSync(outDir).sort()).toEqual(expected);
    expect(written.sort()).toEqual(expected);
  });

  it('writes parseable JSON that ends with a newline', () => {
    const outDir = join(root, 'schemas');
    writeJsonSchemas(outDir);
    const text = readFileSync(join(outDir, 'bill.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text).properties.amount.type).toBe('integer');
  });

  it('is idempotent', () => {
    const outDir = join(root, 'schemas');
    writeJsonSchemas(outDir);
    const first = readFileSync(join(outDir, 'note.json'), 'utf8');
    writeJsonSchemas(outDir);
    expect(readFileSync(join(outDir, 'note.json'), 'utf8')).toBe(first);
  });

  it('replaces edited files and removes JSON files of kinds that no longer exist', () => {
    const outDir = join(root, 'schemas');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'bill.json'), '{}\n');
    writeFileSync(join(outDir, 'old-kind.json'), '{}\n');
    writeFileSync(join(outDir, 'README.md'), 'keep me\n');
    writeJsonSchemas(outDir);
    expect(readdirSync(outDir)).not.toContain('old-kind.json');
    expect(readdirSync(outDir)).toContain('README.md');
    expect(JSON.parse(readFileSync(join(outDir, 'bill.json'), 'utf8')).type).toBe('object');
  });
});
