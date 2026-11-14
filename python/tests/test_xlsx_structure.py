"""Tests for python/tools/xlsx_structure.py. Every workbook is synthetic, every value invented."""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import warnings
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
    "1234,56", "1.234,56", "1234.56", "-63,00", "2026-03-17", "17/03", "12/03/24", "12/03/2024", "46098",
    "LEAKSENT", "Segreto", FMT_LITERAL, "1899", "Caffe", "12345678901", "1985", "01/02/2001", "46303", "RSSMRA85C12",
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


@contextlib.contextmanager
def warnings_ignored():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield


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
        self.assertIn("Riga delle intestazioni: 1\n", out)
        self.assertIn("Colonna «importo»: tipo numero; 3 non vuoti; 1 distinti; formato numero", out)
        self.assertIn("Colonna «data»: tipo data; 3 non vuoti; 3 distinti; da 2026-03 a 2026-06", out)
        self.assertIn("lunghezza testo >30", out)
        self.assertIn("Colonna «cod disp»: tipo testo; 3 non vuoti; 2 distinti; lunghezza testo <=10; forma 2 cifre", out)
        self.assertNotIn("valori:", out)  # Cod Disp. is a reference per instruction: never its values
        self.assertNotRegex(out, r"lunghezza testo \d")

    def segno_file(self, cells: list[str], label: str = "Segno") -> None:
        head = [inline(f"{c}1", h) for c, h in zip("ABC", ["Data", "Importo", label])]
        body = [[inline(f"A{i + 2}", "x"), inline(f"B{i + 2}", "y"), c] for i, c in enumerate(cells)]
        build(self.file, sheet_xml([head, *body]))

    def test_code_values_only_for_short_text_cells_of_code_columns(self) -> None:
        self.segno_file([inline("C2", "D"), inline("C3", "A"), inline("C4", "+"), inline("C5", "EUR")])
        out = self.clean()
        self.assertIn("valori: «+», «A», «D», «EUR»", out)
        for bad in (["Zorb", "Zorb"], ["Rossi Mario"], ["IT60X054", "x"], ["RSSMRA85C12"]):
            self.segno_file([inline(f"C{i + 2}", v) for i, v in enumerate(bad)])
            self.assertNotIn("valori:", self.clean(), bad)

    def test_dates_and_numbers_in_code_columns_never_list_values(self) -> None:
        self.segno_file([num("C2", "46303", 1), num("C3", "46304", 1)], "Segno")
        self.assertNotIn("valori:", self.clean())
        self.segno_file([num("C2", "123"), num("C3", "124")], "Segno")
        self.assertNotIn("valori:", self.clean())
        self.segno_file([inline("C2", "12/03/24"), inline("C3", "14/03/24")], "Segno")
        self.assertNotIn("valori:", self.clean())
        self.segno_file([num("C2", "46303", 1), num("C3", "46304", 1)], "Valuta")  # data valuta
        out = self.clean("--code-columns", "Valuta")
        self.assertNotIn("valori:", out)
        self.assertIn("da 2026-", out)
        self.segno_file([inline("C2", "EUR"), num("C3", "5")], "Segno")  # mixed: not all text
        self.assertNotIn("valori:", self.clean())

    def test_valuta_is_not_a_default_code_column_but_can_be_asked(self) -> None:
        self.segno_file([inline("C2", "EUR"), inline("C3", "EUR")], "Valuta")
        self.assertNotIn("valori:", self.clean())
        self.assertIn("valori: «EUR»", run(["--code-columns", "Valuta", str(self.file)])[1])
        self.segno_file([inline("C2", "D"), inline("C3", "A")])
        self.assertNotIn("valori:", self.clean("--code-columns", ""))

    def test_cod_disp_prints_only_the_form(self) -> None:
        for cells, form in [
            ([num("C2", "12345678901"), num("C3", "12345678902")], "forma 11 cifre"),
            ([inline("C2", "ABC12345"), inline("C3", "ABC12399")], "forma 8 caratteri alfanumerici"),
            ([inline("C2", "AB-12 x"), inline("C3", "12345")], "forma mista"),
        ]:
            self.segno_file(cells, "Cod Disp.")
            out = self.clean("--code-columns", "Cod Disp.")  # even if asked as code column
            self.assertIn(form, out)
            self.assertNotIn("valori:", out)

    def test_code_column_with_many_values_is_not_listed(self) -> None:
        self.segno_file([inline(f"C{i + 2}", chr(97 + i)) for i in range(14)])
        out = self.clean()
        self.assertIn("14 distinti", out)
        self.assertNotIn("valori:", out)

    def test_unknown_labels_are_never_printed(self) -> None:
        rows = [header_row(1, ["Data", "Importo", "Zorbaldo Etichetta", "Descrizione"]), *data_rows(2)]
        build(self.file, sheet_xml(rows))
        out = run([str(self.file)])[1]
        self.assertNotIn("Zorbaldo", out)
        self.assertIn("(colonna 3, testo, lunghezza <=30)", out)
        code, out, _ = run(["--known-labels", "zorbaldo etichetta", str(self.file)])
        self.assertIn("«zorbaldo etichetta»", out)

    def test_labels_are_normalised_for_the_allowlist(self) -> None:
        build(self.file, sheet_xml([header_row(1, ["Zorb Etichet", "Descrizione", "Importo", "Cod. Disp."]), *data_rows(2)]))
        out = self.clean()
        self.assertIn("«descrizione»", out)
        self.assertIn("«cod disp»", out)
        self.assertIn("(colonna 1, testo, lunghezza <=30)", out)

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
        self.assertIn("Riga delle intestazioni: 5\n", out)
        self.assertIn("Riga 1 sopra l'intestazione: A=testo (date: no), B=testo (date: no), C=testo (date: no)", out)
        self.assertIn("Riga 3 sopra l'intestazione: A=testo (intervallo 2026-01..2026-03)", out)
        self.assertIn("Riga 4 sopra l'intestazione: A=testo (date: no), B=numero", out)
        self.assertNotIn("Periodo", out)

    def test_wrongly_chosen_header_rows_print_nothing_personal(self) -> None:
        build(self.file, sheet_xml([
            [inline("A1", "Titolare"), inline("B1", "Mario Rossi"), inline("C1", "Saldo 1.234,56")],
            [inline("A2", "Conto"), inline("B2", IBAN_SPACED), inline("C2", f"Intestatario {NAME}")],
            [inline("A3", "Codice"), inline("B3", "12345678901"), inline("C3", "RSSMRA85C12")],
            [inline("A4", "12/03/24"), inline("B4", "-63,00"), inline("C4", "Caffe da Rossi"), inline("D4", NOTE)],
        ]))
        for row in ("1", "2", "3"):
            out = self.clean("--header-row", row)
            self.assertIn(f"Riga delle intestazioni: {row}\n", out)
            self.assertIn("(colonna", out)

    def test_header_row_with_non_text_cells_is_an_error(self) -> None:
        build(self.file, sheet_xml([header_row(1), *data_rows(2)]))
        for row in ("2", "3"):  # date and number cells
            self.assertEqual(run(["--header-row", row, str(self.file)]),
                             (2, "", xlsx_structure.HEADER_ERROR + "\n"), row)
        self.assertEqual(run(["--json", "--header-row", "2", str(self.file)])[0], 2)

    def test_automatic_pick_without_known_labels_prints_only_length_bands(self) -> None:
        rows = [[inline("A1", "Mario Rossi"), inline("B1", IBAN_SPACED), inline("C1", NAME)], [inline("A2", "x")]]
        build(self.file, sheet_xml(rows))
        out = self.clean()
        self.assertIn("(colonna 2, testo, lunghezza >30)", out)
        self.assertNotRegex(out, r"testo di \d")

    def test_header_with_a_numeric_cell_is_never_a_header(self) -> None:
        head = [inline("A1", "Data"), inline("B1", "Importo"), num("C1", "2026"), inline("D1", "Descrizione")]
        data = [inline("A2", "12/03/2024"), inline("B2", "-63,00"), inline("C2", "Caffe da Rossi"), inline("D2", NOTE)]
        build(self.file, sheet_xml([head, data]))
        out = self.clean()
        self.assertIn("Intestazione non individuata.", out)
        self.assertNotIn("(colonna", out)

    def test_a_movement_row_with_numeric_cells_never_wins_over_the_header(self) -> None:
        rows = [
            [inline("A1", "Data"), inline("B1", "Movimento"), inline("C1", "Ammontare"), inline("D1", "Saldo")],
            [num("A2", "46098", 1), inline("B2", "Bonifico"), num("C2", "5", 2), inline("D2", "Caffe")],
            [inline("A3", "Canale"), inline("B3", "Spese"), num("C3", "5", 2), inline("D3", "Commissioni")],
            [inline("A4", "Canale"), inline("B4", "Spese"), inline("C4", "Valuta"), inline("D4", "Commissioni")],
        ]
        build(self.file, sheet_xml(rows))
        out = self.clean()
        # row 1 has only 2 known labels of 4 cells (half): it qualifies and is the topmost
        self.assertIn("Riga delle intestazioni: 1\n", out)
        rows[0] = [inline("A1", "Titolare"), inline("B1", "Movimento"), inline("C1", "Ammontare"), inline("D1", "Dettaglio")]
        build(self.file, sheet_xml(rows))
        # no qualifying row but row 4 (all text, all known): chosen; the numeric row 3 never is
        self.assertIn("Riga delle intestazioni: 4\n", self.clean())

    def test_half_of_the_cells_must_be_known_labels(self) -> None:
        rows = [[inline(f"{c}1", t) for c, t in zip("ABCDE", ["Data", "Saldo", "Mario Rossi", "Altro", "Ancora"])], header_row(2)]
        build(self.file, sheet_xml(rows))
        self.assertIn("Riga delle intestazioni: 2\n", self.clean())

    def test_half_of_the_cells_must_be_known_labels(self) -> None:
        rows = [[inline(f"{c}1", t) for c, t in zip("ABCDE", ["Data", "Saldo", "Mario Rossi", "Altro", "Ancora"])], header_row(2)]
        build(self.file, sheet_xml(rows))
        self.assertIn("Riga delle intestazioni: 2\n", self.clean())

    def test_header_scan_is_limited_to_the_first_rows(self) -> None:
        rows = [[inline("A1", "Uno"), inline("B1", "Due"), inline("C1", "Tre")]]
        rows += [[inline(f"A{r}", "x")] for r in range(2, 121)]
        rows.append(header_row(121))
        build(self.file, sheet_xml(rows))
        self.assertIn("Riga delle intestazioni: 1\n", self.clean())

    def test_preamble_dates(self) -> None:
        rows = [
            [inline("A1", "Intestatario nato il 12/03/1985, cliente dal 01/02/2001")],
            [inline("A2", "Nato il 12/03/1985")],
            [inline("A2", "Aperto il 05/06/2020")],
            [inline("A3", "12/03/1985")],
            [inline("A4", "Periodo dal 01/01/2026 al 31/03/2026")],
            [num("A5", "46098", 1)],
            header_row(7),
        ]
        build(self.file, sheet_xml(rows))
        out = self.clean()
        self.assertIn("Riga 1 sopra l'intestazione: A=testo (date: si)", out)
        self.assertIn("Riga 2 sopra l'intestazione: A=testo (date: si)", out)
        self.assertIn("Riga 3 sopra l'intestazione: A=testo (date: si)", out)
        self.assertIn("Riga 4 sopra l'intestazione: A=data (date: si)", out)
        self.assertIn("Riga 5 sopra l'intestazione: A=testo (intervallo 2026-01..2026-03)", out)
        self.assertIn("Riga 6 sopra l'intestazione: A=data (date: si)", out)
        self.assertEqual(out.count("intervallo"), 1)
        self.assertNotIn("2020", out)

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
        self.assertEqual([c["intestazione"] for c in cols], ["segno", "valuta", "(colonna 3, testo, lunghezza <=10)"])
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

    def test_read_limits_do_not_trust_declared_sizes(self) -> None:
        self.normal()
        with mock.patch.object(xlsx_structure, "MAX_MEMBER_BYTES", 100):  # read(MAX + 1) is what stops it
            self.rejected()
        with mock.patch.object(xlsx_structure, "MAX_TOTAL_BYTES", 600):  # running budget across members
            self.rejected()

    def test_duplicate_zip_members_are_rejected(self) -> None:
        self.normal()
        with warnings_ignored(), zipfile.ZipFile(self.file, "a") as zf:
            zf.writestr("xl/styles.xml", styles_xml())
        self.rejected()

    def test_boolean_cells_are_text_and_negative_rows_rejected(self) -> None:
        head = [inline(f"{c}1", h) for c, h in zip("ABC", ["Data", "Importo", "Segno"])]
        build(self.file, sheet_xml([head, [inline("A2", "x"), inline("B2", "y"), '<c r="C2" t="b"><v>1</v></c>']]))
        self.assertIn("Colonna «segno»: tipo testo", self.clean())
        build(self.file, f'<worksheet {NS}><sheetData><row r="-7"><c r="A-7"/></row></sheetData></worksheet>')
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

    def test_real_closed_pipe_gives_code_2_and_no_exception_noise(self) -> None:
        self.normal()
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        proc = subprocess.Popen([sys.executable, "-I", "-S", str(TOOL), str(self.file)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        assert proc.stdout is not None and proc.stderr is not None
        proc.stdout.close()  # the reader goes away before the tool writes
        err = proc.stderr.read()
        self.assertEqual(proc.wait(), 2)
        self.assertEqual(err, (xlsx_structure.INTERNAL_ERROR + "\n").encode())
        proc.stderr.close()

    def test_file_is_not_modified(self) -> None:
        self.normal()
        before = self.file.read_bytes()
        self.clean()
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["estratto.xlsx"])


if __name__ == "__main__":
    unittest.main()
