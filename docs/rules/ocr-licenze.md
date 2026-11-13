# OCR: librerie native e licenze delle ruote

Stato: **inventario del 13 novembre 2026** (Task 1 del piano 2b-1, `docs/plans/2026-11-13-piano-2b-ocr.md`).
Esito: **da chiedere a Carlo** (vedi «Conclusione»); `python/THIRD_PARTY.md` e `CLAUDE.md` non sono
stati toccati.

## Metodo

Ruote scaricate da PyPI con `pip download --no-deps --only-binary=:all: --python-version 3.13
--implementation cp --abi cp313` in una cartella temporanea fuori dal repository, lette senza
importarle né eseguirle: elenco dei file con `zipfile`/`unzip`, licenze lette dai file in
`.dist-info/licenses`, librerie collegate e minimo macOS letti con `otool -L`/`otool -l` (macOS) e con
i nomi delle DLL presenti nei file (Windows), versioni lette dalle stringhe dentro le librerie o dal
nome del file. Tutto è stato cancellato a fine lavoro.

## Ruote e dati

| File                                                  | SHA-256                                                            | Byte compressi | Byte decompressi | File | Minimo macOS (etichetta) |
| ----------------------------------------------------- | ------------------------------------------------------------------ | -------------: | ---------------: | ---: | ------------------------ |
| `tesserocr-2.12.0-cp313-cp313-macosx_15_0_arm64.whl`  | `6c2b5b42ad2070ef2fc71952a425b23d1cbfb0f90c7af15d0fc744f9ed0d37cd` |      3.623.075 |        9.008.172 |   22 | 15.0                     |
| `tesserocr-2.12.0-cp313-cp313-macosx_15_0_x86_64.whl` | `c9ce10a86e7d263dcae29bc143ad0de1ce7af3509bc3a19816f5deb50d4ebb90` |      4.092.905 |        9.679.469 |   22 | 15.0                     |
| `tesserocr-2.12.0-cp313-cp313-win_amd64.whl`          | `7ee14f90a09ad75f78010e12e45770ad16569c6d17d5f175f1a948d9cf67976e` |     23.142.504 |       58.524.364 |  108 | —                        |
| `pypdfium2-5.14.0-py3-none-macosx_13_0_arm64.whl`     | `2de384df66ba55fcaab0775f30f28ec1090af3dfa60276a07821efc96d993118` |      3.542.294 |        7.868.086 |   71 | 13.0                     |
| `pypdfium2-5.14.0-py3-none-macosx_13_0_x86_64.whl`    | `e4e203ea9710fd00e5448edb6f1615dc8587035357f75f40b432dde0c33e8da1` |      3.735.845 |        8.233.088 |   71 | 13.0                     |
| `pypdfium2-5.14.0-py3-none-win_amd64.whl`             | `149fd5c6397b8df8bf7911a93506eff0be874f877afe7ac936cf5d37d21a6a06` |      3.947.280 |        7.984.875 |   71 | —                        |
| `ita.traineddata` (tessdata_fast)                     | `b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827` |              — |        2.701.314 |    1 | —                        |

- Tutte e sei le ruote esistono (nessuna piattaforma mancante). tesserocr 2.12.0 è del 22 ottobre
  2026, pypdfium2 5.14.0 del 4 ottobre 2026 (date di PyPI).
- **Minimo macOS:** l'etichetta di tesserocr dice 15.0, ma il modulo `tesserocr.cpython-313-darwin.so`
  è compilato con `minos 15.7` (comando `LC_BUILD_VERSION`, entrambe le architetture); le librerie in
  `.dylibs` hanno `minos` tra 12.0 e 15.0. Che il modulo si carichi su macOS 15.0-15.6 è **non
  verificato**: il minimo sicuro è 15.7. pypdfium2 (`libpdfium.dylib`) ha `minos 13.0`.
- `ita.traineddata`: repository `tesseract-ocr/tessdata_fast`, tag `4.1.0` (16 febbraio 2021);
  il file è lo stesso (blob git `edbffbe0e51892b240630b5eeabededa7e7c9c4f`) dal commit
  `923915d4ced2a7235221788285785a29c4a42d4a` (14 settembre 2017, «Initial import to github») fino
  all'ultimo commit di `main` (`87416418657359cb625c412a48b6e1d6d41c29bd`, 1 agosto 2024). Licenza del
  repository: Apache-2.0 (file `LICENSE`).
- Su macOS tesserocr usa `libcurl`, `libz` e `libc++` del sistema (`/usr/lib`), non contenute nella
  ruota; pypdfium2 usa solo i framework di sistema.

