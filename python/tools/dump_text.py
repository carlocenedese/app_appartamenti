"""Prints the text layer of one PDF as a JSON document (development tool).

    python3 -I python/tools/dump_text.py <file.pdf>

Stdout: `dump_document(read_pdf(file))` as ONE JSON document and a newline, UTF-8 with `\\n`. This
is the input of `load_dump`, to write tests without keeping the PDF. The output contains the text
of the PDF: do not commit it unless the PDF is invented. Exit code 2 with one constant Italian
message on stderr for a missing or unreadable file; no path or text of the PDF is ever quoted.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TextIO

# Under -I neither the script's folder nor PYTHONPATH is on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bollette_pdf.__main__ import _print_json, _utf8_lf  # noqa: E402
from bollette_pdf.reader import dump_document, read_pdf  # noqa: E402

ERROR = "File non indicato, non esistente o non leggibile: nessun output."


def main(argv: list[str], stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = _utf8_lf(sys.stdout if stdout is None else stdout)
    err = _utf8_lf(sys.stderr if stderr is None else stderr)
    try:
        if len(argv) != 1:
            raise ValueError
        _print_json(dump_document(read_pdf(Path(argv[0]))), out)
    except Exception:  # the message of a PDF error may quote text of the PDF
        err.write(f"{ERROR}\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
