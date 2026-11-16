/**
 * Condominium documents and the owners' check of the condominium expenses (plan 8, section 12).
 * Pure: the date of today (`asOf`) is an argument.
 */
import { MATCH_WINDOW, expectedDebit } from './match';
import type {
  Account,
  Apartment,
  BankTransaction,
  BillMatch,
  CondoDocument,
  Instalment,
  MovementClass,
  Payment,
  Transfer,
} from './model';
import { movementUses } from './movements';
import { addDays } from './period';
import { cents, splitCents } from './money';
import type { Cents } from './money';
import type { ISODate } from './period';
import { compareText } from './text';

/**
 * The tenants' share a document gives (plan 8, decision 2: the administrator's document wins):
 * its own `quotaConduttore`, else the sum of its lines' when every line gives one, else none.
 */
export function documentQuotaConduttore(doc: CondoDocument): Cents | undefined {
  if (doc.quotaConduttore !== undefined) return doc.quotaConduttore;
  const lines = doc.lines ?? [];
  if (lines.length === 0 || lines.some((l) => l.quotaConduttore === undefined)) return undefined;
  return cents(lines.reduce((sum, l) => sum + (l.quotaConduttore ?? 0), 0));
}

/** The states of section 12 (R194), plus `in-programma`, `assunta` and, with no date, `in-attesa`. */
export type CondoStatus =
  | 'duplicato'
  | 'pagata'
  | 'importo-diverso'
  | 'assunta'
  | 'senza-addebito'
  | 'in-programma'
  | 'in-attesa';

/** An outgoing movement that no match, payment, transfer or exclusion uses (R198). */
export interface FreeDebit {
  /** The apartment of the movement's account, else the movement's own. */
  apartmentId: string;
  date: ISODate;
  /** Negative, as on the statement. */
  amount: Cents;
}

/**
 * The live outgoing movements without a use that could hide a second charge (R198): no exclusion,
 * no confirmed real match, no payment, no transfer leg (`movementUses`); a class does not count, a
 * double charge classified by a learnt rule is still free.
 */
export function freeDebits(state: {
  accounts: readonly Account[];
  transactions: readonly BankTransaction[];
  classes: MovementClass[];
  payments: Payment[];
  matches: BillMatch[];
  transfers: Transfer[];
}): FreeDebit[] {
  const uses = movementUses(state);
  const apartmentOf = new Map(state.accounts.map((a) => [a.id, a.apartmentId]));
  return state.transactions
    .filter(
      (t) =>
        t.deleted !== true &&
        t.amount < 0 &&
        (uses.get(t.id) ?? []).every((use) => use === 'classificato'),
    )
    .map((t) => ({
      apartmentId:
        (t.accountId === undefined ? undefined : apartmentOf.get(t.accountId)) ?? t.apartmentId,
      date: t.date,
      amount: t.amount,
    }));
}

/**
 * The payment state of one instalment from its live confirmed `amount` matches, in this order:
 * real debits adding up to `rata + conguaglioPrec` are `pagata`, or `duplicato` when a free
 * outgoing movement of the paying apartment (`paidFromApartmentId`, else `apartmentId`) has that
 * same amount within `MATCH_WINDOW` of the due date (R198: the parts of a split payment are
 * matched, so never free); real debits of another sum `importo-diverso`; assumed only `assunta`
 * (R2); none: `senza-addebito` from the day after the due date (no tolerance), `in-programma` up
 * to it, `in-attesa` without a date.
 */
export function instalmentStatus(
  instalment: Instalment,
  matches: readonly BillMatch[],
  asOf?: ISODate,
  free: readonly FreeDebit[] = [],
): CondoStatus {
  const amounts = ownDebits(instalment, matches);
  const real = amounts.filter((m) => m.by !== 'assumed');
  if (real.length > 0) {
    const debited = real.reduce((sum, m) => sum + m.amount, 0);
    const expected = expectedDebit(instalment);
    if (debited !== expected) return 'importo-diverso';
    const payer = instalment.paidFromApartmentId ?? instalment.apartmentId;
    const from = addDays(instalment.dueDate, -MATCH_WINDOW.daysBefore);
    const to = addDays(instalment.dueDate, MATCH_WINDOW.daysAfter);
    const twice = free.some(
      (d) => d.apartmentId === payer && d.amount === -expected && from <= d.date && d.date <= to,
    );
    return twice ? 'duplicato' : 'pagata';
  }
  if (amounts.length > 0) return 'assunta';
  if (asOf === undefined) return 'in-attesa';
  return asOf > instalment.dueDate ? 'senza-addebito' : 'in-programma';
}

