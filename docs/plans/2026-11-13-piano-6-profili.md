# App Bollette: Piano 6 (parte «profili»), i profili dei fornitori arrivano con l'app

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** copiare i profili di `python/seed-profiles/` tra i dati dell'utente, una sola volta, alla creazione dell'area di lavoro, con una sola operazione annullabile del registro.

**Architettura:** una funzione pura del core (`seedProfiles`) riceve i profili già letti e li scrive con `commitChange`; l'installer Tauri porta i file come risorse. Il primo avvio, che chiamerà la funzione, non è in questo piano.

**Stack tecnologico:** TypeScript strict, Vitest, Zod 4 (come i piani 1, 2a e 4); Tauri 2 (risorse); Node per lo script dell'installer.

**Specifica:** `docs/spec.md` (sezioni 7 e 34) e il disegno approvato `docs/plans/2026-11-13-piano-6-profili-disegno.md` (13 novembre 2026). Fuori da questo piano: il primo avvio, ogni aggiornamento dei profili dopo la creazione dell'area di lavoro, schermate e editor dei profili.

## Metodo di esecuzione

- Come nel piano 4: un ramo, mai su `main`; per ogni task test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check`, commit; un revisore distinto per task, una revisione finale; PR, merge con commit di unione solo con la CI verde e il via di user1.

## Vincoli globali

- Valgono quelli dei piani 1, 2a e 4 (core puro: orologio e generatore di `id` sono argomenti, niente `node:*`; nomi in inglese, messaggi in italiano; nessun dato reale; test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura del core ≥ 90%).
- Mai sovrascrivere un profilo che esiste già con quell'`id`.
- Gli avvisi non citano mai il contenuto di un profilo.

## Revisione mirata (Review Focus)

1. Chiamata ripetuta dopo un'interruzione: i profili già scritti restano come sono, compresi `confermato` e `autoRegister` (Task 1).
2. Un solo profilo rotto tra undici: gli altri dieci si scrivono, il rotto si segnala senza il suo contenuto (Task 1).
3. L'elenco dei profili è vuoto: nessuna operazione e nessun file scritto (Task 1).
4. L'installer senza i file dei profili: la costruzione fallisce con un messaggio chiaro invece di produrre un'app senza fornitori (Task 2).

---

## Task 1: `seedProfiles` nel core

**Files:** Create `packages/core/src/seed-profiles.ts`, `packages/core/test/seed-profiles.test.ts`; Modify `packages/core/src/index.ts` (export).

**Interfaces:**
- Consumes: `Store`, `commitChange(store, input, clock, newId)` (`journal.ts`), `SupplierProfileSchema`, `recordPath`/`loadAll` (`store/`), `undoOperation`.
- Produces: `seedProfiles(store: Store, seeds: unknown[], profileId: string, clock: () => string, newId: () => string): Promise<{ written: SupplierProfile[]; skipped: { id: string | null; reason: 'invalid' | 'exists' }[] }>`.

- [ ] **Step 1: test che falliscono** (`seed-profiles.test.ts`, store in memoria dei test esistenti): undici profili validi (si possono generare dai veri `python/seed-profiles/*.json` letti nel test con `node:fs`, solo nel test) scrivono undici file in `_app/dati/supplierProfile/` con una sola operazione `profiles.seed` e riassunto «Profili dei fornitori iniziali: 11»; un profilo con `kind: 'tari'` e `category` (non valido) si salta con `reason: 'invalid'` e `id` `null` se non leggibile, gli altri si scrivono; un `id` già presente non si sovrascrive (`reason: 'exists'`, il record su disco resta identico, anche `status: 'confermato'`); elenco vuoto o tutti saltati: nessuna operazione nel giornale; `undoOperation` dell'operazione segna i record cancellati.
- [ ] **Step 2: eseguire e vedere il fallimento** (`pnpm exec vitest run packages/core/test/seed-profiles.test.ts`).
- [ ] **Step 3: implementare** `seedProfiles`: ogni elemento di `seeds` passa da `SupplierProfileSchema.safeParse` (`id`, `v`, `rev` letti dal file); se `v`/`rev` mancano il profilo è non valido; un profilo il cui record esiste già (`readJson(recordPath(...))` non `undefined`) si salta; i validi nuovi vanno in un solo `commitChange` con un cambio ciascuno (`before` assente). Nessun `warnings` con testo dei profili: solo `id` e `reason`.
- [ ] **Step 4: lint, typecheck, test** (anche con `TZ=America/Los_Angeles`).
- [ ] **Step 5: commit.**

## Task 2: le risorse dell'installer

**Files:** Modify `apps/desktop/src-tauri/tauri.conf.json` (risorse), `scripts/bundle-python.mjs` o uno script nuovo accanto (controllo dei file), `scripts/bundle-python.test.mjs` (o test nuovo); Modify `docs/progress.md` (R83) e `docs/rules/lettura-pdf.md` se serve.

**Interfaces:**
- Produces: la cartella `seed-profiles/` accanto a `python/` nelle risorse dell'app, con gli stessi file di `python/seed-profiles/*.json`; una funzione `checkSeedProfiles(dir: string, expectedMin: number): string[]` (elenco dei file trovati; lancia un `Error` con messaggio italiano se la cartella manca, se ci sono meno di `expectedMin` file `.json` o se un file non è JSON).

- [ ] **Step 1: test che falliscono:** `checkSeedProfiles` su una cartella con 11 JSON restituisce 11 nomi; con 3 file lancia «mancano i profili iniziali»; senza cartella lancia; con un file non JSON lancia senza citarne il contenuto; un test legge `tauri.conf.json` e verifica che le risorse includano `seed-profiles/`.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare:** aggiungere `python/seed-profiles/` alle risorse in `tauri.conf.json` (come già `resources/python/`) e chiamare `checkSeedProfiles(…, 10)` dallo script di costruzione dell'installer prima della compilazione; spiegare in R83 che il primo avvio, quando esisterà, legge i file dalle risorse e chiama `seedProfiles`.
- [ ] **Step 4: lint, typecheck, test, `pnpm data:check`.**
- [ ] **Step 5: commit.**

---

## Copertura del disegno

Obiettivo 1: Task 1; obiettivo 2: Task 2; obiettivo 3 e non obiettivi: nessun task (restano fuori); una sola operazione e annullamento: Task 1; installer senza file: Task 2.
