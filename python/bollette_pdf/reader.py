"""Reads a text PDF into lines and words with coordinates, using pdfminer.six.

Coordinates are in points from the TOP-LEFT corner of the page (pdfminer uses the bottom-left),
rounded to two decimals, and pages are numbered from 1. `read_pdf` raises `PdfReadError` (Italian
message, never containing text from the file) for a file that is not a PDF, is damaged or needs a
password. `dump_document` / `load_dump` give a JSON form of a read document without the file name.

No network, no clock, no randomness.
"""

from __future__ import annotations

import hashlib
import io
import logging
import statistics
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTAnno, LTChar, LTContainer, LTPage, LTTextLine

# pdfminer logs warnings about odd fonts and objects, sometimes quoting values of the file;
# without a handler they would reach stderr through logging's last resort. Nothing of it is
# wanted («nessun dato personale nei log»): the reader reports problems through PdfReadError.
_PDFMINER_LOG = logging.getLogger("pdfminer")
_PDFMINER_LOG.addHandler(logging.NullHandler())
_PDFMINER_LOG.propagate = False
_PDFMINER_LOG.setLevel(logging.CRITICAL + 1)

MIN_TEXT_CHARS = 80
# Text lines whose baseline differs by less than this many points are on the same row. The
# baseline (glyph origin) is used, not the glyph box, because the box grows with the font size.
ROW_TOLERANCE = 2.0
DECIMALS = 2

# Layout choice. boxes_flow=None turns off the grouping of lines into text boxes by position, so
# the reading order is decided here (page, row, x0) and not by pdfminer. char_margin is the
# largest gap, in character widths, that still keeps two glyph runs in one line: the default 2.0
# keeps a sentence together (even justified) but splits a label from a value in another column,
# which is far more than 2 characters away. word_margin 0.1 is the default: a gap wider than 10%
# of a character starts a new word. line_margin is the default 0.5. all_texts=True also builds
# text lines for characters inside Form XObjects (otherwise that text is silently dropped).
LA_PARAMS = LAParams(char_margin=2.0, word_margin=0.1, line_margin=0.5, boxes_flow=None, all_texts=True)


class PdfReadError(Exception):
    """The file cannot be read as a PDF. The message is Italian and generic."""


@dataclass(frozen=True)
class Word:
    text: str
    page: int
    x0: float
    top: float
    x1: float
    bottom: float


@dataclass(frozen=True)
class Line:
    page: int
    text: str
    words: tuple[Word, ...]
    x0: float
    top: float
    x1: float
    bottom: float
    # Median baseline in points from the top: the key of reading order, independent of font size.
    baseline: float = 0.0


@dataclass(frozen=True)
class Document:
    file_hash: str
    file_name: str
    pages: int
    lines: tuple[Line, ...]
    has_text: bool

    @property
    def text(self) -> str:
        return unicodedata.normalize("NFC", "\n".join(line.text for line in self.lines))


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _r(value: float) -> float:
    return round(float(value), DECIMALS)


def _make_line(page: int, words: list[Word], baseline: float) -> Line:
    return Line(
        page=page,
        text=_nfc(" ".join(word.text for word in words)),
        words=tuple(words),
        x0=min(w.x0 for w in words),
        top=min(w.top for w in words),
        x1=max(w.x1 for w in words),
        bottom=max(w.bottom for w in words),
        baseline=baseline,
    )


def _text_lines(container: Any) -> Iterator[LTTextLine]:
    for item in container:
        if isinstance(item, LTTextLine):
            yield item
        elif isinstance(item, LTContainer):
            yield from _text_lines(item)


def _words_of(line: LTTextLine, page: int, height: float) -> list[Word]:
    words: list[Word] = []
    chars: list[LTChar] = []

    def flush() -> None:
        if chars:
            words.append(
                Word(
                    text=_nfc("".join(c.get_text() for c in chars)),
                    page=page,
                    x0=_r(min(c.x0 for c in chars)),
                    top=_r(height - max(c.y1 for c in chars)),
                    x1=_r(max(c.x1 for c in chars)),
                    bottom=_r(height - min(c.y0 for c in chars)),
                )
            )
            chars.clear()

    for item in line:
        if isinstance(item, LTChar) and item.get_text().strip():
            chars.append(item)
        elif isinstance(item, (LTChar, LTAnno)):
            flush()
    flush()
    return words


