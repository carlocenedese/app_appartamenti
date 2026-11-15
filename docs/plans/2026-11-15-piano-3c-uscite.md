# App Bollette: Piano 3c, esclusioni, uscite, F24, giroconti e saldo tra conti

> **Per gli agenti che eseguono:** SOTTO-SKILL OBBLIGATORIA: usare superpowers:subagent-driven-development (consigliata) oppure superpowers:executing-plans per eseguire il piano task per task. I passi usano la sintassi con casella `- [ ]`.

**Obiettivo:** ogni movimento vivo finisce in una sola categoria (escluso, abbinato, pagamento, classificato, giroconto, da rivedere): l'esclusione con conferma, l'abbinamento di bollette e rate con i periodi per conto, le uscite con regole apprese, l'F24 sempre da confermare, i giroconti tra conti propri e il saldo tra conti per coppia di appartamenti.

**Architettura:** funzioni pure per fase (`movements.ts`, `match.ts`, `transfers.ts`, `outgoing.ts`, `balances.ts`) che ricevono lo stato e l'insieme dei movimenti già usati e restituiscono record e proposte con `id` deterministici; un file di scritture per fase (`*-store.ts`) che scrive un'operazione del registro solo se `checkConsistency` è pulito; `reconcile.ts` esegue le fasi nell'ordine D2 (esclusioni → abbinamento → incassi → giroconti → uscite), ognuna con la sua operazione annullabile. `pnpm estratti` aggiunge i comandi.

**Stack tecnologico:** TypeScript strict, Zod 4, Vitest; nessuna dipendenza nuova, nessun Python.

**Specifica:** il disegno `docs/plans/2026-11-15-piano-3c-uscite-disegno.md` (decisioni 1-10, «Mie scelte» 1-13, **risposta di user1 del 15 novembre 2026: ok a tutte le raccomandazioni delle domande 1-11**, che qui sono regole decise); il disegno del piano 3 `docs/plans/2026-11-14-piano-3-csv-disegno.md` (risposte 8, 9, 10, 12, 13, «F24 e saldo tra conti»); `docs/spec.md` sezioni 15, 24 e 42 (R2, R3, R4, R6, R7, che prevalgono); `docs/progress.md` R30 (finestra −5/+10 giorni), R99-R122. Fuori dal 3c: ripartizione dell'F24 per immobile e IMU (3d), Excel e stato «saldato» (piano 5), interfaccia.

## Metodo di esecuzione

