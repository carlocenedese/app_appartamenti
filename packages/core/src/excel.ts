/**
 * The Excel of the settlement of one apartment and one period (plan 5): the rows of the sheets,
 * built from `calcConguaglio` and its own allocation functions, so the sheets cannot disagree
 * with the settlement. Values only, no formula (question 1). Pure: no I/O, no clock.
 */
import {
  CATEGORY_ORDER,
  allocateBillToMonths,
  allocateInstalment,
  SettlementInputError,
  calcConguaglio,
  isPresent,
  previousToTenants,
  settlementPeriodOf,
} from './conguaglio';
export { settlementPeriodOf } from './conguaglio';
import type { ConguaglioInput, ConguaglioResult, CostCategory } from './conguaglio';
import { apartmentFolder } from './accounts';
import type { FreeDebit } from './condominio';
import { safeWord } from './proposal';
import { closeState, closingOf, differenceTenants, unsettledTenants } from './closing';
import type {
  Apartment,
  Bill,
  BillMatch,
  Instalment,
  Payment,
  PeriodClose,
  Tenancy,
  Tenant,
} from './model';
import { cents, formatEuro, splitCents } from './money';
import type { Cents } from './money';
import { annualitaRange, isoDate, lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { MONTH_NAMES, monthRangeLabel } from './tari-note';
import { compareText } from './text';
import type { XlsxCell, XlsxSheet, XlsxWorkbook } from './xlsx-write';

/** One row of the sheet «Bollette»: a bill or an instalment that counts in the settlement. */
export interface ExcelItem {
  itemType: 'bill' | 'instalment';
  itemId: string;
  category: CostCategory;
  supplier?: string;
  number?: string;
  from: ISODate;
  to: ISODate;
  dueDate?: ISODate;
  /** The dates of the debits matched to the amount, distinct and sorted. */
  debitDates: ISODate[];
  /** The amount debited; for a condominium instalment, the tenants' part (R8). */
  amount: Cents;
  commission: Cents;
  /** Amount and commission of the months of the period only, as `calcConguaglio` splits them. */
  inPeriod: Cents;
  fileName?: string;
  note?: string;
}

const live = <T extends { deleted?: boolean }>(records: readonly T[]): T[] =>
  records.filter((record) => record.deleted !== true);
const total = (values: readonly number[]): Cents =>
  cents(values.reduce((sum, value) => sum + value, 0));
const monthRange = (from: YearMonth, to: YearMonth): YearMonth[] =>
  monthsInPeriod(isoDate(`${from}-01`), isoDate(`${to}-01`));

/** `agosto–settembre 2026`, or two ranges when the months outside lie on both sides. */
function outsideLabel(outside: YearMonth[], periodFrom: YearMonth): string {
  const before = outside.filter((m) => m < periodFrom);
  const after = outside.filter((m) => m > periodFrom);
  return [before, after]
    .filter((side) => side.length > 0)
    .map((side) => monthRangeLabel(side[0] as YearMonth, side[side.length - 1] as YearMonth))
    .join(' e ');
}

/**
 * The rows of the sheet «Bollette»: the live bills and instalments of the apartment that
 * `calcConguaglio` takes into `result` (same filters, not `pending`: R2), sorted by start, then
 * by category in `CATEGORY_ORDER`, then by id.
 */
export function excelItems(input: ConguaglioInput, result: ConguaglioResult): ExcelItem[] {
  const { apartment, period } = input;
  const periodMonths = new Set(monthRange(period.from, period.to));
  const inPeriod = (months: YearMonth[]) => months.some((m) => periodMonths.has(m));
  const pending = new Set(result.pending.map((p) => `${p.itemType}\u0000${p.itemId}`));
  const matches = new Map<string, BillMatch[]>();
  for (const match of live(input.matches)) {
    // An `assumed` match stored before B1 is no debit: the item is pending, «da verificare».
    if (!match.confirmed || match.by === 'assumed') continue;
    const key = `${match.itemType}\u0000${match.itemId}`;
    matches.set(key, [...(matches.get(key) ?? []), match]);
  }
  const own = <T extends { apartmentId: string; deleted?: boolean }>(records: T[]): T[] =>
    live(records).filter((record) => record.apartmentId === apartment.id);

  const debits = (itemType: ExcelItem['itemType'], id: string) => {
    const all = matches.get(`${itemType}\u0000${id}`) ?? [];
    const amounts = all.filter((m) => m.part === 'amount');
    return {
      amount: total(amounts.map((m) => m.amount)),
      commission: total(all.filter((m) => m.part === 'commission').map((m) => m.amount)),
      debitDates: [...new Set(amounts.map((m) => m.transactionDate))].sort(compareText),
    };
  };

  const billItem = (bill: Bill): ExcelItem => {
    const { amount, commission, debitDates } = debits('bill', bill.id);
    const amounts = allocateBillToMonths(bill, amount);
    const commissions = allocateBillToMonths(bill, commission);
    const shares = amounts.map((share, i) => ({
      month: share.month,
      amount: share.amount + (commissions[i]?.amount ?? 0),
    }));
    const inside = total(shares.filter((s) => periodMonths.has(s.month)).map((s) => s.amount));
    const outside = shares.filter((s) => !periodMonths.has(s.month));
    const fileName = bill.filePath.split('/').pop();
    return {
      itemType: 'bill',
      itemId: bill.id,
      category: bill.category,
      supplier: bill.supplier,
      ...(bill.number === undefined ? {} : { number: bill.number }),
      from: bill.periodStart,
      to: bill.periodEnd,
      ...(bill.dueDate === undefined ? {} : { dueDate: bill.dueDate }),
      debitDates,
      amount,
      commission,
      inPeriod: inside,
      ...(fileName === undefined || fileName === '' ? {} : { fileName }),
      ...(outside.length === 0
        ? {}
        : {
            note:
              `Bolletta a cavallo: ${formatEuro(total(outside.map((s) => s.amount)))} nei mesi ` +
              `${outsideLabel(
                outside.map((s) => s.month),
                period.from,
              )}, fuori da questo periodo.`,
          }),
    };
  };

  const instalmentItem = (instalment: Instalment): ExcelItem => {
    const { amount: paid, commission, debitDates } = debits('instalment', instalment.id);
    const covered = monthRange(instalment.coversFrom, instalment.coversTo);
    const parts = allocateInstalment(
      instalment,
      paid,
      esercizioOf(instalment),
      previousToTenants(apartment),
    );
    const commissions = splitCents(
      commission,
      covered.map(() => 1),
    );
    const inside =
      total(parts.filter((p) => periodMonths.has(p.month)).map((p) => p.rata + p.conguaglioPrec)) +
      total(commissions.filter((_, i) => periodMonths.has(covered[i] as YearMonth)));
    return {
      itemType: 'instalment',
      itemId: instalment.id,
      category: instalment.kind,
      number: `Rata ${String(instalment.rateIndex)} di ${String(instalment.rateCount)}, ${instalment.esercizio}`,
      from: isoDate(`${instalment.coversFrom}-01`),
      to: lastDayOfMonth(instalment.coversTo),
      dueDate: instalment.dueDate,
      debitDates,
      amount: total(parts.map((p) => p.rata + p.conguaglioPrec)),
      commission,
      inPeriod: cents(inside),
    };
  };

  const esercizioOf = (instalment: Instalment) =>
    instalment.kind === 'condominio' && apartment.condominioStart !== undefined
      ? annualitaRange(instalment.esercizio, apartment.condominioStart)
      : undefined;

  const bills = own(input.bills).filter(
    (bill) =>
      bill.includedInConguaglio &&
      bill.sharedWithTenants &&
      inPeriod(monthsInPeriod(bill.periodStart, bill.periodEnd)) &&
      !pending.has(`bill\u0000${bill.id}`),
  );
  const instalments = own(input.instalments).filter((instalment) => {
    if (instalment.straordinaria === true) return false;
    if (pending.has(`instalment\u0000${instalment.id}`)) return false;
    const esercizio = esercizioOf(instalment);
    const previousYear =
      esercizio !== undefined &&
      instalment.kind === 'condominio' &&
      instalment.conguaglioPrec !== 0 &&
      previousToTenants(apartment)
        ? monthsInPeriod(esercizio.from, esercizio.to)
        : [];
    return inPeriod([...monthRange(instalment.coversFrom, instalment.coversTo), ...previousYear]);
  });

  const rank = (category: CostCategory) => CATEGORY_ORDER.indexOf(category);
  return [...bills.map(billItem), ...instalments.map(instalmentItem)].sort(
    (a, b) =>
      compareText(a.from, b.from) ||
      rank(a.category) - rank(b.category) ||
      compareText(a.itemId, b.itemId),
  );
}

export interface ExcelInput extends ConguaglioInput {
  tenants: Tenant[];
  /** The free outgoing movements, for the «duplicato» of the owners' file (R198). */
  freeDebits?: FreeDebit[];
  /** The live closing of the period (R5), when it is closed. */
  closing?: PeriodClose;
}

/**
 * The first row of the sheets (R171, answer 5 of user1): «Conguaglio provvisorio: voci in attesa
 * N» when the period is not closed or has items waiting; otherwise «Conguaglio chiuso il
 * GG/MM/AAAA», with «, inviato il GG/MM/AAAA» and «, da saldare N» or «, saldato» (F1), saying when
 * the costs changed since the snapshot (a supplementary settlement, R5). The calculation shown is
 * always today's (F2).
 */
export function settlementStateText(
  closing: PeriodClose | undefined,
  waiting: number,
  flags: { changed: boolean; dataChanged: boolean; toCheck?: boolean } = {
    changed: false,
    dataChanged: false,
  },
): string {
  if (closing === undefined || waiting > 0) {
    return `Conguaglio provvisorio: voci in attesa ${String(waiting)}`;
  }
  const date = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
  };
  // F1: the steps after the closing, when user1 marked them. A tenant with only a difference left
  // (G) is counted there, not also in «da saldare» (finding 5 of the third review).
  const differences = differenceTenants(closing).length;
  const whole = unsettledTenants(closing).length - differences;
  const steps = [
    ...(closing.sentOn === undefined ? [] : [`inviato il ${date(closing.sentOn)}`]),
    ...(closeState(closing) === 'saldato'
      ? ['saldato']
      : closing.sentOn === undefined || whole === 0
        ? []
        : [`da saldare ${String(whole)}`]),
    ...(differences > 0
      ? [`saldato fino alla chiusura precedente, differenza da saldare ${String(differences)}`]
      : []),
  ];
  const notes = [
    ...(flags.changed ? ["dopo la chiusura c'è un conguaglio supplementare"] : []),
    ...(flags.dataChanged ? ['dati cambiati dopo la chiusura, da controllare'] : []),
    // Answer F, fourth round A: more flat charge than was due, never a credit.
    ...(flags.toCheck === true ? ['forfait incassato in più, da verificare'] : []),
  ];
  return `Conguaglio chiuso il ${date(closing.closedAt)}${steps.map((x) => `, ${x}`).join('')}${notes.length > 0 ? `: ${notes.join('; ')}` : ''}`;
}

