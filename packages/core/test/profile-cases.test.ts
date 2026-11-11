import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SupplierProfileSchema } from '../src/model';

// python/tests/data/profile-cases.json is also read by python/tests/test_schemas.py, which runs
// the JSON Schema and check_profile_rules on the same cases. The two languages must agree: a
// difference is a test failure on one side or the other.

interface Case {
  name: string;
  valid: boolean;
  set?: Record<string, unknown>;
  unset?: string[];
}

const FILE = fileURLToPath(
  new URL('../../../python/tests/data/profile-cases.json', import.meta.url),
);
const { base, cases } = JSON.parse(readFileSync(FILE, 'utf8')) as {
  base: Record<string, unknown>;
  cases: Case[];
};

function profileOf(testCase: Case): Record<string, unknown> {
  const unset = new Set(testCase.unset ?? []);
  return Object.fromEntries(
    Object.entries({ ...base, ...testCase.set }).filter(([key]) => !unset.has(key)),
  );
}

describe('supplier profile cases shared with Python', () => {
  it('has cases of both verdicts', () => {
    expect(cases.some((testCase) => testCase.valid)).toBe(true);
    expect(cases.some((testCase) => !testCase.valid)).toBe(true);
  });

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    expect(SupplierProfileSchema.safeParse(profileOf(testCase)).success).toBe(testCase.valid);
  });
});
