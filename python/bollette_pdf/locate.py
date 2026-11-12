"""Where a value is on the page: anchors, candidate text by position, and words of a match.

Rules (controller decisions of plan 2a, Task 5):
- an anchor is a run of consecutive WORDS of one `Line`, compared case-insensitively after NFC
  and whitespace collapsing, ignoring the punctuation `: ; , .` at either end of each word
  (ruling R58; still whole words: `Totale` never matches `Subtotale`); its box is the union of
  its words. Words, not `Line.text`, because
  pdfminer may merge a label and a nearby value into one `Line`;
- `same-line`: the words of the same `Line` after the anchor;
- `right`: the first `Line` to the right of the anchor on its row (baseline within ROW_TOLERANCE,
  words starting at or after the anchor's right edge), never the union of further columns
  (ruling R57); the rest of the anchor's own line counts as such a line;
- `below`: the first `Line` of the next BELOW_ROWS rows whose horizontal extent overlaps the
  anchor's. Rows made only of one-character lines (a rotated strip of text down a margin, a
  bullet) are skipped: they neither count toward BELOW_ROWS nor provide the candidate.

A candidate keeps, for every word, its character span in the candidate text, so a regular
expression match can be mapped back to the words (and the box) it covers. Candidate text is cut
at MAX_CANDIDATE characters: user patterns run on it, and a short text bounds backtracking.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .profiles import normalize
from .reader import ROW_TOLERANCE, Document, Line, Word

MAX_CANDIDATE = 400
BELOW_ROWS = 3
_EDGE_PUNCTUATION = ":;,."


def word_key(text: str) -> str:
    """How a word is compared with an anchor word."""
    return normalize(text).strip(_EDGE_PUNCTUATION)


@dataclass(frozen=True)
class Anchor:
    line: int  # index in Layout.lines
    page: int
    x0: float
    top: float
    x1: float
    bottom: float
    baseline: float
    last_word: int  # index in the line's words of the anchor's last word


@dataclass(frozen=True)
class Text:
    """A text built from words, with the span of every word in it."""

    text: str
    spans: tuple[tuple[int, int, Word], ...]

    def words_in(self, start: int, end: int) -> list[Word]:
        """The words whose characters overlap [start, end); for an empty span, none."""
        return [word for s, e, word in self.spans if s < end and start < e]


def join_words(groups: Iterable[Sequence[Word]], limit: int | None = None) -> Text:
    """Words joined by a space, groups (lines) by a newline; cut at `limit` characters."""
    parts: list[str] = []
    spans: list[tuple[int, int, Word]] = []
    position = 0
    for number, words in enumerate(groups):
        for index, word in enumerate(words):
            if number or index:
                separator = "\n" if index == 0 else " "
                parts.append(separator)
                position += len(separator)
            parts.append(word.text)
            spans.append((position, position + len(word.text), word))
            position += len(word.text)
    text = "".join(parts)
    if limit is not None and len(text) > limit:
        text = text[:limit]
        spans = [(s, min(e, limit), w) for s, e, w in spans if s < limit]
    return Text(text, tuple(spans))


def box_of(words: Sequence[Word]) -> list[float]:
    return [
        min(w.x0 for w in words),
        min(w.top for w in words),
        max(w.x1 for w in words),
        max(w.bottom for w in words),
    ]


class Layout:
    """The lines of a document grouped in rows, as the reader orders them."""

    def __init__(self, doc: Document) -> None:
        self.lines: tuple[Line, ...] = doc.lines
        self.pages = doc.pages
        self.row_of: list[int] = []
        self.rows: list[list[int]] = []
        row_page, row_baseline = 0, 0.0
        for index, line in enumerate(self.lines):
            if (
                not self.rows
                or line.page != row_page
                or line.baseline - row_baseline >= ROW_TOLERANCE
            ):
                self.rows.append([])
                row_page, row_baseline = line.page, line.baseline
            self.rows[-1].append(index)
            self.row_of.append(len(self.rows) - 1)
        self._keys = [tuple(word_key(w.text) for w in line.words) for line in self.lines]

    def page_text(self, page: int) -> Text:
        """The page's lines joined by newlines, words by spaces (not cut)."""
        return join_words(line.words for line in self.lines if line.page == page)

    def anchors(self, anchor: str) -> list[Anchor]:
        """Every occurrence of `anchor` as consecutive words of one line, in reading order."""
        tokens = tuple(word_key(token) for token in normalize(anchor).split(" "))
        size = len(tokens)
        found: list[Anchor] = []
        if not any(tokens):
            return found
        for index, keys in enumerate(self._keys):
            for start in range(len(keys) - size + 1):
                if keys[start : start + size] == tokens:
                    line = self.lines[index]
                    words = line.words[start : start + size]
                    x0, top, x1, bottom = box_of(words)
                    found.append(
                        Anchor(index, line.page, x0, top, x1, bottom, line.baseline, start + size - 1)
                    )
        return found

    def candidate(self, anchor: Anchor, position: str) -> Text | None:
        """The text in which to look for the value, or None when there is nothing there."""
        line = self.lines[anchor.line]
        if position == "same-line":
            words: Sequence[Word] = line.words[anchor.last_word + 1 :]
        elif position == "right":
            cells = [
                [word for word in other.words if word.x0 >= anchor.x1]
                for other in self.lines
                if other.page == anchor.page
                and abs(other.baseline - anchor.baseline) <= ROW_TOLERANCE
            ]
            cells = [cell for cell in cells if cell]
            words = min(cells, key=lambda cell: (cell[0].x0, cell[0].top), default=())
        elif position == "below":
            words = self._below(anchor)
        else:
            return None
        if not words:
            return None
        return join_words([words], MAX_CANDIDATE)

    def _below(self, anchor: Anchor) -> Sequence[Word]:
        row = self.row_of[anchor.line]
        real_rows = [
            r
            for r in self.rows[row + 1 :]
            if any(len("".join(self.lines[i].text.split())) > 1 for i in r)
        ]
        for next_row in real_rows[:BELOW_ROWS]:
            lines = sorted((self.lines[i] for i in next_row), key=lambda line: line.x0)
            for line in lines:
                if line.page != anchor.page:
                    return ()
                overlap = min(line.x1, anchor.x1) - max(line.x0, anchor.x0)
                if (
                    line.baseline > anchor.baseline
                    and overlap > 0
                    and line.text.strip()
                ):
                    return line.words
        return ()
