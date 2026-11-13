"""Reads a text PDF into lines and words with coordinates, using pdfminer.six.

Coordinates are in points from the TOP-LEFT corner of the page (pdfminer uses the bottom-left),
rounded to two decimals, and pages are numbered from 1. `read_pdf` raises `PdfReadError` (Italian
message, never containing text from the file) for a file that is not a PDF, is damaged or needs a
password. `dump_document` / `load_dump` give a JSON form of a read document without the file name.
Given the folder of the language data (`ocr_data`), pages without useful text are read with OCR
(`ocr.py`, macOS only): `Document.text_source` says where the text comes from.

No network, no clock, no randomness.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import statistics
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTAnno, LTChar, LTContainer, LTPage, LTTextLine

from . import images

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

# OCR (rule R86). A page goes through OCR when it has no text, or when more than CID_GLYPH_LIMIT
# of its glyphs are `(cid:N)` escapes (glyphs without a Unicode mapping: the text is unusable).
# At most MAX_OCR_PAGES pages of a document are read with OCR; the rest stay as they are.
CID_GLYPH_LIMIT = 0.3
MAX_OCR_PAGES = 20
_CID = re.compile(r"\(cid:[0-9]+\)")
OCR_UNAVAILABLE_WARNING = "OCR non disponibile: le pagine scansionate non sono state lette."
OCR_LIMIT_WARNING = (
    "Lette con l'OCR solo le prime {limit} pagine senza testo: le altre vanno controllate a mano."
)

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
    # Confidence of the OCR engine, 0-100; None for text read from the PDF.
    confidence: float | None = None


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
    # 'pdf' (no page read with OCR), 'ocr' (every page with text read with OCR) or 'mixed'.
    text_source: str = "pdf"
    # Pages (from 1, sorted) whose lines were read with OCR; empty when `text_source` is 'pdf'.
    ocr_pages: tuple[int, ...] = ()
    warnings: tuple[str, ...] = ()

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
    return _reading_order(lines)


def _reading_order(lines: list[Line]) -> list[Line]:
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


def _needs_ocr(lines: list[Line]) -> bool:
    text = "".join(line.text for line in lines)
    escapes = len(_CID.findall(text))
    glyphs = escapes + sum(1 for ch in _CID.sub("", text) if not ch.isspace())
    return glyphs == 0 or escapes > CID_GLYPH_LIMIT * glyphs


def read_pdf(
    path: Path, *, ocr_data: str | Path | None = None, max_ocr_pages: int = MAX_OCR_PAGES
) -> Document:
    """Reads the PDF at `path`; raises PdfReadError if it cannot be read.

    With `ocr_data` (folder of ita.traineddata), pages without useful text are read with OCR,
    at most `max_ocr_pages`; without the engine or the data they stay as they are."""
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as error:
        raise PdfReadError("Impossibile aprire il file.") from error
    file_hash = hashlib.sha256(data).hexdigest()
    if images.sniff(data) is not None:  # by the first bytes, whatever the extension
        return _read_image(path, data, file_hash, ocr_data)
    by_page: list[list[Line]] = []
    try:
        # The bytes read once are both hashed and parsed, so the hash always matches the content.
        for number, layout in enumerate(
            extract_pages(io.BytesIO(data), laparams=LA_PARAMS), start=1
        ):
            by_page.append(_page_lines(layout, number))
    except (KeyboardInterrupt, MemoryError):
        raise
    except Exception:
        # pdfminer raises many kinds (PDFSyntaxError, PDFPasswordIncorrect, PSException,
        # PDFEncryptionError, ...) and bad data can also surface as plain TypeError, ValueError,
        # RecursionError, so any ordinary failure of the parser is wrapped. The original error is
        # dropped (`from None`): it may carry text from the PDF, which must never reach a log.
        if path.suffix.lower() in images.EXTENSIONS:
            raise PdfReadError(images.UNREADABLE) from None
        raise PdfReadError(
            "Il file non è un PDF leggibile: potrebbe essere danneggiato o protetto da password."
        ) from None
    pages = len(by_page)
    if pages == 0:
        raise PdfReadError("Il file non contiene pagine leggibili.")
    text_source, ocr_pages, warnings = _read_with_ocr(data, by_page, ocr_data, max_ocr_pages)
    lines = [line for page_lines in by_page for line in page_lines]
    non_blank = sum(1 for line in lines for ch in line.text if not ch.isspace())
    return Document(
        file_hash=file_hash,
        file_name=_nfc(path.name),
        pages=pages,
        lines=tuple(lines),
        has_text=non_blank >= MIN_TEXT_CHARS,
        text_source=text_source,
        ocr_pages=ocr_pages,
        warnings=warnings,
    )


def _read_image(
    path: Path, data: bytes, file_hash: str, ocr_data: str | Path | None
) -> Document:
    """A JPEG or PNG read as one page, through the OCR path of a scanned PDF (rule R88)."""
    try:
        info = images.parse_image(data)
        wrapped = images.image_pdf(data, info)
    except images.ImageError as error:
        raise PdfReadError(str(error)) from None
    by_page: list[list[Line]] = [[]]
    text_source, ocr_pages, warnings = _read_with_ocr(
        wrapped, by_page, ocr_data, MAX_OCR_PAGES, info.dpi
    )
    non_blank = sum(1 for line in by_page[0] for ch in line.text if not ch.isspace())
    return Document(
        file_hash=file_hash,
        file_name=_nfc(path.name),
        pages=1,
        lines=tuple(by_page[0]),
        has_text=non_blank >= MIN_TEXT_CHARS,
        text_source=text_source,
        ocr_pages=ocr_pages,
        warnings=warnings,
    )


def _read_with_ocr(
    data: bytes,
    by_page: list[list[Line]],
    data_dir: str | Path | None,
    limit: int,
    dpi: int | None = None,
) -> tuple[str, tuple[int, ...], tuple[str, ...]]:
    """Replaces in `by_page` the lines of the pages read with OCR; gives text_source, the pages
    read with OCR and the warnings."""
    wanted = [number for number, lines in enumerate(by_page, start=1) if _needs_ocr(lines)]
    if not wanted:
        return "pdf", (), ()
    read = None
    if data_dir is not None:
        from .ocr import ocr_pages

        read = (
            ocr_pages(data, wanted[:limit], str(data_dir))
            if dpi is None
            else ocr_pages(data, wanted[:limit], str(data_dir), dpi)
        )
    if read is None:
        return "pdf", (), (OCR_UNAVAILABLE_WARNING,)
    done = set()
    for number, lines in zip(wanted, read):
        # A page with broken text where OCR finds nothing keeps the text it had.
        if lines or not by_page[number - 1]:
            by_page[number - 1] = lines
            done.add(number)
    pdf_text = any(lines for number, lines in enumerate(by_page, start=1) if number not in done)
    warnings = (OCR_LIMIT_WARNING.format(limit=limit),) if len(wanted) > limit else ()
    if not done:
        return "pdf", (), warnings
    return ("mixed" if pdf_text else "ocr"), tuple(sorted(done)), warnings


def dump_document(doc: Document) -> dict[str, Any]:
    """JSON-serialisable form of a document, without the file name.

    Coordinates are rounded to two decimals when a document is read, so dumping loses nothing.
    """
    return {
        "fileHash": doc.file_hash,
        "pages": doc.pages,
        "hasText": doc.has_text,
        "textSource": doc.text_source,
        "ocrPages": list(doc.ocr_pages),
        "warnings": list(doc.warnings),
        "lines": [
            {
                "page": line.page,
                "x0": line.x0,
                "top": line.top,
                "x1": line.x1,
                "bottom": line.bottom,
                "baseline": line.baseline,
                "words": [_dump_word(w) for w in line.words],
            }
            for line in doc.lines
        ],
    }


def _dump_word(word: Word) -> dict[str, Any]:
    out: dict[str, Any] = {
        "text": word.text, "x0": word.x0, "top": word.top, "x1": word.x1, "bottom": word.bottom
    }
    if word.confidence is not None:
        out["confidence"] = word.confidence
    return out


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
    # textSource, ocrPages and warnings are optional: dumps written before the OCR have none.
    text_source = data.get("textSource", "pdf")
    ocr_pages = data.get("ocrPages", [])
    warnings = data.get("warnings", [])
    if text_source not in ("pdf", "ocr", "mixed"):
        raise ValueError("Dump non valido: «textSource».")
    if not isinstance(ocr_pages, list) or not all(
        isinstance(n, int) and not isinstance(n, bool) and n >= 1 for n in ocr_pages
    ):
        raise ValueError("Dump non valido: «ocrPages».")
    if not isinstance(warnings, list) or not all(isinstance(w, str) for w in warnings):
        raise ValueError("Dump non valido: «warnings».")
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
                    confidence=_num(item, "confidence") if "confidence" in item else None,
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
        file_hash=file_hash,
        file_name="",
        pages=pages,
        lines=tuple(lines),
        has_text=has_text,
        text_source=text_source,
        ocr_pages=tuple(sorted(set(ocr_pages))),
        warnings=tuple(warnings),
    )
