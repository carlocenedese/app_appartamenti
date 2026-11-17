# Piano 17: applicare le risposte di user1 del 17 novembre 2026 (disegno)

Stato: **in esecuzione** (17 novembre 2026). Ramo `feat/piano-17-risposte`. R nuovi da R300.
Fonte: risposte di user1 del 16 novembre (piano 10) e del 17 novembre 2026 (lotti 1-11). Si applicano
**solo** quelle risposte; ciò che resta aperto è in «Domande ancora aperte». Solo core e riga di
comando, niente schermate. Registro: `docs/progress.md` R300 e seguenti.

## Gruppi

| Gruppo | Piani | Contenuto                                                                                   |
| ------ | ----- | ------------------------------------------------------------------------------------------- |
| B      | 8     | recupero: segno, spesa diretta al fornitore, periodo predefinito, Excel, file proprietari   |
| A      | 11-12 | caparra: permanenza continua, date degli interessi, tassi legali, prospetto automatico      |
| C      | 10-14 | tasse: anno del condominio, discrepanza confermata, voce delle scadenze, F24 misto, TARI    |
| D      | 14    | stima del condominio: consuntivo dell'ultimo anno con documenti, formato fisso              |
| E      | 12    | moduli: durata residua, acconto con nota, dati personali dell'inquilino                     |
| F      | 15    | bollette e cruscotto: 15 giorni, consumi per giorno, codici dell'utenza, spostamento del PDF |
| G      | 16    | distribuzione: solo documenti                                                               |

B va prima di A perché il prospetto della caparra trattiene i recuperi degli inquilini usciti.

## B. Recuperi dagli inquilini (piano 8, lotti 3, 7, 10)

