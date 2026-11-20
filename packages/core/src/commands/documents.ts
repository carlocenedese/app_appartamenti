// The generated documents (plan 26, R402): what `scripts/excel.mjs` and `scripts/moduli.mjs` did
// after reading their options, reachable from the app through any `Store`. The bytes are built as
// before; writing them stays with the caller (`node:fs` or the Tauri file plugin).
import { calcConguaglio, SettlementInputError } from '../conguaglio';
import type { InflateRaw } from '../docx';
import type { ISODate } from '../period';
import {
  EXCEL_SHEETS,
  ExcelInputError,
  buildConguaglioWorkbook,
  excelFilePath,
  excelItems,
} from '../excel';
import { buildOwnersWorkbook, ownersFilePath, ownersItems } from '../excel-owners';
import { loadExcelInput } from '../excel-store';
import { ISODateSchema, YearSchema } from '../model';
import { loadModuleData } from '../module-store';
import { MODULE_KINDS, generateModule, moduleFilePath } from '../modules';
import type { ModuleKind } from '../modules';
import { WORKSPACE_PATH } from '../store/store';
import type { Store } from '../store/store';
import { buildTaxWorkbook, taxFilePath } from '../taxes';
import { loadTaxExport } from '../tax-store';
import { DATA_FORMAT } from '../version';
import { writeXlsx } from '../xlsx-write';
import { CommandStop, invalidCommand } from './stop';

const rejected = (reason: string, extra?: Record<string, unknown>) =>
  new CommandStop('rejected', reason, extra);

/** The bytes of a document and the body of its result. */
export interface BuiltDocument {
  bytes: Uint8Array;
  body: Record<string, unknown>;
}

/** A loaded document: its default path (relative, NFC) and the build, which may still refuse. */
export interface PreparedDocument {
  path: string;
  build: () => BuiltDocument;
}

/**
 * Refuses a folder written by a newer app (review of 18 Nov 2026): a document built without the
 * record kinds this app does not know would be wrong with no notice. The raw file is read, since
 * a newer workspace file may not fit this app's schema; a file that cannot be read stops nothing.
 */
export async function refuseNewerData(store: Store): Promise<void> {
  const workspace = (await store.readJson(WORKSPACE_PATH).catch(() => undefined)) as
    { schemaVersion?: unknown } | undefined;
  const version = workspace?.schemaVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version > DATA_FORMAT) {
    throw rejected('newer-data');
  }
}

/** The day of «Generato il» (R408), from the caller's clock: `bad-arguments` if not `AAAA-MM-GG`. */
function generationDay(today: string): ISODate {
  const day = ISODateSchema.safeParse(today);
  if (!day.success) throw invalidCommand('bad-arguments');
  return day.data;
}

/**
 * The Excel of one apartment and one period (plan 5), or the owners' file with `owners` (plan 5b,
 * R175), dated `today`. Refused: `bad-periods` (E6), the refusals of `loadExcelInput`, and in
 * `build()` `missing-tenant` and `settlement-input` (tenants' file only).
 */
export async function conguaglioExcelCommand(
  store: Store,
  input: { apartmentId: string; periodLabel: string; owners?: boolean; today: string },
): Promise<PreparedDocument> {
  const generatedOn = generationDay(input.today);
  let loaded;
  try {
    loaded = await loadExcelInput(store, {
      apartmentId: input.apartmentId,
      periodLabel: input.periodLabel,
    });
  } catch (error) {
    // E6: only the periods that cannot be built (a lease year not from day 1, period.ts).
    if (error instanceof RangeError && error.message.startsWith('Settlement periods are whole')) {
      throw rejected('bad-periods');
    }
    throw error;
  }
  if (loaded.status !== 'ok') throw rejected(loaded.reason);
  const excel = loaded.input;
  const head = { status: 'written', apartmentId: excel.apartment.id, period: excel.period.label };
  if (input.owners === true) {
    return {
      path: ownersFilePath(excel.apartment, excel.period),
      build: () => {
        // No tenancy is read, so no settlement refusal.
        const workbook = buildOwnersWorkbook(excel, generatedOn);
        const items = ownersItems(excel);
        return {
          bytes: writeXlsx(workbook),
          body: {
            ...head,
            sheets: workbook.sheets.length,
            items: items.length,
            pending: items.filter((i) =>
              ['in-attesa', 'importo-diverso', 'duplicato'].includes(i.status),
            ).length,
          },
        };
      },
    };
  }
  return {
    path: excelFilePath(excel.apartment, excel.period),
    build: () => {
      let result;
      let workbook;
      try {
        result = calcConguaglio(excel);
        workbook = buildConguaglioWorkbook(excel, generatedOn);
      } catch (error) {
        if (error instanceof ExcelInputError) {
          throw rejected('missing-tenant', { tenantIds: error.tenantIds });
        }
        if (error instanceof SettlementInputError) {
          // I5: the ids of the rates to correct (ids only, no amount).
          throw rejected('settlement-input', {
            code: error.code,
            ...(error.instalmentIds === undefined ? {} : { instalmentIds: error.instalmentIds }),
          });
        }
        throw error;
      }
      return {
        bytes: writeXlsx(workbook),
        body: {
          ...head,
          sheets: EXCEL_SHEETS.length,
          tenants: result.tenants.length,
          items: excelItems(excel, result).length,
          pending: result.pending.length,
        },
      };
    },
  };
}

