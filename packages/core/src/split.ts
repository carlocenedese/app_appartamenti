import { cents, splitCents } from './money';
import type { Cents } from './money';

/**
 * Splits one debit shared by several items in proportion to their weights (for the TARI notice of
 * Berchet and Lovarini, the totals of each supply). The shares have the items' sign, opposite to
 * the debit's: a debit of -186,00 € gives positive shares. They always sum to the debit; the
 * leftover cents go to the largest remainders, on equal remainders to the first items.
 * Throws a `RangeError` if there is no weight or a weight is not a positive amount.
 */
export function splitSharedDebit(
  debit: Cents,
  weights: { itemId: string; weight: Cents }[],
): { itemId: string; amount: Cents }[] {
  if (weights.length === 0) throw new RangeError('Cannot split a debit without weights');
  for (const { itemId, weight } of weights) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new RangeError(`Weight of ${itemId} must be a positive amount in cents`);
    }
  }
  const shares = splitCents(
    cents(-debit),
    weights.map(({ weight }) => weight),
  );
  return weights.map(({ itemId }, index) => ({ itemId, amount: shares[index] as Cents }));
}
