# Annullare e riparare

Robin non cancella mai nulla dal disco. Ogni operazione resta nel registro (`_app/journal/`) e si può annullare. Anche l'annullo è un'operazione.

**Oggi:** riga di comando.

## Annullare un'operazione

Ogni comando che scrive risponde con un `operationId`. Per annullarla:

```bash
pnpm estratti annulla-riconciliazione --cartella "$CARTELLA" --operazione op-20260420-0001
```

`annulla-incassi` è lo stesso comando con un altro nome.

Se altri dati dipendono da ciò che l'operazione ha creato, Robin rifiuta con `has-dependents` e dice quanti record per tipo. Annulla prima quelli, in ordine inverso.

**Esempio.** Hai collegato `UTENZA-A` all'appartamento sbagliato:

1. Trovi l'`operationId` nella risposta di `utenza`.
2. `annulla-riconciliazione --operazione …`.
3. Rifai `utenza` con l'appartamento giusto.

<!-- IMMAGINE: 13-annullare/01-registro.png | Il registro delle operazioni con il pulsante Annulla -->

## Annulli con un comando proprio

| Cosa                            | Comando                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Un estratto conto               | `annulla --estratto <id>` (vedi [Conti ed estratti conto](04-conti-ed-estratti.md)) |
| Una bolletta                    | `annulla-bolletta <file.pdf>` (vedi [Bollette](05-bollette.md))                     |
| Un pagamento automatico         | `annulla-pagamento --pagamento <id>`                                                |
| La classificazione di un'uscita | `annulla-uscita --movimento <id>`                                                   |
| Un periodo chiuso               | `riapri-periodo` (vedi [Conguaglio ed Excel](10-conguaglio-ed-excel.md))            |

## Riferimenti mancanti

Elenca i record che puntano a un record mancante o cancellato:

```bash
pnpm estratti riferimenti --cartella "$CARTELLA"
```

Una risposta vuota vuol dire che è tutto a posto.

## Operazione interrotta

Se il computer si spegne o Dropbox si ferma a metà di un'operazione, Robin lo vede al comando dopo. Per sistemare:

```bash
pnpm estratti ripara --cartella "$CARTELLA"
```

## Due versioni dello stesso record

Se user1 e user2 cambiano lo stesso record mentre Dropbox non sincronizza, ci sono due versioni. Prima le guardi:

```bash
pnpm estratti scegli-versione --cartella "$CARTELLA" --file _app/dati/tenant/t-uno.json --dettagli
```

La risposta elenca le versioni, ognuna con l'operazione che l'ha scritta, l'ora e chi l'ha fatta. Poi tieni quella giusta indicando la sua operazione:

```bash
pnpm estratti scegli-versione --cartella "$CARTELLA" --file _app/dati/tenant/t-uno.json \
  --operazione op-20260420-0003
```

<!-- IMMAGINE: 13-annullare/02-due-versioni.png | Le due versioni di un record a confronto -->
