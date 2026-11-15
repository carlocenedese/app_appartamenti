/**
 * The data model: one Zod schema and type for each record kind, plus the workspace file.
 *
 * Each record is stored as one JSON file in `_app/dati/<kind>/<id>.json` (kind names are the keys
 * of `recordSchemas`). The schemas describe that stored JSON, so amounts are plain integers and
 * dates plain strings on disk. Parsing turns them into the branded `Cents`, `ISODate` and
 * `YearMonth`, so the inferred types (`Bill`, `Payment`, ...) are the ones the engine works with.
 * `docs/schemas/*.json` is generated from these schemas (`pnpm schemas:export`) for the Python
 * side, which validates what it writes against them.
 *
 * Unknown keys: the schemas are not strict. A parsed record drops keys it does not know instead of
 * failing, because a later app version may add a field to `v: 1` records and an older app must
 * still read them. Rewriting a record that has such keys would lose them: that is why a change that
 * older apps must not write over raises `minAppVersion`, which makes them read-only (`checkCompat`).
 * `v` stays literal 1: a record with another `v` is a future shape, and the store decides what to
 * do with it before it ever reaches these schemas.
 *
 * Rules that span several fields (a period that ends before it starts, an instalment index beyond
 * the count) are checks on the object. JSON Schema cannot express them, so the generated schema
 * states them in its `description`.
 */
import { z } from 'zod';
import { cents } from './money';
import type { Cents } from './money';
import { isoDate, yearMonth } from './period';
import { normaliseIban } from './iban';
import { foldText } from './text';
import { SEMVER_PATTERN } from './version';

// --- Building blocks ------------------------------------------------------------------------

/** Whole euro cents, any sign. Parses to the branded `Cents`. */
export const CentsSchema = z.int().transform((n): Cents => cents(n));

// The patterns end up in the exported JSON Schema, where Python validators apply them with
// `re.search`. Digits are spelled [0-9] because `\d` also matches other scripts' digits there, and
// the month and day ranges are in the pattern so that "2026-13" or "2026-99-99" never pass it.
// Two things stay with the consumer, and the descriptions say so: whether the day exists in the
// month, and a trailing newline (ECMA 262's `$` refuses it, Python's accepts it).
const MONTH_SOURCE = '[0-9]{4}-(?:0[1-9]|1[0-2])';
const DATE_SOURCE = `${MONTH_SOURCE}-(?:0[1-9]|[12][0-9]|3[01])`;
const TIME_SOURCE = '(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]+)?';
const NEWLINE_NOTE = 'Where "$" accepts a trailing newline (Python), the consumer must reject one.';

/** A string of the given shape that `parse` accepts, turned into the type `parse` returns. */
function checkedString<T>(shape: RegExp, parse: (value: string) => T) {
  return z
    .string()
    .regex(shape)
    .transform((value, ctx): T => {
      try {
        return parse(value);
      } catch (error) {
        ctx.issues.push({
          code: 'custom',
          message: error instanceof Error ? error.message : String(error),
          input: value,
        });
        return z.NEVER;
      }
    });
}

/** A real calendar date, `YYYY-MM-DD`. Parses to the branded `ISODate`. */
export const ISODateSchema = checkedString(new RegExp(`^${DATE_SOURCE}$`), isoDate).meta({
  format: 'date',
  description:
    'Calendar date, YYYY-MM-DD. The pattern checks the month and day ranges; that the day exists ' +
    `in the month needs a "format": "date" check or the consumer's own. ${NEWLINE_NOTE}`,
});

/** A calendar month, `YYYY-MM`. Parses to the branded `YearMonth`. */
export const YearMonthSchema = checkedString(new RegExp(`^${MONTH_SOURCE}$`), yearMonth).meta({
  description: `Calendar month, YYYY-MM (01 to 12). ${NEWLINE_NOTE}`,
});

/**
 * A point in time as an ISO 8601 UTC timestamp, e.g. `2026-11-10T20:15:00.000Z`: always `Z`,
 * never an offset, fractional seconds optional. A plain string once parsed.
 */
export const TimestampSchema = checkedString(
  new RegExp(`^${DATE_SOURCE}T${TIME_SOURCE}Z$`),
  (value) => {
    isoDate(value.slice(0, 10)); // throws for a day that the month does not have
    return value;
  },
).meta({
  format: 'date-time',
  description:
    'ISO 8601 UTC timestamp ending in Z, e.g. 2026-11-10T20:15:00.000Z. That the day exists in ' +
    `the month needs a "format": "date-time" check or the consumer's own. ${NEWLINE_NOTE}`,
});

const NonEmptyString = z.string().min(1);

