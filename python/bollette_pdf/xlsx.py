"""Reads a bank statement `.xlsx` into the neutral table of `StatementTableSchema` (command `table`).

    python -I -m bollette_pdf table <file.xlsx>

Standard library only, read only, no network, no clock. Unlike python/tools/xlsx_structure.py (which
never prints a value) this is the production reader of the statement: its output goes to the app.

The defences against hostile files are the ones of that tool (R98), kept here as a literal copy
because the tool must run alone with `python3 -I -S` and import nothing from `bollette_pdf`;
`test_xlsx.py` checks that the two copies stay identical: limits of bytes, members, rows, columns,
cells and sheets, duplicate members, path traversal, UTF-8 only, no DOCTYPE or ENTITY in any member.

Cells: text (shared, inline or formula string) is `s`; a number is `n` with the shortest decimal text
that reads back the same double (`repr`, never rounded, no exponent); a number whose cell style is a
date and whose serial is at least 1 is `d` (ISO, from the integer part, system 1900 or 1904); an
empty cell or a hole is `null`. A row with no cell is `[]` (row N of the table is row N of Excel) and
trailing holes are cut. Rows and cells out of order or repeated, numbers longer than 40 characters
and an output over 8 MB reject the file. Hidden sheets are skipped. Any problem with the file: one constant message, no
content, exit code 2.
"""

from __future__ import annotations

import io
import json
import posixpath
import re
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_MEMBER_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_MEMBERS = 200
MAX_ROWS = 50_000
MAX_COLS = 256
MAX_CELLS = 2_000_000
MAX_SHEETS = 50
MAX_OUTPUT_BYTES = 8 * 1024 * 1024  # the JSON the app reads; the same cap as the test helper of the core
MAX_NUMBER_CHARS = 40  # a bank amount has neither 40 digits nor an exponent beyond that
BAD_FILE = "File non valido o troppo grande: nessun output."
TABLE_ERROR = BAD_FILE

_XML_ENCODING = re.compile(r"""<\?xml[^>]{0,200}?encoding\s*=\s*["']([^"']+)["']""", re.I)
_FORBIDDEN_XML = re.compile(r"<!(doctype|entity)", re.I)
_NS_STRIP = re.compile(r"\{[^}]*\}")
_BUILTIN_CLASS = {0: "generale", 9: "percentuale", 10: "percentuale", 49: "testo"}
_BUILTIN_CLASS.update({i: "data" for i in (14, 15, 16, 17, 22)})
_BUILTIN_CLASS.update({i: "ora" for i in (18, 19, 20, 21, 45, 46, 47)})


class _Rejected(Exception):
    """A problem with the file or the arguments: the message is a constant Italian sentence."""


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


def _workbook(
    zf: zipfile.ZipFile, budget: list[int]
) -> tuple[list[tuple[int, str, bool, str]], int]:
    """(position, member path, hidden, name) of every sheet, and the epoch ordinal of the date system."""
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
        found.append(
            (len(found) + 1, path, node.get("state", "visible") != "visible", node.get("name", ""))
        )
    if not found or len(found) > MAX_SHEETS:
        raise _Rejected(BAD_FILE)
    return found, epoch


class TableError(Exception):
    """The file cannot be read: the message is the constant `TABLE_ERROR`, never any content."""


_NUMBER = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", re.ASCII)


def _number(raw: str) -> str:
    """The shortest decimal text that reads back the same double; positional, never an exponent.
    Only ASCII decimal text (float() also takes `1_000` and other scripts' digits); a form longer
    than MAX_NUMBER_CHARS is refused (`1e-300` would become 300 characters: an amplification)."""
    if _NUMBER.fullmatch(raw.strip()) is None:
        raise _Rejected(BAD_FILE)
    text = repr(float(raw))
    if text in ("inf", "-inf", "nan"):
        raise _Rejected(BAD_FILE)
    # shortcut: a double is exact only to 17 digits; the cell text itself is not kept
    text = format(Decimal(text), "f") if "e" in text else text
    if len(text) > MAX_NUMBER_CHARS:
        raise _Rejected(BAD_FILE)
    return text


def _iso_date(serial: float, epoch: int) -> str:
    try:
        day = date.fromordinal(epoch + int(serial))
    except (ValueError, OverflowError):
        raise _Rejected(BAD_FILE) from None
    return f"{day.year:04d}-{day.month:02d}-{day.day:02d}"


