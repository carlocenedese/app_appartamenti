"""Tests for bollette_pdf.parse. Every value here is invented."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_DIR))

from bollette_pdf.parse import (  # noqa: E402
    parse_date,
    parse_date_range,
    parse_euro,
    parse_quantity,
)

EURO_OK = [
    ("1.234,56", 123456),
    ("98,46", 9846),
    ("€ 98,46", 9846),
    ("98,46 €", 9846),
    ("- € 63,00", -6300),
    ("-63,00", -6300),
    ("-€63,00", -6300),
    ("98.46", 9846),
    ("1.234.567,89", 123456789),
    ("1234,56", 123456),
    ("0,05", 5),
    ("  12,00  ", 1200),
    ("100", 10000),
]
EURO_BAD = [
    "1,234.56", "12,3", "1.2.3", "1.234", "1.234,5", "", "   ", "€", "abc",
    "12 34,56", "98,46 e 12,00", "1.23.45", "--5,00", "12,345", "5,00 kWh 3",
    "98,", ",50", "1.2345,00",
]
DATE_OK = [
    ("01/09/2025", "2025-09-01"),
    ("1/9/25", "2025-09-01"),
    ("01.09.2025", "2025-09-01"),
    ("01-09-2025", "2025-09-01"),
    ("1 settembre 2025", "2025-09-01"),
    ("1 set 2025", "2025-09-01"),
    ("1 set. 2025", "2025-09-01"),
    ("1° settembre 2025", "2025-09-01"),
    ("1º SET 25", "2025-09-01"),
    ("15 Gennaio 2024", "2024-01-15"),
    ("29/02/2024", "2024-02-29"),
    ("31 dic 2025", "2025-12-31"),
    ("12/11/25", "2025-11-12"),
    ("5 mag 2025", "2025-05-05"),
]
DATE_BAD = [
    "31/02/2026", "29/02/2025", "29/02/2100", "00/01/2025", "32/01/2025", "01/13/2025",
    "2025-09-01", "09/01", "1 foo 2025", "", "1 settembre", "1/9/125", "1 set 2025 x",
    "01/09/2025 31/10/2025", "1,9,2025",
]
MONTHS = [
    ("gennaio", "gen"), ("febbraio", "feb"), ("marzo", "mar"), ("aprile", "apr"),
    ("maggio", "mag"), ("giugno", "giu"), ("luglio", "lug"), ("agosto", "ago"),
    ("settembre", "set"), ("ottobre", "ott"), ("novembre", "nov"), ("dicembre", "dic"),
]
RANGE_OK = [
    ("dal 01/09/2025 al 31/10/2025", ("2025-09-01", "2025-10-31")),
    ("Dal 01/09/2025 Al 31/10/2025", ("2025-09-01", "2025-10-31")),
    ("01/09/2025 - 31/10/2025", ("2025-09-01", "2025-10-31")),
    ("01/09/2025-31/10/2025", ("2025-09-01", "2025-10-31")),
    ("01.09.2025/31.10.2025", ("2025-09-01", "2025-10-31")),
    ("01.09.2025 / 31.10.2025", ("2025-09-01", "2025-10-31")),
    ("01/09/2025 – 31/10/2025", ("2025-09-01", "2025-10-31")),
    ("01-09-2025 - 31-10-2025", ("2025-09-01", "2025-10-31")),
    ("1/9/25 - 31/10/25", ("2025-09-01", "2025-10-31")),
    ("dal 1 settembre 2025 al 31 ottobre 2025", ("2025-09-01", "2025-10-31")),
    ("01/09/2025 - 01/09/2025", ("2025-09-01", "2025-09-01")),
]
RANGE_BAD = [
    "dal 31/10/2025 al 01/09/2025", "01/09/2025", "dal 01/09/2025 al 31/02/2026",
    "01/09/2025 - ", "", "dal 01/09/2025 al", "01/09/2025 - 31/10/2025 - 30/11/2025",
]
QUANTITY_OK = [
    ("123,4 kWh", ("123.4", "kWh")),
    ("1.234 Smc", ("1234", "Smc")),
    ("98,5", ("98.5", None)),
    ("1.234,56 kWh", ("1234.56", "kWh")),
    ("12 m³", ("12", "m³")),
    ("0,5kWh", ("0.5", "kWh")),
    ("1.234.567", ("1234567", None)),
    ("  7  ", ("7", None)),
]
QUANTITY_BAD = ["", "kWh", "1.2.3", "1,2,3", "12 kWh 3", "98.5 kWh", "1.23 Smc", "1.2345", "12 3 kWh"]


class ParseEuroTest(unittest.TestCase):
    def test_accepted(self):
        for text, cents in EURO_OK:
            with self.subTest(text=text):
                result = parse_euro(text)
                self.assertEqual(result, cents)
                self.assertIs(type(result), int)

    def test_rejected(self):
        for text in EURO_BAD:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_euro(text)


class ParseDateTest(unittest.TestCase):
    def test_accepted(self):
        for text, iso in DATE_OK:
            with self.subTest(text=text):
                result = parse_date(text)
                self.assertEqual(result, iso)
                self.assertIs(type(result), str)

    def test_rejected(self):
        for text in DATE_BAD:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_date(text)

    def test_order_is_day_month_year(self):
        self.assertEqual(parse_date("02/03/04"), "2004-03-02")
        with self.assertRaises(ValueError):
            parse_date("03/25/2025")

    def test_all_months_full_and_abbreviated(self):
        for number, (full, short) in enumerate(MONTHS, start=1):
            expected = f"2025-{number:02d}-01"
            for name in (full, full.upper(), short, short + "."):
                with self.subTest(name=name):
                    self.assertEqual(parse_date(f"1 {name} 2025"), expected)

    def test_accents_are_irrelevant(self):
        self.assertEqual(parse_date("1 Giugno 2025"), "2025-06-01")
        self.assertEqual(parse_date("1 sèt 2025"), "2025-09-01")


class ParseDateRangeTest(unittest.TestCase):
    def test_accepted(self):
        for text, expected in RANGE_OK:
            with self.subTest(text=text):
                result = parse_date_range(text)
                self.assertEqual(result, expected)
                self.assertIs(type(result), tuple)

    def test_rejected(self):
        for text in RANGE_BAD:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_date_range(text)


class ParseQuantityTest(unittest.TestCase):
    def test_accepted(self):
        for text, expected in QUANTITY_OK:
            with self.subTest(text=text):
                result = parse_quantity(text)
                self.assertEqual(result, expected)
                self.assertIsInstance(result[0], str)

    def test_rejected(self):
        for text in QUANTITY_BAD:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    parse_quantity(text)


class NoFloatTest(unittest.TestCase):
    def test_no_result_is_float(self):
        results = [parse_euro("98,46"), parse_date("1/9/25"), *parse_date_range("01/09/2025 - 31/10/2025"),
                   *parse_quantity("123,4 kWh")]
        for value in results:
            self.assertNotIsInstance(value, float)

    def test_source_does_not_use_float(self):
        source = (PYTHON_DIR / "bollette_pdf" / "parse.py").read_text("utf-8")
        self.assertNotIn("float", source)


if __name__ == "__main__":
    unittest.main()