## Librerie native e licenze

Colonne «Dove»: **Ma** = tesserocr macOS arm64 e x86_64 (`tesserocr/.dylibs/`), **Wi** = tesserocr
Windows x64 (`tesserocr.libs/`, ruota riparata con delvewheel 1.13.2, librerie di conda-forge),
**Pd** = pypdfium2 su tutte e tre le piattaforme (tutto collegato staticamente in
`pypdfium2_raw/libpdfium.dylib` o `pdfium.dll`; licenze in
`.dist-info/licenses/data/<piattaforma>/BUILD_LICENSES/`, identiche sulle tre piattaforme a meno dei
fine riga e del commento `//` in `pdfium.txt`).

### tesserocr e pypdfium2 (pacchetti)

| Libreria  | Versione | Licenza                                | Dove                                | Verdetto             |
| --------- | -------- | -------------------------------------- | ----------------------------------- | -------------------- |
| tesserocr | 2.12.0   | MIT (`.dist-info/licenses/LICENSE`)    | modulo `.so`/`.pyd`, tutte le ruote | permissiva accettata |
| pypdfium2 | 5.14.0   | BSD-3-Clause, Apache-2.0 (`LICENSES/`) | codice Python, tutte le ruote       | permissiva accettata |

### Dentro pypdfium2 (PDFium di pdfium-binaries, build 156.0.8076)

| Libreria                 | Versione       | Licenza                                                | Dove | Verdetto             |
| ------------------------ | -------------- | ------------------------------------------------------ | ---- | -------------------- |
| PDFium                   | 156.0.8076     | BSD-3-Clause (`pdfium.txt`)                            | Pd   | permissiva accettata |
| pdfium-binaries (script) | —              | MIT (`pdfium-binaries.txt`)                            | Pd   | permissiva accettata |
| Abseil                   | non verificato | Apache-2.0 (`abseil.txt`)                              | Pd   | permissiva accettata |
| Anti-Grain Geometry 2.3  | 2.3            | avviso permissivo di AGG, stile BSD (`agg23.txt`)      | Pd   | permissiva accettata |
| fast_float               | non verificato | MIT (`fast_float.txt`)                                 | Pd   | permissiva accettata |
| FreeType                 | non verificato | FTL, opzione FTL della doppia licenza (`freetype.txt`) | Pd   | permissiva accettata |
| ICU                      | non verificato | Unicode-3.0 (`icu.txt`)                                | Pd   | permissiva accettata |
| Little CMS               | non verificato | MIT (`lcms.txt`)                                       | Pd   | permissiva accettata |
| libjpeg-turbo            | non verificato | IJG + BSD-3-Clause + Zlib (`libjpeg_turbo.md`, `.ijg`) | Pd   | permissiva accettata |
| OpenJPEG                 | non verificato | BSD-2-Clause (`libopenjpeg.txt`)                       | Pd   | permissiva accettata |
| libpng                   | non verificato | libpng License v2 (`libpng.txt`)                       | Pd   | permissiva accettata |
| LLVM libc                | non verificato | Apache-2.0 con LLVM Exception (`llvm-libc.txt`)        | Pd   | permissiva accettata |
| simdutf                  | non verificato | MIT (`simdutf.txt`)                                    | Pd   | permissiva accettata |
| zlib                     | 1.3.2.1        | Zlib (`zlib.txt`)                                      | Pd   | permissiva accettata |

Nota: pypdfium2 porta anche `LICENSES/CC-BY-4.0.txt`, che vale per documentazione ed esempi del
progetto (lo dice il suo `METADATA`), non per codice nella ruota; non è una libreria nativa.

### Dentro tesserocr macOS (arm64 e x86_64)

La ruota macOS non contiene **nessun** file di licenza delle librerie in `.dylibs/` (solo il
`LICENSE` MIT di tesserocr). La licenza indicata è quella del progetto a monte, nota ma **non letta
dalla ruota**.

