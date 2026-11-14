# App Bollette: Piano 3a, conti ed estratti

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** importare l'estratto di un conto (XLSX o CSV) in movimenti normalizzati, una sola volta per movimento, con il periodo coperto dal file o dato da Carlo. Doppioni possibili e movimenti non contabilizzati restano in revisione finché una persona non decide. I periodi coperti valgono per il conto che li ha, e una riga di comando importa e stampa solo conteggi.

**Architettura:** Python (`python -I -m bollette_pdf table`) trasforma l'XLSX in una tabella JSON di celle tipizzate con la sola libreria standard. Il core (puro) legge anche i CSV nella stessa tabella. `readStatementTable` applica il profilo della banca (dati, non codice) e dà righe normalizzate o un errore con riga e campo, mai il valore. `importStatement` scrive in un'operazione il record `statement` e i movimenti nuovi. L'`id` dei movimenti è l'impronta di `transactionKey`, con il conto nell'identità. `matchToTransactions` usa periodi coperti per conto. Lo script `pnpm estratti` lega tutto con `FsStore`.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; Python 3.13 con la sola libreria standard per l'XLSX (`zipfile`, `xml.etree`): nessuna dipendenza nuova.

**Specifica:** il disegno approvato `docs/plans/2026-11-14-piano-3-csv-disegno.md` (14 novembre 2026: «Risposte», «Mie scelte», sotto-piano 3a); `docs/spec.md` sezioni 11, 13, 20, 42 (R2, R7). Fuori da 3a: inquilini, paganti, entrate (3b), uscite, F24, giroconti, saldi (3c), IMU (3d), interfaccia, spostamento del file.

## Metodo di esecuzione

- Come nei piani precedenti: un ramo, mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `REQUIRE_PYTHON=1 pnpm test`, `pnpm python:test`, `pnpm data:check`, commit. Un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; poi una revisione finale e la PR.
- Le regole nuove vanno in `docs/progress.md` dalla **prossima R libera** di `docs/progress.md` (controllare con `grep` prima di scrivere; il Task 1 ha preso R99).
- Le regole di calcolo e di confidenza non si decidono da soli: NEEDS_CONTEXT e si chiede a Carlo.
- **Il profilo della banca è SINTETICO** (`fixtures/bank/profilo-sintetico.json`, colonne e formati ipotizzati da `docs/spec.md` sezione 18 e da `docs/rules/conguaglio-rules.md`). Lo sostituisce il Task 9 (3a-bis), solo dopo l'uscita di `python/tools/xlsx_structure.py` sui file di Carlo.

## Vincoli globali

