# App Bollette: Piano 2b-2, PDF con più documenti (fase 1)

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** ogni documento di un PDF che ne contiene più di uno si legge solo dalle sue pagine, si registra come record a sé (la seconda bolletta di un file non è più un duplicato), porta il suo tipo e una nota, e si annulla da solo o insieme agli altri documenti del file; un file che probabilmente contiene più documenti dà un avviso.

**Architettura:** Python legge un intervallo di pagine (`extract --pages a-b`) su una vista ristretta del `Document` e stampa ancora **un** `ExtractionResult`, con in più `pageRange` e `documentKind`. L'app lo chiama una volta per documento. Il core (puro) aggiunge `fileDocument` ai record, i duplicati per intervallo, la nota automatica e l'annullamento di tutto il file. La divisione la sceglie una persona; nessuna divisione automatica (fase 2).

**Stack tecnologico:** Python 3.13 con pdfminer.six e jsonschema (nessuna dipendenza nuova); TypeScript strict, Vitest, Zod 4.

**Specifica:** il disegno approvato `docs/plans/2026-11-14-piano-2b-2-pdf-multi-documento-disegno.md` (14 novembre 2026, fase 1 snella, «Mie scelte» comprese); `docs/spec.md` sezioni 7, 22 e 42. Fuori da questo piano: fase 2 (`ExtractionSet`, `split.startAnyOf`, controlli fra documenti, lettura unica), interfaccia («Da rivedere», barra di ricerca e il suo filtro), spostamento e nome del file, condominio (2b-3).

## Metodo di esecuzione

