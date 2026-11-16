# Piano 3d: IMU, rate attese, F24 assegnato alla rata e ripartizione nel saldo (disegno)

Stato: **approvato; domande risposte da user1** (16 novembre 2026). Solo disegno; il piano di implementazione è
`docs/plans/2026-11-16-piano-3d-imu.md`. Il piano copre il core (`packages/core`) e la riga di comando
(`pnpm estratti`); **niente schermate e niente veste grafica**. Riferimenti: disegno e piano del 3c
(`docs/plans/2026-11-15-piano-3c-uscite-disegno.md`, decisioni 5 e 9, domanda 5, «Cosa resta fuori»;
`docs/plans/2026-11-15-piano-3c-uscite.md`, Task 7 e 9), `docs/spec.md` sezioni 23, 24, 34 e 42 (R2 e
R3, che prevalgono), `docs/progress.md` R123-R132 (in particolare R129 sull'F24 e R131 sul saldo).
Codice letto: `model.ts` (`Apartment.cadastre`, `MovementClass`, `MovementRule`, `Instalment`),
`movements.ts`, `outgoing.ts`, `outgoing-store.ts`, `balances.ts`, `split.ts`. Nessun documento reale
aperto.

## Perché

Dopo il 3c un F24 confermato resta sul conto che l'ha pagato e, se è dell'appartamento di quel conto,
finisce in `toSplit` del saldo tra conti, «da ripartire», senza importo (decisione 9 del 3c, R131).
L'F24 dell'IMU di Berchet e Lovarini esce dal conto di Berchet e paga cinque immobili (tre di Berchet,
due di Lovarini) senza dividerli: per R3 va ripartito tra i due appartamenti in parti proporzionali nel
Saldo tra conti, e l'app deve dire se quanto pagato torna con quanto atteso.

## Obiettivo

1. Registrare, per appartamento e anno, gli **importi attesi per rata** (dal prospetto, inseriti più
   tardi) ed eventualmente il totale annuo; modificarli quando serve.
2. **Assegnare un F24 a una rata IMU** di un gruppo di appartamenti, sempre con una conferma.
3. **Controllare ogni rata:** pagato contro atteso, avviso oltre l'1%.
4. **Ripartire** l'F24 tra gli appartamenti del gruppo nel saldo tra conti (dopo le risposte di user1).
5. **Imparare dalla prima assegnazione** per suggerire le successive, mai in automatico (dopo le
   risposte di user1).

## Non obiettivi

- Calcolo dell'IMU (aliquote, rendite, detrazioni, scadenze di legge): nessuna regola fiscale nel
  codice (CLAUDE.md); gli importi arrivano dal prospetto e li inserisce user1.
- Compilazione dell'F24 (sezione 23: l'app non compila nulla).
- Scadenze e pagamenti (stati «in scadenza», «in ritardo», ricevute, Home) e Tasse e stime (sezione
  34): useranno le rate di questo piano, in altri piani.
- IMU di Pulci (user2): fuori da questa richiesta; il modello non la esclude.
- Conguaglio degli inquilini: l'IMU non c'entra (R3) e nessun record del conguaglio cambia.
- Schermate, veste grafica.

## Decisioni già prese da user1

Dalla richiesta del 16 novembre 2026, vincolanti:

1. **Totali IMU 2025** di Berchet e di Lovarini comunicati da user1. Sono dati reali: **non entrano nel
   repository** (CLAUDE.md, `pnpm data:check`), user1 li inserisce con la riga di comando nel suo
   archivio. Le fixture usano importi inventati.
2. **Due rate all'anno** per legge. Il numero di rate e gli importi sono **dati** inseriti da user1,
   non codice (nessuna regola fiscale nel codice).
3. **Prospetto 2026 non ancora disponibile:** il modello accetta gli importi attesi per rata, per
   appartamento e anno, inseriti più tardi; una rata senza importo atteso è ammessa.
4. **Un F24 paga cinque immobili** (tre di Berchet, due di Lovarini) e non li separa.
5. **L'F24 esce dal conto di Berchet** e si ripartisce tra i due appartamenti in proporzione agli
   importi attesi, nel Saldo tra conti (sezione 24, R3).
6. **Riconoscimento:** la prima volta user1 assegna a mano ogni F24 alla sua rata IMU; l'app salva una
   regola e impara; la proposta è **sempre mostrata per conferma**, mai registrata da sola (coerente
   con la decisione 5 del 3c: le proposte `p-f24-` e `BankProfile.f24Pattern`).
7. **Avviso oltre l'1% per rata:** se il pagato differisce dall'atteso di più dell'1%, l'app chiede di
   riconciliare e permette a user1 di modificare gli importi attesi.
