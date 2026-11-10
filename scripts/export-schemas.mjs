// Writes the JSON Schema of every record kind and of the workspace file to docs/schemas/<kind>.json
// (`pnpm schemas:export`). The Python side (plan 2) validates what it writes against these files,
// so the two languages cannot drift apart.
//
// The schemas come from the Zod schemas of packages/core (src/schemas-json.ts), which is TypeScript:
// the script runs through tsx. The output is deterministic (fixed key order, two-space indentation,
// final newline) and docs/schemas is listed in .prettierignore so that Prettier does not reflow it.
// packages/core/test/schemas-export.test.ts compares the committed files with freshly generated
// ones, so a change to the model without running this script fails the tests.
//
// JSON files in the folder that no longer match a kind are removed; other files are left alone.

import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJsonSchemas, serializeJsonSchema } from '../packages/core/src/schemas-json.ts';

const DEFAULT_OUT_DIR = fileURLToPath(new URL('../docs/schemas/', import.meta.url));

/** Writes the schema files into `outDir` and returns the names of the files it wrote. */
export function writeJsonSchemas(outDir) {
  const schemas = exportJsonSchemas();
  const fileNames = Object.keys(schemas).map((kind) => `${kind}.json`);

  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.json') && !fileNames.includes(file)) rmSync(join(outDir, file));
  }
  for (const [kind, schema] of Object.entries(schemas)) {
    writeFileSync(join(outDir, `${kind}.json`), serializeJsonSchema(schema), 'utf8');
  }
  return fileNames;
}

function main() {
  const written = writeJsonSchemas(DEFAULT_OUT_DIR);
  console.log(`Wrote ${written.length} JSON Schema files to docs/schemas.`);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntryPoint) main();
