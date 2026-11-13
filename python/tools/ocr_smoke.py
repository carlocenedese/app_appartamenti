"""Smoke test of the OCR of an installed `bollette_pdf` (the one in the built app, in CI).

    <bundled python> -I python/tools/ocr_smoke.py --ocr-data <folder with ita.traineddata>

Draws an invented one-page scan (text rendered to a grayscale image, no text layer), reads it with
the real engine through `read_pdf` and checks that the OCR text is there. Prints `OCR ok` and
exits 0; otherwise one constant Italian message on stderr and exit 1: the text read is never
quoted. The package is the installed one (not the repository's), the page maker is that of the
tests. No network, no clock.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Under -I neither the script's folder nor PYTHONPATH is on sys.path: only the page maker is added.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

ERROR = "OCR non funzionante: la scansione di prova non è stata letta."
PAGE = [(72, 100, "Totale da pagare 123,45", 14), (300, 300, "Scadenza 31/03/2026", 12)]


def smoke(data_dir: str) -> bool:
    try:
        import make_scan
        from bollette_pdf.reader import read_pdf

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "scansione.pdf"
            make_scan.make_scan_pdf(path, [PAGE])
            doc = read_pdf(path, ocr_data=data_dir)
        return doc.text_source == "ocr" and any("123,45" in line.text for line in doc.lines)
    except Exception:  # whatever the failure, nothing of it is printed
        return False


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] != "--ocr-data":
        print(ERROR, file=sys.stderr)
        return 1
    if not smoke(argv[1]):
        print(ERROR, file=sys.stderr)
        return 1
    print("OCR ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
