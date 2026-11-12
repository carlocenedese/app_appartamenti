"""The seed profiles read the layouts of the real bills kept as anonymised fixtures.

Each file in fixtures/pdf/ holds the few lines of a real bill that a profile needs, anonymised with
tools/anonymise.py (names, codes, invoice number and file hash are invented), and the values that
the profile must read from them. The tests also check the shapes of personal data they can know:
IBAN, codice fiscale, POD, e-mail, links and long numbers; the names are checked by the
anonymiser's own list, kept outside the repository.
"""

from __future__ import annotations

import copy
import json
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python"))

from bollette_pdf.extract import extract  # noqa: E402
from bollette_pdf.profiles import load_profiles, matching_profiles  # noqa: E402
from bollette_pdf.reader import load_dump  # noqa: E402

AT = "2026-11-12"
SEED = REPO / "python" / "seed-profiles"
FIXTURES = sorted((REPO / "fixtures" / "pdf").glob("*.json"))

# Shapes of personal data; only the invented codes of fixtures/README.md may match.
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[0-9A-Z]){11,30}\b")
CODICE_FISCALE = re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b")
POD = re.compile(r"\bIT\d{3}E\w{8}\b")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.\w+")
LONG_NUMBER = re.compile(r"\d{7,}")
FICTITIOUS = {"IT60 X054 2811 1010 0000 0123 456", "RSSMRA80A01H501U", "IT001E12345678"}
# The invoice numbers of the fixtures, invented. A fixed list, so that a real number added to a
# fixture (and to its expected values) is not accepted just because it appears in both.
INVENTED_NUMBERS = {
    "acegas-acqua-01": "452030663064",
    "acegas-acqua-02": "493622410726",
    "acegas-tari-01": "5570/2/65484",
    "acegas-tari-02": "9732/15/83030",
    "acegas-tari-03": "82777942925",
    "acegas-tari-04": "5114/21/62591",
    "enel-01": "7185744691",
    "enel-02": "2213731725",
    "enel-03": "0902204015",
    "enel-04": "8082258428",
    "fastweb-01": "M212465544",
    "hera-gas-01": "071020235922",
    "hera-gas-02": "483332832194",
    "hera-gas-03": "243074872614",
    "hera-luce-01": "106914348247",
    "hera-luce-02": "514309923781"
}
# Layouts whose amount is read through a less specific label («Totale bolletta», «Totale fattura»): medium.
MEDIUM_AMOUNT = {"enel-04", "hera-gas-03"}


def _fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _profiles() -> list:
    profiles, warnings = load_profiles(SEED)
    assert warnings == []
    return profiles


def _extract(dump: dict) -> dict:
    return extract(load_dump(dump), _profiles(), AT)


def _lines(fixture: dict) -> list[str]:
    return [" ".join(word["text"] for word in line["words"]) for line in fixture["dump"]["lines"]]


class SeedProfilesTest(unittest.TestCase):
    def test_all_profiles_load_and_are_drafts(self) -> None:
        profiles = _profiles()
        self.assertEqual(len(profiles), len(list(SEED.glob("*.json"))))
        self.assertGreaterEqual(len(profiles), 10)
        for profile in profiles:
            with self.subTest(profile=profile["id"]):
                self.assertEqual(profile["status"], "bozza")
                self.assertEqual(profile["identifiers"], [])
                self.assertTrue((SEED / f"{profile['id']}.json").exists())

    def test_profiles_hold_no_personal_data_or_links(self) -> None:
        text = "\n".join(p.read_text(encoding="utf-8") for p in sorted(SEED.glob("*.json")))
        for pattern in (IBAN, CODICE_FISCALE, POD, EMAIL, LONG_NUMBER):
            self.assertEqual(pattern.findall(text), [])
        self.assertNotIn("http", text)
        self.assertNotIn("www.", text)


