# 01 · Classico «private banking»

**L'idea in una frase:** l'app ha l'aria di un estratto conto di una banca privata italiana ben stampato: carta avorio, inchiostro blu notte, titoli in un serif editoriale, cifre in colonna e un solo tocco d'oro, così ogni settimana si apre con la calma di chi sa che i conti tornano.

Schermate: `01-home.svg` (Home 1440 × 900), `02-conguaglio.svg` (Berchet, scheda Conguaglio, 1440 × 900), `03-mobile.svg` (telefono, sola lettura, 390 × 844).

## Reference trovate online

| Riferimento                                                                                                                                                                                                                                                              | Cosa prendo                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Indulge Digital, _Private banking app_](https://indulge.digital/work/private-banking-app) e [_Top 10 UX tips for private wealth banking apps_](https://indulge.digital/intelligence/articles/top-10-ux-tips-private-wealth-banking-apps)                                | L'idea che in un'app «private» il lusso è la calma: poche informazioni per schermata, gerarchia netta, nessun effetto. Da qui la Home con tre card e quattro cose da fare, non di più. |
| [Loki, template _Signature Wealth_](https://loki.build/templates/signature-wealth/) e [_Legacy Fintech_](https://loki.build/templates/legacy-fintech/)                                                                                                                   | Titoli in serif con dati in sans di precisione e filetti sottili come struttura. Riprendo la coppia serif per i titoli e grotesk per le cifre.                                         |
| [Golden Suisse, _Back Office Dashboard_ (Dribbble)](https://dribbble.com/shots/23886620-Golden-Suisse-Back-Office-Dashboard-Design-Product-Design)                                                                                                                       | L'oro usato solo per evidenziare il punto che conta. Qui l'oro segna solo la voce attiva della barra laterale, il contatore di «Da rivedere» e la scheda aperta.                       |
| [Kombai, sezione card con avorio, verde foresta e oro](https://ww2.kombai.com/gallery/inspirations/card-web-90/)                                                                                                                                                         | La combinazione cromatica esatta: sfondo avorio caldo, verde bottiglia per le azioni, oro smorzato come accento, titoli serif.                                                         |
| [Veza Digital, _Fintech & Finance Web Design Trends 2026_](https://vezadigital.com/post/fintech-web-design-trends) e [Digidop, _2026 Design Trends for Finance Websites_](https://www.digidop.com/blog/2026-design-trends-for-finance-websites)                          | La tendenza 2026 verso una finanza che sembra «familiare», non futuristica, con palette neutre e bordi leggeri. Conferma che il classico oggi non è fuori moda.                        |
| [Creative Bloq, _Top typography trends for 2026_](https://www.creativebloq.com/design/fonts-typography/breaking-rules-and-bringing-joy-top-typography-trends-for-2026)                                                                                                   | Il ritorno dei serif editoriali e caldi nelle interfacce: giustifica un serif nei titoli anche in un'app gestionale.                                                                   |
| [Newsreader di Production Type (Google Fonts)](https://productiontype.com/family/newsreader) e [abbinamento Inter + Newsreader](https://maxibestof.one/typefaces/inter/pairing/newsreader)                                                                               | Il font dei titoli: serif progettato per la lettura a schermo, con tagli ottici, libero (OFL), già provato insieme a Inter.                                                            |
| [We Wealth, _Nuova app di Banca Generali_](https://www.we-wealth.com/news/nuova-app-banca-generali-innovazione-ai-private-banker) e [Fideuram Direct](https://group.intesasanpaolo.com/it/newsroom/tutte-le-news/news/2025/digital-wealth-management-belgio-lussemburgo) | Il registro delle banche private italiane: tono sobrio, blu profondo, frasi brevi e cortesi («Buongiorno, Carlo.»). Nessun elemento grafico copiato: solo il tono.                     |

## Palette

| Token                  | Esadecimale                                                   | Ruolo                                               |
| ---------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `color.bg`             | `#F7F3EA`                                                     | Sfondo pagina, avorio caldo                         |
| `color.surface`        | `#FFFDF8`                                                     | Card, tabelle, campi                                |
| `color.surface.sunken` | `#F1EBDD`                                                     | Controlli segmentati, scorciatoie, riga aperta      |
| `color.rule`           | `#E3DCCB`                                                     | Filetti e bordi (1 px)                              |
| `color.text`           | `#1C2433`                                                     | Testo principale, inchiostro blu notte              |
| `color.text.muted`     | `#5C6370`                                                     | Testo secondario, intestazioni di colonna           |
| `color.nav`            | `#15233A`                                                     | Barra laterale e barra in basso del telefono        |
| `color.nav.text`       | `#F2EBDD` / `#D6D9DF`                                         | Testo nella barra laterale (attivo / normale)       |
| `color.primary`        | `#1E4A38`                                                     | Verde bottiglia: pulsante principale, link d'azione |
| `color.accent.gold`    | `#B8965A` (su blu) · `#8C6C38` (su avorio, solo maiuscoletto) | Accento: voce attiva, contatore, sovrattitoli       |
| `color.success` / bg   | `#2E6B47` / `#E6EFE6`                                         | Semaforo verde, «Saldato»                           |
| `color.warning` / bg   | `#8A5A0B` testo, `#B07A16` icona / `#F6EBCF`                  | Semaforo giallo, «Parziale»                         |
| `color.danger` / bg    | `#9E2B25` / `#F5E1DD`                                         | Semaforo rosso, «Da pagare», importi negativi       |
| `color.info` / bg      | `#15233A` / `#E4E8EF`                                         | «Da rimborsare» (neutro: non è un errore)           |

Contrasto WCAG (calcolato):

- Testo principale `#1C2433` su avorio `#F7F3EA`: **14,0 : 1**; su superficie `#FFFDF8`: 15,3 : 1 (AAA).
- Testo secondario `#5C6370` su avorio: 5,5 : 1 (AA).
- Testo del pulsante `#FFFDF8` su verde `#1E4A38`: 9,9 : 1.
- Testo barra laterale `#D6D9DF`/`#F2EBDD` su `#15233A`: oltre 11 : 1; oro `#B8965A` su blu: 5,7 : 1.
- Stati su fondo chip: verde 5,4 : 1, ocra 5,0 : 1, rosso 5,9 : 1 (tutti AA).
- L'oro su avorio (`#9A7B45`, 3,9 : 1) non si usa mai per testo normale: solo filetti decorativi; i sovrattitoli in oro usano `#8C6C38` in maiuscoletto semibold.

## Tipografia

- **Titoli:** [Newsreader](https://fonts.google.com/specimen/Newsreader) (OFL), taglio Display per 28-40 px, Regular, senza grassetto. Fallback: Libre Baskerville, Baskerville, Georgia, serif. Nelle anteprime PNG il rendering usa Baskerville perché Newsreader non è installato: l'effetto è molto simile.
- **Interfaccia e dati:** [Inter](https://fonts.google.com/specimen/Inter) (OFL) con cifre tabellari (`font-variant-numeric: tabular-nums`) per tutti gli importi, allineati a destra in colonna.
- **Sovrattitoli:** Inter 10-11 px semibold, maiuscoletto con spaziatura 1,4 px («BANCA E FISCO», «MERCOLEDÌ 11 NOVEMBRE 2026»).
- Scala: 40 (saluto) · 36 (titolo pagina) · 28 (nome appartamento) · 24 (titolo sezione) · 16 (pulsante, sottotitolo) · 15 (corpo, righe di tabella) · 14 (corpo secondario) · 13 (meta) · 12 (note) · 11 (maiuscoletti). Corpo minimo 14-15 px; 12 px solo per note.

## Forme, spaziatura, icone, movimento

- **Griglia** 8 pt; margine contenuto 48 px dalla barra laterale (248 px); colonne Home 3 × 344 con 32 di spazio.
- **Forme:** angoli quasi vivi (raggio 3-4 px), come carta tagliata; chip di stato a pillola (raggio 12). Niente ombre: la profondità è data da filetti da 1 px e dal passaggio avorio → bianco caldo.
- **Filetti:** sotto i titoli di sezione un filetto nero da 1 px come nei giornali finanziari; tra le righe filetti chiari. Una barra colorata da 3 px in cima alle card dice lo stato anche da lontano.
- **Icone:** lineari a 1,3-1,5 px, sobrie. Le icone di stato cambiano **forma oltre al colore**: cerchio con spunta (a posto), triangolo con punto esclamativo (da fare), rombo con croce o esclamativo (scaduto / da pagare), cerchio a metà (parziale), freccia di ritorno (da rimborsare).
- **Illustrazioni:** nessuna mascotte. L'unico ornamento è il breve filetto oro sotto il nome dell'app. Stati vuoti con una frase in serif («Niente da rivedere. Buona settimana.») e un filetto, niente disegni.
- **Movimento:** lento e breve (160-200 ms, ease-out). I blocchi del conguaglio si aprono con una tendina; le righe confermate sfumano dal giallo al bianco; il pulsante principale non pulsa mai.

## Usabilità secondo la specifica

- **Un pulsante principale per schermata**, l'unico pieno verde bottiglia: «Rivedi (3)» in Home, «Prepara il messaggio» nel Conguaglio. Le altre azioni sono link verdi con freccia o pulsanti a contorno («Registra pagamento a mano»).
- **Semafori leggibili per daltonici:** colore + forma dell'icona + frase («Tutto a posto», «2 cose da fare», «1 scadenza passata»). La barra colorata delle card è un rinforzo, mai l'unico segnale.
- **Linguaggio semplice:** frasi complete e cortesi, come una lettera della banca («Tre documenti aspettano la tua conferma»). Ogni riga di «Cose da fare» dice il prossimo passo («Conferma», «Prepara sollecito»).
- **Stato sempre visibile:** sincronizzazione in alto a destra, data dell'ultimo estratto conto a piè di pagina, nota sul conguaglio che conta solo le voci trovate nell'estratto conto.

## Pro, contro e rischi

**Pro**

- Trasmette fiducia e precisione: giusto per un'app che maneggia soldi di altri.
- Invecchia bene: è uno stile che non segue una moda, difficilmente stanca dopo un anno.
- Le cifre tabellari in colonna rendono i conguagli confrontabili a colpo d'occhio.
- Regge su Windows: Inter e Newsreader si distribuiscono con l'app, nessun effetto di vetro o sfocatura che su Windows rende male.

**Contro e rischi**

- Può sembrare freddo o «da banca» rispetto ai riferimenti amichevoli della specifica (Duolingo, Handy). Lo compensano il saluto e le frasi cortesi, ma la personalità resta sobria.
- Il serif a 24-40 px è elegante; sotto i 20 px perde leggibilità a schermo: va usato **solo** per titoli.
- L'avorio su monitor economici o mal calibrati può sembrare giallino: tenere il token regolabile e provarlo sul PC di Nicola.
- Il rischio maggiore è l'abuso dell'oro: se finisce su pulsanti o importi lo stile diventa pacchiano. Regola: oro solo per indicare «dove sei».
- Il tema scuro non è immediato (blu notte + avorio invertiti) e va progettato a parte.

## Token per l'implementazione (piano 4)

Tre livelli, come variabili CSS consumate da Tailwind (`theme.extend`) nel frontend Tauri:

```css
:root {
  /* primitivi */
  --ivory-50: #fffdf8;
  --ivory-100: #f7f3ea;
  --ivory-200: #f1ebdd;
  --ivory-300: #e3dccb;
  --navy-900: #15233a;
  --navy-800: #1c2433;
  --slate-500: #5c6370;
  --bottle-700: #1e4a38;
  --gold-400: #b8965a;
  --gold-600: #8c6c38;
  --green-600: #2e6b47;
  --ochre-600: #8a5a0b;
  --ochre-500: #b07a16;
  --red-700: #9e2b25;

  /* semantici */
  --color-bg: var(--ivory-100);
  --color-surface: var(--ivory-50);
  --color-rule: var(--ivory-300);
  --color-text: var(--navy-800);
  --color-text-muted: var(--slate-500);
  --color-primary: var(--bottle-700);
  --color-on-primary: var(--ivory-50);
  --color-accent: var(--gold-400);
  --color-nav: var(--navy-900);
  --color-success: var(--green-600);
  --color-warning: var(--ochre-600);
  --color-danger: var(--red-700);

  --font-display: 'Newsreader', 'Libre Baskerville', Georgia, serif;
  --font-ui: 'Inter', system-ui, sans-serif;
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-pill: 999px;
  --space-1: 8px; /* scala 8, 16, 24, 32, 48 */
  --motion-fast: 160ms;
  --motion-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
}
```

Componenti: `Button.primary` (bottle, alto 48-52), `Button.secondary` (contorno), `Link.action` (verde con freccia), `StatusBadge` (prop `stato`: `ok | da-fare | scaduto | parziale | rimborso`, sempre icona + testo), `Amount` (Inter tabellare, negativo con `- €`), `SectionTitle` (Newsreader 24 + filetto 1 px).
