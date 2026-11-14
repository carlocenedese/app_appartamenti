"""Joins the dumps of the fixtures in `fixtures/pdf/` into one, as if one file held several
documents: pages are renumbered one after the other and the file hash is invented."""

from __future__ import annotations

import hashlib
from typing import Any


def text_page(page: int, text: str) -> dict[str, Any]:
    """A dump line of an invented text, on `page`."""
    words = [
        {"text": word, "x0": 10.0 + 40.0 * i, "top": 20.0, "x1": 45.0 + 40.0 * i, "bottom": 30.0}
        for i, word in enumerate(text.split())
    ]
    return {
        "page": page,
        "x0": 10.0,
        "top": 20.0,
        "x1": words[-1]["x1"],
        "bottom": 30.0,
        "baseline": 28.0,
        "words": words,
    }


def compose(*fixtures: dict[str, Any]) -> dict[str, Any]:
    """One dump from fixtures (the file of a fixture, or its `dump`), in the order given."""
    lines: list[dict[str, Any]] = []
    ocr_pages: list[int] = []
    sources: set[str] = set()
    offset = 0
    hashes = []
    for item in fixtures:
        dump = item.get("dump", item)
        source = dump.get("textSource", "pdf")
        own = {line["page"] for line in dump["lines"]}
        # a dump of a scan written before the OCR pages were listed: every page with text
        pages = dump.get("ocrPages", sorted(own) if source == "ocr" else [])
        sources.add(source)
        ocr_pages += [offset + n for n in pages]
        lines += [{**line, "page": offset + line["page"]} for line in dump["lines"]]
        offset += dump["pages"]
        hashes.append(dump["fileHash"])
    return {
        "fileHash": hashlib.sha256("".join(hashes).encode()).hexdigest(),
        "pages": offset,
        "hasText": any(item.get("dump", item)["hasText"] for item in fixtures),
        "textSource": sources.pop() if len(sources) == 1 else "mixed",
        "ocrPages": ocr_pages,
        "warnings": [],
        "lines": lines,
    }
