"""Italian amounts, dates and quantities as printed on bills.

Rules (ruling R49): the date order is always day-month-year, never guessed; whatever is ambiguous
raises ValueError. Amounts are returned as integer cents, quantities as text with a dot and no
thousands separators; only Decimal and integers are used. The month names are tables in
this file: nothing depends on the system language. No network, no clock.
"""

from __future__ import annotations

import calendar
import re
import unicodedata
from datetime import date
from decimal import Decimal

_MONTHS = (
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
)  # fmt: skip
_MONTH_BY_NAME: dict[str, int] = {}
for _index, _name in enumerate(_MONTHS, start=1):
    _MONTH_BY_NAME[_name] = _index
    _MONTH_BY_NAME[_name[:3]] = _index

_MINUS = "-−–"  # hyphen-minus, minus sign, en dash

# A thousands-grouped number with a comma and exactly two decimals, a plain number with a comma
# and exactly two decimals, or a dot with exactly two decimals (no other separator). A bare
# integer is never an amount (ruling R50).
_EURO_NUMBER = r"(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2})"
_EURO = re.compile(
    rf"(?P<neg>[{_MINUS}]\s*)?(?:€\s*)?(?P<num>{_EURO_NUMBER})(?:\s*€)?",
)
_EURO_NEG_AFTER_SYMBOL = re.compile(rf"€\s*[{_MINUS}]\s*(?P<num>{_EURO_NUMBER})")

_NUMERIC_DATE = r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
_TEXT_DATE = r"\d{1,2}[°º]?\s+[^\W\d_]+\.?\s+\d{2,4}"
_ANY_DATE = rf"(?:{_NUMERIC_DATE}|{_TEXT_DATE})"
_NUMERIC_DATE_RE = re.compile(r"(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})")
_TEXT_DATE_RE = re.compile(r"(\d{1,2})[°º]?\s+([^\W\d_]+)\.?\s+(\d{4}|\d{2})")
_RANGE_RE = re.compile(
    rf"(?:dal\s+)?(?P<start>{_ANY_DATE})(?:\s+al\s+|\s*[-–—/]\s*)(?P<end>{_ANY_DATE})",
    re.IGNORECASE,
)

# Whole months: the year is written once at the end or after each month, the month names are
# full or 3-letter abbreviations with an optional dot.
_MONTH_RANGE_RE = re.compile(
    r"(?P<m1>[^\W\d_]+)\.?(?:\s+(?P<y1>\d{4}|\d{2}))?\s*[-–—]\s*(?P<m2>[^\W\d_]+)\.?\s+(?P<y2>\d{4}|\d{2})",
)

_QUANTITY_RE = re.compile(
    r"(?P<num>\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?:\s*(?P<unit>[^\W\d_][^\s\d]*))?"
)


def _clean(text: str) -> str:
    if not isinstance(text, str):
        raise ValueError("Il valore da leggere non è un testo.")
    return text.strip()


def parse_euro(text: str) -> int:
    """Amount in euro as integer cents; negative for credit notes. ValueError if not clear."""
    cleaned = _clean(text)
    match = _EURO.fullmatch(cleaned)
    negative = False
    if match is not None:
        negative = match.group("neg") is not None
    else:
        match = _EURO_NEG_AFTER_SYMBOL.fullmatch(cleaned)
        negative = match is not None
    if match is None:
        raise ValueError(f"Importo non valido o ambiguo: «{text}».")
    number = match.group("num").replace(".", "") if "," in match.group("num") else match.group("num")
    cents = int(Decimal(number.replace(",", ".")) * 100)
    return -cents if negative else cents


def _year(token: str) -> int:
    return int(token) if len(token) == 4 else 2000 + int(token)


def _build(day: int, month: int, year: int, text: str) -> str:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        raise ValueError(f"Data inesistente: «{text}».") from None


def _month_number(name: str) -> int | None:
    folded = unicodedata.normalize("NFKD", name.lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return _MONTH_BY_NAME.get(folded)


def parse_date(text: str) -> str:
    """ISO date (YYYY-MM-DD) from a day-month-year text. ValueError if not a real date."""
    cleaned = _clean(text)
    numeric = _NUMERIC_DATE_RE.fullmatch(cleaned)
    if numeric is not None:
        day, _, month, year = numeric.groups()
        return _build(int(day), int(month), _year(year), text)
    textual = _TEXT_DATE_RE.fullmatch(cleaned)
    if textual is not None:
        day, month_name, year = textual.groups()
        month = _month_number(month_name)
        if month is None:
            raise ValueError(f"Mese non riconosciuto: «{text}».")
        return _build(int(day), month, _year(year), text)
    raise ValueError(f"Data non valida (serve giorno-mese-anno): «{text}».")


def _month_range(match: re.Match[str], text: str) -> tuple[str, str]:
    first, last = _month_number(match.group("m1")), _month_number(match.group("m2"))
    if first is None or last is None:
        raise ValueError("Mese non riconosciuto nel periodo.")
    end_year = _year(match.group("y2"))
    if match.group("y1") is not None:
        start_year = _year(match.group("y1"))
    else:  # year written once: «Novembre - Febbraio 2025» starts in the previous year
        start_year = end_year - 1 if first > last else end_year
    start = _build(1, first, start_year, text)
    end = _build(calendar.monthrange(end_year, last)[1], last, end_year, text)
    if end < start:
        raise ValueError(f"La fine del periodo precede l'inizio: «{text}».")
    return (start, end)


def parse_date_range(text: str) -> tuple[str, str]:
    """(start, end) ISO dates from «dal … al …», «… - …» or whole months («Gen - Ago 2024»).

    A month range starts on the first day of the first month and ends on the last day of the
    last month. The end must not precede the start.
    """
    cleaned = _clean(text)
    match = _RANGE_RE.fullmatch(cleaned)
    if match is None:
        months = _MONTH_RANGE_RE.fullmatch(cleaned)
        if months is None:
            raise ValueError(f"Periodo non valido: «{text}».")
        return _month_range(months, text)
    start = parse_date(match.group("start"))
    end = parse_date(match.group("end"))
    if end < start:
        raise ValueError(f"La fine del periodo precede l'inizio: «{text}».")
    return (start, end)


def parse_quantity(text: str) -> tuple[str, str | None]:
    """(quantity as text with a dot, unit or None), e.g. «1.234 Smc» -> ("1234", "Smc")."""
    match = _QUANTITY_RE.fullmatch(_clean(text))
    if match is None:
        raise ValueError(f"Quantità non valida o ambigua: «{text}».")
    number = match.group("num").replace(".", "").replace(",", ".")
    return (number, match.group("unit"))


# YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]] and a zone (Z or ±HH:MM).
_AT = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})"
    r"(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,9})?)?"
    r"(?:Z|[+-]([0-9]{2}):([0-9]{2}))?)?"
)


def valid_iso_at(value: object) -> bool:
    """Whether `value` is an ISO date or date-time, the form of the `at` / `now` arguments."""
    match = _AT.fullmatch(value) if isinstance(value, str) else None
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
