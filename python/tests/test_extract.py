"""Tests for bollette_pdf.extract and bollette_pdf.checks.

Every PDF is built with pdfmaker; every text, amount and date here is invented.
"""

from __future__ import annotations

import copy
import sys
import tempfile
import time
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf.checks import run_checks  # noqa: E402
from bollette_pdf.extract import extract  # noqa: E402
from bollette_pdf.reader import read_pdf  # noqa: E402
from bollette_pdf.schemas import validate  # noqa: E402

FILLER = "Testo di riempimento della bolletta inventata, con abbastanza caratteri per la lettura."
AT = "2026-11-11T09:30:00Z"
EURO = "([0-9.]*[0-9],[0-9]{2})"
DATE = "([0-9]{2}/[0-9]{2}/[0-9]{4})"


def rule(anchor, pattern, value_type, position="same-line", group=1):
    return {
        "anchor": anchor,
        "position": position,
        "pattern": pattern,
        "valueType": value_type,
        "group": group,
    }


def light_profile(**changes):
    result = {
        "id": "luce-2025",
        "v": 1,
        "rev": 3,
        "supplier": "Luce Inventata",
        "kind": "bill",
        "category": "elettricita",
        "status": "confermato",
        "autoRegister": False,
        "validFrom": "2025-01-01",
        "recognise": {"allOf": ["Luce Inventata"], "noneOf": []},
        "fields": {
            "number": {"required": False, "rules": [rule("Fattura n.", r"(\S+)", "text")]},
            "issueDate": {"required": False, "rules": [rule("Data emissione", DATE, "date")]},
            "dueDate": {"required": False, "rules": [rule("Scadenza", DATE, "date")]},
            "period": {
                "required": False,
                "rules": [rule("Periodo di fornitura", "(dal .+ al [0-9/]+)", "date-range")],
            },
            "consumption": {
                "required": False,
                "rules": [rule("Consumo", "([0-9.,]+ ?[A-Za-z]*)", "quantity")],
            },
            "amount": {"required": True, "rules": [rule("Totale da pagare", EURO, "euro")]},
        },
        "identifiers": [],
    }
    result.update(copy.deepcopy(changes))
    return result


STANDARD = [
    (72, 80, "Luce Inventata SpA"),
    (72, 100, "Fattura n. FX-2025-0042"),
    (72, 120, "Data emissione 15/03/2025"),
    (72, 140, "Scadenza 05/04/2025"),
    (72, 160, "Periodo di fornitura dal 01/01/2025 al 28/02/2025"),
    (72, 180, "Consumo 123,4 kWh"),
    (72, 200, "Totale da pagare € 87,65"),
    (72, 400, FILLER),
]


def find_word(doc, text):
    found = [w for line in doc.lines for w in line.words if w.text == text]
    assert len(found) == 1, (text, found)
    return found[0]


def box_of(*words):
    return [
        min(w.x0 for w in words),
        min(w.top for w in words),
        max(w.x1 for w in words),
        max(w.bottom for w in words),
    ]


class ExtractTestCase(unittest.TestCase):
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

    def assertValid(self, result) -> None:
        full = dict(result, engineVersion="0.0.0-test", fileName="bolletta.pdf")
        self.assertEqual(validate("extractionResult", full), [])


