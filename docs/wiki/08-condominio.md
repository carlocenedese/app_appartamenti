# Condominio

L'esercizio del condominio si scrive `AAAA-AA`, per esempio `2025-26`, anche se comincia a gennaio. Il mese di inizio è un'impostazione dell'appartamento (`--esercizio-condominio`, vedi [Appartamenti e utenze](02-appartamenti-e-utenze.md)).

**Oggi:** riga di comando.

## Registrare una rata

**Esempio.** Prima di tre rate dell'esercizio 2025-26, con scadenza 10 ottobre 2025: 150,00 € di rata, di cui 18,00 € all'anno restano alla proprietà, più 48,00 € di conguaglio dell'anno prima.

```bash
pnpm estratti rata-condominio --cartella "$CARTELLA" --id inst-condo-a-1 \
  --appartamento apt-a --esercizio 2025-26 --rata 1/3 --scadenza 2025-10-10 \
  --importo 150,00 --quota-proprieta 18,00 --conguaglio-prec 48,00
```

Robin calcola i mesi coperti dalla rata (qui da ottobre 2025 a gennaio 2026) e si aspetta un addebito di 198,00 €. Una rata straordinaria si segna con `--straordinaria`.

<!-- IMMAGINE: 08-condominio/01-rata.png | La rata del condominio con quota della proprietà e conguaglio precedente -->

Una rata già abbinata a un addebito non si cambia: prima si annulla l'abbinamento.

## Preventivo e consuntivo

```bash
pnpm estratti condominio-documento --cartella "$CARTELLA" --appartamento apt-a \
  --esercizio 2025-26 --tipo preventivo --totale 450,00
```

Con `--tipo consuntivo` salvi il consuntivo. `--quota-conduttore` è la parte a carico degli inquilini, se il documento la dice.

## Controllare il condominio

```bash
pnpm estratti condominio --cartella "$CARTELLA" --appartamento apt-a --esercizio 2025-26 --dettagli
pnpm estratti condominio-stima --cartella "$CARTELLA" --appartamento apt-a --esercizio 2026-27 --dettagli
```

Il primo confronta rate, preventivo e consuntivo e mostra le differenze. Il secondo stima l'esercizio partendo da quello prima.

## Spese da recuperare

Una spesa pagata dalla proprietà che gli inquilini devono rimborsare.

**Esempio.** La ferramenta da 40,00 €, di cui 20,00 € da recuperare da `t-uno` e `t-tre`:

```bash
pnpm estratti recupero --cartella "$CARTELLA" --id rec-ferramenta --appartamento apt-a \
  --movimento tx-0061 --importo 20,00 --inquilini t-uno,t-tre
```

Senza movimento, scrivi la data con `--data`. Un importo negativo è un credito agli inquilini: `--importo=-15,00`. Lo stato è `da-recuperare`, `recuperata` o `non-recuperabile` (`--stato`).
