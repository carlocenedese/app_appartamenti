"""Tests for bollette_pdf.profiles. Every text, amount and date here is invented."""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf.profiles import load_profiles, matching_profiles, normalize_ocr  # noqa: E402
from bollette_pdf.reader import Document, Line, Word, read_pdf  # noqa: E402

SEED_DIR = PYTHON_DIR / "seed-profiles"

FILLER = "Testo di riempimento della bolletta inventata, con abbastanza caratteri per la lettura."

BASE = {
    "id": "luce-2025",
    "v": 1,
    "rev": 1,
    "supplier": "Luce Inventata",
    "kind": "bill",
    "category": "elettricita",
    "status": "confermato",
    "autoRegister": False,
    "validFrom": "2025-01-01",
    "recognise": {"allOf": ["Luce Inventata", "Fattura"], "noneOf": ["Nota di credito"]},
    "fields": {
        "amount": {
            "required": True,
            "rules": [
                {
                    "anchor": "Totale da pagare",
                    "position": "same-line",
                    "pattern": "([0-9.]*[0-9],[0-9]{2})",
                    "valueType": "euro",
                    "group": 1,
                }
            ],
        }
    },
    "identifiers": [],
}


def profile(**changes):
    result = copy.deepcopy(BASE)
    result.update(changes)
    return result


class LoadProfilesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write(self, name: str, content: str | bytes) -> None:
        path = self.dir / name
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")

    def test_skips_broken_invalid_and_deleted_files_without_stopping(self) -> None:
        self.write("b-valido.json", json.dumps(profile(id="b")))
        self.write("a-valido.json", json.dumps(profile(id="a")))
        self.write("c-rotto.json", '{"id": "SEGRETO-ROTTO", ')
        self.write("d-non-valido.json", json.dumps(profile(id="d", category="SEGRETO-CATEGORIA")))
        self.write("e-cancellato.json", json.dumps(profile(id="e", deleted=True)))
        self.write("f-binario.json", b"\xff\xfe SEGRETO-BINARIO")
        self.write("g-lista.json", '["SEGRETO-LISTA"]')
        self.write("note.txt", "non è un profilo")
        profiles, warnings = load_profiles(self.dir)
        self.assertEqual([p["id"] for p in profiles], ["a", "b"])
        self.assertEqual(len(warnings), 4)
        for name, warning in zip(
            ["c-rotto.json", "d-non-valido.json", "f-binario.json", "g-lista.json"], warnings
        ):
            self.assertIn(name, warning)
            self.assertNotIn("SEGRETO", warning)
            self.assertNotIn("{", warning)

    def test_deleted_invalid_record_is_skipped_silently(self) -> None:
        self.write("x.json", json.dumps({"id": "x", "deleted": True}))
        self.assertEqual(load_profiles(self.dir), ([], []))

    def test_missing_directory_gives_a_warning(self) -> None:
        profiles, warnings = load_profiles(self.dir / "assente")
        self.assertEqual(profiles, [])
        self.assertEqual(len(warnings), 1)


class MatchingProfilesTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def doc(self, *texts: str):
        items = [(72, 100 + 20 * i, text) for i, text in enumerate(texts)]
        items.append((72, 400, FILLER))
        path = self.dir / "a.pdf"
        pdfmaker.make_pdf(path, [items])
        return read_pdf(path)

    def test_all_of_is_case_and_space_insensitive(self) -> None:
        doc = self.doc("LUCE INVENTATA SpA", "fattura numero 1")
        spaced = profile(recognise={"allOf": ["luce   inventata", "FATTURA"], "noneOf": []})
        self.assertEqual(matching_profiles(doc, [spaced]), [spaced])

    def test_all_of_must_all_be_present(self) -> None:
        doc = self.doc("Luce Inventata SpA")
        self.assertEqual(matching_profiles(doc, [profile()]), [])

    def test_none_of_excludes(self) -> None:
        doc = self.doc("Luce Inventata SpA", "Fattura", "NOTA DI CREDITO")
        self.assertEqual(matching_profiles(doc, [profile()]), [])

    def test_newest_valid_from_first_ties_by_id(self) -> None:
        doc = self.doc("Luce Inventata SpA", "Fattura")
        old = profile(id="z-old", validFrom="2020-01-01")
        new_b = profile(id="b-new", validFrom="2025-01-01")
        new_a = profile(id="a-new", validFrom="2025-01-01")
        other = profile(id="other", recognise={"allOf": ["Gas Inventato"], "noneOf": []})
        result = matching_profiles(doc, [old, new_b, other, new_a])
        self.assertEqual([p["id"] for p in result], ["a-new", "b-new", "z-old"])


