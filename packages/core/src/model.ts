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
 * still read them. Rewriting a record that has such keys would lose them: `loadAll` reports such a
 * record as `unknown-fields` and `commitChange` refuses to write over it, and a change of the
 * schemas raises `DATA_FORMAT` (see `version.ts`), which makes older apps read-only.
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
import { isSafePattern } from './safe-pattern';
import { foldText } from './text';
import { SEMVER_PATTERN } from './version';

// --- Building blocks ------------------------------------------------------------------------

/** Whole euro cents, any sign. Parses to the branded `Cents`. */
export const CentsSchema = z.int().transform((n): Cents => cents(n));

/** Whole euro cents, any sign but zero. */
const NonZeroCentsSchema = z
  .int()
  .refine((n) => n !== 0, { message: 'Not zero' })
  .transform((n): Cents => cents(n));

/** Whole euro cents, at least one. */
const PositiveCentsSchema = z
  .int()
  .min(1)
  .transform((n): Cents => cents(n));

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

/** A year as four digits, `AAAA` (text, as in the ids). */
export const YearSchema = z.string().regex(/^[0-9]{4}$/);

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
  /**
   * Plan 22 (decision 2 of user1, 19 Nov 2026): the beds before a change «valido dal». Each entry
   * holds up to its month `to` included, in increasing order; `posti` and `rooms` hold after the
   * last one. Without entries they hold from always (`bedsAt`).
   */
  earlierBeds: z
    .array(
      z.object({
        to: YearMonthSchema,
        posti: z.int().min(1),
        rooms: z.array(NonEmptyString).optional(),
      }),
    )
    .optional(),
  /** Monthly rent plus flat charges as written in the contract. Only used for a check. */
  contrattoMensile: CentsSchema.optional(),
  /** Start of the lease year (annualità). */
  annualitaStart: AnnualitaStartSchema,
  /** Start of the condominium fiscal year, when the apartment has one. */
  condominioStart: AnnualitaStartSchema.optional(),
  /**
   * Who bears the condominium difference consuntivo − preventivo, i.e. last year's settlement on an
   * instalment (plan 8, R190): `tenants` when absent (R3), `owner` keeps it out of the conguaglio.
   */
  condoDifferenceTo: z.enum(['tenants', 'owner']).optional(),
  /** Days of grace before a rent payment counts as late (R109); `DEFAULT_RENT_LATE_DAYS` if absent. */
  rentLateDays: z.int().min(0).max(31).optional(),
  /** Street address, as written on the notices. */
  address: NonEmptyString.optional(),
  /**
   * POD, PDR and customer codes of the utilities of the apartment (plan 17, R314), typed by
   * user1: the import of a bill checks them.
   */
  supplyCodes: z.array(NonEmptyString).optional(),
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
  .refine(
    (apartment) =>
      (apartment.earlierBeds ?? []).every(
        (e, i, all) =>
          (i === 0 || (all[i - 1]?.to ?? '') < e.to) &&
          (e.rooms === undefined ||
            (e.rooms.length === e.posti && new Set(e.rooms).size === e.rooms.length)),
      ),
    { message: 'Earlier beds: months in order, one unique name per bed', path: ['earlierBeds'] },
  )
  .meta({
    description:
      'When rooms is present: one unique name per bed (posti). earlierBeds: increasing months, the same rule for each entry.',
  });
export type Apartment = z.infer<typeof ApartmentSchema>;

/**
 * A supply of a shared notice (for example a TARI utenza), linked to the apartments it belongs to.
 * `weight` is the part of the supply each apartment pays, in basis points (1..10000, whole): the
 * weights of a supply add up to exactly 10000; no share is written in the code.
 */
const SupplyApartmentsSchema = z
  .array(z.object({ apartmentId: NonEmptyString, weight: z.int().min(1).max(10000) }))
  .min(1);
type SupplyApartments = z.infer<typeof SupplyApartmentsSchema>;
const onceEach = (rows: SupplyApartments) =>
  new Set(rows.map((a) => a.apartmentId)).size === rows.length;
const whole = (rows: SupplyApartments) => rows.reduce((sum, a) => sum + a.weight, 0) === 10000;

