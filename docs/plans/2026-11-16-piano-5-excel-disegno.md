# Piano 5: Excel dei conguagli per appartamento e annualità (disegno)

Stato: **approvato da user1 il 16 novembre 2026** con le risposte alle domande 1, 3-10 (sotto, «Domande
per user1»; resta aperta la 2) e alle domande 11-15 (seconda risposta, task 12-14); i task 1-7 sono uniti, le risposte sono i task 8-11
del piano. Il piano copre
il core (`packages/core`) e una riga di comando (`pnpm excel`); **niente schermate e niente veste
grafica**. Riferimenti: `docs/spec.md` sezioni 5, 6, 9 («Spese condominiali»), 12, 19, 20, 26, 27, 29
e 42 (R1-R8, che prevalgono); `docs/rules/conguaglio-rules.md` (le colonne degli Excel di oggi, fogli
R, C e AV); `docs/progress.md` R6, R7, R98, R103, R107, R112-R132 (in particolare R130: le uscite
verso gli inquilini sono `Payment` negativi); decisione di user1 del 14 novembre 2026, punto 6
(«un Excel come quello di esempio, con tutti i dati delle bollette; formule o valori e libreria da
chiarire nel disegno del piano 5»). Codice letto: `conguaglio.ts`, `caparra.ts`, `interest.ts`,
`commission.ts`, `income.ts`, `golden.ts`, `match-store.ts`, `tari-note.ts`, `period.ts`,
`money.ts`, `model.ts`, `python/bollette_pdf/xlsx.py`. Nessun file reale aperto: **l'Excel di
esempio di user1 non è nel repository**, quindi il disegno parte dalle colonne documentate e le
lacune sono domande.

## Perché

Il core calcola il conguaglio (`calcConguaglio`) con le bollette e le rate abbinate agli addebiti
(R2), le commissioni (R7), il forfait incassato (R4) e, dal 3c, i pagamenti veri registrati, comprese
le uscite verso gli inquilini (R130). Ma il risultato non esce dall'app: l'Excel che gli inquilini
vedono (sezione 9, condivisione in sola lettura) oggi si scrive ancora a mano, con gli errori della
sezione 19.

## Obiettivo

1. Un modello puro del file (fogli, righe, celle tipizzate), costruito dal core a partire dal
   conguaglio, senza I/O.
2. Uno scrittore puro e minimo di `.xlsx` (OOXML in uno zip senza compressione), che dà sempre gli
   stessi byte per gli stessi dati.
3. Il caricamento dei dati di un appartamento e di un periodo di conguaglio dall'archivio, con le
   voci «assunte» di R2.
4. `pnpm excel`: scrive l'`.xlsx` di un appartamento e di un periodo nel percorso indicato.
5. Prova di andata e ritorno con il lettore XLSX di Python già esistente (`bollette_pdf table`).

## Non obiettivi

- **File riservato ai proprietari** (R8, sezioni 12 e 20): piano 5b
  (`2026-11-16-piano-5b-proprietari-disegno.md`), domanda 9.
- Chiusura dell'annualità, istantanee, Excel «definitivo», versioni in `_app/excel_versioni/`,
  differenza con la versione precedente e celle modificate a mano (sezioni 5, 6, 20, 29): con la
  chiusura (R5), in un piano a sé.
- Nota TARI accanto a ogni avviso (R3): manca il dato (sotto, «Lacune»).
- Link alle sottocartelle condivise (sezione 27): manca la tabella «Cartelle condivise» nel modello.
- Schermate (scheda Excel), messaggi agli inquilini, moduli Word (sezione 26), veste grafica.

## Decisioni già prese (dove stanno)

1. **Due tabelle**: dati delle bollette e, nel secondo foglio, Conguagli (sezione 6).
2. **Valori dell'app, non quelli dell'Excel di oggi** (sezioni 19, 29, 38): ripartizione per mese,
   divisore = posti, totali sempre su tutte le righe, mesi contati dall'app.
