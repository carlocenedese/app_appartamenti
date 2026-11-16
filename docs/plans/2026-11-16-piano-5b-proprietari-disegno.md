# Piano 5b: Excel riservato ai proprietari (disegno)

Stato: **disegno del 16 novembre 2026, domande 1-7 con la risposta di user1 dello stesso giorno**
(sotto; R184), nato dalla risposta 9 di user1 al disegno del piano 5 («sì,
stesso scrittore»). Il piano (`2026-11-16-piano-5b-proprietari.md`) implementa solo ciò che è
deciso dalla specifica o da user1; il resto è nelle «Domande per user1» e resta fuori dal file.
Riferimenti: `docs/spec.md` sezioni 12, 19, 20 e 42 (R2, R3, R7, R8, che prevalgono); disegno del
piano 5 (scrittore, determinismo, sicurezza); `docs/progress.md` R150-R156, R170-R173. Codice letto:
`excel.ts`, `excel-store.ts`, `xlsx-write.ts`, `conguaglio.ts` (`allocateInstalment`, quota della
proprietà), `match.ts` (`expectedDebit`), `scripts/excel.mjs`.

## Perché

L'Excel degli inquilini ha una sola voce «Condominio» e solo la parte degli inquilini (R8, sezione
9). La sezione 12 chiede un secondo file, **mai condiviso con gli inquilini**, con l'intera spesa
condominiale (quota della proprietà e straordinarie comprese) e il suo stato di pagamento: è la
garanzia di non avere pendenze verso il condominio.

## Decisioni già prese (dove stanno)

1. **File separato**, riservato, mai condiviso con gli inquilini (sezione 12); nessun nome di
   inquilino e nessun dato degli inquilini dentro.
2. **Colonne separate** per rata, conguaglio dell'anno prima, quota della proprietà e data
   dell'addebito nel CSV (R8).
3. **Intera spesa**, comprese quota della proprietà e straordinarie (sezione 12); le straordinarie
   sono interamente della proprietà (R3).
4. **Quota della proprietà** di una rata ordinaria: la quota annua divisa in parti uguali tra le rate
   (R3), nessuna su un record con `rata` 0 (R-C8, come `ownerShare` in `conguaglio.ts`).
5. **Addebito atteso** = rata + conguaglio dell'anno prima (R3, `expectedDebit`).
6. **Conta solo il CSV** (R2): una voce senza addebito è «in attesa di pagamento»; dove manca
   l'estratto è «assunta, non verificata».
7. **Commissione** come parte della voce (R7), dagli abbinamenti.
8. **Un file per appartamento e annualità** (sezione 20), stesso periodo e stesso caricamento del
   file degli inquilini (`loadExcelInput`); mai sovrascritto (sezione 6); valori, nessuna formula
   (risposta 1); stesso scrittore, nessuna libreria (risposte 9 e 10).
9. **Totali su tutte le righe** (sezione 19).

## Il file generato

