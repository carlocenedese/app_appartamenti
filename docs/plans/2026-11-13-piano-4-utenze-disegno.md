# Piano 4: utenze condivise e appartamento nuovo (disegno)

Stato: **approvato da user1 il 13 novembre 2026**, comprese le «Mie scelte». Specifica di riferimento: `docs/spec.md` (sezioni 22, 29, 30, 42 R3). Dipende da R80 (record `supply`) e dai controlli di `proposalFromExtraction`.

## Perché

Una bolletta con un'utenza che l'app non conosce (un nuovo appartamento, o una TARI condivisa tra più appartamenti) oggi si ferma con `unknown-part` e non c'è nessun posto, nell'app, dove dire a chi appartiene. user1 vuole poterlo fare da «Da rivedere» (decisione del 13 novembre 2026), con l'appartamento già suggerito e con una nota scritta a mano che spieghi perché la ripartizione è quella.

## Obiettivi

1. In «Da rivedere», nel documento con `unknown-part`, un passo **«A chi appartiene l'utenza?»**: scegliere uno o più appartamenti, scrivere la percentuale di ciascuno, confermare. Alla conferma nasce il record `supply` e vale per gli avvisi successivi.
2. L'appartamento è **suggerito**, mai deciso dall'app (vedi «Suggerimento»).
3. Per ogni utenza la **somma delle percentuali è esattamente 100%**; con meno o più la conferma resta bloccata.
4. Una **nota libera** (scritta da user1) spiega il perché della ripartizione; è un record «nota» agganciato all'utenza, e se serve alla singola rata.
5. Una **vista per correggere i collegamenti** (scheda dell'appartamento e voce in Impostazioni) e messaggi chiari per `duplicate-supply` e `part-share`.
6. La procedura guidata «Aggiungi appartamento» (sezione 29, già decisa) resta com'è e **non** ha un passo per le utenze: i collegamenti nascono dal primo avviso.

## Non obiettivi

- Nessuna schermata per scrivere le utenze in anticipo (opzione 2 scartata).
- Nessuna percentuale o regola di ripartizione scritta nel codice: le scrive l'utente.
- Nessun collegamento automatico: anche con un suggerimento forte l'utente conferma.
- OCR e scansioni (piano 2b), perequative di altri layout (R81), condominio.

## Vincoli

- Percentuali in punti base interi (100,00% = 10000): nessun decimale in virgola mobile. Importi in centesimi interi; la suddivisione resta `splitCents` (resti maggiori, a parità ai primi), già approvata (R80).
- `packages/core` resta puro. L'interfaccia, i messaggi e le note sono in italiano; i nomi nel codice in inglese.
- Nessun dato personale nei log. Indirizzo e catasto di un immobile sono dati del documento: restano nel risultato di lettura e nell'appartamento, mai nei log né nelle fixture reali.
- Le note sono riservate ai proprietari (`visibleToTenants: false`).

## Approcci considerati

**Dove si collega l'utenza.** (1) Subito in «Da rivedere»: la via più corta, **scelta**. (2) Prima, nella scheda dell'appartamento: richiede i codici in anticipo, scartata. (3) Tutte e due: due schermate da mantenere, scartata.

**Dove sta la nota.** (A) Un campo di testo nell'utenza: semplice ma senza storia. (B) **Note vere** (record `note` già esistente) agganciate all'utenza e alla rata: autore, data, più note, **scelta** da user1. (C) Campo e note insieme: più campi per poco.

## Disegno

### Modello

- `SupplySchema.apartments[].weight` passa da intero ≥ 1 a **punti base interi 1…10000**, con la regola di record: la somma è esattamente 10000 (e ogni appartamento una volta, come oggi). Un'utenza di un solo appartamento vale 10000. La cartella dei dati e lo schema JSON si rigenerano. I record `supply` esistenti non ci sono ancora (nessuna app li scrive): nessuna migrazione.
- `NoteSchema.targetType` aggiunge `supply`. Le note sull'utenza si mostrano anche accanto alle rate nate da quell'utenza; una nota sulla rata (`instalment`) vale solo per quell'avviso.
- `splitCents` usa i punti base come pesi: nessun cambio al calcolo, solo ai test.

### Suggerimento dell'appartamento

Due fonti, mostrate con la loro origine; se discordano si propone quella dei dati della bolletta:

1. **Dati della bolletta (forte).** Per ogni utenza la TARI riporta l'immobile (via e numero civico, foglio, particella e subalterno). Il lettore Python va esteso per leggere, per ogni parte, anche l'immobile (campo in più nella parte, con un secondo pattern come `parts.add`); il core confronta con indirizzo e dati catastali dell'appartamento (salvati dalla procedura guidata). Confronto sul catasto per uguaglianza e sull'indirizzo per via più civico, senza maiuscole né punteggiatura.
2. **Conto della banca (debole).** Il conto da cui è partito l'addebito dell'avviso indica un appartamento; per un avviso condiviso paga un solo conto, quindi è solo un indizio e non basta per due appartamenti.

Etichette: «da indirizzo», «da catasto», «da conto». Se nessuna fonte è disponibile, l'elenco degli appartamenti è vuoto di suggerimenti e si sceglie a mano.

### Schermata «A chi appartiene l'utenza?»

Compare nella procedura «Documento n di N» quando c'è `unknown-part`, una volta per ogni utenza sconosciuta. Mostra l'etichetta dell'utenza, il PDF affiancato con l'immobile evidenziato e un elenco: appartamento (con il suggerimento già selezionato), percentuale, «+ Aggiungi appartamento» (un'altra riga), totale in tempo reale con messaggio «Il totale è 85%: manca il 15%» e il campo **Nota** facoltativo (testo libero) con avviso che resterà visibile accanto all'utenza. Un solo pulsante principale, «Collega e continua», attivo solo con totale 100%. Con un solo appartamento la percentuale è 100% e non si chiede.

### Correzione dei collegamenti

Scheda «Utenze» dell'appartamento (e la stessa lista in Impostazioni): per ogni utenza etichetta, appartamenti con percentuali, note. Si può cambiare un appartamento o una percentuale (stessa regola del 100%), annullare un collegamento (cancellazione logica, `deleted`), aggiungere una nota. Un cambio vale per gli avvisi futuri; le rate già registrate non cambiano.

### Messaggi dei controlli

- `unknown-part`: «L'utenza … non è collegata a un appartamento. Collegala qui sotto.»
- `duplicate-supply`: «Due utenze hanno la stessa etichetta. Apri Impostazioni, Utenze e correggi: finché ce ne sono due, nessuna delle due viene usata.»
- `part-share`: «La quota di un appartamento su questa utenza è zero: la percentuale è troppo piccola per questo importo. Controlla le percentuali.»
- Somma diversa da 100%: blocco con il messaggio del totale (sopra).

## Mie scelte (da controllare)

Dopo la lettura di un revisore indipendente, queste le decido io; user1 può correggerle.

1. **Campi dell'appartamento.** `ApartmentSchema` non ha indirizzo né catasto, e la procedura guidata non è ancora costruita. Questo piano aggiunge `address` (testo) e `cadastre` (elenco di foglio, particella, subalterno) come campi facoltativi, che si compilano in Impostazioni, Appartamenti anche per gli appartamenti esistenti. Senza questi dati non c'è suggerimento e si sceglie a mano.
2. **Il conto della banca resta fuori dalla prima versione.** L'appartamento non ha un conto e l'addebito di un avviso arriva dopo la conferma. user1 ha chiesto «dal CSV oppure dai dati della bolletta»: basta la seconda fonte. Il suggerimento dal conto si aggiunge quando il CSV è collegato (piano dei movimenti).
3. **Una modifica è atomica.** La vista di correzione cambia tutta l'utenza in una sola scrittura, quindi la somma resta sempre 10000; non esiste uno stato a metà. Fixture e test con pesi 1 e 2 si riscrivono in punti base.
4. **Proposte ormai vecchie.** Una proposta non si conserva: si ricalcola ogni volta che il documento si apre in «Da rivedere». Cancellare o cambiare un collegamento ha quindi effetto subito sui documenti ancora da rivedere (tornano a `unknown-part`) e mai sulle rate già registrate.
5. **Note e rate.** `Instalment` riceve un campo facoltativo `supplyId` (l'utenza da cui nasce), così le note dell'utenza si vedono accanto alle rate. `NoteSchema.targetType` aggiunge `supply`.
6. **Lettore Python.** L'immobile per parte si legge solo nella TARI condivisa (profili `acegas-tari-2024` e `-b`), con un secondo pattern nel profilo. Fixture sintetiche con indirizzo e catasto inventati, mai reali; cambiano anche i casi comuni di `python/tests/data/profile-cases.json`.
7. **Interfaccia.** L'app desktop è oggi una sola finestra Vite senza framework: queste sono le prime schermate, e la scelta del framework è del piano. Nel risultato di lettura ogni parte ha già `source.box` (pagina e riquadro): si evidenzia l'immobile se c'è il riquadro, altrimenti si mostra la pagina.
8. **Piccole.** Una percentuale sotto 1% non dà un avviso a parte: se la quota arrotonda a zero scatta già `part-share`. I due suggerimenti si mostrano per ogni appartamento con la loro origine; con due fonti discordi vale quella della bolletta.

## Da decidere nel piano (lascio al costruttore)

- Il formato esatto di indirizzo e catasto (testo normalizzato o campi separati) e il framework dell'interfaccia.
- Come si ordina l'elenco degli appartamenti suggeriti e come si mostra il PDF affiancato.
- I test di accettazione della schermata (comportamento, non pixel).

## Aperto con user1

Nessuna domanda aperta.
