# Lettura dei PDF: profili dei fornitori

Stato: **approvato da Carlo il 12 novembre 2026** (documento e fixture; Task 12 del piano 2a,
Fase B). Il campione a mano dopo le correzioni è stato rifatto: 57 su 57 giusti. Nessun profilo è `confermato`:
tutti hanno `status: 'bozza'`.

I profili stanno in `python/seed-profiles/<profilo>.json`, le fixture in `fixtures/pdf/<fornitore>-<NN>.json`
(ognuna con i valori attesi), il test in `python/tests/test_real_layouts.py`. I profili non
contengono codici cliente, POD, PDR, nomi o indirizzi (`identifiers` è vuoto: senza codici noti una
bolletta va sempre in revisione, decisione di Carlo del 12 novembre 2026).

## Regole decise da Carlo

- **Importo = «Totale da pagare» del documento** (12 novembre 2026), anche quando comprende altri
  servizi: nel riepilogo Hera il totale può includere «Altri servizi» (es. gas più altro servizio).
  Stessa regola applicata alle bollette Enel Energia, il cui totale comprende il canone TV:
  **confermato da Carlo (12 novembre 2026)**: il canone TV resta nel totale.

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

## Controllo a mano di Carlo (12 novembre 2026)

57 PDF, uno per riga, scelti spaziando per anno e layout (10 per fornitore, 7 per l'acqua).
Carlo ha confrontato i valori letti con i PDF; le righe che non ha citato valgono giuste.

- Luce Hera: 10 su 10 giuste. Fastweb: 10 su 10 giuste.
- Gas: 9 su 10 giuste; la decima era una nota di credito (importo -68,92 €), ora letta.
- Acqua (7): importo, scadenza e numero giusti; il periodo non era letto (vedi «Casi dubbi»).
- TARI (10): periodo non letto in nessuna; quattro bollette del 2021-22 non erano lette per niente,
  e il numero delle bollette 2023 mancava. Dopo le correzioni il periodo e il numero si leggono e
  il profilo `acegas-tari-2021` copre il 2021-22.
- Enel (10): periodo non letto in nessuna e numero mancante nelle bollette 2020-23; dopo le
  correzioni sono letti, con confidenza `medium` nei layout 2020-23.
- **Controllo rifatto dopo le correzioni (13 novembre 2026):** gli stessi 57 PDF, letti col codice
  corretto (periodo dell'acqua compreso): 57 su 57 giusti. Carlo l'ha eseguito a mano.

## Esito sui PDF reali (solo conteggi, 12 novembre 2026)

Con `python/tools/pdf_report.py` sulle cartelle in Dropbox, in sola lettura. Il rapporto stampa
solo conteggi e non è conservato nel repository: si rifà con lo stesso comando.

| Appartamento         | PDF | Riconosciute | Da confermare | Non riconosciute | Senza testo |
| -------------------- | --- | ------------ | ------------- | ---------------- | ----------- |
| Lovarini 2024-2027   | 86  | 82           | 0             | 4                | 0           |
| Pulci 2a, 2020-2026  | 224 | 139          | 1             | 65               | 19          |
| Berchet 3, 2020-2026 | 150 | 103          | 0             | 27               | 20          |

Controllo dell'importo: per Lovarini (Hera, acqua, TARI) e per le bollette Enel di Pulci e
Berchet (esclusi i tre PDF Enel 2020-21 con testo parziale) un programma di prova, non
conservato nel repository, ha confrontato l'importo letto con il valore scritto accanto a «da
pagare» nello stesso documento: nessuna differenza. **Non è il campione di dieci PDF per fornitore
controllati a mano che chiede il piano: resta da fare con Carlo.**

## Scansioni lette con OCR (13 novembre 2026)

Con `python/tools/pdf_report.py --ocr-data` (motore Tesseract 5.5.3, dati `ita.traineddata` di
`tessdata_fast` 4.1.0, profili `python/seed-profiles/`, data `2026-11-13`), in sola lettura sulle
cartelle in Dropbox di Berchet 3 e Pulci 2a (Lovarini non ha scansioni). Il rapporto stampa solo
conteggi e non è conservato nel repository: nessun PDF, nome, importo o testo letto è stato
copiato o scritto. **Questi conteggi NON sono il campione controllato a mano: da controllare a
mano con Carlo, un campione di dieci scansioni, prima di fidarsi dell'OCR.**

| Appartamento | PDF | Senza testo prima | Letti con OCR (`ocr`) | Con qualche pagina OCR (`mixed`) | Solo testo (`pdf`) | Riconosciute | Da confermare | Non riconosciute | Senza testo | Illeggibili | Avviso «OCR non disponibile» |
| ------------ | --- | ----------------- | --------------------- | -------------------------------- | ------------------ | ------------ | ------------- | ---------------- | ----------- | ----------- | ---------------------------- |
| Berchet 3    | 150 | 20                | 20                    | 77                               | 53                 | 28           | 75            | 47               | 0           | 0           | 0                            |
| Pulci 2a     | 224 | 19                | 19                    | 83                               | 122                | 61           | 79            | 84               | 0           | 0           | 0                            |

Prima (solo testo del PDF, stesse cartelle): Berchet 103 riconosciute, 0 da confermare, 27 non
riconosciute; Pulci 139, 1 e 65. Durata: circa 5 minuti per Berchet e 1,5 per Pulci.

- Tutte le scansioni senza testo (39) ora hanno testo. Nessuna è `senza-testo` e nessuna è
  `illeggibile`. Un PDF letto con OCR non è mai `riconosciuta` (regola R87): quelli che un profilo
  riconosce vanno `da-confermare`, gli altri restano `non-riconosciuta` (non c'è un profilo
  dell'acqua di Berchet e Pulci). I conteggi non separano gli stati per origine del testo.
- **Da decidere con Carlo:** 160 PDF che hanno testo (77 di Berchet, 83 di Pulci) hanno anche
  qualche pagina senza testo (pagine solo immagine, per esempio di un'altra scansione dentro il
  PDF) che ora passa dall'OCR, quindi sono `mixed` e, per R87, tutti i campi sono `medium` e lo
  stato è `da-confermare`: bollette che prima erano `riconosciuta` con importo `high` (Berchet da
  103 a 28, Pulci da 139 a 61). La regola `mixed` (un solo tetto per tutto il documento) va
  riconsiderata: per esempio lasciare ai campi letti dal testo del PDF la loro confidenza.
- Il motore scrive sull'errore standard messaggi di Leptonica (`box outside rectangle`) per
  alcune pagine; senza testo né dati dei documenti, ma da zittire.

## Casi dubbi

- **Maggior tutela (Berchet, 21 PDF del 2020-2024):** intestazione «Servizio di Maggior Tutela». Il
  costruttore non ricava una regola stabile per l'importo (l'importo sta sotto «TOTALE DA PAGARE»
  ma il testo cambia). Non ha profilo (spiegazione data a Carlo il 12 novembre 2026; decisione di Carlo: restano in revisione a mano, sono bollette chiuse del passato).
- **Scansioni:** 39 PDF senza testo (19 a Pulci, 20 a Berchet), tra cui le bollette Enel del 2020-21
  di Pulci con glifi rotti (`(cid:…)`). Fuori dal piano 2a (OCR nel 2b); i 3 PDF Enel 2020-21 di
  Pulci con testo parziale sono letti con importo da «Totale bolletta», non confrontato (da
  rivedere).
- **Periodo dell'acqua:** letto come **unione dei periodi di consumo** (decisione di Carlo, 12
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
- **TARI condivisa tra Berchet e Lovarini (`[B+L]`):** i profili `acegas-tari-2024` e
  `acegas-tari-2024-b` leggono le utenze con `parts`: per ogni «Utenza N.» il «TOTALE» della riga
  «Parte fissa» nella tabella di pagina 2 (importo da inizio anno, TEFA compreso). Regola di
  ripartizione decisa da Carlo (13 novembre 2026): l'«Importo da pagare» si divide in proporzione
  a quei totali; le componenti perequative **non** sono nei totali delle utenze (nell'avviso di dicembre 2025: 306,44 + 257,66 = 564,10 = TARI 537,24 + TEFA 26,86; le perequative, 7,60 € a utenza, sono in una tabella a parte e fanno parte dell'importo da pagare). Carlo ha deciso di aggiungerle alla rispettiva utenza (13 novembre 2026): `parts.add` somma al totale di ogni utenza il «TOTALE» della tabella perequative, nel layout dell'avviso di dicembre 2025 (3 componenti UR). Il layout del 2024 (2 componenti) non è letto dall'`add`: lì il peso resta il solo totale (differenza di 1,60 € uguale per le due utenze). Il calcolo e il collegamento
  utenza-appartamento (`tariParts`) sono del modulo di proposta, già previsto dalla sezione 42 R3;
  senza codici noti la bolletta va comunque in revisione. Un avviso senza utenze leggibili
  (`parts-found`) è `da-confermare`. Letti 2 utenze su tutte le 8 bollette `[B+L]` (e 1 o 2 sulle
  altre). Gli avvisi cumulativi (periodo oltre i 4 mesi nuovi) danno `tari-months`.
- **TARI 2020 e acqua di altri appartamenti:** una bolletta TARI del 2020 non è riconosciuta; non
  c'è un profilo dell'acqua di Berchet e Pulci.
- **Non profilati:** Vodafone (Pulci 2020-21), caldaia, Bacchiglione, spese condominiali, acqua di
  Berchet e Pulci.

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
**Politica confermata da Carlo (12 novembre 2026):** `fixtures/README.md` ora ammette qui testo di bollette reali
anonimizzato, come dice `CLAUDE.md` (solo fixture anonimizzate) e il piano 2a, mentre prima
diceva solo PDF sintetici.