- Come nei piani 2a, 2b-1, 4 e 6: un ramo, mai su `main`; per ogni task test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm python:test`, `pnpm data:check`, commit; un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; una revisione finale; PR, merge solo con la CI verde e il via di Carlo.
- Regole nuove in `docs/progress.md` da **R93** (R92 è del ramo `fix/ocr-senza-ancore-seed`; rinumerare all'unione se serve).
- Le regole di calcolo e di confidenza non si decidono da soli: NEEDS_CONTEXT e si chiede a Carlo.
- I PDF reali non entrano mai nel repository; il Task 5 li legge in sola lettura e scrive solo numeri.

## Vincoli globali

- Importi in centesimi interi (`Cents`), date `YYYY-MM-DD`; calcoli sulle date solo con interi e UTC; test che passano con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura almeno 90% sulle righe di `packages/core/src`.
- `packages/core` puro: niente rete, niente `node:*`, niente `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; orologio e generatore di `id` sono argomenti.
- Python: nessuna rete, nessun orologio (`--at` è un argomento), importi solo `Decimal`, stdout UTF-8, un solo JSON per chiamata; `python -I -m bollette_pdf`; unica libreria PDF `pdfminer.six`; nessuna dipendenza nuova.
- Ogni record ha `id`, `v`, `rev`, non si cancella mai dal disco (`deleted`); i record già scritti restano validi senza migrazione (campi nuovi solo opzionali).
- Nessun dato inventato: un campo che non si legge dalle pagine dell'intervallo è `null`/`missing`. Nessun dato reale nel repository (`pnpm data:check`); messaggi, avvisi e note in italiano generico, mai testo del documento, mai percorsi.
- Nomi nel codice e commenti in inglese; messaggi e note in italiano.
- Valori esatti dal disegno: `documentKind` ∈ `bill`, `tari`, `unknown`; avviso `Il file potrebbe contenere più documenti.`; `fileDocument: { pages: [first, last], documentKind }` scritto solo per un intervallo che non copre tutto il file; duplicati: stesso `fileHash` e stesso intervallo `duplicate`, sovrapposti `possible-duplicate`, disgiunti nessuno, record senza `fileDocument` = file intero; il file si rilegge a ogni chiamata (anche l'OCR), costo accettato; `MAX_OCR_PAGES` (20) vale per chiamata.

## Revisione mirata (Review Focus)

1. Un file `illeggibile` ha `pages: 0`: `pageRange` vale `null` e lo schema non lo rifiuta; con `--pages` su un file illeggibile si stampa l'`illeggibile`, non un errore di argomenti (Task 1 e 2).
2. Un intervallo che contiene solo pagine bianche o un'immagine senza OCR: `senza-testo`, `documentKind` `unknown`, mai il testo delle pagine fuori dall'intervallo (Task 2).
3. Un PDF con una sola bolletta che ripete l'importo in una tabella di storico con un valore diverso: l'avviso compare ma stato e confidenza restano quelli di oggi (Task 2; quanti sono sui PDF reali lo conta il Task 5).
4. Un record vecchio senza `fileDocument` e un documento nuovo dello stesso file con `pages: [3, 4]`: `possible-duplicate`, mai una seconda registrazione silenziosa (Task 3).
5. «Annulla tutto il file» quando un documento ha un'operazione successiva che dipende da lui (un abbinamento): si ferma con l'errore di `undoOperation` dopo aver annullato quelli liberi, e rilanciato continua da lì senza annullare due volte (Task 4).

---

## Task 1: `pageRange` e `documentKind` nello schema

**Files:** Modify `packages/core/src/extraction.ts`, `docs/schemas/extractionResult.json` (`pnpm schemas:export`), `python/bollette_pdf/extract.py` (`_result`), `python/bollette_pdf/__main__.py` (`_unreadable`), i costruttori di `ExtractionResult` nei test (`packages/core/test/**`, `python/tests/**`); Create `python/tests/data/extraction-cases.json`; Test `packages/core/test/extraction.test.ts`, `python/tests/test_schemas.py`.

**Interfaces:**

- Consumes: `ExtractionResultSchema` di oggi.
- Produces: `ExtractionResult.pageRange: [number, number] | null` (interi da 1) e `ExtractionResult.documentKind: 'bill' | 'tari' | 'unknown'`, obbligatori; `export const DocumentKindSchema = z.enum(['bill', 'tari', 'unknown'])` e `export type DocumentKind`; Python scrive `pageRange` `[1, pages]` (o `null` con `pages` 0) e `documentKind` = `kind` del profilo o `unknown`.

- [ ] **Step 1: test che falliscono.** Zod: accetta `pageRange: [1, 3]` con `pages: 3`; rifiuta `[2, 1]`, `[1, 4]` con `pages: 3`, `[0, 1]`, `null` con `pages: 3` e `[1, 1]` con `pages: 0`; rifiuta `fields.amount.source.page: 4` e `parts[0].source.page: 1` con `pageRange: [2, 3]`; rifiuta `ocrPages: [1]` con `pageRange: [2, 3]`; rifiuta `documentKind: 'unknown'` con `profileId: 'hera-luce-2025'`, `documentKind: 'bill'` con `profileId: null`, `documentKind: 'tari'` con `kind: 'bill'`. `extraction-cases.json`: ogni caso `{ "name", "result", "zod": bool, "jsonSchema": bool }`; il test Zod e `test_schemas.py` controllano ciascuno il proprio validatore (le refine sono solo in Zod: `jsonSchema` è vero per i casi che violano solo una refine). Python: `extract` su `hera-luce-01` dà `pageRange == [1, pages]` e `documentKind == "bill"`; un documento non riconosciuto `unknown`; `_unreadable` dà `pageRange: None`, `documentKind: "unknown"`.
- [ ] **Step 2:** `pnpm test -- extraction` e `PYTHON=<venv> pnpm python:test` falliscono.
- [ ] **Step 3: implementare** i due campi e le refine (descritte in `.meta`), `pnpm schemas:export`; in Python solo i due valori in `_result` e `_unreadable`; aggiornare i costruttori dei test.
- [ ] **Step 4:** lint, typecheck, `REQUIRE_PYTHON=1 pnpm test`, `pnpm python:test`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(estrazione): pageRange e documentKind nel risultato (piano 2b-2, task 1)`.

## Task 2: `extract --pages a-b` e avviso «più documenti»

**Files:** Modify `python/bollette_pdf/reader.py` (`restrict`), `python/bollette_pdf/extract.py` (avviso), `python/bollette_pdf/__main__.py` (`--pages`), `python/README.md`, `docs/progress.md` (R93); Create `python/tests/compose.py` (unisce dump di fixture); Test `python/tests/test_reader.py`, `test_extract.py`, `test_cli.py`.

**Interfaces:**

- Consumes: `Document`, `read_pdf(path, *, ocr_data=None, max_ocr_pages=MAX_OCR_PAGES)`, `extract(doc, profiles, at)`, `load_dump`.
- Produces: `Document.page_range: tuple[int, int] | None = None` (None = file intero); `restrict(doc: Document, first: int, last: int) -> Document` (righe e `ocr_pages` delle sole pagine `first..last`, `pages` del file, `has_text` ricalcolato con `MIN_TEXT_CHARS` sulle righe tenute, `text_source` ricalcolato come in R86 sulle pagine dell'intervallo, `page_range=(first, last)`; `ValueError` se `1 <= first <= last <= pages` non vale); `WARNING_MANY_DOCUMENTS = "Il file potrebbe contenere più documenti."`; riga di comando `extract --pages a-b` (interi, un solo intervallo); `PAGES_ERROR = "Intervallo di pagine non valido: nessun output."` con codice 2; `compose(*fixtures: dict) -> dict` (dump unico, pagine rinumerate, `fileHash` inventato).

- [ ] **Step 1: test che falliscono.**
  - `restrict(compose(hera, fastweb), 3, 4)` (due pagine ciascuno) ha solo righe di pagina 3 e 4 e `page_range == (3, 4)`; `restrict(doc, 0, 1)` e `restrict(doc, 2, 5)` su 4 pagine lanciano `ValueError`.
  - `extract(restrict(composto, 1, 2))` dà importo, numero e stato attesi di `hera-luce-01` con `pageRange [1, 2]`; `(3, 4)` quelli di `fastweb-01` con `pageRange [3, 4]` e ogni `source.page` in 3-4.
  - Composto letto intero (due fixture di `fixtures/pdf/` lette dallo stesso profilo, con importi diversi; le sceglie l'esecutore): `WARNING_MANY_DOCUMENTS` negli avvisi, importo `medium` e stato come senza l'avviso (confrontati con una lettura con l'avviso tolto).
  - Bolletta più pagina di testo inventato non riconosciuta, intervallo dell'allegato: `non-riconosciuta`, `documentKind` `unknown`.
  - Dump `mixed` composto con `acegas-acqua-ocr-01` come pagina 3: con `(3, 3)` `textSource` `ocr` e `ocrPages [3]`; con `(1, 2)` `pdf` e `ocrPages []`.
  - Intervallo di pagine bianche: `senza-testo`, `unknown`.
  - CLI: `--pages 2-1`, `--pages 0-1`, `--pages 1`, `--pages 1-2,3-4`, `--pages a-b` danno codice 2, stderr `PAGES_ERROR\n`, stdout vuoto; `--pages 1-9` su un PDF di 2 pagine codice 2 dopo la lettura; `--pages 1-1` su un file illeggibile stampa l'`illeggibile` con codice 0; due corse uguali danno gli stessi byte.
- [ ] **Step 2:** `PYTHON=<venv> pnpm python:test` fallisce.
- [ ] **Step 3: implementare.** L'avviso: per `amount` e `number` del profilo scelto, quando la regola che dà il valore ha almeno due letture con valori diversi (lo stesso confronto `agree` di `_read_field`, esposto senza cambiarne il risultato). `--pages` si convalida prima di leggere il file (forma) e dopo (`last <= pages`). Scrivere R93 (`restrict`, avviso, `--pages`, rilettura del file a ogni chiamata).
- [ ] **Step 4:** lint, `pnpm python:test`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(pdf): lettura di un intervallo di pagine e avviso più documenti (piano 2b-2, task 2)`.

## Task 3: `fileDocument` e duplicati per intervallo

**Files:** Modify `packages/core/src/model.ts` (`BillSchema`, `InstalmentSchema`), `docs/schemas/*.json`, `packages/core/src/dedupe.ts`, `packages/core/src/confirmation.ts`, `packages/core/src/index.ts`; Test `packages/core/test/dedupe.test.ts`, `confirmation.test.ts`, `model.test.ts`.

**Interfaces:**

- Consumes: `DocumentKindSchema` (Task 1), `ExtractionResult.pageRange`, `findBillDuplicate`, `findInstalmentDuplicate`, `registerProposal`.
- Produces: `FileDocumentSchema = z.object({ pages: z.tuple([z.int().min(1), z.int().min(1)]), documentKind: DocumentKindSchema })` (refine: `pages[0] <= pages[1]`), campo opzionale `fileDocument` su `Bill` e `Instalment`; `export function samePages(a?: FileDocument, b?: FileDocument): 'same' | 'overlap' | 'disjoint'` (assente = file intero: assente con assente `same`, assente con un intervallo `overlap`); `findBillDuplicate` e `findInstalmentDuplicate` con stesso `fileHash`: `same` → `duplicate`, `overlap` → `possible-duplicate`, `disjoint` → si passa alla regola sui dati; `registerProposal` scrive `fileDocument` da `result.pageRange` e `result.documentKind` solo se `pageRange` non è `[1, result.pages]`.

- [ ] **Step 1: test che falliscono.** `samePages`: `[1,2]`/`[1,2]` `same`, `[1,2]`/`[2,3]` `overlap`, `[1,2]`/`[3,4]` `disjoint`, assente/`[3,4]` `overlap`. `registerProposal` di due bollette dello stesso file con `pageRange [1,2]` e `[3,4]`: entrambe `registered`, record con `fileDocument.pages` `[1,2]` e `[3,4]`; la stessa con `[1,2]` di nuovo: `duplicate`; con `[2,3]`: `possible-duplicate`; un record vecchio senza `fileDocument` e una nuova con `[3,4]`: `possible-duplicate`; una con `pageRange [1, pages]`: nessun `fileDocument` nel record; stesso caso per due rate TARI con lo stesso `rateIndex` da intervalli disgiunti; un record di oggi senza `fileDocument` resta valido.
- [ ] **Step 2:** `pnpm test -- dedupe confirmation` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`.
- [ ] **Step 4:** lint, typecheck, `REQUIRE_PYTHON=1 pnpm test` (anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`), `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): documenti di un file per intervallo di pagine e duplicati (piano 2b-2, task 3)`.

