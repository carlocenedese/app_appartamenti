"""Tests for python/tools/dump_text.py and python/tools/pdf_report.py. All data is invented."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(PYTHON_DIR / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dump_text  # noqa: E402
import make_sample  # noqa: E402
import pdf_report  # noqa: E402
import pdfmaker  # noqa: E402
from bollette_pdf.reader import dump_document, load_dump, read_pdf  # noqa: E402

AT = "2026-11-12"
FAKE_NAME = "Zorbaldo Inventato"
FILLER = "Testo di riempimento inventato, con abbastanza caratteri per essere letto davvero."


def run(tool, argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = tool.main(argv, out, err)
    return code, out.getvalue(), err.getvalue()


class DumpTextTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def test_round_trips_with_load_dump(self) -> None:
        pdf = self.dir / "a.pdf"
        pdfmaker.make_pdf(pdf, [[(72, 80, f"Intestato a {FAKE_NAME}"), (72, 400, FILLER)]])
        code, out, err = run(dump_text, [str(pdf)])
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.endswith("\n") and "\r" not in out)
        self.assertEqual(json.loads(out), dump_document(read_pdf(pdf)))
        doc = load_dump(json.loads(out))
        self.assertIn(FAKE_NAME, doc.text)

    def test_missing_file_gives_one_constant_message(self) -> None:
        code, out, err = run(dump_text, [str(self.dir / "manca-segreta.pdf")])
        self.assertEqual((code, out), (2, ""))
        self.assertNotIn("manca-segreta", err)
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_corrupt_file_and_bad_arguments(self) -> None:
        bad = self.dir / "guasto.pdf"
        bad.write_bytes(b"%PDF-1.4\nnon e un pdf\n")
        for argv in ([str(bad)], [], ["a", "b"]):
            code, out, err = run(dump_text, argv)
            self.assertEqual((code, out), (2, ""))
            self.assertNotIn("guasto", err)
            self.assertEqual(len(err.strip().splitlines()), 1)


class PdfReportTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.samples = self.root / "campioni-riservati"
        make_sample.write_samples(self.samples)  # 2 recognised, 1 corrupt, 1 text-less
        self.profiles = self.samples / "_app" / "dati" / "supplierProfile"
        # Not recognised, in a subfolder, with a recognisable fake name inside.
        sub = self.root / "pdf" / "sotto" / "cartella-segreta"
        sub.mkdir(parents=True)
        pdfmaker.make_pdf(sub / "estranea-segreta.pdf", [[(72, 80, FAKE_NAME), (72, 400, FILLER)]])
        self.pdfs = self.root / "pdf"
        for name in ("bolletta-marzo.pdf", "guasto.pdf", "senza-testo.pdf"):
            (self.pdfs / name).write_bytes((self.samples / name).read_bytes())
        (sub / "bolletta-maggio.pdf").write_bytes((self.samples / "bolletta-maggio.pdf").read_bytes())
        self.before = sorted(p.relative_to(self.root) for p in self.root.rglob("*"))

    def report(self) -> str:
        code, out, err = run(
            pdf_report, ["--profiles", str(self.profiles), "--at", AT, str(self.pdfs)]
        )
        self.assertEqual((code, err), (0, ""))
        return out

    def test_counts(self) -> None:
        out = self.report()
        lines = [line.strip() for line in out.splitlines()]
        for expected in (
            "Totale: 5",
            "riconosciuta: 2",
            "non-riconosciuta: 1",
            "senza-testo: 1",
            "illeggibile: 1",
            "da-confermare: 0",
            "luce-esempio: 2",
            "(nessun profilo): 3",
        ):
            self.assertIn(expected, lines)
        high = [line for line in lines if line.startswith("Campi con confidenza high")]
        self.assertEqual(len(high), 1)
        self.assertRegex(high[0], r"[1-9]\d* su [1-9]\d*$")

    def test_output_never_leaks_names_paths_or_text(self) -> None:
        out = self.report()
        for secret in (
            FAKE_NAME, "segreta", "segreti", "campioni", "sotto", "bolletta", "guasto",
            ".pdf", str(self.root), "Luce Esempio SpA", "64,30", "58,15", "LE-2026",
        ):
            self.assertNotIn(secret, out)

    def test_error_messages_never_leak(self) -> None:
        for argv in (
            ["--profiles", str(self.root / "assente-segreta"), "--at", AT, str(self.pdfs)],
            ["--profiles", str(self.profiles), "--at", "ieri-segreto", str(self.pdfs)],
            ["--profiles", str(self.profiles), "--at", AT],
            ["--profiles", str(self.profiles), "--at", AT, str(self.root / "assente-segreta")],
            ["--bogus-segreto"],
        ):
            code, out, err = run(pdf_report, argv)
            self.assertEqual((code, out), (2, ""), argv)
            self.assertNotIn("segret", err)
            self.assertNotIn(str(self.root), err)

    def test_writes_nothing(self) -> None:
        self.report()
        after = sorted(p.relative_to(self.root) for p in self.root.rglob("*"))
        self.assertEqual(self.before, after)


if __name__ == "__main__":
    unittest.main()
