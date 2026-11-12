"""Command line of bollette_pdf.

    python -I -m bollette_pdf extract --pdf <file> --profiles <directory> --at <ISO date(-time)>
    python -I -m bollette_pdf build-profile --pdf <file> --spec <file.json> --at <ISO date(-time)>
    python -I -m bollette_pdf --version

`extract` prints ONE JSON document (a validated ExtractionResult) and a newline on stdout, in
UTF-8 with `\\n` line endings (stderr is UTF-8 too, on every system). Exit code 0 for every
valid result (also non-riconosciuta, senza-testo and illeggibile), 2 for wrong arguments, an
unreadable path or a result that does not validate. `build-profile` prints, the same way, the
supplierProfile built from the selections of the spec file (see `_read_spec`); a malformed spec,
an unreadable PDF or a selection that cannot be turned into a profile give code 2 and a constant
message.
Messages on stderr are generic Italian sentences: they never contain text read from a PDF, a
profile or a path.

No network, no clock, no randomness; nothing is written to disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Any, NoReturn, TextIO

from . import __version__
from .builder import ProfileDataError, Selection, build_profile
from .extract import extract
from .parse import valid_iso_at
from .profiles import load_profiles
from .reader import PdfReadError, read_pdf
from .schemas import validate

EXIT_OK = 0
EXIT_ERROR = 2
INTERNAL_ERROR = "Errore interno: nessun output."
SPEC_ERROR = "Specifica non valida: nessun profilo costruito."
SELECTION_ERROR = "Selezione non valida: nessun profilo costruito."
_SPEC_KEYS = frozenset(
    {"profileId", "supplier", "kind", "category", "validFrom", "recognise", "fields"}
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
    build = sub.add_parser(
        "build-profile", help="costruisce un profilo da selezioni di testo", add_help=False
    )
    build.add_argument("-h", "--help", action="help", help="mostra questo aiuto")
    build.add_argument("--pdf", required=True, help="file PDF da leggere")
    build.add_argument("--spec", required=True, help="file JSON con il profilo e le selezioni")
    build.add_argument("--at", required=True, help="data o data-ora ISO di riferimento")
    return parser


def _sub_parser_factory(streams: tuple[TextIO, TextIO]) -> Callable[..., _Parser]:
    def make(**kwargs: Any) -> _Parser:
        return _Parser(streams, **kwargs)

    return make


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


class _Utf8Writer:
    """Writes text as UTF-8 to the byte buffer of a stream that cannot be reconfigured."""

    def __init__(self, stream: Any) -> None:
        self._stream = stream

    def write(self, text: str) -> int:
        self._stream.flush()
        self._stream.buffer.write(text.encode("utf-8", "backslashreplace"))
        self._stream.buffer.flush()
        return len(text)

    def flush(self) -> None:
        self._stream.flush()


def _utf8_errors(stream: TextIO) -> TextIO:
    """`stream` writing UTF-8, like stdout. On Windows a piped stderr is in the ANSI code page,
    where the caller (which reads UTF-8) would get «è» as an invalid byte."""
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is not None:
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, OSError, ValueError):
            pass
        else:
            return stream
    if getattr(stream, "buffer", None) is not None:
        return _Utf8Writer(stream)  # type: ignore[return-value]
    return stream


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
    if not valid_iso_at(at):
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


def _selection(raw: Any) -> Selection:
    if not isinstance(raw, dict) or set(raw) != {"page", "box"}:
        raise _Rejected(SPEC_ERROR)
    page, box = raw["page"], raw["box"]
    if isinstance(page, float) and page.is_integer():
        page = int(page)
    if isinstance(page, bool) or not isinstance(page, int):
        raise _Rejected(SPEC_ERROR)
    if not isinstance(box, list) or len(box) != 4:
        raise _Rejected(SPEC_ERROR)
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in box):
        raise _Rejected(SPEC_ERROR)
    return Selection(page, (box[0], box[1], box[2], box[3]))


def _read_spec(path: Path) -> dict[str, Any]:
    """The spec file: {"profileId", "supplier", "kind", "category", "validFrom",
    "recognise": [{"page", "box"}], "fields": {"<field>": {"page", "box"}}}, box being
    [x0, top, x1, bottom] in points from the top-left of the page."""
    try:
        spec = json.loads(path.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError, RecursionError):
        raise _Rejected(SPEC_ERROR) from None
    if not isinstance(spec, dict) or set(spec) != _SPEC_KEYS:
        raise _Rejected(SPEC_ERROR)
    for key in ("profileId", "supplier", "kind", "validFrom"):
        if not isinstance(spec[key], str):
            raise _Rejected(SPEC_ERROR)
    if spec["category"] is not None and not isinstance(spec["category"], str):
        raise _Rejected(SPEC_ERROR)
    if not isinstance(spec["recognise"], list) or not isinstance(spec["fields"], dict):
        raise _Rejected(SPEC_ERROR)
    return {
        "profile_id": spec["profileId"],
        "supplier": spec["supplier"],
        "kind": spec["kind"],
        "category": spec["category"],
        "valid_from": spec["validFrom"],
        "recognise": [_selection(raw) for raw in spec["recognise"]],
        "fields": {name: _selection(raw) for name, raw in spec["fields"].items()},
    }


def _run_build(pdf: str, spec_path: str, at: str, stdout: TextIO) -> None:
    if not _is_file(pdf):
        raise _Rejected("Il file indicato con --pdf non esiste o non è un file.")
    if not _is_file(spec_path):
        raise _Rejected("Il file indicato con --spec non esiste o non è un file.")
    if not valid_iso_at(at):
        raise _Rejected("Il valore di --at non è una data o data-ora ISO valida.")
    arguments = _read_spec(Path(spec_path))
    try:
        doc = read_pdf(Path(pdf))
    except PdfReadError as error:
        raise _Rejected(str(error)) from None
    try:
        profile = build_profile(doc, now=at, **arguments)
    except ProfileDataError:
        raise _Rejected(SPEC_ERROR) from None
    except ValueError:
        # The builder's messages name a field at most; the command keeps one constant message.
        raise _Rejected(SELECTION_ERROR) from None
    _print_json(profile, stdout)


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = sys.stdout if stdout is None else stdout
    err = _utf8_errors(sys.stderr if stderr is None else stderr)
    parser = _build_parser(out, err)
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else EXIT_ERROR
    if args.version:
        out.write(f"{__version__}\n")
        out.flush()
        return EXIT_OK
    if args.command not in ("extract", "build-profile"):
        err.write("Manca il comando: usare «extract», «build-profile» oppure --version.\n")
        return EXIT_ERROR
    try:
        if args.command == "extract":
            _run_extract(args.pdf, args.profiles, args.at, out)
        else:
            _run_build(args.pdf, args.spec, args.at, out)
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
