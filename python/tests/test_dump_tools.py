"""Tests for python/tools/dump_text.py and python/tools/pdf_report.py. All data is invented."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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


def _listdir(folder: Path):
    try:
        yield from folder.iterdir()
    except OSError:
        return


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

    def test_late_failure_gives_the_constant_message(self) -> None:
        pdf = self.dir / "a.pdf"
        pdfmaker.make_pdf(pdf, [[(72, 80, "Ciao"), (72, 400, FILLER)]])

        class Broken(io.StringIO):
            def write(self, text: str) -> int:
                raise OSError("Zorbaldo")

        err = io.StringIO()
        self.assertEqual(dump_text.main([str(pdf)], Broken(), err), 2)
        self.assertNotIn("Zorbaldo", err.getvalue())

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
        # 2 bills x 7 fields; the always-high `supplier` field is not counted.
        self.assertIn("Campi con confidenza high nelle riconosciute (senza supplier): 14 su 14", lines)
        self.assertNotIn("\r", out)

    def test_counts_by_text_source_and_the_ocr_unavailable_warning(self) -> None:
        # No engine asked for: the text-less page is not read and carries the warning.
        lines = [line.strip() for line in self.report().splitlines()]
        for expected in ("pdf: 5", "ocr: 0", "mixed: 0", "Con avviso OCR non disponibile: 1"):
            self.assertIn(expected, lines)
        self.assertIn("pdf senza-testo: 1", lines)
        self.assertIn("ocr riconosciuta: 0", lines)

    def test_counts_the_many_documents_warning_by_profile(self) -> None:
        self.assertIn("Con avviso più documenti: 0", self.report())
        # Both bills in one file, read whole: the file warns, under the profile that read it.
        bills = [make_sample._page(bill) for bill in make_sample.BILLS.values()]
        pdfmaker.make_pdf(self.pdfs / "composto-segreto.pdf", bills)
        lines = [line.strip() for line in self.run_ok(self.pdfs).splitlines()]
        self.assertIn("Con avviso più documenti: 1", lines)
        start = lines.index("Con avviso più documenti per fornitore:")
        self.assertEqual(lines[start + 1 : start + 3], ["(nessun profilo): 0", "luce-esempio: 1"])
        self.assertIn("Totale: 6", lines)

    def test_ocr_data_option_reads_the_scans_with_the_engine(self) -> None:
        from bollette_pdf import ocr
        from test_ocr import FakeEngine

        data = self.root / "dati-ocr"
        data.mkdir()
        with mock.patch.object(ocr, "ENGINE_FACTORY", lambda _dir: FakeEngine()):
            out = self.run_ok(self.pdfs, extra=["--ocr-data", str(data)])
        lines = [line.strip() for line in out.splitlines()]
        for expected in ("pdf: 4", "ocr: 1", "mixed: 0", "Con avviso OCR non disponibile: 0"):
            self.assertIn(expected, lines)
        self.assertNotIn("dati-ocr", out)

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

    def run_ok(self, *folders: Path, profiles: Path | None = None, extra: list[str] = ()) -> str:
        code, out, err = run(
            pdf_report,
            ["--profiles", str(profiles or self.profiles), "--at", AT, *extra, *map(str, folders)],
        )
        self.assertEqual((code, err), (0, ""))
        return out

    def test_skips_dot_files_and_dedupes_real_paths(self) -> None:
        extra = self.root / "altro"
        extra.mkdir()
        pdfmaker.make_pdf(extra / "._x.pdf", [[(72, 80, FAKE_NAME), (72, 400, FILLER)]])
        pdfmaker.make_pdf(extra / "Y.PDF", [[(72, 80, FAKE_NAME), (72, 400, FILLER)]])
        self.assertIn("Totale: 6", self.run_ok(self.pdfs, extra))
        # Same folder twice, a nested folder and a symlink to the same PDF count once.
        (extra / "link.pdf").symlink_to(self.pdfs / "bolletta-marzo.pdf")
        out = self.run_ok(self.pdfs, self.pdfs, self.pdfs / "sotto", extra)
        self.assertIn("Totale: 6", out)

    def test_counts_unreadable_folders_and_ignored_profiles(self) -> None:
        out = self.run_ok(self.pdfs)
        self.assertNotIn("Cartelle non leggibili", out)
        self.assertNotIn("Profili ignorati", out)
        (self.profiles / "rotto-segreto.json").write_text("{ non json Zorbaldo", encoding="utf-8")
        out = self.run_ok(self.pdfs)
        self.assertIn("Profili ignorati: 1", out)
        self.assertNotIn("segreto", out)
        self.assertNotIn("Zorbaldo", out)
        locked = self.pdfs / "sotto" / "cartella-segreta"
        locked.chmod(0)
        self.addCleanup(locked.chmod, 0o755)
        if (locked.exists() and not any(True for _ in _listdir(locked))):
            out = self.run_ok(self.pdfs)
            self.assertIn("Cartelle non leggibili: 1", out)
            self.assertNotIn("segreta", out)

    def test_profile_id_shown_only_if_plain(self) -> None:
        import json

        path = self.profiles / "luce-esempio.json"
        record = json.loads(path.read_text(encoding="utf-8"))
        record["id"] = "Luce Esempio Zorbaldo"
        path.write_text(json.dumps(record), encoding="utf-8")
        out = self.run_ok(self.pdfs)
        self.assertNotIn("Zorbaldo", out)
        self.assertIn("(altro): 2", out)

    def test_writes_nothing(self) -> None:
        self.report()
        after = sorted(p.relative_to(self.root) for p in self.root.rglob("*"))
        self.assertEqual(self.before, after)


if __name__ == "__main__":
    unittest.main()
