# App Bollette: Piano 3b, inquilini, paganti e incassi

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** dalle entrate già importate di un conto si creano i `Payment` degli inquilini: da soli solo con R4 stretto (pagante confermato per un solo inquilino, importo esatto, mese scelto con `rentLateDays`), tutto il resto come proposta in «Da rivedere». Ogni pagante si conferma una volta sola.

**Architettura:** `payers.ts` ricava la chiave del pagante e i paganti validi; `rent-month.ts` sceglie il mese del canone; `income.ts` (puro) fa le fasi «chi» e «che cosa» e restituisce pagamenti e proposte con `id` deterministici. `income-store.ts` scrive con il registro (`income.reconcile`, `income.confirm`, `tenant.save`) solo se `checkConsistency` è pulito. `undoImport` rifiuta se dei pagamenti dipendono dai movimenti; `pnpm estratti` aggiunge `inquilino`, `riconcilia` e `conferma`.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; nessuna dipendenza nuova, nessun Python.

**Specifica:** il disegno approvato `docs/plans/2026-11-14-piano-3b-inquilini-e-incassi-disegno.md` (decisioni 1-11 e A-E, Ruling 1-2, «Mie scelte» 1-4); il disegno del piano 3 `docs/plans/2026-11-14-piano-3-csv-disegno.md` («Risposte» 3-7, «Mie scelte» 8); `docs/spec.md` sezioni 15 («Conferma alla prima volta») e 42 (R4); `docs/progress.md` R99-R107. Fuori da 3b: uscite, F24, giroconti, saldi, `matchToTransactions` con `statementPeriods` (3c), IMU (3d), interfaccia.

## Metodo di esecuzione

- Un ramo, mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`, `TZ=America/Los_Angeles pnpm test`, `pnpm data:check`, commit. Un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; poi una revisione finale e la PR.
- **Un task = un gate di revisione:** il task N+1 parte solo dopo che il task N ha superato la revisione.
- Le regole nuove vanno in `docs/progress.md` dalla **prossima R libera** (controllare con `grep -n '^- \*\*R[0-9]' docs/progress.md | tail -1` prima di scrivere; al 14 novembre 2026 l'ultima è R107). I task che scrivono una R lo dicono nel loro passo.
- Le regole di calcolo e di confidenza non si decidono da soli: NEEDS_CONTEXT e si chiede a Carlo. **Una è già aperta** (sotto, «Da confermare con Carlo prima del Task 5»).

## Vincoli globali

- Importi in `Cents` interi, date `YYYY-MM-DD`, mesi `YYYY-MM`, calcoli sulle date solo con interi e UTC (`addDays`, `daysBetween`, `addMonths` di `period.ts`); test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura almeno 90% sulle righe di `packages/core/src`.
- `packages/core` puro: niente `node:*`, rete, `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; orologio (`clock: () => string`) e `newId: () => string` sono argomenti.
- Record con `id`, `v: 1`, `rev`, mai cancellati dal disco (`deleted`). Campi nuovi dei record esistenti solo opzionali; nessuna migrazione.
- Nessun dato personale (nomi, IBAN, causali, importi) nei messaggi d'errore, nei `summary` del registro, nelle proposte né nell'uscita predefinita della riga di comando. Fixture sintetiche con nomi inventati; IBAN solo dalla tabella di `fixtures/README.md`.
- Valori esatti dal disegno:
  - «sicuro» = un solo `payer` valido per la chiave e importo esattamente `monthlyRent + monthlyForfait` della presenza nel mese scelto;
  - chiave: `iban:<IBAN normalizzato>` se l'IBAN passa `normaliseIban`, altrimenti `name:<foldText del nome>`; un `payer` `name:` non vale per un movimento con IBAN (decisione B);
  - mese: il più vecchio da pagare; se è il mese della data, quello; se è il mese prima, solo con ritardo = `daysBetween(data, ultimo giorno del mese) <= rentLateDays`; altrimenti revisione;
  - `rentLateDays` intero 0-31, assente = 10 (`DEFAULT_RENT_LATE_DAYS`);
  - ordine «chi è»: nome nella causale a parole intere, importo atteso uguale, presente nel mese senza canone, nome alfabetico (`compareText`), `id`;
  - `validFrom` di un `payer` = primo giorno della prima presenza dell'inquilino nell'appartamento del conto (decisione A);
  - `id`: `pay-<transactionId>` (automatico), `pay-<transactionId>-<n>` (parti confermate, n da 1), `p-chi-<transactionId>`, `p-cosa-<transactionId>`.

