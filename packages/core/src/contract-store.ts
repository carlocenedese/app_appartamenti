/**
 * Writing lease contracts (plan 7): the contract data (`saveContract`) and its rent history
 * (`setContractRent`), each write one operation of the journal, nothing written while
 * `checkConsistency` reports a problem (R113), nothing for the same request on the same state.
 * No write ever touches a tenancy, a payment or another contract; no amount, code or name in a
 * summary.
 */
import { cedolareExpected, cedolareRateForYear, contractChecks } from './contract';
import type { ContractCheck } from './contract';
import { checkConsistency, commitChange } from './journal';
import {
  ApartmentSchema,
  ContractSchema,
  PaymentSchema,
  RentYearSchema,
  TenancySchema,
  YearSchema,
  rentHistoryValid,
} from './model';
import type { Contract, Tenancy } from './model';
import { depositChecks } from './deposit';
import type { DepositCheck } from './deposit';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export type ContractInput = Omit<Contract, 'v' | 'rev' | 'deleted' | 'rent' | 'takeovers'>;

export type SaveContractResult =
  | { status: 'saved'; operationId: string; contractId: string }
  | { status: 'unchanged'; contractId: string }
  | {
      status: 'refused';
      reason:
        | 'inconsistent-store'
        | 'invalid-contract'
        | 'unknown-apartment'
        | 'unknown-tenancy'
        | 'unknown-deposit'
        | 'rent-outside-contract'
        | 'takeover-unlinked';
    };

export interface SetContractRentInput {
  contractId: string;
  from: YearMonth;
  monthlyRent: Cents;
  monthlyAdvance: Cents;
}

export type SetContractRentResult =
  | { status: 'saved'; operationId: string; contractId: string }
  | { status: 'unchanged'; contractId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-contract' | 'month-outside-contract' | 'bad-amount';
    };

async function contractsWithDeleted(store: Store): Promise<Contract[]> {
  return (await loadAll(store, 'contract', ContractSchema, { includeDeleted: true })).records;
}

/** Writes `after` over `before` in one operation, or says nothing changed. */
async function write(
  store: Store,
  before: Contract | undefined,
  after: Contract,
  meta: { kind: string; summary: string; profileId: string },
  clock: () => string,
  newId: () => string,
): Promise<
  | { status: 'saved'; operationId: string; contractId: string }
  | { status: 'unchanged'; contractId: string }
> {
  // Both parsed by the same schema: same keys in the same order when the content is the same.
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify({ ...after, rev: before.rev }) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', contractId: after.id };
  }
  const operation = await commitChange(
    store,
    {
      profileId: meta.profileId,
      kind: meta.kind,
      apartmentId: after.apartmentId,
      summary: meta.summary,
      changes: [{ path: recordPath('contract', after.id), before, after }],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, contractId: after.id };
}

/**
 * Creates or updates `input.id` (a new `rev`; a deleted one comes back) in one `contract.save`
 * operation. Every data field is replaced except `rent` and `takeovers` (plan 11), which stay as
 * stored (absent for a new contract). Refused without writing, in this order: `inconsistent-store`;
 * `invalid-contract` (the input with `rent`, `takeovers` or `deleted`, or one the schema refuses: `start` after `end`, a rate
 * without `taxRegime: 'cedolare'`, a repeated id, ...); `unknown-apartment`
 * (absent or deleted); `unknown-tenancy` (a `tenancyIds` entry is not a live tenancy of the same
 * apartment); `unknown-deposit` (a `depositPaymentIds` entry is not a live `caparra` payment of
 * the same apartment); `rent-outside-contract` (the new dates leave a rent entry out);
 * `takeover-unlinked` (plan 11: a tenancy of a stored takeover is not in the new `tenancyIds`). The dates
 * of the tenancies are not checked here: a tenancy outside them is saved and shows in the checks.
 */