export const SupplySchema = RecordBaseSchema.extend({
  /** The supply code as written on the notice (the label of an extracted part). */
  label: NonEmptyString,
  apartments: SupplyApartmentsSchema,
  /**
   * Plan 22 (decision 2 of user1, 19 Nov 2026): the apartments and weights before a change «valido
   * dal», each up to its month `to` included, in increasing order; `apartments` holds after the
   * last one. Without entries it holds from always (`weightsAt`).
   */
  earlierApartments: z
    .array(z.object({ to: YearMonthSchema, apartments: SupplyApartmentsSchema }))
    .optional(),
})
  .refine((supply) => onceEach(supply.apartments), {
    message: 'An apartment appears once in a supply',
    path: ['apartments'],
  })
  .refine((supply) => whole(supply.apartments), {
    message: 'The weights of a supply add up to exactly 10000',
    path: ['apartments'],
  })
  .refine(
    (supply) =>
      (supply.earlierApartments ?? []).every(
        (e, i, all) =>
          (i === 0 || (all[i - 1]?.to ?? '') < e.to) &&
          onceEach(e.apartments) &&
          whole(e.apartments),
      ),
    { message: 'Earlier weights: months in order, the same rules', path: ['earlierApartments'] },
  )
  .meta({
    description:
      'apartments: at least one, each apartment once, weight in basis points (1..10000), sum exactly 10000. earlierApartments: increasing months, the same rules for each entry.',
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
  // Plan 7: optional data fields; none of them is read by a calculation.
  /** Canone concordato. */
  agreedRent: z.literal(true).optional(),
  /** Contract for university students. */
  forStudents: z.literal(true).optional(),
  /** The duration written in the contract (not derived from start/end, which include extensions). */
  durationMonths: z.int().min(1).optional(),
  signedOn: ISODateSchema.optional(),
  /** Identifier and date of the registration: the code is personal data, never in a log or message. */
  registration: z
    .object({ code: NonEmptyString.optional(), date: ISODateSchema.optional() })
    .optional(),
  taxRegime: z.enum(['cedolare', 'ordinario']).optional(),
  /** Cedolare rate in basis points as entered by the user: data only, never used to compute a tax. */
  cedolareRateBp: z.int().min(1).max(10000).optional(),
  tenancyIds: z.array(NonEmptyString).optional(),
  /** `Payment` records of kind `caparra`. */
  depositPaymentIds: z.array(NonEmptyString).optional(),
  /** Rent history: each entry holds from its month until the next entry. */
  rent: z
    .array(
      z.object({ from: YearMonthSchema, monthlyRent: CentsSchema, monthlyAdvance: CentsSchema }),
    )
    .optional(),
  /** Takeovers (plan 11): `month` is the first month of the incoming tenancy. Only a takeover writes it. */
  takeovers: z
    .array(
      z.object({
        month: YearMonthSchema,
        outTenancyId: NonEmptyString,
        inTenancyId: NonEmptyString,
      }),
    )
    .optional(),
})
  .refine((contract) => notAfter(contract.start, contract.end), {
    message: 'The contract ends before it starts',
    path: ['end'],
  })
  .refine(
    (contract) => contract.cedolareRateBp === undefined || contract.taxRegime === 'cedolare',
    { message: 'A cedolare rate needs taxRegime cedolare', path: ['cedolareRateBp'] },
  )
  .refine((contract) => unique(contract.tenancyIds), {
    message: 'A tenancy is linked once',
    path: ['tenancyIds'],
  })
  .refine((contract) => unique(contract.depositPaymentIds), {
    message: 'A deposit is linked once',
    path: ['depositPaymentIds'],
  })
  .refine((contract) => rentHistoryValid(contract), {
    message: 'Rent entries: from strictly increasing within start..end, rent > 0, advance >= 0',
    path: ['rent'],
  })
  .refine(
    ({ takeovers = [] }) =>
      unique(takeovers.map((t) => t.outTenancyId)) &&
      unique(takeovers.map((t) => t.inTenancyId)) &&
      takeovers.every(
        (t, i) =>
          t.outTenancyId !== t.inTenancyId &&
          (i === 0 || notAfter(takeovers[i - 1]?.month ?? '', t.month)),
      ),
    {
      message: 'Takeovers: months not decreasing, a tenancy leaves once and enters once',
      path: ['takeovers'],
    },
  )
  .meta({
    description:
      'start must not be after end. cedolareRateBp only with taxRegime cedolare. tenancyIds and ' +
      'depositPaymentIds without repetitions. rent: from strictly increasing, each between start ' +
      'and end, monthlyRent > 0, monthlyAdvance >= 0. takeovers: month not decreasing, ' +
      'outTenancyId unique, inTenancyId unique, outTenancyId different from inTenancyId.',
  });
export type Contract = z.infer<typeof ContractSchema>;
export type ContractRent = NonNullable<Contract['rent']>[number];

function unique(values: readonly string[] | undefined): boolean {
  return values === undefined || new Set(values).size === values.length;
}