class FixturesTest(unittest.TestCase):
    def test_there_are_fixtures_for_every_supplier(self) -> None:
        names = {path.stem.rsplit("-", 1)[0] for path in FIXTURES}
        self.assertEqual(
            names, {"acegas-acqua", "acegas-tari", "enel", "fastweb", "hera-gas", "hera-luce"}
        )

    def test_each_fixture_reads_as_expected(self) -> None:
        for path in FIXTURES:
            fixture = _fixture(path)
            with self.subTest(fixture=path.stem):
                result = _extract(fixture["dump"])
                expected = dict(fixture["expected"])
                confidence = expected.pop("confidence")
                self.assertEqual(result["status"], expected.pop("status"))
                self.assertEqual(expected["number"], INVENTED_NUMBERS.get(path.stem))
                self.assertEqual(result["profileId"], fixture["profileId"])
                for name, value in expected.items():
                    self.assertEqual(result["fields"][name]["value"], value, name)
                    self.assertEqual(result["fields"][name]["confidence"], confidence[name], name)

    def test_the_amount_is_high_except_in_the_layout_that_reads_the_total_bill(self) -> None:
        # enel-04 has «TOTALE BOLLETTA» on page 2: read as medium, so a person looks at it.
        for path in FIXTURES:
            fixture = _fixture(path)
            if fixture["expected"]["status"] != "riconosciuta":
                continue
            with self.subTest(fixture=path.stem):
                amount = _extract(fixture["dump"])["fields"]["amount"]
                self.assertEqual(amount["confidence"], "medium" if path.stem in MEDIUM_AMOUNT else "high")

    def test_a_fixture_is_recognised_only_by_profiles_of_its_own_category(self) -> None:
        profiles = _profiles()
        for path in FIXTURES:
            fixture = _fixture(path)
            own = next((p for p in profiles if p["id"] == fixture["profileId"]), None)
            with self.subTest(fixture=path.stem):
                self.assertIsNotNone(own)
                matching = matching_profiles(load_dump(fixture["dump"]), profiles)
                self.assertIn(own, matching)
                for profile in matching:
                    self.assertEqual(profile.get("category"), own.get("category"))
                    self.assertEqual(profile["kind"], own["kind"])

    def test_two_layouts_of_the_same_supplier(self) -> None:
        profile_ids = {_fixture(path)["profileId"] for path in FIXTURES}
        for supplier in ("hera-luce", "hera-gas", "acegas-acqua", "acegas-tari"):
            with self.subTest(supplier=supplier):
                self.assertGreaterEqual(len({i for i in profile_ids if i.startswith(supplier)}), 2)

    def test_a_label_that_changes_makes_the_bill_da_confermare(self) -> None:
        # The words of a layout change are simulated: «pagare» of «Totale da pagare» is renamed.
        fixture = _fixture(next(p for p in FIXTURES if p.stem == "hera-luce-01"))
        self.assertEqual(fixture["profileId"], "hera-luce-2024")
        changed = copy.deepcopy(fixture["dump"])
        renamed = 0
        for line in changed["lines"]:
            for word in line["words"]:
                if word["text"] == "pagare":
                    word["text"] = "incassare"
                    renamed += 1
        self.assertEqual(renamed, 1)
        result = _extract(changed)
        self.assertEqual(result["status"], "da-confermare")
        self.assertIsNone(result["fields"]["amount"]["value"])

    def test_fixtures_hold_no_personal_data(self) -> None:
        for path in FIXTURES:
            fixture = _fixture(path)
            text = "\n".join(_lines(fixture))
            allowed = INVENTED_NUMBERS.get(path.stem, "")
            with self.subTest(fixture=path.stem):
                for pattern in (IBAN, CODICE_FISCALE, POD):
                    self.assertTrue(set(pattern.findall(text)) <= FICTITIOUS)
                self.assertEqual(EMAIL.findall(text), [])
                self.assertNotIn("http", text)
                self.assertNotIn("www.", text)
                for run in LONG_NUMBER.findall(text):
                    self.assertIn(run, allowed, "numero lungo che non è quello inventato")
                self.assertRegex(fixture["dump"]["fileHash"], r"^[0-9a-f]{64}$")
                self.assertNotIn("http", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
