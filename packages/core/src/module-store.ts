/**
 * The data of the forms of one tenancy, read from the store (plan 12, R232). Writes nothing.
 */
import type { ZodType } from 'zod';
import { checkConsistency } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  ContractSchema,
  TenancySchema,
  TenantCardSchema,
  TenantSchema,
} from './model';
import type { ModuleData } from './modules';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';

export type LoadModuleDataResult =
  | { status: 'ok'; data: ModuleData }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'unknown-tenancy'
        | 'unknown-apartment'
        | 'unknown-tenant'
        | 'ambiguous-contract';
    };

/**
 * The live tenancy `tenancyId` with its live apartment and tenant, the live contract that links it
 * (`tenancyIds`; none is fine, two are `ambiguous-contract`) and the distinct IBANs of the live
 * accounts of the apartment, sorted. Refused while `checkConsistency` reports a problem.
 */
export async function loadModuleData(
  store: Store,
  query: { tenancyId: string },
): Promise<LoadModuleDataResult> {
  const refuse = (reason: Extract<LoadModuleDataResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  // `loadAll` leaves deleted records out.
  const live = async <T extends { id: string }>(kind: string, schema: ZodType<T>) =>
    (await loadAll(store, kind, schema)).records;
  const tenancy = (await live('tenancy', TenancySchema)).find((t) => t.id === query.tenancyId);
  if (tenancy === undefined) return refuse('unknown-tenancy');
  const apartment = (await live('apartment', ApartmentSchema)).find(
    (a) => a.id === tenancy.apartmentId,
  );
  if (apartment === undefined) return refuse('unknown-apartment');
  const tenant = (await live('tenant', TenantSchema)).find((t) => t.id === tenancy.tenantId);
  if (tenant === undefined) return refuse('unknown-tenant');
  const contracts = (await live('contract', ContractSchema)).filter((c) =>
    (c.tenancyIds ?? []).includes(tenancy.id),
  );
  if (contracts.length > 1) return refuse('ambiguous-contract');
  const ibans = (await live('account', AccountSchema))
    .filter((a) => a.apartmentId === apartment.id)
    .flatMap((a) => (a.iban === undefined ? [] : [a.iban]));
  const card = (await live('tenantCard', TenantCardSchema)).find((c) => c.id === tenant.id);
  const data: ModuleData = {
    apartment,
    tenant,
    ...(card === undefined ? {} : { card }),
    tenancy,
    ibans: [...new Set(ibans)].sort(compareText),
  };
  const [contract] = contracts;
  if (contract !== undefined) data.contract = contract;
  return { status: 'ok', data };
}
