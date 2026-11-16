# Piano 14: stima del condominio per gli anni senza dati e rubrica (disegno)

Stato: **bozza da approvare da user1** (16 novembre 2026). Piano di implementazione:
`docs/plans/2026-11-16-piano-14-condominio-stima.md`. Riferimenti: `docs/spec.md` sezione 34
(«Spese condominiali: per gli anni senza dati si estrapolano da quelli precedenti… mostra la fonte»),
sezione 32 (rubrica), sezione 42; disegno del piano 8 (non obiettivi: estrapolazione e rubrica),
R190-R198, R216. Solo core e riga di comando, niente schermate. Nomi e contatti inventati
(`user1`, «Amministratore Prova», `example.test`).

## Decisione già presa da user1

Per un esercizio senza documenti la stima del condominio è la **copia dell'anno precedente** (stessi
importi e voci), con la fonte esplicita («copiata dall'esercizio X»); appena esiste un preventivo o
un consuntivo dell'esercizio la stima è quello. La stima **non si scrive mai** come dato e non
sovrascrive nulla. Indicizzazioni, medie e variazioni percentuali **non** si fanno.

## 1. Stima (sola lettura)

`condoEstimate(documents, apartmentId, esercizio)` (`condominio.ts`, puro), sui documenti vivi
dell'appartamento:

- l'esercizio ha un documento: fonte `consuntivo` se c'è, altrimenti `preventivo`;
- altrimenti l'esercizio **precedente più vicino della stessa forma numerica** con un documento
  (`2026` da `2025`, `2026-27` da `2025-26`: il più grande strettamente minore), con la stessa scelta
  del documento: fonte `copiata`, con `fromEsercizio` e `fromKind`;
- nessun documento prima, una forma diversa o un esercizio non numerico: nessuna stima, nessuna
  conversione.

Restituisce `{ apartmentId, esercizio, source, fromEsercizio, fromKind, total, quotaConduttore?,
lines? }` con gli importi del documento così come sono. Non entra nella tabella delle tasse (la riga
condominio resta `rule-undecided`, R216), nel conguaglio, nelle scadenze né negli Excel: nessun
risultato attuale cambia. Calcolata a ogni lettura, si aggiorna da sola quando arriva il documento.

`loadCondoEstimate(store, { apartmentId, esercizio })` (`condo-store.ts`): `inconsistent-store`,
`unknown-apartment`, altrimenti `{ status: 'computed', estimate? }`. Riga di comando
`condominio-stima --appartamento --esercizio [--dettagli]`: fonte, esercizio e tipo d'origine sempre;
importi solo con `--dettagli` (R107).

## 2. Rubrica

Record nuovo **`contact`** (`_app/dati/contact/<id>.json`): `role` (`amministratore` | `fornitore`),
`name`, `phone?`, `email?`, `notes?` (testo libero, nessun controllo di formato), `apartmentIds`
(appartamenti collegati, anche nessuno per un fornitore comune), `supplyIds?` (utenze, record
`supply`, oggi solo gli avvisi comuni come la TARI), `categories?` (tipi di bolletta, `BillCategory`:
le bollette non hanno un `id` di utenza). `saveContact` crea o sostituisce tutto il record (come `contratto`: un campo omesso si
toglie) in un'operazione `contact.save` con riassunto costante senza nomi; rifiuti
`inconsistent-store`, `invalid-contact`, `unknown-apartment`, `unknown-supply`; stessa richiesta
`unchanged`. `loadContacts(store, { apartmentId?, role? })` in ordine di `id`. Non tocca movimenti:
si annulla con `annulla-riconciliazione` come `apartment.save`.

Riga di comando: `contatto --id --ruolo --nome [--telefono] [--email] [--note] [--appartamenti a,b]
[--utenze s1,s2] [--categorie gas,acqua]` → `{ status, contactId, operationId? }`; `contatti [--appartamento] [--ruolo]
[--dettagli]`: senza `--dettagli` solo `id`, ruolo, collegamenti e `phone`/`email`/`notes` come 0/1;
nome e contatti solo con `--dettagli`.

## Domande per user1

1. **Quale documento si copia** quando l'anno precedente ha preventivo e consuntivo: oggi il
   consuntivo (e così per l'esercizio stesso: il consuntivo prevale sul preventivo). Va bene?
2. **Più anni senza dati**: oggi si copia l'ultimo esercizio con un documento, anche di due o più anni
   prima, e la fonte lo dice. Va bene, o dopo un anno vuoto non si stima?
3. **Formati diversi di `esercizio`** nello stesso appartamento (`2026` e `2026-27`): oggi si copia
   solo dalla stessa forma numerica, mai tra forme diverse né da un testo come `abc`. Serve una
   conversione, o un formato fisso legato a `condominioStart`?
4. **Stima e tabella delle tasse**: la stima deve alimentare la riga «condominio quota proprietario»
   (oggi `rule-undecided`, R216 domanda 1)? E con quale quota (totale meno quota conduttore)?
5. **Un solo amministratore per appartamento**? Oggi non si controlla.
6. **«Spese» collegate** a un fornitore: oggi appartamenti, utenze (`supply`, solo avvisi comuni) e
   categorie di bolletta. Servono anche i profili dei fornitori, le rate o le scadenze?
7. **Cancellare un contatto**: oggi non c'è un comando (solo annullare la creazione).