/** The rule on `Contract.rent`, also used by the writes to refuse before parsing. */
export function rentHistoryValid(contract: {
  start: string;
  end: string;
  rent?: readonly { from: string; monthlyRent: number; monthlyAdvance: number }[] | undefined;
}): boolean {
  return (contract.rent ?? []).every(
    (entry, i, all) =>
      notAfter(contract.start, entry.from) &&
      notAfter(entry.from, contract.end) &&
      (i === 0 || (all[i - 1]?.from ?? '') < entry.from) &&
      entry.monthlyRent > 0 &&
      entry.monthlyAdvance >= 0,
  );
}

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
  /** The deposit expected from this tenant (plan 11), typed by user1: only checked, never computed. */
  expectedDeposit: PositiveCentsSchema.optional(),
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

/**
 * The reserved part of the tenant's card (plan 17, R311): personal data typed by user1 that fill
 * the forms. A record of its own (`_app/dati/tenantCard/<tenantId>.json`, id = the tenant's id),
 * read only by the forms and `scheda-inquilino`, never by the reconciliation; never printed.
 */
export const TenantCardSchema = RecordBaseSchema.extend({
  taxCode: NonEmptyString.optional(),
  birthPlace: NonEmptyString.optional(),
  birthDate: ISODateSchema.optional(),
  residence: NonEmptyString.optional(),
  idDocument: z
    .object({
      number: NonEmptyString,
      issuer: NonEmptyString.optional(),
      issuedOn: ISODateSchema.optional(),
      expiresOn: ISODateSchema.optional(),
    })
    .optional(),
}).meta({ description: 'id is the tenant id; personal data, every field optional.' });
export type TenantCard = z.infer<typeof TenantCardSchema>;

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
  /** The IMU rate this F24 pays, assigned by hand (plan 3d, task 2). */
  imu: z
    .object({
      f24Group: NonEmptyString,
      year: YearSchema,
      rateIndex: z.int().min(1),
    })
    .optional(),
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
  .refine((c) => c.imu === undefined || c.f24 === true, {
    message: 'imu only with f24',
    path: ['imu'],
  })
  .meta({
    description:
      'id is mc-<transactionId>. excludeReason is present if and only if kind is escluso; ' +
      'apartmentId if and only if kind is not escluso; f24 only with tasse; ruleId never with ' +
      'escluso; imu only with f24.',
  });
export type MovementClass = z.infer<typeof MovementClassSchema>;

/**
 * A rule learnt from a confirmation (`rule-<transactionId>`, plan 3c, question 1): the movements
 * of `accountId` in `direction` whose counterparty has `key` get `kind` and `apartmentId`, from
 * `validFrom` up to `validTo` (both optional); the amount does not count. Incoming only by IBAN
 * (question 2); never outgoing on the IBAN of a valid payer (R130).
 */
export const MovementRuleSchema = RecordBaseSchema.extend({
  direction: z.enum(['in', 'out']),
  accountId: NonEmptyString,
  key: PayerKeySchema,
  kind: OutgoingKindSchema,
  apartmentId: NonEmptyString,
  /** Set when the rule took the place of older rules in conflict (user1, 15 Nov 2026). */
  validFrom: ISODateSchema.optional(),
  validTo: ISODateSchema.optional(),
})
  .refine((r) => r.direction === 'out' || r.key.startsWith('iban:'), {
    message: 'An incoming rule needs an iban key',
    path: ['key'],
  })
  .refine(
    (r) => r.validFrom === undefined || r.validTo === undefined || notAfter(r.validFrom, r.validTo),
    { message: 'The rule ends before it starts', path: ['validTo'] },
  )
  .meta({
    description:
      'With direction in, key must be an iban: key. When both are present, validFrom must not be after validTo.',
  });
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
  /** Recognises an F24 in the description of a movement (plan 3c, task 7; R129). */
  f24Pattern: PatternSchema.optional(),
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
  .refine((p) => p.f24Pattern === undefined || isSafePattern(p.f24Pattern), {
    message: 'f24Pattern is outside the safe subset of R102',
    path: ['f24Pattern'],
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
      'coexist with periodPattern (period) or accountPattern (account); f24Pattern is in the safe ' +
      'subset of R102.',
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

// --- IMU (plan 3d) ---------------------------------------------------------------------------

/**
 * The IMU expected for one apartment and year (`imu-<apartmentId>-<year>`, plan 3d): one entry
 * per rate, indices 1 to n, amounts and due dates when known (data, never computed: no fiscal
 * rule in the code). The apartments with the same `f24Group` and `year` are paid by one F24.
 */
export const ImuYearSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  year: YearSchema,
  f24Group: NonEmptyString,
  /** The annual total, when it is the only figure known (question 10: data only). */
  annualTotal: PositiveCentsSchema.optional(),
  rates: z
    .array(
      z.object({
        index: z.int().min(1),
        expected: PositiveCentsSchema.optional(),
        /** Only shown, never used for a state (question 6). */
        dueDate: ISODateSchema.optional(),
      }),
    )
    .min(1),
})
  .refine((y) => y.id === `imu-${y.apartmentId}-${y.year}`, {
    message: 'The id must be imu-<apartmentId>-<year>',
    path: ['id'],
  })
  .refine((y) => y.rates.every((r, i) => r.index === i + 1), {
    message: 'The rate indices go from 1 to n, in order',
    path: ['rates'],
  })
  .meta({
    description:
      'id is imu-<apartmentId>-<year>; rates[i].index is i + 1; amounts are positive cents.',
  });
