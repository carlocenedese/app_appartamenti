# Piano 16b: aggiornamenti dentro l'app

**Obiettivo:** l'app propone le versioni nuove e le installa dopo il clic dell'utente, con firma verificata; l'interruttore spegne l'unica chiamata di rete.

**Disegno:** `docs/plans/2026-11-17-piano-16b-aggiornamenti-disegno.md`. **Specifica:** sezioni 28, 36, 37. **Registro:** R280-R285.

**Vincoli:** nessun push, nessun segreto, nessuna release; core non toccato; veste grafica esclusa (markup semplice).

## Parte A (provata in locale)

### Task 1: disegno e piano

- [x] Questo file e il disegno.

### Task 2: interruttore e pannello

- [x] `checkUpdates` (facoltativo) in `machine-settings.ts`.
- [x] `updates.ts`: `UpdateBackend`, `updatesOn`, `checkForUpdate`, `renderUpdatesPanel` (controllo all'avvio con `checkAtStart`).
- [x] Test con backend finto: interruttore spento = nessuna chiamata (avvio e «Controlla ora»), errore di rete, versione uguale, installazione solo dopo il clic, errore d'installazione, salvataggio dell'interruttore senza perdere le altre impostazioni.

### Task 3: preflight, workflow del lock, documenti

- [x] `release.mjs preflight`: pretende anche `updater:allow-check`, `updater:allow-download-and-install` e `process:allow-restart` in `capabilities/default.json`, `tauri-plugin-process` in `Cargo.toml` e `lib.rs`, e i due plugin in `Cargo.lock` alla versione di `Cargo.toml`.
- [x] `.github/workflows/cargo-lock.yml`.
- [x] `docs/distribuzione.md`, `apps/desktop/README.md`, R280-R285.

## Parte B (provata solo in CI)

### Task 4: dipendenze e collegamento

- [x] npm `@tauri-apps/plugin-updater` 2.14.0, `@tauri-apps/plugin-process` 2.4.0 (`pnpm install --lockfile-only`).
- [x] `updates-tauri.ts` (backend vero) e pannello in `main.ts` dentro Tauri.
- [x] `Cargo.toml`, `lib.rs`, `capabilities/default.json`.

### Task 5: dopo il push (user1 o agente successivo)

- [x] `Cargo.lock` dall'artifact di `cargo-lock.yml`, commit (4aed59e).
### Task 6: correzioni della seconda revisione (R286-R288)

- [x] Preflight sul lock; interruttore spento con impostazioni assenti o rovinate; controllo dei crate nuovi con licenza fuori elenco in `cargo-lock.yml` (`scripts/rust-licenses.mjs`); interruttore e pulsanti bloccati durante controllo, installazione e salvataggio; `check({ timeout: 30000 })`; permessi `updater:allow-check` e `updater:allow-download-and-install` al posto di `updater:default`; `close()` delle offerte scartate; il primo avvio rilegge le impostazioni prima di scrivere; `.catch` in `main.ts`.

### Ancora da fare

- [ ] `gh workflow run build.yml --ref feat/piano-16b-aggiornamenti` verde, poi unione.
