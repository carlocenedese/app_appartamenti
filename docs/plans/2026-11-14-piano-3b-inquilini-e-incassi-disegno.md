# Piano 3b: inquilini, paganti e incassi (disegno)

Stato: **bozza, da approvare da Carlo.** Solo disegno, nessun codice. Il piano copre il core
(`packages/core`) e la riga di comando (`pnpm estratti`); **niente schermate e niente veste
grafica**. Riferimenti: disegno approvato del piano 3 (`docs/plans/2026-11-14-piano-3-csv-disegno.md`,
«Risposte» 3-7, 12, 13 e «Mie scelte» 8), piano 3a (`docs/plans/2026-11-14-piano-3a-conti-ed-estratti.md`),
ricognizione `docs/plans/2026-11-14-ricognizione-roadmap.md` (ramo `docs/ricognizione-roadmap`, voci C
e I «record dell'inquilino»), `docs/spec.md` sezioni 6, 11, 15 («Conferma alla prima volta»), 17,
18, 31 e 42 (R4, R6, che prevalgono), `docs/progress.md` R99-R107. Nessun estratto reale aperto.

## Perché

Il piano 3a porta i movimenti nell'archivio, ma nessuna entrata diventa ancora un `Payment`. Per R4
il forfait che conta è quello incassato (`collectedForfait`), quindi senza 3b ogni inquilino risulta
in arretrato. 3a e 3b insieme sono il minimo per l'uso reale (disegno del piano 3, «Sotto-piani»).

## Obiettivo

Dalle **entrate** già importate di un conto, riconoscere chi paga, proporre l'inquilino e creare i
`Payment` (`source: 'csv'`): da soli solo con R4 stretto, altrimenti con una proposta in «Da
rivedere». Ogni pagante si conferma **una sola volta** per inquilino; dopo, i suoi bonifici esatti
del mese si registrano da soli.

## Non obiettivi

- Uscite, regole apprese per le uscite, F24, giroconti, saldo tra conti e la chiamata di
  `matchToTransactions` con i periodi per conto (`statementPeriods`, costruiti come dice R106):
  tutto nel 3c. Il 3b non abbina bollette né rate.
- IMU (3d). Stato «saldato» del conguaglio (R6) ed Excel: piano 5; qui solo i `Payment` di tipo
  `conguaglio` che quel piano leggerà.
- Scheda completa dell'inquilino (sezioni 26 e 31: documenti, note, cartelle), lingua dei messaggi
  oltre al campo: piani successivi.
- Uscite verso gli inquilini (rimborsi, restituzione della caparra, R6 a credito): 3c e piano 5.
- Schermate, azioni di massa, veste grafica.

## Decisioni già prese da Carlo

Dal disegno del piano 3 (14 novembre 2026) e dalla ricognizione:

1. **«Sicuro» solo con R4 stretto:** pagante già confermato per quell'inquilino e importo
   esattamente `monthlyRent + monthlyForfait` del mese abbinato. Tutto il resto è «da rivedere», con
   il più probabile in cima e **senza punteggio** (decisione 3, risposta 5).
2. **Ordine delle proposte «chi è»:** nome nella causale (tutte le parole), poi importo atteso
   uguale, poi presenza nel mese senza pagamento, poi alfabetico (risposta 5).
3. **Conferma una sola volta per associazione** pagante → inquilino (sezione 15,
   apprendimento supervisionato); la conferma crea un record `payer` con data di validità.
4. **L'IBAN prevale sul nome:** la chiave del pagante è l'IBAN se c'è; lo stesso IBAN con un nome
   diverso è lo stesso pagante (risposta 7).
5. **Pagante di più inquilini: mai automatico** (risposta 6).
6. **Mese del canone automatico:** il mese della data, se non è già pagato; un mese precedente ancora
   da pagare solo se il ritardo non supera `rentLateDays`, impostazione dell'appartamento, 10 se non
   indicata (risposta 4). **Misura** («Mie scelte» 8, confermata): ritardo = giorni tra l'ultimo
   giorno del mese da pagare e la data del bonifico; un bonifico dentro il mese ha ritardo 0; due
   mesi arretrati vanno sempre in revisione.
7. **Le categorie della banca non contano** (R4); le regole apprese non valgono mai per le entrate
   da inquilini (disegno del piano 3, «Riconciliazione», punto 5).
8. **Movimenti non contabilizzati** esclusi solo dopo una conferma e **possibili doppioni** in
   revisione (risposte 12 e 13): già garantiti dal 3a (righe `held` mai scritte finché una persona non
   decide, R106). Il 3b legge solo movimenti scritti, quindi non vede mai una riga `held`.
9. **Giroconti solo tra conti propri** (risposta 9): un'entrata con l'IBAN della controparte uguale a
   quello di un `account` non è di un inquilino; il 3b la lascia al 3c senza proposta «chi è».
10. **Riconciliazione in un'operazione separata** dall'importazione, pura, con `id` deterministici;
    rieseguirla su uno stato già riconciliato non scrive nulla («Mie scelte» 3 del piano 3).
11. **Prerequisito (R106, R107):** la riconciliazione non parte se `checkConsistency` segnala
    problemi (per esempio un'importazione interrotta, N2).

## Modello dati

Tutti `v: 1`, campi minimi, nessun campo nuovo obbligatorio sui record esistenti.

- **`tenant`** (manca; `Tenancy.tenantId` oggi è una stringa senza record): `name` (nome e cognome
  come nel contratto), `language?: 'it' | 'en'`. L'`id` è quello già usato da `Tenancy.tenantId` e
  `Payment.tenantId`. Nessun altro dato personale («Mie scelte» 4 del piano 3).
- **`payer`** (approccio C2 del piano 3): `key` (`iban:<IBAN normalizzato>` o
  `name:<foldText del nome>`), `tenantId`, `validFrom` (`YYYY-MM-DD`), `validTo?`, `source`
  (`confirmed` per ora; `manual` quando l'interfaccia permetterà di inserirlo a mano, sezione 17
  punto 7). Un record per associazione: un genitore che paga per due figli sono due `payer` con la
  stessa `key`.
- **`Apartment.rentLateDays?`**: intero da 0 a 31; assente vale 10 (decisione 6). Il 10 è il valore
  deciso da Carlo, scritto una volta come costante con nome, non una regola fiscale.
- **`Payment`**: nessun campo nuovo. Un pagamento creato da un movimento ha `source: 'csv'`,
  `transactionId`, `confirmed: true`, `forMonth` sempre esplicito. Un bonifico di più mesi o di più
  tipi dà più `Payment` con lo stesso `transactionId`, la cui somma è l'importo del movimento.
- **Proposte:** non sono record. Si ricalcolano a ogni `reconcile` dallo stato; l'`id` è
  deterministico (`p-chi-<transactionId>`, `p-cosa-<transactionId>`), così la riga di comando può
  confermarle per `id`.

`id` dei pagamenti: `pay-<transactionId>` per il canone automatico, `pay-<transactionId>-<n>` per le
parti di una conferma (n da 1, nell'ordine dato).

## Riconciliazione delle entrate

Funzione pura `reconcileIncome(stato, opzioni) -> { writes, proposals, skipped }`, con `stato` =
conti, appartamenti, presenze (`tenancy`), `tenant`, `payer`, movimenti e pagamenti vivi.

**Movimenti considerati:** vivi, con `accountId` di un conto vivo, importo positivo, nessun
`Payment` vivo con quel `transactionId`. Si elaborano in ordine di data e poi di `id`, così un
ingresso mescolato dà lo stesso risultato e i pagamenti automatici di un movimento valgono per i
successivi.

### Fase «chi»

1. **Chiave:** `iban:` dalla controparte se l'IBAN c'è e passa `normaliseIban`, altrimenti `name:`
   con `foldText`; senza nessuno dei due, nessuna chiave.
2. **Conto proprio:** IBAN di un `account` (anche di un altro appartamento) → `skipped:
   'own-account'`, lasciato al 3c.
3. **Paganti validi** alla data: i `payer` vivi con quella chiave e `validFrom <= data <= validTo`.
   - uno solo → l'inquilino è quello;
   - più di uno (inquilini diversi) → proposta «chi è» con **solo quegli inquilini**, in cima, mai
     automatico (decisione 5);
   - nessuno → proposta «chi è» con gli inquilini che hanno una presenza nell'appartamento del conto,
     nell'ordine della decisione 2. «Importo atteso» = `monthlyRent + monthlyForfait` del mese della
     data; «presenza senza pagamento» = presente in quel mese e senza `Payment` `canone` confermato.
4. **Nome nella causale:** tutte le parole di `foldText(tenant.name)` compaiono come parole intere
   in `foldText(description)` o nel nome della controparte. Nessuna somiglianza parziale.

Confermare una proposta «chi è» crea il `payer` e, nella stessa operazione, risponde anche al «che
cosa» di quel movimento (la sezione 15 chiede le due cose insieme). Per quel pagante la domanda «chi
è» non torna più (decisione 3); per un pagante di più inquilini torna a ogni movimento, ma solo con i
suoi inquilini.

### Fase «che cosa»

Con un inquilino unico dato da un `payer`, il movimento si registra **da solo** (`Payment` `canone`)
solo se tutte queste condizioni valgono:

1. la chiave ha un solo `payer` valido (decisione 5);
2. il mese scelto è «da pagare»: l'inquilino è presente nell'appartamento del conto e non ha un
   `Payment` `canone` vivo (confermato o no) per quel mese;
3. il mese si sceglie così (decisione 6): sia M il mese più vecchio da pagare, fino al mese della
   data compreso; se M è il mese della data, M; se M è il mese prima e il ritardo è al massimo
   `rentLateDays`, M; altrimenti revisione (`late`);
4. l'importo è esattamente `monthlyRent + monthlyForfait` della presenza in M.

Tutto il resto è una proposta «che cosa è» con l'inquilino già scritto e un motivo costante:
`amount-differs` (500 €, parziali, più mesi, compensazioni: R4), `late`, `month-paid` (anticipo o
mese già pagato), `not-present` (conguaglio o caparra di chi è uscito o deve entrare),
`multi-tenant`. La conferma indica una o più parti `{ kind, forMonth, amount }` con somma uguale
all'importo; il tipo è uno di `canone`, `caparra`, `conguaglio`, `altro`.

### Proposte e conferme senza dati personali

Le proposte portano `id`, motivo, `transactionId`, gli `id` degli inquilini in ordine e il mese
proposto; mai nomi, causali o IBAN. La riga di comando li mostra solo con `--dettagli` (R107).

## Scritture, registro e annullamento

- `reconcile`: **una** operazione `income.reconcile` con tutti i pagamenti automatici della corsa;
  `summary` costante con soli conteggi (`Riconciliati gli incassi: 12 automatici, 3 da rivedere.`).
  Nessuna operazione se non c'è nulla da scrivere.
- `confirmIncome(proposalId, scelta)`: una operazione `income.confirm` con l'eventuale `payer` e i
  `Payment`. Rifiuta senza scrivere se la proposta non esiste più nello stato attuale, se le somme
  non tornano, se l'inquilino non è tra quelli ammessi per un pagante di più inquilini.
- Annullare `income.reconcile` toglie i pagamenti automatici; annullare una conferma toglie anche il
  `payer`, e la domanda «chi è» torna.
- **Dipendenze verso il 3a:** R106 dice che `undoImport` non controlla i pagamenti che puntano ai
  movimenti. Il 3b aggiunge il controllo: `undoImport` rifiuta con `dependent-payments` (domanda 5).
- **Prerequisito:** `reconcile` e `confirmIncome` chiamano prima `checkConsistency`; con un problema
  rifiutano con `inconsistent-store` e non scrivono nulla. La riga di comando dà codice 1 e un
  messaggio costante.

## Riga di comando

Si aggiungono a `pnpm estratti` (R107), stesse opzioni comuni (`--cartella`, `--utente`, `--ora`):

- `estratti inquilino --cartella <dir> --id <id> --nome <testo> [--lingua it|en]`: crea o aggiorna
  un `tenant` (serve finché non c'è la scheda).
- `estratti riconcilia --cartella <dir> [--prova]`: `--prova` calcola e stampa senza scrivere.
- `estratti conferma --cartella <dir> --proposta <id> --inquilino <id> --parte <tipo>:<AAAA-MM>:<importo> ...`.
- Uscita JSON con soli conteggi, motivi e `id`; `--dettagli` (vietato nei test e nella CI) aggiunge
  data, importo, causale e nomi.

## Task previsti (il piano li dettaglierà)

1. `tenant`, `payer`, `Apartment.rentLateDays`; schemi esportati.
2. Chiave del pagante e paganti validi (`payerKey`, `validPayers`), con IBAN prevalente.
3. Mese del canone e ritardo (`chooseRentMonth`), solo con interi e UTC.
4. `reconcileIncome` puro: fasi «chi» e «che cosa», ordine delle proposte.
5. Scritture: `reconcile`, `confirmIncome`, prerequisito `checkConsistency`, controllo
   `dependent-payments` in `undoImport`.
6. Riga di comando `inquilino`, `riconcilia`, `conferma`.

## Test (solo fixture sintetiche)

Fixture di un anno su due conti: inquilini con nomi inventati, IBAN di prova aggiunti alla tabella di
`fixtures/README.md` (oggi ce n'è uno solo), canoni di importi diversi.

- Gli automatici sono esattamente quelli attesi; dopo **una** conferma del pagante i mesi successivi
  con importo esatto sono automatici e nessuna domanda «chi è» si ripete.
- Ritardo di 10 giorni automatico, di 11 in revisione; con `rentLateDays: 5` il confine si sposta;
  due mesi arretrati sempre in revisione; anticipo (`month-paid`).
- Stesso IBAN con nome diverso: stesso pagante; nome uguale con IBAN diverso: non lo stesso.
- Pagante di due inquilini: mai automatico, proposta con solo quei due.
- Ordine «chi è» su ogni criterio, e a parità alfabetico.
- 500 €, parziale, più mesi, conguaglio dopo l'uscita: proposta con il motivo giusto; conferma in
  più parti con somma che non torna rifiutata.
- Entrata da un conto proprio: `own-account`, nessuna proposta.
- `collectedForfait` sui pagamenti creati dà i valori attesi.
- Ingresso mescolato, stesso risultato; `reconcile` due volte: la seconda non scrive nulla e
  l'archivio è identico byte per byte.
- `checkConsistency` con un problema: nessuna scrittura. `undoImport` con pagamenti dipendenti:
  `dependent-payments`.
- Riga di comando: senza `--dettagli` `scanText` non trova nomi, IBAN né causali.
- Tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.

## Mie scelte (da controllare)

1. **Proposte non salvate:** si ricalcolano dallo stato; si salvano solo le risposte (`payer`,
   `Payment`). Niente record da tenere allineati, e un estratto annullato fa sparire le sue proposte.
2. **Un `Payment` non confermato blocca il mese** come uno confermato (condizione 2 del «che
   cosa»): oggi nessun percorso ne crea, ma un `Payment` `manual` in bozza non deve far nascere un
   secondo canone per lo stesso mese.
3. **Candidati «chi è»:** tutti gli inquilini con una presenza nell'appartamento del conto, anche
   passata o futura (caparra prima dell'ingresso, conguaglio dopo l'uscita); l'ordine li separa.
4. **Nome nella causale solo a parole intere**, nessuna distanza tra stringhe: niente punteggi
   nascosti (decisione 1).
5. **Un `tenant` senza nome** non esiste: una presenza il cui `tenantId` non ha un record `tenant` è
   candidata, ma senza il criterio del nome, e la riga di comando lo segnala nei conteggi.

## Rischi

- **Ritardo entro la soglia preso per il mese sbagliato** (già nel piano 3): un bonifico esatto nei
  primi 10 giorni, con il mese prima da pagare, va al mese prima. Visibile nell'elenco dei
  registrati automaticamente; si corregge annullando.
- **Nome della controparte letto male dal profilo:** chiave diversa a ogni mese, domande ripetute.
  Si vede dai conteggi; si corregge con il profilo vero (3a, Task 9).
- **Pagante comune a due inquilini mai visto come tale:** la prima conferma crea un solo `payer` e i
  bonifici dell'altro inquilino diventerebbero automatici sul primo se l'importo coincide. Mitigato
  dalla domanda 3 (proposta aperta) e dall'importo esatto della presenza; resta un rischio da
  mostrare nell'elenco dei registrati automaticamente.
- **Privacy:** nomi degli inquilini in chiaro nei record `tenant`, come gli altri dati (decisione 1
  del piano 3); mai nei log, nei `summary` né nell'uscita predefinita.

## Non verificato

- Dove stanno nome e IBAN di chi paga nella causale dei bonifici in entrata della banca vera (piano 3,
  «Non verificato»): dipende dal profilo del 3a-bis. Senza controparte la chiave è il nome ricavato,
  o nessuna.
- Se la banca mette l'IBAN dell'ordinante nei bonifici in entrata o solo il nome.

## Domande aperte per Carlo

1. **Da quando vale un pagante confermato** (`validFrom`)? Se vale dalla data del bonifico
   confermato, gli estratti più vecchi importati dopo richiedono di nuovo «chi è» (contro la
   decisione 3). **Raccomando: dal primo giorno della prima presenza di quell'inquilino
   nell'appartamento**, senza fine finché non la si mette a mano.
2. **Un pagante salvato col solo nome vale per un bonifico che porta anche un IBAN?** Con «l'IBAN
   prevale» le due chiavi sono diverse. **Raccomando: no automatico; proposta con quell'inquilino in
   cima e, alla conferma, un secondo `payer` con l'IBAN** (una sola domanda in più, poi mai più).
3. **Una proposta aperta su un mese blocca gli automatismi dei mesi dopo dello stesso inquilino?**
   Esempio: ottobre arriva come 500 € (in revisione), il 3 novembre arriva il canone esatto; con la
   regola del mese più vecchio andrebbe a ottobre. **Raccomando: sì, finché un movimento precedente
   dello stesso inquilino è in revisione, i successivi vanno in revisione** (motivo
   `earlier-open`); dopo la conferma, `riconcilia` li registra da soli.
4. **«Solo questa volta»:** confermando un «chi è» si può dire che il pagante non va ricordato (un
   amico che paga una volta)? **Raccomando: sì, opzione esplicita**; senza di essa la conferma crea
   sempre il `payer`.
5. **Annullare un estratto con pagamenti già creati dai suoi movimenti:** rifiuto o annullamento a
   cascata? **Raccomando: rifiuto (`dependent-payments`) con l'elenco degli `id`**, e si annullano
   prima le conferme o la riconciliazione; la cascata cancellerebbe conferme fatte a mano senza
   vederle (sezione 35).