/** The file for the commercialista of `year` (plan 10, R215), dated `today`: every live apartment and contract. */
export async function taxExcelCommand(
  store: Store,
  input: { year: string; today: string },
): Promise<PreparedDocument> {
  if (!YearSchema.safeParse(input.year).success) throw invalidCommand('bad-arguments');
  const generatedOn = generationDay(input.today);
  const loaded = await loadTaxExport(store);
  if (loaded.status !== 'ok') throw rejected(loaded.reason);
  return {
    path: taxFilePath(input.year),
    build: () => {
      const workbook = buildTaxWorkbook(loaded, generatedOn);
      return {
        bytes: writeXlsx(workbook),
        body: {
          status: 'written',
          year: input.year,
          sheets: workbook.sheets.length,
          apartments: loaded.apartments.length,
          contracts: loaded.contracts.length,
        },
      };
    },
  };
}

/**
 * The values of the fields the app does not know: an object of texts with field names as keys
 * (`bad-values` otherwise; a key that is not a field name could be a value, never echoed back).
 */
export function suppliedValues(values: unknown): Record<string, string> {
  const ok =
    typeof values === 'object' &&
    values !== null &&
    !Array.isArray(values) &&
    Object.entries(values).every(([k, v]) => /^[a-z0-9_]+$/.test(k) && typeof v === 'string');
  if (!ok) throw invalidCommand('bad-values');
  return values as Record<string, string>;
}

/**
 * A form of section 26 (plan 12, R233) from the owners' `template`. `path` is the default one,
 * `undefined` when the tenant's name gives no folder (the caller refuses `no-tenant-folder` or
 * writes elsewhere). Refused: the refusals of `loadModuleData` and of `generateModule`.
 */
export async function moduleCommand(
  store: Store,
  input: {
    kind: ModuleKind;
    tenancyId: string;
    template: Uint8Array;
    supplied: Record<string, string>;
    today: string;
    inflateRaw: InflateRaw;
  },
): Promise<{ bytes: Uint8Array; path: string | undefined; body: Record<string, unknown> }> {
  const today = ISODateSchema.safeParse(input.today);
  if (!MODULE_KINDS.includes(input.kind) || !today.success) throw invalidCommand('bad-arguments');
  const loaded = await loadModuleData(store, { tenancyId: input.tenancyId });
  if (loaded.status !== 'ok') throw rejected(loaded.reason);
  const result = generateModule({
    kind: input.kind,
    template: input.template,
    data: loaded.data,
    supplied: input.supplied,
    today: today.data,
    inflateRaw: input.inflateRaw,
  });
  if (result.status !== 'ok') {
    throw rejected(
      result.reason,
      result.reason === 'unknown-values'
        ? { count: result.count }
        : 'fields' in result
          ? { fields: result.fields }
          : {},
    );
  }
  return {
    bytes: result.bytes,
    path: moduleFilePath(loaded.data.apartment, loaded.data.tenant, input.kind, today.data),
    body: {
      status: 'written',
      kind: input.kind,
      tenancyId: loaded.data.tenancy.id,
      fields: result.fields,
      appFields: result.appFields,
      askedFields: result.askedFields,
    },
  };
}
