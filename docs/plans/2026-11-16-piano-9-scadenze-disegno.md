# Piano 9: scadenze e pagamenti del proprietario, core e riga di comando (disegno)

Stato: **implementato; regole non decise in «Domande per user1»** (16 novembre 2026). Solo disegno; il piano di implementazione è
`docs/plans/2026-11-16-piano-9-scadenze.md`. Il piano copre il core (`packages/core`) e la riga di
comando (`pnpm estratti`); **niente schermate, niente cruscotto e niente veste grafica**. Riferimenti:
`docs/spec.md` sezioni 10, 23, 30, 34, 38, 39 e 42 (che prevale), `docs/progress.md` R17, R107, R112,
R113, R125, R129, R133-R136, R157-R166, R180-R184. Codice letto: `model.ts` (`Apartment`, `Contract`,
`Instalment`, `BillMatch`, `MovementClass`, `ImuYear`, `RentYear`), `imu.ts` (`imuRates`),
`imu-store.ts`, `match.ts` (`expectedDebit`, `validateMatches`), `match-store.ts`, `movements.ts`
(`undoBlockedBy`), `contract-store.ts` (`setRentYear`, `loadRentYears`), `excel-owners.ts`,
`scripts/estratti.mjs`. Nessun documento reale aperto; nomi e importi inventati.

## Perché

La sezione 23 chiede una lista unica «Scadenze e pagamenti» delle imposte e spese del proprietario:
per ogni voce appartamento, intestatario, scadenza, importo atteso e stato (da pagare, in scadenza,
pagata, in ritardo). Oggi i pezzi esistono sparsi: le rate IMU con la scadenza inserita a mano e l'F24
assegnato (piano 3d), le rate di condominio e TARI con gli abbinamenti agli addebiti (piano 3c), gli
affitti dell'anno con la stima della cedolare (R182), le date dei contratti (piano 7). Mancano la
lista che li mette insieme e un modo di scrivere le voci che non nascono da nessun documento:
imposta di registro, bollo, F24 in generale.

## Obiettivo

1. **Scadenziario derivato** (sola lettura, funzione pura con `today` come argomento): una voce per
   ogni rata IMU di gruppo, ogni rata viva di condominio e TARI, ogni voce a mano; stato dalla data e
   dalle prove di pagamento che esistono già.
2. **Voci a mano** (record nuovo `payable`): appartamento, tipo, scadenza, importo se noto, ripetizione
   annuale come **segno** scritto dall'utente; si segnano pagate a mano o con un movimento già
   classificato, e si annullano con `annulla-riconciliazione`.
3. **Riga di comando**: `scadenze` (lista con filtri), `scadenza-nuova`, `scadenza-pagata`,
   `scadenza-ripeti`.

## Non obiettivi

- Schermate, cruscotto della Home, semaforo e colori (sezione 10): domanda 3.
- Ricerca automatica del pagamento nel CSV dopo la scadenza con regola appresa (sezione 23, «Controllo
  sul CSV»): un piano successivo; oggi la prova di pagamento è solo quella già scritta.
- Ricevuta allegata: domanda 5.
- Calcolo di qualunque scadenza, importo o termine di legge (CLAUDE.md, sezione 39).
- Tabella delle tasse per contribuente (sezione 34): il piano dà l'«ancora previsto», non la tabella.

## Decisioni già prese da user1 (vincolanti)

1. Una rata o voce è **in ritardo dal giorno dopo la scadenza**, nessuna tolleranza.
2. Le scadenze sono **solo dati inseriti**: nessuna data di legge nel codice (R165, domanda 6).
3. IMU, F24 e rate condominiali escono dai conti degli appartamenti (sezione 23, 14 novembre).
4. **Non deciso**: la finestra «in scadenza» e le regole della ripetizione annuale (vedi domande).

## Modello dati

Record nuovo `payable` (`_app/dati/payable/scad-<uuid>.json`, `v: 1`, schema
`docs/schemas/payable.json`):

| Campo | Tipo | Note |
| --- | --- | --- |
| `apartmentId` | testo | appartamento vivo |
| `kind` | `registro` \| `bollo` \| `cedolare` \| `f24` \| `altro` | IMU, condominio e TARI nascono dai loro record |
| `dueDate` | `AAAA-MM-GG` | inserita da user1 |
| `expected?` | centesimi > 0 | assente = «importo da inserire» |
| `repeatYearly?` | `true` | solo un segno: nessuna voce nasce da sola |
| `previousId?` | testo | la voce da cui `scadenza-ripeti` ha creato questa |
| `paid?` | `{ date, transactionId? }` | segnata pagata (a mano o con un movimento) |

