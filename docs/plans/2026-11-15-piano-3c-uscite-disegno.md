# Piano 3c: esclusioni, uscite, F24, giroconti e saldo tra conti (disegno)

Stato: **bozza da approvare da user1** (15 novembre 2026). Solo disegno, nessun codice e nessun piano
di implementazione. Il piano copre il core (`packages/core`) e la riga di comando (`pnpm estratti`);
**niente schermate e niente veste grafica**. Riferimenti: disegno approvato del piano 3
(`docs/plans/2026-11-14-piano-3-csv-disegno.md`, risposte 8, 9, 10, 12, 13, «Riconciliazione» punti
1, 4 e 5, «F24 e saldo tra conti», «Mie scelte» 9 e 10), disegno del 3b
(`docs/plans/2026-11-14-piano-3b-inquilini-e-incassi-disegno.md`), ricognizione
`docs/plans/2026-11-14-ricognizione-roadmap.md` (ramo `docs/ricognizione-roadmap`, voce C),
`docs/spec.md` sezioni 15 («Conferma alla prima volta»), 18, 23, 24, 30 e 42 (R2, R3, R4, R6, R7, che
prevalgono), `docs/progress.md` R99-R121. Codice letto: `income.ts`, `income-store.ts`,
`statement-import.ts`, `statement-read.ts`, `accounts.ts`, `match.ts`, `model.ts`. Nessun estratto
reale aperto.

## Perché

Dopo 3a e 3b gli estratti sono nell'archivio e le entrate degli inquilini diventano `Payment`, ma:

- un movimento già scritto che non è reale (doppione sfuggito, non contabilizzato tenuto per errore)
  non si può togliere senza annullare l'intero estratto;
- `matchToTransactions` non è chiamato da nessuno fuori dai test: per R2 nessuna bolletta e nessuna
  rata risulta pagata;
- le uscite non abbinate, l'F24, i giroconti e il saldo tra conti (sezione 24) non esistono.

## Obiettivo

1. **Per primo:** l'azione «escludi questo movimento», con una conferma, annullabile.
2. Abbinare bollette e rate ai movimenti con i periodi coperti **per conto**, uno per estratto.
3. Classificare le uscite rimaste (utenze, tasse, condominio, altro) con proposte e regole apprese.
4. F24 sempre da confermare, come uscita da rivedere.
5. Giroconti tra conti propri; nel saldo entra solo la restituzione.
6. Saldo tra conti per coppia, con l'elenco delle voci.

Alla fine **ogni movimento vivo sta in una sola categoria**: escluso, abbinato (bolletta o rata),
pagamento (3b), classificato, giroconto, da rivedere.

## Non obiettivi

- Ripartizione dell'F24 per immobile e IMU di Appartamento A e Appartamento B: **3d**. R3 (IMU) non si tocca.
- Excel, stato «saldato» del conguaglio (R6) e istantanee: piano 5.
- Scadenze e pagamenti (voce F2 della ricognizione), Tasse e stime (sezione 34): useranno le uscite
  classificate, in altri piani.
- Schermate (scheda Movimenti, Saldo tra conti), azioni di massa, veste grafica.
- Smistamento e spostamento dei file.

## Decisioni già prese da user1

Dal disegno del piano 3, dal 3b e dalla richiesta del 15 novembre 2026:

1. **Esclusione solo dopo una conferma** (risposta 12): mai automatica, mai da una regola. Un
   movimento escluso non torna più come proposta in `riconcilia`; l'esclusione si annulla.
2. **Possibile doppione in revisione** (risposta 13): già garantito al momento dell'importazione dalle
   righe `held` (R106). L'esclusione del 3c vale per i movimenti **già scritti**.
3. **Periodi per conto** (R100, R106): un periodo per ogni `statement` vivo di un conto vivo, con
   l'appartamento del conto; più estratti danno più periodi; un buco tra due estratti non è coperto
   (le voci lì restano «assunte», R2).
4. **Regole apprese per le uscite:** si applicano da sole dopo la prima conferma, sempre annullabili
   (risposta 10). Non valgono mai per le entrate da inquilini (R4; disegno del piano 3, punto 5).
5. **F24 sempre da confermare** (risposta 8): nemmeno una regola appresa lo registra da sola.
6. **Giroconti solo tra conti propri** (risposta 9 e «Mie scelte» 10 del piano 3): la proposta nasce
   solo dall'IBAN della controparte uguale a quello di un `account`, mai dal testo della causale. La
   prima volta si conferma lo scopo (restituzione del saldo, mutuo, altro); nel saldo entra solo la
   restituzione, con il suo segno. Un bonifico verso terzi o fornitori è un'uscita.