export async function saveContract(
  store: Store,
  input: ContractInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SaveContractResult> {
  const refuse = (reason: Extract<SaveContractResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  // A constant refusal, never a ZodError: the rent history and the takeovers have their own writes.
  if (
    'rent' in input ||
    'takeovers' in input ||
    'deleted' in input ||
    !ContractSchema.safeParse({ ...input, v: 1, rev: 1 }).success
  ) {
    return refuse('invalid-contract');
  }
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records;
  const ownTenancy = (id: string) =>
    tenancies.some((t) => t.id === id && t.apartmentId === input.apartmentId);
  if (!(input.tenancyIds ?? []).every(ownTenancy)) return refuse('unknown-tenancy');
  const payments = (await loadAll(store, 'payment', PaymentSchema)).records;
  const ownDeposit = (id: string) =>
    payments.some(
      (p) => p.id === id && p.kind === 'caparra' && p.apartmentId === input.apartmentId,
    );
  if (!(input.depositPaymentIds ?? []).every(ownDeposit)) return refuse('unknown-deposit');
  const before = (await contractsWithDeleted(store)).find((c) => c.id === input.id);
  const rent = before?.rent;
  if (!rentHistoryValid({ ...input, rent })) return refuse('rent-outside-contract');
  const takeovers = before?.takeovers;
  // Plan 11: a takeover keeps both its tenancies linked; repeat them in `tenancyIds`.
  const ids = new Set(input.tenancyIds ?? []);
  if (
    before?.deleted !== true &&
    (takeovers ?? []).some((t) => !ids.has(t.outTenancyId) || !ids.has(t.inTenancyId))
  ) {
    return refuse('takeover-unlinked');
  }
  const after = parseOrThrow(
    ContractSchema,
    {
      ...input,
      v: 1,
      rev: (before?.rev ?? 0) + 1,
      ...(rent === undefined ? {} : { rent }),
      ...(takeovers === undefined ? {} : { takeovers }),
    },
    'contract',
  );
  return write(
    store,
    before,
    after,
    { kind: 'contract.save', summary: 'Contratto salvato.', profileId },
    clock,
    newId,
  );
}

/**
 * Adds the rent entry of `input.from` to a live contract, in order of `from`, or replaces the
 * entry of the same month, in one `contract.rent` operation. Refused without writing:
 * `inconsistent-store`; `unknown-contract` (absent or deleted); `month-outside-contract` (`from`
 * before `start` or after `end`); `bad-amount` (rent not positive, or a negative advance). An entry
 * goes away only by undoing the operation that wrote it.
 */
export async function setContractRent(
  store: Store,
  input: SetContractRentInput,
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetContractRentResult> {
  const refuse = (reason: Extract<SetContractRentResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const before = (await contractsWithDeleted(store)).find((c) => c.id === input.contractId);
  if (before === undefined || before.deleted === true) return refuse('unknown-contract');
  if (input.from < before.start || input.from > before.end) {
    return refuse('month-outside-contract');
  }
  if (input.monthlyRent <= 0 || input.monthlyAdvance < 0) return refuse('bad-amount');
  const entry = {
    from: input.from,
    monthlyRent: input.monthlyRent,
    monthlyAdvance: input.monthlyAdvance,
  };
  const rent = [...(before.rent ?? []).filter((r) => r.from !== input.from), entry].sort((a, b) =>
    a.from < b.from ? -1 : 1,
  );
  const after = parseOrThrow(ContractSchema, { ...before, rev: before.rev + 1, rent }, 'contract');
  return write(
    store,
    before,
    after,
    { kind: 'contract.rent', summary: 'Aggiornato il canone di un contratto.', profileId },
    clock,
    newId,
  );
}

export type LoadContractChecksResult =
  | { status: 'computed'; contracts: Contract[]; checks: ContractCheck[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The live contracts (by `id`) and their checks (`contractChecks`); with `apartmentId` only the
 * contracts of that apartment and their checks. Read only: the checks are not part of
 * `checkConsistency`, which would block every write.
 */
export async function loadContractChecks(
  store: Store,
  options: { asOf: YearMonth; apartmentId?: string },
): Promise<LoadContractChecksResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const all = (await loadAll(store, 'contract', ContractSchema)).records.sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
  const checks = contractChecks({
    contracts: all,
    tenancies: (await loadAll(store, 'tenancy', TenancySchema)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
    asOf: options.asOf,
  });
  const contracts = all.filter(
    (c) => options.apartmentId === undefined || c.apartmentId === options.apartmentId,
  );
  const ids = new Set(contracts.map((c) => c.id));
  return { status: 'computed', contracts, checks: checks.filter((c) => ids.has(c.contractId)) };
}

export type SetRentYearResult =
  | { status: 'saved'; operationId: string; rentYearId: string }
  | { status: 'unchanged'; rentYearId: string }
  | {
      status: 'refused';
      reason: 'inconsistent-store' | 'unknown-apartment' | 'bad-year' | 'bad-amount';
    };

/**
 * Creates or updates `rent-<apartmentId>-<year>` (a new `rev`; a deleted one comes back), the
 * rents of the year typed by user1, in one `rent.year` operation (R182). Refused without writing:
 * `inconsistent-store`; `unknown-apartment` (absent or deleted); `bad-year` (not `AAAA`);
 * `bad-amount` (not positive). The same total already stored is `unchanged`.
 */
export async function setRentYear(
  store: Store,
  input: { apartmentId: string; year: string; totalRent: Cents },
  profileId: string,
  clock: () => string,
  newId: () => string,
): Promise<SetRentYearResult> {
  const refuse = (reason: Extract<SetRentYearResult, { status: 'refused' }>['reason']) =>
    ({ status: 'refused', reason }) as const;
  if ((await checkConsistency(store)).length > 0) return refuse('inconsistent-store');
  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  if (!apartments.some((a) => a.id === input.apartmentId)) return refuse('unknown-apartment');
  if (!YearSchema.safeParse(input.year).success) return refuse('bad-year');
  if (!Number.isSafeInteger(input.totalRent) || input.totalRent <= 0) return refuse('bad-amount');
  const id = `rent-${input.apartmentId}-${input.year}`;
  const before = (
    await loadAll(store, 'rentYear', RentYearSchema, { includeDeleted: true })
  ).records.find((y) => y.id === id);
  const record = (rev: number) =>
    parseOrThrow(
      RentYearSchema,
      {
        id,
        v: 1,
        rev,
        apartmentId: input.apartmentId,
        year: input.year,
        totalRent: input.totalRent,
      },
      'rentYear',
    );
  if (
    before !== undefined &&
    before.deleted !== true &&
    JSON.stringify(record(before.rev)) === JSON.stringify(before)
  ) {
    return { status: 'unchanged', rentYearId: id };
  }
  const operation = await commitChange(
    store,
    {
      profileId,
      kind: 'rent.year',
      apartmentId: input.apartmentId,
      summary: 'Aggiornati gli affitti di un anno.',
      changes: [
        { path: recordPath('rentYear', id), before, after: record((before?.rev ?? 0) + 1) },
      ],
    },
    clock,
    newId,
  );
  return { status: 'saved', operationId: operation.id, rentYearId: id };
}

export interface RentYearEstimate {
  apartmentId: string;
  year: string;
  totalRent: Cents;
  /** Only with one rate in the year (`cedolareRateForYear`). */
  cedolareRateBp?: number;
  /** An estimate to be confirmed by user1, never a payment (`cedolareExpected`). */
  cedolareExpected?: Cents;
}

export type LoadRentYearsResult =
  | { status: 'computed'; rentYears: RentYearEstimate[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/** The live rents of the year by apartment and year, with the cedolare estimate. Read only. */
export async function loadRentYears(
  store: Store,
  options: { apartmentId?: string },
): Promise<LoadRentYearsResult> {
  if ((await checkConsistency(store)).length > 0) {
    return { status: 'refused', reason: 'inconsistent-store' };
  }
  const contracts = (await loadAll(store, 'contract', ContractSchema)).records;
  const rentYears = (await loadAll(store, 'rentYear', RentYearSchema)).records
    .filter((y) => options.apartmentId === undefined || y.apartmentId === options.apartmentId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((y): RentYearEstimate => {
      const rate = cedolareRateForYear(contracts, y.apartmentId, y.year);
      return {
        apartmentId: y.apartmentId,
        year: y.year,
        totalRent: y.totalRent,
        ...(rate === undefined
          ? {}
          : { cedolareRateBp: rate, cedolareExpected: cedolareExpected(y.totalRent, rate) }),
      };
    });
  return { status: 'computed', rentYears };
}

export type TenancyState = 'futura' | 'in-corso' | 'uscita';

export interface ContractStatus {
  contract: Contract;
  /** The live linked tenancies, in the order of `tenancyIds`, with their state at `asOf`. */
  tenancies: { tenancy: Tenancy; state: TenancyState }[];
  /** `depositChecks` of the tenants of the linked tenancies in the contract's apartment. */
  deposits: DepositCheck[];
  checks: ContractCheck[];
}

export type LoadContractStatusResult =
  | { status: 'computed'; contracts: ContractStatus[] }
  | { status: 'refused'; reason: 'inconsistent-store' };

/**
 * The summary of each live contract (plan 11), by `id`, of `apartmentId` when given: linked
 * tenancies with their state in the month `asOf` (`futura` before `from`, `uscita` after `to`,
 * `in-corso` otherwise), the takeovers (in `contract`), the deposits and the checks. Read only.
 */
export async function loadContractStatus(
  store: Store,
  options: { asOf: YearMonth; apartmentId?: string },
): Promise<LoadContractStatusResult> {
  const loaded = await loadContractChecks(store, options);
  if (loaded.status === 'refused') return loaded;
  const tenancies = (await loadAll(store, 'tenancy', TenancySchema)).records;
  const deposits = depositChecks({
    tenancies,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
  });
  const contracts = loaded.contracts.map((contract): ContractStatus => {
    const linked = (contract.tenancyIds ?? []).flatMap((id) =>
      tenancies.filter((t) => t.id === id),
    );
    const tenants = new Set(linked.map((t) => t.tenantId));
    return {
      contract,
      tenancies: linked.map((tenancy) => ({
        tenancy,
        state:
          options.asOf < tenancy.from
            ? 'futura'
            : tenancy.to !== undefined && tenancy.to < options.asOf
              ? 'uscita'
              : 'in-corso',
      })),
      deposits: deposits.filter(
        (d) => d.apartmentId === contract.apartmentId && tenants.has(d.tenantId),
      ),
      checks: loaded.checks.filter((c) => c.contractId === contract.id),
    };
  });
  return { status: 'computed', contracts };
}
