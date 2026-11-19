# Specifiche app gestione bollette (Mac e Windows)

*Documento vivo, revisione 36 (6 novembre 2026). Le sezioni 28-39 raccolgono le decisioni prese dopo la revisione 35 e prevalgono sulle sezioni precedenti dove sono in conflitto; la sezione 42 (7 novembre) prevale anche sulle sezioni 6, 11, 12, 16 e 32 per verifica col CSV e condominio, in particolare sulla Home con card per appartamento e sul pulsante "Aggiungi appartamento" in Home (sezioni 4 e 27). Il wireframe di riferimento è "Wireframe App Bollette", versione 26.*

## 1. Scopo

App desktop multipiattaforma (Mac e Windows) per organizzare le bollette e le spese condominiali di tre appartamenti (Appartamento A, Appartamento B, Appartamento C), estrarre i dati dai PDF e generare il foglio Excel con i conguagli per inquilino. L'app deve poter gestire anche nuovi appartamenti.

## 2. Utenti

- Utente principale: user1 e il fratello di user1, manager, abituato alle app ma senza competenze di programmazione.
- Requisito: tutto tramite interfaccia grafica, nessun file di configurazione, nessun codice, installazione a doppio clic, procedura guidata al primo avvio.
- Lingua dell'interfaccia: italiano o inglese, a scelta dell'utente nelle impostazioni (decisione del 5 novembre 2026), con termini semplici (Aggiungi inquilino / Add tenant, Nuovo fornitore / New supplier). Ogni utente sceglie la propria lingua; la scelta non cambia i dati né i documenti generati per gli inquilini, che hanno una lingua propria (vedi sezione 21).

## 3. Struttura delle cartelle esistenti

- Per ogni appartamento una cartella radice (ad esempio Appartamento B).
- Al suo interno la cartella Bollette, con una sottocartella per tipo di utenza (elettricità, acqua, gas e così via) contenente i PDF.
- L'app non possiede i file: li osserva. L'utente seleziona le cartelle e il percorso di salvataggio dell'Excel.
- Il tipo di utenza si deduce dal nome della sottocartella.

## 4. Navigazione e schermate

1. **Home**: cosa fare adesso. Pulsante "Rivedi (n)", al massimo sei cose da fare, filtro "Tutti | Per me", operazioni recenti con l'autore. Nessun pulsante "Aggiungi appartamento" (vedi sezione 29).
2. **Da rivedere**: un'unica casella con le schede Documenti e Movimenti (sezione 30).
3. **Appartamenti**: elenco degli appartamenti e unico pulsante "Aggiungi appartamento", che apre la procedura guidata. Ogni appartamento ha le schede Affitti e pagamenti, Bollette, Conguaglio, Inquilini, Condominio, Moduli, Excel, Storico.
4. **Banca e fisco**: Scadenze e pagamenti, Saldo tra conti, Tasse e stime.
5. **Impostazioni** in fondo alla barra laterale: cartelle, utenti e sincronizzazione, appartamenti e regole, cartelle condivise, fornitori e interessi, registro e backup, aggiornamenti.
6. **Selettori e ricerca** sempre in alto: appartamento e annualità, ricerca globale (Ctrl K). Il dettaglio è nella sezione 29.

## 5. Annualità

- L'annualità va dal 1 ottobre al 30 settembre (non anno solare).
- L'annualità corrente mostra le bollette di competenza; alla fine dell'anno si passa alla successiva, mantenendo lo storico di bollette ed Excel generati.
- Il passaggio non è automatico e silenzioso: esiste il pulsante Chiudi annualità, che congela i dati e genera l'Excel definitivo, perché le bollette di fine settembre arrivano spesso a ottobre o novembre.
- Una bolletta appartiene all'annualità in base al periodo di competenza, non alla data di arrivo.

## 6. Inquilini e conguagli

- Anagrafica inquilini per appartamento, con mese di ingresso e mese di uscita, per gestire cessioni e subentri nello stesso anno.
- La ripartizione tra inquilini è a **mesi interi**: ogni bolletta viene assegnata solo ai mesi di presenza di ciascun inquilino.
- Dal conguaglio si sottrae la quota forfettaria versata dall'inquilino, diversa per ogni appartamento (e conservata per annualità, perché può cambiare).
- Il foglio Excel ha la tabella dei dati delle bollette e, nel secondo foglio, la tabella Conguagli. Il formato esatto sarà definito con l'esempio fornito.

### Bollette a cavallo tra due annualità