export type ImuYear = z.infer<typeof ImuYearSchema>;

/**
 * The rents of one apartment and year as typed by user1 (`rent-<apartmentId>-<year>`, R182):
 * the base of the cedolare estimate, never derived from the contracts or the payments.
 */
export const RentYearSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  year: YearSchema,
  totalRent: PositiveCentsSchema,
})
  .refine((y) => y.id === `rent-${y.apartmentId}-${y.year}`, {
    message: 'The id must be rent-<apartmentId>-<year>',
    path: ['id'],
  })
  .meta({ description: 'id is rent-<apartmentId>-<year>; totalRent is positive cents.' });
export type RentYear = z.infer<typeof RentYearSchema>;

/**
 * A rule learnt from an IMU assignment (`imur-<transactionId>`, plan 3d, task 5, question 8):
 * the F24s of `accountId` with the counterparty `key` (none: those without a key) get the
 * suggestion of `f24Group`, from `validFrom` up to `validTo`. It only suggests, never assigns.
 */
export const ImuRuleSchema = RecordBaseSchema.extend({
  accountId: NonEmptyString,
  key: PayerKeySchema.optional(),
  f24Group: NonEmptyString,
  validFrom: ISODateSchema.optional(),
  validTo: ISODateSchema.optional(),
})
  .refine(
    (r) => r.validFrom === undefined || r.validTo === undefined || notAfter(r.validFrom, r.validTo),
    { message: 'The rule ends before it starts', path: ['validTo'] },
  )
  .meta({ description: 'When both are present, validFrom must not be after validTo.' });
export type ImuRule = z.infer<typeof ImuRuleSchema>;

// --- Documents to review (plan 15) ----------------------------------------------------------

/**
 * A PDF (or part of one) read for an apartment that a person still has to confirm (section 22,
 * step 5; R260). It holds no reading and no proposal: those are made again from the file. It is
 * «da rivedere» while no live bill or instalment of the same file and pages exists.
 */
export const PendingDocumentSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  fileHash: NonEmptyString,
  /** The part of the file, when it is not the whole file. */
  pages: z.tuple([z.int().min(1), z.int().min(1)]).optional(),
  documentKind: DocumentKindSchema,
  // No codes: they are made again at each reading (R260), a copy here would go stale.
})
  .refine((d) => d.id.startsWith('doc-'), { message: 'The id must start with doc-', path: ['id'] })
  .refine((d) => d.pages === undefined || d.pages[0] <= d.pages[1], {
    message: 'The page range ends before it starts',
    path: ['pages'],
  })
  .meta({ description: 'id starts with doc-; pages[0] must not be after pages[1].' });
export type PendingDocument = z.infer<typeof PendingDocumentSchema>;

// --- Payables (plan 9) -----------------------------------------------------------------------

/** The kinds typed by hand; IMU, condominium and TARI items come from their own records. */
export const PayableKindSchema = z.enum(['registro', 'bollo', 'cedolare', 'f24', 'altro']);
export type PayableKind = z.infer<typeof PayableKindSchema>;

/**
 * An owner's payable typed by user1 (`scad-<id>`, plan 9): a due date and an amount as data, never
 * computed. `repeatYearly` is only a mark: the next item is made by an explicit command.
 */
