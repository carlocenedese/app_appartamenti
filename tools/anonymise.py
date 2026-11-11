"""Anonymise a JSON document built from real data before it becomes a fixture.

Usage:
    python3 -I tools/anonymise.py --map MAP.json INPUT.json OUTPUT.json

INPUT.json is any JSON document (for a golden fixture: the shape described in Task 7 of plan 1)
written outside the repository from the real Excel files and statements. MAP.json, also outside
the repository, says what to replace:

    {"replace": {"<real text>": "<fictitious text>", ...},
     "forbid": ["<real text that must not survive>", ...]}

Every string in the document, keys included, goes through three steps:

1. each ``replace`` entry is applied as a case-insensitive whole-word replacement (not inside a
   longer word, so that a short name does not hit "Singola"), longest real text first, so that
   "Mario Rossi" wins over "Mario";
2. codes that look like personal data are replaced with the fictitious examples listed in
   ``fixtures/README.md``: IBAN of any country, codice fiscale, POD, PDR, e-mail addresses and
   Italian mobile numbers; links (``http://``, ``https://``, ``file://``, ``www.``) and local
   paths (``/Users/…``, ``/home/…``, ``C:\…``), which point to private folders, become ``""``.
   The PDR rule is deliberately broad: any run of exactly 14 digits is replaced, so fixture ids
   and hashes must not contain one;
3. the result is checked: no ``replace`` key and no ``forbid`` entry may appear anywhere as a
   whole word, again case-insensitively, in a string or in a number written as text. If one
   does, nothing is written and the script exits with code 1.

Texts and map entries are compared in Unicode NFC form, so that a name written by macOS (NFD)
matches the same name written by Windows (NFC); the output strings are NFC.

OUTPUT.json is written with two-space indentation, keys in their original order, UTF-8 and a
final newline. The script never prints the texts it replaces or finds, only how many there are:
logs must not carry personal data. Errors go to stderr with exit code 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

# Fictitious codes from fixtures/README.md ("Codici d'esempio fittizi").
FAKE_IBAN = "IT60 X054 2811 1010 0000 0123 456"
FAKE_CF = "RSSMRA80A01H501U"
FAKE_POD = "IT001E12345678"
FAKE_PDR = "12345678901234"
FAKE_EMAIL = "persona@example.invalid"
FAKE_PHONE = "+39 000 0000000"

PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    ("link", re.compile(r"(?:https?|file)://\S+|\bwww\.\S+", re.I), ""),
    ("path", re.compile(r"(?:/Users/|/home/|\b[A-Za-z]:\\)\S*"), ""),
    ("e-mail", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), FAKE_EMAIL),
    # Country code + 2 check digits + 11 to 30 digits or letters, optionally grouped by spaces:
    # foreign accounts too (students often pay from home).
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[0-9A-Z]){11,30}\b"), FAKE_IBAN),
    ("codice fiscale", re.compile(r"\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b", re.I), FAKE_CF),
    ("POD", re.compile(r"\bIT\d{3}E\d{8}\b", re.I), FAKE_POD),
    ("PDR", re.compile(r"(?<!\d)\d{14}(?!\d)"), FAKE_PDR),
    ("phone", re.compile(r"(?<![\d+])(?:\+39[\s.]?)?3\d{2}[\s.]?\d{6,7}(?!\d)"), FAKE_PHONE),
]


class AnonymiseError(Exception):
    """A real text survived the replacements; the message never contains it."""


def load_map(raw: Any) -> tuple[list[tuple[str, str]], list[str]]:
    if not isinstance(raw, dict):
        raise ValueError("the map must be a JSON object")
    replace = raw.get("replace", {})
    forbid = raw.get("forbid", [])
    if not isinstance(replace, dict) or not all(
        isinstance(k, str) and k and isinstance(v, str) for k, v in replace.items()
    ):
        raise ValueError('"replace" must map non-empty strings to strings')
    if not isinstance(forbid, list) or not all(isinstance(f, str) and f for f in forbid):
        raise ValueError('"forbid" must be a list of non-empty strings')
    replace = {nfc(k): nfc(v) for k, v in replace.items()}
    forbid = [nfc(f) for f in forbid]
    pairs = sorted(replace.items(), key=lambda kv: len(kv[0]), reverse=True)
    for real, fake in pairs:
        if real.lower() in fake.lower():
            raise ValueError("a replacement contains the text it replaces")
    return pairs, list(forbid)


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def word(term: str) -> re.Pattern[str]:
    """The term as a whole word: no letter or digit right before or after it."""
    return re.compile(rf"(?<![^\W_]){re.escape(term)}(?![^\W_])", re.I)


def anonymise_text(text: str, pairs: list[tuple[str, str]], counts: dict[str, int]) -> str:
    text = nfc(text)
    for real, fake in pairs:
        text, n = word(real).subn(lambda _m, f=fake: f, text)
        counts["replace"] = counts.get("replace", 0) + n
    for name, pattern, fake in PATTERNS:
        # A callable, so that the fake text is never read as a regular-expression template.
        text, n = pattern.subn(lambda _m, f=fake: f, text)
        counts[name] = counts.get(name, 0) + n
    return text


def walk(value: Any, pairs: list[tuple[str, str]], counts: dict[str, int]) -> Any:
    if isinstance(value, str):
        return anonymise_text(value, pairs, counts)
    if isinstance(value, list):
        return [walk(item, pairs, counts) for item in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            new_key = anonymise_text(key, pairs, counts)
            if new_key in out:
                raise AnonymiseError("two keys become equal after the replacements")
            out[new_key] = walk(item, pairs, counts)
        return out
    return value


def strings_of(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for item in value for s in strings_of(item)]
    if isinstance(value, dict):
        return [s for k, v in value.items() for s in [k, *strings_of(v)]]
    # Numbers too: a customer code stored as a number must not slip through.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [str(value)]
    return []


def check(document: Any, pairs: list[tuple[str, str]], forbid: list[str]) -> int:
    """Number of real texts still present; 0 means the document is clean."""
    texts = strings_of(document)
    terms = {real.lower() for real, _ in pairs} | {f.lower() for f in forbid}
    return sum(1 for term in terms if any(word(term).search(text) for text in texts))


def anonymise(document: Any, raw_map: Any) -> tuple[Any, dict[str, int]]:
    pairs, forbid = load_map(raw_map)
    counts: dict[str, int] = {}
    result = walk(document, pairs, counts)
    left = check(result, pairs, forbid)
    if left:
        raise AnonymiseError(f"{left} real text(s) still present after anonymisation")
    return result, counts


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Anonymise a JSON document for the fixtures.")
    parser.add_argument("--map", required=True, type=Path)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    try:
        document = json.loads(args.input.read_text(encoding="utf-8"))
        raw_map = json.loads(args.map.read_text(encoding="utf-8"))
        result, counts = anonymise(document, raw_map)
    except AnonymiseError as error:
        print(f"anonymise: {error}; nothing written", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        # json.JSONDecodeError is a ValueError; its message quotes no content of the file.
        print(f"anonymise: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = ", ".join(f"{name} {n}" for name, n in sorted(counts.items()) if n)
    print(f"anonymise: written; replacements: {summary or 'none'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
