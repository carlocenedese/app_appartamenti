/** The note a record gets when its file holds more than one document (plan 2b-2). Italian text. */
import type { FileDocument } from './model';

const KIND_NAMES: Record<FileDocument['documentKind'], string> = {
  bill: 'bolletta',
  tari: 'avviso TARI',
  unknown: 'sconosciuto',
};

function pagesOf({ pages: [first, last] }: FileDocument, one: string, many: string): string {
  return first === last ? `${one} ${String(first)}` : `${many} ${String(first)}-${String(last)}`;
}

/** `self` is the document the note is for; `others` the other documents registered from the file. */
export function fileDocumentNote(self: FileDocument, others: readonly FileDocument[]): string {
  const head = `Documento ${pagesOf(self, 'della pagina', 'delle pagine')} di un file con più documenti.`;
  if (others.length === 0) return `${head} Nessun altro documento dello stesso file è registrato.`;
  const list = [...others]
    .sort((a, b) => a.pages[0] - b.pages[0] || a.pages[1] - b.pages[1])
    .map((doc) => `${KIND_NAMES[doc.documentKind]}, ${pagesOf(doc, 'pagina', 'pagine')}`)
    .join('; ');
  return `${head} Registrati dallo stesso file anche: ${list}.`;
}
