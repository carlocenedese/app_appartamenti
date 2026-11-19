# Accesso al disco dall'app desktop (esito della prova, piano 6, task 1)

Data: 13 novembre 2026. Scopo: l'app deve leggere e scrivere solo la cartella di lavoro che
l'utente sceglie nel dialogo, con i permessi minimi, anche dopo un riavvio.

## Scelta

Tre plugin ufficiali di Tauri 2, licenza `Apache-2.0 OR MIT` (ammessa):

| Plugin                         | Cargo (`Cargo.toml`) | npm (`apps/desktop/package.json`)   | Pubblicato         |
| ------------------------------ | -------------------- | ----------------------------------- | ------------------ |
| `tauri-plugin-fs`              | `=2.7.1`             | `@tauri-apps/plugin-fs` `2.7.1`     | 14 ottobre 2026    |
| `tauri-plugin-dialog`          | `=2.8.4`             | `@tauri-apps/plugin-dialog` `2.8.4` | 27-28 ottobre 2026 |
| `tauri-plugin-persisted-scope` | `=2.4.2`             | (nessun pacchetto npm: solo Rust)   | 14 ottobre 2026    |

`persisted-scope` 2.4.3 (10 novembre 2026) non ha ancora due settimane: si usa 2.4.2.

In `src/lib.rs` i plugin sono solo registrati, nell'ordine fs, dialog, persisted-scope
(persisted-scope legge l'ambito del plugin fs all'avvio). Un solo comando Rust proprio,
`read_bill_pdf` (piano 23), che avvia il lettore Python incluso solo su un PDF e una cartella dei
profili consentiti dall'ambito del plugin fs (`FsExt::try_fs_scope()` e `is_allowed`), cioè dentro la
cartella scelta; senza `AppManifest` in `build.rs` non ha voci nei permessi.

## Permessi

`apps/desktop/src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "fs:allow-exists",
    "fs:allow-read-dir",
    "fs:allow-read-file",
    "fs:allow-rename",
    { "identifier": "fs:allow-mkdir", "allow": [{ "path": "$APPCONFIG" }] },
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [{ "path": "$APPCONFIG/machine-settings.json" }]
    },
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [{ "path": "$APPCONFIG/machine-settings.json" }]
    },
    "fs:allow-write-file"
  ]
}
```

- Nessun ambito statico (`scope`) e nessun `fs:default`: senza una cartella scelta il plugin dei
  file rifiuta ogni percorso. Nessun permesso di cancellare (`fs:allow-remove`): l'app non cancella
  mai (i record hanno `deleted`).
- `fs:allow-write-file` (piano 26, R403, approvato da user1 il 19 novembre 2026): abilita anche i
  comandi `open` e `write` del plugin (`write_file.toml`) e raggiunge la stessa cartella scelta di
  `write-text-file`, senza portata nuova. `TauriStore` lo usa solo con `createNew` (apertura
  `create_new`) per creare un Excel o un modulo, mai sopra un file che c'è già; il permesso in sé
  non impone `createNew`. Nell'elenco sopra restano omessi i permessi dell'aggiornamento
  (`updater:*`, `process:allow-restart`).
- Impostazioni della macchina (piano 6, task 6): `mkdir`, lettura e scrittura di testo hanno in più un
  ambito proprio, solo `$APPCONFIG` (mkdir) e `$APPCONFIG/machine-settings.json`; si somma a quello
  della cartella scelta a runtime. Non provato nell'app vera (vedi R84).
- `tauri.conf.json`, `plugins.fs`:
  - `requireLiteralLeadingDot: false`: altrimenti su macOS il modello `cartella/**` non comprende i
    nomi che iniziano con un punto, cioè i file temporanei `.tmp-*` della scrittura atomica.
    Effetto collaterale: dentro la cartella scelta sono raggiungibili anche gli altri file nascosti.
  - `scopeDroppedPaths: false`: un file o una cartella trascinati sulla finestra non entrano nei
    permessi (il valore predefinito è `true`, e persisted-scope li ricorderebbe per sempre).

## Come la cartella scelta entra nei permessi

1. `pickFolder()` (`apps/desktop/src/tauri-store.ts`) chiama
   `open({ directory: true, recursive: true, multiple: false })`.
2. Il comando `open` del plugin dialog, scelta la cartella, chiama
   `fs_scope.allow_directory(cartella, recursive)` sull'ambito del plugin fs
   (`plugins/dialog/src/commands.rs`, tag `dialog-v2.8.4`). Con `recursive: true` il modello è
   `cartella/**`, quindi anche le sottocartelle.
