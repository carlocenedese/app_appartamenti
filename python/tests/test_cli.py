"""Tests for the command line of bollette_pdf. Every PDF, profile and text here is invented.

The program is started with `python -I`, which ignores PYTHONPATH and the current directory, so
the package is made importable by a tiny bootstrap that adds the `python/` directory to the path
and runs the package like `-m bollette_pdf` does. Some tests call `main` in-process instead.
"""

from __future__ import annotations

import hashlib
import io
import json
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdfmaker  # noqa: E402
from bollette_pdf import __version__  # noqa: E402
from bollette_pdf.__main__ import main  # noqa: E402
from bollette_pdf.schemas import validate  # noqa: E402
from test_extract import AT, FILLER, STANDARD, light_profile  # noqa: E402

BOOTSTRAP = (
    "import runpy, sys; sys.path.insert(0, sys.argv[1]); sys.argv = ['bollette_pdf'] + sys.argv[2:];"
    " runpy.run_module('bollette_pdf', run_name='__main__')"
)
SECRET = "Testo riservato"


def run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-I", "-c", BOOTSTRAP, str(PYTHON_DIR), *args],
        capture_output=True,
        cwd=PYTHON_DIR,
        timeout=120,
    )


class FakeStdout:
    """A text stream with a legacy encoding that cannot be reconfigured (like a Windows pipe)."""

    def __init__(self, encoding: str) -> None:
        self.buffer = io.BytesIO()
        self.encoding = encoding
        self.text = io.TextIOWrapper(self.buffer, encoding=encoding, newline="\r\n")

    def write(self, data: str) -> int:
        return self.text.write(data)

    def flush(self) -> None:
        self.text.flush()


class CliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.profiles = self.dir / "profili"
        self.profiles.mkdir()
        self.pdf = self.dir / "bolletta di prova.pdf"
        pdfmaker.make_pdf(self.pdf, [STANDARD])

    def write_profile(self, name: str = "luce.json", **changes) -> None:
        (self.profiles / name).write_text(json.dumps(light_profile(**changes)), encoding="utf-8")

    def extract(self, pdf=None, profiles=None, at=AT) -> subprocess.CompletedProcess:
        return run_cli(
            "extract",
            "--pdf",
            str(pdf or self.pdf),
            "--profiles",
            str(profiles or self.profiles),
            "--at",
            at,
        )

    def document(self, completed: subprocess.CompletedProcess) -> dict:
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stderr, b"")
        text = completed.stdout.decode("utf-8")
        self.assertTrue(text.endswith("\n"))
        self.assertNotIn("\r", text)
        self.assertEqual(text.count("\n"), 1)
        result = json.loads(text)
        self.assertEqual(validate("extractionResult", result), [])
        return result


