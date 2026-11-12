/**
 * The note written next to every TARI notice (section 42, R3): it explains which months the notice
 * is assigned to, which debit paid it and, for the common notice of Berchet and Lovarini, how the
 * debit is split between the supplies and what one account owes the other. The text is Italian.
 */
import type { BankTransaction } from './model';
import type { Cents } from './money';
import type { ISODate, YearMonth } from './period';

/** Italian month names, January first, as the notes and messages write them. */
export const MONTH_NAMES = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const;

/** `186,00 €`, `1.234,56 €`: the way the notes write amounts (the tables use `formatEuro`). */
function noteEuro(amount: Cents): string {
  const absolute = Math.abs(amount);
  const fraction = absolute % 100;
  const units = String((absolute - fraction) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 ? '-' : ''}${units},${String(fraction).padStart(2, '0')} €`;
}

/** `16/03/2026`. */
function noteDate(date: ISODate): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function monthName(month: YearMonth): { name: string; year: string } {
  const [year = '', number = ''] = month.split('-');
  return { name: MONTH_NAMES[Number(number) - 1] ?? '', year };
}

/** `gennaio–aprile 2026`, `dicembre 2025–gennaio 2026`, `maggio 2026`. */
function monthRange(from: YearMonth, to: YearMonth): string {
  if (to < from) throw new RangeError('The assigned months end before they start');
  const start = monthName(from);
  const end = monthName(to);
  if (from === to) return `${start.name} ${start.year}`;
  if (start.year === end.year) return `${start.name}–${end.name} ${end.year}`;
  return `${start.name} ${start.year}–${end.name} ${end.year}`;
}

export interface TariNotePart {
  apartmentName: string;
  /** Total of this supply on the notice. */
  utenzaTotal: Cents;
  /** This apartment's share of the debit, from `splitSharedDebit`. */
  share: Cents;
  /** True when the debit left another apartment's account, which this one must pay back. */
  paidFromOtherAccount: boolean;
}

/**
 * The Italian note of a TARI notice: number, date of issue when known, declared period, assigned months, the debit with its
 * date and account; with more than one part, the supply totals, the shares of the debit and one
 * "Storno" sentence for each apartment that owes its share to the paying account.
 * Throws a `RangeError` unless exactly one part is paid from its own account and the shares sum
 * to the debit.
 */
export function tariNote(input: {
  avviso: { number: string; periodLabel: string; dueDate: ISODate; issueDate?: ISODate };
  months: { from: YearMonth; to: YearMonth };
  transaction: BankTransaction;
  parts: TariNotePart[];
}): string {
  const { avviso, months, transaction, parts } = input;
  const payers = parts.filter((part) => !part.paidFromOtherAccount);
  const [payer] = payers;
  if (payers.length !== 1 || payer === undefined) {
    throw new RangeError('A TARI notice is paid from exactly one account');
  }
  const debit = Math.abs(transaction.amount) as Cents;
  if (parts.reduce((sum, part) => sum + part.share, 0) !== debit) {
    throw new RangeError('The shares of a TARI notice must sum to its debit');
  }

  const sentences = [
    `Avviso ${avviso.number}${avviso.issueDate === undefined ? '' : ` del ${noteDate(avviso.issueDate)}`}, periodo ${avviso.periodLabel}, mesi assegnati ${monthRange(months.from, months.to)}.`,
    `Addebito ${noteEuro(debit)} il ${noteDate(transaction.date)} sul conto di ${payer.apartmentName}.`,
  ];
  const list = (amountOf: (part: TariNotePart) => Cents): string =>
    parts.map((part) => `${part.apartmentName} ${noteEuro(amountOf(part))}`).join(', ');
  if (parts.length === 1) {
    sentences.push(`Utenze: ${list((part) => part.utenzaTotal)}.`);
  } else {
    sentences.push(
      `Utenze: ${list((part) => part.utenzaTotal)}; riparto dell'addebito in proporzione: ` +
        `${list((part) => part.share)}.`,
    );
    for (const part of parts.filter((p) => p.paidFromOtherAccount)) {
      sentences.push(
        `Storno: ${part.apartmentName} deve ${noteEuro(part.share)} a ${payer.apartmentName}.`,
      );
    }
  }
  return sentences.join(' ');
}
