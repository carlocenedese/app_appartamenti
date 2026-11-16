/**
 * The Excel of the settlement of one apartment and one period (plan 5): the rows of the sheets,
 * built from `calcConguaglio` and its own allocation functions, so the sheets cannot disagree
 * with the settlement. Values only, no formula (question 1). Pure: no I/O, no clock.
 */
import { CATEGORY_ORDER, allocateBillToMonths, allocateInstalment } from './conguaglio';
import type { ConguaglioInput, ConguaglioResult, CostCategory } from './conguaglio';
import type { Bill, BillMatch, Instalment } from './model';
import { cents, formatEuro, splitCents } from './money';
import type { Cents } from './money';
import { annualitaRange, isoDate, lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { monthRangeLabel } from './tari-note';
import { compareText } from './text';

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
  /** The dates of the debits matched to the amount, distinct and sorted; assumed ones excluded. */
  debitDates: ISODate[];
  /** Every amount match is assumed (no statement covers it, R2). */
  assumed: boolean;
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
    if (!match.confirmed) continue;
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
      debitDates: [
        ...new Set(amounts.filter((m) => m.by !== 'assumed').map((m) => m.transactionDate)),
      ].sort(compareText),
      assumed: amounts.length > 0 && amounts.every((m) => m.by === 'assumed'),
    };
  };

  const billItem = (bill: Bill): ExcelItem => {
    const { amount, commission, debitDates, assumed } = debits('bill', bill.id);
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
      assumed,
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
    const { amount: paid, commission, debitDates, assumed } = debits('instalment', instalment.id);
    const covered = monthRange(instalment.coversFrom, instalment.coversTo);
    const parts = allocateInstalment(instalment, paid, esercizioOf(instalment));
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
      assumed,
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
      esercizio !== undefined && instalment.kind === 'condominio' && instalment.conguaglioPrec !== 0
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
