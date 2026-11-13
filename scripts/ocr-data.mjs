// The language data of the OCR engine: ita.traineddata of tesseract-ocr/tessdata_fast, tag 4.1.0
// (Apache-2.0, docs/rules/ocr-licenze.md), checked against its SHA-256 and put into
// apps/desktop/src-tauri/resources/ocr-data/ (bundled by tauri.conf.json, next to python/).
// OCR ships on macOS only for now (decision of 13 November 2026): on Windows the folder holds
// just a note, so that the resource entry of tauri.conf.json still finds it.
// Only Node built-ins: no npm dependencies.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Destination, relative to the root of the repository. */
export const OCR_DATA_DIR = join('apps', 'desktop', 'src-tauri', 'resources', 'ocr-data');

export const OCR_DATA = {
  url: 'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/ita.traineddata',
  sha256: 'b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827',
};

const FILE_NAME = 'ita.traineddata';

async function readSource(source) {
  if (source.startsWith('https://')) {
    const response = await fetch(source, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Download dei dati della lingua non riuscito: HTTP ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  if (!existsSync(source)) {
    throw new Error('Il file dei dati della lingua non è stato trovato.');
  }
  return readFileSync(source);
}

/**
 * Reads `source` (an https:// address or a local path), checks its SHA-256 and only then writes
 * it as destDir/ita.traineddata; returns that path. Never leaves a partial or unchecked file.
 */
export async function fetchOcrData(destDir, source, sha256) {
  const bytes = await readSource(source);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
    throw new Error("Il file dei dati della lingua non corrisponde all'impronta attesa.");
  }
  mkdirSync(destDir, { recursive: true });
  const target = join(destDir, FILE_NAME);
  const partial = `${target}.parziale`;
  try {
    writeFileSync(partial, bytes);
    renameSync(partial, target);
  } finally {
    rmSync(partial, { force: true });
  }
  return target;
}

/** Fills resources/ocr-data/ for `platform`: the checked data on macOS, a note on Windows. */
export async function bundleOcrData(
  root,
  platform = process.platform,
  source = OCR_DATA.url,
  sha256 = OCR_DATA.sha256,
) {
  const target = join(root, OCR_DATA_DIR);
  rmSync(target, { recursive: true, force: true });
  if (platform === 'win32') {
    console.log('OCR non incluso su Windows (rimandato)');
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, 'LEGGIMI.txt'),
      'OCR non incluso su Windows (rimandato): qui non ci sono dati della lingua.\n',
    );
    return;
  }
  const path = await fetchOcrData(target, source, sha256);
  if (!existsSync(path)) throw new Error("Mancano i dati della lingua per l'OCR.");
}
