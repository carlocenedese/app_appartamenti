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

/**
 * One tenant of the supplementary settlement: the difference in costs (`delta`) and, on a line of
 * its own (F11), the flat charge collected at the closing and no longer collected (`forfaitDelta`,
 * positive is to ask the tenant). `action` reads both; a negative `forfaitDelta` (more collected
 * than at the closing, which a closing should not allow) is `da-verificare`.
 */
export interface ClosingRow extends Omit<SupplementaryRow, 'action'> {
  forfaitDelta: Cents;
  action: SupplementaryRow['action'] | 'da-verificare';
}

/** A closed (or reopened, F3) period with what changed since its snapshot. */
export interface PeriodClosed {
  /** `reopened`: the period is open again; the comparison is with its last snapshot. */
  status: 'closed' | 'reopened';
  closedAt: string;
  /** F1: the day the settlement was sent to the tenants, when user1 marked it. */
  sentOn?: string;
  /** F1: the tenants whose settlement user1 marked as settled. */
  settled: NonNullable<PeriodClose['settled']>;
  /** F3: when and why the period was reopened. */
  reopened?: NonNullable<PeriodClose['reopened']>;
  /** For each tenant of either calculation: the difference since the closing. */
  tenants: ClosingRow[];
  unassignedDelta: Cents;
  /** Some difference is not 0: a supplementary settlement is due (R5, F11). */
  changed: boolean;
  /**
   * Data of the snapshot that is neither a cost nor the flat charge changed since the closing
   * (last year's condominium settlement, the tenants of the period): to be checked by a person.
   */
  dataChanged: boolean;
}

/** A closing that holds the period closed: not deleted and not reopened (F3). */
export const isLiveClose = (close: PeriodClose): boolean =>
  close.deleted !== true && close.reopened === undefined;

/** What one tenant owed at the closing: the `due` of `calcConguaglio` from the snapshot. */
export const snapshotDue = (t: PeriodClose['snapshot']['tenants'][number]): Cents =>
  cents(t.spese + t.rata + t.conguaglioPrec + t.commissione + t.recupero - t.forfaitIncassato);

/**
 * The step of a closing (F1, F3): `riaperto`; `saldato` once it is sent and every tenant with
 * something to settle at the closing is marked; `inviato`; else `chiuso`.
 */
export function closeState(close: PeriodClose): 'chiuso' | 'inviato' | 'saldato' | 'riaperto' {
  if (close.reopened !== undefined) return 'riaperto';
  if (close.sentOn === undefined) return 'chiuso';
  const settled = new Set((close.settled ?? []).map((s) => s.tenantId));
  return close.snapshot.tenants.every((t) => snapshotDue(t) === 0 || settled.has(t.tenantId))
    ? 'saldato'
    : 'inviato';
}

/** The tenants with something to settle at the closing that user1 has not marked as settled. */
export function unsettledTenants(close: PeriodClose): string[] {
  const settled = new Set((close.settled ?? []).map((s) => s.tenantId));
  return close.snapshot.tenants
    .filter((t) => snapshotDue(t) !== 0 && !settled.has(t.tenantId))
    .map((t) => t.tenantId);
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
      recupero: t.recupero ?? cents(0),
      forfaitIncassato: t.forfaitIncassato,
      conguaglioPrec: t.condominio.conguaglioPrec,
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
      recupero: cents(t.recupero),
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
  // Both sorted by tenant id (`calcConguaglio` sorts its rows). The flat charge is not here: F11.
  const was = close.snapshot.tenants.map((t) => [t.tenantId, t.conguaglioPrec]);
  const is = current.tenants.map((t) => [t.tenantId, t.condominio.conguaglioPrec]);
  const dataChanged = JSON.stringify(was) !== JSON.stringify(is);
  const collected = (rows: readonly { tenantId: string; forfaitIncassato: number }[]) =>
    new Map(rows.map((t) => [t.tenantId, t.forfaitIncassato]));
  const atClose = collected(close.snapshot.tenants);
  const now = collected(current.tenants);
  const tenants = supplementary.tenants.map((row): ClosingRow => {
    const forfaitDelta = cents((atClose.get(row.tenantId) ?? 0) - (now.get(row.tenantId) ?? 0));
    if (forfaitDelta === 0) return { ...row, forfaitDelta };
    const total = row.delta + forfaitDelta;
    const action =
      forfaitDelta < 0
        ? 'da-verificare'
        : total === 0
          ? 'nessuna'
          : total < 0
            ? 'da-rimborsare'
            : row.departed
              ? 'da-trattenere-o-richiedere'
              : 'da-pagare';
    return { ...row, forfaitDelta, action };
  });
  return {
    status: close.reopened === undefined ? 'closed' : 'reopened',
    closedAt: close.closedAt,
    ...(close.sentOn === undefined ? {} : { sentOn: close.sentOn }),
    settled: close.settled ?? [],
    ...(close.reopened === undefined ? {} : { reopened: close.reopened }),
    tenants,
    unassignedDelta: supplementary.unassignedDelta,
    changed:
      supplementary.unassignedDelta !== 0 ||
      tenants.some((t) => t.delta !== 0 || t.forfaitDelta !== 0),
    dataChanged,
  };
}