## Da confermare con Carlo prima del Task 5

**Da quando un mese conta come «da pagare».** Senza un limite, al primo estratto importato tutti i mesi precedenti della presenza risultano senza canone, e ogni bonifico va in revisione come `late`. Raccomandazione (analogia con R2: un periodo senza estratto si considera pagato, «assunto»): un mese conta come da pagare solo se almeno un giorno del mese è coperto da uno `statement` vivo di un conto dello stesso appartamento. È una regola di confidenza: il Task 5 la riceve come insieme di mesi coperti (`coveredMonths`), così la regola sta in un punto solo. Se Carlo decide altro, cambia solo il calcolo di `coveredMonths`.

## Revisione mirata (Review Focus)

1. **Stesso stato, stesso risultato (Task 5 e 6).** Movimenti, presenze e paganti in ordine mescolato danno le stesse scritture e le stesse proposte; una seconda `runReconcile` non scrive nulla e l'archivio resta identico byte per byte.
2. **Date ai confini (Task 3).** Ritardo 10 e 11 giorni su mesi di 30 e 31 giorni, febbraio 2028 (bisestile), dicembre → gennaio; `rentLateDays: 0` (solo bonifici dentro il mese); il bonifico del 1° del mese dopo con `rentLateDays: 0` va in revisione.
3. **Chiave sporca (Task 2).** IBAN con spazi e minuscole è lo stesso pagante; IBAN con il controllo sbagliato fa usare il nome; nome con spazi doppi, a capo o maiuscole è lo stesso nome; nome vuoto o di soli spazi non dà chiave (proposta senza chiave, nessun `payer` creabile).
4. **Stato cambiato tra proposta e conferma (Task 6).** La proposta è già confermata, il movimento è stato cancellato da `undoImport`, o è nato un `Payment` per quel movimento: `unknown-proposal`, nessuna scrittura.
5. **Presenze ai bordi (Task 4 e 5).** Inquilino che cambia stanza (due presenze consecutive con affitti diversi: vale quella del mese scelto); entrato a metà del periodo; uscito il mese prima del bonifico (canone in ritardo automatico entro la soglia, conguaglio dopo `not-present`); due presenze sovrapposte dello stesso inquilino: rifiuto `tenant-overlap`, mai un abbinamento a caso.

---

## Task 1: record `tenant` e `payer`, `Apartment.rentLateDays`

**Files:** Modify `packages/core/src/model.ts`, `docs/schemas/*.json` (`pnpm schemas:export`), `docs/progress.md` (prossima R libera); Test `packages/core/test/model.test.ts`.

**Interfaces:**

- Consumes: `RecordBaseSchema`, `NonEmptyString`, `ISODateSchema`, `normaliseIban`, `recordSchemas`.
- Produces:
  - `TenantSchema`: `name: NonEmptyString`, `language?: 'it' | 'en'`; `type Tenant`.
  - `PayerKeySchema`: testo `iban:<…>` (con `normaliseIban(resto) === resto`) o `name:<…>` (con `foldText(resto) === resto` e non vuoto); `type PayerKey`.
  - `PayerSchema`: `key: PayerKeySchema`, `tenantId: NonEmptyString`, `validFrom: ISODate`, `validTo?: ISODate` (non prima di `validFrom`), `source: 'confirmed' | 'manual'`; `type Payer`.
  - `ApartmentSchema.rentLateDays?: z.int().min(0).max(31)`; `DEFAULT_RENT_LATE_DAYS = 10`.
  - `recordSchemas` con `tenant` e `payer`.