/**
 * What changed since the closing of the period (R5), for the first row of the files: the costs
 * (`changed`, a supplementary settlement) and the other data of the snapshot (`dataChanged`).
 * When the settlement cannot be computed both are true: the file says to check.
 */
export function closingFlags(
  input: ConguaglioInput & { closing?: PeriodClose },
  result?: ConguaglioResult,
): { changed: boolean; dataChanged: boolean; toCheck: boolean } {
  const { closing } = input;
  if (closing === undefined) return { changed: false, dataChanged: false, toCheck: false };
  let current = result;
  if (current === undefined) {
    try {
      current = calcConguaglio(input);
    } catch (error) {
      if (!(error instanceof SettlementInputError)) throw error;
      return { changed: true, dataChanged: true, toCheck: false };
    }
  }
  const { changed, dataChanged, toCheck } = closingOf(
    closing,
    current,
    input,
    isoDate(closing.closedAt.slice(0, 10)),
  );
  return { changed, dataChanged, toCheck };
}

type Span = { from: YearMonth; to: YearMonth };

/** Question 3, R172, R177: a payment counts in `period` by the month given, else by its date. */
export function inSettlement(
  payment: Pick<Payment, 'forMonth' | 'date'>,
  period: Span,
  spans: readonly Span[],
): boolean {
  if (payment.forMonth !== undefined) {
    return payment.forMonth >= period.from && payment.forMonth <= period.to;
  }
  const home = settlementPeriodOf(payment.date.slice(0, 7) as YearMonth, spans);
  return home?.from === period.from && home.to === period.to;
}

