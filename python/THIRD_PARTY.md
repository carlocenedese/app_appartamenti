# Librerie di terze parti (Python)

Dipendenze fissate in `requirements.txt` (con hash). Licenze lette dai metadati installati con
`python/tools/check_licenses.py`; la verifica automatica gira in CI su Ubuntu, Windows e macOS.

| Pacchetto                 | Versione | Licenza                    | Uso                                      |
| ------------------------- | -------- | -------------------------- | ---------------------------------------- |
| attrs                     | 26.1.0   | MIT                        | transitiva                               |
| cffi                      | 2.0.0    | MIT                        | transitiva                               |
| charset-normalizer        | 3.5.2    | MIT                        | transitiva                               |
| cryptography              | 50.0.2   | Apache-2.0 OR BSD-3-Clause | transitiva                               |
| jsonschema                | 4.26.0   | MIT                        | diretta: validazione con gli schemi JSON |
| jsonschema-specifications | 2025.9.1 | MIT                        | transitiva                               |
| pdfminer.six              | 20260107 | MIT                        | diretta: estrazione del testo dal PDF    |
| pycparser                 | 3.12     | BSD-3-Clause               | transitiva                               |
| referencing               | 0.37.0   | MIT                        | transitiva                               |
| rpds-py                   | 2026.9.1 | MIT                        | transitiva                               |

`cffi` è fissata a 2.0.0 perché dalla 2.1 usa MIT-0, non nell'elenco; `typing-extensions` (PSF-2.0)
serve a Python 3.12, per questo si usa Python 3.13.
