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
- when another recognising profile, in validity and reading every required field, differs from
  the chosen one in supplier, kind or category, the check `profile-unique` fails (ruling R73);
- a TARI profile with `parts` adds the checks `parts-found` and `parts-unique` (ruling R56);
- for `right` and `below`, a value is `high` only when it fills its cell, apart from `€`, `EUR`,
  `euro`, parentheses, colons and spaces (ruling R57); for `same-line`, only when nothing but
  that noise precedes it and no digit (or `.`/`,` and a digit) follows it (ruling R73).

- OCR (ruling R87), per field: a field whose `source.page` is in `ocrPages` is never `high`, and
  one whose text line or cell averages under `OCR_MIN_WORD_CONFIDENCE` is empty; a scan
  (`textSource` `ocr`) is never `riconosciuta` and has no `high` field; a `mixed` document is
  `da-confermare` only when a field with a value was read from an OCR page;
  the warnings of the reader follow those of the profile.

Warnings and check messages are generic Italian sentences that never quote the document.
No network, no clock: `at` is an argument.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .checks import parts_checks, run_checks
from .locate import Layout, Text, box_of
from .parse import parse_date, parse_date_range, parse_euro, parse_quantity
from .profiles import matching_profiles
from .reader import Document

WARNING_REPEATED_PART = "Avviso TARI: parte ripetuta su più pagine, contata una volta."
WARNING_UNREADABLE_PART = "Avviso TARI: parte non leggibile, esclusa."
WARNING_UNREADABLE_ITEM = "Voce non leggibile, esclusa dalla somma delle voci."

# Words read with OCR (confidence 0-100): a field whose text line or cell averages less is empty.
OCR_MIN_WORD_CONFIDENCE = 70

# The value of the amount or the number is read with two different values: the file may hold
# more than one document (the restricted read of `--pages` is the way to choose one).
WARNING_MANY_DOCUMENTS = "Il file potrebbe contenere più documenti."

MESSAGE_PROFILE_UNIQUE = "Più profili di fornitori diversi riconoscono il documento."

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


def _too_uncertain(words: list[Any]) -> bool:
    """Whether the OCR words average under `OCR_MIN_WORD_CONFIDENCE` (text-layer words never do)."""
    scores = [w.confidence for w in words if w.confidence is not None]
    return bool(scores) and sum(scores) / len(scores) < OCR_MIN_WORD_CONFIDENCE


def _source(page: int, words: list[Any], text: str) -> dict[str, Any]:
    return {"page": page, "box": box_of(words), "text": text}


# What may surround a value in its cell without making it doubtful (ruling R57).
_CELL_NOISE = re.compile(r"€|\beur(?:o)?\b|[():\s]", re.IGNORECASE)


def _whole_cell(candidate: Text, start: int, end: int) -> bool:
    rest = candidate.text[:start] + " " + candidate.text[end:]
    return _CELL_NOISE.sub("", rest) == ""


# A match cut out of a longer number: a digit, or `.`/`,` and a digit, right after it.
_NUMBER_GOES_ON = re.compile(r"[0-9]|[.,][0-9]")


def _starts_the_line(candidate: Text, start: int, end: int) -> bool:
    """For `same-line`: only cell noise before the match and no number cut after it (R73)."""
    return _CELL_NOISE.sub("", candidate.text[:start]) == "" and not _NUMBER_GOES_ON.match(
        candidate.text, end
    )


