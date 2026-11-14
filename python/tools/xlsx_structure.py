"""Prints the STRUCTURE of a bank statement `.xlsx`, never its values (development tool).

    python3 -I python/tools/xlsx_structure.py [--json] [--header-row N] [--code-columns "Cod Disp.,Segno"] <file.xlsx>

Standard library only (`zipfile` + `xml.etree`), read only, no network, no clock. For every sheet:
name, size, the detected header row (column labels are printed, masked when they look like data),
and per column: prevalent type (testo, numero, data, vuoto), non-empty count, distinct count (only
the count), text length min/max, declared number/date format, first and last date as YYYY-MM.
The distinct values are listed ONLY for columns named like a code (`--code-columns`, default
«Cod Disp.», «Cod. Disp.», «Segno», «Valuta») with at most 12 distinct values. Rows above the
header: only the type of each cell, and for a text with two or more dates the range as YYYY-MM.
Never prints a row, a text, an amount, a day. A bad or oversized file gives a constant message
and exit code 2. XML with a DOCTYPE or entities is rejected, never parsed.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, NoReturn, TextIO
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bollette_pdf.__main__ import _utf8_lf  # noqa: E402

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_MEMBERS = 200
MAX_ROWS = 200_000
MAX_COLS = 256
MAX_SHEETS = 50
LOW_CARDINALITY = 12
DEFAULT_CODE_COLUMNS = ("Cod Disp.", "Cod. Disp.", "Segno", "Valuta")
BAD_FILE = "File non valido o troppo grande: nessun output."
ARGUMENTS_ERROR = "Argomenti non validi: serve il percorso di un file .xlsx."

_DATE_TEXT = re.compile(r"(\d{4})-(\d{2})-\d{2}|\d{1,2}[/.-](\d{1,2})[/.-](\d{4})")
_BUILTIN_DATE_IDS = set(range(14, 23)) | {45, 46, 47}
_BUILTIN_FORMATS = {0: "Generale", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%"}
_NS_STRIP = re.compile(r"\{[^}]*\}")


class _Rejected(Exception):
    """A problem with the file or the arguments: the message is a constant Italian sentence."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:  # argparse would echo what was typed
        raise _Rejected(ARGUMENTS_ERROR)


def _tag(element: ET.Element) -> str:
    return _NS_STRIP.sub("", element.tag)


def _xml(data: bytes) -> ET.Element:
    head = data.lower()
    if b"<!doctype" in head or b"<!entity" in head:
        raise _Rejected(BAD_FILE)
    return ET.fromstring(data)


def _member(zf: zipfile.ZipFile, name: str, budget: list[int]) -> bytes | None:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_MEMBER_BYTES:
        raise _Rejected(BAD_FILE)
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


def _is_date_format(code: str) -> bool:
    bare = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", code).lower()
    return re.search(r"[ymdhs]", bare) is not None


def _read_styles(data: bytes | None) -> list[tuple[str, bool]]:
    """Per cell style index: (declared format code, is a date format)."""
    if data is None:
        return []
    root = _xml(data)
    custom: dict[int, str] = {}
    xfs: list[int] = []
    for element in root.iter():
        if _tag(element) == "numFmt":
            custom[int(element.get("numFmtId", "0"))] = element.get("formatCode", "")
        elif _tag(element) == "cellXfs":
            xfs = [int(xf.get("numFmtId", "0")) for xf in element if _tag(xf) == "xf"]
    styles = []
    for fmt_id in xfs:
        code = custom.get(fmt_id) or _BUILTIN_FORMATS.get(fmt_id, f"predefinito {fmt_id}")
        styles.append((code, fmt_id in _BUILTIN_DATE_IDS or (fmt_id in custom and _is_date_format(code))))
    return styles


def _read_shared(data: bytes | None) -> list[str]:
    if data is None:
        return []
    return [
        "".join(t.text or "" for t in si.iter() if _tag(t) == "t")
        for si in _xml(data)
        if _tag(si) == "si"
    ]


def _month(serial: float) -> str | None:
    """Excel serial day (1900 system) to YYYY-MM with integers only."""
    try:
        d = date.fromordinal(date(1899, 12, 30).toordinal() + int(serial))
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


# A cell is (kind, key, extra): kind in testo/numero/data/vuoto; key is the raw value (never printed
# except for code columns); extra is the format code or the YYYY-MM month.
Cell = tuple[str, str, str]


