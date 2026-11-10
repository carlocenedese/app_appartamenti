# Documentazione di progetto

- `spec.md`: specifica funzionale. Le regole di calcolo in vigore sono nella sezione 42 (R1-R8); prevalgono sulle altre sezioni.
- `schemas/`: JSON Schema di ogni tipo di record e del file dell'area di lavoro, generati dal modello dati con `pnpm schemas:export` (non si modificano a mano; un test fallisce se non sono aggiornati). La parte Python li usa per validare ciò che scrive.
- `plans/2026-11-06-piano-1-fondamenta-motore.md`: piano 1 (fondamenta e motore di calcolo), con il metodo di esecuzione.

Lingua: documenti e interfaccia in italiano; nomi nel codice e commenti in inglese.
Le copie qui sono istantanee: la specifica originale resta nel documento condiviso e il piano nel progetto "Appartamenti Padova".