- Importi in `Cents` interi, date `YYYY-MM-DD`, calcoli sulle date con interi e UTC; test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura almeno 90% sulle righe di `packages/core/src`.
- `packages/core` puro: niente `node:*`, rete, `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; orologio (`clock: () => string`) e `newId: () => string` sono argomenti; l'impronta è `hashBytes` (Web Crypto).
- Python: nessuna rete, nessun orologio, stdout UTF-8, un solo JSON per chiamata, `python -I -m bollette_pdf`; nessun `float` verso il core: i numeri escono come testo (Task 4).
- Record con `id`, `v: 1`, `rev`, mai cancellati dal disco (`deleted`). Campi nuovi dei record esistenti solo opzionali; nessuna migrazione (nessun movimento reale è salvato).
- Estratti e movimenti **non cifrati** (decisione 1). Si salvano solo data, importo, causale, codice disposizione, controparte e stato contabilizzato; la categoria della banca no.
- Nessun dato reale: fixture sintetiche, numeri inventati, solo IBAN della tabella di `fixtures/README.md`. Un IBAN di test nuovo si aggiunge lì con una nota. Nessun file binario: gli XLSX dei test si costruiscono durante il test.
- Messaggi in italiano e costanti, senza valori del file: mai causali, nomi, IBAN, importi, percorsi nei messaggi d'errore, nei `summary` del registro o nell'uscita predefinita della riga di comando.
- Valori esatti dal disegno:
  - periodo coperto dal file se il profilo lo legge, altrimenti dato a mano (`--dal`, `--al`), mai dalle date dei movimenti;
  - doppione possibile = stessa data e importo di un movimento esistente dello stesso conto, causale diversa, giorno già coperto da un altro estratto;
  - un movimento non contabilizzato si esclude solo dopo conferma;
  - percorso proposto `Riservato_proprietari/Estratti_conto/<Appartamento>/<annualità>/AAAA-MM-GG_Estratto_<Banca>_AAAA-MM.<ext>`.

## Revisione mirata (Review Focus)

1. **Periodo e file ripetuto (Task 7).** Il periodo dichiarato nel file e quello dato a mano sono diversi, oppure una riga cade fuori dal periodo: rifiuto, nessuna scrittura. Lo stesso file importato una seconda volta, anche su un altro conto, è `already-imported` e non scrive nulla.
2. **Righe doppie (Task 2 e 7).** Due righe identiche nello stesso giorno sono due movimenti, non uno. Il file di oggi riletto domani con una riga identica in più aggiunge solo quella.
3. **XLSX insidiosi (Task 4 e 5).** Date seriali con `date1904="1"` o come testo `27/10/2026`; numeri `-92.810000000000002` (esce `-92.81`) e `1234.5`. Un numero `1.234` (tre decimali) è un errore, mai 1.234 €. Celle vuote in mezzo alla riga, stringhe condivise e `inlineStr`.
4. **Segno e conto sbagliato (Task 5 e 7).** Senza segno: importo positivo con colonna «Segno» dal valore sconosciuto, dare e avere entrambi pieni o entrambi vuoti, importo 0. Conto sbagliato: IBAN dichiarato nel file diverso da `account.iban`, conto cancellato, profilo diverso da `account.bankProfileId`. Ognuno è un errore con riga e codice.
5. **Difetto di `match.ts` (Task 2).** Un estratto del conto di Berchet non rende «in attesa» le voci di Pulci, che restano «assunte». Una rata con `paidFromApartmentId` di Berchet è coperta dall'estratto di Berchet, non da quello del suo appartamento.

---

## Task 1: record `account`, `bankProfile`, `statement`; campi nuovi del movimento

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/index.ts`, `docs/schemas/*.json` (`pnpm schemas:export`); Create `packages/core/src/iban.ts`; Test `packages/core/test/model.test.ts`, `iban.test.ts`.

**Interfaces:**

- Consumes: `RecordBaseSchema`, `ISODateSchema`, `PatternSchema` (da esportare dal modulo, oggi interno), `recordSchemas`.
- Produces:
  - `normaliseIban(text: string): string | undefined`: toglie spazi, maiuscole, controllo mod-97; `undefined` se non valido.
  - `AccountSchema`: `apartmentId`, `label`, `bankProfileId`, `iban?` (già normalizzato, refine con `normaliseIban(iban) === iban`), `holder?`.
  - `BankProfileSchema`: `bank`, `validFrom`, `validTo?`, `container: 'xlsx' | 'csv'`, `csvSeparator?: ';' | ','`, `header: { allOf: string[] }` (etichette, confrontate con `foldText`).
    - Colonne (`columns`): `{ date, description: string[], amount?, debit?, credit?, sign?, dispCode?, pending? }` (etichette).
    - Formati: `dateFormat: 'DD/MM/YYYY' | 'YYYY-MM-DD'`, `signValues?: { debit: string[]; credit: string[] }`, `pendingValues?: string[]`.
    - Espressioni: `dispCodePattern?`, `counterparty?: { name?: Pattern; iban?: Pattern }`, `periodPattern?` (2 gruppi, date), `accountPattern?` (1 gruppo).
    - Refine: o `amount` o `debit` e `credit` insieme; `sign` solo con `amount` e con `signValues`; `pending` solo con `pendingValues`.
  - `StatementSchema`:
    - `id` = impronta del file; `accountId`, `bankProfileId`, `fileName`, `suggestedPath`;
    - `from`, `to`, `periodSource: 'file' | 'manual'`, `rowCount`, `transactionIds: string[]` (righe scritte o già presenti);
    - `held: { row: number; reason: 'possible-duplicate' | 'pending'; transaction: BankTransaction; decision?: 'keep' | 'exclude' }[]`.
  - `BankTransaction`: campi opzionali `accountId`, `counterparty?: { name?: string; iban?: string }`, `booked?: boolean`.
  - `recordSchemas` con `account`, `bankProfile`, `statement`.

