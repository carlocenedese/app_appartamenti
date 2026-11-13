"""Reads pages without text with OCR: pypdfium2 draws the page, tesserocr finds the words.

`ocr_pages` gives, for every page asked, the same `Line` and `Word` as the text reader, with the
coordinates of `reader.py` (points from the top-left of the MediaBox, rounded to two decimals)
and the confidence of the engine (0-100) on every word. Both libraries are installed on macOS
only: they are imported when first needed, and a missing library, missing language data or any
failure of the engine gives None, never an exception. The text read never reaches a message or a
log. The language data folder is an argument, never an environment variable.

No network, no clock, no randomness: one thread, so the same page always gives the same words.
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, Protocol

from .reader import Line, Word, _make_line, _nfc, _r, _reading_order

LANGUAGE = "ita"
# Resolution at which a page is drawn for the engine (rule R86): Tesseract reads best with
# characters 20-30 pixels high, which 300 dpi gives for the 8-10 pt text of a bill.
OCR_DPI = 300
POINTS_PER_INCH = 72

# A word as the engine gives it: text, confidence 0-100, left, top, right, bottom in pixels of
# the drawn page (origin top-left). A line: its baseline in pixels (None if unknown) and words.
RawWord = tuple[str, float, float, float, float, float]
RawLine = tuple[float | None, list[RawWord]]


class Engine(Protocol):
    def read(self, data: bytes, pages: list[int], dpi: int) -> list[list[RawLine]]: ...


class _Tesseract:
    def __init__(self, tesserocr: Any, pdfium: Any, data_dir: str) -> None:
        self._tesserocr = tesserocr
        self._pdfium = pdfium
        self._data_dir = data_dir

    def read(self, data: bytes, pages: list[int], dpi: int) -> list[list[RawLine]]:
        pdf = self._pdfium.PdfDocument(data)
        try:
            with self._tesserocr.PyTessBaseAPI(path=self._data_dir, lang=LANGUAGE) as api:
                # Tesseract's own messages go nowhere: none may reach stderr.
                api.SetVariable("debug_file", os.devnull)
                return [self._page(pdf, api, number, dpi) for number in pages]
        finally:
            pdf.close()

    def _page(self, pdf: Any, api: Any, number: int, dpi: int) -> list[RawLine]:
        page = pdf[number - 1]
        try:
            # pdfminer's coordinates are those of the MediaBox; pdfium draws the CropBox.
            page.set_cropbox(*page.get_mediabox())
            bitmap = page.render(scale=dpi / POINTS_PER_INCH, grayscale=True)
            try:
                if bitmap.n_channels != 1:
                    raise ValueError("bitmap")
                api.SetImageBytes(
                    bytes(bitmap.buffer), bitmap.width, bitmap.height, 1, bitmap.stride
                )
            finally:
                bitmap.close()
        finally:
            page.close()
        api.SetSourceResolution(dpi)
        api.Recognize()
        return _raw_lines(api, self._tesserocr)


def _raw_lines(api: Any, tesserocr: Any) -> list[RawLine]:
    level, line_level = tesserocr.RIL.WORD, tesserocr.RIL.TEXTLINE
    lines: list[RawLine] = []
    new_line = True
    for item in tesserocr.iterate_level(api.GetIterator(), level):
        new_line = new_line or item.IsAtBeginningOf(line_level)
        if item.Empty(level):  # a page without words still yields one empty item
            continue
        text = item.GetUTF8Text(level)
        box = item.BoundingBox(level)
        if not text or not text.strip() or box is None:
            continue
        if new_line or not lines:
            baseline = item.Baseline(line_level)
            lines.append(((baseline[0][1] + baseline[1][1]) / 2 if baseline else None, []))
            new_line = False
        confidence = min(max(float(item.Confidence(level)), 0.0), 100.0)
        lines[-1][1].append((text.strip(), confidence, *box))
    return lines


def _load_engine(data_dir: str) -> Engine | None:
    try:
        if not (Path(data_dir) / f"{LANGUAGE}.traineddata").is_file():
            return None
    except (OSError, ValueError):
        return None
    # One thread for a repeatable result; read by OpenMP when the library starts (the macOS wheel
    # of tesserocr 2.12.0 is not linked to OpenMP, so this is only a guard).
    os.environ["OMP_THREAD_LIMIT"] = "1"
    try:
        import pypdfium2
        import tesserocr

        return _Tesseract(tesserocr, pypdfium2, str(data_dir))
    except MemoryError:
        raise
    except Exception:
        # ImportError, or OSError/RuntimeError when a native library does not load: no engine.
        return None


# Seam for the tests: data_dir -> engine, or None when there is no engine.
ENGINE_FACTORY: Callable[[str], Engine | None] = _load_engine


def _lines(number: int, raw_lines: list[RawLine], dpi: int) -> list[Line]:
    scale = POINTS_PER_INCH / dpi
    lines = []
    for baseline, raw_words in raw_lines:
        words = [
            Word(
                text=_nfc(text),
                page=number,
                x0=_r(left * scale),
                top=_r(top * scale),
                x1=_r(right * scale),
                bottom=_r(bottom * scale),
                confidence=_r(confidence),
            )
            for text, confidence, left, top, right, bottom in raw_words
        ]
        if words:
            bottom = max(word.bottom for word in words)
            lines.append(
                _make_line(number, words, bottom if baseline is None else _r(baseline * scale))
            )
    return _reading_order(lines)


@contextlib.contextmanager
def _silent_stderr() -> Iterator[None]:
    """File descriptor 2 goes to the null device meanwhile: Leptonica prints its messages
    («box outside rectangle») straight there, beyond reach of Python's `sys.stderr`."""
    try:
        saved = os.dup(2)
    except OSError:  # no standard error to protect
        yield
        return
    try:
        with open(os.devnull, "wb") as null:
            os.dup2(null.fileno(), 2)
            yield
    finally:
        os.dup2(saved, 2)
        os.close(saved)


def ocr_pages(
    source: bytes | str | Path, pages: list[int], data_dir: str, dpi: int = OCR_DPI
) -> list[list[Line]] | None:
    """Lines of each page in `pages` (numbered from 1), or None when OCR is not available."""
    if not pages:
        return []
    try:
        with _silent_stderr():
            engine = ENGINE_FACTORY(data_dir)
            if engine is None:
                return None
            data = source if isinstance(source, bytes) else Path(source).read_bytes()
            raw_pages = engine.read(data, pages, dpi)
    except MemoryError:
        raise
    except Exception:
        # The message of an engine error may quote what was read: it is dropped.
        return None
    return [_lines(number, raw, dpi) for number, raw in zip(pages, raw_pages)]