export const PayableSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  kind: PayableKindSchema,
  dueDate: ISODateSchema,
  /** Absent: amount still to be typed. */
  expected: PositiveCentsSchema.optional(),
  repeatYearly: z.literal(true).optional(),
  /** The item this one was repeated from. */
  previousId: NonEmptyString.optional(),
  /** Marked paid: by hand, or by a movement whose class was confirmed by hand. */
  paid: z.object({ date: ISODateSchema, transactionId: NonEmptyString.optional() }).optional(),
  /** The tax year chosen by user1 (plan 13, R242), never computed; absent: not chosen. */
  taxYear: z.int().min(1).max(9999).optional(),
  /**
   * The voce of the tax table of a `bollo`, `f24` or `altro` payable, chosen by user1 when it is
   * created (plan 17, R303); a `cedolare` or `registro` one is its own voce.
   */
  taxVoice: z.enum(['cedolare', 'registro']).optional(),
})
  .refine((p) => p.id.startsWith('scad-'), {
    message: 'The id must start with scad-',
    path: ['id'],
  })
  .refine((p) => p.taxVoice === undefined || !['cedolare', 'registro'].includes(p.kind), {
    message: 'taxVoice only for bollo, f24 and altro',
    path: ['taxVoice'],
  })
  .meta({
    description:
      'id starts with scad-; expected is positive cents; taxYear 1-9999; taxVoice only for bollo, f24 and altro.',
  });
export type Payable = z.infer<typeof PayableSchema>;

// --- Condominium (plan 8) ----------------------------------------------------------------------

/**
 * A condominium document of one apartment and fiscal year (`condoc-<apartmentId>-<esercizio>-<kind>`,
 * plan 8, R190): the budget (`preventivo`) or the final account (`consuntivo`). `total` is the
 * unit's share; `quotaConduttore` the tenants' share when the administrator's document gives it
 * (it wins over any rule). The instalment plan is the `Instalment`s of the same `esercizio`.
 */
export const CondoDocumentSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  /** Same text as `Instalment.esercizio`, e.g. `2026-27`. */
  esercizio: NonEmptyString,
  kind: z.enum(['preventivo', 'consuntivo']),
  total: CentsSchema,
  quotaConduttore: CentsSchema.optional(),
  lines: z
    .array(
      z.object({
        label: NonEmptyString,
        amount: CentsSchema,
        quotaConduttore: CentsSchema.optional(),
      }),
    )
    .optional(),
  fileHash: NonEmptyString.optional(),
  fileDocument: FileDocumentSchema.optional(),
})
  .refine((d) => d.id === `condoc-${d.apartmentId}-${d.esercizio}-${d.kind}`, {
    message: 'The id must be condoc-<apartmentId>-<esercizio>-<kind>',
    path: ['id'],
  })
  .refine(
    (d) => d.lines === undefined || d.lines.reduce((sum, l) => sum + l.amount, 0) === d.total,
    { message: 'The lines add up to the total', path: ['lines'] },
  )
  .meta({
    description:
      'id is condoc-<apartmentId>-<esercizio>-<kind>; when lines are present, their amounts add up to total.',
  });
export type CondoDocument = z.infer<typeof CondoDocumentSchema>;

/**
 * Part of an extraordinary condominium expense caused by tenants and advanced by the owners, to be
 * recovered from them in their settlement (plan 8, group B, R196). `amount` is what user1 enters
 * (part of the expense at most); `shares` the tenants user1 chose with their parts; `status` is set
 * by user1 (`non-recuperabile`: the expense stays with the owner); `periodLabel` the settlement
 * period user1 chose (none: in no settlement).
 */
export const TenantRecoverySchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  /** A live extraordinary condominium `Instalment` of the same apartment. */
  instalmentId: NonEmptyString.optional(),
  /**
   * Or a live outgoing movement classified to the apartment: an expense paid straight to a
   * supplier (plan 17, R300).
   */
  transactionId: NonEmptyString.optional(),
  /**
   * Signed (plan 17, R300): negative when the tenant paid on behalf of the owners (a credit of the
   * tenant). Never zero; every share has the sign of the amount.
   */
  amount: NonZeroCentsSchema,
  shares: z.array(z.object({ tenantId: NonEmptyString, amount: NonZeroCentsSchema })).min(1),
  status: z.enum(['da-recuperare', 'recuperata', 'non-recuperabile']),
  periodLabel: NonEmptyString.optional(),
  /**
   * The day of the expense (plan 17, R300): its period is the default one when `periodLabel` is
   * absent. Written from the instalment or the movement; typed by user1 without either.
   */
  date: ISODateSchema.optional(),
})
  .refine((r) => unique(r.shares.map((s) => s.tenantId)), {
    message: 'A tenant appears once',
    path: ['shares'],
  })
  .refine((r) => r.shares.reduce((sum, s) => sum + s.amount, 0) === r.amount, {
    message: 'The shares add up to the amount',
    path: ['shares'],
  })
  .refine((r) => r.shares.every((s) => s.amount > 0 === r.amount > 0), {
    message: 'Every share has the sign of the amount',
    path: ['shares'],
  })
  .refine((r) => r.instalmentId === undefined || r.transactionId === undefined, {
    message: 'At most one expense: an instalment or a movement',
    path: ['transactionId'],
  })
  .refine((r) => r.amount < 0 || r.instalmentId !== undefined || r.transactionId !== undefined, {
    message: 'A positive recovery recovers an expense',
    path: ['instalmentId'],
  })
  .meta({
    description:
      'amount and shares are non-zero cents of one sign; each tenant once; the shares add up to amount; at most one of instalmentId and transactionId, one of them when amount is positive.',
  });
