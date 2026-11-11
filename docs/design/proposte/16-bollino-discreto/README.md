# 16 · Bollino discreto

**L'idea in una frase:** il calore della 03 (forme tonde, pulsanti «gommosi» con un piccolo spessore, colori vivaci ma accordati) con una mascotte ridotta a **segno minimo**: Bollino diventa una bollettina viola con l'angolo piegato e due puntini per occhi. Fa da logo, «pensa» mentre l'app legge un file, riposa negli stati vuoti e fa un saltello quando una conferma riesce. Non sta mai vicino ai soldi.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844), `04-stati.svg` (1440 × 900: vuoto, attesa in 4 fotogrammi, conferma con annulla e saltello, errore, Home scura, Bollino prima e dopo).

---

## Reference trovate online

| #   | Reference | Cosa prendo |
| --- | --------- | ----------- |
| 1   | [Kyle Martinez, «Reverse engineering Claude's ASCII spinner animation» (Medium)](https://medium.com/@kyletmartinez/reverse-engineering-claudes-ascii-spinner-animation-eec2804626e0) | Un'attesa fatta da **pochi fotogrammi di un solo glifo**, accompagnati da un verbo al gerundio («Sto leggendo…»). Il ciclo di Bollino ha 4 fotogrammi. |
| 2   | [DesignRush, analisi del marchio di Claude](https://www.designrush.com/best-designs/logo/claude-logo-design-the-ai-mark-built-to-look-none-of-its-rivals) | Un segno piccolo, un po' irregolare e di un colore caldo, riconoscibile a 16 px. Bollino è asimmetrico per via dell'angolo piegato. |
| 3   | [MacStories, recensione di iOS 27: il nuovo Siri](https://www.macstories.net/stories/ios-and-ipados-27-review/5/) e [9to5Mac sul nuovo Siri](https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/) | L'orb che compare solo mentre lavora e poi sparisce. Prendo l'**alone che pulsa** dietro Bollino durante l'attesa (opacità 10-18 %). |
| 4   | [Blog di Duolingo, «World character visemes»](https://blog.duolingo.com/world-character-visemes) e [Rive, caso Duolingo «Lily»](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life) | Il personaggio come **macchina a stati** (riposo, legge, contento, calmo, spento) gestita dal codice, non come un'illustrazione per ogni schermata. |
| 5   | [Kimp, «Headspace brand»](https://www.kimp.io/headspace-brand/) e [Blush, intervista a Karen Hong (Headspace)](https://blush.design/blog/post/headspace-mindfulness-app) | Personaggi fatti di forme semplici, **due puntini per occhi**, emozione affidata a postura e colore. Headspace li ha semplificati perché sembravano «infantili»: è lo stesso passo dalla 03 alla 16. |
| 6   | [Advertising Week, «Unlocking Headspace's inner brand character»](https://advertisingweek.com/aw360/news/unlocking-headspaces-inner-brand-character/19717/) | Il carattere passa dallo stile (forme, tono) più che da un personaggio sempre in scena. |
| 7   | [Inkbot Design, tendenze dei loghi 2026](https://inkbotdesign.com/maximalism/) e [Renderforest, tendenze delle animazioni dei loghi 2026](https://www.renderforest.com/blog/logo-animation-trends) | I «marchi nati per muoversi»: il logo statico è il fotogramma di riposo di un solo movimento. Per le attese nelle app il movimento dura meno di un secondo oppure è un ciclo lieve, con una versione ferma per «riduci movimento». |
| 8   | [BUCK, previsioni per il 2026](https://pencilsdown.buck.co/p/looking-ahead-bucks-2026-predictions) | Il ritorno delle mascotte, che però qui resta piccola e utile. |
| 9   | Cartella `03-amichevole-con-mascotte` (giro 1) | Palette, Nunito, spessore di 4-5 px sotto card e pulsanti, tono «Ciao Carlo!». Tutto il resto della 03 resta com'era: cambia solo la mascotte. |

## Marchi che mi ispirano e cosa NON copio

- **Claude** (glifo arancione che si anima mentre pensa): prendo l'idea del segno-logo che diventa indicatore di attesa. Non copio la forma a stella, il colore terracotta né i caratteri dell'animazione.
- **Siri / Apple** (orb): prendo l'alone che respira. Non copio i gradienti iridescenti, il vetro né SF Pro.
- **Duolingo**: prendo i pulsanti con lo spessore e la mascotte gestita come macchina a stati. Non copio il verde, il gufo né i toni colpevolizzanti («Duo è triste»).
- **Headspace**: prendo le forme semplici e la faccia a due puntini. Non copio l'arancione né i personaggi.
- Nell'interfaccia non compaiono loghi, nomi di marchi o font proprietari.

## Scheda della mascotte: Bollino 2.0

### Prima (03) e dopo (16)

| | **Prima · 03** | **Dopo · 16** |
| --- | --- | --- |
| Forma | Bolletta con bordo seghettato, contorno spesso, braccia, guance, bocca, casetta sul petto, coriandoli, goccia di sudore | **Due forme e due puntini:** rettangolo arrotondato viola `#5B4BDB`, angolo piegato lavanda `#D3CCFF`, occhi bianchi (raggio 2,9 su 48) |
| Dimensione | 44-88 px, su ogni card | **16-48 px** nell'interfaccia; 96 px solo nello stato vuoto |
| Dove | Logo, ogni card degli appartamenti, intestazioni, fumetto nel Conguaglio, telefono | **Solo** logo, attesa ed elaborazione, stato vuoto, conferma riuscita (nel toast) |
| Emozione | Felice, pensieroso, preoccupato: **segue il semaforo e quindi i soldi** | Neutra o attenta: riposo, legge, contento (solo dopo una tua azione), calmo. **Mai triste, mai preoccupato** |
| Semafori | Faccia + chip | Solo icona a forma propria + testo; Bollino non c'entra |
| Costo | Serve un illustratore per 3-6 pose | Un solo `<symbol>` SVG di 4 tracciati; le pose sono trasformazioni CSS degli occhi |

La tavola `04-stati.svg`, riquadro **f**, mette le due versioni una accanto all'altra.

### Dove compare (al massimo uno per schermata)

| Luogo | Misura | Posa |
| --- | --- | --- |
| Logo nella barra laterale e nell'intestazione del telefono | 36 px / 28 px | riposo, fermo |
| Attesa ed elaborazione («Sto leggendo l'estratto conto…», «Sto calcolando il conguaglio…») | 44 px | ciclo «legge» |
| Stato vuoto («Niente da rivedere.») | 96 px, con alone | calmo |
| Conferma riuscita, nel toast con «Annulla» | 28 px | saltello una volta, poi contento |

**Mai** nelle card degli appartamenti, nelle tabelle, nelle righe di elenco, vicino agli importi, negli errori, nei popup di conferma, nelle procedure di revisione dati. Nelle schermate 01, 02 e 03 l'unico Bollino è il logo.

### Fotogrammi dell'animazione

- **Legge** (ciclo di 1,2 s, 4 fotogrammi da 300 ms, `steps(4)`):
  1. occhi a sinistra (−3,2), segno ruotato −10°;
  2. occhi in basso (+3): «legge»;
  3. occhi a destra (+3,2), segno ruotato +10°;
  4. palpebre chiuse (due trattini).

  L'alone dietro passa da 10 % a 18 % di opacità e torna indietro.
- **Saltello** (360 ms, una volta sola): 1 si schiaccia (scala 1,12 × 0,86), 2 sale di 20 px con gli occhi ad arco, 3 atterra (1,05 × 0,95) e torna a riposo. L'ombra a ellisse si stringe quando è in aria.
- **Calmo** (stato vuoto): occhi a mezzaluna, respiro lentissimo (scala 1 → 1,02 in 4 s).
- **Riduci movimento** (`prefers-reduced-motion`): niente rotazione, niente saltello, niente respiro. Nell'attesa resta fermo sul fotogramma 2 e si muove solo la barra di avanzamento.

### Come si spegne

**Impostazioni › Aspetto › Mostra Bollino** (acceso di default, spegnibile; il concilio suggeriva di spegnerlo di default e la scelta resta aperta). Da spento il logo diventa il solo contorno della bollettina, senza occhi e fermo. L'attesa mostra solo la barra, lo stato vuoto mostra solo la frase e il pulsante. Nessuna informazione dipende da Bollino.

## Palette

| Token | Chiaro | Scuro | Ruolo |
| --- | --- | --- | --- |
| `bg` | `#FFF8EE` | `#16121F` | Sfondo pagina |
| `surface` | `#FFFFFF` | `#221C2F` | Card, tabelle |
| `sidebar` | `#F4EFFF` | `#1C1728` | Barra laterale, filtri |
| `border` / `depth` | `#ECE4D6` / `#E6DCCB` | `#2E2740` / `#0D0A14` | Bordi e spessore delle card |
| `text` | `#2A2140` | `#F3EEFF` | Testo principale |
| `muted` | `#625A78` | `#B3AAC9` | Testo secondario |
| `primary` / `primary-depth` | `#5B4BDB` / `#3F31B0` | `#9A8CFF` / `#6A5AE0` | Pulsante principale, scheda attiva, corpo di Bollino |
| `primary-soft` / `-text` | `#EEEAFF` / `#4B3CC9` | `#2C2547` / `#C4BBFF` | Link, chip neutre, contatori |
| `ok` / `-soft` / `-text` | `#1FA463` / `#DDF7E8` / `#085630` | `#3DD68C` / `#173527` / `#7FE8B4` | In regola, saldato |
| `todo` / `-soft` / `-text` | `#FFC23D` / `#FFF1CC` / `#734400` | `#FFC94D` / `#3A2F14` / `#FFD978` | Da fare, parziale |
| `late` / `-soft` / `-text` | `#E5484D` / `#FFE3E3` / `#8C1820` | `#FF6B70` / `#3D1C22` / `#FF9EA2` | Scaduto, da pagare, errore |
| `blue` / `-soft` / `-text` | `#2F6FDB` / `#E3EDFF` / `#173F8F` | `#6FA0FF` / `#1C2A47` / `#A9C6FF` | Da rimborsare |

Il pulsante principale è viola, un colore che nessuno stato usa. Anche Bollino è viola: appartiene al marchio, non al semaforo.

**Contrasto WCAG (calcolato con la formula di luminanza relativa):**

- Tema chiaro: testo su sfondo 14,3:1, su bianco 15,1:1. Testo secondario su bianco 6,5:1, su sfondo 6,1:1, su barra laterale 5,7:1. Bianco sul primario 6,0:1. Link viola su bianco 7,5:1, su viola tenue 6,4:1.
- Testi di stato piccoli, tutti sopra 7:1: verde su verde tenue 7,8:1; giallo-bruno su giallo tenue 7,3:1 (8,2:1 su bianco); rosso su rosso tenue 7,7:1; blu su blu tenue 8,3:1. Toast: bianco su `#2A2140` 15,1:1, «Annulla» `#C4BBFF` 8,6:1.
- Tema scuro: testo su sfondo 16,2:1, su superficie 14,5:1; secondario 7,5:1; testo scuro sul primario 6,8:1; stati su superficie: verde 11,1:1, giallo 12,1:1, rosso 8,4:1.
- I colori pieni degli stati (`#1FA463`, `#FFC23D`, `#E5484D`) riempiono solo le icone, mai lo sfondo di un testo.

## Tipografia

**Nunito** (Google Fonts, SIL Open Font License 1.1), da includere nell'app, con cifre tabulari negli importi. Fallback: `'Arial Rounded MT Bold'`, poi `sans-serif`. Nei PNG di controllo Nunito non era installato e il testo è reso in Arial Rounded, che ha un solo peso (grassetto): con Nunito i pesi 600-900 si distinguono meglio e il testo è un po' più stretto. Niente serif.

| Uso | Corpo / peso |
| --- | --- |
| Saluto, titolo pagina | 32-34 / 900 |
| Nome appartamento, importi grandi | 24-26 / 900 |
| Titoli di sezione | 22 / 900 |
| Righe, pulsanti | 15-17 / 800 |
| Testo secondario | 14 / 700 |
| Chip, intestazioni di tabella | 13 / 800 (12 solo per le didascalie della tavola stati) |

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt**; margini 32 px; card distanziate di 24 px.
- **Raggi:** card 24 px, righe interne 12-16 px, pulsanti e chip a pillola.
- **Spessore:** niente ombre sfocate. Sotto le card c'è una copia piena spostata di 4 px; sotto il pulsante principale 5 px di `primary-depth`; al clic il pulsante scende di 3 px.
- **Semafori = forma + testo.** Ogni stato ha una forma propria, così nessuna coppia di stati è uguale anche in bianco e nero:

  | Stato | Forma |
  | --- | --- |
  | In regola / saldato | cerchio verde con spunta |
  | Da fare | triangolo arrotondato giallo con «!» |
  | Scaduto | quadrato arrotondato rosso con orologio |
  | Parziale | rombo mezzo pieno |
  | Da pagare | cartellino (pentagono verso destra) con contorno rosso |
  | Da rimborsare | esagono blu con freccia a sinistra |
  | Errore (non è uno stato) | ottagono rosso con «!» |
  | Scadenza futura (neutra) | calendario lineare viola |

  Le card hanno una fascia superiore tenue del colore dello stato, una chip con icona e frase e, per ogni posto, l'icona del suo stato (Pulci: tre cerchi e un quadrato).
- **Icone** lineari da 2 px con estremi arrotondati.
- **Movimento:** solo quello di Bollino descritto sopra, più la pressione dei pulsanti (120 ms) e il conto alla rovescia circolare del toast «Annulla» (8 s).

## Come rispetta i principi di usabilità (spec, sezione 15)

- **Un solo pulsante principale** viola con spessore per schermata: «Rivedi (3)», «Prepara il messaggio», «Torna alla Home», «Scegli un altro file». Le azioni di riga sono pillole bianche («Controlla», «Apri», «Vedi»). Non c'è nessun «Paga»: l'app registra e verifica.
- **Semafori leggibili anche per i daltonici:** forma diversa + frase, il colore viene per terzo.
- **Linguaggio semplice:** «Tutto a posto», «Restano da incassare € 80,75 e da rimborsare € 54,60.», «Il file non sembra un estratto conto».
- **Ogni azione importante si annulla:** il toast «Bolletta confermata · Annulla» resta 8 secondi.
- **Errori:** cosa è successo e come rimediare, senza mascotte e senza «Oops».

## Pro, contro e rischi

**Pro**

- Il calore che piaceva della 03 resta, ma la mascotte non interferisce più con i dati: le tabelle e le card sono sobrie quanto quelle della 02.
- Bollino è economico: 4 tracciati, animabili in CSS con `steps()`. Non serve un illustratore.
- L'attesa diventa riconoscibile e «di marca» invece di uno spinner anonimo.
- Il tema scuro è progettato a parte: il viola diventa lavanda e il testo dei pulsanti diventa scuro.

**Contro e rischi**

- Il segno a 16 px quasi si perde: l'angolo piegato si vede solo da 24 px in su. Sotto i 24 px conviene la versione senza occhi.
- Nelle anteprime di prova il font è Arial Rounded e non Nunito: il giudizio tipografico è provvisorio.
- Sei forme di stato sono tante da imparare. Il conguaglio ne usa quattro e la Home tre, e la frase accanto resta il riferimento.
- Il viola di Bollino è anche il viola del pulsante: lo stesso colore indica marchio e azione. Bollino però non è mai cliccabile e non sta mai accanto al pulsante principale.
- Da verificare sul PC Windows di Nicola a 125 %: i raggi grandi nelle tabelle dense.

## Traduzione in token (piano 4)

```css
:root {
  --color-bg: #fff8ee;
  --color-surface: #ffffff;
  --color-text: #2a2140;
  --color-muted: #625a78;
  --color-primary: #5b4bdb;
  --color-primary-depth: #3f31b0;
  --status-ok: #1fa463;
  --status-ok-bg: #ddf7e8;
  --status-ok-text: #085630;
  --status-todo: #ffc23d;
  --status-todo-bg: #fff1cc;
  --status-todo-text: #734400;
  --status-late: #e5484d;
  --status-late-bg: #ffe3e3;
  --status-late-text: #8c1820;
  --status-refund: #2f6fdb;
  --status-refund-bg: #e3edff;
  --status-refund-text: #173f8f;
  --mascot-body: var(--color-primary);
  --mascot-fold: #d3ccff;
  --mascot-eye: #ffffff;
  --radius-card: 24px;
  --radius-pill: 999px;
  --depth-card: 0 4px 0 #e6dccb;
  --depth-button: 0 5px 0 var(--color-primary-depth);
  --font-ui: 'Nunito', 'Arial Rounded MT Bold', sans-serif;
  --motion-press: 120ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
  --motion-mascot-read: 1200ms steps(4);
  --motion-mascot-hop: 360ms cubic-bezier(0.3, 0.7, 0.4, 1.4);
}
[data-theme='dark'] {
  --color-bg: #16121f;
  --color-surface: #221c2f;
  --color-text: #f3eeff;
  --color-primary: #9a8cff; /* … */
}
```

- Componenti: `Button.primary` (uno per schermata), `StatusIcon(state)` con le sette forme, `StatusChip(state)`, `ApartmentCard(state)` (senza mascotte), `Toast(undo)`.
- `Mascot({ pose: 'rest' | 'read' | 'happy' | 'calm', size })`: un `<symbol>` SVG con il corpo, la piega e due `<circle>` per gli occhi. Le pose spostano o sostituiscono gli occhi; il ciclo «read» è un `@keyframes` a 4 passi. Legge `prefers-reduced-motion` e l'impostazione «Mostra Bollino» (se è spenta usa `pose: 'off'`).
- Regola da verificare in revisione del codice: `Mascot` non può essere figlio di `Table`, `ListRow` o `ApartmentCard`.
