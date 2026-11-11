"""Field extraction: from a read document and the supplier profiles to an ExtractionResult.

`extract(doc, profiles, at)` returns every key of an ExtractionResult except `engineVersion` and
`fileName`, which the command line adds. Rules (plan 2a, Task 5, and the controller decisions):

- a field tries its rules in order; the first rule that yields a valid value gives it. The value
  is `high` when that rule is the first and every other occurrence of its anchor yields the same
  value or none; `medium` when the occurrences disagree (the first in reading order wins) or the
  value comes from a later rule; `missing` (value and source null) when no rule yields a value;
- a value that does not parse is no value for that occurrence, never an exception;
- profile choice: among the profiles that recognise the document, newest `validFrom` first, the
  first whose validity contains the issue date it read (or the date of `at` when it read none) and
  that reads every required field; when none does, the newest recognising profile, and the result
  is always `da-confermare` (ruling R55);
- a TARI profile with `parts` adds the checks `parts-found` and `parts-unique` (ruling R56);
- for `right` and `below`, a value is `high` only when it fills its cell, apart from `€`, `EUR`,
  `euro`, parentheses, colons and spaces (ruling R57).

Warnings and check messages are generic Italian sentences that never quote the document.
No network, no clock: `at` is an argument.
"""

from __future__ import annotations

import re
from typing import Any

from .checks import parts_checks, run_checks
from .locate import Layout, Text, box_of
from .parse import parse_date, parse_date_range, parse_euro, parse_quantity
from .profiles import matching_profiles
from .reader import Document

WARNING_REPEATED_PART = "Avviso TARI: parte ripetuta su più pagine, contata una volta."
WARNING_UNREADABLE_PART = "Avviso TARI: parte non leggibile, esclusa."
WARNING_UNREADABLE_ITEM = "Voce non leggibile, esclusa dalla somma delle voci."

_MISSING: dict[str, Any] = {"value": None, "confidence": "missing", "source": None}


def _compile(pattern: Any) -> re.Pattern[str] | None:
    if not isinstance(pattern, str):
        return None
    try:
        return re.compile(pattern)
    except (re.error, RecursionError, OverflowError):
        return None


def _parse(value_type: str, text: str) -> Any:
    """The value of `text` read as `value_type`, or None when it does not parse."""
    try:
        if value_type == "euro":
            return parse_euro(text)
        if value_type == "date":
            return parse_date(text)
        if value_type == "date-range":
            return parse_date_range(text)
        if value_type == "quantity":
            quantity, unit = parse_quantity(text)
            # Ruling R53: a quantity without a unit is no value.
            return {"quantity": quantity, "unit": unit} if unit else None
        if value_type == "text":
            return text.strip() or None
    except ValueError:
        return None
    return None


def _source(page: int, words: list[Any], text: str) -> dict[str, Any]:
    return {"page": page, "box": box_of(words), "text": text}


# What may surround a value in its cell without making it doubtful (ruling R57).
_CELL_NOISE = re.compile(r"€|\beur(?:o)?\b|[():\s]", re.IGNORECASE)


def _whole_cell(candidate: Text, start: int, end: int) -> bool:
    rest = candidate.text[:start] + " " + candidate.text[end:]
    return _CELL_NOISE.sub("", rest) == ""


def _read_at(
    candidate: Text, page: int, rule: dict[str, Any]
) -> tuple[Any, dict[str, Any], bool] | None:
    """(value, source, whole) read with `rule` from one candidate text, or None.

    `whole` is False when a `right` or `below` match leaves other text in its cell.
    """
    compiled = _compile(rule.get("pattern"))
    if compiled is None:
        return None
    match = compiled.search(candidate.text)
    if match is None:
        return None
    try:
        text = match.group(rule.get("group", 1))
        start, end = match.span(rule.get("group", 1))
    except (IndexError, TypeError):
        return None
    if text is None:
        return None
    value = _parse(rule.get("valueType", ""), text)
    words = candidate.words_in(start, end)
    if value is None or not words:
        return None
    whole = rule.get("position") == "same-line" or _whole_cell(candidate, start, end)
    return value, _source(page, words, text), whole


def _read_field(layout: Layout, spec: dict[str, Any]) -> tuple[Any, str, dict | None]:
    """(value, confidence, source) of one field of a profile."""
    for index, rule in enumerate(spec.get("rules", [])):
        readings = []
        for anchor in layout.anchors(rule.get("anchor", "")):
            candidate = layout.candidate(anchor, rule.get("position", ""))
            reading = _read_at(candidate, anchor.page, rule) if candidate is not None else None
            if reading is not None:
                readings.append(reading)
        if readings:
            value, source, whole = readings[0]
            agree = all(other == value for other, _, _ in readings[1:])
            return value, "high" if index == 0 and agree and whole else "medium", source
    return None, "missing", None


