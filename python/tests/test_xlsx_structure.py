"""Tests for python/tools/xlsx_structure.py. Every workbook is synthetic, every value invented."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from datetime import date, timedelta
from pathlib import Path
from unittest import mock
from xml.sax.saxutils import escape

PYTHON_DIR = Path(__file__).resolve().parents[1]
TOOL = PYTHON_DIR / "tools" / "xlsx_structure.py"
sys.path.insert(0, str(PYTHON_DIR / "tools"))

import xlsx_structure  # noqa: E402

NAME = "Zorbaldo Inventato"
IBAN = "IT60X0542811101000000123456"
IBAN_SPACED = "IT60 X054 2811 1010 0000 0123 456"
NOTE = "Bonifico a favore di Zorbaldo"
SHEET_NAME = "Rossi Mario 12/03"
HIDDEN_NAME = "Nascosto Segreto"
FMT_LITERAL = "SENTINELFMT"
SENTINELS = [
    NAME, "Zorbaldo", "Inventato", "Rossi", "Mario", IBAN, IBAN_SPACED, "0542811101", "Bonifico",
    "1234,56", "1.234,56", "1234.56", "-63,00", "2026-03-17", "17/03", "12/03/24", "46098",
    "LEAKSENT", "Segreto", FMT_LITERAL, "1899", "Caffe",
]
HEADERS = ["Data", "Importo", "Cod Disp.", "Descrizione"]
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
RID = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def styles_xml(fmt: str = "#,##0.00") -> str:
    return (
        f'<styleSheet {NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/>'
        f'<numFmt numFmtId="165" formatCode="{escape(fmt, {chr(34): "&quot;"})}"/></numFmts>'
        '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/>'
        '<xf numFmtId="165"/></cellXfs></styleSheet>'
    )


def inline(ref: str, text: str) -> str:
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>'


def num(ref: str, value: str, style: int = 0) -> str:
    return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'


def sheet_xml(rows: list[list[str]], first_row: int = 1) -> str:
    body = "".join(f'<row r="{first_row + i}">{"".join(r)}</row>' for i, r in enumerate(rows))
    return f"<worksheet {NS}><sheetData>{body}</sheetData></worksheet>"


def build(
    path: Path,
    sheets: list[str] | str,
    *,
    names: list[str] | None = None,
    states: list[str] | None = None,
    wb_extra: str = "",
    fmt: str = "#,##0.00",
    shared: list[str] | None = None,
    extra: dict[str, bytes | str] | None = None,
    encode: str | None = None,
    targets: list[str] | None = None,
) -> None:
    sheets = [sheets] if isinstance(sheets, str) else sheets
    names = names or [f"S{i}" for i in range(len(sheets))]
    states = states or ["visible"] * len(sheets)
    listing = "".join(
        f'<sheet name="{escape(n, {chr(34): "&quot;"})}" sheetId="{i + 1}" state="{s}" r:id="rId{i + 1}"/>'
        for i, (n, s) in enumerate(zip(names, states))
    )
    rels = "".join(
        f'<Relationship Id="rId{i + 1}" Target="{(targets or [f"worksheets/sheet{i + 1}.xml"] * 99)[i]}"/>'
        for i in range(len(sheets))
    )
    members: dict[str, bytes | str] = {
        "xl/workbook.xml": f"<workbook {NS} {RID}>{wb_extra}<sheets>{listing}</sheets></workbook>",
        "xl/_rels/workbook.xml.rels": (
            f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>'
        ),
        "xl/styles.xml": styles_xml(fmt),
    }
    for i, s in enumerate(sheets):
        members[f"xl/worksheets/sheet{i + 1}.xml"] = s
    if shared is not None:
        members["xl/sharedStrings.xml"] = (
            f"<sst {NS}>" + "".join(f"<si><t>{escape(s)}</t></si>" for s in shared) + "</sst>"
        )
    members.update(extra or {})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in members.items():
            if isinstance(data, str) and encode and name == "xl/worksheets/sheet1.xml":
                data = data.encode(encode)
            zf.writestr(name, data)


def header_row(r: int, labels: list[str] = HEADERS) -> list[str]:
    return [inline(f"{c}{r}", h) for c, h in zip("ABCDEFG", labels)]


def data_rows(first: int) -> list[list[str]]:
    return [
        [
            num(f"A{first + i}", str(46098 + i * 40), 1),
            num(f"B{first + i}", "1234.56", 2),
            inline(f"C{first + i}", code),
            inline(f"D{first + i}", f"{NOTE} {IBAN}"),
        ]
        for i, code in enumerate(["01", "02", "01"])
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

    def clean(self, *args: str, expect: int = 0) -> str:
        """Runs text and --json, asserts no sentinel on stdout, json or stderr; returns stdout."""
        texts = []
        for extra in ([], ["--json"]):
            code, out, err = run([*extra, *args, str(self.file)])
            self.assertEqual(code, expect, (extra, err))
            texts.append(out)
            for sentinel in SENTINELS:
                for stream in (out, err):
                    self.assertNotIn(sentinel, stream, sentinel)
        if expect == 0:
            json.loads(texts[1])
        return texts[0]

    def rejected(self) -> None:
        self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"))
        self.assertEqual(run(["--json", str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"))

    def normal(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]))

    # --- what is printed -------------------------------------------------------------------

    def test_normal_structure_without_values(self) -> None:
        self.normal()
        out = self.clean()
        self.assertIn("Foglio 1: 4 righe, 4 colonne", out)
        self.assertIn("Riga delle intestazioni: 1", out)
        self.assertIn("Colonna «importo»: tipo numero; 3 non vuoti; 1 distinti; formato numero", out)
        self.assertIn("Colonna «data»: tipo data; 3 non vuoti; 3 distinti; da 2026-03 a 2026-06", out)
        self.assertIn("lunghezza testo >30", out)
        self.assertIn("Colonna «cod disp»: tipo testo; 3 non vuoti; 2 distinti; lunghezza testo <=10; valori: «01», «02»", out)
        self.assertNotRegex(out, r"lunghezza testo \d")

    def test_values_only_for_short_code_patterns_in_code_columns(self) -> None:
        self.normal()
        self.assertEqual(self.clean().count("valori:"), 1)
        out = self.clean("--code-columns", "Descrizione")  # long text with spaces never qualifies
        self.assertNotIn("valori:", out)
        head = [inline(f"{c}1", h) for c, h in zip("ABC", ["Data", "Valuta", "Segno"])]
        body = [[inline("A2", "x"), inline("B2", "EUR"), inline("C2", "Rossi Mario")],
                [inline("A3", "x"), inline("B3", "EUR"), inline("C3", "Rossi Mario")]]
        build(self.file, sheet_xml([head, *body]))
        out = self.clean()
        self.assertIn("«EUR»", out)
        self.assertEqual(out.count("valori:"), 1)

    def test_code_column_with_many_values_is_not_listed(self) -> None:
        head = [inline(f"{c}1", h) for c, h in zip("ABC", ["Data", "Importo", "Cod Disp."])]
        body = [[inline(f"A{r}", "x"), inline(f"B{r}", "y"), inline(f"C{r}", f"{r:02d}")] for r in range(2, 16)]
        build(self.file, sheet_xml([head, *body]))
        out = self.clean()
        self.assertIn("14 distinti", out)
        self.assertNotIn("valori:", out)

    def test_unknown_labels_are_never_printed(self) -> None:
        rows = [header_row(1, ["Data", "Importo", "Zorbaldo Etichetta", "Descrizione"]), *data_rows(2)]
        build(self.file, sheet_xml(rows))
        out = run([str(self.file)])[1]
        self.assertNotIn("Zorbaldo", out)
        self.assertIn("(colonna 3, testo di 18 caratteri)", out)
        code, out, _ = run(["--known-labels", "zorbaldo etichetta", str(self.file)])
        self.assertIn("«zorbaldo etichetta»", out)

    def test_labels_are_normalised_for_the_allowlist(self) -> None:
        build(self.file, sheet_xml([header_row(1, ["Zorb Etichet", "Descrizione", "Importo", "Cod. Disp."]), *data_rows(2)]))
        out = self.clean()
        self.assertIn("«descrizione»", out)
        self.assertIn("«cod disp»", out)
        self.assertIn("(colonna 1, testo di 12 caratteri)", out)

    # --- header choice and metadata --------------------------------------------------------

    def test_metadata_with_names_and_amounts_above_the_header(self) -> None:
        meta = [
            [inline("A1", "Titolare"), inline("B1", "Mario Rossi"), inline("C1", "Saldo 1.234,56")],
            [inline("A2", "Conto"), inline("B2", IBAN_SPACED), inline("C2", f"Intestatario {NAME}")],
            [inline("A3", "Periodo dal 01/01/2026 al 31/03/2026")],
            [inline("A4", "Saldo"), num("B4", "1234.56")],
        ]
        build(self.file, sheet_xml([*meta, header_row(5), *data_rows(6)]))
        out = self.clean()
        self.assertIn("Riga delle intestazioni: 5", out)
        self.assertIn("Riga 1 sopra l'intestazione: A=testo, B=testo, C=testo", out)
        self.assertIn("Riga 3 sopra l'intestazione: A=testo (intervallo 2026-01..2026-03)", out)
        self.assertIn("Riga 4 sopra l'intestazione: A=testo, B=numero", out)
        self.assertNotIn("Periodo", out)

    def test_wrongly_chosen_header_rows_print_nothing_personal(self) -> None:
        meta = [
            [inline("A1", "Titolare"), inline("B1", "Mario Rossi"), inline("C1", "Saldo 1.234,56")],
            [inline("A2", "Conto"), inline("B2", IBAN_SPACED), inline("C2", f"Intestatario {NAME}")],
        ]
        data = [
            [inline("A3", "12/03/24"), inline("B3", "-63,00"), inline("C3", "Caffe da Rossi"), inline("D3", NOTE)],
        ]
        build(self.file, sheet_xml([*meta, *data]))
        for row in ("1", "2", "3"):
            out = self.clean("--header-row", row)
            self.assertIn(f"Riga delle intestazioni: {row}", out)
            self.assertIn("(colonna", out)

    def test_automatic_pick_without_known_labels_prints_only_lengths(self) -> None:
        rows = [[inline("A1", "Mario Rossi"), inline("B1", IBAN_SPACED), inline("C1", NAME)], [inline("A2", "x")]]
        build(self.file, sheet_xml(rows))
        out = self.clean()
        self.assertIn("(colonna 2, testo di 33 caratteri)", out)

    def test_header_with_a_numeric_cell_is_still_found_and_data_row_is_not(self) -> None:
        head = [inline("A1", "Data"), inline("B1", "Importo"), num("C1", "2026"), inline("D1", "Descrizione")]
        data = [inline("A2", "12/03/24"), inline("B2", "-63,00"), inline("C2", "Caffe da Rossi"), inline("D2", NOTE)]
        build(self.file, sheet_xml([head, data]))
        out = self.clean()
        self.assertIn("Riga delle intestazioni: 1", out)
        self.assertIn("(colonna 3, numero)", out)

    # --- sheets, formats, dates --------------------------------------------------------------

    def test_sheet_names_are_never_printed_and_hidden_sheets_are_skipped(self) -> None:
        visible = sheet_xml([header_row(1), *data_rows(2)])
        secret = sheet_xml([header_row(1, ["Data", "Importo", "Segno", "LEAKSENT"]), *data_rows(2)])
        build(self.file, [visible, secret, visible], names=[SHEET_NAME, HIDDEN_NAME, "Altro"],
              states=["visible", "hidden", "veryHidden"])
        out = self.clean()
        self.assertIn("Foglio 1:", out)
        self.assertNotIn("Foglio 2", out)
        self.assertIn("2 fogli nascosti ignorati", out)
        self.assertEqual(json.loads(run(["--json", str(self.file)])[1])["fogli_nascosti_ignorati"], 2)

    def test_number_format_is_a_class_never_the_string(self) -> None:
        rows = [header_row(1), [num("A2", "46098", 1), num("B2", "5", 3), inline("C2", "01"), inline("D2", "x")]]
        build(self.file, sheet_xml(rows), fmt=f'0" Rossi {FMT_LITERAL}"')
        out = self.clean()
        self.assertIn("formato numero", out)
        for fmt, cls in [('0.0%', "percentuale"), ('[$-410]dd/mm/yyyy "Rossi"', "data"), ("hh:mm", "ora"),
                         ("@", "testo"), ("General", "generale")]:
            self.assertEqual(xlsx_structure._format_class(165, fmt), cls, fmt)

    def test_1904_epoch_invalid_and_small_serials(self) -> None:
        expected = date(1904, 1, 1) + timedelta(days=44636)
        rows = [header_row(1), [num("A2", "44636", 1), num("B2", "1", 2), inline("C2", "01"), inline("D2", "x")]]
        build(self.file, sheet_xml(rows), wb_extra='<workbookPr date1904="1"/>')
        self.assertIn(f"da {expected.year}-{expected.month:02d} a", self.clean())
        build(self.file, sheet_xml(rows))
        self.assertIn("da 2022-03 a 2022-03", self.clean())
        rows = [header_row(1), [num("A2", "0.5", 1), num("B2", "1", 2), inline("C2", "01"), inline("D2", "x")],
                [num("A3", "99999999", 1), num("B3", "1", 2), inline("C3", "01"), inline("D3", "x")],
                [num("A4", "99999999", 1), num("B4", "1", 2), inline("C4", "01"), inline("D4", "x")]]
        build(self.file, sheet_xml(rows))
        out = self.clean()
        self.assertNotIn("1899", out)
        self.assertIn("2 data non valida", out)
        self.assertNotIn("99999999", out)

    def test_shared_strings_and_rich_text(self) -> None:
        sheet = sheet_xml([
            ['<c r="A1" t="s"><v>0</v></c>', '<c r="B1" t="s"><v>1</v></c>', '<c r="C1" t="s"><v>2</v></c>'],
            ['<c r="A2" t="s"><v>3</v></c>', '<c r="B2" t="s"><v>3</v></c>', '<c r="C2" t="s"><v>3</v></c>'],
        ])
        build(self.file, sheet, shared=["Segno", "Valuta", "Altro", NAME])
        cols = json.loads(run(["--json", str(self.file)])[1])["fogli"][0]["colonne_dettaglio"]
        self.assertEqual([c["intestazione"] for c in cols], ["segno", "valuta", "(colonna 3, testo di 5 caratteri)"])
        self.assertNotIn("valori", cols[0])  # the value has spaces: not a code
        self.assertEqual(cols[2]["fascia_lunghezza_testo"], "<=30")
        self.clean()

    # --- defences ----------------------------------------------------------------------------

    def test_corrupt_files(self) -> None:
        for data in (b"questo non e' un file zip", b""):
            self.file.write_bytes(data)
            self.rejected()
        build(self.file, "<worksheet><sheetData><row")
        self.rejected()
        self.assertEqual(run([str(self.dir / "manca.xlsx")]), (2, "", xlsx_structure.BAD_FILE + "\n"))
        self.assertEqual(run([])[0], 2)

    def test_limits(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]), extra={"xl/bomb.bin": b"\0" * 200_000})
        for name, value in [("MAX_TOTAL_BYTES", 1_000), ("MAX_MEMBER_BYTES", 100), ("MAX_ROWS", 2),
                            ("MAX_COLS", 2), ("MAX_FILE_BYTES", 10), ("MAX_MEMBERS", 2), ("MAX_CELLS", 3)]:
            with mock.patch.object(xlsx_structure, name, value):
                self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.BAD_FILE + "\n"), name)
        self.assertLessEqual(xlsx_structure.MAX_FILE_BYTES, 10 * 1024 * 1024)
        self.assertLessEqual(xlsx_structure.MAX_TOTAL_BYTES, 100 * 1024 * 1024)
        self.assertLessEqual(xlsx_structure.MAX_ROWS, 50_000)

    def test_declared_size_bomb(self) -> None:
        build(self.file, sheet_xml([header_row(1)]), extra={"xl/worksheets/sheet9.xml": b"\0" * 5_000_000})
        with mock.patch.object(xlsx_structure, "MAX_TOTAL_BYTES", 1_000_000):  # declared sizes, nothing read
            self.rejected()

    def test_too_many_sheets_and_path_traversal(self) -> None:
        sheet = sheet_xml([header_row(1)])
        build(self.file, [sheet] * 51)
        self.rejected()
        for target in ("../../etc/passwd", "/../x", "/xl/../../x"):
            build(self.file, sheet, targets=[target])
            self.rejected()

    def test_doctype_and_entities_in_every_member(self) -> None:
        evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "LEAKSENT">]>'
        sheet = sheet_xml([header_row(1)])
        for member, plain in [
            ("xl/worksheets/sheet1.xml", None), ("xl/styles.xml", styles_xml()),
            ("xl/sharedStrings.xml", f"<sst {NS}/>"), ("xl/workbook.xml", None),
            ("xl/_rels/workbook.xml.rels", None),
        ]:
            build(self.file, sheet)
            with zipfile.ZipFile(self.file) as zf:
                original = zf.read(member).decode() if member in zf.namelist() else plain or ""
            build(self.file, sheet, extra={member: evil + original.split("?>")[-1]})
            self.rejected()
        build(self.file, sheet, extra={"xl/worksheets/sheet1.xml": "<!doctype x>" + sheet})  # lower case
        self.rejected()

    def test_other_encodings_are_rejected(self) -> None:
        for encoding in ("utf-16", "utf-16-le", "utf-16-be", "utf-32"):
            xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "LEAKSENT">]>' + sheet_xml(
                [[inline("A1", "Data"), inline("B1", "Importo"), inline("C1", "&e;")]]
            )
            build(self.file, xml, encode=encoding)
            self.rejected()
        plain = sheet_xml([header_row(1)])
        build(self.file, plain, encode="utf-16")
        self.rejected()
        build(self.file, '<?xml version="1.0" encoding="ISO-8859-1"?>' + plain)
        self.rejected()
        build(self.file, '<?xml version="1.0" encoding="UTF-8"?>' + plain)
        self.assertEqual(run([str(self.file)])[0], 0)

    # --- launch, errors, side effects ----------------------------------------------------------

    def test_real_launch_with_isolated_stdlib_only_interpreter(self) -> None:
        self.normal()
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        env["PYTHONPATH"] = ""
        # -S: no site, so no .pth file and no virtualenv packages; -I: isolated mode
        done = subprocess.run([sys.executable, "-I", "-S", str(TOOL), str(self.file)],
                              capture_output=True, env=env, cwd=self.dir)
        self.assertEqual((done.returncode, done.stderr), (0, b""))
        self.assertIn("Colonna «data»".encode(), done.stdout)
        for sentinel in SENTINELS:
            self.assertNotIn(sentinel.encode(), done.stdout)
        probe = ("import runpy,sys; runpy.run_path(sys.argv[1], run_name='probe'); "
                 "bad=[m for m in sys.modules if m.split('.')[0] in ('bollette_pdf','pdfminer','jsonschema')]; "
                 "sys.exit(1 if bad else 0)")
        self.assertEqual(subprocess.run([sys.executable, "-I", "-S", "-c", probe, str(TOOL)], env=env).returncode, 0)
        bad = subprocess.run([sys.executable, "-I", "-S", str(TOOL), "--bogus=Zorbaldo", str(self.file)],
                             capture_output=True, env=env)
        self.assertEqual((bad.returncode, bad.stdout), (2, b""))
        self.assertNotIn(b"Zorbaldo", bad.stderr)

    def test_internal_errors_and_closed_pipe_print_no_traceback(self) -> None:
        self.normal()
        with mock.patch.object(xlsx_structure, "analyse", side_effect=RuntimeError(NAME)):
            self.assertEqual(run([str(self.file)]), (2, "", xlsx_structure.INTERNAL_ERROR + "\n"))

        class Broken(io.StringIO):
            def write(self, s: str) -> int:
                raise BrokenPipeError(NAME)

        err = io.StringIO()
        self.assertEqual(xlsx_structure.main([str(self.file)], Broken(), err), 2)
        self.assertEqual(err.getvalue(), xlsx_structure.INTERNAL_ERROR + "\n")

    def test_file_is_not_modified(self) -> None:
        self.normal()
        before = self.file.read_bytes()
        self.clean()
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["estratto.xlsx"])


if __name__ == "__main__":
    unittest.main()
