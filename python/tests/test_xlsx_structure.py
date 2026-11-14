"""Tests for python/tools/xlsx_structure.py. Every workbook is synthetic, every value invented."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock
from xml.sax.saxutils import escape

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(PYTHON_DIR / "tools"))

import xlsx_structure  # noqa: E402

NAME = "Zorbaldo Inventato"
IBAN = "IT60X0542811101000000123456"
AMOUNT_TEXT = "-1234,56"
AMOUNT_NUM = "1234.56"
NOTE = "Bonifico a favore di Zorbaldo"
SENTINELS = [NAME, IBAN, AMOUNT_TEXT, AMOUNT_NUM, "1234", "Zorbaldo", "2026-03-17", "17/03", "45003"]
# 45003 = 2023-03-17 (serial), 46098 = 2026-03-17
HEADERS = ["Data", "Importo", "Cod Disp.", "Descrizione"]

STYLES = (
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>'
    "</styleSheet>"
)


def inline(ref: str, text: str) -> str:
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>'


def num(ref: str, value: str, style: int = 0) -> str:
    return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'


def sheet_xml(rows: list[list[str]], first_row: int = 1) -> str:
    body = "".join(f'<row r="{first_row + i}">{"".join(r)}</row>' for i, r in enumerate(rows))
    return (
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{body}</sheetData></worksheet>"
    )


def build(path: Path, sheet: str, shared: list[str] | None = None, extra: dict[str, bytes] | None = None) -> None:
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rid = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    members = {
        "xl/workbook.xml": f'<workbook {ns} {rid}><sheets><sheet name="Lista" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": (
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
        ),
        "xl/styles.xml": STYLES,
        "xl/worksheets/sheet1.xml": sheet,
    }
    if shared is not None:
        members["xl/sharedStrings.xml"] = (
            f"<sst {ns}>" + "".join(f"<si><t>{escape(s)}</t></si>" for s in shared) + "</sst>"
        )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
        for name, data in (extra or {}).items():
            zf.writestr(name, data)


def header_row(r: int) -> list[str]:
    return [inline(f"{c}{r}", h) for c, h in zip("ABCD", HEADERS)]


def data_rows(first: int) -> list[list[str]]:
    codes = ["01", "02", "01"]
    return [
        [
            num(f"A{first + i}", str(46098 + i * 40), 1),
            num(f"B{first + i}", AMOUNT_NUM, 2),
            inline(f"C{first + i}", code),
            inline(f"D{first + i}", f"{NOTE} {IBAN}"),
        ]
        for i, code in enumerate(codes)
    ]


def run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = xlsx_structure.main(argv, out, err)
    return code, out.getvalue(), err.getvalue()


class XlsxStructureTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.file = self.dir / "estratto.xlsx"

    def assertNoSentinel(self, text: str) -> None:
        for sentinel in SENTINELS:
            self.assertNotIn(sentinel, text)

    def test_normal_structure_without_values(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]))
        code, out, err = run([str(self.file)])
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Foglio «Lista»: 4 righe, 4 colonne", out)
        self.assertIn("Riga delle intestazioni: 1", out)
        self.assertIn("Colonna «Importo»: tipo numero; 3 non vuoti; 1 distinti; formato «#,##0.00»", out)
        self.assertIn("Colonna «Data»: tipo data; 3 non vuoti; 3 distinti; da 2026-03 a 2026-06", out)
        self.assertIn("lunghezza testo", out)
        self.assertNoSentinel(out)

    def test_code_column_lists_values_only_there(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]))
        _, out, _ = run([str(self.file)])
        self.assertIn("Colonna «Cod Disp.»: tipo testo; 3 non vuoti; 2 distinti; lunghezza testo 2-2; valori: «01», «02»", out)
        self.assertEqual(out.count("valori:"), 1)
        _, out, _ = run(["--code-columns", "Descrizione", str(self.file)])
        self.assertNotIn("«01»", out)

    def test_code_column_with_many_values_is_not_listed(self) -> None:
        head = [inline(f"{c}1", h) for c, h in zip("ABC", ["Uno", "Due", "Cod Disp."])]
        body = [[inline(f"A{r}", "x"), inline(f"B{r}", "y"), inline(f"C{r}", f"{r:02d}")] for r in range(2, 16)]
        build(self.file, sheet_xml([head, *body]))
        _, out, _ = run([str(self.file)])
        self.assertIn("14 distinti", out)
        self.assertNotIn("valori:", out)

    def test_header_below_metadata_prints_only_types(self) -> None:
        meta = [
            [inline("A1", f"Conto {IBAN}"), inline("B1", NAME)],
            [inline("A2", "Periodo dal 01/01/2026 al 31/03/2026")],
            [inline("A3", "Saldo"), num("B3", AMOUNT_NUM)],
        ]
        build(self.file, sheet_xml([*meta, header_row(4), *data_rows(5)]))
        code, out, _ = run([str(self.file)])
        self.assertEqual(code, 0)
        self.assertIn("Riga delle intestazioni: 4", out)
        self.assertIn("Riga 1 sopra l'intestazione: A=testo, B=testo", out)
        self.assertIn("Riga 2 sopra l'intestazione: A=testo (intervallo 2026-01..2026-03)", out)
        self.assertIn("Riga 3 sopra l'intestazione: A=testo, B=numero", out)
        self.assertNoSentinel(out)
        self.assertNotIn("Periodo", out)
        self.assertNotIn("31/03", out)

    def test_shared_strings_and_json(self) -> None:
        sheet = sheet_xml([
            [f'<c r="A1" t="s"><v>0</v></c>', f'<c r="B1" t="s"><v>1</v></c>', f'<c r="C1" t="s"><v>2</v></c>'],
            [f'<c r="A2" t="s"><v>3</v></c>', f'<c r="B2" t="s"><v>3</v></c>', f'<c r="C2" t="s"><v>3</v></c>'],
        ])
        build(self.file, sheet, shared=["Segno", "Valuta", "Altro", NAME])
        code, out, _ = run(["--json", str(self.file)])
        self.assertEqual(code, 0)
        report = json.loads(out)
        cols = report["fogli"][0]["colonne_dettaglio"]
        self.assertEqual([c["intestazione"] for c in cols], ["Segno", "Valuta", "Altro"])
        self.assertIn("valori", cols[0])
        self.assertIn("valori", cols[1])
        self.assertNotIn("valori", cols[2])
        self.assertEqual(cols[2]["lunghezza_testo"], [len(NAME), len(NAME)])

    def test_masked_header_label(self) -> None:
        rows = [[inline("A1", IBAN), inline("B1", "Importo"), inline("C1", "Data")], [inline("A2", "x")]]
        build(self.file, sheet_xml(rows))
        _, out, _ = run([str(self.file)])
        self.assertNotIn(IBAN, out)
        self.assertIn("(testo di 27 caratteri)", out)

    def test_corrupt_files(self) -> None:
        cases = {
            "not-zip.xlsx": b"questo non e' un file zip",
            "empty.xlsx": b"",
        }
        for name, data in cases.items():
            path = self.dir / name
            path.write_bytes(data)
            self.assertEqual(run([str(path)]), (2, "", xlsx_structure.BAD_FILE + "\n"), name)
        build(self.file, "<worksheet><sheetData><row")  # truncated XML
        self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"))
        self.assertEqual(run([str(self.dir / "manca.xlsx")])[0], 2)
        self.assertEqual(run([])[0], 2)

    def test_zip_bomb_and_limits(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]), extra={"xl/bomb.bin": b"\0" * 200_000})
        with mock.patch.object(xlsx_structure, "MAX_TOTAL_BYTES", 1_000):
            self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"))
        with mock.patch.object(xlsx_structure, "MAX_MEMBER_BYTES", 100):
            self.assertEqual(run([str(self.file)])[0], 2)
        with mock.patch.object(xlsx_structure, "MAX_ROWS", 2):
            self.assertEqual(run([str(self.file)])[0], 2)
        with mock.patch.object(xlsx_structure, "MAX_COLS", 2):
            self.assertEqual(run([str(self.file)])[0], 2)
        with mock.patch.object(xlsx_structure, "MAX_FILE_BYTES", 10):
            self.assertEqual(run([str(self.file)])[0], 2)
        with mock.patch.object(xlsx_structure, "MAX_MEMBERS", 2):
            self.assertEqual(run([str(self.file)])[0], 2)

    def test_doctype_and_entities_are_rejected(self) -> None:
        evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "AAAA">]>' + sheet_xml([header_row(1)])
        build(self.file, evil)
        self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"))
        build(self.file, sheet_xml([header_row(1)]))
        with zipfile.ZipFile(self.file, "a") as zf:
            zf.writestr("xl/sharedStrings.xml", "<!doctype sst><sst/>")
        self.assertEqual(run([str(self.file)])[0], 2)

    def test_file_is_not_modified(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]))
        before = self.file.read_bytes()
        run([str(self.file)])
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["estratto.xlsx"])


if __name__ == "__main__":
    unittest.main()