export type SettlementStatus =
  'saldato' | 'parziale' | 'da pagare' | 'da restituire' | 'versato in più';

/**
 * The status of a settlement (section 27, R6, question 3, R178): `saldato` once nothing is left and
 * every payment counted is in a statement; `versato in più` beyond the settlement, on its side;
 * while nothing is paid `da pagare`, or `da restituire` for a credit of the tenant; else `parziale`.
 */
export function settlementStatus(
  due: Cents,
  paid: readonly Pick<Payment, 'amount' | 'source'>[],
): SettlementStatus {
  const versato = total(paid.map((p) => p.amount));
  if (versato === due && paid.every((p) => p.source === 'csv')) return 'saldato';
  if (due >= 0 ? versato > due : versato < due) return 'versato in più';
  if (versato === 0) return due < 0 ? 'da restituire' : 'da pagare';
  return 'parziale';
}

export const EXCEL_SHEETS = [
  'Bollette',
  'Conguagli',
  'Affitti versati',
  'Versamenti conguaglio',
] as const;
export type ExcelSheetName = (typeof EXCEL_SHEETS)[number];

/**
 * The headers of each sheet, in one place until user1 sends the format of the example (question
 * 2). «Affitti versati» goes on with one column per month of the period (`ott 2026`).
 */
