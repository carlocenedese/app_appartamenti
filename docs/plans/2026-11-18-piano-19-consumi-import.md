# Piano 19: consumi nell'importazione e nel cruscotto (piano)

Disegno: `2026-11-18-piano-19-consumi-import-disegno.md`. Ogni task: test che falliscono, codice,
`pnpm lint`, `pnpm typecheck`, `pnpm test`, commit.

1. **Core, importazione.** `ProposalContext.thresholds.consumptionAnomalyPercent` e
   `ImportBillInput.thresholds` facoltativi (vecchio controllo solo se dati). `importBill` confronta
   la bolletta proposta con le soglie dell'appartamento: `consumption` nel risultato, `warn`
   `consumption-alarm` con un livello. Test in `bill-import.test.ts`, `proposal.test.ts`.
2. **Core, cruscotto.** `ApartmentDashboard.consumptionThresholds`, conteggi `consumi:giallo` e
   `consumi:rosso`. Test in `dashboard.test.ts`.
3. **Riga di comando.** `bolletta` senza `--soglia-consumi` obbligatoria, con `consumption`
   (dettagli solo con `--dettagli`); `cruscotto` con lo stato delle soglie, il periodo in corso e i
   conteggi nuovi. Test in `scripts/estratti.test.mjs`.
4. **Registro.** R330 e seguenti, domande in `docs/progress.md`.