def fake_doc(pages: dict[int, list[str]], text_source: str, ocr_pages: tuple[int, ...]) -> Document:
    """A document built from invented lines: {page: [line text, ...]}, no PDF involved."""
    lines = []
    for page, texts in pages.items():
        for i, text in enumerate(texts):
            word = Word(text=text, page=page, x0=0, top=i, x1=1, bottom=i + 1)
            lines.append(Line(page, text, (word,), 0, i, 1, i + 1, float(i)))
    return Document("h", "f", len(pages), tuple(lines), True, text_source, ocr_pages)


class OcrMatchingTest(unittest.TestCase):
    """Rule R89: the recognition of a scan compares normalised text (no accents, no punctuation)."""

    def test_scan_matches_across_accents_punctuation_and_line_breaks(self) -> None:
        doc = fake_doc({1: ["SOCIETA' EMITTENTE;", "Luce, Inventata  Spa"]}, "ocr", (1,))
        phrase = profile(recognise={"allOf": ["società emittente:", "luce inventata"], "noneOf": []})
        self.assertEqual(matching_profiles(doc, [phrase]), [phrase])

    def test_scan_matches_a_phrase_broken_over_two_lines(self) -> None:
        doc = fake_doc({1: ["Gestore della tassa", "sui rifiuti (TARI)"]}, "ocr", (1,))
        phrase = profile(recognise={"allOf": ["gestore della tassa sui rifiuti (tari)"], "noneOf": []})
        self.assertEqual(matching_profiles(doc, [phrase]), [phrase])

    def test_scan_none_of_is_normalised_too(self) -> None:
        doc = fake_doc({1: ["Luce Inventata", "Nota-di-credito"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile(recognise={
            "allOf": ["luce inventata"], "noneOf": ["nota di credito"]})]), [])

    def test_pdf_text_keeps_the_strict_comparison(self) -> None:
        # The same lines from a text PDF do not match: no accent folding, no punctuation folding.
        doc = fake_doc({1: ["SOCIETA' EMITTENTE;"]}, "pdf", ())
        phrase = profile(recognise={"allOf": ["società emittente:"], "noneOf": []})
        self.assertEqual(matching_profiles(doc, [phrase]), [])

    def test_mixed_document_folds_only_the_ocr_pages(self) -> None:
        both = profile(recognise={"allOf": ["società emittente:", "fattura n.1"], "noneOf": []})
        # OCR on page 2 gives the phrase of page 2; the PDF page 1 keeps its strict text.
        doc = fake_doc({1: ["Fattura n.1"], 2: ["Societa emittente"]}, "mixed", (2,))
        self.assertEqual(matching_profiles(doc, [both]), [both])
        # The phrase from the PDF page is not folded: "Fattura n 1" does not match "fattura n.1".
        strict = fake_doc({1: ["Fattura n 1"], 2: ["Societa emittente"]}, "mixed", (2,))
        self.assertEqual(matching_profiles(strict, [both]), [])

    def test_punctuation_only_condition_matches_nothing_in_a_scan(self) -> None:
        doc = fake_doc({1: ["Luce Inventata"]}, "ocr", (1,))
        weird = profile(recognise={"allOf": ["luce inventata", "***"], "noneOf": []})
        self.assertEqual(matching_profiles(doc, [weird]), [])

    def test_accents_are_not_folded_for_a_text_pdf_profile_on_another_supplier(self) -> None:
        doc = fake_doc({1: ["Gas Inventato Spa"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile()]), [])


