# Fixture

Qui stanno solo dati anonimizzati o inventati: nomi, codici cliente, POD/PDR, IBAN e codici
fiscali reali non entrano mai nel repository (specifica, sezione 28). I file Excel, CSV, PDF e
JPG sono esclusi da `.gitignore` ovunque tranne in questa cartella, e `pnpm data:check` cerca
nei file tracciati stringhe che somigliano a dati personali e fallisce se ne trova.

## Fixture dorate (`golden/`)

Un file per appartamento e annualità conclusa (`<appartamento>-<annualità>.json`), costruito dagli
Excel reali e anonimizzato con `tools/anonymise.py` (Task 7 del piano 1). Contiene appartamento,
contratto, periodo, bollette, rate, versamenti, movimenti, abbinamenti, inquilini e i valori
attesi del conguaglio per inquilino: `due`, `forfaitIncassato` e le spese per tipologia
(`byCategory`), più le quote dei mesi senza inquilini, alla proprietà (`expectedUnassigned`; prima del piano 21 i posti vuoti).

- I valori `expected` non sono «quello che dice l'Excel» ma quello che user1 ha controllato e
  approvato (`approvedBy`); ogni differenza dall'Excel sta in `knownDeviations` con il motivo.
- Il condominio è escluso da `expected` per costruzione (sezione 42 della specifica, R3).
- Gli inquilini sono `ten-a`, `ten-b`, …; nomi, codici delle bollette e link ai file non ci sono.
- `byCategory` elenca solo le tipologie con un importo: una tipologia senza spese non compare.
- `excel` (facoltativo) riporta per inquilino e tipologia quanto addebita l'Excel, per il rapporto
  delle differenze (`pnpm golden:report`).
- L'ordine dei posti per i resti di centesimo è `apartment.rooms`.
- Le regole che producono i valori sono in `docs/rules/conguaglio-rules.md`.
- `packages/core/test/golden-fixtures.test.ts` controlla schemi, assenza di dati personali e
  coerenza interna; il calcolo del conguaglio (Task 9) deve riprodurre i valori attesi.

| File                 | Annualità | Note                                                     |
| -------------------- | --------- | -------------------------------------------------------- |
| `app-a-2024-25.json` | 2024-25   | 5 posti, 12 inquilini, nessun estratto: bollette assunte |

## Codici d'esempio fittizi

Sono gli unici codici con forma di IBAN, codice fiscale, POD, PDR o codice di registrazione che
`pnpm data:check` accetta nei file tracciati. Sono inventati o presi dagli esempi pubblici della
documentazione; non appartengono a nessuna persona o utenza. Per ammetterne un altro, aggiungerlo
qui tra apici inversi, con una nota: la revisione deve verificare che sia davvero inventato.

| Tipo                                | Codice                              |
| ----------------------------------- | ----------------------------------- |
| IBAN (esempio pubblico)             | `IT60 X054 2811 1010 0000 0123 456` |
| IBAN di prova (inventato)           | `IT52A9999999999000000000001`       |
| IBAN di prova (inventato)           | `IT29B9999999999000000000002`       |
| IBAN di prova (inventato)           | `IT85X0542811101000000000301`       |
| IBAN di prova (inventato)           | `IT58X0542811101000000000302`       |
| IBAN di prova (inventato)           | `IT09X0542811101000000000311`       |
| IBAN di prova (inventato)           | `IT79X0542811101000000000312`       |
| IBAN di prova (inventato)           | `IT52X0542811101000000000313`       |
| IBAN di prova (inventato)           | `IT04X0542811101000000000401`       |
| Codice fiscale (esempio)            | `RSSMRA80A01H501U`                  |
| POD                                 | `IT001E12345678`                    |
| PDR                                 | `12345678901234`                    |
| Codice di registrazione RLI         | `TXX24T123456000AA`                 |
| Codice di registrazione (inventato) | `CODICE-PROVA-0001`                 |
| Codice di registrazione (inventato) | `CODICE-PROVA-0002`                 |

## Come si usano

Nelle fixture e nei test si scrivono questi codici così come sono. Per un caso che richiede un
codice diverso (per esempio due POD distinti) si costruisce il valore a partire da questi, e se
serve nei file tracciati lo si dichiara nella tabella sopra.

