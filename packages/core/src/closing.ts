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
 * One tenant of the supplementary settlement: the difference in costs (`delta`, last year's
 * condominium settlement included, answer K) and, on a line of its own (F11), the flat charge
 * collected at the closing and no longer collected (`forfaitDelta`, positive is to ask the
 * tenant). `action` reads both; more flat charge collected than at the closing (beyond what was
 * missing then, `forfaitNonIncassato`) is `da-verificare` (answer F).
 */
export interface ClosingRow extends Omit<SupplementaryRow, 'action'> {
  forfaitDelta: Cents;
  action: SupplementaryRow['action'] | 'da-verificare';
}

/** A closed (or reopened, F3) period with what changed since its snapshot. */
export interface PeriodClosed {
  /** `reopened`: the period is open again; the comparison is with its last snapshot. */
  status: 'closed' | 'reopened';
  /** F1, F3: the step of the closing (`closeState`). */
  state: 'chiuso' | 'inviato' | 'saldato' | 'riaperto';
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
  /** The tenants of the period changed since the closing (one is new or gone): to check. */
  dataChanged: boolean;
}

/** A closing that holds the period closed: not deleted and not reopened (F3). */
export const isLiveClose = (close: PeriodClose): boolean =>
  close.deleted !== true && close.reopened === undefined;

type SnapshotTenant = PeriodClose['snapshot']['tenants'][number];

/**
 * What one tenant owed at the closing: the `due` of `calcConguaglio` from the snapshot (the flat
 * charge missing at a closing after a reopening, `forfaitNonIncassato`, is part of it: H).
 */
export const snapshotDue = (t: SnapshotTenant): Cents =>
  cents(t.spese + t.rata + t.conguaglioPrec + t.commissione + t.recupero - t.forfaitIncassato);

/**
 * Where the settlement of one tenant of a closing stands (F1, answers D and G of user1):
 * - `saldato`: marked settled on this closing, nothing left;
 * - `differenza`: not marked on this closing, but on an earlier one of the period (or its
 *   supplementary was): only `remaining`, the due now less what that closing settled, is left;
 * - `da-saldare`: never marked, `remaining` is the whole due.
 * `fni` is the flat charge missing at this closing that `remaining` holds (H).
 */
export function tenantBalance(
  close: PeriodClose,
  tenantId: string,
): { status: 'saldato' | 'differenza' | 'da-saldare'; due: Cents; remaining: Cents; fni: Cents } {
  const own = close.snapshot.tenants.find((t) => t.tenantId === tenantId);
  const due = own === undefined ? cents(0) : snapshotDue(own);
  const fni = cents(own?.forfaitNonIncassato ?? 0);
  if ((close.settled ?? []).some((s) => s.tenantId === tenantId)) {
    return { status: 'saldato', due, remaining: cents(0), fni: cents(0) };
  }
  // What earlier closings settled is not due again (G, finding 1 of the third review): newest to
  // oldest, every supplementary marked settled, down to the first closing whose main settlement
  // was marked, whose due at that closing counts too (that mark stays valid for its snapshot).
  let base = 0;
  let marked = false;
  for (const earlier of [...(close.history ?? [])].reverse()) {
    const supplementary = (earlier.supplementarySettled ?? []).find((s) => s.tenantId === tenantId);
    if (supplementary !== undefined) {
      base += supplementary.amount;
      marked = true;
    }
    if ((earlier.settled ?? []).some((s) => s.tenantId === tenantId)) {
      const then = earlier.snapshot.tenants.find((t) => t.tenantId === tenantId);
      base += then === undefined ? 0 : snapshotDue(then);
      marked = true;
      break;
    }
  }
  if (marked) return { status: 'differenza', due, remaining: cents(due - base), fni };
  return { status: 'da-saldare', due, remaining: due, fni };
}

/**
 * The step of a closing (F1, F3): `riaperto`; `saldato` once it is sent and no tenant has
 * anything left to settle (`unsettledTenants`); `inviato`; else `chiuso`.
 */
export function closeState(close: PeriodClose): 'chiuso' | 'inviato' | 'saldato' | 'riaperto' {
  if (close.reopened !== undefined) return 'riaperto';
  if (close.sentOn === undefined) return 'chiuso';
  return unsettledTenants(close).length === 0 ? 'saldato' : 'inviato';
}

/** The tenants with something left to settle on this closing (`tenantBalance`). */
export function unsettledTenants(close: PeriodClose): string[] {
  return close.snapshot.tenants
    .filter((t) => tenantBalance(close, t.tenantId).remaining !== 0)
    .map((t) => t.tenantId);
}

/** Of `unsettledTenants`, those settled up to an earlier closing: only a difference is left (G). */
export function differenceTenants(close: PeriodClose): string[] {
  return unsettledTenants(close).filter((id) => tenantBalance(close, id).status === 'differenza');
}

/**
 * The marks of a closing a person must not lose when choosing between two versions of it
 * (finding 6, `scegli-versione`): sent, settled, supplementary settled, reopened, earlier closings.
 */
export function closeMarks(close: PeriodClose): {
  sentOn?: string;
  settled: string[];
  supplementarySettled: string[];
  reopenedOn?: string;
  earlierClosings: number;
} {
  return {
    ...(close.sentOn === undefined ? {} : { sentOn: close.sentOn }),
    settled: (close.settled ?? []).map((s) => s.tenantId),
    supplementarySettled: (close.supplementarySettled ?? []).map((s) => s.tenantId),
    ...(close.reopened === undefined ? {} : { reopenedOn: close.reopened.on }),
    earlierClosings: close.history?.length ?? 0,
  };
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
  // Answer K: last year's condominium settlement changed since the closing is supplementary too.
  const prec = (rows: readonly { tenantId: string; conguaglioPrec: number }[]) =>
    new Map(rows.map((t) => [t.tenantId, t.conguaglioPrec]));
  const precThen = prec(close.snapshot.tenants);
  const precNow = prec(
    current.tenants.map((t) => ({
      tenantId: t.tenantId,
      conguaglioPrec: t.condominio.conguaglioPrec,
    })),
  );
  const ids = (rows: readonly { tenantId: string }[]) =>
    JSON.stringify(rows.map((t) => t.tenantId).sort());
  const dataChanged = ids(close.snapshot.tenants) !== ids(current.tenants);
  const collected = (rows: readonly { tenantId: string; forfaitIncassato: number }[]) =>
    new Map(rows.map((t) => [t.tenantId, t.forfaitIncassato]));
  const atClose = collected(close.snapshot.tenants);
  const now = collected(current.tenants);
  const missingThen = new Map(
    close.snapshot.tenants.map((t) => [t.tenantId, t.forfaitNonIncassato ?? 0]),
  );
  const tenants = supplementary.tenants.map((row): ClosingRow => {
    const delta = cents(
      row.delta + (precNow.get(row.tenantId) ?? 0) - (precThen.get(row.tenantId) ?? 0),
    );
    const forfaitDelta = cents((atClose.get(row.tenantId) ?? 0) - (now.get(row.tenantId) ?? 0));
    const total = delta + forfaitDelta;
    const action =
      forfaitDelta + (missingThen.get(row.tenantId) ?? 0) < 0
        ? 'da-verificare'
        : total === 0
          ? 'nessuna'
          : total < 0
            ? 'da-rimborsare'
            : row.departed
              ? 'da-trattenere-o-richiedere'
              : 'da-pagare';
    return { ...row, delta, forfaitDelta, action };
  });
  return {
    status: close.reopened === undefined ? 'closed' : 'reopened',
    state: closeState(close),
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
