"""Tests for the OCR reader behind read_pdf. Every text and amount here is invented.

Most tests use a fake engine put in place of `ocr.ENGINE_FACTORY`. The tests of the real engine
(tesserocr and pypdfium2, macOS only) run when the folder of `ita.traineddata` is given with
BOLLETTE_OCR_TEST_DATA or found in apps/desktop/src-tauri/resources/ocr-data (scripts/ocr-data.mjs);
otherwise they are skipped, except with REQUIRE_OCR=1, where they fail.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf import ocr  # noqa: E402
from bollette_pdf.__main__ import main  # noqa: E402
from bollette_pdf import reader  # noqa: E402
from bollette_pdf.reader import (  # noqa: E402
    CID_GLYPH_LIMIT,
    MAX_OCR_PAGES,
    OCR_UNAVAILABLE_WARNING,
    Line,
    Word,
    _needs_ocr,
    dump_document,
    load_dump,
    read_pdf,
)

TOTAL = "Totale da pagare € 123,45"
FILLER = "Testo di riempimento della bolletta inventata, con abbastanza caratteri per la lettura."
DPI = ocr.OCR_DPI


def px(points: float) -> int:
    return round(points * DPI / 72)


class FakeEngine:
    """Gives, for every page asked, the line «Totale da pagare» at 72 pt and a filler line."""

    def __init__(self) -> None:
        self.calls: list[list[int]] = []
        self.empty: set[int] = set()  # pages on which the engine finds no word

    def read(self, data: bytes, pages: list[int], dpi: int) -> list[list[ocr.RawLine]]:
        self.calls.append(list(pages))
        out = []
        for number in pages:
            if number in self.empty:
                out.append([])
                continue
            out.append(
                [
                    (
                        px(100),
                        [
                            ("Totale", 96.5, px(72), px(90), px(110.4), px(100)),
                            ("da", 91.25, px(115.2), px(90), px(129.8), px(100)),
                            (f"p{number}", 88.0, px(135), px(92), px(177), px(103)),
                        ],
                    ),
                    (None, [(FILLER, 70.0, px(72), px(390), px(500), px(400))]),
                ]
            )
        return out


class FakeEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.engine = FakeEngine()
        self.factory_dirs: list[str] = []

        def factory(data_dir: str) -> FakeEngine:
            self.factory_dirs.append(data_dir)
            return self.engine

        patcher = mock.patch.object(ocr, "ENGINE_FACTORY", factory)
        patcher.start()
        self.addCleanup(patcher.stop)

    def pdf(self, pages, name="a.pdf") -> Path:
        path = self.dir / name
        pdfmaker.make_pdf(path, pages)
        return path

    def test_ocr_pages_converts_pixels_to_points_with_confidence(self) -> None:
        pages = ocr.ocr_pages(self.pdf([[]]).read_bytes(), [1], "dati")
        self.assertEqual(self.factory_dirs, ["dati"])
        self.assertEqual(len(pages), 1)
        first, filler = pages[0]
        self.assertEqual(first.text, "Totale da p1")
        self.assertEqual(first.page, 1)
        self.assertEqual(first.baseline, 100.08)
        totale = first.words[0]
        self.assertEqual((totale.x0, totale.top, totale.x1, totale.bottom), (72.0, 90.0, 110.4, 100.08))
        self.assertEqual(totale.confidence, 96.5)
        self.assertEqual((first.x0, first.top, first.x1, first.bottom), (72.0, 90.0, 177.12, 102.96))
        # Without a baseline from the engine, the bottom of the line stands in for it.
        self.assertEqual(filler.baseline, filler.bottom)

    def test_scanned_page_is_read_by_ocr(self) -> None:
        doc = read_pdf(self.pdf([[]]), ocr_data=self.dir)
        self.assertEqual(self.engine.calls, [[1]])
        self.assertEqual(self.factory_dirs, [str(self.dir)])
        self.assertEqual(doc.text_source, "ocr")
        self.assertTrue(doc.has_text)
        self.assertEqual(doc.lines[0].text, "Totale da p1")
        self.assertEqual(doc.warnings, ())

    def test_without_ocr_data_nothing_is_read(self) -> None:
        doc = read_pdf(self.pdf([[]]))
        self.assertEqual(self.engine.calls, [])
        self.assertEqual((doc.text_source, doc.lines, doc.has_text), ("pdf", (), False))
        self.assertEqual(doc.warnings, (OCR_UNAVAILABLE_WARNING,))

    def test_text_everywhere_has_no_ocr_warning(self) -> None:
        for ocr_data in (None, self.dir):
            doc = read_pdf(self.pdf([[(72, 100, TOTAL)]]), ocr_data=ocr_data)
            self.assertEqual(doc.warnings, ())

    def test_engine_missing_gives_the_warning(self) -> None:
        with mock.patch.object(ocr, "ENGINE_FACTORY", lambda data_dir: None):
            doc = read_pdf(self.pdf([[]]), ocr_data=self.dir)
        self.assertEqual((doc.text_source, doc.warnings), ("pdf", (OCR_UNAVAILABLE_WARNING,)))

    def test_factory_that_raises_gives_no_engine(self) -> None:
        for error in (OSError("libtesseract"), RuntimeError("init")):
            with mock.patch.object(ocr, "ENGINE_FACTORY", side_effect=error):
                doc = read_pdf(self.pdf([[]]), ocr_data=self.dir)
                self.assertEqual((doc.text_source, doc.lines), ("pdf", ()))
                self.assertEqual(doc.warnings, (OCR_UNAVAILABLE_WARNING,))
                out, err = io.StringIO(), io.StringIO()
                args = ["--pdf", str(self.pdf([[]])), "--profiles", str(self.dir), "--at", "2026-01-01"]
                code = main(["extract", *args, "--ocr-data", str(self.dir)], stdout=out, stderr=err)
                self.assertEqual((code, err.getvalue()), (0, ""))
                self.assertEqual(json.loads(out.getvalue())["status"], "senza-testo")

    def test_native_load_failure_of_the_real_factory(self) -> None:
        (self.dir / "ita.traineddata").write_bytes(b"finto")
        real_import = __import__

        def failing(name, *args, **kwargs):
            if name in ("tesserocr", "pypdfium2"):
                raise OSError("dlopen")
            return real_import(name, *args, **kwargs)

        with mock.patch.dict(sys.modules), mock.patch("builtins.__import__", failing):
            sys.modules.pop("tesserocr", None)
            sys.modules.pop("pypdfium2", None)
            self.assertIsNone(ocr._load_engine(str(self.dir)))

    def test_broken_page_without_ocr_words_keeps_its_pdf_text(self) -> None:
        self.engine.empty = {1}
        with mock.patch.object(reader, "_needs_ocr", return_value=True):
            doc = read_pdf(self.pdf([[(72, 100, TOTAL)]]), ocr_data=self.dir)
        self.assertEqual(self.engine.calls, [[1]])
        self.assertEqual((doc.text_source, doc.warnings), ("pdf", ()))
        self.assertEqual([line.text for line in doc.lines], [TOTAL])
        self.assertIsNone(doc.lines[0].words[0].confidence)

    def test_broken_page_with_ocr_words_is_replaced(self) -> None:
        with mock.patch.object(reader, "_needs_ocr", return_value=True):
            doc = read_pdf(self.pdf([[(72, 100, TOTAL)]]), ocr_data=self.dir)
        self.assertEqual(doc.text_source, "ocr")
        self.assertEqual(doc.lines[0].text, "Totale da p1")

    def test_text_pages_skip_ocr(self) -> None:
        doc = read_pdf(self.pdf([[(72, 100, TOTAL), (72, 400, FILLER)]]), ocr_data=self.dir)
        self.assertEqual(self.engine.calls, [])
        self.assertEqual(doc.text_source, "pdf")
        self.assertIsNone(doc.lines[0].words[0].confidence)

    def test_mixed_document_reads_only_the_scanned_page(self) -> None:
        doc = read_pdf(self.pdf([[(72, 100, TOTAL)], []]), ocr_data=self.dir)
        self.assertEqual(self.engine.calls, [[2]])
        self.assertEqual(doc.text_source, "mixed")
        self.assertEqual([line.page for line in doc.lines], [1, 2, 2])
        self.assertEqual(doc.lines[0].text, TOTAL)
        self.assertEqual(doc.lines[1].text, "Totale da p2")

    def test_at_most_twenty_pages_go_through_ocr(self) -> None:
        self.assertEqual(MAX_OCR_PAGES, 20)
        doc = read_pdf(self.pdf([[] for _ in range(25)]), ocr_data=self.dir)
        self.assertEqual(self.engine.calls, [list(range(1, 21))])
        self.assertEqual(doc.pages, 25)
        self.assertEqual(sorted({line.page for line in doc.lines}), list(range(1, 21)))
        self.assertEqual(doc.text_source, "ocr")
        self.assertEqual(len(doc.warnings), 1)
        self.assertIn("20", doc.warnings[0])
        self.assertNotIn("Totale", doc.warnings[0])

    def test_command_line_passes_the_data_folder(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        args = ["--pdf", str(self.pdf([[]])), "--profiles", str(self.dir), "--at", "2026-01-01"]
        code = main(["extract", *args, "--ocr-data", str(self.dir / "dati")], stdout=out, stderr=err)
        self.assertEqual((code, err.getvalue()), (0, ""))
        self.assertEqual(self.factory_dirs, [str(self.dir / "dati")])
        self.assertNotEqual(json.loads(out.getvalue())["status"], "senza-testo")

    def test_engine_failure_leaves_the_pages_without_text(self) -> None:
        def broken(data: bytes, pages: list[int], dpi: int) -> list:
            raise RuntimeError("Totale da pagare 123,45")

        self.engine.read = broken  # type: ignore[method-assign]
        doc = read_pdf(self.pdf([[]]), ocr_data=self.dir)
        self.assertEqual((doc.text_source, doc.lines, doc.has_text), ("pdf", (), False))
        self.assertEqual(doc.warnings, (OCR_UNAVAILABLE_WARNING,))

    def test_dump_keeps_confidence_and_text_source(self) -> None:
        doc = read_pdf(self.pdf([[(72, 100, TOTAL)], []]), ocr_data=self.dir)
        data = json.loads(json.dumps(dump_document(doc)))
        self.assertEqual(data["textSource"], "mixed")
        self.assertNotIn("confidence", data["lines"][0]["words"][0])
        self.assertEqual(data["lines"][1]["words"][0]["confidence"], 96.5)
        loaded = load_dump(data)
        self.assertEqual(loaded.lines, doc.lines)
        self.assertEqual((loaded.text_source, loaded.warnings), (doc.text_source, doc.warnings))
        self.assertEqual(dump_document(loaded), data)
        for bad in ({**data, "textSource": "scanner"}, {**data, "warnings": [1]}):
            with self.assertRaises(ValueError):
                load_dump(bad)


class MissingEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.scan = self.dir / "scansione.pdf"
        pdfmaker.make_pdf(self.scan, [[]])

    def test_engine_not_installed(self) -> None:
        (self.dir / "ita.traineddata").write_bytes(b"finto")
        with mock.patch.dict(sys.modules, {"tesserocr": None, "pypdfium2": None}):
            self.assertIsNone(ocr.ENGINE_FACTORY(str(self.dir)))
            doc = read_pdf(self.scan, ocr_data=self.dir)
        self.assertEqual((doc.text_source, doc.lines, doc.has_text), ("pdf", (), False))
        self.assertEqual(doc.warnings, (OCR_UNAVAILABLE_WARNING,))

    def test_language_data_missing(self) -> None:
        self.assertIsNone(ocr.ENGINE_FACTORY(str(self.dir / "manca")))
        doc = read_pdf(self.scan, ocr_data=self.dir / "manca")
        self.assertEqual((doc.text_source, doc.has_text), ("pdf", False))


def _line(text: str) -> Line:
    words = tuple(Word(part, 1, 0, 0, 1, 1) for part in text.split())
    return Line(1, text, words, 0, 0, 1, 1)


class NeedsOcrTest(unittest.TestCase):
    def test_threshold_of_broken_glyphs(self) -> None:
        self.assertEqual(CID_GLYPH_LIMIT, 0.3)
        self.assertTrue(_needs_ocr([]))
        self.assertFalse(_needs_ocr([_line("Totale da pagare")]))
        # 3 escapes out of 10 glyphs: 30%, not above the limit.
        self.assertFalse(_needs_ocr([_line("abcdefg(cid:1)(cid:22)(cid:333)")]))
        self.assertTrue(_needs_ocr([_line("abcdef(cid:1)(cid:22)(cid:333)")]))
        self.assertTrue(_needs_ocr([_line("(cid:12)(cid:13) (cid:14)")]))


@contextlib.contextmanager
def capture_fd2():
    """Captures what native code writes to file descriptor 2; yields a getter of the bytes."""
    captured: list[bytes] = []
    sys.stderr.flush()
    saved = os.dup(2)
    with tempfile.TemporaryFile() as sink:
        os.dup2(sink.fileno(), 2)
        try:
            yield lambda: b"".join(captured)
        finally:
            sys.stderr.flush()
            os.dup2(saved, 2)
            os.close(saved)
            sink.seek(0)
            captured.append(sink.read())


def _real_data() -> Path | None:
    given = os.environ.get("BOLLETTE_OCR_TEST_DATA")
    folder = Path(given) if given else PYTHON_DIR.parent / "apps/desktop/src-tauri/resources/ocr-data"
    return folder if (folder / "ita.traineddata").is_file() else None


REAL_DATA = _real_data()
REQUIRED = os.environ.get("REQUIRE_OCR") == "1"


@unittest.skipUnless(REAL_DATA or REQUIRED, "motore OCR o dati della lingua assenti")
class RealEngineTest(unittest.TestCase):
    TEXT_PAGE = [(72, 100, "Totale da pagare 123,45", 14), (300, 300, "Scadenza 31/03/2026", 12)]

    def setUp(self) -> None:
        if REAL_DATA is None or ocr.ENGINE_FACTORY(str(REAL_DATA)) is None:
            self.fail("REQUIRE_OCR=1 ma il motore OCR o ita.traineddata non sono disponibili")
        import make_scan

        self.make_scan = make_scan.make_scan_pdf
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def scan(self, pages, scanned=None, name="scansione.pdf", **layout) -> Path:
        path = self.dir / name
        self.make_scan(path, pages, scanned, **layout)
        return path

    def assertSameBoxes(self, got, expected) -> None:
        self.assertEqual([line.text for line in got.lines], [line.text for line in expected.lines])
        for a, b in zip(got.lines, expected.lines):
            self.assertAlmostEqual(a.baseline, b.baseline, delta=0.5)
            for u, v in zip(a.words, b.words):
                self.assertAlmostEqual(u.x0, v.x0, delta=1.5)
                self.assertAlmostEqual(u.x1, v.x1, delta=1.5)
                # OCR boxes hold the ink, the text boxes the whole height of the font: the first
                # lie inside the second (measured: up to 3.3 pt less at 14 pt).
                self.assertGreaterEqual(u.top, v.top - 1)
                self.assertLessEqual(u.bottom, v.bottom + 1)
                self.assertGreater(u.bottom - u.top, (v.bottom - v.top) / 2)

    def test_scanned_total_is_read_with_boxes(self) -> None:
        doc = read_pdf(self.scan([[(72, 100, TOTAL, 14), (72, 400, FILLER)]]), ocr_data=REAL_DATA)
        self.assertEqual(doc.text_source, "ocr")
        self.assertTrue(doc.has_text)
        self.assertEqual(doc.lines[0].text, TOTAL)
        for word in doc.lines[0].words:
            self.assertTrue(0 <= word.x0 < word.x1 <= pdfmaker.PAGE_WIDTH)
            self.assertTrue(0 <= word.top < word.bottom <= pdfmaker.PAGE_HEIGHT)
            self.assertTrue(0 <= word.confidence <= 100)
        self.assertAlmostEqual(doc.lines[0].words[0].x0, 72, delta=2)
        self.assertAlmostEqual(doc.lines[0].baseline, 100, delta=1.5)

    def test_coordinates_match_those_of_the_text_page(self) -> None:
        text = self.dir / "testo.pdf"
        pdfmaker.make_pdf(text, [self.TEXT_PAGE])
        expected = read_pdf(text)
        got = read_pdf(self.scan([self.TEXT_PAGE]), ocr_data=REAL_DATA)
        self.assertSameBoxes(got, expected)

    def test_coordinates_of_a_rotated_page_with_offset_media_box(self) -> None:
        import make_scan

        layout = {"rotated": True, "offset": (-30.0, 45.5)}
        text = self.dir / "testo.pdf"
        make_scan.make_text_pdf(text, [self.TEXT_PAGE], **layout)
        expected = read_pdf(text)
        self.assertAlmostEqual(expected.lines[0].words[0].x0, 72, delta=1)
        self.assertAlmostEqual(expected.lines[0].baseline, 100, delta=0.5)
        got = read_pdf(self.scan([self.TEXT_PAGE], **layout), ocr_data=REAL_DATA)
        self.assertEqual(got.text_source, "ocr")
        self.assertSameBoxes(got, expected)

    def test_command_line_creates_no_socket(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        args = ["--pdf", str(self.scan([[(72, 100, TOTAL, 14), (72, 400, FILLER)]])), "--profiles", str(self.dir), "--at", "2026-01-01"]
        with mock.patch.object(socket, "socket", side_effect=AssertionError("rete")):
            code = main(["extract", *args, "--ocr-data", str(REAL_DATA)], stdout=out, stderr=err)
        self.assertEqual((code, err.getvalue()), (0, ""))
        self.assertIn(json.loads(out.getvalue())["status"], ("riconosciuta", "non-riconosciuta", "da-confermare"))

    def test_mixed_document(self) -> None:
        path = self.scan([[(72, 100, "Pagina di testo")], self.TEXT_PAGE], scanned={2})
        doc = read_pdf(path, ocr_data=REAL_DATA)
        self.assertEqual(doc.text_source, "mixed")
        self.assertEqual(doc.lines[0].text, "Pagina di testo")
        self.assertIsNone(doc.lines[0].words[0].confidence)
        self.assertEqual([line.text for line in doc.lines[1:]], ["Totale da pagare 123,45", "Scadenza 31/03/2026"])
        self.assertIsNotNone(doc.lines[1].words[0].confidence)

    def test_same_page_twice_gives_the_same_result(self) -> None:
        path = self.scan([self.TEXT_PAGE, [(72, 500, FILLER)]])
        self.assertEqual(read_pdf(path, ocr_data=REAL_DATA), read_pdf(path, ocr_data=REAL_DATA))

    def test_blank_scan_gives_no_text(self) -> None:
        doc = read_pdf(self.scan([[], []]), ocr_data=REAL_DATA)
        self.assertEqual((doc.text_source, doc.lines, doc.has_text), ("ocr", (), False))

    def test_broken_language_data_gives_no_text(self) -> None:
        broken = self.dir / "dati"
        broken.mkdir()
        (broken / "ita.traineddata").write_bytes(b"non sono dati")
        scan = self.scan([self.TEXT_PAGE])
        with capture_fd2() as written:
            doc = read_pdf(scan, ocr_data=broken)
        self.assertEqual((doc.text_source, doc.lines), ("pdf", ()))
        self.assertEqual(doc.warnings, (OCR_UNAVAILABLE_WARNING,))
        self.assertEqual(written(), b"")

    def test_reading_writes_nothing_to_stderr(self) -> None:
        scan = self.scan([self.TEXT_PAGE, []])
        with capture_fd2() as written:
            read_pdf(scan, ocr_data=REAL_DATA)
        self.assertEqual(written(), b"")


if __name__ == "__main__":
    unittest.main()