8. **L'IMU non entra nel conguaglio degli inquilini:** è un'imposta della proprietà.
9. Vincoli permanenti: importi in `Cents` interi, date `YYYY-MM-DD`, core puro, un JSON per record con
   `id`/`v`/`rev`, mai cancellato dal disco; ogni scrittura dopo `checkConsistency` (R113); rieseguire
   non scrive nulla; nessun dato personale nell'uscita della riga di comando senza `--dettagli`
   (R107); codici di uscita 0/1/2/3.

## Modello dati

Tutti `v: 1`, campi minimi; sui record esistenti solo campi opzionali, nessuna migrazione.

- **`imuYear`** (`_app/dati/imuYear/imu-<apartmentId>-<year>.json`): un record per appartamento e anno.
  Campi: `apartmentId`; `year` (`AAAA`); `f24Group` (testo: gli appartamenti con lo stesso
  `f24Group` e lo stesso `year` sono pagati dallo stesso F24, per esempio `berchet-lovarini`);
  `annualTotal?` (`Cents` > 0, il totale annuo se è l'unico dato noto, come per il 2025); `rates`: una
  voce per rata `{ index, expected?, dueDate? }`, con `index` da 1 a n senza buchi, `expected` `Cents`
  > 0 quando noto, `dueDate` solo come dato inserito (domanda 6). Nessun nome, nessun dato catastale
  (quelli sono già in `Apartment.cadastre`).
- **`MovementClass.imu?`** `{ f24Group, year, rateIndex }`: l'assegnazione di un F24 a una rata. Solo
  con `f24: true` e `apartmentId` uguale all'appartamento del conto che ha pagato (l'F24 da ripartire
  del 3c). Sta nella classe del movimento e non in un record nuovo: un movimento ha una sola classe
  («Mie scelte» 1 del 3c), l'esclusione e `undoImport` la vedono già, e il registro ordina gli
  annullamenti sullo stesso percorso.
- **`imuRule`** (solo dopo le risposte alle domande 7 e 8): la regola appresa per **suggerire** il
  gruppo (e forse la rata) di un F24 nuovo. Non è una `movementRule`: non classifica mai nulla da sola.

Rata IMU = la terna `(f24Group, year, rateIndex)`; i suoi appartamenti sono gli `imuYear` vivi con
quel gruppo e quell'anno.

## 1. Importi attesi

- `setImuYear(store, input, …)`: crea o aggiorna `imu-<apartmentId>-<year>` (nuova `rev`), operazione
  `imu.expected`, `summary` costante `Aggiornati gli importi IMU attesi.`. È anche il modo di
  «modificare i dati iniziali» dopo un avviso (decisione 7).
- Rifiuti senza scrivere: `inconsistent-store`, `unknown-apartment`, `bad-rates` (indici non da 1 a n,
  importo non positivo), `rates-mismatch` (un altro `imuYear` vivo dello stesso gruppo e anno ha un
  altro numero di rate: lo stesso F24 paga la stessa rata di tutti). Stesso contenuto già scritto: nulla
  scritto (`unchanged`).

## 2. Assegnare un F24 a una rata

- `assignImuF24(store, { transactionId, f24Group, year, rateIndex }, …)`: il movimento deve essere
  - una proposta `p-f24-` viva (allora scrive la classe `tasse`, `f24: true`, appartamento del conto,
    con `imu`), oppure
  - già confermato come F24 «da ripartire» (classe viva `f24: true` con l'appartamento del conto, senza
    `imu`: allora la riscrive con `imu`).
- Operazione `imu.assign`, `summary` `Assegnato un F24 a una rata IMU.`; si annulla con
  `annulla-riconciliazione`.
