/**
 * From the result of reading a PDF to the record the app proposes to register (section 22, steps
 * 3 to 6): a bill, or one TARI instalment per supply of the notice, with the automatic checks.
 * Nothing is invented: a field the extractor could not read stays empty, and when a field the
 * record cannot do without is missing the proposal is `none`, with the reason among the checks.
 * The confirmation policy (Task 9) reads the checks and the confidence of every field.
 *
 * Pure: no clock; the ids of the records come from `newId`. Messages are Italian.
 */
import type { ExtractedField, ExtractionResult } from './extraction';
import type { Bill, Consumption, Instalment, Supply, Tenancy } from './model';
import { exceeds, yearBeforeBill } from './consumption';
import { cents, splitCents } from './money';
import type { Cents } from './money';
import { lastDayOfMonth, monthsInPeriod } from './period';
import type { ISODate, YearMonth } from './period';
import { MONTH_NAMES } from './tari-note';
import { foldText } from './text';
import { weightsAt } from './valid-from';

export type ProposalCheck = { code: string; severity: 'ok' | 'warn' | 'fail'; message: string };
type Confidence = 'high' | 'medium' | 'missing';

export type Proposal =
  | {
      kind: 'bill';
      bill: Omit<Bill, 'fileHash' | 'rev' | 'v'>;
      checks: ProposalCheck[];
      confidence: Record<string, Confidence>;
    }
  | {
      kind: 'tari';
      instalments: Omit<Instalment, 'fileHash' | 'rev' | 'v'>[];
      checks: ProposalCheck[];
      confidence: Record<string, Confidence>;
    }
  | { kind: 'none'; checks: ProposalCheck[]; confidence: Record<string, never> };

export type ProposalContext = {
  /** The apartment whose `Da_smistare` folder the PDF came from, and its POD, PDR, codes. */
  apartment: { id: string; knownCodes: string[] };
  bills: Bill[];
  instalments: Instalment[];
  tenancies: Tenancy[];
  /**
   * The percentage of the old check `consumption-anomaly` (R262), from the caller, never from the
   * code; absent, no such check (the alarm of the settings is in `importBill`, plan 19, R330).
   */
  thresholds?: { consumptionAnomalyPercent: number };
  /**
   * TARI: the supplies of shared notices (deleted ones are ignored), each with the apartments it is split
   * between by weight (basis points).
   */
  supplies?: Pick<Supply, 'id' | 'label' | 'apartments' | 'earlierApartments' | 'deleted'>[];
};

type Fields = ExtractionResult['fields'];
type FieldName = keyof Fields;

/** The Italian name of each field, for the messages. */
export const FIELD_LABELS: Record<FieldName, string> = {
  supplier: 'fornitore',
  number: 'numero',
  issueDate: 'data di emissione',
  dueDate: 'scadenza',
  periodStart: 'inizio del periodo',
  periodEnd: 'fine del periodo',
  amount: 'importo',
  consumption: 'consumo',
};

const NOT_READ_STATUS: Record<string, string> = {
  'non-riconosciuta': 'Documento non riconosciuto: nessun profilo di fornitore lo descrive.',
  'senza-testo': 'Il PDF non contiene testo leggibile (scansione): va compilato a mano.',
  illeggibile: 'Il PDF non si può leggere (file guasto o protetto).',
};

/** The value of a field, or `undefined` when it is absent, empty or of confidence `missing`. */
function valueOf<T>(field: ExtractedField<T> | undefined): T | undefined {
  if (field === undefined || field.confidence === 'missing' || field.value === null) {
    return undefined;
  }
  return field.value;
}

/** The confidence of each field the result has; a field without a value counts as missing. */
function confidenceOf(fields: Fields): Record<string, Confidence> {
  const confidence: Record<string, Confidence> = {};
  for (const [name, field] of Object.entries(fields) as [FieldName, ExtractedField<unknown>][]) {
    if (field === undefined) continue;
    confidence[name] = valueOf(field) === undefined ? 'missing' : field.confidence;
  }
  return confidence;
}

const ok = (code: string, message: string): ProposalCheck => ({ code, severity: 'ok', message });
const warn = (code: string, message: string): ProposalCheck => ({
  code,
  severity: 'warn',
  message,
});
const fail = (code: string, message: string): ProposalCheck => ({
  code,
  severity: 'fail',
  message,
});

function monthLabel(month: YearMonth): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

