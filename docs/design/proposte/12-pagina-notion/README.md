# 12 · Pagina di casa

**L'idea in una frase:** ogni schermata dell'app è una pagina di un quaderno digitale: icona e
titolo grande in testa, proprietà in due righe, un callout grigio che dice cosa succede, poi blocchi
(galleria, tabella-database, toggle, caselle da spuntare) in bianco e nero caldo, con gli stati come
pillole tenui. Un piccolo personaggio a tratto, **Casetta**, fa da icona della Home e compare solo
negli stati vuoti e in attesa.

| Schermata                                  | File                |
| ------------------------------------------ | ------------------- |
| Home desktop 1440 × 900                    | `01-home.svg`       |
| Berchet, scheda Conguaglio 1440 × 900      | `02-conguaglio.svg` |
| Telefono, sola lettura 390 × 844           | `03-mobile.svg`     |
| Stati, mascotte e tema scuro 1440 × 900    | `04-stati.svg`      |

---

## Marchi che ispirano e cosa NON copio

- **Notion** (ispirazione principale). Prendo la grammatica: pagina come documento, icona di pagina
  sopra un titolo grande, righe di proprietà con etichetta grigia, callout, toggle, viste di database
  (Galleria | Tabella) con proprietà a pillole tenui, barra laterale ad albero con le pagine figlie.
  **Non copio:** il logo (la «N» nel cubo), il nome, le emoji come icone di pagina, i font della
  casa (la variante proprietaria di Inter e i caratteri del marchio), le illustrazioni di Roman
  Muradov o personaggi riconoscibili, i colori esatti dei tag. La mascotte è un soggetto diverso
  (una casa, non una persona), disegnato con un tratto uniforme e geometrico, non gestuale.
- **App di elenchi da spuntare** (in secondo piano): la riga con casella che si barra e scorre via.
  Qui le caselle sono quadrate perché lo stato «da fare» è già un cerchio.

L'interfaccia non contiene marchi di terzi: il nome dell'app è «Bollette di casa» con un quadratino
«B» neutro.

## Reference reali e cosa prendo