def _read_fields(layout: Layout, profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The output fields of `profile` (period split in periodStart and periodEnd)."""
    fields: dict[str, dict[str, Any]] = {
        "supplier": {"value": profile["supplier"], "confidence": "high", "source": None}
    }
    for name in ("number", "issueDate", "dueDate", "period", "amount", "consumption"):
        spec = profile.get("fields", {}).get(name)
        if spec is None:
            continue
        value, confidence, source = _read_field(layout, spec)
        if value is None:
            entries = {"periodStart": None, "periodEnd": None} if name == "period" else {name: None}
            fields.update({key: dict(_MISSING) for key in entries})
        elif name == "period":
            for key, item in zip(("periodStart", "periodEnd"), value):
                fields[key] = {"value": item, "confidence": confidence, "source": dict(source)}
        else:
            fields[name] = {"value": value, "confidence": confidence, "source": source}
    return fields


def _missing_required(profile: dict[str, Any], fields: dict[str, dict[str, Any]]) -> bool:
    for name, spec in profile.get("fields", {}).items():
        key = "periodStart" if name == "period" else name
        if spec.get("required") and fields.get(key, _MISSING)["value"] is None:
            return True
    return False


def _in_validity(profile: dict[str, Any], day: str) -> bool:
    valid_to = profile.get("validTo")
    return profile["validFrom"] <= day and (valid_to is None or day <= valid_to)


def _identifiers(layout: Layout, profile: dict[str, Any]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    pages = [layout.page_text(page).text for page in range(1, layout.pages + 1)]
    for identifier in profile.get("identifiers", []):
        compiled = _compile(identifier.get("pattern"))
        if compiled is None:
            continue
        for text in pages:
            for match in compiled.finditer(text):
                value = match.group(1) if compiled.groups else match.group(0)
                key = (identifier["kind"], value)
                if value and value.strip() and key not in seen:
                    seen.add(key)
                    found.append({"kind": key[0], "value": value})
    return found


def _parts(
    layout: Layout, profile: dict[str, Any], warnings: list[str]
) -> tuple[list[dict[str, Any]], bool]:
    """(parts, whether a repeated pair was collapsed) of a TARI notice."""
    compiled = _compile((profile.get("parts") or {}).get("pattern"))
    if compiled is None:
        return [], False
    repeated = False
    parts: list[dict[str, Any]] = []
    first_page: dict[tuple[str, int], int] = {}
    for page in range(1, layout.pages + 1):
        page_text = layout.page_text(page)
        for match in compiled.finditer(page_text.text):
            try:
                label, amount_text = match.group(1), match.group(2)
            except IndexError:
                return [], False
            amount = _parse("euro", amount_text) if amount_text is not None else None
            if label is None or amount is None:
                warnings.append(WARNING_UNREADABLE_PART)
                continue
            key = (label.strip(), amount)
            if first_page.setdefault(key, page) != page:
                warnings.append(WARNING_REPEATED_PART)
                repeated = True
                continue
            words = page_text.words_in(*match.span()) or [w for _, _, w in page_text.spans]
            if not words:
                continue
            parts.append(
                {"label": key[0], "amount": amount, "source": _source(page, words, match.group(0))}
            )
    return parts, repeated


def _items_sum(doc: Document, profile: dict[str, Any], warnings: list[str]) -> int | None:
    compiled = _compile((profile.get("items") or {}).get("pattern"))
    if compiled is None or compiled.groups < 1:
        return None
    amounts = []
    for match in compiled.finditer(doc.text):
        amount = _parse("euro", match.group(1)) if match.group(1) is not None else None
        if amount is None:
            warnings.append(WARNING_UNREADABLE_ITEM)
        else:
            amounts.append(amount)
    return sum(amounts) if amounts else None


def _result(doc: Document, status: str) -> dict[str, Any]:
    return {
        "v": 1,
        "fileHash": doc.file_hash,
        "pages": doc.pages,
        "status": status,
        "profileId": None,
        "profileRev": None,
        "kind": None,
        "category": None,
        "fields": {},
        "parts": [],
        "identifiers": [],
        "checks": [],
        "warnings": [],
    }


def extract(doc: Document, profiles: list[dict[str, Any]], at: str) -> dict[str, Any]:
    """ExtractionResult of `doc` without engineVersion and fileName. `at`: ISO date(-time)."""
    if not doc.has_text:
        return _result(doc, "senza-testo")
    matching = matching_profiles(doc, profiles)
    if not matching:
        return _result(doc, "non-riconosciuta")
    layout = Layout(doc)
    today = at[:10]
    readings: dict[int, dict[str, dict[str, Any]]] = {}
    chosen = None
    for index, profile in enumerate(matching):
        fields = readings[index] = _read_fields(layout, profile)
        issue = fields.get("issueDate", _MISSING)["value"]
        if not _in_validity(profile, issue if issue is not None else today):
            continue
        if not _missing_required(profile, fields):
            chosen = index
            break
    # Ruling R55: without an in-validity profile that reads every required field, the newest
    # recognising profile is used, and the result always needs confirmation.
    fallback = chosen is None
    if chosen is None:
        chosen = 0
    profile, fields = matching[chosen], readings[chosen]

    warnings: list[str] = []
    checks = run_checks(fields, _items_sum(doc, profile, warnings))
    parts: list[dict[str, Any]] = []
    if profile["kind"] == "tari" and profile.get("parts") is not None:
        parts, repeated = _parts(layout, profile, warnings)
        checks.extend(parts_checks(len(parts), repeated))
    doubtful = (
        fallback
        or _missing_required(profile, fields)
        or not all(c["ok"] for c in checks)
    )
    result = _result(doc, "da-confermare" if doubtful else "riconosciuta")
    result.update(
        profileId=profile["id"],
        profileRev=profile["rev"],
        kind=profile["kind"],
        category=profile.get("category") if profile["kind"] == "bill" else None,
        fields=fields,
        parts=parts,
        identifiers=_identifiers(layout, profile),
        checks=checks,
        warnings=list(dict.fromkeys(warnings)),
    )
    return result