def _read_at(
    candidate: Text, page: int, rule: dict[str, Any]
) -> tuple[Any, dict[str, Any], bool] | None:
    """(value, source, whole) read with `rule` from one candidate text, or None.

    `whole` is False when a `right` or `below` match leaves other text in its cell, or when a
    `same-line` match follows other text or is cut out of a longer number.
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
    # OCR words only: a text-layer word has no confidence and is never filtered (ruling R87).
    if _too_uncertain([w for _, _, w in candidate.spans]):
        return None
    if rule.get("position") == "same-line":
        whole = _starts_the_line(candidate, start, end)
    else:
        whole = _whole_cell(candidate, start, end)
    return value, _source(page, words, text), whole


def _read_span(layout: Layout, spec: dict[str, Any]) -> tuple[Any, str, list[dict[str, Any]]]:
    """(period, confidence, [start source, end source]) of a `combine: span` period.

    Every rule is applied to every occurrence of its anchor; the period runs from the earliest
    start to the latest end of the intervals read (the rule of the water bills: measured and
    estimated consumption, or «relativi al periodo»). `high` when every interval fills its cell.
    """
    readings = []
    doubtful = False
    for rule in spec.get("rules", []):
        found = []
        for anchor in layout.anchors(rule.get("anchor", "")):
            candidate = layout.candidate(anchor, rule.get("position", ""))
            reading = _read_at(candidate, anchor.page, rule) if candidate is not None else None
            if reading is not None:
                found.append(reading)
            elif candidate is not None and re.search(r"\d", candidate.text):
                doubtful = True  # an interval is written there but cannot be read
        # the same label with different dates: a history table, say, would widen the period
        doubtful = doubtful or any(other[0] != found[0][0] for other in found[1:])
        readings += found
    if not readings:
        return None, "missing", []
    first = min(readings, key=lambda r: r[0][0])
    last = max(readings, key=lambda r: r[0][1])
    confidence = "medium" if doubtful or not all(w for _, _, w in readings) else "high"
    return (first[0][0], last[0][1]), confidence, [first[1], last[1]]


def _read_field(layout: Layout, spec: dict[str, Any]) -> tuple[Any, str, dict | None, bool]:
    """(value, confidence, source, agree) of one field of a profile; `agree` is False when the
    rule that gives the value reads it with different values at different occurrences."""
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
            return value, "high" if index == 0 and agree and whole else "medium", source, agree
    return None, "missing", None, True


def _read_fields(
    layout: Layout, profile: dict[str, Any], disagree: set[str] | None = None
) -> dict[str, dict[str, Any]]:
    """The output fields of `profile` (period split in periodStart and periodEnd). The names of
    the fields read with different values at different occurrences are added to `disagree`."""
    fields: dict[str, dict[str, Any]] = {
        "supplier": {"value": profile["supplier"], "confidence": "high", "source": None}
    }
    for name in ("number", "issueDate", "dueDate", "period", "amount", "consumption"):
        spec = profile.get("fields", {}).get(name)
        if spec is None:
            continue
        if spec.get("combine") == "span" and name == "period":
            value, confidence, sources = _read_span(layout, spec)
            source = None
        else:
            value, confidence, source, agree = _read_field(layout, spec)
            if not agree and disagree is not None:
                disagree.add(name)
            sources = [source, source]
        if value is None:
            entries = {"periodStart": None, "periodEnd": None} if name == "period" else {name: None}
            fields.update({key: dict(_MISSING) for key in entries})
        elif name == "period":
            for key, item, src in zip(("periodStart", "periodEnd"), value, sources):
                fields[key] = {"value": item, "confidence": confidence, "source": dict(src)}
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


def _identity(profile: dict[str, Any]) -> tuple[Any, ...]:
    return profile["supplier"], profile["kind"], profile.get("category")


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
            if _too_uncertain(words):  # same filter as a field (R87)
                warnings.append(WARNING_UNREADABLE_PART)
                continue
            parts.append(
                {"label": key[0], "amount": amount, "source": _source(page, words, match.group(0))}
            )
    add = _compile((profile.get("parts") or {}).get("add"))
    if add is not None and parts:
        by_label = {part["label"]: part for part in parts}
        for page in range(1, layout.pages + 1):
            for match in add.finditer(layout.page_text(page).text):
                try:
                    label, amount_text = match.group(1), match.group(2)
                except IndexError:
                    break
                part = by_label.get(label.strip()) if label is not None else None
                extra = _parse("euro", amount_text) if amount_text is not None else None
                if part is None or extra is None:
                    continue
                part["amount"] = part["amount"] + extra
    prop = _compile(((profile.get("parts") or {}).get("property") or {}).get("pattern"))
    if prop is not None and prop.groups >= 5 and parts:
        by_label = {part["label"]: part for part in parts}
        for page in range(1, layout.pages + 1):
            for match in prop.finditer(layout.page_text(page).text):
                label, address = match.group(1), match.group(2)
                part = by_label.get(label.strip()) if label is not None else None
                if part is None or address is None or not address.strip():
                    continue
                found = {"address": address.strip()}
                for key, group in (("sheet", 3), ("parcel", 4), ("sub", 5)):
                    if match.group(group):
                        found[key] = match.group(group)
                part.setdefault("property", found)
    return parts, repeated


def _items_sum(doc: Document, profile: dict[str, Any], warnings: list[str]) -> tuple[int | None, bool]:
    """(sum of the items, whether one was read from an OCR page). An item of an OCR page whose
    words average under `OCR_MIN_WORD_CONFIDENCE` is unreadable (R87)."""
    compiled = _compile((profile.get("items") or {}).get("pattern"))
    if compiled is None or compiled.groups < 1:
        return None, False
    amounts = []
    from_ocr = False
    layout = Layout(doc)
    texts = [(False, unicodedata.normalize(
        "NFC", "\n".join(line.text for line in doc.lines if line.page not in doc.ocr_pages)
    ), None)]
    texts += [(True, layout.page_text(page).text, layout.page_text(page)) for page in doc.ocr_pages]
    for scanned, content, page_text in texts:
        for match in compiled.finditer(content):
            amount = _parse("euro", match.group(1)) if match.group(1) is not None else None
            if scanned and _too_uncertain(page_text.words_in(*match.span())):
                amount = None
            if amount is None:
                warnings.append(WARNING_UNREADABLE_ITEM)
            else:
                amounts.append(amount)
                from_ocr = from_ocr or scanned
    return (sum(amounts) if amounts else None), from_ocr


def _result(doc: Document, status: str) -> dict[str, Any]:
    return {
        "v": 1,
        "fileHash": doc.file_hash,
        "pages": doc.pages,
        "pageRange": list(doc.page_range or (1, doc.pages)) if doc.pages else None,
        "status": status,
        "profileId": None,
        "profileRev": None,
        "kind": None,
        "documentKind": "unknown",
        "category": None,
        "fields": {},
        "parts": [],
        "identifiers": [],
        "checks": [],
        "warnings": list(dict.fromkeys(doc.warnings)),
        "textSource": doc.text_source,
        "ocrPages": list(doc.ocr_pages),
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
    disagreeing: dict[int, set[str]] = {}
    complete: list[int] = []
    for index, profile in enumerate(matching):
        fields = readings[index] = _read_fields(layout, profile, disagreeing.setdefault(index, set()))
        issue = fields.get("issueDate", _MISSING)["value"]
        if not _in_validity(profile, issue if issue is not None else today):
            continue
        if not _missing_required(profile, fields):
            complete.append(index)
    chosen = complete[0] if complete else None
    # Ruling R55: without an in-validity profile that reads every required field, the newest
    # recognising profile is used, and the result always needs confirmation.
    fallback = chosen is None
    if chosen is None:
        chosen = 0
    profile, fields = matching[chosen], readings[chosen]

    warnings: list[str] = []
    if disagreeing[chosen] & {"amount", "number"}:
        warnings.append(WARNING_MANY_DOCUMENTS)
    items_sum, items_from_ocr = _items_sum(doc, profile, warnings)
    checks = run_checks(fields, items_sum)
    parts: list[dict[str, Any]] = []
    if profile["kind"] == "tari" and profile.get("parts") is not None:
        parts, repeated = _parts(layout, profile, warnings)
        checks.extend(parts_checks(len(parts), repeated))
    # Ruling R73: another complete profile of a different supplier, kind or category also reads
    # the document (an electricity bill advertising gas): which one is right is the user's call.
    if any(_identity(matching[other]) != _identity(profile) for other in complete):
        checks.append({"code": "profile-unique", "ok": False, "message": MESSAGE_PROFILE_UNIQUE})
    doubtful = (
        fallback
        or _missing_required(profile, fields)
        or not all(c["ok"] for c in checks)
    )
    # Ruling R87: a field read from a page read with OCR is never `high`; a scan (`ocr`) is
    # never `riconosciuta` and caps also the supplier of the profile (no source). A `mixed`
    # document is doubtful only when a field with a value was read from an OCR page.
    for field in fields.values():
        from_ocr = field["source"] is not None and field["source"]["page"] in doc.ocr_pages
        if field["confidence"] == "high" and (from_ocr or doc.text_source == "ocr"):
            field["confidence"] = "medium"
        if from_ocr and field["value"] is not None:
            doubtful = doubtful or doc.text_source == "mixed"
    doubtful = doubtful or doc.text_source == "ocr" or items_from_ocr
    # Parts and items read from an OCR page have the same effect as such a field (R87).
    doubtful = doubtful or any(part["source"]["page"] in doc.ocr_pages for part in parts)
    result = _result(doc, "da-confermare" if doubtful else "riconosciuta")
    result.update(
        profileId=profile["id"],
        profileRev=profile["rev"],
        kind=profile["kind"],
        documentKind=profile["kind"],
        category=profile.get("category") if profile["kind"] == "bill" else None,
        fields=fields,
        parts=parts,
        identifiers=_identifiers(layout, profile),
        checks=checks,
        warnings=list(dict.fromkeys([*warnings, *doc.warnings])),
    )
    return result
