"""Builds a minimal synthetic `.xlsx` from a dictionary (tests only; every value is invented).

A sheet is {"name": str, "rows": [[cell, ...], ...], "state": "visible"|"hidden"}. A cell is None (no
cell: a hole) or (kind, text): "s" shared string, "i" inline string, "str" formula string, "e" error,
"b" boolean, "n" number, "d" number with a date style, "t" number with a time-only style.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
RID = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
STYLES = (
    f'<styleSheet {NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="gg/mm/aaaa"/></numFmts>'
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
)
STYLE_OF = {"n": 0, "d": 1, "t": 0}


def _column(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def sheet_xml(rows: list[list[tuple[str, str] | None]], shared: list[str]) -> str:
    body = []
    for number, row in enumerate(rows, start=1):
        cells = []
        for index, cell in enumerate(row):
            if cell is None:
                continue
            kind, text = cell
            ref = f"{_column(index)}{number}"
            if kind == "s":
                shared.append(text)
                cells.append(f'<c r="{ref}" t="s"><v>{len(shared) - 1}</v></c>')
            elif kind == "i":
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>')
            elif kind in ("str", "e", "b"):
                cells.append(f'<c r="{ref}" t="{kind}"><v>{escape(text)}</v></c>')
            else:
                cells.append(f'<c r="{ref}" s="{STYLE_OF[kind]}"><v>{text}</v></c>')
        if cells:
            body.append(f'<row r="{number}">{"".join(cells)}</row>')
    return f"<worksheet {NS}><sheetData>{''.join(body)}</sheetData></worksheet>"


def build_xlsx(
    path: Path,
    sheets: list[dict],
    *,
    date1904: bool = False,
    extra: dict[str, bytes | str] | None = None,
    raw_sheets: dict[int, str] | None = None,
    duplicate: str | None = None,
) -> None:
    """`raw_sheets` replaces the XML of sheet N (1-based); `duplicate` writes that member twice."""
    shared: list[str] = []
    members: dict[str, bytes | str] = {}
    refs, rels = [], []
    for position, sheet in enumerate(sheets, start=1):
        state = sheet.get("state", "visible")
        refs.append(
            f'<sheet name="{escape(sheet["name"], {chr(34): "&quot;"})}" sheetId="{position}" '
            f'state="{state}" r:id="rId{position}"/>'
        )
        rels.append(
            f'<Relationship Id="rId{position}" Target="worksheets/sheet{position}.xml"/>'
        )
        raw = (raw_sheets or {}).get(position)
        members[f"xl/worksheets/sheet{position}.xml"] = (
            raw if raw is not None else sheet_xml(sheet["rows"], shared)
        )
    pr = '<workbookPr date1904="1"/>' if date1904 else ""
    members["xl/workbook.xml"] = f"<workbook {NS} {RID}>{pr}<sheets>{''.join(refs)}</sheets></workbook>"
    members["xl/_rels/workbook.xml.rels"] = (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels)
        + "</Relationships>"
    )
    members["xl/styles.xml"] = STYLES
    if shared:
        members["xl/sharedStrings.xml"] = (
            f"<sst {NS}>" + "".join(f"<si><t>{escape(s)}</t></si>" for s in shared) + "</sst>"
        )
    members.update(extra or {})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
        if duplicate is not None:
            zf.writestr(duplicate, members[duplicate])


if __name__ == "__main__":
    # python3 -I python/tests/xlsx_builder.py <folder>: writes `estratto.xlsx`, a synthetic statement
    # for the integration test of the TypeScript core (invented accounts, amounts and dates).
    import sys

    out = Path(sys.argv[1]) / "estratto.xlsx"
    head = [("i", "Data"), ("i", "Descrizione"), ("i", "Importo")]
    rows = [
        [("i", "Conto di prova"), ("i", "IT00X0000000000000000000000")],
        [],
        head,
        [("d", "46322"), ("s", "Pagamento città"), ("n", "-92.810000000000002")],
        [("d", "46323"), ("i", "Accredito"), ("n", "1234.5")],
        [("d", "46324"), None, ("n", "10")],
    ]
    build_xlsx(out, [{"name": "Movimenti", "rows": rows}])
