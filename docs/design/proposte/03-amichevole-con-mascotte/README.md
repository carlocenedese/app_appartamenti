# 03 · Amichevole con mascotte

**L'idea in una frase:** un'app per le bollette che sembra un'app di consumo simpatica, alla Duolingo o Monzo: forme tonde, pulsanti «gommosi» con un piccolo spessore, colori vivaci ma accordati, e **Bollino**, una bollettina con gli occhi che fa da semaforo con la faccia.

Schermate: `01-home.svg` (1440 × 900), `02-conguaglio.svg` (1440 × 900), `03-mobile.svg` (390 × 844).

---

## Reference trovate online

| #   | Reference                                                                                                                                                                                                                                                                     | Cosa prendo                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Creative Bloq, «Mascots are back, but not as you know them»](https://www.creativebloq.com/design/branding/mascots-are-back-but-not-as-you-know-them)                                                                                                                         | La mascotte come elemento che _risponde_ allo stato, non come decorazione. Bollino cambia faccia in base al semaforo.                                                                        |
| 2   | [Frontify, «How mascots became the secret sauce for successful brands»](https://www.frontify.com/en/futures/how-mascots-became-the-secret-sauce-for-successful-brands)                                                                                                        | La conferma che le mascotte stanno arrivando anche in finanza e B2B: qui si usano in un contesto «serio» ma domestico.                                                                       |
| 3   | [Mucho, «Misconceptions about brand mascots and why they are back»](https://wearemucho.com/insights/misconceptions-about-brand-mascots-and-why-they-are-back)                                                                                                                 | Mascotte come guida e feedback dentro un ciclo di progresso: «5 su 5 in regola» con la festa quando si chiude tutto.                                                                         |
| 4   | [925 Studios, «Duolingo UX Breakdown» (2026)](https://www.925studios.co/blog/duolingo-design-breakdown) e [InVision, «Duolingo redesign»](https://invisionapp.com/inside-design/duolingo-redesign)                                                                            | Duo compare nei momenti di successo, nelle notifiche e negli errori; la mascotte va disegnata pensando già all'animazione. Prendo il pulsante con il «bordo inferiore» spesso e le tre pose. |
| 5   | [Kota, «5 finance brands that ditched corporate design and won»](https://kota.co.uk/blog/5-finance-brands-that-ditched-corporate-design-and-won/) e [11:FS, «Meowing cards and hot coral»](https://www.11fs.com/article/meowing-cards-and-hot-coral-the-new-brand-identities) | Monzo e le neobanche: colore pieno, linguaggio parlato, angoli morbidi. Prendo le card a 24–28 px e il tono «Ciao Carlo!».                                                                   |
| 6   | [Revolut: guida al brand (Made Good Designs)](https://madegooddesigns.com/revolut-brand-guidelines/)                                                                                                                                                                          | Pulsanti a pillola, molta aria intorno ai numeri. Gli importi grandi e in grassetto vengono da qui.                                                                                          |
| 7   | [Lummi, «UI trends 2026»](https://staticpages.lummi.ai/blog/ui-trends-2026) e [daisyUI, «18 UI design trends for 2026»](https://trends.daisyui.com/ui-design-trends-2026/)                                                                                                    | Il ritorno della profondità tattile (soft 3D, claymorphism leggero): ombre piene e corte invece di sfumature, pulsanti che «si schiacciano».                                                 |
| 8   | [Craftwork, «20 illustrations for onboarding and UX»](https://craftwork.design/blog/20-illustrations-for-onboarding-and-ux)                                                                                                                                                   | Ogni stato vuoto ha un'illustrazione **e** un'azione successiva. Regola applicata agli stati vuoti di Bollino.                                                                               |
| 9   | [Dribbble, «Fintech experimental UI»](https://www.dribbble.com/shots/22144402-Fintech-experimental-UI)                                                                                                                                                                        | Il passaggio da giocoso a «accessibile»: il gioco sta nei dettagli (mascotte, coriandoli), la struttura resta da cruscotto ordinato.                                                         |

## La mascotte: Bollino

Un foglietto di bolletta con il bordo seghettato, l'angolo piegato color lavanda, due righe di «testo» sulla pancia e una casetta viola sul petto (le bollette sono sempre di una casa). Contorno scuro spesso (3,5 su 100), corpo color carta, guance rosa. È disegnato in SVG in un riquadro 100 × 100 e si scala da 44 px (logo) a 88 px (card).

**Carattere:** il ragioniere di quartiere padovano, preciso ma alla mano. Non fa battute sui soldi, non giudica chi è in ritardo, dice le cose come stanno e poi dice cosa fare. Parla poco.

| Espressione                             | Quando                                                  | Cosa fa                                                                         |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Felice** (`bollino-felice`)           | Semaforo verde, conguaglio saldato, «Da rivedere» vuoto | Occhi chiusi a mezzaluna, bocca aperta, braccia in alto; può avere i coriandoli |
| **Pensieroso** (`bollino-pensa`)        | Semaforo giallo, qualcosa da fare ma niente di scaduto  | Sguardo in alto, mano al mento, due puntini «di pensiero»                       |
| **Preoccupato** (`bollino-preoccupato`) | Semaforo rosso, scadenza passata, errore che blocca     | Sopracciglia in su, bocca ondulata, goccia di sudore azzurra                    |

**Regole d'uso**

- **Una sola mascotte per zona**: una per card appartamento, una nell'intestazione di una scheda, una negli stati vuoti. Mai due Bollino nello stesso riquadro, mai Bollino dentro le tabelle o le righe di elenco.
- **La faccia segue il semaforo, non lo sostituisce.** Accanto c'è sempre la chip con colore, icona e frase («1 scadenza passata»). Chi non guarda la mascotte non perde informazioni.
- **Sta zitto** nelle procedure con dati (revisione dei documenti, abbinamento dei bonifici, subentro passo per passo), nei popup di conferma e in Impostazioni: lì conta il PDF accanto ai campi, non la simpatia.
- **Parla solo con un fumetto breve** (massimo due righe) e solo per dire cosa fare dopo (vedi `02-conguaglio.svg`). Mai battute sugli importi, mai «Oops!» negli errori: si scrive cosa è successo e come rimediare.
- **Festa con misura.** I coriandoli compaiono solo quando uno stato passa a verde (per esempio l'ultimo inquilino salda il conguaglio) e durano un secondo. Su una card già verde da giorni Bollino resta felice ma senza coriandoli.
- **Mai preoccupato per più di un giorno senza un motivo cliccabile**: se è rosso, nella card c'è la riga che porta al problema.
- Nell'app del telefono compare nelle tre card, a 60 px, sempre dentro un riquadro del colore del semaforo.

## Palette

| Token                               | Esadecimale                       | Ruolo                                     |
| ----------------------------------- | --------------------------------- | ----------------------------------------- |
| `color.bg`                          | `#FFF8EE`                         | Sfondo pagina (carta calda)               |
| `color.surface`                     | `#FFFFFF`                         | Card, tabelle, campi                      |
| `color.sidebar`                     | `#F4EFFF`                         | Barra laterale, filtri segmentati         |
| `color.border`                      | `#ECE4D6`                         | Bordi e «spessore» delle card neutre      |
| `color.text`                        | `#2A2140`                         | Testo principale, contorno di Bollino     |
| `color.text-muted`                  | `#6B6380`                         | Testo secondario                          |
| `color.primary`                     | `#5B4BDB`                         | Pulsante principale, scheda attiva        |
| `color.primary-depth`               | `#3F31B0`                         | Spessore sotto il pulsante principale     |
| `color.primary-soft` / `-text`      | `#EEEAFF` / `#4B3CC9`             | Link, azioni secondarie, «in arrivo»      |
| `color.success` / `-soft` / `-text` | `#1FA463` / `#DDF7E8` / `#0F7A45` | Verde: tutto a posto, saldato             |
| `color.warning` / `-soft` / `-text` | `#FFC23D` / `#FFF1CC` / `#8A5300` | Giallo: da fare, parziale                 |
| `color.danger` / `-soft` / `-text`  | `#FF5A5F` / `#FFE3E3` / `#B4232A` | Rosso: scaduto, da pagare, saldo negativo |
| Accenti illustrazione               | `#FF9DB4`, `#7CC8FF`, `#FF8A5B`   | Guance, goccia, avatar di Nicola          |

**Contrasto WCAG (calcolato):** testo `#2A2140` su sfondo `#FFF8EE` 14,3 : 1 e su bianco 15,1 : 1; testo secondario `#6B6380` su bianco 5,6 : 1 e su sfondo 5,4 : 1; bianco su primario 6,0 : 1; testi delle chip: verde 4,8 : 1, giallo 5,6 : 1, rosso 5,4 : 1, viola 6,4 : 1. Tutto supera AA (4,5 : 1). Il verde pieno `#1FA463` con testo bianco arriva a 3,2 : 1, quindi si usa solo come fondo di icone, mai come fondo di testo. Il giallo pieno porta icone scure (9,4 : 1).

## Tipografia

**Nunito** (Google Fonts, SIL Open Font License), sans-serif con terminali arrotondati, ottima nelle cifre e con accenti italiani completi. Pesi 600, 700, 800, 900. Cifre tabulari (`font-variant-numeric: tabular-nums`) in tabelle e importi. Fallback: `'Arial Rounded MT Bold'`, poi `sans-serif` (nei PNG di prova il font non era installato: la resa reale con Nunito è un po' più tonda e stretta).

| Uso                                      | Corpo / peso                               |
| ---------------------------------------- | ------------------------------------------ |
| Saluto, titolo pagina                    | 30–34 / 900                                |
| Nome appartamento, importi grandi        | 22–26 / 900                                |
| Titoli di sezione                        | 20–22 / 900                                |
| Testo di riga, pulsanti                  | 15–17 / 800                                |
| Testo secondario                         | 14 / 600                                   |
| Etichette, chip, intestazioni di tabella | 13 / 800 (minimo assoluto 12 sul telefono) |

## Forme, spaziatura, icone, movimento

- **Griglia 8 pt**; margini di pagina 32 px, spazio tra card 24 px.
- **Raggi:** card 24–28 px, pulsanti e chip a pillola, righe interne 12–16 px.
- **Spessore («soft depth»):** niente ombre sfocate. Sotto ogni card c'è una copia piena spostata di 4–5 px nel colore del bordo; sotto il pulsante principale 5 px di `primary-depth`. Al clic il pulsante scende di 3 px (si «schiaccia»).
- **Bordi colorati** per semaforo sulle card (verde, giallo, rosso tenui) e fascia superiore nel tono `-soft`.
- **Icone** lineari da 2 px con estremi arrotondati (stile Phosphor/Lucide «rounded»), dentro dischi pieni del colore di stato quando indicano uno stato.
- **Movimento:** Bollino respira piano (scala 1 → 1,02 in 3 s) solo quando è in vista; cambia espressione con un piccolo salto (120 ms). Coriandoli 900 ms quando una card diventa verde. Rispetto di «riduci movimento»: niente respiro e niente coriandoli, cambio di faccia istantaneo.

## Come rispetta i principi di usabilità (spec, sezione 15)

- **Un solo pulsante principale**: è l'unico elemento viola pieno con lo spessore («Rivedi (3)», «Prepara il messaggio»). Tutte le altre azioni sono pillole bianche con contorno.
- **Semafori leggibili anche per daltonici**: sempre colore **+ icona** (spunta, punto esclamativo, orologio, mezzo cerchio) **+ frase**, e in più la faccia di Bollino. Nella tabella del conguaglio «Da pagare» ha un contorno e l'icona, non solo il rosso.
- **Linguaggio semplice**: «Tutto a posto», «2 cose da fare», «Mancano 3 versamenti e 1 rimborso».
- **Ogni schermata dice cosa fare dopo**: il fumetto di Bollino e il sottotitolo del saluto lo dicono in una riga.
- **Stati vuoti**: Bollino felice + frase + azione successiva («Niente da rivedere. Torna alla Home»). **Errori**: Bollino preoccupato + cosa è successo + come rimediare, mai solo un codice.

## Pro, contro e rischi

**Pro**

- Toglie ansia a un compito noioso; i due fratelli capiscono lo stato con un'occhiata, anche dal telefono.
- Il semaforo è ridondante (faccia, colore, icona, frase): difficile fraintenderlo.
- Tecnicamente leggero: colori piatti e ombre piene si rendono identici su Mac e Windows (WebView2), niente sfocature costose.

**Contro e rischi**

- **Stanchezza dopo un anno**: la mascotte può diventare stucchevole. Per questo le regole la limitano a una per zona e la zittiscono nei flussi di lavoro; un'impostazione «Mostra Bollino» permette di spegnerla (la faccia lascia posto a un disco col solo simbolo).
- **Serietà percepita**: con i soldi degli inquilini c'è il rischio di sembrare un gioco. Tabelle e importi restano sobri; il gioco sta solo nei bordi.
- **Nicola su Windows**: Nunito va incluso nell'app (non contare sul font di sistema); le ombre piene reggono bene anche con la scala 125–150 % di Windows.
- **Lavoro di illustrazione**: tre pose ora, probabilmente cinque o sei in futuro (attesa/sincronizzazione, festa grande, sonno per lo stato vuoto). Vanno mantenute coerenti.
- Le tabelle dense (conguaglio, movimenti) hanno meno aria che nelle app di consumo: va verificato che i raggi grandi non rubino spazio.

## Traduzione in token (piano 4)

Tre livelli, in CSS custom properties generate da un file JSON:

```css
:root {
  /* primitivi */
  --violet-500: #5b4bdb;
  --violet-700: #3f31b0;
  --violet-50: #eeeaff;
  --green-500: #1fa463;
  --green-50: #ddf7e8;
  --green-800: #0f7a45;
  --amber-400: #ffc23d;
  --amber-50: #fff1cc;
  --amber-800: #8a5300;
  --red-400: #ff5a5f;
  --red-50: #ffe3e3;
  --red-800: #b4232a;
  --paper: #fff8ee;
  --ink: #2a2140;
  --ink-muted: #6b6380;

  /* semantici */
  --color-bg: var(--paper);
  --color-primary: var(--violet-500);
  --status-ok-fill: var(--green-500);
  --status-ok-bg: var(--green-50);
  --status-ok-text: var(--green-800);
  --status-todo-fill: var(--amber-400); /* … */
  --status-late-fill: var(--red-400); /* … */

  /* forma e profondità */
  --radius-card: 24px;
  --radius-pill: 999px;
  --depth-card: 0 4px 0 var(--color-border);
  --depth-button: 0 5px 0 var(--violet-700);
  --space-unit: 8px;
  --font-ui: 'Nunito', 'Arial Rounded MT Bold', sans-serif;
  --motion-press: 120ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
}
```

- Componenti: `Button.primary` (unico per schermata), `StatusChip(state)`, `ApartmentCard(state)`, `Mascot(mood: happy | thinking | worried, size)` che mappa lo stato del semaforo sulla posa. Le tre pose sono `<symbol>` SVG in un solo sprite (`bollino.svg`), come nelle schermate (`#bollino-felice`, `#bollino-pensa`, `#bollino-preoccupato`).
- `Mascot` legge `prefers-reduced-motion` e l'impostazione «Mostra Bollino».
