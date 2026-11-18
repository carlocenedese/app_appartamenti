# Lettura dei PDF: profili dei fornitori

Stato: **approvato da user1 il 12 novembre 2026** (documento e fixture; Task 12 del piano 2a,
Fase B). Il campione a mano dopo le correzioni è stato rifatto: 57 su 57 giusti. Nessun profilo è `confermato`:
tutti hanno `status: 'bozza'`.

I profili stanno in `python/seed-profiles/<profilo>.json`, le fixture in `fixtures/pdf/<fornitore>-<NN>.json`
(ognuna con i valori attesi), il test in `python/tests/test_real_layouts.py`. I profili non
contengono codici cliente, POD, PDR, nomi o indirizzi (`identifiers` è vuoto: senza codici noti una
bolletta va sempre in revisione, decisione di user1 del 12 novembre 2026).

## Regole decise da user1

- **Importo = «Totale da pagare» del documento** (12 novembre 2026), anche quando comprende altri
  servizi: nel riepilogo Hera il totale può includere «Altri servizi» (es. gas più altro servizio).
  Stessa regola applicata alle bollette Enel Energia, il cui totale comprende il canone TV:
  **confermato da user1 (12 novembre 2026)**: il canone TV resta nel totale.

## Regole prese dal piano per leggere i PDF

- Il riconoscimento usa testo dei documenti che non sia un link (i link sono cancellati dalle
  fixture) e che distingua il servizio: `kWh` per la luce, `Smc` per il gas, «servizio idrico» per
  l'acqua, «GESTORE DELLA TASSA SUI RIFIUTI (TARI)» per la TARI, «FASTWEB S.p.A.» e «Enel Energia».
