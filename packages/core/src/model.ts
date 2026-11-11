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

/** A note written by a person (not the automatic notes of the app). */
export const NoteSchema = RecordBaseSchema.extend({
  targetType: z.enum([
    'apartment',
    'contract',
    'tenancy',
    'bill',
    'instalment',
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
 * A regular expression that compiles in JavaScript and stays in the subset shared with Python's
 * `re`: numbered groups only, no lookbehind, no inline flags. JSON Schema cannot express this.
 */
const PatternSchema = NonEmptyString.superRefine((pattern, ctx) => {
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
  /** Tried in order; the first that matches wins. */
  rules: z.array(RuleSchema).min(1),
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
  }),
  fields: z.partialRecord(
    z.enum(Object.keys(FIELD_VALUE_TYPES) as [keyof typeof FIELD_VALUE_TYPES]),
    FieldRulesSchema,
  ),
  identifiers: z.array(z.object({ kind: IdentifierKindSchema, pattern: PatternSchema })),
  /** TARI only: one match per part of the notice, label in group 1 and amount in group 2. */
  parts: z.object({ pattern: PatternSchema }).optional(),
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
  .meta({
    description:
      'kind "bill" needs a category and kind "tari" must not have one; parts only with kind ' +
      '"tari"; validFrom must not be after validTo; the valueType of every rule of a field is ' +
      'fixed: amount euro, issueDate and dueDate date, period date-range, consumption quantity, ' +
      'number text.',
  });
export type SupplierProfile = z.infer<typeof SupplierProfileSchema>;

/**
 * The record schemas by kind. The keys are the folder names under `_app/dati/` and the names
 * of the files in `docs/schemas/`.
 */
export const recordSchemas = {
  apartment: ApartmentSchema,
  contract: ContractSchema,
  tenancy: TenancySchema,
  bill: BillSchema,
  payment: PaymentSchema,
  transaction: BankTransactionSchema,
  instalment: InstalmentSchema,
  match: BillMatchSchema,
  note: NoteSchema,
  supplierProfile: SupplierProfileSchema,
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