- [ ] **Step 1: test che falliscono.** `TenantSchema` rifiuta `name: ''` e `language: 'de'`. `PayerSchema` accetta `key: 'iban:IT60X0542811101000000123456'` e `'name:mario rossi'`; rifiuta `'iban:it60x0542811101000000123456'`, `'iban:IT60X0542811101000000123457'`, `'name:Mario Rossi'`, `'name:'`, `'tel:1'`, e `validTo` prima di `validFrom`. `ApartmentSchema` rifiuta `rentLateDays: -1`, `32`, `2.5`; un appartamento senza il campo resta valido. `recordSchemas.tenant` e `.payer` esistono.
- [ ] **Step 2:** `pnpm test -- model` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; scrivere la prossima R libera con il Ruling 2 del disegno (`rentLateDays` 0-31, predefinito 10).
- [ ] **Step 4:** lint, typecheck, test, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): inquilini, paganti e soglia del ritardo nel modello (piano 3b, task 1)`.

## Task 2: chiave del pagante, paganti validi, nome nella causale

**Files:** Create `packages/core/src/payers.ts`; Modify `packages/core/src/index.ts`, `fixtures/README.md` (due IBAN di prova inventati in più, mod-97 valido, con nota), `docs/progress.md` (prossima R libera); Test `packages/core/test/payers.test.ts`.

**Interfaces:**

- Consumes: `normaliseIban`, `foldText`, `compareText`, `Payer`, `PayerKey`, `Tenancy`, `BankTransaction['counterparty']`.
- Produces:
  - `payerKeyOf(counterparty?: { name?: string; iban?: string }): PayerKey | undefined`.
  - `nameKeyOf(counterparty?: { name?: string }): PayerKey | undefined` (la chiave `name:` anche quando c'è l'IBAN, per la decisione B).
  - `validPayers(payers: Payer[], key: PayerKey, date: ISODate): Payer[]`: vivi, `validFrom <= date`, `validTo` assente o `>= date`, ordinati per `tenantId`, un solo record per `tenantId`.
  - `nameInText(name: string, texts: string[]): boolean`: le parole (`/[\p{L}\p{N}]+/gu`) di `foldText(name)` compaiono tutte come parole intere nelle parole di `foldText` di almeno uno dei testi uniti.
  - `firstPresenceDay(tenancies: Tenancy[], tenantId: string, apartmentId: string): ISODate | undefined`: `<from più vecchio>-01` delle presenze vive.

- [ ] **Step 1: test che falliscono.**
  - `payerKeyOf({ iban: 'it60 x054 2811 1010 0000 0123 456', name: 'Mario Rossi' })` dà `'iban:IT60X0542811101000000123456'`; con un IBAN dal controllo sbagliato dà `'name:mario rossi'`; `{ name: '  Mario  ROSSI\n' }` dà `'name:mario rossi'`; `{ name: '   ' }` e `undefined` danno `undefined`.
  - `validPayers`: un pagante cancellato, uno con `validFrom` dopo la data e uno con `validTo` prima sono esclusi; due record dello stesso inquilino ne danno uno; due inquilini ne danno due in ordine.
  - `nameInText('Mario Rossi', ['BONIFICO DA ROSSI MARIO'])` vero; `nameInText('Mario Rossi', ['MARIOROSSI'])` e `(['MARIO ROSSINI'])` falsi.
  - `firstPresenceDay` con presenze `2025-03` e `2024-10` nello stesso appartamento dà `'2024-10-01'`; in un altro appartamento non conta.
- [ ] **Step 2:** `pnpm test -- payers` fallisce.
- [ ] **Step 3: implementare**; aggiungere i due IBAN a `fixtures/README.md`; scrivere la prossima R libera con il Ruling 1 del disegno (nome solo a parole intere).
- [ ] **Step 4:** lint, typecheck, test, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): chiave del pagante e paganti validi (piano 3b, task 2)`.

## Task 3: mese del canone e ritardo

**Files:** Create `packages/core/src/rent-month.ts`; Modify `packages/core/src/period.ts` (esportare `lastDayOfMonth(month: YearMonth): ISODate`; `proposal.ts` usa quella invece della sua `lastDay`), `packages/core/src/index.ts`; Test `packages/core/test/rent-month.test.ts`.

**Interfaces:**

- Consumes: `addDays`, `addMonths`, `daysBetween` (`daysBetween(a, b)` = giorni da b ad a).
- Produces:
  - `lastDayOfMonth(month: YearMonth): ISODate`.
  - `chooseRentMonth(input: { date: ISODate; unpaid: YearMonth[]; lateDays: number }): { status: 'auto'; month: YearMonth } | { status: 'review'; reason: 'late' | 'month-paid' }`. `unpaid` sono i mesi da pagare fino al mese della data compreso (li calcola il Task 5). Vuoto → `month-paid`; il più vecchio è il mese della data → `auto`; è il mese prima e `daysBetween(date, lastDayOfMonth(m)) <= lateDays` → `auto`; ogni altro caso → `late`.