def _page_lines(layout: LTPage, page: int) -> list[Line]:
    lines = []
    for text_line in _text_lines(layout):
        words = _words_of(text_line, page, layout.height)
        if words:
            baseline = statistics.median(
                _r(layout.height - c.matrix[5]) for c in text_line if isinstance(c, LTChar)
            )
            lines.append(_make_line(page, words, _r(baseline)))
    # Reading order: rows from the top, a row being lines whose baseline is within ROW_TOLERANCE of
    # the first line of the row; inside a row from left to right.
    lines.sort(key=lambda line: (line.baseline, line.x0))
    ordered: list[Line] = []
    row: list[Line] = []
    anchor = 0.0
    for line in lines:
        if row and line.baseline - anchor >= ROW_TOLERANCE:
            ordered.extend(sorted(row, key=lambda item: item.x0))
            row = []
        if not row:
            anchor = line.baseline
        row.append(line)
    ordered.extend(sorted(row, key=lambda item: item.x0))
    return ordered


def read_pdf(path: Path) -> Document:
    """Reads the PDF at `path`; raises PdfReadError if it cannot be read."""
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as error:
        raise PdfReadError("Impossibile aprire il file.") from error
    file_hash = hashlib.sha256(data).hexdigest()
    lines: list[Line] = []
    pages = 0
    try:
        # The bytes read once are both hashed and parsed, so the hash always matches the content.
        for number, layout in enumerate(
            extract_pages(io.BytesIO(data), laparams=LA_PARAMS), start=1
        ):
            pages = number
            lines.extend(_page_lines(layout, number))
    except (KeyboardInterrupt, MemoryError):
        raise
    except Exception:
        # pdfminer raises many kinds (PDFSyntaxError, PDFPasswordIncorrect, PSException,
        # PDFEncryptionError, ...) and bad data can also surface as plain TypeError, ValueError,
        # RecursionError, so any ordinary failure of the parser is wrapped. The original error is
        # dropped (`from None`): it may carry text from the PDF, which must never reach a log.
        raise PdfReadError(
            "Il file non è un PDF leggibile: potrebbe essere danneggiato o protetto da password."
        ) from None
    if pages == 0:
        raise PdfReadError("Il file non contiene pagine leggibili.")
    non_blank = sum(1 for line in lines for ch in line.text if not ch.isspace())
    return Document(
        file_hash=file_hash,
        file_name=_nfc(path.name),
        pages=pages,
        lines=tuple(lines),
        has_text=non_blank >= MIN_TEXT_CHARS,
    )


def dump_document(doc: Document) -> dict[str, Any]:
    """JSON-serialisable form of a document, without the file name.

    Coordinates are rounded to two decimals when a document is read, so dumping loses nothing.
    """
    return {
        "fileHash": doc.file_hash,
        "pages": doc.pages,
        "hasText": doc.has_text,
        "lines": [
            {
                "page": line.page,
                "x0": line.x0,
                "top": line.top,
                "x1": line.x1,
                "bottom": line.bottom,
                "baseline": line.baseline,
                "words": [
                    {"text": w.text, "x0": w.x0, "top": w.top, "x1": w.x1, "bottom": w.bottom}
                    for w in line.words
                ],
            }
            for line in doc.lines
        ],
    }


def _int(data: Any, key: str) -> int:
    value = data.get(key) if isinstance(data, dict) else None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"Dump non valido: «{key}».")
    return value


def _num(data: Any, key: str) -> float:
    value = data.get(key) if isinstance(data, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Dump non valido: «{key}».")
    return float(value)


def load_dump(data: dict[str, Any]) -> Document:
    """Inverse of dump_document; file_name is empty. Raises ValueError for a bad dump."""
    if not isinstance(data, dict):
        raise ValueError("Dump non valido.")
    file_hash = data.get("fileHash")
    has_text = data.get("hasText")
    raw_lines = data.get("lines")
    if not isinstance(file_hash, str) or not isinstance(has_text, bool):
        raise ValueError("Dump non valido.")
    if not isinstance(raw_lines, list):
        raise ValueError("Dump non valido: «lines».")
    pages = _int(data, "pages")
    lines = []
    for raw in raw_lines:
        page = _int(raw, "page")
        raw_words = raw.get("words")
        if not isinstance(raw_words, list) or not raw_words:
            raise ValueError("Dump non valido: «words».")
        words = []
        for item in raw_words:
            text = item.get("text") if isinstance(item, dict) else None
            if not isinstance(text, str):
                raise ValueError("Dump non valido: «text».")
            words.append(
                Word(
                    text=_nfc(text),
                    page=page,
                    x0=_num(item, "x0"),
                    top=_num(item, "top"),
                    x1=_num(item, "x1"),
                    bottom=_num(item, "bottom"),
                )
            )
        lines.append(
            Line(
                page=page,
                text=_nfc(" ".join(w.text for w in words)),
                words=tuple(words),
                x0=_num(raw, "x0"),
                top=_num(raw, "top"),
                x1=_num(raw, "x1"),
                bottom=_num(raw, "bottom"),
                baseline=_num(raw, "baseline"),
            )
        )
    return Document(
        file_hash=file_hash, file_name="", pages=pages, lines=tuple(lines), has_text=has_text
    )
