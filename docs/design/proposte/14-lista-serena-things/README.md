# 14 · Lista serena

**L'idea in una frase:** l'app è una lista di cose da fare, calma e precisa: ogni mattina Carlo
apre «Oggi», spunta un cerchio quando una cosa è sistemata, la riga scorre via e resta solo ciò
che manca.

Bianco quasi ovunque, una barra laterale grigio chiarissimo, quasi nessun bordo (le righe si
separano con lo spazio e con un filetto chiarissimo), un solo blu deciso per le azioni e una
gerarchia tipografica netta con un solo carattere. Le card degli appartamenti sono compatte e
stanno in una striscia: la Home ruota attorno alle **Cose da fare**, divise in **Oggi** e
**Prossimi**. Niente mascotte: il «personaggio» è la checkbox tonda che si chiude con un guizzo.

Schermate: `01-home.svg`, `02-conguaglio.svg`, `03-mobile.svg`, `04-stati.svg`.

## Quali marchi mi ispirano e cosa NON copio

| Ispirazione | Cosa prendo | Cosa NON copio |
| --- | --- | --- |
| Things 3 (Cultured Code) | Le liste «Oggi» e «Prossimi», la checkbox che si riempie, le «aree» nella barra laterale (qui i tre appartamenti sotto Appartamenti), il bianco generoso, la bandierina per la scadenza | Il nome, l'icona dell'app, il carattere proprietario, la stella gialla di «Oggi» (qui un punto blu), il quadrato arrotondato come checkbox delle attività (qui il cerchio) |
| Promemoria di Apple | Il cerchio vuoto come checkbox, le liste raggruppate su sfondo grigio chiaro nel telefono, il titolo grande «Oggi» | SF Pro, i colori di sistema, le icone SF Symbols, i colori per lista |
| Todoist | La conferma con «Annulla» dopo aver spuntato, la data a destra della riga, il filtro «Tutti / Per me» | Il rosso come colore d'azione (qui il rosso è solo «scaduto» e «da pagare»), il logo |
| Linear (tema chiaro) | La tabella densa ma ariosa, la riduzione dei separatori, la precisione dei grigi | Il viola, il tema scuro come predefinito, il carattere |

Nell'interfaccia non compaiono loghi, nomi di marchio né font proprietari. Il marchio dell'app è
un quadrato blu con dentro un cerchio spuntato, disegnato da zero.

## Reference reali (cercate online)

