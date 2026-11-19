/**
 * The PDF reader of the app (plan 23): the Rust command `read_bill_pdf` runs the bundled
 * `python -I -m bollette_pdf extract` and gives its stdout; `parseExtractionResult` of the core
 * validates it, as the core's integration tests do. The result goes to `importBill` as it is.
 * No screen calls it yet (user1: the screens are not designed). The command comes in as a
 * `PdfReaderBackend`, so tests use a fake one.
 */
import { invoke } from '@tauri-apps/api/core';
import { parseExtractionResult } from '@bollette/core';
import type { ExtractionResult } from '@bollette/core';

/**
 * Absolute paths inside the folder the user picked (the command refuses any other): `pdf` the
 * file, `profiles` the folder of the profile records, `<folder>/_app/dati/supplierProfile`.
 * `at` is the ISO date(-time) of the reading, from the caller's clock; `pages` is `a-b`.
 */
export interface ReadBillPdfInput {
  pdf: string;
  profiles: string;
  at: string;
  pages?: string;
}

/** The command: resolves with the stdout of the reader, rejects with `{ code, message }`. */
export interface PdfReaderBackend {
  extract(input: ReadBillPdfInput): Promise<string>;
}

export const tauriPdfReaderBackend: PdfReaderBackend = {
  extract: (input) =>
    invoke<string>('read_bill_pdf', {
      pdf: input.pdf,
      profiles: input.profiles,
      at: input.at,
      pages: input.pages ?? null,
    }),
};

/** The codes of the Rust command (python_reader.rs), and `invalid-result` from the core. */
export const PDF_READER_ERROR_CODES = [
  'path-forbidden',
  'python-missing',
  'timeout',
  'output-too-large',
  'exit-code',
  'invalid-json',
  'internal',
  'invalid-result',
] as const;
export type PdfReaderErrorCode = (typeof PDF_READER_ERROR_CODES)[number];

/** Why a PDF could not be read; `message` is Italian and never holds a path or document text. */
export class PdfReaderError extends Error {
  constructor(
    readonly code: PdfReaderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfReaderError';
  }
}

const INTERNAL_MESSAGE = 'Errore interno: lettura non completata.';

/** A rejection of the command as a `PdfReaderError`; anything unexpected is `internal`. */
function readerError(error: unknown): PdfReaderError {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (
      typeof code === 'string' &&
      typeof message === 'string' &&
      (PDF_READER_ERROR_CODES as readonly string[]).includes(code)
    ) {
      return new PdfReaderError(code as PdfReaderErrorCode, message);
    }
  }
  // An unknown rejection could carry a path: only the constant message.
  return new PdfReaderError('internal', INTERNAL_MESSAGE);
}

/** Reads one PDF; the result is validated by the core. Rejects with a `PdfReaderError`. */
export async function readBillPdf(
  input: ReadBillPdfInput,
  backend: PdfReaderBackend = tauriPdfReaderBackend,
): Promise<ExtractionResult> {
  let text: string;
  try {
    text = await backend.extract(input);
  } catch (error) {
    throw readerError(error);
  }
  try {
    return parseExtractionResult(text);
  } catch (error) {
    throw new PdfReaderError('invalid-result', (error as Error).message);
  }
}
