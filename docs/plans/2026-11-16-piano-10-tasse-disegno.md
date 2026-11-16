# Piano 10: Tasse e stime (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Il piano di implementazione è
`docs/plans/2026-11-16-piano-10-tasse.md`. Il piano copre il core (`packages/core`) e la riga di
comando (`pnpm estratti`, `pnpm excel`); **niente schermate**. Riferimenti: `docs/spec.md` sezioni
23, 24, 34 (con le decisioni del 6 e del 16 novembre), 38, 39 e 42 (R2, R3, che prevalgono);
`docs/progress.md` R133-R136 e R164-R166 (IMU), R157-R163 (contratti), R180-R183 (affitti
dell'anno e stima della cedolare), R190-R198 (condominio), R150-R156 e R184 (Excel e file dei
proprietari); la risposta 7 di user1 del 14 novembre 2026 («Tasse e stime: chiedere conferma per
discrepanze maggiori di 0,10 €»). Codice letto: `model.ts`, `imu.ts`, `contract.ts`,
`contract-store.ts`, `condominio.ts`, `match.ts`, `xlsx-write.ts`, `excel-owners.ts`,
`scripts/estratti.mjs`, `scripts/excel.mjs`; il piano 9 (`payables.ts`, PR #47, ora su `main`) per allineare i nomi. Nessun documento reale: `user1`/`user2`,
appartamenti, importi e codici inventati.

## Perché

La sezione 34 chiede una tabella per contribuente con, per voce, la stima di inizio anno, il
pagato finora, l'ancora previsto, la differenza e lo stato; l'avviso di gennaio sull'anno vuoto con
la proposta di copiare l'anno precedente; l'esportazione per il commercialista. Oggi ci sono i
pezzi da cui leggere (rate IMU con gli F24 assegnati, rate TARI e condominio con gli abbinamenti,
movimenti classificati «tasse», contratti, affitti dell'anno), ma nessun posto dove scrivere la
stima e nessun modo di dire a quale tassa e a quale anno va un F24 che non è IMU.

## Obiettivo

1. **Stima di inizio anno** come dato: un record per appartamento, anno e voce, con l'importo
   scritto da user1. Mai calcolata; la stima della cedolare di R182 si mostra **accanto**, come
   proposta, mai come importo.
2. **Assegnazione di un movimento «tasse» a cedolare o registro** con l'anno di imposta, in una o
   più parti (un F24 di giugno può pagare il saldo di un anno e l'acconto del successivo).
3. **Tabella per contribuente** (il contribuente è il `locatore` dell'appartamento, un dato): per
   ogni voce stima, pagato, ancora previsto, differenza = pagato + ancora previsto − stima e stato
   `in-linea`, `discrepanza`, `da-verificare` con i motivi.
4. **Avviso di gennaio** sugli appartamenti senza stime nell'anno e **copia dell'anno precedente**
   con un comando esplicito, mai da sola.
5. **Esportazione per il commercialista** in Excel (scrittore di `xlsx-write.ts`): immobili,
   contratti, canoni, in `Riservato_proprietari/Tasse/<anno>/`, mai sovrascritto.

## Non obiettivi

- Spese condominiali estrapolate per gli anni senza dati (voce a parte della sezione 34).
- Colori del cruscotto, interfaccia, elenco delle discrepanze con link (lo darà l'interfaccia: la
  tabella ha già lo stato per voce).
- Calcolo di qualunque imposta: nessuna aliquota nel codice (CLAUDE.md, sezione 34).
- Adattatore dalle scadenze del piano 9 a `expectedItems`: fatto nel piano 13 (R243) con l'anno
  di riferimento scelto da user1 (`Payable.taxYear`, R242).

## Decisioni già prese da user1

1. Dichiarazioni ed F24 li prepara il commercialista; l'app stima e confronta (sezioni 34, 38).
2. Gli importi delle tasse li inserisce l'utente voce per voce e anno per anno; nulla si calcola da
   solo; nessuna aliquota nell'app (sezione 34, decisione del 6 novembre).
3. Voci: cedolare secca, IMU, imposte di registro e proroghe, TARI, condominio quota proprietario;
   differenza = pagato + ancora previsto − stima; stati in linea, discrepanza, da verificare
   (sezione 34).
4. Il pagato arriva dal CSV (R2), l'ancora previsto da Scadenze e pagamenti (sezione 34).
5. Se un anno è vuoto, a gennaio l'app avvisa e **propone** di copiare l'anno precedente.
6. La cedolare si può solo stimare come proposta da confermare; la stima non vale mai come pagata
   (R182, sezione 34).
7. Le discrepanze sono solo avvisi, non bloccano nulla (sezione 34).
8. **Soglia: discrepanze maggiori di 0,10 €** (risposta 7 di user1, 14 novembre 2026).
9. Esportazione: dati di ogni immobile e contratto (codici, canoni, date, registrazioni) in Excel,
   in `Riservato_proprietari/Tasse/<anno>` (sezione 34).
10. IMU: rate e F24 come in R133-R136, R164-R166; un F24 IMU non separa gli immobili.

## Il modello

### Record `taxEstimate` (nuovo)

`_app/dati/taxEstimate/tax-<apartmentId>-<anno>-<voce>.json`: `apartmentId`, `year` (`AAAA`),
`voce` (`cedolare` | `imu` | `registro` | `tari` | `condominio`), `amount` (centesimi **≥ 0**: lo
zero dice «nessuna spesa prevista per questo appartamento», diverso da «non scritto»). Un record per
terna, come `rentYear` (R182).

### Record `taxPayment` (nuovo)

`_app/dati/taxPayment/taxp-<transactionId>.json`: `transactionId` e `parts` (almeno una) con
`voce` (`cedolare` | `registro`), `year` e `amount` > 0, nessuna coppia voce-anno ripetuta. La somma
delle parti è l'importo addebitato (R2: conta l'importo del CSV). Un record a parte e non un campo
di `MovementClass`: le scritture delle classificazioni (piano 3c) non lo toccano, e un'assegnazione
rimasta su un movimento che non è più «tasse» si vede nella tabella come `da-verificare`.

## La tabella

Per un anno, una tabella per ogni `locatore` distinto degli appartamenti vivi, con i suoi
appartamenti e cinque righe (una per voce). Per ogni riga:

- **Stima:** somma delle stime vive degli appartamenti del contribuente per quella voce e anno, solo
  se **ogni** appartamento ne ha una; altrimenti motivo `missing-estimate` e nessuna stima.
- **Pagato** (solo movimenti veri del CSV):
  - **IMU:** le rate IMU dell'anno (`imuRates`) dei gruppi fatti solo di appartamenti del
    contribuente: `paid` delle rate con un F24 assegnato. Rata `importo-mancante` o
    `da-riconciliare`: conta, con motivo `imu-to-check`. Gruppo con appartamenti di più
    contribuenti: fuori, motivo `imu-mixed-taxpayers` (l'F24 non separa gli immobili).
  - **TARI:** le rate `tari` vive degli appartamenti del contribuente con `esercizio` = anno:
    somma degli abbinamenti vivi, confermati, `part: 'amount'`, non `assumed`. Un abbinamento
    `assumed` (periodo senza estratto, R2) non conta e dà `assumed-payment`.
  - **Cedolare e registro:** le parti di quella voce e anno dei `taxPayment` vivi su un movimento
    vivo, contabilizzato, in uscita, classificato «tasse» (non IMU) per un appartamento del
    contribuente. Un'assegnazione su un movimento che non lo è più: fuori, `stale-assignment`.
  - **Condominio:** non deciso (domanda 1): nessun pagato, motivo `rule-undecided`.
- **Ancora previsto:**
  - **IMU:** l'atteso delle rate senza F24 (`attesa`); senza atteso motivo `imu-expected-missing`
    (con il solo totale annuo: piano 13, R244).
  - **TARI:** `expectedDebit` delle rate senza abbinamenti veri e senza `assumed`.
  - **Cedolare e registro:** dalle scadenze del piano 9 con l'anno di riferimento
    (`expectedItems`, adattatore del piano 13, R243); senza l'ingresso motivo
    `no-expected-source`.
  - **Condominio:** come il pagato, `rule-undecided`.
- **Movimenti «tasse» non assegnati:** un movimento vivo, contabilizzato, in uscita, classificato
  «tasse» per un appartamento del contribuente, con la data nell'anno, senza rata IMU e senza
  `taxPayment`, dà `unassigned-tax-movement` a cedolare, IMU e registro (potrebbe essere di una di
  queste).
- **Differenza** = pagato + ancora previsto − stima, solo senza motivi.
- **Stato:** `da-verificare` se c'è almeno un motivo; altrimenti `discrepanza` se
  |differenza| > soglia, `in-linea` se no. La soglia è un ingresso (`tolerance`); la riga di
  comando passa `TAX_DISCREPANCY_TOLERANCE` = 10 centesimi (decisione 8: «maggiori di 0,10 €», quindi
  0,10 € esatti sono in linea).
- **Proposta della cedolare** (solo sulla riga della cedolare): per ogni appartamento del
  contribuente con un `rentYear` dell'anno e un'aliquota (`loadRentYears`, R182), l'importo stimato,
  accanto; mai nella stima, nel pagato o nella differenza.

## Avviso di gennaio e copia

- `taxYearWarnings({ today, apartments, estimates })`: solo se il mese di `today` è gennaio, per
  ogni appartamento vivo senza stime vive nell'anno di `today`, `{ apartmentId, year,
  canCopy }` (`canCopy`: ha stime vive nell'anno prima). `tasse` lo mostra con l'orologio della
  riga di comando.
- `copyPreviousTaxYear(store, { year, apartmentId? })`: copia nell'anno le stime vive dell'anno
  prima (degli appartamenti indicati o di tutti), in una sola operazione `tax.copy`. Rifiuti senza
  scrivere: `inconsistent-store`, `bad-year`, `unknown-apartment`, `year-not-empty` (un appartamento
  ha già una stima viva nell'anno: non si sovrascrive mai nulla), `nothing-to-copy`.

## Esportazione per il commercialista

`buildTaxWorkbook({ apartments, contracts })` → tre fogli: `Immobili` (id, nome, locatore,
indirizzo, dati catastali), `Contratti` (appartamento, contratto, tipo, inizio, fine, durata,
firmato il, codice e data di registrazione, canone concordato, studenti, regime, aliquota della
cedolare come scritta nel contratto), `Canoni` (contratto, dal mese, canone, acconto). Tutti gli
appartamenti e contratti vivi (domanda 5). `taxFilePath(anno)` =
`Riservato_proprietari/Tasse/<anno>/Tasse_<anno>.xlsx`. `pnpm excel --tasse <anno> --cartella
<dir> [--uscita <file>]` con la scrittura di R156 e R176 (mai sopra un file esistente, nessun
collegamento seguito); l'uscita stampa solo stato, anno e numeri di fogli, appartamenti, contratti.

## Riga di comando

- `tasse-stima --appartamento --anno --voce --importo` (`importo` ≥ 0) → `setTaxEstimate`.
- `tasse-copia --anno [--appartamento]` → `copyPreviousTaxYear`.
- `tasse-assegna --movimento --parte <voce>:<AAAA>:<importo> [--parte …]` → `assignTaxPayment`.
- `tasse --anno [--dettagli]` → tabelle e avvisi. Senza `--dettagli` solo voce, stato, motivi e
  id degli appartamenti; importi, nome del contribuente e proposte solo con `--dettagli` (R107).
- Le tre scritture si annullano con `annulla-riconciliazione` (`tax.estimate`, `tax.copy`,
  `tax.assign`).

## Mie scelte (Ruling, da confermare)

1. Il contribuente è `Apartment.locatore` (senza spazi ai bordi, in NFC), anche in comproprietà:
   **confermato** da user1 il 16 novembre 2026 (piano 13, R240).
2. La tabella è per contribuente, quindi un F24 IMU di un gruppo fatto solo di appartamenti dello
   stesso contribuente non si ripartisce (la ripartizione di R164 serve al saldo tra conti).
3. Stima zero ammessa e diversa da «mancante».
4. TARI: anno = `esercizio` della rata, **deciso** da user1 (piano 13, R241); la riga si calcola
   come le altre. Commissione fuori e pagato senza controllo d'importo restano come prima.
5. IMU con il solo totale annuo: pagato così com'è e controllo sull'anno, **deciso** da user1
   (piano 13, R244). Un F24 IMU non contabilizzato non conta come pagato e dà `imu-to-check`.
6. Movimenti in entrata classificati «tasse» (rimborsi) ignorati e non assegnabili (domanda 6).
7. La copia prende solo l'anno prima; rilanciata quando le stime dell'anno sono esattamente le
   copie dà `unchanged`, altrimenti rifiuta se l'anno ha già una stima per un appartamento indicato.

## Domande per user1

1. **Condominio quota proprietario:** a quale anno di imposta va una rata di un esercizio a cavallo
   (`2026-27`): data dell'addebito, scadenza, mesi coperti? E il pagato è la quota proprietà della
   rata (`quotaProprieta / rateCount`) più le straordinarie, o tutto l'addebito? Fino alla
   risposta la riga ha solo la stima e `rule-undecided`.
2. **Soglia:** la decisione «conferma per discrepanze maggiori di 0,10 €» vale per questa tabella
   (letta così)? «Chiedere conferma» vuol dire che una discrepanza si può confermare (accettare) e
   smette di comparire? Oggi è solo uno stato.
3. **Voce di `bollo` e `f24`:** in quale voce della tabella vanno queste scadenze? (L'anno
   d'imposta di una scadenza è stato risolto: campo `taxYear` scelto da user1, piano 13.)
4. **Pagato dalle scadenze segnate pagate a mano** (piano 9, `paid` senza movimento): contano nel
   pagato (che oggi viene solo dal CSV)?
5. **Esportazione:** tutti i contratti o solo quelli con un mese nell'anno? Servono anche gli
   affitti dell'anno (`rentYear`), le stime o la tabella? «Resta nel registro» vuol dire che
   l'esportazione va scritta nel registro delle modifiche?
6. **Rimborsi** (movimenti in entrata classificati «tasse»): riducono il pagato di una voce?
7. **Avviso di gennaio:** solo a gennaio (letto così) o finché l'anno resta vuoto? Per
   appartamento (scelto) o per contribuente?
8. **F24 misto** (IMU e cedolare nello stesso F24): oggi un F24 assegnato a una rata IMU non si può
   assegnare a cedolare o registro (`imu-assigned`).
9. La TARI in tabella è quella dell'appartamento (gli inquilini la rimborsano col forfait): va
   bene così o la voce TARI della sezione 34 è un'altra cosa?

Le domande 10 (contribuente), 11 (anno della TARI) e 12 (IMU con il solo totale annuo) e la prima
parte della 3 hanno avuto risposta il 16 novembre 2026: piano 13, R240-R244. Il resto della 11
(commissione, controllo d'importo) è nella domanda 3 del piano 13.