/** `IT001E 1234` and `it001e1234` are the same code. */
const normaliseCode = (code: string): string => code.replace(/\s+/g, '').toUpperCase();

// --- Checks shared by bills and TARI ---------------------------------------------------------

function extractionChecks(result: ExtractionResult): ProposalCheck[] {
  return result.checks
    .filter((c) => !c.ok)
    .map((c) =>
      fail(`extraction:${c.code}`, c.message || `Controllo di lettura ${c.code} fallito.`),
    );
}

function statusCheck(result: ExtractionResult): ProposalCheck[] {
  return result.status === 'da-confermare'
    ? [warn('status', 'Lettura da confermare: profilo nuovo, cambiato o con campi dubbi.')]
    : [];
}

function apartmentCodesCheck(result: ExtractionResult, ctx: ProposalContext): ProposalCheck[] {
  const known = new Set(ctx.apartment.knownCodes.map(normaliseCode));
  if (known.size === 0) return [];
  return result.identifiers.some(({ value }) => known.has(normaliseCode(value)))
    ? [ok('apartment-codes', "Un codice del documento è dell'appartamento.")]
    : [
        warn(
          'apartment-codes',
          "Nessun codice del documento (POD, PDR, codice cliente) è tra quelli dell'appartamento.",
        ),
      ];
}

function periodTenanciesCheck(
  apartmentId: string,
  months: readonly YearMonth[],
  tenancies: readonly Tenancy[],
): ProposalCheck {
  const live = tenancies.filter((t) => t.apartmentId === apartmentId && t.deleted !== true);
  const empty = months.filter(
    (month) => !live.some((t) => t.from <= month && (t.to === undefined || month <= t.to)),
  );
  return empty.length === 0
    ? ok('period-tenancies', 'Ogni mese del periodo ha inquilini.')
    : warn(
        'period-tenancies',
        `Mesi del periodo senza inquilini: ${empty.map(monthLabel).join(', ')}.`,
      );
}

function missingField(name: FieldName): ProposalCheck {
  return fail('missing-field', `Campo obbligatorio non letto: ${FIELD_LABELS[name]}.`);
}

// --- Consumption ------------------------------------------------------------------------------

function consumptionCheck(
  bill: { apartmentId: string; category: string; periodStart: ISODate; periodEnd: ISODate },
  consumption: Consumption,
  ctx: ProposalContext,
): ProposalCheck[] {
  const percent = ctx.thresholds?.consumptionAnomalyPercent;
  if (percent === undefined) return [];
  const previous = yearBeforeBill({ ...bill, id: '', amount: cents(0), consumption }, ctx.bills);
  if (previous?.consumption === undefined) return [];
  const before = previous.consumption.quantity;
  return exceeds(consumption.quantity, before, percent)
    ? [
        warn(
          'consumption-anomaly',
          `Consumo ${consumption.quantity} ${consumption.unit} oltre il ` +
            `${percent} % in più dello stesso periodo dell'anno ` +
            `prima (${before} ${previous.consumption.unit}).`,
        ),
      ]
    : [ok('consumption-anomaly', "Consumo in linea con lo stesso periodo dell'anno prima.")];
}

// --- Bill -------------------------------------------------------------------------------------

