# App Bollette: Piano 4, utenze condivise e appartamento nuovo

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** quando una bolletta ha un'utenza sconosciuta, la schermata «Da rivedere» chiede «A chi appartiene l'utenza?», suggerisce l'appartamento dall'immobile scritto nell'avviso, controlla che le percentuali sommino al 100%, salva il collegamento (record `supply`) con una nota facoltativa e lo rende correggibile.

**Architettura:** tutta la logica sta nel core puro (`packages/core`): modello, suggerimento, bozza di collegamento con le sue regole, scritture con `commitChange`. Il lettore Python legge anche l'immobile di ogni utenza (TARI condivisa). L'app desktop (Vite, oggi senza framework) mostra due schermate sottili sopra la logica del core; nessuna regola vive nell'interfaccia.

**Stack tecnologico:** TypeScript strict, Vitest, Zod 4; Python 3.13 come nel piano 2a; Vite e TypeScript per l'interfaccia, **senza framework** (scelta di questo piano: due schermate, funzioni che costruiscono il DOM; si rivaluta quando le schermate crescono).

**Specifica:** `docs/spec.md` (sezioni 22, 29, 30, 42 R3) e il disegno approvato `docs/plans/2026-11-13-piano-4-utenze-disegno.md` (13 novembre 2026, «Mie scelte» comprese). Fuori da questo piano: procedura guidata «Aggiungi appartamento», suggerimento dal conto della banca, OCR, condominio.

## Metodo di esecuzione

- Come nel piano 2a: un ramo, mai su `main`; per ogni task test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check`, commit; un revisore distinto, correzioni fino a 5 giri; PR a fine piano, merge con commit di unione solo con la CI verde e il via di Carlo.
- Le regole di calcolo non si decidono da soli: l'esecutore si ferma con NEEDS_CONTEXT e l'orchestratore chiede a Carlo.

## Vincoli globali

- Valgono quelli del piano 1 e 2a (centesimi interi, core puro, test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`, copertura del core ≥ 90%, nomi in inglese, interfaccia in italiano, nessun dato reale nel repository, nessun dato personale nei log).
- **Percentuali in punti base interi** (100,00% = 10000), `z.int()`, mai virgola mobile. Per ogni utenza la somma è esattamente 10000.
- Indirizzo e catasto sono dati personali: restano nei record e nel risultato di lettura, mai nei log, mai nelle fixture se non inventati.
- Le note sono riservate ai proprietari (`visibleToTenants: false`).

## Revisione mirata (Review Focus)

1. Un avviso con due utenze dello stesso appartamento (somma delle quote su una stessa persona): `duplicate-apartment`, nessuna proposta (già coperto, resta nei test del Task 2).
2. Percentuali che sommano a 99,99% o 100,01%: conferma bloccata, mai arrotondata di nascosto (Task 3).
3. Indirizzo scritto con altra maiuscola, punteggiatura o «Via»/«V.»: il suggerimento deve comunque trovarlo, senza trovare l'appartamento sbagliato con lo stesso civico in un'altra via (Task 2).
4. Un collegamento cancellato mentre un documento è in revisione: il documento torna a `unknown-part`, nessuna rata registrata cambia (Task 4).
5. Due persone che modificano la stessa utenza: la seconda scrittura fallisce con `StaleWriteError` e l'interfaccia lo dice invece di sovrascrivere (Task 4).

---

## Task 1: Modello (punti base, indirizzo, catasto, `supplyId`, note)

**Files:** Modify `packages/core/src/model.ts` (`SupplySchema`, `ApartmentSchema`, `InstalmentSchema`, `NoteSchema.targetType`), `packages/core/src/proposal.ts` (usa i punti base), i test collegati (`model.test.ts`, `proposal.test.ts`, `confirmation.test.ts`), `docs/schemas/*.json` rigenerati con `pnpm schemas:export`.

**Interfaces:**
- Produces: `Supply.apartments[].weight`: intero 1…10000; refine: somma esattamente 10000 e appartamenti distinti. `Apartment.address?: string` (non vuoto) e `Apartment.cadastre?: {sheet: string; parcel: string; sub: string}[]` (campi non vuoti). `Instalment.supplyId?: string`. `Note.targetType` accetta `'supply'`.

- [ ] **Step 1: test che falliscono.** In `model.test.ts`: `SupplySchema` rifiuta pesi `[5000, 4999]`, `[10001]`, `[0, 10000]`, `[]`; accetta `[10000]` e `[2500, 7500]`; `ApartmentSchema` accetta `address` e `cadastre` e li rifiuta vuoti; `InstalmentSchema` accetta `supplyId`; `NoteSchema` accetta `targetType: 'supply'`.
- [ ] **Step 2: eseguire e vedere il fallimento** (`pnpm exec vitest run packages/core/test/model.test.ts`).
- [ ] **Step 3: implementare** le modifiche allo schema; in `proposal.ts` i pesi passano a `splitCents` come punti base (nessun altro cambio di calcolo) e le rate nate da un'utenza portano `supplyId`. Aggiornare le fixture dei test con pesi 1 e 2 in punti base (10000, 3333/6667 con somma 10000).
- [ ] **Step 4: `pnpm schemas:export`, poi lint, typecheck e test.**
- [ ] **Step 5: commit** («feat(core): utenze in punti base, indirizzo e catasto, supplyId»).

