# Piano 23: il lettore Python dei PDF avviato dall'app desktop (piano)

Decisione di user1: le schermate non sono ancora disegnate. Qui solo l'impianto che una schermata
futura chiamerà: nessuna interfaccia visibile, nessuna schermata nuova. Ogni task: test che
falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, commit.

Contratto esistente (non cambia): `python -I -m bollette_pdf extract --pdf <file> --profiles
<cartella> --at <data ISO> [--ocr-data <cartella>] [--pages a-b]`; un solo documento JSON
(`ExtractionResult`) su stdout in UTF-8, codice 0 per ogni risultato valido, 2 per argomenti o
file non validi, messaggi generici in italiano su stderr (`python/bollette_pdf/__main__.py`).
L'interprete incluso è la risorsa `python/` di `tauri.conf.json` (`bin/python3` su macOS,
`python.exe` su Windows, come `interpreterPath` di `scripts/bundle-python.mjs`); i dati dell'OCR
sono la risorsa `ocr-data/`. I profili sono i record `_app/dati/supplierProfile/` della cartella
scelta (`recordPath('supplierProfile', …)`).

1. **Lettura della risposta nel core.** `parseExtractionResult(text)` in
   `packages/core/src/extraction.ts`: `JSON.parse` e `ExtractionResultSchema`, errori in italiano
   con i soli percorsi dei problemi (mai i valori del documento). L'aiuto dei test
   `packages/core/test/helpers/python-extract.ts` la usa al posto della sua copia, così test
   d'integrazione e app validano allo stesso modo. Test in `extraction.test.ts`.
2. **Comando Rust `read_bill_pdf`.** Modulo `apps/desktop/src-tauri/src/python_reader.rs`, solo
   `std` e `serde_json` (già dipendenza): nessuna crate nuova, `Cargo.lock` invariato.
   - Interprete: in produzione solo quello incluso; in sviluppo (`debug_assertions`) la variabile
     `PYTHON` se c'è, come i test e `estratti.mjs`, altrimenti quello incluso. Mai il Python di
     sistema in produzione.
   - Argomenti come vettore, nessuna shell: `-I -m bollette_pdf extract --pdf=… --profiles=…
     --at=…`, `--pages=…` se dato, `--ocr-data=…` solo se c'è `ocr-data/ita.traineddata`.
   - Percorsi: assoluti, esistenti (file il PDF, cartella i profili) e consentiti dall'ambito del
     plugin dei file (`FsExt::fs_scope().is_allowed`, che risolve i collegamenti come i comandi
     del plugin): solo la cartella scelta dall'utente. A Python va il percorso canonico controllato.
   - Esecuzione: stdin chiuso, stdout e stderr letti su thread (una pipe piena non sembra un
     tempo scaduto), stdout al massimo 8 MB, tempo massimo 60 s, poi il processo è ucciso e
     atteso; su Windows senza finestra (`CREATE_NO_WINDOW`).
   - Errori strutturati `{ code, message }` in italiano, mai un percorso né testo del documento:
     codici in inglese come gli altri nomi del codice: `path-forbidden`, `python-missing`,
     `timeout`, `output-too-large`, `exit-code` (con la prima riga di stderr, che il pacchetto
     tiene generica), `invalid-json`, `internal`. Il comando restituisce il testo di stdout così com'è: lo valida il core.
   - Comando asincrono (`spawn_blocking`): la finestra non si blocca durante la lettura.
   - Test unitari Rust: costruzione degli argomenti, scelta dell'interprete, mappa degli errori,
     tempo scaduto, uscita non zero, JSON non valido, interprete assente (processi `/bin/sh` solo
     nei test, su Unix).
3. **Involucro TypeScript.** `apps/desktop/src/pdf-reader-tauri.ts`, come `updates-tauri.ts`:
   interfaccia `PdfReaderBackend` (il comando grezzo), `tauriPdfReaderBackend` con `invoke`, e
   `readBillPdf(input, backend?)` che restituisce un `ExtractionResult` validato da
   `parseExtractionResult`, pronto per `importBill`. Un rifiuto del comando diventa
   `PdfReaderError` con `code` e `message`. Test con un backend finto e con `invoke` simulato.
4. **Configurazione.** Nessuna modifica prevista: senza `AppManifest` in `build.rs` i comandi
   dell'app sono consentiti alla finestra senza voci nei permessi. Da aggiornare solo i testi che
   dicono «nessun comando Rust proprio» (`docs/rules/disco-app.md`); la descrizione della
   capability resta a user1.

Integrazione con il Python vero: il test con `REQUIRE_PYTHON=1` esiste per il core
(`extract-integration.test.ts`) e copre il contratto; vitest non avvia Tauri, quindi per il comando
Rust nessun test d'integrazione nuovo (Ruling).
