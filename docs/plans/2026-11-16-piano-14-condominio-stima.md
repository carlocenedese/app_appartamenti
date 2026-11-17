# Piano 14: stima del condominio e rubrica (implementazione)

Disegno: `docs/plans/2026-11-16-piano-14-condominio-stima-disegno.md`. Ramo
`feat/piano-14-condominio-stima`. Per ogni task: test che falliscono, codice, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, commit.

1. **Stima** (R250): `condoEstimate` in `condominio.ts`, `loadCondoEstimate` in `condo-store.ts`,
   comando `condominio-stima`; test puri (esercizio con documenti, copia dal più vicino, nessun
   documento, documenti cancellati e di altri appartamenti) e della riga di comando (importi solo con
   `--dettagli`).
2. **Record `contact`** (R251, R252): schema in `model.ts`, `recordSchemas`, `docs/schemas/contact.json`
   rigenerato, liste dei test aggiornate; `saveContact` e `loadContacts` in `contact-store.ts` con i
   rifiuti, `unchanged`, scrittura dopo `checkConsistency`.
3. **Riga di comando della rubrica** (R253): `contatto`, `contatti`, `contact.save` annullabile;
   nessun nome né contatto in uscita senza `--dettagli`.
4. Domande aperte in `docs/progress.md` (R254).
