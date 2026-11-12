"""Patterns that generalise the shape of a selected value (plan 2a, Task 7, rulings R61 and R62).

`shape_pattern(text, value_type, position=...)` returns a pattern with ONE numbered group that
reads values shaped like `text` from the candidate text `extract` builds for a rule:

- every pattern starts at the beginning of the candidate, allowing only spaces, colons and `€`
  before the value, outside the group (`^[\\s:€]*`): a value is never picked from the middle of
  other text, so «1 234,56» (space as thousands separator) gives no value instead of 234,56;
- numeric shapes (euro, date, date range, quantity) end with `(?![\\d.,])`: «98,467» or
  «1,234.56» are no values for a «98,46» or «98.46» shape;
- `text` captures exactly the number of selected words for `same-line` (the rest of the line may
  hold another column), and the whole cell for `right` and `below` (ruling R57).

Only constructs common to Python and JavaScript are used: numbered groups, a lookahead, no
lookbehind, no inline flags (so upper and lower case are spelled out as `[Aa][Ll]`).
Error messages are generic Italian sentences that never quote the text.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .parse import parse_date, parse_date_range, parse_euro, parse_quantity

_START = r"^[\s:€]*"
_END = r"(?![\d.,])"
_MINUS = "[-−–]"
_EURO_COMMA = rf"(?:{_MINUS}\s?)?(?:\d{{1,3}}(?:\.\d{{3}})+|\d+),\d{{2}}"
_EURO_POINT = rf"(?:{_MINUS}\s?)?\d+\.\d{{2}}"
_NUMERIC_DATE = r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
_TEXT_DATE = r"\d{1,2}[°º]?\s+[A-Za-z]+\.?\s+\d{2,4}"
_QUANTITY = r"\d[\d.]*(?:,\d+)?\s*[A-Za-zµ]+[²³]?"
_WHOLE_TEXT = r"\S+(?: \S+)*"
_RANGE_START = r"(?:[Dd][Aa][Ll]\s+)?"
_RANGE_SEPARATORS = {
    "al": r"\s+[Aa][Ll]\s+",
    "-": r"\s*-\s*",
    "–": r"\s*–\s*",
    "—": r"\s*—\s*",
    "/": r"\s*/\s*",
}
_RANGE_SHAPE = re.compile(
    rf"(?:dal\s+)?({_NUMERIC_DATE}|{_TEXT_DATE})(\s+al\s+|\s*[-–—/]\s*)({_NUMERIC_DATE}|{_TEXT_DATE})",
    re.IGNORECASE,
)
POSITIONS = ("same-line", "right", "below")
UNREADABLE = "Il testo selezionato non è leggibile con il tipo del campo."


def _read(text: str, value_type: str) -> Any:
    if value_type == "euro":
        return parse_euro(text)
    if value_type == "date":
        return parse_date(text)
    if value_type == "date-range":
        return parse_date_range(text)
    if value_type == "quantity":
        quantity, unit = parse_quantity(text)
        if unit is None:
            raise ValueError
        return {"quantity": quantity, "unit": unit}
    if value_type == "text":
        if not text.strip():
            raise ValueError
        return text.strip()
    raise ValueError


def selected_value(text: str, value_type: str) -> Any:
    """The value of a selected text read as `value_type`, as `extract` reports it.

    Raises ValueError with a generic message (the parsers' messages quote the text).
    """
    try:
        return _read(text, value_type)
    except (ValueError, TypeError):
        raise ValueError(UNREADABLE) from None


def _date_shape(text: str) -> str:
    if re.fullmatch(_NUMERIC_DATE, text):
        return _NUMERIC_DATE
    if re.fullmatch(_TEXT_DATE, text):
        return _TEXT_DATE
    raise ValueError(UNREADABLE)


def _core(text: str, value_type: str, position: str) -> str:
    """The value part of the pattern, with its group and right boundary."""
    if value_type == "euro":
        return f"({_EURO_COMMA if ',' in text else _EURO_POINT}){_END}"
    if value_type == "date":
        return f"({_date_shape(text)}){_END}"
    if value_type == "date-range":
        match = _RANGE_SHAPE.fullmatch(text)
        if match is None:
            raise ValueError(UNREADABLE)
        separator = _RANGE_SEPARATORS[match.group(2).strip().lower()]
        start, end = _date_shape(match.group(1)), _date_shape(match.group(3))
        return f"({_RANGE_START}{start}{separator}{end}){_END}"
    if value_type == "quantity":
        return f"({_QUANTITY}){_END}"
    if position == "same-line":
        extra = len(text.split()) - 1
        return r"(\S+)" if extra == 0 else rf"(\S+(?: \S+){{{extra}}})"
    return f"({_WHOLE_TEXT})"


def shape_pattern(text: str, value_type: str, position: str = "right") -> str:
    """A pattern with one capture group that reads values shaped like `text` at `position`.

    Raises ValueError (generic message) when `text` cannot be read as `value_type`, or when the
    pattern would not read it back to the same value.
    """
    if not isinstance(text, str) or position not in POSITIONS:
        raise ValueError(UNREADABLE)
    text = " ".join(unicodedata.normalize("NFC", text).split())
    value = selected_value(text, value_type)
    pattern = _START + _core(text, value_type, position)
    match = re.search(pattern, text)
    try:
        same = match is not None and _read(match.group(1), value_type) == value
    except (ValueError, TypeError):
        same = False
    if not same:
        raise ValueError(UNREADABLE)
    return pattern


def value_shaped(word: str) -> bool:
    """Whether a word looks like a value (digit, amount, date or quantity): never an anchor."""
    if any(ch.isdigit() for ch in word):
        return True
    bare = word.strip(":;,.")
    for value_type in ("euro", "date", "quantity"):
        try:
            _read(bare, value_type)
        except (ValueError, TypeError):
            continue
        return True
    return False