class ExtractTest(CliTestCase):
    def test_recognised_pdf_gives_one_valid_document(self) -> None:
        self.write_profile()
        result = self.document(self.extract())
        self.assertEqual(result["status"], "riconosciuta")
        self.assertEqual(result["engineVersion"], __version__)
        self.assertEqual(result["fileName"], "bolletta di prova.pdf")
        self.assertEqual(result["fileHash"], hashlib.sha256(self.pdf.read_bytes()).hexdigest())
        self.assertEqual(result["fields"]["amount"]["value"], 8765)

    def test_broken_and_invalid_profiles_are_warnings_with_names_only(self) -> None:
        self.write_profile()
        (self.profiles / "rotto.json").write_text("{ non json", encoding="utf-8")
        (self.profiles / "non-valido.json").write_text('{"id": "x"}', encoding="utf-8")
        result = self.document(self.extract())
        self.assertEqual(result["status"], "riconosciuta")
        warnings = "\n".join(result["warnings"])
        self.assertIn("rotto.json", warnings)
        self.assertIn("non-valido.json", warnings)
        self.assertNotIn("non json", warnings)

    def test_not_recognised_and_no_text_are_exit_zero(self) -> None:
        result = self.document(self.extract())  # no profile at all
        self.assertEqual(result["status"], "non-riconosciuta")
        blank = self.dir / "vuoto.pdf"
        pdfmaker.make_blank_pdf(blank)
        result = self.document(self.extract(pdf=blank))
        self.assertEqual(result["status"], "senza-testo")

    def test_pdfminer_warnings_never_reach_stderr(self) -> None:
        # A dangling /FontDescriptor makes pdfminer log «Could not get FontBBox …», which would
        # otherwise go to stderr through logging's last-resort handler (and may quote the file).
        self.write_profile()
        bad = self.dir / "font-guasto.pdf"
        pdfmaker.make_bad_font_pdf(bad, STANDARD)
        completed = self.extract(pdf=bad)
        self.assertEqual(completed.stderr, b"")
        self.document(completed)

    def test_corrupt_pdf_is_illeggibile(self) -> None:
        corrupt = self.dir / "guasto.pdf"
        corrupt.write_bytes(b"%PDF-1.4 questo non e un pdf " + SECRET.encode())
        result = self.document(self.extract(pdf=corrupt))
        self.assertEqual(result["status"], "illeggibile")
        self.assertEqual(result["pages"], 0)
        self.assertEqual(result["fields"], {})
        self.assertEqual(result["parts"], [])
        self.assertEqual(result["identifiers"], [])
        self.assertEqual(result["checks"], [])
        for key in ("profileId", "profileRev", "kind", "category"):
            self.assertIsNone(result[key])
        self.assertEqual(result["fileName"], "guasto.pdf")
        self.assertEqual(result["fileHash"], hashlib.sha256(corrupt.read_bytes()).hexdigest())
        self.assertEqual(len(result["warnings"]), 1)
        self.assertNotIn(SECRET, result["warnings"][0])

    def test_encrypted_pdf_is_illeggibile(self) -> None:
        encrypted = self.dir / "protetto.pdf"
        pdfmaker.make_encrypted_pdf(encrypted)
        result = self.document(self.extract(pdf=encrypted))
        self.assertEqual(result["status"], "illeggibile")
        self.assertNotIn(SECRET, json.dumps(result))

    def test_two_runs_give_the_same_bytes(self) -> None:
        self.write_profile()
        (self.profiles / "rotto.json").write_text("{", encoding="utf-8")
        first, second = self.extract(), self.extract()
        self.assertEqual(first.returncode, 0)
        self.assertEqual(first.stdout, second.stdout)

    def test_accepted_at_forms(self) -> None:
        for at in (
            "2026-11-11",
            "2026-11-11T09:30",
            "2026-11-11T09:30:15",
            "2026-11-11T09:30:15.250",
            "2026-11-11T09:30:15Z",
            "2026-11-11T09:30:15.250+01:00",
            "2026-02-28T23:59-05:30",
            "2028-02-29",
        ):
            with self.subTest(at=at):
                self.document(self.extract(at=at))

    def test_output_is_utf8_when_the_stream_is_not(self) -> None:
        supplier = "Società Èlettrica €uro"
        self.write_profile(supplier=supplier, recognise={"allOf": ["Luce Inventata"], "noneOf": []})
        stdout = FakeStdout("cp1252")
        stderr = io.StringIO()
        code = main(
            ["extract", "--pdf", str(self.pdf), "--profiles", str(self.profiles), "--at", AT],
            stdout,
            stderr,
        )
        stdout.flush()
        self.assertEqual(code, 0, stderr.getvalue())
        self.assertEqual(stderr.getvalue(), "")
        data = stdout.buffer.getvalue()
        self.assertNotIn(b"\r", data)
        self.assertTrue(data.endswith(b"\n"))
        result = json.loads(data.decode("utf-8"))
        self.assertEqual(result["fields"]["supplier"]["value"], supplier)
        self.assertIn("€".encode("utf-8"), data)
        self.assertEqual(validate("extractionResult", result), [])

    def test_no_socket_is_ever_created(self) -> None:
        self.write_profile()
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(socket, "socket", side_effect=AssertionError("rete")):
            code = main(
                ["extract", "--pdf", str(self.pdf), "--profiles", str(self.profiles), "--at", AT],
                stdout,
                stderr,
            )
        self.assertEqual(code, 0, stderr.getvalue())
        self.assertEqual(json.loads(stdout.getvalue())["status"], "riconosciuta")

    def test_invalid_final_document_gives_code_two_and_no_output(self) -> None:
        self.write_profile()
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch("bollette_pdf.__main__.validate", return_value=["campo: valore segreto"]):
            code = main(
                ["extract", "--pdf", str(self.pdf), "--profiles", str(self.profiles), "--at", AT],
                stdout,
                stderr,
            )
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn("segreto", stderr.getvalue())
        self.assertNotEqual(stderr.getvalue(), "")

    def assertInternalError(self, target: str, error: Exception) -> None:
        self.write_profile()
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch(target, side_effect=error):
            code = main(
                ["extract", "--pdf", str(self.pdf), "--profiles", str(self.profiles), "--at", AT],
                stdout,
                stderr,
            )
        self.assertEqual(code, 2)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "Errore interno: nessun output.\n")

    def test_unexpected_errors_give_code_two_and_a_constant_message(self) -> None:
        self.assertInternalError("bollette_pdf.__main__.extract", ValueError("testo riservato"))
        self.assertInternalError("bollette_pdf.__main__.load_profiles", OSError("percorso riservato"))
        self.assertInternalError("bollette_pdf.__main__.read_pdf", RuntimeError("contenuto riservato"))


