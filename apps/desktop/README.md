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

## Build degli installer

La costruzione parte solo con un'etichetta di versione o a mano, mai a ogni push (i minuti macOS
costano dieci volte quelli Linux):

1. Etichetta: `git tag v0.1.0` e `git push origin v0.1.0` (per una prova va bene anche
   `v0.0.1-prova`, da cancellare dopo), oppure su GitHub: Actions, Build, Run workflow.
2. La prima volta dura circa 20-30 minuti (poi la cache di Rust accorcia). Le due build, Windows e
   macOS, vanno in parallelo; se una fallisce l'altra continua.
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

- **Cargo.lock**: non c'è, perché in locale manca Rust. La CI lo crea a ogni esecuzione dalle
  versioni di `Cargo.toml`, quindi le dipendenze indirette non sono fissate. Dopo la prima build
  verde: `cargo generate-lockfile` in `src-tauri/`, commit del file e `--locked` nel workflow.
- **Licenze di `cargo-deny`** (`deny.toml`, ruling R23): ammette solo l'elenco del vincolo globale
  più MPL-2.0. L'albero di Tauri probabilmente richiede anche `Unicode-3.0` e `Zlib`, forse
  `Apache-2.0 WITH LLVM-exception`. Non sono state aggiunte: se il passo `cargo deny` fallisce alla
  prima esecuzione, decide Carlo quali ammettere.
- **Chiave di firma degli aggiornamenti** (Task 11, passo 6; piano 6): da decidere dove si
  conserva la chiave privata. Se si perde, le app già installate non si aggiornano più.
- **Firma del codice**: nessun certificato Windows; su Mac, se l'app si rifiuta di partire su
  Apple Silicon serve almeno la firma ad hoc (`bundle.macOS.signingIdentity` impostato a `-`).
- **Versione**: `version` sta in `tauri.conf.json`, in `Cargo.toml` e in `package.json`, da
  tenere uguali a mano; l'etichetta `v*` non la cambia.
