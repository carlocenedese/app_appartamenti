"""Prints the STRUCTURE of a bank statement `.xlsx`, never its values (development tool).

    python3 -I python/tools/xlsx_structure.py [--json] [--header-row N] [--known-labels "a,b"]
        [--code-columns "Cod Disp.,Segno"] <file.xlsx>

Standard library only (no import from `bollette_pdf`), read only, no network, no clock.

Safe by construction, not by heuristic: the only text ever printed from the file is a column label
that, normalised (lower case, no accents or punctuation), is IN AN ALLOWLIST of bank statement
column names (`KNOWN_LABELS`, extendable with `--known-labels`). Any other label is printed as
«colonna N, testo di K caratteri», a sheet as «foglio N»: no content. So even a wrong row picked as
header (account metadata, a data row) prints nothing personal.

Per visible sheet: size, header row, per column: prevalent type (testo, numero, data, vuoto), counts
(non-empty, distinct), band of the text length (<=10, <=30, >30), CLASS of the declared format
(generale, numero, percentuale, data, ora, testo; never the format string), first and last date as
YYYY-MM. Distinct values are listed ONLY for a column named in `--code-columns` (default «Segno»,
«Dare», «Avere»), only if every cell is TEXT of at most 3 letters, digits, + or -, and at most 12
distinct: never numbers or dates. «Cod Disp.» (a reference per instruction) prints only its FORM
(«11 cifre»). Rows above the header: cell types; a text with a range of two dates prints it as
YYYY-MM..YYYY-MM (years 2000-2100), any other date only «date: si».
Hidden sheets are skipped and counted. A bad or oversized file, a member that is not UTF-8, or a
DOCTYPE/ENTITY in any member read: constant message, exit code 2.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import posixpath
import re
import sys
import unicodedata
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, NoReturn, TextIO
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_MEMBER_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_MEMBERS = 200
MAX_ROWS = 50_000
MAX_COLS = 256
MAX_CELLS = 2_000_000
MAX_SHEETS = 50
HEADER_SCAN_ROWS = 100
LOW_CARDINALITY = 12
DEFAULT_CODE_COLUMNS = ("Segno", "Dare", "Avere")
FORM_COLUMNS = {"cod disp", "codice disposizione"}
CODE_VALUE = re.compile(r"[A-Za-z0-9+\-]{1,3}")
KNOWN_LABELS = (
    "data, data contabile, data valuta, data operazione, data registrazione, data movimento, "
    "data e ora, valuta, divisa, descrizione, descrizione operazione, causale, causale abi, "
    "causale operazione, importo, importo eur, importo in euro, segno, dare, avere, entrate, "
    "uscite, addebiti, accrediti, saldo, saldo contabile, saldo disponibile, cod disp, codice, "
    "codice disposizione, iban, intestatario, ordinante, beneficiario, controparte, tipo, "
    "tipo operazione, tipologia, categoria, note, riferimento, cro, trn, numero, n operazione, "
    "canale, commissioni, spese, filiale, conto, rapporto, abi, cab"
)
BAD_FILE = "File non valido o troppo grande: nessun output."
ARGUMENTS_ERROR = "Argomenti non validi: serve il percorso di un file .xlsx."
INTERNAL_ERROR = "Errore interno: nessun output."
HEADER_ERROR = "La riga indicata non è una riga di intestazione di sole etichette: nessun output."

_DATE_TEXT = re.compile(r"(\d{4})-(\d{2})-\d{2}|\d{1,2}[/.-](\d{1,2})[/.-](\d{4})")
_XML_ENCODING = re.compile(r"""<\?xml[^>]{0,200}?encoding\s*=\s*["']([^"']+)["']""", re.I)
_FORBIDDEN_XML = re.compile(r"<!(doctype|entity)", re.I)
_NS_STRIP = re.compile(r"\{[^}]*\}")
_BUILTIN_CLASS = {0: "generale", 9: "percentuale", 10: "percentuale", 49: "testo"}
_BUILTIN_CLASS.update({i: "data" for i in (14, 15, 16, 17, 22)})
_BUILTIN_CLASS.update({i: "ora" for i in (18, 19, 20, 21, 45, 46, 47)})


class _Rejected(Exception):
    """A problem with the file or the arguments: the message is a constant Italian sentence."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:  # argparse would echo what was typed
        raise _Rejected(ARGUMENTS_ERROR)