/** A day and month that exist every year, so February 29 is not allowed. */
const AnnualitaStartSchema = z
  .object({
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
  })
  .refine(
    ({ month, day }) => {
      try {
        // 2001 is not a leap year.
        isoDate(`2001-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Not a day that exists every year (February 29 is not allowed)', path: ['day'] },
  )
  .meta({ description: 'A month and day that exist every year; day must exist in that month.' });

/** The fields every record shares. `rev` starts at 1 and grows with each change. */
export const RecordBaseSchema = z.object({
  id: NonEmptyString,
  v: z.literal(1),
  rev: z.int().min(1),
  deleted: z.boolean().optional(),
});
export type RecordBase = z.infer<typeof RecordBaseSchema>;

// Dates and months compare as text: the formats have a fixed width with a four-digit year.
const notAfter = (earlier: string, later: string): boolean => earlier <= later;

// --- Records ---------------------------------------------------------------------------------

export const DEFAULT_RENT_LATE_DAYS = 10;

export const ApartmentSchema = RecordBaseSchema.extend({
  name: NonEmptyString,
  locatore: NonEmptyString,
  /** Number of beds: the divisor of shared costs, so at least 1. */
  posti: z.int().min(1),
  /**
   * Names of the beds in their fixed order (`Tenancy.room` uses these names). When a monthly
   * share does not divide evenly, the leftover cents go to the first beds in this order (R30).
   */
  rooms: z.array(NonEmptyString).optional(),
  /** Monthly rent plus flat charges as written in the contract. Only used for a check. */
  contrattoMensile: CentsSchema.optional(),
  /** Start of the lease year (annualità). */
  annualitaStart: AnnualitaStartSchema,
  /** Start of the condominium fiscal year, when the apartment has one. */
  condominioStart: AnnualitaStartSchema.optional(),
  /** Days of grace before a rent payment counts as late (R109); `DEFAULT_RENT_LATE_DAYS` if absent. */
  rentLateDays: z.int().min(0).max(31).optional(),
  /** Street address, as written on the notices. */
  address: NonEmptyString.optional(),
  /** Cadastral identifiers (foglio, particella, subalterno), one entry per unit. */
  cadastre: z
    .array(z.object({ sheet: NonEmptyString, parcel: NonEmptyString, sub: NonEmptyString }))
    .optional(),
})
  .refine(
    (apartment) => apartment.rooms === undefined || apartment.rooms.length === apartment.posti,
    {
      message: 'There must be one room name per bed',
      path: ['rooms'],
    },
  )
  .refine(
    (apartment) =>
      apartment.rooms === undefined || new Set(apartment.rooms).size === apartment.rooms.length,
    { message: 'Room names must be unique', path: ['rooms'] },
  )
  .meta({ description: 'When rooms is present: one unique name per bed (posti).' });
export type Apartment = z.infer<typeof ApartmentSchema>;

/**
 * A supply of a shared notice (for example a TARI utenza), linked to the apartments it belongs to.
 * `weight` is the part of the supply each apartment pays, in basis points (1..10000, whole): the
 * weights of a supply add up to exactly 10000; no share is written in the code.
 */
export const SupplySchema = RecordBaseSchema.extend({
  /** The supply code as written on the notice (the label of an extracted part). */
  label: NonEmptyString,
  apartments: z
    .array(z.object({ apartmentId: NonEmptyString, weight: z.int().min(1).max(10000) }))
    .min(1),
})
  .refine(
    (supply) =>
      new Set(supply.apartments.map((a) => a.apartmentId)).size === supply.apartments.length,
    { message: 'An apartment appears once in a supply', path: ['apartments'] },
  )
  .refine((supply) => supply.apartments.reduce((sum, a) => sum + a.weight, 0) === 10000, {
    message: 'The weights of a supply add up to exactly 10000',
    path: ['apartments'],
  })
  .meta({
    description:
      'apartments: at least one, each apartment once, weight in basis points (1..10000), sum exactly 10000.',
  });
export type Supply = z.infer<typeof SupplySchema>;

/** A person who uses the app on this folder. The name is personal data: never put it in a log or message. */
export const UserSchema = RecordBaseSchema.extend({
  // `\S` rejects a name of whitespace only.
  name: NonEmptyString.regex(/\S/, { message: 'The name is empty' }),
});
export type User = z.infer<typeof UserSchema>;

export const ContractSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  type: z.enum(['1+1', '3+2', '4+4', 'altro']),
  start: YearMonthSchema,
  /** Last month of the contract, including extensions that are already certain. */
  end: YearMonthSchema,
  settlement: z.enum(['annuale', 'intero-contratto']),
})
  .refine((contract) => notAfter(contract.start, contract.end), {
    message: 'The contract ends before it starts',
    path: ['end'],
  })
  .meta({ description: 'start must not be after end.' });
export type Contract = z.infer<typeof ContractSchema>;

export const TenancySchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  tenantId: NonEmptyString,
  room: z.string().optional(),
  from: YearMonthSchema,
  to: YearMonthSchema.optional(),
  /** What the tenant actually pays each month as rent (no expenses in it). */
  monthlyRent: CentsSchema,
  /** What the tenant actually pays each month as flat service charge. */
  monthlyForfait: CentsSchema,
})
  .refine((tenancy) => tenancy.to === undefined || notAfter(tenancy.from, tenancy.to), {
    message: 'The tenancy ends before it starts',
    path: ['to'],
  })
  .meta({ description: 'When to is present, from must not be after to.' });
export type Tenancy = z.infer<typeof TenancySchema>;

// --- Tenants and payers (plan 3b) ---------------------------------------------------------------

export const TenantSchema = RecordBaseSchema.extend({
  name: NonEmptyString,
  language: z.enum(['it', 'en']).optional(),
});
export type Tenant = z.infer<typeof TenantSchema>;

/** `iban:<normalised IBAN>` or `name:<folded name>`: the same form the matcher compares. */
export const PayerKeySchema = z.string().refine(
  (key) => {
    if (key.startsWith('iban:')) return normaliseIban(key.slice(5)) === key.slice(5);
    if (key.startsWith('name:')) {
      const name = key.slice(5);
      return name !== '' && foldText(name) === name;
    }
    return false;
  },
  { message: 'The key must be iban:<normalised IBAN> or name:<folded name>' },
);
export type PayerKey = z.infer<typeof PayerKeySchema>;

export const PayerSchema = RecordBaseSchema.extend({
  key: PayerKeySchema,
  tenantId: NonEmptyString,
  validFrom: ISODateSchema,
  validTo: ISODateSchema.optional(),
  source: z.enum(['confirmed', 'manual']),
})
  .refine((payer) => payer.validTo === undefined || notAfter(payer.validFrom, payer.validTo), {
    message: 'The payer ends before it starts',
    path: ['validTo'],
  })
  .meta({ description: 'When validTo is present, validFrom must not be after validTo.' });
export type Payer = z.infer<typeof PayerSchema>;

/** The categories of a bill; a supplier profile of kind `bill` names one. */
export const BillCategorySchema = z.enum(['elettricita', 'gas', 'acqua', 'internet', 'altro']);

/** A consumption read from a bill: a decimal quantity written as text with a dot, and its unit. */
export const ConsumptionSchema = z
  .object({
    quantity: z
      .string()
      .regex(/^-?[0-9]+(?:\.[0-9]+)?$/)
      .meta({ description: 'Decimal number as text with a dot, e.g. "123.4"; never a float.' }),
    unit: NonEmptyString,
  })
  .meta({ description: 'Quantity consumed and its unit, e.g. 123.4 kWh.' });
export type Consumption = z.infer<typeof ConsumptionSchema>;

/** What a document is: a bill, a TARI notice, or something no profile recognises. */
export const DocumentKindSchema = z.enum(['bill', 'tari', 'unknown']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

/**
 * The part of a PDF a record was read from, when the file holds more than one document: pages
 * `[first, last]` (1-based, inclusive). A record without it covers the whole file (records written
 * before plan 2b-2 stay valid, so `v` does not change).
 */
export const FileDocumentSchema = z
  .object({
    pages: z.tuple([z.int().min(1), z.int().min(1)]),
    documentKind: DocumentKindSchema,
  })
  .refine((doc) => doc.pages[0] <= doc.pages[1], {
    message: 'The page range ends before it starts',
    path: ['pages'],
  })
  .meta({ description: 'pages[0] must not be after pages[1].' });
export type FileDocument = z.infer<typeof FileDocumentSchema>;

export const BillSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  /** Condominium and TARI are instalments, IMU is the owner's tax: none of them is a bill. */
  category: BillCategorySchema,
  supplier: NonEmptyString,
  number: z.string().optional(),
  issueDate: ISODateSchema.optional(),
  /** Due date, used to match the bill with the bank debit. */
  dueDate: ISODateSchema.optional(),
  periodStart: ISODateSchema,
  periodEnd: ISODateSchema,
  /** Negative for a credit note. */
  amount: CentsSchema,
  /** What the bill says was consumed in the period, when it says so. */
  consumption: ConsumptionSchema.optional(),
  includedInConguaglio: z.boolean(),
  sharedWithTenants: z.boolean(),
  fileHash: NonEmptyString,
  filePath: NonEmptyString,
  fileDocument: FileDocumentSchema.optional(),
})
  .refine((bill) => notAfter(bill.periodStart, bill.periodEnd), {
    message: 'The billing period ends before it starts',
    path: ['periodEnd'],
  })
  .meta({ description: 'periodStart must not be after periodEnd.' });
export type Bill = z.infer<typeof BillSchema>;

export const PaymentSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  tenantId: NonEmptyString,
  date: ISODateSchema,
  amount: CentsSchema,
  /** Only confirmed payments enter the calculations. */
  confirmed: z.boolean(),
  /** Only `canone` (rent plus flat charge) counts towards the flat charge collected. */
  kind: z.enum(['canone', 'conguaglio', 'caparra', 'altro']),
  /** Month the payment is for; the month of `date` when absent. */
  forMonth: YearMonthSchema.optional(),
  source: z.enum(['csv', 'manual', 'excel']),
  transactionId: NonEmptyString.optional(),
  note: z.string().optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const BankTransactionSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  date: ISODateSchema,
  /** Negative for a debit on the account. */
  amount: CentsSchema,
  description: z.string(),
  /** Disposition code, equal on a debit and on its "Commissioni e spese" row. */
  dispCode: z.string().optional(),
  statementHash: NonEmptyString,
  /** The account the row belongs to; absent on rows written before accounts existed. */
  accountId: NonEmptyString.optional(),
  /** Who paid or was paid, when the statement says so. */
  counterparty: z.object({ name: z.string().optional(), iban: z.string().optional() }).optional(),
  /** False for a pending row; absent means booked. */
  booked: z.boolean().optional(),
});
export type BankTransaction = z.infer<typeof BankTransactionSchema>;

/**
 * The instalment counts that divide 12, so that each instalment covers whole months. One list
 * for the check and for the exported enum; the tests pin it to the divisors of 12.
 */
const INSTALMENT_COUNTS = [1, 2, 3, 4, 6, 12] as const;

export const InstalmentSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  kind: z.enum(['condominio', 'tari']),
  /** Fiscal year or lease year such as `2026-27`; for the TARI, the year such as `2026`. */
  esercizio: NonEmptyString,
  /** 1-based position of this instalment. */
  rateIndex: z.int().min(1),
  /** Each instalment covers `12 / rateCount` consecutive months. */
  rateCount: z
    .int()
    .min(1)
    .max(12)
    .refine((count) => INSTALMENT_COUNTS.some((allowed) => allowed === count), {
      message: 'The number of instalments must divide 12',
    })
    .meta({ enum: [...INSTALMENT_COUNTS] }),
  dueDate: ISODateSchema,
  /** Date the notice was issued (data di emissione), written in the TARI note when present. */
  issueDate: ISODateSchema.optional(),
  /** Amount of this instalment; it may differ from one instalment to the next. */
  rata: CentsSchema,
  /** Condominium only: the owner's yearly total for this apartment, 0 if absent. */
  quotaProprieta: CentsSchema,
  /** Condominium only: previous year's settlement, negative when it is a credit. */
  conguaglioPrec: CentsSchema,
  /** An instalment that belongs entirely to the owner, never charged to the tenants. */
  straordinaria: z.boolean().optional(),
  /** Apartment whose bank account pays the debit, when it is not this one. */
  paidFromApartmentId: NonEmptyString.optional(),
  /** The supply this instalment was born from, when it was split by supply. */
  supplyId: NonEmptyString.optional(),
  /** A notice shared by several apartments. */
  shared: z
    .object({
      groupId: NonEmptyString,
      /** Total to pay on the whole notice. */
      groupTotal: CentsSchema,
      /** This apartment's share of the notice, by supply. */
      weight: CentsSchema,
    })
    .optional(),
  coversFrom: YearMonthSchema,
  coversTo: YearMonthSchema,
  fileHash: NonEmptyString.optional(),
  fileDocument: FileDocumentSchema.optional(),
})
  .refine((instalment) => instalment.rateIndex <= instalment.rateCount, {
    message: 'The instalment index is beyond the number of instalments',
    path: ['rateIndex'],
  })
  .refine((instalment) => notAfter(instalment.coversFrom, instalment.coversTo), {
    message: 'The instalment covers a period that ends before it starts',
    path: ['coversTo'],
  })
  .meta({
    description: 'rateIndex must not exceed rateCount; coversFrom must not be after coversTo.',
  });
export type Instalment = z.infer<typeof InstalmentSchema>;

export const BillMatchSchema = RecordBaseSchema.extend({
  itemType: z.enum(['bill', 'instalment']),
  itemId: NonEmptyString,
  transactionId: NonEmptyString,
  transactionDate: ISODateSchema,
  /** The part of the debit that covers this item. */
  amount: CentsSchema,
  /** Commission rows are tied to a debit and follow the item it pays. */
  part: z.enum(['amount', 'commission']),
  confirmed: z.boolean(),
  /** `assumed`: no bank statement covers the period, so the item is taken as paid. */
  by: z.enum(['auto', 'manual', 'assumed']),
});
export type BillMatch = z.infer<typeof BillMatchSchema>;

/** What a movement is (plan 3c): left out of everything (`escluso`) or a category of expense. */
export const MovementKindSchema = z.enum(['escluso', 'utenze', 'tasse', 'condominio', 'altro']);
export type MovementKind = z.infer<typeof MovementKindSchema>;
export const OutgoingKindSchema = MovementKindSchema.exclude(['escluso']);
export type OutgoingKind = z.infer<typeof OutgoingKindSchema>;
export const ExcludeReasonSchema = z.enum(['doppione', 'non-contabilizzato', 'non-reale']);
export type ExcludeReason = z.infer<typeof ExcludeReasonSchema>;

/** The one class of a movement (`mc-<transactionId>`): no description, no name. */
export const MovementClassSchema = RecordBaseSchema.extend({
  transactionId: NonEmptyString,
  kind: MovementKindSchema,
  excludeReason: ExcludeReasonSchema.optional(),
  /** Where the expense goes; absent for an exclusion. */
  apartmentId: NonEmptyString.optional(),
  f24: z.literal(true).optional(),
  /** The rule that produced it, for an automatic one. */
  ruleId: NonEmptyString.optional(),
})
  .refine((c) => c.id === `mc-${c.transactionId}`, {
    message: 'The id must be mc-<transactionId>',
    path: ['id'],
  })
  .refine((c) => (c.kind === 'escluso') === (c.excludeReason !== undefined), {
    message: 'excludeReason is there exactly for kind escluso',
    path: ['excludeReason'],
  })
  .refine((c) => (c.kind === 'escluso') !== (c.apartmentId !== undefined), {
    message: 'apartmentId is there exactly when kind is not escluso',
    path: ['apartmentId'],
  })
  .refine((c) => c.f24 === undefined || c.kind === 'tasse', {
    message: 'f24 only with kind tasse',
    path: ['f24'],
  })
  .refine((c) => c.ruleId === undefined || c.kind !== 'escluso', {
    message: 'An exclusion never comes from a rule',
    path: ['ruleId'],
  })
  .meta({
    description:
      'id is mc-<transactionId>. excludeReason is present if and only if kind is escluso; ' +
      'apartmentId if and only if kind is not escluso; f24 only with tasse; ruleId never with escluso.',
  });
export type MovementClass = z.infer<typeof MovementClassSchema>;

/**
 * A rule learnt from a confirmation (`rule-<transactionId>`, plan 3c, question 1): the movements
 * of `accountId` in `direction` whose counterparty has `key` get `kind` and `apartmentId`, up to
 * `validTo`; the amount does not count. Incoming only by IBAN (question 2).
 */
export const MovementRuleSchema = RecordBaseSchema.extend({
  direction: z.enum(['in', 'out']),
  accountId: NonEmptyString,
  key: PayerKeySchema,
  kind: OutgoingKindSchema,
  apartmentId: NonEmptyString,
  validTo: ISODateSchema.optional(),
})
  .refine((r) => r.direction === 'out' || r.key.startsWith('iban:'), {
    message: 'An incoming rule needs an iban key',
    path: ['key'],
  })
  .meta({ description: 'With direction in, key must be an iban: key.' });
export type MovementRule = z.infer<typeof MovementRuleSchema>;

/** A note written by a person (not the automatic notes of the app). */
export const NoteSchema = RecordBaseSchema.extend({
  targetType: z.enum([
    'apartment',
    'contract',
    'tenancy',
    'bill',
    'instalment',
    'supply',
    'payment',
    'transaction',
    'match',
  ]),
  targetId: NonEmptyString,
  // Length is counted in UTF-16 units, so a text full of characters outside the basic plane
  // may be refused where a JSON Schema validator (which counts characters) would pass it.
  // `\S` rejects a text of whitespace only, like `trim()` would.
  text: z.string().min(1).max(2000).regex(/\S/, { message: 'The note is empty' }),
  /** Who wrote the note. */
  profileId: NonEmptyString,
  /** When it was written, from the clock passed in by the caller. */
  at: TimestampSchema,
  /** Notes stay with the owner unless marked. */
  visibleToTenants: z.boolean().default(false),
});
export type Note = z.infer<typeof NoteSchema>;

// --- Supplier profile -------------------------------------------------------------------------

/** The kinds of identifier a bill carries: electricity point, gas point, customer code. */
export const IdentifierKindSchema = z.enum(['pod', 'pdr', 'customer']);

// The profile is read by a Python program, so a pattern must compile in JavaScript and use only
// what `re` and `RegExp` share: numbered groups, no lookbehind, no inline flags. Escapes and
// character classes are removed before looking for these constructs, so `\(?<` and `[(?<=]` pass.
const FORBIDDEN_CONSTRUCTS: readonly [RegExp, string][] = [
  [/\(\?P?<(?![=!])/, 'named groups'],
  [/\(\?<[=!]/, 'lookbehind'],
  [/\(\?(?:[a-zA-Z]+(?:-[a-zA-Z]+)?|-[a-zA-Z]+)[:)]/, 'inline flags'],
];

/** Why `pattern` is not allowed, or `undefined` when it is. */
function patternProblem(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
  } catch {
    return 'The pattern is not a valid regular expression';
  }
  const bare = pattern.replace(/\\./gs, '').replace(/\[[^\]]*\]/g, '');
  const found = FORBIDDEN_CONSTRUCTS.find(([construct]) => construct.test(bare));
  return found === undefined ? undefined : `The pattern uses ${found[1]}, not shared with Python`;
}

/**
 * The number of capture groups of `pattern` (an alternative that matches the empty string makes
 * `exec` succeed, and its result has one slot per group), or `undefined` when it does not compile
 * (`PatternSchema` reports that).
 */
function captureGroups(pattern: string): number | undefined {
  try {
    const match = new RegExp(`${pattern}|`).exec('');
    return match === null ? undefined : match.length - 1;
  } catch {
    return undefined;
  }
}

/** Whether `pattern` has at least `minimum` capture groups (true when it does not compile). */
function hasGroups(pattern: string, minimum: number): boolean {
  const groups = captureGroups(pattern);
  return groups === undefined || groups >= minimum;
}

/**
 * A regular expression that compiles in JavaScript and stays in the subset shared with Python's
 * `re`: numbered groups only, no lookbehind, no inline flags. JSON Schema cannot express this.
 */
export const PatternSchema = NonEmptyString.superRefine((pattern, ctx) => {
  const problem = patternProblem(pattern);
  if (problem !== undefined) ctx.addIssue({ code: 'custom', message: problem });
}).meta({
  description:
    'Regular expression valid in JavaScript and Python: numbered groups only, no lookbehind ' +
    '("(?<=", "(?<!"), no inline flags such as "(?i)".',
});

export const RuleValueTypeSchema = z.enum(['euro', 'date', 'date-range', 'text', 'quantity']);

/** How to read one value: find the anchor text, look in `position`, match `pattern`. */
export const RuleSchema = z.object({
  /** Text of the label next to the value. */
  anchor: NonEmptyString,
  position: z.enum(['same-line', 'right', 'below']),
  pattern: PatternSchema,
  valueType: RuleValueTypeSchema,
  /** The capture group of `pattern` that holds the value. */
  group: z.int().min(0).default(1),
});
export type Rule = z.infer<typeof RuleSchema>;

const FieldRulesSchema = z.object({
  required: z.boolean(),
  /** Tried in order; the first that matches wins, unless `combine` says otherwise. */
  rules: z.array(RuleSchema).min(1),
  /**
   * `span` (period only): every rule is applied to every occurrence of its anchor and the period
   * runs from the earliest start to the latest end of all the intervals read, e.g. a water bill
   * with a measured and an estimated interval.
   */
  combine: z.enum(['span']).optional(),
});

/** The fields a profile can read, and the only value type each one accepts. */
const FIELD_VALUE_TYPES = {
  number: 'text',
  issueDate: 'date',
  dueDate: 'date',
  period: 'date-range',
  amount: 'euro',
  consumption: 'quantity',
} as const;

/** Same as `normalize_ocr` in python/bollette_pdf/profiles.py (rule R89). */
function normaliseOcr(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const SupplierProfileSchema = RecordBaseSchema.extend({
  supplier: NonEmptyString,
  kind: z.enum(['bill', 'tari']),
  category: BillCategorySchema.optional(),
  /** `bozza` until the owner confirms the first reading made with it. */
  status: z.enum(['bozza', 'confermato']),
  /** Register a bill that passes every check without asking. */
  autoRegister: z.boolean(),
  /** First day the layout is in use; a new layout is a new profile and the old one stays. */
  validFrom: ISODateSchema,
  validTo: ISODateSchema.optional(),
  /** The PDF belongs to this supplier when all `allOf` texts appear and no `noneOf` text does. */
  recognise: z.object({
    allOf: z.array(NonEmptyString).min(1),
    noneOf: z.array(NonEmptyString),
    /** R90: words that recognise a scanned page instead of `allOf`; a text PDF ignores them. */
    ocrAnyOf: z.array(NonEmptyString).optional(),
  }),
  fields: z.partialRecord(
    z.enum(Object.keys(FIELD_VALUE_TYPES) as [keyof typeof FIELD_VALUE_TYPES]),
    FieldRulesSchema,
  ),
  identifiers: z.array(z.object({ kind: IdentifierKindSchema, pattern: PatternSchema })),
  /** TARI only: one match per part of the notice, label in group 1 and amount in group 2. */
  parts: z
    .object({
      pattern: PatternSchema,
      /** Same two groups: an amount added to the part with the same label (e.g. perequative). */
      add: PatternSchema.optional(),
      /** Five groups: supply label, address, sheet, parcel, sub; sets the property of the part with that label. */
      property: z.object({ pattern: PatternSchema }).optional(),
    })
    .optional(),
  /** One match per line item, amount in group 1; the items are summed to check the total. */
  items: z.object({ pattern: PatternSchema }).optional(),
})
  .refine((profile) => profile.kind === 'tari' || profile.category !== undefined, {
    message: 'A bill profile needs a category',
    path: ['category'],
  })
  .refine((profile) => profile.kind === 'bill' || profile.category === undefined, {
    message: 'A TARI profile must not have a category',
    path: ['category'],
  })
  .refine(
    (profile) => {
      const words = (profile.recognise.ocrAnyOf ?? []).map(normaliseOcr);
      return words.every((word) => word !== '') && new Set(words).size === words.length;
    },
    {
      message: 'An ocrAnyOf text needs a letter or a digit and must not repeat another',
      path: ['recognise', 'ocrAnyOf'],
    },
  )
  .refine((profile) => profile.kind === 'tari' || profile.parts === undefined, {
    message: 'Only a TARI profile has parts',
    path: ['parts'],
  })
  .refine(
    (profile) => profile.validTo === undefined || notAfter(profile.validFrom, profile.validTo),
    {
      message: 'The profile ends before it starts',
      path: ['validTo'],
    },
  )
  .refine(
    (profile) =>
      Object.entries(profile.fields).every(([name, spec]) =>
        spec.rules.every(
          (rule) => rule.valueType === FIELD_VALUE_TYPES[name as keyof typeof FIELD_VALUE_TYPES],
        ),
      ),
    { message: 'A rule has a value type that its field cannot hold', path: ['fields'] },
  )
  .refine(
    (profile) =>
      Object.entries(profile.fields).every(
        ([name, spec]) => spec.combine === undefined || name === 'period',
      ),
    { message: 'Only the period can combine its readings', path: ['fields'] },
  )
  .refine(
    (profile) =>
      Object.values(profile.fields).every((spec) =>
        spec.rules.every((rule) => hasGroups(rule.pattern, rule.group)),
      ),
    {
      message: 'Una regola indica un gruppo che il suo pattern non ha tra i gruppi di cattura',
      path: ['fields'],
    },
  )
  .refine((profile) => profile.parts === undefined || hasGroups(profile.parts.pattern, 2), {
    message: 'Il pattern delle parti deve avere almeno 2 gruppi di cattura (etichetta e importo)',
    path: ['parts'],
  })
  .refine((profile) => profile.parts?.add === undefined || hasGroups(profile.parts.add, 2), {
    message: 'Il pattern delle aggiunte alle parti deve avere almeno 2 gruppi di cattura',
    path: ['parts'],
  })
  .refine(
    (profile) =>
      profile.parts?.property === undefined || hasGroups(profile.parts.property.pattern, 5),
    {
      message:
        "Il pattern dell'immobile delle parti deve avere almeno 5 gruppi di cattura (etichetta, indirizzo, foglio, particella, subalterno)",
      path: ['parts'],
    },
  )
  .refine((profile) => profile.items === undefined || hasGroups(profile.items.pattern, 1), {
    message: 'Il pattern delle voci deve avere almeno 1 gruppo di cattura (importo)',
    path: ['items'],
  })
  .meta({
    description:
      'kind "bill" needs a category and kind "tari" must not have one; parts only with kind ' +
      '"tari"; validFrom must not be after validTo; the valueType of every rule of a field is ' +
      'fixed: amount euro, issueDate and dueDate date, period date-range, consumption quantity, ' +
      "number text; the group of every rule must be one of its pattern's capture groups (0 is " +
      'the whole match), the parts pattern needs at least 2 capture groups and the items ' +
      'pattern at least 1; combine "span" only on the period.',
  });
export type SupplierProfile = z.infer<typeof SupplierProfileSchema>;

// --- Bank accounts and statements (plan 3a) -----------------------------------------------------

export const AccountSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  label: NonEmptyString,
  bankProfileId: NonEmptyString,
  /** Already normalised: no spaces, capitals, valid mod-97 check. */
  iban: z
    .string()
    .refine((iban) => normaliseIban(iban) === iban, {
      message: 'The IBAN must be normalised (no spaces, capitals) and pass the mod-97 check',
    })
    .optional(),
  holder: z.string().optional(),
});
export type Account = z.infer<typeof AccountSchema>;

/** Never empty: a profile with no label to look for would recognise any file. */
const LabelsSchema = z.array(NonEmptyString).min(1);

const PreambleLabelSchema = z.object({ label: NonEmptyString });

export const BankProfileSchema = RecordBaseSchema.extend({
  bank: NonEmptyString,
  validFrom: ISODateSchema,
  validTo: ISODateSchema.optional(),
  container: z.enum(['xlsx', 'csv']),
  csvSeparator: z.enum([';', ',']).optional(),
  /** Labels of the header row, compared with `foldText`. */
  header: z.object({ allOf: LabelsSchema }),
  /** Labels of the columns, compared with `foldText`. */
  columns: z.object({
    date: NonEmptyString,
    description: LabelsSchema,
    amount: NonEmptyString.optional(),
    debit: NonEmptyString.optional(),
    credit: NonEmptyString.optional(),
    sign: NonEmptyString.optional(),
    dispCode: NonEmptyString.optional(),
    pending: NonEmptyString.optional(),
  }),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD']),
  signValues: z.object({ debit: LabelsSchema, credit: LabelsSchema }).optional(),
  pendingValues: LabelsSchema.optional(),
  dispCodePattern: PatternSchema.optional(),
  counterparty: z
    .object({ name: PatternSchema.optional(), iban: PatternSchema.optional() })
    .optional(),
  /** Two groups: the first and the last day of the statement. */
  periodPattern: PatternSchema.optional(),
  /** One group: the account number or IBAN written in the file. */
  accountPattern: PatternSchema.optional(),
  /**
   * Lines above the header written as "label, value to its right" (the label is compared with
   * `foldText`, the value is the first non-empty cell to its right): the period, the account (one
   * capture group) and the number of movement rows, a completeness check.
   */
  preamble: z
    .object({
      periodFrom: PreambleLabelSchema.optional(),
      periodTo: PreambleLabelSchema.optional(),
      account: z.object({ label: NonEmptyString, pattern: PatternSchema }).optional(),
      rowCount: PreambleLabelSchema.optional(),
    })
    .optional(),
})
  .refine(
    ({ columns: c }) =>
      c.amount !== undefined
        ? c.debit === undefined && c.credit === undefined
        : c.debit !== undefined && c.credit !== undefined,
    { message: 'Either amount, or debit and credit together', path: ['columns'] },
  )
  .refine(
    ({ columns: c, signValues }) =>
      c.sign === undefined || (c.amount !== undefined && signValues !== undefined),
    {
      message: 'sign needs amount and signValues',
      path: ['columns', 'sign'],
    },
  )
  .refine(
    ({ columns: c, pendingValues }) => c.pending === undefined || pendingValues !== undefined,
    {
      message: 'pending needs pendingValues',
      path: ['columns', 'pending'],
    },
  )
  .refine((p) => p.validTo === undefined || notAfter(p.validFrom, p.validTo), {
    message: 'validTo must not be before validFrom',
    path: ['validTo'],
  })
  .refine((p) => p.periodPattern === undefined || hasGroups(p.periodPattern, 2), {
    message: 'periodPattern needs two groups',
    path: ['periodPattern'],
  })
  .refine((p) => p.accountPattern === undefined || hasGroups(p.accountPattern, 1), {
    message: 'accountPattern needs one group',
    path: ['accountPattern'],
  })
  .refine((p) => (p.preamble?.periodFrom === undefined) === (p.preamble?.periodTo === undefined), {
    message: 'preamble needs periodFrom and periodTo together',
    path: ['preamble'],
  })
  .refine((p) => p.preamble?.account === undefined || hasGroups(p.preamble.account.pattern, 1), {
    message: 'preamble.account.pattern needs one group',
    path: ['preamble', 'account', 'pattern'],
  })
  .refine((p) => p.periodPattern === undefined || p.preamble?.periodFrom === undefined, {
    message: 'ambiguous-profile: periodPattern and preamble.periodFrom/periodTo, choose one',
    path: ['periodPattern'],
  })
  .refine((p) => p.accountPattern === undefined || p.preamble?.account === undefined, {
    message: 'ambiguous-profile: accountPattern and preamble.account, choose one',
    path: ['accountPattern'],
  })
  .meta({
    description:
      'Either columns.amount, or columns.debit and columns.credit together; columns.sign needs ' +
      'columns.amount and signValues; columns.pending needs pendingValues; validFrom must not be ' +
      'after validTo; periodPattern has at least two capture groups, accountPattern at least one; ' +
      'preamble has periodFrom and periodTo together, its account pattern one group, and it does not ' +
      'coexist with periodPattern (period) or accountPattern (account).',
  });
export type BankProfile = z.infer<typeof BankProfileSchema>;

export const StatementSchema = RecordBaseSchema.extend({
  accountId: NonEmptyString,
  bankProfileId: NonEmptyString,
  fileName: NonEmptyString,
  suggestedPath: NonEmptyString,
  from: ISODateSchema,
  to: ISODateSchema,
  periodSource: z.enum(['file', 'manual']),
  rowCount: z.int().min(0),
  /** Rows written, or already present. */
  transactionIds: z.array(NonEmptyString),
  /** Rows waiting for a decision. */
  held: z.array(
    z.object({
      row: z.int().min(1),
      reason: z.enum(['possible-duplicate', 'pending']),
      transaction: BankTransactionSchema,
      decision: z.enum(['keep', 'exclude']).optional(),
    }),
  ),
})
  .refine((s) => notAfter(s.from, s.to), { message: 'from must not be after to', path: ['from'] })
  .meta({ description: 'from must not be after to. The id is the fingerprint of the file.' });
export type Statement = z.infer<typeof StatementSchema>;

// --- Transfers between own accounts (plan 3c, task 5) ----------------------------------------

/** What a transfer is for: only `saldo` enters the balance between the apartments. */
export const TransferPurposeSchema = z.enum(['saldo', 'mutuo', 'altro']);
export type TransferPurpose = z.infer<typeof TransferPurposeSchema>;

/**
 * Money moved from one own account to another: the outgoing and incoming movements (its legs),
 * one of them at least, or none for a repayment recorded by hand (`manual`, section 24).
 */
export const TransferSchema = RecordBaseSchema.extend({
  fromAccountId: NonEmptyString,
  toAccountId: NonEmptyString,
  amount: z
    .int()
    .min(1)
    .transform((n): Cents => cents(n)),
  date: ISODateSchema,
  outTransactionId: NonEmptyString.optional(),
  inTransactionId: NonEmptyString.optional(),
  purpose: TransferPurposeSchema,
  /** `confirmed` by a person, `auto` from a pair confirmed before, `manual` without movements. */
  source: z.enum(['confirmed', 'auto', 'manual']),
  /** «Solo questa volta»: the pair does not become automatic. */
  oneOff: z.literal(true).optional(),
})
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'The two accounts must differ',
    path: ['toAccountId'],
  })
  .refine(
    (t) =>
      (t.source === 'manual') ===
      (t.outTransactionId === undefined && t.inTransactionId === undefined),
    { message: 'source is manual exactly when there is no movement', path: ['source'] },
  )
  .meta({
    description:
      'amount is positive; fromAccountId and toAccountId differ; source is manual if and only if ' +
      'neither outTransactionId nor inTransactionId is there.',
  });
export type Transfer = z.infer<typeof TransferSchema>;

/**
 * The record schemas by kind. The keys are the folder names under `_app/dati/` and the names
 * of the files in `docs/schemas/`.
 */
export const recordSchemas = {
  apartment: ApartmentSchema,
  contract: ContractSchema,
  tenancy: TenancySchema,
  supply: SupplySchema,
  bill: BillSchema,
  payment: PaymentSchema,
  transaction: BankTransactionSchema,
  instalment: InstalmentSchema,
  match: BillMatchSchema,
  note: NoteSchema,
  supplierProfile: SupplierProfileSchema,
  user: UserSchema,
  account: AccountSchema,
  bankProfile: BankProfileSchema,
  statement: StatementSchema,
  tenant: TenantSchema,
  payer: PayerSchema,
  movementClass: MovementClassSchema,
  movementRule: MovementRuleSchema,
  transfer: TransferSchema,
} as const;
export type RecordKind = keyof typeof recordSchemas;

// --- Workspace -------------------------------------------------------------------------------

/**
 * `workspace.json`, at the root of the shared folder. It is not a collection of records, so it has
 * no `id`, `v` or `rev`. `schemaVersion` describes the whole folder; `minAppVersion` is the oldest
 * app allowed to write to it (see `checkCompat`).
 */
export const WorkspaceSchema = z.object({
  workspaceId: NonEmptyString,
  name: NonEmptyString,
  schemaVersion: z.int().min(1),
  minAppVersion: z
    .string()
    .regex(SEMVER_PATTERN)
    .meta({
      description: `Plain MAJOR.MINOR.PATCH, no pre-release tag. ${NEWLINE_NOTE}`,
    }),
  createdAt: TimestampSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
