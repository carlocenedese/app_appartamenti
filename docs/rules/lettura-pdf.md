# Lettura dei PDF: profili dei fornitori

Stato: **bozza, in attesa dell'approvazione di Carlo** (Task 12 del piano 2a, Fase B). Nessun
profilo è `confermato`: tutti hanno `status: 'bozza'`.

I profili stanno in `python/seed-profiles/<profilo>.json`, le fixture in `fixtures/pdf/<fornitore>-<NN>.json`
(ognuna con i valori attesi), il test in `python/tests/test_real_layouts.py`. I profili non
contengono codici cliente, POD, PDR, nomi o indirizzi (`identifiers` è vuoto: senza codici noti una
bolletta va sempre in revisione, decisione di Carlo del 12 novembre 2026).

## Regole decise da Carlo

- **Importo = «Totale da pagare» del documento** (12 novembre 2026), anche quando comprende altri
  servizi: nel riepilogo Hera il totale può includere «Altri servizi» (es. gas più altro servizio).
  Stessa regola applicata alle bollette Enel Energia, il cui totale comprende il canone TV:
  **da confermare da Carlo** che valga anche lì.

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
| `acegas-tari-2024-b`    | AcegasApsAmga | TARI Padova | «Totale da pagare:*»                                            |
| `fastweb-internet-2024` | Fastweb       | internet    | unico layout visto                                              |
| `enel-luce-2020`        | Enel Energia  | luce        | tre layout nella stessa pagina 1 e uno con il totale a pagina 2 |

Campi letti: importo, scadenza, numero, data di emissione, periodo e consumo, dove il layout lo
permette (tabella sotto).

| Profilo                           | Importo                                | Scadenza                    | Numero               | Emissione | Periodo | Consumo             |
| --------------------------------- | -------------------------------------- | --------------------------- | -------------------- | --------- | ------- | ------------------- |
| `hera-luce-2024`, `hera-gas-2024` | sì                                     | sì                          | sì                   | sì        | sì      | **no**              |
| `hera-luce-2025`, `hera-gas-2025` | sì                                     | sì                          | sì                   | sì        | sì      | sì                  |
| `acegas-acqua-2024/2025`          | sì                                     | sì                          | sì                   | sì        | **no**  | sì                  |
| `acegas-tari-2024`, `-b`          | sì                                     | sì                          | sì                   | sì        | **no**  | **no**              |
| `fastweb-internet-2024`           | sì                                     | sì                          | sì                   | **no**    | sì      | **no**              |
| `enel-luce-2020`                  | sì (`medium` con il totale a pagina 2) | sì (`medium` in tre layout) | tutti tranne 2022-23 | sì        | **no**  | solo layout 2024-25 |

## Esito sui PDF reali (solo conteggi, 12 novembre 2026)

Con `python/tools/pdf_report.py` sulle cartelle in Dropbox, in sola lettura. Il rapporto stampa
solo conteggi e non è conservato nel repository: si rifà con lo stesso comando.

| Appartamento         | PDF | Riconosciute | Da confermare | Non riconosciute | Senza testo |
| -------------------- | --- | ------------ | ------------- | ---------------- | ----------- |
| Lovarini 2024-2027   | 86  | 80           | 2             | 4                | 0           |
| Pulci 2a, 2020-2026  | 224 | 138          | 2             | 65               | 19          |
| Berchet 3, 2020-2026 | 150 | 96           | 7             | 27               | 20          |

Controllo dell'importo: per Lovarini (Hera, acqua, TARI) e per le bollette Enel di Pulci e
Berchet (esclusi i tre PDF Enel 2020-21 con testo parziale) un programma di prova, non
conservato nel repository, ha confrontato l'importo letto con il valore scritto accanto a «da
pagare» nello stesso documento: nessuna differenza. **Non è il campione di dieci PDF per fornitore
controllati a mano che chiede il piano: resta da fare con Carlo.**

## Casi dubbi

- **Maggior tutela (Berchet, 21 PDF del 2020-2024):** intestazione «Servizio di Maggior Tutela». Il
  costruttore non ricava una regola stabile per l'importo (l'importo sta sotto «TOTALE DA PAGARE»
  ma il testo cambia). Non ha profilo.
- **Scansioni:** 39 PDF senza testo (19 a Pulci, 20 a Berchet), tra cui le bollette Enel del 2020-21
  di Pulci con glifi rotti (`(cid:…)`). Fuori dal piano 2a (OCR nel 2b); i 3 PDF Enel 2020-21 di
  Pulci con testo parziale sono letti con importo da «Totale bolletta», non confrontato (da
  rivedere).
- **Consumo e periodo:** nel layout Hera del 2024 il consumo sta in una tabella a colonne e non si
  legge; il periodo della TARI è scritto come «Gennaio - Aprile 2024» e Fastweb non ha la data di
  emissione leggibile con certezza.
- **TARI condivisa tra Berchet e Lovarini (`[B+L]`):** il profilo non legge ancora le utenze con
  `parts`, che il piano prevede. Va fatto con Carlo (la ripartizione tra gli appartamenti è una
  regola di calcolo).
- **Gas e luce di Lovarini:** 2 gas `da-confermare` (bollette con il riepilogo diverso).
- **Non profilati:** Vodafone (Pulci 2020-21), caldaia, Bacchiglione, spese condominiali, acqua di
  Berchet e Pulci.

## Fixture

14 file in `fixtures/pdf/`, una per layout (due layout di Hera luce e acqua, due di TARI, quattro
di Enel, uno di Fastweb, due di Hera gas) più un gas `da-confermare`. Ogni file contiene il minimo
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
