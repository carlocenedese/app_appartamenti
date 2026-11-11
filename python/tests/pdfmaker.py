"""Minimal dependency-free PDF writer for tests. Every text here is invented.

Pages are A4 (595.28 x 841.89 points), text is Helvetica 10 pt, and each text item is
`(x, y, text)` with x from the left edge and y from the TOP edge, in points; y is the baseline.
Only text that fits WinAnsi (cp1252) can be written: Latin letters with accents, and the euro
sign as `€`. Other characters raise UnicodeEncodeError. The cross-reference table is exact.
"""

from __future__ import annotations

from pathlib import Path

PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
FONT_SIZE = 10


def _escape(text: str) -> bytes:
    raw = text.encode("cp1252")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _content(items: list[tuple[float, float, str]]) -> bytes:
    """Text items are `(x, y, text)`, or `(x, y, text, size)` for a size other than 10 pt."""
    parts = []
    for item in items:
        x, y, text = item[:3]
        size = item[3] if len(item) > 3 else FONT_SIZE  # type: ignore[misc]
        pdf_y = PAGE_HEIGHT - y
        parts.append(
            b"BT /F1 %g Tf %.2f %.2f Td (" % (size, x, pdf_y) + _escape(text) + b") Tj ET"
        )
    return b"\n".join(parts)


def _write(path: Path, objects: list[bytes], trailer_extra: bytes = b"") -> None:
    """Writes numbered objects (object n is objects[n - 1]); object 1 is the catalog."""
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R%s >>\n" % (len(objects) + 1, trailer_extra)
    out += b"startxref\n%d\n%%%%EOF\n" % xref
    Path(path).write_bytes(bytes(out))


def _document_objects(pages: list[list[tuple[float, float, str]]]) -> list[bytes]:
    # 1 catalog, 2 page tree, 3 font, then for every page a page object and a content stream.
    kids = b" ".join(b"%d 0 R" % (4 + 2 * i) for i in range(len(pages)))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(pages)),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    for i, items in enumerate(pages):
        stream = _content(items)
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] "
            b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>"
            % (PAGE_WIDTH, PAGE_HEIGHT, 5 + 2 * i)
        )
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    return objects


def make_pdf(path: Path, pages: list[list[tuple[float, float, str]]]) -> None:
    """Writes a PDF with one page per list of `(x, y, text)` items."""
    _write(path, _document_objects(pages))


def make_form_pdf(path: Path, items: list[tuple[float, float, str]]) -> None:
    """Writes a one-page PDF whose text is inside a Form XObject drawn with `Do`."""
    stream = _content(items)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] "
        b"/Resources << /XObject << /Fm1 6 0 R >> >> /Contents 5 0 R >>" % (PAGE_WIDTH, PAGE_HEIGHT),
        b"<< /Length 7 >>\nstream\n/Fm1 Do\nendstream",
        b"<< /Type /XObject /Subtype /Form /BBox [0 0 %.2f %.2f] "
        b"/Resources << /Font << /F1 3 0 R >> >> /Length %d >>\nstream\n" % (PAGE_WIDTH, PAGE_HEIGHT, len(stream))
        + stream + b"\nendstream",
    ]
    _write(path, objects)


def make_blank_pdf(path: Path) -> None:
    """Writes a one-page PDF with no text."""
    make_pdf(path, [[]])


def make_encrypted_pdf(path: Path) -> None:
    """Writes a PDF with a Standard security handler (V 1, R 2, 40 bit) and arbitrary keys.

    Nothing is really encrypted: the /U entry does not match the empty password, so a reader
    that checks the password fails, which is the case under test.
    """
    objects = _document_objects([[(72, 100, "Testo riservato")]])
    objects.append(
        b"<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <" + b"41" * 32 + b"> /U <"
        + b"42" * 32 + b"> >>"
    )
    encrypt = len(objects)
    _write(
        path,
        objects,
        b" /Encrypt %d 0 R /ID [<" % encrypt + b"43" * 16 + b"> <" + b"43" * 16 + b">]",
    )
