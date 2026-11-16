/**
 * Writing lease contracts (plan 7): the contract data (`saveContract`) and its rent history
 * (`setContractRent`), each write one operation of the journal, nothing written while
 * `checkConsistency` reports a problem (R113), nothing for the same request on the same state.
 * No write ever touches a tenancy, a payment or another contract; no amount, code or name in a
 * summary.
 */
import { contractChecks } from './contract';
import type { ContractCheck } from './contract';
import { checkConsistency, commitChange } from './journal';
import {
  ApartmentSchema,
  ContractSchema,
  PaymentSchema,
  TenancySchema,
  rentHistoryValid,
} from './model';
import type { Contract } from './model';
import type { Cents } from './money';
import { parseOrThrow } from './parse';
import type { YearMonth } from './period';
import { loadAll } from './store/load';
import { recordPath } from './store/records';
import type { Store } from './store/store';

export type ContractInput = Omit<Contract, 'v' | 'rev' | 'deleted' | 'rent'>;

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
        | 'rent-outside-contract';
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
 * operation. Every data field is replaced except `rent`, which stays as stored (absent for a new
 * contract). Refused without writing, in this order: `inconsistent-store`; `invalid-contract`
 * (the input with `rent` or `deleted`, or one the schema refuses: `start` after `end`, a rate
 * without `taxRegime: 'cedolare'`, a repeated id, ...); `unknown-apartment`
 * (absent or deleted); `unknown-tenancy` (a `tenancyIds` entry is not a live tenancy of the same
 * apartment); `unknown-deposit` (a `depositPaymentIds` entry is not a live `caparra` payment of
 * the same apartment); `rent-outside-contract` (the new dates leave a rent entry out). The dates
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
  // A constant refusal, never a ZodError: the rent history is written only by setContractRent.
  if (
    'rent' in input ||
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
  const after = parseOrThrow(
    ContractSchema,
    { ...input, v: 1, rev: (before?.rev ?? 0) + 1, ...(rent === undefined ? {} : { rent }) },
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
