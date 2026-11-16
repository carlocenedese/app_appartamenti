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
  yearMonth,
} from '../../src/index';
import type { ExcelInput, RecordKind } from '../../src/index';

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
export function fixtureInput(fixture: ExcelFixture = FIXTURE): ExcelInput {
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
    // The contract goes on for one more lease year (what `loadExcelInput` finds).
    nextPeriodFrom: yearMonth('2027-10'),
  };
}

export type StoreRecords = Partial<
  Record<RecordKind, readonly { id: string; rev: number; [key: string]: unknown }[]>
>;

/** A statement of the account of Nord, with no rows: it only says which days are covered. */
export const statementRecord = (id: string, from: string, to: string) => ({
  id,
  v: 1,
  rev: 1,
  accountId: 'acc-nord',
  bankProfileId: 'bp-sintetico',
  fileName: `${id}.xlsx`,
  suggestedPath: `Nord/Estratti/${id}.xlsx`,
  from,
  to,
  periodSource: 'file',
  rowCount: 0,
  transactionIds: [],
  held: [],
});

/**
 * The fixture as the records of a store: every record except the assumed match (assumed matches
 * are never saved), one account and statements for October-December 2026 and July-September
 * 2027, so the gas bill of March 2027 has no statement (assumed) and the water bill of July 2027
 * waits for its debit.
 */
export function fixtureRecords(fixture: ExcelFixture = FIXTURE): StoreRecords {
  return {
    apartment: fixture.apartments,
    contract: fixture.contracts,
    tenant: fixture.tenants,
    tenancy: fixture.tenancies,
    bill: fixture.bills,
    instalment: fixture.instalments,
    match: fixture.matches.filter((m) => m.by !== 'assumed'),
    payment: fixture.payments,
    account: [
      {
        id: 'acc-nord',
        v: 1,
        rev: 1,
        apartmentId: 'apt-nord',
        label: 'Conto Nord',
        bankProfileId: 'bp-sintetico',
      },
    ],
    statement: [
      statementRecord('st-1', '2026-10-01', '2026-12-31'),
      statementRecord('st-2', '2027-07-01', '2027-09-30'),
    ],
  };
}
