# Piano 8: documenti del condominio, differenza di consuntivo, controllo delle spese e recuperi dagli inquilini (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Il piano di implementazione è
`docs/plans/2026-11-16-piano-8-condominio.md`. Il piano copre il core (`packages/core`), la riga di
comando (`pnpm estratti`) e il file Excel dei proprietari; **niente schermate**. Riferimenti:
`docs/spec.md` sezioni 6 («Spese condominiali»), 12, 15, 16, 23, 24, 32, 34 e 42 (R1-R8, in
particolare R2, R3 e R5, che prevalgono); `docs/progress.md` R125, R131, R153, R174, R176, R184;
disegni e piani 3c, 5b e 7 per la forma. Codice letto: `model.ts` (`Apartment`, `Instalment`,
`BillMatch`), `conguaglio.ts` (`calcConguaglio`, `allocateInstalment`, `instalmentOwnerShare`),
`match.ts` (`expectedDebit`), `balances.ts`, `excel.ts`, `excel-owners.ts`, `excel-store.ts`,
`imu-store.ts`, `scripts/estratti.mjs`, `scripts/excel.mjs`. Nessun documento reale aperto: nomi
`user1`/`user2`, appartamenti, inquilini e importi inventati.

## Perché

Le rate del condominio esistono già (`Instalment`: rata, conguaglio dell'anno prima, quota annua
della proprietà, straordinaria), ma mancano i documenti da cui nascono (preventivo e consuntivo
dell'esercizio, sezione 32), un'impostazione che dica a chi va la differenza di consuntivo
(sezione 32: «si include nel conguaglio o resta a carico del proprietario»), il controllo dei
pagamenti dei proprietari verso il condominio (sezione 12) con i quattro esiti, e il caso
dell'intervento causato da un inquilino, anticipato dai proprietari e da recuperare.

## Obiettivo

1. **Documenti del condominio** per appartamento ed esercizio: preventivo e consuntivo (rendiconto),
   con il totale dell'unità, la quota conduttore se il documento la dà e, se servono, le voci. Il
   **piano rate** sono le `Instalment` esistenti dello stesso appartamento ed esercizio: nessun
   record nuovo.
2. **Impostazione dell'appartamento** `condoDifferenceTo`: `tenants` (inquilini, **predefinita** se
   assente) o `owner` (proprietario), chiesta alla creazione dell'appartamento (comando nuovo
   `appartamento`, che crea o aggiorna).
3. **Differenza di consuntivo** calcolata e mostrata (consuntivo − preventivo, del totale e, se tutti
   e due i documenti la danno, della quota conduttore) con la destinazione dell'impostazione: **mai
   scritta da sola** come addebito agli inquilini.
4. **Controllo delle spese condominiali** (sezione 12) per ogni rata ordinaria e straordinaria:
   `pagata`, `senza-addebito`, `importo-diverso`, `duplicato` (più `in-programma` prima della
   scadenza e `assunta` senza estratto), nella riga di comando (`condominio`) e nel file dei
   proprietari (stato `duplicato`).
5. **Intervento causato da un inquilino** (gruppo di task a parte): una spesa straordinaria
   anticipata dai proprietari, da recuperare da uno o più inquilini scelti da user1 con le loro
   quote, come riga del loro conguaglio.

## Non obiettivi

- Estrapolazione della spesa per gli anni senza dati (sezione 34), rubrica di amministratore e
  fornitori (sezione 32), interfaccia.
- Lettura dei PDF del condominio (profili, sezione 7): i documenti si scrivono dalla riga di comando.
- Tabella di regole modificabile per le voci senza quota conduttore (sezione 7): domanda 3.
- Scrittura automatica di `quotaProprieta` o `conguaglioPrec` sulle rate dai documenti: domande 1, 4.

## Decisioni già prese da user1

Vincolanti (spec, CLAUDE.md, risposte di user1 del 16 novembre 2026):

1. Documenti per appartamento ed esercizio: preventivo, consuntivo, piano rate; si riusa quello che
   c'è (`Instalment`) e si aggiunge solo quello che manca.
2. **Quota conduttore: vince il documento dell'amministratore**; una tabella di regole modificabile
   vale solo dove il documento non dà la quota.
3. Impostazione per appartamento sulla differenza consuntivo − preventivo: `tenants` (predefinita) o
   `owner`, chiesta alla creazione; la differenza si calcola e si mostra (proposta), non si addebita
   in silenzio agli inquilini; i risultati attuali sui dati attuali **non cambiano**.
