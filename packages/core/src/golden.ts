/**
 * The golden fixtures (fixtures/golden/*.json, Task 7 of plan 1): their shape and the settlement
 * they describe. Pure, so that the tests and `pnpm golden:report` share one definition; reading
 * the files is left to them. Not exported from the package index: only tests and scripts use it.
 */
import { z } from 'zod';
import { calcConguaglio } from './conguaglio';
import type { ConguaglioResult } from './conguaglio';
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
} from './model';
import type { Instalment } from './model';
import { annualitaRange, yearMonth } from './period';
import { compareText } from './text';

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

/**
 * The settlement of a fixture as the golden values describe it: the condominium is left out by
 * construction (section 42, R3; Task 7), so its instalments do not take part.
 */
export function settleGolden(fixture: GoldenFixture): ConguaglioResult {
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

/** One condominium fiscal year settled on its own months (Step 4b of Task 9). */
export interface CondominioYearCheck {
  esercizio: string;
  /** Items of that year still pending: the check holds only when there are none. */
  pending: string[];
  /** Tenants' rata and last year's settlement plus the same on empty beds. */
  shared: number;
  /** The tenants' quota of the budget (instalments minus the owner's yearly share) plus last year. */
  budget: number;
}

/**
 * The year-end check of the condominium: every fiscal year of the (non extraordinary) condominium
 * instalments is settled over its own 12 months, which need not be the lease year of the fixture,
 * and what reaches the tenants and the empty beds is compared with the budget. The owner's yearly
 * share is the `quotaProprieta` of the records with a non-zero `rata` (R-C8).
 */
export function condominioYearChecks(
  input: Pick<GoldenFixture, 'apartment' | 'instalments' | 'matches' | 'tenancies'>,
): CondominioYearCheck[] {
  const start = input.apartment.condominioStart;
  const byYear = new Map<string, Instalment[]>();
  for (const item of input.instalments) {
    if (item.kind !== 'condominio' || item.straordinaria === true) continue;
    byYear.set(item.esercizio, [...(byYear.get(item.esercizio) ?? []), item]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([esercizio, items]) => {
      if (start === undefined) {
        throw new RangeError('The apartment has condominium instalments but no condominioStart');
      }
      const range = annualitaRange(esercizio, start);
      const settled = calcConguaglio({
        apartment: input.apartment,
        period: {
          label: esercizio,
          from: yearMonth(range.from.slice(0, 7)),
          to: yearMonth(range.to.slice(0, 7)),
        },
        bills: [],
        instalments: items,
        matches: input.matches.filter((match) => match.part === 'amount'),
        tenancies: input.tenancies,
        payments: [],
      });
      const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
      const owner = items.find((item) => item.rata !== 0)?.quotaProprieta ?? 0;
      return {
        esercizio,
        pending: settled.pending.map((item) => item.itemId),
        shared:
          sum(settled.tenants.map((t) => t.condominio.rata + t.condominio.conguaglioPrec)) +
          settled.unassignedByBucket.rata +
          settled.unassignedByBucket.conguaglioPrec,
        budget: sum(items.map((item) => item.rata + item.conguaglioPrec)) - owner,
      };
    });
}
