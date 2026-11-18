// The Excel of the settlement of one apartment and one period from the command line (plan 5,
// tasks 7 and 11): `pnpm excel --cartella <dir> --appartamento <id> --periodo <etichetta>
// [--uscita <file.xlsx>] [--proprietari]`; without `--uscita` the file goes to `excelFilePath`
// under `--cartella` (question 7, R173). `--proprietari` writes the owners' file instead (plan 5b,
// R175), by default to `ownersFilePath` (R184). `--tasse <anno>` writes the file for the
// commercialista instead (plan 10, R215), by default to `taxFilePath`, with no apartment or
// period. The core builds the file; this script opens the data folder with FsStore and
// writes the bytes through a temporary file in the same folder, linked to the output so that an
// existing file is never overwritten (section 6, R156).
//
// The output is one JSON line with a status, counts and ids: never a name, an amount or a path.
// Exit codes (R107): 0 written, 1 refused, 2 arguments not valid, 3 an unexpected failure.

import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  EXCEL_SHEETS,
  ExcelInputError,
  SettlementInputError,
  YearSchema,
  buildConguaglioWorkbook,
  buildOwnersWorkbook,
  buildTaxWorkbook,
  calcConguaglio,
  excelFilePath,
  excelItems,
  loadExcelInput,
  loadTaxExport,
  ownersFilePath,
  ownersItems,
  taxFilePath,
  writeXlsx,
} from '../packages/core/src/index.ts';
import {
  Stop,
  checkDefaultFolders,
  invalid,
  outputPath,
  rejected,
  writeNew,
} from './output-file.mjs';

const MESSAGES = {
  'bad-arguments':
    'Argomenti non validi: servono --cartella, --appartamento e --periodo, oppure --cartella e --tasse <anno> (--uscita facoltativo).',
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-output':
    'Il file di uscita non è valido: serve un nome .xlsx ammesso, in una cartella che esiste.',
  'file-exists': 'Rifiutato: il file di uscita esiste già e non si sovrascrive.',
  'bad-default-folder':
    'Rifiutato: nel percorso predefinito c’è un collegamento o un file al posto di una cartella: usare --uscita.',
  'link-unsupported':
    'Rifiutato: la cartella di uscita non permette di scrivere il file senza rischiare di sovrascriverlo.',
  'inconsistent-store':
    'Rifiutato: i dati non sono come li lascia il registro: eseguire «pnpm estratti ripara».',
  'unknown-apartment': 'Rifiutato: appartamento sconosciuto.',
  'unknown-period': 'Rifiutato: nessun periodo di conguaglio con questa etichetta.',
  'ambiguous-period': 'Rifiutato: due contratti danno periodi diversi con questa etichetta.',
  'missing-tenant': 'Rifiutato: un inquilino del periodo non ha un’anagrafica.',
  'settlement-input': 'Rifiutato: le presenze o le rate non permettono il conguaglio.',
  'bad-periods':
    'Rifiutato: con i dati dell’appartamento non si costruiscono i periodi di conguaglio (per esempio un’annualità che non comincia il giorno 1): correggerli, ripetere non serve.',
  failed: 'Operazione non riuscita: ripetere il comando.',
};

/**
 * Runs one command line; returns the exit code and the JSON line. `io.newId` names the temporary
 * file, `io.link` is `linkSync` (replaced only by the tests).
 */