1. **Notion, «The thinking behind our latest brand campaign»**
   ([notion.com/blog](https://www.notion.com/blog/the-thinking-behind-our-latest-brand-campaign)).
   Conferma che il marchio nasce in bianco e nero con illustrazioni a tratto. Prendo il bianco e nero
   come base e il colore solo dove serve (qui: le pillole di stato).
2. **Roman Muradov, corso «Brand Illustration»**
   ([Skillshare](https://www.skillshare.com/en/classes/brand-illustration-create-unforgettable-stylized-brand-imagery/1636459821))
   e la guida di terze parti sullo «stile Notion»
   ([getillustrations.com](https://getillustrations.com/blog/notion-style-illustrations-how-to-use-them-in-templates-websites-and-saas-products/)).
   Linee nere su fondo bianco, invertite nel tema scuro, pochi tratti, niente ombre. Da qui il
   principio di Casetta: stesso spessore di linea delle icone, riempimento solo del colore della
   pagina. Non riproduco il tratto gestuale di Muradov, che richiederebbe un illustratore.
3. **Notion Help, «Style & customize your page»**
   ([notion.com/help](https://www.notion.com/it/help/customize-and-style-your-content)) e
   **Thomas Frank, «Callouts – My Favorite Block»**
   ([thomasjfrank.com](https://thomasjfrank.com/learn-notion/callouts-my-favorite-block/)). Icona e
   titolo della pagina, callout come blocco con icona e fondo colorato. Il callout grigio in cima a
   ogni pagina è il «cosa devi sapere» della schermata.
4. **Matthias Frank, «Notion colors»** ([matthiasfrank.de](https://matthiasfrank.de/en/notion-colors/)).
   La palette chiusa di una decina di colori, con varianti testo e sfondo. Prendo la regola: ogni
   colore ha una coppia «sfondo tenue + testo scuro», mai testo colorato su bianco.
5. **Design Compass sull'identità di Notion**
   ([designcompass.org](https://designcompass.org/en/2025/01/20/notion/)) e **Buck, «Notion — Think it.
   Make it.»** ([buck.co](https://buck.co/work/notion-think-it-make-it)). Il sito usa Inter come base
   tipografica; il marchio resta monocromo e rigoroso anche quando aggiunge colore. Uso Inter (OFL)
   per l'interfaccia, ma non la variante proprietaria.
6. **«Blocks, not pages» e i trend 2026 sulle interfacce modulari**
   ([Design Systems Collective](https://www.designsystemscollective.com/composable-interfaces-why-the-future-of-ux-is-built-in-blocks-not-pages-c9263ff42681),
   [UXPin, trend 2026](https://uxpin.com/studio/blog/ui-ux-design-trends/)). L'interfaccia come pila
   di blocchi componibili. Qui i blocchi sono fissi (Carlo e Nicola non devono costruirsi le
   pagine), ma il linguaggio è lo stesso: si legge dall'alto in basso come un documento.
7. **Newsreader di Production Type**
   ([GitHub, licenza OFL](https://www.github.com/productiontype/Newsreader),
   [productiontype.com](https://productiontype.com/family/newsreader)). Serif per lo schermo con taglio
   «Display» per i titoli grandi: dà il tono di pagina scritta che in Notion dà lo stile «Serif».

## Palette

Bianco e nero caldo: il nero è un bruno molto scuro, il grigio della barra laterale tende alla carta.
Il **pulsante principale è nero caldo**, che non è un colore di stato. Gli stati sono pillole con
fondo tenue e testo scuro, sempre con un'icona di forma propria.

| Token                     | Chiaro (fondo / testo) | Scuro (fondo / testo) | Ruolo                            | Contrasto chiaro · scuro |
| ------------------------- | ---------------------- | --------------------- | -------------------------------- | ------------------------ |
| `page`                    | `#FFFFFF`              | `#1D1C1A`             | sfondo pagina                    | —                        |
| `side`                    | `#F7F6F3`              | `#232220`             | barra laterale                   | —                        |
| `callout`                 | `#F3F2EF`              | `#262522`             | callout, campi, ricerca          | —                        |
| `sel`                     | `#EBEAE6`              | `#33312E`             | voce selezionata                 | —                        |
| `rule`                    | `#E9E7E2`              | `#34322F`             | righe e bordi                    | decorativo               |
| `text`                    | `#2F2C28`              | `#ECEAE5`             | testo principale                 | **13,9** · **14,2**      |
| `muted`                   | `#6E6A63`              | `#A29E96`             | etichette, ore, note             | 5,4 (4,8 sul callout) · 6,4 |
| `primary` / `on-primary`  | `#2F2C28` / `#FFFFFF`  | `#ECEAE5` / `#1D1C1A` | pulsante principale              | **13,9** · **14,2**      |
| `green` (in regola, saldato)    | `#E3EFE5` / `#1E5631` | `#22372A` / `#A6DCB4` | pillola                     | **7,3** · **8,2**        |
| `yellow` (da fare)        | `#F7ECCF` / `#5E4200`  | `#3A3017` / `#EDCB7C` | pillola                          | **7,9** · **8,3**        |
| `red` (scaduto, da pagare) | `#F9DDD8` / `#821F15` | `#46231F` / `#F4AEA4` | pillola; saldo negativo su bianco 9,7 | **7,6** · **7,5**   |
| `purple` (parziale)       | `#ECE5F5` / `#5A3A86`  | `#2F2640` / `#CDB6EE` | pillola                          | **7,2** · **7,8**        |
| `blue` (da rimborsare)    | `#E0EBF6` / `#174A78`  | `#1E3247` / `#A5CBF0` | pillola                          | **7,6** · **7,7**        |
| `gray` (neutro, tag)      | `#EDECE9` / `#46433D`  | `#2E2C29` / `#CFCBC3` | tag neutri, avatar               | **8,3** · **8,6**        |

Rapporti calcolati con la formula WCAG 2.x. Tutto il testo di stato piccolo (pillole a 13 px) è
**≥ 7:1** in entrambi i temi. Il testo `muted` (≥ 4,5:1) non si usa mai per stati, solo per
etichette e ore; sul callout scende a 4,8:1, quindi lì il testo del callout è sempre `text`.

## Tipografia

- **Titoli di pagina (≥ 24 px):** *Newsreader* (SIL OFL 1.1, Google Fonts), 600. 40 px per il
  saluto della Home, 36 per il titolo di pagina, 32 per le tavole, 28-30 sul telefono. Il serif non
  scende mai sotto i 24 px (regola ClearType).
- **Tutto il resto:** *Inter* (SIL OFL 1.1), 400/500/600, con cifre tabellari (`tnum`) negli
  importi. Scala: 13 (pillole, etichette di colonna, note), 14 (proprietà, righe secondarie), 15
  (righe di elenco, celle), 16 (nomi nelle card), 18 (titoli di sezione), 20 (titoli di pannello).
  Corpo base 15 px su desktop.
- *Nota sulle anteprime:* Newsreader non è installato sulla macchina di prova, quindi i PNG mostrano
  il fallback **Charter**; Inter è reso con il font vero. Negli SVG `font-family` è
  `Newsreader, Charter, Georgia, serif` e `Inter, 'Segoe UI', system-ui, sans-serif`.

## Forme degli stati

Ogni stato ha una forma propria; la parola è sempre dentro la pillola.

| Stato                       | Forma                               | Colore  |
| --------------------------- | ----------------------------------- | ------- |
| In regola, saldato          | cerchio pieno con spunta            | verde   |
| Da fare, in scadenza        | cerchio vuoto pieno a metà          | giallo  |
| Scaduto                     | triangolo pieno con «!»             | rosso   |
| Parziale                    | rombo pieno a metà                  | viola   |
| Da pagare                   | quadrato vuoto (casella da riempire) | rosso  |
| Da rimborsare               | freccia di ritorno                  | blu     |

«In regola» e «saldato» condividono forma perché hanno lo stesso significato (niente da fare).
«Scaduto» e «da pagare» condividono il rosso ma non la forma (triangolo contro quadrato).

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt.** Colonna di pagina larga 1000 px centrata nell'area di lavoro, margini 100 px.
  Righe di elenco 44 px, righe di tabella 40 px, toggle 36 px.
- **Raggi piccoli:** 4 px pillole, 6 px pulsanti e callout, 8 px card della galleria. Nessuna ombra:
  i livelli si separano con righe `rule` da 1 px e con il grigio del callout.
- **Icone a tratto** 16 px, linea 1,4 px, angoli arrotondati, nessun riempimento: casa, vassoio,
  palazzo, calendario, frecce, ricevuta, fulmine, fiamma, goccia, wifi, cestino.
- **Blocchi:** callout grigio in testa; galleria per gli appartamenti (alternativa «Tabella»);
  tabella-database con icona per ogni colonna e riga dei calcoli in fondo («Somma», «Netto»);
  toggle per i blocchi delle bollette, con filo verticale che lega i figli; caselle da spuntare
  per le cose da fare.
- **Movimento:** apertura toggle 160 ms con rotazione del triangolino; spunta di una cosa da fare:
  la casella si riempie (120 ms), la riga si barra e dopo 8 s scorre via, con «Annulla» nel toast;
  pagine in dissolvenza 120 ms. Con «riduci movimento» restano solo cambi istantanei.

## Scheda della mascotte: Casetta

| Voce              | Dettaglio |
| ----------------- | --------- |
| **Forma**         | Una casetta a tratto: tetto a capanna, comignolo, muri appena irregolari, due occhi a punto, bocca neutra a filo, due gambette, un braccio con una matita. Disegnata in un riquadro 100 × 100 con linea 3,2 (≈ 1,6 px a 48 px), riempimento del colore della pagina, inchiostro `text`. Nel tema scuro le linee diventano chiare e il riempimento scuro: si inverte, non si ridisegna. |
| **Carattere**     | Neutra o attenta. Non sorride ai soldi e non si preoccupa: scrive, legge, riposa. Mai lacrime, sudore o festa. |
| **Dove compare**  | (1) icona di pagina della Home, 48-52 px, lontana dalle card; (2) intestazione dell'app sul telefono, 40 px; (3) stato vuoto, 120 px, occhi chiusi e matita giù; (4) attesa («Sto leggendo l'estratto conto…»), 48 px nella riga di avanzamento. **Mai** in tabelle, righe di elenco, card con importi, toast o errori. Al massimo una per schermata. |
| **Taglie**        | 48 px versione completa; 24 px senza bocca e linea più spessa; 16 px senza matita (solo casa con occhi). Sotto i 16 px non si usa. |
| **Fotogrammi**    | Attesa in 4 fotogrammi da 600 ms in ciclo (`steps(4)` in CSS, o 4 `<g>` alternati): 1 matita all'inizio del foglio; 2 prima riga a metà; 3 prima riga piena, seconda a metà; 4 due righe piene, terza in corso. Gli occhi guardano il foglio. Nessun movimento del corpo. Stato vuoto: statico (al massimo un battito di palpebre ogni 6 s, 2 fotogrammi). |
| **Come si spegne** | Impostazioni › Aspetto: «Mostra Casetta» (spenta: al suo posto l'icona a tratto della pagina, per esempio il vassoio o la casa), «Animazioni» (spente: solo il fotogramma 1), «Segui riduci movimento» (attivo di default: con `prefers-reduced-motion` si mostra il fotogramma 1 e il testo di avanzamento). |
| **Realizzazione** | Un solo SVG con tracciati semplici e varianti per prop (`eyes`, `pencil`, `frame`), senza illustratore. |

## Come rispetta i principi di usabilità

- **Un solo pulsante principale** per schermata, nero caldo pieno, in alto a destra all'altezza del
  titolo: «Rivedi (3)», «Prepara il messaggio», «Importa un estratto conto», «Scegli un altro
  file». Il resto è link, toggle o filtro. Nessuna azione che l'app non fa («Prepara il messaggio»,
  non «Invia» o «Paga»).
- **Semafori leggibili senza colore:** forma + parola in ogni pillola; nella barra laterale le tre
  case hanno la stessa icona di stato.
- **Linguaggio semplice:** il callout dice in una frase cosa aspetta Carlo; le note dicono da dove
  vengono i numeri.
- **Stato sempre visibile:** «Sincronizzato · 09:42» in alto, «Avanzamento: Calcolato → Inviato →
  Saldato» nella proprietà del conguaglio, barra di avanzamento nell'attesa.
- **Conferma e annulla:** toast scuro «Bolletta confermata · Annulla» con 8 s per ripensarci.
- **Doppio selettore** «Berchet · Annualità 2025-26» e ricerca «Ctrl K» nella barra in alto.

## Pro, contro e rischi

**Pro**
- Molto calma e leggibile: il bianco fa da sfondo ai pochi colori, che sono tutti stati.
- Familiare: chi ha usato un editor a blocchi riconosce subito toggle, callout e database.
- Economica da costruire: niente ombre, gradienti, texture; pochi componenti ripetuti. Regge uguale su
  Windows e Mac.
- La mascotte è un tracciato SVG di poche righe e si spegne senza perdere informazioni.

**Contro e rischi**
- **Rischio «sembra Notion».** Chi la vede può pensare a un modello di Notion, non a un'app. Lo
  mitigano il nome, i blocchi fissi (niente «/» né trascinamento) e la mascotte propria.
- **Piatta fino alla monotonia.** Tutto bianco, tutto riga sottile: dopo un anno può sembrare un
  foglio di calcolo. Il serif dei titoli e Casetta servono a dare carattere.
- **Toggle chiusi nascondono informazioni:** il totale è sempre sulla riga del toggle, così chiuso
  non vuol dire nascosto.
- **Pillole piccole (13 px):** vanno provate sul PC Windows di Nicola a 125 %; se serve si passa a 14 px.
- **Newsreader non provato a schermo** (anteprime con Charter): verificare il peso 600 a 36-40 px su
  ClearType.
- **Viola per «parziale»** è un sesto colore: se pesa, si può usare il giallo, contando sul rombo.

## Token per l'implementazione (piano 4)

```css
:root {
  /* primitivi */
  --ink-900: #2f2c28; --ink-500: #6e6a63; --paper-0: #ffffff; --paper-50: #f7f6f3;
  --paper-100: #f3f2ef; --paper-150: #ebeae6; --paper-200: #e9e7e2;
  --green-bg: #e3efe5; --green-fg: #1e5631; --yellow-bg: #f7eccf; --yellow-fg: #5e4200;
  --red-bg: #f9ddd8; --red-fg: #821f15; --purple-bg: #ece5f5; --purple-fg: #5a3a86;
  --blue-bg: #e0ebf6; --blue-fg: #174a78; --gray-bg: #edece9; --gray-fg: #46433d;

  /* semantici */
  --color-bg: var(--paper-0); --color-sidebar: var(--paper-50); --color-callout: var(--paper-100);
  --color-selected: var(--paper-150); --color-rule: var(--paper-200);
  --color-text: var(--ink-900); --color-text-muted: var(--ink-500);
  --color-primary: var(--ink-900); --color-on-primary: var(--paper-0);
  --status-ok-bg: var(--green-bg);   --status-ok-fg: var(--green-fg);
  --status-todo-bg: var(--yellow-bg); --status-todo-fg: var(--yellow-fg);
  --status-late-bg: var(--red-bg);   --status-late-fg: var(--red-fg);
  --status-partial-bg: var(--purple-bg); --status-partial-fg: var(--purple-fg);
  --status-refund-bg: var(--blue-bg); --status-refund-fg: var(--blue-fg);
  --amount-negative: var(--red-fg);

  --font-display: 'Newsreader', Charter, Georgia, serif;   /* solo ≥ 24 px */
  --font-ui: 'Inter', 'Segoe UI', system-ui, sans-serif;   /* font-feature-settings: "tnum" sugli importi */
  --text-xs: 13px; --text-sm: 14px; --text-md: 15px; --text-lg: 18px; --text-xl: 20px;
  --text-title: 36px; --text-hero: 40px;
  --space: 8px; --radius-pill: 4px; --radius-control: 6px; --radius-card: 8px;
  --row-list: 44px; --row-table: 40px; --row-toggle: 36px;
  --dur-fast: 120ms; --dur-toggle: 160ms; --mascot-frame: 600ms; --toast-undo: 8s;
}
:root[data-theme="dark"] {
  --color-bg: #1d1c1a; --color-sidebar: #232220; --color-callout: #262522; --color-selected: #33312e;
  --color-rule: #34322f; --color-text: #eceae5; --color-text-muted: #a29e96;
  --color-primary: #eceae5; --color-on-primary: #1d1c1a;
  --status-ok-bg: #22372a; --status-ok-fg: #a6dcb4; --status-todo-bg: #3a3017; --status-todo-fg: #edcb7c;
  --status-late-bg: #46231f; --status-late-fg: #f4aea4; --status-partial-bg: #2f2640; --status-partial-fg: #cdb6ee;
  --status-refund-bg: #1e3247; --status-refund-fg: #a5cbf0; --amount-negative: #f4aea4;
}
```

Componenti: `PageHeader` (icona, titolo, proprietà, pulsante principale), `Callout`, `StatusPill`
(forma + parola + colore, inseparabili), `GalleryCard`, `DatabaseTable` (icone di colonna, riga dei
calcoli), `ToggleBlock` (totale sempre sulla riga), `TodoRow`, `Toast` con annulla, `Casetta`
(prop `frame`, `size`, rispetta impostazione e `prefers-reduced-motion`).
