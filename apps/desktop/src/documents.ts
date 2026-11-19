/**
 * The generated documents from the app (plan 26): the Excel of a settlement (tenants' or owners'
 * file), the file for the commercialista and the forms filled from the owners' Word templates,
 * with the same bytes as `pnpm excel` and `pnpm moduli`. The core builds them
 * (`commands/documents.ts`); they go to their default path inside the picked folder, through
 * `TauriStore`, never over an existing file. No screen calls them yet.
 *
 * Results carry reason codes and fields, never the command line's `message` (R387, R405).
 */
import {
  CommandStop,
  DOCX_LIMITS,
  commandRefusal,
  conguaglioExcelCommand,
  inflateAhead,
  moduleCommand,
  refuseNewerData,
  suppliedValues,
  taxExcelCommand,
} from '@bollette/core';
import type { BuiltDocument, ModuleKind, PreparedDocument } from '@bollette/core';
import type { TauriStore } from './tauri-store';

/** Why a document was not written. */
export const DOCUMENT_REFUSAL_REASONS = [
  // Writing (R403, R406) and the data folder.
  'newer-data',
  'file-exists',
  'bad-default-folder',
  'write-interrupted',
  'bad-arguments',
  'inconsistent-store',
  'file-access',
  'inconsistent-record',
  'unreadable-records',
  // Excel.
  'unknown-apartment',
  'unknown-period',
  'ambiguous-period',
  'bad-periods',
  'missing-tenant',
  'settlement-input',
  // Forms.
  'bad-template-file',
  'template-too-large',
  'bad-values',
  'unknown-tenancy',
  'unknown-tenant',
  'ambiguous-contract',
  'bad-template',
  'bad-placeholder',
  'unclosed-placeholder',
  'unknown-fields',
  'unknown-values',
  'unfilled-elsewhere',
  'field-from-app',
  'advance-without-note',
  'missing-fields',
  'bad-value',
  'no-tenant-folder',
] as const;
export type DocumentRefusalReason = (typeof DOCUMENT_REFUSAL_REASONS)[number];

export type DocumentResult =
  /** `path` is relative to the picked folder (NFC); the other fields are counts and ids. */
  | { status: 'written'; path: string; [field: string]: unknown }
  /**
   * Fields: ids, field names or counts (`tenantIds`, `fields`, `count`, `paths`, ...);
   * `write-interrupted` gives in `paths` the partial file to delete.
   */
  | { status: 'rejected' | 'invalid'; reason: DocumentRefusalReason; [field: string]: unknown }
  | { status: 'failed'; reason: 'failed' };

const rejected = (reason: DocumentRefusalReason, extra?: Record<string, unknown>) =>
  new CommandStop('rejected', reason, extra);
const invalid = (reason: DocumentRefusalReason) => new CommandStop('invalid', reason);

/** A reason or status this file does not list is a failure: a screen never meets an unknown one. */
const known = (result: { status: unknown; reason: unknown }) =>
  (result.status === 'rejected' || result.status === 'invalid') &&
  (DOCUMENT_REFUSAL_REASONS as readonly unknown[]).includes(result.reason);

const FAILED: DocumentResult = { status: 'failed', reason: 'failed' };

async function run(task: () => Promise<DocumentResult>): Promise<DocumentResult> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof CommandStop) {
      const result = { ...error.extra, status: error.status, reason: error.reason };
      return known(result) ? (result as DocumentResult) : FAILED;
    }
    const refusal = commandRefusal(error);
    if (refusal !== undefined) {
      delete refusal.message;
      const result = refusal as { status: unknown; reason: unknown };
      return known(result) ? (result as DocumentResult) : FAILED;
    }
    // Never the error's message: it could hold a path or a value.
    return FAILED;
  }
}

async function write(store: TauriStore, path: string, { bytes, body }: BuiltDocument) {
  const outcome = await store.writeNewFile(path, bytes);
  if (outcome === 'write-interrupted') throw rejected(outcome, { paths: [path.normalize('NFC')] });
  if (outcome !== 'written') throw rejected(outcome);
  return { ...body, status: 'written' as const, path: path.normalize('NFC') };
}

/** As the command line: the default path is checked before the file is built. */
async function writePrepared(store: TauriStore, { path, build }: PreparedDocument) {
  const problem = await store.newFileProblem(path);
  if (problem !== undefined) throw rejected(problem);
  return write(store, path, build());
}

/**
 * The Excel of the settlement of one apartment and one period
 * (`<Appartamento>/<periodo>/Excel/Conguaglio_…xlsx`), or with `owners` the owners' file.
 */
export function writeConguaglioExcel(
  store: TauriStore,
  args: { apartmentId: string; periodLabel: string; owners?: boolean },
): Promise<DocumentResult> {
  return run(async () => {
    await refuseNewerData(store);
    return writePrepared(store, await conguaglioExcelCommand(store, args));
  });
}

/** The file for the commercialista of `year` (`AAAA`). */
export function writeTaxExcel(store: TauriStore, args: { year: string }): Promise<DocumentResult> {
  return run(async () => {
    await refuseNewerData(store);
    return writePrepared(store, await taxExcelCommand(store, args));
  });
}

/**
 * Raw deflate with `DecompressionStream` (R404), never more than `maxOutputLength` bytes: the
 * webview has no `node:zlib`.
 */
export async function inflateRawStream(
  data: Uint8Array,
  maxOutputLength: number,
): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // A broken stream rejects these too: the reader below reports it.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOutputLength) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError('Inflated data too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * A form of `kind` for the tenancy `tenancyId`, from the Word template at `templatePath` (relative
 * to the picked folder), to `<Appartamento>/Contratti/<Inquilino>/<AAAA-MM-GG>_<modulo>.docx`.
 * `values` are the fields the app does not know; `today` (`AAAA-MM-GG`) is the caller's clock.
 */
export function writeModulo(
  store: TauriStore,
  args: {
    kind: ModuleKind;
    tenancyId: string;
    templatePath: string;
    values?: Record<string, string>;
    today: string;
  },
): Promise<DocumentResult> {
  return run(async () => {
    await refuseNewerData(store);
    if (!args.templatePath.toLowerCase().endsWith('.docx')) throw invalid('bad-template-file');
    let template: Uint8Array;
    try {
      template = await store.readBytes(args.templatePath);
    } catch {
      throw invalid('bad-template-file');
    }
    // R407: after the read; checking before would need the `fs:allow-stat` permission.
    if (template.length > DOCX_LIMITS.templateBytes) throw invalid('template-too-large');
    const supplied = suppliedValues(args.values ?? {});
    const result = await moduleCommand(store, {
      kind: args.kind,
      tenancyId: args.tenancyId,
      template,
      supplied,
      today: args.today,
      inflateRaw: await inflateAhead(template, inflateRawStream),
    });
    if (result.path === undefined) throw rejected('no-tenant-folder');
    return write(store, result.path, result);
  });
}
