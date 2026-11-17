/**
 * The status of each apartment for the Home (section 10; section 30 «Da rivedere» and
 * «Scadenze»), as data: counts by code, never a colour, a severity or a line of interface (R204,
 * question 3; plan 15). It only reads, composing the loaders that already exist; no rule, window
 * or threshold is decided here (the «in scadenza» window is `soonDays`, given by the caller).
 */
import { pendingDocuments } from './bill-import';
import { loadCondo } from './condo-store';
import { calcConguaglio, SettlementInputError } from './conguaglio';
import { loadContractChecks, loadContractStatus } from './contract-store';
import { loadExcelInput } from './excel-store';
import { checkConsistency } from './journal';
import {
  AccountSchema,
  ApartmentSchema,
  BankTransactionSchema,
  BillMatchSchema,
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
  /** The shares of the empty beds, left to the owner. */
  unassigned?: Cents;
}

export interface ApartmentDashboard {
  apartmentId: string;
  /** Count by code, only the codes with a count above 0, keys sorted. */
  counts: Record<string, number>;
}

export type DashboardResult =
  | { status: 'computed'; apartments: ApartmentDashboard[]; settlements: SettlementStatusRow[] }
  | { status: 'refused'; reason: 'inconsistent-store' | 'bad-year' };

// States that mean nothing is left to do, so they are not counted. `assunta` is counted: whether
// an instalment without a statement is paid is open (R204, question 7).
const DONE = new Set(['pagata', 'versata', 'in-linea', 'confermata']);

/**
 * The counts of every live apartment, by id (R264: any loader refused refuses it all):
 * `documento-da-rivedere` (`pendingDocuments`), `movimento-senza-uso` (a booked movement with no
 * use in `movementUses`, the definition of the reconciliation, on the apartment of its account),
 * `scadenza:<stato>` and `scadenza-controllo:<check>` (`loadScadenzario`, for each apartment of the
 * item), `contratto:<codice>` (`loadContractChecks` in the month of `today`), `caparra:<stato>`
 * (`loadContractStatus`, once per tenant), `condominio:<stato>` and
 * `condominio:recupero-oltre-spesa` (`loadCondo` on `today`), `tasse:<stato>` and
 * `tasse:stima-mancante` (`loadTaxTable`, only with `taxYear`, for each apartment of the taxpayer),
 * and for each settlement period given `conguaglio:voci-in-attesa` (the pending items),
 * `conguaglio:posti-vuoti` (1 when the empty beds have a share) or `conguaglio:non-calcolabile`.
 * States that mean done (`pagata`, `versata`, `in-linea`) are not counted.
 */
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

export async function loadDashboard(
  store: Store,
  options: DashboardOptions,
): Promise<DashboardResult> {
  const refused = { status: 'refused', reason: 'inconsistent-store' } as const;
  if ((await checkConsistency(store)).length > 0) return refused;
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
      settlements.push({
        apartmentId,
        periodLabel,
        pending: result.pending.length,
        unassigned: result.unassigned,
      });
      add(apartmentId, 'conguaglio:voci-in-attesa', result.pending.length);
      if (result.unassigned !== 0) add(apartmentId, 'conguaglio:posti-vuoti');
    } catch (error) {
      if (!(error instanceof SettlementInputError)) throw error;
      settlements.push({ apartmentId, periodLabel, problem: error.code });
      add(apartmentId, 'conguaglio:non-calcolabile');
    }
  }

  const apartments = (await loadAll(store, 'apartment', ApartmentSchema)).records;
  return {
    status: 'computed',
    apartments: apartments.map((a) => ({
      apartmentId: a.id,
      counts: Object.fromEntries(
        [...(counts.get(a.id) ?? new Map<string, number>())].sort(([x], [y]) =>
          x < y ? -1 : x > y ? 1 : 0,
        ),
      ),
    })),
    settlements,
  };
}
