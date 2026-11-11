"""Tests for bollette_pdf.reader. Every text here is invented."""

from __future__ import annotations

import json
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf.reader import (  # noqa: E402
    MIN_TEXT_CHARS,
    PdfReadError,
    dump_document,
    load_dump,
    read_pdf,
)

LONG = "Il consumo fatturato nel periodo di riferimento e riportato nella tabella seguente"


class ReaderTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def pdf(self, pages, name="a.pdf") -> Path:
        path = self.dir / name
        pdfmaker.make_pdf(path, pages)
        return path

    def test_two_columns_are_separate_lines_with_coordinates(self) -> None:
        path = self.pdf([[(72, 100, "Totale da pagare"), (400, 100, "98,46 €"), (72, 130, "Scadenza")]])
        doc = read_pdf(path)
        self.assertEqual([line.text for line in doc.lines], ["Totale da pagare", "98,46 €", "Scadenza"])
        label, value, third = doc.lines
        self.assertEqual(label.page, 1)
        self.assertAlmostEqual(label.x0, 72, delta=1)
        self.assertAlmostEqual(value.x0, 400, delta=1)
        self.assertAlmostEqual(label.top, value.top, delta=1)
        self.assertLess(label.top, label.bottom)
        self.assertAlmostEqual(label.bottom, 100 + 2.1, delta=2.5)  # baseline plus descent
        self.assertAlmostEqual(third.top - label.top, 30, delta=1)
        self.assertEqual([w.text for w in label.words], ["Totale", "da", "pagare"])
        self.assertAlmostEqual(label.words[0].x0, 72, delta=1)
        self.assertGreater(label.words[1].x0, label.words[0].x1)
        self.assertEqual([w.text for w in value.words], ["98,46", "€"])
        self.assertTrue(doc.text.startswith("Totale da pagare\n98,46 €"))

    def test_long_line_is_not_split(self) -> None:
        doc = read_pdf(self.pdf([[(50, 200, LONG)]]))
        self.assertEqual([line.text for line in doc.lines], [LONG])

    def test_reading_order(self) -> None:
        doc = read_pdf(self.pdf([[(300, 300, "terzo"), (72, 100, "primo"), (72, 300, "secondo")]]))
        self.assertEqual([line.text for line in doc.lines], ["primo", "secondo", "terzo"])

    def test_pages_are_numbered_from_one(self) -> None:
        doc = read_pdf(self.pdf([[(72, 100, "uno")], [(72, 100, "due")]]))
        self.assertEqual(doc.pages, 2)
        self.assertEqual([(line.page, line.text) for line in doc.lines], [(1, "uno"), (2, "due")])

    def test_has_text(self) -> None:
        self.assertTrue(read_pdf(self.pdf([[(72, 100, LONG), (72, 120, LONG)]])).has_text)
        # 79 non-blank characters are below the limit, 80 are enough
        self.assertFalse(read_pdf(self.pdf([[(72, 100, "a" * 79)]])).has_text)
        self.assertTrue(read_pdf(self.pdf([[(72, 100, "a" * 80)]])).has_text)
        self.assertTrue(MIN_TEXT_CHARS == 80)
        self.assertFalse(read_pdf(self.pdf([[(72, 100, "venti caratteri xxxx")]])).has_text)
        blank = self.dir / "blank.pdf"
        pdfmaker.make_blank_pdf(blank)
        doc = read_pdf(blank)
        self.assertFalse(doc.has_text)
        self.assertEqual((doc.pages, doc.lines), (1, ()))

    def test_bad_files_raise_without_leaking_text(self) -> None:
        plain = self.dir / "plain.pdf"
        plain.write_text("SEGRETO-DA-NON-MOSTRARE testo semplice\n", encoding="utf-8")
        good = self.pdf([[(72, 100, "SEGRETO-DA-NON-MOSTRARE")]], "good.pdf")
        truncated = self.dir / "trunc.pdf"
        truncated.write_bytes(good.read_bytes()[:150])
        encrypted = self.dir / "enc.pdf"
        pdfmaker.make_encrypted_pdf(encrypted)
        empty = self.dir / "empty.pdf"
        empty.write_bytes(b"")
        for path in (plain, truncated, encrypted, empty):
            with self.subTest(path.name):
                with self.assertRaises(PdfReadError) as caught:
                    read_pdf(path)
                self.assertNotIn("SEGRETO", str(caught.exception))
                self.assertNotIn(path.name, str(caught.exception))
        with self.assertRaises(PdfReadError):
            read_pdf(self.dir / "missing.pdf")

    def test_round_trip_of_the_dump(self) -> None:
        doc = read_pdf(self.pdf([[(72, 100, "Totale da pagare"), (400, 100, "98,46 €")], [(72, 90, "due")]]))
        data = dump_document(doc)
        self.assertEqual(json.loads(json.dumps(data)), data)
        self.assertNotIn("a.pdf", json.dumps(data))
        for key in ("fileHash", "pages", "hasText", "lines"):
            self.assertIn(key, data)
        loaded = load_dump(json.loads(json.dumps(data)))
        self.assertEqual(loaded.file_name, "")
        self.assertEqual(loaded.file_hash, doc.file_hash)
        self.assertEqual(loaded.pages, doc.pages)
        self.assertEqual(loaded.has_text, doc.has_text)
        self.assertEqual(loaded.text, doc.text)
        self.assertEqual(len(loaded.lines), len(doc.lines))
        for a, b in zip(loaded.lines, doc.lines):
            self.assertEqual((a.page, a.text), (b.page, b.text))
            self.assertEqual(len(a.words), len(b.words))
            for u, v in zip(a.words, b.words):
                self.assertEqual(u.text, v.text)
                self.assertAlmostEqual(u.x0, v.x0, delta=0.006)
                self.assertAlmostEqual(u.bottom, v.bottom, delta=0.006)
        # Dumping again is stable: the dump holds values already rounded to two decimals.
        self.assertEqual(dump_document(loaded), data)
        self.assertEqual(load_dump(data), loaded)

    def test_bad_dumps_raise_value_error(self) -> None:
        good = dump_document(read_pdf(self.pdf([[(72, 100, "uno")]])))
        bad = [
            None,
            [],
            {},
            {**good, "pages": "2"},
            {**good, "hasText": 1},
            {**good, "fileHash": 5},
            {**good, "lines": None},
            {**good, "lines": [{"page": 1}]},
            {**good, "lines": [{**good["lines"][0], "words": [{"text": "x"}]}]},
        ]
        for data in bad:
            with self.subTest(data=data):
                with self.assertRaises(ValueError):
                    load_dump(data)  # type: ignore[arg-type]

    def test_accented_and_spaced_paths(self) -> None:
        nfc = self.dir / unicodedata.normalize("NFC", "bolletta è maggio.pdf")
        pdfmaker.make_pdf(nfc, [[(72, 100, "Città di Perù")]])
        nfd = self.dir / "sub"
        nfd.mkdir()
        nfd_path = nfd / unicodedata.normalize("NFD", "bolletta è maggio.pdf")
        nfd_path.write_bytes(nfc.read_bytes())
        a, b = read_pdf(nfc), read_pdf(nfd_path)
        self.assertEqual(a.file_hash, b.file_hash)
        self.assertEqual(a.lines, b.lines)
        self.assertEqual(a.file_name, b.file_name)
        self.assertEqual(a.file_name, unicodedata.normalize("NFC", "bolletta è maggio.pdf"))
        self.assertEqual(a.text, "Città di Perù")
        self.assertEqual(a.text, unicodedata.normalize("NFC", a.text))

    def test_same_file_twice(self) -> None:
        path = self.pdf([[(72, 100, "Totale"), (300, 100, "1,00")]])
        self.assertEqual(read_pdf(path), read_pdf(path))
        self.assertEqual(len(read_pdf(path).file_hash), 64)


if __name__ == "__main__":
    unittest.main()