- [ ] **Step 1: test che falliscono.** `normaliseIban(' it60 x054 2811 1010 0000 0123 456 ')` dà `'IT60X0542811101000000123456'`; con una cifra cambiata dà `undefined`. `BankProfileSchema` rifiuta `amount` più `debit`, il solo `debit`, `sign` senza `signValues`, `periodPattern` con un gruppo; accetta `fixtures/bank/profilo-sintetico.json`. `AccountSchema` rifiuta un IBAN non normalizzato. `StatementSchema` rifiuta `from` dopo `to`. Un `BankTransaction` senza i campi nuovi resta valido.
- [ ] **Step 2:** `pnpm test -- model iban` fallisce.
- [ ] **Step 3: implementare**; creare `fixtures/bank/profilo-sintetico.json` (ipotesi, con nota in `fixtures/README.md`) e lanciare `pnpm schemas:export`.
- [ ] **Step 4:** lint, typecheck, test, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): conti, profili della banca ed estratti nel modello (piano 3a, task 1)`.

## Task 2: conto nell'identità del movimento e periodi coperti per conto

**Files:** Modify `packages/core/src/dedupe.ts`, `packages/core/src/match.ts`, `packages/core/test/match.test.ts` (periodi con il conto), `docs/progress.md` (prossima R libera); Test `dedupe.test.ts`, `match.test.ts`.

**Interfaces:**

- Consumes: `transactionKey`, `keyTransactions`, `MatchInput`.
- Produces:
  - `DebitIdentity` con `accountId?: string`: con il conto le parti sono `['account', accountId, date, amount, foldText(description)]`, senza restano quelle di oggi (le impronte di oggi non cambiano).
  - `MatchInput.statementPeriods: { apartmentId: string; from: ISODate; to: ISODate }[]`, obbligatorio: un periodo copre solo le voci il cui conto pagante (`node.account`) è `apartmentId`.

- [ ] **Step 1: test che falliscono.**
  - Due movimenti uguali su `acc-1` e `acc-2` dello stesso appartamento hanno `id` diversi; senza `accountId` l'impronta è uguale a quella di oggi (valore fissato nel test esistente).
  - Tre righe identiche nello stesso giorno danno occorrenze 0, 1, 2; la stessa lista con una quarta riga identica dà gli stessi primi tre `id`.
  - `match`: con il solo periodo di `berchet` la bolletta di `pulci` dello stesso mese è `assumed`, quella di `berchet` senza addebito è `pending`; una rata di `lovarini` con `paidFromApartmentId: 'berchet'` è coperta dal periodo di `berchet`.
- [ ] **Step 2:** `pnpm test -- dedupe match` fallisce.
- [ ] **Step 3: implementare**; aggiornare i test di `match` esistenti con il conto nei periodi; scrivere la prossima R libera.
- [ ] **Step 4:** lint, typecheck, test con i due `TZ` passano.
- [ ] **Step 5: commit** `fix(core): periodi coperti per conto e conto nell'impronta del movimento (piano 3a, task 2)`.

## Task 3: tabella dell'estratto e lettore CSV

**Files:** Create `packages/core/src/statement-table.ts`; Modify `index.ts`; Test `packages/core/test/statement-table.test.ts`.

**Interfaces:**

- Produces:
  - `StatementCellSchema`: `{ t: 's', v: string } | { t: 'n', v: string } | { t: 'd', v: ISODate } | null`, dove `n` è un decimale in testo con il punto.
  - `StatementTableSchema = z.object({ v: z.literal(1), sheets: z.array(z.object({ name: z.string(), rows: z.array(z.array(StatementCellSchema)) })).min(1) })`.
  - `parseCsv(text: string, separator: ';' | ','): StatementTable`: un foglio, BOM tolto, `\r\n` e `\n`, virgolette doppie con `""`, ogni cella `{ t: 's' }` e le vuote `null`.
  - `CsvError` con `code: 'unclosed-quote'` e `row`.

- [ ] **Step 1: test che falliscono.** `parseCsv('﻿Data;Importo\r\n27/10/2026;"-92,81"\n', ';')` dà due righe con `{ t: 's', v: '-92,81' }`. `"a ""b"""` dà `a "b"`. Un `;` dentro le virgolette non separa. Una cella vuota è `null`. Una virgoletta non chiusa dà `CsvError` alla riga 2. `StatementTableSchema` rifiuta `{ t: 'n', v: '1e5' }` e `{ t: 'd', v: '2026-02-30' }`.
- [ ] **Step 2:** `pnpm test -- statement-table` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, test passano.
- [ ] **Step 5: commit** `feat(core): tabella dell'estratto e lettore CSV (piano 3a, task 3)`.

