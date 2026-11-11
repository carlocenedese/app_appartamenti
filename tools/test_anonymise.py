"""Tests for tools/anonymise.py.

Run with: python3 -I -m unittest discover -s tools -p 'test_*.py'

Every value here is invented. The real-looking codes are the fictitious examples of
fixtures/README.md or are built so that they never match a real person.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anonymise as anon  # noqa: E402

SCRIPT = Path(__file__).resolve().with_name("anonymise.py")


class ReplaceTests(unittest.TestCase):
    def test_replaces_case_insensitively_in_values_and_keys(self):
        doc = {"note": "Pagato da PIPPO Pluto", "Pippo Pluto": 1}
        out, counts = anon.anonymise(doc, {"replace": {"pippo pluto": "Inquilino A"}})
        self.assertEqual(out, {"note": "Pagato da Inquilino A", "Inquilino A": 1})
        self.assertEqual(counts["replace"], 2)

    def test_longest_text_wins(self):
        doc = ["Pippo Pluto", "Pippo"]
        out, _ = anon.anonymise(doc, {"replace": {"Pippo": "B", "Pippo Pluto": "A"}})
        self.assertEqual(out, ["A", "B"])

    def test_walks_nested_structures_and_keeps_other_types(self):
        doc = {"a": [{"b": "x Pippo"}, 3, None, True, 1.5]}
        out, _ = anon.anonymise(doc, {"replace": {"Pippo": "B"}})
        self.assertEqual(out, {"a": [{"b": "x B"}, 3, None, True, 1.5]})

    def test_only_whole_words_are_replaced_and_checked(self):
        doc = ["Camera singola", "Ola, Ola!", "ola_x"]
        out, counts = anon.anonymise(doc, {"replace": {"Ola": "Inquilina B"}, "forbid": ["gola"]})
        self.assertEqual(out, ["Camera singola", "Inquilina B, Inquilina B!", "Inquilina B_x"])
        self.assertEqual(counts["replace"], 3)

    def test_fake_text_is_not_a_regex_template(self):
        out, _ = anon.anonymise(["Pippo"], {"replace": {"Pippo": r"A\1"}})
        self.assertEqual(out, [r"A\1"])


class PatternTests(unittest.TestCase):
    def run_one(self, text: str) -> str:
        out, _ = anon.anonymise([text], {})
        return out[0]

    def test_iban_with_and_without_spaces(self):
        # Built from pieces so that pnpm data:check does not see a code in this file.
        compact = "IT" + "02L1234512345123456789012"
        spaced = "IT" + "02 L123 4512 3451 2345 6789 012"
        self.assertEqual(self.run_one(f"conto {compact}."), f"conto {anon.FAKE_IBAN}.")
        self.assertEqual(self.run_one(spaced), anon.FAKE_IBAN)

    def test_codice_fiscale(self):
        self.assertEqual(self.run_one("CF " + "BNCLRA" + "90B41F205X"), f"CF {anon.FAKE_CF}")

    def test_pod_and_pdr(self):
        self.assertEqual(self.run_one("IT" + "123E87654321"), anon.FAKE_POD)
        self.assertEqual(self.run_one("pdr " + "9876543" + "2109876"), f"pdr {anon.FAKE_PDR}")
        self.assertEqual(self.run_one("123456789012345"), "123456789012345")  # 15 digits

    def test_email_and_links(self):
        text = "scrivi a nome.cognome@posta.it o vedi https://www.example.com/x?y=1 ora"
        self.assertEqual(self.run_one(text), f"scrivi a {anon.FAKE_EMAIL} o vedi  ora")

    def test_foreign_iban(self):
        self.assertEqual(self.run_one("DE" + "89370400440532013000"), anon.FAKE_IBAN)

    def test_phone_numbers(self):
        self.assertEqual(self.run_one("tel. " + "347 1234567"), f"tel. {anon.FAKE_PHONE}")
        self.assertEqual(self.run_one("+39" + "3471234567"), anon.FAKE_PHONE)

    def test_www_file_links_and_local_paths(self):
        for text in ("www.example.com/x", "file:///tmp/x.pdf", "/Users/" + "someone/Dropbox/x.pdf",
                     "C:" + "\\Users\\x\\y.pdf", "/home/" + "x/y"):
            self.assertEqual(self.run_one(text), "", text)

    def test_fictitious_examples_stay_as_they_are(self):
        for fake in (anon.FAKE_IBAN, anon.FAKE_CF, anon.FAKE_POD, anon.FAKE_PDR, anon.FAKE_EMAIL,
                     anon.FAKE_PHONE):
            self.assertEqual(self.run_one(fake), fake)


class CheckTests(unittest.TestCase):
    def test_forbidden_text_left_raises_without_quoting_it(self):
        with self.assertRaises(anon.AnonymiseError) as ctx:
            anon.anonymise({"n": "Topolino"}, {"forbid": ["topolino"]})
        self.assertNotIn("opolino", str(ctx.exception))

    def test_numbers_are_checked_against_forbid(self):
        with self.assertRaises(anon.AnonymiseError):
            anon.anonymise({"codice": 4711}, {"forbid": ["4711"]})

    def test_nfd_text_matches_nfc_map(self):
        nfd = "Nicolo\u0300"  # o + combining grave accent
        out, _ = anon.anonymise([f"da {nfd}"], {"replace": {"Nicol\u00f2": "Inquilino C"}})
        self.assertEqual(out, ["da Inquilino C"])

    def test_keys_that_collide_raise(self):
        with self.assertRaises(anon.AnonymiseError):
            anon.anonymise({"Pippo": 1, "B": 2}, {"replace": {"Pippo": "B"}})

    def test_bad_maps_are_rejected(self):
        for bad in ([], {"replace": {"": "x"}}, {"replace": {"a": 1}}, {"forbid": "x"},
                    {"replace": {"Pippo": "Pippo jr"}}):
            with self.assertRaises(ValueError):
                anon.anonymise({}, bad)


class CommandLineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, doc, mapping):
        (self.dir / "in.json").write_text(json.dumps(doc), encoding="utf-8")
        (self.dir / "map.json").write_text(json.dumps(mapping), encoding="utf-8")
        return subprocess.run(
            [sys.executable, "-I", str(SCRIPT), "--map", str(self.dir / "map.json"),
             str(self.dir / "in.json"), str(self.dir / "out.json")],
            capture_output=True, text=True, check=False,
        )

    def test_writes_formatted_output_and_reports_counts_only(self):
        result = self.run_cli({"nome": "Pippo"}, {"replace": {"Pippo": "Inquilino A"}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("Pippo", result.stderr)
        text = (self.dir / "out.json").read_text(encoding="utf-8")
        self.assertEqual(text, '{\n  "nome": "Inquilino A"\n}\n')

    def test_leftover_writes_nothing_and_exits_1(self):
        result = self.run_cli({"nome": "Pippo"}, {"forbid": ["Pippo"]})
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.dir / "out.json").exists())
        self.assertNotIn("Pippo", result.stderr)

    def test_unreadable_input_exits_2(self):
        (self.dir / "map.json").write_text("{}", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "-I", str(SCRIPT), "--map", str(self.dir / "map.json"),
             str(self.dir / "missing.json"), str(self.dir / "out.json")],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
