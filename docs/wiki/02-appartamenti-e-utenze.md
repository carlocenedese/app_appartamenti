# Appartamenti e utenze

## Creare un appartamento

Serve una volta per appartamento, prima di inquilini, bollette e conti.

**Oggi:** riga di comando.

```bash
pnpm estratti appartamento --cartella "$CARTELLA" --utente user1 \
  --id apt-a --nome "Appartamento A" --locatore "Locatore Esempio" \
  --posti 2 --annualita 10-01 --esercizio-condominio 10-01 \
  --differenza-condominio inquilini
```

| Opzione                   | Significato                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| `--id`                    | L'identificativo che userai negli altri comandi (`apt-a`)                         |
| `--nome`                  | Il nome della cartella e dei documenti («Appartamento A»)                         |
| `--locatore`              | Chi affitta, come compare nei moduli                                              |
| `--posti`                 | Quanti posti letto ci sono                                                        |
| `--annualita`             | Giorno e mese di inizio del periodo di conguaglio (`10-01` = dal 1° ottobre)      |
| `--esercizio-condominio`  | Giorno e mese di inizio dell'esercizio del condominio                             |
| `--differenza-condominio` | Chi paga la differenza del consuntivo condominiale (`inquilini` o `proprietario`) |

<!-- IMMAGINE: 02-appartamenti/01-nuovo-appartamento.png | La schermata per creare un appartamento -->

## Cambiare un appartamento

Lo stesso comando, con lo stesso `--id`, cambia solo i campi che scrivi. Se il cambio tocca i conguagli già fatti, l'app rifiuta con `needs-confirmation`: ripeti il comando con `--modifica` per confermare.

**Dare un nome ai posti:**

```bash
pnpm estratti appartamento --cartella "$CARTELLA" --id apt-a --modifica \
  --posti-nomi stanza-1,stanza-2
```

**Aggiungere un posto da un certo mese:** `--posti 3 --dal 2026-10`. I mesi prima restano con i posti di prima.

**Codici POD e PDR** (luce e gas), per riconoscere le bollette dell'appartamento:

```bash
pnpm estratti appartamento --cartella "$CARTELLA" --id apt-a --modifica \
  --codici POD-ESEMPIO-A,PDR-ESEMPIO-A
```

Un posto con presenze non si può togliere: l'app rifiuta con il nome della presenza.

## Collegare un'utenza a uno o più appartamenti

Serve per un avviso che vale per più appartamenti, come la TARI condivisa. Ogni utenza ha il codice scritto sull'avviso e dice quale parte va a ogni appartamento.

**Dalla schermata.** Quando una bolletta da rivedere ha un'utenza sconosciuta:

1. Robin mostra il codice dell'utenza e propone gli appartamenti.
2. Per ogni riga scegli **Appartamento** e scrivi la **Percentuale**. Con **+ Aggiungi appartamento** ne aggiungi uno.
3. Il **Totale** in basso deve fare 100%.
4. Se vuoi, scrivi una **Nota**.
5. Premi **Collega e continua**.

<!-- IMMAGINE: 02-appartamenti/02-collega-utenza.png | La schermata di collegamento con due appartamenti al 60% e 40% -->

Nell'elenco delle utenze, ogni utenza ha i pulsanti **Modifica**, **Rimuovi** e **Aggiungi nota**.

<!-- IMMAGINE: 02-appartamenti/03-elenco-utenze.png | L'elenco delle utenze collegate -->

**Dalla riga di comando.** Un'utenza tutta di un appartamento:

```bash
pnpm estratti utenza --cartella "$CARTELLA" --etichetta UTENZA-A --appartamento apt-a
```

Un'utenza divisa tra due appartamenti:

```bash
pnpm estratti utenza --cartella "$CARTELLA" --etichetta UTENZA-AB \
  --ripartizione "apt-a:60;apt-b:40"
```

Con `--dal 2026-10` le percentuali nuove valgono da quel mese.

**Esempio.** L'avviso TARI di gennaio–aprile 2026 vale 186,00 € e ha due utenze: `UTENZA-A` con 100,75 € e `UTENZA-B` con 84,71 €. Collegate ognuna al suo appartamento, la riconciliazione divide l'addebito in 101,04 € per A e 84,96 € per B, in proporzione.

Dalla riga di comando un collegamento non si cambia: si annulla con `annulla-riconciliazione` e si rifà (vedi [Annullare e riparare](13-annullare-e-riparare.md)).
