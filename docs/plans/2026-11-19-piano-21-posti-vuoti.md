# Piano 21: le spese si dividono tra gli inquilini presenti (19 novembre 2026)

Deciso da user1 il 19 novembre 2026; prevale sulla parte di R1 (sezione 42) che lasciava i posti vuoti alla proprietà.

## Regola

- In un mese con meno inquilini presenti che posti, le spese di quel mese si dividono tra gli inquilini presenti in quel mese; i posti vuoti non hanno quota. Vale per tutte le spese divise per posto: bollette (luce, gas, acqua, internet), TARI (avvisi propri e avviso comune), rate di condominio a carico degli inquilini, conguaglio condominiale dell'anno prima quando va agli inquilini, commissioni.
- Un mese senza nessun inquilino presente: le spese del mese restano alla proprietà, come oggi la quota dei posti vuoti.
- Vale per tutti i periodi, anche passati: si ricalcola tutto.
- Esempio: bolletta di 90,00 € di un mese, 3 posti, 2 inquilini presenti tutto il mese: 45,00 € ciascuno, 0 € alla proprietà (prima 30 / 30 / 30 alla proprietà).

## Cosa resta com'è

- La presenza resta a mesi interi (`Tenancy.from` e `to` sono mesi): chi è presente in un mese conta per tutto il mese. Il divisore passa dai posti agli inquilini presenti.
- La quota di un mese si divide in parti uguali; i centesimi che avanzano vanno ai primi inquilini presenti nell'ordine dei posti (`Apartment.rooms`), senza `rooms` in ordine di `tenantId`.
- La divisione della bolletta tra i mesi (in proporzione ai giorni, R340) non cambia: una bolletta a cavallo di un mese con inquilini e di un mese vuoto dà la quota del primo ai presenti e quella del secondo alla proprietà.
- Affitto, interessi sulla caparra, `condoDifferenceTo` (con `owner` il conguaglio dell'anno prima resta alla proprietà e non si divide), recuperi delle spese straordinarie e ogni altra regola.
- Campi `unassigned`, `unassignedByBucket`, `emptyBeds` dell'istantanea, riga «Posti vuoti (proprietà)» dell'Excel e codice `conguaglio:posti-vuoti` del cruscotto: restano e ora contano solo i mesi senza inquilini. Nessun cambio di schema, `DATA_FORMAT` resta 4, `CORE_VERSION` non sale (come R340).

## Passi

1. Test che falliscono in `packages/core/test/conguaglio.test.ts`: esempio dei 90 €, centesimi nell'ordine dei posti, mese senza inquilini, bolletta a cavallo di un mese pieno e di uno vuoto, somme invariate.
2. `calcConguaglio` (`share` in `conguaglio.ts`): divisore = inquilini presenti; nessuno presente → tutto a `unassigned`.
3. Test, valori d'oro, hash dell'Excel e resoconto delle differenze che si muovono; `pnpm golden:report`.
4. Specifica (sezione 42, R1 ed esempi; sezioni superate segnate), `docs/rules/conguaglio-rules.md`, `docs/progress.md` (Ruling).
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, controllo dei dati personali, test toccati con `TZ=Pacific/Auckland` e `TZ=America/Los_Angeles`, test del modello di chiusura con `CLOSING_MODEL_SEEDS=500`.

## Effetto sui periodi chiusi

Un periodo chiuso con la regola di prima e con posti vuoti mostra ora un conguaglio supplementare: i presenti devono la quota che prima andava alla proprietà (R5, anche chi è partito, dalla caparra se è ancora in mano). È la conseguenza di «vale anche per il passato»; domanda per user1 nel resoconto.
