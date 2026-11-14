import { describe, expect, it } from 'vitest';
import { fileDocumentNote } from '../src/index';
import type { FileDocument } from '../src/index';

const doc = (a: number, b: number, documentKind: FileDocument['documentKind']): FileDocument => ({
  pages: [a, b],
  documentKind,
});

describe('fileDocumentNote', () => {
  it('names the pages of the document and the others of the file', () => {
    expect(fileDocumentNote(doc(3, 4, 'bill'), [doc(1, 2, 'bill')])).toBe(
      'Documento delle pagine 3-4 di un file con più documenti. Registrati dallo stesso file anche: bolletta, pagine 1-2.',
    );
  });

  it('says so when no other document is registered, and writes one page as "pagina"', () => {
    expect(fileDocumentNote(doc(5, 5, 'tari'), [])).toBe(
      'Documento della pagina 5 di un file con più documenti. Nessun altro documento dello stesso file è registrato.',
    );
  });

  it('orders the others by first page and names every kind', () => {
    expect(fileDocumentNote(doc(3, 4, 'bill'), [doc(5, 5, 'tari'), doc(1, 2, 'unknown')])).toBe(
      'Documento delle pagine 3-4 di un file con più documenti. Registrati dallo stesso file anche: sconosciuto, pagine 1-2; avviso TARI, pagina 5.',
    );
  });
});