export const EXCEL_HEADERS: Record<ExcelSheetName, readonly string[]> = {
  Bollette: [
    'Tipo',
    'Fornitore',
    'Numero',
    'Periodo dal',
    'Periodo al',
    'Scadenza',
    'Addebito',
    'Importo',
    'Commissione',
    'Quota nel periodo',
    'File',
    'Nota',
  ],
  Conguagli: [
    'Posto',
    'Inquilino',
    'Mesi',
    'N. mesi',
    'Spese',
    'Condominio',
    'Forfait incassato',
    'Conguaglio',
    'Versato',
    'Residuo',
    'Stato',
  ],
  'Affitti versati': ['Posto', 'Inquilino', 'Quota'],
  'Versamenti conguaglio': ['Inquilino', 'Data', 'Importo', 'Mese indicato', 'Origine'],
};

const CATEGORY_LABELS: Record<CostCategory, string> = {
  elettricita: 'Elettricità',
  gas: 'Gas',
  acqua: 'Acqua',
  internet: 'Internet',
  altro: 'Altro',
  tari: 'TARI',
  condominio: 'Condominio',
};

const PENDING_REASONS: Record<string, string> = {
  '': 'in attesa di pagamento',
  'importo diverso': 'importo diverso',
  'da verificare': 'da verificare',
  'parte della proprietà maggiore della rata': 'quota maggiore della rata',
};

const SOURCE_LABELS: Record<Payment['source'], string> = {
  csv: 'estratto conto',
  manual: 'a mano',
  excel: 'Excel',
};

