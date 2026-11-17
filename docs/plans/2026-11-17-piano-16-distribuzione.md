# Piano 16: distribuzione e Python in produzione

**Obiettivo:** installer scaricabile da una pagina pubblica, Python incluso, aggiornamenti firmati automatici, senza che user1 consegni chiavi o tocchi il computer di user2.

**Disegno:** `docs/plans/2026-11-17-piano-16-distribuzione-disegno.md`. **Specifica:** sezioni 2, 28, 36, 37, 40. **Registro:** R270-R275.

**Vincoli:** nessuna chiave generata, nessun secret impostato, nessuna release pubblicata, nessun push da parte degli agenti; segreti letti solo dai secrets di GitHub; nessun nome di account nei file (l'indirizzo si costruisce da `github.repository`); solo moduli di Node negli script (nessuna dipendenza nuova).

## Task 1: disegno e piano (questo file)

- [x] Stato attuale, opzioni (a)-(d), domande per user1.

## Task 2: `scripts/release.mjs` (preflight, manifest, controllo del pacchetto)

- [x] `preflight <etichetta>`: etichetta `vX.Y.Z` uguale alla versione di `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package.json`, `apps/desktop/package.json`; chiave pubblica non segnaposto; `tauri-plugin-updater` in `Cargo.toml`; secret di firma presente (`HAS_SIGNING_KEY=true`). Elenca tutti i problemi, esce con 1.
- [x] `manifest <cartella> <etichetta> <indirizzo base>`: controlla che ci siano l'installer Windows e l'archivio macOS con le loro `.sig`, che nessun file superi il limite, scrive `latest.json` (piattaforme `windows-x86_64`, `darwin-aarch64`) e `SHA256SUMS`.
- [x] Test in `scripts/release.test.mjs` con cartelle temporanee.

## Task 3: `build.yml` e `tauri.conf.json`

- [x] `tauri.conf.json`: `plugins.updater.pubkey` = segnaposto documentato; nessun indirizzo (`requireSignedVersion` arriva con il plugin nel piano 16b, perché dipende dalla sua versione).
- [x] Su etichetta: preflight prima della build; sovrapposizione `--config` con `createUpdaterArtifacts` e l'indirizzo da `github.repository`; `TAURI_SIGNING_PRIVATE_KEY` solo da `secrets`; raccolta dei file della release con nomi senza spazi.
- [x] Job `publish` (`contents: write`, senza il secret di firma): `release.mjs manifest`, `gh release create` con `GITHUB_TOKEN`.
- [x] La build a mano resta com'era (artifact di prova, nessuna firma).

## Task 4: `scripts/setup-updater.mjs` (l'unico comando di user1)

- [x] Trova una sola coppia `*.key` / `*.key.pub` nella cartella indicata; privata a `gh secret set TAURI_SIGNING_PRIVATE_KEY` su stdin; pubblica al posto del segnaposto in `tauri.conf.json`. Non genera chiavi, non stampa la privata.
- [x] Test con un `gh` finto.

## Task 5: documentazione

- [x] `docs/distribuzione.md` per user1, in italiano semplice; `apps/desktop/README.md` aggiornato; R270-R275 in `docs/progress.md`.

## Piano 16b (dopo, serve Rust o una build in CI senza `--locked`)

1. `tauri-plugin-updater` e `tauri-plugin-process` in `Cargo.toml` (versioni esatte), `@tauri-apps/plugin-updater` e `@tauri-apps/plugin-process` in `apps/desktop/package.json`; registrazione in `lib.rs`; permessi `updater:default` e `process:allow-restart` in `capabilities/default.json`; `plugins.updater.requireSignedVersion: true` se la versione del plugin lo conosce.
2. `Cargo.lock`: build a mano senza `--locked`, artifact `cargo-lock`, commit (`apps/desktop/README.md`, «Punti aperti»); `cargo deny` sulle licenze nuove.
3. Interfaccia: controllo all'avvio, domanda «È disponibile la versione X: installarla?», interruttore nelle impostazioni (domanda 4), messaggi in italiano e inglese.
4. Prima release vera `v0.2.0` (o quella scelta): si prova l'aggiornamento da una versione alla successiva su Windows (CI: installazione silenziosa della vecchia, poi lettura di `latest.json`; la prova completa la fa user1 sul proprio computer).
