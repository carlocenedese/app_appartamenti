# Revisione del 18 novembre 2026: reperti «soldi sbagliati»

Stato: lavoro interrotto per limite d'uso, subito dopo la ricognizione. Nessun codice è cambiato.

## Fatto

- Letti i rapporti 2-e2e (E*), 3-regole (C*, I*, B*), 1-undo (U3) e le decisioni del proprietario.
- Individuata la correzione di E1, non ancora applicata. In `packages/core/src/proposal.ts`, nel ciclo
  che crea le rate TARI condivise, va aggiunto
  `paidFromApartmentId: ctx.apartment.id` a ogni rata con `apartmentId` diverso dall'appartamento
  dell'avviso. La prova del rapporto 2 la verifica su una copia della cartella.

## Manca (tutto)

E1, E2, E3, E6, E7, E8, E9, E10, C1, I1, I5, I10/B19, B17, U3, M1/E12 e i minori E13-E19. I 7 `it.fails` di
`scripts/ciclo-completo.test.mjs` restano come prima.

Note per chi riprende:

- **E1.** Cambia la forma del ciclo completo: la TARI si abbina già nella fase 4. Vanno quindi riscritti:
  - la fase 5;
  - i test «stato attuale» (oracolo senza TARI, saldi 5000+5000).
- **B17.** Prima di scrivere un rifiuto, va confrontato con la decisione del lotto 11 («canone confermato
  dopo l'uscita: SOLO AVVISO»).
- **E6.** `apartment-store.ts` è di un altro scrittore. Il controllo va messo nel comando `appartamento`
  di `scripts/estratti.mjs`, e il `RangeError` va catturato in `excel.mjs`.
- **E11.** Richiede `movements.ts`, che è di un altro scrittore: resta nell'arretrato.