export async function main(argv, io = { newId: randomUUID, link: linkSync }) {
  const done = (code, body) => ({ code, output: `${JSON.stringify(body)}\n` });
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          cartella: { type: 'string' },
          appartamento: { type: 'string' },
          periodo: { type: 'string' },
          uscita: { type: 'string' },
          proprietari: { type: 'boolean' },
          tasse: { type: 'string' },
        },
        allowPositionals: false,
        strict: true,
      }));
    } catch {
      throw invalid('bad-arguments');
    }
    const taxes = values.tasse !== undefined;
    const argumentsValid = taxes
      ? Boolean(values.cartella) &&
        YearSchema.safeParse(values.tasse).success &&
        ['appartamento', 'periodo', 'proprietari'].every((k) => values[k] === undefined)
      : ['cartella', 'appartamento', 'periodo'].every((k) => values[k]);
    if (!argumentsValid || values.uscita === '') throw invalid('bad-arguments');
    try {
      if (!statSync(values.cartella).isDirectory()) throw new Error('not a folder');
    } catch {
      throw invalid('bad-folder');
    }
    let target = values.uscita === undefined ? undefined : outputPath(values.uscita, '.xlsx');
    if (target !== undefined && existsSync(target.file)) throw rejected('file-exists');

    if (taxes) {
      // Plan 10, R215: every live apartment and contract; names and codes stay in the file.
      const loaded = await loadTaxExport(new FsStore(values.cartella));
      if (loaded.status !== 'ok') throw rejected(loaded.reason);
      if (target === undefined) {
        const file = join(values.cartella, ...taxFilePath(values.tasse).split('/'));
        target = { file, folder: dirname(file) };
        checkDefaultFolders(values.cartella, file);
        if (existsSync(file)) throw rejected('file-exists');
      }
      const workbook = buildTaxWorkbook(loaded);
      if (values.uscita === undefined) mkdirSync(target.folder, { recursive: true });
      writeNew(target.file, target.folder, writeXlsx(workbook), io);
      return done(0, {
        status: 'written',
        year: values.tasse,
        sheets: workbook.sheets.length,
        apartments: loaded.apartments.length,
        contracts: loaded.contracts.length,
      });
    }

    let loaded;
    try {
      loaded = await loadExcelInput(new FsStore(values.cartella), {
        apartmentId: values.appartamento,
        periodLabel: values.periodo,
      });
    } catch (error) {
      // E6: only the periods that cannot be built (a lease year not from day 1, period.ts); any
      // other error stays a failure.
      if (error instanceof RangeError && error.message.startsWith('Settlement periods are whole')) {
        throw rejected('bad-periods');
      }
      throw error;
    }
    if (loaded.status !== 'ok') throw rejected(loaded.reason);
    if (target === undefined) {
      const file = join(
        values.cartella,
        ...(values.proprietari === true ? ownersFilePath : excelFilePath)(
          loaded.input.apartment,
          loaded.input.period,
        ).split('/'),
      );
      target = { file, folder: dirname(file) };
      checkDefaultFolders(values.cartella, file);
      if (existsSync(file)) throw rejected('file-exists');
    }
    const { file, folder } = target;
    if (values.proprietari === true) {
      // Plan 5b, R175: no tenancy is read, so no settlement refusal.
      const owners = buildOwnersWorkbook(loaded.input);
      if (values.uscita === undefined) mkdirSync(folder, { recursive: true });
      writeNew(file, folder, writeXlsx(owners), io);
      const items = ownersItems(loaded.input);
      return done(0, {
        status: 'written',
        apartmentId: loaded.input.apartment.id,
        period: loaded.input.period.label,
        sheets: owners.sheets.length,
        items: items.length,
        pending: items.filter((i) =>
          ['in-attesa', 'importo-diverso', 'duplicato'].includes(i.status),
        ).length,
      });
    }
    let workbook;
    let result;
    try {
      result = calcConguaglio(loaded.input);
      workbook = buildConguaglioWorkbook(loaded.input);
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
    // Only the default folder is created, and only once the file can be built.
    if (values.uscita === undefined) mkdirSync(folder, { recursive: true });
    writeNew(file, folder, writeXlsx(workbook), io);
    return done(0, {
      status: 'written',
      apartmentId: loaded.input.apartment.id,
      period: loaded.input.period.label,
      sheets: EXCEL_SHEETS.length,
      tenants: result.tenants.length,
      items: excelItems(loaded.input, result).length,
      pending: result.pending.length,
    });
  } catch (error) {
    if (error instanceof Stop) {
      return done(error.status === 'invalid' ? 2 : 1, {
        status: error.status,
        reason: error.reason,
        message: MESSAGES[error.reason],
        ...error.extra,
      });
    }
    // Never the message or the stack: they could hold a path or a value.
    return done(3, { status: 'failed', reason: 'failed', message: MESSAGES.failed });
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { code, output } = await main(process.argv.slice(2));
  process.stdout.write(output, () => process.exit(code));
}
