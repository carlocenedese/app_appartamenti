// The Italian messages of the commands (plan 24, R386): moved from scripts/estratti.mjs, where
// the command line prints them. R387: they are the command line's wording (some name its options
// and commands); the screens of the app map the reason codes and the fields to their own text and
// never show `message`.

/** The message of each refusal reason or warning code, by code. */
export const COMMAND_MESSAGES: Readonly<Record<string, string>> = {
  'bad-arguments':
    'Argomenti non validi: vedere «pnpm estratti <comando> --help» (comandi: «pnpm estratti --help»).',
  'unknown-command': 'Comando sconosciuto: l’elenco dei comandi è in «pnpm estratti --help».',
  'annualita-not-first-day':
    'Argomenti non validi: l’annualità comincia il giorno 1 di un mese (per esempio --annualita 10-01), perché i periodi di conguaglio sono a mesi interi.',
  'bad-folder': 'La cartella dei dati non esiste o non è una cartella.',
  'bad-file': 'Il file non esiste, non si può leggere o è troppo grande.',
  'bad-profile': 'Il profilo della banca non è valido.',
  'unreadable-statement': 'L’estratto non si può leggere: file non valido o troppo grande.',
  'no-python': 'Impossibile leggere l’XLSX: interprete Python non utilizzabile.',
  'already-imported': 'Questo estratto è già stato importato.',
  'unknown-apartment': 'Rifiutato: appartamento sconosciuto.',
  'invalid-kind': 'Rifiutato: tipo non ammesso per un’uscita verso un inquilino.',
  'rule-conflict-dates':
    'Rifiutato: una regola in conflitto comincia il giorno del movimento o dopo; confermare «solo questa volta».',
  'unknown-bank-profile': 'Rifiutato: profilo della banca sconosciuto.',
  'bad-iban': 'Rifiutato: IBAN non valido.',
  'iban-in-use': 'Rifiutato: IBAN già usato da un altro conto.',
  'unknown-account': 'Rifiutato: conto sconosciuto.',
  'wrong-profile': 'Rifiutato: il profilo non è quello del conto.',
  'wrong-account': 'Rifiutato: il conto dell’estratto non è quello indicato.',
  'bad-declared-account': 'Rifiutato: il conto scritto nell’estratto è vuoto.',
  'masked-account': 'Rifiutato: il conto scritto nell’estratto è mascherato.',
  'needs-period': 'Rifiutato: serve il periodo (--dal e --al).',
  'period-mismatch': 'Rifiutato: il periodo indicato non è quello dell’estratto.',
  'row-outside-period': 'Rifiutato: una riga è fuori dal periodo.',
  'not-decidable': 'Rifiutato: estratto sconosciuto, o riga non da decidere o già decisa.',
  'no-import': 'Rifiutato: nessuna importazione da annullare per questo estratto.',
  'shared-transactions': 'Rifiutato: un altro estratto elenca gli stessi movimenti.',
  'held-duplicates': 'Rifiutato: un altro estratto ha righe da rivedere che ne dipendono.',
  'dependent-payments': 'Rifiutato: dei pagamenti dipendono dai movimenti di questo estratto.',
  'dependent-records':
    'Rifiutato: abbinamenti o classificazioni dipendono dai movimenti di questo estratto.',
  'later-changes': 'Rifiutato: dopo l’importazione ci sono state altre modifiche.',
  'journal-not-aligned': 'Rifiutato: il registro non è riallineato con i dati.',
  'inconsistent-store':
    'Rifiutato: i dati non sono come li lascia il registro: eseguire «pnpm estratti ripara».',
  'unknown-proposal': 'Rifiutato: proposta sconosciuta o già confermata.',
  'month-outside-presence':
    'Attenzione: il mese del canone è fuori dalla presenza dell’inquilino. Registrato; controllare il mese.',
  'month-already-paid':
    'Attenzione: per questo mese c’è già un altro canone confermato dell’inquilino. Registrato; controllare il mese.',
  'invalid-shared-notice':
    'Un avviso comune (TARI) non si può abbinare: se è stato registrato prima del 18 novembre 2026, annullarlo con «annulla-bolletta» e registrarlo di nuovo con «bolletta».',
  'already-recorded':
    'Già registrato, nessuna modifica: per registrarne un secondo uguale usare --id.',
  'stale-proposal':
    "Rifiutato: la situazione è cambiata dopo un'altra conferma (il movimento può essere diventato automatico): rilanciare riconcilia e scegliere dalla lista nuova.",
  'tenant-not-allowed': 'Rifiutato: inquilino non ammesso per questa proposta.',
  'empty-parts': 'Rifiutato: nessuna parte, o una parte senza importo positivo.',
  'sum-mismatch': 'Rifiutato: la somma delle parti non è l’importo del movimento.',
  'no-presence': 'Rifiutato: l’inquilino non ha una presenza nell’appartamento del conto.',
  'repair-refused':
    'Non riparato: il dato sul disco non è uno stato da cui parte il registro. Se è biforcato, scegliere con «scegli-versione»; altrimenti attendere che Dropbox finisca la sincronizzazione e riprovare.',
  'newer-data': 'Rifiutato: dati scritti da una versione più nuova dell’app: aggiornare l’app.',
  'unreadable-records':
    'Rifiutato: alcuni dati non si possono usare (rovinati, di un’altra versione, biforcati o non leggibili): vedere «paths».',
  'file-access':
    'Rifiutato: un file non si può usare ora (aperto in un altro programma, permessi, Dropbox): chiuderlo e riprovare.',
  'inconsistent-record':
    'Rifiutato: il dato non è come dice il registro: «ripara», o «scegli-versione» se è stato modificato in due posti.',
  'not-forked':
    'Rifiutato: il file non ha due versioni da scegliere, o l’operazione non è una di quelle.',
  'not-reconcile-operation':
    'Rifiutato: si annullano solo le operazioni della riconciliazione (incassi, esclusioni, abbinamenti, uscite, giroconti, IMU, contratti, appartamenti, condominio, scadenze, tasse, presenze, rubrica).',
  'unknown-payment': 'Rifiutato: pagamento sconosciuto o già annullato.',
  'not-automatic': 'Rifiutato: non è un pagamento automatico di una riconciliazione.',
  'unknown-operation': 'Rifiutato: operazione sconosciuta.',
  'already-undone': 'Rifiutato: l’operazione è già stata annullata.',
  'has-dependents': 'Rifiutato: operazioni successive dipendono da questa: annullarle prima.',
  // Review of 18 Nov 2026 (annullo, U8): the creation of an apartment, a rule, a stay, an account...
  'record-has-dependents':
    'Rifiutato: dei record dipendono da ciò che questa operazione ha creato (conteggi per tipo in «counts»): annullarli prima.',
  'rooms-in-use':
    'Rifiutato: i posti («rooms») sono usati da presenze («tenancyIds»), anche passate: aggiungere il posto nuovo, spostare le presenze, poi togliere il vecchio.',
  'apartment-unknown-room':
    'Rifiutato: una presenza («tenancyIds») non indica un posto dell’appartamento: indicarlo prima di cambiare i posti.',
  'apartment-beds-conflict':
    'Rifiutato: con questi posti le presenze non entrano più («code», dal mese «month»).',
  'tenancy-in-use':
    'Rifiutato: la presenza ha pagamenti, recuperi o un contratto collegati («recordIds»): per un altro inquilino o appartamento creare una presenza nuova.',
  'no-references': 'Nessun riferimento pendente.',
  'label-in-use':
    'Rifiutato: un’utenza con questa etichetta esiste già con altri appartamenti o quote («supplyId»).',
  'missing-condominio-start':
    'Rifiutato: l’appartamento non ha l’inizio dell’esercizio del condominio dal giorno 1 (appartamento --esercizio-condominio MM-01).',
  'invalid-instalment':
    'Rifiutato: rata non valida: esercizio AAAA-AA o AAAA, rata n/N con N divisore di 12, importi e scadenza.',
  'instalment-in-use':
    'Rifiutato: la rata ha abbinamenti o recuperi («recordIds»): annullarli prima di cambiarla.',
  'instalment-id-collision':
    'Rifiutato: l’identificativo è di una rata TARI o di un altro appartamento.',
  'owner-share-differs':
    'Attenzione: le rate dell’esercizio non hanno la stessa quota della proprietà o lo stesso numero di rate («instalmentIds»): il conguaglio le rifiuta finché non si corregge.',
  'invalid-workspace-settings': 'Rifiutato: impostazione non valida.',
  'closing-changed':
    'Rifiutato: dopo la chiusura sono cambiati costi o dati del periodo, e annullarla perderebbe il conguaglio supplementare. Due vie: tenere la chiusura e usare «conguaglio-supplementare»; oppure riaprire il periodo con il motivo («riapri-periodo»), che tiene l’istantanea nello storico.',
  'reopen-changed':
    'Rifiutato: dopo la riapertura sono cambiati costi o dati del periodo: annullarla chiuderebbe il periodo senza un’istantanea nuova. Chiudere di nuovo con «chiudi-periodo».',
  'not-closed': 'Rifiutato: il periodo non è chiuso (mai chiuso, o riaperto).',
  'unknown-tenant-in-close':
    'Rifiutato: l’inquilino non è nell’istantanea della chiusura del periodo.',
  'unknown-movement-in-close': 'Rifiutato: il movimento non esiste.',
  'missing-reason': 'Rifiutato: per riaprire il periodo serve il motivo (--motivo).',
  'no-supplementary': 'Rifiutato: l’inquilino non ha un conguaglio supplementare da saldare.',
  'nothing-to-mark':
    'Rifiutato: l’inquilino non ha un canone non incassato aperto per questo esito su questa chiusura.',
  'nothing-to-check':
    'Rifiutato: l’inquilino non ha forfait «da verificare» per questo esito su questa chiusura.',
  'forfait-to-check':
    'Da verificare: è stato incassato più forfait del dovuto in un periodo chiuso; non è un credito automatico.',
  'invalid-close-input': 'Rifiutato: data non valida.',
  'period-reopened':
    'Rifiutato: un periodo di conguaglio dell’inquilino è riaperto: chiuderlo di nuovo prima del prospetto della caparra.',
  'codes-not-in-apartment':
    'Rifiutato: un codice dell’utenza non è tra i codici dell’appartamento («apartmentIds»): aggiungerlo prima con «appartamento --codici».',
  'codes-in-use':
    'Rifiutato: un’utenza dell’appartamento usa un codice che si toglierebbe («supplyIds»): toglierlo prima dall’utenza («utenza --codici»).',
  'no-month-to-cover':
    'Rifiutato: il canone versato in più non copre nessun mese: è un credito dell’inquilino da rimborsare.',
  'rent-excess-open':
    'Attenzione: ci sono canoni versati in più con una proposta aperta su mesi di questo periodo («rentExcesses»): confermarli con «eccedenza-canone».',
  'instalment-esercizio-format':
    'Rifiutato: una rata vuole l’esercizio nella forma 2026-27 oppure 2026 (l’esercizio che inizia nel 2026).',
  'tari-december-missing':
    'Rifiutato: l’appartamento è nell’avviso TARI comune e il periodo si chiude solo dopo l’addebito dell’avviso TARI del dicembre che sta dentro il periodo («month», R3): registrarlo e abbinarlo, poi chiudere.',
  'closed-period-changed':
    'Attenzione: questa scrittura cambia un periodo di conguaglio già chiuso («closedPeriods»): serve un conguaglio supplementare (conguaglio-supplementare).',
  'closing-unknown':
    'Rifiutato: il conguaglio del periodo ora non si calcola, quindi non si sa se annullare la chiusura perderebbe un conguaglio supplementare: correggere prima i dati del periodo.',
  'already-closed':
    'Rifiutato: il periodo è già chiuso: per riaprirlo «riapri-periodo» con data e motivo.',
  'rent-missing':
    'Attenzione: il periodo riaperto è chiuso di nuovo senza un canone («rentMissing»): è la riga «Canone non incassato», trattenuta dalla caparra se è ancora in mano, altrimenti da richiedere (importi solo con --dettagli).',
  'cannot-close':
    'Rifiutato: il periodo non si chiude: mancano affitti o forfait, o ci sono voci in attesa («missing»; importi solo con --dettagli).',
  'period-settlement-error':
    'Rifiutato: il conguaglio del periodo non si può calcolare («code»): correggere i dati, poi riprovare.',
  'unknown-period': 'Rifiutato: periodo di conguaglio sconosciuto per l’appartamento.',
  'ambiguous-period-label':
    'Rifiutato: due contratti danno periodi diversi con la stessa etichetta.',
  'invalid-supply':
    'Rifiutato: utenza non valida: etichetta vuota, o le quote degli appartamenti non fanno 100%.',
  'class-has-dependents':
    'Rifiutato: la classificazione automatica del movimento ha un recupero, un pagamento di tasse o una scadenza pagata: decidere prima se vale la bolletta o il recupero.',
  'movement-has-dependents':
    'Rifiutato: dei record dipendono da questo movimento: annullarli prima.',
  'unknown-transaction': 'Rifiutato: movimento sconosciuto o cancellato.',
  'already-classified': 'Rifiutato: il movimento è già escluso o classificato: annullarlo prima.',
  'unknown-item': 'Rifiutato: bolletta o rata sconosciuta o cancellata.',
  'transaction-used': 'Rifiutato: il movimento è escluso, già pagato o classificato a mano.',
  'duplicate-part': 'Rifiutato: la stessa parte compare due volte.',
  'invalid-group': 'Rifiutato: l’avviso comune della rata non è valido.',
  'invalid-matches': 'Rifiutato: le somme dell’abbinamento non tornano.',
  'unknown-class': 'Rifiutato: il movimento non ha una classificazione.',
  'class-not-automatic': 'Rifiutato: non è una classificazione automatica di una riconciliazione.',
  'f24-not-tasse': 'Rifiutato: un F24 va nella categoria «tasse».',
  'f24-not-outgoing': 'Rifiutato: un F24 è solo un’uscita.',
  'leg-not-allowed': 'Rifiutato: il movimento indicato non è una gamba di questo giroconto.',
  'same-account': 'Rifiutato: i due conti sono lo stesso conto.',
  'invalid-amount': 'Rifiutato: l’importo deve essere positivo.',
  'bad-rates': 'Rifiutato: le rate vanno numerate da 1 senza buchi, con importi positivi.',
  'rates-mismatch':
    'Rifiutato: un altro appartamento dello stesso gruppo e anno ha un altro numero di rate.',
  'not-imu-candidate':
    'Rifiutato: il movimento non è un F24 da assegnare (proposta F24 o F24 da ripartire del conto).',
  'unknown-rate': 'Rifiutato: nessun appartamento del gruppo ha questa rata in questo anno.',
  'payer-not-in-group': 'Rifiutato: l’appartamento del conto non è nel gruppo in questo anno.',
  'rate-already-paid': 'Rifiutato: un altro F24 è già assegnato a questa rata.',
  'imu-has-assignments':
    'Rifiutato: un F24 è assegnato a una rata IMU che cambierebbe: annullare prima l’assegnazione.',
  'imu-to-reconcile': 'Rata IMU da riconciliare: controllare gli importi attesi (imu-atteso).',
  'unknown-tenancy': 'Rifiutato: una presenza indicata non esiste o è di un altro appartamento.',
  'unknown-deposit':
    'Rifiutato: una caparra indicata non è un pagamento «caparra» di questo appartamento.',
  'rent-outside-contract':
    'Rifiutato: le nuove date lasciano fuori una voce del canone già scritta.',
  'unknown-contract': 'Rifiutato: contratto sconosciuto o cancellato.',
  'invalid-contract': 'Rifiutato: i dati del contratto non sono validi.',
  'month-outside-contract': 'Rifiutato: il mese è fuori dalle date del contratto.',
  'bad-amount': 'Rifiutato: il canone deve essere positivo e l’acconto non negativo.',
  'rent-differs':
    'Canone del contratto diverso dal totale delle presenze: controllare il contratto o le presenze.',
  'cedolare-estimate': 'Cedolare stimata: da confermare, non è un pagamento.',
  'contract-overlap':
    'Due contratti vivi dello stesso appartamento hanno mesi in comune: controllare le date.',
  'unknown-payable': 'Rifiutato: scadenza sconosciuta o annullata.',
  'not-repeating': 'Rifiutato: la scadenza non è segnata «ogni anno».',
  'already-repeated': 'Rifiutato: la scadenza ha già la voce successiva.',
  'already-paid': 'Rifiutato: la scadenza è già segnata pagata: annullare prima.',
  'transaction-not-classified':
    'Rifiutato: il movimento non ha una classificazione confermata a mano (esclusioni escluse).',
  'payable-linked': 'Rifiutato: il movimento paga già una scadenza: annullare prima.',
  'bad-date': 'Rifiutato: serve la data del pagamento o il movimento.',
  'date-and-transaction': 'Rifiutato: indicare la data o il movimento, non tutti e due.',
  'missing-fields':
    'Rifiutato: per un appartamento nuovo servono nome, locatore, posti, annualità e differenza del condominio.',
  'invalid-document': 'Rifiutato: i dati del documento del condominio non sono validi.',
  'esercizio-format':
    'Rifiutato: l’esercizio ha una forma diversa da quella degli altri documenti dell’appartamento (2026 o 2026-27).',
  'not-extraordinary':
    'Rifiutato: la voce non è una spesa condominiale straordinaria viva di questo appartamento.',
  'amount-too-high': 'Rifiutato: da recuperare più della spesa anticipata.',
  'bad-shares':
    'Rifiutato: quote non valide (inquilino ripetuto o senza presenza, quota zero o di segno diverso, somma diversa).',
  'unknown-expense':
    'Rifiutato: il movimento non è un’uscita viva classificata a questo appartamento.',
  'missing-date':
    'Rifiutato: senza spesa collegata servono la data della spesa (--data) o il periodo (--periodo).',
  'recovery-above-expense':
    'Avviso: i recuperi superano la spesa straordinaria, corretta dopo: controllare i recuperi.',
  'invalid-recovery': 'Rifiutato: i dati del recupero non sono validi.',
  'needs-confirmation':
    'Rifiutato: posti e inizio dell’annualità cambiano ogni conguaglio: ripetere con --modifica.',
  'invalid-apartment': 'Rifiutato: i dati dell’appartamento non sono validi.',
  'f24-pattern-missing':
    'Nota: il profilo della banca non riconosce ancora gli F24 di questo conto.',
  'invalid-tenancy':
    'Rifiutato: i dati della presenza non sono validi (identificativo, mesi o importi).',
  'unknown-tenant': 'Rifiutato: inquilino sconosciuto o cancellato.',
  'same-tenant': 'Rifiutato: nel subentro l’inquilino che entra è quello che esce.',
  'no-contract': 'Rifiutato: la presenza che esce non è in esattamente un contratto vivo.',
  'tenancy-exists': 'Rifiutato: la presenza che entra esiste già con altri dati.',
  'beds-conflict':
    'Rifiutato: con questa presenza il conguaglio non si può calcolare (posto occupato, posto sconosciuto, troppi inquilini o inquilino presente due volte).',
  'tenancy-has-dependents':
    'Rifiutato: versamenti, recuperi o presenze nello stesso posto dipendono da questa operazione: annullarli prima.',
  'takeover-unlinked':
    'Rifiutato: il contratto ha un subentro: ripetere --presenze con le presenze del subentro.',
  'no-room': 'Rifiutato: una delle due presenze non ha un posto.',
  'same-room': 'Rifiutato: le due presenze sono nello stesso posto.',
  'different-contract': 'Rifiutato: le due presenze sono in contratti diversi.',
  'pending-takeover':
    'Rifiutato: una delle due presenze ha già un subentro registrato: annullare prima il subentro.',
  'id-too-long':
    'Rifiutato: l’identificativo della presenza nuova supera 64 caratteri (vedi part): indicarlo con --id-a o --id-b.',
  'swap-unlinked':
    'Rifiutato: il contratto ha un cambio di posto: ripetere --presenze con entrambe le presenze di ciascun inquilino.',
  'swap-rent-unchanged':
    'Nota: i due posti hanno affitti diversi e almeno uno resta quello di prima: indicare --canone-a e --canone-b se cambiano.',
  'swap-forfait-unchanged': 'Nota: i due forfait sono diversi e ciascuno tiene il proprio.',
  'has-recoveries':
    'Rifiutato: l’inquilino ha un recupero in un periodo in cui non sarebbe più presente: correggere prima il recupero.',
  'deposit-check': 'Caparra mancante o diversa da quella attesa: controllare i versamenti.',
  'no-deposit': 'Rifiutato: nessuna caparra versata da questo inquilino in questo appartamento.',
  'already-returned': 'Rifiutato: la caparra risulta già restituita.',
  'deposit-to-request':
    'Attenzione: la caparra è già restituita e il prospetto non cambia: i conguagli dei periodi chiusi non saldati o supplementari sono da richiedere («toRequest»; righe con --dettagli).',
  'missing-rate':
    'Rifiutato: manca il tasso legale di un anno della permanenza: inserirlo con «tasso-legale».',
  'no-exit': 'Rifiutato: la permanenza dell’inquilino non ha ancora una fine.',
  'partial-return':
    'Rifiutato: c’è già una restituzione parziale della caparra: come contarla non è ancora deciso.',
  'several-stays':
    'Rifiutato: l’inquilino ha avuto più permanenze separate nell’appartamento: quale caparra appartenga a quale non è ancora deciso.',
  'mixed-f24-out':
    'Da verificare: la parte non IMU di un F24 misto resta fuori dal saldo tra appartamenti.',
  'recovery-waiting':
    'Avviso: un recupero da trattenere aspetta il pagamento della spesa: non è ancora nel prospetto.',
  'no-period': 'Rifiutato: nessun periodo di conguaglio contiene il mese di uscita.',
  'ambiguous-period': 'Rifiutato: più periodi di conguaglio contengono il mese di uscita.',
  'settlement-error':
    'Rifiutato: il conguaglio del periodo di uscita non si calcola (presenze o rate da correggere).',
  'invalid-rate': 'Rifiutato: anno o tasso non validi.',
  'deposit-return-draft':
    'Prospetto con le date, i tassi e il conguaglio indicati: da controllare prima dell’invio.',
  'bad-year': 'Rifiutato: anno non valido.',
  'bad-parts':
    'Rifiutato: parti non valide (importo non positivo, voce e anno ripetuti, voce non ammessa).',
  'year-not-empty':
    'Rifiutato: l’anno ha già delle stime per un appartamento indicato: non si sovrascrive nulla.',
  'nothing-to-copy': 'Rifiutato: nessuna stima dell’anno prima da copiare.',
  'not-tax-debit': 'Rifiutato: il movimento non è un addebito contabilizzato classificato «tasse».',
  'imu-assigned': 'Rifiutato: il movimento paga una rata IMU: annullare prima l’assegnazione.',
  'tax-assigned':
    'Rifiutato: il movimento è assegnato a cedolare o registro: annullare prima l’assegnazione.',
  'invalid-contact':
    'Rifiutato: contatto non valido (id o campi vuoti, categoria sconosciuta, collegamento ripetuto).',
  'unknown-supply': 'Rifiutato: utenza sconosciuta.',
  'condo-estimate-copied':
    'Stima copiata da un esercizio precedente: non è un documento del condominio e non si salva.',
  'tax-year-empty':
    'Avviso: nessuna stima delle tasse per quest’anno: «tasse-copia» copia l’anno prima.',
  'tax-no-payable':
    'Da verificare: nessuna scadenza con anno di riferimento per questa voce e quest’anno; una scadenza senza anno va riscritta con «scadenza-nuova --id <id> --anno-riferimento <AAAA>».',
  'no-discrepancy': 'Rifiutato: la voce di quest’anno non ha una discrepanza da confermare.',
  'bad-note': 'Rifiutato: la nota è vuota.',
  'invalid-card': 'Rifiutato: la scheda riservata è vuota o ha dati non validi (date AAAA-MM-GG).',
  'bad-values':
    'Il file dei valori non è valido: un oggetto JSON con testi per codice_fiscale, luogo_nascita, data_nascita, residenza, documento_numero, documento_ente, documento_rilascio, documento_scadenza.',
  'invalid-settings': 'Rifiutato: soglie non valide.',
  'unknown-bill': 'Rifiutato: bolletta sconosciuta o cancellata.',
  'no-consumption-thresholds':
    'Nessuna soglia dell’allarme consumi: inserirle con «soglie-consumi» (nessun valore predefinito).',
  'bad-voce': 'Rifiutato: voce delle tasse non valida.',
  'bad-voice': 'Rifiutato: una scadenza di cedolare o registro è già la sua voce: niente --voce.',
  'tax-discrepancy':
    'Discrepanza tra la stima e il pagato più l’ancora previsto: solo un avviso, non blocca nulla.',
  failed: 'Operazione non riuscita: ripetere il comando (per un estratto, «importa»).',
  'bad-reading': 'La lettura non è valida: rifarla con «python -I -m bollette_pdf extract».',
  'bill-rejected': 'Rifiutato: niente da registrare, o file diverso da quello letto.',
  'duplicate-bill': 'Questo documento è già registrato.',
  'possible-duplicate-bill': 'Un documento con gli stessi dati è già registrato: controllare.',
  'several-documents':
    'Rifiutato: il file contiene più documenti; indicare quale con --pagine a-b (o --pagine intero).',
  'has-dependents-bill':
    'Rifiutato: un abbinamento o un recupero usa la bolletta; annullare prima quelli.',
};