Un foglio, «Condominio». Una riga per rata di condominio viva dell'appartamento (ordinaria o
straordinaria, abbinata o no) che tocca il periodo, con lo stesso criterio del foglio Bollette (R153:
mesi coperti nel periodo, o i mesi dell'esercizio se c'è un conguaglio dell'anno prima), in ordine di
`coversFrom`, poi `id`; per ultima la riga «Totale».

| Colonna | Valore |
| --- | --- |
| Esercizio | `instalment.esercizio` |
| Rata | `Rata <i> di <n>` |
| Straordinaria | «sì» per `straordinaria`, altrimenti vuota |
| Mesi dal / al | primo giorno di `coversFrom` / ultimo di `coversTo` |
| Scadenza | `dueDate` |
| Importo rata | `rata` |
| Conguaglio anno prima | `conguaglioPrec` (negativo se a credito) |
| Quota proprietà | ordinaria: la sua parte della quota annua (decisione 4); straordinaria: l'addebito atteso (decisione 3) |
| Addebito atteso | `rata + conguaglioPrec` |
| Addebitato | somma degli abbinamenti `amount` confermati e non assunti; vuota se nessuno |
| Commissione | somma degli abbinamenti `commission` confermati |
| Data addebito | date distinte degli addebiti non assunti, `dd/mm/yyyy`, separate da «, » |
| Stato | «importo diverso» se gli addebiti non assunti non sono l'atteso; «pagata» se c'è un addebito non assunto; «assunta, non verificata» se ci sono solo abbinamenti assunti; altrimenti «in attesa di pagamento» |

Il «Totale» somma Importo rata, Conguaglio anno prima, Quota proprietà, Addebito atteso, Addebitato
e Commissione.

## Architettura

- `buildOwnersWorkbook(input: ConguaglioInput)` in `packages/core/src/excel-owners.ts` (puro):
  nessuna chiamata a `calcConguaglio` (il file non dipende dalle presenze); usa `expectedDebit` e
  la quota della proprietà di `conguaglio.ts` (esportata come `instalmentOwnerShare`).
- `pnpm excel --proprietari`: stesso caricamento (`loadExcelInput`), stessa scrittura senza
  sovrascrittura; **`--uscita` obbligatorio** finché manca la domanda 2. Uscita JSON senza nomi,
  importi né percorsi.

## Domande per user1

Non le decido io: finché manca la risposta il punto resta fuori (o com'è indicato).

1. **Stati «importo diverso» e «pagamento duplicato» (sezione 12).** Il modello non ha una regola
   che li riconosca: R2 tiene in attesa una rata con un addebito diverso finché non si corregge o si
   abbina a mano; un abbinamento a mano di importo diverso oggi risulta «pagata», con Addebito atteso
   e Addebitato diversi nelle due colonne. Esempio: atteso 198,00 €, abbinato a mano 196,00 € → oggi
   «pagata». Vuoi «importo diverso» quando Addebitato ≠ Addebito atteso? E «duplicato»: due addebiti
   per la stessa rata, o lo stesso addebito su due rate? Fino alla risposta: nessuno dei due stati.
   **Risposta di user1: «importo diverso» quando Addebitato ≠ Addebito atteso; nessun «duplicato».**
2. **Nome e cartella del file.** La sezione 20 dice «Riservato_proprietari/ … Excel dei proprietari
   per annualità», senza il percorso esatto. Proposta:
   `Riservato_proprietari/Excel/<Appartamento>/<periodo>/Proprietari_<Appartamento>_<periodo>.xlsx`.
   Fino alla risposta `--uscita` è obbligatorio.
   **Risposta di user1: sì, quel percorso** (caratteri sicuri); `--uscita` vale ancora.
3. **Banca e saldo tra conti (sezione 20)** e IMU/F24 (sezione 23): vanno nel file dei proprietari,
   e con quali colonne? Fino alla risposta: fuori.
   **Risposta di user1: fuori.**
4. **TARI** nel file dei proprietari? R3 parla della nota TARI «nel file della proprietà», la
   sezione 20 elenca solo condominio, banca e saldo. Se sì: con l'avviso intero o la quota
   dell'appartamento, e con la nota (che oggi manca di dati, lacuna 1 del piano 5)? Fino alla
   risposta: fuori.
   **Risposta di user1: fuori.**
5. **Riga «provvisorio»** in cima anche a questo file, come nell'Excel degli inquilini (risposta
   5)? Fino alla risposta: no.
   **Risposta di user1: sì, con lo stesso criterio** (sempre, finché non c'è la chiusura; N = rate
   in attesa o con importo diverso).
6. **Quale periodo.** Oggi il file segue il periodo di conguaglio (per il 3+2 l'intero contratto),
   non l'esercizio del condominio. Va bene, o preferisci un file per esercizio condominiale?
   **Risposta di user1: il periodo di conguaglio, com'è.**
7. **(Dalla revisione.) Rate a cavallo di due periodi.** Una rata che copre mesi di due annualità
   (per esempio luglio-ottobre con annualità da ottobre) compare intera nei file di tutte e due,
   così la somma dei totali di due anni conta due volte la rata (300,00 € in ciascuno). Va bene
   (il file è un elenco di rate da pagare), o la rata va in un solo file, o divisa per mesi?
   **Risposta di user1: intera in tutti e due i file, com'è.**

## Mie scelte (da controllare)

1. Stesso criterio di scelta delle rate del foglio Bollette (R153), senza escludere straordinarie e
   voci in attesa.
2. «Addebitato» e «Data addebito» solo dagli addebiti veri: una voce assunta non ha importo
   addebitato (lo dice lo Stato).
3. Ordine: `coversFrom`, poi `id`.

## Test (solo fixture sintetiche)

Sulla fixture `anno-esempio` (rata 1 con quota della proprietà e conguaglio dell'anno prima) più
varianti: straordinaria, rata in attesa, rata assunta, rata con `rata` 0; colonne e totali; nessun
nome di inquilino nel file; stessi byte con l'ingresso mescolato e nei due `TZ`; riga di comando con
`--proprietari` (scrive, non sovrascrive, `--uscita` obbligatorio, uscita senza dati personali).

## Cosa resta fuori

Domande 1-6; interfaccia; versioni in `_app/excel_versioni/`.
