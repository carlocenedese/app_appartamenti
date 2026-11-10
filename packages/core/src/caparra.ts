import { cents } from './money';
import type { Cents } from './money';

/** What goes into the deposit return statement. Amounts are positive when owed to the tenant. */
export interface CaparraReturnInput {
  /** The deposit paid by the tenant. */
  caparra: Cents;
  /** The legal interest on the deposit (see `legalInterest`). */
  interest: Cents;
  /** The tenant's utility settlement: positive is a debt to deduct, negative a credit to add. */
  conguaglio: Cents;
  /** Further charges to deduct (the mosquito screen, the registration tax share, ...). */
  extraCharges: readonly { label: string; amount: Cents }[];
}

/** One line of the statement: positive adds to what is returned, negative deducts from it. */
export interface CaparraLine {
  label: string;
  amount: Cents;
}

export interface CaparraReturn {
  /** The amount to transfer to the tenant: the sum of the line amounts. Negative if they owe. */
  total: Cents;
  /** Caparra, interessi, conguaglio, then each extra charge in input order. */
  lines: CaparraLine[];
}

/**
 * The deposit return statement: caparra, plus legal interest, minus the conguaglio, minus the
 * extra charges. The conguaglio is shown as a deduction (a credit of the tenant shows as an
 * addition). The three fixed lines are always present, even when their amount is zero, and the
 * labels are the Italian ones printed on the tenant's statement.
 * Throws a `RangeError` if an amount or the total is not a safe integer.
 */
export function caparraReturn(input: CaparraReturnInput): CaparraReturn {
  const lines: CaparraLine[] = [
    { label: 'Caparra', amount: input.caparra },
    { label: 'Interessi legali', amount: input.interest },
    { label: 'Conguaglio bollette', amount: cents(-input.conguaglio) },
    ...input.extraCharges.map(({ label, amount }) => ({ label, amount: cents(-amount) })),
  ];
  // Checking every partial sum keeps the total exact: each one stays a safe integer.
  const total = lines.reduce((sum, { amount }) => cents(sum + amount), cents(0));
  return { total, lines };
}