export type TenantRecovery = z.infer<typeof TenantRecoverySchema>;

// --- Thresholds of the consumption alarm (plan 17) ---------------------------------------------

const MetricThresholdsSchema = z
  .object({
    consumption: z.int().min(0).optional(),
    amount: z.int().min(0).optional(),
    unitPrice: z.int().min(0).optional(),
  })
  .optional();

/**
 * The thresholds of the consumption alarm (plan 17, R313), in basis points, typed by user1: the
 * same for every apartment (`soglie-consumi`), or one apartment's own (`soglie-consumi-<id>`).
 */
export const ConsumptionSettingsSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString.optional(),
  giallo: MetricThresholdsSchema,
  rosso: MetricThresholdsSchema,
})
  .refine(
    (c) =>
      c.id === (c.apartmentId === undefined ? 'soglie-consumi' : `soglie-consumi-${c.apartmentId}`),
    { message: 'The id must be soglie-consumi or soglie-consumi-<apartmentId>', path: ['id'] },
  )
  .meta({
    description:
      'id is soglie-consumi, or soglie-consumi-<apartmentId> for one apartment; thresholds in basis points.',
  });
export type ConsumptionSettings = z.infer<typeof ConsumptionSettingsSchema>;

// --- Workspace settings (review of 18 Nov 2026, I9) --------------------------------------------

/** The id of the one settings record of the workspace. */
export const WORKSPACE_SETTINGS_ID = 'impostazioni';

/**
 * The control thresholds of the workspace typed by user1 (review of 18 Nov 2026, I9): a field
 * absent means the default of the code (`DEFAULT_IMU_TOLERANCE_BP`). One record,
 * `impostazioni`.
 */
export const WorkspaceSettingsSchema = RecordBaseSchema.extend({
  /**
   * IMU: how far an F24 may be from the expected rate and still be paid, in basis points of the
   * expected (100 is 1%, decision of user1 of 14 Nov 2026: «= configurazione»).
   */
  imuToleranceBp: z.int().min(0).max(10000).optional(),
})
  .refine((s) => s.id === WORKSPACE_SETTINGS_ID, {
    message: 'The id must be impostazioni',
    path: ['id'],
  })
  .meta({ description: 'id is impostazioni; imuToleranceBp in basis points (100 = 1%).' });
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

// --- Closing of a settlement period (review of 18 Nov 2026, I2, R5) ----------------------------

/**
 * The costs of each tenant and of the owner at a closing (R5): the months with no tenant present
 * (plan 21), or the empty beds for a snapshot of `engineVersion` 0.1.0 (R363).
 */
const PeriodSnapshotSchema = z.object({
  /** Bills and TARI, condominium rata and commission of each tenant (`spese`, `rata`, ...). */
  tenants: z.array(
    z.object({
      tenantId: NonEmptyString,
      spese: CentsSchema,
      rata: CentsSchema,
      commissione: CentsSchema,
      /** What the tenant owes for an intervention (R197), 0 if none: part of the costs. */
      recupero: CentsSchema,
      /** Not a cost: asked in the supplementary settlement when it falls (F11). */
      forfaitIncassato: CentsSchema,
      /** Last year's condominium settlement (R3): a change after closing is supplementary (K). */
      conguaglioPrec: CentsSchema,
      /**
       * H: the flat charge counted at the previous closing and no longer collected when the
       * reopened period was closed again (part of the due, shown on a line of its own).
       */
      forfaitNonIncassato: CentsSchema.optional(),
    }),
  ),
  /** The months with no tenant present (plan 21; before, the empty beds), last year's condominium settlement excluded. */
  emptyBeds: CentsSchema,
});

/**
 * Settlement of one tenant marked by user1 (F1): the date, and the movement that paid it if any.
 * Fifth round: `amount`, what was due and declared settled then, and `flatCollected`, the flat
 * charge collected at that moment (what comes after it is extra, «da verificare»). A mark written
 * without them by an earlier commit of this branch is read as the snapshot's due and flat charge.
 */