## PDF e profili dei fornitori (piano 2a)

- `fixtures/pdf/`: estratti di testo di bollette reali (Task 12 del piano 2a), ridotti al minimo che
  serve a un profilo e anonimizzati: nomi, vie, codici, IBAN, e-mail, telefoni e link tolti, numero
  di fattura e impronta del file inventati. Restano importi e date della bolletta. Nessun PDF reale
  entra mai nel repository, nemmeno anonimizzato; i PDF sintetici dei test li genera uno script
  (`python/tests/make_sample.py`), con testi e importi inventati.
- `python/seed-profiles/` (fuori da `fixtures/`): profili dei fornitori (`SupplierProfile`) che
  riconoscono per parole chiave, senza codici cliente, POD, PDR o indirizzi; quelli dell'utente
  stanno nei suoi dati, in `_app/dati/supplierProfile/`.

## Conti ed estratti (piano 3a)

- `fixtures/bank/profilo-sintetico.json`: profilo della banca **ipotetico** (colonne, formati ed
  espressioni inventati, nessuna banca reale), per provare lo schema `BankProfile`. Gli IBAN dei
  test sono inventati con il controllo mod-97 valido (per esempio `IT60X0542811101000000123456`).

## Uscite e giroconti (piano 3c)

- `IT04X0542811101000000000401` è l'IBAN di un fornitore inventato: nei test del piano 3c è la
  controparte di uscite e rimborsi, mai un conto proprio.
- `fixtures/reconcile/tre-conti.json`: tre conti inventati (Appartamento A, Appartamento B, Appartamento C, con gli IBAN di
  prova `…0301`, `…0302` e `IT52A…0001` della tabella sopra), gennaio-marzo 2027. Due estratti di
  Appartamento A con un buco a febbraio (la bolletta di febbraio è da verificare, B1), bollette con una nota di
  credito, una rata condominiale con il suo doppione escluso, due inquilini inventati (gli IBAN
  `…0311` e `…0312`), un giroconto tra Appartamento B e Appartamento A e uscite verso il fornitore inventato
  `…0401`. `records` sono i record per tipo. La leggono `packages/core/test/reconcile.test.ts` e
  `scripts/estratti.test.mjs`.

## Incassi (piano 3b)

- `fixtures/income/anno-sintetico.json`: un anno inventato (2026) su due conti di due appartamenti,
  quattro inquilini con nomi inventati e un genitore che paga per due figli dallo stesso IBAN (due
  `payer` con la stessa chiave). `records` sono i record per tipo, `expected` gli automatici della
  prima riconciliazione, le conferme (una per pagante) e gli automatici e le proposte dopo. Gli IBAN
  sono quelli di prova `…0301`-`…0313` della tabella sopra (costruiti con `ibanEndingWith`). La
  legge `packages/core/test/income-year.test.ts`.

## Excel dei conguagli (piano 5)

- `fixtures/excel/anno-esempio.json`: l'annualità 2026-27 inventata dell'appartamento Nord (4 posti,
  `apt-nord`) con Sud (`apt-sud`) per la TARI comune: luce a cavallo, internet con commissione, gas
  da verificare (B1), acqua in attesa, condominio con parte della proprietà e conguaglio dell'anno prima, un
  posto vuoto per tre mesi, un cambio di inquilino nello stesso posto, canoni, un conguaglio versato
  e uno restituito, una caparra restituita. Inquilini con nomi inventati («Anna Prova», …), nessun
  IBAN. La leggono `packages/core/test/helpers/excel-fixture.ts` e i test dell'Excel.

## Contratti (piano 7)

- `fixtures/contracts/due-appartamenti.json`: Appartamento A e Appartamento B inventati, sei inquilini con nomi
  inventati, cinque presenze a Appartamento A (quella di Elena Fittizia da 2025-09, prima del contratto) e
  la caparra di Franco Immaginario, che non ha presenze; nessun contratto: li scrivono i comandi
  `contratto` e `contratto-canone` nel test della riga di comando. I codici di registrazione
  `CODICE-PROVA-0001` e `CODICE-PROVA-0002` sono inventati; importi e aliquota sono inventati.
