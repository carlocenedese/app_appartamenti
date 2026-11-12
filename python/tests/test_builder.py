"""Tests for bollette_pdf.builder and the `build-profile` command.

Every PDF is built with pdfmaker; every supplier, text, amount and date here is invented. The
selection boxes are computed from the read document, as the screen of plan 4 will compute them
from the rendered page, with a small margin around the words.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf.builder import Selection, build_profile, selected_value, shape_pattern  # noqa: E402
from bollette_pdf.extract import extract  # noqa: E402
from bollette_pdf.reader import read_pdf  # noqa: E402
from bollette_pdf.schemas import check_profile_rules, validate  # noqa: E402
from test_cli import run_cli  # noqa: E402

FILLER = "Testo di riempimento della bolletta inventata, con abbastanza caratteri per la lettura."
AT = "2026-11-11T09:30:00Z"
SPEC_MESSAGE = "Specifica non valida: nessun profilo costruito.\n"
SELECTION_MESSAGE = "Selezione non valida: nessun profilo costruito.\n"


def bill(number: str, amount: str, due: str, period: str) -> list[tuple]:
    return [
        (72, 60, "Acqua Inventata S.p.A.", 14),
        (72, 100, f"Fattura n. {number}"),
        (72, 120, f"Totale da pagare: {amount} €"),
        (72, 140, f"Scadenza: {due}"),
        (72, 160, f"Periodo: dal {period}"),
        (72, 400, FILLER),
        (72, 415, FILLER),
    ]


FIRST = bill("AI-2026-0042", "98,46", "10/11/2026", "01/09/2026 al 31/10/2026")
SECOND = bill("AI-2026-0107", "1.234,50", "05/12/2026", "01/10/2026 al 30/11/2026")
# The filler is the same in every test PDF and is not checked against messages.
TEXTS = [item[2] for item in FIRST if item[2] != FILLER]


def box_around(doc, text: str, page: int = 1, occurrence: int = 0) -> tuple:
    """The box of the consecutive words reading `text`, with a 1-point margin."""
    tokens = text.split(" ")
    found = []
    for line in doc.lines:
        if line.page != page:
            continue
        words = [w.text for w in line.words]
        for start in range(len(words) - len(tokens) + 1):
            if words[start : start + len(tokens)] == tokens:
                found.append(line.words[start : start + len(tokens)])
    chosen = found[occurrence]
    return (
        min(w.x0 for w in chosen) - 1,
        min(w.top for w in chosen) - 1,
        max(w.x1 for w in chosen) + 1,
        max(w.bottom for w in chosen) + 1,
    )


def select(doc, text: str, page: int = 1, occurrence: int = 0) -> Selection:
    return Selection(page, box_around(doc, text, page, occurrence))


class BuilderTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self._count = 0

    def doc(self, *pages):
        self._count += 1
        path = self.dir / f"d{self._count}.pdf"
        pdfmaker.make_pdf(path, [list(page) for page in pages])
        return read_pdf(path)

    def build(self, doc, fields, recognise=None, **changes):
        arguments = {
            "profile_id": "acqua-2026",
            "supplier": "Acqua Inventata",
            "kind": "bill",
            "category": "acqua",
            "valid_from": "2026-01-01",
            "recognise": [select(doc, "Acqua Inventata")] if recognise is None else recognise,
            "fields": fields,
            "now": AT,
        }
        arguments.update(changes)
        return build_profile(doc, **arguments)

    def assertNoDocumentText(self, message: str, texts) -> None:
        for text in texts:
            for word in text.split(" "):
                if len(word) > 3:
                    self.assertNotIn(word, message)


class BuildTest(BuilderTestCase):
    def standard_fields(self, doc):
        return {
            "number": select(doc, "AI-2026-0042"),
            "amount": select(doc, "98,46 €"),
            "dueDate": select(doc, "10/11/2026"),
            "period": select(doc, "dal 01/09/2026 al 31/10/2026"),
        }

    def test_profile_is_valid_and_reads_back_with_high(self) -> None:
        doc = self.doc(FIRST)
        profile = self.build(doc, self.standard_fields(doc))
        self.assertEqual(validate("supplierProfile", profile), [])
        self.assertEqual(profile["id"], "acqua-2026")
        self.assertEqual((profile["v"], profile["rev"]), (1, 1))
        self.assertEqual((profile["status"], profile["autoRegister"]), ("bozza", True))
        self.assertEqual((profile["kind"], profile["category"]), ("bill", "acqua"))
        self.assertEqual(profile["validFrom"], "2026-01-01")
        self.assertEqual(profile["recognise"], {"allOf": ["acqua inventata"], "noneOf": []})
        self.assertEqual(profile["identifiers"], [])
        self.assertEqual(
            {name: spec["required"] for name, spec in profile["fields"].items()},
            {"number": False, "dueDate": False, "period": False, "amount": True},
        )
        self.assertEqual(profile["fields"]["amount"]["rules"][0]["valueType"], "euro")
        self.assertEqual(profile["fields"]["amount"]["rules"][0]["position"], "same-line")
        self.assertEqual(profile["fields"]["dueDate"]["rules"][0]["anchor"], "Scadenza:")

        result = extract(doc, [profile], AT)
        self.assertNotEqual(result["status"], "non-riconosciuta")
        fields = result["fields"]
        expected = {
            "number": "AI-2026-0042",
            "amount": 9846,
            "dueDate": "2026-11-10",
            "periodStart": "2026-09-01",
            "periodEnd": "2026-10-31",
        }
        for key, value in expected.items():
            self.assertEqual(fields[key]["value"], value, key)
            self.assertEqual(fields[key]["confidence"], "high", key)

    def test_profile_generalises_to_another_bill_with_the_same_layout(self) -> None:
        doc = self.doc(FIRST)
        profile = self.build(doc, self.standard_fields(doc))
        other = self.doc(SECOND)
        fields = extract(other, [profile], AT)["fields"]
        expected = {
            "number": "AI-2026-0107",
            "amount": 123450,
            "dueDate": "2026-12-05",
            "periodStart": "2026-10-01",
            "periodEnd": "2026-11-30",
        }
        for key, value in expected.items():
            self.assertEqual(fields[key]["value"], value, key)
            self.assertEqual(fields[key]["confidence"], "high", key)

    def test_same_inputs_give_the_same_profile(self) -> None:
        doc = self.doc(FIRST)
        first = self.build(doc, self.standard_fields(doc))
        second = self.build(doc, self.standard_fields(doc))
        self.assertEqual(json.dumps(first), json.dumps(second))

    def test_tari_profile_has_no_category(self) -> None:
        doc = self.doc(FIRST)
        profile = self.build(
            doc, {"amount": select(doc, "98,46")}, kind="tari", category=None
        )
        self.assertNotIn("category", profile)
        self.assertEqual(validate("supplierProfile", profile), [])

    def test_recognise_texts_are_lower_case_deduplicated_in_order(self) -> None:
        doc = self.doc(FIRST)
        profile = self.build(
            doc,
            {"amount": select(doc, "98,46 €")},
            recognise=[
                select(doc, "Acqua Inventata S.p.A."),
                select(doc, "Fattura"),
                select(doc, "Acqua Inventata S.p.A."),
            ],
        )
        self.assertEqual(profile["recognise"]["allOf"], ["acqua inventata s.p.a.", "fattura"])

    def test_short_or_noise_anchors_grow(self) -> None:
        # «n.» has one letter and «EUR» is cell noise: neither is a stable label (R73).
        doc = self.doc(
            [
                (72, 60, "Acqua Inventata S.p.A.", 14),
                (72, 100, "Fattura n. AI-2026-0042"),
                (72, 120, "Totale EUR 98,46"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"number": select(doc, "AI-2026-0042"), "amount": select(doc, "98,46")}
        )
        anchors = {name: spec["rules"][0]["anchor"] for name, spec in profile["fields"].items()}
        self.assertEqual(anchors, {"number": "Fattura n.", "amount": "Totale EUR"})
        result = extract(doc, [profile], AT)
        self.assertEqual(result["fields"]["number"]["confidence"], "high")
        self.assertEqual(result["fields"]["amount"]["confidence"], "high")

    def test_right_far_column(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 120, "Importo totale"),
                (420, 120, "98,46 €"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"amount": select(doc, "98,46 €")}, recognise=[select(doc, "Gas Inventato")]
        )
        rule = profile["fields"]["amount"]["rules"][0]
        self.assertEqual((rule["anchor"], rule["position"]), ("totale", "right"))
        field = extract(doc, [profile], AT)["fields"]["amount"]
        self.assertEqual((field["value"], field["confidence"]), (9846, "high"))

    def test_below(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 120, "Data di scadenza"),
                (72, 134, "10/11/2026"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"dueDate": select(doc, "10/11/2026")}, recognise=[select(doc, "Gas Inventato")]
        )
        rule = profile["fields"]["dueDate"]["rules"][0]
        self.assertEqual(rule["position"], "below")
        self.assertIn(rule["anchor"], ("Data", "Data di", "Data di scadenza"))
        field = extract(doc, [profile], AT)["fields"]["dueDate"]
        self.assertEqual((field["value"], field["confidence"]), ("2026-11-10", "high"))

    def test_number_followed_by_more_text_on_the_line(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 100, "Fattura n. GX-77 del 01/10/2026"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"number": select(doc, "GX-77")}, recognise=[select(doc, "Gas Inventato")]
        )
        field = extract(doc, [profile], AT)["fields"]["number"]
        self.assertEqual((field["value"], field["confidence"]), ("GX-77", "high"))

    def test_consumption_quantity(self) -> None:
        doc = self.doc(
            [(72, 60, "Gas Inventato"), (72, 100, "Consumo fatturato 1.234 Smc"), (72, 400, FILLER)]
        )
        profile = self.build(
            doc,
            {"consumption": select(doc, "1.234 Smc")},
            recognise=[select(doc, "Gas Inventato")],
        )
        field = extract(doc, [profile], AT)["fields"]["consumption"]
        self.assertEqual(field["value"], {"quantity": "1234", "unit": "Smc"})
        self.assertEqual(field["confidence"], "high")

    def test_repeated_anchor_uses_a_longer_left_context(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 100, "Quota fissa Importo: 12,00 €"),
                (72, 120, "Totale Importo: 98,46 €"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"amount": select(doc, "98,46 €")}, recognise=[select(doc, "Gas Inventato")]
        )
        self.assertEqual(profile["fields"]["amount"]["rules"][0]["anchor"], "Totale Importo:")
        field = extract(doc, [profile], AT)["fields"]["amount"]
        self.assertEqual((field["value"], field["confidence"]), (9846, "high"))

    def test_repeated_anchor_with_the_same_context_is_rejected(self) -> None:
        texts = ["Gas Inventato", "Totale da pagare: 12,00 €", "Totale da pagare: 98,46 €"]
        doc = self.doc(
            [(72, 60, texts[0]), (72, 100, texts[1]), (72, 120, texts[2]), (72, 400, FILLER)]
        )
        for occurrence in (0, 1):
            amount = "12,00 €" if occurrence == 0 else "98,46 €"
            with self.assertRaises(ValueError) as caught:
                self.build(
                    doc, {"amount": select(doc, amount)}, recognise=[select(doc, "Gas Inventato")]
                )
            self.assertIn("amount", str(caught.exception))
            self.assertNoDocumentText(str(caught.exception), texts)


class RejectionTest(BuilderTestCase):
    def assertRejected(self, doc, texts, **arguments) -> str:
        with self.assertRaises(ValueError) as caught:
            self.build(doc, **arguments)
        message = str(caught.exception)
        self.assertNoDocumentText(message, texts)
        return message

    def test_empty_field_selection(self) -> None:
        doc = self.doc(FIRST)
        self.assertRejected(doc, TEXTS, fields={"amount": Selection(1, (300, 700, 400, 750))})

    def test_empty_recognise_selection(self) -> None:
        doc = self.doc(FIRST)
        self.assertRejected(
            doc,
            TEXTS,
            fields={"amount": select(doc, "98,46 €")},
            recognise=[Selection(1, (300, 700, 400, 750))],
        )

    def test_short_recognise_text(self) -> None:
        doc = self.doc(FIRST)
        self.assertRejected(
            doc, TEXTS, fields={"amount": select(doc, "98,46 €")}, recognise=[select(doc, "n.")]
        )

    def test_non_date_for_a_date_field(self) -> None:
        doc = self.doc(FIRST)
        message = self.assertRejected(doc, TEXTS, fields={"dueDate": select(doc, "AI-2026-0042")})
        self.assertIn("dueDate", message)

    def test_non_amount_for_the_amount_field(self) -> None:
        doc = self.doc(FIRST)
        self.assertRejected(doc, TEXTS, fields={"amount": select(doc, "10/11/2026")})

    def test_another_line_between_anchor_and_value(self) -> None:
        # «nota» stands below the label, so a `below` rule from the label reads it, not the date.
        texts = ["Gas Inventato", "Scadenza", "nota", "10/11/2026"]
        doc = self.doc(
            [
                (72, 60, texts[0]),
                (72, 120, texts[1], 14),
                (72, 134, texts[2]),
                (115, 148, texts[3]),
                (72, 400, FILLER),
            ]
        )
        message = self.assertRejected(
            doc,
            texts,
            fields={"dueDate": select(doc, "10/11/2026")},
            recognise=[select(doc, "Gas Inventato")],
        )
        self.assertIn("dueDate", message)

    def test_unknown_field_page_and_bad_now(self) -> None:
        doc = self.doc(FIRST)
        self.assertRejected(doc, TEXTS, fields={"total": select(doc, "98,46 €")})
        self.assertRejected(doc, TEXTS, fields={"amount": Selection(2, (0, 0, 100, 100))})
        self.assertRejected(doc, TEXTS, fields={"amount": select(doc, "98,46 €")}, now="ieri")
        self.assertRejected(
            doc, TEXTS, fields={"amount": Selection(1, (0, 0, float("nan"), 100))}
        )

    def test_invalid_profile_values(self) -> None:
        doc = self.doc(FIRST)
        amount = {"amount": select(doc, "98,46 €")}
        self.assertRejected(doc, TEXTS, fields=amount, kind="bill", category=None)
        self.assertRejected(doc, TEXTS, fields=amount, kind="tari", category="acqua")
        self.assertRejected(doc, TEXTS, fields=amount, valid_from="2026-02-30")
        self.assertRejected(doc, TEXTS, fields=amount, profile_id="")
        self.assertRejected(doc, TEXTS, fields=amount, recognise=[])

    def test_document_without_text(self) -> None:
        doc = self.doc([(72, 60, "Acqua Inventata")])
        self.assertRejected(
            doc,
            ["Acqua Inventata"],
            fields={"amount": Selection(1, (0, 0, 500, 500))},
        )


class SafetyTest(BuilderTestCase):
    """Rulings R61 and R62: a profile never reads a wrong value with `high`."""

    def amount_profile(self, amount_line: str):
        doc = self.doc(
            [(72, 60, "Gas Inventato"), (72, 120, amount_line), (72, 400, FILLER), (72, 415, FILLER)]
        )
        amount = amount_line.split(": ", 1)[1]
        return self.build(
            doc, {"amount": select(doc, amount)}, recognise=[select(doc, "Gas Inventato")]
        )

    def read(self, profile, *items):
        doc = self.doc([(72, 60, "Gas Inventato"), *items, (72, 400, FILLER), (72, 415, FILLER)])
        return extract(doc, [profile], AT)["fields"]

    def test_space_as_thousands_separator_is_missing(self) -> None:
        profile = self.amount_profile("Totale da pagare: 98,46 €")
        field = self.read(profile, (72, 120, "Totale da pagare: 1 234,56 €"))["amount"]
        self.assertEqual((field["value"], field["confidence"]), (None, "missing"))
        same = self.read(profile, (72, 120, "Totale da pagare: 1.234,56 €"))["amount"]
        self.assertEqual((same["value"], same["confidence"]), (123456, "high"))

    def test_decimal_point_shape_does_not_read_a_comma_thousands_amount(self) -> None:
        profile = self.amount_profile("Totale da pagare: 98.46 €")
        field = self.read(profile, (72, 120, "Totale da pagare: 1,234.56 €"))["amount"]
        self.assertEqual((field["value"], field["confidence"]), (None, "missing"))

    def test_same_line_number_reads_only_the_selected_words(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 100, "Fattura n. AI-0042"),
                (300, 100, "Pagina 1 di 2"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc, {"number": select(doc, "AI-0042")}, recognise=[select(doc, "Gas Inventato")]
        )
        self.assertEqual(profile["fields"]["number"]["rules"][0]["pattern"], r"^[\s:€]*(\S+)")
        field = self.read(profile, (72, 100, "Fattura n. AI-2026-000107 Pagina 1 di 2"))["number"]
        self.assertEqual((field["value"], field["confidence"]), ("AI-2026-000107", "high"))

    def test_upper_case_period(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 100, "Periodo: DAL 01/09/2026 AL 31/10/2026"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc,
            {"period": select(doc, "DAL 01/09/2026 AL 31/10/2026")},
            recognise=[select(doc, "Gas Inventato")],
        )
        fields = self.read(profile, (72, 100, "Periodo: dal 01/10/2026 al 30/11/2026"))
        self.assertEqual(fields["periodStart"]["value"], "2026-10-01")
        self.assertEqual(fields["periodEnd"]["confidence"], "high")

    def test_month_range_selection_reads_back_with_high(self) -> None:
        doc = self.doc(
            [
                (72, 60, "Gas Inventato"),
                (72, 100, "Competenza: OTT. 2021 - NOV. 2021 - spesa per l'ENERGIA ELETTRICA"),
                (72, 400, FILLER),
            ]
        )
        profile = self.build(
            doc,
            {"period": select(doc, "OTT. 2021 - NOV. 2021")},
            recognise=[select(doc, "Gas Inventato")],
        )
        fields = self.read(
            profile, (72, 100, "Competenza: DIC. 2024 - GEN. 2025 - spesa per l'ENERGIA ELETTRICA")
        )
        self.assertEqual(fields["periodStart"]["value"], "2024-12-01")
        self.assertEqual(fields["periodEnd"]["value"], "2025-01-31")
        self.assertEqual(fields["periodEnd"]["confidence"], "high")

    def assertNoStableAnchor(self, items, value: str) -> None:
        texts = ["Gas Inventato", *(item[2] for item in items)]
        doc = self.doc([(72, 60, texts[0]), *items, (72, 400, FILLER)])
        with self.assertRaises(ValueError) as caught:
            self.build(
                doc, {"amount": select(doc, value)}, recognise=[select(doc, "Gas Inventato")]
            )
        message = str(caught.exception)
        self.assertIn("amount", message)
        self.assertNoDocumentText(message, texts)
        for word in ("05/11/2026", "87,10", "120,00", "98,46"):
            self.assertNotIn(word, message)

    def test_date_in_the_label_is_never_an_anchor(self) -> None:
        self.assertNoStableAnchor([(72, 120, "Totale bolletta del 05/11/2026: 98,46 €")], "98,46 €")

    def test_value_column_of_a_table_row_is_never_an_anchor(self) -> None:
        self.assertNoStableAnchor(
            [(72, 120, "Totale"), (300, 120, "87,10"), (420, 120, "120,00")], "120,00"
        )

    def test_no_label_at_all(self) -> None:
        self.assertNoStableAnchor([(400, 120, "98,46 €")], "98,46 €")
        self.assertNoStableAnchor([(400, 106, "2026"), (400, 120, "98,46 €")], "98,46 €")


class ShapePatternTest(unittest.TestCase):
    def assertReads(self, pattern: str, text: str, expected: str | None) -> None:
        match = re.search(pattern, text)
        if expected is None:
            self.assertIsNone(match, (pattern, text))
            return
        self.assertIsNotNone(match, (pattern, text))
        self.assertEqual(match.group(1), expected)

    def assertAllowed(self, pattern: str, value_type: str, field: str) -> None:
        rule = {"anchor": "x", "position": "same-line", "pattern": pattern, "valueType": value_type}
        profile = {"kind": "tari", "fields": {field: {"required": False, "rules": [rule]}}}
        self.assertEqual(check_profile_rules(profile), [])

    def test_euro(self) -> None:
        pattern = shape_pattern("98,46", "euro")
        self.assertAllowed(pattern, "euro", "amount")
        self.assertReads(pattern, "98,46 €", "98,46")
        self.assertReads(pattern, ": € 1.234,50", "1.234,50")
        self.assertReads(pattern, "-12,00", "-12,00")
        self.assertReads(pattern, "98 euro", None)
        self.assertReads(pattern, "1 234,56 €", None)
        self.assertReads(pattern, "98,467", None)
        self.assertReads(pattern, "Totale 98,46", None)
        self.assertEqual(shape_pattern("1.234,50 €", "euro"), pattern)
        self.assertEqual(shape_pattern("98,46", "euro", "same-line"), pattern)

    def test_euro_with_a_decimal_point(self) -> None:
        pattern = shape_pattern("98.46", "euro")
        self.assertReads(pattern, "12.30 €", "12.30")
        self.assertReads(pattern, "1,234.56", None)

    def test_date(self) -> None:
        pattern = shape_pattern("10/11/2026", "date")
        self.assertEqual(pattern, r"^[\s:€]*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})(?![\d.,])")
        self.assertAllowed(pattern, "date", "dueDate")
        self.assertReads(pattern, "5.12.26 entro", "5.12.26")
        self.assertReads(pattern, "entro il 5.12.26", None)

    def test_textual_date(self) -> None:
        pattern = shape_pattern("10 novembre 2026", "date")
        self.assertAllowed(pattern, "date", "dueDate")
        self.assertReads(pattern, "5 dicembre 2026", "5 dicembre 2026")

    def test_date_range(self) -> None:
        pattern = shape_pattern("dal 01/09/2026 al 31/10/2026", "date-range")
        self.assertAllowed(pattern, "date-range", "period")
        self.assertReads(pattern, "dal 1/10/2026 al 30/11/2026", "dal 1/10/2026 al 30/11/2026")
        self.assertReads(pattern, "DAL 1/10/2026 AL 30/11/2026", "DAL 1/10/2026 AL 30/11/2026")
        self.assertReads(pattern, "1/10/2026 al 30/11/2026", "1/10/2026 al 30/11/2026")
        upper = shape_pattern("DAL 01/09/2026 AL 31/10/2026", "date-range")
        self.assertEqual(upper, pattern)
        dash = shape_pattern("01/09/2026 - 31/10/2026", "date-range")
        self.assertAllowed(dash, "date-range", "period")
        self.assertReads(dash, "01/10/2026 - 30/11/2026", "01/10/2026 - 30/11/2026")
        self.assertReads(dash, "01/10/2026 al 30/11/2026", None)

    def test_month_range(self) -> None:
        pattern = shape_pattern("Gennaio - Aprile 2024", "date-range")
        self.assertAllowed(pattern, "date-range", "period")
        self.assertNotIn("(?<", pattern)
        self.assertEqual(pattern.count("(") - pattern.count("(?"), 1)
        self.assertReads(pattern, "OTTOBRE - DICEMBRE 2023", "OTTOBRE - DICEMBRE 2023")
        self.assertReads(pattern, "OTT. 2021 - NOV. 2021", "OTT. 2021 - NOV. 2021")
        self.assertReads(
            pattern, "FEB. 2025 - MAR. 2025 - spesa per l'ENERGIA", "FEB. 2025 - MAR. 2025"
        )
        self.assertReads(pattern, "Periodo FEB. 2025 - MAR. 2025", None)
        self.assertEqual(shape_pattern("OTT. 2021 - NOV. 2021", "date-range"), pattern)

    def test_quantity(self) -> None:
        pattern = shape_pattern("1.234 Smc", "quantity")
        self.assertAllowed(pattern, "quantity", "consumption")
        self.assertReads(pattern, "87,5 kWh", "87,5 kWh")
        self.assertReads(pattern, "12 m³", "12 m³")

    def test_text(self) -> None:
        whole = shape_pattern("AI-2026-0042", "text")
        self.assertEqual(whole, r"^[\s:€]*(\S+(?: \S+)*)")
        self.assertAllowed(whole, "text", "number")
        one = shape_pattern("AI-2026-0042", "text", "same-line")
        self.assertEqual(one, r"^[\s:€]*(\S+)")
        two = shape_pattern("AI 0042", "text", "same-line")
        self.assertAllowed(two, "text", "number")
        self.assertReads(two, "AB 0107 Pagina 1 di 2", "AB 0107")

    def test_unreadable_text_raises_without_quoting_it(self) -> None:
        for text, value_type in (
            ("98", "euro"),
            ("Mario Rossi 12", "euro"),
            ("Mario Rossi", "date"),
            ("10/11/2026", "date-range"),
            ("123", "quantity"),
            ("", "text"),
            ("10/11/2026", "colour"),
        ):
            with self.subTest(text=text, value_type=value_type):
                with self.assertRaises(ValueError) as caught:
                    shape_pattern(text, value_type)
                message = str(caught.exception)
                for word in text.split():
                    self.assertNotIn(word, message)
                with self.assertRaises(ValueError) as caught:
                    selected_value(text, value_type)
                for word in text.split():
                    self.assertNotIn(word, str(caught.exception))


class CommandTest(BuilderTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.pdf = self.dir / "bolletta.pdf"
        pdfmaker.make_pdf(self.pdf, [FIRST])
        doc = read_pdf(self.pdf)

        def spec_box(text):
            return {"page": 1, "box": list(box_around(doc, text))}

        self.spec = {
            "profileId": "acqua-2026",
            "supplier": "Acqua Inventata",
            "kind": "bill",
            "category": "acqua",
            "validFrom": "2026-01-01",
            "recognise": [spec_box("Acqua Inventata")],
            "fields": {
                "amount": spec_box("98,46 €"),
                "dueDate": spec_box("10/11/2026"),
                "period": spec_box("dal 01/09/2026 al 31/10/2026"),
            },
        }

    def run_build(self, spec) -> subprocess.CompletedProcess:
        path = self.dir / "spec.json"
        text = spec if isinstance(spec, str) else json.dumps(spec)
        path.write_text(text, encoding="utf-8")
        return run_cli("build-profile", "--pdf", str(self.pdf), "--spec", str(path), "--at", AT)

    def test_valid_spec_prints_the_profile_and_writes_nothing(self) -> None:
        self.run_build(self.spec)  # writes spec.json once
        before = sorted(p.name for p in self.dir.rglob("*"))
        completed = self.run_build(self.spec)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stderr, b"")
        text = completed.stdout.decode("utf-8")
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(text.count("\n"), 1)
        profile = json.loads(text)
        self.assertEqual(validate("supplierProfile", profile), [])
        self.assertEqual(profile["id"], "acqua-2026")
        self.assertEqual(sorted(p.name for p in self.dir.rglob("*")), before)
        fields = extract(read_pdf(self.pdf), [profile], AT)["fields"]
        self.assertEqual((fields["amount"]["value"], fields["amount"]["confidence"]), (9846, "high"))

    def test_two_runs_give_the_same_bytes(self) -> None:
        first = self.run_build(self.spec)
        second = self.run_build(self.spec)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)

    def assertRejected(self, completed, message: str = SPEC_MESSAGE) -> None:
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, b"")
        self.assertEqual(completed.stderr.decode("utf-8"), message)

    def test_malformed_spec(self) -> None:
        self.assertRejected(self.run_build("{not json"))
        self.assertRejected(self.run_build("[]"))
        for key in ("profileId", "recognise", "fields", "kind"):
            spec = dict(self.spec)
            del spec[key]
            with self.subTest(missing=key):
                self.assertRejected(self.run_build(spec))
        bad_box = dict(self.spec, fields={"amount": {"page": 1, "box": [1, 2, 3]}})
        self.assertRejected(self.run_build(bad_box))
        bad_page = dict(self.spec, fields={"amount": {"page": True, "box": [1, 2, 3, 4]}})
        self.assertRejected(self.run_build(bad_page))

    def test_bad_selection(self) -> None:
        empty = dict(self.spec, fields={"amount": {"page": 1, "box": [300, 700, 400, 750]}})
        self.assertRejected(self.run_build(empty), SELECTION_MESSAGE)
        wrong_type = dict(self.spec, fields={"dueDate": self.spec["fields"]["amount"]})
        self.assertRejected(self.run_build(wrong_type), SELECTION_MESSAGE)

    def test_missing_files_and_bad_at(self) -> None:
        spec = self.dir / "spec.json"
        spec.write_text(json.dumps(self.spec), encoding="utf-8")
        missing = str(self.dir / "manca.pdf")
        completed = run_cli("build-profile", "--pdf", missing, "--spec", str(spec), "--at", AT)
        self.assertEqual((completed.returncode, completed.stdout), (2, b""))
        self.assertNotIn("manca", completed.stderr.decode("utf-8"))
        completed = run_cli(
            "build-profile", "--pdf", str(self.pdf), "--spec", str(spec), "--at", "ieri"
        )
        self.assertEqual((completed.returncode, completed.stdout), (2, b""))


if __name__ == "__main__":
    unittest.main()
