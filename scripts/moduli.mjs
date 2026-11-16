// The forms of section 26 from the command line (plan 12, R233):
// `pnpm moduli --cartella <dir> --tipo <modulo> --presenza <id> --modello <file.docx>
// [--valori <file.json>] [--oggi <AAAA-MM-GG>] [--uscita <file.docx>]` fills the owners' template
// with the data of the tenancy and the values of the file; without `--uscita` the document goes to
// `moduleFilePath` under `--cartella`. `pnpm moduli --vuoto --tipo <modulo> --uscita <file.docx>`
// writes the starter template. Never over an existing file (R156).
//
// The output is one JSON line with a status, counts, ids and field names: never a value, a name or
// a path (the default path holds the tenant's name). Exit codes (R107): 0 written, 1 refused,
// 2 arguments not valid, 3 an unexpected failure.

import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { FsStore } from '../packages/store-fs/src/fs-store.ts';
import {
  DOCX_LIMITS,
  ISODateSchema,
  MODULE_KINDS,
  generateModule,
  loadModuleData,
  moduleFilePath,
  starterDocx,
} from '../packages/core/src/index.ts';
import {
  Stop,
  checkDefaultFolders,
  invalid,
  outputPath,
  pathExists,
  rejected,
  writeNew,
} from './output-file.mjs';

const MESSAGES = {
  'bad-arguments': `Argomenti non validi: servono --cartella, --tipo, --presenza e --modello (--valori, --oggi e --uscita facoltativi), oppure --vuoto, --tipo e --uscita. Tipi: ${MODULE_KINDS.join(', ')}.`,
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-output':
    'Il file di uscita non è valido: serve un nome .docx ammesso, in una cartella che esiste.',
  'bad-template-file': 'Il modello non si legge: serve un file .docx che esiste.',
  'bad-values':
    'Il file dei valori non è valido: serve un oggetto JSON con un testo per ogni campo (nomi in minuscole, cifre e _).',
  'file-exists': 'Rifiutato: il file di uscita esiste già e non si sovrascrive.',
  'bad-default-folder':
    'Rifiutato: nel percorso predefinito c’è un collegamento o un file al posto di una cartella: usare --uscita.',
  'link-unsupported':
    'Rifiutato: la cartella di uscita non permette di scrivere il file senza rischiare di sovrascriverlo.',
  'inconsistent-store':
    'Rifiutato: i dati non sono come li lascia il registro: eseguire «pnpm estratti ripara».',
  'unknown-tenancy': 'Rifiutato: presenza sconosciuta.',
  'unknown-apartment': 'Rifiutato: l’appartamento della presenza non esiste.',
  'unknown-tenant': 'Rifiutato: l’inquilino della presenza non ha un’anagrafica.',
  'ambiguous-contract': 'Rifiutato: la presenza è collegata a due contratti vivi.',
  'bad-template': 'Rifiutato: il modello non è un file Word (.docx) che l’app sa leggere.',
  'bad-placeholder':
    'Rifiutato: nel modello c’è un segnaposto con un nome non valido (solo minuscole, cifre e _).',
  'unclosed-placeholder': 'Rifiutato: nel modello c’è un «{{» senza «}}» nello stesso paragrafo.',
  'unknown-fields': 'Rifiutato: nel modello ci sono segnaposto che questo modulo non conosce.',
  'unknown-values':
    'Rifiutato: nel file dei valori ci sono chiavi che questo modulo non conosce (se ne indica solo il numero).',
  'template-too-large': 'Il modello è troppo grande per un modulo.',
  'no-tenant-folder':
    'Rifiutato: dal nome dell’inquilino non si ricava una cartella: usare --uscita.',
  'unfilled-elsewhere':
    'Rifiutato: nel modello c’è un «{{» fuori dal testo che l’app riempie (commenti, proprietà, grafici o codici di campo).',
  'field-from-app':
    'Rifiutato: questi campi vengono dalla scheda e non si danno nel file dei valori.',
  'missing-fields': 'Rifiutato: mancano i valori di questi campi: aggiungerli al file dei valori.',
  'bad-value': 'Rifiutato: il valore di questi campi ha caratteri non ammessi.',
  failed: 'Operazione non riuscita: ripetere il comando.',
};