- Una bolletta il cui periodo attraversa il 30 settembre viene duplicata e ripartita **a mesi interi** tra le due annualità (decisione del 4 novembre 2026: sempre mesi interi, mai giorni; superata per l'importo della bolletta, che dal 18 novembre 2026 si divide tra i mesi in proporzione ai giorni, sezione 42, R1).
- La bolletta originale resta un unico record con il suo PDF e il suo importo; le due quote sono collegate e si ricalcolano se l'originale viene corretto.
- Arrotondamento: la somma delle due quote deve coincidere con l'importo originale, quindi la seconda quota si calcola per differenza.
- Ogni quota riporta l'etichetta di bolletta a cavallo con rimando all'altra.

### Riapertura di annualità chiuse

- Se una bolletta modifica un'annualità già chiusa, l'app avvisa e mostra di quanto cambia il conguaglio di ciascun inquilino; la riapertura avviene solo con conferma.
- Ogni riapertura viene registrata in uno storico con data e motivo.
- L'Excel precedente viene conservato come versione, non sovrascritto.

## 7. Estrazione dei dati dai PDF

- Circa il 90% delle bollette è in PDF testuale; una piccola parte, soprattutto l'acqua, arriva come scansione e richiede OCR (ad esempio Tesseract). Le bollette da OCR vanno sempre in revisione manuale.
- I fornitori sono stabili ma devono poter cambiare: ogni fornitore è un **profilo di configurazione** (non codice) che indica come riconoscerlo e dove trovare importo, periodo, scadenza e consumo.
- Creazione dei profili solo con il mouse: l'utente carica un PDF di esempio, seleziona il testo da estrarre e l'app genera il profilo. Aggiungere un fornitore o una tipologia nuova non richiede modifiche al codice.

### Spese condominiali

- Trattate come tipo di documento a parte: PDF lungo con le spese di tutti i proprietari.
- L'app individua la quota dell'utente, poi applica una tabella di regole modificabile che divide ogni voce tra parte inquilini e parte proprietà.
- Nell'Excel finisce solo la parte inquilini; nella revisione l'utente vede entrambe le parti.

## 8. Architettura proposta

- Interfaccia web incorporata in un guscio desktop. Preferenza: **Tauri**, per installer leggero e consumi bassi, con Python come processo ausiliario per PDF (ad esempio pdfplumber), OCR ed Excel (ad esempio openpyxl). Alternativa: Electron, più pesante ma con comportamento identico su tutti i sistemi.
- Dati veri in tanti piccoli file JSON in una sottocartella dedicata (vedi sezione 9), non in un database unico. L'Excel è un'**esportazione generata** nel formato già in uso, non la fonte dei dati.
- Python va impacchettato dentro l'installer, così l'utente non installa nulla a parte l'app.
- Concetto centrale del modello dati: l'annualità, con data di inizio e fine.

## 9. Utenti multipli, sincronizzazione e condivisione

L'app sarà usata da più persone (user1 e suo fratello) e i dati devono restare sincronizzati. Ipotesi di lavoro: continuare a usare Dropbox, come oggi, evitando però un database unico condiviso.

- **Perché non un database unico su Dropbox**: se due persone modificano in contemporanea, o la sincronizzazione è in ritardo, Dropbox crea una copia in conflitto e si rischia di perdere dati. Il rischio è noto con SQLite.
- **Dati in piccoli file JSON**: un file per bolletta, per inquilino e per le regole. Dropbox gestisce bene molti file piccoli e un eventuale conflitto resta limitato a un solo record.
- **Sottocartella dedicata**: tutti i file JSON stanno in una sottocartella separata, così le cartelle delle bollette restano pulite e facili da navigare per una persona. L'utente non ha motivo di aprirla.
- **Blocco di cortesia**: quando l'app è aperta crea un file di blocco nella cartella condivisa; chi la apre per secondo la trova in sola lettura con un messaggio chiaro. È una protezione semplice per due persone che si coordinano.
- **Condivisione agli inquilini**: resta come oggi, l'Excel condiviso in sola lettura tramite la funzione di condivisione di Dropbox. Non è una soluzione approssimativa e non serve sostituirla.
- **Alternativa scartata per ora**: un database cloud ospitato (ad esempio Supabase) darebbe sincronizzazione in tempo reale e nessun conflitto, ma richiede internet e amministrazione, ed è sproporzionato per due utenti e tre appartamenti. Da riconsiderare se gli utenti aumentano.

## 10. Cruscotto di stato sulla Home

Ogni scheda appartamento nella Home mostra a colpo d'occhio se ci sono azioni da compiere.

- **Semaforo**: verde se tutto è a posto, giallo se c'è qualcosa da fare, rosso se c'è qualcosa di scaduto o non riconciliato.
- **Segnalazioni concrete**: poche righe con un numero e un clic che porta direttamente al problema. Esempi: bollette nuove da controllare, conguaglio da emettere, inquilino con pagamento in ritardo, bolletta attesa e non ancora arrivata, spesa condominiale senza addebito corrispondente.
- **Bollette attese**: l'app impara dallo storico la cadenza di ciascun fornitore (ad esempio bimestrale) e segnala quando manca una bolletta del periodo.
- **Saldo di cassa dell'appartamento**: entrate degli inquilini meno uscite pagate, ricavato dal conto dedicato.
- **Pagamenti degli inquilini**: sono registrati nell'Excel, che resta la fonte per questo dato. Il formato esatto verrà definito con l'esempio fornito.

## 11. Riconciliazione bancaria

L'app incrocia tre fonti: bollette, pagamenti degli inquilini e movimenti dell'estratto conto. Ogni appartamento ha un conto bancario dedicato, usato solo per le spese di quell'appartamento; l'abbinamento è quindi automatico per appartamento.

- **Importazione**: l'estratto conto viene scaricato dalla banca e salvato nella cartella degli estratti indicata nelle impostazioni dell'appartamento. La banca dei tre conti lo dà oggi in XLSX («Lista operazioni»), che l'app legge direttamente; legge anche i CSV (decisione del 14 novembre 2026).
- **Abbinamento bollette**: cerca un addebito con importo uguale, data compatibile e, quando presente, il nome del fornitore nella causale.
- **Abbinamento inquilini**: cerca un bonifico in entrata con il nome dell'inquilino e l'importo atteso (quota forfettaria o affitto).
- **Grado di certezza**: ogni abbinamento ha un livello di confidenza; quelli dubbi finiscono in una schermata di conferma, come per la revisione delle bollette.
- **Esiti mostrati**: bolletta pagata, bolletta senza addebito corrispondente, importo diverso dal previsto, inquilino in ritardo.
- **Sicurezza** (decisione del 14 novembre 2026): gli estratti conto non sono cifrati, perché user2 è cointestatario e ha già tutti gli accessi. I movimenti si salvano con i soli campi necessari (data, importo, causale, codice disposizione, controparte) in `_app/dati/transaction/` e il file originale in `Riservato_proprietari/`. La cartella `App Bollette` non si condivide con gli inquilini, che ricevono solo i link alle sottocartelle di tipologia (sezione 27).
- **Accesso**: il fratello di user1 è cointestatario dei conti e vede già tutti i movimenti, quindi non servono permessi diversi tra i due utenti.

## 12. Riconciliazione delle spese condominiali e foglio riservato

Funzione associata al singolo appartamento, non agli inquilini: serve a verificare che i proprietari abbiano pagato tutte le spese verso il condominio e l'amministrazione.

- **Cosa controlla**: spese condominiali ordinarie e spese straordinarie pagate dai proprietari, abbinate agli addebiti sul conto dell'appartamento.
- **Esiti**: spesa pagata, spesa senza addebito corrispondente, importo pagato diverso dal dovuto, pagamento duplicato.
- **Secondo foglio Excel riservato ai proprietari**: file separato dall'Excel dei conguagli, mai condiviso con gli inquilini, con l'elenco delle spese condominiali e il loro stato di pagamento. Dà la garanzia di non avere pendenze verso il condominio.
- **Rapporto con i conguagli**: nell'Excel degli inquilini finisce solo la parte di spesa a loro carico; il foglio riservato contiene invece l'intera spesa, comprese la quota della proprietà e le straordinarie.
- **Cruscotto**: le anomalie compaiono tra le segnalazioni della scheda dell'appartamento.

## 13. Estensibilità e moduli futuri

L'app è progettata a moduli, in modo che nuove funzioni si aggiungano senza rifare quelle esistenti.

- **Nucleo comune**: anagrafica degli appartamenti, annualità, movimenti bancari, categorie di spesa e regole di ripartizione.
- **Moduli**: bollette, conguagli, riconciliazione bancaria, spese condominiali. Ogni modulo porta le proprie schermate, le proprie regole e le proprie segnalazioni per il cruscotto, senza modificare gli altri.
- **Regole come dati**: le ripartizioni (tra inquilini e proprietà, tra appartamenti) sono tabelle modificabili e non codice, come i profili dei fornitori.
- **Più conti per appartamento**: il nucleo ammette più conti bancari per appartamento, oltre al conto dedicato alle spese.
- **Categorie di spesa**: ogni spesa ha una categoria; una categoria nuova (ad esempio le imposte) entra nel foglio riservato e nel cruscotto senza cambiare la struttura.

### Moduli rimandati (fuori dal perimetro iniziale)

- **Imposte**: user1 fornirà le informazioni sulle tasse, sul conto bancario usato per pagarle e sulle percentuali associate a ogni appartamento; l'app ridistribuirà le imposte tra gli appartamenti.
- **Indici di investimento**: rendimento lordo e netto, flusso di cassa, valore attuale netto, tasso interno di rendimento, tempo di recupero. Servono dati aggiuntivi per appartamento (prezzo e costi di acquisto, ristrutturazione, valore attuale, voci fisse annuali, eventuale mutuo), da raccogliere quando il modulo verrà attivato.

## 14. Questioni aperte e informazioni in arrivo

- Appartamento B: PDF di gas e Internet da dicembre 2025 a marzo 2026 mancanti (li scarica user1 dai portali); consuntivo condominiale 2025/26 non ancora arrivato.
- Da leggere ancora per i profili dei fornitori: PDF di Appartamento C (caldaia, Enel, gas, TARI e acqua in JPG, condominio ordinario e straordinario) e PDF di gas e Internet di Appartamento B.
- Alias pagante → inquilino da compilare insieme a user1 (pagano spesso genitori o terzi).
- Significato delle quote 380/280 nel foglio Affitti Versati di Appartamento A e della quota 30 € nel conguaglio.
- Regole fiscali (RLI per subentri e nuovi contratti, termini e imposte) da verificare su fonti ufficiali prima di indicarle nell'app.
- Decisione definitiva Tauri contro Electron, da confermare dopo un prototipo.

## 15. Decisioni confermate (4–5 novembre 2026)

- Ripartizione tra gli inquilini a mesi interi di presenza, anche per le bollette a cavallo tra due annualità; l'importo della bolletta si divide però tra i mesi in proporzione ai giorni (sezione 42, R1, decisione del 18 novembre 2026). Una bolletta si registra una sola volta e si ripartisce in automatico.
- Commissione bancaria : l'app legge l'importo reale dalla riga "Commissioni e spese" del CSV, legata all'addebito (sezione 42, R7); nessuna opzione per appartamento.
- ~~Divisore dei conguagli = numero di posti: Appartamento A: 5, Appartamento B: 4, Appartamento C: 4. È un parametro dell'appartamento, non una formula.~~ Superata dalla sezione 42, R1 (deciso da user1 il 19 novembre 2026): le spese di un mese si dividono tra gli inquilini presenti in quel mese; i posti restano un dato dell'appartamento (quanti inquilini possono stare insieme e l'ordine dei centesimi).
- Canone TV, tassa consortile Bachiglione e TARI sono a carico degli inquilini.
- TARI (corretta il 18 novembre 2026, decisione di user1): l'addebito di un avviso comune a due appartamenti si divide tra le utenze in proporzione ai totali per utenza indicati nell'avviso, con i centesimi che avanzano ai resti maggiori (sezione 42, R3). Dalle quote non si sottrae quanto già addebitato nell'anno per la stessa utenza. Esempio: secondo avviso di 250,00 €, totali dell'anno per utenza 200,00 € e 250,00 €: quote 111,11 € e 138,89 €.
- Condominio: agli inquilini si addebitano le quote del conduttore indicate dall'amministratore (manutenzione parti comuni, riscaldamento, consumo ripartitori, ascensore, scale, acqua). Restano al proprietario "Generali proprietà" (assicurazione, amministrazione, adempimenti fiscali, spese postali, cancelleria, spese bancarie, straordinarie impreviste), "Proprietà appartamenti", spese personali, saldi degli esercizi precedenti e saldi straordinari. Si parte dal preventivo e si corregge a consuntivo. L'art. 4 del contratto non si considera.
- Una bolletta senza codice riceve un identificativo interno.
- L'Excel condiviso con gli inquilini mostra anche il dettaglio delle bollette.
- Il conguaglio si calcola con un bottone, sempre aggiornato; si può attivare il ricalcolo ricorrente (per esempio ogni tre mesi). Stati: calcolato, inviato (con data di invio), saldato (riconosciuto dal CSV, anche a rate).

### Conferma alla prima volta (apprendimento supervisionato)

- Documento nuovo o non riconosciuto (fornitore mai visto, layout cambiato, tipo diverso come una cartella esattoriale): l'app non importa da sola. Mostra il PDF accanto ai campi estratti e chiede conferma di tipo, appartamento, fornitore, importi e periodo.
- Una volta confermato, il layout diventa un profilo con versione e data di inizio validità. I documenti successivi con lo stesso layout si importano da soli e finiscono in un elenco "importate automaticamente" da controllare a colpo d'occhio.
- Un layout che cambia (come l'Enel, cambiato tre volte) conta come nuova versione e chiede di nuovo conferma.
- Per i documenti non ripartibili l'app chiede cosa farne: bolletta da ripartire, spesa del proprietario, da ignorare.
- Bonifici: il primo movimento di un pagante o di una causale mai visti non si abbina da solo. L'app propone l'inquilino più probabile (nome nella causale, importo atteso, mese) e user1 conferma, indicando anche a cosa serve (affitto e forfait, conguaglio, caparra, altro). La coppia pagante → inquilino viene salvata con data di inizio validità e applicata ai bonifici successivi.
- Ogni conferma resta nello storico delle modifiche e si può annullare.

### Piattaforma

- Il fratello di user1 usa Windows: la versione Windows ha priorità per prove e installer. L'ambiente di sviluppo non è Windows, quindi le prove su Windows passano da build automatiche e da una prova reale sul suo computer.
- Installer Windows non firmato mostra un avviso di SmartScreen: da decidere se acquistare un certificato di firma.

### Principi di usabilità

- Nessun manuale: ogni schermata dice cosa fare dopo, con un solo pulsante principale evidente.
- Linguaggio semplice, senza termini tecnici; messaggi di errore che spiegano come rimediare.
- Riferimenti di stile: Revolut, Notion, Handy, Duolingo (chiaro, amichevole, centrato sull'utente). Nessuna preferenza grafica specifica; la veste grafica si rifinisce dopo che i flussi funzionano.
- Stato sempre visibile con colori e frasi (semafori), non con numeri da interpretare.
- Ogni azione importante chiede conferma e si può annullare.

## 16. Regole per appartamento

| Parametro | Appartamento A | Appartamento B | Appartamento C |
| --- | --- | --- | --- |
| Locatore | user1 | user1 | user2 (adempimenti fiscali a suo nome) |
| Posti (divisore fino al 19 novembre 2026, poi sezione 42, R1) | 5 | 4 | 4 |
| Forfait mensile a persona | 30 € | 40 € | 30 € |
| Annualità | 1 ottobre – 30 settembre | conguagli a richiesta; condominio 1 maggio – 30 aprile | conguagli a richiesta |
| Condominio | preventivo meno "Generali Proprietà" | quote conduttore del bilancio Facciolati | riparto inquilini fornito dall'amministratore, con rate e scadenze |
| TARI | utenza propria nell'avviso Appartamento A + Appartamento B | utenza propria nell'avviso Appartamento A + Appartamento B | avviso proprio, in immagine JPG |
| Commissione 0,80 € | non applicata dal 2025/26 | non applicata da metà 2025 | applicata |
| Enel | bimestrale | mensile | bimestrale |
| Gas | assente nella cartella 2024-25 | mensile | mensile |
| Acqua | foto/scansioni | PDF, più cartella Bachiglione | JPEG |

## 17. Subentro e uscita di un inquilino

1. Si registrano uscita ed entrata con il mese e la camera.
2. Il bottone calcola il conguaglio provvisorio dell'inquilino uscente fino al mese di uscita.
3. L'app calcola la caparra da restituire: caparra, più interessi legali per anno, meno conguaglio, meno eventuali addebiti extra (per esempio la zanzariera a Appartamento C).
4. L'app prepara il prospetto per l'inquilino, con il dettaglio delle bollette.
5. user1 inserisce la data di invio; da quel giorno parte il controllo sul CSV.
6. L'app riconosce il bonifico di restituzione della caparra e i versamenti del conguaglio, anche a rate.
7. Per il nuovo inquilino si impostano forfait, caparra attesa e alias dei paganti.
8. L'app ricorda gli adempimenti fiscali del subentro. Termini e imposte vanno verificati su fonti ufficiali; non sono ancora stati verificati.

## 18. Riconciliazione bancaria: cosa emerge dagli estratti reali

- Formato (Intesa): data, operazione, dettagli con causale, conto, categoria della banca, importo. Un file per conto.
- Chi paga spesso non è l'inquilino (genitori, terzi): serve una tabella di alias pagante → inquilino che l'app propone e user1 conferma.
- Le categorie della banca non sono affidabili: lo stesso bonifico è "Affitti incassati" o "Bonifici ricevuti".
- I conguagli possono arrivare a rate ("Prima rata conguaglio").
- Movimenti da ignorare o classificare come spese del proprietario: F24, rata del mutuo, imposta di bollo, SUNIA, commissioni.
- Gli addebiti diretti (Hera, Enel, Fastweb) coincidono con le bollette: l'app segna la bolletta come pagata e segnala le differenze.

## 19. Errori degli Excel attuali da non replicare

| Problema | Dove | Regola dell'app |
| --- | --- | --- |
| Intervalli SUM scritti a mano | tutti gli appartamenti | allocazione automatica per mese |
| Divisore 5 con 4 inquilini | Appartamento B, foglio Conguagli | ~~divisore = posti dell'appartamento~~ superata: divisore = inquilini presenti nel mese (sezione 42, R1, 19 novembre 2026) |
| Regole condominiali diverse da un anno all'altro | Appartamento B | regola unica (sezione 15) |
| Importo preso dal bilancio di un altro anno | Appartamento B, riga 17 | l'importo viene dal PDF e dal suo esercizio |
| Link al PDF sbagliato | Appartamento B, N17 | il PDF è collegato al record in automatico |
| TARI "rata 1" duplicata, bolletta senza data | Appartamento C | controllo duplicati e date mancanti |
| Somma totale con intervallo troncato | Appartamento C, versione di maggio 2025 | totali calcolati sempre su tutte le righe |
| Competenza scritta a mano nelle note | Appartamento C | competenza ricavata dal periodo e dai mesi di presenza |
| Stessa fattura registrata due volte con pro quota 0,5 | Appartamento A 2025/26 | un record, due quote collegate |

## 20. Cartelle, smistamento e registro delle modifiche

```text
App Bollette/                     (cartella condivisa tra user1 e user2)
  Appartamento A/
    Da_smistare/                  qui si inseriscono le bollette di questo appartamento
    Contratti/<inquilino>/        contratti, moduli, caparra, registrazioni, subentri, attestazioni
    2025-26/                      una cartella per ogni annualità
      Elettricita/  Gas/  Acqua/  Internet/  Rifiuti/  Condominio/  Altro/
      Excel/                      Excel dell'annualità per gli inquilini
    2026-27/ ...
  Appartamento B/                       stessa struttura, con la sua Da_smistare
  Appartamento C/                          stessa struttura, con la sua Da_smistare
  Riservato_proprietari/          Estratti_conto/<appartamento>/<annualità>/ (non cifrati), Excel dei proprietari per annualità
  _app/                           dati, configurazione, registro; non toccare
    dati/  config/  journal/  excel_versioni/  CHANGELOG.md
```

- Ogni appartamento ha la sua cartella Da\_smistare (decisione del 5 novembre 2026). L'app controlla comunque che il documento sia davvero di quell'appartamento (indirizzo, intestatario, codici cliente, POD/PDR) e, se non torna, chiede prima di spostarlo. La TARI di Appartamento A e Appartamento B, un solo PDF per due appartamenti, si inserisce in una delle due cartelle e viene copiata nell'altra.
- Smistamento: ogni file viene letto, classificato (con la conferma alla prima volta), spostato e rinominato. Se non riesce a leggerlo, resta nella cartella di ingresso con la scritta "serve aiuto". I duplicati si riconoscono dall'impronta del file.
- Nomi dei file: `AAAA-MM-GG_Tipo_Fornitore_Periodo.pdf` con la data di emissione, per esempio `2026-04-13_Elettricita_Hera_2026-03.pdf`. Niente accenti né caratteri vietati su Windows, nomi brevi (limite di lunghezza dei percorsi su Windows), suffisso numerico se due nomi coincidono. Il nome originale resta nel record.
- Struttura per annualità (decisione del 5 novembre 2026): dentro ogni appartamento c'è una cartella per ogni annualità, e dentro l'annualità una sottocartella per ogni tipologia (elettricità, gas, acqua, internet, rifiuti, condominio, altro) e la cartella Excel. Le cartelle Da\_smistare e Contratti stanno a livello di appartamento, perché l'annualità di un documento si conosce solo dopo averlo letto. L'app assegna il file all'annualità dai mesi del periodo. Una bolletta a cavallo tra due annualità viene salvata in una copia per ciascuna annualità, e il calcolo resta a mesi interi. Excel: due file per annualità e appartamento, quello per gli inquilini nella cartella Excel dell'annualità e quello dei proprietari (condominio, banca, saldo tra conti) in Riservato\_proprietari.
- Registro delle modifiche, ispirato ai messaggi di commit di GitHub: ogni operazione scrive un file piccolo in `journal/` (data e ora, utente, riassunto, elenco di file aggiunti, spostati o rinominati, righe dell'Excel cambiate, conguagli prima e dopo, motivo). `CHANGELOG.md` è generato da quei file, in ordine cronologico, leggibile da chiunque. Un file per operazione evita i conflitti di Dropbox quando due persone lavorano insieme.
- Non si usa Git vero: le cartelle .git dentro Dropbox si corrompono facilmente. Ogni generazione dell'Excel viene salvata in `excel_versioni/`, e l'app mostra la differenza rispetto alla versione precedente.
- Le vecchie cartelle (per esempio 07.Bollette 24-25 e 08.Bollette 25-26) si importano una sola volta per copia; gli originali non vengono toccati.
- Da verificare: che Dropbox consenta di creare un link di sola visualizzazione per una sottocartella (per esempio 2025-26/Elettricita) di una cartella già condivisa tra i proprietari. Gli inquilini ricevono solo i link alle sottocartelle di tipologia; la cartella Condivisa\_inquilini non esiste più.

## 21. Funzioni aggiuntive (decisione del 5 novembre 2026)

- **Scadenziario.** Una vista unica con fine contratti e preavvisi di disdetta, registrazioni e proroghe RLI, annualità dell'imposta di registro (se non in cedolare), IMU, TARI, rate condominiali, restituzione dei depositi. Promemoria in app con colori (in ritardo, entro 30 giorni, più avanti). Da verificare sulle fonti ufficiali: termini e codici tributo RLI prima di inserirli come regole.
- **Messaggi pronti agli inquilini.** Bozza di email o WhatsApp per conguagli, solleciti, comunicazioni di subentro e restituzione del deposito, con importo, scadenza, IBAN e dettaglio delle bollette. Lingua scelta per inquilino (italiano o inglese, campo nella scheda dell'inquilino). L'app prepara il testo; l'invio resta un'azione confermata da una persona, e la data di invio avvia il controllo sul CSV bancario.
- **Export per la dichiarazione.** Riepilogo annuale per appartamento e per proprietario (Appartamento C intestato a user2): canoni incassati, spese a carico del proprietario, imposte pagate, utile per il quadro RB, in un Excel pensato per il commercialista. Le spese a carico degli inquilini e i conguagli sono tenuti separati. Regime fiscale e importi da verificare con un professionista.
- **Lingua dell'app.** Italiano o inglese, scelta per utente nelle impostazioni. Tutti i testi dell'interfaccia stanno in file di traduzione separati dal codice, così si possono aggiungere altre lingue senza modificare l'app. Date, importi e separatori seguono la lingua scelta.
- **Allarme consumi anomali.** Quando importa una bolletta, l'app la confronta con le precedenti dello stesso appartamento e fornitore (stesso periodo dell'anno prima, e media degli ultimi mesi) e segnala in giallo o rosso se consumo, importo o prezzo unitario sono molto diversi, per esempio una perdita d'acqua, un contatore sbagliato o una lettura stimata. L'avviso compare sulla Home e nella schermata di conferma della bolletta, con il confronto a fianco. Soglie di default semplici, modificabili per appartamento; l'utente può segnare un avviso come "va bene così" e l'app lo ricorda. Serve almeno un anno di storico: si parte dalle bollette importate dalle vecchie cartelle.

## 22. Flusso di importazione di una bolletta (approvato il 5 novembre 2026)

1. **Arrivo.** L'app osserva la cartella `Da_smistare` di ogni appartamento; si può anche trascinare un file nella finestra. Attende la fine della sincronizzazione di Dropbox, calcola l'impronta (hash) del file e segnala i duplicati senza registrarli due volte.
2. **Lettura.** PDF con testo letto direttamente; scansioni e foto con OCR. Se l'OCR non è affidabile il campo resta vuoto e da compilare a mano: nessun valore inventato.
3. **Riconoscimento.** Tipo e fornitore dal profilo (parole chiave, codice cliente, POD/PDR, indirizzo di fornitura) e verifica dell'appartamento. Esiti: riconosciuta, da confermare (nuovo fornitore, layout cambiato, campi mancanti), non riconosciuta (per esempio una cartella esattoriale).
4. **Controlli automatici.** Numero fattura già presente; totale uguale alla somma delle voci; periodo coerente con le permanenze; importo e consumo confrontati con lo storico (allarme consumi anomali).
5. **Conferma.** PDF a sinistra, dati letti a destra; verde = sicuro, giallo = dubbio, rosso = mancante; un solo pulsante "Confermo". Alla prima conferma di un layout nasce il profilo del fornitore, con data di inizio validità.
6. **Spostamento e nome.** File in `Bollette/<Tipo>/<anno di emissione>/` con nome `AAAA-MM-GG_Tipo_Fornitore_Periodo.pdf`; nome originale conservato nel record.
7. **Registrazione.** Record del documento e della spesa, divisione a mesi interi tra gli inquilini presenti, riga nel registro con collegamento al PDF, voce nel registro delle modifiche. Il conguaglio dell'appartamento passa a "da aggiornare"; non viene ricalcolato né inviato da solo.
8. **Annullamento.** Ogni importazione si può annullare: il file torna in `Da_smistare`, la riga sparisce, resta una voce nel registro.

**Casi speciali:** TARI di Appartamento A e Appartamento B (un PDF, due appartamenti: divisa per utenza e copiata nell'altra cartella); bolletta senza codice (identificativo interno); condominio (colonne del conduttore, preventivo poi consuntivo); PDF con più documenti (l'app propone di separarli e chiede conferma).

**Politica di conferma (scelta a, 5 novembre 2026).** Dopo la prima conferma di un layout, le bollette successive dello stesso fornitore che superano tutti i controlli vengono registrate automaticamente e mostrate come "registrata automaticamente", con pulsante Annulla. L'app chiede conferma solo se un controllo fallisce o il layout cambia. L'impostazione può essere cambiata per singolo fornitore (conferma sempre).

## 23. Scadenze e pagamenti: imposte e spese del proprietario (5 novembre 2026)

Lo Scadenziario diventa "Scadenze e pagamenti" e include una schermata per imposte e spese a carico dei proprietari. Il controllo del pagamento sul CSV della banca è una funzione prevista (finora la riconciliazione copriva solo gli incassi degli inquilini).

- **Voci gestibili:** IMU, imposta di registro e bollo, cedolare secca, TARI pagata al Comune, rate condominiali (dal piano rate del preventivo), F24 in generale. Ogni voce ha appartamento, intestatario (Appartamento C a user2), scadenza, importo atteso, stato (da pagare, in scadenza, pagata, in ritardo) e, se c'è, ricevuta allegata. Le voci ricorrenti si ripetono ogni anno. L'app tiene traccia dei pagamenti e non compila l'F24.
- **Imposta di registro:** tutti i contratti sono a canone concordato. Secondo user1 l'imposta di registro si applica solo al subentro o alla firma di un nuovo contratto, e per il subentro l'importo è di 67 euro. Verificato sul sito dell'Agenzia delle Entrate: cessione o subentro senza corrispettivo = imposta fissa di 67 euro, termine 30 giorni, tramite servizi telematici o F24 Elementi identificativi (con comunicazione all'ufficio se si usa l'F24). Da verificare: registrazione di un nuovo contratto (importo, termini). La scheda degli appartamenti indica la cedolare secca per tutti e tre i contratti (canone concordato e cedolare secca sono due cose distinte); con la cedolare non sono dovuti imposta di registro né bollo sul canone. Per cessione e subentro l'imposta fissa di 67 euro è dovuta (confermato da user1 il 5 novembre 2026) e, in caso di cessione, viene detratta dalla caparra restituita all'inquilino uscente: l'app la inserisce tra le detrazioni nel passo 3 del subentro.
- **Controllo sul CSV:** dopo la scadenza l'app cerca nei movimenti in uscita un pagamento compatibile (importo, data vicina, causale F24, IMU, condominio). La prima volta chiede conferma e salva la regola; poi segna "pagata" da sola, con Annulla. Se non trova nulla la voce resta in rosso sulla Home e nello Scadenziario. Si può anche segnare "pagata" a mano con la ricevuta.
- **Conti (chiarito il 14 novembre 2026):** IMU, F24 e rate condominiali escono dai tre conti degli appartamenti, tutti della stessa banca; non ci sono altri conti da importare.

## 24. Compensazioni tra conti (5 novembre 2026)

Ogni appartamento ha il suo conto. Alcune spese vengono pagate dal conto di un appartamento ma riguardano anche un altro: per esempio le rate condominiali o altre spese di Appartamento B addebitate sul conto di Appartamento A, e la TARI di Appartamento A e Appartamento B che arriva su Appartamento A.

- **Voce "Saldo tra conti"** (nella schermata Banca e sulla Home): per ogni coppia di conti mostra quanto un conto deve restituire all'altro, per esempio "Appartamento B deve a Appartamento A X euro", con l'elenco delle spese che lo compongono (data, descrizione, quota, documento collegato).
- **Come si calcola:** ogni spesa o pagamento ha un appartamento di destinazione per voce. La quota di un altro appartamento si prende dalle righe del documento (TARI per utenza, F24 per immobile, rate condominiali per unità) e non da una percentuale fissa. Se una voce non ha un destinatario chiaro l'app chiede conferma e ricorda la scelta.
- **Quando si chiude:** quando nel CSV compare un bonifico tra i due conti (giroconto), l'app lo abbina e riduce il saldo; si può anche registrare una restituzione a mano. Un saldo non azzerato resta visibile sulla Home.
- **Scopo:** verificare che ogni conto contenga l'importo corretto, e vedere in qualsiasi momento da dove nasce una differenza.

## 25. Storico e annualità per appartamento (5 novembre 2026)

- **Annualità per appartamento:** ogni appartamento ha le sue annualità, con date di inizio e fine proprie (impostate nelle regole dell'appartamento). Non esiste un'unica annualità valida per tutti: la Home mostra per ciascun appartamento quella in corso.
- **Selettore di annualità:** in alto nella scheda appartamento, per cambiare annualità (corrente, precedenti). Cambia bollette, conguagli, condominio, pagamenti e scadenze mostrati. Ogni appartamento ricorda la propria scelta, quindi si può guardare Appartamento A 2024-25 e Appartamento B 2025-26 insieme.
- **Schermata Storico:** per appartamento, una linea del tempo di tutte le annualità con totali (spese, acconti, conguagli, incassi), stato (aperta, chiusa, da riaprire), inquilini presenti e collegamenti ai documenti. Si possono confrontare due annualità fianco a fianco.
- **Annualità chiuse:** in sola lettura. "Riapri" richiede conferma e viene scritto nel registro delle modifiche (vedi sezione 6, Riapertura di annualità chiuse).
- **Dati:** lo storico nasce dall'importazione delle vecchie cartelle (per esempio 07.Bollette 24-25 e 08.Bollette 25-26), e alimenta anche l'allarme consumi anomali.

## 26. Moduli e documenti generati dall'app (5 novembre 2026)

Dalla cartella "99.Modulistica aggiornata" di Appartamento A risultano gli stessi moduli per tutti e tre gli appartamenti. L'app li genera in Word (.docx) e PDF a partire dai dati che ha già e chiede solo quelli che mancano, nel momento giusto della procedura. Il modello in Word resta modificabile da voi; i segnaposto vengono sostituiti dall'app. Il file generato viene salvato nella cartella `Contratti` dell'appartamento, nella sottocartella dell'inquilino. Il documento firmato, rimesso in `Da_smistare`, viene riconosciuto e collegato all'inquilino.

| Modulo | Quando | Dati richiesti | Cosa suggerisce l'app |
| --- | --- | --- | --- |
| Cauzione e impegno (promessa di contratto) | Nuovo inquilino che ferma la camera, prima della firma | Nome, CF, numero e ente della carta d'identità, rilascio e scadenza, data entro cui firma il contratto, durata in mesi, decorrenza, canone mensile della camera, tipo (nuovo contratto oppure cessione e chi esce) | Locatore, appartamento, IBAN dell'appartamento, caparra (500 euro nel modello), scadenza del versamento a 2 giorni, forfait e divisione tra gli inquilini |
| Subentro e cauzione | Nuovo inquilino che prende il posto di uno uscente | Come sopra, più il codice identificativo del contratto registrato | Contratto registrato, durata residua, caparra, clausola dei 15 giorni per segnalare danni |
| Cauzione o conferma | Rinnovo: l'inquilino resta e la caparra precedente fa da garanzia | Canone mensile del nuovo anno, durata (12 mesi), data di decorrenza | Dati dell'inquilino, caparra già versata, data di scadenza del contratto in corso |
| Impegno canone | Rinnovo: impegno sul canone massimo della camera per l'anno dopo | Camera, canone massimo, periodo | Canone attuale, periodo del contratto, regola "spese escluse" |
| Comunicazione aumento prezzi | Rinnovo con canoni nuovi | Nuovo canone per camera | Vecchio canone per inquilina e testo del messaggio (italiano o inglese) |
| Conferma disdetta | Un inquilino esce prima della scadenza | Data di recesso, mezzo e data della disdetta, data di fine anticipata | Data di firma e di registrazione del contratto, numero del contratto, nome dell'inquilino |
| Restituzione cauzione e consegna chiavi | Uscita di un inquilino | Data di consegna delle chiavi e stato dei locali | Tabella calcolata: cauzione, interessi legali, quota bollette fino alla data di uscita (conguaglio provvisorio), quota adempimento successivo (imposta di registro), quota pulizia annuale, saldo da bonificare |
| Contratto di locazione per studenti | Nuovo contratto o proroga | Anagrafica di ciascun inquilino, corso di studi, durata, canone, acconto spese, deposito | Dati catastali, classe energetica, superficie, caratteristiche dell'alloggio, accordo territoriale, IBAN, cedolare secca, testo degli articoli |

**Scheda dell'inquilino (da completare nella procedura giusta).** Nome, luogo e data di nascita, codice fiscale, residenza, email e telefono, corso di studi, numero e ente della carta d'identità con rilascio e scadenza, garante (se c'è), camera, canone della camera, data di ingresso e di uscita prevista, pagatori abituali (per riconoscere i bonifici), lingua dei messaggi. Dati personali sensibili: restano nella parte riservata ai proprietari e non nella cartella condivisa con gli inquilini.

**Cosa fa l'app nelle procedure.**

- *Nuovo inquilino o subentro:* chiede i dati che mancano, prepara il modulo giusto con tutto compilato e lo segna come "da firmare". Quando nel CSV compare il versamento della caparra (500 euro entro 2 giorni), lo riconosce e ne salva la data, necessaria per gli interessi.
- *Disdetta:* prepara la conferma di disdetta con data di recesso e mezzo di comunicazione.
- *Uscita:* nel passo 3 del subentro compila la tabella del modulo di restituzione, con l'imposta fissa di 67 euro e la quota bollette dal conguaglio provvisorio, e propone il testo del bonifico.
- *Rinnovo:* prepara la comunicazione dei nuovi canoni per ogni camera, poi l'impegno sul canone o la conferma di cauzione.
- *Dopo la firma:* ricorda la registrazione o la comunicazione RLI, con le regole di cui alla sezione 23.

**Parametri per appartamento (non fissi nel modello).** Locatore (user1 per Appartamento A e Appartamento B, user2 per Appartamento C), indirizzo, IBAN, importo della caparra, numero di inquilini, canone per camera, forfait. Nei modelli attuali nome del locatore e IBAN sono quelli di Appartamento A.

**Da correggere nei modelli attuali.** Cauzione o conferma: la data "31.09" non esiste (settembre ha 30 giorni). Restituzione cauzione: "Vicolo Esempio 1" contro "Galleria Giovanni Esempio n1" negli altri moduli, un riferimento "Padova1" nel testo e un refuso ("eccezzion"). Contratto: nel modello v03 il locatore risulta residente all'estero, indirizzo non aggiornato. I testi giuridici non vengono cambiati dall'app: eventuali modifiche vanno concordate.

**Regole decise (5 novembre 2026).** (1) Caparra di 500 euro per tutti e tre gli appartamenti, per ogni inquilino. (2) Imposta fissa di 67 euro per la cessione: va tutta addebitata all'inquilino uscente (detratta dalla caparra da restituire); se nello stesso mese più inquilini cedono il contratto, i 67 euro si dividono in parti uguali tra gli inquilini che cedono in quel mese. (3) Quota pulizia annuale: non è un importo fisso, l'app la chiede ogni volta nel passo di restituzione, con 0 come valore proposto. (4) Si usano solo i dati e i moduli più recenti: i valori dei modelli datati (canoni di esempio, importi, date) non vengono riutilizzati e i dati dei contratti in corso vengono dalla scheda degli appartamenti.

**Esempi reali (subentro di agosto 2026 a Appartamento A).** Due moduli compilati e firmati: la promessa di contratto della nuova inquilina e la restituzione cauzione dell'inquilina uscente. Da qui emergono le regole seguenti, che l'app deve riprodurre.

- **Promessa di contratto:** tipo "adempimento successivo (cessione)" con il codice identificativo del contratto registrato di Appartamento A e il nome di chi esce; durata di 14 mesi dal 01/08/2026, cioè i mesi che restano fino alla fine del contratto (30/09/2027): l'app la calcola da sola; canone mensile della camera di 380 euro "comprensivo di quota forfettaria"; caparra di 500 euro sul conto di Appartamento A. Il prezzo della camera è quindi un valore per camera che include il forfait: risolve la domanda sulle quote "380/280" di Affitti Versati.
- **Restituzione cauzione:** 500,00 + interessi 8,83 − bollette 460,21 − quota adempimento successivo 33,50 − pulizia 0 = saldo 15,12 euro. I conti tornano. La quota di 33,50 euro è la metà di 67 euro: due inquilini hanno ceduto nello stesso mese, come previsto dalla regola di divisione.
- **Interessi:** 8,83 euro si ottengono con il tasso legale annuo applicato a mesi interi: 500 euro × 2% × 5/12 (agosto-dicembre 2025) + 500 euro × 1,6% × 7/12 (gennaio-luglio 2026). L'app usa lo stesso metodo con la tabella dei tassi per anno. Il tasso 2026 (1,6%) risulta da fonti che citano il decreto del MEF; i tassi di ogni anno vanno verificati sulle fonti ufficiali prima dell'uso.
- **Dati scritti a mano:** nella promessa firmata nome, codice fiscale e carta d'identità sono manoscritti su una scansione, dove l'OCR non è affidabile. L'app non li legge dalla scansione: li chiede e li conserva nella scheda, e usa la scansione solo come documento firmato.

**Da verificare negli esempi.** Nella restituzione la data delle bollette "fino al" è 02/10/2025, mentre l'uscita è del 31/07/2026: controllare se la data è un refuso. I campi "firmato in data" e "registrato il giorno" non distinguono il contratto originale dalla registrazione della cessione: l'app li terrà separati.

**Da chiarire.** Per i moduli di cui ho letto solo la versione datata (subentro, conferma disdetta, cauzione o conferma, impegno canone, contratto di locazione) serve l'indicazione della versione più recente da usare come base.

## 27. Decisioni dopo i primi wireframe (5 novembre 2026)

- **Appartamenti e nuovi appartamenti.** La voce "Appartamenti" nella barra laterale apre l'elenco con tutti gli appartamenti e il pulsante "Aggiungi appartamento" (procedura guidata: indirizzo e dati catastali, locatore e IBAN, regole, camere e inquilini, cartelle). Lo stesso pulsante è sulla Home (card tratteggiata) e in Impostazioni.
- **Scheda appartamento.** La prima cosa che si vede aprendo un appartamento è "Gli inquilini sono in regola?": matrice inquilino per mese (incassato, parziale, non incassato dopo il 5), caparre versate, stato del conguaglio, con dati dal CSV della banca e possibilità di registrare un pagamento a mano e di preparare un sollecito. La Home mostra su ogni card un riepilogo (per esempio "4 su 5 in regola") e tra le cose da fare un affitto non ricevuto. Storico, bollette, inquilini, condominio e contratti sono schede della stessa pagina.
- **Condivisione delle bollette con gli inquilini (decisione del 5 novembre 2026: solo link alle cartelle condivise).** Nella schermata di conferma una casella "Mostra questa bolletta agli inquilini" (proposta: sì per le bollette incluse nel conguaglio, no per contratti, rendiconti e documenti riservati). Le bollette condivise vengono copiate nella sottocartella di tipologia dell'annualità, dove arrivano i link, con il nome standard (data, tipo, fornitore, periodo). Nessun collegamento con l'interfaccia di Dropbox: i link sono quelli di condivisione delle sottocartelle, che i proprietari creano da Dropbox e incollano nell'app, in Impostazioni, nella tabella "Cartelle condivise" (una riga per appartamento, annualità e tipologia, con il suo link). Nell'Excel degli inquilini ogni bolletta riporta il nome del file, così si trova subito aprendo la cartella, e il link alla sottocartella corrispondente. Se manca il link per un appartamento o un'annualità, l'app lo chiede prima di generare l'Excel. Ogni appartamento ha la sua cartella condivisa, perché gli inquilini di un appartamento non vedano gli altri. Da verificare: che Dropbox consenta il link di condivisione di una sottocartella e le impostazioni di visibilità (solo visualizzazione).
- **Conguaglio: pagamenti a mano.** Per ogni inquilino colonne da pagare, versato (con l'origine: CSV o a mano), residuo e stato (saldato, parziale, da pagare). Pulsante "Registra pagamento a mano" per un versamento che l'app non ritrova nel CSV: inquilino, data, importo, nota; annullabile.
- **Conguaglio: messaggio.** Di default un solo messaggio per il gruppo, con importo di ciascuno e dettaglio delle bollette. Un interruttore, spento di default, crea invece un messaggio diverso per ogni inquilino, nella sua lingua. L'invio lo fa sempre una persona.
- **Conguaglio: dettaglio per tipologia.** Le bollette incluse sono raggruppate per tipologia (elettricità, gas, acqua, condominio, TARI) in blocchi apribili, con le singole bollette dentro.

## 28. Principi: tutto in locale

- Nessuna AI generativa e nessuna API di terzi: ogni funzione gira sul computer dell'utente. La lettura dei documenti usa pdfplumber e Tesseract con i profili dei fornitori (dati, non codice); l'abbinamento dei bonifici usa regole e fuzzy matching locale.
- L'unica chiamata di rete dell'app è il controllo degli aggiornamenti (sezione 37): non invia dati personali e si può disattivare. La sincronizzazione la fa solo Dropbox.
- La lettura dei documenti sta dietro un'interfaccia sostituibile, così in futuro si potrà aggiungere un modello locale come opzione senza cambiare il resto. Non è previsto in questa versione.
- Nella prima fase di sviluppo si misura la percentuale di bollette lette correttamente sui documenti reali. Un modello locale si valuta solo se il risultato è insufficiente.
- Un importo letto male è peggio di un campo vuoto: per questo ogni valore incerto passa da "Da rivedere" e nulla entra nei dati senza conferma.
- In sviluppo si usano solo fixture anonimizzate (nomi, codici cliente, POD/PDR, IBAN sostituiti). Le bollette reali non vengono date a Claude né a Claude Code.

## 29. Navigazione, selettori e schermate (sostituisce 4)

- **Barra laterale**: Home; Da rivedere (con contatore); Appartamenti; gruppo "Banca e fisco" (Scadenze e pagamenti, Saldo tra conti, Tasse e stime); Impostazioni in fondo.
- **Doppio selettore** in alto: appartamento e annualità. Le annualità offerte dipendono dall'appartamento scelto. Nelle viste globali "Tutti" e "In corso (ciascuno)". Condominio usa "Esercizio" (1 maggio-30 aprile).
- **Ricerca globale** (Ctrl K): appartamenti, inquilini, bollette, scadenze, movimenti, file.
- **Home**: pulsante "Rivedi (n)", al massimo quattro cose da fare, filtro "Tutti | Per me", operazioni recenti con l'autore. "Aggiungi appartamento" non è più in Home: c'è solo in Appartamenti e apre la procedura guidata (popup o pagina).
- **Scheda appartamento**: schede Affitti e pagamenti, Bollette, Conguaglio, Inquilini, Condominio, Moduli, Excel, Storico. "Avvia subentro" parte dalla scheda.
- **Subentro**: procedura a passi, uno per volta, con barra di avanzamento che mostra passi fatti e da fare.
- **Bollette**: solo l'annualità selezionata; le precedenti si consultano nello Storico. Escludere dal conguaglio, nascondere agli inquilini e spostare di annualità sono azioni nel dettaglio.
- **Excel**: ripartizioni, spese condominiali e annualità le calcola l'app. Una correzione si fa nell'app, con il motivo nel registro, e l'Excel si rigenera. Se un Excel è stato modificato a mano, prima di rigenerarlo l'app mostra le celle cambiate e chiede se tenerle o scartarle. Oggi gli Excel si correggono a mano.
- **Storico**: il grafico si sceglie con un controllo segmentato (per anno, per bimestre, nessuno); l'appartamento si sceglie dal selettore globale.
- **Layout stretto** (sotto 900 px): la barra laterale diventa un menu a burger che si apre sopra la pagina; i due selettori diventano un unico menu a tendina "Appartamento · annualità"; le schede e i filtri scorrono in orizzontale; stato di sincronizzazione e nome utente si riducono a icone.
- Interfaccia pronta per la traduzione (testi senza larghezze fisse) e accessibile (contrasto, focus, uso da tastiera, etichette).

## 30. Da rivedere e Scadenze

- **Un'unica casella "Da rivedere"** con due schede. **Documenti**: procedura "Documento n di N" con PDF affiancato e campo evidenziato, chip di confidenza (verde sicuro, giallo da controllare, rosso mancante), i campi da controllare in cima, barra di conferma sempre visibile. **Movimenti**: voci del CSV della banca non riconosciute, da contabilizzare o scartare, con anteprima dell'effetto e azioni di massa.
- **Apprendimento supervisionato**: dopo la prima conferma di un fornitore le bollette successive si registrano da sole, con possibilità di annullare. Un fornitore con layout cambiato torna in revisione. Segnalazione dei consumi anomali rispetto allo stesso periodo dell'anno precedente.
- **Scadenze e pagamenti**: una sola lista con filtri Stato (predefinito "Da fare"; anche Tutte, In ritardo, Entro 30 giorni, Programmate, Pagate di recente, Importo da inserire, Non nel CSV) e Tipo (IMU, imposta di registro, TARI, rate condominiali, altro). Un solo pulsante "+ Aggiungi voce", in alto, apre un popup. Ogni riga si modifica e ha un menu ⋯.
- **Saldo tra conti**: mostra solo i saldi tra i conti; i movimenti da chiarire stanno in Da rivedere.

## 31. Inquilini, schede e note

- **Scheda inquilino** per ogni inquilino e annualità, con la situazione: normale, cessionario (subentra a un inquilino presente) o uscito.
- **Documenti richiesti**: sempre modulo caparra e modulo caparra firmato, link al contratto di pertinenza (il contratto non si copia) e documento di avvenuta registrazione presso l'Agenzia delle Entrate. Per un cessionario anche la traccia dell'inquilino sostituito con link alla sua scheda. Per chi se ne va il modulo firmato di restituzione della caparra e, facoltativa, la conferma di mancato rinnovo o della volontà di cessione.
- **Notifica** in Home, nell'elenco Inquilini e nella scheda quando manca un documento richiesto.
- **Cartelle**: sottocartella Inquilini per ogni annualità, con una cartella per inquilino. Un rinnovo crea la cartella della nuova annualità con il link alla caparra già versata.
- **Collegamenti** dalla scheda a versamento affitti e stato dei conguagli.
- **Note per inquilino**: testo libero con data e autore, possibilità di fissare una nota in alto, modifica ed eliminazione. Visibili solo ai proprietari, non compaiono negli Excel né nei messaggi; le modifiche vanno nel registro. L'elenco Inquilini ha una colonna Note con il conteggio.

## 32. Condominio e fornitori

- **Amministratore** (nome, email e telefono), **documenti** del condominio (preventivo, rendiconto, piano rate) che arrivano da Da rivedere come le altre bollette.
- **Ripartizione**: tre totali in evidenza (totale unità, quota conduttore addebitata, quota proprietario non addebitata). Un accordion "Dettagli voce per voce" mostra la tabella completa e il pulsante "Apri il rendiconto (PDF)". Nel conguaglio entra la quota conduttore delle sole rate pagate e trovate nel CSV (sezione 42).
- **Rate** dell'esercizio, con stato (in ritardo e non nel CSV, in programma, pagata), anche in Scadenze e pagamenti. **Consuntivo**: la differenza rispetto al preventivo si include nel conguaglio o resta a carico del proprietario, su conferma.
- **Altri fornitori e contatti**: pulsante "+ Aggiungi fornitore" (idraulico, elettricista, fabbro, pulizie, altro) con nome, categoria, telefono, email, appartamenti serviti e note. Le note, riservate ai proprietari, servono a ricordare interventi, costi e orari; si aggiungono e correggono anche dopo.

## 33. Messaggi e file

- I messaggi agli inquilini (conguaglio, solleciti, subentro) si salvano come file .txt con la data di creazione e si possono copiare negli appunti. L'invio lo fa sempre una persona.
- I file stanno nella cartella Messaggi dell'appartamento e nella cartella Inquilini/annualità/inquilino (sezione 31), oltre alla struttura già descritta nella sezione 20.

## 34. Tasse e stime (sostituisce "Dichiarazione dei redditi")

- **Ruolo**: dichiarazioni ed F24 li prepara il commercialista con i dati di immobile e contratto. L'app non compila nulla. A inizio anno l'utente stima spese e tasse; l'app confronta con quanto pagato e con quanto ancora previsto e segnala le discrepanze.
- **Tabella per contribuente** (user1: Appartamento A e Appartamento B; user2: Appartamento C): per ogni voce (cedolare secca, IMU, imposte di registro e proroghe, TARI, condominio quota proprietario) stima di inizio anno, pagato finora, ancora previsto, differenza e stato (in linea, discrepanza, da verificare). Differenza = pagato + ancora previsto - stima. Il pagato arriva dal CSV, l'ancora previsto da Scadenze e pagamenti.
- **Tasse**: gli importi li inserisce l'utente voce per voce e anno per anno (tabella voce × anno). Nell'app non ci sono aliquote e nulla si calcola da solo. Se un anno è vuoto, a gennaio l'app avvisa e propone di copiare l'anno precedente.
- **Spese condominiali**: per gli anni senza dati si estrapolano da quelli precedenti finché non ci sono preventivi o consuntivi aggiornati; la stima poi si aggiorna da sola e mostra la fonte (preventivo, consuntivo, estrapolata dal...).
- **Discrepanze**: elenco con link alla voce, solo come avviso: non bloccano nulla.
- **Esporta per il commercialista**: dati di ogni immobile e contratto (codici, canoni, date, registrazioni) in Excel; il file va in Riservato\_proprietari/Tasse/anno e resta nel registro.
- Decisione del 6 novembre: gli importi delle tasse si inseriscono anno per anno, quando arriva il momento.
- Decisione del 16 novembre (piano 7-bis, R182): la cedolare si può solo **stimare**, come proposta da confermare: totale degli affitti dell'anno inserito a mano dall'utente × aliquota inserita nel contratto, un solo arrotondamento al centesimo, metà in su. Nessun'altra tassa si calcola e la stima non vale mai come pagata.

## 35. Registro delle modifiche

- Ogni modifica ai dati ha data, utente, appartamento e motivo. Si vedono gli ultimi 12 mesi; le operazioni più vecchie stanno in un archivio sempre consultabile ed esportabile.
- Una modifica si può annullare; se altre operazioni ne dipendono, l'app mostra l'elenco prima di annullare anche quelle. Il registro non si modifica e non si cancella. Una riga già annullata non si può annullare di nuovo.

## 36. Profili, sincronizzazione e dati

- **Primo avvio**: crea il gruppo di lavoro e il profilo di chi lo usa (user1, user2). I profili non sono account con password. Chi arriva dopo sceglie "Unisciti a un gruppo" e indica la cartella condivisa.
- **Cartella di lavoro condivisa** "App Bollette" su Dropbox: l'app la riconosce dal file \_app/workspace.json, quindi la stessa cartella condivisa vale come invito e non serve importare nulla. Il percorso locale è per macchina.
- Dropbox deve tenere i file "sempre su questo dispositivo". Non c'è blocco dei file: se due persone modificano insieme appare un avviso, e in caso di conflitto un confronto.
- **Dati**: un file JSON per record e un file per ogni operazione del registro; niente SQLite e niente .git dentro Dropbox. I profili dei fornitori sono dati versionati.
- **Inquilini**: ricevono solo link in sola visualizzazione alle sottocartelle del proprio appartamento (sezione 27).
- **Versione dei dati**: ogni cartella ha una versione dello schema e una versione minima dell'app (min\_app\_version). Un'app più vecchia apre in sola lettura; prima di ogni migrazione si fa un backup.

## 37. Distribuzione e aggiornamenti

- **Tecnologia**: interfaccia web in Tauri con un componente Python (pdfplumber, Tesseract, openpyxl) incluso nell'installer. Windows è la priorità (user2), poi macOS.
- **Build**: GitHub Actions produce gli installer per Windows (.msi/.exe) e macOS a ogni versione. Il codice sorgente è in un repository privato fuori da Dropbox; le versioni si pubblicano in un repository pubblico senza dati personali.
- **Aggiornamenti**: l'app controlla se esiste una versione nuova e propone di installarla; il manifest è firmato con una chiave propria. È l'unica chiamata di rete (sezione 28) e si può disattivare.
- **Firma Windows**: decisione del 6 novembre 2026, nessun certificato di firma. Alla prima installazione Windows SmartScreen mostra un avviso; le istruzioni per user2 sono "Maggiori informazioni", poi "Esegui comunque". Da verificare l'equivalente su macOS (app non notarizzata).
- **Compatibilità**: i layout dei fornitori sono dati, quindi un cambio di layout non richiede una nuova versione dell'app.

## 38. Decisioni del 6 novembre 2026

- Nessuna AI generativa e nessuna API di terzi (sezione 28).
- Nessun certificato di firma per Windows: si accetta l'avviso SmartScreen alla prima installazione.
- Gli Excel oggi si correggono a mano; con l'app le correzioni di ripartizioni, spese condominiali e annualità non servono più perché le calcola l'app.
- Dichiarazioni dei redditi ed F24 li fa il commercialista; l'app fa stime e confronti (sezione 34).
- Registro visibile per 12 mesi con archivio a parte; Bollette solo dell'annualità corrente; dettagli del condominio in un accordion con link al documento.
- Le tasse le inserisce l'utente anno per anno; le spese condominiali si estrapolano finché non ci sono preventivi o consuntivi.
- Non esiste un foglio di stima di inizio anno da cui partire.

## 39. Punti aperti

- Tasse: nessun punto aperto, gli importi si inseriscono anno per anno (sezione 34).
- Nuove versioni dei cinque modelli (subentro, conferma disdetta, cauzione o conferma, impegno canone, contratto) e loro dati.
- Verificare su fonti ufficiali i tassi di interesse legale per anno (2025: 2%, 2026: 1,6%) e termini e importi di registrazione dei nuovi contratti. Nessuna aliquota va scritta nell'app senza fonte.
- Verificare che Dropbox consenta il link in sola visualizzazione di una sottocartella.
- Confermare che la proroga RLI di Appartamento A e la registrazione di Appartamento C (scadenza 30/10/2026) siano state fatte: oggi sono segnate come in ritardo nell'esempio.
- Comportamento su macOS senza notarizzazione.
- Alias del pagatore per abbinare un bonifico all'inquilino; un unico link alla cartella Excel per gli inquilini o uno per annualità.
- Blocco di aggiornamento della scheda appartamenti nel progetto (contratto di Appartamento A, caparre, nuove annualità).
- Aggiungere le cartelle Messaggi e Inquilini/annualità/inquilino alla struttura della sezione 20.
- Conguaglio di Appartamento B e interessi sul deposito: si preparano con l'app, dopo la prova su un'annualità conclusa e dopo aver finito di costruire l'app (decisione del 10 novembre 2026).

## 40. Apertura ad altri utenti (decisione del 6 novembre 2026)

- **Obiettivo oggi:** uso personale o con poche altre persone; ipotesi di open source; si tiene aperta la possibilità di venderla in futuro.
- **Repository privato** finché non si decide la licenza. Il copyright resta di user1; non si accettano contributi esterni senza un accordo che permetta di cambiare licenza in seguito.
- **Controllo delle licenze delle librerie** fin dall'inizio: niente dipendenze con licenza che obblighi a rilasciare tutto o che impedisca la vendita (per esempio PyMuPDF, AGPL). Si usano librerie con licenze permissive (MIT, Apache, BSD).
- **Licenze ammesse in più (decisione dell'11 novembre 2026):** Unicode-3.0 e Zlib, permissive, richieste dalle dipendenze Rust di Tauri.
- **Regole di sviluppo che tengono aperta la porta:** nessun dato dei propri appartamenti scritto nel codice; tipi di contratto, regimi, utenze e regole di ripartizione come impostazioni; regole fiscali come dati con fonte e data; nessuna telemetria; i profili dei fornitori non contengono dati personali.
- **Prima di una beta con altri proprietari:** primo avvio guidato con dati di prova e importazione di un Excel; editor dei profili dei fornitori per utenti non tecnici; backup e ripristino con un clic; rapporto diagnostico senza dati sensibili; prove con altri servizi di sincronizzazione; test automatici su documenti anonimizzati.
- **Prima di una distribuzione pubblica:** certificato di firma Windows e notarizzazione macOS (oggi esclusi per l'uso familiare); avviso che non è consulenza fiscale né legale, condizioni d'uso e informativa sulla privacy; supporto e aggiornamento annuale delle regole; solo Italia.
- **Scelta della licenza** rimandata al momento della beta.

## 41. App mobile di sola lettura (decisione del 6 novembre 2026)

- **Ambito:** app per telefono di sola consultazione, accanto all'app desktop: chi ha pagato, scadenze, stato dei conguagli, note, elenco inquilini e documenti mancanti, copia di un messaggio negli appunti. Non modifica dati e non carica bollette: lettura dei documenti, conferme, Excel e ogni scrittura restano sul computer.
- **Notifiche:** solo notifiche programmate sul telefono (per esempio una scadenza), senza server.
- **Accesso ai dati:** il telefono legge la stessa cartella di lavoro condivisa tramite i file del telefono (Dropbox come cartella, disponibile offline), senza usare le API di Dropbox e senza chiamate di rete dell'app (sezione 28).
- **Scelte di architettura da prendere nel piano:** (1) il formato dei file JSON con versione e regole di unione (sezione 36) è il contratto tra desktop e telefono e si scrive come specifica a sé; (2) calcoli e regole (interessi, ripartizioni, conguagli, stato dei pagamenti, scadenze) in un componente portabile condiviso (TypeScript o Rust), con Python solo per la lettura dei PDF e degli estratti conto XLSX su desktop (decisione del 14 novembre 2026); (3) interfaccia web adattabile, già prevista dal layout stretto. Framework per il telefono da scegliere dopo una verifica (Tauri 2 mobile, Capacitor o React Native).
- **Distribuzione:** iOS con account sviluppatore Apple e TestFlight; Android con file di installazione. Rimandata a dopo la versione desktop.

## 42. Regole di calcolo e verifica (consolidate il 10 novembre 2026)

Queste 8 regole sono le uniche regole di calcolo in vigore. Prevalgono sulle sezioni 6, 11, 12, 16, 17 (per il forfait), 32 e su ogni esempio precedente.

### R1. Competenza e riparto

- Ogni costo ha dei mesi di competenza. L'importo si divide per i mesi, poi in ogni mese tra gli inquilini presenti in quel mese (deciso da user1 il 19 novembre 2026, sostituisce il divisore uguale ai posti): i posti vuoti non hanno quota. Vale per tutte le spese divise per posto (bollette, TARI propria e comune, rate di condominio e conguaglio dell'anno prima quando vanno agli inquilini, commissioni) e per tutti i periodi non chiusi, anche passati; un periodo già chiuso con la regola di prima la tiene (posti vuoti alla proprietà, nessun conguaglio supplementare per questo), e un periodo riaperto, che è di nuovo aperto, alla chiusura successiva usa la regola nuova (risposta di user1 del 19 novembre 2026). Solo un mese senza nessun inquilino presente resta a carico della proprietà; nell'Excel è la riga «Mesi senza inquilini». La presenza resta a mesi interi. Esempio: bolletta di 90,00 € di un mese, 3 posti, 2 inquilini presenti tutto il mese: 45,00 € ciascuno, 0 € alla proprietà (prima 30,00 € a testa e 30,00 € alla proprietà).
- Bolletta (deciso da user1 il 18 novembre 2026): l'importo si divide tra i mesi del suo periodo in proporzione ai giorni del periodo che cadono in ciascun mese, anche quando il periodo copre solo mesi interi (un mese di 31 giorni pesa più di uno di 30). Esempio: bolletta dal 30 settembre al 29 novembre, 90,00 €: settembre 1 giorno, ottobre 31, novembre 29, in tutto 61; settembre 1,48 €, ottobre 45,74 €, novembre 42,78 €. Le voci a rata (R3) restano divise in parti uguali tra i mesi che coprono.
- Periodo di conguaglio: dipende dal contratto. Transitori da 12 mesi rinnovabili (Appartamento A, Appartamento C): un periodo per annualità (ottobre–settembre). Contratto 3+2 di Appartamento B (aprile 2024 – marzo 2029): un solo periodo per tutta la durata, con i subentri al suo interno. Alla creazione di un appartamento e alla chiusura di un periodo o di un contratto l'app chiede durata e tipo del contratto successivo (1+1 o 3+2).
- Mesi di competenza: per una bolletta, i mesi del suo periodo; per una voce a rata, i mesi coperti dalla rata (R3); per il conguaglio condominiale dell'anno prima, i 12 mesi dell'esercizio corrente.
- Arrotondamento: la somma delle quote è sempre uguale all'importo; ogni mese riceve la parte intera in centesimi della sua quota, e i centesimi che avanzano vanno uno per mese ai primi mesi. Nel mese i centesimi che avanzano vanno ai primi inquilini presenti nell'ordine dei posti.

### R2. Un costo conta solo se è nel CSV

- Bollette, rate di condominio, F24 e conguagli si abbinano a un addebito nel CSV del conto dell'appartamento (importo uguale, data compatibile, fornitore nella causale). Finché l'addebito non c'è la voce è "In attesa di pagamento": resta in Da rivedere, fuori dal conguaglio e dall'Excel degli inquilini.
- Annualità storiche e CSV mancanti: l'app legge più CSV, uno per periodo (senza duplicare i movimenti già letti). Una voce senza addebito trovato non si considera mai pagata (deciso da user1 il 18 novembre 2026, sostituisce le voci "assunte"): se nessun estratto del conto pagante copre la sua data resta "da verificare", fuori dal conguaglio e dall'Excel degli inquilini come una voce in attesa. Se invece nella finestra della scadenza c'è un addebito candidato di un estratto (stesso importo, oppure importo diverso con il fornitore nella causale), la voce si abbina o si propone come sempre. Esempio: bolletta di 100,00 € con scadenza 31 gennaio, primo estratto dal 1° febbraio, nessun addebito trovato: "da verificare", non pagata. Vale anche per le annualità passate senza estratti e per un abbinamento "assunto" salvato prima: si legge ma non conta. Dai prossimi anni gli estratti si salvano ogni mese.
- Conta l'importo addebitato. Se è diverso da quello del documento, l'app segnala "importo diverso" e chiede conferma; per una rata di condominio o un F24 la voce resta in attesa finché non si corregge il documento o non si abbina a mano.
- Un addebito può coprire più voci (un F24, la TARI) e una voce può avere più addebiti (rate): l'abbinamento è manuale e le somme devono tornare, salvo l'avviso TARI comune di Appartamento A e Appartamento B, che si abbina in automatico (R3).

### R3. Voci a rate (condominio, TARI)

- Una voce pagata in n rate entra nel conguaglio una rata alla volta, quando l'addebito compare nel CSV. Ogni rata copre 12/n mesi del periodo della voce, in ordine, salvo diversa indicazione del piano rate. Piani reali (dai documenti): condominio di Appartamento A: 3 rate (ottobre, gennaio, aprile) e di Appartamento B: 3 rate (10 luglio, 10 ottobre, 10 febbraio), ciascuna da 4 mesi, di importo diverso (la prima include il conguaglio dell'anno prima); condominio di Appartamento C: 3 rate ordinarie, con esercizio da ottobre e 4 mesi per rata; TARI 3 avvisi all'anno (gennaio–aprile, maggio–agosto, settembre–dicembre, anno solare), ciascuno con l'importo al netto di quanto già richiesto.
- Condominio, rata: entra al netto della quota annua della proprietà (un solo importo per appartamento ed esercizio, somma di tutte le voci escluse come Generali Proprietà e le spese straordinarie), divisa in parti uguali tra le rate. Le rate straordinarie sono interamente della proprietà.
- Condominio, conguaglio dell'anno prima: sta sulla stessa riga della rata, in un'altra colonna. Entra per intero, senza sottrazioni, quando compare nel CSV l'addebito della rata che lo contiene, e si divide sui 12 mesi dell'esercizio corrente tra gli inquilini presenti. È l'unica eccezione alla competenza: non va all'annualità precedente, nemmeno se è a credito. L'addebito atteso è rata + conguaglio.
- IMU: non entra nel conguaglio degli inquilini. È un'imposta della proprietà e si gestisce in Scadenze e pagamenti (due rate per legge, F24 nel CSV). L'F24 di Appartamento A e Appartamento B esce dal conto di Appartamento A e si ripartisce tra i due appartamenti in parti proporzionali nel Saldo tra conti.
- TARI di Appartamento A e Appartamento B: un solo avviso e un solo addebito, con una sezione per utenza. L'addebito si divide tra i due appartamenti in proporzione ai totali per utenza indicati nell'avviso (abbinamento automatico quando l'addebito comune è uno solo, decisione dell'11 novembre 2026; resti ai resti maggiori). Appartamento C ha avvisi propri.
- TARI, competenza (decisa il 10 novembre 2026): gli avvisi sono cumulativi sull'anno solare e ognuno si assegna ai suoi 4 mesi nuovi: gennaio–aprile, maggio–agosto, settembre–dicembre (l'avviso di dicembre contiene anche le piccole componenti annuali). Il periodo di conguaglio di un appartamento dell'avviso TARI comune si chiude solo dopo l'addebito TARI del dicembre che sta dentro il periodo, così settembre non riapre il periodo precedente (deciso da user1 il 18 novembre 2026). Esempi: periodo aprile 2025 – marzo 2026, serve l'addebito di dicembre 2025; settembre 2025 – agosto 2026, dicembre 2025; gennaio–dicembre 2026, dicembre 2026. Un periodo di più anni aspetta ogni dicembre al suo interno; un periodo senza dicembre (per esempio gennaio–giugno) non aspetta nessun addebito TARI.
- TARI, nota su ogni avviso: l'app scrive accanto a ogni avviso TARI (in Da rivedere, nell'Excel degli inquilini e nel file della proprietà) una nota che spiega il calcolo: numero e data dell'avviso, periodo dichiarato, mesi assegnati e perché, importo addebitato nel CSV con data e conto; per l'avviso comune anche il totale di ciascuna utenza, la quota di Appartamento A e di Appartamento B dell'addebito con il criterio di riparto, e lo storno: quanto il conto di Appartamento B deve al conto di Appartamento A per quell'avviso. Esempio: "Avviso 2026/1/89064, periodo gennaio–aprile 2026, mesi assegnati gennaio–aprile. Addebito 186,00 € il 16/03/2026 sul conto di Appartamento A. Utenze: Appartamento A 100,75 €, Appartamento B 84,71 €; riparto dell'addebito in proporzione: Appartamento A 101,04 €, Appartamento B 84,96 €. Storno: Appartamento B deve 84,96 € a Appartamento A."

### R4. Affitto e forfait degli inquilini

- Ogni inquilino ha, per la durata della sua presenza, un affitto mensile e un forfait mensile, che possono differire da una persona all'altra. L'affitto non include nulla: tutte le spese (acqua, gas, luce, TARI, condominio e le altre voci degli Excel) sono coperte dal forfait.
- Il forfait che conta è quello incassato. Ogni versamento mensile trovato nel CSV (affitto + forfait) si abbina al mese dovuto e si imputa prima all'affitto, poi al forfait. Chi non versa risulta in arretrato.
- Ogni entrata del CSV si classifica (canone, caparra, saldo di conguaglio, altro) e si attribuisce a un inquilino e a un mese solo dopo conferma. In automatico solo quando il pagante è già stato confermato per quell'inquilino e l'importo è esattamente affitto + forfait del mese; tutto il resto va in Da rivedere (importi diversi, 500 € che possono essere caparra o canone, versamenti parziali o compensati con un credito, più mesi in un bonifico). Le categorie assegnate dalla banca ("Affitti incassati", "Bonifici ricevuti") non contano. Lo stesso vale per le uscite non abbinate a una voce: rimborso a un inquilino, spesa della proprietà, imposta di subentro da addebitare a chi esce, movimento privato.
- Dovuto = quote dei costi (R1–R3) − forfait incassato.
- Il totale mensile di tutti gli affitti e forfait si confronta con il contratto (canone + acconto): è solo un avviso.

### R5. Chiusura, riapertura e conguaglio supplementare

- L'annualità si chiude con un'istantanea solo quando sono stati incassati tutti gli affitti e tutti i forfait e il conguaglio è inviato: un forfait non può quindi arrivare dopo la chiusura.
- Una voce che arriva o viene pagata dopo la chiusura (bolletta tardiva, correzione) non cambia l'istantanea. La differenza rispetto all'istantanea è un conguaglio supplementare di quell'annualità, ripartito per competenza (R1) tra chi c'era in quei mesi, anche se è partito. L'app crea una notifica in Da rivedere e in Scadenze.
- Il condominio non passa di qui: il conguaglio dell'anno prima segue R3.
- Debito di un inquilino già partito: nessuna ripartizione sui presenti. Si trattiene dalla caparra se è ancora in mano, altrimenti si chiede all'inquilino partito; se non si recupera, resta a carico della proprietà.
- Dopo la chiusura ci sono tre passi distinti (deciso da user1 il 18 novembre 2026): chiuso (l'istantanea), inviato agli inquilini (una data, segnata da user1) e saldato per ciascun inquilino (data e, se c'è, il movimento che lo paga; lo segna solo user1, mai l'app da sola). L'Excel, il file della proprietà e la Home mostrano il passo.
- Dopo la chiusura l'Excel mostra il calcolo di oggi, con l'avviso «serve un conguaglio supplementare» quando qualcosa è cambiato.
- Riapertura: un periodo chiuso si riapre con una data e un motivo obbligatorio. L'istantanea vecchia resta nello storico, con i segni di invio e di saldo, e non si cancella; una chiusura successiva prende un'istantanea nuova, che diventa quella corrente. Il registro dice chi e quando, come per ogni operazione. Chi era segnato saldato sulla chiusura precedente deve solo la differenza tra il dovuto nuovo e quello saldato: esempio, chiuso con 120,00 € dovuti e saldati, riaperto, bolletta tardiva di 10,00 €, chiuso di nuovo: da saldare 10,00 €, non 130,00 €; la Home e l'Excel dicono «saldato fino alla chiusura precedente, differenza da saldare».
- Un periodo riaperto si chiude di nuovo anche se manca un forfait il cui pagamento è stato annullato dopo la chiusura precedente: l'importo diventa la riga «Forfait non incassato <periodo>». Allo stesso modo si chiude di nuovo anche se manca un canone (per esempio un bonifico respinto, deciso da user1 il 19 novembre 2026): la chiusura lo avvisa e l'inquilino ha la riga «Canone non incassato <periodo>», trattenuta dalla caparra se è ancora in mano, altrimenti da richiedere. Il canone resta fuori dal conguaglio e dai saldi; un pagamento successivo per quel mese toglie la riga. Un periodo mai chiuso non si chiude finché manca un forfait. Se quel forfait viene pagato dopo, annulla la riga; un forfait incassato oltre il dovuto (per esempio pagato dopo che il proprietario ha segnato saldato il conguaglio) è «da verificare», con l'importo, e non diventa mai un credito automatico.
- Finché il periodo è chiuso, ciò che c'era alla chiusura non si cambia finché non si riapre: presenze, canoni e contratti, bollette e rate già contate, pagamenti e abbinamenti del periodo, i movimenti e le loro classi che li reggono (modifica, cancellazione, annullo); anche una presenza o un contratto nuovi dentro il periodo, i dati dell'appartamento che valgono nel periodo (posti, inizio dell'annualità: il messaggio dice quali periodi chiusi riaprire) e i pesi di un'utenza della TARI comune a cui è collegata una rata già contata. Posti e pesi hanno un mese «valido dal» (deciso da user1 il 19 novembre 2026): il valore vecchio vale prima di quel mese, il nuovo da quel mese; un dato senza mese vale da sempre. Un cambio da un mese dopo ogni periodo chiuso si accetta, uno che tocca un periodo chiuso è rifiutato. Un avviso TARI usa i pesi del suo primo mese; se i pesi cambiano nei mesi dell'avviso, l'avviso si divide a mano. Un'utenza nuova si collega sempre. Il messaggio nomina il periodo e dice «riapri il periodo con il motivo». Ciò che arriva dopo (una bolletta nuova, movimenti nuovi, un pagamento o un abbinamento per una voce in attesa) si accetta e va nel conguaglio supplementare.
- Forfait annullato dopo una riapertura: se un forfait contato alla chiusura viene poi annullato, quanto non è incassato si chiede nel conguaglio supplementare con una riga a sé.
- Un cambio dopo la chiusura del conguaglio condominiale dell'anno prima entra nel conguaglio supplementare.
- Anche il conguaglio supplementare si segna saldato (inquilino, data, movimento facoltativo); una volta segnato non si trattiene dalla caparra.
- Ogni saldo segnato conserva l'importo dichiarato saldato e il forfait incassato in quel momento: quanto resta da saldare è il dovuto di oggi meno la somma di quegli importi; il forfait incassato dopo un saldo è già saldato con esso ed è «da verificare», mai un credito. Il forfait da verificare non blocca i saldi e nessun saldo lo cambia; come chiuderlo è ancora da decidere (oggi si corregge il pagamento).
- Caparra all'uscita: i conguagli dei periodi chiusi non saldati da quell'inquilino (tutto il dovuto finché il proprietario non lo segna saldato, i pagamenti parziali non contano) e i debiti di un conguaglio supplementare non segnato saldato si trattengono dalla caparra in automatico, ciascuno su una riga con periodo e tipo; un credito dell'inquilino si aggiunge allo stesso modo. Esempio: l'inquilino esce nel 2027 con 120,00 € del conguaglio 2025-26 non pagati: riga «Conguaglio 2025-26 non saldato − € 120,00». Esempio: il supplementare dà 12,00 € in più a un inquilino uscito ad agosto, caparra ancora in mano: una riga di 12,00 €. Se la caparra è già restituita il prospetto passato non cambia: le righe sono «da richiedere», e il dovuto del periodo d'uscita alla chiusura con i pagamenti è elencato «da verificare». Un periodo dell'inquilino riaperto ferma il prospetto finché non si chiude di nuovo. Gli interessi sulla caparra restano semplici, a mesi interi.

### R6. Saldo dei conguagli

- Un conguaglio a credito si salda con un nostro versamento agli inquilini di quell'annualità, anche partiti; uno a debito con un versamento atteso da loro.
- Il saldo è chiuso solo quando il bonifico compare nel CSV, in uscita o in entrata.

### R7. Commissione e caparra

- Commissione bancaria: è una riga a parte nel CSV ("Commissioni e spese", 0,80 €), legata all'addebito dallo stesso codice disposizione. Si conta come parte di quella bolletta (stessi mesi, stesso riparto) solo se compare nel CSV; non c'è più un interruttore per appartamento né una data di fine. Il rimborso della caparra con interessi resta come nella sezione 17.

### R8. Excel

- Excel degli inquilini: una sola voce "Condominio" per versamento, senza distinguere rata e conguaglio dell'anno prima.
- File riservato alla proprietà: rata, conguaglio dell'anno prima, quota della proprietà e data dell'addebito nel CSV in colonne separate.

### Esempi (importi inventati)

**Condominio.** Esempio inventato: appartamento a 4 posti, esercizio 1 maggio 2026 – 30 aprile 2027, con 4 rate da 3 mesi (i piani reali hanno 3 rate da 4 mesi). A, B e C presenti tutto l'anno; E presente maggio–luglio; D da agosto. 1ª rata (maggio–luglio): rata 150,00 €, di cui 6,00 € di quota della proprietà (24,00 € l'anno ÷ 4), più conguaglio 2025/26 di 48,00 €: addebito nel CSV 198,00 €. Entrano 144,00 € di rata sui 3 mesi (12,00 € per inquilino e mese) e 48,00 € di conguaglio sui 12 mesi (1,00 € per inquilino e mese).

| Inquilino | Mesi nell'esercizio | di cui rata | di cui conguaglio | Totale |
| --- | --- | --- | --- | --- |
| A, B, C (ciascuno) | 12 | 36,00 € | 12,00 € | 48,00 € |
| E | 3 | 36,00 € | 3,00 € | 39,00 € |
| D | 9 | 0,00 € | 9,00 € | 9,00 € |
| Totale |  | 144,00 € | 48,00 € | 192,00 € |

La 2ª rata (agosto–ottobre, 144,00 € al netto) compare nel CSV: A, B, C e D aggiungono 36,00 € ciascuno, E nulla.

**Bolletta tardiva.** Appartamento A, annualità 1 ottobre – 30 settembre, 5 posti. Una bolletta della luce dal 1° luglio al 30 settembre, 90,00 €, arriva ed è pagata a novembre, dopo la chiusura. A, B, C ed E c'erano tutti e tre i mesi, D è partito a fine agosto, F è arrivato a settembre. Quote dei mesi in proporzione ai giorni (31, 31 e 30 su 92): luglio 30,33 €, agosto 30,33 €, settembre 29,34 €; ogni mese si divide tra i 5 inquilini presenti, con i centesimi in più ai primi posti. Conguaglio supplementare: A, B e C 18,01 € ciascuno, E 17,99 €, D 12,12 €, F 5,86 €. I 12,12 € di D si trattengono dalla caparra se è ancora in mano.

### Da confermare

- Nessun punto aperto sulle regole di calcolo al 10 novembre 2026.
