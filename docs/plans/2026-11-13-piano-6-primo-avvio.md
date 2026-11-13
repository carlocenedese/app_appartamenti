# App Bollette: Piano 6 (parte «primo avvio e sincronizzazione»)

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** l'app installata crea una cartella di lavoro (o si unisce a una esistente), la valuta all'apertura (compatibilità, sincronizzazione, presenza di altri) e può leggerla e scriverla dal disco.

**Architettura:** tutta la logica è nel core puro (`packages/core`): `createUser`, `createWorkspace`, `assessWorkspace`, regole dei nomi dei conflitti, presenza. L'app desktop porta un `TauriStore` che implementa l'interfaccia `Store` già esistente, le impostazioni per macchina e una procedura guidata sottile; nessuna regola nell'interfaccia.

**Stack tecnologico:** TypeScript strict, Vitest, Zod 4 (come i piani 1, 2a, 4 e 6); Tauri 2 con i plugin ufficiali per i file e per le finestre di dialogo (lato Rust); happy-dom per i test delle viste (già in `apps/desktop`).

**Specifica:** `docs/spec.md` (sezioni 2, 9, 20, 28, 36, 40 e 41) e il disegno approvato `docs/plans/2026-11-13-piano-6-primo-avvio-disegno.md` (13 novembre 2026, «Mie scelte» comprese). Fuori da questo piano: aggiornamenti firmati, Scadenze e pagamenti, Tasse e stime, iCloud e altri servizi (solo il punto di estensione), migrazione e backup.

## Metodo di esecuzione