def _utf8_lf(stream: TextIO) -> TextIO:
    """`stream` writing UTF-8 with `\\n` line endings, the same on every system."""
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
        except (AttributeError, OSError, ValueError):
            pass
    return stream


def _normalise(label: str) -> str:
    decomposed = unicodedata.normalize("NFKD", label)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", plain).split())


def _names(csv: str) -> set[str]:
    return {n for n in (_normalise(p) for p in csv.split(",")) if n}


def _tag(element: ET.Element) -> str:
    return _NS_STRIP.sub("", element.tag)


def _check_text(data: bytes) -> None:
    """Rejects any member that is not UTF-8 or has a DOCTYPE/ENTITY. The search is on the DECODED
    text: in UTF-16 the bytes of «<!DOCTYPE» do not match a byte search."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise _Rejected(BAD_FILE) from None
    if "\0" in text or _FORBIDDEN_XML.search(text):
        raise _Rejected(BAD_FILE)
    declared = _XML_ENCODING.search(text[:300])
    if declared is not None and declared.group(1).lower() not in ("utf-8", "utf8"):
        raise _Rejected(BAD_FILE)


def _xml(data: bytes) -> ET.Element:
    _check_text(data)
    return ET.fromstring(data)


def _member(zf: zipfile.ZipFile, name: str, budget: list[int]) -> bytes | None:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    with zf.open(info) as handle:
        data = handle.read(MAX_MEMBER_BYTES + 1)
    budget[0] += len(data)
    if len(data) > MAX_MEMBER_BYTES or budget[0] > MAX_TOTAL_BYTES:
        raise _Rejected(BAD_FILE)
    return data


def _column_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref)
    if letters is None:
        raise _Rejected(BAD_FILE)
    index = 0
    for char in letters.group():
        index = index * 26 + ord(char) - 64
    return index


def _column_letters(index: int) -> str:
    letters = ""
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def _format_class(fmt_id: int, code: str | None) -> str:
    """Class of a number format; the format string itself is never kept."""
    if code is None:
        return _BUILTIN_CLASS.get(fmt_id, "numero")
    bare = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.|_.|\*.', "", code).lower()
    if bare in ("general", "generale"):
        return "generale"
    if "@" in bare:
        return "testo"
    if "%" in bare:
        return "percentuale"
    if re.search(r"[yd]", bare) or ("m" in bare and not re.search(r"[hs]", bare)):
        return "data"
    if re.search(r"[hs]", bare):
        return "ora"
    return "numero"


def _read_styles(data: bytes | None) -> list[str]:
    """Per cell style index, the class of its number format."""
    if data is None:
        return []
    custom: dict[int, str] = {}
    xfs: list[int] = []
    for element in _xml(data).iter():
        if _tag(element) == "numFmt":
            custom[int(element.get("numFmtId", "0"))] = element.get("formatCode", "")
        elif _tag(element) == "cellXfs":
            xfs = [int(xf.get("numFmtId", "0")) for xf in element if _tag(xf) == "xf"]
    return [_format_class(i, custom.get(i)) for i in xfs]


def _read_shared(data: bytes | None) -> list[str]:
    if data is None:
        return []

    def texts(node: ET.Element) -> list[str]:
        # rPh is phonetic text, not part of the cell value
        return [
            (child.text or "") if _tag(child) == "t" else "".join(texts(child))
            for child in node
            if _tag(child) in ("t", "r")
        ]

    return ["".join(texts(si)) for si in _xml(data) if _tag(si) == "si"]


def _month(serial: float, epoch: int) -> str | None:
    """Excel serial day to YYYY-MM with integers only; None when it is not a valid date."""
    try:
        d = date.fromordinal(epoch + int(serial))
    except (ValueError, OverflowError):
        return None
    return f"{d.year:04d}-{d.month:02d}"


def _text_months(text: str) -> list[str]:
    months = []
    for m in _DATE_TEXT.finditer(text):
        if m.group(1):
            year, month = m.group(1), m.group(2)
        else:
            year, month = m.group(4), m.group(3).zfill(2)
        if 1 <= int(month) <= 12:
            months.append(f"{year}-{month}")
    return months


# A cell is (kind, key, extra): kind in testo/numero/data/vuoto; key is the raw value (counted, never
# printed except for code columns); extra is the format class (numero) or YYYY-MM ("" if invalid).
Cell = tuple[str, str, str]


def _cell(c: ET.Element, shared: list[str], styles: list[str], epoch: int) -> Cell:
    kind = c.get("t", "n")
    value = next((v.text or "" for v in c if _tag(v) == "v"), "")
    if kind == "inlineStr":
        text = "".join(t.text or "" for p in c if _tag(p) == "is" for t in p.iter() if _tag(t) == "t")
    elif kind == "s":
        try:
            text = shared[int(value)]
        except (ValueError, IndexError):
            raise _Rejected(BAD_FILE) from None
    elif kind in ("str", "e"):
        text = value
    elif kind == "b":
        return ("testo", value, "")
    else:
        if value.strip() == "":
            return ("vuoto", "", "")
        try:
            number = float(value)
        except ValueError:
            raise _Rejected(BAD_FILE) from None
        index = int(c.get("s", "0"))
        cls = styles[index] if index < len(styles) else "generale"
        if cls == "data" and number >= 1:
            return ("data", value, _month(number, epoch) or "")
        return ("numero", value, cls)
    if text.strip() == "":
        return ("vuoto", "", "")
    months = _text_months(text) if len(text) <= 40 else []
    if len(months) == 1 and _DATE_TEXT.fullmatch(text.strip()):
        return ("data", text, months[0])
    return ("testo", text, "")


def _read_sheet(
    data: bytes, shared: list[str], styles: list[str], epoch: int
) -> dict[int, dict[int, Cell]]:
    _check_text(data)
    rows: dict[int, dict[int, Cell]] = {}
    last_row = cells = 0
    for _, row in ET.iterparse(io.BytesIO(data), events=("end",)):
        if _tag(row) != "row":
            continue
        last_row = int(row.get("r", last_row + 1))
        if not 1 <= last_row <= MAX_ROWS:
            raise _Rejected(BAD_FILE)
        last_col = 0
        for c in row:
            if _tag(c) != "c":
                continue
            last_col = _column_index(c.get("r") or "") if c.get("r") else last_col + 1
            cells += 1
            if last_col > MAX_COLS or cells > MAX_CELLS:
                raise _Rejected(BAD_FILE)
            cell = _cell(c, shared, styles, epoch)
            if cell[0] != "vuoto":
                rows.setdefault(last_row, {})[last_col] = cell
        row.clear()
    return rows


def _workbook(zf: zipfile.ZipFile, budget: list[int]) -> tuple[list[tuple[int, str, bool]], int]:
    """(position, member path, hidden) of every sheet, and the epoch ordinal of the date system."""
    workbook = _member(zf, "xl/workbook.xml", budget)
    rels = _member(zf, "xl/_rels/workbook.xml.rels", budget)
    if workbook is None or rels is None:
        raise _Rejected(BAD_FILE)
    targets = {r.get("Id"): r.get("Target", "") for r in _xml(rels) if _tag(r) == "Relationship"}
    epoch = date(1899, 12, 30).toordinal()
    found = []
    for node in _xml(workbook).iter():
        if _tag(node) == "workbookPr" and node.get("date1904", "").lower() in ("1", "true"):
            epoch = date(1904, 1, 1).toordinal()
        if _tag(node) != "sheet":
            continue
        target = next((v for k, v in node.attrib.items() if k.endswith("}id")), None)
        path = targets.get(target or "", "")
        path = path.lstrip("/") if path.startswith("/") else posixpath.normpath(f"xl/{path}")
        if not path or path.startswith(".."):
            raise _Rejected(BAD_FILE)
        found.append((len(found) + 1, path, node.get("state", "visible") != "visible"))
    if not found or len(found) > MAX_SHEETS:
        raise _Rejected(BAD_FILE)
    return found, epoch


def _label(cell: Cell, col: int, known: set[str]) -> str:
    """The label only if it is in the allowlist; otherwise a description without content."""
    if cell[0] == "testo":
        name = _normalise(cell[1])
        if name in known:
            return name
        return f"(colonna {col}, testo, lunghezza {_band(len(cell[1].strip()))})"
    return f"(colonna {col}, {cell[0]})"


def _is_label_row(cells: dict[int, Cell], known: set[str]) -> bool:
    """Only text cells, at least 2 known labels and at least half of the cells known."""
    if not cells or any(c[0] != "testo" for c in cells.values()):
        return False
    hits = sum(1 for c in cells.values() if _normalise(c[1]) in known)
    return hits >= 2 and hits * 2 >= len(cells)


def _header_row(rows: dict[int, dict[int, Cell]], known: set[str]) -> int | None:
    numbers = sorted(rows)
    top = next((r for r in numbers[:HEADER_SCAN_ROWS] if _is_label_row(rows[r], known)), None)
    if top is not None:
        return top
    return next(
        (r for r in numbers if len(rows[r]) >= 3 and all(c[0] == "testo" for c in rows[r].values())),
        None,
    )


def _preamble(cells: dict[int, Cell]) -> list[dict[str, Any]]:
    out = []
    for col in sorted(cells):
        kind, key, _ = cells[col]
        item: dict[str, Any] = {"cella": _column_letters(col), "tipo": kind}
        if kind == "testo":
            months = _text_months(key)
            # a period is two dates in one cell, both in plausible years: any other date is only «si»
            if len(months) == 2 and all("2000" <= m[:4] <= "2100" for m in months):
                item["intervallo"] = f"{min(months)}..{max(months)}"
            else:
                item["date"] = "si" if months else "no"
        elif kind == "data":
            item["date"] = "si"
        out.append(item)
    return out


def _band(length: int) -> str:
    return "<=10" if length <= 10 else "<=30" if length <= 30 else ">30"


def _form(cells: list[Cell]) -> str:
    keys = [c[1] for c in cells if c[0] in ("testo", "numero")]
    if not keys or len(keys) != len(cells):
        return "mista"
    lengths = sorted({len(k) for k in keys})
    size = str(lengths[0]) if len(lengths) == 1 else f"{lengths[0]}-{lengths[-1]}"
    if all(k.isascii() and k.isdigit() for k in keys):
        return f"{size} cifre"
    if all(k.isascii() and k.isalnum() for k in keys):
        return f"{size} caratteri alfanumerici"
    return "mista"


def _column(label: str, cells: list[Cell], code: bool, rows_count: int) -> dict[str, Any]:
    kinds = Counter(c[0] for c in cells)
    prevalent = kinds.most_common(1)[0][0] if cells else "vuoto"
    distinct = {c[1] for c in cells}
    info: dict[str, Any] = {
        "intestazione": label,
        "tipo": prevalent,
        "non_vuoti": len(cells),
        "vuoti": rows_count - len(cells),
        "distinti": len(distinct),
    }
    texts = [len(c[1]) for c in cells if c[0] == "testo"]
    if texts:
        info["fascia_lunghezza_testo"] = _band(max(texts))
    if prevalent == "numero":
        info["classe_formato"] = Counter(c[2] for c in cells if c[0] == "numero").most_common(1)[0][0]
    if prevalent == "data":
        months = sorted(c[2] for c in cells if c[0] == "data" and c[2])
        info["date_non_valide"] = sum(1 for c in cells if c[0] == "data" and not c[2])
        if months:
            info["primo_mese"], info["ultimo_mese"] = months[0], months[-1]
    if label in FORM_COLUMNS and cells:
        info["forma"] = _form(cells)
    elif (
        code
        and distinct
        and len(distinct) <= LOW_CARDINALITY
        and all(c[0] == "testo" and CODE_VALUE.fullmatch(c[1]) for c in cells)
    ):
        info["valori"] = sorted(distinct)
    return info


def _analyse_sheet(
    position: int,
    rows: dict[int, dict[int, Cell]],
    known: set[str],
    code_names: set[str],
    header_row: int | None,
) -> dict[str, Any]:
    numbers = sorted(rows)
    header = header_row if header_row is not None else _header_row(rows, known)
    sheet: dict[str, Any] = {
        "foglio": position,
        "righe": numbers[-1] if numbers else 0,
        "colonne": max((max(r) for r in rows.values()), default=0),
        "riga_intestazione": header,
    }
    if header is not None and header in rows:
        if header_row is not None and any(c[0] != "testo" for c in rows[header].values()):
            raise _Rejected(HEADER_ERROR)
        sheet["sopra_intestazione"] = [
            {"riga": r, "celle": _preamble(rows[r])} for r in numbers if r < header
        ]
        body = [rows[r] for r in numbers if r > header]
        sheet["righe_dati"] = len(body)
        columns = []
        for col in sorted(rows[header]):
            label = _label(rows[header][col], col, known)
            columns.append(
                _column(label, [r[col] for r in body if col in r], label in code_names, len(body))
            )
        sheet["colonne_dettaglio"] = columns
    return sheet


def analyse(
    path: Path, code_columns: tuple[str, ...], header_row: int | None, extra_labels: str = ""
) -> dict[str, Any]:
    code_names = {n for n in (_normalise(c) for c in code_columns) if n}
    known = _names(KNOWN_LABELS) | _names(extra_labels) | code_names
    sheets: list[dict[str, Any]] = []
    hidden = 0
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            raise _Rejected(BAD_FILE)
        budget = [0]
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if len(names) > MAX_MEMBERS or len(set(names)) != len(names):
                raise _Rejected(BAD_FILE)
            styles = _read_styles(_member(zf, "xl/styles.xml", budget))
            shared = _read_shared(_member(zf, "xl/sharedStrings.xml", budget))
            listed, epoch = _workbook(zf, budget)
            for position, member, is_hidden in listed:
                if is_hidden:
                    hidden += 1
                    continue
                data = _member(zf, member, budget)
                if data is None:
                    raise _Rejected(BAD_FILE)
                rows = _read_sheet(data, shared, styles, epoch)
                sheets.append(_analyse_sheet(position, rows, known, code_names, header_row))
    except _Rejected:
        raise
    except Exception:  # BadZipFile, ParseError, OSError, ...: never echo what they quote
        raise _Rejected(BAD_FILE) from None
    return {"fogli": sheets, "fogli_nascosti_ignorati": hidden}


def render(report: dict[str, Any]) -> str:
    lines: list[str] = []
    for sheet in report["fogli"]:
        lines.append(f"Foglio {sheet['foglio']}: {sheet['righe']} righe, {sheet['colonne']} colonne")
        if sheet["riga_intestazione"] is None or "colonne_dettaglio" not in sheet:
            lines.append("  Intestazione non individuata.")
            continue
        lines.append(f"  Riga delle intestazioni: {sheet['riga_intestazione']}")
        for above in sheet["sopra_intestazione"]:
            cells = ", ".join(
                f"{c['cella']}={c['tipo']}"
                + (f" (intervallo {c['intervallo']})" if "intervallo" in c else "")
                + (f" (date: {c['date']})" if "date" in c else "")
                for c in above["celle"]
            )
            lines.append(f"  Riga {above['riga']} sopra l'intestazione: {cells}")
        lines.append(f"  Righe di dati: {sheet['righe_dati']}")
        for col in sheet["colonne_dettaglio"]:
            parts = [
                f"tipo {col['tipo']}",
                f"{col['non_vuoti']} non vuoti",
                f"{col['distinti']} distinti",
            ]
            if "fascia_lunghezza_testo" in col:
                parts.append(f"lunghezza testo {col['fascia_lunghezza_testo']}")
            if "classe_formato" in col:
                parts.append(f"formato {col['classe_formato']}")
            if "primo_mese" in col:
                parts.append(f"da {col['primo_mese']} a {col['ultimo_mese']}")
            if col.get("date_non_valide"):
                parts.append(f"{col['date_non_valide']} data non valida")
            if "forma" in col:
                parts.append(f"forma {col['forma']}")
            if "valori" in col:
                parts.append("valori: " + ", ".join(f"«{v}»" for v in col["valori"]))
            lines.append(f"  Colonna «{col['intestazione']}»: " + "; ".join(parts))
    if report["fogli_nascosti_ignorati"]:
        lines.append(f"{report['fogli_nascosti_ignorati']} fogli nascosti ignorati")
    return "\n".join(lines) + "\n"


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = _utf8_lf(sys.stdout if stdout is None else stdout)
    err = _utf8_lf(sys.stderr if stderr is None else stderr)
    message = ""
    try:
        parser = _Parser(add_help=False)
        parser.add_argument("--json", action="store_true")
        parser.add_argument("--header-row", type=int)
        parser.add_argument("--code-columns")
        parser.add_argument("--known-labels", default="")
        parser.add_argument("file")
        args = parser.parse_args(argv)
        names = (
            DEFAULT_CODE_COLUMNS
            if args.code_columns is None
            else tuple(n.strip() for n in args.code_columns.split(",") if n.strip())
        )
        report = analyse(Path(args.file), names, args.header_row, args.known_labels)
        text = (
            json.dumps(report, ensure_ascii=False, indent=2) + "\n" if args.json else render(report)
        )
        out.write(text)
        out.flush()
        return 0
    except _Rejected as rejected:  # only the constant messages above
        message = str(rejected)
    except Exception:  # includes a closed pipe: never a traceback
        message = INTERNAL_ERROR
    if stdout is None:  # a real closed pipe: stop the exit-time flush of stdout from complaining
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        except Exception:
            pass
    try:
        err.write(f"{message}\n")
    except Exception:
        pass
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
