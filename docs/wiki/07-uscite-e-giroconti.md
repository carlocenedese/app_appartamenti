# Uscite e giroconti

Dopo la riconciliazione restano le uscite che Robin non sa classificare e i movimenti tra i conti degli appartamenti. Le trovi in `riconcilia --dettagli`, sotto `outgoing` e `transfers`.

**Oggi:** riga di comando.

## Classificare un'uscita

La categoria è `utenze`, `tasse`, `condominio` o `altro`.

**Esempio.** Una spesa in ferramenta di 40,00 € per Appartamento A:

```bash
pnpm estratti uscita --cartella "$CARTELLA" --proposta out-0004 --categoria altro --appartamento apt-a
```

Per un F24 aggiungi `--f24`. Con `--solo-questa-volta` Robin non ricorda il beneficiario per le volte dopo.

<!-- IMMAGINE: 07-uscite/01-classifica.png | Un'uscita da classificare con la scelta della categoria -->

Per togliere la classificazione:

```bash
pnpm estratti annulla-uscita --cartella "$CARTELLA" --movimento tx-0061
```

Se la spesa va ripagata dagli inquilini, registrala anche come recupero (vedi [Condominio](08-condominio.md#spese-da-recuperare)).

## Un'uscita verso un inquilino

Il tipo è `caparra`, `conguaglio` o `altro`. `--mese` è il mese a cui si riferisce.

**Esempio.** La restituzione della caparra a `t-due`, uscito a marzo:

```bash
pnpm estratti uscita-inquilino --cartella "$CARTELLA" --proposta out-0009 \
  --inquilino t-due --tipo caparra --mese 2026-04
```

Per restituire un canone versato in più, al posto di `--tipo` usa `--rimborso-canone` con il mese del canone.

## Giroconto tra due conti

Quando un conto manda soldi a un altro, Robin propone di unire le due «gambe» del movimento. Lo scopo è `saldo`, `mutuo` o `altro`.

```bash
pnpm estratti giroconto --cartella "$CARTELLA" --proposta gir-0001 --scopo saldo \
  --gambe tx-0070,tx-0102
```

Un passaggio senza movimento in banca (per esempio contanti) si registra a mano.

**Esempio.** A dà 50,00 € a B il 1° agosto 2026:

```bash
pnpm estratti giroconto-manuale --cartella "$CARTELLA" --da acc-apt-a --a acc-apt-b \
  --importo 50,00 --data 2026-08-01 --scopo saldo
```

## Saldo tra i conti

```bash
pnpm estratti saldi --cartella "$CARTELLA" --dettagli
```

Mostra quanto ogni appartamento deve agli altri, dopo spese comuni e giroconti.

<!-- IMMAGINE: 07-uscite/02-saldi.png | Il saldo tra i conti degli appartamenti -->
