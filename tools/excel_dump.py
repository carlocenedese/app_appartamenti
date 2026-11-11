"""Dump the formulas and the cached values of an .xlsx workbook as one JSON document.

Usage:
    python3 -I tools/excel_dump.py [--sheet NAME]... [--formulas-only] <file.xlsx>

The workbook is opened twice with openpyxl: with ``data_only=False`` to read the formulas and
with ``data_only=True`` to read the values Excel cached the last time it saved the file.
openpyxl never computes formulas: a formula cell has ``"value": null`` when the file carries no
cached value (for example a workbook written by openpyxl itself and never opened in Excel).

Output (stdout, one JSON document, UTF-8, nothing else):

    {"file": "<basename>",
     "sheets": [{"name": "...", "dimensions": "A1:K40",
                 "cells": [{"coord": "B7", "row": 7, "col": 2,
                            "formula": "=SUM(B2:B6)" | null,
                            "value": <number | string | boolean | ISO date string | null>,
                            "type": "n" | "s" | "b" | "d" | "e" | null,
                            "number_format": "General"}],
                 "merged": ["A1:C1"]}]}

Every cell with a formula or a value is listed, in sheet order, then row, then column. Dates,
datetimes and times are ISO 8601 strings (an Excel date is a datetime at midnight). ``type`` is
the type of the cached value: n number, s string, b boolean, d date, e error (``value`` is then
the Excel error text, for example "#DIV/0!"), null when there is no value.

The script only reads the file it is given: it writes no file, opens no network connection and
prints nothing but the JSON document on stdout. Errors go to stderr with exit code 2.
"""

from __future__ import annotations

import argparse
import datetime
import decimal
import json
import os
import sys
import warnings
import zipfile
from typing import Any

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException

EXIT_ERROR = 2

# openpyxl data types of a cached value -> the type letters of the output.
_TYPE_LETTERS = {
    "n": "n",
    "s": "s",
    "str": "s",
    "inlineStr": "s",
    "b": "b",
    "d": "d",
    "e": "e",
}


class DumpError(Exception):
    """A problem with the input that the user can fix; the message is printed on stderr."""


def _json_value(value: Any) -> Any:
    """Converts a cell value to something json can write: ISO strings for dates, plain numbers."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, decimal.Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    return str(value)


def _type_letter(data_type: str, value: Any) -> str | None:
    """Type letter of a cached value, or None when the cell has no value."""
    if value is None:
        return None
    letter = _TYPE_LETTERS.get(data_type)
    if letter is not None:
        return letter
    # Unknown openpyxl data type: fall back on the Python type of the value.
    if isinstance(value, bool):
        return "b"
    if isinstance(value, (int, float, decimal.Decimal)):
        return "n"
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return "d"
    return "s"


def _formula_text(value: Any) -> str:
    """The formula of a formula cell as text starting with "="."""
    if isinstance(value, str):
        return value
    text = getattr(value, "text", None)  # ArrayFormula
    if isinstance(text, str):
        return text if text.startswith("=") else "=" + text
    return f"=TABLE({getattr(value, 'ref', '')})"  # DataTableFormula


def _cell_records(formula_sheet: Any, values_sheet: Any, formulas_only: bool) -> list[dict]:
    """One record per non-empty cell, ordered by row then column.

    Reads the cells openpyxl actually holds (``_cells``, stable since openpyxl 2.x) instead of
    walking ``iter_rows()``, which would materialise every cell of the bounding box: a single
    styled cell far away from the data would otherwise cost millions of objects.
    """
    value_cells = values_sheet._cells
    records = []
    for key in sorted(formula_sheet._cells):
        cell = formula_sheet._cells[key]
        has_formula = cell.data_type == "f"
        if formulas_only and not has_formula:
            continue
        value_cell = value_cells.get(key)
        value = value_cell.value if value_cell is not None else None
        if not has_formula and value is None:
            continue
        data_type = value_cell.data_type if value_cell is not None else "n"
        records.append(
            {
                "coord": cell.coordinate,
                "row": cell.row,
                "col": cell.column,
                "formula": _formula_text(cell.value) if has_formula else None,
                "value": _json_value(value),
                "type": _type_letter(data_type, value),
                "number_format": cell.number_format,
            }
        )
    return records


def _merged_ranges(sheet: Any) -> list[str]:
    ranges = sorted(
        sheet.merged_cells.ranges,
        key=lambda r: (r.min_row, r.min_col, r.max_row, r.max_col),
    )
    return [r.coord for r in ranges]


def _load(path: str, data_only: bool) -> Any:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # openpyxl warns about unsupported extensions, harmless
        return openpyxl.load_workbook(path, data_only=data_only)


def build_dump(path: str, sheets: list[str] | None = None, formulas_only: bool = False) -> dict:
    """Reads the workbook at ``path`` and returns the document described in the module docstring.

    Raises DumpError when the file is missing, is not a readable .xlsx, or ``sheets`` names a
    sheet it does not contain.
    """
    name = os.path.basename(path)
    try:
        formula_book = _load(path, data_only=False)
        values_book = _load(path, data_only=True)
    except FileNotFoundError:
        raise DumpError(f"file non trovato: {name}") from None
    except (IsADirectoryError, PermissionError):
        raise DumpError(f"impossibile aprire il file: {name}") from None
    except (InvalidFileException, zipfile.BadZipFile, KeyError):
        raise DumpError(f"non è un file .xlsx valido: {name}") from None
    except Exception as error:  # a corrupt workbook can fail in many ways inside openpyxl
        raise DumpError(f"impossibile leggere il file {name} ({type(error).__name__})") from None

    try:
        titles = [sheet.title for sheet in formula_book.worksheets]
        unknown = [wanted for wanted in (sheets or []) if wanted not in titles]
        if unknown:
            raise DumpError(
                "foglio non trovato: "
                + ", ".join(repr(wanted) for wanted in unknown)
                + "; fogli presenti: "
                + ", ".join(repr(title) for title in titles)
            )
        selected = set(sheets) if sheets else set(titles)
        values_by_title = {sheet.title: sheet for sheet in values_book.worksheets}
        return {
            "file": name,
            "sheets": [
                {
                    "name": sheet.title,
                    "dimensions": sheet.dimensions,
                    "cells": _cell_records(sheet, values_by_title[sheet.title], formulas_only),
                    "merged": _merged_ranges(sheet),
                }
                for sheet in formula_book.worksheets
                if sheet.title in selected
            ],
        }
    finally:
        formula_book.close()
        values_book.close()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="excel_dump.py",
        description=(
            "Stampa su stdout un documento JSON con formule, valori calcolati (quelli salvati "
            "da Excel nel file) e formati di ogni cella non vuota di un file .xlsx."
        ),
    )
    parser.add_argument("file", help="file .xlsx da leggere (non viene modificato)")
    parser.add_argument(
        "--sheet",
        action="append",
        metavar="NOME",
        help="limita l'output al foglio NOME (ripetibile)",
    )
    parser.add_argument(
        "--formulas-only",
        action="store_true",
        help="stampa solo le celle che contengono una formula",
    )
    return parser.parse_args(argv)  # argparse exits with code 2 on a usage error


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        document = build_dump(args.file, args.sheet, args.formulas_only)
        text = json.dumps(document, ensure_ascii=False, allow_nan=False)
    except DumpError as error:
        print(f"excel_dump: {error}", file=sys.stderr)
        return EXIT_ERROR
    # Bytes, not text: the encoding must not depend on the locale of the terminal or the CI.
    sys.stdout.buffer.write(text.encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
