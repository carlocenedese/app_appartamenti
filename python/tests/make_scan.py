"""Synthetic scanned PDFs for the OCR tests. Every text here is invented.

`make_scan_pdf(path, pages, scanned)` writes the pages of `pdfmaker` (items `(x, y, text)` or
`(x, y, text, size)`), but each page whose 1-based number is in `scanned` (all pages when
`scanned` is None) is replaced by a grayscale image of itself, drawn with pypdfium2 at `dpi`
and covering the whole page, with no text layer. Needs pypdfium2 (macOS), never Pillow.

With `rotated=True` every page has `/Rotate 90` and a landscape MediaBox whose content is drawn
turned, so that the page is shown upright (A4 portrait) and the item coordinates stay those of the
page as shown. `offset` moves the origin of the MediaBox (`[ox oy ox+w oy+h]`).
`make_text_pdf` writes the same pages with their text layer, to compare with the scan.
"""

from __future__ import annotations

import tempfile
import zlib
from pathlib import Path

import pdfmaker

Items = list[tuple]
W, H = pdfmaker.PAGE_WIDTH, pdfmaker.PAGE_HEIGHT


def _page(resources: bytes, content: int, rotated: bool, offset: tuple[float, float]) -> bytes:
    ox, oy = offset
    width, height = (H, W) if rotated else (W, H)
    return b"<< /Type /Page /Parent 2 0 R /MediaBox [%.2f %.2f %.2f %.2f]%s /Resources %s /Contents %d 0 R >>" % (
        ox, oy, ox + width, oy + height, b" /Rotate 90" if rotated else b"", resources, content
    )


def _stream(body: bytes, rotated: bool, offset: tuple[float, float]) -> bytes:
    ox, oy = offset
    # Maps the coordinates of the page as shown to those of the MediaBox. /Rotate 90 turns the
    # page clockwise when shown: shown (X, Y) is user (ox + H - Y, oy + X).
    cm = b"0 1 -1 0 %.2f %.2f cm" % (ox + H, oy) if rotated else b"1 0 0 1 %.2f %.2f cm" % (ox, oy)
    stream = b"q " + cm + b"\n" + body + b"\nQ"
    return b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"


def _text_objects(pages: list[Items], rotated: bool, offset: tuple[float, float]) -> list[bytes]:
    objects = pdfmaker._document_objects(pages)
    # Page n is object 4 + 2(n-1), its content stream the next one (see pdfmaker).
    for index, items in enumerate(pages):
        objects[3 + 2 * index] = _page(b"<< /Font << /F1 3 0 R >> >>", 5 + 2 * index, rotated, offset)
        objects[4 + 2 * index] = _stream(pdfmaker._content(items), rotated, offset)
    return objects


def make_text_pdf(
    path: Path, pages: list[Items], rotated: bool = False, offset: tuple[float, float] = (0, 0)
) -> None:
    pdfmaker._write(path, _text_objects(pages, rotated, offset))


def _render(text_pdf: bytes, dpi: int) -> list[tuple[int, int, bytes]]:
    import pypdfium2

    images = []
    pdf = pypdfium2.PdfDocument(text_pdf)
    try:
        for page in pdf:
            bitmap = page.render(scale=dpi / 72, grayscale=True)
            if bitmap.n_channels != 1:
                raise ValueError("bitmap non in scala di grigi")
            buffer = bytes(bitmap.buffer)
            rows = b"".join(
                buffer[row * bitmap.stride : row * bitmap.stride + bitmap.width]
                for row in range(bitmap.height)
            )
            images.append((bitmap.width, bitmap.height, rows))
    finally:
        pdf.close()
    return images


def make_scan_pdf(
    path: Path,
    pages: list[Items],
    scanned: set[int] | None = None,
    dpi: int = 200,
    rotated: bool = False,
    offset: tuple[float, float] = (0, 0),
) -> None:
    objects = _text_objects(pages, rotated, offset)
    with tempfile.TemporaryDirectory() as folder:
        text_path = Path(folder) / "testo.pdf"
        pdfmaker._write(text_path, objects)
        images = _render(text_path.read_bytes(), dpi)
    for index, (width, height, rows) in enumerate(images):
        if scanned is not None and index + 1 not in scanned:
            continue
        data = zlib.compress(rows)
        objects.append(
            b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
            b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (width, height, len(data))
            + data
            + b"\nendstream"
        )
        image = b"<< /XObject << /Im1 %d 0 R >> >>" % len(objects)
        objects[3 + 2 * index] = _page(image, 5 + 2 * index, rotated, offset)
        objects[4 + 2 * index] = _stream(b"%.2f 0 0 %.2f 0 0 cm /Im1 Do" % (W, H), rotated, offset)
    pdfmaker._write(path, objects)