/**
 * Where the Excel of a period goes under the shared folder (section 20, question 7, R173):
 * `<Appartamento>/<periodo>/Excel/Conguaglio_<Appartamento>_<periodo>.xlsx`, ASCII letters,
 * digits, `_` and `-` only, never a name Windows reserves.
 */
export function excelFilePath(
  apartment: Pick<Apartment, 'name'>,
  period: Pick<ConguaglioInput['period'], 'label'>,
): string {
  const folder = apartmentFolder(apartment.name);
  const label = safeWord(period.label, 'periodo', 20);
  return `${folder}/${label}/Excel/Conguaglio_${folder}_${label}.xlsx`;
}

/** A tenant of the period has no live `tenant` record, so no name (question 8). */
export class ExcelInputError extends Error {
  readonly code = 'missing-tenant';
  readonly tenantIds: string[];

  constructor(tenantIds: string[]) {
    // Constant message: the ids are in `tenantIds`.
    super("Un inquilino del periodo non ha un'anagrafica: aggiungila prima di generare l'Excel.");
    this.name = 'ExcelInputError';
    this.tenantIds = tenantIds;
  }
}

const text = (value: string | undefined): XlsxCell | null =>
  value === undefined || value === '' ? null : { kind: 'text', value };
const euro = (value: Cents): XlsxCell => ({ kind: 'euro', value });
const date = (value: ISODate | undefined): XlsxCell | null =>
  value === undefined ? null : { kind: 'date', value };
/** `ott`. */
const shortMonth = (month: YearMonth): string =>
  (MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '').slice(0, 3);
/** `ott 2026`. */
const monthWithYear = (month: YearMonth): string => `${shortMonth(month)} ${month.slice(0, 4)}`;
/** `10/12/2026`. */
const dayMonthYear = (day: ISODate): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/**
 * The Excel of the settlement of `input.period` for `input.apartment` (plan 5): the sheets of
 * `EXCEL_SHEETS`, values only. A `SettlementInputError` of `calcConguaglio` goes through as it
 * is; a tenant of the period without a live `Tenant` throws `ExcelInputError`. No formula, no
 * deposit; the pending items only listed, with no amount (questions 1, 3, 6).
 */