class FieldsTest(ExtractTestCase):
    def test_standard_bill_all_fields_high_with_source(self) -> None:
        doc = self.doc(STANDARD)
        result = extract(doc, [light_profile()], AT)
        fields = result["fields"]
        self.assertEqual(result["status"], "riconosciuta")
        self.assertEqual((result["profileId"], result["profileRev"]), ("luce-2025", 3))
        self.assertEqual((result["kind"], result["category"]), ("bill", "elettricita"))
        self.assertEqual(result["v"], 1)
        self.assertEqual(result["fileHash"], doc.file_hash)
        self.assertEqual(result["pages"], 1)
        self.assertEqual(
            fields["supplier"], {"value": "Luce Inventata", "confidence": "high", "source": None}
        )
        expected = {
            "number": "FX-2025-0042",
            "issueDate": "2025-03-15",
            "dueDate": "2025-04-05",
            "periodStart": "2025-01-01",
            "periodEnd": "2025-02-28",
            "consumption": {"quantity": "123.4", "unit": "kWh"},
            "amount": 8765,
        }
        self.assertEqual({k: fields[k]["value"] for k in expected}, expected)
        for name in expected:
            self.assertEqual(fields[name]["confidence"], "high", name)
        value = find_word(doc, "87,65")
        self.assertEqual(
            fields["amount"]["source"], {"page": 1, "box": box_of(value), "text": "87,65"}
        )
        self.assertGreater(value.x0, 150)
        due = find_word(doc, "05/04/2025")
        self.assertEqual(fields["dueDate"]["source"]["box"], box_of(due))
        period_words = [find_word(doc, t) for t in ("dal", "01/01/2025", "al", "28/02/2025")]
        self.assertEqual(fields["periodStart"]["source"]["box"], box_of(*period_words))
        self.assertEqual(fields["periodStart"]["source"], fields["periodEnd"]["source"])
        self.assertEqual(
            fields["consumption"]["source"]["box"],
            box_of(find_word(doc, "123,4"), find_word(doc, "kWh")),
        )
        self.assertEqual([(c["code"], c["ok"]) for c in result["checks"]],
                         [("period-order", True), ("due-after-issue", True)])
        for check in result["checks"]:
            self.assertTrue(check["message"])
        self.assertValid(result)

    def test_anchor_in_merged_label_and_value_line(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare"),
                        (158, 200, "87,65"), (72, 400, FILLER)])
        merged = [line for line in doc.lines if "pagare" in line.text]
        self.assertEqual(merged[0].text, "Totale da pagare 87,65")  # precondition: one Line
        amount = extract(doc, [light_profile()], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "high"))
        self.assertEqual(amount["source"]["box"], box_of(find_word(doc, "87,65")))

    def test_right_reads_a_far_column(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare"),
                        (300, 200, "Note varie"), (450, 200, "87,65"), (72, 400, FILLER)])
        self.assertEqual(len([ln for ln in doc.lines if abs(ln.baseline - 200) < 2]), 3)
        same_line = extract(doc, [light_profile()], AT)["fields"]["amount"]
        self.assertEqual(same_line["confidence"], "missing")
        profile = light_profile()
        profile["fields"]["amount"]["rules"] = [rule("Totale da pagare", EURO, "euro", "right")]
        amount = extract(doc, [profile], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "high"))
        self.assertEqual(amount["source"]["box"], box_of(find_word(doc, "87,65")))

    def test_right_ignores_words_left_of_the_anchor(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "12,00"),
                        (200, 200, "Totale da pagare"), (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["amount"]["rules"] = [rule("Totale da pagare", EURO, "euro", "right")]
        self.assertEqual(extract(doc, [profile], AT)["fields"]["amount"]["confidence"], "missing")

    def test_below_reads_the_overlapping_line_under_the_label(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (300, 120, "Scadenza"),
                        (72, 135, "01/01/2020"), (300, 135, "05/04/2025"), (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["dueDate"]["rules"] = [rule("Scadenza", DATE, "date", "below")]
        due = extract(doc, [profile], AT)["fields"]["dueDate"]
        self.assertEqual((due["value"], due["confidence"]), ("2025-04-05", "high"))
        self.assertEqual(due["source"]["box"], box_of(find_word(doc, "05/04/2025")))

    def test_below_looks_at_most_three_rows_down(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (300, 120, "Scadenza"),
                        (72, 135, "riga uno"), (72, 150, "riga due"), (72, 165, "riga tre"),
                        (300, 180, "05/04/2025"), (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["dueDate"]["rules"] = [rule("Scadenza", DATE, "date", "below")]
        self.assertEqual(extract(doc, [profile], AT)["fields"]["dueDate"]["confidence"], "missing")

    def test_two_totals_with_different_values_are_medium_first_kept(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare 87,65"),
                        (72, 220, "Totale da pagare 12,00"), (72, 400, FILLER)])
        amount = extract(doc, [light_profile()], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "medium"))

    def test_two_totals_with_the_same_value_are_high(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare 87,65"),
                        (72, 220, "Totale da pagare"), (72, 240, "Totale da pagare 87,65"),
                        (72, 400, FILLER)])
        amount = extract(doc, [light_profile()], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "high"))

    def test_value_from_a_later_rule_is_medium(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare 87,65"),
                        (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["amount"]["rules"] = [
            rule("Importo complessivo", EURO, "euro"),
            rule("Totale da pagare", EURO, "euro"),
        ]
        amount = extract(doc, [profile], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "medium"))

    def test_unparsable_value_is_no_value_and_next_rule_wins(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare 87"),
                        (72, 220, "Importo 87,65"), (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["amount"]["rules"] = [
            rule("Totale da pagare", "([0-9,]+)", "euro"),
            rule("Importo", EURO, "euro"),
        ]
        amount = extract(doc, [profile], AT)["fields"]["amount"]
        self.assertEqual((amount["value"], amount["confidence"]), (8765, "medium"))

    def test_missing_optional_field_keeps_status(self) -> None:
        doc = self.doc([item for item in STANDARD if "Scadenza" not in item[2]])
        result = extract(doc, [light_profile()], AT)
        self.assertEqual(result["fields"]["dueDate"],
                         {"value": None, "confidence": "missing", "source": None})
        self.assertEqual(result["status"], "riconosciuta")
        self.assertValid(result)

    def test_missing_required_field_is_da_confermare(self) -> None:
        doc = self.doc([item for item in STANDARD if "Totale" not in item[2]])
        result = extract(doc, [light_profile()], AT)
        self.assertEqual(result["fields"]["amount"],
                         {"value": None, "confidence": "missing", "source": None})
        self.assertEqual(result["status"], "da-confermare")
        self.assertEqual(result["profileId"], "luce-2025")
        self.assertValid(result)

    def test_quantity_without_unit_has_empty_unit(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 180, "Consumo 1.234"),
                        (72, 400, FILLER)])
        consumption = extract(doc, [light_profile()], AT)["fields"]["consumption"]
        self.assertEqual(consumption["value"], {"quantity": "1234", "unit": ""})

    def test_group_zero_and_text_value(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 100, "Fattura n. AB 77"),
                        (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["number"]["rules"] = [rule("Fattura n.", "[A-Z]+ [0-9]+", "text", group=0)]
        number = extract(doc, [profile], AT)["fields"]["number"]
        self.assertEqual(number["value"], "AB 77")
        self.assertEqual(number["source"]["box"], box_of(find_word(doc, "AB"), find_word(doc, "77")))

    def test_anchor_must_be_whole_consecutive_words(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Subtotale da pagare 87,65"),
                        (72, 220, "Totale ancora da pagare 87,65"), (72, 400, FILLER)])
        self.assertEqual(
            extract(doc, [light_profile()], AT)["fields"]["amount"]["confidence"], "missing"
        )

    def test_anchor_is_case_and_space_insensitive(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "TOTALE DA PAGARE 87,65"),
                        (72, 400, FILLER)])
        profile = light_profile()
        profile["fields"]["amount"]["rules"] = [rule("totale  da   pagare", EURO, "euro")]
        self.assertEqual(extract(doc, [profile], AT)["fields"]["amount"]["value"], 8765)

    def test_backtracking_pattern_finishes_quickly(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 100, "Fattura n. " + "a" * 5000, 1),
                        (72, 400, FILLER)])
        self.assertGreater(len(doc.text), 5000)  # precondition: the long word is read
        for pattern in ("(a+)+$", "(a*a*a*c)"):
            profile = light_profile()
            profile["fields"]["number"]["rules"] = [rule("Fattura n.", pattern, "text")]
            start = time.perf_counter()
            extract(doc, [profile], AT)
            self.assertLess(time.perf_counter() - start, 5, pattern)

    def test_same_input_gives_the_same_result(self) -> None:
        doc = self.doc(STANDARD)
        self.assertEqual(extract(doc, [light_profile()], AT), extract(doc, [light_profile()], AT))


