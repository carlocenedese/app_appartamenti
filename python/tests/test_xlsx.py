"""Tests for `bollette_pdf table` (python/bollette_pdf/xlsx.py). Every workbook is synthetic."""

from __future__ import annotations

import ast
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest import mock

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(PYTHON_DIR / "tools"))

import xlsx_builder  # noqa: E402
import xlsx_structure  # noqa: E402
from bollette_pdf import xlsx  # noqa: E402
from bollette_pdf.__main__ import main  # noqa: E402

SECRET = "Zorbaldo Segreto"
BAD = "File non valido o troppo grande: nessun output.\n"
BOOTSTRAP = (
    "import runpy, sys; sys.path.insert(0, sys.argv[1]); sys.argv = ['bollette_pdf'] + sys.argv[2:];"
    " runpy.run_module('bollette_pdf', run_name='__main__')"
)


def sheet(rows: list, name: str = "Movimenti", state: str = "visible") -> dict:
    return {"name": name, "rows": rows, "state": state}


class TableTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.file = self.dir / "estratto.xlsx"

    def cli(self, *extra: str) -> tuple[int, bytes, bytes]:
        done = subprocess.run(
            [sys.executable, "-I", "-c", BOOTSTRAP, str(PYTHON_DIR), "table", str(self.file), *extra],
            capture_output=True, cwd=self.dir, timeout=60,
        )
        return done.returncode, done.stdout, done.stderr

    def table(self, **kwargs) -> dict:
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual((main(["table", str(self.file)], out, err), err.getvalue()), (0, ""))
        return json.loads(out.getvalue())

    def rejected(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            code = main(["table", str(self.file)], out, err)
        self.assertEqual((code, out.getvalue(), err.getvalue()), (2, "", BAD))
        self.assertEqual(xlsx.TABLE_ERROR + "\n", BAD)

    # --- values --------------------------------------------------------------------------------

    def test_cell_types_holes_and_dates(self) -> None:
        rows = [
            [("i", "Data"), ("i", "Importo"), ("i", "Descrizione")],
            [("d", "46322"), ("n", "-92.810000000000002"), ("s", "Caffè città")],
            [("d", "46322.75"), None, ("i", "ciao"), ("n", "1234.5")],
            [("n", "7"), ("n", "0.1"), ("str", "x"), ("b", "1"), ("e", "#N/A")],
        ]
        xlsx_builder.build_xlsx(self.file, [sheet(rows)])
        self.assertEqual(self.table(), {"v": 1, "sheets": [{"name": "Movimenti", "rows": [
            [{"t": "s", "v": "Data"}, {"t": "s", "v": "Importo"}, {"t": "s", "v": "Descrizione"}],
            [{"t": "d", "v": "2026-10-27"}, {"t": "n", "v": "-92.81"}, {"t": "s", "v": "Caffè città"}],
            [{"t": "d", "v": "2026-10-27"}, None, {"t": "s", "v": "ciao"}, {"t": "n", "v": "1234.5"}],
            [{"t": "n", "v": "7.0"}, {"t": "n", "v": "0.1"}, {"t": "s", "v": "x"},
             {"t": "s", "v": "1"}, {"t": "s", "v": "#N/A"}],
        ]}]})

    def test_date_system_1904_and_serials_below_one(self) -> None:
        rows = [[("d", "46322"), ("d", "0.5"), ("t", "0.25"), ("d", "1"), ("d", "0")]]
        xlsx_builder.build_xlsx(self.file, [sheet(rows)], date1904=True)
        cells = self.table()["sheets"][0]["rows"][0]
        self.assertEqual(cells[0], {"t": "d", "v": "2030-10-28"})
        self.assertEqual(cells[1], {"t": "n", "v": "0.5"})  # a serial below 1 is not a date
        self.assertEqual(cells[2], {"t": "n", "v": "0.25"})
        self.assertEqual(cells[3], {"t": "d", "v": "1904-01-02"})
        self.assertEqual(cells[4], {"t": "n", "v": "0.0"})

    def test_numbers_are_never_rounded_and_never_use_an_exponent(self) -> None:
        raws = ["0.1", "1E-05", "1e+16", "123456789.12", "-0.30000000000000004", "1234", "100000"]
        xlsx_builder.build_xlsx(self.file, [sheet([[("n", r) for r in raws]])])
        values = [c["v"] for c in self.table()["sheets"][0]["rows"][0]]
        self.assertEqual(values, ["0.1", "0.00001", "10000000000000000", "123456789.12",
                                  "-0.30000000000000004", "1234.0", "100000.0"])
        for value in values:
            self.assertRegex(value, r"^-?\d+(\.\d+)?$")
            self.assertEqual(float(value), float(raws[values.index(value)]))

    def test_non_finite_and_garbage_numbers_are_rejected(self) -> None:
        for raw in ("nan", "inf", "1e999", SECRET):
            xlsx_builder.build_xlsx(self.file, [sheet([[("n", raw)]])])
            self.rejected()

    def test_rows_without_cells_are_skipped_and_trailing_holes_trimmed(self) -> None:
        rows = [[("i", "a")], [], [None, None], [None, ("i", "b"), ("i", "")], [("i", ""), None]]
        xlsx_builder.build_xlsx(self.file, [sheet(rows)])
        self.assertEqual(self.table()["sheets"][0]["rows"],
                         [[{"t": "s", "v": "a"}], [None, {"t": "s", "v": "b"}]])

    def test_hidden_sheets_are_skipped_and_all_hidden_is_rejected(self) -> None:
        sheets = [sheet([[("i", SECRET)]], "Nascosto", "hidden"), sheet([[("i", "x")]], "Visibile")]
        xlsx_builder.build_xlsx(self.file, sheets)
        table = self.table()
        self.assertEqual([s["name"] for s in table["sheets"]], ["Visibile"])
        self.assertNotIn(SECRET, json.dumps(table))
        xlsx_builder.build_xlsx(self.file, sheets[:1])
        self.rejected()

    def test_two_runs_give_the_same_bytes_and_stdout_is_utf8(self) -> None:
        xlsx_builder.build_xlsx(self.file, [sheet([[("s", "Caffè € città"), ("n", "1.5")]])])
        first, second = self.cli(), self.cli()
        self.assertEqual(first, second)
        self.assertEqual((first[0], first[2]), (0, b""))
        self.assertIn("Caffè € città".encode("utf-8"), first[1])
        self.assertTrue(first[1].endswith(b"\n") and b"\r" not in first[1])
        self.assertEqual(self.table(), json.loads(first[1]))

    def test_file_is_not_modified_and_nothing_is_written(self) -> None:
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x")]])])
        before = self.file.read_bytes()
        self.table()
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual([p.name for p in self.dir.iterdir()], ["estratto.xlsx"])

    # --- rejected files: constant message, code 2, empty stdout -------------------------------

    def test_not_a_zip_missing_and_empty_file(self) -> None:
        self.file.write_bytes(b"questo non e' uno zip " + SECRET.encode())
        self.rejected()
        self.file.write_bytes(b"")
        self.rejected()
        self.file.unlink()
        self.rejected()

    def test_doctype_and_entity_in_any_member(self) -> None:
        ok = [sheet([[("i", "x")]])]
        for member, xml in (
            ("xl/worksheets/sheet1.xml", f'<!DOCTYPE x [<!ENTITY a "{SECRET}">]><worksheet {xlsx_builder.NS}/>'),
            ("xl/sharedStrings.xml", f'<!doctype sst><sst {xlsx_builder.NS}/>'),
            ("xl/styles.xml", f'<!ENTITY a "b"><styleSheet {xlsx_builder.NS}/>'),
            ("xl/workbook.xml", f'<!DOCTYPE w><workbook {xlsx_builder.NS}/>'),
            ("xl/_rels/workbook.xml.rels", "<!DOCTYPE r><Relationships/>"),
        ):
            xlsx_builder.build_xlsx(self.file, ok, extra={member: xml})
            self.rejected()

    def test_non_utf8_members_are_rejected(self) -> None:
        plain = xlsx_builder.sheet_xml([[("i", "x")]], [])
        xlsx_builder.build_xlsx(self.file, [sheet([])], raw_sheets={1: plain})
        self.table()
        for member in ("xl/worksheets/sheet1.xml", "xl/styles.xml"):
            for data in (plain.encode("utf-16"), '<?xml version="1.0" encoding="ISO-8859-1"?>' + plain):
                xlsx_builder.build_xlsx(self.file, [sheet([])], extra={member: data})
                self.rejected()

    def test_limits(self) -> None:
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x"), ("i", "y")], [("i", "z")]])])
        self.table()
        for name, value in (("MAX_ROWS", 1), ("MAX_COLS", 1), ("MAX_CELLS", 2), ("MAX_FILE_BYTES", 100),
                            ("MAX_MEMBER_BYTES", 100), ("MAX_TOTAL_BYTES", 300), ("MAX_MEMBERS", 3),
                            ("MAX_SHEETS", 0)):
            with mock.patch.object(xlsx, name, value):
                self.rejected()
        self.assertEqual((xlsx.MAX_FILE_BYTES, xlsx.MAX_MEMBER_BYTES, xlsx.MAX_TOTAL_BYTES, xlsx.MAX_MEMBERS,
                          xlsx.MAX_ROWS, xlsx.MAX_COLS, xlsx.MAX_CELLS, xlsx.MAX_SHEETS),
                         (10 * 1024 * 1024, 32 * 1024 * 1024, 100 * 1024 * 1024, 200, 50_000, 256,
                          2_000_000, 50))

    def test_more_members_than_the_limit(self) -> None:
        extra = {f"xl/extra{i}.xml": "<a/>" for i in range(xlsx.MAX_MEMBERS)}
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x")]])], extra=extra)
        self.rejected()

    def test_duplicate_members_and_path_traversal(self) -> None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # zipfile warns about the duplicate it is asked to write
            xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x")]])], duplicate="xl/worksheets/sheet1.xml")
        self.rejected()
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x")]])])
        with zipfile.ZipFile(self.file) as zf:
            members = {n: zf.read(n) for n in zf.namelist()}
        members["xl/_rels/workbook.xml.rels"] = members["xl/_rels/workbook.xml.rels"].replace(
            b"worksheets/sheet1.xml", b"../../etc/passwd")
        with zipfile.ZipFile(self.file, "w") as zf:
            for name, data in members.items():
                zf.writestr(name, data)
        self.rejected()

    def test_bad_structure_gives_the_same_message(self) -> None:
        bad_cell = f'<worksheet {xlsx_builder.NS}><sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData></worksheet>'
        torn = f"<worksheet {xlsx_builder.NS}><sheetData><row r="
        row0 = f'<worksheet {xlsx_builder.NS}><sheetData><row r="0"><c r="A1"/></row></sheetData></worksheet>'
        for raw in (bad_cell, torn, row0):
            xlsx_builder.build_xlsx(self.file, [sheet([])], raw_sheets={1: raw})
            self.rejected()
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", "x")]])], extra={"xl/styles.xml": "<styleSheet"})
        self.rejected()

    def test_an_impossible_date_is_rejected_without_the_value(self) -> None:
        xlsx_builder.build_xlsx(self.file, [sheet([[("d", "99999999")]])])
        self.rejected()

    def test_errors_never_carry_cell_content(self) -> None:
        raw = (f'<worksheet {xlsx_builder.NS}><sheetData><row r="1"><c r="A1"><v>{SECRET}</v></c>'
               "</row></sheetData></worksheet>")
        xlsx_builder.build_xlsx(self.file, [sheet([[("i", SECRET)]], SECRET)], raw_sheets={1: raw})
        code, out, err = self.cli()
        self.assertEqual((code, out, err), (2, b"", BAD.encode()))
        err = io.StringIO()
        self.assertEqual(main(["table", str(self.dir / SECRET)], io.StringIO(), err), 2)
        self.assertEqual(err.getvalue(), BAD)
        with mock.patch.object(xlsx, "read_table", side_effect=RuntimeError(SECRET)):
            err = io.StringIO()
            self.assertEqual(main(["table", str(self.file)], io.StringIO(), err), 2)
            self.assertNotIn(SECRET, err.getvalue())

    def test_wrong_arguments(self) -> None:
        for argv in (["table"], ["table", "a", "b"], ["table", "--x"]):
            err = io.StringIO()
            self.assertEqual(main(argv, io.StringIO(), err), 2)
            self.assertNotIn("--x", err.getvalue())

    # --- the defences of the structure tool stay aligned --------------------------------------

    def test_shared_defences_are_identical_to_the_structure_tool(self) -> None:
        def functions(path: Path) -> dict[str, str]:
            source = path.read_text(encoding="utf-8")
            return {
                node.name: ast.get_source_segment(source, node) or ""
                for node in ast.parse(source).body
                if isinstance(node, (ast.FunctionDef, ast.ClassDef))
            }

        mine = functions(PYTHON_DIR / "bollette_pdf" / "xlsx.py")
        theirs = functions(PYTHON_DIR / "tools" / "xlsx_structure.py")
        shared = ["_Rejected", "_tag", "_check_text", "_xml", "_member", "_column_index",
                  "_format_class", "_read_styles", "_read_shared", "_workbook"]
        for name in shared:
            self.assertNotEqual(mine.get(name), "", name)
            self.assertEqual(mine.get(name), theirs.get(name), name)
        for name in ("MAX_FILE_BYTES", "MAX_MEMBER_BYTES", "MAX_TOTAL_BYTES", "MAX_MEMBERS", "MAX_ROWS",
                     "MAX_COLS", "MAX_CELLS", "MAX_SHEETS", "BAD_FILE", "_BUILTIN_CLASS"):
            self.assertEqual(getattr(xlsx, name), getattr(xlsx_structure, name), name)
        for name in ("_XML_ENCODING", "_FORBIDDEN_XML", "_NS_STRIP"):
            a, b = getattr(xlsx, name), getattr(xlsx_structure, name)
            self.assertEqual((a.pattern, a.flags), (b.pattern, b.flags), name)

    def test_module_is_standard_library_only_and_has_no_clock(self) -> None:
        source = (PYTHON_DIR / "bollette_pdf" / "xlsx.py").read_text(encoding="utf-8")
        modules = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                modules.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                modules.add(node.module or "")
        self.assertEqual(modules, {"__future__", "io", "posixpath", "re", "zipfile", "datetime", "decimal",
                                   "pathlib", "typing", "xml.etree"})
        self.assertIsNone(re.search(r"\b(today|now|utcnow|random|socket|urllib)\b", source))


if __name__ == "__main__":
    unittest.main()