- Più layout dello stesso fornitore sono profili distinti, o regole diverse di uno stesso campo
  (Enel: tre regole per la scadenza, due per l'importo). Quando un'etichetta cambia, il campo
  manca e la bolletta va `da-confermare` (il test lo simula). Un layout nuovo che conserva le
  etichette può invece essere letto con confidenza alta senza essere giusto: per questo serve il
  campione controllato a mano.
- Date di validità, scelte e non lette dai documenti: `validFrom` `2020-01-01` (primo anno con
  bollette) per Hera 2024, AcegasApsAmga TARI, Fastweb ed Enel; `hera-*-2024` hanno `validTo`
  `2025-10-31` e `hera-*-2025` `validFrom` `2025-11-01` (la prima bolletta nel layout nuovo è del
  12 novembre 2025); `acegas-acqua-2024` ha `validTo` `2024-12-31` e `acegas-acqua-2025`
  `validFrom` `2025-01-01` (`acegas-acqua-2024` ha `validFrom` `2020-01-01`) (il layout cambia tra una bolletta emessa a novembre 2024 e una di
  marzo 2025).
- Le ancore di alcuni campi sono parole generiche (`del`, `Data`): una sola occorrenza basta per
  una lettura `high`. È un rischio da controllare nel campione a mano.

## Profili

| Profilo                 | Fornitore     | Servizio    | Layout                                                          |
| ----------------------- | ------------- | ----------- | --------------------------------------------------------------- |
| `hera-luce-2024`        | Hera Comm     | luce        | riepilogo su una riga (fino a ottobre 2025)                     |
| `hera-luce-2025`        | Hera Comm     | luce        | «nuova bolletta» (da novembre 2025)                             |
| `hera-gas-2024`         | Hera Comm     | gas         | riepilogo su una riga                                           |
| `hera-gas-2025`         | Hera Comm     | gas         | «nuova bolletta»                                                |
| `acegas-acqua-2024`     | AcegasApsAmga | acqua       | riepilogo su una riga                                           |
| `acegas-acqua-2025`     | AcegasApsAmga | acqua       | riepilogo su due colonne                                        |
| `acegas-tari-2024`      | AcegasApsAmga | TARI Padova | «Totale da pagare:»                                             |
| `acegas-tari-2024-b`    | AcegasApsAmga | TARI Padova | «Totale da pagare:*» (anche 2023, con «Bolletta nr.»)           |
| `acegas-tari-2021`      | AcegasApsAmga | TARI Padova | «Bolletta nr.» con importo dopo «Euro» (2021-2022)              |
| `fastweb-internet-2024` | Fastweb       | internet    | unico layout visto                                              |
| `enel-luce-2020`        | Enel Energia  | luce        | tre layout nella stessa pagina 1 e uno con il totale a pagina 2 |

Campi letti: importo, scadenza, numero, data di emissione, periodo e consumo, dove il layout lo
permette (tabella sotto).

| Profilo                           | Importo                                | Scadenza                    | Numero                | Emissione | Periodo               | Consumo             |
| --------------------------------- | -------------------------------------- | --------------------------- | --------------------- | --------- | --------------------- | ------------------- |
| `hera-luce-2024`, `hera-gas-2024` | sì                                     | sì                          | sì                    | sì        | sì                    | **no**              |
| `hera-luce-2025`, `hera-gas-2025` | sì                                     | sì                          | sì                    | sì        | sì                    | sì                  |
| `acegas-acqua-2024/2025`          | sì                                     | sì                          | sì                    | sì        | **no**                | sì                  |
| `acegas-tari-2021`, `-2024`, `-b` | sì                                     | sì                          | sì                    | sì        | sì (mesi interi)      | **no**              |
| `fastweb-internet-2024`           | sì                                     | sì                          | sì                    | **no**    | sì                    | **no**              |
| `enel-luce-2020`                  | sì (`medium` con il totale a pagina 2) | sì (`medium` in tre layout) | sì (`medium` 2020-23) | sì        | sì (`medium` 2020-23) | solo layout 2024-25 |

## Controllo a mano di user1 (12 novembre 2026)

57 PDF, uno per riga, scelti spaziando per anno e layout (10 per fornitore, 7 per l'acqua).
user1 ha confrontato i valori letti con i PDF; le righe che non ha citato valgono giuste.

- Luce Hera: 10 su 10 giuste. Fastweb: 10 su 10 giuste.
- Gas: 9 su 10 giuste; la decima era una nota di credito (importo -68,92 €), ora letta.
- Acqua (7): importo, scadenza e numero giusti; il periodo non era letto (vedi «Casi dubbi»).
- TARI (10): periodo non letto in nessuna; quattro bollette del 2021-22 non erano lette per niente,
  e il numero delle bollette 2023 mancava. Dopo le correzioni il periodo e il numero si leggono e
  il profilo `acegas-tari-2021` copre il 2021-22.
- Enel (10): periodo non letto in nessuna e numero mancante nelle bollette 2020-23; dopo le
  correzioni sono letti, con confidenza `medium` nei layout 2020-23.
- **Controllo rifatto dopo le correzioni (13 novembre 2026):** gli stessi 57 PDF, letti col codice
  corretto (periodo dell'acqua compreso): 57 su 57 giusti. user1 l'ha eseguito a mano.

## Esito sui PDF reali (solo conteggi, 12 novembre 2026)

Con `python/tools/pdf_report.py` sulle cartelle in Dropbox, in sola lettura. Il rapporto stampa
solo conteggi e non è conservato nel repository: si rifà con lo stesso comando.

| Appartamento              | PDF | Riconosciute | Da confermare | Non riconosciute | Senza testo |
| ------------------------- | --- | ------------ | ------------- | ---------------- | ----------- |
| Appartamento B 2024-2027  | 86  | 82           | 0             | 4                | 0           |
| Appartamento C, 2020-2026 | 224 | 139          | 1             | 65               | 19          |
| Appartamento A, 2020-2026 | 150 | 103          | 0             | 27               | 20          |

Controllo dell'importo: per Appartamento B (Hera, acqua, TARI) e per le bollette Enel di Appartamento C e
Appartamento A (esclusi i tre PDF Enel 2020-21 con testo parziale) un programma di prova, non
conservato nel repository, ha confrontato l'importo letto con il valore scritto accanto a «da
pagare» nello stesso documento: nessuna differenza. **Non è il campione di dieci PDF per fornitore
controllati a mano che chiede il piano: resta da fare con user1.**

## Scansioni lette con OCR (13 novembre 2026)

Con `python/tools/pdf_report.py --ocr-data` (motore Tesseract 5.5.3, dati `ita.traineddata` di
`tessdata_fast` 4.1.0, profili `python/seed-profiles/`, data `2026-11-13`), in sola lettura sulle
cartelle in Dropbox di Appartamento A e Appartamento C (Appartamento B non ha scansioni). Il rapporto stampa solo
conteggi e non è conservato nel repository: nessun PDF, nome, importo o testo letto è stato
copiato o scritto. **Questi conteggi NON sono il campione controllato a mano: da controllare a
mano con user1, un campione di dieci scansioni, prima di fidarsi dell'OCR.**

| Appartamento   | PDF | Senza testo prima | Letti con OCR (`ocr`) | Con qualche pagina OCR (`mixed`) | Solo testo (`pdf`) | Riconosciute | Da confermare | Non riconosciute | Senza testo | Illeggibili | Avviso «OCR non disponibile» |
| -------------- | --- | ----------------- | --------------------- | -------------------------------- | ------------------ | ------------ | ------------- | ---------------- | ----------- | ----------- | ---------------------------- |
| Appartamento A | 150 | 20                | 20                    | 77                               | 53                 | 103          | 0             | 47               | 0           | 0           | 0                            |
| Appartamento C | 224 | 19                | 19                    | 83                               | 122                | 139          | 1             | 84               | 0           | 0           | 0                            |

Stato per origine del testo (riconosciute / da confermare / non riconosciute):

| Appartamento   | `pdf`       | `ocr`      | `mixed`    |
| -------------- | ----------- | ---------- | ---------- |
| Appartamento A | 28 / 0 / 25 | 0 / 0 / 20 | 75 / 0 / 2 |
| Appartamento C | 61 / 0 / 61 | 0 / 0 / 19 | 78 / 1 / 4 |

Prima (solo testo del PDF, stesse cartelle): Appartamento A: 103 riconosciute, 0 da confermare, 27 non
riconosciute; Appartamento C: 139, 1 e 65. Durata: circa 5 minuti per Appartamento A e 1,5 per Appartamento C. Con la
regola per campo (R87, task 7) le riconosciute tornano ai valori di prima; la prima corsa di questa
sezione, con il tetto su tutto il documento, dava 28 e 61.

- Tutte le scansioni senza testo (39) ora hanno testo. Nessuna è `senza-testo` e nessuna è
  `illeggibile`. Un PDF letto per intero con OCR (`ocr`) non è mai `riconosciuta` (R87), ma nessun
  profilo ne riconosce uno: le 39 scansioni restano `non-riconosciuta` (non c'è un profilo
  dell'acqua di Appartamento A e Appartamento C, e le Enel con glifi rotti non corrispondono ai profili).
- 160 PDF hanno testo e qualche pagina solo immagine (77 di Appartamento A, 83 di Appartamento C): sono `mixed`, e
  con la regola per campo restano `riconosciuta` quando nessun campo con valore viene da una pagina
  OCR (153 su 160); solo uno (Appartamento C) è `da-confermare` per questo motivo.
- I messaggi di Leptonica (`box outside rectangle`) non arrivano più sull'errore standard: nella
  corsa il descrittore 2 è rimasto vuoto.

### Secondo giro (R89, normalizzazione del testo OCR)

Il confronto di `recognise` sul testo OCR ora ignora accenti, punteggiatura e a capo (R89); il testo
dei PDF di testo si confronta come prima. Sulle stesse cartelle (solo conteggi): le 39 scansioni
restano 39 `non-riconosciuta`, nessun profilo scelto; le altre origini non cambiano (`pdf`: 89
riconosciute e 86 non; `mixed`: 153 riconosciute, 1 da confermare, 6 non). Le frasi lunghe dei
profili (`allOf[0]`) non compaiono nelle scansioni nemmeno normalizzate (0 su 39); servono ancore
alternative a parola singola per fornitore, che richiedono un cambio dello schema (in attesa di
decisione di user1, R89).

### Terzo giro (R90, `recognise.ocrAnyOf`)

`recognise` può avere `ocrAnyOf` (R90, approvato da user1 il 13 novembre 2026): un documento letto
con l'OCR per intero (`textSource` `ocr`) è riconosciuto dal profilo se soddisfa `allOf`
**oppure** contiene, come parola intera nel testo normalizzato come in R89, almeno uno dei testi di
`ocrAnyOf`; `noneOf` esclude comunque. Un PDF di testo (e le pagine di testo di un `mixed`) ignora
`ocrAnyOf` del tutto, e così le pagine OCR di un `mixed` (correzione della revisione finale, approvata da user1: una pagina scansionata con «kWh» rendeva ambiguo un PDF Enel di testo); un profilo senza `ocrAnyOf` non cambia. Ogni testo deve avere una lettera o una
cifra una volta normalizzato e non ripetersi (JSON Schema, Zod e `check_profile_rules`, casi in
`profile-cases.json`). **Nessun profilo seed lo dichiara (R92, decisione di user1 del 14 novembre 2026):** le parole di fornitore farebbero riconoscere come bollette conferme di pagamento e note del fornitore, che devono restare `non-riconosciuta`; il campo resta come meccanismo per l'utente. Parola condivisa fra profili dello stesso fornitore: vale l'ordine
di R55; tipi diversi restano segnalati da R73 (comunque `da-confermare`). Tentativo unico: le scansioni restano
«da rivedere» e inserimento a mano (decisione di user1, R90, R92).

Esito del terzo giro con le parole di fornitore, poi tolte (R92) (solo conteggi): delle 39 scansioni 9 sono riconosciute (tutte `da-confermare`:
4 Enel, 3 acqua, 1 TARI, 1 gas Hera) e 30 no; ambigue 0; dei campi delle 9 riconosciute non se ne legge quasi nessuno
(importo, scadenza e numero mancano in 9 su 9). Le altre origini non cambiano (`pdf` 89 e 86, `mixed` 153, 1 e 6).
Il resto resta a mano: «da rivedere» e inserimento a mano.

## Avviso «più documenti» sui PDF reali (14 novembre 2026)

Con `python/tools/pdf_report.py` (che ora conta anche i file con l'avviso «Il file potrebbe contenere
più documenti», in totale e per profilo), profili `python/seed-profiles/`, data `2026-11-14`, OCR
attivo, in sola lettura sulle cartelle in Dropbox. Solo conteggi: nessun nome, importo o testo.

| Appartamento   | PDF | Con l'avviso | Per profilo              |
| -------------- | --- | ------------ | ------------------------ |
| Appartamento B | 86  | 1            | `hera-luce-2024` 1       |
| Appartamento C | 224 | 1            | `enel-luce-2020` 1       |
| Appartamento A | 150 | 2            | `acegas-tari-2024-b` 2   |
| Totale         | 460 | 4            | nessuno «nessun profilo» |

Gli altri conteggi (stati, origine del testo) sono invariati rispetto alla sezione delle scansioni.
**L'avviso scatta anche su un documento solo con una tabella di storico** (stessi campi letti con
valori diversi nello stesso file): i 4 casi non sono stati guardati e **vanno guardati da user1**,
che decide se il file contiene davvero più documenti. Le 18 fixture si leggono uguali con o senza
`--pages 1-<pagine>` e nessuna ha l'avviso.

## Casi dubbi

- **Maggior tutela (Appartamento A, 21 PDF del 2020-2024):** intestazione «Servizio di Maggior Tutela». Il
  costruttore non ricava una regola stabile per l'importo (l'importo sta sotto «TOTALE DA PAGARE»
  ma il testo cambia). Non ha profilo (spiegazione data a user1 il 12 novembre 2026; decisione di user1: restano in revisione a mano, sono bollette chiuse del passato).
- **Scansioni:** 39 PDF senza testo (19 a Appartamento C, 20 a Appartamento A), tra cui le bollette Enel del 2020-21
  di Appartamento C con glifi rotti (`(cid:…)`). Fuori dal piano 2a (OCR nel 2b); i 3 PDF Enel 2020-21 di
  Appartamento C con testo parziale sono letti con importo da «Totale bolletta», non confrontato (da
  rivedere).
- **Periodo dell'acqua:** letto come **unione dei periodi di consumo** (decisione di user1, 12
  novembre 2026, R76-R77): «rilevato» e «stimato» insieme, dal primo inizio all'ultima fine
  (esempi: 25.10.2023-12.03.2024; 10.08.2024-10.07.2025; 12.08.2025-11.03.2026). Con buchi o
  sovrapposizioni vale lo stesso; se un intervallo non si legge o le date discordano la confidenza
  è `medium`.
- **Consumo e emissione:** nel layout Hera del 2024 il consumo sta in una tabella a colonne e non
  si legge; Fastweb non ha la data di emissione leggibile con certezza.
- **Nota di credito (gas):** una bolletta a credito scrive «Importo a credito» invece di «Totale da
  pagare». Si legge «Totale fattura» (negativo) e la scadenza di pagina 3, con confidenza `medium`;
  con questa regola un gas senza il totale di pagina 1 si legge dal «Totale fattura», che esclude
  gli «Altri servizi».
- **Ancore ambigue:** per Enel 2020-23 «PERIODO» compare in più punti, e le regole sono perciò
  `medium`.
- **TARI condivisa tra Appartamento A e Appartamento B (`[A+B]`):** i profili `acegas-tari-2024` e
  `acegas-tari-2024-b` leggono le utenze con `parts`: per ogni «Utenza N.» il «TOTALE» della riga
  «Parte fissa» nella tabella di pagina 2 (importo da inizio anno, TEFA compreso). Regola di
  ripartizione decisa da user1 (13 novembre 2026): l'«Importo da pagare» si divide in proporzione
  a quei totali; le componenti perequative **non** sono nei totali delle utenze (nell'avviso di dicembre 2025: 306,44 + 257,66 = 564,10 = TARI 537,24 + TEFA 26,86; le perequative, 7,60 € a utenza, sono in una tabella a parte e fanno parte dell'importo da pagare). user1 ha deciso di aggiungerle alla rispettiva utenza (13 novembre 2026): `parts.add` somma al totale di ogni utenza il «TOTALE» della tabella perequative, nel layout dell'avviso di dicembre 2025 (3 componenti UR). Il layout del 2024 (2 componenti) non è letto dall'`add`: lì il peso resta il solo totale (differenza di 1,60 € uguale per le due utenze). Il calcolo e il collegamento
  utenza-appartamento (`tariParts`) sono del modulo di proposta, già previsto dalla sezione 42 R3;
  senza codici noti la bolletta va comunque in revisione. Un avviso senza utenze leggibili
  (`parts-found`) è `da-confermare`. Letti 2 utenze su tutte le 8 bollette `[A+B]` (e 1 o 2 sulle
  altre). Gli avvisi cumulativi (periodo oltre i 4 mesi nuovi) danno `tari-months`.
- **TARI 2020 e acqua di altri appartamenti:** una bolletta TARI del 2020 non è riconosciuta; non
  c'è un profilo dell'acqua di Appartamento A e Appartamento C.
- **Non profilati:** Vodafone (Appartamento C 2020-21), caldaia, Bacchiglione, spese condominiali, acqua di
  Appartamento A e Appartamento C.

## Fixture

17 file in `fixtures/pdf/`, una per layout (due di Hera luce, due di acqua, cinque di TARI, uno
di Fastweb, tre di Hera gas di cui una nota di credito, quattro di Enel). Il caso di un layout che
cambia si prova nel test, che rinomina un'etichetta e si aspetta `da-confermare`. Ogni file contiene il minimo
di righe con cui il profilo legge gli stessi valori e gli stessi livelli di confidenza: si toglie
una riga alla volta finché il risultato non cambia. Poi nomi, vie, codici cliente e contratto,
IBAN, e-mail, telefoni e link sono tolti con `tools/anonymise.py` (che sostituisce anche IBAN,
codici fiscali, POD, PDR di 14 cifre, e-mail e telefoni); le cifre lunghe 7 o più, il numero di
fattura e l'impronta del file sono invece inventati da uno script di preparazione fuori dal
repository, con cifre prese dal nome della fixture e non dal numero vero (la stessa stringa nella
fixture e nei valori attesi). Il test fissa l'elenco dei numeri inventati. La mappa di sostituzione
sta fuori dal repository; `pnpm data:check` controlla i file tracciati.
**Politica confermata da user1 (12 novembre 2026):** `fixtures/README.md` ora ammette qui testo di bollette reali
anonimizzato, come dice `CLAUDE.md` (solo fixture anonimizzate) e il piano 2a, mentre prima
diceva solo PDF sintetici.