7. **Abbinamento delle due gambe di un giroconto** (piano 3, «F24 e saldo tra conti»): stesso
   importo, segni opposti, entro 5 giorni.
8. **Saldo mai da una percentuale fissa** (sezione 24): solo da righe dei documenti e abbinamenti.
9. **IMU fino al 3d** (piano 3): un F24 resta tutto sul conto che l'ha pagato, con l'avviso «da
   ripartire»; il saldo tra conti lo elenca a parte, senza importo.
10. Proposte senza dati personali, uscita predefinita della riga di comando con soli `id`, conteggi e
    motivi (R107); prerequisito `checkConsistency` per ogni scrittura (R113).

## Modello dati

Tutti `v: 1`, campi minimi, nessun campo nuovo obbligatorio sui record esistenti.

- **`movementClass`** (`_app/dati/movement-class/mc-<transactionId>.json`): un solo record per
  movimento, quindi un movimento ha al più una classe. Campi: `transactionId`; `kind`: `escluso`,
  `utenze`, `tasse`, `condominio`, `altro`; `excludeReason` (solo e obbligatorio con `escluso`):
  `doppione`, `non-contabilizzato`, `non-reale`; `apartmentId` (destinazione, assente con `escluso`;
  di norma l'appartamento del conto); `f24?: true`; `ruleId?` (la regola che l'ha prodotta). Nessuna
  causale, nessun nome.
- **`movementRule`**: `direction` (`out`, e `in` solo se user1 risponde sì alla domanda 2), `accountId`,
  `key` (la chiave della controparte, stessa forma di `PayerKey`: `iban:` o `name:`), `kind`
  (`utenze`, `tasse`, `condominio`, `altro`), `apartmentId`, `validTo?`. I criteri esatti sono la
  domanda 1.
- **`transfer`**: `fromAccountId`, `toAccountId`, `amount` (positivo), `date`, `outTransactionId?`,
  `inTransactionId?` (almeno uno, oppure `manual: true` per una restituzione registrata a mano,
  sezione 24), `purpose`: `saldo`, `mutuo`, `altro`.
- **`BankProfile.f24Pattern?`**: pattern (sottoinsieme sicuro di R102) che riconosce un F24 nella
  causale. È configurazione della banca, non codice; il testo vero non è verificato (sotto).
- **`Payment`**: nessun campo nuovo; un'uscita verso un inquilino userebbe un importo negativo (domanda
  9).

Proposte: non sono record, si ricalcolano dallo stato (come nel 3b); `id` deterministici
`p-escl-<transactionId>`, `p-uscita-<transactionId>`, `p-f24-<transactionId>`,
`p-giro-<transactionId>`, `p-abb-<itemId>`.

## 1. Escludi questo movimento (per primo)

- `excludeMovement(store, transactionId, reason, …)`: una operazione `movement.exclude` (`Movimento
  escluso.`, summary costante) che scrive `movementClass` `escluso`. È la conferma: nessuna
  esclusione nasce altrove.
- **Rifiuti, senza scrivere:** `inconsistent-store`; `unknown-transaction` (inesistente o
  cancellato); `already-classified` (ha già una `movementClass` viva: prima la si annulla);
  `has-dependents` con l'elenco degli `id` se il movimento ha un `Payment` vivo, un `BillMatch`
  confermato vivo o un `transfer` vivo (come la decisione E del 3b: prima si annullano quelli).
- **Effetto:** ogni fase della riconciliazione (abbinamento, incassi, uscite, giroconti, saldi) legge
  i movimenti **senza** gli esclusi; un escluso non dà più proposte, non blocca altri movimenti
  (`earlier-open` del 3b) e non entra nel saldo.
- **Annullamento:** `undoOperation` dell'esclusione cancella la `movementClass`; alla corsa dopo il
  movimento torna normale (proposte o automatici come prima).
- **Proposta di esclusione** (`p-escl-`): solo se user1 risponde sì alla domanda 3, e sempre da
  confermare.
- Riga di comando: `estratti escludi --movimento <id> --motivo doppione|non-contabilizzato|non-reale`.

## 2. Periodi per conto e abbinamento di bollette e rate

- `statementPeriodsOf(accounts, statements)`: per ogni `statement` vivo di un conto vivo
  `{ apartmentId: account.apartmentId, from, to }` (R106); più estratti dello stesso conto restano
  periodi separati, così un buco resta scoperto.