def _cell(c: ET.Element, shared: list[str], styles: list[tuple[str, bool]]) -> Cell:
    kind = c.get("t", "n")
    value = next((v.text or "" for v in c if _tag(v) == "v"), "")
    if kind == "inlineStr":
        text = "".join(t.text or "" for t in c.iter() if _tag(t) == "t")
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
        code, is_date = styles[index] if index < len(styles) else ("Generale", False)
        month = _month(number) if is_date else None
        return ("data", value, month) if month else ("numero", value, code)
    if text.strip() == "":
        return ("vuoto", "", "")
    months = _text_months(text) if len(text) <= 40 else []
    if len(months) == 1 and _DATE_TEXT.fullmatch(text.strip()):
        return ("data", text, months[0])
    return ("testo", text, "")


def _read_sheet(
    data: bytes, shared: list[str], styles: list[tuple[str, bool]]
) -> dict[int, dict[int, Cell]]:
    rows: dict[int, dict[int, Cell]] = {}
    last_row = 0
    for row in _xml(data).iter():
        if _tag(row) != "row":
            continue
        last_row = int(row.get("r", last_row + 1))
        if last_row > MAX_ROWS:
            raise _Rejected(BAD_FILE)
        last_col = 0
        for c in row:
            if _tag(c) != "c":
                continue
            last_col = _column_index(c.get("r")) if c.get("r") else last_col + 1
            if last_col > MAX_COLS:
                raise _Rejected(BAD_FILE)
            cell = _cell(c, shared, styles)
            if cell[0] != "vuoto":
                rows.setdefault(last_row, {})[last_col] = cell
    return rows


def _sheet_paths(zf: zipfile.ZipFile, budget: list[int]) -> list[tuple[str, str]]:
    workbook = _member(zf, "xl/workbook.xml", budget)
    rels = _member(zf, "xl/_rels/workbook.xml.rels", budget)
    if workbook is None or rels is None:
        raise _Rejected(BAD_FILE)
    targets = {r.get("Id"): r.get("Target", "") for r in _xml(rels) if _tag(r) == "Relationship"}
    found = []
    for sheet in _xml(workbook).iter():
        if _tag(sheet) != "sheet":
            continue
        target = next((v for k, v in sheet.attrib.items() if k.endswith("}id")), None)
        path = targets.get(target or "", "")
        path = path.lstrip("/") if path.startswith("/") else posixpath.normpath(f"xl/{path}")
        if not path or path.startswith(".."):
            raise _Rejected(BAD_FILE)
        found.append((sheet.get("name", ""), path))
    if not found or len(found) > MAX_SHEETS:
        raise _Rejected(BAD_FILE)
    return found


def _label(cell: Cell) -> str:
    """A header label, masked when it looks like data rather than a label."""
    text = cell[1].strip()
    if len(text) > 40 or re.search(r"\d{5,}", text):
        return f"(testo di {len(text)} caratteri)"
    return text


def _is_header(cells: dict[int, Cell]) -> bool:
    return len(cells) >= 3 and all(c[0] == "testo" for c in cells.values())


def _preamble(cells: dict[int, Cell]) -> list[dict[str, Any]]:
    out = []
    for col in sorted(cells):
        kind, key, _ = cells[col]
        item: dict[str, Any] = {"cella": _column_letters(col), "tipo": kind}
        months = _text_months(key) if kind == "testo" else []
        if len(months) >= 2:
            item["intervallo"] = f"{min(months)}..{max(months)}"
        elif kind == "data":
            item["mese"] = cells[col][2]
        out.append(item)
    return out


def _column(
    label: str, cells: list[Cell], code_names: set[str], rows_count: int
) -> dict[str, Any]:
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
        info["lunghezza_testo"] = [min(texts), max(texts)]
    if prevalent == "numero":
        info["formato"] = Counter(c[2] for c in cells if c[0] == "numero").most_common(1)[0][0]
    if prevalent == "data":
        months = sorted(c[2] for c in cells if c[0] == "data")
        info["primo_mese"], info["ultimo_mese"] = months[0], months[-1]
    if " ".join(label.casefold().split()) in code_names and len(distinct) <= LOW_CARDINALITY:
        info["valori"] = sorted(v if len(v) <= 30 else "(lungo)" for v in distinct)
    return info


