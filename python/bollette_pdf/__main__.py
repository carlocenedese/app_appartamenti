"""Command line of bollette_pdf.

    python -I -m bollette_pdf extract --pdf <file> --profiles <directory> --at <ISO date(-time)>
    python -I -m bollette_pdf --version

Prints ONE JSON document (a validated ExtractionResult) and a newline on stdout, in UTF-8 with
`\\n` line endings. Exit code 0 for every valid result (also non-riconosciuta, senza-testo and
illeggibile), 2 for wrong arguments, an unreadable path or a result that does not validate.
Messages on stderr are generic Italian sentences: they never contain text read from a PDF, a
profile or a path.

No network, no clock, no randomness; nothing is written to disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any, NoReturn, TextIO

from . import __version__
from .extract import extract
from .profiles import load_profiles
from .reader import PdfReadError, read_pdf
from .schemas import validate

EXIT_OK = 0
EXIT_ERROR = 2
INTERNAL_ERROR = "Errore interno: nessun output."

# YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]] and a zone (Z or ±HH:MM).
_AT = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})"
    r"(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?"
    r"(?:Z|[+-]([0-9]{2}):([0-9]{2}))?)?"
)
# Keys first, in the order of the schema; the rest follows in the order of `extract`.
_HEAD_KEYS = ("v", "engineVersion", "fileHash", "fileName", "pages", "status")


class _Rejected(Exception):
    """A problem with the arguments: the message is a generic Italian sentence."""


class _Parser(argparse.ArgumentParser):
    """argparse with Italian generic messages: it never echoes what was typed."""

    def __init__(self, streams: tuple[TextIO, TextIO], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._stdout, self._stderr = streams

    def error(self, message: str) -> NoReturn:
        self._stderr.write("Argomenti non validi: vedere l'uso con --help.\n")
        raise SystemExit(EXIT_ERROR)

    def _print_message(self, message: str, file: TextIO | None = None) -> None:
        if message:
            (file or self._stdout).write(message)


def _build_parser(stdout: TextIO, stderr: TextIO) -> argparse.ArgumentParser:
    streams = (stdout, stderr)
    parser = _Parser(
        streams,
        prog="bollette_pdf",
        description="Legge una bolletta in PDF e stampa un risultato JSON.",
        add_help=False,
    )
    parser.add_argument("-h", "--help", action="help", help="mostra questo aiuto")
    parser.add_argument("--version", action="store_true", help="stampa la versione")
    sub = parser.add_subparsers(dest="command", parser_class=_sub_parser_factory(streams))
    command = sub.add_parser("extract", help="estrae i dati di una bolletta", add_help=False)
    command.add_argument("-h", "--help", action="help", help="mostra questo aiuto")
    command.add_argument("--pdf", required=True, help="file PDF da leggere")
    command.add_argument("--profiles", required=True, help="cartella dei profili dei fornitori")
    command.add_argument("--at", required=True, help="data o data-ora ISO di riferimento")
    return parser


def _sub_parser_factory(streams: tuple[TextIO, TextIO]) -> Callable[..., _Parser]:
    def make(**kwargs: Any) -> _Parser:
        return _Parser(streams, **kwargs)

    return make


def _valid_at(value: str) -> bool:
    match = _AT.fullmatch(value)
    if match is None:
        return False
    year, month, day = int(match[1]), int(match[2]), int(match[3])
    try:
        date(year, month, day)
    except ValueError:
        return False
    hour = int(match[4]) if match[4] is not None else 0
    minute = int(match[5]) if match[5] is not None else 0
    second = int(match[6]) if match[6] is not None else 0
    if hour > 23 or minute > 59 or second > 59:
        return False
    if match[7] is not None and (int(match[7]) > 23 or int(match[8]) > 59):
        return False
    return True


def _is_file(value: str) -> bool:
    try:
        return Path(value).is_file()
    except (OSError, ValueError):
        return False


def _is_dir(value: str) -> bool:
    try:
        return Path(value).is_dir()
    except (OSError, ValueError):
        return False


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _complete(result: dict[str, Any], file_name: str) -> dict[str, Any]:
    full: dict[str, Any] = {
        "v": result["v"],
        "engineVersion": __version__,
        "fileHash": result["fileHash"],
        "fileName": file_name,
        "pages": result["pages"],
        "status": result["status"],
    }
    for key, value in result.items():
        if key not in _HEAD_KEYS:
            full[key] = value
    return full


def _unreadable(file_hash: str, file_name: str, message: str) -> dict[str, Any]:
    return {
        "v": 1,
        "fileHash": file_hash,
        "pages": 0,
        "status": "illeggibile",
        "profileId": None,
        "profileRev": None,
        "kind": None,
        "category": None,
        "fields": {},
        "parts": [],
        "identifiers": [],
        "checks": [],
        "warnings": [message],
    }


def _print_json(document: dict[str, Any], stdout: TextIO) -> None:
    text = json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n"
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        # Lone surrogates (from an odd file name): escape them, the JSON stays valid.
        text = json.dumps(document, ensure_ascii=True, separators=(",", ":")) + "\n"
    reconfigure = getattr(stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", newline="\n")
        stdout.write(text)
        stdout.flush()
        return
    buffer = getattr(stdout, "buffer", None)
    if buffer is not None:
        buffer.write(text.encode("utf-8"))
        buffer.flush()
        return
    stdout.write(text)
    stdout.flush()


def _run_extract(pdf: str, profiles: str, at: str, stdout: TextIO) -> None:
    if not _is_file(pdf):
        raise _Rejected("Il file indicato con --pdf non esiste o non è un file.")
    if not _is_dir(profiles):
        raise _Rejected("La cartella indicata con --profiles non esiste o non è una cartella.")
    if not _valid_at(at):
        raise _Rejected("Il valore di --at non è una data o data-ora ISO valida.")
    path = Path(pdf)
    file_name = _nfc(path.name)
    try:
        data = path.read_bytes()
    except OSError:
        raise _Rejected("Impossibile leggere il file indicato con --pdf.") from None
    loaded, warnings = load_profiles(Path(profiles))
    try:
        doc = read_pdf(path)
    except PdfReadError as error:
        result = _unreadable(hashlib.sha256(data).hexdigest(), file_name, str(error))
        warnings = []
    else:
        result = extract(doc, loaded, at)
    final = _complete(result, file_name)
    final["warnings"] = [*warnings, *result["warnings"]]
    if validate("extractionResult", final):
        # The validator messages may quote values of the document: they are not reported.
        raise _Rejected("Il risultato non è valido secondo lo schema: nessun output.")
    _print_json(final, stdout)


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = sys.stdout if stdout is None else stdout
    err = sys.stderr if stderr is None else stderr
    parser = _build_parser(out, err)
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else EXIT_ERROR
    if args.version:
        out.write(f"{__version__}\n")
        out.flush()
        return EXIT_OK
    if args.command != "extract":
        err.write("Manca il comando: usare «extract» oppure --version.\n")
        return EXIT_ERROR
    try:
        _run_extract(args.pdf, args.profiles, args.at, out)
    except _Rejected as rejected:
        err.write(f"{rejected}\n")
        return EXIT_ERROR
    except Exception:
        # Never show the exception: its message may quote text read from the PDF or a path.
        err.write(f"{INTERNAL_ERROR}\n")
        return EXIT_ERROR
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