- `runMatch`: chiama `matchToTransactions` con bollette e rate vive, movimenti vivi non esclusi, i
  periodi, la finestra di R30 e gli abbinamenti esistenti; scrive in un'operazione `match.reconcile`
  i soli abbinamenti **confermati** nuovi (automatici esatti, R15). Proposte (senza fornitore, importo
  diverso), ambigui e presunti si ricalcolano a ogni corsa e non si salvano.
- `confirmMatch`: conferma una proposta o un abbinamento a mano di più voci e più addebiti, con
  `validateMatches` (R2: le somme devono tornare); operazione `match.confirm`.

## 3. Riconciliazione in fasi

Ordine (scelta D2 del piano 3): esclusioni → abbinamento (2) → incassi (3b) → giroconti (5) →
uscite e entrate rimaste (3, 4). Ogni fase riceve l'insieme dei movimenti già usati dalle precedenti
e li salta: `reconcileIncome` riceve in più gli esclusi, quelli abbinati (una nota di credito è
un'entrata abbinata a una bolletta) e quelli classificati. Ogni fase scrive la sua operazione,
annullabile da sola. Un test controlla l'invariante «una sola categoria per movimento».

## 4. Uscite: classificazione, proposte e regole apprese

Movimenti considerati: vivi, non esclusi, non usati dalle fasi prima, importo negativo (e positivo
non da inquilino, se la domanda 2 è sì), conto vivo.

1. **Regola valida, unica, applicabile** → `movementClass` automatica (`ruleId`) nell'operazione
   `outgoing.reconcile` (`Classificate le uscite: N automatiche, M da rivedere.`). Mai per un F24, un
   conto proprio o un movimento con più regole in conflitto (proposta, come il `multi-tenant` del 3b).
2. Altrimenti una proposta `p-uscita-` con un motivo costante (`new-counterparty`, `no-counterparty`,
   `rule-conflict`, `undone`) e, se c'è, la categoria suggerita (domanda 7).
3. **Conferma** (`confirmOutgoing`, operazione `outgoing.confirm`): categoria e appartamento di
   destinazione; crea la regola salvo «solo questa volta» (come la decisione D del 3b).
4. **Annullare** una classificazione automatica da sola (`outgoing.cancel-auto`, come R121) lascia il
   movimento `undone`: non torna automatico. Annullare l'intera `outgoing.reconcile` lo riporta
   normale (come R118). Annullare una conferma toglie anche la regola.
5. Una classificazione è un'informazione: **non crea costi** nel conguaglio (domanda 8) e non nasconde
   il movimento a una bolletta registrata dopo (domanda 6).

## 5. F24

- Riconosciuto da `BankProfile.f24Pattern`, oppure indicato a mano alla conferma (`f24: true`).
- Sempre una proposta `p-f24-`, anche con una regola che lo copre (la regola precompila solo la
  categoria `tasse`). Confermato è una `movementClass` `tasse` con `f24: true` e l'appartamento del
  conto che l'ha pagato.
- Nel saldo tra conti compare nell'elenco «da ripartire (3d)», senza importo (decisione 9); se si può
  assegnare per intero a un altro appartamento già ora è la domanda 5.

## 6. Giroconti

- Un movimento la cui controparte ha l'IBAN di un `account` vivo (`own-account` del 3b, ora anche per
  le uscite) dà una proposta `p-giro-` con l'altro conto.
- **Due gambe:** se nell'altro conto c'è un movimento di segno opposto, stesso importo, entro 5 giorni
  e non usato, la proposta le lega in un solo `transfer`; più candidati → nessun legame automatico,
  la persona sceglie. Senza estratto dell'altro conto basta una gamba.
- Conferma (`confirmTransfer`, `transfer.confirm`): lo scopo. Se i giroconti successivi tra la stessa
  coppia diventino automatici è la domanda 4.
- Giroconto tra due conti dello stesso appartamento: `transfer` registrato, fuori dal saldo («Mie
  scelte» 7).

## 7. Saldo tra conti

Funzione pura `accountBalances(stato) -> { pairs, toSplit }`, per **coppia di appartamenti** (i conti
di un appartamento insieme). Per la coppia (X, Y), «Y deve a X» è:

- \+ le quote di Y pagate da un conto di X: `BillMatch` confermati di rate di Y con conto pagante X
  (rate con `paidFromApartmentId`, avvisi TARI comuni divisi con `splitSharedDebit`), più la
  commissione legata se la domanda 10 è sì;
