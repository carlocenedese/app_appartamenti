"""Tests for python/tools/check_licenses.py. Every distribution here is invented."""

from __future__ import annotations

import io
import re
import sys
import unittest
from contextlib import redirect_stdout
from email.message import Message
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PYTHON_DIR.parent
sys.path.insert(0, str(PYTHON_DIR / "tools"))
import check_licenses as cl  # noqa: E402


class FakeDistribution:
    def __init__(self, name, *, expression=None, license=None, classifiers=()):
        self.metadata = Message()
        self.metadata["Name"] = name
        self.metadata["Version"] = "1.0"
        if expression is not None:
            self.metadata["License-Expression"] = expression
        if license is not None:
            self.metadata["License"] = license
        for classifier in classifiers:
            self.metadata["Classifier"] = classifier


def verdicts(*dists):
    return {r.name: r.allowed for r in cl.check(dists)}


class AllowedListTests(unittest.TestCase):
    def test_same_list_as_the_javascript_checker(self):
        source = (REPO_DIR / "scripts" / "check-licenses.mjs").read_text("utf-8")
        block = re.search(r"ALLOWED_LICENSES = new Set\(\[(.*?)\]\)", source, re.S)
        self.assertIsNotNone(block)
        # Comments may hold quotes; only look at the lines that are a quoted identifier.
        js = re.findall(r"^\s*'([^']+)',\s*$", block.group(1), re.M)
        self.assertEqual(set(js), set(cl.ALLOWED_LICENSES))
        self.assertEqual(len(js), len(cl.ALLOWED_LICENSES))


class ExpressionTests(unittest.TestCase):
    def ok(self, expression):
        return cl.is_allowed(expression)

    def test_single_identifiers(self):
        self.assertTrue(self.ok("MIT"))
        self.assertTrue(self.ok("mit"))
        self.assertTrue(self.ok("BlueOak-1.0.0"))
        self.assertFalse(self.ok("GPL-3.0-only"))
        self.assertFalse(self.ok("LGPL-2.1-or-later"))
        self.assertFalse(self.ok("AGPL-3.0"))
        self.assertFalse(self.ok("MPL-2.0"))
        self.assertFalse(self.ok("MIT-0"))
        self.assertFalse(self.ok("PSF-2.0"))

    def test_or_needs_one_allowed_alternative(self):
        self.assertTrue(self.ok("Apache-2.0 OR BSD-3-Clause"))
        self.assertTrue(self.ok("GPL-3.0-only OR MIT"))
        self.assertTrue(self.ok("MIT or GPL-2.0-only"))
        self.assertFalse(self.ok("GPL-3.0-only OR LGPL-2.1-only"))

    def test_and_needs_every_part(self):
        self.assertTrue(self.ok("MIT AND Zlib"))
        self.assertFalse(self.ok("MIT AND GPL-3.0-only"))

    def test_and_binds_tighter_than_or(self):
        self.assertFalse(self.ok("MIT AND GPL-3.0-only OR GPL-2.0-only"))
        self.assertTrue(self.ok("MIT AND ISC OR GPL-2.0-only"))
        self.assertTrue(self.ok("(MIT OR GPL-2.0-only) AND ISC"))
        self.assertFalse(self.ok("(GPL-2.0-only OR GPL-3.0-only) AND ISC"))

    def test_with_and_plus_use_the_base_licence(self):
        self.assertTrue(self.ok("Apache-2.0 WITH LLVM-exception"))
        self.assertFalse(self.ok("GPL-2.0-only WITH Classpath-exception-2.0"))
        self.assertTrue(self.ok("Apache-2.0+"))

    def test_garbage_is_not_allowed(self):
        for expression in ("", "   ", "UNKNOWN", "UNLICENSED", "(MIT", "MIT OR", "MIT MIT",
                           "SEE LICENSE IN LICENSE.txt", "OR", "()"):
            self.assertFalse(self.ok(expression), expression)


