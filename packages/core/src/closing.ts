/**
 * The pure part of the closing of a settlement period (review of 18 Nov 2026, I2, R5): the id,
 * the snapshot of a calculation and the supplementary settlement against it.
 */
import { calcConguaglioSupplementare, rentNotCollected } from './conguaglio';
import type { ConguaglioResult, SettlementCosts, SupplementaryRow } from './conguaglio';
import type { Payment, PeriodClose, Tenancy } from './model';
import { cents } from './money';
import type { Cents } from './money';
import { isoDate, monthsInPeriod } from './period';
import type { ISODate } from './period';

/**
 * One tenant of the supplementary settlement: the difference in costs (`delta`, last year's
 * condominium settlement included, answer K) and, on a line of its own (F11), the flat charge
 * collected at the closing and no longer collected (`forfaitDelta`, positive is to ask the
 * tenant). `action` reads both; more flat charge collected than at the closing (beyond what was
 * missing then, `forfaitNonIncassato`) is `da-verificare` (answer F).
 */
export interface ClosingRow extends Omit<SupplementaryRow, 'action'> {
  /** The flat charge collected at the closing less today's (display; read `total`, `forfaitPaid`). */
  forfaitDelta: Cents;
  /**
   * The supplementary settlement of the tenant, computed once (fourth round, B): the costs since the
   * snapshot plus the flat charge collected at the closing and lost since. What is paid since on
   * the flat charge missing at the closing is `forfaitPaid`, never here. This is what
   * «Conguaglio supplementare» withholds and what `markTenantSettled({ supplementary })` settles.
   */
  total: Cents;
  /** What is left of the tenant's settlement, main and supplementary (`tenantBalance`). */
  remaining: Cents;
  /** What is left of the main settlement (0 once marked on this closing). */
  mainRemaining: Cents;
  /** Plan 22: of `toCheck`, what user1 checked as a credit of the tenant (still to check). */
  flatCredit: Cents;
  /** Of the flat charge missing at the closing (H), what is paid since: it reduces the main due. */
  forfaitPaid: Cents;
  /**
   * Flat charge collected beyond what was due (answer F, fourth round A): «da verificare», shown
   * with its amount and never an automatic credit.
   */
  toCheck: Cents;
  action: SupplementaryRow['action'] | 'da-verificare';
  /**
   * Plan 22, decision 1: the rent of the period not collected today (a bounced transfer after a
   * reopening), the row «Canone non incassato». Not part of the settlement (R4): outside `total`,
   * `remaining` and every mark. Less what user1 marked `saldato` or `non-recuperabile`.
   */
  rentMissing: Cents;
  /** Of `rentMissing`, what user1 marked `richiesto` (answer 2). */
  rentAsked: Cents;
  /** What user1 marked `non-recuperabile`: left with the owner (R5). */
  rentLost: Cents;
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
  /**
   * The tenants of the period changed since the closing (one is new or gone), or a flat charge
   * missing at the closing was paid since (it changes the main due): to check.
   */
  dataChanged: boolean;
  /** Some flat charge was collected beyond what was due: «da verificare» (`ClosingRow.toCheck`). */
  toCheck: boolean;
  /** Plan 22: the tenants with a rent not collected still open (`ClosingRow.rentMissing`). */
  rentMissing: number;
  /** The tenants with something left of the main settlement (F1). */
  unsettled: string[];
  /** Of them, those settled on an earlier closing: only a difference is left (G). */
  differences: string[];
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

type Mark = { amount: number; flat?: number };

/**
 * The marks of one tenant on every closing of the period, oldest first (the history, then the
 * current closing): the main mark and the supplementary mark of each, as amounts.
 */
function marksOf(close: PeriodClose, tenantId: string) {
  const closings = [...(close.history ?? []), close];
  let prior = 0;
  return closings.map((c) => {
    const own = c.snapshot.tenants.find((t) => t.tenantId === tenantId);
    const entry = (c.settled ?? []).find((s) => s.tenantId === tenantId);
    const supEntry = (c.supplementarySettled ?? []).find((s) => s.tenantId === tenantId);
    // A main mark written before the fifth round has no amount: it declared the snapshot's due,
    // as a level, so its amount is that due less what earlier closings declared; its flat charge is
    // the snapshot's. Only earlier commits of this branch wrote such marks (nothing is in main).
    const main: Mark | undefined =
      entry === undefined
        ? undefined
        : {
            amount: entry.amount ?? (own === undefined ? 0 : snapshotDue(own)) - prior,
            ...(entry.flatCollected !== undefined
              ? { flat: entry.flatCollected }
              : own === undefined
                ? {}
                : { flat: own.forfaitIncassato }),
          };
    const sup = supEntry?.amount ?? 0;
    const before = prior;
    prior += (main?.amount ?? 0) + sup;
    return { own, main, sup, prior: before, hasSup: supEntry !== undefined };
  });
}

/** Where one tenant's settlement stands (`tenantBalance`); amounts in cents, positive owed. */
export interface TenantLedger {
  /** Main settlement: marked on this closing, only a difference after an earlier mark, or none. */
  status: 'saldato' | 'differenza' | 'da-saldare';
  /** Today's due (`calcConguaglio`). */
  due: Cents;
  /** What is left: due + toCheck − every amount marked settled (main and supplementary). */
  remaining: Cents;
  /** What a main mark would declare now; 0 once marked on this closing. */
  mainRemaining: Cents;
  /** Of `mainRemaining`, the flat charge missing at this closing still unpaid (H). */
  fniLeft: Cents;
  /** What a supplementary mark would declare now (the supplementary level). */
  supplementary: Cents;
  /** The supplementary already marked on this closing. */
  supplementarySettled: Cents;
  /** Flat charge collected at the closing and lost since (F11). */
  lostFlat: Cents;
  /** Of the flat charge missing at the closing, what is paid since (it reduces the main). */
  forfaitPaid: Cents;
  /**
   * Flat charge collected after the last main mark: already settled, «da verificare» (answer F),
   * less what user1 checked (plan 22, `flatCleared`).
   */
  toCheck: Cents;
  /** Plan 22: of the flat charge to check, what user1 checked (every outcome). */
  flatCleared: Cents;
  /**
   * Plan 22, answer 5 of user1: of `flatCleared`, what was checked as `credito`: a credit of the
   * tenant, in the supplementary settlement (it lowers `remaining`).
   */
  flatCredit: Cents;
}

/** A flat-charge payment of the tenant, as a check keeps it (answer 7). */
export type FlatPayment = { id: string; amount: number };

/**
 * The tenant's live confirmed `canone` payments of the months `from..to` (by `forMonth`, else the
 * month of the date, as the settlement), sorted by id: what a check of the flat charge is tied to.
 */
export function flatPaymentsOf(
  payments: readonly Payment[],
  tenantId: string,
  from: string,
  to: string,
): FlatPayment[] {
  return payments
    .filter((p) => p.deleted !== true && p.confirmed && p.kind === 'canone')
    .filter((p) => p.tenantId === tenantId)
    .filter((p) => {
      const month = p.forMonth ?? p.date.slice(0, 7);
      return from <= month && month <= to;
    })
    .map((p) => ({ id: p.id, amount: p.amount as number }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The one computation of a tenant's settlement (fifth round, from the model test): each mark
 * stores what it declared settled (`amount`) and the flat charge collected then (`flatCollected`).
 * remaining = today's due + toCheck − the sum of the amounts, where toCheck (extra) is the flat
 * charge collected after the last main mark: already settled, so «da verificare», never a credit
 * and never lowering what is withheld. A main mark declares the snapshot's due (with the extra the
 * snapshot already counts) less the missing flat charge paid since (H) and less what earlier
 * closings declared; a supplementary mark declares the rest. A new closing changes no amount, so
 * «settled on an earlier closing owes only the difference» (G) follows. No walk over snapshot dues.
 */
export function tenantBalance(
  close: PeriodClose,
  tenantId: string,
  now: {
    due: number;
    forfaitIncassato: number;
    /** The tenant's flat-charge payments today (`flatPaymentsOf`); without them every check holds. */
    payments?: readonly FlatPayment[];
  },
): TenantLedger {
  const marks = marksOf(close, tenantId);
  const current = marks.at(-1) as (typeof marks)[number];
  const earlierMain = marks
    .slice(0, -1)
    .map((m) => m.main)
    .filter((m) => m !== undefined)
    .at(-1);
  const anyEarlier = marks.slice(0, -1).some((m) => m.main !== undefined || m.hasSup);
  const own = current.own;
  const snapshot = own === undefined ? 0 : snapshotDue(own);
  const flatThen = own?.forfaitIncassato ?? 0;
  const fni = own?.forfaitNonIncassato ?? 0;
  const extraInSnapshot =
    earlierMain?.flat === undefined ? 0 : Math.max(0, flatThen - earlierMain.flat);
  const forfaitPaid = Math.min(Math.max(0, now.forfaitIncassato - flatThen), fni);
  const lastFlat = current.main !== undefined ? current.main.flat : earlierMain?.flat;
  // Without any main mark, only flat charge beyond what this snapshot lacked is extra (answer F;
  // the app's imputation caps a month at its due, so real data never gets there).
  const toCheck =
    lastFlat === undefined
      ? Math.max(0, now.forfaitIncassato - flatThen - fni)
      : Math.max(0, now.forfaitIncassato - lastFlat);
  const owed = now.due + toCheck - current.prior - (current.main?.amount ?? 0) - current.sup;
  // Plan 22: the checks of user1 on every closing. Answer 7: a check holds only while each payment
  // it was made on is still there with the same amount (a payment taken away and a new one of the
  // same amount is to check again); capped by today's extra, in the order they were made.
  const holds = (f: { payments?: readonly FlatPayment[] }) =>
    now.payments === undefined ||
    f.payments === undefined ||
    f.payments.every((p) =>
      (now.payments ?? []).some((q) => q.id === p.id && q.amount === p.amount),
    );
  let flatCleared = 0;
  let flatCredit = 0;
  for (const f of [...(close.history ?? []), close].flatMap((c) => c.flatChecked ?? [])) {
    if (f.tenantId !== tenantId || !holds(f)) continue;
    const take = Math.min(f.amount, toCheck - flatCleared);
    flatCleared += take;
    // Answer 5: a credit goes into the supplementary settlement.
    if (f.outcome === 'credito') flatCredit += take;
  }
  const remaining = owed - flatCredit;
  const mainRemaining =
    current.main !== undefined ? 0 : snapshot + extraInSnapshot - forfaitPaid - current.prior;
  // The flat charge still missing, as far as the main still holds it.
  const fniLeft =
    current.main !== undefined
      ? 0
      : Math.min(Math.max(0, fni - forfaitPaid), Math.max(0, mainRemaining));
  return {
    status: current.main !== undefined ? 'saldato' : anyEarlier ? 'differenza' : 'da-saldare',
    due: cents(now.due),
    remaining: cents(remaining),
    mainRemaining: cents(mainRemaining),
    fniLeft: cents(fniLeft),
    supplementary: cents(remaining - mainRemaining + current.sup),
    supplementarySettled: cents(current.sup),
    lostFlat: cents(Math.max(0, flatThen - now.forfaitIncassato)),
    forfaitPaid: cents(forfaitPaid),
    toCheck: cents(toCheck - flatCleared),
    flatCleared: cents(flatCleared),
    flatCredit: cents(flatCredit),
  };
}

/**
 * The marks of a closing a person must not lose when choosing between two versions of it
 * (finding 6, `scegli-versione`): sent, settled, supplementary settled, reopened, earlier closings.
 */
export function closeMarks(close: PeriodClose): {
  sentOn?: string;
  settled: string[];
  supplementarySettled: string[];
  flatChecked: string[];
  rentMarks: string[];
  reopenedOn?: string;
  earlierClosings: number;
} {
  return {
    ...(close.sentOn === undefined ? {} : { sentOn: close.sentOn }),
    settled: (close.settled ?? []).map((s) => s.tenantId),
    supplementarySettled: (close.supplementarySettled ?? []).map((s) => s.tenantId),
    flatChecked: (close.flatChecked ?? []).map((f) => f.tenantId),
    rentMarks: (close.rentMarks ?? []).map((f) => f.tenantId),
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
  input: { tenancies: Tenancy[]; payments?: Payment[] },
  asOf: ISODate,
): PeriodClosed {
  const nowRows = new Map(current.tenants.map((t) => [t.tenantId, t]));
  const rent = rentOf(close, input);
  const ledgerOf = (id: string) => {
    const today = nowRows.get(id);
    return tenantBalance(close, id, {
      due: today?.due ?? 0,
      forfaitIncassato: today?.forfaitIncassato ?? 0,
      ...(input.payments === undefined
        ? {}
        : { payments: flatPaymentsOf(input.payments, id, close.from, close.to) }),
    });
  };
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
  const tenants = supplementary.tenants.map((row): ClosingRow => {
    const ownRent = rent.get(row.tenantId);
    const delta = cents(
      row.delta + (precNow.get(row.tenantId) ?? 0) - (precThen.get(row.tenantId) ?? 0),
    );
    const today = nowRows.get(row.tenantId);
    const forfaitDelta = cents((atClose.get(row.tenantId) ?? 0) - (today?.forfaitIncassato ?? 0));
    // The one computation of the settlement (`tenantBalance`, fifth round).
    const ledger = ledgerOf(row.tenantId);
    const left = ledger.supplementary - ledger.supplementarySettled;
    // C2: «da verificare» only when nothing else is left of the supplementary; otherwise the
    // action follows the amount and `toCheck` is beside it.
    const action =
      left === 0
        ? ledger.toCheck > 0
          ? 'da-verificare'
          : 'nessuna'
        : left < 0
          ? 'da-rimborsare'
          : row.departed
            ? 'da-trattenere-o-richiedere'
            : 'da-pagare';
    return {
      ...row,
      delta,
      forfaitDelta,
      total: ledger.supplementary,
      remaining: ledger.remaining,
      mainRemaining: ledger.mainRemaining,
      forfaitPaid: ledger.forfaitPaid,
      toCheck: ledger.toCheck,
      flatCredit: ledger.flatCredit,
      action,
      rentMissing: ownRent?.open ?? cents(0),
      rentAsked: ownRent?.asked ?? cents(0),
      rentLost: ownRent?.lost ?? cents(0),
    };
  });
  const unsettled = tenants.filter((t) => t.mainRemaining !== 0).map((t) => t.tenantId);
  const differences = unsettled.filter((id) => ledgerOf(id).status === 'differenza');
  return {
    status: close.reopened === undefined ? 'closed' : 'reopened',
    state:
      close.reopened !== undefined
        ? 'riaperto'
        : close.sentOn === undefined
          ? 'chiuso'
          : unsettled.length === 0
            ? 'saldato'
            : 'inviato',
    closedAt: close.closedAt,
    ...(close.sentOn === undefined ? {} : { sentOn: close.sentOn }),
    settled: close.settled ?? [],
    ...(close.reopened === undefined ? {} : { reopened: close.reopened }),
    tenants,
    unassignedDelta: supplementary.unassignedDelta,
    unsettled,
    differences,
    changed: supplementary.unassignedDelta !== 0 || tenants.some((t) => t.total !== 0),
    // C3: a flat charge that only covers what was missing changes nothing to check.
    dataChanged,
    toCheck: tenants.some((t) => t.toCheck !== 0),
    rentMissing: tenants.filter((t) => t.rentMissing > 0).length,
  };
}

/** Where the rent not collected of one tenant stands (plan 22); cents. */
export interface RentLedger {
  /** Still to collect: missing today less what user1 marked `saldato` or `non-recuperabile`. */
  open: Cents;
  /** Of `open`, what user1 marked `richiesto` (asked from the tenant). */
  asked: Cents;
  /** Marked `non-recuperabile`: left with the owner (R5), no longer withheld or asked. */
  lost: Cents;
  /** What is open, month by month (what a new mark records). */
  months: { month: string; amount: Cents }[];
}

/**
 * Plan 22, decision 1 and answer 2 of user1: the rent not collected of each tenant of the period
 * today (`rentNotCollected`, from the payments), with the marks of user1 on every closing, each
 * holding month by month up to the amount it recorded: `saldato` and `non-recuperabile` take it
 * out of what is open, `richiesto` only says it was asked. Without the payments nothing is known.
 */
export function rentOf(
  close: PeriodClose,
  input: { tenancies: Tenancy[]; payments?: Payment[] },
): Map<string, RentLedger> {
  const out = new Map<string, RentLedger>();
  if (input.payments === undefined) return out;
  const missing = rentNotCollected({
    tenancies: input.tenancies,
    payments: input.payments,
    months: monthsInPeriod(isoDate(`${close.from}-01`), isoDate(`${close.to}-01`)),
  });
  const marks = [...(close.history ?? []), close].flatMap((c) => c.rentMarks ?? []);
  for (const [tenantId, rows] of missing) {
    let open = 0;
    let asked = 0;
    let lost = 0;
    const months: RentLedger['months'] = [];
    for (const { month, amount } of rows) {
      let used = 0;
      let askedHere = 0;
      for (const mark of marks) {
        if (mark.tenantId !== tenantId) continue;
        const marked = mark.months
          .filter((m) => m.month === month)
          .reduce((sum, m) => sum + m.amount, 0);
        if (mark.outcome === 'richiesto') {
          askedHere += marked;
          continue;
        }
        const take = Math.min(marked, amount - used);
        used += take;
        if (mark.outcome === 'non-recuperabile') lost += take;
      }
      const left = amount - used;
      open += left;
      asked += Math.min(left, askedHere);
      if (left > 0) months.push({ month, amount: cents(left) });
    }
    out.set(tenantId, { open: cents(open), asked: cents(asked), lost: cents(lost), months });
  }
  return out;
}