def _cell(c: ET.Element, shared: list[str], styles: list[str], epoch: int) -> dict[str, str] | None:
    kind = c.get("t", "n")
    value = next((v.text or "" for v in c if _tag(v) == "v"), "")
    if kind == "inlineStr":
        # like the shared strings: runs `r` and plain `t`, never the phonetic text `rPh`
        text = "".join(
            (t.text or "")
            for p in c
            if _tag(p) == "is"
            for run in p
            if _tag(run) in ("t", "r")
            for t in ([run] if _tag(run) == "t" else list(run))
            if _tag(t) == "t"
        )
    elif kind == "s":
        try:
            text = shared[int(value)]
        except (ValueError, IndexError):
            raise _Rejected(BAD_FILE) from None
    elif kind in ("str", "e", "b"):
        text = value
    else:
        if value.strip() == "":
            return None
        number = float(value)
        index = int(c.get("s", "0"))
        if (styles[index] if index < len(styles) else "generale") == "data" and number >= 1:
            return {"t": "d", "v": _iso_date(number, epoch)}
        return {"t": "n", "v": _number(value)}
    return {"t": "s", "v": text} if text != "" else None


def _read_sheet(
    data: bytes, shared: list[str], styles: list[str], epoch: int, output: list[int]
) -> list[list[dict[str, str] | None]]:
    """Rows as Excel numbers them: row N is `rows[N - 1]`, an empty row is `[]`. Rows and the cells
    of a row must be in strictly increasing order (a cell moved to another column would be an amount
    under another heading); `output` is the running size of the JSON, capped by MAX_OUTPUT_BYTES."""
    _check_text(data)
    rows: list[list[dict[str, str] | None]] = []
    cells = 0
    for _, row in ET.iterparse(io.BytesIO(data), events=("end",)):
        if _tag(row) != "row":
            continue
        number = int(row.get("r", len(rows) + 1))
        if not len(rows) < number <= MAX_ROWS:
            raise _Rejected(BAD_FILE)
        output[0] += 3 * (number - len(rows))
        rows.extend([] for _ in range(number - len(rows) - 1))
        line: list[dict[str, str] | None] = []
        last_col = 0
        for c in row:
            if _tag(c) != "c":
                continue
            ref = c.get("r")
            if ref is None:
                column = last_col + 1
            else:
                match = re.fullmatch(r"([A-Z]+)([0-9]+)", ref, re.ASCII)
                if match is None or int(match[2]) != number:
                    raise _Rejected(BAD_FILE)
                column = _column_index(ref)
            if column <= last_col:
                raise _Rejected(BAD_FILE)
            last_col = column
            cells += 1
            if last_col > MAX_COLS or cells > MAX_CELLS:
                raise _Rejected(BAD_FILE)
            cell = _cell(c, shared, styles, epoch)
            if cell is not None:
                line.extend([None] * (last_col - 1 - len(line)))
                line.append(cell)
                output[0] += len(json.dumps(cell["v"], ensure_ascii=False).encode("utf-8")) + 14
            if output[0] > MAX_OUTPUT_BYTES:
                raise _Rejected(BAD_FILE)
        output[0] += 5 * len(line)
        rows.append(line)
        row.clear()
    return rows


def read_table(path: Path) -> dict[str, Any]:
    """The table of every visible sheet; raises `TableError` for any file it cannot read safely."""
    sheets: list[dict[str, Any]] = []
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            raise _Rejected(BAD_FILE)
        budget = [0]
        output = [0]
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if len(names) > MAX_MEMBERS or len(set(names)) != len(names):
                raise _Rejected(BAD_FILE)
            styles = _read_styles(_member(zf, "xl/styles.xml", budget))
            shared = _read_shared(_member(zf, "xl/sharedStrings.xml", budget))
            listed, epoch = _workbook(zf, budget)
            for _position, member, hidden, name in listed:
                if hidden:
                    continue
                data = _member(zf, member, budget)
                if data is None:
                    raise _Rejected(BAD_FILE)
                sheets.append({"name": name, "rows": _read_sheet(data, shared, styles, epoch, output)})
        if not sheets:
            raise _Rejected(BAD_FILE)
    except Exception:  # _Rejected, BadZipFile, ParseError, OSError, ...: never echo what they quote
        raise TableError(TABLE_ERROR) from None
    return {"v": 1, "sheets": sheets}