`id` = `scad-<id generato>` (refine). Nessuna descrizione libera e nessun nome: l'intestatario è
`Apartment.locatore` dell'appartamento.

## 1. Lo scadenziario (funzione pura)

`scadenzario({ today, soonDays?, apartments, imuYears, classes, transactions, instalments, matches,
payables, contracts })` → `{ items, contractEnds }`.

Voce: `{ source: 'imu' | 'instalment' | 'payable', id, kind, apartmentIds, taxpayers, dueDate?,
expected?, state, paidOn?, transactionId?, check?, repeatYearly?, repeated? }`.

- **IMU**: una voce per rata di gruppo di `imuRates` (`id` = `<gruppo>/<anno>/<rata>`, `kind` `imu`,
  appartamenti del gruppo, `dueDate` ed `expected` come li dà `imuRates`). Pagata solo con lo stato
  `pagata` di `imuRates` (F24 assegnato e importo entro l'1%, R135); con un F24 assegnato ma stato
  `da-riconciliare` o `importo-mancante` la voce **resta da pagare** (sezione 42: «la voce resta in
  attesa finché non si corregge il documento o non si abbina a mano») con `check` uguale a quello stato.
- **Rate di condominio e TARI**: una voce per `Instalment` vivo (`kind` = quello della rata, `expected`
  = `expectedDebit`). Pagata quando gli abbinamenti confermati vivi, non presunti, di parte `amount`
  sommano a `expectedDebit` (come R184); con una somma diversa resta da pagare con
  `check: 'importo-diverso'`. Per una rata di un avviso comune basta un abbinamento confermato: le somme
  le ha già controllate `validateMatches` alla conferma (R125). `paidOn` = la data più recente degli
  addebiti. Senza addebito, se nessun estratto del conto che paga copre la scadenza, la voce
  ha `check: 'periodo-senza-estratto'` e lo stato dalla data (domanda 7, non decisa).
- **Voci a mano**: pagate con `paid` (se c'è un `transactionId`, solo se il movimento e la sua classe
  sono ancora vivi).
- **Stato**: `pagata` come sopra; altrimenti `in-ritardo` se `today` è **dopo** `dueDate` (decisione 1);
  `in-scadenza` solo se il chiamante passa `soonDays` e `dueDate − today ≤ soonDays`; altrimenti
  `da-pagare`. Senza `dueDate` (una rata IMU senza data) la voce è `da-pagare`. Date come testo
  `AAAA-MM-GG` e `daysBetween` in interi UTC.
- **Intestatari** (`taxpayers`): i `locatore` distinti degli appartamenti della voce, ordinati.
- **Fine dei contratti** (`contractEnds`): i contratti vivi con `end` dal mese di `today` in poi
  (`contractId`, `apartmentId`, `end`), senza stato: non sono pagamenti. Il preavviso non c'è nei
  dati e resta fuori (domanda 6).
- **Cedolare**: la stima di R182 non diventa una voce (non ha scadenza e non si paga da sola); la riga
  di comando la mostra a parte con `--dettagli`, come stima (domanda 4).

Ordine: `dueDate` (le voci senza data in fondo), poi `source`, poi `id`.

## 2. Scrivere le voci a mano

- `savePayable(store, { id?, apartmentId, kind, dueDate, expected?, repeatYearly? }, …)`: senza `id`
  crea `scad-<newId()>`, con `id` aggiorna (tiene `paid` e `previousId`). Operazione `payable.save`,
  `Salvata una scadenza.`. Rifiuti senza scrivere: `inconsistent-store`, `unknown-apartment`,
  `unknown-payable`, `bad-amount`; stesso contenuto → `unchanged`.
- `repeatPayable(store, { payableId, dueDate, expected? }, …)`: la voce successiva di una voce con
  `repeatYearly`, **con la scadenza data dall'utente** (nessuna data calcolata, domanda 2); copia
  appartamento, tipo e segno, `previousId` = la voce. Operazione `payable.repeat`, `Ripetuta una
  scadenza.`. Rifiuti: `inconsistent-store`, `unknown-payable`, `not-repeating`, `already-repeated`
  (una voce viva ha già quel `previousId`), `bad-amount`.
- `setPayablePaid(store, { payableId, date?, transactionId? }, …)`: operazione `payable.paid`,
  `Segnata pagata una scadenza.`. Con un movimento la data è la sua. Rifiuti: `inconsistent-store`,
  `unknown-payable`, `already-paid`, `unknown-transaction` (assente, cancellato o non un addebito),
  `transaction-not-classified`, `transaction-used`, `bad-date` (né data né movimento).

**Un movimento, un uso.** Un movimento si collega a una voce solo se ha già la sua classe **confermata
a mano** (non esclusa, senza `ruleId`, senza `imu`): il suo unico uso resta la classe, la voce lo
annota. Così l'abbinamento lo rifiuta già (`transaction-used`, R125). In più: un movimento collegato a
una voce viva non si assegna a una rata IMU (`assignImuF24` → `payable-linked`), e l'annullamento
dell'operazione che ha scritto la sua classe è bloccato (`undoBlockedBy` → la voce: annullare prima il
pagamento). L'importazione non si annulla comunque finché c'è la classe (R125).

