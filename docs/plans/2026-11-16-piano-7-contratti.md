# App Bollette: Piano 7, contratti di locazione, storico del canone e controlli sui dati

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** il record `contract` con i dati che user1 ha (canone concordato, studenti, durata, firma, registrazione, regime fiscale e aliquota come dati, presenze e caparre collegate), lo storico del canone per data, scritture annullabili dalla riga di comando e un elenco di controlli in sola lettura (presenze fuori dalle date, collegamenti rotti, caparre, confronto di R4), mai una correzione automatica.

**Architettura:** campi opzionali sul `ContractSchema` esistente; funzioni pure in `contract.ts` (`rentForMonth`, `contractChecks`); scritture in `contract-store.ts` (`saveContract`, `setContractRent`), ognuna un'operazione del registro solo se `checkConsistency` è pulito; lettura `loadContractChecks`; `pnpm estratti` aggiunge `contratto`, `contratto-canone`, `contratti`. Conguaglio, Excel, incassi e `settlementPeriods` non cambiano.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; nessuna dipendenza nuova, nessun Python.

**Specifica:** il disegno `docs/plans/2026-11-16-piano-7-contratti-disegno.md` (decisioni 1-8, «Mie scelte» 1-10; **domande 1-8 aperte**, nessuna blocca i task: ognuna è fuori dal piano o trattata come scritto nel task); `docs/spec.md` sezioni 6, 17, 23, 26, 31, 34 e 42 (R1, R4, che prevalgono); `docs/progress.md` R34, R107, R112, R113, R117, R132, R155. Fuori dal 7: cedolare attesa (domanda 1), Scadenze e pagamenti, Tasse e stime, moduli, comando delle presenze, interfaccia.

## Metodo di esecuzione

