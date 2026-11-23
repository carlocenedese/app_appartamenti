# Riconciliazione

La riconciliazione mette insieme i movimenti del conto con ciò che Robin sa: affitti e caparre attesi, bollette, rate, uscite e giroconti. Abbina da sola ciò che è sicuro e propone il resto.

**Oggi:** riga di comando.

## Prova senza scrivere

```bash
pnpm estratti riconcilia --cartella "$CARTELLA" --prova
```

Dice quante proposte ci sono, cosa manca e quali uscite sono da classificare. Non cambia nulla.

## Eseguire la riconciliazione

```bash
pnpm estratti riconcilia --cartella "$CARTELLA" --utente user1 --dettagli
```

Con `--dettagli` la risposta mostra le proposte con causale, data e importo. Ogni proposta ha un `id`.

<!-- IMMAGINE: 06-riconciliazione/01-proposte.png | L'elenco delle proposte d'incasso da confermare -->

## Confermare un incasso

Per ogni proposta, dici di quale inquilino è e a cosa serve. Ogni `--parte` ha la forma `tipo:mese:importo`, con tipo `canone`, `conguaglio`, `caparra` o `altro`.

**Esempio.** Un bonifico di 410,00 € di `t-tre` per l'affitto di aprile 2026:

```bash
pnpm estratti conferma --cartella "$CARTELLA" --proposta prop-0007 \
  --inquilino t-tre --parte canone:2026-04:410,00
```

Un bonifico che paga due cose si divide con due `--parte`:

```bash
pnpm estratti conferma --cartella "$CARTELLA" --proposta prop-0008 --inquilino t-uno \
  --parte caparra:2025-10:500,00 --parte canone:2025-10:350,00
```

Robin ricorda chi paga, così la volta dopo propone lo stesso inquilino. Con `--solo-questa-volta` non lo ricorda.

Una conferma cambia le altre proposte: dopo ogni conferma, rilancia `riconcilia`.

## Canone versato in più

Se un inquilino ha pagato un mese in più, `riconcilia` lo propone. Lo assegni al mese che manca con:

```bash
pnpm estratti eccedenza-canone --cartella "$CARTELLA" --proposta ecc-0001
```

## Abbinare a mano bollette e rate a un addebito

Quando Robin non trova da solo l'addebito di una bolletta o di una rata, lo abbini tu. `--parte` ha la forma `bill:<bolletta>:<movimento>:<importo>` oppure `instalment:<rata>:<movimento>:<importo>`. Con `:commissione` alla fine, l'importo è la commissione della banca.

```bash
pnpm estratti abbina --cartella "$CARTELLA" --parte bill:bill-0003:tx-0042:84,50
```

## Escludere un movimento

Un movimento che non va contato si esclude, con un motivo: `doppione`, `non-contabilizzato`, `non-reale` o `privato`.

```bash
pnpm estratti escludi --cartella "$CARTELLA" --movimento tx-0050 --motivo doppione
```

## Annullare un pagamento automatico

Se Robin ha abbinato da solo un pagamento sbagliato:

```bash
pnpm estratti annulla-pagamento --cartella "$CARTELLA" --pagamento pay-0012
```

Il movimento torna da rivedere alla prossima `riconcilia`.

## Chiudere un anno passato

Le voci di un anno passato ancora «da verificare», che sai già pagate, si confermano tutte insieme:

```bash
pnpm estratti conferma-anno --cartella "$CARTELLA" --anno 2025
```

È una sola operazione, che si annulla in un colpo (vedi [Annullare e riparare](13-annullare-e-riparare.md)).

## Esempio di un giro completo

1. `importa` gli estratti dei due conti (vedi [Conti ed estratti conto](04-conti-ed-estratti.md)).
2. `riconcilia --prova` per vedere quante proposte ci sono.
3. `riconcilia --dettagli`, poi `conferma` per le caparre di ottobre e il primo affitto di ogni inquilino.
4. Di nuovo `riconcilia`: ora i pagamenti degli stessi inquilini si abbinano da soli.
5. Classifica le uscite rimaste e conferma i giroconti (vedi [Uscite e giroconti](07-uscite-e-giroconti.md)).
6. `escludi` il prelievo privato.
7. Un'ultima `riconcilia`: non resta nulla da proporre.