- [ ] **Step 1: test che falliscono** (Review Focus 2):
  - `{ date: '2026-11-10', unpaid: ['2026-10', '2026-11'], lateDays: 10 }` → `auto` `2026-10`; `'2026-11-11'` → `late`;
  - `{ date: '2026-10-03', unpaid: ['2026-10'] }` → `auto` `2026-10`; `unpaid: []` → `month-paid`;
  - `unpaid: ['2026-09', '2026-10', '2026-11']` con data `2026-11-01` e `lateDays: 31` → `late` (due mesi arretrati);
  - `'2028-03-10'` con `['2028-02']` e `lateDays: 10` → `auto`; `'2027-01-10'` con `['2026-12']` → `auto`;
  - `lateDays: 0`: `'2026-11-01'` con `['2026-10']` → `late`;
  - `lastDayOfMonth('2028-02')` = `'2028-02-29'`, `('2026-12')` = `'2026-12-31'`.
- [ ] **Step 2:** `pnpm test -- rent-month` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, test con i due `TZ` passano.
- [ ] **Step 5: commit** `feat(core): mese del canone con la soglia del ritardo (piano 3b, task 3)`.

## Task 4: fase «chi» con le proposte ordinate

**Files:** Create `packages/core/src/income.ts` (prima parte); Modify `packages/core/src/index.ts`; Test `packages/core/test/income-who.test.ts`.

**Interfaces:**

- Consumes: Task 2 (`payerKeyOf`, `nameKeyOf`, `validPayers`, `nameInText`), `Account`, `Apartment`, `Tenancy`, `Tenant`, `Payer`, `Payment`, `BankTransaction`.
- Produces:
  - `IncomeContext = { accounts: Account[]; apartments: Apartment[]; tenancies: Tenancy[]; tenants: Tenant[]; payers: Payer[]; payments: Payment[] }` (record vivi e cancellati: le funzioni filtrano).
  - `whoPaid(tx: BankTransaction, ctx: IncomeContext): WhoResult`, con `WhoResult` uno di:
    - `{ kind: 'skip'; reason: 'no-account' | 'own-account' }` (conto mancante o cancellato; IBAN della controparte uguale all'`iban` di un conto vivo qualunque);
    - `{ kind: 'known'; tenantId: string; key: PayerKey }` (un solo `payer` valido);
    - `{ kind: 'ask'; reason: 'new-payer' | 'multi-tenant' | 'name-only-payer'; tenantIds: string[]; key?: PayerKey }`.
  - Ordine di `tenantIds`: per `multi-tenant` solo gli inquilini dei paganti validi; per `name-only-payer` quelli del `payer` `name:` in cima, poi gli altri; per `new-payer` tutti gli inquilini con una presenza nell'appartamento del conto. Dentro ogni gruppo: `nameInText` vero prima; poi importo uguale a `monthlyRent + monthlyForfait` della presenza nel mese della data; poi presente nel mese della data senza `Payment` `canone` vivo per quel mese; poi `compareText` sul nome (l'`id` se manca il `tenant`), poi `id`.

- [ ] **Step 1: test che falliscono.**
  - un `payer` `iban:` valido → `known`; lo stesso IBAN con un altro nome nella controparte → `known` con lo stesso inquilino;
  - due `payer` con la stessa chiave e inquilini diversi → `ask` `multi-tenant` con solo quei due;
  - un `payer` `name:mario rossi` e un movimento con IBAN e nome `Mario Rossi` → `ask` `name-only-payer` con quell'inquilino primo (decisione B);
  - controparte con l'IBAN di un conto proprio di un altro appartamento → `skip` `own-account`;
  - `new-payer`: quattro inquilini costruiti in modo che ogni criterio decida da solo una coppia (nome, importo, presenza senza canone, alfabetico);
  - un inquilino con due presenze consecutive in stanze diverse compare una volta sola; una presenza senza `tenant` è candidata e ordinata per `id`;
  - nessuna proposta contiene nomi o IBAN (solo `id` e chiave assente se manca).
- [ ] **Step 2:** `pnpm test -- income-who` fallisce.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** lint, typecheck, test, copertura passano.
- [ ] **Step 5: commit** `feat(core): chi ha pagato, con le proposte ordinate senza punteggio (piano 3b, task 4)`.

## Task 5: `reconcileIncome`, fase «che cosa»

Parte solo dopo la risposta di Carlo su «Da confermare con Carlo prima del Task 5».

**Files:** Modify `packages/core/src/income.ts`, `packages/core/src/index.ts`, `docs/progress.md` (prossima R libera); Test `packages/core/test/income.test.ts`.