4. Controllo dei proprietari (sezione 12): `pagata`; `senza addebito` **dal giorno dopo la scadenza,
   nessuna tolleranza**; `importo diverso` (addebitato ≠ atteso); `duplicato` = **due addebiti per la
   stessa rata**.
5. **Spese straordinarie sempre interamente della proprietà** (mai nel conguaglio, già così in
   `allocateInstalment`) ed **entrano nel saldo tra conti** come le ordinarie (già così in
   `accountBalances`, voci `rata`: il piano aggiunge solo il test).
6. Riga di comando con le regole di riservatezza: importi e date solo con `--dettagli` (R107).
7. **Intervento causato da un inquilino** (16 novembre 2026, richiesta del coordinatore per user1):
   il recupero sta **nel conguaglio dell'inquilino** (una riga di addebito nel conguaglio del
   periodo); user1 **sceglie** uno o più inquilini e la quota di ciascuno (in parti uguali se non le
   indica, resti come `splitCents`); stato `da-recuperare` / `recuperata` / `non-recuperabile`
   (`non-recuperabile` lo mette user1 e la spesa resta alla proprietà); l'importo da recuperare lo
   inserisce user1 e **può essere solo una parte** della spesa, **mai più** della spesa. Tutte le
   altre straordinarie restano della proprietà. L'anticipo entra nel controllo delle spese e nel
   saldo tra conti come straordinaria. **Conguagli identici** per i dati senza recuperi.

## Modello dati

- `Apartment.condoDifferenceTo?: 'tenants' | 'owner'` (opzionale, assente = `tenants`; `v: 1`,
  nessuna migrazione).