| Reference | Cosa prendo |
| --- | --- |
| [Things, sito del prodotto (Cultured Code)](https://culturedcode.com/things/) e [scheda su App Store](https://apps.apple.com/ee/app/id904237743?l=en-gb) | «Today» e «Upcoming» come due liste che ordinano il tempo: qui «Oggi» e «Prossimi» dentro Cose da fare. |
| [MacStories, *Things 3: Beauty and Delight in a Task Manager*](https://www.macstories.net/?p=48965) | L'idea che la piacevolezza stia nei dettagli (animazioni brevi, spazio) e non nella decorazione. |
| [Blake Crosley, design study su Things](https://blakecrosley.com/blog/design-study-things) | La sequenza della spunta (riempimento, spunta, conferma) in circa mezzo secondo: base dei fotogrammi in `04-stati.svg`. Fonte di terzi, i tempi qui sono miei. |
| [Pratt IxD, *Design Critique: Reminders (macOS)*](https://ixd.prattsi.org/2024/12/design-critique-reminders-macos-app/) e [Michael Tsai, *In loving memory of square checkbox*](https://mjtsai.com/blog/2024/01/30/in-loving-memory-of-square-checkbox) | Il cerchio come checkbox delle cose da fare, ormai riconosciuto da tutti; la lista a gruppi del telefono. |
| [Apple HIG, Toggles e checkbox](https://developer.apple.com/design/human-interface-guidelines/toggles) | La checkbox deve mostrare con chiarezza il suo stato; in una lista modificabile può stare senza etichetta propria. |
| [Linear, *Behind the latest design refresh*](https://linear.app/blog/behind-the-latest-design-refresh) e [*How we redesigned the Linear UI*](https://linear.app/blog/how-we-redesigned-the-linear-ui) | Meno separatori, grigi caldi ma nitidi, temi chiaro e scuro generati dagli stessi token (qui due palette progettate). |
| [Adobe XD Ideas, il redesign di Todoist raccontato dal team](https://xd.adobe.com/ideas/perspectives/interviews/reimagining-an-app-from-the-ground-up-behind-the-scenes-of-todoists-redesign) | Un'app di liste che resta calma con molti elementi: gerarchia data dal peso, non dal colore. |
| [Inzuoo su DEV, motion design e micro-interazioni](https://dev.to/marketingwithinzuoo/the-quiet-revolution-why-motion-design-and-micro-interactions-are-now-the-heart-of-great-user-254a) e [ezud, *Designing for reduced motion*](https://www.ezud.com/animation-motion-accessibility-reduced-motion) | Il trend 2025-26: micro-animazioni piccole che confermano un gesto, con una variante ridotta (dissolvenza invece di scorrimento) per «riduci movimento». |
| [Inter su Google Fonts](https://fonts.google.com/specimen/Inter) | Il carattere unico, con cifre tabellari. |

## Palette

Il blu è l'unico colore d'azione e non è mai un colore di stato. Gli stati usano verde, ambra,
rosso e viola scuri, scelti per stare almeno a **7:1** anche come testo piccolo.

### Tema chiaro

| Token | Hex | Ruolo | Contrasto |
| --- | --- | --- | --- |
| `bg` | `#FFFFFF` | sfondo pagina | — |
| `side` | `#F5F6F8` | barra laterale, card compatte, gruppi | — |
| `fill` | `#F2F4F7` | campi, selettori, avatar | — |
| `hair` | `#ECEEF2` | filetti tra le righe (decorativo) | — |
| `ink` | `#1B1E23` | testo principale | 16,7:1 su bianco · 15,5:1 su `side` |
| `ink2` | `#555B65` | testo secondario | 6,8:1 su bianco · 6,3:1 su `side` |
| `ring` | `#80868F` | contorno della checkbox aperta | 3,7:1 (oggetto grafico, minimo 3:1) |
| `blue` (primario) | `#1D5BD6` | pulsante principale, link, checkbox fatta | 6,0:1 su bianco; bianco sul pulsante 6,0:1 |
| `tint` | `#E6EDFB` | voce attiva della barra laterale | blu su `tint` 5,1:1 |
| `green` (successo) | `#0D5C31` | in regola, saldato | 8,1:1 · 7,5:1 su `side` |
| `amber` (attenzione) | `#6B4600` | da fare, parziale | 8,4:1 · 7,8:1 su `side` |
| `red` (errore) | `#9C1F15` | scaduto, da pagare, saldo negativo | 8,0:1 · 7,4:1 su `side` |
| `violet` | `#6B3A99` | da rimborsare | 7,8:1 · 7,2:1 su `side` |

### Tema scuro (progettato, non invertito)

| Token | Hex | Contrasto |
| --- | --- | --- |
| `bg` / `side` / `fill` | `#14161A` / `#1A1D22` / `#22262D` | — |
| `ink` | `#ECEEF2` | 15,6:1 |
| `ink2` | `#AEB4BE` | 8,1:1 su `side` |
| `blue` | `#7AA7FF` (testo del pulsante `#0E1420`, 7,7:1) | 7,6:1 |
| `green` / `amber` / `red` / `violet` | `#5CCB8F` / `#F0B44A` / `#FF9C92` / `#C4A2F0` | 7,5 / 8,2 / 7,5 / 7,6:1 su `fill` |

Contrasti calcolati con la formula WCAG 2.x (script nel mio scratchpad, non nel repository).

## Tipografia

- **Inter** (SIL Open Font License 1.1), un solo carattere in quattro pesi: 400, 500, 600, 700.
  Cifre tabellari (`tnum`) negli importi. Nessun serif, quindi nessun problema di ClearType.
- Scala: titolo pagina 32/700 (telefono 34); titolo scheda 30/700; sezione 22/700; sottosezione
  17-18/700; corpo e righe 15/500; meta 13/400; etichette di gruppo 12-13/600-700; minimo 12.
- Spaziatura delle lettere leggermente negativa solo nei titoli (-0,3/-0,6 px).

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt**, righe delle liste alte 64 px, colonna di contenuto con margini di 48 px.
- **Raggi:** 8 (voci della barra laterale), 10-12 (card, pulsanti), 16 (pannelli). Ombre solo sul
  pulsante principale, sul segmento attivo del filtro e sul toast.
- **Quasi nessun bordo:** card come campiture grigio chiarissimo; righe separate da un filetto
  `hair` che parte dal testo, non dal bordo (come nelle liste di sistema).
- **Icone:** tratto 1,6 px, angoli arrotondati, disegnate a mano in 16 px.
- **Dizionario degli stati, sette forme diverse** (sempre con testo accanto):
  - in regola: cerchio pieno con spunta (verde);
  - da fare: triangolo con punto esclamativo (ambra);
  - scaduto: bandierina (rosso);
  - saldato: quadrato arrotondato pieno con spunta (verde);
  - parziale: cerchio pieno a metà (ambra);
  - da pagare: cerchio vuoto con freccia in giù, i soldi entrano in cassa (rosso);
  - da rimborsare: cerchio vuoto con freccia in su, i soldi escono (viola).
  La checkbox delle cose da fare è un cerchio vuoto **grigio e senza segni**, più grande (22 px):
  è un comando, non uno stato, e non si confonde con «da pagare».
- **Movimento (unica micro-animazione, niente mascotte):**
  - *Spunta:* 0 ms cerchio aperto; 80 ms premuto (scala 0,88, anello blu); 200 ms si riempie di
    blu con un guizzo (scala 1,18 e un alone che svanisce); 320 ms torna a 1,0 con la spunta e il
    testo diventa grigio; 600-900 ms la riga scorre a destra, sfuma e si chiude in altezza.
    Compare il toast «Bolletta confermata · Annulla» per 8 secondi (anche Ctrl Z).
  - *Attesa:* tre puntini che si riempiono uno alla volta (0, 300, 600, 900 ms, ciclo 1,2 s)
    accanto a «Sto leggendo l'estratto conto…».
  - *Riduci movimento* (impostazione dell'app e del sistema): niente guizzo né scorrimento, la
    riga sfuma in 150 ms; i puntini restano fermi e la frase mostra il progresso in parole
    («Lettura in corso, 128 movimenti su 340»).
  - Realizzazione: `transform: scale` e `opacity` in CSS, con `cubic-bezier(.3,1.5,.6,1)` per il
    guizzo; nessuna libreria.

## Come rispetta i principi di usabilità (sezione 15)

- **Un solo pulsante principale** per schermata, blu pieno: «Rivedi (3)», «Prepara il
  messaggio», «Importa un estratto conto», «Scegli un altro file». Tutto il resto è testo o link.
- **Ogni schermata dice cosa fare dopo:** la Home è letteralmente una lista; il conguaglio ha un
  piccolo elenco «Prima di chiudere il conguaglio».
- **Semafori leggibili senza colore:** sette forme diverse più la parola; i tre appartamenti
  usano cerchio, triangolo e bandierina.
- **Si conferma e si annulla:** spuntare non cancella nulla, registra; il toast con «Annulla»
  resta 8 secondi. La spunta di «Affitto non ricevuto» apre la registrazione dell'affitto, non
  «paga» niente. Nessun pulsante promette pagamenti.
- **Linguaggio semplice:** «Da fare», «Scaduto», «Niente da rivedere», «Non è stato salvato
  nulla».

## Pro, contro e rischi

**Pro**
- Il modello mentale «lista di cose da fare» è quello che Carlo e Nicola conoscono già dal
  telefono: zero manuale.
- Molto economico da implementare: un font, pochi token, nessuna illustrazione, una sola
  animazione in CSS.
- Identico su Mac e Windows (niente serif, niente vetro, niente texture).
- Il tema scuro è una seconda palette, non un'inversione.

**Contro**
- Meno «carattere» di 01 o 10: rischia di sembrare un'app di produttività generica.
- Sulle schermate dense (conguaglio) la serenità viene solo dallo spazio: con nomi lunghi o più
  inquilini la tabella si allunga.
- Sette forme di stato da imparare (anche se ognuna ha sempre la parola accanto).

**Rischi**
- Spuntare con un clic una cosa che sposta soldi è un gesto leggero: va sempre accompagnato da
  annulla e, per le azioni importanti, da una conferma esplicita.
- Il guizzo può stancare dopo un anno: va tenuto sotto i 400 ms e si spegne con «riduci
  movimento».
- A 125 % su Windows i 12 px delle etichette scendono vicino al limite: da provare sul PC di
  Nicola.

## Token per il piano 4

```css
:root {
  --font: "Inter", system-ui, sans-serif;
  --bg: #FFFFFF; --side: #F5F6F8; --fill: #F2F4F7; --hair: #ECEEF2;
  --ink: #1B1E23; --ink-2: #555B65; --ring: #80868F;
  --action: #1D5BD6; --action-ink: #FFFFFF; --action-tint: #E6EDFB;
  --ok: #0D5C31; --todo: #6B4600; --late: #9C1F15; --refund: #6B3A99;
  --radius-s: 8px; --radius-m: 11px; --radius-l: 16px;
  --row-h: 64px; --space: 8px;
  --check-size: 22px;
  --dur-check: 320ms; --dur-row-out: 300ms; --ease-pop: cubic-bezier(.3,1.5,.6,1);
  --dots-cycle: 1200ms; --toast-undo: 8s;
}
[data-theme="dark"] {
  --bg: #14161A; --side: #1A1D22; --fill: #22262D; --hair: #2A2E36;
  --ink: #ECEEF2; --ink-2: #AEB4BE; --ring: #6E7580;
  --action: #7AA7FF; --action-ink: #0E1420; --action-tint: #22324F;
  --ok: #5CCB8F; --todo: #F0B44A; --late: #FF9C92; --refund: #C4A2F0;
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-check: 0ms; --dur-row-out: 150ms; --ease-pop: linear; }
}
```

Gli stati si mappano su un componente `StatusIcon` con sette varianti (`ok`, `todo`, `late`,
`settled`, `partial`, `due`, `refund`), ciascuna con forma propria e testo obbligatorio.
