"""JPEG and PNG files as input: recognised by their first bytes, checked without any imaging
library, and wrapped in a one-page PDF so that the OCR path of `ocr.py` reads them like a scan.

The headers are parsed here (signature, size, resolution, EXIF orientation, structure); the pixels
are never decoded: pdfium decodes the image when it draws the page, and the page matrix applies
the EXIF orientation (rotation and mirroring), so no imaging library is needed (rule R88). That
also means everything but the drawing works without the OCR engine: a file that is too big,
corrupt or of an unsupported kind is reported as `ImageError` on every platform.

Resolution: EXIF (JPEG) or pHYs (PNG) when present and between 72 and 1200 dpi, else 300. The page
is `pixels * 72 / dpi` points on each side, so coordinates are in points like those of a PDF.
Messages are Italian and generic: they never quote the file.

No network, no clock, no randomness.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

DEFAULT_DPI = 300
MIN_DPI, MAX_DPI = 72, 1200
MAX_PIXELS = 30_000_000

_JPEG = b"\xff\xd8\xff"
_PNG = b"\x89PNG\r\n\x1a\n"
EXTENSIONS = (".jpg", ".jpeg", ".png")

UNREADABLE = "Il file non è un'immagine JPEG o PNG leggibile: potrebbe essere danneggiato."
TOO_BIG = "L'immagine supera i 30 megapixel: è troppo grande per essere letta."
UNSUPPORTED = "Questa variante del formato immagine non è supportata."
UNSUPPORTED_PNG = "Questa variante di PNG (con trasparenza o interlacciata) non è supportata."

# Orientation (EXIF 1-8) -> (a1, b1, c1, a2, b2, c2) with c in {0, W, H} written as strings:
# the displayed point of the stored pixel (x, y) is (a1*x + b1*y + c1, a2*x + b2*y + c2), y down.
_ORIENTATIONS = {
    1: (1, 0, "0", 0, 1, "0"),
    2: (-1, 0, "W", 0, 1, "0"),
    3: (-1, 0, "W", 0, -1, "H"),
    4: (1, 0, "0", 0, -1, "H"),
    5: (0, 1, "0", 1, 0, "0"),
    6: (0, -1, "H", 1, 0, "0"),
    7: (0, -1, "H", -1, 0, "W"),
    8: (0, 1, "0", -1, 0, "W"),
}


class ImageError(Exception):
    """The file is not a readable, supported image. The message is Italian and generic."""


@dataclass(frozen=True)
class ImageInfo:
    kind: str  # 'jpeg' or 'png'
    width: int
    height: int
    dpi: int
    orientation: int = 1
    # JPEG: 0 gray, 2 RGB. PNG: the colour type (0, 2 or 3).
    color_type: int = 0
    bit_depth: int = 8
    idat: bytes = b""  # PNG: the concatenated data of the IDAT chunks
    palette: bytes = b""  # PNG: the PLTE chunk


def sniff(data: bytes) -> str | None:
    """'jpeg' or 'png' by the first bytes, else None. The extension plays no part."""
    if data.startswith(_JPEG):
        return "jpeg"
    if data.startswith(_PNG):
        return "png"
    return None


def parse_image(data: bytes) -> ImageInfo:
    """Header and structure of a JPEG or PNG; raises ImageError. Never decodes pixels."""
    try:
        kind = sniff(data)
        if kind == "jpeg":
            return _parse_jpeg(data)
        if kind == "png":
            return _parse_png(data)
    except (struct.error, IndexError, zlib.error, ValueError):
        pass
    raise ImageError(UNREADABLE)


def _sane(dpi: float | None) -> int:
    if dpi is None or not MIN_DPI <= round(dpi) <= MAX_DPI:
        return DEFAULT_DPI
    return round(dpi)


def _check_size(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise ImageError(UNREADABLE)
    if width * height > MAX_PIXELS:
        raise ImageError(TOO_BIG)


def _exif(segment: bytes) -> tuple[int, float | None]:
    """(orientation 1-8, dpi or None) of an Exif APP1 body; any oddity gives the defaults."""
    try:
        tiff = segment[6:]
        order = {b"MM": ">", b"II": "<"}[tiff[:2]]
        if struct.unpack_from(order + "H", tiff, 2)[0] != 42:
            return 1, None
        start = struct.unpack_from(order + "I", tiff, 4)[0]
        count = struct.unpack_from(order + "H", tiff, start)[0]
        orientation, unit, dpi = 1, 2, None
        for index in range(min(count, 64)):
            tag, kind = struct.unpack_from(order + "HH", tiff, start + 2 + 12 * index)
            at = start + 2 + 12 * index + 8
            if tag == 0x0112 and kind == 3:
                orientation = struct.unpack_from(order + "H", tiff, at)[0]
            elif tag == 0x0128 and kind == 3:
                unit = struct.unpack_from(order + "H", tiff, at)[0]
            elif tag == 0x011A and kind == 5:
                number, divisor = struct.unpack_from(order + "II", tiff, struct.unpack_from(order + "I", tiff, at)[0])
                dpi = number / divisor
        if unit == 3 and dpi is not None:
            dpi *= 2.54
        elif unit != 2:
            dpi = None
        return (orientation if orientation in _ORIENTATIONS else 1), dpi
    except (KeyError, struct.error, ZeroDivisionError):
        return 1, None


def _parse_jpeg(data: bytes) -> ImageInfo:
    size = len(data)
    position = 2
    orientation, dpi, found, exif_seen = 1, None, None, False
    while True:
        if position + 4 > size or data[position] != 0xFF:
            raise ValueError
        while data[position] == 0xFF:  # fill bytes
            position += 1
        marker = data[position]
        position += 1
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            continue
        if marker in (0xD8, 0xD9, 0x00):
            raise ValueError
        length = struct.unpack_from(">H", data, position)[0]
        if length < 2 or position + length > size:
            raise ValueError
        body = data[position + 2 : position + length]
        position += length
        if marker == 0xE1 and body.startswith(b"Exif\0\0") and not exif_seen:
            exif_seen = True
            orientation, dpi = _exif(body)
        elif marker in (0xC0, 0xC1, 0xC2):
            precision, height, width, components = struct.unpack_from(">BHHB", body)
            if precision != 8 or components not in (1, 3):
                raise ImageError(UNSUPPORTED)
            _check_size(width, height)
            found = (width, height, 0 if components == 1 else 2)
        elif marker in (0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            raise ImageError(UNSUPPORTED)
        elif marker == 0xDA:
            break
    # A file cut short lacks its end marker (trailing zero bytes and blanks are tolerated).
    if found is None or not data.rstrip(b"\0 \r\n").endswith(b"\xff\xd9"):
        raise ValueError
    width, height, color_type = found
    return ImageInfo("jpeg", width, height, _sane(dpi), orientation, color_type)


_CHANNELS = {0: 1, 2: 3, 3: 1}
_DEPTHS = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8)}


def _parse_png(data: bytes) -> ImageInfo:
    position, header, idat, palette, dpi, ended = 8, None, [], b"", None, False
    while position < len(data) and not ended:
        length, kind = struct.unpack_from(">I4s", data, position)
        body = data[position + 8 : position + 8 + length]
        (crc,) = struct.unpack_from(">I", data, position + 8 + length)
        if len(body) != length or crc != zlib.crc32(kind + body):
            raise ValueError
        position += 12 + length
        if header is None and (kind != b"IHDR" or length != 13):
            raise ValueError
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            palette = body
        elif kind == b"pHYs" and length == 9:
            x, _, unit = struct.unpack(">IIB", body)
            dpi = x * 0.0254 if unit == 1 else None
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            ended = True
    if header is None or not ended or not idat:
        raise ValueError
    width, height, depth, color, compression, filtering, interlace = header
    _check_size(width, height)
    if compression or filtering or interlace not in (0, 1) or color not in (0, 2, 3, 4, 6):
        raise ValueError
    if color in (4, 6) or interlace:
        raise ImageError(UNSUPPORTED_PNG)
    if depth not in _DEPTHS[color]:
        raise ValueError
    if color == 3 and (len(palette) % 3 or not 3 <= len(palette) <= 3 * (1 << depth)):
        raise ValueError
    _check_inflates(b"".join(idat), height * (1 + (width * _CHANNELS[color] * depth + 7) // 8))
    return ImageInfo("png", width, height, _sane(dpi), 1, color, depth, b"".join(idat), palette)


def _check_inflates(data: bytes, expected: int) -> None:
    """The IDAT data must inflate to exactly the number of bytes the header promises.

    Stops as soon as the output exceeds `expected` (a decompression bomb is never inflated), and
    keeps asking with no input while output is pending: zlib can consume all the input and still
    hold output, with an empty `unconsumed_tail`."""
    inflater, total, chunk = zlib.decompressobj(), 0, data
    while not inflater.eof:
        out = inflater.decompress(chunk, 1 << 16)
        total += len(out)
        if total > expected:
            raise ValueError
        chunk = inflater.unconsumed_tail
        if not out and not chunk:  # no progress: the data is cut short
            break
    if not inflater.eof or inflater.unused_data or total != expected:
        raise ValueError


def _number(value: float) -> str:
    return "%g" % round(value, 4)


def image_pdf(data: bytes, info: ImageInfo) -> bytes:
    """A PDF of one page that shows the image upright, `pixels * 72 / dpi` points on each side
    (sides swapped for the orientations 5-8); the EXIF orientation is the matrix of the drawing."""
    k = 72 / info.dpi
    w, h = info.width, info.height
    a1, b1, c1, a2, b2, c2 = _ORIENTATIONS[info.orientation]
    c1, c2 = ({"0": 0, "W": w, "H": h}[c1], {"0": 0, "W": w, "H": h}[c2])
    page_w, page_h = (h, w) if info.orientation >= 5 else (w, h)
    matrix = (
        k * a1 * w, -k * a2 * w, -k * b1 * h, k * b2 * h,
        k * (b1 * h + c1), k * (page_h - (b2 * h + c2)),
    )
    if info.kind == "jpeg":
        space = b"/DeviceGray" if info.color_type == 0 else b"/DeviceRGB"
        extra, stream = b"/Filter /DCTDecode", data
    else:
        if info.color_type == 3:
            space = b"[/Indexed /DeviceRGB %d <%s>]" % (len(info.palette) // 3 - 1, info.palette.hex().encode())
        else:
            space = b"/DeviceGray" if info.color_type == 0 else b"/DeviceRGB"
        extra = (
            b"/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent %d /Columns %d >>"
            % (_CHANNELS[info.color_type], info.bit_depth, w)
        )
        stream = info.idat
    content = b"q\n" + " ".join("%.4f" % value for value in matrix).encode() + b" cm /Im0 Do\nQ"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /XObject << /Im0 5 0 R >> >> "
        b"/Contents 4 0 R >>" % (_number(page_w * k).encode(), _number(page_h * k).encode()),
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent %d %s "
        b"/Length %d >>\nstream\n" % (w, h, space, info.bit_depth, extra, len(stream)) + stream + b"\nendstream",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)