export function buildConguaglioWorkbook(input: ExcelInput): XlsxWorkbook {
  const result = calcConguaglio(input);
  const { apartment, period } = input;
  const names = new Map(live(input.tenants).map((t) => [t.id, t.name]));
  const missing = result.tenants.map((t) => t.tenantId).filter((id) => !names.has(id));
  if (missing.length > 0) throw new ExcelInputError(missing);
  const nameOf = (tenantId: string) => names.get(tenantId) ?? '';

  const months = monthRange(period.from, period.to);
  const longPeriod = months.length > 12;
  const settled = new Set(result.tenants.map((t) => t.tenantId));
  const tenancies = live(input.tenancies).filter(
    (t) =>
      t.apartmentId === apartment.id &&
      settled.has(t.tenantId) &&
      months.some((m) => isPresent(t, m)),
  );
  const monthsOf = (t: Tenancy) => months.filter((m) => isPresent(t, m));
  const roomRank = (room: string | undefined) => {
    const index = room === undefined ? -1 : (apartment.rooms ?? []).indexOf(room);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const byBed = (a: Tenancy, b: Tenancy) =>
    roomRank(a.room) - roomRank(b.room) ||
    compareText(monthsOf(a)[0] ?? '', monthsOf(b)[0] ?? '') ||
    compareText(a.tenantId, b.tenantId) ||
    compareText(a.id, b.id);
  tenancies.sort(
    (a, b) => compareText(monthsOf(a)[0] ?? '', monthsOf(b)[0] ?? '') || compareText(a.id, b.id),
  );
  const presences = (tenantId: string) => tenancies.filter((t) => t.tenantId === tenantId);
  const firstPresence = (tenantId: string) => presences(tenantId)[0] as Tenancy;

  const items = excelItems(input, result);
  const bollette: (XlsxCell | null)[][] = items.map((item) => [
    text(CATEGORY_LABELS[item.category]),
    text(item.supplier),
    text(item.number),
    date(item.from),
    date(item.to),
    date(item.dueDate),
    text(item.debitDates.map(dayMonthYear).join(', ')),
    euro(item.amount),
    euro(item.commission),
    euro(item.inPeriod),
    text(item.fileName),
    text(item.note),
  ]);
  bollette.push([
    text('Totale'),
    ...Array<null>(6).fill(null),
    ...(['amount', 'commission', 'inPeriod'] as const).map((k) =>
      euro(total(items.map((item) => item[k]))),
    ),
  ]);
  // Plan 17, R300 (plan 8 question 10): the recoveries from tenants, a section of their own after
  // the total; in «Conguagli» they are in the column Spese.
  const recovering = result.tenants.filter((t) => t.recupero !== undefined);
  if (recovering.length > 0) {
    bollette.push([], [text('Recuperi dagli inquilini')], [text('Inquilino'), text('Importo')]);
    for (const t of recovering)
      bollette.push([text(nameOf(t.tenantId)), euro(t.recupero ?? cents(0))]);
  }
  // Question 6: the pending items are listed after the total, with no amount.
  interface PendingRow {
    id: string;
    category: CostCategory;
    supplier?: string;
    from: ISODate;
    to: ISODate;
    reason?: string;
  }
  const pending = result.pending.flatMap((p): PendingRow[] => {
    if (p.itemType === 'bill') {
      const b = input.bills.find((x) => x.id === p.itemId);
      return b === undefined
        ? []
        : [
            {
              id: b.id,
              category: b.category,
              supplier: b.supplier,
              from: b.periodStart,
              to: b.periodEnd,
              ...(p.reason === undefined ? {} : { reason: p.reason }),
            },
          ];
    }
    const i = input.instalments.find((x) => x.id === p.itemId);
    return i === undefined
      ? []
      : [
          {
            id: i.id,
            category: i.kind,
            from: isoDate(`${i.coversFrom}-01`),
            to: lastDayOfMonth(i.coversTo),
            ...(p.reason === undefined ? {} : { reason: p.reason }),
          },
        ];
  });
  if (pending.length > 0) {
    const rank = (category: CostCategory) => CATEGORY_ORDER.indexOf(category);
    pending.sort(
      (a, b) =>
        compareText(a.from, b.from) ||
        rank(a.category) - rank(b.category) ||
        compareText(a.id, b.id),
    );
    bollette.push(
      [],
      [text('Voci in attesa di pagamento')],
      ['Tipo', 'Fornitore', undefined, 'Periodo dal', 'Periodo al', 'Motivo'].map(text),
    );
    for (const p of pending) {
      bollette.push([
        text(CATEGORY_LABELS[p.category]),
        text(p.supplier),
        null,
        date(p.from),
        date(p.to),
        // D15, R179: the reason of `calcConguaglio`, in the words of user1.
        text(PENDING_REASONS[p.reason ?? ''] ?? p.reason),
      ]);
    }
  }

  const payments = live(input.payments).filter(
    (p) => p.confirmed && p.apartmentId === apartment.id,
  );
  const spans = input.periods ?? [period];
  const settlementPayments = payments
    .filter(
      (p) => p.kind === 'conguaglio' && settled.has(p.tenantId) && inSettlement(p, period, spans),
    )
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
  const paidBy = (tenantId: string) => settlementPayments.filter((p) => p.tenantId === tenantId);

  const label = (m: YearMonth) => (longPeriod ? monthWithYear(m) : shortMonth(m));
  const settlements = [...result.tenants].sort((a, b) =>
    byBed(firstPresence(a.tenantId), firstPresence(b.tenantId)),
  );
  const columns = settlements.map((t) => {
    const versato = total(paidBy(t.tenantId).map((p) => p.amount));
    return [
      t.spese + t.commissione + (t.recupero ?? 0),
      t.condominio.rata + t.condominio.conguaglioPrec,
      t.forfaitIncassato,
      t.due,
      versato,
      t.due - versato,
    ];
  });
  const conguagli: (XlsxCell | null)[][] = settlements.map((t, i) => {
    const own = presences(t.tenantId);
    const rooms = [...new Set(own.flatMap((p) => (p.room === undefined ? [] : [p.room])))];
    const spans = own.map((p) => {
      const present = monthsOf(p);
      const first = present[0] as YearMonth;
      const last = present[present.length - 1] as YearMonth;
      return first === last ? label(first) : `${label(first)} – ${label(last)}`;
    });
    return [
      text(rooms.join(', ')),
      text(nameOf(t.tenantId)),
      text(spans.join('; ')),
      { kind: 'int', value: new Set(own.flatMap(monthsOf)).size },
      ...(columns[i] ?? []).map((v) => euro(cents(v))),
      text(settlementStatus(t.due, paidBy(t.tenantId))),
    ];
  });
  // The empty beds (question 4): with them Spese + Condominio of the total is the bills' total.
  const empty = result.unassignedByBucket;
  const emptyBeds = [empty.spese + empty.commissione, empty.rata + empty.conguaglioPrec];
  conguagli.push([
    text('Posti vuoti (proprietà)'),
    null,
    null,
    null,
    ...emptyBeds.map((v) => euro(cents(v))),
  ]);
  conguagli.push([
    text('Totale'),
    null,
    null,
    null,
    ...[0, 1, 2, 3, 4, 5].map((c) =>
      euro(total([...columns.map((col) => col[c] ?? 0), emptyBeds[c] ?? 0])),
    ),
  ]);

  const rentDates = new Map<string, ISODate[]>();
  for (const p of payments) {
    if (p.kind !== 'canone') continue;
    const key = `${p.tenantId}\u0000${p.forMonth ?? p.date.slice(0, 7)}`;
    rentDates.set(key, [...(rentDates.get(key) ?? []), p.date]);
  }
  const affitti: (XlsxCell | null)[][] = [...tenancies].sort(byBed).map((t) => [
    text(t.room),
    text(nameOf(t.tenantId)),
    euro(cents(t.monthlyRent + t.monthlyForfait)),
    ...months.map((m) =>
      isPresent(t, m)
        ? text(
            [...(rentDates.get(`${t.tenantId}\u0000${m}`) ?? [])]
              .sort(compareText)
              .map((d) => `${d.slice(8, 10)} ${shortMonth(d.slice(0, 7) as YearMonth)}`)
              .join(', '),
          )
        : null,
    ),
  ]);

  const versamenti: (XlsxCell | null)[][] = settlementPayments.map((p) => [
    text(nameOf(p.tenantId)),
    date(p.date),
    euro(p.amount),
    text(p.forMonth === undefined ? undefined : monthWithYear(p.forMonth)),
    text(SOURCE_LABELS[p.source]),
  ]);

  const header = (name: ExcelSheetName, extra: string[] = []): XlsxCell[] =>
    [...EXCEL_HEADERS[name], ...extra].map((value) => ({ kind: 'text', value }));
  // Question 5, R171: provisional unless closed (R5) with nothing waiting.
  const closing = input.closing;
  const provisional: XlsxCell[] = [
    {
      kind: 'text',
      value: settlementStateText(closing, result.pending.length, closingFlags(input, result)),
    },
  ];
  const sheet = (
    name: ExcelSheetName,
    rows: (XlsxCell | null)[][],
    extra?: string[],
    top: XlsxCell[][] = [],
  ) => ({ name, rows: [...top, header(name, extra), ...rows] }) satisfies XlsxSheet;
  return {
    sheets: [
      sheet('Bollette', bollette, [], [provisional]),
      sheet('Conguagli', conguagli, [], [provisional]),
      sheet('Affitti versati', affitti, months.map(monthWithYear)),
      sheet('Versamenti conguaglio', versamenti),
    ],
  };
}
