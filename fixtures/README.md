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
(`byCategory`), più le quote dei posti vuoti (`expectedUnassigned`).

- I valori `expected` non sono «quello che dice l'Excel» ma quello che Carlo ha controllato e
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

| File                   | Annualità | Note                                                     |
| ---------------------- | --------- | -------------------------------------------------------- |
| `berchet-2024-25.json` | 2024-25   | 5 posti, 12 inquilini, nessun estratto: bollette assunte |

## Codici d'esempio fittizi

Sono gli unici codici con forma di IBAN, codice fiscale, POD, PDR o codice di registrazione che
`pnpm data:check` accetta nei file tracciati. Sono inventati o presi dagli esempi pubblici della
documentazione; non appartengono a nessuna persona o utenza. Per ammetterne un altro, aggiungerlo
qui tra apici inversi, con una nota: la revisione deve verificare che sia davvero inventato.

| Tipo                        | Codice                              |
| --------------------------- | ----------------------------------- |
| IBAN (esempio pubblico)     | `IT60 X054 2811 1010 0000 0123 456` |
| IBAN di prova (inventato)   | `IT52A9999999999000000000001`       |
| IBAN di prova (inventato)   | `IT29B9999999999000000000002`       |
| Codice fiscale (esempio)    | `RSSMRA80A01H501U`                  |
| POD                         | `IT001E12345678`                    |
| PDR                         | `12345678901234`                    |
| Codice di registrazione RLI | `TXX24T123456000AA`                 |

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
