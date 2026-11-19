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
import { YearSchema, conguaglioExcelCommand, taxExcelCommand } from '../packages/core/src/index.ts';
import {
  Stop,
  checkDefaultFolders,
  NEWER_DATA_MESSAGE,
  invalid,
  outputPath,
  refuseNewerData,
  rejected,
  writeNew,
} from './output-file.mjs';

const MESSAGES = {
  'bad-arguments':
    'Argomenti non validi: servono --cartella, --appartamento e --periodo, oppure --cartella e --tasse <anno> (--uscita facoltativo); vedere «pnpm excel --help».',
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-output':
    'Il file di uscita non è valido: serve un nome .xlsx ammesso, in una cartella che esiste.',
  'file-exists': 'Rifiutato: il file di uscita esiste già e non si sovrascrive.',
  'newer-data': NEWER_DATA_MESSAGE,
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

/** The options of the command line; each one has a line in OPTION_HELP (Q9). */
export const OPTIONS = {
  cartella: { type: 'string' },
  appartamento: { type: 'string' },
  periodo: { type: 'string' },
  uscita: { type: 'string' },
  proprietari: { type: 'boolean' },
  tasse: { type: 'string' },
};

/** One line of help in Italian for each option (review of 18 Nov 2026, Q9). */
export const OPTION_HELP = {
  cartella: 'La cartella dei dati condivisa.',
  appartamento: 'L’identificativo dell’appartamento.',
  periodo: 'L’etichetta del periodo di conguaglio, per esempio 2025-26.',
  uscita: 'Il file .xlsx da scrivere (facoltativo: senza, il percorso predefinito).',
  proprietari: 'Scrive il file riservato ai proprietari invece di quello degli inquilini.',
  tasse: 'Scrive il file per il commercialista dell’anno indicato (senza appartamento e periodo).',
};

export const USAGE =
  'Uso: pnpm excel --cartella <dir> --appartamento <id> --periodo <etichetta> [--uscita <file.xlsx>] [--proprietari], oppure pnpm excel --cartella <dir> --tasse <anno>. Uscita: 0 scritto, 1 rifiutato, 2 argomenti non validi, 3 errore inatteso.';

/**
 * Runs one command line; returns the exit code and the JSON line. `io.newId` names the temporary
 * file, `io.link` is `linkSync` (replaced only by the tests).
 */
export async function main(argv, io = { newId: randomUUID, link: linkSync }) {
  const done = (code, body) => ({ code, output: `${JSON.stringify(body)}\n` });
  try {
    // Q9: the options with one line each; nothing is read or written.
    if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'aiuto') {
      return done(0, {
        status: 'help',
        message: USAGE,
        options: Object.keys(OPTIONS).map((option) => ({
          option: `--${option}`,
          description: OPTION_HELP[option],
        })),
      });
    }
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: OPTIONS,
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
    await refuseNewerData(new FsStore(values.cartella));
    let target = values.uscita === undefined ? undefined : outputPath(values.uscita, '.xlsx');
    if (target !== undefined && existsSync(target.file)) throw rejected('file-exists');

    const store = new FsStore(values.cartella);
    const prepared = taxes
      ? await taxExcelCommand(store, { year: values.tasse })
      : await conguaglioExcelCommand(store, {
          apartmentId: values.appartamento,
          periodLabel: values.periodo,
          owners: values.proprietari === true,
        });
    if (target === undefined) {
      const file = join(values.cartella, ...prepared.path.split('/'));
      target = { file, folder: dirname(file) };
      checkDefaultFolders(values.cartella, file);
      if (existsSync(file)) throw rejected('file-exists');
    }
    const { bytes, body } = prepared.build();
    // Only the default folder is created, and only once the file can be built.
    if (values.uscita === undefined) mkdirSync(target.folder, { recursive: true });
    writeNew(target.file, target.folder, bytes, io);
    return done(0, body);
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