function billProposal(
  result: ExtractionResult,
  ctx: ProposalContext,
  newId: () => string,
): Proposal {
  const { fields } = result;
  const supplier = valueOf(fields.supplier);
  const periodStart = valueOf(fields.periodStart);
  const periodEnd = valueOf(fields.periodEnd);
  const amount = valueOf(fields.amount);
  const checks: ProposalCheck[] = [...extractionChecks(result), ...statusCheck(result)];
  const required = { supplier, amount, periodStart, periodEnd };
  for (const [name, value] of Object.entries(required)) {
    if (value === undefined) checks.push(missingField(name as FieldName));
  }
  if (result.category === null) {
    checks.push(fail('missing-field', 'Tipo di bolletta non riconosciuto.'));
  }
  if (periodStart !== undefined && periodEnd !== undefined && periodEnd < periodStart) {
    checks.push(fail('period-order', 'Il periodo finisce prima di cominciare.'));
  }
  checks.push(...apartmentCodesCheck(result, ctx));
  if (
    supplier === undefined ||
    amount === undefined ||
    periodStart === undefined ||
    periodEnd === undefined ||
    result.category === null ||
    periodEnd < periodStart
  ) {
    return { kind: 'none', checks, confidence: {} };
  }
  const category = result.category;
  const number = valueOf(fields.number);
  const issueDate = valueOf(fields.issueDate);
  const dueDate = valueOf(fields.dueDate);
  const consumption = valueOf(fields.consumption);
  const apartmentId = ctx.apartment.id;

  if (number !== undefined && number.trim() !== '') {
    const folded = foldText(number);
    const duplicate = ctx.bills.some(
      (b) =>
        b.deleted !== true &&
        b.apartmentId === apartmentId &&
        foldText(b.supplier) === foldText(supplier) &&
        b.number !== undefined &&
        foldText(b.number) === folded,
    );
    checks.push(
      duplicate
        ? fail(
            'duplicate-number',
            `Esiste già una bolletta di ${supplier} con il numero ${number}.`,
          )
        : ok('duplicate-number', 'Numero di bolletta nuovo.'),
    );
  }
  checks.push(
    periodTenanciesCheck(apartmentId, monthsInPeriod(periodStart, periodEnd), ctx.tenancies),
  );
  if (consumption !== undefined) {
    checks.push(
      ...consumptionCheck({ apartmentId, category, periodStart, periodEnd }, consumption, ctx),
    );
  }
  if (issueDate === undefined) {
    checks.push(
      warn('file-name', 'Data di emissione mancante: il nome del file usa la fine del periodo.'),
    );
  }
  const filePath = suggestedFilePath({
    category,
    supplier,
    issueDate: issueDate ?? periodEnd,
    periodStart,
    periodEnd,
  });
  return {
    kind: 'bill',
    bill: {
      id: newId(),
      apartmentId,
      category,
      supplier,
      ...(number === undefined ? {} : { number }),
      ...(issueDate === undefined ? {} : { issueDate }),
      ...(dueDate === undefined ? {} : { dueDate }),
      periodStart,
      periodEnd,
      amount,
      ...(consumption === undefined ? {} : { consumption }),
      includedInConguaglio: true,
      sharedWithTenants: true,
      filePath,
    },
    checks,
    confidence: confidenceOf(fields),
  };
}

// --- TARI -------------------------------------------------------------------------------------

/**
 * The instalment a TARI notice is, from the month of its due date (R42): January to May is the
 * first (it adds January to April), June to September the second (May to August), October to
 * December the third (September to December). The year of the due date is the `esercizio`.
 */
function tariRate(dueDate: ISODate): {
  rateIndex: number;
  coversFrom: YearMonth;
  coversTo: YearMonth;
  esercizio: string;
} {
  const year = dueDate.slice(0, 4);
  const month = Number(dueDate.slice(5, 7));
  const rateIndex = month <= 5 ? 1 : month <= 9 ? 2 : 3;
  const first = (rateIndex - 1) * 4 + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    rateIndex,
    coversFrom: `${year}-${pad(first)}` as YearMonth,
    coversTo: `${year}-${pad(first + 3)}` as YearMonth,
    esercizio: year,
  };
}

/** The supplies the caller gave that are not deleted. */
function liveSupplies(ctx: ProposalContext): NonNullable<ProposalContext['supplies']> {
  return (ctx.supplies ?? []).filter((supply) => supply.deleted !== true);
}