3. **Solo le voci nel CSV** (R2): una voce «in attesa di pagamento» resta fuori dall'Excel degli
   inquilini; dove non c'è estratto la voce è «assunta» e non verificata, e lo si scrive.
4. **Conta l'importo addebitato** (R2), con la commissione come parte di quella voce, stessi mesi e
   stesso riparto (R7).
5. **Condominio: una sola voce «Condominio» per versamento**, senza distinguere rata e conguaglio
   dell'anno prima (R8); **solo la parte degli inquilini** (sezione 9, «Spese condominiali»; sezione 12).
6. **Bolletta a cavallo di due annualità**: la quota di questo periodo con l'etichetta che rimanda
   all'altra (sezione 6).
7. **Ogni bolletta riporta il nome del file** (sezione 27).
8. **Mesi interi** e mese di ingresso e di uscita come in R1 e nella sezione 6; ordine dei posti =
   `apartment.rooms` (conguaglio-rules (a)).
9. **Formato degli importi** `€ 1.234,56`, negativi `- € 63,00` (CLAUDE.md); date come nelle note
   (`16/03/2026`, R3).
10. **Un file per appartamento e periodo di conguaglio** (sezioni 20 e 42, R1: annualità per i
    transitori, intero contratto per il 3+2), mai sovrascritto (sezione 6).
11. **Licenze**: solo l'elenco di CLAUDE.md; nessuna libreria nuova senza approvazione (decisione del
    14 novembre, punto 6).

## Che cosa dicono i documenti sul formato di oggi

Da `docs/rules/conguaglio-rules.md` (celle degli Excel veri, senza valori personali):

| Foglio | Colonne documentate |
| --- | --- |
| Registro bollette (R) | B periodo o esercizio («2023/2024»), C tipo («Condominiali»), D importo, E quota della voce nell'annualità, F commissione (0,80), G importo considerato (`D*E+F`), H data di scadenza; nel registro di un altro appartamento N è il link al PDF |
| Conguagli (C) | D spese della voce sui mesi dell'inquilino (prima di `/posti`), E condominio, F mesi a parole («Ott - Apr»; «Mar 24 - Gen 26» per un periodo di più anni), G numero di mesi, H forfait (`30 × mesi`), I conguaglio versato (`68.28+44.11+10.15`), J conguaglio da versare (`D/5+E/5-H-I`) |
| Affitti versati (AV) | E quota del posto (affitto + forfait), F e seguenti la data del versamento di ogni mese («09 ott»), nessun importo |

