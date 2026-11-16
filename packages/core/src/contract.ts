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

/**
 * The cedolare ESTIMATE (R182): `totalRent × rateBp / 10000`, one rounding to the cent, half up.
 * Both figures are data typed by user1; the result is only shown, to be confirmed by user1.
 */
export function cedolareExpected(totalRent: Cents, rateBp: number): Cents {
  // BigInt: the product can pass Number.MAX_SAFE_INTEGER; rateBp <= 10000 keeps the result safe.
  return cents(Number((BigInt(totalRent) * BigInt(rateBp) + 5000n) / 10000n));
}

/**
 * The rate of the estimate of `apartmentId` in `year`: the one `cedolareRateBp` of its live
 * contracts with a month in the year, all `cedolare` with a rate; none for a mixed year (one of
 * them not `cedolare` or without a rate), for two different rates, or with no contract (R182).
 */
export function cedolareRateForYear(
  contracts: readonly Contract[],
  apartmentId: string,
  year: string,
): number | undefined {
  const rates = new Set(
    contracts
      .filter(
        (c) =>
          c.deleted !== true &&
          c.apartmentId === apartmentId &&
          c.start <= `${year}-12` &&
          `${year}-01` <= c.end,
      )
      .map((c) => (c.taxRegime === 'cedolare' ? c.cedolareRateBp : undefined)),
  );
  const [rate, ...others] = [...rates];
  return others.length === 0 ? rate : undefined;
}

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
  | 'contract-overlap'
  | 'takeover-unlinked'
  | 'takeover-dates'
  | 'payment-after-end';

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
    // Plan 11: takeovers written by hand or left by a later `contratto` without them.
    for (const t of contract.takeovers ?? []) {
      const at = { contractId, tenancyId: t.inTenancyId, from: t.month };
      const ids = contract.tenancyIds ?? [];
      if (!ids.includes(t.outTenancyId) || !ids.includes(t.inTenancyId)) {
        out.push({ code: 'takeover-unlinked', ...at });
        continue;
      }
      const leaving = tenancies.get(t.outTenancyId);
      const entering = tenancies.get(t.inTenancyId);
      if (
        leaving === undefined ||
        entering === undefined ||
        entering.from !== t.month ||
        leaving.to !== addMonths(t.month, -1)
      ) {
        out.push({ code: 'takeover-dates', ...at });
      }
    }
    // Plan 11: a confirmed rent for a month after the end of a linked stay, with no other stay of
    // the tenant in the apartment that month: a warning only (question 13 of the design).
    for (const tenancy of linked) {
      if (tenancy.to === undefined) continue;
      const end = tenancy.to;
      for (const payment of payments.values()) {
        const month = payment.forMonth ?? (payment.date.slice(0, 7) as YearMonth);
        if (
          payment.kind === 'canone' &&
          payment.confirmed &&
          payment.tenantId === tenancy.tenantId &&
          payment.apartmentId === tenancy.apartmentId &&
          month > end &&
          ![...tenancies.values()].some(
            (o) =>
              o.tenantId === tenancy.tenantId &&
              o.apartmentId === tenancy.apartmentId &&
              isPresent(o, month),
          )
        ) {
          out.push({
            code: 'payment-after-end',
            contractId,
            tenancyId: tenancy.id,
            paymentId: payment.id,
            from: month,
          });
        }
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