- Come nei piani 4 e 6: un ramo, mai su `main`; per ogni task test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check`, commit; un revisore distinto per task, una revisione finale; PR, merge con commit di unione solo con la CI verde e il via di Carlo.
- Le regole di calcolo e i casi che il disegno non decide: l'esecutore si ferma con NEEDS_CONTEXT.
- Il Task 1 è una **prova**: se non regge, il ripiego concordato (comandi Rust propri) cambia la forma dei Task 1 e 6; l'orchestratore decide e lo scrive nel registro.

## Vincoli globali

- Valgono quelli dei piani 1, 2a, 4 e 6 (core puro: orologio e generatore di `id` sono argomenti, niente `node:*`; nomi in inglese, messaggi in italiano; nessun dato reale; test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core ≥ 90%).
- Percorsi in NFC; nomi di file senza `:` e senza caratteri vietati da Windows.
- Una cartella più nuova dell'app si apre in sola lettura e non si scrive mai (`checkCompat`).
- Nessun dato personale nei log: né nomi di utenti né percorsi.
- Le impostazioni per macchina (percorso della cartella, «chi sono io», lingua) non stanno mai nella cartella condivisa.

## Revisione mirata (Review Focus)

1. Una cartella sincronizzata a metà (un record o un file del registro manca): apertura in sola lettura, nessuna scrittura, nessuna riparazione senza il clic dell'utente (Task 4).
2. `createWorkspace` interrotto a metà e rilanciato: nessun secondo utente, nessun profilo sovrascritto, `workspace.json` scritto per ultimo (Task 3).
3. Una cartella con `workspace.json` non valido o con `schemaVersion` più nuova: sola lettura o rifiuto, mai una scrittura (Task 4).
4. L'utente scelto sulla macchina non esiste più nella cartella: la procedura lo chiede di nuovo, non scrive come utente fantasma (Task 6).
5. Un file di presenza vecchio di giorni, o scritto da una macchina con l'orologio sbagliato: nessun falso avviso «sta lavorando» (Task 5).

---

## Task 1: Prova dei permessi e `TauriStore`

**Files:** Modify `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/capabilities/*.json`, `apps/desktop/src-tauri/src/lib.rs` (registrazione dei plugin); Create `apps/desktop/src/tauri-store.ts`, `apps/desktop/test/tauri-store.test.ts`; Create `docs/rules/disco-app.md` (esito della prova).

**Interfaces:**
- Consumes: l'interfaccia `Store` (`readJson`, `writeJsonAtomic`, `list`, `readBytes`) di `packages/core/src/store/store.ts`.
- Produces: `class TauriStore implements Store` costruita con una cartella radice (stringa) e un oggetto `FsBackend` con le sole operazioni che usa (`readText`, `writeText`, `rename`, `readDir`, `readBytes`, `mkdir`, `exists`); `pickFolder(): Promise<string | null>` (finestra di dialogo).

- [ ] **Step 1: test che falliscono** con un `FsBackend` finto in memoria: `writeJsonAtomic` scrive un file temporaneo `.tmp-*` e lo rinomina (un lettore non vede mai metà file); `list` ordina, normalizza in NFC e non restituisce `.tmp-*`; `readJson` di un file inesistente dà `undefined` e di uno rotto lancia `MalformedJsonError`; gli stessi casi dei test di contratto di `FsStore` (`packages/store-fs/test`), ripetuti su `TauriStore`.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** `TauriStore` e `pickFolder`; aggiungere i plugin ufficiali dei file e delle finestre di dialogo con permessi ristretti (nessun permesso sull'intero disco): la cartella scelta entra nei permessi a runtime. Registrarli in `lib.rs`.
- [ ] **Step 4: la prova.** Verificare (anche solo con la costruzione in CI e una lettura del codice dei plugin, se non c'è Rust in locale) che una cartella scelta nel dialogo sia scrivibile, che l'autorizzazione resti dopo il riavvio e che la licenza dei plugin lato Cargo sia ammessa (strumento già usato dal progetto per `Cargo.lock`). Scrivere l'esito in `docs/rules/disco-app.md` con le parti **non verificate** dette chiaramente. Se non regge: fermarsi con NEEDS_CONTEXT e descrivere il ripiego (comandi Rust propri).
- [ ] **Step 5: lint, typecheck, test, `pnpm data:check`; commit.**

## Task 2: Profilo utente

**Files:** Modify `packages/core/src/model.ts` (`UserSchema`, `user` in `recordSchemas`), `docs/schemas/*.json` (`pnpm schemas:export`), `packages/core/src/index.ts`; Create `packages/core/src/users.ts`, `packages/core/test/users.test.ts`; Modify `packages/core/test/model.test.ts`, `packages/core/test/schemas-export.test.ts`, `scripts/export-schemas.test.mjs`.

**Interfaces:**
- Produces: `UserSchema` (`RecordBaseSchema` più `name: NonEmptyString`); tipo `User`; `createUser(store: Store, input: {id: string; name: string}, profileId: string, clock: () => string, newId: () => string): Promise<User>` (una operazione `users.create`, record in `_app/dati/user/<id>.json`; se il record esiste già con quell'`id` lo restituisce e non scrive nulla); `liveUsers(store: Store): Promise<User[]>` (non cancellati).

- [ ] **Step 1: test che falliscono:** `UserSchema` accetta un nome e rifiuta un nome vuoto; un `id` con `/` o `..` è rifiutato come non sicuro; `createUser` scrive una operazione e un file; richiamarla con lo stesso `id` non scrive altro (ripresa); `liveUsers` non restituisce un utente cancellato; l'operazione si annulla con `undoOperation`.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** schema, `createUser`, `liveUsers` con `commitChange` e `assertSafeSegment` come le altre scritture; rigenerare gli schemi.
- [ ] **Step 4: lint, typecheck, test (anche con `TZ=America/Los_Angeles`), `pnpm data:check`.**
- [ ] **Step 5: commit.**

## Task 3: `createWorkspace` e ripresa

**Files:** Create `packages/core/src/workspace.ts`, `packages/core/test/workspace.test.ts`; Modify `packages/core/src/index.ts`.

**Interfaces:**
- Consumes: `createUser` (Task 2), `seedProfiles` (piano 6, profili), `WorkspaceSchema`, `CORE_VERSION`.
- Produces: `createWorkspace(store: Store, input: {workspaceId: string; name: string; user: {id: string; name: string}}, seeds: unknown[], clock: () => string, newId: () => string): Promise<{workspace: Workspace; user: User; seeded: number}>`: rifiuta (`RangeError`) se esiste già `_app/workspace.json`; ordine: `createUser`, `seedProfiles`, poi `workspace.json` per ultimo con `schemaVersion` del core, `minAppVersion` uguale a `CORE_VERSION` e `createdAt` da `clock()`; rilanciarla con gli stessi `id` dopo un'interruzione riprende senza duplicare utente né profili.

- [ ] **Step 1: test che falliscono:** crea una cartella con utente, undici profili e `workspace.json` valido; rifiuta se `workspace.json` esiste; interruzione simulata dopo `createUser` (store che lancia alla seconda scrittura) e rilancio con gli stessi `id`: un solo utente, profili scritti una volta, `workspace.json` presente; `workspace.json` non esiste finché utente e profili non sono scritti.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** `createWorkspace`; scrivere `workspace.json` con `writeJsonAtomic`.
- [ ] **Step 4: lint, typecheck, test, `pnpm data:check`.**
- [ ] **Step 5: commit.**

## Task 4: Regole dei conflitti e `assessWorkspace`

**Files:** Modify `packages/core/src/store/load.ts` (rilevamento dei nomi di conflitto), `packages/core/src/journal.ts` (se serve esporre lo stato), `packages/core/src/index.ts`; Create `packages/core/src/assess.ts`, `packages/core/test/assess.test.ts`; Modify i test esistenti del rilevamento dei conflitti.

**Interfaces:**
- Produces: `type ConflictNameRule = {service: string; isConflictName(name: string): boolean}`; `DROPBOX_CONFLICT_RULE`; un parametro facoltativo `conflictRules?: ConflictNameRule[]` di `loadAll`/`loadDir` (predefinito: solo Dropbox, nessuna firma esistente cambia); `assessWorkspace(store: Store, appVersion: string, conflictRules?: ConflictNameRule[]): Promise<{compat: 'ok' | 'readonly' | 'upgrade-needed' | 'invalid'; sync: 'ok' | 'behind'; writable: boolean; problems: Problem[]}>`, con `writable` vero solo se `compat` è `ok`, `sync` è `ok` e `workspace.json` è valido; `sync` è `behind` se `checkConsistency` dà almeno un `diverged`.

- [ ] **Step 1: test che falliscono:** cartella pulita → `writable: true`; un record mancante rispetto al registro → `behind` e `writable: false`; `schemaVersion` più nuova → `readonly`; `workspace.json` rotto → `invalid` e non scrivibile; una copia in conflitto e un `id` doppio compaiono in `problems` ma non bloccano; una regola di prova per un secondo servizio riconosce un nome che quella di Dropbox non riconosce, e `loadAll` senza il parametro si comporta come prima (i test esistenti restano verdi).
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** estraendo il rilevamento esistente nella regola `DROPBOX_CONFLICT_RULE` e passando l'elenco; `assessWorkspace` unisce `findWorkspace`, `checkCompat`, i problemi di `loadAll` e `checkConsistency`. La riparazione resta `repairDiverged` esistente, chiamata solo dal chiamante.
- [ ] **Step 4: lint, typecheck, test, `pnpm data:check`.**
- [ ] **Step 5: commit.**

## Task 5: Presenza

**Files:** Create `packages/core/src/presence.ts`, `packages/core/test/presence.test.ts`; Modify `packages/core/src/index.ts`.

**Interfaces:**
- Produces: `type PresenceEntry = {userId: string; at: string}` (ISO con ora); `PRESENCE_DIR = '_app/presenza'`; `writePresence(store: Store, userId: string, now: string): Promise<void>` (scrive `_app/presenza/<userId>.json` con `writeJsonAtomic`, senza `id`, `v`, `rev` né registro); `readPresence(store: Store): Promise<PresenceEntry[]>` (ignora i file non validi); `othersActive(now: string, entries: PresenceEntry[], me: string, windowMinutes: number, toleranceMinutes?: number): string[]` (gli `userId` attivi, escluso `me`, con tolleranza predefinita di un minuto per orologi diversi; un'ora nel futuro oltre la tolleranza non conta).

- [ ] **Step 1: test che falliscono:** un utente con ultimo segnale 2 minuti fa e finestra 3 → attivo; 5 minuti fa → no; `me` mai incluso; un file di tre giorni fa non dà avviso; un segnale con ora nel futuro oltre la tolleranza non conta; un file non valido è ignorato; con fusi `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles` lo stesso risultato.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** le tre funzioni; nessun orologio nel core (l'ora è un argomento); `loadAll` non legge `_app/presenza`.
- [ ] **Step 4: lint, typecheck, test, `pnpm data:check`.**
- [ ] **Step 5: commit.**

## Task 6: Impostazioni per macchina e procedura guidata

**Files:** Create `apps/desktop/src/machine-settings.ts`, `apps/desktop/src/first-run.ts`, `apps/desktop/test/machine-settings.test.ts`, `apps/desktop/test/first-run.test.ts`; Modify `apps/desktop/src/main.ts` (solo l'aggancio, dietro un percorso `#primo-avvio` finché non c'è il resto dell'app), `apps/desktop/src/style.css`.

**Interfaces:**
- Consumes: `TauriStore`, `pickFolder` (Task 1), `createWorkspace` (Task 3), `assessWorkspace` (Task 4), `writePresence`/`readPresence`/`othersActive` (Task 5), `liveUsers`/`createUser` (Task 2).
- Produces: `loadMachineSettings(backend): Promise<{folder?: string; userId?: string; language?: string; pendingWorkspace?: {workspaceId: string; userId: string}}>` e `saveMachineSettings(backend, settings)` (cartella di configurazione dell'app, mai nella cartella condivisa); `renderFirstRun(root: HTMLElement, input: {...callback e dati...}): void` con le schermate «Crea gruppo», «Unisciti a un gruppo», scelta o creazione del profilo, e i messaggi di sola lettura, di sincronizzazione in corso (con il pulsante di riparazione che chiama `repairDiverged` solo al clic) e di presenza.

- [ ] **Step 1: test che falliscono** (happy-dom): «Crea gruppo» fissa e salva gli `id` in `pendingWorkspace` prima di scrivere e li riusa a un secondo tentativo; con `behind` mostra «sincronizzazione in corso o incompleta», disattiva le scritture e il clic sul pulsante di riparazione chiama la riparazione una volta; se `userId` della macchina non esiste in `liveUsers`, propone di sceglierne o crearne un altro; con un altro utente attivo mostra l'avviso di presenza con il suo nome; ogni schermata ha un solo pulsante principale.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** le due unità come funzioni sottili sul core, senza regole proprie; i testi sono quelli del disegno («Crea gruppo», «Unisciti a un gruppo»).
- [ ] **Step 4: `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm --filter desktop build`, `pnpm data:check`.**
- [ ] **Step 5: commit, poi la nota nel registro (`docs/progress.md`, R84) con tutte le scelte e i seguiti: schermata «Documento n di N», aggiornamenti firmati, iCloud.**

---

## Copertura del disegno

Obiettivo 1: Task 3; 2: Task 3 e 6; 3: Task 4 e 6; 4: Task 5 e 6; 5: Task 1; non obiettivi: nessun task. Scelte: sincronizzazione `ok`/`behind` e quando si scrive: Task 4; ripresa: Task 3; «chi sono io»: Task 6; presenza fuori dai record: Task 5; permessi: Task 1; regole dei conflitti: Task 4; versioni: Task 3.