- Rifiuti senza scrivere: `inconsistent-store`; `not-imu-candidate` (né l'uno né l'altro caso, per
  esempio un F24 già assegnato per intero a un altro appartamento con la domanda 5 del 3c);
  `unknown-rate` (nessun `imuYear` vivo del gruppo e dell'anno con quella rata); `payer-not-in-group`
  (l'appartamento del conto non è nel gruppo); `rate-already-paid` (un'altra classe viva ha già la
  stessa rata: domanda 9).
- Nessuna assegnazione nasce da una corsa: è sempre questa conferma (decisione 6).

## 3. Controllo per rata

Funzione pura `imuRates(input: { years, classes, transactions })`: per ogni rata del gruppo, ordinata
per gruppo, anno, indice:

- `expected` = somma degli `expected` della rata negli `imuYear` del gruppo; mancante se manca anche
  per un solo appartamento (domanda 4);
- `paid` = `-tx.amount` dell'F24 assegnato;
- stato: `attesa` (nessun F24), `importo-mancante` (F24 assegnato, atteso incompleto), `pagata`
  (`100 × |paid − expected| ≤ expected`), `da-riconciliare` (oltre l'1%, decisione 7).

Il confronto è sulla rata **del gruppo**, perché l'F24 non separa gli appartamenti. L'1% è calcolato
solo con interi: con atteso 1.000,00 € un F24 di 1.010,00 € è `pagata`, di 1.010,01 € è
`da-riconciliare`. Un avviso `da-riconciliare` si chiude modificando gli importi attesi (`setImuYear`)
o assegnando un altro F24 (annullando l'assegnazione); se si possa accettare la differenza senza
modificare nulla è la domanda 5.

## 4. Ripartizione nel saldo tra conti (domande 1-5 e 10, risposte)

R3 e la decisione 5 fissano: dal conto di Berchet, in parti proporzionali, tra i due appartamenti.
Con le risposte di user1 (domande 1-5 e 10, R164) un F24 di una rata `pagata` dà una voce
`kind: 'imu'` per ogni appartamento del gruppo diverso da quello del conto, con la sua quota
dell'addebito effettivo; una rata non `pagata` resta in `toSplit` con il motivo
(`imu-importo-mancante`, `imu-da-riconciliare`), mai con un importo nel netto. **Esempio
(importi inventati):** rata 1 attesa Berchet 600,00 €, Lovarini 400,00 €; F24 di 1.005,00 € dal conto
di Berchet (dentro l'1%): quote 603,00 € e 402,00 €, «Lovarini deve a Berchet 402,00 €».

## 5. Regola appresa e suggerimento (domande 7 e 8, risposte)

Alla prima assegnazione (salvo «solo questa volta») si salva un `imuRule`; per un F24 nuovo che la
regola copre la proposta `p-f24-` porta un suggerimento (`imuSuggestion`: il gruppo e, con la domanda
7, la rata). Il suggerimento non scrive nulla: l'assegnazione resta `assignImuF24` (decisione 6).
La regola è per conto e chiave della controparte, suggerisce il gruppo; anno e rata vengono dalla
data dell'F24 (la rata aperta con l'indice più basso). R165.

## Riga di comando

- `imu-atteso --cartella <dir> --appartamento <id> --anno <AAAA> --gruppo <id> [--totale <importo>]
  [--rata <n>[:<importo>][:<AAAA-MM-GG>] …]`.
- `imu-f24 --cartella <dir> --movimento <id> --gruppo <id> --anno <AAAA> --rata <n>`.
- `imu --cartella <dir> [--anno <AAAA>] [--dettagli]`: di default solo gruppo, anno, indice, stato e
  numero di F24 per rata; `--dettagli` aggiunge atteso, pagato, differenza e `id` del movimento.
- `saldi` mostra i motivi IMU in `toSplit` (conteggi di default, dettagli con `--dettagli`).
- `annulla-riconciliazione` accetta `imu.assign` e `imu.expected`.
- Codici: 0 riuscito, 1 rifiutato, 2 argomenti non validi, 3 errore inatteso.

## Scritture, registro e annullamento

- Operazioni `imu.expected`, `imu.assign` (e `imu.rule`, o la regola dentro `imu.assign`, dopo la
  domanda 8). `summary` costanti, senza importi né nomi.
- Ogni scrittura rifiuta `inconsistent-store` senza scrivere; la stessa richiesta sullo stesso stato
  non scrive nulla.
- L'assegnazione è un campo della classe: `excludeMovement` la rifiuta già (`already-classified`),
  `undoImport` già (`dependent-records`), e il registro rifiuta l'annullamento della conferma del 3c
  se dopo c'è stata l'assegnazione (stesso percorso: `undoOperation` senza `cascade` rifiuta se un’operazione successiva ne dipende).

## Domande per user1

**Tutte risposte da user1 il 16 novembre 2026** (vincolanti; `docs/progress.md` R164 e R165). Le
decisioni, al posto delle domande:

1. **Base della proporzione:** gli importi attesi della **stessa rata**; con i soli totali annui
   (domanda 10) i totali annui.
2. **Arrotondamento delle quote:** come la TARI comune (`splitSharedDebit`/`splitCents`): resti
   maggiori, a parità il primo appartamento; la somma è sempre l'addebito.
3. **Che cosa si ripartisce:** l'**addebito effettivo** dell'F24, nella proporzione degli attesi
   (esempio della sezione 4: 1.005,00 € → 603,00 e 402,00 €).
4. **Atteso noto per un solo appartamento:** nessuna ripartizione e nessun controllo dell'1%; rata
   `importo-mancante`, F24 in `toSplit`; mai un atteso dedotto per differenza.
5. **F24 fuori tolleranza:** resta fuori dal saldo (`toSplit`, `imu-da-riconciliare`) finché non si
   correggono gli attesi; **nessuna** accettazione della differenza.
6. **Scadenze per rata:** solo dato inserito (`dueDate`), nessuno stato dalla data (gli stati «in
   scadenza» e «in ritardo» restano al piano di Scadenze e pagamenti).
7. **Dalla data dell'F24 alla rata:** l'app suggerisce l'anno della data dell'F24 e la rata aperta
   con l'indice più basso, **sempre da confermare**, mai assegnata da sola.
8. **Criteri della regola appresa:** per conto (`accountId`) e chiave della controparte se c'è;
   suggerisce solo il gruppo sulla proposta `p-f24-`; termina quando user1 assegna diversamente
   (come le regole del 3c); sempre confermata.
9. **Un F24 per due rate o due F24 per una rata:** per ora rifiuto (`rate-already-paid`, una rata
   per F24).
10. **Anno con i soli totali annui:** proporzione sui totali annui e controllo dell'1% **annuo**,
    sulla somma degli F24 dell'anno contro il totale.
11. **Base dell'1%:** l'atteso; esattamente l'1,00% è incluso (`pagata`).
12. **Annullamenti e assegnazioni** (R136, domanda (a)): annullare o cambiare un `imu.expected`
    (`setImuYear` o `annulla-riconciliazione`) quando un F24 è assegnato a una rata che sparirebbe
    o cambierebbe gruppo o numero di rate è **rifiutato**: prima si annulla l'assegnazione.

## Mie scelte (da controllare)

1. **Assegnazione nella classe del movimento** (`MovementClass.imu`), non in un record nuovo.
2. **Rata del gruppo** come unità di controllo: l'F24 non separa gli appartamenti.
3. **`f24Group` è un testo negli `imuYear`**, per anno: nessun record di gruppo; il pagatore è il conto
   del movimento.
4. **Nessuna corsa scrive IMU:** `riconcilia` resta come nel 3c; l'assegnazione è solo una conferma.
5. **Atteso modificabile in ogni momento** con una nuova `rev`; stato e ripartizione si ricalcolano.
6. **Soglia dell'1% come costante del core** (`IMU_TOLERANCE_PERCENT = 1`, come `TRANSFER_LEG_DAYS`):
   è una decisione di controllo di user1, non un'aliquota.
7. **`payer-not-in-group`:** un F24 di un conto il cui appartamento non è nel gruppo non si assegna.
8. **La decisione 5 del 3c resta:** la regola IMU non è una `movementRule` e non classifica nulla.

## Test (solo fixture sintetiche)

- `imuYear`: rate da 1 a n, buchi rifiutati, importo 0 rifiutato, numero di rate diverso nello stesso
  gruppo e anno rifiutato; stessa richiesta due volte → la seconda non scrive.
- assegnazione: da una `p-f24-` e da un F24 «da ripartire»; rifiuti `not-imu-candidate`,
  `unknown-rate`, `payer-not-in-group`, `rate-already-paid`; annullata, l'F24 torna come prima;
  `excludeMovement` rifiuta; `undoImport` rifiuta con `dependent-records`.
- controllo: confini dell'1% (1.010,00 sì, 1.010,01 no; 990,00 sì, 989,99 no), `importo-mancante`,
  `attesa`; modifica dell'atteso porta `da-riconciliare` a `pagata`.
- saldo: con le domande 1-5 aperte, un F24 assegnato resta in `toSplit` con il motivo e nessun
  importo nel netto; nessun record del conguaglio cambia.
- riga di comando: senza `--dettagli` `scanText` non trova importi né causali; codici 0/1/2/3.
- tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`; ingresso mescolato, stesso
  risultato.

## Rischi

- **F24 assegnato alla rata sbagliata:** visibile in `imu`, si annulla con `annulla-riconciliazione`.
- **Atteso inserito male:** l'avviso dell'1% lo segnala solo dopo l'F24; con l'atteso incompleto non
  c'è controllo (domanda 4).
- **Pattern F24 assente** (R129): nessuna `p-f24-`; un F24 confermato a mano come F24 si può comunque
  assegnare.

## Non verificato

- Testo della causale di un F24 IMU nella banca vera (per `f24Pattern` e per la domanda 8).
- Forma del prospetto IMU (per rata o solo annuo) per il 2026.

## Cosa resta fuori

- Scadenze e pagamenti (stati dalla data, Home, ricevute), Tasse e stime (sezione 34).
- Interfaccia e veste grafica.
- IMU di Pulci, F24 di più rate o di più anni (domanda 9).
