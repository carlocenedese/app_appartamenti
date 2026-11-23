# Primo avvio

Al primo avvio, Robin chiede la cartella del gruppo. Il gruppo è la cartella condivisa da chi gestisce gli appartamenti, per esempio user1 e user2. Ci sono due strade: crearne uno nuovo o unirsi a uno che esiste già.

**Oggi:** schermata dell'app.

## Creare un gruppo

Lo fa una persona sola, la prima volta. Robin si apre su questa schermata.

1. Nella cartella condivisa (per esempio in Dropbox), crea una cartella vuota, per esempio `App Bollette`.
2. In Robin scrivi **Nome del gruppo** e **Il tuo nome**.
3. Premi **Crea gruppo** e scegli la cartella vuota.

<!-- IMMAGINE: 01-primo-avvio/01-crea-gruppo.png | La schermata «Crea gruppo» con il nome del gruppo e il nome dell'utente -->

Robin scrive `_app/workspace.json` e i profili dei fornitori già pronti (quelli che servono a leggere le bollette), poi apre la cartella.

**Esempio.** user1 crea la cartella `App Bollette` in Dropbox, scrive «Appartamenti» come gruppo e «user1» come nome, preme **Crea gruppo** e sceglie la cartella.

Se la creazione si interrompe, riprova con la stessa cartella: il lavoro fatto non si perde.

## Unirsi a un gruppo

Lo fa chi entra in un gruppo già creato, su un altro computer.

1. Aspetta che la cartella condivisa sia sincronizzata sul tuo computer.
2. In Robin premi il collegamento **Unisciti a un gruppo**.
3. Premi **Scegli la cartella del gruppo** e scegli la cartella condivisa.
4. Nella schermata **Chi sei?** scegli il tuo nome tra gli utenti del gruppo, oppure **Nuovo utente** e scrivi il tuo nome.
5. Premi **Continua**.

<!-- IMMAGINE: 01-primo-avvio/02-unisciti.png | La schermata «Unisciti a un gruppo» -->
<!-- IMMAGINE: 01-primo-avvio/03-chi-sei.png | La schermata «Chi sei?» con l'elenco degli utenti -->

**Esempio.** user2 riceve da user1 la cartella `App Bollette` condivisa in Dropbox, la sceglie e indica «user2».

## Messaggi che puoi vedere

| Messaggio                                          | Cosa fare                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| La cartella scelta è troppo ampia                  | Hai scelto la cartella principale del disco o la tua cartella home. Scegline una dentro la cartella condivisa. |
| Questa cartella contiene già dei dati di un gruppo | Usa **Unisciti a un gruppo**, oppure scegli una cartella vuota per un gruppo nuovo.                            |
| Questa cartella non contiene un gruppo valido      | La cartella non ha `_app/workspace.json`: forse non è ancora sincronizzata, o è quella sbagliata.              |
| Aggiorna i dati della cartella                     | La cartella è di una versione precedente. Robin chiede il consenso prima di aggiornarla.                       |