class CheckTests(unittest.TestCase):
    def test_mit_passes(self):
        self.assertEqual(verdicts(FakeDistribution("a", expression="MIT")), {"a": True})

    def test_gpl_fails(self):
        self.assertEqual(verdicts(FakeDistribution("a", expression="GPL-3.0-only")), {"a": False})
        self.assertEqual(verdicts(FakeDistribution("a", license="GPL")), {"a": False})

    def test_missing_licence_fails(self):
        self.assertEqual(verdicts(FakeDistribution("a")), {"a": False})
        self.assertEqual(verdicts(FakeDistribution("a", license="UNKNOWN")), {"a": False})

    def test_or_expression_with_one_allowed_alternative_passes(self):
        dist = FakeDistribution("a", expression="Apache-2.0 OR BSD-3-Clause")
        self.assertEqual(verdicts(dist), {"a": True})

    def test_licence_field_when_there_is_no_expression(self):
        self.assertEqual(verdicts(FakeDistribution("a", license="MIT")), {"a": True})
        self.assertEqual(verdicts(FakeDistribution("a", license="MIT License")), {"a": True})
        self.assertEqual(verdicts(FakeDistribution("a", license="Apache 2.0")), {"a": True})

    def test_licence_field_with_the_whole_text_is_not_trusted(self):
        text = "Permission is hereby granted, free of charge, to any person obtaining a copy\n" * 3
        self.assertEqual(verdicts(FakeDistribution("a", license=text)), {"a": False})

    def test_classifiers_when_there_is_nothing_else(self):
        mit = FakeDistribution("a", classifiers=["License :: OSI Approved :: MIT License"])
        self.assertEqual(verdicts(mit), {"a": True})
        gpl = FakeDistribution(
            "a", classifiers=["License :: OSI Approved :: GNU General Public License v3 (GPLv3)"]
        )
        self.assertEqual(verdicts(gpl), {"a": False})
        both = FakeDistribution(
            "a",
            classifiers=[
                "License :: OSI Approved :: MIT License",
                "License :: OSI Approved :: GNU General Public License v3 (GPLv3)",
            ],
        )
        # Several classifiers are alternatives, like OR.
        self.assertEqual(verdicts(both), {"a": True})

    def test_ambiguous_bsd_classifier_fails(self):
        bsd = FakeDistribution("a", classifiers=["License :: OSI Approved :: BSD License"])
        self.assertEqual(verdicts(bsd), {"a": False})

    def test_expression_beats_the_other_fields(self):
        dist = FakeDistribution("a", expression="MIT", license="GPL", classifiers=["License :: GPL"])
        self.assertEqual(verdicts(dist), {"a": True})

    def test_distribution_without_a_name_is_reported(self):
        dist = FakeDistribution("a", expression="MIT")
        del dist.metadata["Name"]
        results = cl.check([dist])
        self.assertEqual([r.allowed for r in results], [False])


class MainTests(unittest.TestCase):
    def run_main(self, dists):
        out = io.StringIO()
        with redirect_stdout(out):
            code = cl.main(distributions=dists)
        return code, out.getvalue()

    def test_exit_zero_and_only_names_and_licences(self):
        code, out = self.run_main(
            [FakeDistribution("alpha", expression="MIT"), FakeDistribution("beta", license="ISC")]
        )
        self.assertEqual(code, 0)
        self.assertIn("alpha", out)
        self.assertIn("MIT", out)
        self.assertNotIn("Permission", out)

    def test_exit_one_names_the_failures(self):
        code, out = self.run_main(
            [FakeDistribution("alpha", expression="MIT"), FakeDistribution("beta", expression="GPL-3.0-only")]
        )
        self.assertEqual(code, 1)
        self.assertIn("beta", out)
        self.assertIn("GPL-3.0-only", out)

    def test_licence_text_is_never_printed(self):
        text = "SECRET-LICENCE-TEXT " + "x" * 300
        code, out = self.run_main([FakeDistribution("alpha", license=text)])
        self.assertEqual(code, 1)
        self.assertNotIn("SECRET", out)

    def test_only_the_shipped_packages_are_checked(self):
        # Tooling of the CI Python (pip, certifi on macOS) is not shipped: it is not judged.
        out = io.StringIO()
        dists = [
            FakeDistribution("Alpha_Pkg", expression="MIT"),
            FakeDistribution("certifi", expression="MPL-2.0"),
            FakeDistribution("pip", expression="MIT"),
        ]
        with redirect_stdout(out):
            code = cl.main(distributions=dists, shipped={"alpha-pkg"})
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("Alpha_Pkg", out.getvalue())
        self.assertIn("Non distribuiti, non controllati: certifi, pip", out.getvalue())

    def test_a_shipped_package_stays_strict(self):
        out = io.StringIO()
        dists = [FakeDistribution("certifi", expression="MPL-2.0")]
        with redirect_stdout(out):
            code = cl.main(distributions=dists, shipped={"certifi"})
        self.assertEqual(code, 1)
        self.assertIn("Licenze non ammesse: certifi", out.getvalue())

    def test_a_shipped_package_that_is_not_installed_fails(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = cl.main(distributions=[FakeDistribution("alpha", expression="MIT")], shipped={"alpha", "beta"})
        self.assertEqual(code, 1)
        self.assertIn("Pacchetti non installati: beta", out.getvalue())

    def test_shipped_names_from_requirements(self):
        text = (
            "# comment\n"
            "attrs==26.1.0 \\\n    --hash=sha256:00\n    # via\n    #   jsonschema\n"
            "pdfminer-six==20260107 \\\n"
            "Charset_Normalizer==3.5.2\n"
            "rpds.py==1\n"
        )
        self.assertEqual(
            cl.shipped_names(text), {"attrs", "pdfminer-six", "charset-normalizer", "rpds-py"}
        )
        self.assertEqual(cl.canonical("pdfminer.six"), "pdfminer-six")

    def test_the_real_requirements_are_read(self):
        names = cl.shipped_names(cl.REQUIREMENTS.read_text("utf-8"))
        self.assertIn("pdfminer-six", names)
        self.assertIn("jsonschema", names)
        self.assertNotIn("pip", names)
        self.assertNotIn("certifi", names)

    def test_real_environment(self):
        # The installed environment of whoever runs the tests: the check itself must not crash.
        results = cl.check(cl.installed_distributions())
        self.assertTrue(results)


if __name__ == "__main__":
    unittest.main()
