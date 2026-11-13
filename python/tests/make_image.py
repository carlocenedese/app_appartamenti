"""Synthetic JPEG and PNG images for the image tests, written with the standard library only (no
Pillow). Every text and pixel here is invented.

`make_png` and `make_jpeg` take 8-bit gray rows (`width * height` bytes, top row first). The JPEG
encoder is baseline, one component, with its own flat Huffman tables (valid, not optimal): it is
slow on busy images, so the tests keep them small. `render_band` draws text with pypdfium2 (macOS)
on a gray band; `rotate_cw` / `rotate_ccw` turn such rows by 90 degrees.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

import pdfmaker

ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]
QUANT = 2
COS = [[math.cos((2 * x + 1) * u * math.pi / 16) for x in range(8)] for u in range(8)]
SCALE = [math.sqrt(1 / 8)] + [math.sqrt(2 / 8)] * 7
AC_SYMBOLS = [0x00, 0xF0] + [(run << 4) | size for run in range(16) for size in range(1, 11)]


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def make_png(
    width: int,
    height: int,
    rows: bytes,
    dpi: int | None = None,
    color_type: int = 0,
    interlace: int = 0,
    bit_depth: int = 8,
) -> bytes:
    """A PNG of `rows` (raw samples, top row first); every scanline gets filter type 0."""
    stride = len(rows) // height
    raw = b"".join(b"\0" + rows[y * stride : (y + 1) * stride] for y in range(height))
    out = b"\x89PNG\r\n\x1a\n"
    out += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, interlace))
    if dpi is not None:
        out += _chunk(b"pHYs", struct.pack(">IIB", round(dpi / 0.0254), round(dpi / 0.0254), 1))
    out += _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")
    return out


def exif(orientation: int | None = None, dpi: int | None = None, big_endian: bool = True) -> bytes:
    """Body of an APP1 segment with the orientation and/or the resolution (inches)."""
    end = ">" if big_endian else "<"
    entries = []
    if orientation is not None:
        entries.append((0x0112, 3, struct.pack(end + "HH", orientation, 0)))
    data = b""
    base = 8 + 2 + 12 * (len(entries) + (3 if dpi is not None else 0)) + 4
    if dpi is not None:
        rational = struct.pack(end + "II", dpi, 1)
        entries.append((0x011A, 5, struct.pack(end + "I", base)))
        entries.append((0x011B, 5, struct.pack(end + "I", base)))
        entries.append((0x0128, 3, struct.pack(end + "HH", 2, 0)))
        data = rational
    body = (b"MM" if big_endian else b"II") + struct.pack(end + "HI", 42, 8)
    body += struct.pack(end + "H", len(entries))
    for tag, kind, value in entries:
        body += struct.pack(end + "HHI", tag, kind, 1) + value
    return b"Exif\0\0" + body + struct.pack(end + "I", 0) + data


def _dct(block: list[list[int]]) -> list[int]:
    rows = [[sum(block[y][x] * COS[u][x] for x in range(8)) * SCALE[u] for u in range(8)] for y in range(8)]
    out = [0] * 64
    for u in range(8):
        for v in range(8):
            out[v * 8 + u] = round(sum(rows[y][u] * COS[v][y] for y in range(8)) * SCALE[v] / QUANT)
    return out


class _Bits:
    def __init__(self) -> None:
        self.out = bytearray()
        self.acc = 0
        self.count = 0

    def put(self, value: int, length: int) -> None:
        self.acc = (self.acc << length) | (value & ((1 << length) - 1))
        self.count += length
        while self.count >= 8:
            byte = (self.acc >> (self.count - 8)) & 0xFF
            self.out.append(byte)
            if byte == 0xFF:
                self.out.append(0)
            self.count -= 8
        self.acc &= (1 << self.count) - 1

    def finish(self) -> bytes:
        if self.count:
            self.put((1 << (8 - self.count)) - 1, 8 - self.count)
        return bytes(self.out)


def _magnitude(bits: _Bits, value: int) -> int:
    size = abs(value).bit_length()
    return size, (value if value >= 0 else value + (1 << size) - 1)  # type: ignore[return-value]


def _encode_scan(width: int, height: int, rows: bytes) -> bytes:
    bits = _Bits()
    previous = 0
    ac_code = {symbol: index for index, symbol in enumerate(AC_SYMBOLS)}
    for by in range(0, height, 8):
        for bx in range(0, width, 8):
            block = [
                [rows[min(by + y, height - 1) * width + min(bx + x, width - 1)] for x in range(8)]
                for y in range(8)
            ]
            flat = {value for line in block for value in line}
            if len(flat) == 1:
                coefficients = [4 * (flat.pop() - 128)] + [0] * 63  # DC only: 8 * (v - 128) / QUANT
            else:
                coefficients = _dct([[value - 128 for value in line] for line in block])
            size, extra = _magnitude(bits, coefficients[0] - previous)
            previous = coefficients[0]
            bits.put(size, 4)  # DC symbol = its size, as a 4-bit code
            bits.put(extra, size)
            run = 0
            last = max((i for i in range(1, 64) if coefficients[ZIGZAG[i]]), default=0)
            for index in range(1, last + 1):
                value = coefficients[ZIGZAG[index]]
                if value == 0:
                    run += 1
                    continue
                while run > 15:
                    bits.put(ac_code[0xF0], 8)
                    run -= 16
                size, extra = _magnitude(bits, value)
                bits.put(ac_code[(run << 4) | size], 8)
                bits.put(extra, size)
                run = 0
            if last < 63:
                bits.put(ac_code[0x00], 8)
    return bits.finish()


def _segment(marker: int, body: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body


def make_jpeg(
    width: int, height: int, rows: bytes, orientation: int | None = None, dpi: int | None = None,
    big_endian: bool = True,
) -> bytes:
    """A baseline gray JPEG of `rows` (8-bit, top row first), with an optional EXIF segment."""
    out = b"\xff\xd8"
    if orientation is not None or dpi is not None:
        out += _segment(0xE1, exif(orientation, dpi, big_endian))
    out += _segment(0xDB, b"\0" + bytes([QUANT] * 64))
    out += _segment(0xC0, struct.pack(">BHHB", 8, height, width, 1) + b"\x01\x11\x00")
    out += _segment(0xC4, b"\x00" + bytes([0] * 3 + [12] + [0] * 12) + bytes(range(12)))
    out += _segment(0xC4, b"\x10" + bytes([0] * 7 + [len(AC_SYMBOLS)] + [0] * 8) + bytes(AC_SYMBOLS))
    out += _segment(0xDA, b"\x01\x01\x00\x00\x3f\x00")
    return out + _encode_scan(width, height, rows) + b"\xff\xd9"


def jpeg_header(width: int, height: int) -> bytes:
    """Only the markers of a JPEG of that size (no real image data): for the size limit."""
    return (
        b"\xff\xd8"
        + _segment(0xC0, struct.pack(">BHHB", 8, height, width, 1) + b"\x01\x11\x00")
        + _segment(0xDA, b"\x01\x01\x00\x00\x3f\x00")
        + b"\x00\xff\xd9"
    )


def render_band(items: list[tuple], width: int = 1400, height: int = 260, dpi: int = 300) -> bytes:
    """Gray rows (`width * height`) of the top-left corner of a page with `items` (see pdfmaker)."""
    import tempfile

    import pypdfium2

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "pagina.pdf"
        pdfmaker.make_pdf(path, [items])
        pdf = pypdfium2.PdfDocument(path.read_bytes())
    try:
        bitmap = pdf[0].render(scale=dpi / 72, grayscale=True)
        buffer = bytes(bitmap.buffer)
        stride = bitmap.stride
        bitmap.close()
    finally:
        pdf.close()
    return b"".join(buffer[y * stride : y * stride + width] for y in range(height))


def rotate_cw(width: int, height: int, rows: bytes) -> tuple[int, int, bytes]:
    """The image turned 90 degrees clockwise: (new width, new height, rows)."""
    out = bytearray()
    for y in range(width):
        out += bytes(rows[(height - 1 - x) * width + y] for x in range(height))
    return height, width, bytes(out)


def rotate_ccw(width: int, height: int, rows: bytes) -> tuple[int, int, bytes]:
    out = bytearray()
    for y in range(width):
        out += bytes(rows[x * width + (width - 1 - y)] for x in range(height))
    return height, width, bytes(out)
