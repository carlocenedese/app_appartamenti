/**
 * The data of the Excel of one apartment and one period, read from the store (plan 5, R155).
 * The period comes from the apartment's contracts (`settlementPeriods`); the matches are the
 * saved ones plus the assumed ones `planMatch` computes (R2: with no statement an item is taken
 * as paid). Writes nothing.
 */
import type { ZodType } from 'zod';
import type { ExcelInput } from './excel';
import { checkConsistency } from './journal';
import { planMatch } from './match-store';
import {
  ApartmentSchema,
  BillMatchSchema,
  BillSchema,
  ContractSchema,
  InstalmentSchema,
  PaymentSchema,
  TenancySchema,
  TenantSchema,
} from './model';
import { settlementPeriods } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';

export type LoadExcelInputResult =
  | { status: 'ok'; input: ExcelInput }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-apartment' | 'unknown-period' | 'ambiguous-period';
    };

/**
 * The `ExcelInput` of `query.apartmentId` and the period labelled `query.periodLabel` among the
 * settlement periods of its live contracts. Refused while `checkConsistency` reports a problem,
 * for an apartment that is not live, for a label of no period, and for one label with two
 * different spans of months.
 */
export async function loadExcelInput(
  store: Store,
  query: { apartmentId: string; periodLabel: string },
): Promise<LoadExcelInputResult> {
  const refuse = (reason: Extract<LoadExcelInputResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const records = async <T extends { id: string }>(kind: string, schema: ZodType<T>) =>
    (await loadAll(store, kind, schema)).records;
  const apartment = (await records('apartment', ApartmentSchema)).find(
    (a) => a.id === query.apartmentId,
  );
  if (apartment === undefined) return refuse('unknown-apartment');
  const own = <T extends { apartmentId: string }>(list: T[]) =>
    list.filter((r) => r.apartmentId === apartment.id);

  const periods = own(await records('contract', ContractSchema))
    .flatMap((contract) => settlementPeriods(contract, apartment.annualitaStart))
    .filter((p) => p.label === query.periodLabel);
  const [period] = periods;
  if (period === undefined) return refuse('unknown-period');
  if (periods.some((p) => p.from !== period.from || p.to !== period.to)) {
    return refuse('ambiguous-period');
  }

  return {
    status: 'ok',
    input: {
      apartment,
      period: { label: period.label, from: period.from, to: period.to },
      tenants: await records('tenant', TenantSchema),
      tenancies: own(await records('tenancy', TenancySchema)),
      bills: own(await records('bill', BillSchema)),
      instalments: own(await records('instalment', InstalmentSchema)),
      payments: own(await records('payment', PaymentSchema)),
      matches: [
        ...(await records('match', BillMatchSchema)),
        ...(await planMatch(store)).assumedMatches,
      ],
    },
  };
}