function tariProposal(
  result: ExtractionResult,
  ctx: ProposalContext,
  newId: () => string,
): Proposal {
  const { fields } = result;
  const dueDate = valueOf(fields.dueDate);
  const total = valueOf(fields.amount);
  const checks: ProposalCheck[] = [...extractionChecks(result), ...statusCheck(result)];
  if (dueDate === undefined) checks.push(missingField('dueDate'));
  if (total === undefined) checks.push(missingField('amount'));
  checks.push(...apartmentCodesCheck(result, ctx));
  if (dueDate === undefined || total === undefined) {
    return { kind: 'none', checks, confidence: {} };
  }
  const rate = tariRate(dueDate);
  const declaredStart = valueOf(fields.periodStart);
  const declaredEnd = valueOf(fields.periodEnd);
  const months = `${monthLabel(rate.coversFrom)} – ${monthLabel(rate.coversTo)}`;
  if (declaredStart !== `${rate.coversFrom}-01` || declaredEnd !== lastDayOfMonth(rate.coversTo)) {
    checks.push(
      warn(
        'tari-months',
        declaredStart === undefined || declaredEnd === undefined
          ? `Periodo dell'avviso non letto: assegnati i mesi ${months} dalla scadenza.`
          : `Il periodo dell'avviso (${declaredStart} – ${declaredEnd}) non è quello dei mesi ` +
              `assegnati dalla scadenza, ${months}.`,
      ),
    );
  }
  const issueDate = valueOf(fields.issueDate);
  const base = {
    kind: 'tari' as const,
    esercizio: rate.esercizio,
    rateIndex: rate.rateIndex,
    rateCount: 3,
    dueDate,
    ...(issueDate === undefined ? {} : { issueDate }),
    quotaProprieta: 0 as Cents,
    conguaglioPrec: 0 as Cents,
    coversFrom: rate.coversFrom,
    coversTo: rate.coversTo,
  };

  const instalments: Omit<Instalment, 'fileHash' | 'rev' | 'v'>[] = [];
  if (result.parts.length === 0) {
    // A notice the app knows is shared, read without its supplies, must not go entirely to one
    // apartment without anyone noticing (R65): the instalment is proposed but cannot pass.
    if (liveSupplies(ctx).length > 0) {
      checks.push(
        fail('missing-parts', 'Avviso condiviso letto senza le utenze: va diviso a mano.'),
      );
    }
    instalments.push({ id: newId(), apartmentId: ctx.apartment.id, ...base, rata: total });
  } else {
    const byLabel = new Map<string, (typeof ctx.supplies & object)[number]>();
    for (const supply of liveSupplies(ctx)) {
      const key = foldText(supply.label);
      if (byLabel.has(key)) {
        // Which of the two owns the part cannot be told: nothing is proposed for either (R80).
        checks.push(
          fail(
            'duplicate-supply',
            `Due utenze hanno la stessa etichetta «${supply.label}». Apri Impostazioni, Utenze e correggi: finché ce ne sono due, nessuna delle due viene usata.`,
          ),
        );
        byLabel.set(key, { id: supply.id, label: supply.label, apartments: [] });
      } else {
        byLabel.set(key, supply);
      }
    }
    const known: { apartmentId: string; amount: Cents; supplyId: string }[] = [];
    for (const part of result.parts) {
      const target = byLabel.get(foldText(part.label));
      if (target === undefined || target.apartments.length === 0) {
        checks.push(
          fail(
            'unknown-part',
            `L'utenza «${part.label}» non è collegata a un appartamento. Collegala qui sotto.`,
          ),
        );
      } else if (part.amount <= 0) {
        checks.push(fail('part-amount', `L'utenza «${part.label}» non ha un importo positivo.`));
      } else if (
        // Plan 22: weights that change inside the months of the notice (question for user1).
        JSON.stringify(weightsAt(target, rate.coversFrom)) !==
        JSON.stringify(weightsAt(target, rate.coversTo))
      ) {
        checks.push(
          fail(
            'part-weights-changed',
            `Le percentuali dell'utenza «${part.label}» cambiano nei mesi dell'avviso: dividi l'avviso a mano.`,
          ),
        );
      } else {
        // An apartment's share of the supply by weight, those in force in the first month of the
        // notice (plan 22); cents that do not divide go as in R3.
        const weights = weightsAt(target, rate.coversFrom);
        const shares = splitCents(
          part.amount,
          weights.map((a) => a.weight),
        );
        if (shares.some((share) => share <= 0)) {
          // A zero share would make the group inconsistent for the matching (weight > 0).
          checks.push(
            fail(
              'part-share',
              `La quota di un appartamento su questa utenza «${part.label}» è zero: la percentuale è troppo piccola per questo importo. Controlla le percentuali.`,
            ),
          );
        } else {
          weights.forEach(({ apartmentId }, index) => {
            known.push({ apartmentId, amount: shares[index] as Cents, supplyId: target.id });
          });
        }
      }
    }
    const seen = new Set<string>();
    for (const { apartmentId } of known) {
      if (seen.has(apartmentId)) {
        checks.push(
          fail('duplicate-apartment', "Lo stesso appartamento compare due volte nell'avviso."),
        );
        break;
      }
      seen.add(apartmentId);
    }
    const groupId = newId();
    for (const { apartmentId, amount, supplyId } of known) {
      instalments.push({
        id: newId(),
        apartmentId,
        supplyId,
        // One notice, one debit (R3): the account of the apartment the notice is filed for pays
        // every share, so the group agrees on its paying account (E1).
        ...(apartmentId === ctx.apartment.id ? {} : { paidFromApartmentId: ctx.apartment.id }),
        ...base,
        rata: amount,
        shared: { groupId, groupTotal: total, weight: amount },
      });
    }
  }

  const months4 = monthsInPeriod(`${rate.coversFrom}-01` as ISODate, lastDayOfMonth(rate.coversTo));
  for (const instalment of instalments) {
    const duplicate = ctx.instalments.some(
      (i) =>
        i.deleted !== true &&
        i.kind === 'tari' &&
        i.apartmentId === instalment.apartmentId &&
        i.esercizio === instalment.esercizio &&
        i.rateIndex === instalment.rateIndex,
    );
    checks.push(
      duplicate
        ? fail(
            'duplicate-instalment',
            `L'appartamento ha già la rata ${instalment.rateIndex} della TARI ${instalment.esercizio}.`,
          )
        : ok('duplicate-instalment', 'Rata TARI nuova.'),
      periodTenanciesCheck(instalment.apartmentId, months4, ctx.tenancies),
    );
  }
  return { kind: 'tari', instalments, checks, confidence: confidenceOf(fields) };
}

