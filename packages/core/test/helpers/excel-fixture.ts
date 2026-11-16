// The invented lease year of `fixtures/excel/anno-esempio.json` (plan 5), checked against the
// record schemas and turned into the input of the Excel of `apt-nord`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ApartmentSchema,
  BillMatchSchema,
  BillSchema,
  ContractSchema,
  InstalmentSchema,
  PaymentSchema,
  TenancySchema,
  TenantSchema,
  YearMonthSchema,
} from '../../src/index';
import type { ConguaglioInput, Tenant } from '../../src/index';

export const ExcelFixtureSchema = z.object({
  description: z.string(),
  apartmentId: z.string(),
  period: z.object({ label: z.string(), from: YearMonthSchema, to: YearMonthSchema }),
  apartments: z.array(ApartmentSchema),
  contracts: z.array(ContractSchema),
  tenants: z.array(TenantSchema),
  tenancies: z.array(TenancySchema),
  bills: z.array(BillSchema),
  instalments: z.array(InstalmentSchema),
  matches: z.array(BillMatchSchema),
  payments: z.array(PaymentSchema),
});
export type ExcelFixture = z.infer<typeof ExcelFixtureSchema>;

export const FIXTURE: ExcelFixture = ExcelFixtureSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../fixtures/excel/anno-esempio.json', import.meta.url)),
      'utf8',
    ),
  ),
);

/** The input of the Excel of the fixture's apartment and period (a fresh copy each time). */
export function fixtureInput(
  fixture: ExcelFixture = FIXTURE,
): ConguaglioInput & { tenants: Tenant[] } {
  const copy = structuredClone(fixture);
  const apartment = copy.apartments.find((a) => a.id === copy.apartmentId);
  if (apartment === undefined) throw new Error('The fixture has no apartment of its own');
  return {
    apartment,
    period: copy.period,
    bills: copy.bills,
    instalments: copy.instalments,
    matches: copy.matches,
    tenancies: copy.tenancies,
    payments: copy.payments,
    tenants: copy.tenants,
  };
}
