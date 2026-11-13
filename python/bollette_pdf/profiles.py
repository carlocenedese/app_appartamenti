"""Supplier profiles: loading them from a folder and finding those that recognise a document.

A profile is a `supplierProfile` record (one JSON file per record). `load_profiles` never stops on
a bad file: it reports it in an Italian warning that names only the file, never its content.
No network, no clock.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

from .reader import Document
from .schemas import validate


def normalize(text: str) -> str:
    """NFC, case-folded, whitespace runs collapsed to one space and trimmed."""
    return " ".join(unicodedata.normalize("NFC", text).casefold().split())


def load_profiles(directory: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """The valid, not deleted profiles of `*.json` files in `directory`, sorted by file name.

    Returns (profiles, warnings). A file that cannot be read, is not JSON or is not a valid
    profile is skipped with a warning naming only the file.
    """
    directory = Path(directory)
    if not directory.is_dir():
        return [], ["La cartella dei profili dei fornitori non esiste: nessun profilo letto."]
    profiles: list[dict[str, Any]] = []
    warnings: list[str] = []
    for path in sorted(directory.glob("*.json"), key=lambda item: item.name):
        if not path.is_file():
            continue
        name = unicodedata.normalize("NFC", path.name)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError, RecursionError):
            warnings.append(f"Profilo «{name}» non leggibile: ignorato.")
            continue
        if isinstance(data, dict) and data.get("deleted") is True:
            continue
        if validate("supplierProfile", data):
            # The validation errors may quote values of the file: they are not reported.
            warnings.append(f"Profilo «{name}» non valido: ignorato.")
            continue
        profiles.append(data)
    return profiles, warnings


def normalize_ocr(text: str) -> str:
    """For OCR text (rule R89): NFKD without accents, case-folded, every run of characters that
    are not letters or digits (punctuation, line breaks, spaces) is one space, trimmed."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join("".join(c if c.isalnum() else " " for c in folded.casefold()).split())


def recognises(profile: dict[str, Any], pdf_text: str, ocr_text: str = "") -> bool:
    """Every `allOf` text is in the PDF text (`normalize`) or in the OCR text (`normalize_ocr`),
    or (R90) a word of `ocrAnyOf` is in the OCR text; none of `noneOf` is."""

    def found(condition: str) -> bool:
        folded = normalize_ocr(condition)
        return normalize(condition) in pdf_text or (folded != "" and folded in ocr_text)

    recognise = profile["recognise"]
    if any(found(text) for text in recognise["noneOf"]):
        return False
    padded = f" {ocr_text} "
    anchored = any(
        folded != "" and f" {folded} " in padded
        for folded in map(normalize_ocr, recognise.get("ocrAnyOf", []))
    )
    return anchored or all(found(text) for text in recognise["allOf"])


def matching_profiles(doc: Document, profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Profiles that recognise `doc`, newest `validFrom` first (ties by `id`).

    The lines read with OCR (`doc.ocr_pages`) are compared folded (R89); the others as they are.
    """
    pdf_lines = [line.text for line in doc.lines if line.page not in doc.ocr_pages]
    ocr_lines = [line.text for line in doc.lines if line.page in doc.ocr_pages]
    pdf_text = normalize("\n".join(pdf_lines))
    ocr_text = normalize_ocr("\n".join(ocr_lines))
    found = [profile for profile in profiles if recognises(profile, pdf_text, ocr_text)]
    found.sort(key=lambda profile: profile["id"])
    found.sort(key=lambda profile: profile["validFrom"], reverse=True)
    return found
