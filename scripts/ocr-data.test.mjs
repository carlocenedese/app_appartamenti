import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_DATA, OCR_DATA_DIR, bundleOcrData, fetchOcrData } from './ocr-data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const MISMATCH = "Il file dei dati della lingua non corrisponde all'impronta attesa.";
let dir;
let source;
let sha256;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ocr-data-'));
  source = join(dir, 'sorgente.traineddata');
  writeFileSync(source, 'dati della lingua finti');
  sha256 = createHash('sha256').update('dati della lingua finti').digest('hex');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fetchOcrData', () => {
  it('copies a local source whose SHA-256 matches, leaving exactly one file', async () => {
    const dest = join(dir, 'dest');
    const path = await fetchOcrData(dest, source, sha256);
    expect(path).toBe(join(dest, 'ita.traineddata'));
    expect(readdirSync(dest)).toEqual(['ita.traineddata']);
    expect(readFileSync(path, 'utf8')).toBe('dati della lingua finti');
  });

  it('throws the Italian message on a wrong SHA-256 and leaves no file', async () => {
    const dest = join(dir, 'dest');
    await expect(fetchOcrData(dest, source, '0'.repeat(64))).rejects.toThrow(MISMATCH);
    expect(existsSync(dest) ? readdirSync(dest) : []).toEqual([]);
  });

  it('throws a clear Italian error when the local source is missing', async () => {
    await expect(fetchOcrData(join(dir, 'dest'), join(dir, 'manca'), sha256)).rejects.toThrow(
      'Il file dei dati della lingua non è stato trovato.',
    );
  });

  it('pins tessdata_fast 4.1.0 with the hash of docs/rules/ocr-licenze.md', () => {
    expect(OCR_DATA.url).toBe(
      'https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/ita.traineddata',
    );
    expect(OCR_DATA.sha256).toBe(
      'b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827',
    );
    expect(readFileSync(join(root, 'docs', 'rules', 'ocr-licenze.md'), 'utf8')).toContain(
      OCR_DATA.sha256,
    );
  });
});

describe('bundleOcrData', () => {
  it('puts the language data into resources/ocr-data/ on macOS', async () => {
    const repo = join(dir, 'repo');
    await bundleOcrData(repo, 'darwin', source, sha256);
    expect(readdirSync(join(repo, OCR_DATA_DIR))).toEqual(['ita.traineddata']);
  });

  it('stops the build when the data cannot be fetched', async () => {
    await expect(
      bundleOcrData(join(dir, 'repo'), 'darwin', join(dir, 'manca'), sha256),
    ).rejects.toThrow('Il file dei dati della lingua non è stato trovato.');
  });

  it('on Windows fetches nothing and leaves a placeholder so that Tauri finds the folder', async () => {
    const repo = join(dir, 'repo');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await bundleOcrData(repo, 'win32', join(dir, 'manca'), sha256);
    expect(log).toHaveBeenCalledWith('OCR non incluso su Windows (rimandato)');
    log.mockRestore();
    expect(readdirSync(join(repo, OCR_DATA_DIR))).toEqual(['LEGGIMI.txt']);
  });
});

describe('tauri.conf.json', () => {
  it('bundles the OCR language data', () => {
    const conf = JSON.parse(
      readFileSync(join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
    );
    expect(conf.bundle.resources['resources/ocr-data/']).toBe('ocr-data/');
  });
});
