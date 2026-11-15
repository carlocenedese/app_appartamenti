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

## OCR (solo macOS)

L'OCR esce solo su macOS (decisione di user1 del 13 novembre 2026); Windows è rimandato perché la
ruota Windows di tesserocr contiene libiconv e libcharset sotto LGPL-2.1. Inventario completo e
verifiche in `docs/rules/ocr-licenze.md`. Le ruote macOS (arm64 e x86_64) non portano i testi delle
licenze delle librerie in `tesserocr/.dylibs/`: i testi sono in `python/licenses/ocr-native-libraries.txt`
(uno per progetto, alla versione della ruota), che `scripts/bundle-python.mjs` mette nel bundle in
`bollette_pdf/licenses/` e che `build.yml` controlla nell'app costruita (revisione finale, I4).

In `requirements.txt` le due ruote sono fissate con il marcatore `sys_platform == "darwin"`
(`tesserocr==2.12.0`, `pypdfium2==5.14.0`): pip non le installa su Windows e Linux, e
`check_licenses.py` le controlla solo su macOS. Il campo `License` di pypdfium2 è testo libero
(«BSD-3-Clause, Apache-2.0, dependency licenses»): `check_licenses.py` lo accetta solo per la
versione 5.14.0 e solo con quel testo esatto. `ita.traineddata` è scaricato con controllo SHA-256
da `scripts/ocr-data.mjs` in `resources/ocr-data/` (su Windows c'è solo una nota).

| Componente                        | Versione | Licenza                          | Origine del testo                              |
| --------------------------------- | -------- | -------------------------------- | ---------------------------------------------- |
| tesserocr                         | 2.12.0   | MIT                              | `.dist-info/licenses/LICENSE` nella ruota      |
| pypdfium2 (con PDFium)            | 5.14.0   | BSD-3-Clause, Apache-2.0         | `LICENSES/` e `BUILD_LICENSES/` nella ruota    |
| `ita.traineddata` (tessdata_fast) | 4.1.0    | Apache-2.0                       | https://github.com/tesseract-ocr/tessdata_fast |
| Tesseract                         | 5.5.3    | Apache-2.0                       | https://github.com/tesseract-ocr/tesseract     |
| Leptonica                         | —        | BSD-2-Clause                     | https://github.com/DanBloomberg/leptonica      |
| libpng                            | 1.6.58   | libpng License v2                | https://github.com/pnggroup/libpng             |
| libjpeg-turbo                     | 3.2.0    | IJG + BSD-3-Clause + Zlib        | https://github.com/libjpeg-turbo/libjpeg-turbo |
| libtiff                           | 4.7.2    | libtiff                          | https://gitlab.com/libtiff/libtiff             |
| libwebp, libwebpmux, libsharpyuv  | —        | BSD-3-Clause                     | https://chromium.googlesource.com/webm/libwebp |
| liblzma                           | 5.8.3    | 0BSD                             | https://github.com/tukaani-project/xz          |
| Zstandard                         | 1.5.7    | BSD-3-Clause (scelta tra le due) | https://github.com/facebook/zstd               |

## Interprete incorporato nell'installer

L'app desktop porta con sé un interprete Python (`scripts/bundle-python.mjs`, vedi
`apps/desktop/README.md`): la distribuzione _python-build-standalone_ della release `20261026`
(pubblicata il 26 ottobre 2026), variante «install_only» `.tar.gz`, Python 3.13.18:

- Windows: `cpython-3.13.18+20261026-x86_64-pc-windows-msvc-install_only.tar.gz`
- macOS: `cpython-3.13.18+20261026-aarch64-apple-darwin-install_only.tar.gz`

Indirizzi e impronte SHA-256 (dal file `SHA256SUMS` della release) sono in `python/runtime.json`.
Lo script toglie pip (e la sua copia in `ensurepip/_bundled`): pip incorpora certifi, MPL-2.0. Toglie
anche Tcl/Tk con `tkinter`, IDLE e `turtle` (decisione R69: l'app non li usa e la licenza TCL non è
nell'elenco); l'elenco dei percorsi è `TKINTER_PATHS` in `scripts/bundle-python.mjs`.

Licenze dei componenti, prese dal `LICENSE.txt` della distribuzione (`LICENSE.txt` nella cartella
dell'interprete su Windows, `lib/python3.13/LICENSE.txt` su macOS) e, per le librerie che quel file non elenca, dai
metadati di python-build-standalone alla stessa release (`pythonbuild/downloads.json`, campo
`licenses`). Quali componenti ci sono su ciascun sistema è stato controllato sui file della
distribuzione (DLL su Windows, simboli e librerie collegate su macOS).

| Componente                                                              | Versione | Licenza                                         | Windows | macOS |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------- | ------- | ----- |
| CPython                                                                 | 3.13.18  | PSF-2.0 (accettata, sezione 8 della spec, R45)¹ | sì      | sì    |
| OpenSSL                                                                 | 3.5.9    | Apache-2.0                                      | sì      | sì    |
| libffi                                                                  | 3.8.0²   | MIT                                             | sì      | sì    |
| Expat                                                                   | 2.9.0²   | MIT                                             | sì      | sì    |
| mpdecimal                                                               | 4.0.0    | BSD-2-Clause                                    | sì      | sì    |
| xz (liblzma)                                                            | 5.8.4    | 0BSD                                            | sì      | sì    |
| zlib                                                                    | 1.3.2    | Zlib                                            | sì      | no³   |
| libuuid                                                                 | 1.0.3    | BSD-3-Clause                                    | no⁴     | sì    |
| bzip2                                                                   | 1.0.8    | bzip2-1.0.6 (*)                                 | sì      | sì    |
| SQLite                                                                  | 3.53.1   | pubblico dominio (*)                            | sì      | sì    |
| Runtime Microsoft Visual C++ (`vcruntime140.dll`, `vcruntime140_1.dll`) | —        | Microsoft Distributable Code (*)                | sì      | no    |

¹ Il `LICENSE.txt` riporta la PSF License Version 2 e, per le versioni storiche, le licenze
BeOpen, CNRI e CWI; i metadati di python-build-standalone indicano `Python-2.0` e `CNRI-Python`. Il
codice di terzi già dentro il sorgente di CPython è elencato nella documentazione di Python
(«Licenses and Acknowledgements for Incorporated Software»).
² Versione dei metadati di python-build-standalone; su Windows libffi ed Expat possono venire dalle
dipendenze precompilate di CPython, con la stessa licenza.
³ macOS usa la zlib del sistema (`/usr/lib/libz.1.dylib`), come libedit e ncurses: non sono nel
pacchetto.
⁴ Su Windows `_uuid` usa le funzioni del sistema (rpcrt4).

(*) Fuori dall'elenco delle licenze ammesse (spec sezione 40), accettate in attesa della decisione
di user1: bzip2-1.0.6 è una licenza simile a BSD, SQLite è nel pubblico dominio, il runtime
Microsoft si ridistribuisce alle condizioni riportate nel `LICENSE.txt` di Windows. Il
`LICENSE.txt` di Windows riporta anche la licenza di Tcl/Tk, che però non è più nel pacchetto.
