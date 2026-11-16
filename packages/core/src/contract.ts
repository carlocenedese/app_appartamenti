/**
 * Lease contracts (plan 7): the rent of a month from the contract's history. Pure, no writes.
 */
import type { Contract, ContractRent } from './model';
import type { YearMonth } from './period';

/** The entry of `rent` with the largest `from` not after `month`; none before the first entry. */
export function rentForMonth(
  contract: Pick<Contract, 'rent'>,
  month: YearMonth,
): ContractRent | undefined {
  // `rent` is sorted by `from` (schema refine).
  return [...(contract.rent ?? [])].reverse().find((entry) => entry.from <= month);
}