- \+ le `movementClass` confermate (non escluse) su un conto di X con `apartmentId` Y;
- − i `transfer` `saldo` da un conto di Y a uno di X; + quelli da X a Y;
- poi il netto con il verso opposto: si mostra una sola riga per coppia («Appartamento B deve a Appartamento A
  185,76 €») con l'elenco delle voci (data, tipo, quota, `id` del documento o del movimento).

`toSplit` elenca gli F24 confermati senza importo. Le voci presunte (senza estratto) sono la domanda
11. Le entrate (canoni) non entrano mai nel saldo.

**Esempio (importi inventati).** Dal conto di Appartamento A: quota di Appartamento B della TARI comune 84,96 €
(l'esempio di R3), rata condominiale di Appartamento B 300,00 € con commissione 0,80 €, bonifico a un
fornitore di 50,00 €; dal conto di Appartamento B a quello di Appartamento A un giroconto «saldo» di 200,00 €.
Saldo: 84,96 + 300,00 + 0,80 − 200,00 = **Appartamento B deve a Appartamento A 185,76 €**. Il bonifico al
fornitore non entra (è un'uscita di Appartamento A).

Riga di comando `estratti saldi`: di default solo coppie di `id` di appartamento e numero di voci;
`--dettagli` aggiunge importi, date e voci (R107).

## Scritture, registro e annullamento

- Operazioni: `movement.exclude`, `match.reconcile`, `match.confirm`, `outgoing.reconcile`,
  `outgoing.confirm`, `outgoing.cancel-auto`, `transfer.confirm` (e `transfer.reconcile` se la
  domanda 4 è sì). Summary costanti con soli conteggi.
- Tutte rifiutano `inconsistent-store` senza scrivere; rieseguire una corsa sullo stesso stato non
  scrive nulla.
- `undoImport` (R114) si estende: rifiuta anche con abbinamenti confermati, classificazioni o
  `transfer` vivi sui movimenti che cancellerebbe (`dependent-records`, con gli `id`). Le esclusioni
  non bloccano («Mie scelte» 4).
- `annulla-incassi` diventa un annullamento generico delle operazioni della riconciliazione (stesso
  controllo `has-dependents`); `statement.import` resta solo da `annulla`.

## Domande per user1

Risposta (15 novembre 2026): ok a tutte le raccomandazioni, 1–11.

Regole di calcolo o di fiducia: non le decido io. Per ognuna la mia raccomandazione e un esempio con
importi inventati.

1. **Quando una regola appresa vale per un'uscita nuova?** Raccomando: stessa controparte (IBAN, se
   no il nome), stesso conto, uscita; **l'importo non conta**; senza controparte nessuna regola (sempre
   proposta). Esempio: confermi «SUNIA, IBAN …, conto Appartamento A → altro, Appartamento A» per 40,00 €; l'anno
   dopo SUNIA addebita 42,00 € sullo stesso conto: classificato da solo. Lo stesso addebito sul conto
   di Appartamento C: proposta. (Il disegno del piano 3 parlava di «testo nella causale»: raccomando la
   controparte perché la causale cambia a ogni mese.)
2. **Regole anche per le entrate che non sono degli inquilini** (rimborsi dei fornitori)? Raccomando:
   sì, solo per IBAN e solo se quell'IBAN non ha nessun `payer` (mai per nome). Esempio: un rimborso
   Enel di 12,30 € con IBAN Enel, confermato «utenze, Appartamento C»; il rimborso dopo, 8,10 €, si classifica
   da solo. Un bonifico da un genitore senza `payer` resta «chi è».
