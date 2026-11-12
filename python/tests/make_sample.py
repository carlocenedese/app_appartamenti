"""Writes synthetic sample files for the integration test of the TypeScript core.

    python3 -I python/tests/make_sample.py <folder>

Into <folder> it writes, all invented (supplier, numbers, amounts, dates; the POD is the
fictitious one of fixtures/README.md):

- `bolletta-marzo.pdf` and `bolletta-maggio.pdf`: two bills of the same supplier and layout,
  with different numbers, dates, periods and amounts;
- `guasto.pdf`: bytes that are not a PDF; `senza-testo.pdf`: a page without text;
- `_app/dati/supplierProfile/luce-esempio.json`: a valid supplier profile in `bozza` (rev 1,
  autoRegister false) that reads both bills with confidence `high`, at the path the app uses.

The profile is validated with the package's own schema before it is written. Prints nothing;
exit code 0 on success. No network, no clock.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
# Under -I neither the script's folder nor PYTHONPATH is on sys.path.
sys.path.insert(0, str(TESTS_DIR.parent))
sys.path.insert(0, str(TESTS_DIR))

import pdfmaker  # noqa: E402
from bollette_pdf.schemas import validate  # noqa: E402

PROFILE_ID = "luce-esempio"
SUPPLIER = "Luce Esempio"
POD = "IT001E12345678"
FILLER = "Testo di riempimento della bolletta inventata, con abbastanza caratteri per la lettura."
EURO = "([0-9.]*[0-9],[0-9]{2})"
DATE = "([0-9]{2}/[0-9]{2}/[0-9]{4})"

BILLS = {
    "bolletta-marzo.pdf": {
        "number": "LE-2026-0101",
        "issue": "10/03/2026",
        "due": "31/03/2026",
        "period": "dal 01/01/2026 al 28/02/2026",
        "consumption": "212,5 kWh",
        "amount": "64,30",
    },
    "bolletta-maggio.pdf": {
        "number": "LE-2026-0177",
        "issue": "12/05/2026",
        "due": "02/06/2026",
        "period": "dal 01/03/2026 al 30/04/2026",
        "consumption": "187,0 kWh",
        "amount": "58,15",
    },
}


def _rule(anchor: str, pattern: str, value_type: str) -> dict:
    return {
        "anchor": anchor,
        "position": "same-line",
        "pattern": pattern,
        "valueType": value_type,
        "group": 1,
    }


def profile() -> dict:
    return {
        "id": PROFILE_ID,
        "v": 1,
        "rev": 1,
        "supplier": SUPPLIER,
        "kind": "bill",
        "category": "elettricita",
        "status": "bozza",
        "autoRegister": False,
        "validFrom": "2025-01-01",
        "recognise": {"allOf": ["luce esempio spa"], "noneOf": []},
        "fields": {
            "number": {"required": True, "rules": [_rule("Fattura n.", r"(\S+)", "text")]},
            "issueDate": {"required": True, "rules": [_rule("Data emissione", DATE, "date")]},
            "dueDate": {"required": True, "rules": [_rule("Scadenza", DATE, "date")]},
            "period": {
                "required": True,
                "rules": [_rule("Periodo di fornitura", "(dal .+ al [0-9/]+)", "date-range")],
            },
            "consumption": {
                "required": False,
                "rules": [_rule("Consumo", "([0-9.,]+ ?[A-Za-z]*)", "quantity")],
            },
            "amount": {"required": True, "rules": [_rule("Totale da pagare", EURO, "euro")]},
        },
        "identifiers": [{"kind": "pod", "pattern": "POD (IT[0-9]{3}E[0-9]{8})"}],
    }


def _page(bill: dict) -> list[tuple[float, float, str]]:
    return [
        (72, 80, f"{SUPPLIER} SpA"),
        (72, 100, f"Fattura n. {bill['number']}"),
        (72, 120, f"Data emissione {bill['issue']}"),
        (72, 140, f"Scadenza {bill['due']}"),
        (72, 160, f"Periodo di fornitura {bill['period']}"),
        (72, 180, f"POD {POD}"),
        (72, 200, f"Consumo {bill['consumption']}"),
        (72, 220, f"Totale da pagare € {bill['amount']}"),
        (72, 400, FILLER),
    ]


def write_samples(folder: Path) -> None:
    record = profile()
    if validate("supplierProfile", record):
        raise SystemExit("Profilo di prova non valido.")
    folder.mkdir(parents=True, exist_ok=True)
    for name, bill in BILLS.items():
        pdfmaker.make_pdf(folder / name, [_page(bill)])
    (folder / "guasto.pdf").write_bytes(b"%PDF-1.4\nquesto non e un PDF completo\n")
    pdfmaker.make_blank_pdf(folder / "senza-testo.pdf")
    profiles = folder / "_app" / "dati" / "supplierProfile"
    profiles.mkdir(parents=True, exist_ok=True)
    (profiles / f"{PROFILE_ID}.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write("Uso: make_sample.py <cartella>\n")
        return 2
    write_samples(Path(argv[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
