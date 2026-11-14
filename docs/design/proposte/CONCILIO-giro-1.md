# Concilio sul primo giro (11/11/2026)

Cinque consiglieri con personalità diverse (Bastian Contraria, Filosofo dei primi principi,
Espansionista, Esterno «geometra», Esecutore «sviluppatore frontend») hanno classificato le dieci
proposte, cinque revisori anonimi hanno valutato le risposte e un presidente ha sintetizzato.

**Classifica del concilio:** 1) 09 Modernismo italiano, 2) 02 Minimale svizzero, 3) 01 Private
banking, 4) 10 Carta calma, 5) 03 Mascotte. Scartate: 04, 05, 06, 07, 08.

**Preferenze di Carlo dopo il concilio:** gli piacciono **01, 02, 03 e 10**. Gli piace l'idea della
mascotte, ma nella 03 è troppo presente: meglio una mascotte passiva e micro-illustrazioni discrete.

## Regole emerse (valgono per ogni stile)

- Il colore del pulsante principale non coincide mai con un colore di stato (errore di 02 rosso e
  di 01 verde).
- Lo stato si legge dalla forma o dall'icona prima che dal colore; due stati diversi non hanno la
  stessa forma.
- Tema chiaro obbligatorio, tema scuro progettato (non invertito).
- Nessun pulsante che promette azioni che l'app non fa (es. «Paga»).
- Serif solo nei titoli grandi (≥ 24 px) per la resa su Windows con ClearType.
- Contrasto del testo di stato almeno 4,5:1, meglio 7:1 per il testo piccolo.
- Il tema dell'app e quello di PDF e messaggi agli inquilini si possono separare.
- Prima di scegliere: provare la schermata Conguaglio nel caso peggiore, con i font veri, sul PC
  Windows di Nicola a 125 %.

## Verdetto completo del presidente

### Dove il concilio è d'accordo
- 09 è la scelta più solida: 4 consiglieri su 5 la mettono sul podio, 3 al primo posto. Stato leggibile dalla forma, piatta, uguale su Mac e Windows, economica in token, pulsante blu separato dai semafori.
- Il colore dell'azione non deve mai coincidere con un colore di stato: difetto della 02 (rosso) e della 01 (pulsante `#1E4A38` vicino al «Saldato» `#2E6B47`).
- Scartate 04 e 07 (solo scure, per sviluppatori) e 05 (conguagli come «missioni» su soldi veri).
- 10 bella ma contrasto al limite e timbro rosso «SALDATO» confondibile con lo scaduto.

### Dove il concilio si scontra
- 01/02 contro 06/03: l'Espansionista scarta 01 e 02 come «dimenticabili»; tutte e cinque le revisioni lo indicano come punto cieco.
- 06: seconda per l'Esecutore (economica, robusta), «da ragazzini» per Esterno e Filosofo; fuori dalla cinquina.
- 01 contro 02 per la fiducia: la 01 vale solo con il serif limitato ai titoli.

### Punti ciechi emersi dalle revisioni
- Anteprime con font di riserva: giudizio tipografico provvisorio.
- Guardata quasi solo la Home; le schermate rischiose sono conguaglio, conferma con annulla, tabelle dense, stati vuoti o di errore, telefono.
- Nessun test con Carlo e Nicola né sul PC Windows di Nicola a 125-150 %.
- Nella 09 «da pagare» (quadrato vuoto) e «scaduto» (quadrato rosso) hanno la stessa forma: da verificare a 16 px.
- I token rendono la scelta reversibile: fissare prima le regole indipendenti dallo stile.
- Anteprime con dati incoerenti (Pulci «4 su 4» quasi ovunque, «3 su 4» nella 09; «Martedì 11 novembre 2026» nella 02, che è mercoledì).

### La raccomandazione
1. 09 Modernismo italiano: illustrazioni delle card ridotte o SVG parametrici; forma distinta per «da pagare»; Archivo incorporato; tema scuro progettato.
2. 02 Minimale svizzero: pulsante principale nero o blu, rosso solo per lo scaduto.
3. 01 Private banking: pulsante blu notte, serif solo nei titoli da 24 px in su, tema scuro da zero.
4. 10 Carta calma: testi di stato a 7:1, timbro «SALDATO» verde muschio, niente font CJK.
5. 03 Mascotte: mascotte spenta di default, nessun pulsante «Paga»; senza illustratore non si realizza.

### La prima cosa da fare
Costruire con i token la schermata Conguaglio Pulci (5 scadenze passate, nomi lunghi, saldo −63 €) nelle versioni 09 e 02 con i font veri, darla a Nicola sul suo PC Windows a 125 % con un solo compito, «trova cosa devi fare e fallo», e cronometrare.