class StatusTest(ExtractTestCase):
    def test_non_riconosciuta(self) -> None:
        doc = self.doc([(72, 80, "Gas Inventato"), (72, 400, FILLER)])
        result = extract(doc, [light_profile()], AT)
        self.assertEqual(result["status"], "non-riconosciuta")
        self.assertEqual(result["fields"], {})
        for key in ("profileId", "profileRev", "kind", "category"):
            self.assertIsNone(result[key])
        self.assertEqual((result["parts"], result["identifiers"], result["checks"]), ([], [], []))
        self.assertValid(result)

    def test_none_of_gives_non_riconosciuta(self) -> None:
        doc = self.doc(STANDARD + [(72, 300, "Nota di credito")])
        profile = light_profile(recognise={"allOf": ["Luce Inventata"], "noneOf": ["NOTA DI CREDITO"]})
        self.assertEqual(extract(doc, [profile], AT)["status"], "non-riconosciuta")

    def test_senza_testo(self) -> None:
        doc = self.doc([(72, 80, "Luce Inventata"), (72, 200, "Totale da pagare 87,65")])
        self.assertFalse(doc.has_text)
        result = extract(doc, [light_profile()], AT)
        self.assertEqual(result["status"], "senza-testo")
        self.assertEqual(result["fields"], {})
        self.assertIsNone(result["profileId"])
        self.assertValid(result)

    def test_items_sum_ok(self) -> None:
        doc = self.doc(STANDARD + [(72, 260, "Voce energia 50,00"), (72, 280, "Voce rete 37,65")])
        profile = light_profile(items={"pattern": "Voce [a-z]+ ([0-9.]*[0-9],[0-9]{2})"})
        result = extract(doc, [profile], AT)
        check = [c for c in result["checks"] if c["code"] == "items-sum"]
        self.assertEqual([c["ok"] for c in check], [True])
        self.assertEqual(result["status"], "riconosciuta")

    def test_items_sum_wrong_is_da_confermare(self) -> None:
        doc = self.doc(STANDARD + [(72, 260, "Voce energia 50,00"), (72, 280, "Voce rete 30,00")])
        profile = light_profile(items={"pattern": "Voce [a-z]+ ([0-9.]*[0-9],[0-9]{2})"})
        result = extract(doc, [profile], AT)
        check = [c for c in result["checks"] if c["code"] == "items-sum"]
        self.assertEqual([c["ok"] for c in check], [False])
        self.assertEqual(result["status"], "da-confermare")
        self.assertNotIn("80,00", check[0]["message"])
        self.assertValid(result)

    def test_no_items_no_check(self) -> None:
        profile = light_profile(items={"pattern": "Voce [a-z]+ ([0-9.]*[0-9],[0-9]{2})"})
        result = extract(self.doc(STANDARD), [profile], AT)
        self.assertNotIn("items-sum", [c["code"] for c in result["checks"]])

    def test_due_before_issue_is_da_confermare(self) -> None:
        pages = [item if "Scadenza" not in item[2] else (72, 140, "Scadenza 01/03/2025")
                 for item in STANDARD]
        result = extract(self.doc(pages), [light_profile()], AT)
        check = [c for c in result["checks"] if c["code"] == "due-after-issue"]
        self.assertEqual([c["ok"] for c in check], [False])
        self.assertEqual(result["status"], "da-confermare")

    def test_identifiers_deduplicated_across_pages(self) -> None:
        profile = light_profile(identifiers=[
            {"kind": "pod", "pattern": "(IT[0-9]{3}E[0-9]{8})"},
            {"kind": "customer", "pattern": "Codice cliente ([0-9]+)"},
            {"kind": "pdr", "pattern": "[0-9]{14}"},
        ])
        doc = self.doc(
            STANDARD + [(72, 300, "POD IT001E12345678"), (72, 320, "Codice cliente 998877")],
            [(72, 100, "POD IT001E12345678 e PDR 12345678901234"), (72, 400, FILLER)],
        )
        result = extract(doc, [profile], AT)
        self.assertEqual(result["identifiers"], [
            {"kind": "pod", "value": "IT001E12345678"},
            {"kind": "customer", "value": "998877"},
            {"kind": "pdr", "value": "12345678901234"},
        ])
        self.assertEqual(result["pages"], 2)
        self.assertValid(result)


