// Reading the golden fixtures (fixtures/golden/*.json) for the tests. Their shape and the
// settlement they describe are in src/golden.ts, shared with `pnpm golden:report`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoldenFixtureSchema } from '../../src/golden';
import type { GoldenFixture } from '../../src/golden';

export const GOLDEN_DIR = fileURLToPath(new URL('../../../../fixtures/golden/', import.meta.url));

/** The file names of the golden fixtures, sorted. */
export function goldenFiles(dir = GOLDEN_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** The raw text of a fixture file and the fixture it parses to. */
export function readGolden(
  name: string,
  dir = GOLDEN_DIR,
): { text: string; fixture: GoldenFixture } {
  const text = readFileSync(join(dir, name), 'utf8');
  return { text, fixture: GoldenFixtureSchema.parse(JSON.parse(text)) };
}
