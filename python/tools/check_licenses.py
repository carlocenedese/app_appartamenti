"""Fails when an installed Python distribution has a licence outside the allowed list.

Reads the metadata of the installed distributions with importlib.metadata: the field
`License-Expression`, else `License`, else the Trove classifiers. A distribution passes when its
SPDX expression is allowed: `A OR B` needs one allowed alternative, `A AND B` every part,
`A WITH X` and `A+` are judged by `A`. GPL, LGPL, AGPL, an unknown licence and a missing licence
fail. The output holds distribution names, versions and licence identifiers, never licence texts.

Only the distributions the app ships are judged: those pinned in python/requirements.txt. The
interpreter used to run the check may carry its own tooling (pip; on macOS the python.org build
that setup-python installs also has certifi, MPL-2.0), which is not shipped: such distributions
are listed by name as not checked. A pinned distribution that is not installed fails.

Usage: python3 -I python/tools/check_licenses.py   (exit code 1 on any failure)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

# Keep in step with ALLOWED_LICENSES in scripts/check-licenses.mjs (the npm check) and with
# deny.toml (the Rust check): one list for the whole project. test_check_licenses.py reads the
# JavaScript file as text and fails when the two lists differ.
ALLOWED_LICENSES = frozenset(
    {
        "MIT",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
        "0BSD",
        "CC0-1.0",
        "Unlicense",
        "BlueOak-1.0.0",
        "Unicode-3.0",
        "Zlib",
    }
)
_ALLOWED_LOWER = frozenset(name.lower() for name in ALLOWED_LICENSES)

# Free-text `License` values and classifiers that name an allowed licence unambiguously.
# "BSD License" is not here: it can mean the 2-clause, the 3-clause or an older 4-clause licence.
_ALIASES = {
    "mit license": "MIT",
    "the mit license": "MIT",
    "apache software license": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache 2.0": "Apache-2.0",
    "apache 2": "Apache-2.0",
    "isc license (iscl)": "ISC",
    "isc license": "ISC",
    "bsd-3-clause license": "BSD-3-Clause",
    "bsd 3-clause": "BSD-3-Clause",
    "3-clause bsd license": "BSD-3-Clause",
    "bsd-2-clause license": "BSD-2-Clause",
    "2-clause bsd license": "BSD-2-Clause",
    "zlib/libpng license": "Zlib",
    "the unlicense (unlicense)": "Unlicense",
    "cc0 1.0 universal (cc0 1.0) public domain dedication": "CC0-1.0",
}
_CLASSIFIER_PREFIX = "License :: "
# Longer than any licence name; a longer `License` value is the text of a licence.
_MAX_LICENSE_FIELD = 100
_MISSING = {"", "unknown", "unlicensed", "none"}

_TOKEN = re.compile(r"\(|\)|[^\s()]+")


def _normalise(identifier: str) -> str:
    return _ALIASES.get(identifier.strip().lower(), identifier.strip())


def _is_allowed_identifier(identifier: str) -> bool:
    # `A+` means "or any later version" and `A WITH X` is an exception to A: both follow A.
    base = identifier[:-1] if identifier.endswith("+") else identifier
    return base.lower() in _ALLOWED_LOWER


def is_allowed(expression: str) -> bool:
    """Whether an SPDX licence expression is allowed. A malformed expression is not."""
    tokens = _TOKEN.findall(expression)
    position = 0

    def peek() -> str | None:
        return tokens[position] if position < len(tokens) else None

    def keyword(word: str) -> bool:
        token = peek()
        return token is not None and token.upper() == word

    def parse_or() -> bool:
        nonlocal position
        result = parse_and()
        while keyword("OR"):
            position += 1
            # Both sides are always parsed so that a malformed tail is an error.
            result = parse_and() or result
        return result

    def parse_and() -> bool:
        nonlocal position
        result = parse_atom()
        while keyword("AND"):
            position += 1
            result = parse_atom() and result
        return result

    def parse_atom() -> bool:
        nonlocal position
        token = peek()
        if token is None or token == ")" or token.upper() in ("AND", "OR", "WITH"):
            raise ValueError("expression")
        position += 1
        if token == "(":
            result = parse_or()
            if peek() != ")":
                raise ValueError("parenthesis")
            position += 1
            return result
        allowed = _is_allowed_identifier(_normalise(token))
        if keyword("WITH"):
            position += 1
            exception = peek()
            if exception is None or exception in "()" or exception.upper() in ("AND", "OR", "WITH"):
                raise ValueError("exception")
            position += 1
        return allowed

    if not tokens:
        return False
    try:
        result = parse_or()
    except ValueError:
        return False
    return result and position == len(tokens)


def _classifier_licence(classifier: str) -> str | None:
    name = classifier[len(_CLASSIFIER_PREFIX) :].split(" :: ")[-1].strip()
    return _ALIASES.get(name.lower(), name)


# Free-text `License` fields read and judged by hand, as SPDX: (name, version, exact field) ->
# expression. Another version or another text is judged as usual (and fails).
_REVIEWED = {
    # The licence files of the wheel, including the libraries built into PDFium, are listed in
    # docs/rules/ocr-licenze.md (accepted for macOS on 13 November 2026).
    ("pypdfium2", "5.14.0", "BSD-3-Clause, Apache-2.0, dependency licenses"): "BSD-3-Clause AND Apache-2.0",
}


def licence_of(distribution) -> tuple[str, ...]:
    """The licence alternatives a distribution states; empty when it states none.

    One SPDX expression from `License-Expression` or the short `License` field, else one
    alternative per licence classifier (several classifiers mean the user may choose).
    """
    meta = distribution.metadata
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return (expression,)
    field = (meta.get("License") or "").strip()
    reviewed = _REVIEWED.get((canonical(meta.get("Name") or ""), meta.get("Version") or "", field))
    if reviewed is not None:
        return (reviewed,)
    if field and field.lower() not in _MISSING and len(field) <= _MAX_LICENSE_FIELD and "\n" not in field:
        return (_normalise(field),)
    classifiers = [
        _classifier_licence(c)
        for c in (meta.get_all("Classifier") or [])
        if c.startswith(_CLASSIFIER_PREFIX)
    ]
    classifiers = [c for c in classifiers if c and c.lower() not in _MISSING]
    return tuple(classifiers)


@dataclass(frozen=True)
class Result:
    name: str
    version: str
    licence: str | None  # the alternatives joined with " OR "; None when none is stated
    allowed: bool


def check(distributions) -> list[Result]:
    results = []
    for distribution in distributions:
        meta = distribution.metadata
        name = meta.get("Name") or "(senza nome)"
        alternatives = licence_of(distribution) if meta.get("Name") else ()
        allowed = any(is_allowed(alternative) for alternative in alternatives)
        licence = " OR ".join(alternatives) if alternatives else None
        results.append(Result(name, meta.get("Version") or "?", licence, allowed))
    return sorted(results, key=lambda r: r.name.lower())


def installed_distributions():
    return metadata.distributions()


REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"
_PINNED = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==[^;\s]*\s*(?:;\s*(.*?))?\s*\\?\s*$")
# The only environment marker the project uses: the OCR wheels ship on macOS only.
_PLATFORM_MARKER = re.compile(r"""^sys_platform\s*==\s*["']([^"']+)["']$""")


def canonical(name: str) -> str:
    """The normalised name of a distribution (PEP 503): lower case, runs of `-_.` as `-`."""
    return re.sub(r"[-_.]+", "-", name).lower()


def shipped_names(requirements_text: str, platform: str = sys.platform) -> set[str]:
    """The canonical names pinned (`name==version`) in a requirements file that pip installs on
    `platform`. A marker other than `sys_platform == "..."` raises ValueError."""
    names = set()
    for line in requirements_text.splitlines():
        match = _PINNED.match(line)
        if not match:
            continue
        marker = match.group(2)
        if marker:
            only = _PLATFORM_MARKER.match(marker)
            if only is None:
                raise ValueError(f"Marcatore non gestito in requirements.txt: {marker}")
            if only.group(1) != platform:
                continue
        names.add(canonical(match.group(1)))
    return names


def _distribution_name(distribution) -> str:
    return distribution.metadata.get("Name") or ""


def _printable(licence: str | None) -> str:
    if licence is None:
        return "licenza mancante"
    # A licence name is short; never print more than a line of metadata.
    return licence if len(licence) <= _MAX_LICENSE_FIELD else licence[:_MAX_LICENSE_FIELD] + "…"


def main(distributions=None, shipped=None) -> int:
    """Checks `distributions` (the installed ones by default). Only those named in `shipped`
    (canonical names; by default the ones pinned in requirements.txt) are judged; with
    `distributions` given and `shipped` None, every distribution is judged."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if distributions is None:
        distributions = list(installed_distributions())
        if shipped is None:
            shipped = shipped_names(REQUIREMENTS.read_text("utf-8"))
    distributions = list(distributions)
    ignored: list[str] = []
    missing: list[str] = []
    if shipped is not None:
        present = {canonical(_distribution_name(d)) for d in distributions}
        missing = sorted(shipped - present)
        kept = [d for d in distributions if canonical(_distribution_name(d)) in shipped]
        ignored = sorted(
            {_distribution_name(d) or "(senza nome)" for d in distributions if d not in kept},
            key=str.lower,
        )
        distributions = kept
    results = check(distributions)
    for result in results:
        mark = "ok " if result.allowed else "NO "
        print(f"{mark} {result.name} {result.version}: {_printable(result.licence)}")
    if ignored:
        print(f"Non distribuiti, non controllati: {', '.join(ignored)}")
    failed = [r for r in results if not r.allowed]
    if failed:
        print(f"Licenze non ammesse: {', '.join(r.name for r in failed)}")
    if missing:
        print(f"Pacchetti non installati: {', '.join(missing)}")
    if failed or missing:
        return 1
    print(f"Tutte le licenze sono ammesse ({len(results)} pacchetti).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
