# Brief del secondo giro: otto nuove proposte (11-18)

Il primo giro (01-10, tag git `design-giro-1`) resta intatto: **non toccare le cartelle 01-10,
`BRIEF.md`, `CONCILIO-giro-1.md`, `index.html`, `confronto.html`**. Leggi `BRIEF.md` (contesto
dell'app, schermate, formato) e `CONCILIO-giro-1.md` (regole emerse): valgono anche qui, con le
modifiche sotto.

## Cosa è cambiato

- A Carlo piacciono **01 Private banking, 02 Minimale svizzero, 03 Mascotte, 10 Carta calma**. Guarda
  le loro cartelle per capire cosa funziona.
- Ora vuole stili ispirati a **marchi con una veste grafica forte** (Apple, Notion, Nothing,
  Things, Revolut, Teenage Engineering…). Ispirazione, non copia: nessun logo, nome di marchio o
  font proprietario nell'interfaccia (SF Pro, Ndot, Söhne ecc. non si possono usare: scegli font
  con licenza libera, OFL o simili, e dillo nel README).
- **Mascotte passiva.** Gli piace l'idea della mascotte, ma nella 03 è troppo presente. Dove la
  proposta prevede una mascotte deve essere **discreta**: micro-illustrazioni e micro-animazioni
  come l'asterisco di Claude che «pensa», le illustrazioni a tratto di Notion, l'orb di Siri.
  Regole della mascotte passiva:
  - compare solo in: stato vuoto, attesa o elaborazione (es. «Sto leggendo l'estratto conto…»),
    breve conferma riuscita, intestazione o icona dell'app; mai nelle tabelle, nelle righe di
    elenco o vicino agli importi;
  - al massimo una per schermata, piccola (16-48 px nell'interfaccia, più grande solo negli stati
    vuoti);
  - non esprime emozioni forti sui soldi (niente pianti né sudore per un inquilino che non paga):
    al massimo neutra o attenta;
  - è semplice da realizzare: poche forme geometriche o un tratto, animabile in CSS/SVG con 2-4
    fotogrammi, senza illustratore;
  - si spegne dalle Impostazioni e rispetta «riduci movimento».

## Regole fisse (dal concilio)

- Pulsante principale di un colore che **non** è un colore di stato.
- Stato leggibile da forma o icona + testo prima che dal colore; due stati diversi mai con la
  stessa forma. Stati: in regola, da fare, scaduto (semafori) e, per il conguaglio, saldato,
  parziale, da pagare, da rimborsare.
- Tema chiaro principale, tema scuro progettato (va mostrato in `04-stati.svg`).
- Serif solo nei titoli da 24 px in su; corpo 14-16 px; contrasto del testo almeno 4,5:1, testo di
  stato piccolo almeno 7:1. Dichiara i rapporti nel README.
- Nessun pulsante che promette azioni che l'app non fa (l'app non paga: registra e verifica).

## Dati canonici (identici in tutte le schermate di tutte le proposte)

- Oggi: **mercoledì 11 novembre 2026**. Utente collegato: Carlo. «Rivedi (3)».
- **Berchet** · verde · «Tutto a posto» · 5 su 5 in regola · saldo di cassa € 412,30.
- **Lovarini** · giallo · «2 cose da fare» · 4 su 4 in regola · saldo € 188,75.
- **Pulci** · rosso · «1 scadenza passata» · 3 su 4 in regola · saldo - € 63,00.
- Cose da fare: «Bolletta Hera gas di Lovarini da confermare»; «Affitto di novembre non ricevuto —
  Giulia R. (Pulci)»; «Rata condominio Lovarini in scadenza il 10/12»; «Conguaglio Pulci da
  inviare».
- Operazioni recenti: «Nicola ha confermato la bolletta luce di Berchet · 09:42»; «Carlo ha
  importato l'estratto conto di ottobre · ieri 18:10»; «Nicola ha registrato l'affitto di Sofia B. ·
  ieri 11:05».
- Conguaglio **Berchet · Annualità 2025-26** (inquilini, mesi, quota costi, forfait incassato,
  differenza, stato):
  - Marco T. · 12 · € 418,60 · € 360,00 · da pagare € 58,60 · da pagare
  - Sofia B. · 12 · € 402,15 · € 360,00 · da pagare € 42,15 · parziale (versati € 20,00)
  - Luca P. · 10 · € 300,00 · € 300,00 · € 0,00 · saldato
  - Anna V. · 12 · € 305,40 · € 360,00 · da rimborsare € 54,60 · da rimborsare
  - Elena C. · 12 · € 446,85 · € 360,00 · da pagare € 86,85 · saldato (versati € 86,85)
  - Blocchi (sommano € 1.873,00, come le quote): Elettricità € 812,46 · 6 bollette (aperto: Hera
    luce set-ott € 98,24; Hera luce lug-ago € 104,10; Hera luce mag-giu € 91,37; «e altre 3»),
    Gas € 412,40, Acqua € 188,30, Internet € 359,40, TARI € 100,44, Condominio € 0,00 (nessuna
    rata trovata). Nota: «Gli importi contano solo le voci
    trovate nell'estratto conto.» Pulsante principale: «Prepara il messaggio».
- Telefono: prossime scadenze «Rata condominio Lovarini · 10/12 · € 320,00», «TARI Pulci · 16/12 ·
  € 101,04»; chi ha pagato l'affitto di novembre: tutti tranne Giulia R. (Pulci).

## Consegna per ogni proposta, nella sua cartella `docs/design/proposte/NN-slug/`

- `README.md` come nel primo giro (idea in una frase, almeno 5 reference reali con link e cosa
  prendi, palette con contrasto, tipografia con licenza, forme, movimento, usabilità, pro/contro/
  rischi, token per il piano 4), più: **quali marchi ti ispirano e cosa NON copi**, e, se c'è,
  la **scheda della mascotte** (forma, dove compare, fotogrammi dell'animazione, come si spegne).
- `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844), come
  nel primo giro.
- **`04-stati.svg` (1440 × 900)**, nuova: una tavola con (a) stato vuoto «Da rivedere» senza
  niente da fare, (b) attesa «Sto leggendo l'estratto conto…» con la micro-animazione mostrata in
  3-4 fotogrammi affiancati, (c) conferma con annulla («Bolletta confermata · Annulla»), (d) errore
  («Il file non sembra un estratto conto»), (e) un pezzo della Home nel tema scuro. Se la proposta
  ha la mascotte, mostrala qui nei suoi stati.
- SVG puro, autosufficiente, valido con `xmllint --noout`; controlla ogni SVG convertito in PNG
  (`rsvg-convert -w 1440 file.svg -o <cartella temporanea>/x.png`, poi guarda il PNG) e correggi
  testi sovrapposti, tagliati o illeggibili. Non salvare PNG nel repository.
- Scrivi solo nella tua cartella. Nessun commit, push o ramo.
