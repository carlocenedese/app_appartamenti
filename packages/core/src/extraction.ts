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
  DocumentKindSchema,
  IdentifierKindSchema,
  ISODateSchema,
} from './model';

const NonEmptyString = z.string().min(1);

/**
 * Where a value was read: page (1-based), box `[x0, top, x1, bottom]` in points from the TOP-LEFT
 * corner of the page (as the Python reader gives it, not PDF user space), text read.
 */
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

/** Whether `item` (a field or a part) has a value read from a page that was read with OCR. */
function readWithOcr(
  result: { ocrPages: number[] },
  item: { value?: unknown; source: { page: number } | null } | undefined,
): boolean {
  return (
    item !== undefined &&
    item.value !== null &&
    item.source !== null &&
    result.ocrPages.includes(item.source.page)
  );
}

/** Whether a field, or a part of a TARI notice, was read from a page read with OCR. */
export function hasOcrReading(result: {
  ocrPages: number[];
  fields: Record<string, { value: unknown; source: { page: number } | null } | undefined>;
  parts: { source: { page: number } }[];
}): boolean {
  return (
    Object.values(result.fields).some((field) => readWithOcr(result, field)) ||
    result.parts.some((part) => readWithOcr(result, part))
  );
}

/** Whether `page` lies in the result's page range (a result with no range has no page). */
function inRange(range: [number, number] | null, page: number): boolean {
  return range !== null && page >= range[0] && page <= range[1];
}

export const ExtractionResultSchema = z
  .object({
    v: z.literal(1),
    engineVersion: NonEmptyString,
    /** SHA-256 of the file, lowercase hexadecimal. */
    fileHash: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: NonEmptyString,
    pages: z.int().min(0),
    /**
     * The pages (from 1, both included) this result was read from; `null` only for a file that
     * could not be read (`pages` 0). `source.page` and `ocrPages` stay inside it.
     */
    pageRange: z.tuple([z.int().min(1), z.int().min(1)]).nullable(),
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
    /** The profile's `kind`, or `unknown` when no profile recognised the document. */
    documentKind: DocumentKindSchema,
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
    parts: z.array(
      z.object({
        label: z.string(),
        amount: CentsSchema,
        source: SourceSchema,
        /** The property the part refers to, as written in the notice. */
        property: z
          .object({
            address: z.string(),
            sheet: z.string().optional(),
            parcel: z.string().optional(),
            sub: z.string().optional(),
          })
          .optional(),
      }),
    ),
    identifiers: z.array(z.object({ kind: IdentifierKindSchema, value: NonEmptyString })),
    /** Checks made by the extractor, e.g. the total equals the sum of the items. */
    checks: z.array(z.object({ code: NonEmptyString, ok: z.boolean(), message: z.string() })),
    /** Notes that do not change the status. */
    warnings: z.array(z.string()),
    /** Where the text comes from: the PDF's own text layer, OCR of scanned pages, or both. */
    textSource: z.enum(['pdf', 'ocr', 'mixed']),
    /** Pages (from 1, as `source.page`) read with OCR; none when `textSource` is `pdf`. */
    ocrPages: z.array(z.int().min(1)),
  })
  .refine(
    (result) =>
      result.pageRange === null
        ? result.pages === 0
        : result.pageRange[0] <= result.pageRange[1] && result.pageRange[1] <= result.pages,
    { message: 'The page range is null only for an unreadable file and lies inside the file.' },
  )
  .refine(
    (result) =>
      [
        ...Object.values(result.fields).map((field) => field?.source),
        ...result.parts.map((part) => part.source),
      ].every((source) => !source || inRange(result.pageRange, source.page)) &&
      result.ocrPages.every((page) => inRange(result.pageRange, page)),
    { message: 'Every source page and OCR page lies inside the page range.' },
  )
  .refine(
    (result) =>
      result.documentKind === (result.profileId === null ? 'unknown' : (result.kind ?? 'unknown')),
    { message: 'The document kind is the profile kind, or unknown without a profile.' },
  )
  .refine((result) => result.textSource !== 'pdf' || result.ocrPages.length === 0, {
    message: 'A result whose text is all from the PDF has no page read with OCR.',
  })
  .refine(
    (result) =>
      result.textSource !== 'ocr' ||
      (result.status !== 'riconosciuta' &&
        Object.values(result.fields).every(
          (field) => field === undefined || field.confidence !== 'high',
        )),
    { message: 'A scanned result is never riconosciuta and has no field with confidence high.' },
  )
  .refine(
    (result) =>
      Object.values(result.fields).every(
        (field) =>
          field === undefined || field.confidence !== 'high' || !readWithOcr(result, field),
      ) &&
      (result.status !== 'riconosciuta' || !hasOcrReading(result)),
    {
      message:
        'A field read from a page with OCR is never high, and a result with a field or a part read so is never riconosciuta.',
    },
  )
  .meta({
    description:
      'What the extractor prints for one PDF. fileHash is lowercase hexadecimal; a PDF without ' +
      'text has status "senza-testo" and no fields.',
  });
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
