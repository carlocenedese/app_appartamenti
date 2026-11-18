# Piano 11: arrivo, subentro e uscita di un inquilino (disegno)

Stato: **scelte da confermare da user1** (16 novembre 2026; correzioni della revisione incluse). Piano di implementazione:
`docs/plans/2026-11-16-piano-11-subentro.md`. Solo core (`packages/core`) e riga di comando
(`pnpm estratti`); **niente schermate**. Riferimenti: `docs/spec.md` sezioni 6, 17, 26, 31 e 42 (R1, R4,
R5, R7, che prevalgono); disegno del piano 7 (domande 7 e 8, rinviate a questo piano); R112, R113,
R130, R180-R182. Codice letto: `model.ts` (`Tenancy`, `Contract`, `Payment`), `contract.ts`,
`contract-store.ts`, `conguaglio.ts` (`checkTenantOverlaps`, `bedsIn`), `caparra.ts`, `interest.ts`,
`outgoing-store.ts` (`confirmTenantOutgoing`), `movements.ts` (`undoBlockedBy`), `scripts/estratti.mjs`.
Nessun documento reale aperto.

## Perché

Oggi una presenza (`tenancy`) si scrive solo a mano nei file: non c'è un comando per l'arrivo di un
inquilino, per la sua uscita né per un subentro. Il contratto (piano 7) collega le presenze e le
caparre, ma non dice chi è subentrato a chi; nessuno controlla che la caparra versata sia quella
attesa; il prospetto di restituzione (`caparraReturn`, `legalInterest`) esiste solo come funzione.

## Obiettivo

1. **Arrivo:** scrivere una presenza (appartamento, inquilino, posto, mesi, affitto, forfait, caparra
   attesa), collegandola se richiesto a un contratto, in un'operazione annullabile.
2. **Uscita:** scrivere l'ultimo mese di una presenza.
3. **Subentro (cessione):** in un'unica operazione l'uscente finisce nel mese indicato, il subentrante
   entra il mese dopo nello stesso posto e nello stesso contratto, e il contratto ricorda il subentro.
   Il contratto resta **un solo record** con lo storico del canone (piano 7, domanda 6).
4. **Controllo della caparra:** caparra attesa (dato della presenza, nessun importo nel codice)
   confrontata con i versamenti `caparra` confermati: avviso se manca o è diversa.
5. **Restituzione della caparra:** il prospetto di `caparraReturn` con gli interessi di
   `legalInterest`, tutti gli ingressi dati espliciti; sola lettura.
6. **Stato per contratto:** presenze (in corso, uscite, future), subentri, caparre e controlli.

## Non obiettivi

- Conguaglio provvisorio dell'uscente calcolato dall'app (sezione 17, punto 2): domanda 2. Il prospetto
  riceve il conguaglio come importo dato da user1.
- Data di invio del prospetto e controllo sul CSV da quel giorno (punto 5); riconoscimento del bonifico
  di restituzione: c'è già, `uscita-inquilino --tipo caparra` (R130) scrive un `Payment` `caparra`
  negativo.
- Alias dei paganti per il nuovo inquilino (punto 7): domanda 5.
- Adempimenti fiscali del subentro (punto 8): termini e imposte non verificati; domanda 6.
- Codice e data di registrazione della cessione (sezione 26): domanda 7.
- Moduli (caparra, restituzione), scheda inquilino, cartelle, notifiche (sezione 31). Schermate.

## Modello dati

Nessun record nuovo; due campi **opzionali** (`v: 1`, nessuna migrazione: nessuna versione precedente
scrive presenze né subentri, quindi nessuna riscrittura li perde).

| Record | Campo | Tipo | Significato |
| --- | --- | --- | --- |
| `tenancy` | `expectedDeposit?` | `Cents` > 0 | caparra attesa per questa presenza, inserita da user1 (500 € negli esempi, mai nel codice) |
| `contract` | `takeovers?` | `{ month, outTenancyId, inTenancyId }[]` | i subentri: `month` è il primo mese del subentrante; `month` non decrescente; ogni presenza esce al più una volta ed entra al più una volta, mai uguali |

