# App desktop (Tauri 2)

Scheletro dell'app: una finestra che mostra `App Bollette, motore <versione>`. La versione viene da
`@bollette/core`. Non ha ancora altre funzioni (arrivano con i piani 4 e seguenti).

- `src/`, `index.html`: la pagina (TypeScript e Vite).
- `src-tauri/`: il guscio Tauri (Rust). Versioni di `tauri` e `tauri-build` fissate in `Cargo.toml`.
- `app-icon.png`: icona di partenza. Per rifarle:
  `pnpm --filter desktop tauri icon app-icon.png -o src-tauri/icons`, poi si tengono solo i sei
  file già presenti in `src-tauri/icons/` (gli altri servono a Android, iOS e Microsoft Store).

## In locale

- `pnpm --filter desktop build`: compila solo la pagina in `dist/` (basta Node).
- `pnpm test`: i test, dalla radice del repository.
- `pnpm --filter desktop tauri dev` apre la finestra vera, ma serve Rust (`rustup`): in CI si
  costruisce senza.

## Interprete Python incorporato

L'installer contiene un interprete Python 3.13 con `bollette_pdf` e le sue dipendenze, in
`src-tauri/resources/python/` (nel pacchetto: `python/` tra le risorse dell'app). La cartella non è
nel repository: la crea `node scripts/bundle-python.mjs` (dalla radice), che `build.yml` esegue prima
della build Tauri. Senza la cartella `tauri build` e `tauri dev` si fermano, perché
`tauri.conf.json` la elenca tra le risorse.

- L'interprete è una distribuzione _python-build-standalone_, variante «install_only» `.tar.gz`;
  indirizzo, impronta SHA-256 (presa dal file `SHA256SUMS` della release) e versione per
  `windows-x86_64` e `macos-aarch64` sono in `python/runtime.json`. Lo script verifica l'impronta
  prima di estrarre: un archivio che non corrisponde non viene mai estratto.
- Le dipendenze vengono da `python/requirements.txt` (`--require-hashes --no-deps
--only-binary :all:`); poi lo script toglie pip (non serve all'app e porta certifi, MPL-2.0) e
  copia `python/bollette_pdf/` con `schemas/supplierProfile.json` e `schemas/extractionResult.json`.
  Subito dopo l'estrazione toglie Tcl/Tk, `tkinter`, IDLE e `turtle` (non usati; licenza TCL fuori
  elenco). Alla fine controlla `python -I -m bollette_pdf --version`, che `tkinter` non ci sia più,
  e stampa la dimensione (circa 76 MB su macOS).
- Dopo la build, `build.yml` avvia `python -I -m bollette_pdf --version` dall'app installata
  (Windows, in `%LOCALAPPDATA%\App Bollette`, un percorso con spazi) e dall'app costruita (macOS).
- Per aggiornare l'interprete: si sceglie una release di python-build-standalone pubblicata da
  almeno due settimane, si copiano in `python/runtime.json` gli indirizzi dei due file
  `cpython-3.13.*-{x86_64-pc-windows-msvc,aarch64-apple-darwin}-install_only.tar.gz` e le loro
  righe di `SHA256SUMS`, e si ricontrolla l'elenco delle licenze in `python/THIRD_PARTY.md`.
- L'interprete macOS è solo per Apple Silicon: nell'app universale, su un Mac Intel la parte Python
  non parte (punto aperto).

## Build degli installer

La costruzione parte solo con un'etichetta di versione o a mano, mai a ogni push (i minuti macOS
costano dieci volte quelli Linux):

1. Etichetta: `git tag v0.1.0` e `git push origin v0.1.0` (per una prova va bene anche
   `v0.0.1-prova`, da cancellare dopo), oppure su GitHub: Actions, Build, Run workflow.
2. La prima volta dura circa 20-30 minuti (poi la cache di Rust accorcia). Le due build, Windows e
   macOS, vanno in parallelo; se una fallisce l'altra continua. Test e controllo delle licenze
   (npm e `cargo deny`) girano solo nel job Windows: `ci.yml` prova già ogni sistema.
3. Gli installer sono nella pagina dell'esecuzione, in fondo, sotto "Artifacts", oppure con
   `gh run download <id-esecuzione>`:
   - `bollette-windows`: il `.msi` e il programma di installazione `.exe` (NSIS).
   - `bollette-macos`: il `.dmg` e l'app in `App-Bollette.app.tar.gz` (universale: Apple Silicon e
     Intel).

Gli installer non sono firmati:

- **Windows**: SmartScreen mostra «Windows ha protetto il PC». Si sceglie «Maggiori informazioni»,
  poi «Esegui comunque». Il componente WebView2 è già in Windows 10 e 11 aggiornati; se manca,
  l'installer lo scarica.
- **macOS**: l'app non è notarizzata. Si apre dal menu contestuale (tasto destro, «Apri»). Da
  macOS 15 non basta: si prova ad aprirla, poi in Impostazioni di Sistema, «Privacy e sicurezza»,
  si sceglie «Apri comunque».

## Punti aperti

- **Cargo.lock**: fissato l'11 novembre 2026 con il file generato dalla prima build verde
  (esecuzione 42946109167); il workflow usa `--locked`. Per aggiornare le dipendenze Rust serve
  Rust in locale (`cargo update` in `src-tauri`), oppure si toglie `--locked` per una build, si
  scarica l'artifact `cargo-lock` e lo si committa.
- **Licenze di `cargo-deny`** (`deny.toml`): ammette l'elenco del vincolo globale più MPL-2.0 e,
  per decisione di Carlo dell'11 novembre 2026, `Unicode-3.0` e `Zlib` (richieste dall'albero Rust
  di Tauri). Con queste la prima build è passata; se una dipendenza nuova porta altre licenze, decide Carlo.
- **Chiave di firma degli aggiornamenti**: generata l'11 novembre 2026, senza password, nella
  cartella iCloud di Carlo `Personale/App_appartamenti/chiave-firma-aggiornamenti/` (con un
  `LEGGIMI.txt`). Non entra mai nel repository; nel piano 6 la privata diventa un secret GitHub e la
  pubblica va in `tauri.conf.json`. Conservarne una copia anche fuori da iCloud.
- **Firma del codice**: nessun certificato Windows; su Mac, se l'app si rifiuta di partire su
  Apple Silicon serve almeno la firma ad hoc (`bundle.macOS.signingIdentity` impostato a `-`).
- **Versione**: `version` sta in `tauri.conf.json`, in `Cargo.toml` e in `package.json`, da
  tenere uguali a mano; l'etichetta `v*` non la cambia.
