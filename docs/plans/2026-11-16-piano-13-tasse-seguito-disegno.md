# Piano 13: seguito di Tasse e stime (disegno)

Stato: **bozza** (16 novembre 2026). Piano: `docs/plans/2026-11-16-piano-13-tasse-seguito.md`.
Applica quattro risposte di user1 alle domande del piano 10 (disegno
`docs/plans/2026-11-16-piano-10-tasse-disegno.md`, R210-R217) e nient'altro. Solo core e riga di
comando, niente schermate; nessun dato reale (`user1`/`user2`, importi inventati).

## Risposte di user1 (16 novembre 2026)

1. **Contribuente = `Apartment.locatore`** (domanda 10): confermato, anche in comproprietà resta il
   `locatore`. Nessun cambio di codice: cade solo il «non deciso».
2. **TARI** (domanda 11): l'anno d'imposta è l'`esercizio` della rata; la riga TARI non ha più
   sempre `rule-undecided` e si calcola come le altre voci.
3. **IMU con il solo totale annuo** (domanda 12): il pagato si contabilizza così com'è, niente
   `imu-expected-missing` per una rata non pagata se c'è il totale annuo atteso; a fine anno si
   controlla che l'uscita dal conto coincida con il totale annuo atteso (in linea o discrepanza con
   la soglia già presente).
4. **Anno di riferimento delle scadenze** (domanda 3, prima parte): campo opzionale `taxYear`
   (intero) nella `payable`, scelto da user1 alla creazione (`scadenza-nuova --anno-riferimento`) e
   modificabile solo come gli altri campi (`savePayable` con `id`, una `rev` nuova). Un adattatore
   porta le scadenze `cedolare` e `registro` con l'anno nell'«ancora previsto» della tabella.

## Il modello

`Payable.taxYear`: intero 1-9999, facoltativo; `v: 1`, nessuna migrazione (assente = non scelto).
`savePayable` lo scrive come `expected`: un aggiornamento senza l'opzione lo toglie.
`repeatPayable` **non** lo copia né lo calcola (l'anno dopo sarebbe un anno calcolato): la nuova
voce lo riceve solo se user1 lo scrive (`scadenza-ripeti --anno-riferimento`).

## Ancora previsto di cedolare e registro

`payableExpectedItems({ payables, transactions, classes })` (`payables.ts`): per ogni `payable`
viva `cedolare` o `registro` **non pagata** (stessa prova di `scadenzario`: un movimento cancellato
o con classe `escluso` non prova il pagamento) una voce `{ apartmentId, voce, year?, amount? }` con
`year` = `taxYear` in `AAAA` e `amount` = `expected`. Nella tabella:

- con anno e importo: entra nell'ancora previsto dell'anno;
- con anno e senza importo: motivo nuovo `expected-amount-missing` nell'anno (mai uno zero muto);
- senza anno: motivo `no-expected-source` della voce in **ogni** anno del contribuente (non si sa a
  quale anno vada: nessuna regola per sceglierlo).

`loadTaxTable` passa sempre queste voci: senza scadenze l'ancora previsto è 0.

## TARI

Tolto `rule-undecided`: stima, pagato (abbinamenti veri delle rate con `esercizio` = anno),
ancora previsto (`expectedDebit` delle rate senza abbinamenti), differenza e stato come le altre
voci. Commissione fuori e nessun controllo d'importo restano come nel piano 10 (Ruling R241).

## IMU con il solo totale annuo

Per un gruppo dell'anno con soli totali annui (`ImuRate.annual`):

- ogni F24 contabilizzato conta nel pagato così com'è (niente `imu-to-check` per `importo-mancante`
  o `da-riconciliare`: lo stato della rata col 1% non si usa); un F24 non contabilizzato resta
  `imu-to-check` (R2);
- rata senza F24: nessun ancora previsto e nessun `imu-expected-missing`;
- **fine anno** = ogni rata del gruppo ha un F24 (`annual.paid`, come in `imu.ts`, senza
  orologio). Prima: motivo nuovo `imu-year-open` (da verificare, nessun confronto); dopo:
  `annualDifference` = somma di `annual.paid` − somma di `annual.expected` dei gruppi del
  contribuente, e la riga è `discrepanza` se |`annualDifference`| > `tolerance` (0,10 €) **oppure**
  |differenza con la stima| > `tolerance`.

## Domande per user1 (restano aperte)

Dal piano 10, ancora aperte: condominio (anno d'imposta e importo, domanda 1); soglia e discrepanza
confermabile (domanda 2); voce di `bollo` e `f24` (domanda 3, seconda parte); scadenze pagate a
mano nel pagato (domanda 4); contenuto dell'esportazione (domanda 5); rimborsi (domanda 6); avviso
di gennaio (domanda 7); F24 misto IMU e cedolare (domanda 8); TARI dell'appartamento come voce
(domanda 9). Nuove:

1. **IMU a fine anno:** letto «fine anno» come «ogni rata ha un F24» e «soglia» come gli 0,10 € della
   tabella (non l'1% di `imu.ts`); la riga è discrepanza se l'uscita non è il totale annuo **o** se
   pagato e stima differiscono. Va bene? Se una rata non si paga mai la riga resta `imu-year-open`.
2. **Scadenza senza anno di riferimento:** oggi dà `no-expected-source` in ogni anno: va bene, o
   basta l'anno della scadenza?
3. **TARI:** commissione bancaria fuori e pagato senza controllo d'importo, come ora?