class ProfileChoiceTest(ExtractTestCase):
    def profiles(self):
        old = light_profile(id="luce-2020", validFrom="2020-01-01", validTo="2024-12-31")
        new = light_profile(id="luce-2025", validFrom="2025-01-01")
        return [old, new]

    def bill(self, issue):
        items = [item for item in STANDARD if "emissione" not in item[2]]
        if issue is not None:
            items.append((72, 120, f"Data emissione {issue}"))
        return self.doc(items)

    def test_2025_bill_uses_the_new_profile(self) -> None:
        result = extract(self.bill("15/03/2025"), self.profiles(), AT)
        self.assertEqual(result["profileId"], "luce-2025")

    def test_2023_bill_uses_the_old_profile(self) -> None:
        result = extract(self.bill("15/03/2023"), self.profiles(), AT)
        self.assertEqual((result["profileId"], result["status"]), ("luce-2020", "riconosciuta"))

    def test_without_issue_date_at_decides(self) -> None:
        doc = self.bill(None)
        self.assertEqual(extract(doc, self.profiles(), "2023-06-01T10:00:00Z")["profileId"],
                         "luce-2020")
        self.assertEqual(extract(doc, self.profiles(), "2025-06-01")["profileId"], "luce-2025")

    def test_no_profile_complete_falls_back_to_the_newest(self) -> None:
        doc = self.doc([item for item in STANDARD if "Totale" not in item[2]])
        result = extract(doc, self.profiles(), AT)
        self.assertEqual((result["profileId"], result["status"]), ("luce-2025", "da-confermare"))

    def test_profile_that_reads_the_required_fields_wins_over_newer(self) -> None:
        newer = light_profile(id="luce-2026", validFrom="2026-01-01")
        newer["fields"]["amount"]["rules"] = [rule("Importo complessivo", EURO, "euro")]
        result = extract(self.bill("15/03/2026"), self.profiles() + [newer], AT)
        self.assertEqual(result["profileId"], "luce-2025")