## Task 4: `bollette_pdf table` per l'XLSX

**Files:** Create `python/bollette_pdf/xlsx.py`; Modify `python/bollette_pdf/__main__.py` (comando `table`), `python/README.md`, `docs/progress.md` (prossima R libera); Create `python/tests/xlsx_builder.py` (costruisce un XLSX minimo da un dizionario), `python/tests/test_xlsx.py`; Test d'integrazione `packages/core/test/statement-table-python.test.ts`.

**Interfaces:**

- Consumes: le difese di R98 (`xlsx_structure.py`: limiti di dimensione, DOCTYPE ed ENTITY rifiutati, stessi limiti numerici). Se la PR #30 è unita, lo strumento importa dal nuovo modulo invece di duplicare il codice.
- Produces:
  - `read_table(path: Path) -> dict`: la tabella di `StatementTableSchema`, con questi tipi di cella:
    - testo (condiviso, `inlineStr`, `str`) → `s`;
    - numero senza stile di data → `n`, con `v` = `repr(float(raw))`, la più corta che rilegge lo stesso double (mai arrotondata);
    - numero con stile di data → `d`, dalla parte intera del seriale, sistema 1900 o 1904 secondo `workbookPr/@date1904`, solo con interi;
    - celle vuote e buchi → `null`.
  - `TABLE_ERROR = "File non valido o troppo grande: nessun output."`, codice 2.
  - Riga di comando `table <file>`.

- [ ] **Step 1: test che falliscono.** Un XLSX costruito con:
  - una stringa condivisa, un `inlineStr`, `-92.810000000000002`, `1234.5`;
  - il seriale `46322` con stile data (`2026-10-27`) e lo stesso con `date1904="1"` (`2030-10-28`);
  - una cella mancante in B.

  Uscite attese: `{"t":"n","v":"-92.81"}`, `{"t":"n","v":"1234.5"}`, `{"t":"d","v":"2026-10-27"}`, `null` al posto di B. Un file con `<!DOCTYPE`, uno non ZIP e uno oltre il limite di membri danno codice 2, `TABLE_ERROR` su stderr, stdout vuoto. Due corse uguali danno gli stessi byte. Nel core, l'uscita reale passa `StatementTableSchema` (`REQUIRE_PYTHON=1`).
- [ ] **Step 2:** `PYTHON=<venv> pnpm python:test` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (rappresentazione dei numeri e delle date).
- [ ] **Step 4:** `pnpm python:test`, `REQUIRE_PYTHON=1 pnpm test`, lint, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(python): tabella degli estratti XLSX con la libreria standard (piano 3a, task 4)`.

## Task 5: righe dell'estratto dal profilo della banca

**Files:** Create `packages/core/src/statement-read.ts`; Modify `index.ts`; Test `packages/core/test/statement-read.test.ts`.

**Interfaces:**

- Consumes: `StatementTable`, `BankProfile`, `parseEuro`, `normaliseIban`, `isoDate`, `foldText`.
- Proteggere `accountPattern`/`periodPattern` dal ReDoS dove vengono eseguiti (lunghezza massima dell'input, niente quantificatori annidati) con test.
- Produces:
  - `readStatementTable(table: StatementTable, profile: BankProfile): StatementRead`, con `StatementRead = { rows: StatementRow[]; declaredPeriod?: { from: ISODate; to: ISODate }; declaredAccount?: string }`.
  - `StatementRow = { row: number; date: ISODate; amount: Cents; description: string; dispCode?: string; counterparty?: { name?: string; iban?: string }; booked: boolean }`.
  - Intestazione: prima riga del foglio (`profile.sheet` 0) che contiene tutte le etichette di `header.allOf`.
  - Descrizione: le colonne di `description` unite con `' - '`, senza le celle vuote.
  - Importo: cella `n` con `/^-?[0-9]+(\.[0-9]{1,2})?$/`, cella `s` con `parseEuro`. Il segno viene dalla cella, da `signValues` o da dare/avere.
  - Periodo e conto: `periodPattern` e `accountPattern` sulle righe sopra l'intestazione.
  - `StatementReadError` con `code` tra `no-header`, `missing-column`, `bad-date`, `bad-amount`, `unknown-sign`, `debit-and-credit`, `no-amount`, `zero-amount`, `bad-period`, e `row`, `column?`. Il messaggio è costante e non porta mai il valore.

- [ ] **Step 1: test che falliscono** (tabelle scritte a mano con il profilo sintetico e le sue varianti):
  - riga `d 2026-10-27 | s Addebito | s HERA COMM | n -92.81 | s A123` dà `{ date: '2026-10-27', amount: -9281, description: 'Addebito - HERA COMM', dispCode: 'A123', booked: true }`;
  - date di testo `27/10/2026`; importo di testo `-1.234,56` dà `-123456`;
  - le celle `n 1.234` e `n 1e5` danno `bad-amount` alla riga giusta;
  - importo `n 92.81` con «Segno» `D` dà `-9281`, con `X` dà `unknown-sign`;
  - dare e avere entrambi pieni dà `debit-and-credit`, entrambi vuoti `no-amount`; `0` dà `zero-amount`;
  - una cella «In attesa» nella colonna `pending` dà `booked: false`;
  - controparte e IBAN dalla causale con le espressioni del profilo; un IBAN non valido resta fuori (`iban` assente, nessun errore);
  - periodo `dal 01/10/2026 al 31/10/2026` sopra l'intestazione dà `declaredPeriod`; un periodo invertito dà `bad-period`;
  - senza le etichette dell'intestazione dà `no-header`;
  - nessun messaggio d'errore contiene la cella letta.
- [ ] **Step 2:** `pnpm test -- statement-read` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): lettura delle righe di un estratto col profilo della banca (piano 3a, task 5)`.