## Task 4: nota automatica e «annulla tutto il file»

**Files:** Create `packages/core/src/file-document-note.ts`, `packages/core/src/undo-file.ts`; Modify `packages/core/src/index.ts`; Test `packages/core/test/file-document-note.test.ts`, `undo-file.test.ts`.

**Interfaces:**

- Consumes: `FileDocument`, `Bill`, `Instalment` (Task 3), `readJournal`, `undoOperation(store, opId, profileId, clock, newId, opts)`.
- Produces:
  - `fileDocumentNote(self: FileDocument, others: FileDocument[]): string`. Testo: `Documento delle pagine 3-4 di un file con più documenti.` (una pagina: `della pagina 5`), poi ` Registrati dallo stesso file anche: bolletta, pagine 1-2; avviso TARI, pagina 5.` ordinati per pagina, oppure ` Nessun altro documento dello stesso file è registrato.`; tipi `bolletta`, `avviso TARI`, `sconosciuto`. La «bolletta» resta tale anche se il record viene da un documento `unknown` registrato a mano: vale il `documentKind` del record.
  - `undoFile(store: Store, fileHash: string, profileId: string, clock: () => string, newId: () => string): Promise<Operation[]>`: le operazioni di registrazione non annullate che hanno creato un record (`before` assente) con quel `fileHash`, dalla più recente, ognuna con `undoOperation` senza `cascade`; restituisce le operazioni di annullamento. Un errore di `undoOperation` si propaga e lascia annullate quelle già fatte.
