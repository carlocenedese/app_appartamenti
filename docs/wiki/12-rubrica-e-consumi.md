# Rubrica e consumi

**Oggi:** riga di comando.

## Rubrica

Amministratori di condominio e fornitori, con i loro recapiti. Il ruolo è `amministratore` o `fornitore`.

```bash
pnpm estratti contatto --cartella "$CARTELLA" --id ctc-1 --ruolo amministratore \
  --nome "Amministratore Esempio" --telefono "+39 000 000 0000" \
  --email amministratore@example.test --appartamenti apt-a,apt-b
```

Per un fornitore puoi aggiungere `--utenze` e `--categorie`; per tutti, `--note`. Lo stesso comando con lo stesso `--id` sostituisce il contatto.

```bash
pnpm estratti contatti --cartella "$CARTELLA" --appartamento apt-b --dettagli
```

Senza `--dettagli` l'elenco non mostra nomi e recapiti.

<!-- IMMAGINE: 12-rubrica/01-contatti.png | La rubrica con amministratori e fornitori -->

## Allarme consumi

Robin confronta ogni bolletta con lo stesso periodo dell'anno prima e avvisa se la differenza supera le soglie. Le soglie le scegli tu, in percentuale, per `consumi`, `importo` o `prezzo`:

- **giallo**: da controllare;
- **rosso**: anomalo.

```bash
pnpm estratti soglie-consumi --cartella "$CARTELLA" --giallo consumi:30 --rosso consumi:50,importo:80
```

Con `--appartamento apt-a` le soglie valgono solo per quell'appartamento.

**Controllare una bolletta:**

```bash
pnpm estratti consumi --cartella "$CARTELLA" --bolletta bill-0003 --dettagli
```

**Esempio.** Con giallo a 30% e rosso a 50%, una bolletta del gas con il 60% di consumi in più dell'anno prima è rossa. Il cruscotto la conta tra gli allarmi.

<!-- IMMAGINE: 12-consumi/01-allarme.png | Una bolletta con l'allarme rosso sui consumi -->