## Task 2: Suggerimento dell'appartamento e controlli con i nuovi messaggi

**Files:** Create `packages/core/src/suggest.ts`, `packages/core/test/suggest.test.ts`; Modify `packages/core/src/proposal.ts` (messaggi), `packages/core/src/extraction.ts` (parte con `property`), `packages/core/src/index.ts` (export).

**Interfaces:**
- Consumes: `Apartment` (Task 1), `ExtractionResult.parts`.
- Produces: `ExtractionResult.parts[].property?: {address: string; sheet?: string; parcel?: string; sub?: string}`; `suggestApartments(property: Part['property'], apartments: Pick<Apartment,'id'|'address'|'cadastre'>[]): {apartmentId: string; origin: 'catasto' | 'indirizzo'}[]` (catasto per uguaglianza di foglio, particella e subalterno; indirizzo per uguaglianza di via e numero civico dopo normalizzazione senza maiuscole, accenti, punteggiatura e con «via»/«v.» uniformati; mai più di un'origine per appartamento, `catasto` prima di `indirizzo`).

- [ ] **Step 1: test che falliscono** (`suggest.test.ts`): stesso catasto trova l'appartamento con origine `catasto`; indirizzo scritto «GAL. G. BERCHET 3» contro «Galleria G. Berchet 3» trova `indirizzo`; stesso civico in altra via non trova nulla; appartamento senza `address` e senza `cadastre` mai suggerito; `property` assente dà `[]`.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** `suggestApartments` in `suggest.ts` e aggiungere `property` a `ExtractionResult.parts` (facoltativo). Nei controlli di `proposal.ts` i messaggi di `unknown-part`, `duplicate-supply`, `part-share` sono quelli del disegno («Collegala qui sotto.», «Apri Impostazioni, Utenze e correggi: …», «La percentuale è troppo piccola per questo importo. Controlla le percentuali.»); aggiornare i test esistenti che li citano.
- [ ] **Step 4: lint, typecheck, test.**
- [ ] **Step 5: commit.**

## Task 3: Bozza del collegamento (regole della schermata)

**Files:** Create `packages/core/src/supply-link.ts`, `packages/core/test/supply-link.test.ts`; Modify `packages/core/src/index.ts`.

**Interfaces:**
- Consumes: `suggestApartments` (Task 2), `Supply`.
- Produces: tipo `SupplyDraft = {label: string; rows: {apartmentId: string; basisPoints: number}[]; note: string}`; `newDraft(label: string, suggested: {apartmentId: string}[]): SupplyDraft` (una riga al 100% se c'è un suggerimento solo, altrimenti righe vuote); `draftTotal(draft): number`; `draftProblem(draft): string | undefined` (messaggi italiani: «Il totale è 85%: manca il 15%», «Il totale è 101%: sono 1% di troppo», appartamento ripetuto, nessuna riga); `draftToSupply(draft, ids: {newId: () => string}): Omit<Supply, 'v' | 'rev'>`, che lancia `RangeError` se `draftProblem` non è `undefined`.

- [ ] **Step 1: test che falliscono:** totale 8500 dà «manca il 15%»; 10001 dà «di troppo»; 9999 dà il messaggio e `draftToSupply` lancia; riga ripetuta; una riga da 10000 è valida; la nota vuota non crea nulla di strano.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** in `supply-link.ts`; il testo percentuale usa due decimali con la virgola («33,33%»).
- [ ] **Step 4: lint, typecheck, test.**
- [ ] **Step 5: commit.**

## Task 4: Scritture del collegamento, modifica atomica, note

**Files:** Create `packages/core/src/supply-store.ts`, `packages/core/test/supply-store.test.ts`; Modify `packages/core/src/notes.ts` solo se serve esporre le note di un'utenza (`notesFor` esiste già).

**Interfaces:**
- Consumes: `Store`, `commitChange(store, input, clock, newId)`, `SupplySchema`, `draftToSupply` (Task 3), `NoteSchema`.
- Produces: `linkSupply(store: Store, draft: SupplyDraft, profileId: string, clock: () => string, newId: () => string): Promise<Supply>` (un'operazione `supply.link`, scrive il record `supply` e, se `draft.note` non è vuota, una nota con `targetType: 'supply'`; tutto nella stessa operazione); `updateSupply(store, supply: Supply, draft: SupplyDraft, profileId, clock, newId): Promise<Supply>` (una sola scrittura, `StaleWriteError` se il record è cambiato); `removeSupply(store, supply: Supply, profileId, clock, newId): Promise<Supply>` (cancellazione logica `deleted: true`); `liveSupplies(store: Store): Promise<Supply[]>` (non cancellate).

- [ ] **Step 1: test che falliscono** con uno store in memoria dei test esistenti: `linkSupply` scrive record e nota in un'operazione; con bozza non valida non scrive niente; `updateSupply` rifiuta una somma ≠ 10000 e non lascia stati a metà; due `updateSupply` concorrenti sullo stesso record: il secondo dà `StaleWriteError`; `removeSupply` imposta `deleted` e `liveSupplies` non la restituisce più; una `proposalFromExtraction` con la lista dopo `removeSupply` torna a `unknown-part` e non cambia le rate già registrate.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** con `commitChange` e le funzioni di journal esistenti (sia l'operazione sia i record con `expectedRev` come in `confirmProfile`).
- [ ] **Step 4: lint, typecheck, test.**
- [ ] **Step 5: commit.**

## Task 5: Lettore Python, immobile di ogni utenza

**Files:** Modify `python/bollette_pdf/extract.py` (`_parts`), `python/bollette_pdf/schemas.py` (controllo del pattern `parts.property`), `packages/core/src/model.ts` (`parts.property` nello schema del profilo), `python/seed-profiles/acegas-tari-2024.json` e `acegas-tari-2024-b.json`, `python/tests/data/profile-cases.json`, `python/tests/test_extract.py`, `fixtures/pdf/acegas-tari-05.json` (indirizzo e catasto inventati), `python/tests/test_real_layouts.py`; `docs/schemas/*.json`.

**Interfaces:**
- Produces: `parts.property?: {pattern: string}` nel profilo, con almeno 5 gruppi di cattura: etichetta dell'utenza, indirizzo, foglio, particella, subalterno (i gruppi non trovati danno un campo assente); nel risultato `parts[].property = {address, sheet?, parcel?, sub?}`. Nessuna regola di suddivisione dell'immobile sta nel codice: la fanno i gruppi del profilo.

- [ ] **Step 1: test che falliscono:** caso comune di profilo con `parts.property` valido e con un solo gruppo (rifiutato); `test_extract.py` con un documento sintetico a due utenze; `test_real_layouts.py` aspetta `property` per `acegas-tari-05` con valori inventati e nessuno per le altre fixture.
- [ ] **Step 2: eseguire e vedere il fallimento** (`PYTHON=<venv> pnpm python:test`).
- [ ] **Step 3: implementare:** `_parts` dopo `add` legge `property` con lo stesso metodo (per etichetta); schema Zod e controlli Python allineati; pattern nei due profili TARI sul layout reale («Immobile n.1: … / mq. … / Dati Catastali: Fog. … Num. … Sub. …») scritto con valori solo nelle fixture inventate.
- [ ] **Step 4: `pnpm schemas:export`, test Python e del core, `pnpm data:check`.**
- [ ] **Step 5: commit.**

## Task 6: Interfaccia «Da rivedere» e scheda «Utenze»

**Files:** Create `apps/desktop/src/supply-link-view.ts`, `apps/desktop/src/supplies-view.ts`, `apps/desktop/test/supply-link-view.test.ts`, `apps/desktop/test/supplies-view.test.ts`; Modify `apps/desktop/src/main.ts`, `apps/desktop/src/style.css`.

**Interfaces:**
- Consumes: `newDraft`, `draftTotal`, `draftProblem` (Task 3), `linkSupply`, `updateSupply`, `removeSupply`, `liveSupplies` (Task 4), `suggestApartments` (Task 2).
- Produces: `renderSupplyLink(root: HTMLElement, input: {label: string; suggested: ReturnType<typeof suggestApartments>; apartments: {id: string; name: string}[]; onConfirm: (draft: SupplyDraft) => Promise<void>}): void` (elenco di righe con appartamento e percentuale, «+ Aggiungi appartamento», totale e messaggio in tempo reale, campo nota facoltativo, un solo pulsante «Collega e continua» disattivato se `draftProblem` non è `undefined`, etichette «da catasto» e «da indirizzo»); `renderSupplies(root, input: {supplies: Supply[]; apartments: {id: string; name: string}[]; notes: Note[]; onUpdate; onRemove; onAddNote}): void`.

- [ ] **Step 1: test che falliscono** (Vitest con `happy-dom` se già in uso, altrimenti con funzioni che costruiscono un albero testabile senza DOM reale): il pulsante è disattivato a 85%, attivo a 100%; il suggerimento è già selezionato e mostra la sua origine; con un solo appartamento la percentuale non si chiede; il messaggio del totale cambia scrivendo; la scheda mostra le note dell'utenza.
- [ ] **Step 2: eseguire e vedere il fallimento.**
- [ ] **Step 3: implementare** le due viste come funzioni pure sul DOM che chiamano solo il core; nessun calcolo nell'interfaccia. Collegarle in `main.ts` solo con dati di prova locali (nessuna procedura «Documento n di N» in questo piano).
- [ ] **Step 4: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter desktop build`.**
- [ ] **Step 5: commit, poi `docs/progress.md` (R82) e la PR di fine piano.**

---

## Copertura del disegno

Obiettivi 1-3 e 5: Task 1, 3, 6; suggerimento: Task 2 e 5; nota: Task 1, 4, 6; correzione e messaggi: Task 2, 4, 6; obiettivo 6 e non obiettivi: nessun task (rimangono fuori); punti base, `supplyId`, indirizzo e catasto: Task 1.
