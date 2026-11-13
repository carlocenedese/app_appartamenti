"""Synthetic scanned PDFs for the OCR tests. Every text here is invented.

`make_scan_pdf(path, pages, scanned)` writes the pages of `pdfmaker` (items `(x, y, text)` or
`(x, y, text, size)`), but each page whose 1-based number is in `scanned` (all pages when
`scanned` is None) is replaced by a grayscale image of itself, drawn with pypdfium2 at `dpi`
and covering the whole page, with no text layer. Needs pypdfium2 (macOS), never Pillow.
"""

from __future__ import annotations

import tempfile
import zlib
from pathlib import Path

import pdfmaker

Items = list[tuple]


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


def make_scan_pdf(path: Path, pages: list[Items], scanned: set[int] | None = None, dpi: int = 200) -> None:
    with tempfile.TemporaryDirectory() as folder:
        text_path = Path(folder) / "testo.pdf"
        pdfmaker.make_pdf(text_path, pages)
        images = _render(text_path.read_bytes(), dpi)
    objects = pdfmaker._document_objects(pages)
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
        image = len(objects)
        stream = b"q %.2f 0 0 %.2f 0 0 cm /Im1 Do Q" % (pdfmaker.PAGE_WIDTH, pdfmaker.PAGE_HEIGHT)
        # Page n is object 4 + 2(n-1), its content stream the next one (see pdfmaker).
        objects[3 + 2 * index] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] "
            b"/Resources << /XObject << /Im1 %d 0 R >> >> /Contents %d 0 R >>"
            % (pdfmaker.PAGE_WIDTH, pdfmaker.PAGE_HEIGHT, image, 5 + 2 * index)
        )
        objects[4 + 2 * index] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
    pdfmaker._write(path, objects)