def analyse(path: Path, code_columns: tuple[str, ...], header_row: int | None) -> dict[str, Any]:
    code_names = {" ".join(n.casefold().split()) for n in code_columns}
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            raise _Rejected(BAD_FILE)
        budget = [0]
        with zipfile.ZipFile(path) as zf:
            if len(zf.infolist()) > MAX_MEMBERS:
                raise _Rejected(BAD_FILE)
            styles = _read_styles(_member(zf, "xl/styles.xml", budget))
            shared = _read_shared(_member(zf, "xl/sharedStrings.xml", budget))
            sheets = []
            for name, member in _sheet_paths(zf, budget):
                data = _member(zf, member, budget)
                if data is None:
                    raise _Rejected(BAD_FILE)
                sheets.append((name, _read_sheet(data, shared, styles)))
    except _Rejected:
        raise
    except Exception:  # BadZipFile, ParseError, OSError, ...: never echo what they quote
        raise _Rejected(BAD_FILE) from None
    result = []
    for name, rows in sheets:
        numbers = sorted(rows)
        header = header_row if header_row is not None else next(
            (r for r in numbers if _is_header(rows[r])), None
        )
        sheet: dict[str, Any] = {
            "foglio": _label(("testo", name, "")),
            "righe": numbers[-1] if numbers else 0,
            "colonne": max((max(r) for r in rows.values()), default=0),
            "riga_intestazione": header,
        }
        if header is not None and header in rows:
            sheet["sopra_intestazione"] = [
                {"riga": r, "celle": _preamble(rows[r])} for r in numbers if r < header
            ]
            body = [rows[r] for r in numbers if r > header]
            sheet["righe_dati"] = len(body)
            sheet["colonne_dettaglio"] = [
                _column(
                    _label(rows[header][col]),
                    [r[col] for r in body if col in r],
                    code_names,
                    len(body),
                )
                for col in sorted(rows[header])
            ]
        result.append(sheet)
    return {"fogli": result}


def render(report: dict[str, Any]) -> str:
    lines: list[str] = []
    for sheet in report["fogli"]:
        lines.append(f"Foglio «{sheet['foglio']}»: {sheet['righe']} righe, {sheet['colonne']} colonne")
        if sheet["riga_intestazione"] is None or "colonne_dettaglio" not in sheet:
            lines.append("  Intestazione non individuata.")
            continue
        lines.append(f"  Riga delle intestazioni: {sheet['riga_intestazione']}")
        for above in sheet["sopra_intestazione"]:
            cells = ", ".join(
                f"{c['cella']}={c['tipo']}"
                + (f" (intervallo {c['intervallo']})" if "intervallo" in c else "")
                + (f" ({c['mese']})" if "mese" in c else "")
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
            if "lunghezza_testo" in col:
                parts.append("lunghezza testo {}-{}".format(*col["lunghezza_testo"]))
            if "formato" in col:
                parts.append(f"formato «{col['formato']}»")
            if "primo_mese" in col:
                parts.append(f"da {col['primo_mese']} a {col['ultimo_mese']}")
            if "valori" in col:
                parts.append("valori: " + ", ".join(f"«{v}»" for v in col["valori"]))
            lines.append(f"  Colonna «{col['intestazione']}»: " + "; ".join(parts))
    return "\n".join(lines) + "\n"


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = _utf8_lf(sys.stdout if stdout is None else stdout)
    err = _utf8_lf(sys.stderr if stderr is None else stderr)
    try:
        parser = _Parser(add_help=False)
        parser.add_argument("--json", action="store_true")
        parser.add_argument("--header-row", type=int)
        parser.add_argument("--code-columns")
        parser.add_argument("file")
        args = parser.parse_args(argv)
        names = (
            DEFAULT_CODE_COLUMNS
            if args.code_columns is None
            else tuple(n.strip() for n in args.code_columns.split(",") if n.strip())
        )
        report = analyse(Path(args.file), names, args.header_row)
        text = (
            json.dumps(report, ensure_ascii=False, indent=2) + "\n" if args.json else render(report)
        )
    except _Rejected as rejected:  # only the constant messages above
        err.write(f"{rejected}\n")
        return 2
    except Exception:
        err.write("Errore interno: nessun output.\n")
        return 2
    out.write(text)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