3. Ogni comando del plugin fs passa da `resolve_path` (`plugins/fs/src/commands.rs`, tag
   `fs-v2.7.1`), che accetta il percorso se lo consente l'ambito del comando **oppure** l'ambito di
   runtime (`fs_scope.scope.is_allowed`), dopo aver risolto i collegamenti simbolici. Quindi basta il
   permesso `fs:allow-<comando>` senza ambito statico.
4. persisted-scope ascolta le modifiche dell'ambito e le salva in `.persisted-scope` nella cartella
   dati dell'app (`app_data_dir`); all'avvio le rimette (`plugins/persisted-scope/src/lib.rs`, tag
   `persisted-scope-v2.4.2`). Così la cartella resta autorizzata dopo il riavvio.

## Che cosa è verificato

- Lettura del codice sorgente dei plugin ai tag indicati (via GitHub, `tauri-apps/plugins-workspace`)
  e del modulo `scope/fs.rs` di `tauri` 2.12.5: i passi 2, 3 e 4 qui sopra, i valori predefiniti di
  `requireLiteralLeadingDot` (`true` su Unix) e `scopeDroppedPaths` (`true`), i nomi dei permessi
  (`permissions/autogenerated/reference.md`).
- `rename` del plugin usa `std::fs::rename`, che sostituisce il file di destinazione anche su
  Windows: la scrittura atomica (file `.tmp-*` e rinomina) funziona come in `FsStore`.
- Licenze: `Apache-2.0 OR MIT` per i tre crate (Cargo.toml del workspace dei plugin) e per i due
  pacchetti npm (`npm view`). Le dipendenze Rust nuove dirette sono `rfd` 0.17 (MIT), `bincode` 1
  (MIT), `aho-corasick` 1 (Unlicense OR MIT), oltre a crate già presenti nell'albero di Tauri.
- `TauriStore` con un file system finto in memoria: gli stessi casi dei test di `FsStore`
  (`apps/desktop/test/tauri-store.test.ts`).

## Che cosa NON è verificato

- **Nessuna prova vera dell'app.** Rust non c'è in locale (`cargo: command not found`, decisione
  R9): non sono state provate né la scelta della cartella, né la scrittura, né il riavvio. Va
  provato a mano su una build di CI (Windows e macOS): scegliere una cartella, creare un file,
  chiudere e riaprire l'app, rileggere il file senza riscegliere la cartella.
- **`Cargo.lock` aggiornato il 13 novembre 2026** da una build di `build.yml` senza `--locked` (artifact `cargo-lock`, 418 pacchetti, con i tre plugin). La prima build ha mostrato un errore che in locale non si vedeva: `tauri::generate_context!` legge la sezione `plugins` di `tauri.conf.json` con `serde_json`, ora tra le dipendenze (`=1.0.140`).
- **Licenze dell'albero Rust completo**: le controlla `cargo deny` solo in CI (dopo il punto sopra).
- persisted-scope salva i modelli già «escapati» e li rimette con `allow_directory`, che li escapa di
  nuovo; il plugin corregge i casi noti (`fix_pattern`), ma una cartella con `[`, `]`, `*` o `?` nel
  nome potrebbe non essere ritrovata dopo il riavvio. Non provato.
- macOS sandbox e «security-scoped bookmarks»: l'app non è in sandbox (non passa dall'App Store),
  quindi non servono; se un giorno lo fosse, persisted-scope non basta.

## Limiti accettati

- Il plugin fs non chiama `fsync`: dopo un'interruzione di corrente subito dopo la rinomina, su
  alcuni file system il file potrebbe restare vuoto o vecchio. `FsStore` invece sincronizza.
- Una rinomina fallita lascia il file `.tmp-*` (l'app non ha il permesso di cancellare); `list` lo
  nasconde, come per un processo interrotto.
- Ogni cartella scelta resta autorizzata per sempre (persisted-scope non ha una revoca); nessuna
  cartella fuori da quelle scelte è raggiungibile.

## Ripiego concordato (se la prova su CI non regge)

Se la cartella scelta non risulta scrivibile o non resta autorizzata dopo il riavvio: un piccolo
insieme di comandi Rust propri (leggere, scrivere in modo atomico con `sync_all`, elencare,
leggere byte), limitati alla cartella salvata nelle impostazioni della macchina, al posto del
plugin fs. `TauriStore` cambia solo il `FsBackend`; si prova solo in CI.
