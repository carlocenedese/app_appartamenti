/**
 * Lease contracts (plan 7): the rent of a month from the contract's history, and the read-only
 * checks between contracts, tenancies and deposits. Pure: nothing here writes or corrects data.
 */
import { isPresent } from './conguaglio';
import type { Contract, ContractRent, Payment, Tenancy } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { addMonths } from './period';
import type { YearMonth } from './period';

/** The entry of `rent` with the largest `from` not after `month`; none before the first entry. */
export function rentForMonth(
  contract: Pick<Contract, 'rent'>,
  month: YearMonth,
): ContractRent | undefined {
  // `rent` is sorted by `from` (schema refine).
  return [...(contract.rent ?? [])].reverse().find((entry) => entry.from <= month);
}

export type ContractCheckCode =
  | 'unknown-tenancy'
  | 'tenancy-other-apartment'
  | 'tenancy-outside-contract'
  | 'tenancy-linked-twice'
  | 'unlinked-tenancy'
  | 'unknown-deposit'
  | 'deposit-other-tenant'
  | 'rent-differs'
  | 'contract-overlap';

export interface ContractCheck {
  code: ContractCheckCode;
  contractId: string;
  /** `contract-overlap`: the other live contract of the apartment, after `contractId` by id. */
  otherContractId?: string;
  tenancyId?: string;
  paymentId?: string;
  from?: YearMonth;
  to?: YearMonth;
  expected?: Cents;
  actual?: Cents;
}

const overlaps = (tenancy: Tenancy, contract: Contract): boolean =>
  tenancy.from <= contract.end && (tenancy.to === undefined || contract.start <= tenancy.to);

const compare = (a: string | undefined, b: string | undefined): number => {
  const [x, y] = [a ?? '', b ?? ''];
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * The checks of the live contracts (plan 7, design section 3), ordered by `contractId`, `code`,
 * `otherContractId`, `tenancyId`, `paymentId`, `from`. A list to show, never a correction and never a block.
 */
export function contractChecks(input: {
  contracts: readonly Contract[];
  tenancies: readonly Tenancy[];
  payments: readonly Payment[];
  asOf: YearMonth;
}): ContractCheck[] {
  const contracts = input.contracts.filter((c) => c.deleted !== true);
  const tenancies = new Map(
    input.tenancies.filter((t) => t.deleted !== true).map((t) => [t.id, t]),
  );
  const payments = new Map(input.payments.filter((p) => p.deleted !== true).map((p) => [p.id, p]));
  const linkCount = new Map<string, number>();
  for (const id of contracts.flatMap((c) => c.tenancyIds ?? [])) {
    linkCount.set(id, (linkCount.get(id) ?? 0) + 1);
  }
  const out: ContractCheck[] = [];

  for (const contract of contracts) {
    const contractId = contract.id;
    const linked: Tenancy[] = [];
    for (const tenancyId of contract.tenancyIds ?? []) {
      const tenancy = tenancies.get(tenancyId);
      const at = { contractId, tenancyId };
      if (tenancy === undefined) {
        out.push({ code: 'unknown-tenancy', ...at });
        continue;
      }
      linked.push(tenancy);
      if (tenancy.apartmentId !== contract.apartmentId) {
        out.push({ code: 'tenancy-other-apartment', ...at });
      } else if (
        tenancy.from < contract.start ||
        tenancy.to === undefined ||
        tenancy.to > contract.end
      ) {
        out.push({ code: 'tenancy-outside-contract', ...at });
      }
      if ((linkCount.get(tenancyId) ?? 0) > 1) out.push({ code: 'tenancy-linked-twice', ...at });
    }
    const tenants = new Set(linked.map((t) => t.tenantId));
    for (const paymentId of contract.depositPaymentIds ?? []) {
      const payment = payments.get(paymentId);
      if (
        payment === undefined ||
        payment.kind !== 'caparra' ||
        payment.apartmentId !== contract.apartmentId
      ) {
        out.push({ code: 'unknown-deposit', contractId, paymentId });
      } else if (!tenants.has(payment.tenantId)) {
        out.push({ code: 'deposit-other-tenant', contractId, paymentId });
      }
    }
  }

  for (const contract of contracts)
    out.push(...rentDiffers(contract, [...tenancies.values()], input.asOf));

  // Two live contracts of one apartment with months in common: two rents for the same month.
  const byId = [...contracts].sort((a, b) => compare(a.id, b.id));
  byId.forEach((a, i) => {
    for (const b of byId.slice(i + 1)) {
      const from = a.start > b.start ? a.start : b.start;
      const to = a.end < b.end ? a.end : b.end;
      if (a.apartmentId === b.apartmentId && from <= to) {
        out.push({ code: 'contract-overlap', contractId: a.id, otherContractId: b.id, from, to });
      }
    }
  });

  // Only where the apartment uses links, so apartments without them give no warning per tenancy.
  const linking = contracts
    .filter((c) => c.tenancyIds !== undefined)
    .sort((a, b) => compare(a.id, b.id));
  for (const tenancy of tenancies.values()) {
    if (linkCount.has(tenancy.id)) continue;
    const first = linking.find(
      (c) => c.apartmentId === tenancy.apartmentId && overlaps(tenancy, c),
    );
    if (first !== undefined) {
      out.push({ code: 'unlinked-tenancy', contractId: first.id, tenancyId: tenancy.id });
    }
  }

  return out.sort(
    (a, b) =>
      compare(a.contractId, b.contractId) ||
      compare(a.code, b.code) ||
      compare(a.otherContractId, b.otherContractId) ||
      compare(a.tenancyId, b.tenancyId) ||
      compare(a.paymentId, b.paymentId) ||
      compare(a.from, b.from),
  );
}

/**
 * R4 on the rent history: for each month from `start` to `min(end, asOf)` with a known rent, the
 * contract's rent plus advance against the rent plus flat charge of every live tenancy of the
 * apartment present in the month (linked or not). Equal consecutive months form one interval.
 */
function rentDiffers(
  contract: Contract,
  tenancies: readonly Tenancy[],
  asOf: YearMonth,
): ContractCheck[] {
  const own = tenancies.filter((t) => t.apartmentId === contract.apartmentId);
  const last = contract.end < asOf ? contract.end : asOf;
  const out: ContractCheck[] = [];
  let open: ContractCheck | undefined;
  for (let month = contract.start; month <= last; month = addMonths(month, 1)) {
    const rent = rentForMonth(contract, month);
    const expected = rent === undefined ? undefined : rent.monthlyRent + rent.monthlyAdvance;
    const actual = own
      .filter((t) => isPresent(t, month))
      .reduce((sum, t) => sum + t.monthlyRent + t.monthlyForfait, 0);
    if (expected === undefined || expected === actual) {
      open = undefined;
    } else if (open?.expected === expected && open.actual === actual) {
      open.to = month;
    } else {
      open = {
        code: 'rent-differs',
        contractId: contract.id,
        from: month,
        to: month,
        expected: cents(expected),
        actual: cents(actual),
      };
      out.push(open);
    }
  }
  return out;
}