**Interfaces:**

- Consumes: Task 3 (`chooseRentMonth`, `DEFAULT_RENT_LATE_DAYS`), Task 4 (`whoPaid`, `IncomeContext`), `Statement`, `isPresent` (da esportare da `conguaglio.ts`), `SettlementInputError`.
- Produces:
  - `IncomeReason = 'new-payer' | 'multi-tenant' | 'name-only-payer' | 'amount-differs' | 'late' | 'month-paid' | 'not-present' | 'earlier-open'`.
  - `IncomeProposal = { id: string; transactionId: string; step: 'chi' | 'cosa'; reason: IncomeReason; tenantIds: string[]; key?: PayerKey; month?: YearMonth }`.
  - `PaymentDraft = Omit<Payment, 'v' | 'rev'>`.
  - `reconcileIncome(input: IncomeContext & { transactions: BankTransaction[]; statements: Statement[] }): { payments: PaymentDraft[]; proposals: IncomeProposal[]; skipped: { transactionId: string; reason: 'no-account' | 'own-account' }[] }`, tutto ordinato per `id`.
  - Regole:
    - movimenti vivi, importo positivo, nessun `Payment` vivo con quel `transactionId`; in ordine di `date`, poi `id`;
    - `whoPaid` `ask` → proposta `p-chi-…` con `step: 'chi'`;
    - `known`: se un movimento precedente della stessa corsa ha dato una proposta `cosa` con `tenantIds` uguale a `[tenantId]` → `earlier-open`; se l'inquilino non è presente né nel mese della data né in quello prima → `not-present`; `unpaid` = mesi coperti (`coveredMonths`, dalla risposta di Carlo) con l'inquilino presente e senza `Payment` `canone` vivo, inclusi i pagamenti automatici già decisi nella corsa; poi `chooseRentMonth` con `apartment.rentLateDays ?? DEFAULT_RENT_LATE_DAYS`; se `auto` e l'importo è esattamente affitto più forfait della presenza in quel mese → `PaymentDraft` `pay-<transactionId>` (`kind: 'canone'`, `confirmed: true`, `source: 'csv'`, `forMonth`, `apartmentId` del conto); altrimenti proposta `p-cosa-…` con il motivo (`amount-differs` con il mese proposto);
    - due presenze sovrapposte dello stesso inquilino: `SettlementInputError` `tenant-overlap`, come `collectedForfait`.

- [ ] **Step 1: test che falliscono** (Review Focus 1 e 5):
  - esatto nel mese → un pagamento; 500 € → `amount-differs`; due mesi in un bonifico → `amount-differs`; mese già pagato → `month-paid`; ritardo 10 → automatico, 11 → `late`; `rentLateDays: 5` sull'appartamento sposta il confine;
  - ottobre in revisione e il canone esatto del 3 novembre → `earlier-open` (decisione C); senza la proposta di ottobre lo stesso movimento è automatico;
  - cambio di stanza con affitti diversi: vale la presenza del mese scelto; uscito a ottobre, bonifico esatto il 5 novembre → ottobre automatico; bonifico del 20 dicembre → `not-present`;
  - mese fuori da `coveredMonths` non conta come da pagare;
  - presenze sovrapposte → `tenant-overlap`;
  - `collectedForfait` sui `PaymentDraft` restituiti dà il forfait atteso;
  - movimenti, presenze e paganti mescolati: stesso risultato (`toEqual`); un `Payment` vivo per il movimento → il movimento non compare.