const ownDebits = (instalment: Instalment, matches: readonly BillMatch[]): BillMatch[] =>
  matches.filter(
    (m) =>
      m.deleted !== true &&
      m.confirmed &&
      m.itemType === 'instalment' &&
      m.itemId === instalment.id &&
      m.part === 'amount',
  );

export interface CondoCheckRow {
  instalmentId: string;
  apartmentId: string;
  esercizio: string;
  rateIndex: number;
  rateCount: number;
  straordinaria: boolean;
  dueDate: ISODate;
  /** `rata + conguaglioPrec`. */
  expected: Cents;
  /** The real (not assumed) debits; absent if none. */
  debited?: Cents;
  debitDates: ISODate[];
  status: Exclude<CondoStatus, 'in-attesa'>;
}

/**
 * The owners' check of the condominium expenses (section 12, R194): every live condominium
 * instalment, ordinary or extraordinary, with its state on `asOf`; sorted by apartment,
 * `coversFrom`, `id`.
 */
export function condoCheck(input: {
  instalments: readonly Instalment[];
  matches: readonly BillMatch[];
  asOf: ISODate;
  free?: readonly FreeDebit[];
}): CondoCheckRow[] {
  return input.instalments
    .filter((i) => i.deleted !== true && i.kind === 'condominio')
    .sort(
      (a, b) =>
        compareText(a.apartmentId, b.apartmentId) ||
        compareText(a.coversFrom, b.coversFrom) ||
        compareText(a.id, b.id),
    )
    .map((i) => {
      const real = ownDebits(i, input.matches).filter((m) => m.by !== 'assumed');
      return {
        instalmentId: i.id,
        apartmentId: i.apartmentId,
        esercizio: i.esercizio,
        rateIndex: i.rateIndex,
        rateCount: i.rateCount,
        straordinaria: i.straordinaria === true,
        dueDate: i.dueDate,
        expected: expectedDebit(i),
        ...(real.length === 0 ? {} : { debited: cents(real.reduce((s, m) => s + m.amount, 0)) }),
        debitDates: [...new Set(real.map((m) => m.transactionDate))].sort(compareText),
        status: instalmentStatus(
          i,
          input.matches,
          input.asOf,
          input.free,
        ) as CondoCheckRow['status'],
      };
    });
}

export interface CondoDifference {
  apartmentId: string;
  esercizio: string;
  /** From `Apartment.condoDifferenceTo`, `tenants` when absent. */
  to: 'tenants' | 'owner';
  preventivo: Cents;
  consuntivo: Cents;
  /** `consuntivo − preventivo`. */
  difference: Cents;
  /** The same on the tenants' shares, when both documents give one. */
  conduttore?: { preventivo: Cents; consuntivo: Cents; difference: Cents };
}

/**
 * The difference consuntivo − preventivo of every live apartment and fiscal year with both live
 * documents (R194): a proposal to show, never written and never in the settlement. Sorted by
 * apartment and fiscal year.
 */
export function condoDifferences(
  apartments: readonly Apartment[],
  documents: readonly CondoDocument[],
): CondoDifference[] {
  const live = documents.filter((d) => d.deleted !== true);
  const find = (apartmentId: string, esercizio: string, kind: CondoDocument['kind']) =>
    live.find((d) => d.apartmentId === apartmentId && d.esercizio === esercizio && d.kind === kind);
  return live
    .filter((d) => d.kind === 'preventivo')
    .flatMap((budget): CondoDifference[] => {
      const apartment = apartments.find((a) => a.id === budget.apartmentId && a.deleted !== true);
      const final = find(budget.apartmentId, budget.esercizio, 'consuntivo');
      if (apartment === undefined || final === undefined) return [];
      const before = documentQuotaConduttore(budget);
      const after = documentQuotaConduttore(final);
      return [
        {
          apartmentId: budget.apartmentId,
          esercizio: budget.esercizio,
          to: apartment.condoDifferenceTo ?? 'tenants',
          preventivo: budget.total,
          consuntivo: final.total,
          difference: cents(final.total - budget.total),
          ...(before === undefined || after === undefined
            ? {}
            : {
                conduttore: {
                  preventivo: before,
                  consuntivo: after,
                  difference: cents(after - before),
                },
              }),
        },
      ];
    })
    .sort(
      (a, b) => compareText(a.apartmentId, b.apartmentId) || compareText(a.esercizio, b.esercizio),
    );
}

/** `amount` in equal parts over `tenantIds`, leftover cents to the first ones (`splitCents`). */
export function equalShares(
  amount: Cents,
  tenantIds: readonly string[],
): { tenantId: string; amount: Cents }[] {
  const parts = splitCents(
    amount,
    tenantIds.map(() => 1),
  );
  return tenantIds.map((tenantId, i) => ({ tenantId, amount: parts[i] as Cents }));
}
