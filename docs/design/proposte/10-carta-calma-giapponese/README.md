# 10 — Carta calma

**L'idea in una frase:** l'app come un quaderno di casa ben tenuto, con carta calda, righe a inchiostro, un timbro rosso quando un conto è saldato e tanto spazio vuoto. È l'opposto di un'app finanziaria che mette ansia.

Ispirazione giapponese (Muji, _wabi-sabi_, _ma_ cioè lo spazio vuoto come elemento attivo) unita alla _calm technology_: l'app chiede attenzione solo quando serve, e il resto del tempo dice soltanto «è tutto in ordine».

| Schermata                             | File                |
| ------------------------------------- | ------------------- |
| Home desktop 1440 × 900               | `01-home.svg`       |
| Berchet, scheda Conguaglio 1440 × 900 | `02-conguaglio.svg` |
| Telefono, sola lettura 390 × 844      | `03-mobile.svg`     |

---

## Reference reali e cosa prendo da ognuna

1. **Amber Case, _Principles of Calm Technology_** ([caseorganic.com](https://www.caseorganic.com/post/principles-of-calm-technology), [Calm Tech Institute](https://www.calmtech.institute/post/creating-a-calm-tech-experience), [O'Reilly](https://oreilly.com/content/principles-calm-technology-we-are-not-bad-at-technology-technology-is-bad-at-us)). Prendo l'idea che la tecnologia debba «informare e creare calma» e passare dalla periferia al centro dell'attenzione solo quando serve. Per questo la Home dice prima «Il resto è in ordine» e mette i problemi in quattro righe sobrie, senza badge rossi ovunque.
2. **Kenya Hara e Muji: il vuoto, non il minimalismo** ([Quartz](https://qz.com/quartzy/1140182/mujis-design-philosophy-is-emptiness-not-minimalism-says-kenya-hara), [Muji, _The art of simple design_](https://uk.muji.eu/pages/muji-stories/the-art-of-simple-design.html), [Lars Müller, _White_](https://www.lars-mueller-publishers.com/white)). Il bianco come contenitore che si riempie. Ne derivano i margini larghi, una sola grande scritta per schermata e nessuna decorazione che non porti informazione.
3. **MUJI design system (riassunto di terze parti)** ([shadcn.io/design/muji](https://www.shadcn.io/design/muji)). Una tela color carta, un solo accento rosso scuro e pochissimi colori. Uso il rosso solo per il timbro e il marchio, mai per decorare. È un riassunto non ufficiale: lo prendo come spunto, non come fonte.
4. **Trend _wabi-sabi_ e _Japanese minimalism_ nella UI** ([daisyUI trends: wabi-sabi](https://trends.daisyui.com/trend/wabi-sabi/), [daisyUI: Japanese minimalism](https://trends.daisyui.com/trend/japanese-minimalism/), [Fireart, _Japanese Minimalism in UI_](https://fireart.studio/blog/japanese-minimalism-in-ui-design-for-digital-products/)). Toni terrosi smorzati, texture organiche appena percepibili e piccole irregolarità volute, come le righe a inchiostro che non sono mai perfettamente dritte e il nastro di carta storto sulle card.
5. **Trend grafici 2026: texture, calore, materia** ([Creative Bloq, _Texture, warmth and tactile rebellion_](https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026), [_Human-centric web design trends 2026_](https://locallylost-project.pages.dev/guides/human-centric-web-design-trends-2026/), [Updivision, _UI color trends 2026_](https://updivision.com/blog/post/ui-color-trends-to-watch-in-2026)). Bianchi caldi al posto del #FFFFFF e ombre in tono caldo invece che nere. Soprattutto la regola di **un solo strato di grana, al 3-8 % di opacità**, mai una texture per ogni componente: è il limite che separa «carta» da «effetto carta datato».
6. **Template «Washi Soken» e «Solo Ledger» (Kombai)** ([Washi Soken](https://kombai.com/examples/templates/washi-soken), [Solo Ledger](https://kombai.com/examples/templates/solo-ledger)). Il primo usa sigilli circolari di tipo _hanko_ e un solo accento vermiglio; il secondo trasforma una dashboard finanziaria in un registro color crema. Da qui vengono il timbro «SALDATO» e la doppia riga del totale da libro contabile.
7. **Font: Shippori Mincho e Zen Kaku Gothic New su Google Fonts** ([Shippori Mincho](https://fonts.google.com/specimen/Shippori+Mincho), [Zen Kaku Gothic New](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New/about)). Un _mincho_ nato per i romanzieri, usato per i titoli, e un sans giapponese pensato per la leggibilità, usato per tutto il resto. Due voci, come in un quaderno scritto a mano e stampato.

Su Dribbble non ho trovato uno shot specifico che unisca dashboard, registro e _hanko_. Le ricerche portano soprattutto a pagine di tag. Per questo le reference visive dirette sono i due template Kombai e i trend daisyUI.

---

## Palette

Sfondo color carta non sbiancata, inchiostro bruno al posto del nero, un indaco _aizome_ per l'unica azione principale e tre colori naturali per gli stati. Il rosso vermiglio _shu_ serve solo per il timbro e il marchio.

| Token                | Hex                                        | Ruolo                            | Contrasto su `carta`                             |
| -------------------- | ------------------------------------------ | -------------------------------- | ------------------------------------------------ |
| `carta`              | `#F4EFE6`                                  | sfondo pagina                    | —                                                |
| `foglio`             | `#FBF8F2`                                  | superfici: card, registro, campi | —                                                |
| `dorso`              | `#ECE5D8`                                  | barra laterale                   | —                                                |
| `riga`               | `#D9CFBF`                                  | righe a inchiostro, bordi        | decorativo                                       |
| `inchiostro`         | `#2B2620`                                  | testo principale                 | **13,1 : 1** (AAA)                               |
| `inchiostro-tenue`   | `#6B6257`                                  | testo secondario                 | **5,2 : 1** (AA)                                 |
| `aizome` (primario)  | `#2F4A6B`                                  | pulsante principale, link        | 7,9 : 1; testo `foglio` sul pulsante **8,6 : 1** |
| `muschio` (successo) | `#56663A`                                  | «Tutto a posto», pagato          | 5,5 : 1 (AA)                                     |
| `ocra` (attenzione)  | `#8C6418`                                  | «Da fare», parziale, in scadenza | 4,6 : 1 (AA, al limite)                          |
| `cachi` (errore)     | `#A8532A`                                  | scaduto, da pagare, in ritardo   | 4,7 : 1 (AA, al limite)                          |
| `shu` (timbro)       | `#B0362A`                                  | timbro «SALDATO», marchio        | 5,4 : 1                                          |
| nastri di carta      | `#56663A`, `#C99A3C`, `#B8612A` al 30-40 % | nastro decorativo sulle card     | decorativo, mai unico segnale                    |

Contrasti calcolati con la formula WCAG 2.x. **Attenzione:** `ocra` e `cachi` scendono sotto 4,5 : 1 sul `dorso` (4,2 : 1), quindi non vanno usati come testo nella barra laterale. Lì gli stati si mostrano solo con `inchiostro`.

## Tipografia

- **Titoli:** _Shippori Mincho_ (OFL, Google Fonts), 600. Corpi: 40 per il saluto, 34 per il titolo della pagina, 21-22 per le sezioni, 26/19 per il nome dell'appartamento sulla card desktop/mobile.
- **Testo e numeri:** _Zen Kaku Gothic New_ (OFL, Google Fonts), 400 e 700. Corpi: 16 per il corpo e le righe da fare, 15 per gli importi, 14 per link e stati, 12,5-13 per le note, 11 maiuscoletto spaziato (+1,4) per le etichette di colonna.
- **Interlinea** generosa (1,5 sul corpo), righe di registro a 64 px, ritmo su griglia 8 pt.
- **Italiano e numeri.** I font giapponesi hanno un set latino completo, ma nella fase 4 vanno verificati `€`, `à è é ì ò ù`, `ª`, e le cifre tabellari (`font-feature-settings: "tnum"`). Se Zen Kaku non avesse cifre tabellari, per le sole colonne di importi si usa **Inter** con `tnum`, che sta bene accanto a Zen Kaku. Il formato resta `€ 1.234,56` e `- € 63,00`, con importi sempre allineati a destra nel registro. L'italiano è circa il 30 % più lungo dell'inglese, per questo nessun testo ha larghezza fissa e le colonne del registro hanno etichette su due righe («DA PAGARE / RIMBORSARE»).
- _Nota sulle anteprime:_ i font non sono installati sulla macchina di prova, quindi i PNG sono resi con i fallback di sistema Hiragino Mincho e Hiragino Sans, molto simili per carattere. Negli SVG `font-family` nomina prima il font scelto, poi il fallback Hiragino e infine il generico.

## Forme, spaziatura, icone, illustrazioni, movimento

- **Forme.** Fogli rettangolari con raggio 4 (carta, non pillole), pulsanti e selettori a pillola (raggio pieno) perché siano l'unica cosa «morbida» e quindi cliccabile. Ombra unica, calda e larga (`0 3 8 rgba(90,70,48,.09)`).
- **Righe a inchiostro.** Separatori e righe di registro sono linee leggermente irregolari (filtro di spostamento a bassa frequenza, 2 px). Il registro ha il **margine rosso doppio** dei quaderni e la **doppia riga** sopra il totale, come nei libri contabili.
- **Spaziatura.** Griglia 8 pt; margini di pagina 56 px; 24 px tra le card; 64 px per le righe del registro. Il vuoto è voluto: al massimo quattro cose da fare.
- **Icone.** Tratto sottile 1,4 px, angoli arrotondati, nessun riempimento. **Gli stati hanno tre forme diverse:** cerchio con spunta (a posto), cerchio pieno a metà come una luna (da fare), triangolo con punto esclamativo (scaduto). Accanto c'è sempre la parola.
- **Elementi decorativi.** Un pezzo di nastro di carta _washi_ in cima a ogni card, nel colore dello stato (ridondante, mai unico segnale). Il timbro **SALDATO** in vermiglio, rettangolare con doppio bordo e grana d'inchiostro. Il marchio è un piccolo sigillo quadrato con la «B». Niente mascotte: il «personaggio» è il quaderno.
- **Stato vuoto.** Quando non c'è niente da fare, al posto della lista compare una pagina a righe vuota con una frase sola: «Niente da fare oggi. Il quaderno è in ordine.» Errori: riquadro `foglio` con bordo `cachi` tratteggiato, frase che dice cosa fare e un solo pulsante.
- **Movimento (lento e gentile).**
  - Transizioni di pagina: dissolvenza con salita di 4 px, 280 ms, `cubic-bezier(.2,.7,.2,1)`.
  - Spunta di una cosa fatta: il cerchio si traccia come un tratto di pennello (`stroke-dashoffset`, 500 ms), poi la riga sbiadisce e scivola via (300 ms).
  - Timbro: quando un conguaglio risulta saldato dal CSV, il timbro appare con scala 1,12 → 1, rotazione −2° → −6° e opacità 0 → 0,9 in 320 ms, con un leggero rimbalzo, come una mano che preme. Succede una volta sola e mai in automatico mentre si scorre.
  - Sincronizzazione: il puntino `muschio` «respira» (opacità 0,6 ↔ 1, 2,4 s) solo mentre sincronizza.
  - `prefers-reduced-motion`: tutto diventa dissolvenze da 120 ms, il timbro appare senza movimento.

## Come rispetta i principi di usabilità (sezione 15)

- **Un solo pulsante principale.** È l'unico elemento pieno in `aizome` della schermata («Rivedi (3)», «Prepara il messaggio»). Le azioni secondarie sono link testuali («Ricalcola», «+ Registra pagamento a mano»). Il contrasto tra carta e indaco lo rende impossibile da mancare.
- **Semafori leggibili anche per daltonici.** Colore, forma dell'icona e parola insieme («Tutto a posto», «2 cose da fare», «1 scadenza passata»). Muschio, ocra e cachi differiscono anche per luminosità, non solo per tinta. Nell'app del telefono chi non ha pagato ha anche un cerchio **tratteggiato**.
- **Linguaggio semplice.** Frasi complete e colloquiali: «Tre cose aspettano una tua occhiata. Il resto è in ordine.», «manca Giulia R.», «Posto vuoto da settembre a novembre 2025: € 135,79 restano a carico del proprietario.»
- **Stato sempre visibile.** Avanzamento del conguaglio Calcolato → Inviato → Saldato in cima alla scheda; sincronizzazione in alto a destra; «Quaderno aggiornato stamattina alle 08:42» nella barra laterale.
- **Conferma e annulla.** Ogni operazione recente ha «Ripristina». Il timbro si toglie dal menu della riga con conferma.
- **Riferimenti della specifica (Revolut, Notion, Handy, Duolingo).** Di Notion prende la pagina come documento calmo, di Duolingo il piccolo momento di soddisfazione (il timbro). Di Revolut prende meno: niente grafici nervosi.

## Pro, contro e rischi

**Pro**

- Toglie ansia a un compito che ne ha molta (soldi, inquilini, scadenze). Aprire l'app non sembra aprire la banca.
- Gerarchia chiarissima: tanto vuoto, una sola cosa scura e piena per schermata.
- Il timbro rende memorabile il momento in cui un conguaglio è chiuso: piccola ricompensa, utile per un'app usata ogni settimana.
- Regge bene su Windows: niente trasparenze o sfocature costose, solo colori piatti, un'ombra e una texture statica che si può pre-renderizzare in un PNG piastrellato.

**Contro e rischi**

- **Rosso del timbro contro rosso dell'errore.** Il vermiglio _shu_ (saldato = buono) è vicino al `cachi` (scaduto = cattivo). È mitigato da forma (rettangolo-timbro contro triangolo), parola e tono (cachi più arancio e bruno), ma va provato con Nicola. Alternativa pronta: timbro in `muschio`.
- **Ocra e cachi sono al limite AA** (4,6-4,7 : 1). Basta poco a scendere sotto. Vanno usati solo in grassetto e da 13,5 px in su, mai sul `dorso`.
- **Texture e linee irregolari** costano rendering se fatte con filtri SVG dal vivo. In produzione: una PNG di grana da 256 px piastrellata e righe disegnate come SVG statici.
- **Stancherà dopo un anno?** Il rischio è basso perché la decorazione è poca (grana, nastro, timbro) e il resto è tipografia. Il nastro _washi_ è l'elemento più «di moda»: si può spegnere senza perdere nulla.
- **Leggibile per Nicola?** Corpi 15-16 px, contrasto del testo principale 13 : 1, nessun gergo. Il _mincho_ va usato solo nei titoli (≥ 17 px): nei testi piccoli le grazie sottili si perdono, soprattutto su schermi Windows a 100 %.
- **Font giapponesi pesanti** (molti MB per i glifi kanji). Nell'app Tauri si includono solo i sottoinsiemi latini (`unicode-range`), poche decine di KB.
- **Modalità scura** non disegnata: andrebbe pensata come «carta di notte» (fondo `#22201C`, inchiostro `#E9E2D6`), senza grana.

## Token per l'implementazione (piano 4)

Tre livelli (primitivi → semantici → componenti), come variabili CSS, con un `tailwind.config` che le legge.

```css
:root {
  /* primitivi */
  --paper-50: #fbf8f2;
  --paper-100: #f4efe6;
  --paper-200: #ece5d8;
  --paper-300: #d9cfbf;
  --ink-900: #2b2620;
  --ink-600: #6b6257;
  --ink-400: #8d8273;
  --aizome-700: #2f4a6b;
  --moss-700: #56663a;
  --ochre-700: #8c6418;
  --kaki-700: #a8532a;
  --shu-700: #b0362a;

  /* semantici */
  --color-bg: var(--paper-100);
  --color-surface: var(--paper-50);
  --color-sidebar: var(--paper-200);
  --color-rule: var(--paper-300);
  --color-text: var(--ink-900);
  --color-text-muted: var(--ink-600);
  --color-primary: var(--aizome-700);
  --color-on-primary: var(--paper-50);
  --color-status-ok: var(--moss-700);
  --color-status-todo: var(--ochre-700);
  --color-status-late: var(--kaki-700);
  --color-stamp: var(--shu-700);

  --font-display: 'Shippori Mincho', serif;
  --font-body: 'Zen Kaku Gothic New', sans-serif;
  --font-figures: 'Zen Kaku Gothic New', 'Inter', sans-serif; /* con tnum */
  --text-xs: 11px;
  --text-sm: 12.5px;
  --text-md: 14px;
  --text-base: 16px;
  --text-lg: 21px;
  --text-xl: 34px;
  --text-2xl: 40px;

  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-7: 56px;
  --radius-sheet: 4px;
  --radius-pill: 999px;
  --shadow-sheet: 0 3px 16px rgba(90, 70, 48, 0.09);
  --texture-paper: url(paper-grain.png);
  --texture-opacity: 0.06;

  --ease-calm: cubic-bezier(0.2, 0.7, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 280ms;
  --dur-stamp: 320ms;
  --dur-ink: 500ms;
}
```

Componenti da definire con questi token: `StatusLabel` (icona, parola e colore insieme, mai separabili), `SheetCard` (foglio con nastro opzionale), `LedgerTable` (righe a inchiostro, margine rosso, doppia riga del totale, colonne numeriche allineate a destra con `tnum`), `Stamp` (variante `saldato`, animazione una sola volta), `PrimaryButton` (uno per vista, con controllo in revisione del codice), `InkRule`.