- «Annulla solo questo documento» è `undoOperation` di oggi: niente di nuovo. Rimettere il file in `Da_smistare` resta al piano che sposta i file.

- [ ] **Step 1: test che falliscono.** Note: `[3,4]` con `[[1,2] bill]` dà esattamente `Documento delle pagine 3-4 di un file con più documenti. Registrati dallo stesso file anche: bolletta, pagine 1-2.`; `[5,5]` senza altri dà `Documento della pagina 5 di un file con più documenti. Nessun altro documento dello stesso file è registrato.`; l'ordine degli altri segue la prima pagina. `undoFile`: due bollette e una rata dello stesso file registrate, una bolletta di un altro file: tre annullamenti, l'altra resta; chiamato di nuovo restituisce `[]`; un documento già annullato da solo non viene annullato di nuovo; con una dipendenza sul primo registrato lancia dopo aver annullato gli altri, e rilanciato senza la dipendenza annulla solo quello.
- [ ] **Step 2:** `pnpm test -- file-document-note undo-file` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, `REQUIRE_PYTHON=1 pnpm test` con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): nota dei documenti di un file e annullamento del file intero (piano 2b-2, task 4)`.

## Task 5: non regressione e conteggi sui PDF reali

**Files:** Modify `python/tests/test_real_layouts.py`, `python/tools/pdf_report.py` (colonna dell'avviso), `python/tests/test_dev_tools.py`, `docs/rules/lettura-pdf.md` (conteggi), `docs/progress.md`.

**Interfaces:**

- Consumes: `extract`, `WARNING_MANY_DOCUMENTS` (Task 2), `report(...)` di `pdf_report.py`.
- Produces: il rapporto conta i file con `WARNING_MANY_DOCUMENTS`, per profilo scelto (o «nessun profilo»).

- [ ] **Step 1: test che falliscono.** Per ogni fixture di `fixtures/pdf/` (18 oggi): stessi valori, confidenze e stato attesi, `pageRange [1, pages]`, `documentKind` del profilo; e lo stesso risultato con `--pages 1-<pages>` letto dalla riga di comando, salvo `pageRange` uguale. Il rapporto su una cartella temporanea con un composto letto intero conta 1 nella colonna «più documenti» del suo profilo.
- [ ] **Step 2:** `PYTHON=<venv> pnpm python:test` fallisce.
- [ ] **Step 3: implementare** la colonna; lanciare il rapporto in sola lettura sulle cartelle reali (Lovarini, Pulci, Berchet) e scrivere in `docs/rules/lettura-pdf.md` **solo numeri**: file con l'avviso per profilo, con la nota che l'avviso scatta anche su un documento solo con una tabella di storico e che i casi vanno guardati da Carlo; nessun nome di file, importo o testo. Una riga in `docs/progress.md`.
- [ ] **Step 4:** lint, `pnpm python:test`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `test(pdf): non regressione delle fixture e conteggi dell'avviso più documenti (piano 2b-2, task 5)`.

---

## Copertura del disegno

Avviso: Task 2 (conteggi Task 5). `--pages`, vista ristretta, rilettura a ogni chiamata, OCR per intervallo: Task 2. `pageRange`, `documentKind`, refine, schemi, casi comuni: Task 1. Valorizzazione di `documentKind` (profilo o `unknown`; record a mano col tipo scelto): Task 1 e 3. `fileDocument` ridotto, duplicati per intervallo, seconda bolletta registrabile: Task 3. Nota automatica e due annullamenti: Task 4. Conferme di pagamento e note sempre `unknown` (decisione 7): nessun profilo seed le riconosce, il caso con testo inventato è nel Task 2; un `noneOf` si aggiunge solo se il Task 5 ne trova una riconosciuta. Registrazione automatica ad alta confidenza (decisione 5): invariata, `registerProposal` di oggi. Filtro di ricerca, domanda di revisione, divisione a mano nell'interfaccia: piano dell'interfaccia. Fase 2: nessun task.