## Task 6: conti e profili nell'archivio; percorso proposto dell'estratto

**Files:** Create `packages/core/src/accounts.ts`; Modify `index.ts`; Test `packages/core/test/accounts.test.ts`.

**Interfaces:**

- Consumes: `commitChange`, `loadAll`, `recordPath`, `annualitaOf`, le regole di nome sicuro di `suggestedFilePath` (`safeWord`, da esportare da `proposal.ts`).
- Produces:
  - `saveBankProfile(store, profile: BankProfile, profileId, clock, newId): Promise<Operation>` (operazione `bank-profile.save`).
  - `saveAccount(store, draft: Omit<Account, 'id' | 'v' | 'rev'>, profileId, clock, newId): Promise<{ status: 'saved'; account: Account; operationId: string } | { status: 'rejected'; reason: 'unknown-apartment' | 'unknown-bank-profile' | 'bad-iban' | 'iban-in-use' }>`; l'IBAN passa da `normaliseIban`.
  - `statementFilePath(input: { apartment: Apartment; to: ISODate; bank: string; ext: 'xlsx' | 'csv' }): string`.

- [ ] **Step 1: test che falliscono.** `saveAccount` con l'IBAN di esempio scritto con spazi salva `'IT60X0542811101000000123456'`. Danno `rejected`: lo stesso IBAN su un secondo conto (`iban-in-use`), un appartamento inesistente o cancellato, un profilo inesistente. Ogni salvataggio è un'operazione annullabile. `statementFilePath({ apartment: { name: 'Berchet_3', annualitaStart: { month: 10, day: 1 } }, to: '2026-10-31', bank: 'Banca', ext: 'xlsx' })` dà `'Riservato_proprietari/Estratti_conto/Berchet_3/2026-27/2026-10-31_Estratto_Banca_2026-10.xlsx'`; un nome con `:` o accenti esce sicuro.
- [ ] **Step 2:** `pnpm test -- accounts` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, test passano.
- [ ] **Step 5: commit** `feat(core): conti, profili della banca e percorso degli estratti (piano 3a, task 6)`.

## Task 7: importazione dell'estratto, righe in revisione, annullamento

**Files:** Create `packages/core/src/statement-import.ts`; Modify `index.ts`, `docs/progress.md` (prossima R libera); Test `packages/core/test/statement-import.test.ts`.

**Interfaces:**

