# Brief comune: proposte di veste grafica per App Bollette

Dieci proposte di stile completamente diverse per l'app desktop (Mac e Windows, Tauri) e per la
futura app del telefono in sola lettura. Non si implementa nulla: ogni proposta è una scheda dello
stile più tre schermate statiche in SVG che mostrano come apparirebbe l'app.

## L'app in breve (dalla specifica, `docs/spec.md`, sezioni 4, 10, 15, 27, 29, 30)

- Gestisce bollette, rate di condominio e TARI e i conguagli degli inquilini di tre appartamenti
  di studenti a Padova: **Berchet** (5 posti), **Lovarini** (4 posti), **Pulci** (4 posti).
- Utenti: Carlo e il fratello Nicola, manager, non programmatori. Principi di usabilità (sezione
  15): nessun manuale, ogni schermata dice cosa fare dopo con **un solo pulsante principale
  evidente**, linguaggio semplice, stato sempre visibile con colori e frasi (semafori), ogni azione
  importante si conferma e si annulla. Riferimenti citati: Revolut, Notion, Handy, Duolingo.
- Barra laterale (sezione 29): Home; Da rivedere (con contatore); Appartamenti; gruppo «Banca e
  fisco» (Scadenze e pagamenti, Saldo tra conti, Tasse e stime); Impostazioni in fondo. In alto un
  doppio selettore «Appartamento · Annualità» (es. «Berchet · 2025-26») e la ricerca globale
  (Ctrl K). Stato di sincronizzazione e nome utente in alto a destra.
- Interfaccia in italiano. Importi nel formato `€ 1.234,56`, negativi `- € 63,00`.

## Le tre schermate da disegnare (obbligatorie, stessi contenuti in tutte le proposte)

1. **`01-home.svg` — Home desktop, 1440 × 900.** Barra laterale; in testa saluto e pulsante
   principale «Rivedi (3)»; tre card degli appartamenti con semaforo (Berchet verde «Tutto a
   posto», Lovarini giallo «2 cose da fare», Pulci rosso «1 scadenza passata»), ciascuna con un
   riepilogo («4 su 5 in regola», saldo di cassa); elenco «Cose da fare» (al massimo quattro: es.
   «Bolletta Hera gas da confermare», «Affitto di novembre non ricevuto — Giulia R.», «Rata
   condominio Lovarini in scadenza il 10/12», «Conguaglio Pulci da inviare»); «Operazioni recenti»
   con autore (Carlo, Nicola) e ora; filtro «Tutti | Per me».
2. **`02-conguaglio.svg` — Scheda appartamento, tab Conguaglio, 1440 × 900.** Intestazione
   «Berchet · Annualità 2025-26» con le schede Affitti e pagamenti, Bollette, **Conguaglio**,
   Inquilini, Condominio, Moduli, Excel, Storico. Tabella per inquilino: nome, mesi, quota costi,
   forfait incassato, da pagare / da rimborsare, stato (saldato, parziale, da pagare). Blocchi per
   tipologia (Elettricità, Gas, Acqua, Internet, TARI, Condominio) con totali, uno aperto con due o
   tre bollette dentro. Un solo pulsante principale: «Prepara il messaggio». Nota in piccolo che
   gli importi contano solo le voci trovate nell'estratto conto.
3. **`03-mobile.svg` — App del telefono, sola lettura, 390 × 844.** Home compatta: le tre card
   degli appartamenti con semaforo, le prossime scadenze, chi ha pagato questo mese.

Dati inventati ma realistici e coerenti tra le schermate (5 inquilini a Berchet, importi in
centesimi plausibili: luce 98,24 €, internet 29,95 €, TARI 101,04 €, conguaglio per inquilino
tra −60 € e +90 €). **Mai nomi, IBAN, codici fiscali o indirizzi di persone reali**: usa nomi
inventati (es. Giulia R., Marco T., Sofia B., Luca P., Anna V.).

## Ogni proposta consegna, nella sua cartella `docs/design/proposte/NN-slug/`

- `README.md` in italiano:
  - nome dello stile e un'idea in una frase;
  - **reference reali trovate online** (almeno 5, con link: Dribbble, Behance, siti di prodotto,
    articoli sui trend 2025-2026, movimenti artistici) e cosa prendi da ognuna;
  - palette (token con esadecimali e ruolo: sfondo, superficie, testo, primario, successo,
    attenzione, errore), con verifica del contrasto WCAG AA del testo principale;
  - tipografia (font con licenza libera, es. Google Fonts, e scala dei corpi);
  - forme, spaziatura, icone, illustrazioni o mascotte, movimento (descritto);
  - come lo stile rispetta i principi di usabilità della specifica (un pulsante principale,
    semafori leggibili anche per daltonici: colore più icona o testo, linguaggio semplice);
  - pro, contro e rischi (es. stanca dopo un anno? regge su Windows? leggibile per Nicola?);
  - come si tradurrebbe in token per l'implementazione (piano 4).
- Le tre schermate SVG sopra, autosufficienti: solo SVG puro (niente immagini esterne, niente
  `<foreignObject>`, niente script), testi come `<text>` con `font-family` che nomina il font
  scelto seguito da un fallback generico, gradienti e filtri SVG ammessi. Devono essere valide
  (`xmllint --noout file.svg`) e si devono vedere bene una volta convertite in PNG
  (`rsvg-convert -w 1440 file.svg -o /tmp/...png`, poi guarda il PNG con lo strumento di lettura
  immagini e correggi testi sovrapposti, tagliati o illeggibili). Non salvare i PNG nel
  repository.
- Nessun file fuori dalla propria cartella. Nessun commit, nessun push, nessun ramo: il
  coordinatore raccoglie tutto.

## Qualità

Segui le buone regole di UI/UX: gerarchia chiara, griglia coerente (8 pt), allineamenti, contrasto,
stato vuoto e stati di errore riconoscibili, tipografia leggibile a 14-16 px per il corpo. Lo stile
deve essere riconoscibile e coraggioso, ma le schermate devono restare credibili come app che Carlo
e Nicola userebbero davvero ogni settimana.
