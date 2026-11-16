# App Bollette: Piano 5b, Excel riservato ai proprietari

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** dal caricamento del piano 5 (`loadExcelInput`) si genera l'`.xlsx` riservato ai proprietari di un appartamento e di un periodo: le rate di condominio intere (ordinarie e straordinarie) con rata, conguaglio dell'anno prima, quota della proprietà, addebito atteso e addebitato, data dell'addebito e stato del pagamento.

**Architettura:** `excel-owners.ts` (puro) costruisce un `XlsxWorkbook` di un foglio senza `calcConguaglio`; `writeXlsx` del piano 5 lo scrive; `pnpm excel --proprietari` lo salva con la scrittura senza sovrascrittura di R156.

**Specifica:** il disegno `2026-11-16-piano-5b-proprietari-disegno.md` (decisioni 1-9, «Il file generato», «Mie scelte» 1-3, domande 1-6 **aperte**); `docs/spec.md` sezioni 12, 19, 20, R2, R3, R7, R8. Regole da R174 (gli altri rami prendono R1xx in parallelo).

## Metodo di esecuzione

- Ramo `feat/piano-5-bis`, dopo i task 8-11 del piano 5. Per ogni task: test rosso, codice, `pnpm lint`, `pnpm typecheck`, test toccati (i test della riga di comando da soli), `TZ=Pacific/Auckland` sui test del core, `node scripts/check-personal-data.mjs`, commit.
- Le domande 1-6 del disegno sono aperte: nessun task le decide.

## Vincoli globali

Quelli del piano 5 (centesimi interi, core puro, deterministico, nessun dato personale nell'uscita della riga di comando, fixture sintetiche, nessuna libreria nuova). In più: **nessun dato degli inquilini** nel file dei proprietari (test).

## Task 1: il file dei proprietari

**Files:** Create `packages/core/src/excel-owners.ts`, `packages/core/test/excel-owners.test.ts`; Modify `packages/core/src/conguaglio.ts` (esporta la quota della proprietà come `instalmentOwnerShare`), `packages/core/src/index.ts`, `docs/progress.md`.

**Interfaces:**

- `OWNERS_SHEET = 'Condominio'`, `OWNERS_HEADERS` (le colonne del disegno, in un punto solo).
- `ownersItems(input: ConguaglioInput): OwnersItem[]` e `buildOwnersWorkbook(input: ConguaglioInput): XlsxWorkbook`.
- `OwnersItem`: `instalmentId`, `esercizio`, `rateIndex`, `rateCount`, `straordinaria`, `from`, `to`, `dueDate`, `rata`, `conguaglioPrec`, `ownerShare`, `expected`, `debited?`, `commission`, `debitDates`, `status` (`pagata` | `assunta` | `in-attesa`).

- [ ] **Step 1: test che falliscono.** Fixture: la rata `inst-cond-1` con le sue colonne e lo stato; varianti: straordinaria (quota = atteso), rata senza abbinamenti (in attesa, Addebitato vuoto), solo abbinamenti assunti (assunta, Addebitato vuoto), rata 0 con conguaglio (quota 0); una rata della TARI e una di un altro appartamento non ci sono; Totale; nessun testo degli inquilini (`Tenant.name`); ingresso mescolato → stessi byte; SHA-256 fisso.
- [ ] **Step 2:** i test falliscono.
- [ ] **Step 3: implementare**; R174.
- [ ] **Step 4:** lint, typecheck, test, `TZ=Pacific/Auckland`.
- [ ] **Step 5: commit** `feat(core): Excel riservato ai proprietari con le rate di condominio (piano 5b, task 1)`.

## Task 2: `pnpm excel --proprietari`

**Files:** Modify `scripts/excel.mjs`, `scripts/excel.test.mjs`, `docs/progress.md`.

- `--proprietari` (booleano): scrive `writeXlsx(buildOwnersWorkbook(input))`; **`--uscita` obbligatorio** (domanda 2 aperta: senza → 2 `bad-arguments`); nessun controllo `missing-tenant` né `settlement-input` (il file non usa le presenze).
- Uscita: `{ status: 'written', apartmentId, period, sheets: 1, items, pending }` (`pending` = rate in attesa), come quella dell'Excel degli inquilini.
- [ ] **Step 1: test che falliscono:** scrive i byte attesi, la seconda volta `file-exists`, senza `--uscita` → 2, uscita senza nomi, importi né percorsi.
- [ ] **Step 2-5** come il task 1; R175; commit `feat(cli): pnpm excel --proprietari (piano 5b, task 2)`.

## Autoverifica

- Decisioni 1-9 → task 1 (1, 2, 3, 4, 5, 6, 7, 9) e task 2 (8). Domande 1-6: nessun task le decide.
- `loadExcelInput` (piano 5) è l'unico caricamento; `writeXlsx` l'unico scrittore.

## Task 3: risposte di user1 (16 novembre 2026)

**Files:** Modify `packages/core/src/excel-owners.ts`, `scripts/excel.mjs`, i loro test, `docs/progress.md` (R184; R180-R183 sono di un altro ramo).

- Riga in cima `Conguaglio provvisorio: voci in attesa N` (N = rate `in attesa di pagamento` o `importo diverso`), sopra le intestazioni.
- Stato `importo diverso` quando la somma degli addebiti non assunti è diversa dall'addebito atteso; nessun «duplicato».
- `ownersFilePath`: `Riservato_proprietari/Excel/<Appartamento>/<periodo>/Proprietari_<Appartamento>_<periodo>.xlsx`; `pnpm excel --proprietari` senza `--uscita` scrive lì (cartelle create, collegamenti e file al posto delle cartelle rifiutati come R176).
- Restano fuori TARI, banca, saldo tra conti, IMU; periodo e rate a cavallo come sono.

