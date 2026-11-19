# Piano 25: regole decise da user1 il 18 e 19 novembre 2026

Ramo `feat/regole-decise`, da `refactor/logica-nel-core` (PR #82). La logica nuova va in
`packages/core/src/commands/` e nei moduli del core; `scripts/estratti.mjs` legge solo le opzioni e
stampa (R386). I testi `message` sono quelli della riga di comando (R387). Rulings da R388.

## Che cosa cambia lo schema dei dati

`DATA_FORMAT` resta 5 e nessuno schema cambia in questo piano: ogni punto che lo richiede si ferma
e va nelle domande per user1.

| Punto | Schema | Perché |
| --- | --- | --- |
| 1. B5, canone versato in più | no | l'eccedenza si calcola dai pagamenti; la conferma divide un pagamento in due (`pay-<movimento>-…`) |
| 2. F7, esercizio «2026» | no | `esercizio` è già un testo libero |
| 3a. presenza senza fine | no | calcolo alla lettura, dai contratti collegati |
| 3b. esclusione «privato» | **sì** | `excludeReason` è un elenco chiuso in `movementClass.json` |
| 3c. PDF dell'avviso TARI | **sì** | `Instalment` non ha `filePath` e nessun record conserva il nome originale del file |
| 4. F12, POD e PDR sull'utenza | **sì** | `supply.json` non ha codici |
| 5. H5, nota dello scambio | no | `Note.targetType` ammette già `contract` |
| 6. conferma in blocco di un anno | **sì** | «da verificare» è calcolato, mai salvato; un abbinamento vuole un movimento (`transactionId`) e `by: 'assumed'` non conta per scelta (B1) |

## Ordine dei commit

1. Questo piano.
2. H5: `recordRoomSwap` scrive nella stessa operazione `tenancy.swap` una nota (`Note`, privata)
   sul contratto dello scambio; la richiesta ripetuta (`unchanged`, ricollegamento) non ne scrive
   un'altra; l'annullo la toglie con il resto.
3. F7: `esercizioRange` in `period.ts` legge `2026-27` e `2026`; tutti i lettori dell'esercizio
   (conguaglio, Excel, file dei proprietari, golden, `rata-condominio`) passano di lì;
   `rata-condominio` accetta `2026`. Resta una forma per appartamento (R310).
4. 3a: `withContractEnds(tenancies, contracts)`: una presenza senza fine finisce con il contratto
   collegato; applicata solo dove si legge per calcolare (`loadExcelInput`, incassi e arretrati),
   mai dove si scrive.
5. B5: `rentExcesses` (puro) trova il mese con più canone del dovuto e propone il primo mese
   precedente che manca; `riconcilia` lo mostra; `eccedenza-canone` lo conferma
   (`income.excess`, annullabile con `annulla-riconciliazione`). Rifiutarla non scrive nulla.
6. Specifica §42 e registro (R388 e seguenti).

Dopo ogni commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Alla fine anche i due fusi orari,
`CLOSING_MODEL_SEEDS=500` e `node scripts/check-personal-data.mjs`.
