"""Tests for bollette_pdf.schemas.

Run with: python3 -I -m unittest discover -s python/tests
(or `pnpm python:test`). Every value here is invented.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PYTHON_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PYTHON_DIR.parent
sys.path.insert(0, str(PYTHON_DIR))

import bollette_pdf  # noqa: E402
from bollette_pdf import schemas  # noqa: E402

CASES = json.loads((Path(__file__).parent / "data" / "profile-cases.json").read_text("utf-8"))
BASE = CASES["base"]


def profile_of(case: dict) -> dict:
    profile = {**copy.deepcopy(BASE), **copy.deepcopy(case.get("set", {}))}
    for key in case.get("unset", []):
        profile.pop(key, None)
    return profile


def with_rule(**changes) -> dict:
    profile = copy.deepcopy(BASE)
    rule = profile["fields"]["amount"]["rules"][0]
    rule.update(changes)
    return profile


class VersionTests(unittest.TestCase):
    def test_version(self):
        self.assertEqual(bollette_pdf.__version__, "0.1.0")


class ValidateTests(unittest.TestCase):
    def test_valid_profile_has_no_errors(self):
        self.assertEqual(schemas.validate("supplierProfile", copy.deepcopy(BASE)), [])

    def test_missing_field_is_named(self):
        profile = copy.deepcopy(BASE)
        del profile["supplier"]
        errors = schemas.validate("supplierProfile", profile)
        self.assertTrue(errors)
        self.assertTrue(any("supplier" in e for e in errors), errors)

    def test_wrong_type_names_the_path(self):
        profile = copy.deepcopy(BASE)
        profile["recognise"]["allOf"] = []
        errors = schemas.validate("supplierProfile", profile)
        self.assertTrue(any("recognise/allOf" in e for e in errors), errors)

    def test_date_with_trailing_newline_is_refused(self):
        profile = copy.deepcopy(BASE)
        profile["validFrom"] = "2025-01-01\n"
        self.assertTrue(schemas.validate("supplierProfile", profile))

    def test_rules_are_added_to_the_schema_errors(self):
        profile = copy.deepcopy(BASE)
        del profile["supplier"]
        del profile["category"]
        errors = schemas.validate("supplierProfile", profile)
        self.assertTrue(any("supplier" in e for e in errors), errors)
        self.assertTrue(any("categoria" in e for e in errors), errors)

    def test_extraction_result(self):
        path = REPO_DIR / "docs" / "schemas" / "extractionResult.json"
        required = json.loads(path.read_text("utf-8")).get("required", [])
        self.assertTrue(required)
        # An empty document misses every required key and each one is named.
        errors = schemas.validate("extractionResult", {})
        for name in required:
            self.assertTrue(any(name in e for e in errors), (name, errors))

    def test_extraction_result_valid_documents(self):
        source = {"page": 1, "box": [10, 20, 110.5, 40], "text": "Totale 98,46"}
        full = {
            "v": 1, "engineVersion": "0.1.0", "fileHash": "a" * 64, "fileName": "bolletta.pdf",
            "pages": 3, "status": "riconosciuta", "profileId": "prof-1", "profileRev": 2,
            "kind": "bill", "category": "elettricita",
            "fields": {"amount": {"value": 9846, "confidence": "high", "source": source}},
            "parts": [{"label": "Quota fissa", "amount": 1200, "source": source}],
            "identifiers": [{"kind": "pod", "value": "IT001E12345678"}],
            "checks": [{"code": "total-matches-items", "ok": True, "message": "Il totale torna."}],
            "warnings": [],
        }
        self.assertEqual(schemas.validate("extractionResult", full), [])
        empty = {**full, "status": "senza-testo", "profileId": None, "profileRev": None,
                 "kind": None, "category": None, "fields": {}, "parts": [], "identifiers": [],
                 "checks": []}
        self.assertEqual(schemas.validate("extractionResult", empty), [])
        self.assertTrue(schemas.validate("extractionResult", {**full, "fileHash": "xyz"}))

    def test_unknown_kind(self):
        with self.assertRaises(KeyError):
            schemas.validate("doesNotExist", {})

    def test_kind_cannot_leave_the_folder(self):
        for kind in ("../supplierProfile", "a/b", "", "supplierProfile.json", "..\\x"):
            with self.assertRaises(KeyError, msg=kind):
                schemas.validate(kind, {})


class LookupTests(unittest.TestCase):
    def write_schema(self, folder: Path, title: str) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "supplierProfile.json").write_text(
            json.dumps({"type": "object", "required": [title]}), encoding="utf-8"
        )

    def test_environment_variable_comes_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_schema(Path(tmp), "fromEnvironment")
            with mock.patch.dict(os.environ, {"BOLLETTE_SCHEMAS_DIR": tmp}):
                errors = schemas.validate("supplierProfile", {})
        self.assertEqual(len(errors), 1)
        self.assertIn("fromEnvironment", errors[0])

    def test_package_folder_comes_before_the_repository(self):
        env = {k: v for k, v in os.environ.items() if k != "BOLLETTE_SCHEMAS_DIR"}
        with tempfile.TemporaryDirectory() as tmp:
            self.write_schema(Path(tmp) / "schemas", "fromPackage")
            with mock.patch.dict(os.environ, env, clear=True):
                with mock.patch.object(schemas, "PACKAGE_DIR", Path(tmp)):
                    errors = schemas.validate("supplierProfile", {})
        self.assertEqual(len(errors), 1)
        self.assertIn("fromPackage", errors[0])

    def test_falls_back_to_the_repository(self):
        env = {k: v for k, v in os.environ.items() if k != "BOLLETTE_SCHEMAS_DIR"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(schemas.validate("supplierProfile", copy.deepcopy(BASE)), [])

    def test_environment_folder_without_the_file_falls_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"BOLLETTE_SCHEMAS_DIR": tmp}):
                self.assertEqual(schemas.validate("supplierProfile", copy.deepcopy(BASE)), [])

    def test_no_folder_at_all_is_a_key_error(self):
        with mock.patch.object(schemas, "schema_dirs", return_value=[]):
            with self.assertRaises(KeyError):
                schemas.validate("supplierProfile", {})


class SharedCaseTests(unittest.TestCase):
    """The same cases are checked against Zod by packages/core/test/profile-cases.test.ts."""

    def test_every_case(self):
        self.assertGreater(len(CASES["cases"]), 50)
        for case in CASES["cases"]:
            with self.subTest(case["name"]):
                errors = schemas.validate("supplierProfile", profile_of(case))
                self.assertEqual(errors == [], case["valid"], errors)


class ProfileRulesTests(unittest.TestCase):
    def test_valid_profile(self):
        self.assertEqual(schemas.check_profile_rules(copy.deepcopy(BASE)), [])

    def test_messages_are_in_italian(self):
        profile = copy.deepcopy(BASE)
        del profile["category"]
        self.assertEqual(
            schemas.check_profile_rules(profile),
            ["category: un profilo di tipo «bill» richiede la categoria"],
        )

    def test_group_beyond_the_capture_groups(self):
        errors = schemas.check_profile_rules(with_rule(pattern="([0-9]+)", group=2))
        self.assertEqual(len(errors), 1)
        self.assertIn("fields.amount.rules[0].group", errors[0])

    def test_group_zero_and_default_group(self):
        self.assertEqual(schemas.check_profile_rules(with_rule(group=0)), [])
        profile = with_rule(pattern="[0-9]+")
        del profile["fields"]["amount"]["rules"][0]["group"]
        self.assertEqual(len(schemas.check_profile_rules(profile)), 1)

    def test_non_capturing_groups_are_not_counted(self):
        self.assertEqual(
            schemas.check_profile_rules(with_rule(pattern="(?:a|b)([0-9]+)", group=1)), []
        )
        self.assertEqual(
            len(schemas.check_profile_rules(with_rule(pattern="(?:a|b)[0-9]+", group=1))), 1
        )

    def test_parts_need_two_capture_groups(self):
        profile = {**copy.deepcopy(BASE), "kind": "tari", "parts": {"pattern": "([a-z]+)"}}
        del profile["category"]
        errors = schemas.check_profile_rules(profile)
        self.assertEqual(len(errors), 1)
        self.assertIn("parts.pattern", errors[0])
        profile["parts"]["pattern"] = "([a-z]+) ([0-9]+)"
        self.assertEqual(schemas.check_profile_rules(profile), [])

    def test_items_need_a_capture_group(self):
        profile = copy.deepcopy(BASE)
        profile["items"] = {"pattern": "[0-9]+"}
        errors = schemas.check_profile_rules(profile)
        self.assertEqual(len(errors), 1)
        self.assertIn("items.pattern", errors[0])

    def test_pattern_problems_name_their_place(self):
        profile = copy.deepcopy(BASE)
        profile["identifiers"] = [{"kind": "pod", "pattern": "(?<n>x)"}]
        errors = schemas.check_profile_rules(profile)
        self.assertEqual(len(errors), 1)
        self.assertIn("identifiers[0].pattern", errors[0])

    def test_survives_a_document_of_the_wrong_shape(self):
        for document in ({}, {"fields": []}, {"fields": {"amount": 3}}, {"identifiers": [1]},
                         {"fields": {"amount": {"rules": [3, {"pattern": 5}]}}},
                         {"validFrom": 3, "validTo": "x"}, {"parts": "x", "items": []}):
            schemas.check_profile_rules(document)  # must not raise
        self.assertEqual(schemas.check_profile_rules([]), [])  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