- Un ramo (`feat/piano-7`), mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`, `TZ=America/Los_Angeles pnpm test`, `pnpm data:check`, commit. Un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; poi una revisione finale e la PR.
- **Un task = un gate di revisione.** Dipendenze: 2 ← 1; 3 ← 1; 4 ← 3; 5 ← 2, 4; 6 ← 1-5.
- Le regole nuove vanno in `docs/progress.md` dalla **prossima R libera** (`grep -n '^- \*\*R[0-9]' docs/progress.md | tail -1`; al 16 novembre 2026 l'ultima è R156). Ogni task scrive la sua R nel passo 3.
- Le regole di calcolo e di confidenza non si decidono da soli: NEEDS_CONTEXT e si chiede a user1. In particolare **nessun calcolo della cedolare** (domanda 1, sezione 34) e nessun cambiamento a `calcConguaglio` (domanda 2).

## Vincoli globali

- Importi in `Cents` interi, mesi `YYYY-MM`, date `YYYY-MM-DD`; confronti solo con interi; test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura almeno 90% sulle righe di `packages/core/src`.
- `packages/core` puro: niente `node:*`, rete, `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; `clock`, `newId` e `asOf` sono argomenti.
- Record con `id`, `v: 1`, `rev`, mai cancellati dal disco (`deleted`); **solo campi opzionali nuovi** su `contract`, nessuna migrazione, nessun record nuovo; i contratti già scritti (fixture dell'Excel e dorate) restano validi e danno gli stessi periodi.
- Ogni scrittura: `checkConsistency(store)` vuoto, altrimenti `inconsistent-store` e nulla scritto (R113); la stessa richiesta sullo stesso stato non scrive nulla (`unchanged`).
- **Nessuna aliquota nel codice:** `cedolareRateBp` è solo un dato inserito da user1, salvato e mostrato, mai letto da un calcolo.
- **Nessun dato reale:** nomi di inquilini inventati, proprietari solo `user1`/`user2`, codici di registrazione inventati e dichiarati in `fixtures/README.md`, importi inventati, IBAN solo dalla tabella di `fixtures/README.md`.
- Nessun dato personale (importi, nomi, codici di registrazione, `id` di presenze e pagamenti) in `summary`, messaggi d'errore o uscita predefinita della riga di comando (R107); solo con `--dettagli`.
- Valori esatti:
  - canone del mese `m` = la voce di `rent` con il `from` più grande `<= m`; nessuna voce → nessun canone (nessun confronto);
  - `rent-differs` se `sum(monthlyRent + monthlyForfait)` delle presenze vive dell'appartamento presenti nel mese (`isPresent` di `conguaglio.ts`) `!== monthlyRent + monthlyAdvance`, solo per mesi `<= asOf` (R4);
  - `--aliquota-cedolare`: `^[0-9]{1,3}(,[0-9]{1,2})?$`, punti base = parte intera × 100 + decimali (`10` → 1000, `10,5` → 1050, `10,05` → 1005), poi 1..10000.

## Da confermare con user1

**Risposte di user1 (16 novembre 2026, piano 7-bis, R180-R183):** 1 stima della cedolare sugli affitti dell'anno inseriti a mano (R182); 2 controllo R34 sullo storico del contratto del mese, `contrattoMensile` come riserva (R180); 3 solo il totale; 4 `rent-differs` com'è; 6 un record; 7, 8 non ora; 9 avviso `contract-overlap` (R181); 5 resta fuori. Testo originale del piano, prima delle risposte:

Nessuna domanda blocca un task. Domanda 1 (cedolare attesa) e domande 5, 7, 8: fuori dal piano, nessun task. Domanda 2: il conguaglio non cambia (Review Focus 4). Domanda 3: solo il totale. Domanda 4: il posto vuoto dà `rent-differs`, come R34. Domanda 6: un record per i rinnovi; con la risposta opposta si salvano due contratti, nessun codice cambia. Una risposta diversa cambia solo il punto indicato.

## Revisione mirata (Review Focus)

1. **Mai una correzione (Task 2, 3, 4).** Nessun controllo scrive, nessuna scrittura cambia una presenza, un pagamento o un altro contratto; una presenza fuori dalle date si salva e compare tra i controlli.
2. **Storico del canone (Task 1, 2).** `from` strettamente crescenti e tra `start` e `end`; `saveContract` non tocca `rent`; nuove date che lasciano fuori una voce → `rent-outside-contract`.
3. **Confini di `rent-differs` (Task 4).** Mese prima della prima voce: nessun confronto; mese di `asOf` sì, mese dopo no; mesi consecutivi uguali in un intervallo, un cambio di presenza o di canone apre un intervallo nuovo.
4. **Conguaglio ed Excel invariati (Task 1, 6).** Stessi `ConguaglioResult` e stessi byte dell'Excel della fixture prima e dopo; `contractWarnings` (R34) non cambia.
5. **Riservatezza (Task 5).** Senza `--dettagli` nessun importo, codice di registrazione, data di firma o di registrazione, `tenancyId`, `paymentId`.

---

## Task 1: campi del contratto e canone del mese

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/index.ts`, `docs/schemas/contract.json` (`pnpm schemas:export`), `docs/glossary.md` (canone concordato → `agreedRent`; contratto per studenti → `forStudents`; durata → `durationMonths`; data di firma → `signedOn`; registrazione, codice identificativo → `registration`, `code`; regime fiscale → `taxRegime`; cedolare secca → `cedolare`, aliquota → `cedolareRateBp`; storico del canone → `rent`; acconto spese → `monthlyAdvance`), `docs/progress.md`; Create `packages/core/src/contract.ts`; Test `packages/core/test/model.test.ts`, `packages/core/test/contract.test.ts`.

**Interfaces:**

- Consumes: `ContractSchema`, `RecordBaseSchema`, `NonEmptyString`, `CentsSchema`, `ISODateSchema`, `YearMonthSchema`.
- Produces:
  - `ContractSchema` estesa con: `agreedRent: z.literal(true).optional()`, `forStudents: z.literal(true).optional()`, `durationMonths: z.int().min(1).optional()`, `signedOn: ISODateSchema.optional()`, `registration: z.object({ code: NonEmptyString.optional(), date: ISODateSchema.optional() }).optional()`, `taxRegime: z.enum(['cedolare', 'ordinario']).optional()`, `cedolareRateBp: z.int().min(1).max(10000).optional()`, `tenancyIds: z.array(NonEmptyString).optional()`, `depositPaymentIds: z.array(NonEmptyString).optional()`, `rent: z.array(z.object({ from: YearMonthSchema, monthlyRent: CentsSchema, monthlyAdvance: CentsSchema })).optional()`. Refine (oltre a quella di oggi su `start`/`end`): `cedolareRateBp` solo con `taxRegime === 'cedolare'`; `tenancyIds` e `depositPaymentIds` senza ripetizioni; `rent`: `from` strettamente crescenti, ognuno `start <= from <= end`, `monthlyRent > 0`, `monthlyAdvance >= 0`. Descrizione nel `meta` per lo schema JSON. `type Contract` invariato nel nome.
  - `ContractRent = { from: YearMonth; monthlyRent: Cents; monthlyAdvance: Cents }`.
  - `rentForMonth(contract: Pick<Contract, 'rent'>, month: YearMonth): ContractRent | undefined` (in `contract.ts`).

- [ ] **Step 1: test che falliscono.**
  - il contratto di `validRecords.contract` di oggi (senza campi nuovi) resta valido e uguale dopo il parse; i contratti delle fixture `fixtures/excel/` e `fixtures/golden/` restano validi;
  - un contratto completo `{ id: 'ctr-berchet', apartmentId: 'berchet', type: '1+1', start: '2025-10', end: '2027-09', settlement: 'annuale', agreedRent: true, forStudents: true, durationMonths: 12, signedOn: '2025-09-20', registration: { code: 'CODICE-PROVA-0001', date: '2025-10-10' }, taxRegime: 'cedolare', cedolareRateBp: 1000, tenancyIds: ['tcy-a'], depositPaymentIds: ['pay-c1'], rent: [{ from: '2025-10', monthlyRent: 160000, monthlyAdvance: 15000 }, { from: '2026-10', monthlyRent: 165000, monthlyAdvance: 15000 }] }` è valido;
  - rifiutati: `rent` con `from` uguali o decrescenti, `from: '2025-09'` o `'2027-10'`, `monthlyRent: 0`, `monthlyAdvance: -1`; `cedolareRateBp` con `taxRegime: 'ordinario'` o senza `taxRegime`; `cedolareRateBp: 0` e `10001`; `tenancyIds: ['a', 'a']`; `durationMonths: 0`; `agreedRent: false`; `registration.date: '2025-02-30'`;
  - `rentForMonth`: `2025-09` → `undefined`, `2025-10` e `2026-09` → la prima voce, `2026-10` e `2027-09` → la seconda; senza `rent` → `undefined`;
  - `pnpm schemas:export` non lascia differenze dopo il commit (test di `schemas-export`).
- [ ] **Step 2:** `pnpm test -- model contract schemas-export` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; voci nel glossario; scrivere la prossima R libera (campi opzionali di `contract`, «Mie scelte» 1, 2, 7, 10, nessun `minAppVersion` nuovo, canone del mese, aliquota solo dato con la domanda 1).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): dati del contratto e storico del canone (piano 7, task 1)`.

## Task 2: scrivere un contratto e il suo canone

**Files:** Create `packages/core/src/contract-store.ts`; Modify `packages/core/src/index.ts`, `docs/progress.md`; Test `packages/core/test/contract-store.test.ts`.

**Interfaces:**

- Consumes: Task 1, `checkConsistency`, `commitChange`, `undoOperation`, `loadAll`, `recordPath`, `parseOrThrow`, `ApartmentSchema`, `TenancySchema`, `PaymentSchema`.
- Produces:
  - `ContractInput = Omit<Contract, 'v' | 'rev' | 'deleted' | 'rent'>` (con `id`).
  - `saveContract(store, input: ContractInput, profileId: string, clock: () => string, newId: () => string): Promise<{ status: 'saved'; operationId: string; contractId: string } | { status: 'unchanged'; contractId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-apartment' | 'unknown-tenancy' | 'unknown-deposit' | 'rent-outside-contract' }>`. Crea o aggiorna `input.id` (nuova `rev`; un record cancellato torna vivo); `rent` resta quello del record di prima (assente per uno nuovo). Rifiuti in quest'ordine: `inconsistent-store`; `unknown-apartment` (assente o cancellato); `unknown-tenancy` (un `tenancyIds` non è una `tenancy` viva con lo stesso `apartmentId`); `unknown-deposit` (un `depositPaymentIds` non è un `Payment` vivo `kind: 'caparra'` con lo stesso `apartmentId`); `rent-outside-contract` (il record risultante non passa la refine di `rent`). Le date delle presenze **non** si controllano qui (Review Focus 1). Operazione `contract.save`, `summary` `Contratto salvato.`, `apartmentId` del contratto. `unchanged` se il record risultante è uguale a quello vivo (stesso confronto di `setImuYear`).
  - `setContractRent(store, input: { contractId: string; from: YearMonth; monthlyRent: Cents; monthlyAdvance: Cents }, profileId, clock, newId): Promise<{ status: 'saved'; operationId: string; contractId: string } | { status: 'unchanged'; contractId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-contract' | 'month-outside-contract' | 'bad-amount' }>`. Aggiunge la voce in ordine di `from` o sostituisce quella con lo stesso `from`; `bad-amount` se `monthlyRent <= 0` o `monthlyAdvance < 0`; `month-outside-contract` se `from < start` o `from > end`. Operazione `contract.rent`, `summary` `Aggiornato il canone di un contratto.`.

- [ ] **Step 1: test che falliscono** (Review Focus 1, 2; archivio in memoria, presenze e pagamenti scritti con `commitChange`).
  - `saveContract` del contratto del Task 1 (senza `rent`) → `saved`, `summary` esattamente `Contratto salvato.`; la stessa richiesta → `unchanged`, registro e archivio uguali byte per byte;
  - dopo `setContractRent` 2025-10 e 2026-10, un `saveContract` con `registration.date` cambiata → `saved`, `rent` uguale; con `end: '2026-09'` → `rent-outside-contract`, nulla scritto;
  - presenza `tcy-a` collegata da `2025-09` (prima di `start`) → `saved` (nessun rifiuto sulle date) e la presenza invariata;
  - rifiuti senza scrivere: appartamento inesistente; presenza inesistente, cancellata o di Lovarini; pagamento `canone` invece di `caparra`, cancellato o di un altro appartamento; record `diverged` → `inconsistent-store`;
  - `setContractRent`: `saved`; stessa voce → `unchanged`; stesso `from` con importo nuovo → voce sostituita, una sola; `from: '2025-09'` → `month-outside-contract`; `monthlyRent: 0` → `bad-amount`; contratto inesistente o cancellato → `unknown-contract`; `diverged` → `inconsistent-store`;
  - `undoOperation` di `contract.rent` toglie la voce; di `contract.save` di un contratto nuovo lo cancella (`deleted: true`), di un aggiornamento rimette la `rev` di prima; `saveContract` dopo l'annullamento della creazione → torna vivo con `rev` nuova;
  - `summary` e messaggi senza importi, codici, nomi (`scanText` vuoto).
- [ ] **Step 2:** `pnpm test -- contract-store` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (operazioni e rifiuti, «Mie scelte» 4, `rent` conservato, nessuna cancellazione se non con l'annullamento).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): contratto e canone scritti nel registro, annullabili (piano 7, task 2)`.

## Task 3: controlli su presenze e caparre

**Files:** Modify `packages/core/src/contract.ts`, `packages/core/src/contract-store.ts`, `packages/core/src/index.ts`, `docs/progress.md`; Test `packages/core/test/contract.test.ts`, `packages/core/test/contract-store.test.ts`.

**Interfaces:**

- Consumes: Task 1, `isPresent` (`conguaglio.ts`, già esportato), `Tenancy`, `Payment`.
- Produces:
  - `ContractCheckCode = 'unknown-tenancy' | 'tenancy-other-apartment' | 'tenancy-outside-contract' | 'tenancy-linked-twice' | 'unlinked-tenancy' | 'unknown-deposit' | 'deposit-other-tenant' | 'rent-differs'` (`rent-differs` dal Task 4).
  - `ContractCheck = { code: ContractCheckCode; contractId: string; tenancyId?: string; paymentId?: string; from?: YearMonth; to?: YearMonth; expected?: Cents; actual?: Cents }`.
  - `contractChecks(input: { contracts: Contract[]; tenancies: Tenancy[]; payments: Payment[]; asOf: YearMonth }): ContractCheck[]`: sui contratti vivi, con le regole della tabella della sezione 3 del disegno. `tenancy-outside-contract`: `from < start`, oppure `to > end`, oppure `to` assente. `tenancy-linked-twice`: una voce per contratto, ciascuna con il `contractId` di uno dei due. `unlinked-tenancy`: solo negli appartamenti con almeno un contratto vivo che ha `tenancyIds` (anche vuoto), per le presenze vive non collegate a nessun contratto vivo che hanno almeno un mese tra `start` ed `end` di uno di quei contratti (`contractId` del primo per `id`). `deposit-other-tenant`: `payment.tenantId` non è il `tenantId` di nessuna presenza viva collegata. Ordine: `contractId`, `code`, `tenancyId`, `paymentId`, `from`. Puro, non scrive.
  - `loadContractChecks(store, options: { asOf: YearMonth; apartmentId?: string }): Promise<{ status: 'computed'; contracts: Contract[]; checks: ContractCheck[] } | { status: 'refused'; reason: 'inconsistent-store' }>`: record vivi; con `apartmentId` solo i contratti e le voci di quell'appartamento; non scrive.

- [ ] **Step 1: test che falliscono** (Review Focus 1; nomi inventati Anna Prova, Bruno Esempio).
  - un caso per codice: presenza cancellata dopo il collegamento → `unknown-tenancy`; presenza di Lovarini nel contratto di Berchet (scritta a mano, `saveContract` la rifiuterebbe) → `tenancy-other-apartment`; presenza da `2025-09`, fino a `2027-10`, e senza fine → `tenancy-outside-contract` (tre casi); presenza in due contratti → due `tenancy-linked-twice`; presenza non collegata nei mesi del contratto → `unlinked-tenancy`, ma nessuna voce se nessun contratto dell'appartamento ha `tenancyIds`; pagamento cancellato o diventato `altro` → `unknown-deposit`; caparra di Bruno Esempio con la sola presenza di Anna Prova collegata → `deposit-other-tenant`;
  - un contratto cancellato non dà voci e non conta per `tenancy-linked-twice` né per `unlinked-tenancy`;
  - ingresso mescolato → stesso risultato (`toEqual`); nessun ingresso cambia (oggetti congelati);
  - `loadContractChecks`: `diverged` → `inconsistent-store`; il registro e l'archivio non cambiano dopo la chiamata; `apartmentId` filtra.
- [ ] **Step 2:** `pnpm test -- contract contract-store` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (codici, «Mie scelte» 3, 5, controlli fuori da `checkConsistency`, mai una correzione).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): controlli in sola lettura tra contratti, presenze e caparre (piano 7, task 3)`.

## Task 4: confronto del canone con le presenze (R4)

**Files:** Modify `packages/core/src/contract.ts`, `docs/progress.md`; Test `packages/core/test/contract.test.ts`, `packages/core/test/conguaglio.test.ts`.

**Interfaces:**

- Consumes: Task 1 (`rentForMonth`), Task 3 (`contractChecks`), `isPresent`, `addMonths` (`period.ts`, per scorrere i mesi da `start` a `min(end, asOf)`).
- Produces: in `contractChecks`, voci `{ code: 'rent-differs', contractId, from, to, expected, actual }`: per ogni mese da `start` a `min(end, asOf)` con `rentForMonth` definito, `expected = monthlyRent + monthlyAdvance`, `actual` = somma di `monthlyRent + monthlyForfait` delle presenze vive con `apartmentId` del contratto e `isPresent(tenancy, month)` (tutte, collegate o no: R4); mesi consecutivi con lo stesso `expected` e lo stesso `actual` in un solo intervallo. Nessuna altra funzione cambia.

- [ ] **Step 1: test che falliscono** (Review Focus 3, 4; l'esempio della sezione 3 del disegno).
  - `ctr-berchet` 160000 + 15000 da 2025-10; quattro presenze 35000 + 3000 e una 33000 + 3000 da 2025-10 a 2026-09; `asOf: '2026-11'` → una voce `rent-differs` `from: '2025-10'`, `to: '2026-09'`, `expected: 175000`, `actual: 188000`, e una `from: '2026-10'`, `to: '2026-11'`, `actual: 0`;
  - con il rinnovo 2026-10 a 165000 + 15000 e presenze nuove che danno 180000 → nessuna voce da 2026-10;
  - `asOf: '2026-09'` → nessuna voce per 2026-10; mese prima della prima voce del canone → nessun confronto; contratto senza `rent` → nessuna voce `rent-differs`;
  - una presenza che esce a 2026-03 apre un intervallo nuovo da 2026-04;
  - `calcConguaglio` della stessa fixture dà lo stesso risultato con e senza i campi nuovi del contratto (Review Focus 4, domanda 2).
- [ ] **Step 2:** `pnpm test -- contract conguaglio` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (R4 sullo storico, «Mie scelte» 6, domanda 4 come avviso, domanda 2 aperta: conguaglio invariato, domanda 5 fuori).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): canone del contratto confrontato con le presenze, solo avviso (piano 7, task 4)`.

## Task 5: riga di comando dei contratti

**Files:** Modify `scripts/estratti.mjs`, `docs/progress.md`; Test `scripts/estratti.test.mjs`.

**Interfaces:**

- Consumes: Task 2 (`saveContract`, `setContractRent`), Task 3-4 (`loadContractChecks`), `parseEuro`, `RECONCILE_KINDS`, `MESSAGES`, `scanText`.
- Produces:
  - `estratti contratto --cartella <dir> --id <id> --appartamento <id> --tipo 1+1|3+2|4+4|altro --inizio <AAAA-MM> --fine <AAAA-MM> --conguaglio annuale|intero-contratto [--concordato] [--studenti] [--durata <n>] [--firmato <AAAA-MM-GG>] [--codice-registrazione <testo>] [--registrato <AAAA-MM-GG>] [--regime cedolare|ordinario] [--aliquota-cedolare <percentuale>] [--presenze <id,id>] [--caparre <id,id>]` → `saveContract`; `--id` come `inquilino` (`^[A-Za-z0-9_-]{1,64}$`); `--presenze`/`--caparre` con le regole di `--gambe` (R132: `id` vuoto, con caratteri fuori da `A-Za-z0-9_-` o ripetuto → 2); `--aliquota-cedolare` come nei Vincoli, senza `--regime cedolare` → 2; uscita `{ status: 'saved' | 'unchanged', contractId, operationId? }`.
  - `estratti contratto-canone --cartella <dir> --contratto <id> --dal <AAAA-MM> --canone <importo> --acconto <importo>` → `setContractRent`; importi con `parseEuro`; canone zero o negativo, acconto negativo → 2; uscita `{ status, contractId, operationId? }`.
  - `estratti contratti --cartella <dir> [--appartamento <id>] [--dettagli]` → `loadContractChecks` con `asOf` = mese di `clock()`; di default `{ status: 'ok', contracts: [{ id, apartmentId, type, start, end, settlement, agreedRent, forStudents, taxRegime, tenancies: <n>, deposits: <n>, rentEntries: <n> }], checks: [{ code, contractId, from?, to? }] }`; con `--dettagli` anche `durationMonths`, `signedOn`, `registration`, `cedolareRateBp`, `rent`, `tenancyIds`, `depositPaymentIds` e nei controlli `tenancyId`, `paymentId`, `expected`, `actual`. Per ogni `rent-differs` il messaggio costante `Canone del contratto diverso dal totale delle presenze: controllare il contratto o le presenze.`.
  - `RECONCILE_KINDS` aggiunge `contract.save` e `contract.rent`.
  - Messaggi costanti nuovi in `MESSAGES` per `unknown-tenancy`, `unknown-deposit`, `rent-outside-contract`, `unknown-contract`, `month-outside-contract`, `bad-amount` (senza importi né `id`).
  - Le opzioni nuove valgono solo nei loro comandi (R132); in un altro comando → 2.

- [ ] **Step 1: test che falliscono** (Review Focus 5; cartella temporanea con appartamento, presenze e una caparra scritte con `commitChange`).
  - `contratto … --concordato --studenti --regime cedolare --aliquota-cedolare 10 --codice-registrazione CODICE-PROVA-0001 --presenze tcy-a,tcy-b` → 0, `saved`; di nuovo → 0, `unchanged`; `--aliquota-cedolare 10,5` → `cedolareRateBp` 1050; `10.5`, `abc`, `0`, `100,001` → 2; `--aliquota-cedolare 10` con `--regime ordinario` → 2; `--inizio 2025-13` → 2; `--presenze tcy-a,tcy-a` → 2; presenza inesistente → 1 con il messaggio di `unknown-tenancy`;
  - `contratto-canone --dal 2025-10 --canone 1600,00 --acconto 150,00` → 0; `--canone 0` → 2; `--dal 2030-01` → 1 (`month-outside-contract`);
  - `contratti` → 0, senza `--dettagli` `scanText` vuoto e nessuna cifra degli importi, nessun `CODICE-PROVA`, `tcy-`, `pay-` nell'uscita; con `--dettagli` il codice, `rent` e `expected`/`actual`;
  - `annulla-riconciliazione --operazione <contract.rent>` → 0 e la voce sparisce da `contratti --dettagli`; di `contract.save` sotto un `contract.rent` successivo → 1 (`has-dependents`);
  - `--contratto` in `riconcilia` → 2; errore inatteso → 3.
- [ ] **Step 2:** `pnpm test -- scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (comandi, uscita predefinita senza dati personali, «Mie scelte» 8, 9, `asOf` dall'orologio).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(cli): comandi contratto, contratto-canone e contratti (piano 7, task 5)`.

## Task 6: fixture di prova completa e revisione finale

**Files:** Create `fixtures/contracts/due-appartamenti.json` (Berchet e Lovarini, cinque presenze inventate di cui una da 2025-09, una caparra per un inquilino non collegato, nessun contratto: li scrivono i comandi); Modify `fixtures/README.md` (codici di registrazione inventati `CODICE-PROVA-0001`, `CODICE-PROVA-0002`), `scripts/estratti.test.mjs`, `docs/progress.md`.

**Interfaces:** nessuna nuova; consuma i comandi del Task 5.

- [ ] **Step 1: test che falliscono:** in una cartella temporanea con la fixture: `contratto` per Berchet (`1+1`, annuale, cedolare 10, presenze) e Lovarini (`3+2`, intero contratto, ordinario); `contratto-canone` per il canone iniziale e un rinnovo di Berchet; `contratti` → `tenancy-outside-contract`, `deposit-other-tenant`, un `rent-differs` con il messaggio, nessun'altra voce; seconda esecuzione degli stessi comandi → nessuna scrittura (registro uguale); `annulla-riconciliazione` del rinnovo → l'intervallo cambia; l'Excel (`pnpm excel`) di Berchet e i periodi di `settlementPeriods` uguali a quelli di un contratto con i soli campi di prima (Review Focus 4); senza `--dettagli` nessun dato personale; tutto con i due `TZ`.
- [ ] **Step 2:** `pnpm test -- scripts/estratti` fallisce.
- [ ] **Step 3: implementare** la fixture; scrivere la prossima R libera (percorso completo, domande 1-8 ancora aperte con il loro trattamento).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `test(cli): percorso dei contratti sulla fixture di due appartamenti (piano 7, task 6)`.

## Autoverifica

- **Copertura del disegno:** modello e canone del mese (decisioni 1, 2, 3, 6, «Mie scelte» 1, 2, 7, 8, 10): Task 1; scritture, rifiuti, annullamento (decisione 8, «Mie scelte» 4): Task 2; controlli su presenze e caparre (decisioni 5, 7, «Mie scelte» 3, 5): Task 3; confronto di R4 (decisione 4, «Mie scelte» 6, domande 2, 4): Task 4; riga di comando e R107 («Mie scelte» 8, 9): Task 5; percorso completo: Task 6. Domande 1, 3, 5, 6, 7, 8: fuori dal piano o nessun codice, scritto in «Da confermare con user1».
- **Nessuna regola nuova decisa qui:** nessun calcolo della cedolare (aliquota solo dato), nessun cambiamento al conguaglio, nessun controllo sui versamenti ricevuti né sull'importo della caparra.
- **Firme coerenti:** `Contract` e `rentForMonth` (Task 1) sono letti dai Task 2, 3, 4; `saveContract`/`setContractRent` (Task 2) dalla riga di comando (Task 5); `ContractCheck` (Task 3) riceve `rent-differs` dal Task 4 e va in `contratti` (Task 5).
- **Review Focus nei test:** 1 → Task 2, 3; 2 → Task 1, 2; 3 → Task 4; 4 → Task 4, 6; 5 → Task 5, 6.