// --- Entry point ------------------------------------------------------------------------------

/**
 * The record proposed for `result`, with the automatic checks (section 22, step 4). `none` when
 * the PDF was not recognised, has no text or cannot be read, or when a field the record needs is
 * missing; the checks then say why. Throws a `RangeError` for a negative or non-finite threshold.
 */
export function proposalFromExtraction(
  result: ExtractionResult,
  ctx: ProposalContext,
  newId: () => string,
): Proposal {
  const percent = ctx.thresholds?.consumptionAnomalyPercent;
  if (percent !== undefined && (!Number.isFinite(percent) || percent < 0)) {
    throw new RangeError('The consumption anomaly threshold must be a non-negative percentage');
  }
  const notRead = NOT_READ_STATUS[result.status];
  if (notRead !== undefined) {
    return {
      kind: 'none',
      checks: [fail('status', notRead), ...extractionChecks(result)],
      confidence: {},
    };
  }
  if (result.kind === 'tari') return tariProposal(result, ctx, newId);
  if (result.kind === 'bill') return billProposal(result, ctx, newId);
  return {
    kind: 'none',
    checks: [fail('kind', 'Tipo di documento non riconosciuto.'), ...extractionChecks(result)],
    confidence: {},
  };
}

// --- File name --------------------------------------------------------------------------------

const TYPE_FOLDERS: Record<string, string> = {
  elettricita: 'Elettricita',
  gas: 'Gas',
  acqua: 'Acqua',
  internet: 'Internet',
  altro: 'Altro',
  tari: 'Rifiuti',
};

const MAX_SUPPLIER_LENGTH = 30;

/**
 * Plain ASCII letters and digits joined by `-`: accents dropped, every other character (`:`,
 * `'`, spaces, the `_` that separates the parts of the name) a separator. Such a name is NFC, has
 * none of the characters Windows forbids and never ends in a dot or a space.
 */
export function safeWord(text: string, fallback: string, maxLength: number): string {
  const word = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
  return word === '' ? fallback : word;
}

/**
 * Where a registered bill goes (section 22, step 6):
 * `Bollette/<Tipo>/<anno di emissione>/AAAA-MM-GG_Tipo_Fornitore_AAAAMMGG-AAAAMMGG.pdf`. Built from
 * the date strings alone, so it is the same in every time zone. No segment is a name Windows
 * reserves (CON, NUL, COM1...): the file name starts with a date, the folders are fixed words.
 */
export function suggestedFilePath(input: {
  category: string;
  supplier: string;
  issueDate: ISODate;
  periodStart: ISODate;
  periodEnd: ISODate;
}): string {
  const known = TYPE_FOLDERS[input.category];
  const type =
    known ??
    (() => {
      const word = safeWord(input.category, 'Altro', MAX_SUPPLIER_LENGTH);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })();
  const supplier = safeWord(input.supplier, 'Fornitore', MAX_SUPPLIER_LENGTH);
  const compact = (date: ISODate) => date.replaceAll('-', '');
  const period = `${compact(input.periodStart)}-${compact(input.periodEnd)}`;
  const year = input.issueDate.slice(0, 4);
  return `Bollette/${type}/${year}/${input.issueDate}_${type}_${supplier}_${period}.pdf`;
}