- `TenantRecovery`: `instalmentId` diventa facoltativo; nuovo `transactionId?` (un movimento in
  uscita vivo, classificato all'appartamento, cioè una spesa pagata direttamente a un fornitore); al
  più uno dei due. `amount` e quote **con segno** (mai zero, tutte dello stesso segno): negativo =
  l'inquilino ha anticipato per conto della proprietà (credito nel suo conguaglio; come lo si
  restituisce, di solito dall'affitto del mese dopo, non è deciso nel codice). Nuovo `date?`: la
  data della spesa, scritta da `saveTenantRecovery` (scadenza della rata, data del movimento; per un
  recupero senza spesa collegata la dà user1). Un recupero positivo ha sempre una spesa collegata.
- **Periodo predefinito:** senza `periodLabel` il recupero va nel periodo che contiene il mese di
  `date`. Un recupero vecchio senza `date` né periodo resta fuori, come prima.
- **Spesa pagata:** rata con abbinamento `amount` confermato (come oggi), movimento sempre (è
  l'addebito), nessuna spesa (negativo) sempre.
- **Inquilino già uscito:** una quota di un recupero **senza** periodo indicato il cui inquilino non
  è nel periodo della data non entra nel conguaglio (nessun `recovery-tenant-absent`) e si trattiene
  dalla caparra (gruppo A). Con il periodo indicato da user1 resta il rifiuto.
- **Excel degli inquilini:** non più rifiutato. Nel foglio Bollette, dopo il Totale, la sezione
  «Recuperi dagli inquilini» (Inquilino, Importo, Spesa); nel foglio Conguagli il recupero sta nella
  colonna Spese, così Spese + Condominio − Forfait = Conguaglio resta vero.
- **File dei proprietari:** la «Quota proprietà» di una straordinaria scende dei recuperi positivi
  vivi (non `non-recuperabile`) su quella rata.
- **Differenza consuntivo/preventivo:** già a carico degli inquilini se l'appartamento non dice
  `owner` (R193), e per intero (`conguaglioPrec` del totale dell'unità): nessun cambio, test.

### Lotto 7: quota del conguaglio dell'anno prima nel preventivo (domanda aperta)

Risposta di user1: il preventivo contiene anche la quota del conguaglio dell'anno prima; va
**aggiunta** alle rate dell'anno in corso in modo che a fine anno ciò che esce (rate dell'anno +
consuntivo) coincida con quanto dovuto; delle rate si applica nel conguaglio solo la quota inquilini,
il consuntivo entra per intero.

Parte inequivocabile, già nel codice: delle rate entra nel conguaglio solo la parte al netto della
quota della proprietà (`instalmentOwnerShare`); la differenza (`conguaglioPrec`) entra per intero
agli inquilini (R193). Esempio numerico delle due letture possibili:

- Esercizio 2025: preventivo 1.200,00 €, consuntivo 1.300,00 € → differenza +100,00 €.
- Esercizio 2026: preventivo dell'amministratore 1.300,00 € in 4 rate da 325,00 €, che contengono
  25,00 € ciascuna della differenza 2025; quota della proprietà 200,00 €/anno (50,00 € a rata).
- **Lettura 1 (oggi):** la rata si scrive `rata` 300,00 + `conguaglioPrec` 25,00. Agli inquilini:
  4 × (300 − 50) = 1.000,00 € di rate + 100,00 € di differenza = 1.100,00 €; proprietà 200,00 €.
  Uscita dal conto 1.300,00 €.
- **Lettura 2:** la rata si scrive `rata` 325,00 (il preventivo intero) e la differenza 2025 si
  calcola dai documenti (consuntivo − preventivo 2025 = 100,00 €) e si **aggiunge** al conguaglio
  2026 per intero; per non contarla due volte la quota inquilini delle rate dovrebbe essere
  4 × (325 − 50) − 100 = 1.000,00 €. Totale inquilini uguale, ma la differenza viene dai documenti e
  non da ciò che l'amministratore scrive sulla rata.
- Le due letture danno lo stesso totale solo se la rata contiene esattamente la differenza
  dell'anno prima divisa per il numero di rate. Domanda a user1: quale delle due, e che cosa fare
  quando la rata contiene una cifra diversa dalla differenza dei documenti. **Non deciso nel codice.**

## A. Caparra e subentro (piani 11 e 12, lotti 1, 2, 4, 11)

- **Permanenza continua:** presenze vive dello stesso inquilino nello stesso appartamento senza mesi
  vuoti tra l'una e l'altra (`next.from` = mese dopo `prev.to`). La caparra segue la permanenza, non
  il contratto: un rinnovo non chiede una nuova caparra.
- **Capitale:** versamenti `caparra` confermati meno restituzioni dell'inquilino in quell'appartamento
  (la caparra **in mano**). Rifiuto `already-returned` solo se c'è stato un versamento e non resta
  nulla in mano: una permanenza nuova dopo una restituzione si calcola sui versamenti nuovi.
- **Date degli interessi:** dal primo giorno del primo mese della permanenza continua più recente
  all'ultimo giorno del suo ultimo mese (uscita effettiva, mesi interi come le presenze). Per tutta la
  caparra, anche con più versamenti (lotto 11). Permanenza senza fine: `no-exit`. Il metodo di
  calcolo resta R7 (mesi interi).
- **Tassi legali:** record `legalRate` per anno (`_app/dati/legalRate/tasso-<anno>.json`, `year`,
  `rateBp`), scritto da user1 con `pnpm estratti tasso-legale --anno --tasso` (annullabile). Il
  prospetto li legge dall'archivio; un anno mancante: `missing-rate`.
- **Conguaglio nel prospetto:** la riga dell'inquilino (`due`) del periodo di conguaglio che contiene
  il mese di uscita, senza le voci in attesa (non contano già), meno i versamenti di conguaglio già
  fatti per quel periodo. `--conguaglio` lo sostituisce se user1 lo scrive a mano.
- **Recuperi trattenuti:** ogni quota positiva o negativa di un recupero vivo senza periodo indicato,
  con la spesa pagata, il cui inquilino non è nel periodo della data della spesa, è una riga
  «Recupero» del prospetto.
- **Cessione:** la caparra la versa il subentrante (`--caparra-attesa` del subentro); quella
  dell'uscente si restituisce con il suo prospetto. Già così: nessun trasferimento automatico.
- Già così (test esistenti): canone confermato dopo l'uscita solo avviso (`payment-after-end`);
  subentrante nello stesso posto; cambio nello stesso mese rifiutato; paganti del nuovo inquilino
  solo dopo un versamento confermato.

## C, D, E, F, G

Vedi le sezioni di `docs/progress.md` R300 e seguenti: ogni gruppo ha il suo Ruling con il dettaglio.

## Domande ancora aperte (non decise)

1. PDF dei moduli (R234 domanda 1).
2. Adempimenti fiscali del subentro (R224 domanda 6): li indicherà user1.
3. Formula della quota del conguaglio dell'anno prima nel preventivo (lotto 7, esempio sopra).
4. Valori delle soglie dell'allarme consumi e livelli giallo/rosso (R265 domanda 1).
5. Interessi «a giorni»: il calcolo resta a mesi interi (R7); le presenze sono a mesi interi.
6. Come si restituisce un recupero negativo (dall'affitto del mese dopo o altro): solo il segno.
