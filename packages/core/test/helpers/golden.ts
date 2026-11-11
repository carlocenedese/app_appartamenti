// The shape of a golden fixture (fixtures/golden/*.json, Task 7 of plan 1) and how to read them.
// Shared by the structural test, the settlement test and `pnpm golden:report`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  CentsSchema,
  ContractSchema,
  InstalmentSchema,
  PaymentSchema,
  TenancySchema,
  YearMonthSchema,
  calcConguaglio,
} from '../../src/index';

export const GOLDEN_DIR = fileURLToPath(new URL('../../../../fixtures/golden/', import.meta.url));

export const GoldenFixtureSchema = z.strictObject({
  apartment: ApartmentSchema,
  contract: ContractSchema,
  period: z.strictObject({ label: z.string().min(1), from: YearMonthSchema, to: YearMonthSchema }),
  bills: z.array(BillSchema),
  instalments: z.array(InstalmentSchema),
  payments: z.array(PaymentSchema),
  transactions: z.array(BankTransactionSchema),
  matches: z.array(BillMatchSchema),
  tenancies: z.array(TenancySchema),
  expectedPending: z.array(z.string()),
  expected: z.array(
    z.strictObject({
      tenantId: z.string().min(1),
      due: CentsSchema,
      forfaitIncassato: CentsSchema,
      byCategory: z.record(z.string(), CentsSchema),
    }),
  ),
  expectedUnassigned: CentsSchema,
  /** What the Excel charges each tenant, by category (costs only), for the difference report. */
  excel: z
    .array(
      z.strictObject({
        tenantId: z.string().min(1),
        byCategory: z.record(z.string(), CentsSchema),
      }),
    )
    .optional(),
  approvedBy: z.string().min(1),
  knownDeviations: z.array(z.strictObject({ what: z.string().min(1), why: z.string().min(1) })),
});
export type GoldenFixture = z.infer<typeof GoldenFixtureSchema>;

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

/**
 * The settlement of a fixture as the golden values describe it: the condominium is left out by
 * construction (section 42, R3; Task 7), so its instalments do not take part.
 */
export function settleGolden(fixture: GoldenFixture): ReturnType<typeof calcConguaglio> {
  return calcConguaglio({
    apartment: fixture.apartment,
    period: fixture.period,
    bills: fixture.bills,
    instalments: fixture.instalments.filter((instalment) => instalment.kind !== 'condominio'),
    matches: fixture.matches,
    tenancies: fixture.tenancies,
    payments: fixture.payments,
  });
}

/** The cost categories of a settlement row, without the condominium. */
export function costsWithoutCondominio(
  byCategory: Partial<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(byCategory).filter(
      (entry): entry is [string, number] => entry[0] !== 'condominio' && entry[1] !== undefined,
    ),
  );
}
