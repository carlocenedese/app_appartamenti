# 04 · Precisione scura

**L'idea in una frase:** l'app come uno strumento di precisione: superfici quasi nere a strati,
bordi sottili da 1 px, cifre in carattere monospaziato allineate come su un estratto conto, e
tutto si può fare anche da tastiera (⌘K), ma ogni schermata dice comunque a parole cosa fare dopo.

È la famiglia estetica di Linear, Vercel e Raycast, addomesticata per due manager non
programmatori: niente gergo, semafori con icona e frase, un solo pulsante principale con un
alone di luce che lo rende impossibile da mancare.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844).

---

## Reference reali e cosa prendo da ognuna

| #   | Reference                                                                                                                                                                                                                        | Cosa prendo                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Linear, [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) e [changelog del refresh UI, marzo 2026](https://linear.app/changelog/2026-03-12-ui-refresh)                                 | Grigi scuri **leggermente caldi e poco saturi** invece del blu freddo; barra laterale più spenta del contenuto; meno bordi, più spazio. Il principio «non competere per un'attenzione che non ti sei guadagnato»: qui solo il pulsante principale e i semafori hanno colore pieno. |
| 2   | Linear, [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)                                                                                                                                | Temi generati da pochi parametri (sfondo, accento, contrasto) e contrasto alzato nei temi scuro e chiaro: la base per i token qui sotto e per la variante chiara.                                                                                                                  |
| 3   | Vercel, [Geist Design System](https://vercel.com/geist)                                                                                                                                                                          | Coppia sans + mono: il monospaziato per importi, codici, date e scorciatoie; la scala di grigi a 10 passi; i chip delle scorciatoie come piccoli tasti con bordo.                                                                                                                  |
| 4   | Raycast, analisi dello stile ([shadcn.io, Raycast DESIGN.md](https://www.shadcn.io/design/raycast), non ufficiale)                                                                                                               | Tela quasi nera (circa `#07080a`), bordi bianchi all'6-10 %, raggi piccoli (6 px per righe e pulsanti), accento usato **una volta per pagina**. Il riquadro «⌘K Cerca o fai qualsiasi cosa» e la barra delle scorciatoie in basso vengono da qui.                                  |
| 5   | [The Linear aesthetic, decoded](https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026) (2026)                                                                                                 | Densità calma: righe da 52-70 px, metadati in mono piccolo sotto il titolo, navigazione da tastiera visibile (`G H`, `G A`, `↑ ↓`, `↵`).                                                                                                                                           |
| 6   | Dribbble, [Raja Raman, «Vault Dashboard»](https://dribbble.com/raja-raman) (finance, charcoal, monospace)                                                                                                                        | Importi grandi in mono su card scure con **sparkline** a riempimento sfumato: il saldo di cassa di ogni appartamento.                                                                                                                                                              |
| 7   | Dribbble, [Proarea, «Finance Dashboard, Dark Mode»](https://dribbble.com/proarea_team/shots)                                                                                                                                     | Le tessere KPI in alto nel Conguaglio (costi, forfait, da incassare, da rimborsare) con micro-grafico a barre mensile.                                                                                                                                                             |
| 8   | [925 Studios, SaaS dashboard design 2026](https://925studios.co/blog/saas-dashboard-design-examples-2026) e [DEV, SaaS dashboard trends 2026](https://dev.to/thekitbase/saas-dashboard-design-trends-in-2026-with-examples-121m) | Tendenza 2026 «dark first, light second» per gli strumenti usati tutti i giorni, aloni di gradiente per dare profondità; e il contrappunto: **lo scuro dev'essere una preferenza**, quindi si consegna anche la variante chiara.                                                   |

---

## Palette (tema scuro, predefinito)

| Token            | Hex                   | Ruolo                                                 |
| ---------------- | --------------------- | ----------------------------------------------------- |
| `bg/canvas`      | `#0A0B0D`             | Sfondo della finestra                                 |
| `bg/sidebar`     | `#0D0E11`             | Barra laterale e barra delle scorciatoie              |
| `surface/1`      | `#111216`             | Card, tabelle, campi                                  |
| `surface/2`      | `#16171B`             | Riga selezionata, intestazioni di tabella             |
| `surface/3`      | `#1A1B20`             | Elemento attivo nella barra, chip dei tasti           |
| `border/subtle`  | `#1D1F24`             | Separatori tra righe                                  |
| `border/default` | `#222429`             | Bordo di card e contenitori                           |
| `border/strong`  | `#2C2E34`             | Bordo di campi, chip, pulsanti secondari              |
| `text/primary`   | `#EDEEF0`             | Testo principale                                      |
| `text/secondary` | `#A0A3AB`             | Testo di supporto, navigazione inattiva               |
| `text/tertiary`  | `#858993`             | Metadati, etichette mono                              |
| `accent/solid`   | `#5A5EE6` → `#6A6EF0` | Pulsante principale (gradiente verticale), contatori  |
| `accent/text`    | `#8B8FFF`             | Link, scheda attiva, focus                            |
| `status/success` | `#3DD68C`             | Verde: «Tutto a posto», «Saldato»                     |
| `status/warning` | `#F2B13D`             | Giallo: «2 cose da fare», «Parziale», «Da pagare»     |
| `status/danger`  | `#F26D6D`             | Rosso: «1 scadenza passata», saldo negativo           |
| `status/info`    | `#5EA8F7`             | Blu: «Da rimborsare», scadenze future                 |
| `glow/accent`    | `#5A5EE6` al 16 %     | Alone radiale in alto e dietro il pulsante principale |

Colori di tipologia (solo quadratini da 10 px, mai testo): elettricità `#FBBF24`, gas `#F97316`,
acqua `#38BDF8`, internet `#A78BFA`, TARI `#34D399`, condominio `#F472B6`.

### Contrasto WCAG (calcolato)

| Coppia                             | Rapporto  | Esito                             |
| ---------------------------------- | --------- | --------------------------------- |
| `text/primary` su `bg/canvas`      | 16,96 : 1 | AAA                               |
| `text/primary` su `surface/1`      | 16,12 : 1 | AAA                               |
| `text/secondary` su `surface/1`    | 7,42 : 1  | AAA                               |
| `text/tertiary` su `surface/1`     | 5,35 : 1  | AA (usato solo da 11-12 px in su) |
| bianco su `accent/solid` `#5A5EE6` | 5,03 : 1  | AA                                |
| `accent/text` su `surface/1`       | 6,66 : 1  | AA                                |
| `status/success` su `surface/1`    | 9,98 : 1  | AAA                               |
| `status/warning` su `surface/1`    | 9,92 : 1  | AAA                               |
| `status/danger` su `surface/1`     | 6,40 : 1  | AA                                |

Scelta voluta: il terziario è `#858993` e non il classico `#6B6F78` di molti temi scuri (3,9 : 1,
sotto soglia). È il punto in cui gli stili «alla Linear» spesso falliscono l'accessibilità.

### Nota sulla modalità chiara

Lo stile nasce scuro, ma la variante chiara è obbligatoria (preferenza di sistema o interruttore
in Impostazioni) perché Nicola potrebbe usare l'app di giorno su un portatile Windows luminoso.
Stessa struttura, stessi token semantici, valori diversi:

| Token            | Chiaro                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| `bg/canvas`      | `#FAFAFB`                                                              |
| `surface/1`      | `#FFFFFF`                                                              |
| `border/default` | `#E6E7EA`                                                              |
| `text/primary`   | `#1A1C22` (16,3 : 1 su `#FAFAFB`)                                      |
| `text/tertiary`  | `#5E626B` (6,1 : 1 su bianco)                                          |
| `accent/solid`   | `#4F46E5` (6,3 : 1 con testo bianco)                                   |
| stati            | versioni più scure: verde `#15803D`, giallo `#A16207`, rosso `#C2410C` |

Nel chiaro gli aloni spariscono quasi del tutto (opacità 6 %) e la profondità passa a un'ombra
morbida da 1 px + 8 px di sfocatura: un alone viola su bianco sembra uno sbaffo.

---

## Tipografia

- **Inter** (SIL Open Font License, Google Fonts) per testo e titoli. Variabile, ottime cifre
  tabellari e resa uniforme su macOS e Windows.
- **JetBrains Mono** (SIL OFL, Google Fonts) per importi, date, codici, etichette in maiuscolo e
  chip delle scorciatoie. Negli SVG il fallback è `Menlo, monospace`; nelle anteprime PNG si vede
  Menlo perché JetBrains Mono non era installato sulla macchina di rendering.
- Alternativa equivalente: **Geist + Geist Mono** (OFL, Vercel).

| Ruolo                  | Font           | Corpo / interlinea                        | Peso    |
| ---------------------- | -------------- | ----------------------------------------- | ------- |
| Titolo pagina          | Inter          | 26-28 / 34, tracking −0,4                 | 600     |
| Titolo sezione         | Inter          | 15-16 / 24                                | 600     |
| Corpo, righe di elenco | Inter          | 14 / 20                                   | 400-500 |
| Testo di supporto      | Inter          | 13 / 20                                   | 400     |
| Nota, legenda          | Inter          | 12 / 16                                   | 400     |
| Importo principale     | JetBrains Mono | 20-22 / 28                                | 600     |
| Importo in tabella     | JetBrains Mono | 13 / 20                                   | 400-600 |
| Metadati, etichette    | JetBrains Mono | 10-11 / 16, maiuscolo, tracking +0,6/+1,2 | 400     |

Regola: **ogni numero che si confronta con un altro è in mono**, allineato a destra, con il segno
staccato (`- € 63,00`, `+ € 24,82`). Le frasi restano in Inter: il mono non deve mai far sembrare
l'app un terminale.

---

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt**; margine contenuto 32 px; gutter tra card 16 px; barra laterale 240 px.
- **Raggi:** 4 px chip dei tasti, 6 px campi e righe di navigazione, 8 px pulsanti, 10 px card,
  pillole di stato a raggio pieno.
- **Bordi** sempre 1 px; la profondità nasce da tre livelli di superficie (`canvas → surface/1 →
surface/2`), un gradiente verticale di 4 % sulle card e un filo luminoso da 1 px sul bordo
  superiore delle card appartamento, nel colore del semaforo.
- **Aloni:** uno radiale in alto a destra della pagina e uno sotto il pulsante principale. Mai
  più di due per schermata.
- **Icone:** [Lucide](https://lucide.dev) (licenza ISC), tratto 1,5 px, 16 px, nessun riempimento
  tranne nelle icone di stato.
- **Illustrazioni / mascotte:** nessuna. Il «personaggio» è la precisione: gli stati vuoti usano
  un grande `⌘K` disegnato a filo con una frase («Nessuna cosa da fare. Premi ⌘K se cerchi
  qualcosa.»).
- **Micro-grafici:** sparkline del saldo di cassa (6 mesi) su ogni card, barre mensili dei costi
  nel Conguaglio, quadratini «mesi di permanenza» per ogni inquilino (12 caselle: si vede a colpo
  d'occhio chi è rimasto 9 mesi).
- **Movimento (descritto):** 120-160 ms, curva `cubic-bezier(0.2, 0, 0, 1)`. La riga selezionata
  scorre con un indicatore verticale da 2 px; i blocchi per tipologia si aprono in altezza con
  dissolvenza del contenuto; la palette ⌘K appare con scala da 0,98 a 1 e sfocatura dello
  sfondo; il pulsante principale ha un alone che «respira» una sola volta quando cambia il
  contatore. Con «Riduci movimento» attivo tutto diventa dissolvenza istantanea.

---

## Come rispetta i principi di usabilità della specifica

- **Un solo pulsante principale:** è l'unico elemento a colore pieno con alone (`Rivedi (3)`,
  `Prepara il messaggio`). Tutto il resto è grigio con bordo; «Ricalcola» è secondario.
- **Semafori leggibili anche per daltonici:** colore **più icona di forma diversa più frase**:
  cerchio con spunta «Tutto a posto», triangolo con punto esclamativo «2 cose da fare», cerchio
  pieno con esclamativo «1 scadenza passata». Negli stati del conguaglio: spunta (saldato),
  mezzo cerchio (parziale), cerchio tratteggiato (da pagare), freccia di ritorno (da rimborsare).
  Nella app del telefono pagato = cerchio pieno, non pagato = cerchio tratteggiato, con legenda.
- **Linguaggio semplice:** «Il resto è sotto controllo», «Ti mostro al massimo 4 cose alla volta»,
  «posto libero 3 mesi: € 184,94 restano a te». Le scorciatoie sono un aiuto in più, mai l'unico
  modo: ogni azione ha anche il suo pulsante o link visibile.
- **Cosa fare dopo:** la Home apre su una lista ordinata per urgenza con la prima riga già
  selezionata e il suo pulsante «Conferma ↵».
- **Annullare:** `⌘Z annulla l'ultima azione` è sempre scritto nella barra in basso; nelle
  operazioni recenti c'è «Ripristina».
- **Windows:** la barra in basso dice «Su Windows: Ctrl al posto di ⌘»; l'app mostra i tasti
  giusti per il sistema (`Ctrl K`).

---

## Pro, contro e rischi

**Pro**

- Molto leggibile per numeri e tabelle: il mono allinea gli importi come un estratto conto.
- Calmo: pochissimo colore, quindi i semafori spiccano davvero.
- Invecchia bene: è lo stile degli strumenti professionali del 2024-2026 e non dipende da una
  moda illustrativa.
- Le scorciatoie fanno risparmiare tempo a Carlo, che conferma decine di bollette.

**Contro e rischi**

- **Può sembrare «da programmatori»** e intimidire Nicola. Mitigazione: frasi ovunque, chip dei
  tasti solo come suggerimento, tema chiaro disponibile, nessun gergo.
- **Lo scuro di giorno stanca** su schermi lucidi e in stanze luminose: da qui la variante chiara
  di pari dignità, non un ripiego.
- **Windows:** la resa di grigi molto vicini (`#0A0B0D` / `#0D0E11` / `#111216`) varia molto tra
  pannelli economici; su alcuni portatili i livelli si confondono. Va provato sul computer di
  Nicola e, se serve, aumentato lo scarto tra superfici di 2-3 punti.
- **Aloni e gradienti** possono sembrare sporchi su schermi a bassa profondità di colore
  (banding): tenerli sotto il 20 % di opacità.
- **Testo piccolo in mono** (10-11 px) è il punto debole: mai usarlo per informazioni
  indispensabili, solo per metadati.
- **Stanca dopo un anno?** Meno di uno stile colorato o illustrato; il rischio è opposto, cioè
  che sembri freddo. Un accento personalizzabile in Impostazioni lo rende «loro».

---

## Traduzione in token (piano 4)

Tre livelli, esportati come variabili CSS per Tauri (e come oggetto TypeScript per i grafici):

```css
/* 1. primitivi */
--gray-950: #0a0b0d;
--gray-925: #0d0e11;
--gray-900: #111216;
--gray-875: #16171b;
--gray-850: #1a1b20;
--gray-800: #222429;
--gray-750: #2c2e34;
--gray-400: #858993;
--gray-300: #a0a3ab;
--gray-50: #edeef0;
--indigo-500: #5a5ee6;
--indigo-400: #6a6ef0;
--indigo-300: #8b8fff;
--green-400: #3dd68c;
--amber-400: #f2b13d;
--red-400: #f26d6d;
--blue-400: #5ea8f7;

/* 2. semantici (cambiano tra scuro e chiaro) */
--bg-canvas: var(--gray-950);
--bg-sidebar: var(--gray-925);
--surface-1: var(--gray-900);
--surface-2: var(--gray-875);
--surface-3: var(--gray-850);
--border-default: var(--gray-800);
--border-strong: var(--gray-750);
--text-primary: var(--gray-50);
--text-secondary: var(--gray-300);
--text-tertiary: var(--gray-400);
--accent: var(--indigo-500);
--accent-text: var(--indigo-300);
--status-ok: var(--green-400);
--status-todo: var(--amber-400);
--status-late: var(--red-400);
--status-info: var(--blue-400);
--status-bg-alpha: 0.1;
--status-border-alpha: 0.35;

/* 3. componenti */
--button-primary-bg: linear-gradient(180deg, var(--indigo-400), var(--indigo-500));
--button-primary-glow: 0 8px 28px rgb(90 94 230 / 0.45);
--card-radius: 10px;
--control-radius: 6px;
--kbd-radius: 4px;
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
--space: 8px;
--row-height: 52px;
--sidebar-width: 240px;
--motion-fast: 120ms;
--motion-base: 160ms;
--ease: cubic-bezier(0.2, 0, 0, 1);
```

Il tema chiaro ridefinisce solo il livello 2 sotto `[data-theme="light"]`. Le pillole di stato
sono un unico componente `StatusPill(tone, icon, label)` che rifiuta di essere creato senza
`icon` e `label`: così il semaforo non può mai essere solo colore. Gli importi passano tutti da
un `Money` che applica mono, cifre tabellari, allineamento a destra e il formato `- € 1.234,56`.
