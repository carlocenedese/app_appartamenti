"""Tests for tools/excel_dump.py.

Run with: python3 -I -m unittest discover -s tools -p 'test_*.py'

The workbooks are built here, in a temporary directory, from invented values: no real file is
needed and nothing is left behind. openpyxl does not compute formulas, so a workbook it writes
carries no cached value for its formula cells and the script must report ``"value": null`` for
them. To also exercise the ``data_only=True`` path (the reason the script exists), a second copy
of the workbook is produced by patching the cached values straight into the sheet XML, the way
Excel stores them.
"""

from __future__ import annotations

import ast
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

try:
    import openpyxl
except ModuleNotFoundError:
    # A local tool (tools/README.md): CI has no openpyxl, which is not in python/requirements.txt.
    raise unittest.SkipTest("openpyxl non installato: tools/excel_dump.py non viene provato") from None

SCRIPT = Path(__file__).resolve().with_name("excel_dump.py")


def run_dump(*args: str, cwd: str | None = None) -> tuple[int, bytes, bytes]:
    """Runs the script in a fresh isolated interpreter and returns (exit code, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, "-I", str(SCRIPT), *args],
        capture_output=True,
        cwd=cwd,
        check=False,
    )
    return result.returncode, result.stdout, result.stderr


def build_sample(path: Path) -> None:
    """Two sheets: values, a formula, a date, a boolean, an empty styled cell, a merged range."""
    book = openpyxl.Workbook()
    rent = book.active
    rent.title = "Affitti"
    rent.append(["Inquilino", "Canone", "Data", "Pagato"])
    rent.append(["Inquilino A", 450, datetime.date(2025, 1, 31), True])
    rent["A3"], rent["B3"] = "Inquilino Città", 450.25
    rent["A4"], rent["B4"] = "Totale", "=SUM(B2:B3)"
    rent["B5"].number_format = "0.00"  # styled but empty: must not be listed
    rent["A6"] = "Titolo"
    rent.merge_cells("A6:C6")
    summary = book.create_sheet("Riepilogo")
    summary["A1"], summary["B1"] = "Totale affitti", "=Affitti!B4"
    summary["B2"] = '=IF(B1>0,"ok","no")'
    summary["B3"] = "=1/0"
    book.save(path)


def inject_cached_values(source: Path, target: Path, patches: dict[str, dict[str, tuple]]) -> None:
    """Copies a workbook, filling the empty ``<v />`` of some formula cells with cached values.

    ``patches`` maps a sheet part (``xl/worksheets/sheet1.xml``) to {coord: (t attribute or
    None, cached text)}.
    """
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            part_patches = patches.get(item.filename)
            if part_patches:
                xml = data.decode("utf-8")
                for coord, (cell_type, cached) in part_patches.items():
                    pattern = re.compile(rf'<c r="{coord}"([^>]*)>(<f>.*?</f>)<v ?/></c>')
                    type_attr = f' t="{cell_type}"' if cell_type else ""
                    xml, count = pattern.subn(
                        lambda m: (
                            f'<c r="{coord}"{m.group(1)}{type_attr}>'
                            f"{m.group(2)}<v>{cached}</v></c>"
                        ),
                        xml,
                    )
                    assert count == 1, f"cell {coord} not found in {item.filename}"
                data = xml.encode("utf-8")
            dst.writestr(item, data)


def cells_by_coord(sheet: dict) -> dict[str, dict]:
    return {cell["coord"]: cell for cell in sheet["cells"]}


class ExcelDumpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls._tmp.name)
        cls.sample = cls.dir / "esempio.xlsx"
        build_sample(cls.sample)
        cls.cached = cls.dir / "con-valori.xlsx"
        inject_cached_values(
            cls.sample,
            cls.cached,
            {
                "xl/worksheets/sheet1.xml": {"B4": (None, "900.25")},
                "xl/worksheets/sheet2.xml": {
                    "B1": (None, "900.25"),
                    "B2": ("str", "ok"),
                    "B3": ("e", "#DIV/0!"),
                },
            },
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def dump(self, path: Path, *args: str) -> dict:
        code, out, err = run_dump(*args, str(path), cwd=str(self.dir))
        self.assertEqual(code, 0, err.decode())
        self.assertEqual(err, b"")
        self.assertTrue(out.endswith(b"\n"))
        return json.loads(out.decode("utf-8"))  # the whole stdout is one JSON document

    # --- structure and values ---------------------------------------------------------------

    def test_structure_values_dates_and_merged_ranges(self) -> None:
        document = self.dump(self.sample)
        self.assertEqual(list(document), ["file", "sheets"])
        self.assertEqual(document["file"], "esempio.xlsx")
        self.assertEqual([sheet["name"] for sheet in document["sheets"]], ["Affitti", "Riepilogo"])

        rent, summary = document["sheets"]
        self.assertEqual(rent["dimensions"], "A1:D6")
        self.assertEqual(rent["merged"], ["A6:C6"])
        self.assertEqual(summary["dimensions"], "A1:B3")
        self.assertEqual(summary["merged"], [])

        cells = cells_by_coord(rent)
        self.assertEqual(
            cells["B2"],
            {
                "coord": "B2",
                "row": 2,
                "col": 2,
                "formula": None,
                "value": 450,
                "type": "n",
                "number_format": "General",
            },
        )
        self.assertEqual(cells["B3"]["value"], 450.25)
        self.assertEqual(cells["A3"]["value"], "Inquilino Città")
        self.assertEqual(cells["A3"]["type"], "s")
        self.assertEqual(cells["D2"]["value"], True)
        self.assertEqual(cells["D2"]["type"], "b")
        self.assertEqual(cells["C2"]["value"], "2025-01-31T00:00:00")
        self.assertEqual(cells["C2"]["type"], "d")
        self.assertEqual(cells["C2"]["number_format"], "yyyy-mm-dd")
        self.assertNotIn("B5", cells)  # styled but empty
        self.assertNotIn("B6", cells)  # inside the merged range, no value
        self.assertEqual(
            list(cells),
            ["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2", "A3", "B3", "A4", "B4", "A6"],
        )

    def test_formula_without_cached_value_has_null_value(self) -> None:
        # openpyxl writes formulas without a cached value and never computes them.
        document = self.dump(self.sample)
        total = cells_by_coord(document["sheets"][0])["B4"]
        self.assertEqual(total["formula"], "=SUM(B2:B3)")
        self.assertIsNone(total["value"])
        self.assertIsNone(total["type"])
        cross_sheet = cells_by_coord(document["sheets"][1])["B1"]
        self.assertEqual(cross_sheet["formula"], "=Affitti!B4")
        self.assertIsNone(cross_sheet["value"])

    def test_formula_with_cached_value(self) -> None:
        document = self.dump(self.cached)
        rent, summary = document["sheets"]
        total = cells_by_coord(rent)["B4"]
        self.assertEqual(
            (total["formula"], total["value"], total["type"]),
            ("=SUM(B2:B3)", 900.25, "n"),
        )
        cells = cells_by_coord(summary)
        self.assertEqual(
            (cells["B1"]["formula"], cells["B1"]["value"], cells["B1"]["type"]),
            ("=Affitti!B4", 900.25, "n"),
        )
        self.assertEqual(
            (cells["B2"]["formula"], cells["B2"]["value"], cells["B2"]["type"]),
            ('=IF(B1>0,"ok","no")', "ok", "s"),
        )
        self.assertEqual(
            (cells["B3"]["formula"], cells["B3"]["value"], cells["B3"]["type"]),
            ("=1/0", "#DIV/0!", "e"),
        )

    def test_utf8_is_written_unescaped(self) -> None:
        _, out, _ = run_dump(str(self.sample), cwd=str(self.dir))
        self.assertIn("Inquilino Città".encode("utf-8"), out)

    # --- options ------------------------------------------------------------------------------

    def test_formulas_only(self) -> None:
        document = self.dump(self.cached, "--formulas-only")
        rent, summary = document["sheets"]
        self.assertEqual(list(cells_by_coord(rent)), ["B4"])
        self.assertEqual(list(cells_by_coord(summary)), ["B1", "B2", "B3"])
        self.assertEqual(rent["merged"], ["A6:C6"])  # the rest of the sheet is still described
        for sheet in document["sheets"]:
            for cell in sheet["cells"]:
                self.assertIsNotNone(cell["formula"])

    def test_sheet_filter(self) -> None:
        only_summary = self.dump(self.sample, "--sheet", "Riepilogo")
        self.assertEqual([sheet["name"] for sheet in only_summary["sheets"]], ["Riepilogo"])
        both = self.dump(self.sample, "--sheet", "Riepilogo", "--sheet", "Affitti")
        self.assertEqual(  # workbook order, not command-line order
            [sheet["name"] for sheet in both["sheets"]], ["Affitti", "Riepilogo"]
        )
        combined = self.dump(self.cached, "--sheet", "Affitti", "--formulas-only")
        self.assertEqual([sheet["name"] for sheet in combined["sheets"]], ["Affitti"])
        self.assertEqual(list(cells_by_coord(combined["sheets"][0])), ["B4"])

    def test_unknown_sheet_is_an_error(self) -> None:
        code, out, err = run_dump("--sheet", "Inesistente", str(self.sample), cwd=str(self.dir))
        self.assertEqual(code, 2)
        self.assertEqual(out, b"")
        self.assertIn("Inesistente", err.decode())
        self.assertIn("Affitti", err.decode())  # lists the sheets that do exist

    # --- errors -------------------------------------------------------------------------------

    def test_missing_file(self) -> None:
        code, out, err = run_dump(str(self.dir / "non-esiste.xlsx"), cwd=str(self.dir))
        self.assertEqual(code, 2)
        self.assertEqual(out, b"")
        self.assertIn("non trovato", err.decode())

    def test_not_an_xlsx(self) -> None:
        fake_xlsx = self.dir / "finto.xlsx"
        fake_xlsx.write_text("questo non è un file Excel\n", encoding="utf-8")
        wrong_extension = self.dir / "dati.txt"
        wrong_extension.write_bytes(self.sample.read_bytes())
        old_format = self.dir / "vecchio.xls"
        old_format.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        for path in (fake_xlsx, wrong_extension, old_format, self.dir):
            with self.subTest(path=path.name):
                code, out, err = run_dump(str(path), cwd=str(self.dir))
                self.assertEqual(code, 2)
                self.assertEqual(out, b"")
                self.assertNotEqual(err, b"")
                self.assertNotIn(b"Traceback", err)

    def test_usage_error(self) -> None:
        code, out, err = run_dump(cwd=str(self.dir))
        self.assertEqual(code, 2)
        self.assertEqual(out, b"")
        self.assertNotEqual(err, b"")

    # --- guarantees ---------------------------------------------------------------------------

    def test_output_is_deterministic(self) -> None:
        first = run_dump(str(self.cached), cwd=str(self.dir))
        second = run_dump(str(self.cached), cwd=str(self.dir))
        self.assertEqual(first, second)

    def test_writes_nothing(self) -> None:
        def snapshot() -> dict[str, str]:
            return {
                name: hashlib.sha256((self.dir / name).read_bytes()).hexdigest()
                for name in sorted(os.listdir(self.dir))
                if (self.dir / name).is_file()
            }

        before = snapshot()
        run_dump(str(self.cached), cwd=str(self.dir))
        run_dump("--formulas-only", str(self.sample), cwd=str(self.dir))
        self.assertEqual(snapshot(), before)  # same files, same bytes, no new file

    def test_source_stays_offline_and_read_only(self) -> None:
        allowed_imports = {
            "__future__",
            "argparse",
            "datetime",
            "decimal",
            "json",
            "os",
            "sys",
            "warnings",
            "zipfile",
            "typing",
            "openpyxl",
        }
        write_calls = {"save", "write_text", "write_bytes", "mkdir", "unlink", "remove", "rename"}
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            else:
                modules = []
            for module in modules:
                self.assertIn(module.split(".")[0], allowed_imports, f"unexpected import {module}")
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {"open", "exec", "eval", "__import__"})
                if isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, write_calls)


if __name__ == "__main__":
    unittest.main()
