# Inquilini e contratti

L'ordine è: inquilino, contratto, canone del contratto, presenza dell'inquilino nell'appartamento.

**Oggi:** riga di comando.

## Creare un inquilino

```bash
pnpm estratti inquilino --cartella "$CARTELLA" --id t-uno --nome "Tizio Fittizio" --lingua it
```

`--lingua` è la lingua dei moduli e dei messaggi per l'inquilino. Lo stesso comando con lo stesso `--id` aggiorna nome o lingua.

<!-- IMMAGINE: 03-inquilini/01-nuovo-inquilino.png | La schermata per creare un inquilino -->

I dati personali (codice fiscale, documento) vanno nella scheda riservata: vedi [Caparra e moduli Word](11-caparra-e-moduli.md).

## Creare un contratto

```bash
pnpm estratti contratto --cartella "$CARTELLA" --id ctr-apt-a --appartamento apt-a \
  --tipo 1+1 --inizio 2025-10 --fine 2026-09 --conguaglio annuale \
  --regime cedolare --aliquota-cedolare 21
```

| Opzione              | Valori                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| `--tipo`             | `1+1`, `3+2`, `4+4`, `altro`                                                        |
| `--inizio`, `--fine` | primo e ultimo mese del contratto                                                   |
| `--conguaglio`       | `annuale` oppure `intero-contratto`                                                 |
| `--regime`           | `cedolare` oppure `ordinario`                                                       |
| facoltative          | `--concordato`, `--studenti`, `--firmato`, `--registrato`, `--codice-registrazione` |

Lo stesso comando con lo stesso `--id` sostituisce il contratto.

## Fissare il canone del contratto

```bash
pnpm estratti contratto-canone --cartella "$CARTELLA" --contratto ctr-apt-a \
  --dal 2025-10 --canone 700,00 --acconto 100,00
```

`--canone` è l'affitto totale del contratto, `--acconto` l'acconto mensile delle spese. Per un aumento aggiungi un'altra voce con il mese da cui vale: `--dal 2026-10 --canone 720,00`. La storia resta.

## Registrare l'arrivo di un inquilino (presenza)

```bash
pnpm estratti presenza --cartella "$CARTELLA" --id tcy-uno --appartamento apt-a \
  --inquilino t-uno --contratto ctr-apt-a --posto stanza-1 --dal 2025-10 \
  --affitto 350,00 --forfait 50,00 --caparra-attesa 500,00
```

`--affitto` e `--forfait` sono la parte mensile di questo inquilino. `--caparra-attesa` è la caparra che deve versare. Con `--al` indichi già il mese di uscita, se lo sai.

<!-- IMMAGINE: 03-inquilini/02-presenza.png | La schermata di arrivo di un inquilino con posto, affitto e forfait -->

## Registrare l'uscita

```bash
pnpm estratti fine-presenza --cartella "$CARTELLA" --presenza tcy-uno --mese 2026-06
```

`--mese` è l'ultimo mese in cui l'inquilino c'è.

## Subentro: un inquilino lascia il posto a un altro

**Esempio.** `t-due` esce dopo marzo 2026 e `t-tre` entra ad aprile nello stesso posto, con un affitto di 360,00 €.

```bash
pnpm estratti subentro --cartella "$CARTELLA" --presenza tcy-due --mese 2026-03 \
  --id tcy-tre --inquilino t-tre --affitto 360,00 --forfait 50,00 --caparra-attesa 500,00
```

`--mese` è l'ultimo mese di chi esce. La presenza nuova parte dal mese dopo.

## Scambio di camera

Due inquilini dello stesso contratto si scambiano il posto da un certo mese.

```bash
pnpm estratti scambio-camera --cartella "$CARTELLA" --appartamento apt-a \
  --presenza-a tcy-uno --presenza-b tcy-tre --mese 2026-05
```

Con `--canone-a` e `--canone-b` dai l'affitto nuovo di ciascuno, se cambia.

## Controllare contratti e presenze

```bash
pnpm estratti contratti --cartella "$CARTELLA"
pnpm estratti stato-contratti --cartella "$CARTELLA" --appartamento apt-a --dettagli
```

`stato-contratti` mostra presenze, subentri, caparre e controlli, per esempio una presenza fuori dal periodo del contratto o un posto occupato due volte.

<!-- IMMAGINE: 03-inquilini/03-stato-contratti.png | Lo stato dei contratti con i controlli -->

## Affitti dell'anno per la cedolare

Per stimare la cedolare, salva il totale degli affitti di un appartamento in un anno:

```bash
pnpm estratti affitti-anno --cartella "$CARTELLA" --appartamento apt-a --anno 2026 --totale 8400,00
```