| Libreria (file)                         | Versione                      | Licenza a monte (non nella ruota)               | Dove | Verdetto                                       |
| --------------------------------------- | ----------------------------- | ----------------------------------------------- | ---- | ---------------------------------------------- |
| Tesseract (`libtesseract.5.5.3.dylib`)  | 5.5.3                         | Apache-2.0                                      | Ma   | da chiedere a Carlo (file di licenza mancante) |
| Leptonica (`libleptonica.6.0.0.dylib`)  | non verificato (soname 6.0.0) | BSD-2-Clause                                    | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libpng (`libpng16.16.dylib`)            | 1.6.58                        | libpng License v2                               | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libjpeg-turbo (`libjpeg.8.3.2.dylib`)   | 3.2.0                         | IJG + BSD-3-Clause + Zlib                       | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libtiff (`libtiff.6.dylib`)             | 4.7.2                         | libtiff                                         | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libwebp (`libwebp.7.2.0.dylib`)         | non verificato (soname 7.2.0) | BSD-3-Clause                                    | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libwebpmux (`libwebpmux.3.1.2.dylib`)   | non verificato (soname 3.1.2) | BSD-3-Clause                                    | Ma   | da chiedere a Carlo (file di licenza mancante) |
| libsharpyuv (`libsharpyuv.0.1.2.dylib`) | non verificato (soname 0.1.2) | BSD-3-Clause                                    | Ma   | da chiedere a Carlo (file di licenza mancante) |
| liblzma (`liblzma.5.dylib`)             | 5.8.3                         | 0BSD                                            | Ma   | da chiedere a Carlo (file di licenza mancante) |
| Zstandard (`libzstd.1.5.7.dylib`)       | 1.5.7                         | BSD-3-Clause o GPL-2.0 (doppia, si sceglie BSD) | Ma   | da chiedere a Carlo (file di licenza mancante) |

### Dentro tesserocr Windows x64

Licenze lette da `.dist-info/licenses/.wheel-licenses/<pacchetto>/`. Dipendenze lette dai nomi delle
DLL dentro ciascuna DLL: `tesseract55` → `leptonica`, `archive`, `libcurl`; `archive` → `iconv`,
`charset`, `libxml2`, `libbz2`, `liblzma`, `lz4`, `zstd`, `zlib`; `libxml2` → `iconv`, `icuuc78`.

| Libreria (DLL)                                | Versione                  | Licenza (file nella ruota)                                                                            | Dove | Verdetto                |
| --------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | ----------------------- |
| Tesseract (`tesseract55`)                     | 5.5.3                     | Apache-2.0 (`tesseract/tesseract/LICENSE`)                                                            | Wi   | permissiva accettata    |
| Leptonica (`leptonica-1.87.0`)                | 1.87.0                    | BSD-2-Clause (`leptonica/leptonica-license.txt`)                                                      | Wi   | permissiva accettata    |
| libpng (`libpng16`)                           | 1.6.59                    | libpng License v2 (`libpng/LICENSE`)                                                                  | Wi   | permissiva accettata    |
| libjpeg-turbo (`jpeg8`)                       | 3.2.0                     | IJG + BSD-3-Clause + Zlib (`libjpeg-turbo/LICENSE.md`)                                                | Wi   | permissiva accettata    |
| libtiff (`tiff`)                              | 4.7.2                     | libtiff (`libtiff/LICENSE.md`)                                                                        | Wi   | permissiva accettata    |
| libwebp, libwebpmux, libsharpyuv              | non verificato            | BSD-3-Clause (`libwebp-base/COPYING`)                                                                 | Wi   | permissiva accettata    |
| giflib (`gif-7`)                              | non verificato (soname 7) | MIT (`giflib/COPYING`); `getopt` di mingw-w64: ISC (`getopt_LICENSE.txt`)                             | Wi   | permissiva accettata    |
| OpenJPEG (`openjp2`)                          | 2.5.4                     | BSD-2-Clause (`openjpeg/LICENSE`)                                                                     | Wi   | permissiva accettata    |
| LERC (`Lerc`)                                 | non verificato            | Apache-2.0 (`lerc/LICENSE`)                                                                           | Wi   | permissiva accettata    |
| libdeflate (`deflate`)                        | non verificato            | MIT (`libdeflate/COPYING`)                                                                            | Wi   | permissiva accettata    |
| zlib (`zlib`)                                 | 1.3.2                     | Zlib (`libzlib/LICENSE`)                                                                              | Wi   | permissiva accettata    |
| Zstandard (`zstd`)                            | 1.5.7                     | BSD-3-Clause (`zstd/LICENSE`)                                                                         | Wi   | permissiva accettata    |
| liblzma (`liblzma`)                           | non verificato            | 0BSD (`liblzma/COPYING`, `COPYING.0BSD`; GPL/LGPL solo per strumenti non inclusi)                     | Wi   | permissiva accettata    |
| bzip2 (`libbz2`)                              | 1.0.8                     | bzip2-1.0.6, stile BSD (`bzip2/LICENSE`; come R69)                                                    | Wi   | permissiva accettata    |
| LZ4 (`lz4`)                                   | 1.10.0                    | BSD-2-Clause (`lz4-c/lib/LICENSE`)                                                                    | Wi   | permissiva accettata    |
| libarchive (`archive`)                        | 3.8.9                     | BSD-2-Clause (`libarchive/COPYING`)                                                                   | Wi   | permissiva accettata    |
| libxml2 (`libxml2`)                           | non verificato            | MIT (`libxml2/Copyright`, `libxml2-16/Copyright`)                                                     | Wi   | permissiva accettata    |
| ICU (`icuuc78`, `icudt78`)                    | 78.3                      | Unicode-3.0 (`icu/LICENSE`)                                                                           | Wi   | permissiva accettata    |
| libcurl (`libcurl`)                           | 8.23.0                    | curl, stile MIT (`libcurl/COPYING`)                                                                   | Wi   | permissiva accettata    |
| libssh2 (`libssh2`)                           | non verificato            | BSD-3-Clause (`libssh2/COPYING`)                                                                      | Wi   | permissiva accettata    |
| libpsl (`psl-5`)                              | 0.23.1                    | MIT (`libpsl/LICENSE`)                                                                                | Wi   | permissiva accettata    |
| OpenSSL (`libcrypto-3-x64`)                   | 3.6.5                     | Apache-2.0 (`openssl/LICENSE.txt`)                                                                    | Wi   | permissiva accettata    |
| Kerberos (krb5)                               | —                         | stile BSD/MIT (`krb5/doc/notice.rst`); nessuna DLL krb5 nella ruota                                   | Wi   | permissiva accettata    |
| **GNU libiconv (`iconv`)**                    | non verificato            | **LGPL-2.1** (`libiconv/COPYING.LIB`)                                                                 | Wi   | **da chiedere a Carlo** |
| **libcharset (`charset`)**, parte di libiconv | non verificato            | **LGPL-2.1** (stesso file di libiconv)                                                                | Wi   | **da chiedere a Carlo** |
| **ca-certificates**                           | —                         | **MPL-2.0** (`ca-certificates/LICENSE`); nessun file di certificati trovato nella ruota               | Wi   | **da chiedere a Carlo** |
| **Runtime Microsoft C++ (`msvcp140`)**        | non verificato            | licenza Microsoft (`vc14_runtime/LICENSE.TXT`)                                                        | Wi   | **da chiedere a Carlo** |
| **UCRT, vcomp14**                             | —                         | licenze Microsoft (`ucrt/LICENSE.txt`, `vcomp14/LICENSE.TXT`); nessuna DLL corrispondente nella ruota | Wi   | **da chiedere a Carlo** |