class ErrorsTest(CliTestCase):
    def assertRejected(self, completed: subprocess.CompletedProcess) -> None:
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, b"")
        self.assertNotEqual(completed.stderr, b"")
        self.assertNotIn(b"Luce Inventata", completed.stderr)
        self.assertNotIn(b"Totale", completed.stderr)
        self.assertNotIn(str(self.dir).encode(), completed.stderr)

    def test_missing_pdf_file(self) -> None:
        self.assertRejected(self.extract(pdf=self.dir / "non-esiste.pdf"))

    def test_directory_as_pdf(self) -> None:
        self.assertRejected(self.extract(pdf=self.dir))

    def test_missing_profiles_directory(self) -> None:
        self.assertRejected(self.extract(profiles=self.dir / "non-esiste"))

    def test_file_as_profiles_directory(self) -> None:
        self.assertRejected(self.extract(profiles=self.pdf))

    def test_bad_at(self) -> None:
        for at in (
            "2026-13-40",
            "2026-02-29",
            "tomorrow",
            "",
            "2026-11-11T25:00",
            "2026-11-11T09:60",
            "2026-11-11 09:30",
            "2026-11-11T09:30+25:00",
            "2026-11-11T09:30:15.Z",
            "11/11/2026",
        ):
            with self.subTest(at=at):
                self.assertRejected(self.extract(at=at))

    def test_missing_arguments(self) -> None:
        self.assertRejected(run_cli("extract", "--profiles", str(self.profiles), "--at", AT))
        self.assertRejected(run_cli("extract", "--pdf", str(self.pdf), "--at", AT))
        self.assertRejected(run_cli("extract", "--pdf", str(self.pdf), "--profiles", str(self.profiles)))

    def test_no_subcommand(self) -> None:
        self.assertRejected(run_cli())

    def test_unknown_subcommand(self) -> None:
        self.assertRejected(run_cli("altro"))


class VersionTest(CliTestCase):
    def test_version(self) -> None:
        completed = run_cli("--version")
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, f"{__version__}\n".encode())
        self.assertEqual(completed.stderr, b"")


if __name__ == "__main__":
    unittest.main()
