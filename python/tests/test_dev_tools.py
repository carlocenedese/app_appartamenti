"""Tests for python/tests/make_sample.py and python/tools/dev_install.py. All data is invented."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(PYTHON_DIR / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dev_install  # noqa: E402
import make_sample  # noqa: E402
from bollette_pdf.extract import extract  # noqa: E402
from bollette_pdf.profiles import load_profiles  # noqa: E402
from bollette_pdf.reader import PdfReadError, read_pdf  # noqa: E402
from bollette_pdf.schemas import validate  # noqa: E402

AT = "2026-11-12T09:00:00Z"


class MakeSampleTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name) / "cartella con spazi è"
        self.assertEqual(make_sample.main([str(self.dir)]), 0)
        self.profiles, warnings = load_profiles(self.dir / "_app" / "dati" / "supplierProfile")
        self.assertEqual(warnings, [])

    def test_profile_is_a_valid_draft(self) -> None:
        [profile] = self.profiles
        self.assertEqual(validate("supplierProfile", profile), [])
        self.assertEqual((profile["status"], profile["rev"]), ("bozza", 1))

    def test_both_bills_are_recognised_with_every_field_high(self) -> None:
        numbers = set()
        for name in make_sample.BILLS:
            result = extract(read_pdf(self.dir / name), self.profiles, AT)
            self.assertEqual(result["status"], "riconosciuta", name)
            self.assertEqual(
                {f["confidence"] for f in result["fields"].values()}, {"high"}, name
            )
            self.assertEqual(result["identifiers"], [{"kind": "pod", "value": make_sample.POD}])
            numbers.add(result["fields"]["number"]["value"])
        self.assertEqual(len(numbers), 2)

    def test_broken_and_blank_files(self) -> None:
        with self.assertRaises(PdfReadError):
            read_pdf(self.dir / "guasto.pdf")
        self.assertFalse(read_pdf(self.dir / "senza-testo.pdf").has_text)

    def test_wrong_arguments(self) -> None:
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(make_sample.main([]), 2)
        self.assertIn("Uso", err.getvalue())


class DevInstallTest(unittest.TestCase):
    def test_only_in_a_virtualenv_or_on_ci(self) -> None:
        self.assertTrue(dev_install.allowed("/venv", "/usr", {}))
        self.assertTrue(dev_install.allowed("/usr", "/usr", {"CI": "true"}))
        self.assertFalse(dev_install.allowed("/usr", "/usr", {}))
        self.assertFalse(dev_install.allowed("/usr", "/usr", {"CI": "1"}))

    def test_writes_one_line_naming_the_python_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = dev_install.write_pth(Path(tmp), Path("/repo con spazi/python"))
            self.assertEqual(path.name, "bollette_pdf-dev.pth")
            self.assertEqual(path.read_text(encoding="utf-8"), "/repo con spazi/python\n")


if __name__ == "__main__":
    unittest.main()
