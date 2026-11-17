# Piano 16b: aggiornamenti dentro l'app

**Obiettivo:** l'app propone le versioni nuove e le installa dopo il clic dell'utente, con firma verificata; l'interruttore spegne l'unica chiamata di rete.

**Disegno:** `docs/plans/2026-11-17-piano-16b-aggiornamenti-disegno.md`. **Specifica:** sezioni 28, 36, 37. **Registro:** R280-R285.

**Vincoli:** nessun push, nessun segreto, nessuna release; core non toccato; veste grafica esclusa (markup semplice).

## Parte A (provata in locale)

### Task 1: disegno e piano

- [x] Questo file e il disegno.

### Task 2: interruttore e pannello

- [x] `checkUpdates` (facoltativo) in `machine-settings.ts`.
- [x] `updates.ts`: `UpdateBackend`, `checkForUpdate`, `startupCheck`, `renderUpdatesPanel`.
- [x] Test con backend finto: interruttore spento = nessuna chiamata (avvio e «Controlla ora»), errore di rete, versione uguale, installazione solo dopo il clic, errore d'installazione, salvataggio dell'interruttore senza perdere le altre impostazioni.

### Task 3: preflight, workflow del lock, documenti

- [x] `release.mjs preflight`: pretende anche `updater:default` e `process:allow-restart` in `capabilities/default.json` e `tauri-plugin-process` in `Cargo.toml` e `lib.rs`.
- [x] `.github/workflows/cargo-lock.yml`.
- [x] `docs/distribuzione.md`, `apps/desktop/README.md`, R280-R285.

## Parte B (provata solo in CI)

### Task 4: dipendenze e collegamento

- [x] npm `@tauri-apps/plugin-updater` 2.14.0, `@tauri-apps/plugin-process` 2.4.0 (`pnpm install --lockfile-only`).
- [x] `updates-tauri.ts` (backend vero) e pannello in `main.ts` dentro Tauri.
- [x] `Cargo.toml`, `lib.rs`, `capabilities/default.json`.

### Task 5: dopo il push (user1 o agente successivo)

- [ ] `Cargo.lock` dall'artifact di `cargo-lock.yml`, commit.
- [ ] `gh workflow run build.yml --ref feat/piano-16b-aggiornamenti` verde, poi unione.
