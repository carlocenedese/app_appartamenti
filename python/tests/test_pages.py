"""Tests for the reading of a range of pages (`restrict`, `--pages`) and the «more documents»
warning. The documents are the anonymised fixtures of fixtures/pdf/, joined by `compose`."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf.__main__ import PAGES_ERROR, main  # noqa: E402
from bollette_pdf.extract import WARNING_MANY_DOCUMENTS, extract  # noqa: E402
from bollette_pdf.profiles import load_profiles  # noqa: E402
from bollette_pdf.reader import load_dump, restrict  # noqa: E402
from compose import compose, text_page  # noqa: E402
from test_extract import AT, FILLER, STANDARD, light_profile  # noqa: E402

FIXTURES = REPO / "fixtures" / "pdf"
PROFILES, _ = load_profiles(REPO / "python" / "seed-profiles")


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def run(*args: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(args), out, err)
    return code, out.getvalue(), err.getvalue()


class RestrictTest(unittest.TestCase):
    def setUp(self) -> None:
        self.hera, self.fast = fixture("hera-luce-01"), fixture("fastweb-01")
        self.first = self.hera["dump"]["pages"]  # last page of the first document
        self.dump = compose(self.hera, self.fast)
        self.doc = load_dump(self.dump)

    def test_keeps_only_the_lines_of_the_range(self) -> None:
        part = restrict(self.doc, self.first + 1, self.doc.pages)
        self.assertEqual(part.page_range, (self.first + 1, self.doc.pages))
        self.assertEqual(part.pages, self.doc.pages)
        self.assertTrue(part.lines)
        self.assertTrue(all(line.page > self.first for line in part.lines))

    def test_range_ends_are_included_and_neighbours_left_out(self) -> None:
        pages = {line.page for line in self.doc.lines}
        for first, last in ((1, 3), (3, 3), (3, 5)):
            kept = {line.page for line in restrict(self.doc, first, last).lines}
            self.assertEqual(kept, {p for p in pages if first <= p <= last}, (first, last))
        self.assertTrue({1, 3} <= pages)  # the fixture has lines on both ends and outside
        self.assertEqual({line.page for line in restrict(self.doc, 3, 3).lines}, {3})
        self.assertEqual({line.page for line in restrict(self.doc, 1, 1).lines}, {1})

    def test_range_outside_the_file_is_refused(self) -> None:
        for first, last in ((0, 1), (2, 1), (1, self.doc.pages + 1)):
            with self.assertRaises(ValueError):
                restrict(self.doc, first, last)

    def test_has_text_is_worked_out_again(self) -> None:
        self.assertTrue(self.doc.has_text)
        self.assertFalse(restrict(self.doc, 2, 2).has_text)  # a page of the first with no text

    def test_text_source_follows_the_pages_of_the_range(self) -> None:
        mixed = load_dump(compose(self.hera, fixture("acegas-acqua-ocr-01")))
        n = mixed.pages
        scan_first = self.first + 1
        self.assertEqual(mixed.text_source, "mixed")
        scan = restrict(mixed, scan_first, n)
        self.assertEqual((scan.text_source, scan.ocr_pages), ("ocr", (scan_first, scan_first + 2, n)))
        bill = restrict(mixed, 1, self.first)
        self.assertEqual((bill.text_source, bill.ocr_pages), ("pdf", ()))
        both = restrict(mixed, 1, n)
        self.assertEqual(both.text_source, "mixed")


class ExtractRangeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.hera, self.fast = fixture("hera-luce-01"), fixture("fastweb-01")
        self.first = self.hera["dump"]["pages"]
        self.doc = load_dump(compose(self.hera, self.fast))

    def read(self, first: int, last: int) -> dict:
        return extract(restrict(self.doc, first, last), PROFILES, AT)

    def test_each_document_of_the_file_is_read_alone(self) -> None:
        a = self.read(1, self.first)
        self.assertEqual(a["pageRange"], [1, self.first])
        self.assertEqual(a["status"], self.hera["expected"]["status"])
        self.assertEqual(a["fields"]["amount"]["value"], self.hera["expected"]["amount"])
        self.assertEqual(a["fields"]["number"]["value"], self.hera["expected"]["number"])
        self.assertNotIn(WARNING_MANY_DOCUMENTS, a["warnings"])
        b = self.read(self.first + 1, self.doc.pages)
        self.assertEqual(b["pageRange"], [self.first + 1, self.doc.pages])
        self.assertEqual(b["fields"]["amount"]["value"], self.fast["expected"]["amount"])
        self.assertEqual(b["fields"]["number"]["value"], self.fast["expected"]["number"])
        pages = {f["source"]["page"] for f in b["fields"].values() if f["source"]}
        self.assertTrue(pages and all(self.first < p <= self.doc.pages for p in pages))

    def test_whole_file_with_two_documents_warns_without_changing_the_value(self) -> None:
        one, two = fixture("acegas-tari-02"), fixture("acegas-tari-04")
        doc = load_dump(compose(one, two))
        whole = extract(doc, PROFILES, AT)
        self.assertIn(WARNING_MANY_DOCUMENTS, whole["warnings"])
        self.assertEqual(whole["fields"]["amount"]["confidence"], "medium")
        self.assertEqual(whole["fields"]["amount"]["value"], one["expected"]["amount"])
        alone = extract(restrict(doc, 1, one["dump"]["pages"]), PROFILES, AT)
        self.assertNotIn(WARNING_MANY_DOCUMENTS, alone["warnings"])
        # values written out: the warning changes neither the status nor a confidence
        self.assertEqual(whole["status"], "riconosciuta")
        self.assertEqual(whole["fields"]["number"]["confidence"], "high")
        self.assertEqual(whole["fields"]["supplier"]["confidence"], "high")

    def test_a_single_bill_never_warns(self) -> None:
        for path in sorted(FIXTURES.glob("*.json")):
            result = extract(load_dump(fixture(path.stem)["dump"]), PROFILES, AT)
            self.assertNotIn(WARNING_MANY_DOCUMENTS, result["warnings"], path.stem)

    def test_unrecognised_attachment_after_a_bill(self) -> None:
        dump = compose(self.hera)
        n = dump["pages"]
        dump["pages"] = n + 1
        dump["lines"].append(text_page(n + 1, "Allegato inventato " + "parole di prova " * 12))
        result = extract(restrict(load_dump(dump), n + 1, n + 1), PROFILES, AT)
        self.assertEqual((result["status"], result["documentKind"]), ("non-riconosciuta", "unknown"))

    def test_scan_page_in_a_mixed_file(self) -> None:
        dump = compose(self.hera, fixture("acegas-acqua-ocr-01"))
        doc = load_dump(dump)
        scan = extract(restrict(doc, self.first + 1, doc.pages), PROFILES, AT)
        self.assertEqual((scan["textSource"], scan["ocrPages"][0]), ("ocr", self.first + 1))
        bill = extract(restrict(doc, 1, self.first), PROFILES, AT)
        self.assertEqual((bill["textSource"], bill["ocrPages"]), ("pdf", []))

    def test_blank_pages(self) -> None:
        dump = compose(self.hera)
        n = dump["pages"]
        dump["pages"] = n + 2
        result = extract(restrict(load_dump(dump), n + 1, n + 2), PROFILES, AT)
        self.assertEqual((result["status"], result["documentKind"]), ("senza-testo", "unknown"))
        self.assertEqual(result["pageRange"], [n + 1, n + 2])


class CliPagesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        (root / "profiles").mkdir()
        (root / "profiles" / "luce.json").write_text(json.dumps(light_profile()), encoding="utf-8")
        self.pdf = root / "bolletta.pdf"
        pdfmaker.make_pdf(self.pdf, [STANDARD, [(50, 700, "Pagina due " + FILLER)]])
        self.args = ["extract", "--pdf", str(self.pdf), "--profiles", str(root / "profiles"), "--at", AT]
        self.root = root

    def test_bad_ranges_are_refused_before_reading(self) -> None:
        for bad in ("2-1", "0-1", "1", "1-2,3-4", "a-b", "-1-2", "١-٢"):
            code, out, err = run(*self.args, f"--pages={bad}")
            self.assertEqual((code, out, err), (2, "", PAGES_ERROR + "\n"), bad)

    def test_range_beyond_the_file_is_refused_after_reading(self) -> None:
        self.assertEqual(run(*self.args, "--pages", "1-9"), (2, "", PAGES_ERROR + "\n"))

    def test_range_is_read_and_repeatable(self) -> None:
        first = run(*self.args, "--pages", "1-1")
        self.assertEqual(first[0], 0)
        self.assertEqual(json.loads(first[1])["pageRange"], [1, 1])
        self.assertEqual(first, run(*self.args, "--pages", "1-1"))
        self.assertEqual(json.loads(run(*self.args)[1])["pageRange"], [1, 2])

    def test_unreadable_file_is_reported_with_a_range(self) -> None:
        self.pdf.write_bytes(b"not a pdf")
        code, out, _ = run(*self.args, "--pages", "1-1")
        result = json.loads(out)
        self.assertEqual((code, result["status"]), (0, "illeggibile"))
        self.assertEqual((result["pageRange"], result["pages"]), (None, 0))

    def test_huge_number_is_a_bad_range_not_an_internal_error(self) -> None:
        for bad in ("1-" + "9" * 5000, "9" * 5000 + "-1"):
            self.assertEqual(run(*self.args, f"--pages={bad}"), (2, "", PAGES_ERROR + "\n"))


if __name__ == "__main__":
    unittest.main()