- Consumes: `readStatementTable`, `keyTransactions`, `hashBytes`, `statementFilePath`, `commitChange`, `undoOperation`, `loadAll`.
- Produces:
  - `importStatement(store, input: { accountId: string; fileBytes: Uint8Array; fileName: string; table: StatementTable; period?: { from: ISODate; to: ISODate } }, profileId, clock, newId): Promise<ImportResult>`.
  - `ImportResult` è uno di:
    - `{ status: 'imported'; statement: Statement; added: number; alreadyKnown: number; held: number; operationId: string }`;
    - `{ status: 'already-imported'; statementId: string }`;
    - `{ status: 'rejected'; reason: 'unknown-account' | 'wrong-profile' | 'wrong-account' | 'needs-period' | 'period-mismatch' | 'row-outside-period'; row?: number }`;
    - lo `StatementReadError` del Task 5 si propaga.
  - Regole:
    - `already-imported` vale per la stessa impronta di uno `statement` non cancellato, su qualunque conto;
    - `wrong-account` se `declaredAccount` non è contenuto in `account.iban`;
    - le righe non contabilizzate e i doppioni possibili vanno in `held` e non si scrivono;
    - `summary` costante, per esempio `Importato un estratto conto: 34 movimenti nuovi, 2 da rivedere.`
  - `resolveHeld(store, statementId: string, row: number, decision: 'keep' | 'exclude', profileId, clock, newId): Promise<Operation>`: `keep` scrive il movimento, poi la decisione si registra nello `statement`; una riga già decisa lancia `RangeError`.
  - `undoImport(store, statementId, profileId, clock, newId): Promise<{ status: 'undone'; operation: Operation } | { status: 'refused'; reason: 'shared-transactions' }>`: rifiuta se un altro `statement` non cancellato elenca uno dei movimenti che l'annullamento cancellerebbe.

- [ ] **Step 1: test che falliscono** (`MemoryStore`, orologio e `newId` fissi):
  - importare lo stesso file due volte: la seconda dà `already-imported`, e l'archivio (file e registro) è identico byte per byte prima e dopo;
  - lo stesso file su un altro conto: `already-imported`;
  - ottobre poi 15 ottobre-15 novembre: l'unione senza doppioni (`alreadyKnown` uguale alle righe in comune), e le tre righe identiche dello stesso giorno restano tre;
  - una riga con la stessa data e lo stesso importo di un movimento esistente ma un'altra causale, in un giorno coperto, va in `held` come `possible-duplicate`;
  - una riga `booked: false` va in `held` come `pending`; `resolveHeld(…, 'exclude')` non scrive movimenti, `keep` ne scrive uno;
  - senza periodo nel file né `period`: `needs-period`; periodo del file diverso da `period`: `period-mismatch`; una riga fuori: `row-outside-period` con la riga; in nessuno di questi casi si scrive qualcosa;
  - IBAN dichiarato diverso: `wrong-account`; conto cancellato: `unknown-account`; profilo diverso: `wrong-profile`;
  - `undoImport` del primo estratto quando il secondo ne contiene dei movimenti: `refused`; il secondo si annulla;
  - nessun `summary` contiene una causale o un importo;
  - le occorrenze delle righe identiche seguono l'ordine del file: due file con le stesse righe in ordine diverso, ma con le righe identiche nello stesso ordine relativo, danno gli stessi `id`.
