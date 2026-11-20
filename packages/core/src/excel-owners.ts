/**
 * The Excel reserved to the owners of one apartment and one period (plan 5b, section 12, R8): every
 * live condominium instalment, ordinary or extraordinary, paid or not, with rata, last year's
 * settlement, owner share, expected and debited amount, debit dates and payment status in separate
 * columns. Never shared with the tenants: nothing about them goes in. Values only. Pure.
 */
import { instalmentStatus } from './condominio';
import type { FreeDebit } from './condominio';
import { instalmentOwnerShare, previousToTenants } from './conguaglio';
import type { ConguaglioInput } from './conguaglio';
import { expectedDebit } from './match';
import { apartmentFolder } from './accounts';
import type { Apartment, Instalment, PeriodClose, TenantRecovery } from './model';
import { closingFlags, settlementStateText } from './excel';
import { safeWord } from './proposal';
import { cents } from './money';
import type { Cents } from './money';
import { esercizioRange, isoDate, lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { compareText } from './text';
import type { XlsxCell, XlsxWorkbook } from './xlsx-write';

/** `instalmentStatus` without a date (plan 8, R195): the file has no clock. */
export type OwnersStatus =
  'pagata' | 'importo-diverso' | 'duplicato' | 'da-verificare' | 'in-attesa';

export interface OwnersItem {
  instalmentId: string;
  esercizio: string;
  rateIndex: number;
  rateCount: number;
  straordinaria: boolean;
  from: ISODate;
  to: ISODate;
  dueDate: ISODate;
  rata: Cents;
  conguaglioPrec: Cents;
  /**
   * Its part of the yearly owner share; an extraordinary instalment is the owner's in full (R3),
   * less the live recoveries from tenants on it (plan 17, R300).
   */
  ownerShare: Cents;
  /** `rata + conguaglioPrec` (R3). */
  expected: Cents;
  /** The confirmed debits that are not assumed; absent if none. */
  debited?: Cents;
  commission: Cents;
  /** Dates of the debits that are not assumed, distinct and sorted. */
  debitDates: ISODate[];
  status: OwnersStatus;
}

export const OWNERS_SHEET = 'Condominio';

/** The headers of the sheet, in one place. */
export const OWNERS_HEADERS = [
  'Esercizio',
  'Rata',
  'Straordinaria',
  'Mesi dal',
  'Mesi al',
  'Scadenza',
  'Importo rata',
  'Conguaglio anno prima',
  'Quota proprietà',
  'Addebito atteso',
  'Addebitato',
  'Commissione',
  'Data addebito',
  'Stato',
] as const;

const STATUS_LABELS: Record<OwnersStatus, string> = {
  pagata: 'pagata',
  'importo-diverso': 'importo diverso',
  duplicato: 'duplicato',
  'da-verificare': 'da verificare',
  'in-attesa': 'in attesa di pagamento',
};

const total = (values: readonly number[]): Cents =>
  cents(values.reduce((sum, value) => sum + value, 0));
const monthRange = (from: YearMonth, to: YearMonth): YearMonth[] =>
  monthsInPeriod(isoDate(`${from}-01`), isoDate(`${to}-01`));

/**
 * The owners' part of a condominium instalment (R3, R8): an extraordinary one in full, less the
 * live recoveries from tenants on it (plan 17, R300); an ordinary one its part of the yearly owner
 * share, plus last year's settlement with `condoDifferenceTo: 'owner'` (R193). The «Quota
 * proprietà» of the owners' file and the condominio row of the tax table (R305).
 */
export function ownerShareOf(
  instalment: Instalment,
  apartment: Apartment,
  recoveries: readonly TenantRecovery[],
): Cents {
  if (instalment.straordinaria === true) {
    const recovered = recoveries
      .filter(
        (r) =>
          r.deleted !== true &&
          r.instalmentId === instalment.id &&
          r.status !== 'non-recuperabile' &&
          r.amount > 0,
      )
      .reduce((sum, r) => sum + r.amount, 0);
    return cents(expectedDebit(instalment) - recovered);
  }
  return cents(
    instalmentOwnerShare(instalment) +
      (previousToTenants(apartment) ? 0 : instalment.conguaglioPrec),
  );
}

/**
 * The rows of the sheet: the live condominium instalments of the apartment whose months touch the
 * period, with the criterion of the sheet «Bollette» (R153) but with the extraordinary and the
 * pending ones; sorted by `coversFrom`, then `id`.
 */
export function ownersItems(input: ConguaglioInput & { freeDebits?: FreeDebit[] }): OwnersItem[] {
  const { apartment, period } = input;
  const periodMonths = new Set(monthRange(period.from, period.to));
  const matches = input.matches.filter(
    (m) => m.deleted !== true && m.confirmed && m.itemType === 'instalment',
  );
  // The instalments the matching leaves «da verificare» (B1).
  const unverifiedIds = new Set(
    (input.unverified ?? []).filter((r) => r.itemType === 'instalment').map((r) => r.itemId),
  );
  const esercizioMonths = (instalment: Instalment): YearMonth[] => {
    if (instalment.conguaglioPrec === 0 || apartment.condominioStart === undefined) return [];
    const range = esercizioRange(instalment.esercizio, apartment.condominioStart);
    return monthsInPeriod(range.from, range.to);
  };

  return input.instalments
    .filter(
      (i) =>
        i.deleted !== true &&
        i.apartmentId === apartment.id &&
        i.kind === 'condominio' &&
        [...monthRange(i.coversFrom, i.coversTo), ...esercizioMonths(i)].some((m) =>
          periodMonths.has(m),
        ),
    )
    .sort((a, b) => compareText(a.coversFrom, b.coversFrom) || compareText(a.id, b.id))
    .map((i): OwnersItem => {
      const own = matches.filter((m) => m.itemId === i.id);
      const amounts = own.filter((m) => m.part === 'amount');
      const real = amounts.filter((m) => m.by !== 'assumed');
      const expected = expectedDebit(i);
      const straordinaria = i.straordinaria === true;
      const debited = total(real.map((m) => m.amount));
      return {
        instalmentId: i.id,
        esercizio: i.esercizio,
        rateIndex: i.rateIndex,
        rateCount: i.rateCount,
        straordinaria,
        from: isoDate(`${i.coversFrom}-01`),
        to: lastDayOfMonth(i.coversTo),
        dueDate: i.dueDate,
        rata: i.rata,
        conguaglioPrec: i.conguaglioPrec,
        // With `owner` (R193) last year's settlement is the owner's too.
        ownerShare: ownerShareOf(i, apartment, input.recoveries ?? []),
        expected,
        ...(real.length === 0 ? {} : { debited }),
        commission: total(own.filter((m) => m.part === 'commission').map((m) => m.amount)),
        debitDates: [...new Set(real.map((m) => m.transactionDate))].sort(compareText),
        // 5b D1 (R184) and plan 8 (R195): the check of section 12, without a date.
        status: instalmentStatus(
          i,
          own,
          undefined,
          input.freeDebits,
          unverifiedIds,
        ) as OwnersStatus,
      };
    });
}

const euro = (value: Cents | undefined): XlsxCell | null =>
  value === undefined ? null : { kind: 'euro', value };
const text = (value: string): XlsxCell | null => (value === '' ? null : { kind: 'text', value });
const date = (value: ISODate): XlsxCell => ({ kind: 'date', value });
const dayMonthYear = (day: ISODate): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** The owners' file (plan 5b): the sheet `OWNERS_SHEET`, then the row «Totale» (section 19). */
export function buildOwnersWorkbook(
  input: ConguaglioInput & { freeDebits?: FreeDebit[]; closing?: PeriodClose },
  generatedOn?: ISODate,
): XlsxWorkbook {
  const items = ownersItems(input);
  const rows: (XlsxCell | null)[][] = items.map((item) => [
    text(item.esercizio),
    text(`Rata ${String(item.rateIndex)} di ${String(item.rateCount)}`),
    text(item.straordinaria ? 'sì' : ''),
    date(item.from),
    date(item.to),
    date(item.dueDate),
    euro(item.rata),
    euro(item.conguaglioPrec),
    euro(item.ownerShare),
    euro(item.expected),
    euro(item.debited),
    euro(item.commission),
    text(item.debitDates.map(dayMonthYear).join(', ')),
    text(STATUS_LABELS[item.status]),
  ]);
  const sum = (pick: (item: OwnersItem) => Cents | undefined) =>
    euro(total(items.map((item) => pick(item) ?? 0)));
  const totalRow = rows.length;
  rows.push([
    text('Totale'),
    null,
    null,
    null,
    null,
    null,
    sum((i) => i.rata),
    sum((i) => i.conguaglioPrec),
    sum((i) => i.ownerShare),
    sum((i) => i.expected),
    // Empty, not 0, when nothing is debited: as in the rows.
    items.some((i) => i.debited !== undefined) ? sum((i) => i.debited) : null,
    sum((i) => i.commission),
  ]);
  // Plan 17, R300: every recovery of the period, a negative one as the tenant's credit; no tenant.
  const months = new Set(monthRange(input.period.from, input.period.to));
  const recoveries = (input.recoveries ?? [])
    .filter(
      (r) =>
        r.deleted !== true &&
        r.apartmentId === input.apartment.id &&
        r.status !== 'non-recuperabile' &&
        (r.periodLabel === undefined
          ? r.date !== undefined && months.has(r.date.slice(0, 7) as YearMonth)
          : r.periodLabel === input.period.label),
    )
    .sort((a, b) => compareText(a.id, b.id));
  if (recoveries.length > 0) {
    rows.push(
      [],
      [text('Recuperi dagli inquilini')],
      ['Recupero', 'Data', 'Importo', 'Nota'].map(text),
    );
    for (const r of recoveries) {
      rows.push([
        text(r.id),
        r.date === undefined ? null : date(r.date),
        euro(r.amount),
        text(r.amount < 0 ? 'credito dell’inquilino' : ''),
      ]);
    }
  }
  const header = OWNERS_HEADERS.map((value): XlsxCell => ({ kind: 'text', value }));
  // 5b D5, R184: as the tenants' file (R171); N = instalments not paid.
  const waiting = items.filter((i) =>
    ['in-attesa', 'importo-diverso', 'duplicato'].includes(i.status),
  );
  const provisional: XlsxCell[] = [
    {
      kind: 'text',
      value: settlementStateText(input.closing, waiting.length, closingFlags(input)),
    },
  ];
  return {
    ...(generatedOn === undefined ? {} : { generatedOn }),
    // R408: header (row 1) bold and frozen, the total bold.
    sheets: [
      {
        name: OWNERS_SHEET,
        rows: [provisional, header, ...rows],
        header: 1,
        totals: [totalRow + 2],
      },
    ],
  };
}

/**
 * Where the owners' file goes under the shared folder (5b D2, R184):
 * `Riservato_proprietari/Excel/<Appartamento>/<periodo>/Proprietari_<Appartamento>_<periodo>.xlsx`,
 * with the safe names of `excelFilePath`.
 */
export function ownersFilePath(
  apartment: Pick<Apartment, 'name'>,
  period: Pick<ConguaglioInput['period'], 'label'>,
): string {
  const folder = apartmentFolder(apartment.name);
  const label = safeWord(period.label, 'periodo', 20);
  return `Riservato_proprietari/Excel/${folder}/${label}/Proprietari_${folder}_${label}.xlsx`;
}