3. **Proporre l'esclusione di un non contabilizzato superato?** Un movimento tenuto con `booked:
   false` il cui giorno è coperto da un estratto più recente dello stesso conto che non lo contiene
   più. Raccomando: sì, **solo proposta** (`p-escl-`, motivo `pending-superseded`), l'esclusione resta
   una conferma. Esempio: estratto di marzo con «−25,00 € in lavorazione» del 30 marzo, tenuto;
   l'estratto di aprile (che copre anche il 30 marzo) ha −25,00 € del 31 marzo contabilizzato con
   causale diversa: proposta di escludere il primo.
4. **Giroconti dopo la prima conferma automatici?** Raccomando: sì, per la stessa coppia di conti e
   lo stesso verso, con lo scopo confermato, annullabili (come le regole delle uscite). Esempio:
   confermi Appartamento B → Appartamento A 200,00 € «saldo»; il mese dopo Appartamento B → Appartamento A 150,00 € diventa da
   solo «saldo» e il debito scende di 150,00 €. Appartamento A → Appartamento B resta proposta.
5. **Un F24 si può assegnare per intero a un altro appartamento già nel 3c?** Raccomando: sì, alla
   conferma, e allora entra nel saldo con l'importo intero; la divisione per righe resta al 3d.
   Esempio: imposta di registro di 67,00 € di Appartamento B pagata con F24 dal conto di Appartamento A: «Appartamento B
   deve a Appartamento A 67,00 €». Un F24 IMU con due immobili resta «da ripartire», senza importo.
6. **Una bolletta registrata dopo che una regola ha classificato il suo addebito:** vince la bolletta?
   Raccomando: sì per le classificazioni automatiche (la regola cede, nella stessa operazione
   dell'abbinamento, annullabile); una classificazione confermata a mano resta e l'abbinamento diventa
   proposta. Esempio: la regola classifica «Hera −63,00 €» come utenze; poi registri la bolletta Hera
   di 63,00 €: l'addebito si abbina alla bolletta ed entra nel conguaglio (R2).
7. **Che cosa suggerisce la proposta per un'uscita mai vista?** È solo l'ordine, mai un automatico.
   Raccomando: fornitore noto nella causale → `utenze`; F24 → `tasse`; nient'altro (nessuna categoria
   dalle parole della causale, le categorie della banca non contano, R4). Esempio: «ADDEBITO DIRETTO
   ENEL −48,20 €» senza bolletta: proposta `utenze`; «BONIFICO A ROSSI IDRAULICO −120,00 €»: nessun
   suggerimento.
8. **Un'uscita classificata `utenze` o `condominio` senza documento entra nel conguaglio?**
   Raccomando: **no**; resta segnalata «documento mancante» finché non si registra la bolletta o la
   rata. Esempio: addebito Enel −48,20 € classificato utenze, bolletta non registrata: nessuna quota
   agli inquilini; quando registri la bolletta, si abbina e conta.
9. **Uscite verso un inquilino** (restituzione della caparra, conguaglio a credito, rimborso, R6):
   come si registrano? Raccomando: sempre da confermare, mai da una regola, come `Payment` con
   importo negativo (`caparra`, `conguaglio`, `altro`, mai `canone`) e il mese indicato. Esempio:
   restituzione della caparra di 600,00 € con 5,40 € di interessi meno 67,00 € di imposta: bonifico
   −538,40 € → `Payment` `caparra` −538,40 € all'inquilino uscente; il piano 5 lo userà per R6.
10. **La commissione di una rata pagata per un altro appartamento va nel saldo?** R7 dice che è parte
    della voce. Raccomando: sì. Esempio: rata di Appartamento B 300,00 € dal conto di Appartamento A più 0,80 € di
    commissione: Appartamento B deve 300,80 €.
11. **Le voci presunte (periodo senza estratto) entrano nel saldo?** Raccomando: no, elencate a parte
    «non verificate», senza importo nel netto. Esempio: rata di Appartamento B di 300,00 € del 2025, nessun
    estratto di Appartamento A per quel mese: non entra nei 185,76 € dell'esempio, ma compare nell'elenco.

## Mie scelte (da controllare)

1. **Un record per movimento** (`mc-<transactionId>`) per esclusione e categoria: due classi per lo
   stesso movimento non possono esistere.
2. **Escludere non cancella il movimento:** `deleted` resta il segno dell'annullamento dell'estratto,
   così le due azioni non si confondono.
3. **Esclusione rifiutata con dipendenti** (`has-dependents`): come la decisione E del 3b, niente
   cascata.
4. **L'esclusione sopravvive all'annullamento e alla reimportazione dello stesso estratto** (stesso
   `id` del movimento) e non blocca `undoImport`; si toglie solo annullandola.
5. **Fasi in operazioni separate**, ognuna annullabile da sola, nell'ordine D2.
6. **Solo gli abbinamenti confermati si salvano;** proposte, ambigui e presunti si ricalcolano (come le
   proposte del 3b).
7. **Saldo per coppia di appartamenti**, non di conti: oggi c'è un conto per appartamento e la
   sezione 24 parla di appartamenti («Appartamento B deve a Appartamento A»).
8. **«Solo questa volta»** anche per le uscite e i giroconti, come la decisione D del 3b.
9. **Annullare una sola classificazione automatica** lascia il movimento `undone`, come R118 e R121.
10. **Regole in conflitto** (due regole valide con categorie diverse): proposta, mai automatico.
11. **F24 riconosciuto da un pattern del profilo della banca** (dati), più la scelta a mano.
12. **Commissione non legata a un addebito abbinato:** un'uscita come le altre.
13. **`saldi` senza importi di default** (R107): gli importi solo con `--dettagli`.

## Test (solo fixture sintetiche)

Fixture con due conti (Appartamento A, Appartamento B) e un terzo (Appartamento C), IBAN di prova già in
`fixtures/README.md` per i conti propri, più un IBAN inventato per un fornitore da aggiungere alla
tabella:

- escludi: un doppione escluso sparisce dalle proposte e dal saldo; annullato torna; rifiuti
  `has-dependents` e `already-classified`; nessuna esclusione senza conferma;
- due estratti dello stesso conto con un buco: le voci nel buco presunte, le altre in attesa o
  abbinate;
- uscite: prima conferma con regola, seconda automatica; `undone` dopo l'annullamento singolo;
  conflitto di regole; F24 mai automatico;
- giroconti: due gambe legate, una gamba sola, verso opposto aumenta il debito, bonifico a un
  fornitore mai giroconto;
- saldo dell'esempio: 185,76 € con l'elenco delle voci;
- invariante «una sola categoria per movimento»; ingresso mescolato, stesso risultato; corsa ripetuta
  senza scritture, archivio identico byte per byte;
- riga di comando: senza `--dettagli` `scanText` non trova nomi, IBAN, causali né importi;
- tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.

## Rischi

- **Regola troppo larga:** con «l'importo non conta» (domanda 1) una controparte che cambia natura
  (stesso IBAN per servizi diversi) si classifica in silenzio. Visibile nell'elenco degli automatici,
  annullabile.
- **F24 non riconosciuto** se il pattern è sbagliato o assente: finisce tra le uscite «da rivedere»,
  oppure in automatico se una regola copre la controparte; il danno è visibile tra gli automatici e
  si annulla con `cancelAutomaticClass`.
- **Giroconto con la controparte senza IBAN:** non riconosciuto, va «da classificare» (piano 3,
  «Rischi»).
- **Esclusione sbagliata:** un movimento vero escluso non entra in nulla. Si vede nell'elenco degli
  esclusi, si annulla.

## Non verificato

- Testo della causale di un F24 nella banca vera (per `f24Pattern`); serve lo strumento di struttura o
  una riga anonimizzata con user1.
- Se i giroconti tra i conti propri portano l'IBAN della controparte in entrata e in uscita.
- Se le date di un movimento non contabilizzato cambiano alla contabilizzazione (domanda 3).

## Task proposti (il piano li dettaglierà)

| # | Titolo | Dipende da |
| --- | --- | --- |
| 1 | `movementClass` ed esclusione (`excludeMovement`, annullamento, filtro in `reconcileIncome`, comando `escludi`) | — |
| 2 | Proposta di esclusione dei non contabilizzati superati (solo se domanda 3 sì) | 1 |
| 3 | Periodi per conto e abbinamento di bollette e rate (`statementPeriodsOf`, `runMatch`, `confirmMatch`) | 1 |
| 4 | Riconciliazione in fasi, movimenti usati, invariante «una sola categoria», `undoImport` con `dependent-records` | 1, 3 |
| 5 | Giroconti (`transfer`, proposte da IBAN propri, due gambe, scopo) | 4 |
| 6 | Uscite: `movementRule`, proposte, automatici, conferma, annullamento singolo | 4 |
| 7 | F24 (`f24Pattern`, proposta sempre da confermare) | 6 |
| 8 | Uscite verso gli inquilini (solo se domanda 9 sì) | 6 |
| 9 | Saldo tra conti (`accountBalances`) | 3, 5, 6, 7 |
| 10 | Riga di comando di uscite, giroconti e `saldi`; Ruling in `docs/progress.md` | 5-9 |

## Cosa resta fuori

- **Interfaccia:** scheda Movimenti di «Da rivedere», Saldo tra conti sulla Home e in Banca, azioni di
  massa, veste grafica (con user1).
- **3d:** ripartizione dell'F24 per immobile (IMU di Appartamento A e Appartamento B) e correzione di R3.
- **Excel e piano 5:** colonne del file riservato, stato «saldato» dei conguagli (R6), uso dei
  `Payment` negativi.
- Scadenze e pagamenti, Tasse e stime, smistamento dei file.
