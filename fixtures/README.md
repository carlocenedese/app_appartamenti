# Fixture

Qui stanno solo dati anonimizzati o inventati: nomi, codici cliente, POD/PDR, IBAN e codici
fiscali reali non entrano mai nel repository (specifica, sezione 28). I file Excel, CSV, PDF e
JPG sono esclusi da `.gitignore` ovunque tranne in questa cartella, e `pnpm data:check` cerca
nei file tracciati stringhe che somigliano a dati personali e fallisce se ne trova.

Le fixture dorate e gli strumenti di anonimizzazione arrivano con il Task 7 del piano 1.

## Codici d'esempio fittizi

Sono gli unici codici con forma di IBAN, codice fiscale, POD, PDR o codice di registrazione che
`pnpm data:check` accetta nei file tracciati. Sono inventati o presi dagli esempi pubblici della
documentazione; non appartengono a nessuna persona o utenza. Per ammetterne un altro, aggiungerlo
qui tra apici inversi, con una nota: la revisione deve verificare che sia davvero inventato.

| Tipo                        | Codice                              |
| --------------------------- | ----------------------------------- |
| IBAN (esempio pubblico)     | `IT60 X054 2811 1010 0000 0123 456` |
| Codice fiscale (esempio)    | `RSSMRA80A01H501U`                  |
| POD                         | `IT001E12345678`                    |
| PDR                         | `12345678901234`                    |
| Codice di registrazione RLI | `TXX24T123456000AA`                 |

## Come si usano

Nelle fixture e nei test si scrivono questi codici così come sono. Per un caso che richiede un
codice diverso (per esempio due POD distinti) si costruisce il valore a partire da questi, e se
serve nei file tracciati lo si dichiara nella tabella sopra.
