/**
 * The result of reading one PDF bill: what the Python extractor prints on stdout. It is a
 * document, not a stored record (no `id` or `rev`), but it has `v` like the records and its JSON
 * Schema is exported to `docs/schemas/extractionResult.json` for the Python side to validate
 * against. Amounts are cents, dates `YYYY-MM-DD`; a field that cannot be read reliably has no
 * value (`null`, confidence `missing`): nothing is invented.
 */
import { z } from 'zod';
import {
  BillCategorySchema,
  CentsSchema,
  ConsumptionSchema,
  IdentifierKindSchema,
  ISODateSchema,
} from './model';

const NonEmptyString = z.string().min(1);

/** Where a value was read: page (1-based), box `[x0, y0, x1, y1]` in PDF points, text read. */
const SourceSchema = z.object({
  page: z.int().min(1),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  text: z.string(),
});
export type ExtractionSource = z.infer<typeof SourceSchema>;

/** `high`: one match and the checks pass; `medium`: several matches or a doubtful check. */
const ConfidenceSchema = z.enum(['high', 'medium', 'missing']);

/** A field read from the PDF: the value (or `null`), how sure the extractor is, and the source. */
function extractedField<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    confidence: ConfidenceSchema,
    source: SourceSchema.nullable(),
  });
}
export type ExtractedField<T> = {
  value: T | null;
  confidence: z.infer<typeof ConfidenceSchema>;
  source: ExtractionSource | null;
};

export const ExtractionResultSchema = z
  .object({
    v: z.literal(1),
    engineVersion: NonEmptyString,
    /** SHA-256 of the file, lowercase hexadecimal. */
    fileHash: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: NonEmptyString,
    pages: z.int().min(0),
    status: z.enum([
      'riconosciuta',
      'da-confermare',
      'non-riconosciuta',
      'senza-testo',
      'illeggibile',
    ]),
    profileId: NonEmptyString.nullable(),
    profileRev: z.int().min(1).nullable(),
    kind: z.enum(['bill', 'tari']).nullable(),
    category: BillCategorySchema.nullable(),
    fields: z.object({
      supplier: extractedField(NonEmptyString).optional(),
      number: extractedField(z.string()).optional(),
      issueDate: extractedField(ISODateSchema).optional(),
      dueDate: extractedField(ISODateSchema).optional(),
      periodStart: extractedField(ISODateSchema).optional(),
      periodEnd: extractedField(ISODateSchema).optional(),
      amount: extractedField(CentsSchema).optional(),
      consumption: extractedField(ConsumptionSchema).optional(),
    }),
    /** TARI only: the parts of the notice. */
    parts: z.array(z.object({ label: z.string(), amount: CentsSchema, source: SourceSchema })),
    identifiers: z.array(z.object({ kind: IdentifierKindSchema, value: NonEmptyString })),
    /** Checks made by the extractor, e.g. the total equals the sum of the items. */
    checks: z.array(z.object({ code: NonEmptyString, ok: z.boolean(), message: z.string() })),
    /** Notes that do not change the status. */
    warnings: z.array(z.string()),
  })
  .meta({
    description:
      'What the extractor prints for one PDF. fileHash is lowercase hexadecimal; a PDF without ' +
      'text has status "senza-testo" and no fields.',
  });
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