- `takeovers` è come `rent`: lo scrive solo il subentro, `saveContract` lo conserva e rifiuta un
  ingresso che lo contiene (`invalid-contract`). `saveContract` rifiuta anche (`takeover-unlinked`)
  nuove `tenancyIds` senza le presenze di un subentro scritto: si ripete `--presenze` con quelle.
- Dati scritti a mano: `contractChecks` dà `takeover-unlinked` (una presenza del subentro non è in
  `tenancyIds`) e `takeover-dates` (il subentrante non comincia nel `month` o l'uscente non finisce il
  mese prima, o una delle due presenze non c'è più). Solo avvisi.
- Il subentrante è collegato al contratto (`tenancyIds`) come ogni altra presenza.

## 1. Arrivo: `saveTenancy`

`saveTenancy(store, { id, apartmentId, tenantId, room?, from, to?, monthlyRent, monthlyForfait,
expectedDeposit?, contractId? }, …)`: crea o sostituisce la presenza `id` (nuova `rev`; una cancellata
torna viva), operazione `tenancy.save`, `summary` `Presenza salvata.`. Come `contratto`, sostituisce
**tutti** i campi: uno non indicato (`room`, `to`, `expectedDeposit`) si toglie, quindi una presenza
finita salvata di nuovo senza `--al` torna aperta (domanda 12). Con `contractId` aggiunge `id` a
`tenancyIds` del contratto nella stessa operazione (se c'è già, il contratto non cambia).

Rifiuti senza scrivere, in quest'ordine:

1. `inconsistent-store`;
2. `invalid-tenancy` (`id` non `^[A-Za-z0-9_-]{1,64}$`, `to` prima di `from`, affitto o forfait
   negativi, caparra attesa non positiva);
3. `unknown-apartment`, `unknown-tenant` (assente o cancellato);
4. `unknown-contract` (assente, cancellato o di un altro appartamento);
5. `beds-conflict` con `code` e `month`: la presenza renderebbe impossibile il conguaglio
   (`tenant-overlap`, `room-overlap`, `unknown-room`, `too-many-tenants`: gli stessi controlli di
   `calcConguaglio`, non una regola nuova). Si controllano solo i mesi della presenza scritta, così un
   conflitto vecchio in altri mesi non blocca la correzione.

Stesso contenuto già scritto (e già collegato): `unchanged`, nulla scritto.

## 2. Uscita: `endTenancy`

`endTenancy(store, { tenancyId, lastMonth }, …)`: `to = lastMonth`, operazione `tenancy.end`,
`Uscita registrata.`. Rifiuti: `inconsistent-store`, `unknown-tenancy`, `invalid-tenancy` (`lastMonth`
prima di `from`), `beds-conflict` (allungare una presenza passa dai controlli dei posti),
`has-recoveries` (l'inquilino resterebbe fuori da un periodo in cui un recupero vivo, non
`non-recuperabile` e con `periodLabel`, gli dà una quota: il conguaglio darebbe
`recovery-tenant-absent`, R197). Stesso `to`: `unchanged`. Canoni confermati per mesi dopo il nuovo
`to` non si rifiutano: `contractChecks` li segnala con `payment-after-end` (solo avviso, domanda 13).

## 3. Subentro: `recordTakeover`

`recordTakeover(store, { outTenancyId, lastMonth, incoming: { id, tenantId, monthlyRent,
monthlyForfait, expectedDeposit? } }, …)`, operazione `tenancy.takeover`, `Registrato un subentro.`:

- l'uscente: `to = lastMonth`;
- il subentrante: stesso appartamento e posto, `from = lastMonth + 1`, `to` = il vecchio `to`
  dell'uscente (assente se non c'era): **Ruling**, il subentrante prende il resto del posto;
- il contratto vivo che collega l'uscente: `tenancyIds` + subentrante, `takeovers` + `{ month,
  outTenancyId, inTenancyId }`.

Rifiuti: `inconsistent-store`; `unknown-tenancy` (uscente assente o cancellata); `invalid-tenancy`
(`lastMonth` prima di `from` o non prima del vecchio `to`, `id` non valido, importi); `unknown-tenant`;
`same-tenant` (un cambio di posto non è un subentro); `no-contract` (l'uscente non è in esattamente un
contratto vivo); `invalid-tenancy` anche se il subentrante comincerebbe dopo la fine del contratto;
`tenancy-exists` (`incoming.id` è già una presenza viva diversa da quella che scriverebbe il
subentro); `beds-conflict`; `has-recoveries` (come l'uscita). La stessa richiesta già registrata: `unchanged`.

**Esempio (nomi e importi inventati):** contratto `ctr-app-c` 2025-10 – 2026-09, posto «A» di Anna
Prova (350,00 + 30,00 €) fino a 2026-09. Subentro con ultimo mese 2026-02: Anna Prova esce a 2026-02,
Bruno Esempio entra a 2026-03 nel posto «A» fino a 2026-09 con 360,00 + 30,00 € e caparra attesa
500,00 €; il contratto ha `takeovers: [{ month: '2026-03', outTenancyId, inTenancyId }]`. Lo storico del
canone del contratto non cambia (si aggiorna con `contratto-canone` se serve).

## 4. Controllo della caparra (sola lettura)

`depositChecks({ tenancies, payments })`, per **inquilino e appartamento** (un rinnovo con una nuova
presenza non chiede una seconda caparra, sezione 31):

- `expected`: la caparra attesa della presenza viva più recente (per `from`) che ne ha una;
- `paid`: somma dei `Payment` vivi, confermati, `caparra`, di quell'inquilino e appartamento, con
  importo positivo; `returned`: valore assoluto della somma di quelli negativi (le restituzioni
  registrate con `uscita-inquilino`, R130);
- `status`: `non-impostata` (nessuna caparra attesa), `mancante` (`paid` 0), `diversa` (`paid ≠
  expected`), `versata` (uguale). Solo un avviso: mai una correzione, mai in `checkConsistency`.

## 5. Restituzione della caparra (sola lettura)

`loadDepositReturn(store, { apartmentId, tenantId, from, to, rates, conguaglio, extraCharges })`:

- capitale = `paid` del punto 4, cioè tutti i versamenti dell'inquilino in quell'appartamento da
  sempre; rifiuti `no-deposit` (nessun versamento), `already-returned` (c'è già una restituzione, in
  qualsiasi momento: una sola restituzione per inquilino e appartamento), `missing-rate` (manca il
  tasso di un anno: `legalInterest` lo dice). Somma da sempre e restituzione unica non sono decise:
  la lettura è prudente (rifiuto), domanda 14;
- `interest = legalInterest(capitale, rates, from, to)`, poi `caparraReturn({ caparra, interest,
  conguaglio, extraCharges })`: righe e totale come oggi.
- **Tutti gli ingressi sono dati di user1** (domande 1-3): le date degli interessi, i tassi legali per
  anno (punti base), il conguaglio (positivo se l'inquilino deve), gli addebiti extra.

## 6. Stato per contratto (sola lettura)

`loadContractStatus(store, { asOf, apartmentId? })`, per contratto vivo: le presenze collegate con lo
stato al mese `asOf` (`futura`, `in-corso`, `uscita`), i subentri, il controllo della caparra degli
inquilini collegati e i codici di `contractChecks` del contratto.

## Riga di comando

- `presenza --id --appartamento --inquilino --dal <AAAA-MM> [--al <AAAA-MM>] [--posto] --affitto
  <euro> --forfait <euro> [--caparra-attesa <euro>] [--contratto <id>]` → `{ status, tenancyId,
  operationId? }`.
- `fine-presenza --presenza <id> --mese <AAAA-MM>` → `{ status, tenancyId, operationId? }`.
- `subentro --presenza <uscente> --mese <ultimo mese> --id <subentrante> --inquilino --affitto
  --forfait [--caparra-attesa]` → `{ status, tenancyId, operationId? }`.
- `stato-contratti [--appartamento] [--dettagli]`: di default per contratto `contractId`,
  `apartmentId`, conteggi delle presenze per stato, numero di subentri, conteggi delle caparre per
  stato, codici dei controlli; con `--dettagli` anche presenze, inquilini, mesi, posti, importi.
- `caparra-restituzione --appartamento --inquilino --dal <AAAA-MM-GG> --al <AAAA-MM-GG> --tasso
  <anno:percentuale>… --conguaglio <euro> [--addebito <etichetta:euro>]…` → di default solo `{ status:
  'ok', lines: n }`; righe e totale con `--dettagli` (importi, R107).
- `annulla-riconciliazione` accetta `tenancy.save`, `tenancy.end`, `tenancy.takeover`.
- Codici 0/1/2/3; messaggi costanti; nessun nome, importo o `id` di inquilino o pagamento senza
  `--dettagli`. **Ruling (R223):** le tre scritture riportano l'`id` della presenza scritto da user1
  (come `contratto` riporta quello del contratto); `stato-contratti` senza `--dettagli` dà solo
  conteggi e codici. `--tasso` con un anno ripetuto è un argomento non valido (2).

## Annullamento

- Annullare `tenancy.save` di una presenza nuova la cancella (`deleted`); `tenancy.takeover` rimette
  l'uscente, cancella il subentrante e toglie il subentro dal contratto, in un passo.
- `undoBlockedBy`: un annullamento che rimetterebbe una presenza in conflitto con i posti (per
  esempio un'uscita annullata quando il posto è già di un altro) è bloccato dalle presenze in
  conflitto, o dalla presenza rimessa stessa se il conflitto è solo suo (`unknown-room`: il posto non
  esiste più); un'operazione che ha creato una presenza non si annulla se l'inquilino ha versamenti
  o recuperi vivi in quell'appartamento e nessun'altra presenza viva lì (il conguaglio o gli incassi
  resterebbero senza presenza): annullare prima quelli. Nessun movimento è toccato da queste
  operazioni.

## Domande per user1

Regole di calcolo o di fiducia non decise: restano fuori o sono dati espliciti.

1. **Date degli interessi sulla caparra.** Dal giorno del versamento al giorno della restituzione, o
   all'ultimo giorno del mese di uscita? Oggi sono `--dal` e `--al` scritti da user1. Raccomando:
   dal versamento all'ultimo giorno del mese di uscita. Esempio: 500,00 € dal 25/09/2025 al 28/02/2026,
   tasso 2%: 5 mesi interi (ottobre–febbraio; settembre è parziale) → 4,17 €.
2. **Conguaglio provvisorio dell'uscente.** Quale conguaglio entra nel prospetto: la riga
   dell'inquilino nel conguaglio del periodo al momento dell'uscita (con le voci ancora in attesa
   escluse, R2), e come si tratta una bolletta che arriva dopo (R5: si trattiene se la caparra è ancora
   in mano)? Oggi è un importo dato da user1.
3. **Tassi legali.** Dove si conservano (record di configurazione per anno, come IMU) e chi li
   aggiorna? Oggi `--tasso` a ogni prospetto.
4. **Più versamenti di caparra.** Con due versamenti (per esempio 300 + 200 €), gli interessi corrono
   da ciascuna data? Oggi un solo calcolo dal `--dal` dato.
5. **Alias dei paganti** del nuovo inquilino (sezione 17, punto 7): un pagante scritto a mano rende
   automatici gli incassi (R4), quindi è una regola di fiducia. Si può scrivere senza un primo
   versamento confermato?
6. **Adempimenti fiscali del subentro** (punto 8): quali, con quali termini; vanno verificati su fonti
   ufficiali. Nessun promemoria finché non sono decisi.
7. **Registrazione della cessione:** codice e data separati da quelli del contratto (sezione 26) in
   ogni subentro? Raccomando un campo opzionale `registration` nel subentro.
8. **Caparra del subentrante in una cessione:** la versa il subentrante alla proprietà, o la caparra
   dell'uscente passa al subentrante (e allora nessuna restituzione all'uscente)? Oggi il controllo
   tratta ogni inquilino per sé.
9. **Uscita e ingresso nello stesso mese** nello stesso posto: oggi rifiutati (`room-overlap`, mesi
   interi R1). Va bene?
10. **Posto del subentrante:** oggi prende sempre il posto dell'uscente (non c'è `--posto` in
    `subentro`). Serve poter indicare un altro posto?
11. **Fine del subentrante:** oggi eredita il vecchio `to` dell'uscente (nessuno se non c'era). Va
    bene, o la fine va sempre indicata?
12. **Presenza salvata di nuovo senza `--al`:** `presenza` sostituisce tutti i campi, quindi riapre una
    presenza finita. Va rifiutata la riapertura o basta documentarla? Oggi solo documentata.
13. **Canoni dopo l'uscita:** un canone confermato per un mese dopo la nuova fine resta com'è e compare
    come `payment-after-end` in `contratti` e `stato-contratti`. Va bloccata l'uscita, o spostato il
    pagamento al subentrante, o basta l'avviso?
14. **Caparra da sempre e restituzione unica:** il capitale è la somma dei versamenti di caparra
    dell'inquilino nell'appartamento da sempre e una restituzione già registrata blocca ogni nuovo
    prospetto. Con due contratti successivi dello stesso inquilino (caparra restituita e poi versata
    di nuovo) serve limitare al contratto o alla presenza?

## Mie scelte (da controllare)

1. Caparra attesa nella **presenza** (sezione 17, punto 7: «per il nuovo inquilino si impostano …
   caparra attesa»), non nell'appartamento (domanda 8 del piano 7); assente = non controllata.
2. Controllo della caparra **per inquilino e appartamento**, con l'attesa della presenza più recente.
3. Il subentrante eredita il posto e il vecchio `to` dell'uscente (domande 10 e 11).
4. Subentro solo dentro un contratto (è una cessione del contratto); senza contratto si usano
   `fine-presenza` e `presenza`.
5. I controlli dei posti in scrittura sono quelli già in `calcConguaglio`, esportati, non copiati.

## Test (solo dati inventati: user1, user2, Anna Prova, Bruno Esempio)

- Schemi: `expectedDeposit` non positivo rifiutato; `takeovers` con presenza ripetuta o mesi
  decrescenti rifiutati; record di oggi validi.
- `saveTenancy`, `endTenancy`, `recordTakeover`: salvato, `unchanged` (archivio e registro uguali),
  ogni rifiuto senza scrittura, `saveContract` conserva `takeovers`, annullamento e blocco.
- `depositChecks`: un caso per stato, restituzione negativa contata a parte, rinnovo.
- `loadDepositReturn`: esempio con importi inventati, rifiuti.
- Riga di comando: codici 0/1/2/3, `scanText` vuoto senza `--dettagli`, annullamento.
- Conguaglio ed Excel della fixture invariati; tutto anche con `TZ=Pacific/Auckland` e
  `TZ=America/Los_Angeles`.

## Rischi

- Un annullamento di una presenza dopo altri dati che la usano: bloccato solo per versamenti e
  recuperi; un collegamento in un contratto scritto dopo resta e diventa `unknown-tenancy` nei
  controlli.
- Le presenze scritte a mano prima di questo piano non hanno caparra attesa: `non-impostata`.
