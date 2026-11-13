"""Tests for the image parser (`bollette_pdf/images.py`): no engine needed. Everything is invented."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import make_image  # noqa: E402
from bollette_pdf import images  # noqa: E402
from bollette_pdf.images import ImageError, image_pdf, parse_image, sniff  # noqa: E402

ROWS = bytes((x * 7 + y * 3) % 256 for y in range(16) for x in range(24))  # 24 x 16
JPEG = make_image.make_jpeg(24, 16, ROWS)
PNG = make_image.make_png(24, 16, ROWS)


class SignatureTest(unittest.TestCase):
    def test_sniff(self) -> None:
        self.assertEqual((sniff(JPEG), sniff(PNG)), ("jpeg", "png"))
        self.assertIsNone(sniff(b"%PDF-1.4\n"))
        self.assertIsNone(sniff(b"\xff\xd8"))
        self.assertIsNone(sniff(b""))


class JpegTest(unittest.TestCase):
    def test_size_and_defaults(self) -> None:
        info = parse_image(JPEG)
        self.assertEqual((info.kind, info.width, info.height, info.dpi, info.orientation), ("jpeg", 24, 16, 300, 1))

    def test_exif_orientation_and_dpi_both_byte_orders(self) -> None:
        for big in (True, False):
            info = parse_image(make_image.make_jpeg(24, 16, ROWS, orientation=6, dpi=150, big_endian=big))
            self.assertEqual((info.orientation, info.dpi), (6, 150))

    def test_orientation_out_of_range_and_insane_dpi_are_ignored(self) -> None:
        info = parse_image(make_image.make_jpeg(24, 16, ROWS, orientation=9, dpi=10))
        self.assertEqual((info.orientation, info.dpi), (1, 300))
        self.assertEqual(parse_image(make_image.make_jpeg(24, 16, ROWS, dpi=2000)).dpi, 300)

    def test_broken_exif_is_ignored_not_fatal(self) -> None:
        broken = JPEG[:2] + b"\xff\xe1\x00\x0bExif\x00\x00MM\x00" + JPEG[2:]
        info = parse_image(broken)
        self.assertEqual((info.orientation, info.dpi), (1, 300))

    def test_truncated_or_headerless_files_are_errors(self) -> None:
        for data in (JPEG[:-2], JPEG[:30], b"\xff\xd8\xff", b"\xff\xd8\xff\xe0\x00"):
            with self.assertRaises(ImageError):
                parse_image(data)

    def test_limit_is_thirty_megapixels(self) -> None:
        self.assertEqual(parse_image(make_image.jpeg_header(6000, 5000)).width, 6000)
        with self.assertRaises(ImageError) as caught:
            parse_image(make_image.jpeg_header(6001, 5000))
        self.assertIn("30 megapixel", str(caught.exception))
        with self.assertRaises(ImageError):
            parse_image(make_image.jpeg_header(8000, 5000))

    def test_zero_size_is_an_error(self) -> None:
        with self.assertRaises(ImageError):
            parse_image(make_image.jpeg_header(0, 10))


class PngTest(unittest.TestCase):
    def test_size_and_dpi(self) -> None:
        info = parse_image(PNG)
        self.assertEqual((info.kind, info.width, info.height, info.dpi, info.orientation), ("png", 24, 16, 300, 1))
        self.assertEqual(parse_image(make_image.make_png(24, 16, ROWS, dpi=150)).dpi, 150)
        self.assertEqual(parse_image(make_image.make_png(24, 16, ROWS, dpi=20)).dpi, 300)

    def test_corrupt_png_is_an_error(self) -> None:
        flipped = bytearray(PNG)
        flipped[len(PNG) // 2] ^= 0xFF
        for data in (bytes(flipped), PNG[:-12], PNG[:40], PNG[:8], PNG[:-12] + b"\0" * 12):
            with self.assertRaises(ImageError):
                parse_image(data)

    def test_data_shorter_than_the_header_says_is_an_error(self) -> None:
        with self.assertRaises(ImageError):
            parse_image(_rewrite_header(PNG, 24, 17))

    def test_limit_is_thirty_megapixels(self) -> None:
        with self.assertRaises(ImageError) as caught:
            parse_image(_rewrite_header(PNG, 8000, 5000))
        self.assertIn("30 megapixel", str(caught.exception))

    def test_alpha_and_interlaced_are_not_supported(self) -> None:
        alpha = make_image.make_png(2, 2, bytes(16), color_type=6)
        interlaced = make_image.make_png(24, 16, ROWS, interlace=1)
        for data in (alpha, interlaced):
            with self.assertRaises(ImageError) as caught:
                parse_image(data)
            self.assertIn("non è supportata", str(caught.exception))


def _rewrite_header(png: bytes, width: int, height: int) -> bytes:
    import struct
    import zlib

    body = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    chunk = struct.pack(">I", 13) + b"IHDR" + body + struct.pack(">I", zlib.crc32(b"IHDR" + body))
    return png[:8] + chunk + png[8 + 25 :]


class PdfWrapperTest(unittest.TestCase):
    def cm(self, data: bytes) -> list[float]:
        pdf = image_pdf(data, parse_image(data))
        line = [part for part in pdf.split(b"\n") if part.endswith(b"cm /Im0 Do")][0]
        return [float(value) for value in line.split()[:6]]

    def media_box(self, data: bytes) -> list[float]:
        pdf = image_pdf(data, parse_image(data))
        start = pdf.index(b"/MediaBox [") + len(b"/MediaBox [")
        return [float(value) for value in pdf[start : pdf.index(b"]", start)].split()]

    def test_upright_image_fills_a_page_of_pixels_times_72_over_dpi(self) -> None:
        for dpi, k in ((300, 72 / 300), (150, 72 / 150)):
            data = make_image.make_png(24, 16, ROWS, dpi=dpi)
            self.assertEqual(self.media_box(data), [0, 0, round(24 * k, 4), round(16 * k, 4)])
            self.assertEqual(self.cm(data), [round(24 * k, 4), 0, 0, round(16 * k, 4), 0, 0])

    def test_orientations(self) -> None:
        k = 72 / 300
        w, h = round(24 * k, 4), round(16 * k, 4)
        expected = {
            1: ([w, 0, 0, h, 0, 0], (w, h)),
            2: ([-w, 0, 0, h, w, 0], (w, h)),
            3: ([-w, 0, 0, -h, w, h], (w, h)),
            4: ([w, 0, 0, -h, 0, h], (w, h)),
            5: ([0, -w, -h, 0, h, w], (h, w)),
            6: ([0, -w, h, 0, 0, w], (h, w)),
            7: ([0, w, h, 0, 0, 0], (h, w)),
            8: ([0, w, -h, 0, h, 0], (h, w)),
        }
        for orientation, (matrix, (page_w, page_h)) in expected.items():
            data = make_image.make_jpeg(24, 16, ROWS, orientation=orientation)
            with self.subTest(orientation=orientation):
                self.assertEqual(self.media_box(data), [0, 0, page_w, page_h])
                for got, want in zip(self.cm(data), matrix):
                    self.assertAlmostEqual(got, want, places=3)

    def test_jpeg_is_embedded_as_it_is_and_png_keeps_its_compressed_data(self) -> None:
        self.assertIn(JPEG, image_pdf(JPEG, parse_image(JPEG)))
        self.assertIn(b"/DCTDecode", image_pdf(JPEG, parse_image(JPEG)))
        pdf = image_pdf(PNG, parse_image(PNG))
        self.assertIn(b"/FlateDecode", pdf)
        self.assertIn(b"/Predictor 15", pdf)

    def test_constants(self) -> None:
        self.assertEqual((images.MAX_PIXELS, images.DEFAULT_DPI), (30_000_000, 300))


if __name__ == "__main__":
    unittest.main()
