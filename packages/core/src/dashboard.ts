/**
 * The status of each apartment for the Home (section 10; section 30 «Da rivedere» and
 * «Scadenze»), as data: counts by code, never a colour, a severity or a line of interface (R204,
 * question 3; plan 15). It only reads, composing the loaders that already exist; no rule, window
 * or threshold is decided here (the «in scadenza» window is `soonDays`, given by the caller).
 */
import { pendingDocuments } from './bill-import';
import { loadCondo } from './condo-store';
import { compareConsumption, worstLevel } from './consumption';
import { consumptionThresholdsFor } from './consumption-store';
import { closingOf } from './closing';
import { calcConguaglio, SettlementInputError } from './conguaglio';
import { loadContractChecks, loadContractStatus } from './contract-store';
import { loadExcelInput } from './excel-store';
import { writesBlocked } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
  BillSchema,
  ConsumptionSettingsSchema,
  ContractSchema,
  MovementClassSchema,
  PaymentSchema,
  TransferSchema,
} from './model';
import type { Cents } from './money';
import { movementUses } from './movements';
import { loadScadenzario } from './payables';
import { settlementPeriods, yearMonth } from './period';
import type { ISODate, YearMonth } from './period';
import { loadAll } from './store/load';
import type { Store } from './store/store';
import { loadTaxTable } from './tax-store';
import { compareText } from './text';

export interface DashboardOptions {
  today: ISODate;
  /** Days of the «in scadenza» window; `DEFAULT_SOON_DAYS` when absent (R309). */
  soonDays?: number;
  /** The tax year of the table of «Tasse e stime»; without it the taxes are left out. */
  taxYear?: string;
  /**
   * The settlement periods to look at; absent, the period in course of each live apartment (the
   * one of its live contracts that holds the month of `today`: answer of user1, R316).
   */
  settlements?: { apartmentId: string; periodLabel: string }[];
}

export interface SettlementStatusRow {
  apartmentId: string;
  periodLabel: string;
  /** Why the period could not be computed: a refusal of `loadExcelInput` or the input error. */
  problem?: string;
  /** Items of the period that do not count yet (conguaglio provvisorio). */
  pending?: number;
  /** The months with no tenant present, left to the owner (plan 21). */
  unassigned?: Cents;
  /** R5: the period is closed («chiuso»); absent, it is provisional. */
  closed?: true;
  /** F1: the step of a closed period: `chiuso`, `inviato` (sent) or `saldato` (all settled). */
  step?: 'chiuso' | 'inviato' | 'saldato';
}

export interface ApartmentDashboard {
  apartmentId: string;
  /** Count by code, only the codes with a count above 0, keys sorted. */
  counts: Record<string, number>;
  /** False: no consumption thresholds for the apartment, so no alarm («soglie non impostate»). */
  consumptionThresholds: boolean;
}

export type DashboardResult =
  | { status: 'computed'; apartments: ApartmentDashboard[]; settlements: SettlementStatusRow[] }
  | { status: 'refused'; reason: 'inconsistent-store' | 'bad-year' };

// States that mean nothing is left to do, so they are not counted. `da-verificare` is counted: an
// instalment without a statement is never taken as paid (B1).
const DONE = new Set(['pagata', 'versata', 'in-linea', 'confermata']);