- Record nuovo **`condoDocument`** (`_app/dati/condoDocument/`), `id` =
  `condoc-<apartmentId>-<esercizio>-<kind>` (uno per tipo ed esercizio; una versione nuova è un `rev`
  nuovo): `apartmentId`, `esercizio` (stesso testo di `Instalment.esercizio`), `kind`
  (`preventivo` | `consuntivo`), `total` (totale dell'unità, centesimi), `quotaConduttore?`,
  `lines?: { label, amount, quotaConduttore? }[]` (somma di `amount` = `total`), `fileHash?`,
  `fileDocument?`. Quota conduttore del documento: `quotaConduttore` se c'è, altrimenti la somma di
  quelle delle voci **se tutte la danno**, altrimenti nessuna («non indicata»).
- Record nuovo **`tenantRecovery`** (task del gruppo B): `apartmentId`, `instalmentId` (una rata
  `condominio` **straordinaria** dello stesso appartamento), `amount` (> 0, ≤ addebito atteso della
  rata), `shares: { tenantId, amount }[]` (inquilini distinti, importi > 0, somma = `amount`),
  `status`, `periodLabel?` (il periodo di conguaglio scelto da user1: senza, il recupero non entra in
  nessun conguaglio, domanda 9).

## 1. Impostazione e creazione dell'appartamento

`saveApartment(store, input, profileId, clock, newId)` (`apartment-store.ts`): crea (servono nome,
locatore, posti, inizio dell'annualità **e** `condoDifferenceTo`: è la domanda alla creazione) o
aggiorna (solo i campi dati; gli altri, come `rooms` o `cadastre`, restano) in un'operazione
`apartment.save`. Rifiuti: `inconsistent-store`, `missing-fields` (creazione senza i campi),
`invalid-apartment` (lo schema rifiuta), `unchanged` se nulla cambia.

## 2. Differenza di consuntivo nel conguaglio

Oggi la differenza dell'anno prima arriva al conguaglio come `conguaglioPrec` della rata che la
contiene (R3: entra per intero sui 12 mesi dell'esercizio corrente). Con `condoDifferenceTo` assente
o `tenants` **non cambia nulla**. Con `owner` il `conguaglioPrec` resta alla proprietà: l'addebito
atteso resta `rata + conguaglioPrec` (R2, abbinamento invariato), ma `allocateInstalment` non lo
ripartisce (come la quota della proprietà) e il file dei proprietari lo somma alla «Quota
proprietà». Lettura del coordinatore della risposta 3, **da confermare** (domanda 1).

`condoDifferences(apartment, documents)`: per ogni esercizio con preventivo **e** consuntivo vivi,
`{ esercizio, preventivo, consuntivo, difference, conduttore?, to }`, con `difference` = consuntivo −
preventivo e `conduttore` = la stessa differenza sulle quote conduttore quando tutti e due i
documenti la danno; `to` dall'impostazione. È una proposta da mostrare: non scrive nulla e non entra
in `calcConguaglio`.

## 3. Controllo delle spese condominiali

`condoCheck({ instalments, matches, asOf })` (`condominio.ts`, puro), per ogni rata viva
`condominio` (ordinaria o straordinaria), ordinata per appartamento, `coversFrom`, `id`:

| Stato | Quando (in quest'ordine) |
| --- | --- |
| `duplicato` | pagata (sotto) e un movimento in uscita libero (senza abbinamento, pagamento, giroconto né esclusione) dell'appartamento pagante con lo stesso importo dell'addebito atteso, entro `MATCH_WINDOW` dalla scadenza (R198) |
| `pagata` | addebiti non assunti con somma = addebito atteso (anche in più parti, R2) |
| `importo-diverso` | addebiti non assunti con somma ≠ addebito atteso |
| `assunta` | solo abbinamenti assunti (periodo senza estratto, R2) |
| `senza-addebito` | nessun abbinamento e `asOf` > scadenza (dal giorno dopo, nessuna tolleranza) |
| `in-programma` | nessun abbinamento e `asOf` ≤ scadenza |

`asOf` è la data UTC dell'orologio passato dalla riga di comando. Il file dei proprietari (che non ha
orologio) usa lo stesso calcolo senza data: `in attesa di pagamento` resta com'è, si aggiunge solo
`duplicato` (sopra `pagata` e `importo diverso`). Le fixture attuali non hanno due addebiti sulla
stessa rata: hash e righe non cambiano.

Riga di comando `condominio --cartella <dir> [--appartamento <id>] [--esercizio <testo>]
[--dettagli]`: `{ status: 'ok', rate: [{ instalmentId, apartmentId, esercizio, rateIndex, rateCount,
straordinaria, status }], anomalie: <n>, differenze: [{ apartmentId, esercizio, to, conduttore: 0|1
}], recuperi: [...] }`; con `--dettagli` anche atteso, addebitato, scadenza, date degli addebiti,
importi delle differenze e dei recuperi. Anomalie = `senza-addebito` + `importo-diverso` +
`duplicato`.

## 4. Intervento causato da un inquilino (gruppo B)

`saveTenantRecovery` (`recovery-store.ts`) crea o aggiorna un recupero (operazione
`recovery.save`). Rifiuti: `inconsistent-store`, `unknown-apartment`, `not-extraordinary` (rata
sconosciuta, cancellata, non `condominio` straordinaria o di un altro appartamento),
`amount-too-high` (oltre l'addebito atteso della rata), `bad-shares` (inquilino ripetuto o senza
presenza nell'appartamento, quota non positiva, somma ≠ importo). Senza quote la riga di comando
divide in parti uguali con `splitCents` (resti ai primi inquilini nell'ordine dato).

Nel conguaglio: `ConguaglioInput.recoveries?` (opzionale); un recupero vivo dell'appartamento con
`periodLabel` uguale all'etichetta del periodo e stato diverso da `non-recuperabile` aggiunge
`recupero` alla riga dell'inquilino e al suo `due`. Il campo `recupero` c'è **solo** se diverso da 0:
senza recuperi il risultato è identico (test sulle dorate). Un inquilino del recupero senza riga nel
periodo: `SettlementInputError` `recovery-tenant-absent` (rifiuto, domanda 9). L'Excel degli
inquilini **rifiuta** (`recoveries-not-supported`) un periodo con recuperi finché user1 non dice come
mostrarli (domanda 10); la riga di comando `condominio` li elenca con lo stato.

## Domande per user1

1. **Differenza e `conguaglioPrec`.** Il piano tratta il «conguaglio dell'anno prima» sulla rata
   (R3) come la differenza di consuntivo: con `owner` resta tutto alla proprietà. È giusto, o la
   differenza da mandare agli inquilini è un'altra (per esempio solo quella della quota conduttore)?
2. **Quale differenza agli inquilini.** Con `tenants`, deve entrare la differenza del totale
   dell'unità (come oggi `conguaglioPrec` per intero) o solo quella della quota conduttore? Il piano
   mostra le due e non ne addebita nessuna.
3. **Tabella di regole** per le voci senza quota conduttore: voce intera agli inquilini o alla
   proprietà, o una percentuale? Riconoscimento della voce per testo esatto o per parole? Fuori dal
   piano.
4. **Documento e rate.** Quando il preventivo dà la quota conduttore, la quota della proprietà delle
   rate (`quotaProprieta`) deve venire da lì (totale − quota conduttore) e sostituire quella scritta
   sulle rate? Oggi nulla si scrive da solo e il piano non confronta i due numeri.
5. **Duplicato (revisione, R198).** Un pagamento in più parti abbinate è `pagata`. `duplicato` è
   una stima: rata pagata e un altro movimento libero con lo stesso importo dell'addebito atteso nella
   finestra di abbinamento (`MATCH_WINDOW`, 5 giorni prima e 10 dopo la scadenza). Va bene la
   finestra? Un secondo addebito di importo diverso o fuori finestra non si segnala.
6. **Data di oggi.** Il giorno dopo la scadenza si conta sulla data UTC dell'orologio: va bene, o
   serve la data italiana (a cavallo della mezzanotte cambia di un giorno)?
7. **File dei proprietari e scadenza.** Il file non ha una data: deve mostrare `senza addebito` e
   `in programma` con la data di generazione?
8. **Quando un recupero è `recuperata`.** Oggi lo stato lo mette solo user1 a mano; deve passare da
   solo quando il conguaglio dell'inquilino è saldato (R6)?
9. **Periodo del recupero.** In quale conguaglio entra se user1 non lo indica (quello della data
   della spesa, il primo aperto, quello in corso)? E se l'inquilino è già partito (R5: caparra)? Oggi
   senza periodo non entra e un inquilino assente dal periodo è un rifiuto.
10. **Excel degli inquilini.** Come si mostra la riga del recupero (riga a parte nel foglio Bollette,
    colonna nel foglio Conguagli)? Oggi il file si rifiuta per quel periodo.
11. **Interessi** sull'importo anticipato: no (nessun calcolo nel piano)?
12. **Spese non condominiali.** Un intervento pagato direttamente al fornitore (un movimento
    classificato, non una rata del condominio) va recuperato allo stesso modo? Oggi il recupero
    richiede una rata straordinaria.
13. **File dei proprietari e recupero.** La «Quota proprietà» di una straordinaria con recupero deve
    scendere della parte da recuperare? Oggi resta l'intero addebito.

14. **Recupero e R2.** Il piano fa entrare la quota di un recupero solo quando la spesa straordinaria
    è addebitata nel CSV (o assunta, R2); prima la rata resta «recupero in attesa del pagamento». Va
    bene, o il recupero entra anche prima del pagamento?
15. **Due recuperi sulla stessa spesa.** Il piano somma tutti i recuperi vivi di una rata e rifiuta se
    superano la spesa. Va bene?

## Osservazioni della revisione

- M6 della revisione del piano 8: con `owner` il file dei proprietari sceglie ancora le righe con i
  mesi dell'esercizio (`esercizioMonths`), quindi una rata compare nel file di un periodo che il lato
  degli inquilini non tocca più. È innocuo ma non coincide con `excel.ts`; non trattato in questo piano.

## Mie scelte (da controllare)

1. Nessun record «piano rate»: sono le `Instalment` con lo stesso `apartmentId` ed `esercizio`.
2. Stato `in-programma` (termine della sezione 32) per le rate non scadute senza addebito.
3. Il comando `appartamento` aggiorna solo i campi indicati; la creazione chiede sempre
   `--differenza-condominio`.
4. `id` del documento fisso per tipo ed esercizio; `id` del recupero scelto da chi lo scrive.
5. Riservatezza: nell'uscita predefinita nessun importo, data, nome o causale; gli `id` sì (R107).

## Test (solo fixture sintetiche)

Schemi (validi e rifiutati), scritture con rifiuti e `unchanged`, `allocateInstalment` e
`calcConguaglio` con `owner` (e identità con `tenants` e senza impostazione), `condoCheck` con ogni
stato e il confine della scadenza, `condoDifferences`, straordinaria nel saldo tra conti, file dei
proprietari con `duplicato`, recuperi nel conguaglio (identità senza recuperi, quote, stato
`non-recuperabile`, periodo diverso, inquilino assente), rifiuto dell'Excel, riga di comando.
Tutti anche con `TZ=Pacific/Auckland`.

## Rischi

- Un'impostazione `owner` cambia il conguaglio di quell'appartamento: per i dati attuali (nessuna
  impostazione) non cambia nulla (test sulle dorate).
- `duplicato` può segnalare un pagamento in due parti (domanda 5): è solo un avviso.

## Task proposti

Gruppo A: 1 modello; 2 appartamento; 3 documenti; 4 `owner` nel conguaglio; 5 controllo e
differenze con la riga di comando `condominio`; 6 `duplicato` nel file dei proprietari.
Gruppo B: 7 record e scrittura del recupero; 8 recupero nel conguaglio, rifiuto dell'Excel e
elenco in `condominio`.
