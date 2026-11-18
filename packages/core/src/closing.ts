/**
 * The pure part of the closing of a settlement period (review of 18 Nov 2026, I2, R5): the id,
 * the snapshot of a calculation and the supplementary settlement against it.
 */
import { calcConguaglioSupplementare } from './conguaglio';
import type { ConguaglioResult, SettlementCosts, SupplementaryRow } from './conguaglio';
import type { PeriodClose, Tenancy } from './model';
import { cents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';

/** A closed period with what changed since its snapshot. */
export interface PeriodClosed {
  status: 'closed';
  closedAt: string;
  /** For each tenant of either calculation: the difference in costs since the closing. */
  tenants: SupplementaryRow[];
  unassignedDelta: Cents;
  /** Some difference is not 0: a supplementary settlement is due (R5). */
  changed: boolean;
}

export const periodCloseId = (apartmentId: string, periodLabel: string): string =>
  `chiusura-${apartmentId}-${periodLabel}`;

/** The costs of a calculation that the snapshot keeps (R5: the flat charge is all collected). */
export function snapshotOf(result: ConguaglioResult): PeriodClose['snapshot'] {
  return {
    tenants: result.tenants.map((t) => ({
      tenantId: t.tenantId,
      spese: t.spese,
      rata: t.condominio.rata,
      commissione: t.commissione,
    })),
    emptyBeds: cents(result.unassigned - result.unassignedByBucket.conguaglioPrec),
  };
}

/** A snapshot read as the costs `calcConguaglioSupplementare` compares. */
function snapshotCosts(snapshot: PeriodClose['snapshot']): SettlementCosts {
  return {
    tenants: snapshot.tenants.map((t) => ({
      tenantId: t.tenantId,
      spese: cents(t.spese),
      condominio: { rata: cents(t.rata) },
      commissione: cents(t.commissione),
    })),
    unassigned: cents(snapshot.emptyBeds),
    unassignedByBucket: { conguaglioPrec: cents(0) },
  };
}

/** The supplementary settlement of `current` against the snapshot of `close` (pure). */
export function closingOf(
  close: PeriodClose,
  current: ConguaglioResult,
  input: { tenancies: Tenancy[] },
  asOf: ISODate,
): PeriodClosed {
  const supplementary = calcConguaglioSupplementare({
    current,
    snapshot: snapshotCosts(close.snapshot),
    tenancies: input.tenancies,
    asOf,
  });
  return {
    status: 'closed',
    closedAt: close.closedAt,
    ...supplementary,
    changed:
      supplementary.unassignedDelta !== 0 || supplementary.tenants.some((t) => t.delta !== 0),
  };
}