const inflateRaw = (data, maxOutputLength) => inflateRawSync(data, { maxOutputLength });

function readValues(path) {
  if (path === undefined) return {};
  let values;
  try {
    values = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw invalid('bad-values');
  }
  const ok =
    typeof values === 'object' &&
    values !== null &&
    !Array.isArray(values) &&
    // A key that is not a field name could be a value put in its place: never echoed back.
    Object.entries(values).every(([k, v]) => /^[a-z0-9_]+$/.test(k) && typeof v === 'string');
  if (!ok) throw invalid('bad-values');
  return values;
}

function readTemplate(path) {
  let size;
  try {
    if (!path.toLowerCase().endsWith('.docx')) throw new Error('not a docx');
    size = statSync(path).size;
  } catch {
    throw invalid('bad-template-file');
  }
  if (size > DOCX_LIMITS.templateBytes) throw invalid('template-too-large');
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    throw invalid('bad-template-file');
  }
}

/**
 * Runs one command line; returns the exit code and the JSON line. `io.newId` names the temporary
 * file, `io.link` is `linkSync`, `io.today` gives today's date when `--oggi` is absent.
 */
export async function main(
  argv,
  io = { newId: randomUUID, link: linkSync, today: () => new Date().toISOString().slice(0, 10) },
) {
  const done = (code, body) => ({ code, output: `${JSON.stringify(body)}\n` });
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          cartella: { type: 'string' },
          tipo: { type: 'string' },
          presenza: { type: 'string' },
          modello: { type: 'string' },
          valori: { type: 'string' },
          oggi: { type: 'string' },
          uscita: { type: 'string' },
          vuoto: { type: 'boolean' },
        },
        allowPositionals: false,
        strict: true,
      }));
    } catch {
      throw invalid('bad-arguments');
    }
    const kind = values.tipo;
    if (!MODULE_KINDS.includes(kind) || values.uscita === '') throw invalid('bad-arguments');

    if (values.vuoto === true) {
      const others = ['cartella', 'presenza', 'modello', 'valori', 'oggi'];
      if (values.uscita === undefined || others.some((k) => values[k] !== undefined)) {
        throw invalid('bad-arguments');
      }
      const target = outputPath(values.uscita, '.docx');
      if (pathExists(target.file)) throw rejected('file-exists');
      const bytes = starterDocx(kind);
      writeNew(target.file, target.folder, bytes, io);
      return done(0, { status: 'written', kind });
    }

    if (!['cartella', 'presenza', 'modello'].every((k) => values[k])) {
      throw invalid('bad-arguments');
    }
    const today = values.oggi ?? io.today();
    if (!ISODateSchema.safeParse(today).success) throw invalid('bad-arguments');
    try {
      if (!statSync(values.cartella).isDirectory()) throw new Error('not a folder');
    } catch {
      throw invalid('bad-folder');
    }
    let target = values.uscita === undefined ? undefined : outputPath(values.uscita, '.docx');
    if (target !== undefined && pathExists(target.file)) throw rejected('file-exists');
    const template = readTemplate(values.modello);
    const supplied = readValues(values.valori);

    const loaded = await loadModuleData(new FsStore(values.cartella), {
      tenancyId: values.presenza,
    });
    if (loaded.status !== 'ok') throw rejected(loaded.reason);
    const result = generateModule({
      kind,
      template,
      data: loaded.data,
      supplied,
      today,
      inflateRaw,
    });
    if (result.status !== 'ok') {
      throw rejected(
        result.reason,
        result.reason === 'unknown-values' ? { count: result.count } : { fields: result.fields },
      );
    }

    if (target === undefined) {
      const path = moduleFilePath(loaded.data.apartment, loaded.data.tenant, kind, today);
      if (path === undefined) throw rejected('no-tenant-folder');
      const file = join(values.cartella, ...path.split('/'));
      target = { file, folder: dirname(file) };
      checkDefaultFolders(values.cartella, file);
      if (pathExists(file)) throw rejected('file-exists');
      mkdirSync(target.folder, { recursive: true });
    }
    writeNew(target.file, target.folder, result.bytes, io);
    return done(0, {
      status: 'written',
      kind,
      tenancyId: loaded.data.tenancy.id,
      fields: result.fields,
      appFields: result.appFields,
      askedFields: result.askedFields,
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