class TariTest(ExtractTestCase):
    def tari_profile(self):
        return {
            "id": "tari-comune",
            "v": 1,
            "rev": 1,
            "supplier": "Comune Inventato",
            "kind": "tari",
            "status": "bozza",
            "autoRegister": False,
            "validFrom": "2024-01-01",
            "recognise": {"allOf": ["Avviso TARI"], "noneOf": []},
            "fields": {"amount": {"required": True, "rules": [rule("Totale avviso", EURO, "euro")]}},
            "identifiers": [],
            "parts": {"pattern": "Utenza ([A-Za-z]+) ([0-9.,]+)"},
        }

    def test_two_parts_none_lost_none_twice(self) -> None:
        doc = self.doc([(72, 80, "Comune Inventato - Avviso TARI"),
                        (72, 120, "Utenza abitazione 120,00"), (72, 140, "Utenza box 30,50"),
                        (72, 200, "Totale avviso 150,50"), (72, 400, FILLER)])
        result = extract(doc, [self.tari_profile()], AT)
        self.assertEqual(result["status"], "riconosciuta")
        self.assertEqual((result["kind"], result["category"]), ("tari", None))
        self.assertEqual([(p["label"], p["amount"]) for p in result["parts"]],
                         [("abitazione", 12000), ("box", 3050)])
        [line] = [ln for ln in doc.lines if "abitazione" in ln.text]
        source = result["parts"][0]["source"]
        self.assertEqual(source["page"], 1)
        self.assertEqual(source["box"], box_of(*line.words))
        self.assertEqual(source["text"], "Utenza abitazione 120,00")
        self.assertEqual(result["warnings"], [])
        self.assertValid(result)

    def test_same_part_on_two_pages_is_read_once(self) -> None:
        doc = self.doc(
            [(72, 80, "Comune Inventato - Avviso TARI"), (72, 120, "Utenza abitazione 120,00"),
             (72, 140, "Utenza box 30,50"), (72, 200, "Totale avviso 150,50"), (72, 400, FILLER)],
            [(72, 120, "Utenza box 30,50"), (72, 140, "Utenza garage 1,2"), (72, 400, FILLER)],
        )
        result = extract(doc, [self.tari_profile()], AT)
        self.assertEqual([(p["label"], p["amount"], p["source"]["page"]) for p in result["parts"]],
                         [("abitazione", 12000, 1), ("box", 3050, 1)])
        self.assertTrue(any("parte ripetuta" in w for w in result["warnings"]))
        self.assertTrue(any("parte non leggibile" in w for w in result["warnings"]))
        for warning in result["warnings"]:
            self.assertNotIn("garage", warning)
            self.assertNotIn("box", warning)
        self.assertValid(result)


class RunChecksTest(unittest.TestCase):
    @staticmethod
    def field(value):
        return {"value": value, "confidence": "high", "source": None}

    def test_no_inputs_no_checks(self) -> None:
        self.assertEqual(run_checks({}, None), [])
        self.assertEqual(run_checks({"amount": self.field(None)}, 100), [])
        self.assertEqual(run_checks({"periodStart": self.field("2025-01-01")}, None), [])

    def test_period_order(self) -> None:
        fields = {"periodStart": self.field("2025-03-01"), "periodEnd": self.field("2025-02-28")}
        [check] = run_checks(fields, None)
        self.assertEqual((check["code"], check["ok"]), ("period-order", False))
        fields["periodEnd"] = self.field("2025-03-01")
        self.assertTrue(run_checks(fields, None)[0]["ok"])

    def test_due_after_issue(self) -> None:
        fields = {"issueDate": self.field("2025-03-15"), "dueDate": self.field("2025-03-14")}
        [check] = run_checks(fields, None)
        self.assertEqual((check["code"], check["ok"]), ("due-after-issue", False))
        fields["dueDate"] = self.field("2025-03-15")
        self.assertTrue(run_checks(fields, None)[0]["ok"])

    def test_items_sum(self) -> None:
        fields = {"amount": self.field(8765)}
        self.assertTrue(run_checks(fields, 8765)[0]["ok"])
        [check] = run_checks(fields, 8700)
        self.assertEqual((check["code"], check["ok"]), ("items-sum", False))
        self.assertTrue(check["message"])
        self.assertNotIn("87", check["message"])


if __name__ == "__main__":
    unittest.main()