## Riga di comando

- `scadenze --cartella <dir> [--stato da-pagare|in-scadenza|pagata|in-ritardo] [--tipo <tipo>]
  [--entro <giorni>] [--oggi <AAAA-MM-GG>] [--dettagli]`. `--stato in-scadenza` senza `--entro` dà 2.
  Senza `--dettagli`: `source`, `id`, `kind`, `apartmentIds`, `state`, `check`, `repeatYearly`,
  `repeated`, e per i contratti solo `contractId` e `apartmentId`. Con `--dettagli` anche date,
  importi, `transactionId`, intestatari, mese di fine e le stime della cedolare (`estimates`, con il
  messaggio di R182).
- `scadenza-nuova --appartamento --tipo registro|bollo|cedolare|f24|altro --scadenza <data>
  [--importo <importo>] [--ogni-anno] [--id <id>]` → `{ status, payableId, operationId? }`.
- `scadenza-ripeti --id --scadenza <data> [--importo]`, `scadenza-pagata --id (--movimento <id> |
  --data <data>)`.
- Annullamento: `annulla-riconciliazione --operazione` accetta `payable.save`, `payable.repeat`,
  `payable.paid`.

## Domande per user1

1. **Finestra «in scadenza»**: quanti giorni prima della scadenza? Oggi è solo un argomento esplicito
   (`--entro`); senza, lo stato non compare mai. Il filtro «Entro 30 giorni» della sezione 30 lo
   suggerisce ma non lo decide per lo stato.
2. **Ripetizione annuale**: la voce dell'anno dopo va creata con la stessa data un anno dopo? Con lo
   stesso importo o con «importo da inserire»? Il 29 febbraio? In automatico a gennaio o solo a
   comando? Oggi: solo a comando e con la data scritta dall'utente.
3. **Cruscotto**: quale stato dà giallo e quale rosso (sezione 10)? Una voce «importo diverso» conta
   come in ritardo?
4. **Cedolare**: come si legano la stima dell'anno (R182) e le voci a mano di tipo `cedolare` (quale
   anno di affitti copre quale scadenza)? Oggi la stima è solo mostrata accanto.
5. **Ricevuta allegata**: dove sta il file (cartella della sezione 20) e come si collega (percorso o
   impronta)? Oggi nessun campo.
6. **Preavviso dei contratti**: serve un campo nel contratto (mesi di preavviso)? Oggi solo la fine.
7. **Voci senza estratto conto**: una rata di un periodo che nessun estratto copre è pagata presunta
   (R17) o in ritardo? Non deciso: lo stato viene solo dalla data e la voce ha l'indicazione neutra
   `check: 'periodo-senza-estratto'`.
8. **Segnare pagata a mano una rata IMU, di condominio o TARI** (senza F24 o addebito): serve? Oggi
   solo le voci a mano.

## Mie scelte (da controllare)

1. Un solo record per le voci a mano, con un `kind` chiuso; IMU, condominio e TARI restano nei loro.
2. La rata IMU è una voce di gruppo (come R135), con tutti gli appartamenti del gruppo.
3. «Oggi» della riga di comando = la data UTC dell'orologio (`--ora` o l'ora del sistema), oppure
   `--oggi`: il core non legge mai l'orologio.
4. Il collegamento a un movimento richiede una classe confermata a mano: niente secondo uso.

## Test (solo fixture sintetiche)

Appartamenti `app-a`, `app-b`, `app-c` con locatori inventati (`Locatore Uno`, `Locatore Due`),
importi e date inventati; stato al giorno della scadenza (da pagare) e al giorno dopo (in ritardo);
`soonDays` 0 e 10; F24 entro e fuori dall'1%; rata con addebito diverso; avviso comune; contratti
finiti e vivi; percorso completo della riga di comando con annullamento.

## Rischi

- Il «giorno» è UTC: tra mezzanotte e l'una (le due d'estate) in Italia la riga di comando vede ancora
  il giorno prima, salvo `--oggi`.
- Una voce di tipo `f24` pagata da un F24 che paga anche una rata IMU non si può collegare: è lo
  stesso movimento (domanda 8 e piano futuro sugli F24 con più voci).