- Un ramo (`feat/piano-3c`), mai su `main`. Per ogni task: test che falliscono, codice, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `TZ=Pacific/Auckland pnpm test`, `TZ=America/Los_Angeles pnpm test`, `pnpm data:check`, commit. Un revisore distinto per task (piano, disegno, qualità), fino a 5 giri; poi una revisione finale e la PR.
- **Un task = un gate di revisione:** un task parte solo quando i task da cui dipende hanno superato la revisione. Dipendenze: 2 ← 1; 3 ← 1; 4 ← 1, 3; 5 ← 4; 6 ← 4; 7 ← 6; 8 ← 6; 9 ← 3, 5, 6, 7; 10 ← 5-9.
- Le regole nuove vanno in `docs/progress.md` dalla **prossima R libera** (`grep -n '^- \*\*R[0-9]' docs/progress.md | tail -1`; al 15 novembre 2026 l'ultima è R122). Ogni task scrive la sua R nel passo 3.
- Le regole di calcolo e di confidenza non si decidono da soli: NEEDS_CONTEXT e si chiede a user1. **Una è aperta** (sotto, «Da confermare con user1 prima del Task 9»).

## Vincoli globali

- Importi in `Cents` interi, date `YYYY-MM-DD`, calcoli sulle date solo con interi e UTC (`daysBetween`, `addDays` di `period.ts`); test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; copertura almeno 90% sulle righe di `packages/core/src`.
- `packages/core` puro: niente `node:*`, rete, `Date.now()`, `new Date()` senza argomenti, `Math.random()`, `crypto.randomUUID()`; `clock: () => string` e `newId: () => string` sono argomenti.
- Record con `id`, `v: 1`, `rev`, mai cancellati dal disco (`deleted`); campi nuovi dei record esistenti solo opzionali; nessuna migrazione. Le cartelle seguono le chiavi di `recordSchemas` (come `supplierProfile`): `_app/dati/movementClass/`, `movementRule/`, `transfer/`.
- Ogni scrittura: `checkConsistency(store)` vuoto, altrimenti `inconsistent-store` e nulla scritto (R113); rieseguire una corsa sullo stesso stato non scrive nulla.
- Nessun dato personale (nomi, IBAN, causali, importi) in messaggi d'errore, `summary`, proposte o uscita predefinita della riga di comando (R107); importi e date solo con `--dettagli`. Proposte con soli `id`, motivi costanti e categorie.
- Fixture sintetiche, nomi inventati; nei file e nei commit solo `user1`/`user2`, nessun civico dopo il nome di un appartamento. IBAN solo dalla tabella di `fixtures/README.md`: conti propri Berchet `IT85X0542811101000000000301`, Lovarini `IT58X0542811101000000000302`, Pulci `IT52A9999999999000000000001`; fornitore inventato `IT04X0542811101000000000401` (aggiunto alla tabella con questo piano).
- Valori esatti dal disegno e dalle risposte:
  - finestra di abbinamento `{ daysBefore: 5, daysAfter: 10 }` (R30); gambe di un giroconto: stesso importo, segni opposti, `|daysBetween| <= 5`;
  - chiave della controparte = `payerKeyOf(tx.counterparty)` (`iban:` se l'IBAN è valido, altrimenti `name:`); regola valida = viva, stesso `accountId`, stessa `direction` (segno), stessa chiave, `validTo` assente o `>= date`; **l'importo non conta**; senza chiave nessuna regola (domanda 1);
  - regole `in` solo con chiave `iban:` e solo se nessun `payer` valido ha quella chiave (domanda 2);
  - F24 mai automatico, nemmeno con una regola (decisione 5); un F24 assegnato a un altro appartamento entra nel saldo con l'importo intero (domanda 5);
  - `id`: `mc-<transactionId>`, `rule-<transactionId>`, `tr-<outTransactionId ?? inTransactionId>`, `p-escl-`, `p-abb-<itemId>`, `p-uscita-`, `p-f24-`, `p-giro-<transactionId>`; `pay-<transactionId>-1` per un'uscita verso un inquilino.

## Da confermare con user1 prima del Task 9

**Quali classificazioni entrano nel saldo.** Il disegno dice «le `movementClass` confermate». Raccomandazione: tutte le classificazioni vive non escluse con `apartmentId` diverso dall'appartamento del conto, **anche quelle automatiche** (nascono da una regola che user1 ha confermato), con quota `-tx.amount`: un'entrata classificata (rimborso) per un altro appartamento riduce quindi il suo debito. Esempio (inventato): regola «Associazione Esempio, conto di Berchet → altro, Lovarini»; l'addebito automatico di −40,00 € fa «Lovarini deve a Berchet 40,00 €»; un rimborso di +12,30 € classificato «utenze, Lovarini» sul conto di Berchet lo porta a 27,70 €. Il Task 9 riceve la regola come un filtro in un punto solo (`inBalance(cls)`): se user1 decide «solo le confermate a mano», cambia solo quel filtro (automatica = `ruleId` presente).

## Revisione mirata (Review Focus)

1. **Una sola categoria tra corse diverse (Task 4, 5, 6).** Un movimento usato da una fase in una corsa precedente non è mai preso da un'altra: classificato da una regola e poi bolletta registrata (cede, domanda 6), gamba di un giroconto che ha anche una regola delle uscite, pagamento negativo verso un inquilino. Dopo la corsa completa sulla fixture, mescolata, `movementUses` dà al più un uso per movimento; la seconda corsa non scrive nulla.
2. **Stato cambiato tra proposta e conferma (Task 5, 6, 8).** Movimento escluso, abbinato, cancellato da `undoImport` o già classificato dopo la proposta: `unknown-proposal`, nessuna scrittura.
3. **Date delle gambe ai confini (Task 5).** 5 giorni sì, 6 no, in entrambi i versi; a cavallo dell'anno (`2027-12-30` → `2028-01-03`); stesso importo con lo stesso segno non è una gamba; con i due `TZ`.
4. **Controparte sporca (Task 5 e 6).** IBAN con spazi e minuscole uguale a un conto proprio è un giroconto; IBAN dal controllo sbagliato usa il nome (mai giroconto); nome vuoto o di soli spazi è `no-counterparty` e non crea una regola.
5. **Annullamenti a catena (Task 1, 6).** Esclusione annullata: alla corsa dopo il movimento torna automatico; `outgoing.cancel-auto` annullato: la classificazione torna viva e non è `undone`; `undoImport` con un movimento escluso non è bloccato, con uno classificato sì.

---

## Task 1: `movementClass` ed esclusione

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/income.ts`, `packages/core/src/income-store.ts`, `packages/core/src/index.ts`, `scripts/estratti.mjs`, `docs/schemas/*.json` (`pnpm schemas:export`), `docs/progress.md`; Create `packages/core/src/movements.ts`; Test `packages/core/test/model.test.ts`, `packages/core/test/movements.test.ts`, `packages/core/test/income.test.ts`, `scripts/estratti.test.mjs`.

**Interfaces:**

- Consumes: `RecordBaseSchema`, `NonEmptyString`, `commitChange`, `checkConsistency`, `loadAll`, `recordPath`, `reconcileIncome`.
- Produces:
  - `MovementKindSchema = z.enum(['escluso', 'utenze', 'tasse', 'condominio', 'altro'])`, `OutgoingKindSchema` (le stesse senza `escluso`), `ExcludeReasonSchema = z.enum(['doppione', 'non-contabilizzato', 'non-reale'])`.
  - `MovementClassSchema`: `transactionId`, `kind`, `excludeReason?`, `apartmentId?`, `f24?: z.literal(true)`, `ruleId?`; refine: `id === 'mc-' + transactionId`; `excludeReason` presente se e solo se `kind === 'escluso'`; `apartmentId` presente se e solo se non `escluso`; `f24` solo con `tasse`; `ruleId` mai con `escluso`. `type MovementClass`; `recordSchemas.movementClass`.
  - `excludedIds(classes: MovementClass[]): Set<string>` (vivi `escluso`).
  - `excludeMovement(store, input: { transactionId: string; reason: ExcludeReason }, profileId, clock, newId): Promise<{ status: 'excluded'; operationId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-transaction' | 'already-classified' } | { status: 'refused'; reason: 'has-dependents'; recordIds: string[] }>`: operazione `movement.exclude`, `summary` `Movimento escluso.`; `has-dependents` con gli `id` ordinati di `Payment` vivi e `BillMatch` vivi confermati (non `assumed`) su quel movimento (i `transfer` li aggiunge il Task 5).
  - `reconcileIncome(input & { usedTransactionIds?: ReadonlySet<string> })`: i movimenti nell'insieme non danno né pagamenti né proposte e non bloccano (`earlier-open`). `runReconcile` e `confirmIncome` passano `excludedIds`.
  - `estratti escludi --cartella <dir> --movimento <id> --motivo doppione|non-contabilizzato|non-reale`; `annulla-incassi` accetta anche `movement.exclude`.

- [ ] **Step 1: test che falliscono.**
  - `MovementClassSchema` accetta `{ id: 'mc-t1', transactionId: 't1', kind: 'escluso', excludeReason: 'doppione' }`; rifiuta `escluso` senza motivo, `escluso` con `apartmentId`, `utenze` senza `apartmentId`, `utenze` con `excludeReason`, `f24: true` con `altro`, `id: 'mc-t2'` per `t1`.
  - `excludeMovement` su un doppione: un'operazione `movement.exclude`, `summary` esattamente `Movimento escluso.`; `runReconcile` dopo non dà pagamento né proposta per quel movimento; un canone di ottobre escluso non dà `earlier-open` al canone esatto di novembre (automatico).
  - Rifiuti senza scrivere (registro e archivio invariati): movimento inesistente o cancellato → `unknown-transaction`; già escluso → `already-classified`; con un `Payment` vivo → `has-dependents` con `['pay-t1']`; con un `BillMatch` confermato vivo → `has-dependents` con il suo `id`; record `diverged` → `inconsistent-store`.
  - `undoOperation` dell'esclusione: `mc-t1` cancellato, `runReconcile` dopo rende il movimento automatico come prima (Review Focus 5).
  - Nessuna esclusione senza `excludeMovement`: `runReconcile` su una fixture con un doppione evidente non scrive mai `movementClass`.
  - `estratti escludi` → codice 0 con `{ status: 'excluded', operationId }`; `--motivo altro` → codice 2; `has-dependents` → codice 1 con `recordIds`; `annulla-incassi --operazione <esclusione>` → codice 0.
- [ ] **Step 2:** `pnpm test -- model movements income scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; scrivere la prossima R libera (record `movementClass`, un record per movimento, cartella `movementClass/` invece di `movement-class/` del disegno per la convenzione di `recordSchemas`, rifiuti, «Mie scelte» 2-4).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): escludi un movimento, con conferma e annullabile (piano 3c, task 1)`.

## Task 2: proposta di esclusione dei non contabilizzati superati

**Files:** Modify `packages/core/src/movements.ts`, `scripts/estratti.mjs`, `docs/progress.md`; Test `packages/core/test/movements.test.ts`, `scripts/estratti.test.mjs`.

**Interfaces:**

- Consumes: Task 1 (`MovementClass`, `excludedIds`), `Statement`, `BankTransaction`, `Account`.
- Produces:
  - `ExclusionProposal = { id: string; transactionId: string; reason: 'pending-superseded'; suggestedReason: 'non-contabilizzato' }`.
  - `supersededPending(input: { accounts: Account[]; statements: Statement[]; transactions: BankTransaction[]; classes: MovementClass[] }): ExclusionProposal[]`, ordinate per `id`. Regola (domanda 3): movimento vivo con `booked === false`, conto vivo, senza `movementClass` viva; esiste uno `statement` vivo dello stesso `accountId` che **non** elenca il movimento in `transactionIds`, con `from <= tx.date <= to` e `to` successivo al `to` di ogni `statement` vivo che lo elenca. Mai una scrittura: l'esclusione resta `excludeMovement`.
  - `listExclusionProposals(store): Promise<ExclusionProposal[]>`; `estratti riconcilia` aggiunge `exclusions: [{ id, reason }]`.

- [ ] **Step 1: test che falliscono** (l'esempio della domanda 3):
  - estratto di marzo `2027-03-01`..`2027-03-31` con −25,00 € del `2027-03-30` `booked: false`, estratto di aprile `2027-03-30`..`2027-04-30` che non lo elenca → una proposta `p-escl-<id>` con `suggestedReason: 'non-contabilizzato'`;
  - aprile da `2027-04-01` → nessuna; senza aprile → nessuna; movimento contabilizzato → nessuna; estratto di aprile cancellato → nessuna; un estratto **più vecchio** che copre il giorno e non lo elenca → nessuna;
  - dopo `excludeMovement` la proposta sparisce; `runReconcile` non scrive nulla per la proposta;
  - `estratti riconcilia` mostra `exclusions` con soli `id` e motivo (`scanText` vuoto).
- [ ] **Step 2:** `pnpm test -- movements scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (domanda 3, con la definizione di «più recente»).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ` passano.
- [ ] **Step 5: commit** `feat(core): proposta di esclusione dei non contabilizzati superati (piano 3c, task 2)`.

## Task 3: periodi per conto e abbinamento di bollette e rate

**Files:** Modify `packages/core/src/match.ts`, `packages/core/src/index.ts`, `docs/progress.md`; Create `packages/core/src/match-store.ts`; Test `packages/core/test/match.test.ts`, `packages/core/test/match-store.test.ts`.

**Interfaces:**

- Consumes: Task 1 (`MovementClass`, `excludedIds`), `matchToTransactions`, `validateMatches`, `expectedDebit`, `splitSharedDebit`, `BillMatchSchema`.
- Produces:
  - `MATCH_WINDOW = { daysBefore: 5, daysAfter: 10 } as const` (R30).
  - `statementPeriodsOf(accounts: Account[], statements: Statement[]): MatchInput['statementPeriods']`: un periodo `{ apartmentId: account.apartmentId, from, to }` per `statement` vivo di un conto vivo, ordinati per `apartmentId`, `from`, `to`; mai uniti.
  - `matchId(item: MatchItemRef, part: BillMatch['part'], transactionId: string): string` (lo stesso formato di `makeMatch`, che lo usa).
  - `MatchProposal = { id: string; itemType: MatchItemType; itemId: string; transactionId: string; reason: 'no-supplier' | 'amount-differs' | 'classified' }`.
  - `runMatch(store, profileId, clock, newId, options?: { dryRun?: boolean }): Promise<MatchRunResult>`, con `MatchRunResult = { status: 'matched'; written: number; yielded: number; proposals: MatchProposal[]; pending: MatchItemRef[]; ambiguous: MatchResult['ambiguous']; assumed: MatchItemRef[]; operationId?: string } | { status: 'refused'; reason: 'inconsistent-store' }`.
  - Regole di `runMatch`: movimenti vivi, non esclusi, senza `Payment` vivo; `existing` = `BillMatch` salvati; si scrivono solo i `BillMatch` nuovi `confirmed` con `by: 'auto'` (importi e commissioni); proposte (`confirmed: false`) con `amount-differs` se l'importo è diverso dall'atteso, altrimenti `no-supplier`; presunti, ambigui e proposte mai salvati («Mie scelte» 6). **Domanda 6:** un abbinamento confermato nuovo su un movimento con `movementClass` automatica (`ruleId`) la cancella nella stessa operazione (`yielded`); su uno con classificazione a mano non si scrive e diventa proposta `classified`. Operazione `match.reconcile`, `summary` `Abbinate le voci: N automatiche, M da rivedere.`
  - `confirmMatch(store, input: { parts: { itemType: MatchItemType; itemId: string; transactionId: string; amount: Cents; part: 'amount' | 'commission' }[] }, profileId, clock, newId): Promise<{ status: 'confirmed'; operationId: string; matchIds: string[] } | { status: 'refused'; reason: 'inconsistent-store' | 'empty-parts' | 'unknown-item' | 'unknown-transaction' | 'transaction-used' } | { status: 'refused'; reason: 'invalid-matches'; errors: MatchCheckError[] }>`: `BillMatch` `by: 'manual'`, `confirmed: true`; `validateMatches` sulle voci e sui movimenti delle parti con i confermati esistenti (atteso = `expectedDebit`, per una rata di un avviso comune la sua quota di `splitSharedDebit(-groupTotal, pesi)`); `transaction-used` se il movimento è escluso, ha un `Payment` vivo o una classificazione a mano; una classificazione automatica cede come sopra. Operazione `match.confirm`, `summary` `Confermato un abbinamento: N voci.`

- [ ] **Step 1: test che falliscono.**
  - `statementPeriodsOf`: due estratti dello stesso conto (`2027-01-01`..`2027-01-31`, `2027-03-01`..`2027-03-31`) danno due periodi; estratto cancellato o conto cancellato non conta.
  - Con quei due estratti: rata di scadenza `2027-01-20` con addebito esatto del `2027-01-22` → scritta (`written: 1`); rata del `2027-02-15` → in `assumed`, non scritta; rata del `2027-03-10` senza addebito → in `pending`.
  - addebito escluso → la sua rata resta `pending`; bolletta con addebito esatto senza fornitore nella causale → proposta `no-supplier` `p-abb-<itemId>`; con importo diverso e fornitore → `amount-differs`.
  - domanda 6: `movementClass` con `ruleId` sull'addebito esatto della bolletta Hera di 63,00 € → `match.reconcile` con il `BillMatch` e la cancellazione di `mc-<id>` (`yielded: 1`); `undoOperation` rimette la classificazione e toglie l'abbinamento; con classificazione a mano → proposta `classified`, nulla scritto.
  - due corse: la seconda `written: 0`, registro e archivio identici byte per byte; `dryRun` non scrive; record `diverged` → `inconsistent-store`.
  - `confirmMatch`: bolletta di 100,00 € con due addebiti −60,00 e −40,00 € → `confirmed`; con 60,00 e 30,00 → `invalid-matches` con `item-under`; addebito escluso → `transaction-used`; parti vuote → `empty-parts`; voce inesistente → `unknown-item`; nessuna scrittura nei rifiuti.
- [ ] **Step 2:** `pnpm test -- match match-store` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (periodi per conto, cosa si salva, domanda 6, `match.confirm`).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): abbinamento di bollette e rate con i periodi per conto (piano 3c, task 3)`.

## Task 4: riconciliazione in fasi, una sola categoria, `undoImport`

**Files:** Create `packages/core/src/reconcile.ts`, `fixtures/reconcile/tre-conti.json` (tre conti Berchet, Lovarini, Pulci con gli IBAN di prova, due estratti con un buco, bollette, rate, inquilini, un doppione, un giroconto, uscite verso il fornitore inventato); Modify `packages/core/src/income-store.ts`, `packages/core/src/statement-import.ts`, `packages/core/src/index.ts`, `scripts/estratti.mjs`, `fixtures/README.md` (la fixture), `docs/progress.md`; Test `packages/core/test/reconcile.test.ts`, `packages/core/test/statement-import.test.ts`, `scripts/estratti.test.mjs`.

**Interfaces:**

- Consumes: Task 1 (`excludedIds`), Task 2 (`listExclusionProposals`), Task 3 (`runMatch`, `confirmMatch`), `runReconcile`.
- Produces:
  - `MovementUse = 'escluso' | 'abbinato' | 'pagamento' | 'classificato' | 'giroconto'`.
  - `movementUses(state: { classes: MovementClass[]; payments: Payment[]; matches: BillMatch[] }): Map<string, MovementUse[]>`: record vivi; `abbinato` solo per `BillMatch` confermati non `assumed`. Il Task 5 aggiunge `transfers`.
  - `runReconcile` passa a `reconcileIncome` come `usedTransactionIds` i movimenti con un uso diverso da `pagamento`.
  - `runReconciliation(store, profileId, clock, newId, options?: { dryRun?: boolean }): Promise<{ status: 'reconciled'; exclusions: ExclusionProposal[]; match: MatchRunResult; income: ReconcileRunResult } | { status: 'refused'; reason: 'inconsistent-store' }>`: fasi in ordine, ognuna con la sua operazione; un rifiuto ferma le fasi dopo. I Task 5 e 6 aggiungono `transfers` e `outgoing`.
  - `undoImport`: nuova variante `{ status: 'refused'; reason: 'dependent-records'; recordIds: string[] }` (ordinati, dopo il controllo dei pagamenti): `BillMatch` confermati vivi e `movementClass` vive non `escluso` sui movimenti che cancellerebbe. Le esclusioni non bloccano.
  - Riga di comando: `riconcilia` usa `runReconciliation` e mantiene in cima i campi degli incassi, più `match: { written, yielded, proposals: [{ id, reason }], pending: <n>, assumed: <n> }`; `abbina --parte <bill|instalment>:<voce>:<movimento>:<importo>[:commissione] [--parte …]` (`confirmMatch`, importo con `parseEuro`); `annulla-riconciliazione --operazione <id>` per i tipi `income.reconcile`, `income.confirm`, `income.cancel-payment`, `movement.exclude`, `match.reconcile`, `match.confirm` (gli altri task aggiungono i loro); `annulla-incassi` resta come sinonimo (R116).

- [ ] **Step 1: test che falliscono** (Review Focus 1):
  - sulla fixture `tre-conti`: `runReconciliation` scrive prima `match.reconcile` e poi `income.reconcile`; una nota di credito abbinata a una bolletta non diventa un `Payment`; ogni movimento vivo ha al più un uso in `movementUses`;
  - record della fixture in ordine mescolato → stesse scritture e stesse proposte (`toEqual`); seconda corsa senza scritture, archivio identico byte per byte;
  - `undoImport` con un abbinamento confermato su un suo movimento → `dependent-records` con l'`id` del `BillMatch`, archivio invariato; con un movimento solo escluso → `undone`;
  - `estratti abbina` con una parte malformata → codice 2; `annulla-riconciliazione` di un `match.reconcile` → codice 0; di uno `statement.import` → codice 1 `not-reconcile-operation`; `riconcilia` senza `--dettagli`: `scanText` vuoto, nessun importo né causale della fixture.
- [ ] **Step 2:** `pnpm test -- reconcile statement-import scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (ordine D2, `movementUses`, `dependent-records` che integra R114, comando generico).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): riconciliazione in fasi con una sola categoria per movimento (piano 3c, task 4)`.

## Task 5: giroconti

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/movements.ts`, `packages/core/src/reconcile.ts`, `packages/core/src/match-store.ts`, `packages/core/src/statement-import.ts`, `packages/core/src/index.ts`, `docs/schemas/*.json`, `docs/progress.md`; Create `packages/core/src/transfers.ts`, `packages/core/src/transfer-store.ts`; Test `packages/core/test/transfers.test.ts`, `packages/core/test/transfer-store.test.ts`.

**Interfaces:**

- Consumes: Task 4 (`movementUses`, `runReconciliation`), `normaliseIban`, `daysBetween`.
- Produces:
  - `TransferPurposeSchema = z.enum(['saldo', 'mutuo', 'altro'])`; `TransferSchema`: `fromAccountId`, `toAccountId`, `amount` (intero > 0), `date`, `outTransactionId?`, `inTransactionId?`, `purpose`, `source: 'confirmed' | 'auto' | 'manual'`, `oneOff?: z.literal(true)`; refine: conti diversi; `source: 'manual'` se e solo se nessun movimento, altrimenti almeno uno. `recordSchemas.transfer`.
  - `TRANSFER_LEG_DAYS = 5`.
  - `TransferProposal = { id: string; transactionId: string; fromAccountId: string; toAccountId: string; legIds: string[]; reason: 'new-pair' | 'several-legs' | 'purpose-conflict'; purpose?: TransferPurpose }`; `TransferDraft = Omit<Transfer, 'v' | 'rev'>`.
  - `reconcileTransfers(input: { accounts: Account[]; transactions: BankTransaction[]; transfers: Transfer[]; used: ReadonlySet<string> }): { transfers: TransferDraft[]; proposals: TransferProposal[] }`. Candidati: movimenti vivi, non usati, conto vivo, `normaliseIban(counterparty.iban)` uguale all'`iban` di un **altro** conto vivo (mai dal testo). Ordine: prima le uscite, poi `date`, `id`; un movimento preso come gamba non è più candidato. Gambe: nell'altro conto, movimenti vivi non usati con `amount === -tx.amount` e `|daysBetween| <= 5`. Verso: dal conto dell'uscita a quello dell'entrata. Automatico (domanda 4): esiste un `transfer` vivo `confirmed` senza `oneOff` per lo stesso `(from, to)`, tutti con lo stesso scopo, e al più una gamba candidata → `TransferDraft` `source: 'auto'`; scopi diversi → `purpose-conflict`; più gambe → `several-legs`, mai legate da sole; altrimenti `new-pair`.
  - `runTransfers(store, profileId, clock, newId, options?)`: operazione `transfer.reconcile`, `summary` `Riconciliati i giroconti: N automatici, M da rivedere.`
  - `confirmTransfer(store, input: { proposalId: string; purpose: TransferPurpose; otherLegId?: string; rememberPair: boolean }, …): Promise<{ status: 'confirmed'; operationId: string; transferId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-proposal' | 'leg-not-allowed' }>`: proposta ricalcolata; `otherLegId` deve essere tra `legIds`; assente con una sola gamba → quella; `rememberPair: false` → `oneOff: true` («Mie scelte» 8). Operazione `transfer.confirm`, `summary` `Confermato un giroconto.`
  - `recordManualTransfer(store, input: { fromAccountId: string; toAccountId: string; amount: Cents; date: ISODate; purpose: TransferPurpose }, …)`: `tr-<newId()>`, `source: 'manual'`, operazione `transfer.manual`; rifiuti `unknown-account`, `same-account`, `invalid-amount` (sezione 24: restituzione a mano).
  - Estensioni: `movementUses` riceve `transfers` (`giroconto` per le due gambe); `excludeMovement` `has-dependents` include i `transfer` vivi; `runMatch` salta le gambe; `undoImport` `dependent-records` include i `transfer`; `runReconciliation` aggiunge la fase `transfers` dopo gli incassi.

- [ ] **Step 1: test che falliscono** (Review Focus 3 e 4):
  - −200,00 € dal conto di Lovarini il `2027-04-02` con l'IBAN di Berchet scritto `it85 x054 2811 1010 0000 0000 301`, +200,00 € su Berchet il `2027-04-07` → proposta `p-giro-<uscita>` con `legIds` = [entrata]; entrata il `2027-04-08` → `legIds: []`; due entrate candidate → `several-legs`; +200,00 € con lo stesso segno dell'uscita non è gamba; `2027-12-30` → `2028-01-03` è gamba;
  - conferma `saldo` → un `transfer` con le due gambe; il mese dopo −150,00 € Lovarini → Berchet → automatico `saldo`; Berchet → Lovarini resta `new-pair`; con `rememberPair: false` il successivo non è automatico; due conferme con scopi diversi → `purpose-conflict`;
  - un bonifico al fornitore (`IT04X0542811101000000000401`) o con IBAN dal controllo sbagliato non è mai giroconto; una sola gamba senza estratto dell'altro conto basta;
  - stato cambiato (gamba esclusa o legata a un altro `transfer` dopo la proposta) → `unknown-proposal`, nulla scritto (Review Focus 2);
  - `excludeMovement` su una gamba → `has-dependents` con `tr-<id>`; `recordManualTransfer` con lo stesso conto → `same-account`, con 0 → `invalid-amount`;
  - due corse: la seconda non scrive.
- [ ] **Step 2:** `pnpm test -- transfers transfer-store` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; scrivere la prossima R libera (gambe, domanda 4, `source` al posto di `manual: true` del disegno, restituzione a mano).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): giroconti tra conti propri con le due gambe e lo scopo (piano 3c, task 5)`.

## Task 6: uscite, regole apprese, conferma, annullamento singolo

**Files:** Modify `packages/core/src/model.ts`, `packages/core/src/reconcile.ts`, `packages/core/src/index.ts`, `docs/schemas/*.json`, `docs/progress.md`; Create `packages/core/src/outgoing.ts`, `packages/core/src/outgoing-store.ts`; Test `packages/core/test/outgoing.test.ts`, `packages/core/test/outgoing-store.test.ts`.

**Interfaces:**

- Consumes: Task 1 (`MovementClass`, `OutgoingKindSchema`), Task 4 (`movementUses`, `runReconciliation`), Task 5 (conti propri), `payerKeyOf`, `validPayers`, `reconcileIncome` (per le proposte `p-chi-`), `latestOperationByPath`, `foldText`.
- Produces:
  - `MovementRuleSchema`: `direction: 'in' | 'out'`, `accountId`, `key: PayerKeySchema`, `kind: OutgoingKind`, `apartmentId`, `validTo?`; refine: `direction: 'in'` solo con chiave `iban:`. `recordSchemas.movementRule`.
  - `OutgoingReason = 'new-counterparty' | 'no-counterparty' | 'rule-conflict' | 'undone'` (il Task 7 aggiunge `f24`); `OutgoingProposal = { id: string; transactionId: string; step: 'uscita' | 'f24'; reason: OutgoingReason; suggestedKind?: OutgoingKind }`; `MovementClassDraft = Omit<MovementClass, 'v' | 'rev'>`.
  - `reconcileOutgoing(input: { accounts; transactions; classes; rules; payers; bills; supplierProfiles; used: ReadonlySet<string>; operations: Operation[] }): { classes: MovementClassDraft[]; proposals: OutgoingProposal[]; missingDocument: string[] }`, tutto ordinato per `id`.
  - Regole: candidati vivi, conto vivo, non usati, controparte non conto proprio; uscite (`amount < 0`) e, per la domanda 2, entrate con chiave `iban:` senza `payer` valido. Regole valide (vedi Vincoli): una sola coppia `(kind, apartmentId)` → `mc-<id>` con `ruleId`, `apartmentId` della regola; più coppie → `rule-conflict`; nessuna → `new-counterparty` (o `no-counterparty` senza chiave). Un'entrata senza regola non dà proposta (resta la `p-chi-` degli incassi). `undone`: `mc-<id>` cancellato la cui ultima operazione è `outgoing.cancel-auto` → mai più automatico; cancellato dall'annullamento dell'intera `outgoing.reconcile` → normale (come R118). `suggestedKind` (domanda 7): `utenze` se `foldText` della causale contiene il `supplier` di una bolletta viva o di un `SupplierProfile` vivo; nient'altro. `missingDocument` (domanda 8): classificazioni vive `utenze` o `condominio` senza `BillMatch` confermato vivo sul movimento.
  - `runOutgoing(store, …, options?)`: operazione `outgoing.reconcile`, `summary` `Classificate le uscite: N automatiche, M da rivedere.`
  - `confirmOutgoing(store, input: { proposalId: string; kind: OutgoingKind; apartmentId: string; rememberRule: boolean }, …): Promise<{ status: 'confirmed'; operationId: string; classId: string; ruleId?: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-proposal' | 'unknown-apartment' }>`: `proposalId` è una `p-uscita-` ricalcolata, oppure una `p-chi-` `new-payer` di un'entrata con chiave `iban:` senza `payer`; scrive `mc-<id>` senza `ruleId` e, con `rememberRule` e una chiave ammessa, la regola `rule-<id>` per ultima. Operazione `outgoing.confirm`, `summary` `Classificato un movimento.`
  - `cancelAutomaticClass(store, transactionId, …): Promise<{ status: 'cancelled'; operationId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-class' | 'not-automatic' }>`: operazione `outgoing.cancel-auto`, `summary` `Annullata una classificazione automatica.`; automatica = `ruleId` presente e ultima operazione `outgoing.reconcile`.
  - `runReconciliation` aggiunge la fase `outgoing` dopo i giroconti e toglie da `income.proposals` quelle dei movimenti classificati nella stessa corsa.

- [ ] **Step 1: test che falliscono** (gli esempi delle domande 1, 2, 7, 8):
  - conferma «controparte con l'IBAN del fornitore, conto di Berchet → `altro`, Berchet» per −40,00 € → `mc-` e `rule-`; l'anno dopo −42,00 € sullo stesso conto → automatico con `ruleId`; lo stesso addebito sul conto di Pulci → `new-counterparty`;
  - `rememberRule: false` → nessuna regola; senza controparte → `no-counterparty` e nessuna regola anche con `rememberRule`; nome di soli spazi → `no-counterparty` (Review Focus 4);
  - due regole valide con categorie diverse → `rule-conflict`, nessun automatico;
  - `cancelAutomaticClass` → alla corsa dopo `undone`, mai automatico; annullata l'intera `outgoing.reconcile` → automatico di nuovo; annullato il `cancel-auto` → la classificazione torna viva (Review Focus 5); annullata una conferma → anche la regola cancellata;
  - rimborso +12,30 € con l'IBAN del fornitore e nessun `payer`: `p-chi-` degli incassi; `confirmOutgoing` con quella proposta, `utenze`, Pulci → regola `in`; il rimborso dopo +8,10 € → automatico e senza `p-chi-` nell'uscita di `runReconciliation`; un'entrata da un IBAN con `payer` non è mai classificata; una regola `in` con chiave `name:` è rifiutata dallo schema;
  - «ADDEBITO DIRETTO ENEL» con una bolletta Enel registrata altrove → `suggestedKind: 'utenze'`; «BONIFICO A ROSSI IDRAULICO» → nessun suggerimento;
  - classificato `utenze` senza bolletta → in `missingDocument`; nessun record del conguaglio cambia;
  - stato cambiato tra proposta e conferma → `unknown-proposal` (Review Focus 2); `apartmentId` inesistente → `unknown-apartment`;
  - dopo la corsa completa sulla fixture `tre-conti` `movementUses` dà al più un uso per movimento; seconda corsa senza scritture; nessun `summary` né proposta con nomi, IBAN, causali o importi.
- [ ] **Step 2:** `pnpm test -- outgoing outgoing-store reconcile` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; scrivere la prossima R libera (domande 1, 2, 6, 7, 8, `undone`, conferma di un'entrata dalla proposta `p-chi-`).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(core): uscite con proposte e regole apprese, annullabili (piano 3c, task 6)`.

## Task 7: F24

**Files:** Create `packages/core/src/safe-pattern.ts` (spostare `isSafePattern` da `statement-read.ts`, che la riesporta); Modify `packages/core/src/model.ts`, `packages/core/src/outgoing.ts`, `packages/core/src/outgoing-store.ts`, `docs/schemas/*.json`, `docs/progress.md`; Test `packages/core/test/statement-bank-profile.test.ts`, `packages/core/test/outgoing.test.ts`, `packages/core/test/outgoing-store.test.ts`.

**Interfaces:**

- Consumes: Task 6 (`reconcileOutgoing`, `confirmOutgoing`, `OutgoingProposal`).
- Produces:
  - `BankProfileSchema.f24Pattern?: PatternSchema` con refine `isSafePattern` (sottoinsieme sicuro di R102).
  - `isF24(tx: BankTransaction, profile: BankProfile | undefined): boolean`: `new RegExp(f24Pattern).test(tx.description)`; profilo = quello vivo con `id === account.bankProfileId`.
  - In `reconcileOutgoing`: un F24 dà **sempre** `p-f24-<id>` (`step: 'f24'`, `reason: 'f24'`, `suggestedKind: 'tasse'`), anche con una regola valida; mai una `movementClass` automatica.
  - `confirmOutgoing` input con `f24?: boolean`: con `f24` il `kind` deve essere `tasse` (altrimenti rifiuto `f24-not-tasse`), la classe ha `f24: true`; `apartmentId` qualunque appartamento vivo (domanda 5); nessuna regola creata da un F24. Una `p-f24-` confermata con `f24: false` è un'uscita normale (pattern sbagliato).

- [ ] **Step 1: test che falliscono.**
  - `BankProfileSchema` rifiuta un `f24Pattern` non sicuro (per esempio `(a+)+`) e accetta `^PAGAMENTO F24\b`;
  - «PAGAMENTO F24 DELEGA 0001» −67,00 € → `p-f24-` con `suggestedKind: 'tasse'`; con una regola valida per la sua controparte → ancora `p-f24-` e nessun automatico; senza `f24Pattern` → `p-uscita-`;
  - conferma con `f24: true`, `tasse`, Lovarini sul conto di Berchet → `mc-` con `f24: true` e `apartmentId` Lovarini, nessuna regola; con `f24: true` e `altro` → `f24-not-tasse`, nulla scritto;
  - una `p-uscita-` confermata a mano con `f24: true` vale come F24.
- [ ] **Step 2:** `pnpm test -- statement-bank-profile outgoing` fallisce.
- [ ] **Step 3: implementare**; `pnpm schemas:export`; scrivere la prossima R libera (F24 sempre proposta, domanda 5, testo vero della causale non verificato).
- [ ] **Step 4:** lint, typecheck, test, copertura passano.
- [ ] **Step 5: commit** `feat(core): F24 sempre da confermare (piano 3c, task 7)`.

## Task 8: uscite verso gli inquilini

**Files:** Modify `packages/core/src/outgoing-store.ts`, `packages/core/src/index.ts`, `docs/progress.md`; Test `packages/core/test/outgoing-store.test.ts`.

**Interfaces:**

- Consumes: Task 6 (`OutgoingProposal`, `reconcileOutgoing`), `firstPresenceDay`, `PaymentSchema`.
- Produces: `confirmTenantOutgoing(store, input: { proposalId: string; tenantId: string; kind: 'caparra' | 'conguaglio' | 'altro'; forMonth: YearMonth }, …): Promise<{ status: 'confirmed'; operationId: string; paymentId: string } | { status: 'refused'; reason: 'inconsistent-store' | 'unknown-proposal' | 'tenant-not-allowed' }>` (domanda 9): `proposalId` una `p-uscita-` ricalcolata di un'uscita; `Payment` `pay-<transactionId>-1` con `amount = tx.amount` (negativo), `apartmentId` del conto, `confirmed: true`, `source: 'csv'`; `tenant-not-allowed` per un inquilino cancellato o senza presenza nell'appartamento. Mai da una regola. Operazione `outgoing.tenant`, `summary` `Registrata un'uscita verso un inquilino.`

- [ ] **Step 1: test che falliscono.** Caparra di 600,00 € con 5,40 € di interessi meno 67,00 € di imposta: bonifico −538,40 € → `Payment` `caparra` di −53840 all'inquilino uscente; alla corsa dopo il movimento ha l'uso `pagamento` e nessuna proposta; `reconcileIncome` lo ignora; `excludeMovement` → `has-dependents` con `pay-<id>-1`; inquilino senza presenza → `tenant-not-allowed`; `kind` `canone` non passa il tipo (test di `@ts-expect-error`); una regola sulla stessa controparte non crea mai un `Payment`.
- [ ] **Step 2:** `pnpm test -- outgoing-store` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (domanda 9; il piano 5 userà questi `Payment` per R6).
- [ ] **Step 4:** lint, typecheck, test passano.
- [ ] **Step 5: commit** `feat(core): uscite verso gli inquilini come pagamenti negativi confermati (piano 3c, task 8)`.

## Task 9: saldo tra conti

Parte solo dopo la risposta di user1 su «Da confermare con user1 prima del Task 9».

**Files:** Create `packages/core/src/balances.ts`; Modify `packages/core/src/reconcile.ts`, `packages/core/src/index.ts`, `docs/progress.md`; Test `packages/core/test/balances.test.ts`.

**Interfaces:**

- Consumes: Task 3 (`runMatch` con `dryRun`, `assumed`), Task 5 (`Transfer`), Task 6 e 7 (`MovementClass` con `f24`), `compareText`.
- Produces:
  - `BalanceItem = { date: ISODate; kind: 'rata' | 'bolletta' | 'commissione' | 'uscita' | 'f24' | 'giroconto'; payerApartmentId: string; forApartmentId: string; amount: Cents; refId: string }`: `amount` positivo = quanto `forApartmentId` deve a `payerApartmentId`.
  - `BalancePair = { creditorApartmentId: string; debtorApartmentId: string; amount: Cents; items: BalanceItem[] }` (`amount >= 0`; a 0 il creditore è il primo per `compareText`).
  - `accountBalances(input: { accounts: Account[]; bills: Bill[]; instalments: Instalment[]; matches: BillMatch[]; assumed: MatchItemRef[]; transactions: BankTransaction[]; classes: MovementClass[]; transfers: Transfer[] }): { pairs: BalancePair[]; toSplit: { transactionId: string; apartmentId: string; date: ISODate }[]; unverified: { itemType: MatchItemType; itemId: string; payerApartmentId: string; forApartmentId: string }[] }`.
  - Regole (sezione 24, decisioni 8 e 9, domande 5, 10, 11): `rata`/`bolletta`/`commissione` = `BillMatch` vivi confermati non `assumed` di una rata o bolletta viva di Y su un movimento vivo di un conto di X ≠ Y (l'appartamento del conto, mai `paidFromApartmentId`: fix finale I4, Ruling del coordinatore sulla decisione finale di user1), quota `m.amount` (la commissione per la domanda 10); `uscita`/`f24` = classificazioni vive che passano `inBalance` (risposta di user1) su un conto di X con `apartmentId` Y ≠ X, quota `-tx.amount`; F24 con `apartmentId` uguale a quello del conto → `toSplit`, senza importo; `giroconto` = `transfer` vivi `saldo` tra appartamenti diversi, da F a T: voce `{ payerApartmentId: T, forApartmentId: F, amount: -amount }`; voci `assumed` con conto pagante diverso → `unverified`, mai nel netto; entrate dagli inquilini mai. Netto per coppia non ordinata; voci ordinate per `date`, `kind`, `refId`; coppie per `creditorApartmentId`, `debtorApartmentId`.
  - `loadAccountBalances(store): Promise<LoadAccountBalancesResult>` (`{ status: 'computed', ...saldo }` oppure `{ status: 'refused', reason: 'inconsistent-store' }`): legge i record e gli `assumed` di `planMatch` (lo stesso calcolo di `runMatch` con `dryRun`); non scrive.

- [ ] **Step 1: test che falliscono** (l'esempio del disegno):
  - dal conto di Berchet: quota di Lovarini della TARI comune 8496, rata condominiale di Lovarini di 30000 con commissione 80, uscita al fornitore di −5000 classificata `altro` per Berchet; da Lovarini a Berchet un `transfer` `saldo` di 20000 → una coppia `{ creditorApartmentId: 'berchet', debtorApartmentId: 'lovarini', amount: 18576 }` con quattro voci (8496, 30000, 80, −20000); l'uscita al fornitore non c'è;
  - un `transfer` `saldo` da Berchet a Lovarini di 5000 porta il netto a 23576; uno `mutuo` non conta; uno tra due conti dello stesso appartamento non conta;
  - F24 di 6700 di Lovarini pagato da Berchet → +6700; F24 di Berchet sul suo conto → in `toSplit`, netto invariato;
  - rata di Lovarini presunta (nessun estratto di Berchet per quel mese) → in `unverified`, netto invariato;
  - classificazione `escluso` o cancellata, `BillMatch` non confermato, `Payment` di un inquilino: nessuna voce;
  - ingresso mescolato → stesso risultato (`toEqual`).
- [ ] **Step 2:** `pnpm test -- balances` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (formula del saldo, risposta di user1 su `inBalance`, domande 10 e 11).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, copertura passano.
- [ ] **Step 5: commit** `feat(core): saldo tra conti per coppia di appartamenti con l'elenco delle voci (piano 3c, task 9)`.

## Task 10: riga di comando di uscite, giroconti e saldi

**Files:** Modify `scripts/estratti.mjs`, `scripts/estratti.test.mjs`, `docs/progress.md`.

**Interfaces:**

- Consumes: Task 5 (`confirmTransfer`, `recordManualTransfer`), Task 6 e 7 (`confirmOutgoing`, `cancelAutomaticClass`), Task 8 (`confirmTenantOutgoing`), Task 9 (`loadAccountBalances`), `parseEuro`, `scanText`, codici di uscita di R107.
- Produces:
  - `riconcilia` aggiunge `transfers: { written, proposals: [{ id, reason, legCount }] }` e `outgoing: { written, proposals: [{ id, step, reason, suggestedKind? }], missingDocument: <n> }`;
  - `uscita --proposta <id> --categoria utenze|tasse|condominio|altro --appartamento <id> [--f24] [--solo-questa-volta]`;
  - `annulla-uscita --movimento <id>` (`cancelAutomaticClass`);
  - `uscita-inquilino --proposta <id> --inquilino <id> --tipo caparra|conguaglio|altro --mese <AAAA-MM>`;
  - `giroconto --proposta <id> --scopo saldo|mutuo|altro [--altra-gamba <id>] [--solo-questa-volta]`;
  - `giroconto-manuale --da <conto> --a <conto> --importo <importo> --data <AAAA-MM-GG> --scopo saldo|mutuo|altro`;
  - `saldi [--dettagli]`: di default `{ status: 'ok', pairs: [{ creditorApartmentId, debtorApartmentId, items: <n> }], toSplit: <n>, unverified: <n> }`; `--dettagli` aggiunge `amount` e le voci;
  - `annulla-riconciliazione` accetta anche `outgoing.reconcile`, `outgoing.confirm`, `outgoing.cancel-auto`, `outgoing.tenant`, `transfer.reconcile`, `transfer.confirm`, `transfer.manual`.
  - Codici: 0 riuscito, 1 rifiutato (motivi del core), 2 argomenti non validi (categoria, scopo, tipo, mese o importo non validi), 3 errore inatteso.

- [ ] **Step 1: test che falliscono.** In una cartella temporanea con la fixture `tre-conti`: `riconcilia` → proposte di giroconto e uscite; `giroconto --scopo saldo` e `uscita --categoria altro` → codice 0; il secondo `importa` e `riconcilia` → un giroconto e un'uscita automatici; `saldi` → una coppia con il numero di voci e nessun importo; `saldi --dettagli` → `amount` 18576 sulla fixture dell'esempio; `--categoria varie` → codice 2; `uscita --f24 --categoria altro` → codice 1 `f24-not-tasse`; `annulla-uscita` di una classificazione a mano → codice 1 `not-automatic`. Senza `--dettagli` `scanText` non trova nulla e l'uscita non contiene nomi, IBAN, causali né importi della fixture.
- [ ] **Step 2:** `pnpm test -- scripts/estratti` fallisce.
- [ ] **Step 3: implementare**; scrivere la prossima R libera (comandi, uscita predefinita senza importi, «Mie scelte» 13).
- [ ] **Step 4:** lint, typecheck, test con i due `TZ`, `pnpm data:check` passano.
- [ ] **Step 5: commit** `feat(cli): pnpm estratti per uscite, giroconti e saldo tra conti (piano 3c, task 10)`.

## Autoverifica

- **Copertura del disegno:** esclusione e annullamento (decisione 1, «Mie scelte» 1-4): Task 1; domanda 3: Task 2; periodi per conto, solo confermati salvati, domanda 6 (decisione 3, «Mie scelte» 6): Task 3; fasi D2, una sola categoria, `dependent-records` («Mie scelte» 5): Task 4; giroconti e restituzione a mano (decisioni 6-7, domanda 4, «Mie scelte» 7 e 8): Task 5; regole e uscite (decisione 4, domande 1, 2, 7, 8, «Mie scelte» 9, 10, 12): Task 6; F24 (decisione 5, domanda 5, «Mie scelte» 11): Task 7; domanda 9: Task 8; saldo (decisioni 8 e 9, domande 10 e 11): Task 9; riga di comando e R107 (decisione 10, «Mie scelte» 13): Task 10.
- **Firme coerenti:** `MovementClass` (Task 1) è scritta dai Task 3 (cancellazione), 6, 7 e letta da 4 e 9; `movementUses` (Task 4) riceve `transfers` dal Task 5 ed è l'insieme `used` dei Task 5 e 6; `MatchRunResult.assumed` (Task 3) entra in `accountBalances` (Task 9); `OutgoingProposal.id` (Task 6) è l'argomento di `confirmOutgoing` (Task 6 e 7), `confirmTenantOutgoing` (Task 8) e `--proposta` (Task 10).
- **Review Focus nei test:** 1 → Task 4 e 6; 2 → Task 5, 6, 8; 3 → Task 5; 4 → Task 5 e 6; 5 → Task 1 e 6.