- [ ] **Step 2:** `pnpm test -- income` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera con la regola dei mesi coperti come decisa da Carlo e con la definizione di `earlier-open`.
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): incassi automatici con R4 stretto e proposte (piano 3b, task 5)`.

## Task 6: scritture: riconciliazione, conferma, inquilino

**Files:** Create `packages/core/src/income-store.ts`, `fixtures/income/anno-sintetico.json` (un anno, due conti, quattro inquilini inventati, un genitore che paga per due figli); Modify `packages/core/src/index.ts`, `fixtures/README.md` (la fixture), `docs/progress.md` (prossima R libera); Test `packages/core/test/income-store.test.ts`, `packages/core/test/income-year.test.ts`.

**Interfaces:**

- Consumes: Task 2 (`firstPresenceDay`), Task 5 (`reconcileIncome`, `IncomeProposal`), `commitChange`, `checkConsistency`, `loadAll`, `recordPath`.
- Produces:
  - `saveTenant(store, draft: { id: string; name: string; language?: 'it' | 'en' }, profileId, clock, newId): Promise<Operation>`: `tenant.save`, nuovo o nuova `rev`; `summary` `Inquilino salvato`.
  - `runReconcile(store, profileId, clock, newId, options?: { dryRun?: boolean }): Promise<{ status: 'reconciled'; written: number; proposals: IncomeProposal[]; skipped: number; operationId?: string } | { status: 'refused'; reason: 'inconsistent-store' }>`: una sola operazione `income.reconcile` con i pagamenti nuovi, nessuna se non ce ne sono o con `dryRun`; `summary` `Riconciliati gli incassi: N automatici, M da rivedere.`
  - `confirmIncome(store, input: { proposalId: string; tenantId: string; parts: { kind: Payment['kind']; forMonth: YearMonth; amount: Cents }[]; rememberPayer: boolean }, profileId, clock, newId): Promise<{ status: 'confirmed'; operationId: string; paymentIds: string[]; payerId?: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-proposal' | 'tenant-not-allowed' | 'empty-parts' | 'sum-mismatch' | 'no-presence' }>`.
  - Regole di `confirmIncome`: la proposta si ricalcola con `reconcileIncome` sullo stato attuale (Review Focus 4); `tenantId` deve essere tra i `tenantIds` della proposta per `multi-tenant` e per ogni proposta `cosa`, e avere una presenza nell'appartamento per `new-payer` e `name-only-payer`; parti non vuote con importi positivi e somma uguale all'importo; `payer` (`source: 'confirmed'`, `validFrom` = `firstPresenceDay`) solo se `step` è `chi`, c'è una `key` e `rememberPayer` è vero (decisione D); pagamenti `pay-<transactionId>-<n>` con `confirmed: true`, `source: 'csv'`; una operazione `income.confirm`, `summary` `Confermato un incasso: N pagamenti.`
  - Prima di ogni scrittura (anche `dryRun`) `checkConsistency(store)` vuoto, altrimenti `inconsistent-store` e nulla scritto.

- [ ] **Step 1: test che falliscono** (`MemoryStore`, orologio e `newId` fissi):
  - `income-year`: sulla fixture dell'anno gli automatici sono esattamente quelli elencati nella fixture; dopo **una** `confirmIncome` del pagante di ogni inquilino una nuova `runReconcile` rende automatici i mesi successivi esatti e non lascia nessuna proposta `chi` per quei paganti; il genitore di due figli non è mai automatico;
  - `runReconcile` due volte: la seconda ha `written: 0`, nessun file nuovo nel registro, archivio identico byte per byte; `dryRun` non scrive;
  - `rememberPayer: false` crea i pagamenti e non il `payer`: al movimento dopo torna `chi`;
  - somma diversa → `sum-mismatch`; proposta già confermata, movimento cancellato o pagamento già presente → `unknown-proposal`; inquilino fuori dai due di un `multi-tenant` → `tenant-not-allowed`; nessuna scrittura in nessun caso;
  - un record `diverged` (scritto a mano sopra il registro) → `inconsistent-store` per `runReconcile` e `confirmIncome`;
  - annullare `income.confirm` toglie anche il `payer` e la proposta `chi` torna;
  - nessun `summary` contiene nomi, IBAN, causali o importi.
- [ ] **Step 2:** `pnpm test -- income-store income-year` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (operazioni, rifiuti, `validFrom`, «solo questa volta»).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): riconciliazione e conferma degli incassi con il registro (piano 3b, task 6)`.

## Task 7: `undoImport` rifiuta con pagamenti dipendenti

**Files:** Modify `packages/core/src/statement-import.ts`, `scripts/estratti.mjs` (il comando `annulla` stampa il motivo e gli `id`), `docs/progress.md` (prossima R libera, integra R106); Test `packages/core/test/statement-import.test.ts`, `scripts/estratti.test.mjs`.

**Interfaces:**

- Consumes: `undoImport` di oggi, `loadAll` dei `payment`.
- Produces: nel tipo di ritorno di `undoImport` la variante `{ status: 'refused'; reason: 'dependent-payments'; paymentIds: string[] }` (ordinati), controllata prima di ogni scrittura: un `Payment` vivo il cui `transactionId` è tra i movimenti che l'annullamento cancellerebbe (decisione E).

- [ ] **Step 1: test che falliscono.** Importare, riconciliare (un automatico), `undoImport` → `dependent-payments` con `['pay-<id>']` e archivio invariato; annullata la riconciliazione, `undoImport` → `undone`. Un pagamento su un movimento che l'estratto ha solo trovato già presente non blocca. `estratti annulla` con un pagamento dipendente: codice 1, uscita con `reason` e `paymentIds`, nessun dato personale (`scanText`).
- [ ] **Step 2:** `pnpm test -- statement-import scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera.
- [ ] **Step 4:** lint, typecheck, test, `pnpm data:check` passano.
- [ ] **Step 5: commit** `fix(core): l'annullamento di un estratto rifiuta se dei pagamenti dipendono dai suoi movimenti (piano 3b, task 7)`.

