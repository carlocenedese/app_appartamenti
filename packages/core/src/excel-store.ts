/**
 * The data of the Excel of one apartment and one period, read from the store (plan 5, R155).
 * The period comes from the apartment's contracts (`settlementPeriods`); the matches are the
 * saved ones: an item with no statement is never taken as paid, the items `planMatch` leaves to
 * verify are pending «da verificare» (B1). Writes nothing.
 */
import type { ZodType } from 'zod';
import type { ExcelInput } from './excel';
import { loadFreeDebits } from './condo-store';
import { recoverableMovements } from './condominio';
import { writesBlocked } from './journal';
import { planMatch } from './match-store';
import {
  ApartmentSchema,
  BankTransactionSchema,
  MovementClassSchema,
  BillMatchSchema,
  BillSchema,
  ContractSchema,
  InstalmentSchema,
  PaymentSchema,
  PeriodCloseSchema,
  TenancySchema,
  TenantRecoverySchema,
  TenantSchema,
} from './model';
import { isLiveClose, periodCloseId } from './closing';
import { splitOfClosing } from './conguaglio';
import { withContractEnds } from './contract';
import { settlementPeriods } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';

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
  if (await writesBlocked(store)) return refuse('inconsistent-store');
  const records = async <T extends { id: string }>(kind: string, schema: ZodType<T>) =>
    (await loadAll(store, kind, schema)).records;
  const apartment = (await records('apartment', ApartmentSchema)).find(
    (a) => a.id === query.apartmentId,
  );
  if (apartment === undefined) return refuse('unknown-apartment');
  const own = <T extends { apartmentId: string }>(list: T[]) =>
    list.filter((r) => r.apartmentId === apartment.id);

  const contracts = own(await records('contract', ContractSchema));
  const all = contracts.flatMap((contract) =>
    settlementPeriods(contract, apartment.annualitaStart),
  );
  const periods = all.filter((p) => p.label === query.periodLabel);
  const [period] = periods;
  if (period === undefined) return refuse('unknown-period');
  if (periods.some((p) => p.from !== period.from || p.to !== period.to)) {
    return refuse('ambiguous-period');
  }

  const matches = await records('match', BillMatchSchema);
  // Every settlement period, once and in order (R177).
  const spans = [
    ...new Map(all.map((p) => [`${p.from}/${p.to}`, { from: p.from, to: p.to }])).values(),
  ].sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
  // R5: the live closing of the period, if it is closed (a reopened one is open again, F3).
  const closing = (await records('periodClose', PeriodCloseSchema)).find(
    (c) => c.id === periodCloseId(apartment.id, period.label) && isLiveClose(c),
  );
  return {
    status: 'ok',
    input: {
      apartment,
      period: { label: period.label, from: period.from, to: period.to },
      periods: spans,
      tenants: await records('tenant', TenantSchema),
      // F9 a: a stay without end lasts until the end of its contract.
      tenancies: withContractEnds(own(await records('tenancy', TenancySchema)), contracts),
      bills: own(await records('bill', BillSchema)),
      instalments: own(await records('instalment', InstalmentSchema)),
      payments: own(await records('payment', PaymentSchema)),
      contracts,
      recoveries: own(await records('tenantRecovery', TenantRecoverySchema)),
      recoverableMovements: recoverableMovements({
        apartmentId: apartment.id,
        transactions: await records('transaction', BankTransactionSchema),
        classes: await records('movementClass', MovementClassSchema),
      }),
      matches,
      unverified: (await planMatch(store)).run.unverified,
      freeDebits: await loadFreeDebits(store, matches),
      ...(closing === undefined ? {} : { closing }),
      // R363: a period closed before plan 21 is recomputed with the split over the beds.
      split: splitOfClosing(closing),
    },
  };
}