// Plan 18: the refusals of scambio-camera whose general message speaks of a takeover or an arrival.
export const SWAP_MESSAGES: Readonly<Record<string, string>> = {
  'same-tenant': 'Rifiutato: nello scambio le due presenze sono dello stesso inquilino.',
  'no-contract': 'Rifiutato: una delle due presenze non è in esattamente un contratto vivo.',
  'tenancy-exists':
    'Rifiutato: una presenza nuova esiste già con altri dati: annullare lo scambio precedente (annulla-riconciliazione) o scegliere altri identificativi con --id-a e --id-b.',
};

/** The operations `annulla-riconciliazione` undoes (R116, R126, R132). */
export const RECONCILE_KINDS: readonly string[] = [
  'income.reconcile',
  'income.confirm',
  'income.cancel-payment',
  'income.excess',
  'movement.exclude',
  'match.reconcile',
  'match.confirm',
  'outgoing.reconcile',
  'outgoing.confirm',
  'outgoing.cancel-auto',
  'outgoing.tenant',
  'transfer.reconcile',
  'transfer.confirm',
  'transfer.manual',
  'imu.expected',
  'imu.assign',
  'contract.save',
  'contract.rent',
  'apartment.save',
  'condo.document',
  'recovery.save',
  'rent.year',
  'payable.save',
  'payable.repeat',
  'payable.paid',
  'tenancy.save',
  'tenancy.end',
  'tenancy.takeover',
  'tenancy.swap',
  'tax.estimate',
  'tax.copy',
  'tax.assign',
  'contact.save',
  'legal-rate.save',
  'tax.confirm',
  'tenant.card',
  'consumption.settings',
  // Review of 18 Nov 2026 (annullo, point 1): an apartment created by mistake can be taken away,
  // its account and supply first; `undoBlockedBy` refuses while records point at them.
  'account.save',
  'supply.link',
  'tenant.save',
  'bank-profile.save',
  // I3, E4: a condominium instalment typed by user1.
  'condo.instalment',
  // I9: the workspace settings.
  'settings.save',
  // I2, R5: the closing of a settlement period (its undo opens the period again).
  'period.close',
  // F1, F3: sent, settled and reopened.
  'period.send',
  'period.settle',
  'period.reopen',
  // Plan 22: the flat charge checked, and the dated weights of a supply («valido dal»).
  'period.flat-check',
  'period.rent-mark',
  'supply.update',
];
