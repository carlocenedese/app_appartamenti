/**
 * Deposits (plan 11): the check of the deposit paid against the one expected, and the return
 * statement (`caparraReturn` with `legalInterest`). Read only; the expected deposit, the rates, the
 * interest dates, the conguaglio and the extra charges are data typed by user1, never in the code.
 */
import { caparraReturn } from './caparra';
import type { CaparraReturn } from './caparra';
import { legalInterest } from './interest';
import type { RatePeriod } from './interest';
import { checkConsistency } from './journal';
import { PaymentSchema, TenancySchema } from './model';
import type { Payment, Tenancy } from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { compareText } from './text';

export type DepositStatus = 'non-impostata' | 'mancante' | 'diversa' | 'versata';

export interface DepositCheck {
  apartmentId: string;
  tenantId: string;
  /** The expected deposit of the latest live tenancy (by `from`) that has one. */
  expected?: Cents;
  /** Live confirmed `caparra` payments with a positive amount. */
  paid: Cents;
  /** The returns: live confirmed `caparra` payments with a negative amount, as a positive sum. */
  returned: Cents;
  status: DepositStatus;
}

/**
 * The deposit of each tenant with a live tenancy, per apartment (a renewal does not ask for a
 * second deposit), sorted by apartment and tenant. A warning only: never a correction.
 */
export function depositChecks(input: {
  tenancies: readonly Tenancy[];
  payments: readonly Payment[];
}): DepositCheck[] {
  const tenancies = input.tenancies
    .filter((t) => t.deleted !== true)
    .sort((a, b) => compareText(a.from, b.from));
  const pairs = new Map(tenancies.map((t) => [`${t.apartmentId}\u0000${t.tenantId}`, t]));
  return [...pairs.values()]
    .map(({ apartmentId, tenantId }): DepositCheck => {
      const expected = tenancies
        .filter((t) => t.apartmentId === apartmentId && t.tenantId === tenantId)
        .map((t) => t.expectedDeposit)
        .filter((d) => d !== undefined)
        .at(-1);
      const amounts = input.payments
        .filter(
          (p) =>
            p.deleted !== true &&
            p.confirmed &&
            p.kind === 'caparra' &&
            p.apartmentId === apartmentId &&
            p.tenantId === tenantId,
        )
        .map((p) => p.amount);
      const paid = cents(amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0));
      const returned = cents(-amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0));
      const status: DepositStatus =
        expected === undefined
          ? 'non-impostata'
          : paid === 0
            ? 'mancante'
            : paid === expected
              ? 'versata'
              : 'diversa';
      return {
        apartmentId,
        tenantId,
        ...(expected === undefined ? {} : { expected }),
        paid,
        returned,
        status,
      };
    })
    .sort(
      (a, b) => compareText(a.apartmentId, b.apartmentId) || compareText(a.tenantId, b.tenantId),
    );
}

export interface DepositReturnInput {
  apartmentId: string;
  tenantId: string;
  /** First and last day of the interest, typed by user1 (question 1 of the design). */
  from: ISODate;
  to: ISODate;
  /** Legal rates by year, typed by user1. */
  rates: readonly RatePeriod[];
  /** The tenant's conguaglio typed by user1: positive is a debt (question 2). */
  conguaglio: Cents;
  extraCharges: readonly { label: string; amount: Cents }[];
}

export type DepositReturnResult =
  | { status: 'computed'; statement: CaparraReturn }
  | {
      status: 'refused';
      reason:
        'inconsistent-store' | 'no-deposit' | 'already-returned' | 'invalid-dates' | 'missing-rate';
    };

/**
 * The return statement of the deposit of `tenantId` in `apartmentId`: the deposit paid (as
 * `depositChecks`), plus `legalInterest` on it from `from` to `to`, minus the conguaglio and the
 * extra charges (`caparraReturn`). Read only. Refused: `inconsistent-store`; `no-deposit` (nothing
 * paid); `already-returned` (a return is already registered); `invalid-dates` (`to` before
 * `from`); `missing-rate` (a year without a rate, or rates `legalInterest` refuses).
 */
export async function loadDepositReturn(
  store: Store,
  input: DepositReturnInput,
): Promise<DepositReturnResult> {
  const refuse = (reason: Extract<DepositReturnResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const check = depositChecks({
    tenancies: (await loadAll(store, 'tenancy', TenancySchema)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
  }).find((c) => c.apartmentId === input.apartmentId && c.tenantId === input.tenantId);
  if (check === undefined || check.paid === 0) return refuse('no-deposit');
  if (check.returned > 0) return refuse('already-returned');
  if (input.to < input.from) return refuse('invalid-dates');
  let interest: Cents;
  try {
    interest = legalInterest(check.paid, input.rates, input.from, input.to);
  } catch (error) {
    if (error instanceof RangeError) return refuse('missing-rate');
    throw error;
  }
  return {
    status: 'computed',
    statement: caparraReturn({
      caparra: check.paid,
      interest,
      conguaglio: input.conguaglio,
      extraCharges: input.extraCharges,
    }),
  };
}