Non sono documentati: le colonne A-C del foglio C e A del foglio R, le intestazioni esatte, le righe
sopra la tabella (titolo, appartamento), larghezze, caratteri e colori, i nomi dei fogli dopo la
generazione, e se il formato è uguale per i tre appartamenti (il foglio di un appartamento ha
`N13/4` in un'altra posizione). Sono la domanda 2.

## Il file generato (proposta, da confermare con la domanda 2)

Valori scritti dall'app, nessuna formula (domanda 1). Ogni foglio ha una riga di intestazione e poi i
dati; gli importi sono celle numeriche in euro con il formato `"€ "#,##0.00;"- € "#,##0.00`
(su un Excel in italiano si vede `€ 1.234,56` e `- € 63,00`), le date celle data `dd/mm/yyyy`.

**Foglio «Bollette»** (registro: una riga per voce che entra nel conguaglio del periodo, cioè non
`pending` per `calcConguaglio`), in ordine di inizio periodo, poi tipo, poi `id`:

| Colonna | Bolletta | Rata (TARI, condominio) |
| --- | --- | --- |
| Tipo | Elettricità, Gas, Acqua, Internet, Altro | TARI, Condominio |
| Fornitore | `bill.supplier` | vuoto |
| Numero | `bill.number` | `Rata <i> di <n>, <esercizio>` |
| Periodo dal / al | `periodStart` / `periodEnd` | primo giorno di `coversFrom` / ultimo di `coversTo` |
| Scadenza | `dueDate` | `dueDate` |
| Addebito | date degli addebiti abbinati, oppure «assunta, non verificata» (R2) | uguale |
| Importo | somma degli abbinamenti `amount` (R2) | condominio: addebito meno la parte della proprietà, cioè la parte degli inquilini, conguaglio dell'anno prima compreso (R8); TARI: la quota di questo appartamento |
| Commissione | somma degli abbinamenti `commission` (R7) | uguale |
| Quota nel periodo | importo e commissione dei soli mesi del periodo, con le stesse funzioni del conguaglio (`allocateBillToMonths`, `allocateInstalment`) | uguale |
| File | nome del file di `bill.filePath` | vuoto (la rata non ha percorso) |
| Nota | «Bolletta a cavallo: € 60,00 nei mesi agosto–settembre 2026, fuori da questo periodo.» (sezione 6) | vuota |

Dopo le voci la riga «Totale» (Importo, Commissione e Quota nel periodo sommati su tutte le righe,
sezione 19). Poi, se ci sono voci in attesa di pagamento (domanda 6), una riga vuota, la riga
«Voci in attesa di pagamento» e una riga per voce con i soli Tipo, Fornitore, Periodo dal e Periodo al
(nessun importo), nello stesso ordine delle voci.

**Riga in cima** (domanda 5): «Conguaglio provvisorio: voci in attesa N» come prima riga dei fogli
Bollette e Conguagli, sopra le intestazioni, finché il periodo non è chiuso (senza la chiusura di R5
nessun periodo lo è) o ci sono voci in attesa.

**Foglio «Conguagli»**: una riga per inquilino presente nel periodo, nell'ordine dei posti
(`apartment.rooms`) e poi del primo mese, come nell'esempio; per ultima la riga «Totale» con le somme
di tutte le righe (sezione 19).

| Colonna | Valore |
| --- | --- |
| Posto | `tenancy.room` (più posti separati da virgola se l'inquilino ha cambiato posto) |
| Inquilino | `Tenant.name` |
| Mesi | «ott – apr» come C!F; con l'anno («mar 2024 – gen 2026») se il periodo è più lungo di un'annualità; più presenze separate da «; » |
| N. mesi | mesi di presenza nel periodo |
| Spese | `spese + commissione` del risultato (bollette e TARI, commissione compresa per R7) |
| Condominio | `condominio.rata + condominio.conguaglioPrec` (R8) |
| Forfait incassato | `forfaitIncassato` (R4: incassato, non dovuto) |
| Conguaglio | `due`: positivo = l'inquilino deve, negativo = credito dell'inquilino |
| Versato | somma dei versamenti di conguaglio del periodo dell'inquilino, col segno (domanda 3) |
| Residuo | `Conguaglio − Versato` |
| Stato | «saldato», «parziale» o «da pagare» (sezione 27, R6; regola alla domanda 3) |

Prima del «Totale» la riga «Posti vuoti (proprietà)» (domanda 4): Spese =
`unassignedByBucket.spese + commissione`, Condominio = `rata + conguaglioPrec`, le altre colonne
vuote; così Spese + Condominio del «Totale» = «Quota nel periodo» del «Totale» del foglio Bollette.

**Foglio «Affitti versati»**: una riga per presenza (inquilino e posto), stesso ordine; colonne
Posto, Inquilino, Quota (`monthlyRent + monthlyForfait`, come AV!E), poi un mese per colonna del
periodo (intestazione «ott 2026»). Nella cella del mese le date dei versamenti `canone` confermati di
quel mese (`forMonth`, altrimenti il mese della data: la regola di `collectedForfait`) nella forma
dell'esempio («09 ott»; più date separate da virgola); vuota se non c'è versamento o fuori presenza.
Nessun importo, come l'esempio.

**Foglio «Versamenti conguaglio»**: i fatti, senza conti. Una riga per `Payment` vivo, confermato,
`kind: 'conguaglio'`, dell'appartamento e di un inquilino del periodo: Inquilino, Data, Importo (con
il segno registrato: positivo = versato dall'inquilino, negativo = restituito all'inquilino, R130),
Mese indicato (`forMonth`), Origine (estratto, a mano, Excel). In ordine di data e `id`. Le caparre
(`kind: 'caparra'`) non ci sono: domanda 3.

## Architettura

- **`packages/core/src/zip.ts`** (puro): `crc32` e `zipStored`, zip con il metodo 0 (senza
  compressione), data e ora fisse (1 gennaio 1980), voci nell'ordine dato, niente zip64. È il pezzo
  che una libreria farebbe; sono un centinaio di righe.
- **`packages/core/src/xlsx-write.ts`** (puro): `XlsxWorkbook` → `Uint8Array`. Scrive solo le parti
  minime di SpreadsheetML (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`,
  `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheetN.xml`), testo in celle
  `inlineStr`, nessun `docProps` (dove starebbero autore e data), nessuna formula. Importi dai
  centesimi al testo decimale senza virgola mobile (`123456` → `1234.56`); date come numero seriale
  intero con `daysBetween('1899-12-30', data)`.
- **`packages/core/src/excel.ts`** (puro): `buildConguaglioWorkbook(input)` → `XlsxWorkbook`.
  Chiama `calcConguaglio` una volta e ne riusa le funzioni di ripartizione per il foglio Bollette;
  un test controlla che la somma della colonna «Quota nel periodo» sia uguale alle quote degli
  inquilini più i posti vuoti (`unassigned`), così le due tabelle non possono divergere.
- **`packages/core/src/excel-store.ts`**: `loadExcelInput(store, { apartmentId, periodLabel })`
  legge i record vivi, ricava il periodo dal contratto (`settlementPeriods`) e aggiunge agli
  abbinamenti salvati quelli «assunti» che `planMatch` calcola (R2, come `loadAccountBalances`).
  Nessuna scrittura.
- **`scripts/excel.mjs`** (`pnpm excel`): orologio e file system stanno qui, come in
  `scripts/estratti.mjs`; scrive in un file temporaneo nella stessa cartella e lo rinomina, rifiuta se
  il file c'è già.

### Libreria xlsx: nessuna

Ho valutato le alternative senza rete, quindi licenze, versioni e dipendenze delle librerie **non
sono verificate in questa sessione**: `exceljs` (MIT, molte dipendenze transitive per lo zip e lo
streaming), `xlsx`/SheetJS (Apache-2.0, ma le versioni recenti non sono più pubblicate sul registro
npm), `write-excel-file` (MIT, con una libreria zip sotto), `fflate` (MIT, solo zip). Proposta:
**nessuna dipendenza nuova**, perché

- servono sei file XML piccoli e uno zip senza compressione: poco codice, tutto testato;
- l'uscita deve essere deterministica byte per byte (date fisse nello zip, nessun `docProps`, ordine
  fisso), cosa che le librerie non sempre permettono;
- `pnpm licenses:check` e la catena di build restano come sono; il core resta puro (lo scrittore non
  usa `node:*`, solo `TextEncoder`);
- `openpyxl`, citato nella sezione 8, non è ammesso: in Python le sole dipendenze sono `pdfminer.six`
  e `jsonschema` (CLAUDE.md).

Ripiego, solo se Excel rifiutasse uno zip senza compressione (non dovrebbe: lo standard OOXML lo
ammette): `fflate` (MIT, senza dipendenze) per la sola compressione, con versione esatta pubblicata
da almeno due settimane, verificata al momento. Domanda 10.

## Determinismo

- Stessi record → stessi byte: nessun orologio nel core né nel file (nessuna data di creazione), zip
  con data fissa, fogli, righe e voci dello zip in ordine fisso, ordinamenti con `compareText`,
  ingresso mescolato → stesso file.
- `pnpm excel` passa al core solo i record; l'orologio non entra nel file.
- I test con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles` danno lo stesso hash.

## Sicurezza e dati personali

- Il file contiene nomi e importi (è il suo scopo) e va dove l'utente indica; **l'uscita della riga di
  comando** ha solo stato, conteggi e motivi (R107): mai nomi, importi o percorsi.
- I messaggi d'errore sono costanti; un `SettlementInputError` esce con il solo `code`.
- Testo delle celle: si rifiutano i caratteri che XML 1.0 non ammette (controllo), si fa l'escape di
  `& < > "`; i nomi dei fogli seguono le regole di Excel (1-31 caratteri, niente `[]:*?/\`).
- Nessun dato reale nelle fixture: appartamenti e inquilini inventati, IBAN della tabella di
  `fixtures/README.md`.

## Lacune (dati che mancano nel modello)

1. **Nota TARI (R3).** `tariNote` esiste ma chiede numero dell'avviso e periodo dichiarato, che
   `Instalment` non ha; nessuno li scrive oggi. Il piano 5 non scrive la nota; si aggiunge quando la
   lettura degli avvisi TARI salva quei due dati (campo facoltativo, nessuna regola nuova).
2. **Link alla sottocartella** (sezione 27): manca la tabella «Cartelle condivise»; «l'app lo chiede
   prima di generare l'Excel» è dell'interfaccia.
3. **Nome del file di una rata**: `Instalment` ha solo `fileHash`; la colonna File resta vuota.
4. **Esempio di user1** non nel repository: intestazioni e ordine esatti (domanda 2).

## Domande per user1

Regole di calcolo, di fiducia o di formato: non le decido io. Finché manca la risposta il punto resta
fuori (o com'è indicato) e il resto procede.

1. **Formule o valori?** L'esempio usa formule (`=D3*E3+F3`, `=D6/5+E6/5-H6-I6`). Raccomando
   **valori**: i conti li fa l'app (sezione 38), una formula modificata a mano darebbe un numero
   diverso dall'app. Esempio: la quota di un inquilino 150,09 € scritta come numero, non come
   `=D6/5-H6`. Il piano scrive valori; se rispondi «formule», un task in più le aggiunge solo nelle
   righe dei totali.
   **Risposta di user1 (16 novembre 2026): valori.** Nessuna formula.
2. **Il formato esatto dell'esempio.** Servono, senza valori: nomi e ordine dei fogli, intestazioni e
   ordine delle colonne, le righe sopra la tabella (titolo, appartamento, annualità), se è uguale per
   i tre appartamenti. Basta scriverli, oppure lanciare `python3 -I python/tools/xlsx_structure.py
   --known-labels "…"` sull'esempio (stampa solo le etichette in elenco, R98). Fino ad allora il
   piano usa le colonne del capitolo «Il file generato», con intestazioni in un punto solo
   (`EXCEL_HEADERS`), così cambiarle è una riga.
3. **Versato, residuo e stato del conguaglio (R6).** Quali `Payment` contano come conguaglio versato
   di un periodo? Raccomando: solo `kind: 'conguaglio'` confermati di quell'appartamento e inquilino
   con `forMonth` nel periodo (o, senza `forMonth`, la data nel periodo o dopo la sua fine fino al
   periodo successivo), con il loro segno; «saldato» solo con origine `csv` (R6: «chiuso solo quando
   il bonifico compare nel CSV»); una restituzione della caparra con la riga «Conguaglio bollette»
   (`caparraReturn`) **non** conta finché non decidi tu. E nel file condiviso con tutti gli inquilini
   vanno anche le **caparre**? Raccomando no. Esempio: conguaglio 120,00 €, bonifici dell'inquilino
   50,00 € (CSV) e 70,00 € (a mano) → con la raccomandazione: versato 120,00 €, stato «parziale» finché
   il secondo non compare nel CSV. Fino alla risposta: niente colonna versato/residuo/stato, solo il
   foglio «Versamenti conguaglio» con i fatti, senza caparre.
   **Risposta di user1: sì, come la raccomandazione**, caparre fuori dal file condiviso. Task 9 del
   piano; R172. Il confine «fino al periodo successivo» e il versato oltre il dovuto restano domande
   (11 e 12).
4. **Riga dei posti vuoti nel foglio Conguagli?** Con la riga «Posti vuoti (proprietà)» il totale
   del foglio Conguagli è uguale al totale del foglio Bollette; senza, differisce dell'importo dei
   posti vuoti. Raccomando sì. Esempio: Bollette 1.000,00 €, inquilini 940,00 €, posti vuoti 60,00 €.
   Fino alla risposta: nessuna riga.
   **Risposta di user1: sì.** Task 8; R170.
5. **«Provvisorio» sul file di un periodo non chiuso?** Finché non c'è la chiusura (R5) ogni Excel è
   provvisorio. Raccomando una riga in cima «Conguaglio provvisorio: voci in attesa N» quando ci sono
   voci `pending` o il periodo non è chiuso. Fino alla risposta: nulla (l'uscita della riga di comando
   dà il numero delle voci in attesa).
   **Risposta di user1: sì.** Nel modello non c'è ancora la chiusura (R5), quindi nessun periodo è
   chiuso e la riga c'è sempre, anche con N = 0 (R171). Task 10.
6. **Voci in attesa di pagamento**: R2 le tiene fuori; vanno almeno **elencate** (senza importo) in
   fondo al foglio Bollette, perché gli inquilini sappiano che arriveranno? Raccomando sì, solo tipo,
   fornitore e periodo. Fino alla risposta: fuori del tutto, come dice R2.
   **Risposta di user1: sì**, tipo, fornitore e periodo, nessun importo. Task 10; R171.
7. **Nome e cartella del file.** La sezione 20 dice `<Appartamento>/<annualità>/Excel/`; il nome no.
   Raccomando `Conguaglio_<Appartamento>_<periodo>.xlsx` (con `safeWord`, niente accenti né `:`).
   Fino alla risposta `pnpm excel` chiede il percorso con `--uscita`.
   **Risposta di user1: sì.** Senza `--uscita` il file va in
   `<Appartamento>/<periodo>/Excel/Conguaglio_<Appartamento>_<periodo>.xlsx` sotto `--cartella`;
   `--uscita` vale ancora. Task 11; R173.
8. **Inquilino senza nome** (presenza senza record `tenant`): raccomando rifiutare la generazione con
   l'elenco degli `id` (`missing-tenant`), non scrivere l'`id` al posto del nome. Il piano fa così; se
   preferisci l'`id`, cambia un controllo.
   **Risposta di user1: rifiutare** (`missing-tenant`), come già fatto.
9. **File riservato ai proprietari (R8, sezioni 12 e 20)**: lo facciamo nel piano 5b subito dopo, con
   le colonne di R8 (rata, conguaglio dell'anno prima, quota della proprietà, data dell'addebito) più
   straordinarie e stato del pagamento? Raccomando sì, stesso scrittore.
   **Risposta di user1: sì**, stesso scrittore: piano 5b.
10. **Nessuna libreria xlsx** (zip e XML scritti da noi, sopra): approvi? Ripiego `fflate` (MIT) solo
    se Excel rifiutasse il file.
    **Risposta di user1: nessuna libreria.**
11. **(Nuova.) Fino a quando conta un versamento senza mese indicato?** La risposta 3 dice
    «la data nel periodo o dopo la sua fine fino al periodo successivo». La leggo come «fino al
    giorno prima dell'inizio del periodo successivo» (R172): così un bonifico non conta mai per due
    periodi. Ma con annualità consecutive il conguaglio del 2026-27, pagato a novembre 2027 senza
    mese indicato, conta nel 2027-28 e non nel 2026-27. Esempio: conguaglio 2026-27 di 120,00 €,
    bonifico di 120,00 € il 15/11/2027 senza mese → oggi va nel 2027-28; per contarlo nel 2026-27
    serve il mese indicato (`forMonth` `2027-09` o un altro mese del periodo). Va bene, o preferisci
    una finestra dopo la fine (per esempio fino alla fine del periodo successivo, contando il
    bonifico una volta sola)? Senza periodo successivo (ultimo contratto) la finestra non ha fine.
    **Risposta di user1 (D11): senza mese indicato conta fino alla fine del periodo successivo, una
    volta sola** (R177, task 12).
12. **(Nuova.) Stato con versato oltre il dovuto.** Conguaglio 100,00 €, versati 120,00 €
    dal CSV: residuo −20,00 €. La sezione 27 ha solo «saldato, parziale, da pagare»: oggi scrivo
    «parziale» (R172). Vuoi un'altra parola (per esempio «versato in più») o un'altra regola?
    **Risposta di user1 (D12): «versato in più».** R178, task 13.
13. **(Nuova, dalla revisione.) Periodi che si sovrappongono.** Il periodo successivo è il primo
    che inizia dopo la fine di questo; un contratto che inizia prima della fine (per esempio un
    3+2 da 2027-03 accanto all'annualità 2026-27) non chiude la finestra, quindi un bonifico senza
    mese del 10/05/2027 di 80,00 € conta nel 2026-27 e anche nel periodo del nuovo contratto. Come
    vanno scelti i periodi in questo caso?
    **Risposta di user1 (D13): conta nel periodo che inizia per ultimo tra quelli che lo contengono**
    (R177, task 12).
14. **(Nuova, dalla revisione.) Casi strani dello stato.** Oggi: conguaglio 0,00 € e nessun
    versamento → «saldato»; conguaglio 100,00 €, bonifici +50,00 € e −50,00 € → versato 0 → «da
    pagare»; credito dell'inquilino −40,00 € e nessuna restituzione → «da pagare» (ma siamo noi a
    dover pagare). Vanno bene queste parole?
    **Risposta di user1 (D14): il credito non ancora restituito è «da restituire»**; il resto resta
    com'è (0 senza versamenti «saldato», +50/−50 «da pagare»). R178, task 13.
15. **(Nuova, dalla revisione.) Voci pagate elencate come «in attesa».** L'elenco in fondo al foglio
    Bollette riporta tutte le voci che `calcConguaglio` tiene fuori, anche quelle con l'addebito nel
    CSV ma ferme per un altro motivo (importo diverso, quota della proprietà più grande della rata).
    Esempio: rata di condominio 300,00 € addebitata, ma la quota della proprietà è 320,00 € → è
    elencata come «in attesa di pagamento». Serve un'altra intestazione o un motivo?
    **Risposta di user1 (D15): una colonna «Motivo»** con «in attesa di pagamento», «importo
    diverso» o «quota maggiore della rata». R179, task 14.
16. **(Nuova, aperta, dalla revisione.) Versamento nella direzione sbagliata.** Credito
    dell'inquilino −40,00 € e un bonifico dell'inquilino di +10,00 €: oggi «parziale» (residuo
    −50,00 €); conguaglio +100,00 € e una nostra restituzione di −20,00 €: oggi «parziale» (residuo
    120,00 €). Vanno chiamati «versato in più» o in un altro modo?

## Mie scelte (da controllare)

1. Ordine del foglio Bollette: inizio del periodo, tipo, `id`.
2. Mesi a parole in minuscolo, abbreviati a tre lettere come i nomi di `MONTH_NAMES` («ott – apr»);
   le intestazioni dei mesi nel foglio Affitti versati con l'anno («ott 2026»).
3. Più date nella stessa cella separate da «, »; più presenze dello stesso inquilino separate da «; ».
4. Una riga per presenza nel foglio Affitti versati (la quota può cambiare), una per inquilino nel
   foglio Conguagli (il conguaglio è per inquilino).
5. La parte di un'uscita verso un inquilino resta col segno registrato (negativo), come nel modello.
6. `pnpm excel` non sovrascrive mai (sezione 6): un file esistente è un rifiuto, non una nuova versione.

## Test (solo fixture sintetiche)

Fixture nuova `fixtures/excel/anno-esempio.json` (appartamenti e inquilini inventati, `apt-nord` con
4 posti e `apt-sud`, periodo 2026-27): una bolletta della luce a cavallo (agosto-novembre 2026),
internet con commissione, gas presunto (nessun estratto), una bolletta in attesa, TARI comune ai due
appartamenti addebitata dal conto di Nord, una rata di condominio con parte della proprietà e
conguaglio dell'anno prima, un posto vuoto per tre mesi, un cambio di inquilino nello stesso posto, i
canoni, un conguaglio versato (+50,00 €) e uno restituito (−12,00 €, R130), una caparra restituita
(−538,40 €, che non compare).

- zip: CRC-32 di riferimento, intestazioni e directory centrale coerenti, stessi byte due volte,
  rifiuti (nomi doppi, non NFC, `..`, file troppo grandi per uno zip senza zip64);
- xlsx: XML esatto di un foglio piccolo, escape, rifiuto dei caratteri di controllo e dei nomi di
  foglio non validi, importi e date esatti;
- Python: il file letto da `python -I -m bollette_pdf table` ha i fogli, le intestazioni, gli importi
  (`n` «1234.56») e le date (`d` ISO) attesi (saltato senza Python, obbligatorio con
  `REQUIRE_PYTHON=1`);
- excel: celle attese per le voci semplici, invariante Bollette = inquilini + posti vuoti, totali,
  ordine dei posti, ingresso mescolato → stesso file, voce in attesa assente, caparra assente;
- loader e riga di comando: periodo ignoto, appartamento ignoto, archivio incoerente, inquilino senza
  nome, file già presente, uscita senza dati personali (`scanText`);
- tutto anche con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`.

## Rischi

- **Formato diverso dall'esempio** finché manca la domanda 2: il file è giusto nei numeri ma non
  «come l'esempio». Le intestazioni stanno in un punto solo.
- **Excel o Numbers non aprono il file**: verificato solo con il lettore Python (stretto) e con i test;
  user1 apre il file d'esempio generato prima dell'unione (sotto).
- **Divergenza tra fogli**: il foglio Bollette ricalcola le quote; l'invariante con `calcConguaglio`
  lo impedisce nei test.

## Non verificato

- Apertura in Excel per Mac e Windows, Numbers e LibreOffice (lo zip senza compressione e le celle
  `inlineStr` sono standard, ma va provato a mano da user1 con il file della fixture).
- Che il formato `"€ "#,##0.00` mostri i separatori italiani su un Excel in un'altra lingua (dipende
  dalle impostazioni del computer di chi apre).

## Task proposti (il piano li dettaglia)

| # | Titolo | Dipende da |
| --- | --- | --- |
| 1 | Zip senza compressione (`crc32`, `zipStored`) | — |
| 2 | Scrittore xlsx (`XlsxWorkbook`, `writeXlsx`) | 1 |
| 3 | Andata e ritorno con il lettore Python | 2 |
| 4 | Foglio Bollette (`excelItems`, fixture `anno-esempio`) | — |
| 5 | Fogli Conguagli, Affitti versati, Versamenti conguaglio (`buildConguaglioWorkbook`) | 2, 4 |
| 6 | Caricamento dall'archivio (`loadExcelInput`, assunte da `planMatch`) | 5 |
| 7 | Riga di comando `pnpm excel`; Ruling in `docs/progress.md` | 3, 6 |

## Cosa resta fuori

- File riservato ai proprietari (domanda 9), stato del conguaglio (domanda 3), nota TARI e link
  (lacune 1 e 2).
- Chiusura, istantanee, versioni in `_app/excel_versioni/`, differenze e celle cambiate a mano.
- Interfaccia (scheda Excel, pulsante «Chiudi annualità»), messaggi agli inquilini, moduli Word.