/** The settlement period in course of each live apartment, by apartment and label (R316). */
async function currentSettlements(
  store: Store,
  month: YearMonth,
): Promise<{ apartmentId: string; periodLabel: string }[]> {
  const contracts = (await loadAll(store, 'contract', ContractSchema)).records;
  const rows = new Map<string, { apartmentId: string; periodLabel: string }>();
  for (const apartment of (await loadAll(store, 'apartment', ApartmentSchema)).records) {
    for (const contract of contracts.filter((c) => c.apartmentId === apartment.id)) {
      let periods;
      try {
        periods = settlementPeriods(contract, apartment.annualitaStart);
      } catch {
        continue; // a contract the settlement cannot read: «contratto:» says it already
      }
      for (const p of periods.filter((p) => p.from <= month && month <= p.to)) {
        rows.set(`${apartment.id}\u0000${p.label}`, {
          apartmentId: apartment.id,
          periodLabel: p.label,
        });
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      compareText(a.apartmentId, b.apartmentId) || compareText(a.periodLabel, b.periodLabel),
  );
}

/**
 * The counts of every live apartment, by id (R264: any loader refused refuses it all):
 * `documento-da-rivedere` (`pendingDocuments`), `movimento-senza-uso` (a booked movement with no
 * use in `movementUses`, the definition of the reconciliation, on the apartment of its account),
 * `scadenza:<stato>` and `scadenza-controllo:<check>` (`loadScadenzario`, for each apartment of the
 * item), `contratto:<codice>` (`loadContractChecks` in the month of `today`), `caparra:<stato>`
 * (`loadContractStatus`, once per tenant), `condominio:<stato>` and
 * `condominio:recupero-oltre-spesa` (`loadCondo` on `today`), `tasse:<stato>` and
 * `tasse:stima-mancante` (`loadTaxTable`, only with `taxYear`, for each apartment of the taxpayer),
 * and for each settlement period given (else the one in course of each apartment, R316)
 * `conguaglio:voci-in-attesa` (the pending items),
 * `conguaglio:mesi-senza-inquilini` (1 when months with no tenant present carry a cost, left to the
 * owner, plan 21; on a period closed before plan 21, recomputed over the beds, R363, it holds the
 * empty-bed shares) or `conguaglio:non-calcolabile`,
 * `conguaglio:supplementare` (a closed period whose costs changed since its snapshot, R5),
 * `conguaglio:dati-cambiati` (other data of its snapshot changed, such as the flat charge),
 * and `consumi:giallo` / `consumi:rosso` (the last live bill of each apartment and kind by its
 * worst level, `compareConsumption` with the thresholds of its apartment; none without
 * thresholds: plan 19, R331).
 * States that mean done (`pagata`, `versata`, `in-linea`, `confermata`) are not counted.
 */
export async function loadDashboard(
  store: Store,
  options: DashboardOptions,
): Promise<DashboardResult> {
  const refused = { status: 'refused', reason: 'inconsistent-store' } as const;
  if (await writesBlocked(store)) return refused;
  const { today } = options;
  const asOf = yearMonth(today.slice(0, 7));
  const counts = new Map<string, Map<string, number>>();
  const add = (apartmentId: string, code: string, n = 1) => {
    if (n <= 0) return;
    const own = counts.get(apartmentId) ?? new Map<string, number>();
    own.set(code, (own.get(code) ?? 0) + n);
    counts.set(apartmentId, own);
  };

  for (const doc of await pendingDocuments(store)) add(doc.apartmentId, 'documento-da-rivedere');

  const accounts = (await loadAll(store, 'account', AccountSchema)).records;
  const uses = movementUses({
    classes: (await loadAll(store, 'movementClass', MovementClassSchema)).records,
    payments: (await loadAll(store, 'payment', PaymentSchema)).records,
    matches: (await loadAll(store, 'match', BillMatchSchema)).records,
    transfers: (await loadAll(store, 'transfer', TransferSchema)).records,
  });
  for (const t of (await loadAll(store, 'transaction', BankTransactionSchema)).records) {
    if (t.booked === false || uses.has(t.id)) continue;
    const account = accounts.find((a) => a.id === t.accountId);
    add(account?.apartmentId ?? t.apartmentId, 'movimento-senza-uso');
  }

  const scadenze = await loadScadenzario(store, {
    today,
    ...(options.soonDays === undefined ? {} : { soonDays: options.soonDays }),
  });
  if (scadenze.status === 'refused') return refused;
  for (const item of scadenze.items) {
    for (const id of item.apartmentIds) {
      if (!DONE.has(item.state)) add(id, `scadenza:${item.state}`);
      if (item.check !== undefined) add(id, `scadenza-controllo:${item.check}`);
    }
  }

  const contracts = await loadContractChecks(store, { asOf });
  if (contracts.status === 'refused') return refused;
  for (const check of contracts.checks) {
    const contract = contracts.contracts.find((c) => c.id === check.contractId);
    if (contract !== undefined) add(contract.apartmentId, `contratto:${check.code}`);
  }

  const status = await loadContractStatus(store, { asOf });
  if (status.status === 'refused') return refused;
  // A tenant in two contracts of one apartment is counted once; the state that is not
  // `versata` wins, so nothing to check is hidden (R264).
  const deposits = new Map<string, (typeof status.contracts)[number]['deposits'][number]>();
  for (const d of status.contracts.flatMap((c) => c.deposits)) {
    const key = `${d.apartmentId}/${d.tenantId}`;
    const seen = deposits.get(key);
    if (seen === undefined || seen.status === 'versata') deposits.set(key, d);
  }
  for (const d of deposits.values()) {
    if (!DONE.has(d.status)) add(d.apartmentId, `caparra:${d.status}`);
  }

  const condo = await loadCondo(store, { asOf: today });
  if (condo.status === 'refused') return refused;
  for (const row of condo.rates) {
    if (!DONE.has(row.status)) add(row.apartmentId, `condominio:${row.status}`);
  }
  for (const warning of condo.warnings) {
    const row = condo.rates.find((r) => r.instalmentId === warning.instalmentId);
    if (row !== undefined) add(row.apartmentId, 'condominio:recupero-oltre-spesa');
  }

  if (options.taxYear !== undefined) {
    const taxes = await loadTaxTable(store, { year: options.taxYear, today });
    if (taxes.status === 'refused') return { status: 'refused', reason: taxes.reason };
    for (const table of taxes.tables) {
      for (const row of table.rows) {
        if (DONE.has(row.state)) continue;
        for (const id of table.apartmentIds) add(id, `tasse:${row.state}`);
      }
    }
    for (const w of taxes.warnings) {
      for (const id of w.apartmentIds) add(id, 'tasse:stima-mancante');
    }
  }

  const settlements: SettlementStatusRow[] = [];
  for (const { apartmentId, periodLabel } of options.settlements ??
    (await currentSettlements(store, asOf))) {
    const loaded = await loadExcelInput(store, { apartmentId, periodLabel });
    if (loaded.status === 'refused') {
      if (loaded.reason === 'inconsistent-store') return refused;
      settlements.push({ apartmentId, periodLabel, problem: loaded.reason });
      add(apartmentId, 'conguaglio:non-calcolabile');
      continue;
    }
    try {
      const result = calcConguaglio(loaded.input);
      const { closing } = loaded.input;
      // One computation of the settlement for every count (fifth round, `closingOf`).
      const since =
        closing === undefined ? undefined : closingOf(closing, result, loaded.input, today);
      settlements.push({
        apartmentId,
        periodLabel,
        pending: result.pending.length,
        unassigned: result.unassigned,
        ...(since === undefined
          ? {}
          : { closed: true as const, step: since.state as 'chiuso' | 'inviato' | 'saldato' }),
      });
      if (since !== undefined && closing !== undefined) {
        // F1: a closed period still to send, then the tenants still to settle; a tenant with only
        // a difference left (G) is counted apart (finding 5).
        if (closing.sentOn === undefined) add(apartmentId, 'conguaglio:da-inviare');
        else
          add(
            apartmentId,
            'conguaglio:da-saldare',
            since.unsettled.length - since.differences.length,
          );
        add(apartmentId, 'conguaglio:differenza-da-saldare', since.differences.length);
        // C3: flat charge collected beyond what was due, «da verificare».
        add(
          apartmentId,
          'conguaglio:forfait-da-verificare',
          since.tenants.filter((t) => t.toCheck > 0).length,
        );
      }
      add(apartmentId, 'conguaglio:voci-in-attesa', result.pending.length);
      if (result.unassigned !== 0) add(apartmentId, 'conguaglio:mesi-senza-inquilini');
      // R5: a closed period whose costs changed since the snapshot (a late bill): a supplementary
      // settlement to make, «Da rivedere».
      if (since?.changed === true) add(apartmentId, 'conguaglio:supplementare');
      // The tenants of the period changed since the snapshot: to check.
      if (since?.dataChanged === true) add(apartmentId, 'conguaglio:dati-cambiati');
    } catch (error) {
      if (!(error instanceof SettlementInputError)) throw error;
      settlements.push({ apartmentId, periodLabel, problem: error.code });
      add(apartmentId, 'conguaglio:non-calcolabile');
    }
  }

  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  const settings = (await loadAll(store, 'consumptionSettings', ConsumptionSettingsSchema)).records;
  const bills = (await loadAll(store, 'bill', BillSchema)).records;
  // The state now: only the last live bill of each apartment and kind (latest end, then id).
  const last = new Map<string, (typeof bills)[number]>();
  for (const bill of bills) {
    const key = `${bill.apartmentId}\u0000${bill.category}`;
    const seen = last.get(key);
    if (
      seen === undefined ||
      bill.periodEnd > seen.periodEnd ||
      (bill.periodEnd === seen.periodEnd && bill.id > seen.id)
    ) {
      last.set(key, bill);
    }
  }
  for (const bill of last.values()) {
    const thresholds = consumptionThresholdsFor(settings, bill.apartmentId);
    if (thresholds === undefined) continue;
    const level = worstLevel(compareConsumption(bill, bills, { thresholds }));
    if (level !== undefined) add(bill.apartmentId, `consumi:${level}`);
  }
  return {
    status: 'computed',
    apartments: apartments.map((a) => ({
      apartmentId: a.id,
      counts: Object.fromEntries(
        [...(counts.get(a.id) ?? new Map<string, number>())].sort(([x], [y]) =>
          x < y ? -1 : x > y ? 1 : 0,
        ),
      ),
      consumptionThresholds: consumptionThresholdsFor(settings, a.id) !== undefined,
    })),
    settlements,
  };
}