const PeriodSettledSchema = z.array(
  z.object({
    tenantId: NonEmptyString,
    on: ISODateSchema,
    transactionId: NonEmptyString.optional(),
    amount: CentsSchema.optional(),
    flatCollected: CentsSchema.optional(),
  }),
);

/**
 * D: supplementary settlements marked settled by user1: the tenant, the date, the movement if any
 * and the amount of the supplementary settled then (a later difference is still due).
 */
const SupplementarySettledSchema = z.array(
  z.object({
    tenantId: NonEmptyString,
    on: ISODateSchema,
    transactionId: NonEmptyString.optional(),
    amount: CentsSchema,
  }),
);

/** A reopening (F3): the date and the reason, both given by user1. */
const PeriodReopenedSchema = z.object({ on: ISODateSchema, reason: NonEmptyString });

/**
 * The closing of one settlement period of an apartment (R5), `chiusura-<apartmentId>-<periodLabel>`,
 * with the snapshot of the costs of each tenant and of the owner that the supplementary
 * settlement compares with (`calcConguaglioSupplementare`). Written only when every rent and flat
 * charge is collected and no item is waiting. F1: `sentOn` (sent to the tenants) and `settled` (per
 * tenant) are marked by user1; F3: `reopened` opens the period again, keeping this snapshot, and a
 * later closing moves it into `history` (never deleted).
 */
export const PeriodCloseSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  periodLabel: NonEmptyString,
  from: YearMonthSchema,
  to: YearMonthSchema,
  closedAt: TimestampSchema,
  /** `CALC_VERSION` of the calculation of the snapshot; 0.1.0 is the split over the beds (R363). */
  engineVersion: NonEmptyString,
  snapshot: PeriodSnapshotSchema,
  /** The day the settlement was sent to the tenants (F1). */
  sentOn: ISODateSchema.optional(),
  /** The tenants whose settlement user1 marked as settled (F1), once each. */
  settled: PeriodSettledSchema.optional(),
  /** The supplementary settlements marked settled (D), once per tenant. */
  supplementarySettled: SupplementarySettledSchema.optional(),
  /**
   * The records the snapshot counted, as `<kind>/<id>`, sorted (F5): what existed at the closing,
   * read from the folder and not from the clocks, so an operation of another computer synced
   * after the closing is new.
   */
  inputs: z.array(NonEmptyString).optional(),
  /** Present when the period was reopened after this closing (F3): it is no longer closed. */
  reopened: PeriodReopenedSchema.optional(),
  /** The earlier closings of the period, each reopened, oldest first (F3). */
  history: z
    .array(
      z.object({
        closedAt: TimestampSchema,
        engineVersion: NonEmptyString,
        snapshot: PeriodSnapshotSchema,
        sentOn: ISODateSchema.optional(),
        settled: PeriodSettledSchema.optional(),
        supplementarySettled: SupplementarySettledSchema.optional(),
        reopened: PeriodReopenedSchema,
      }),
    )
    .optional(),
})
  .refine((c) => c.id === `chiusura-${c.apartmentId}-${c.periodLabel}`, {
    message: 'The id must be chiusura-<apartmentId>-<periodLabel>',
    path: ['id'],
  })
  .meta({ description: 'id is chiusura-<apartmentId>-<periodLabel>; amounts in cents.' });
export type PeriodClose = z.infer<typeof PeriodCloseSchema>;

// --- Legal interest rates (plan 17) -------------------------------------------------------------

/**
 * The legal interest rate of one year (plan 17, R301), typed by user1 like the IMU amounts: the
 * deposit return statement reads it, the code never holds a rate.
 */
export const LegalRateSchema = RecordBaseSchema.extend({
  year: YearSchema,
  /** Basis points: 250 is 2,50%. */
  rateBp: z.int().min(0).max(10000),
})
  .refine((r) => r.id === `tasso-${r.year}`, {
    message: 'The id must be tasso-<year>',
    path: ['id'],
  })
  .meta({ description: 'id is tasso-<year>; rateBp in basis points, 0 to 10000.' });
export type LegalRate = z.infer<typeof LegalRateSchema>;

// --- Address book (plan 14) --------------------------------------------------------------------

/**
 * A condominium administrator or a supplier (plan 14, R251): name and contacts as free text typed
 * by user1, never checked or read by the engine; linked to apartments, supplies (utenze) and bill
 * categories (spese).
 */
