"""A supplier profile built from text selections on a PDF (plan 2a, Task 7).

The screen of plan 4 lets the user drag a box over text: `build_profile` turns those boxes into a
`supplierProfile` record. Rules (controller decisions of plan 2a, Task 7, and ruling R60):

- the text of a selection is the words of its page whose box centre lies inside the selection,
  in reading order, joined by single spaces;
- `recognise.allOf` holds the lower-cased text of every recognition selection (at least
  MIN_RECOGNISE_CHARS characters, duplicates dropped);
- for a field, the anchor is the text nearest to the LEFT of the selection on its row: the 1 to
  MAX_ANCHOR_WORDS words just before it in its own line (`same-line`), or the last words of the
  nearest line on the row that ends before it (`right`); with nothing on the left, words of the
  line just above that overlaps it horizontally (`below`). The shortest anchor that reads the
  selected value back with confidence `high` wins;
- the pattern generalises the shape of the selected text (`shape_pattern`), so that a bill with the
  same layout and other values is read too;
- the built profile is read back with `extract` on the same document: every field must give the
  selected value with `high`, otherwise ValueError.

Error messages are Italian and generic: they name a field at most, never text of the document.
No network, no clock: `now` is an argument (validated, not stored: the record has no timestamp).
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .extract import extract
from .locate import BELOW_ROWS, Layout, word_key
from .parse import (
    parse_date,
    parse_date_range,
    parse_euro,
    parse_quantity,
    valid_iso_at,
)
from .reader import ROW_TOLERANCE, Document, Word
from .schemas import FIELD_VALUE_TYPES, validate

MAX_ANCHOR_WORDS = 4
MIN_RECOGNISE_CHARS = 3
FIELD_ORDER = ("number", "issueDate", "dueDate", "period", "amount", "consumption")
REQUIRED_FIELDS = frozenset({"amount"})


class ProfileDataError(ValueError):
    """A value of the profile itself (id, supplier, kind, category, dates) is not valid."""


@dataclass(frozen=True)
class Selection:
    """A box drawn on a page: (x0, top, x1, bottom) in points from the top-left; page from 1."""

    page: int
    box: tuple[float, float, float, float]


# --- Patterns -----------------------------------------------------------------------------------

_MINUS = "[-−–]"
_EURO_COMMA = rf"((?:{_MINUS}\s?)?(?:\d{{1,3}}(?:\.\d{{3}})+|\d+),\d{{2}})(?!\d)"
_EURO_POINT = rf"((?:{_MINUS}\s?)?\d+\.\d{{2}})(?!\d)"
_NUMERIC_DATE = r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
_TEXT_DATE = r"\d{1,2}[°º]?\s+[A-Za-z]+\.?\s+\d{2,4}"
_QUANTITY = r"(\d[\d.]*(?:,\d+)?\s*[A-Za-zµ]+[²³]?)"
_TEXT = r"(\S+(?: \S+)*)"
_RANGE_SEPARATORS = {
    "al": r"\s+[Aa]l\s+",
    "-": r"\s*-\s*",
    "–": r"\s*–\s*",
    "—": r"\s*—\s*",
    "/": r"\s*/\s*",
}
_RANGE_SHAPE = re.compile(
    rf"(?:dal\s+)?({_NUMERIC_DATE}|{_TEXT_DATE})(\s+al\s+|\s*[-–—/]\s*)({_NUMERIC_DATE}|{_TEXT_DATE})",
    re.IGNORECASE,
)


def _date_shape(text: str) -> str:
    if re.fullmatch(_NUMERIC_DATE, text):
        return _NUMERIC_DATE
    if re.fullmatch(_TEXT_DATE, text):
        return _TEXT_DATE
    raise ValueError("Data non leggibile.")


def selected_value(text: str, value_type: str) -> Any:
    """The value of a selected text read as `value_type`, as `extract` reports it."""
    if value_type == "euro":
        return parse_euro(text)
    if value_type == "date":
        return parse_date(text)
    if value_type == "date-range":
        return parse_date_range(text)
    if value_type == "quantity":
        quantity, unit = parse_quantity(text)
        if unit is None:
            raise ValueError("Quantità senza unità.")
        return {"quantity": quantity, "unit": unit}
    if value_type == "text":
        if not text.strip():
            raise ValueError("Testo vuoto.")
        return text.strip()
    raise ValueError("Tipo di valore sconosciuto.")


def _raw_shape(text: str, value_type: str) -> str:
    if value_type == "euro":
        return _EURO_COMMA if "," in text else _EURO_POINT
    if value_type == "date":
        return f"({_date_shape(text)})"
    if value_type == "date-range":
        match = _RANGE_SHAPE.fullmatch(text)
        if match is None:
            raise ValueError("Periodo non leggibile.")
        separator = _RANGE_SEPARATORS[match.group(2).strip().lower()]
        start, end = _date_shape(match.group(1)), _date_shape(match.group(3))
        return f"((?:[Dd]al\\s+)?{start}{separator}{end})"
    if value_type == "quantity":
        return _QUANTITY
    return _TEXT


def shape_pattern(text: str, value_type: str) -> str:
    """A pattern with one capture group that reads values shaped like `text`.

    Raises ValueError when `text` cannot be read as `value_type`, or when the pattern would not
    read it back to the same value.
    """
    text = unicodedata.normalize("NFC", text).strip()
    value = selected_value(text, value_type)
    pattern = _raw_shape(text, value_type)
    match = re.search(pattern, text)
    try:
        same = match is not None and selected_value(match.group(1), value_type) == value
    except ValueError:
        same = False
    if not same:
        raise ValueError("Il testo selezionato non ha una forma riconoscibile.")
    return pattern


# --- Selections ---------------------------------------------------------------------------------


def _number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError
    return float(value)


def _selected(doc: Document, selection: object, label: str) -> list[tuple[int, int]]:
    """(line index, word index) of the selected words, in reading order."""
    try:
        if not isinstance(selection, Selection):
            raise ValueError
        page = selection.page
        if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= doc.pages:
            raise ValueError
        if len(selection.box) != 4:
            raise ValueError
        x0, top, x1, bottom = (_number(value) for value in selection.box)
    except (ValueError, TypeError):
        raise ValueError(f"Selezione non valida per «{label}».") from None
    left, right = sorted((x0, x1))
    upper, lower = sorted((top, bottom))
    picked = []
    for line_index, line in enumerate(doc.lines):
        if line.page != page:
            continue
        for word_index, word in enumerate(line.words):
            cx, cy = (word.x0 + word.x1) / 2, (word.top + word.bottom) / 2
            if left <= cx <= right and upper <= cy <= lower:
                picked.append((line_index, word_index))
    if not picked:
        raise ValueError(f"La selezione per «{label}» non contiene testo.")
    return picked


def _text_of(doc: Document, picked: Sequence[tuple[int, int]]) -> str:
    words = (doc.lines[line].words[word].text for line, word in picked)
    return unicodedata.normalize("NFC", " ".join(words))


# --- Anchors ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Option:
    line: int
    first: int  # index of the anchor's first word in the line
    last: int  # index of the anchor's last word in the line
    position: str


def _windows(line: int, count: int, position: str) -> list[_Option]:
    """The last 1..MAX_ANCHOR_WORDS of the first `count` words of a line."""
    return [
        _Option(line, count - size, count - 1, position)
        for size in range(1, min(MAX_ANCHOR_WORDS, count) + 1)
    ]


def _anchor_options(layout: Layout, line_index: int, word_index: int) -> list[_Option]:
    """Anchors to try for a value starting at the given word, shortest first."""
    line = layout.lines[line_index]
    if word_index > 0:
        return _windows(line_index, word_index, "same-line")
    start = line.words[0].x0
    on_left = [
        index
        for index, other in enumerate(layout.lines)
        if index != line_index
        and other.page == line.page
        and abs(other.baseline - line.baseline) <= ROW_TOLERANCE
        and other.x1 <= start
    ]
    if on_left:
        nearest = max(on_left, key=lambda index: (layout.lines[index].x1, -index))
        return _windows(nearest, len(layout.lines[nearest].words), "right")
    row = layout.row_of[line_index]
    for above in range(row - 1, max(row - 1 - BELOW_ROWS, -1), -1):
        options: list[_Option] = []
        for index in layout.rows[above]:
            other = layout.lines[index]
            if other.page != line.page:
                continue
            words = other.words
            for size in range(1, MAX_ANCHOR_WORDS + 1):
                for first in range(len(words) - size + 1):
                    x0, x1 = words[first].x0, words[first + size - 1].x1
                    if min(x1, line.x1) - max(x0, line.x0) > 0:
                        options.append(_Option(index, first, first + size - 1, "below"))
        if options:
            options.sort(key=lambda option: option.last - option.first)
            return options
    return []


def _anchor_text(layout: Layout, option: _Option) -> str | None:
    words = layout.lines[option.line].words[option.first : option.last + 1]
    if not any(word_key(word.text) for word in words):
        return None
    return unicodedata.normalize("NFC", " ".join(word.text for word in words))


def _leads_to(layout: Layout, option: _Option, anchor: str, first_word: Word) -> bool:
    """Whether `extract` would look for the value at the selection from this anchor."""
    for occurrence in layout.anchors(anchor):
        if occurrence.line == option.line and occurrence.last_word == option.last:
            candidate = layout.candidate(occurrence, option.position)
            return candidate is not None and candidate.spans[0][2] == first_word
    return False


# --- Building -----------------------------------------------------------------------------------


def _reads_back(result: dict[str, Any], name: str, expected: Any) -> bool:
    fields = result.get("fields", {})
    if name == "period":
        pairs = zip(("periodStart", "periodEnd"), expected)
    else:
        pairs = iter([(name, expected)])
    for key, value in pairs:
        field = fields.get(key)
        if field is None or field["value"] != value or field["confidence"] != "high":
            return False
    return True


def _rule(anchor: str, position: str, pattern: str, value_type: str) -> dict[str, Any]:
    return {
        "anchor": anchor,
        "position": position,
        "pattern": pattern,
        "valueType": value_type,
        "group": 1,
    }


def _build_field(
    doc: Document, layout: Layout, base: dict[str, Any], name: str, selection: object, now: str
) -> dict[str, Any]:
    picked = _selected(doc, selection, name)
    text = _text_of(doc, picked)
    value_type = FIELD_VALUE_TYPES[name]
    try:
        expected = selected_value(text, value_type)
        patterns = [shape_pattern(text, value_type)]
    except ValueError:
        raise ValueError(
            f"Il testo selezionato per «{name}» non è leggibile con il tipo del campo."
        ) from None
    if value_type == "text":
        # The whole rest of the cell first; then exactly the selected number of words, for a
        # value followed by other text on its line.
        extra = len(picked) - 1
        patterns.append(r"(\S+)" if extra == 0 else rf"(\S+(?: \S+){{{extra}}})")
    line_index, word_index = picked[0]
    first_word = doc.lines[line_index].words[word_index]
    options = _anchor_options(layout, line_index, word_index)
    reachable = False
    for option in options:
        anchor = _anchor_text(layout, option)
        if anchor is None or not _leads_to(layout, option, anchor, first_word):
            continue
        reachable = True
        for pattern in patterns:
            spec = {
                "required": name in REQUIRED_FIELDS,
                "rules": [_rule(anchor, option.position, pattern, value_type)],
            }
            result = extract(doc, [dict(base, fields={name: spec})], now)
            if _reads_back(result, name, expected):
                return spec
    if not reachable:
        raise ValueError(
            f"Per «{name}» non c'è un'etichetta che porti alla selezione, a sinistra sulla "
            "stessa riga o subito sopra."
        )
    raise ValueError(
        f"Il campo «{name}» non si rilegge con certezza dal documento: provare un'altra selezione."
    )


def _recognise(doc: Document, selections: object) -> list[str]:
    if not isinstance(selections, list) or not selections:
        raise ProfileDataError("Serve almeno una selezione per riconoscere il fornitore.")
    texts: list[str] = []
    for selection in selections:
        text = " ".join(_text_of(doc, _selected(doc, selection, "riconoscimento")).lower().split())
        if len(text) < MIN_RECOGNISE_CHARS:
            raise ValueError(
                f"Il testo di riconoscimento deve avere almeno {MIN_RECOGNISE_CHARS} caratteri."
            )
        if text not in texts:
            texts.append(text)
    return texts


def build_profile(
    doc: Document,
    *,
    profile_id: str,
    supplier: str,
    kind: str,
    category: str | None,
    valid_from: str,
    recognise: list[Selection],
    fields: dict[str, Selection],
    now: str,
) -> dict[str, Any]:
    """A valid `supplierProfile` record (`bozza`, rev 1) built from selections on `doc`.

    Raises ValueError (ProfileDataError for the profile's own values) with a generic Italian
    message when a selection is empty, unreadable or cannot be read back with `high`.
    """
    if not valid_iso_at(now):
        raise ProfileDataError("La data di riferimento non è una data o data-ora ISO valida.")
    if not isinstance(fields, dict) or any(name not in FIELD_VALUE_TYPES for name in fields):
        raise ProfileDataError("Nome di campo non ammesso.")
    if not doc.has_text:
        raise ValueError("Il documento non contiene testo leggibile: nessun profilo costruito.")
    profile: dict[str, Any] = {
        "id": profile_id,
        "v": 1,
        "rev": 1,
        "supplier": supplier,
        "kind": kind,
        "category": category,
        "status": "bozza",
        "autoRegister": True,
        "validFrom": valid_from,
        "recognise": {"allOf": _recognise(doc, recognise), "noneOf": []},
        "fields": {},
        "identifiers": [],
    }
    if category is None:
        del profile["category"]
    if validate("supplierProfile", profile):
        # The validation messages may quote the values: they are not reported.
        raise ProfileDataError("I dati del profilo non sono validi.")
    if extract(doc, [profile], now)["status"] == "non-riconosciuta":
        raise ValueError("Il testo di riconoscimento non si ritrova nel documento.")

    layout = Layout(doc)
    for name in FIELD_ORDER:
        if name in fields:
            profile["fields"][name] = _build_field(doc, layout, profile, name, fields[name], now)
    if validate("supplierProfile", profile):
        raise ValueError("Il profilo costruito non è valido secondo lo schema.")

    # Ruling R60: the whole profile must read every selected field back with `high`.
    result = extract(doc, [profile], now)
    if result["status"] == "non-riconosciuta":
        raise ValueError("Il testo di riconoscimento non si ritrova nel documento.")
    for name in profile["fields"]:
        picked = _selected(doc, fields[name], name)
        expected = selected_value(_text_of(doc, picked), FIELD_VALUE_TYPES[name])
        if not _reads_back(result, name, expected):
            raise ValueError(f"Il campo «{name}» non si rilegge con certezza dal documento.")
    return profile
