"""Counts how the extraction engine reads a folder of PDFs (development tool).

    python3 -I python/tools/pdf_report.py --profiles <folder> --at YYYY-MM-DD <folder-of-pdfs>...

Walks the folders recursively (sorted), reads every `*.pdf` in place (read only: nothing is
copied or written) and runs `extract` with the profiles of `--profiles`. Prints ONLY counts: per
supplier (`profileId`, or «(nessun profilo)»), per status, how many fields of the recognised
documents have confidence `high` (the `supplier` field, always high, is not counted), and a
total. It never prints a file name, a path, an amount, a text read from a PDF or an exception
message: any of them can quote the PDFs, which are real. File names starting with `.` are skipped
and a `profileId` that is not a plain slug is shown as «(altro)».
A PDF that cannot be read counts as `illeggibile`. No network, no clock (`--at` is an argument).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, NoReturn, TextIO

# Under -I neither the script's folder nor PYTHONPATH is on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bollette_pdf.__main__ import _utf8_lf  # noqa: E402
from bollette_pdf.extract import extract  # noqa: E402
from bollette_pdf.parse import valid_iso_at  # noqa: E402
from bollette_pdf.profiles import load_profiles  # noqa: E402
from bollette_pdf.reader import read_pdf  # noqa: E402

STATUSES = ("riconosciuta", "da-confermare", "non-riconosciuta", "senza-testo", "illeggibile")
NO_PROFILE = "(nessun profilo)"
OTHER = "(altro)"
_PLAIN_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
ARGUMENTS_ERROR = "Argomenti non validi: serve --profiles <cartella> --at AAAA-MM-GG <cartella>..."
FOLDER_ERROR = "Una cartella indicata non esiste o non è una cartella."
DATE_ERROR = "Il valore di --at non è una data ISO valida."


class _Rejected(Exception):
    """A problem with the arguments: the message is a constant Italian sentence."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:  # argparse would echo what was typed
        raise _Rejected(ARGUMENTS_ERROR)


def _pdfs(folder: Path, unreadable: list[int]) -> list[Path]:
    found: list[Path] = []

    def failed(_error: OSError) -> None:
        unreadable[0] += 1

    for root, dirs, files in os.walk(folder, onerror=failed):
        dirs.sort()
        # Dot files are AppleDouble leftovers (`._x.pdf`), not documents.
        found.extend(
            Path(root) / name
            for name in sorted(files)
            if name.lower().endswith(".pdf") and not name.startswith(".")
        )
    return found


def _read(path: Path, profiles: list[dict[str, Any]], at: str) -> dict[str, Any] | None:
    try:
        return extract(read_pdf(path), profiles, at)
    except Exception:  # PdfReadError or anything else: counted, never shown
        return None


def report(folders: list[Path], profiles: list[dict[str, Any]], ignored: int, at: str) -> str:
    statuses: Counter[str] = Counter()
    suppliers: Counter[str] = Counter()
    high = total_fields = 0
    unreadable = [0]
    seen: set[Path] = set()
    for folder in folders:
        for path in _pdfs(folder, unreadable):
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            result = _read(path, profiles, at)
            status = result["status"] if result is not None else "illeggibile"
            statuses[status] += 1
            profile_id = (result or {}).get("profileId")
            if profile_id is None:
                profile_id = NO_PROFILE
            elif not (isinstance(profile_id, str) and _PLAIN_ID.fullmatch(profile_id)):
                profile_id = OTHER
            suppliers[profile_id] += 1
            if result is not None and status == "riconosciuta":
                # `supplier` is always high (it comes from the profile): not a reading.
                confidences = [
                    f["confidence"] for name, f in result["fields"].items() if name != "supplier"
                ]
                high += confidences.count("high")
                total_fields += len(confidences)
    lines = [f"Totale: {sum(statuses.values())}", "Per stato:"]
    lines += [f"  {status}: {statuses[status]}" for status in STATUSES]
    lines.append("Per fornitore:")
    lines += [f"  {name}: {suppliers[name]}" for name in sorted(suppliers)]
    lines.append(
        f"Campi con confidenza high nelle riconosciute (senza supplier): {high} su {total_fields}"
    )
    if unreadable[0]:
        lines.append(f"Cartelle non leggibili: {unreadable[0]}")
    if ignored:
        lines.append(f"Profili ignorati: {ignored}")
    return "\n".join(lines) + "\n"


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = _utf8_lf(sys.stdout if stdout is None else stdout)
    err = _utf8_lf(sys.stderr if stderr is None else stderr)
    try:
        parser = _Parser(add_help=False)
        parser.add_argument("--profiles", required=True)
        parser.add_argument("--at", required=True)
        parser.add_argument("folders", nargs="+")
        args = parser.parse_args(argv)
        if not valid_iso_at(args.at):
            raise _Rejected(DATE_ERROR)
        folders = [Path(f) for f in args.folders]
        if not all(f.is_dir() for f in [Path(args.profiles), *folders]):
            raise _Rejected(FOLDER_ERROR)
        profiles, warnings = load_profiles(Path(args.profiles))
        text = report(folders, profiles, len(warnings), args.at)
    except _Rejected as rejected:  # only the constant messages above
        err.write(f"{rejected}\n")
        return 2
    except Exception:
        err.write("Errore interno: nessun output.\n")
        return 2
    out.write(text)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