### Dati

| File                              | Origine                                  | Licenza                | Verdetto             |
| --------------------------------- | ---------------------------------------- | ---------------------- | -------------------- |
| `ita.traineddata` (tessdata_fast) | `tesseract-ocr/tessdata_fast`, tag 4.1.0 | Apache-2.0 (`LICENSE`) | permissiva accettata |

## Conclusione

Conteggio: 40 righe permissive accettate, 15 da chiedere a Carlo (10 su macOS per file di licenza mancante, 5 su Windows).

Il lavoro si ferma (decisione 2 del disegno): **la ruota Windows di tesserocr contiene GNU libiconv
e libcharset sotto LGPL-2.1**, collegate dinamicamente come DLL separate da libarchive e libxml2 (a loro volta caricate da
Tesseract). Inoltre:

1. **macOS:** le dieci librerie in `tesserocr/.dylibs/` hanno licenze a monte permissive (Apache-2.0,
   BSD, libpng, libtiff, IJG, 0BSD, Zstandard scegliendo BSD), ma la ruota non porta i testi delle
   licenze; bisognerebbe aggiungerli noi in `THIRD_PARTY.md` e nell'installer.
2. **Windows:** oltre a libiconv, un file di licenza MPL-2.0 (ca-certificates, senza file di
   certificati nella ruota) e il runtime Microsoft `msvcp140.dll` (licenza Microsoft, come
   `vcruntime140*.dll` già accettati in attesa di conferma con R69).
3. **Minimo macOS:** il modulo di tesserocr dichiara `minos 15.7`, non 15.0 come l'etichetta.

Possibili strade, da decidere da Carlo: accettare LGPL-2.1 per due DLL separate e sostituibili su
Windows; compilare noi tesserocr/Tesseract per Windows senza libarchive e libcurl (sparirebbero,
da verificare, libiconv, libcharset, libxml2, ICU, libcurl, libssh2, libpsl, OpenSSL e ca-certificates); oppure
usare un'altra fonte delle librerie per Windows. pypdfium2 e `ita.traineddata` sono a posto.