## Task 8: riga di comando `inquilino`, `riconcilia`, `conferma`

**Files:** Modify `scripts/estratti.mjs`, `scripts/estratti.test.mjs`, `docs/progress.md` (prossima R libera).

**Interfaces:**

- Consumes: Task 6 (`saveTenant`, `runReconcile`, `confirmIncome`), `parseEuro`, `FsStore`, `scanText`, le opzioni comuni e i codici di uscita di R107.
- Produces:
  - `estratti inquilino --cartella <dir> --id <id> --nome <testo> [--lingua it|en]`;
  - `estratti riconcilia --cartella <dir> [--prova]`: JSON `{ status, written, proposals: [{ id, step, reason, tenantIds, month? }], skipped }`;
  - `estratti conferma --cartella <dir> --proposta <id> --inquilino <id> --parte <tipo>:<AAAA-MM>:<importo> [--parte …] [--solo-questa-volta]` (`<importo>` letto con `parseEuro`, per esempio `850,00`);
  - `--dettagli` aggiunge a ogni proposta data, importo, causale e i nomi degli inquilini; vietato nei test e nella CI.
  - Codici: 0 riuscito, 1 rifiutato (motivi del core), 2 argomenti non validi (`--parte` malformata, tipo sconosciuto, mese non valido), 3 errore inatteso.

- [ ] **Step 1: test che falliscono.** In una cartella temporanea: `profilo`, `conto`, `inquilino` e `importa` di un CSV sintetico; `riconcilia` dà le proposte attese e codice 0; `conferma` della proposta `chi` con una parte `canone` dà codice 0; `riconcilia --prova` dopo un secondo `importa` mostra un automatico e non scrive nel registro; `riconcilia` lo scrive; `--parte canone:2026-13:850,00` → codice 2; somma sbagliata → codice 1 con `sum-mismatch`. Senza `--dettagli` `scanText` non trova nulla e l'uscita non contiene nomi né causali della fixture.
- [ ] **Step 2:** `pnpm test -- scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera.
- [ ] **Step 4:** lint, typecheck, test, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(cli): pnpm estratti per inquilini, riconciliazione e conferma degli incassi (piano 3b, task 8)`.

## Autoverifica

- **Copertura del disegno:**
  - `tenant`, `payer`, `rentLateDays`: Task 1;
  - chiave, IBAN prevalente, decisione B, parole intere, `validFrom` (A): Task 2 e 6;
  - mese e ritardo: Task 3;
  - ordine «chi è», pagante di più inquilini, conti propri: Task 4;
  - R4 stretto, motivi, `earlier-open` (C): Task 5;
  - operazioni, idempotenza, «solo questa volta» (D), `checkConsistency`: Task 6;
  - `dependent-payments` (E): Task 7;
  - riga di comando senza dati personali: Task 8.
  - Non contabilizzati e doppioni (decisione 8): garantiti dal 3a; il Task 5 legge solo movimenti scritti. Restano fuori `matchToTransactions` e `statementPeriods` (3c).
- **Firme coerenti:**
  - `PayerKey` (Task 1) è prodotta dal Task 2 e portata da `WhoResult` (Task 4) e `IncomeProposal` (Task 5);
  - `PaymentDraft` (Task 5) diventa `Payment` con `v: 1` e `rev` nel Task 6;
  - `IncomeProposal.id` (Task 5) è l'argomento di `confirmIncome` (Task 6) e di `--proposta` (Task 8).
- **Review Focus nei test:** 1 → Task 5 e 6; 2 → Task 3; 3 → Task 2; 4 → Task 6; 5 → Task 4 e 5.