export const ContactSchema = RecordBaseSchema.extend({
  role: z.enum(['amministratore', 'fornitore']),
  name: NonEmptyString,
  phone: NonEmptyString.optional(),
  email: NonEmptyString.optional(),
  notes: NonEmptyString.optional(),
  apartmentIds: z.array(NonEmptyString),
  supplyIds: z.array(NonEmptyString).optional(),
  /** The kinds of bill (spese) the contact is for: bills carry no supply id. */
  categories: z.array(BillCategorySchema).optional(),
})
  .refine((c) => unique(c.apartmentIds) && unique(c.supplyIds) && unique(c.categories), {
    message: 'An apartment or a supply appears once',
    path: ['apartmentIds'],
  })
  .meta({ description: 'Each apartment, supply and category appears once.' });
export type Contact = z.infer<typeof ContactSchema>;

// --- Taxes and estimates (plan 10) -------------------------------------------------------------

/** The voci of «Tasse e stime» (section 34). */
export const TAX_VOICES = ['cedolare', 'imu', 'registro', 'tari', 'condominio'] as const;
export const TaxVoiceSchema = z.enum(TAX_VOICES);
export type TaxVoice = z.infer<typeof TaxVoiceSchema>;

/**
 * The start-of-year estimate of one apartment, year and voce typed by user1
 * (`tax-<apartmentId>-<year>-<voce>`, plan 10, R210): data, never computed. Zero means «nothing
 * expected», which differs from no record.
 */
export const TaxEstimateSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  year: YearSchema,
  voce: TaxVoiceSchema,
  amount: z
    .int()
    .min(0)
    .transform((n): Cents => cents(n)),
})
  .refine((e) => e.id === `tax-${e.apartmentId}-${e.year}-${e.voce}`, {
    message: 'The id must be tax-<apartmentId>-<year>-<voce>',
    path: ['id'],
  })
  .meta({ description: 'id is tax-<apartmentId>-<year>-<voce>; amount is cents, not negative.' });
export type TaxEstimate = z.infer<typeof TaxEstimateSchema>;

/**
 * A «tasse» debit assigned by user1 to cedolare or registro and tax years (`taxp-<transactionId>`,
 * plan 10, R210): the parts add up to the debit (checked by the write, R2). IMU F24s have their
 * own assignment (`MovementClass.imu`).
 */
export const TaxPaymentSchema = RecordBaseSchema.extend({
  transactionId: NonEmptyString,
  parts: z
    .array(
      z.object({
        voce: z.enum(['cedolare', 'registro']),
        year: YearSchema,
        amount: PositiveCentsSchema,
      }),
    )
    .min(1),
})
  .refine((p) => p.id === `taxp-${p.transactionId}`, {
    message: 'The id must be taxp-<transactionId>',
    path: ['id'],
  })
  .refine((p) => unique(p.parts.map((part) => `${part.voce}-${part.year}`)), {
    message: 'A voce and year appear once',
    path: ['parts'],
  })
  .meta({
    description:
      'id is taxp-<transactionId>; parts: at least one, amounts positive cents, each voce and year once.',
  });
export type TaxPayment = z.infer<typeof TaxPaymentSchema>;

// --- Confirmed tax discrepancies (plan 17) ---------------------------------------------------

/**
 * A discrepancy of the tax table confirmed by user1 with a note (plan 17, R304): the row of the
 * taxpayer of `apartmentId` (the first of the table) for `year` and `voce` no longer warns while
 * its difference is still `difference` (and `annualDifference`, for an IMU with only the annual
 * total). Undone with the journal.
 */
export const TaxConfirmationSchema = RecordBaseSchema.extend({
  apartmentId: NonEmptyString,
  year: YearSchema,
  voce: TaxVoiceSchema,
  difference: CentsSchema,
  annualDifference: CentsSchema.optional(),
  note: NonEmptyString,
})
  .refine((c) => c.id === `taxc-${c.apartmentId}-${c.year}-${c.voce}`, {
    message: 'The id must be taxc-<apartmentId>-<year>-<voce>',
    path: ['id'],
  })
  .meta({ description: 'id is taxc-<apartmentId>-<year>-<voce>; note not empty.' });
export type TaxConfirmation = z.infer<typeof TaxConfirmationSchema>;

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
  imuYear: ImuYearSchema,
  rentYear: RentYearSchema,
  imuRule: ImuRuleSchema,
  payable: PayableSchema,
  pendingDocument: PendingDocumentSchema,
  condoDocument: CondoDocumentSchema,
  tenantRecovery: TenantRecoverySchema,
  taxEstimate: TaxEstimateSchema,
  taxPayment: TaxPaymentSchema,
  contact: ContactSchema,
  legalRate: LegalRateSchema,
  taxConfirmation: TaxConfirmationSchema,
  consumptionSettings: ConsumptionSettingsSchema,
  tenantCard: TenantCardSchema,
  workspaceSettings: WorkspaceSettingsSchema,
  periodClose: PeriodCloseSchema,
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
