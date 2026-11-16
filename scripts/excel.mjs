// The Excel of the settlement of one apartment and one period from the command line (plan 5,
// tasks 7 and 11): `pnpm excel --cartella <dir> --appartamento <id> --periodo <etichetta>
// [--uscita <file.xlsx>]`; without `--uscita` the file goes to `excelFilePath` under `--cartella`
// (question 7, R173). The core builds the file; this script opens the data folder with FsStore and
// writes the bytes through a temporary file in the same folder, linked to the output so that an
// existing file is never overwritten (section 6, R156).
//
// The output is one JSON line with a status, counts and ids: never a name, an amount or a path.
// Exit codes (R107): 0 written, 1 refused, 2 arguments not valid, 3 an unexpected failure.

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  EXCEL_SHEETS,
  ExcelInputError,
  SettlementInputError,
  assertSafeRelPath,
  buildConguaglioWorkbook,
  calcConguaglio,
  excelFilePath,
  excelItems,
  loadExcelInput,
  writeXlsx,
} from '../packages/core/src/index.ts';

const MESSAGES = {
  'bad-arguments':
    'Argomenti non validi: servono --cartella, --appartamento e --periodo (--uscita facoltativo).',
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-output':
    'Il file di uscita non è valido: serve un nome .xlsx ammesso, in una cartella che esiste.',
  'file-exists': 'Rifiutato: il file di uscita esiste già e non si sovrascrive.',
  'link-unsupported':
    'Rifiutato: la cartella di uscita non permette di scrivere il file senza rischiare di sovrascriverlo.',
  'inconsistent-store':
    'Rifiutato: i dati non sono come li lascia il registro: eseguire «pnpm estratti ripara».',
  'unknown-apartment': 'Rifiutato: appartamento sconosciuto.',
  'unknown-period': 'Rifiutato: nessun periodo di conguaglio con questa etichetta.',
  'ambiguous-period': 'Rifiutato: due contratti danno periodi diversi con questa etichetta.',
  'missing-tenant': 'Rifiutato: un inquilino del periodo non ha un’anagrafica.',
  'settlement-input': 'Rifiutato: le presenze o le rate non permettono il conguaglio.',
  failed: 'Operazione non riuscita: ripetere il comando.',
};

class Stop extends Error {
  constructor(status, reason, extra = {}) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.extra = extra;
  }
}
const invalid = (reason) => new Stop('invalid', reason);
const rejected = (reason, extra) => new Stop('rejected', reason, extra);

/** Checks the output path; returns it with the file name in NFC. */
function outputPath(raw) {
  const name = basename(raw).normalize('NFC');
  const folder = dirname(raw);
  try {
    if (raw.endsWith('/') || raw.endsWith(sep)) throw new Error('a folder');
    if (!name.toLowerCase().endsWith('.xlsx') || name.length === '.xlsx'.length) {
      throw new Error('not a name');
    }
    assertSafeRelPath(name);
    if (!statSync(folder).isDirectory()) throw new Error('not a folder');
  } catch {
    throw invalid('bad-output');
  }
  return { file: join(folder, name), folder };
}

/** Errors of a folder (or disk) that has no hard links: refused, never a plain overwrite. */
const NO_LINK = ['EPERM', 'ENOTSUP', 'EXDEV', 'EOPNOTSUPP'];

/** Writes `bytes` to `file` only if it does not exist: a temporary file, then a hard link. */
function writeNew(file, folder, bytes, { newId, link }) {
  const temporary = join(folder, `.tmp-${newId()}.xlsx`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    link(temporary, file);
  } catch (error) {
    if (error?.code === 'EEXIST' && existsSync(file)) throw rejected('file-exists');
    if (NO_LINK.includes(error?.code)) throw rejected('link-unsupported');
    throw error;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing was written.
    }
  }
}

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
        },
        allowPositionals: false,
        strict: true,
      }));
    } catch {
      throw invalid('bad-arguments');
    }
    if (['cartella', 'appartamento', 'periodo'].some((k) => !values[k]) || values.uscita === '') {
      throw invalid('bad-arguments');
    }
    try {
      if (!statSync(values.cartella).isDirectory()) throw new Error('not a folder');
    } catch {
      throw invalid('bad-folder');
    }
    let target = values.uscita === undefined ? undefined : outputPath(values.uscita);
    if (target !== undefined && existsSync(target.file)) throw rejected('file-exists');

    const loaded = await loadExcelInput(new FsStore(values.cartella), {
      apartmentId: values.appartamento,
      periodLabel: values.periodo,
    });
    if (loaded.status !== 'ok') throw rejected(loaded.reason);
    if (target === undefined) {
      const file = join(
        values.cartella,
        ...excelFilePath(loaded.input.apartment, loaded.input.period).split('/'),
      );
      target = { file, folder: dirname(file) };
      if (existsSync(file)) throw rejected('file-exists');
    }
    const { file, folder } = target;
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
        throw rejected('settlement-input', { code: error.code });
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
