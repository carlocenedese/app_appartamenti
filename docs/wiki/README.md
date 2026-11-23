# Wiki di Robin

Istruzioni passo passo per tutte le operazioni dell'app. Ogni pagina spiega quando serve un'operazione, come si fa e cosa succede dopo, con un esempio.

Gli esempi usano solo dati inventati: «Appartamento A» (`apt-a`), «Appartamento B» (`apt-b`) e gli inquilini `t-uno`, `t-due` e `t-tre`. Gli importi sono di fantasia.

## Pagine

| Pagina                                               | Cosa contiene                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Come leggere la wiki](00-come-leggere.md)           | Schermate e riga di comando, cartella dei dati, formato di date e importi     |
| [Primo avvio](01-primo-avvio.md)                     | Creare un gruppo o unirsi a uno esistente                                     |
| [Appartamenti e utenze](02-appartamenti-e-utenze.md) | Creare un appartamento, i posti, i codici POD e PDR, la TARI condivisa        |
| [Inquilini e contratti](03-inquilini-e-contratti.md) | Inquilini, contratti, canone, presenze, subentri, scambi di camera, uscite    |
| [Conti ed estratti conto](04-conti-ed-estratti.md)   | Profilo della banca, conto, importare un estratto, righe in sospeso           |
| [Bollette](05-bollette.md)                           | Inserire un PDF, controllare la lettura, registrarlo, annullarlo              |
| [Riconciliazione](06-riconciliazione.md)             | Abbinare incassi e addebiti, confermare le proposte, escludere movimenti      |
| [Uscite e giroconti](07-uscite-e-giroconti.md)       | Classificare le uscite, rimborsi agli inquilini, movimenti tra conti, saldi   |
| [Condominio](08-condominio.md)                       | Rate, preventivo e consuntivo, stima, spese da recuperare                     |
| [Tasse e scadenze](09-tasse-e-scadenze.md)           | IMU, cedolare, registro, tasso legale, scadenze della proprietà               |
| [Conguaglio ed Excel](10-conguaglio-ed-excel.md)     | Cruscotto, chiusura del periodo, invio, saldo, supplementare, file Excel      |
| [Caparra e moduli Word](11-caparra-e-moduli.md)      | Restituzione della caparra, scheda dell'inquilino, moduli da modello Word     |
| [Rubrica e consumi](12-rubrica-e-consumi.md)         | Amministratori e fornitori, soglie dell'allarme consumi                       |
| [Annullare e riparare](13-annullare-e-riparare.md)   | Annullare un'operazione, riparare un'interruzione, scegliere tra due versioni |
| [Aggiornamenti dell'app](14-aggiornamenti.md)        | Controllo e installazione delle versioni nuove                                |

## Immagini

Le immagini arrivano quando lo stile grafico sarà scelto. Ogni pagina ha già i punti dove vanno, scritti come commento HTML:

```markdown
<!-- IMMAGINE: 05-bollette/01-da-smistare.png | La cartella Da_smistare con un PDF appena inserito -->
```

Il commento non si vede nella pagina. Quando l'immagine è pronta:

1. salvarla in `docs/wiki/immagini/` con il percorso scritto nel commento;
2. sostituire il commento con `![La cartella Da_smistare con un PDF appena inserito](immagini/05-bollette/01-da-smistare.png)`.

Per vedere tutte le immagini ancora da fare:

```bash
grep -rn "IMMAGINE:" docs/wiki
```

Nelle immagini, solo dati inventati come quelli degli esempi: niente nomi, indirizzi, IBAN o importi veri.