class OcrAnyOfTest(unittest.TestCase):
    """Rule R90: `recognise.ocrAnyOf` is an alternative to `allOf` for scanned pages only."""

    ANCHOR = {"allOf": ["frase lunga che la scansione rovina"], "noneOf": ["nota di credito"],
              "ocrAnyOf": ["inventata"]}

    def test_scan_with_the_word_is_recognised_without_all_of(self) -> None:
        doc = fake_doc({1: ["Luce INVENTATA, Spa"]}, "ocr", (1,))
        anchored = profile(recognise=self.ANCHOR)
        self.assertEqual(matching_profiles(doc, [anchored]), [anchored])

    def test_scan_without_the_word_is_not_recognised(self) -> None:
        doc = fake_doc({1: ["Luce Diversa Spa"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile(recognise=self.ANCHOR)]), [])

    def test_word_is_matched_as_a_whole_word(self) -> None:
        doc = fake_doc({1: ["Luce Inventatissima"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile(recognise=self.ANCHOR)]), [])

    def test_none_of_still_excludes_a_scan(self) -> None:
        doc = fake_doc({1: ["Luce Inventata", "Nota di credito"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile(recognise=self.ANCHOR)]), [])

    def test_text_pdf_ignores_it_entirely(self) -> None:
        doc = fake_doc({1: ["Luce Inventata Spa"]}, "pdf", ())
        self.assertEqual(matching_profiles(doc, [profile(recognise=self.ANCHOR)]), [])

    def test_mixed_never_uses_it(self) -> None:
        anchored = profile(recognise=self.ANCHOR)
        on_pdf_page = fake_doc({1: ["Luce Inventata"], 2: ["altro"]}, "mixed", (2,))
        self.assertEqual(matching_profiles(on_pdf_page, [anchored]), [])
        on_ocr_page = fake_doc({1: ["altro"], 2: ["Luce Inventata"]}, "mixed", (2,))
        self.assertEqual(matching_profiles(on_ocr_page, [anchored]), [])

    def test_profile_without_it_is_unchanged(self) -> None:
        doc = fake_doc({1: ["Luce Inventata"]}, "ocr", (1,))
        self.assertEqual(matching_profiles(doc, [profile(recognise={
            "allOf": ["frase lunga"], "noneOf": []})]), [])

    def test_seed_profiles_have_one_supplier_word_never_shared_between_suppliers(self) -> None:
        profiles, warnings = load_profiles(SEED_DIR)
        self.assertEqual(warnings, [])
        owners: dict[str, set[str]] = {}
        for item in profiles:
            words = item["recognise"].get("ocrAnyOf", [])
            self.assertEqual(len(words), 1, item["id"])
            word = normalize_ocr(words[0])
            self.assertEqual(word, words[0], item["id"])
            owners.setdefault(word, set()).add(item["supplier"])
        self.assertTrue(all(len(suppliers) == 1 for suppliers in owners.values()), owners)
        self.assertFalse({"kwh", "smc", "idrico", "tari"} & set(owners), owners)

    def test_scan_of_another_supplier_with_a_service_word_matches_no_seed_profile(self) -> None:
        profiles, _ = load_profiles(SEED_DIR)
        doc = fake_doc({1: ["Consumi Energia", "1200 kWh", "10 Smc", "Consumo idrico", "TARI"]},
                       "ocr", (1,))
        self.assertEqual(matching_profiles(doc, profiles), [])

    def test_text_pdf_with_a_scanned_page_is_not_made_ambiguous(self) -> None:
        profiles, _ = load_profiles(SEED_DIR)
        doc = fake_doc({1: ["Enel Energia", "luce"], 2: ["Allegato", "HERA 120 kWh"]}, "mixed", (2,))
        self.assertEqual([p["id"] for p in matching_profiles(doc, profiles)], ["enel-luce-2020"])

    def test_scan_with_a_supplier_word_is_recognised_by_that_supplier_only(self) -> None:
        profiles, _ = load_profiles(SEED_DIR)
        doc = fake_doc({1: ["HERA Comm", "1200 kWh"]}, "ocr", (1,))
        self.assertEqual({p["supplier"] for p in matching_profiles(doc, profiles)}, {"Hera Comm"})


if __name__ == "__main__":
    unittest.main()
