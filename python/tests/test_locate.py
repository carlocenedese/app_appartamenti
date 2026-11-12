"""Tests for the `below` position of bollette_pdf.locate. Every text here is invented."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bollette_pdf.locate import Layout  # noqa: E402
from bollette_pdf.reader import Document, Line, Word  # noqa: E402


def line(text: str, x0: float, baseline: float) -> Line:
    words = []
    x = x0
    for token in text.split():
        words.append(Word(token, 1, x, baseline - 8, x + 6 * len(token), baseline + 2))
        x += 6 * len(token) + 4
    return Line(1, text, tuple(words), x0, baseline - 8, x - 4, baseline + 2, baseline)


def layout(lines: list[Line]) -> Layout:
    lines.sort(key=lambda item: item.baseline)
    return Layout(Document("h", "f.pdf", 1, tuple(lines), True))


def below(lines: list[Line]) -> str | None:
    lay = layout(lines)
    found = lay.candidate(lay.anchors("PERIODO")[0], "below")
    return found.text if found else None


class BelowTests(unittest.TestCase):
    def test_one_character_rows_on_the_margin_do_not_use_the_budget(self) -> None:
        strip = [line(c, 560, 120 + 10 * n) for n, c in enumerate("abc")]
        lines = [line("PERIODO", 50, 100), line("AGO. 2022 - SET. 2022", 50, 112), *strip]
        self.assertEqual(below(lines), "AGO. 2022 - SET. 2022")

    def test_value_two_rows_down_past_three_strip_rows(self) -> None:
        strip = [line(c, 560, 104 + 4 * n) for n, c in enumerate("abc")]
        lines = [line("PERIODO", 50, 100), *strip, line("AGO. 2022 - SET. 2022", 50, 120)]
        self.assertEqual(below(lines), "AGO. 2022 - SET. 2022")

    def test_real_rows_still_use_the_budget(self) -> None:
        filler = [line("riga di testo", 300, 112 + 12 * n) for n in range(3)]
        lines = [line("PERIODO", 50, 100), *filler, line("AGO. 2022 - SET. 2022", 50, 160)]
        self.assertIsNone(below(lines))


if __name__ == "__main__":
    unittest.main()
