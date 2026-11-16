# Piano 3d: IMU, rate attese, F24 assegnato alla rata e ripartizione nel saldo (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Solo disegno; il piano di implementazione è
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

## 4. Ripartizione nel saldo tra conti (dopo le domande 1-5)

R3 e la decisione 5 fissano: dal conto di Berchet, in parti proporzionali, tra i due appartamenti.
Restano aperte la base della proporzione, l'arrotondamento, l'importo da ripartire e i casi senza
atteso completo o fuori tolleranza. **Finché user1 non risponde la ripartizione non si calcola:** un
F24 assegnato resta in `toSplit` del saldo come oggi, con in più il motivo e la rata
(`imu-da-ripartire`, `imu-importo-mancante`, `imu-da-riconciliare`), mai con un importo nel netto.

Con le raccomandazioni delle domande 1-3 la voce del saldo sarebbe `kind: 'imu'`, una per ogni
appartamento del gruppo diverso da quello del conto, con la sua quota dell'addebito. **Esempio
(importi inventati):** rata 1 attesa Berchet 600,00 €, Lovarini 400,00 €; F24 di 1.005,00 € dal conto
di Berchet (dentro l'1%): quote 603,00 € e 402,00 €, «Lovarini deve a Berchet 402,00 €».

## 5. Regola appresa e suggerimento (dopo le domande 7 e 8)

Alla prima assegnazione (salvo «solo questa volta») si salva un `imuRule`; per un F24 nuovo che la
regola copre la proposta `p-f24-` porta un suggerimento (`imuSuggestion`: il gruppo e, con la domanda
7, la rata). Il suggerimento non scrive nulla: l'assegnazione resta `assignImuF24` (decisione 6).
Finché le domande 7 e 8 sono aperte, ogni F24 si assegna con gruppo, anno e rata indicati a mano.

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

Regole di calcolo o di fiducia non decise: non le decido io. Finché sono aperte, il punto resta fuori o
dietro un rifiuto esplicito (indicato per ognuna). Per ognuna la mia raccomandazione e un esempio con
importi inventati.

1. **Base della proporzione.** Importi attesi della **stessa rata** o totali annui? Raccomando: la
   stessa rata (l'F24 paga quella); il totale annuo solo se nessuna rata ha importi (domanda 10).
   Esempio: rata 1 attesa 600,00 e 400,00 €, totali annui 1.300,00 e 700,00 €: con la rata il 60%/40%,
   con l'anno il 65%/35%. *Finché è aperta: nessuna ripartizione, F24 in `toSplit`.*
2. **Arrotondamento delle quote.** Raccomando: come la TARI comune (R3, `splitSharedDebit`), resti ai
   resti maggiori, a parità al primo appartamento; la somma è sempre l'addebito. Esempio: 1.000,01 €
   al 50%/50%: 500,01 € e 500,00 €. *Aperta: nessuna ripartizione.*
3. **Che cosa si ripartisce:** l'addebito effettivo o gli importi attesi? Raccomando: l'addebito
   effettivo (è il denaro uscito dal conto) nella proporzione degli attesi. Esempio della sezione 4:
   1.005,00 € → 603,00 e 402,00 €, non 600,00 e 400,00 €. *Aperta: nessuna ripartizione.*
4. **Atteso noto per un solo appartamento** (per esempio il prospetto di Lovarini non c'è ancora).
   Raccomando: nessuna ripartizione e nessun controllo dell'1%; la rata è `importo-mancante` e l'F24
   resta in `toSplit` finché non si inseriscono tutti gli attesi. Esempio: Berchet 600,00 €, Lovarini
   senza importo, F24 1.000,00 €: niente «Lovarini deve 400,00 €» dedotto per differenza. *Già così nel
   piano, come rifiuto.*
5. **F24 fuori tolleranza:** entra nel saldo? E si può **accettare la differenza** (per esempio
   interessi di un ravvedimento) senza modificare gli attesi? Raccomando: non entra finché la rata è
   `da-riconciliare` (come R2 per l'F24 con importo diverso); nessuna accettazione: si modificano gli
   attesi. Esempio: atteso 1.000,00 €, F24 1.030,00 €: resta fuori dal saldo finché user1 non porta
   l'atteso a 1.030,00 € (o lo corregge). *Già così nel piano.*
6. **Scadenze per rata.** La data di scadenza è un dato inserito (`dueDate`) o la si ricava? E quando
   una rata è «in ritardo»? Raccomando: solo dato inserito, nessuna data di legge nel codice; gli stati
   «in scadenza» e «in ritardo» nel piano di Scadenze e pagamenti. Esempio: rata 2 2026 con scadenza
   inserita 2026-12-16 e nessun F24 al 2026-12-20: «in ritardo» solo lì. *Aperta: `dueDate` si salva e
   si mostra, nessuno stato dalla data.*
7. **Dalla data dell'F24 alla rata:** l'app suggerisce anno e rata? Raccomando: suggerisce l'anno della
   data dell'F24 e la rata aperta (senza F24) con l'indice più basso, sempre da confermare. Esempio:
   F24 del 2026-06-14 → 2026 rata 1; F24 del 2026-12-10 con la rata 1 già pagata → 2026 rata 2. *Aperta:
   nessun suggerimento di rata.*
8. **Criteri della regola appresa.** Un F24 spesso non ha controparte (IBAN o nome). Raccomando: regola
   per **conto** (`accountId`) e chiave della controparte se c'è, che suggerisce solo il gruppo;
   termina con una nuova assegnazione diversa (come le regole del 3c). Esempio: assegni il primo F24
   del conto di Berchet al gruppo `berchet-lovarini`; il successivo F24 dallo stesso conto propone
   quel gruppo; un F24 di registro di 67,00 € dallo stesso conto avrebbe lo stesso suggerimento, ma
   resta una proposta e lo assegni a «tasse» senza rata. *Aperta: nessuna regola salvata.*
9. **Un F24 per due rate o due F24 per una rata** (unica soluzione a giugno, integrazione, ravvedimento).
   Raccomando: per ora rifiuto (`rate-already-paid`, una rata per F24); da riprendere se capita.
   Esempio: F24 di 2.000,00 € a giugno che paga rata 1 e 2: oggi non si assegna. *Già così nel piano.*
10. **Anno 2025 con i soli totali annui.** Raccomando: user1 inserisce le due rate dal prospetto 2025 se
    ce l'ha; altrimenti `annualTotal` e un controllo **annuo** (somma dei due F24 contro il totale,
    stesso 1%) e la proporzione sui totali. Esempio: totali 1.300,00 e 700,00 €, F24 di 1.000,00 € e
    1.000,00 €: somma 2.000,00 € in linea; ogni F24 al 65%/35%. *Aperta: con il solo totale annuo la
    rata è `importo-mancante`.*
11. **Base dell'1%.** La decisione dice «differisce dall'atteso»: raccomando l'atteso come base
    (`100 × |pagato − atteso| > atteso`), sulla rata del gruppo. Esempio: atteso 1.000,00 €, F24
    989,99 € → avviso; 990,00 € → in linea. *Usata così nel piano (è la lettura letterale); da
    confermare.*

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
