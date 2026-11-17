# App Bollette: Piano 18, scambio di camera tra inquilini già presenti (disegno)

Bozza da approvare da user1. Caso particolare del subentro (piano 11, R220-R225, sezione 17 della
specifica). Richiesta di user1: «Dai la possibilità di un caso particolare di subentro che è lo scambio
camera tra inquilini già presenti. Unica cosa che cambia possibilmente è affitto versato.» Regole del
registro da **R310**.

## Cosa fa

Due inquilini presenti nello stesso appartamento e nello stesso contratto si scambiano i posti dal mese
`M`, in **una sola operazione** `tenancy.swap` (un solo annullo, come il subentro):

- le due presenze attuali finiscono al mese `M-1`;
- per ciascun inquilino comincia una presenza nuova dal mese `M` nel posto dell'altro, con lo stesso
  inquilino, lo stesso `to` (fine prevista) della propria presenza, lo stesso forfait e la stessa
  caparra attesa (`expectedDeposit` copiata: nessuna nuova caparra, `depositChecks` è per inquilino e
  appartamento e non cambia);
- le due presenze nuove entrano in `tenancyIds` del contratto; lo storico del canone del contratto e i
  subentri (`takeovers`) non cambiano.

Il conguaglio non ha bisogno di nulla di nuovo: un cambio di posto è già «una presenza che finisce un
mese e una che comincia il successivo» (`checkTenantOverlaps`); la quota per posto (`bedsIn`) segue il
posto di ciascun mese; mesi interi, il cambio vale dal mese `M`.

**Affitto versato.** Dal mese `M` ciascuno paga `--canone-a`/`--canone-b` se dati, altrimenti il
proprio affitto attuale. Se un canone non è dato e gli affitti delle due presenze sono diversi, l'esito
porta l'avviso `swap-rent-unchanged` (solo un avviso: l'app non decide quale canone vale). Lo storico
del canone del contratto è un importo unico per l'appartamento, senza ripartizione per posto: l'unico
dato per posto sono gli affitti delle due presenze.

**Identificativi.** La presenza nuova si chiama `<id della presenza vecchia>-<M>` (per esempio
`tcy-anna-2026-03`): deterministico, quindi la stessa richiesta dà `unchanged`. Un `id` derivato oltre
64 caratteri → `invalid-tenancy`; un `id` derivato che è già una presenza viva diversa →
`tenancy-exists`.

## Rifiuti (senza scrivere, in ordine)

`inconsistent-store`; `unknown-tenancy` (una presenza assente, cancellata o di un altro appartamento);
`same-tenant` (stessa presenza o stesso inquilino); `tenancy-exists` (un `id` derivato è già una
presenza viva: lo stesso scambio con altri importi o un'altra presenza); `no-room` (una presenza senza posto); `same-room`;
`invalid-tenancy` (`M` non successivo all'inizio di entrambe, una presenza non presente in `M`, `M` oltre
la fine del contratto, canone negativo, `id` derivato non valido); `no-contract` (una presenza non è in
esattamente un contratto vivo); `different-contract` (i due contratti sono diversi, domanda 2);
`beds-conflict` (con `code` e `month`, le quattro presenze insieme).

Annullamento: `annulla-riconciliazione` accetta `tenancy.swap`; `tenancyUndoBlockers` (piano 11) blocca
già un annullo che rimetterebbe due presenze nello stesso posto.

## Riga di comando

`scambio-camera --appartamento --presenza-a --presenza-b --mese [--canone-a <euro>] [--canone-b <euro>]`
→ `{ status, tenancyIds, operationId?, warnings? }`: solo `id` di presenze (come `subentro`) e codici;
nessun nome né importo.

## Domande per user1 (nessuna decisa nel codice)

1. **Mese del cambio a metà.** Oggi mesi interi: chi cambia camera il 15 conta tutto il mese nel posto
   nuovo (come il subentro, domanda 9 del piano 11). Va bene?
2. **Due contratti diversi.** Se i due inquilini hanno contratti separati nello stesso appartamento, lo
   scambio è rifiutato (`different-contract`). Va permesso (ciascuno resta nel proprio contratto)?
3. **Canone del posto nuovo.** Dal mese `M` ciascuno paga il canone che si indica, altrimenti il proprio
   vecchio canone con l'avviso. Deve prendere di regola il canone dell'altro (il canone «segue il
   posto»)? Serve una nuova voce nello storico del canone del contratto?
4. **Forfait.** Oggi ciascuno tiene il proprio forfait. Se i due forfait sono diversi, segue il posto o
   l'inquilino?
5. **Caparra.** Resta quella di ciascuno; se i canoni cambiano, la caparra va adeguata?
6. **Identificativi** derivati `<presenza>-<mese>`: va bene o preferisci scriverli tu (`--id-a`, `--id-b`)?
7. **Contratto e registrazione.** Lo scambio non tocca `takeovers` né la registrazione: serve una
   comunicazione all'Agenzia o un'annotazione nel contratto?
8. **Subentro già registrato.** Se una delle due presenze esce in un subentro già scritto, lo scambio è
   rifiutato (`pending-takeover`): il subentro andrebbe riscritto sulla presenza nuova. Va fatto?