- [ ] **Step 2:** `pnpm test -- statement-import` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (periodo, `held`, `already-imported` su qualunque conto, rifiuto dell'annullamento).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): importazione degli estratti con revisione di doppioni e non contabilizzati (piano 3a, task 7)`.

## Task 8: riga di comando `pnpm estratti`

**Files:** Create `scripts/estratti.mjs`, `scripts/estratti.test.mjs`; Modify `package.json` (`"estratti": "tsx scripts/estratti.mjs"`), `docs/progress.md` (prossima R libera).

**Interfaces:**

- Consumes: `FsStore` (`@bollette/store-fs`), `importStatement`, `resolveHeld`, `undoImport`, `saveAccount`, `saveBankProfile`, `parseCsv`, `StatementTableSchema`, `scanText` di `scripts/check-personal-data.mjs`; l'interprete Python con `PYTHON`, come `scripts/python.mjs`.
- Produces:
  - Comandi: `estratti profilo --cartella <dir> <profilo.json>`, `estratti conto --cartella <dir> --appartamento <id> --profilo <id> --etichetta <testo> [--iban <testo>]`, `estratti importa --cartella <dir> --conto <id> [--dal AAAA-MM-GG --al AAAA-MM-GG] <file>`, `estratti decidi --cartella <dir> --estratto <id> --riga <n> --tieni|--escludi`, `estratti annulla --cartella <dir> --estratto <id>`.
  - Opzioni comuni `--utente <profileId>` e `--ora <timestamp>`; senza `--ora` lo script legge l'orologio, che è consentito fuori dal core.
  - Uscita: un JSON con `status` e conteggi e `id`. `--dettagli` aggiunge data, importo e causale delle righe in `held`; è vietato nei test.
  - Codici di uscita: 0 riuscito, 1 rifiutato, 2 argomenti o file non validi.

- [ ] **Step 1: test che falliscono.** In una cartella temporanea: `profilo`, `conto` e `importa` di un CSV sintetico danno `{"status":"imported","added":5,"alreadyKnown":0,"held":1}` con codice 0. La stessa `importa` di nuovo dà `already-imported` e nessun file nuovo nel registro. Un XLSX costruito dal builder del Task 4 (`REQUIRE_PYTHON=1`) dà lo stesso risultato del CSV equivalente. `--dal` senza `--al` dà codice 2. Senza `--dettagli`, `scanText` sull'uscita non trova nulla e l'uscita non contiene nessuna causale della fixture.
- [ ] **Step 2:** `pnpm test -- scripts/estratti` (progetto vitest `scripts`) fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera.
- [ ] **Step 4:** lint, typecheck, `REQUIRE_PYTHON=1 pnpm test`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(cli): pnpm estratti per conti e importazione (piano 3a, task 8)`.

## Task 9 (3a-bis): profilo vero della banca

Parte solo quando Carlo ha incollato l'uscita di `python/tools/xlsx_structure.py` sui file di ottobre 2026: sole intestazioni, tipi e conteggi, nessun valore.

**Files:** Create `python/seed-profiles/<banca>-estratto-<anno>.json` (o la cartella dei seed scelta nel Task 1), Modify `fixtures/bank/` (una fixture sintetica con le intestazioni vere e valori inventati), `packages/core/src/seed-profiles.ts` se i seed della banca si copiano al primo avvio come quelli dei fornitori, `docs/progress.md` (prossima R libera).

- [ ] **Step 1: test che falliscono.** La fixture con le intestazioni vere, letta con il profilo nuovo, dà le righe attese: date, segni, codice disposizione, controparte, non contabilizzati e periodo dichiarato, ciascuno se l'uscita dello strumento mostra che esiste.
- [ ] **Step 2:** fallisce con il profilo sintetico.
- [ ] **Step 3: scrivere il profilo.** Ogni ipotesi del profilo sintetico smentita dall'uscita (per esempio dove sta «Cod Disp.», colonna unica o dare/avere, date seriali o testo) va nella prossima R libera. Se serve un campo di profilo nuovo, NEEDS_CONTEXT.
- [ ] **Step 4:** tutti i controlli passano; Carlo importa i suoi file in locale con `pnpm estratti importa` e riporta solo l'uscita senza `--dettagli`.
- [ ] **Step 5: commit** `feat(profili): profilo dell'estratto della banca dei tre conti (piano 3a, task 9)`.

## Autoverifica

- **Copertura del disegno (3a):**
  - conti, profilo come dati, `statement`: Task 1 e 6;
  - CSV nel core, XLSX in Python con la libreria standard: Task 3 e 4;
  - righe e controparte: Task 5;
  - identità con il conto e periodi per conto: Task 2;
  - periodo dal file o a mano, doppioni possibili, non contabilizzati solo dopo conferma, file ripetuto, operazione unica e annullamento: Task 7;
  - percorso della sezione 20: Task 6;
  - riga di comando senza dati personali: Task 8;
  - profilo sintetico sostituito: Task 9.
  - Restano fuori, come da disegno, `tenant` e `payer` (3b) e `movementClass`, `f24`, `transfer` (3c).
- **Firme coerenti:**
  - `StatementTable` (Task 3) è prodotta dal Task 4 e consumata dal Task 5;
  - `StatementRead.rows` va a `keyTransactions` con `accountId` (Task 2) nel Task 7;
  - `Statement.held[].transaction` è un `BankTransaction` (Task 1);
  - `statementPeriods` con `apartmentId` (Task 2) si ricava da `Statement.from/to` e dall'`apartmentId` del conto, nel 3b o 3c, quando si chiama `matchToTransactions`.
- **Review Focus nei test:** 1 → Task 7; 2 → Task 2 e 7; 3 → Task 4 e 5; 4 → Task 5 e 7; 5 → Task 2.
