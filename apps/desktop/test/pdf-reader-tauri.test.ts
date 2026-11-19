import { describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { PdfReaderError, readBillPdf, tauriPdfReaderBackend } =
  await import('../src/pdf-reader-tauri');

// An invented reading: a scanned PDF without text, no data of anyone.
const reading = {
  v: 1,
  engineVersion: '0.1.0',
  fileHash: 'b'.repeat(64),
  fileName: 'scansione.pdf',
  pages: 2,
  pageRange: [1, 2],
  status: 'senza-testo',
  profileId: null,
  profileRev: null,
  kind: null,
  documentKind: 'unknown',
  category: null,
  fields: {},
  parts: [],
  identifiers: [],
  checks: [],
  warnings: [],
  textSource: 'pdf',
  ocrPages: [],
};

const input = {
  pdf: '/Cartella scelta/Appartamento A/Da_smistare/scansione.pdf',
  profiles: '/Cartella scelta/_app/dati/supplierProfile',
  at: '2026-11-19',
};

const fake = (extract: () => Promise<string>) => ({ extract: vi.fn(extract) });

describe('tauriPdfReaderBackend', () => {
  it('invokes read_bill_pdf with the paths, the date and the pages', async () => {
    tauri.invoke.mockResolvedValue('{}');
    expect(await tauriPdfReaderBackend.extract(input)).toBe('{}');
    expect(tauri.invoke).toHaveBeenLastCalledWith('read_bill_pdf', { ...input, pages: null });
    await tauriPdfReaderBackend.extract({ ...input, pages: '3-4' });
    expect(tauri.invoke).toHaveBeenLastCalledWith('read_bill_pdf', { ...input, pages: '3-4' });
  });
});

describe('readBillPdf', () => {
  it('gives the reading validated by the core', async () => {
    const backend = fake(() => Promise.resolve(`${JSON.stringify(reading)}\n`));
    const result = await readBillPdf(input, backend);
    expect(result.status).toBe('senza-testo');
    expect(result.fileName).toBe('scansione.pdf');
    expect(backend.extract).toHaveBeenCalledWith(input);
  });

  it('uses the Tauri command by default', async () => {
    tauri.invoke.mockResolvedValue(JSON.stringify(reading));
    expect((await readBillPdf(input)).pages).toBe(2);
  });

  it('passes on the code and the message of the command', async () => {
    const backend = fake(() =>
      Promise.reject({
        code: 'timeout',
        message: 'Lettura interrotta: nessuna risposta entro 60 s.',
      }),
    );
    const error = await readBillPdf(input, backend).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReaderError);
    expect(error).toMatchObject({
      code: 'timeout',
      message: 'Lettura interrotta: nessuna risposta entro 60 s.',
    });
  });

  it.each([
    ['a string', 'forbidden path: /Cartella scelta/segreto.pdf'],
    ['an unknown code', { code: 'other', message: '/Cartella scelta/segreto.pdf' }],
    ['null', null],
  ])('turns %s into internal, with no path', async (_, rejection) => {
    const error = await readBillPdf(
      input,
      fake(() => Promise.reject(rejection)),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'internal',
      message: 'Errore interno: lettura non completata.',
    });
  });

  it('refuses a reading the core does not accept, naming only the paths', async () => {
    const bad = JSON.stringify({ ...reading, fileName: 42, status: 'segreto' });
    const error = await readBillPdf(
      input,
      fake(() => Promise.resolve(bad)),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid-result' });
    expect((error as Error).message).toMatch(/fileName/);
    expect((error as Error).message).not.toMatch(/segreto/);
  });

  it('refuses text that is not JSON', async () => {
    const error = await readBillPdf(
      input,
      fake(() => Promise.resolve('non json')),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'invalid-result',
      message: 'La risposta di Python non è JSON.',
    });
  });
});
