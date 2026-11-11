"""Validation of documents against the JSON Schemas exported by the TypeScript core.

`validate(kind, document)` runs the JSON Schema `<kind>.json` and returns the error messages (an
empty list means valid). JSON Schema cannot express the cross-field rules of a supplier profile
that the Zod schema enforces, so `check_profile_rules` repeats them and `validate` adds them for
`supplierProfile`. python/tests/data/profile-cases.json keeps the two implementations in step.

Where the schema files are looked for, in this order:
  1. the folder named by the environment variable BOLLETTE_SCHEMAS_DIR;
  2. the `schemas/` folder inside this package (the installer puts them there);
  3. `docs/schemas/`, walking up from the package to the root of the repository.

Only the standard library and jsonschema are used. No network, no clock.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterable
from datetime import date
from pathlib import Path
from typing import Any

import jsonschema

ENVIRONMENT_VARIABLE = "BOLLETTE_SCHEMAS_DIR"
PACKAGE_DIR = Path(__file__).resolve().parent

_KIND = re.compile(r"[A-Za-z][A-Za-z0-9]*")


def schema_dirs() -> list[Path]:
    """The folders to look in, in order of preference. They may not exist."""
    dirs: list[Path] = []
    from_environment = os.environ.get(ENVIRONMENT_VARIABLE)
    if from_environment:
        dirs.append(Path(from_environment))
    dirs.append(PACKAGE_DIR / "schemas")
    for parent in PACKAGE_DIR.parents:
        dirs.append(parent / "docs" / "schemas")
    return dirs


def _load_schema(kind: str) -> dict[str, Any]:
    if not _KIND.fullmatch(kind):
        raise KeyError(kind)
    for folder in schema_dirs():
        path = folder / f"{kind}.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise KeyError(kind)


def _where(parts: Iterable[object]) -> str:
    return "/".join(str(part) for part in parts)


def validate(kind: str, document: object) -> list[str]:
    """Error messages of `document` against the schema `kind` (the file name without `.json`).

    Raises KeyError for a kind without a schema file. An empty list means the document is valid.
    """
    schema = _load_schema(kind)
    validator_class = jsonschema.validators.validator_for(schema)
    validator = validator_class(schema, format_checker=jsonschema.FormatChecker())
    errors = []
    for error in sorted(validator.iter_errors(document), key=lambda e: [str(p) for p in e.path]):
        where = _where(error.absolute_path)
        errors.append(f"{where}: {error.message}" if where else error.message)
    if kind == "supplierProfile" and isinstance(document, dict):
        errors.extend(check_profile_rules(document))
    return errors


# --- Cross-field rules of the supplier profile -------------------------------------------------

# Same table as FIELD_VALUE_TYPES in packages/core/src/model.ts.
FIELD_VALUE_TYPES = {
    "number": "text",
    "issueDate": "date",
    "dueDate": "date",
    "period": "date-range",
    "amount": "euro",
    "consumption": "quantity",
}

# Same constructs as FORBIDDEN_CONSTRUCTS in packages/core/src/model.ts: the patterns are shared
# with JavaScript, so only numbered groups, no lookbehind and no inline flags.
_FORBIDDEN_CONSTRUCTS = (
    (re.compile(r"\(\?P?<(?![=!])"), "gruppi con nome"),
    (re.compile(r"\(\?<[=!]"), "lookbehind"),
    (re.compile(r"\(\?(?:[a-zA-Z]+(?:-[a-zA-Z]+)?|-[a-zA-Z]+)[:)]"), "flag in linea"),
)
_ESCAPE = re.compile(r"\\.", re.DOTALL)
_CLASS = re.compile(r"\[[^\]]*\]")
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _pattern_problem(pattern: str) -> tuple[str | None, int]:
    """Why `pattern` is not allowed (or None), and its number of capture groups."""
    try:
        compiled = re.compile(pattern)
    except (re.error, RecursionError, OverflowError) as error:
        return f"non è un'espressione regolare valida ({error})", 0
    # Escapes and character classes go first, so that `\(?<` and `[(?<=]` pass.
    bare = _CLASS.sub("", _ESCAPE.sub("", pattern))
    for construct, name in _FORBIDDEN_CONSTRUCTS:
        if construct.search(bare):
            return f"usa {name}, non condivisi con JavaScript", compiled.groups
    return None, compiled.groups


def _check_pattern(
    where: str, pattern: object, minimum_groups: int, errors: list[str]
) -> int | None:
    """Check one pattern; return its number of capture groups, or None when it is unusable."""
    if not isinstance(pattern, str) or pattern == "":
        return None  # JSON Schema reports it
    problem, groups = _pattern_problem(pattern)
    if problem is not None:
        errors.append(f"{where}: il pattern {problem}")
        return None
    if groups < minimum_groups:
        errors.append(
            f"{where}: il pattern deve avere almeno {minimum_groups} "
            f"gruppi di cattura, ne ha {groups}"
        )
    return groups


def _parse_date(value: object) -> date | None:
    if isinstance(value, str) and _DATE.fullmatch(value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def check_profile_rules(profile: dict[str, Any]) -> list[str]:
    """The profile rules that JSON Schema cannot express (messages in Italian).

    A profile of the wrong shape does not raise: the parts that cannot be read are skipped, since
    JSON Schema reports them.
    """
    errors: list[str] = []
    if not isinstance(profile, dict):
        return errors
    kind = profile.get("kind")
    if kind == "bill" and profile.get("category") is None:
        errors.append("category: un profilo di tipo «bill» richiede la categoria")
    if kind == "tari" and "category" in profile and profile["category"] is not None:
        errors.append("category: un profilo di tipo «tari» non deve avere la categoria")
    if kind != "tari" and profile.get("parts") is not None:
        errors.append("parts: solo un profilo di tipo «tari» ha le parti")

    valid_from = _parse_date(profile.get("validFrom"))
    valid_to = _parse_date(profile.get("validTo"))
    if valid_from is not None and valid_to is not None and valid_to < valid_from:
        errors.append("validTo: il profilo finisce prima di cominciare")

    fields = profile.get("fields")
    if isinstance(fields, dict):
        for name, spec in fields.items():
            rules = spec.get("rules") if isinstance(spec, dict) else None
            if not isinstance(rules, list):
                continue
            for index, rule in enumerate(rules):
                if not isinstance(rule, dict):
                    continue
                where = f"fields.{name}.rules[{index}]"
                expected = FIELD_VALUE_TYPES.get(name)
                value_type = rule.get("valueType")
                if expected is not None and value_type is not None and value_type != expected:
                    errors.append(
                        f"{where}.valueType: il campo «{name}» accetta solo il tipo "
                        f"«{expected}», non «{value_type}»"
                    )
                groups = _check_pattern(f"{where}.pattern", rule.get("pattern"), 0, errors)
                group = rule.get("group", 1)
                if (
                    groups is not None
                    and isinstance(group, int)
                    and not isinstance(group, bool)
                    and group > groups
                ):
                    errors.append(
                        f"{where}.group: il gruppo {group} non esiste, il pattern ha "
                        f"{groups} gruppi di cattura"
                    )

    identifiers = profile.get("identifiers")
    if isinstance(identifiers, list):
        for index, identifier in enumerate(identifiers):
            if isinstance(identifier, dict):
                _check_pattern(f"identifiers[{index}].pattern", identifier.get("pattern"), 0, errors)
    for name, minimum in (("parts", 2), ("items", 1)):
        section = profile.get(name)
        if isinstance(section, dict):
            _check_pattern(f"{name}.pattern", section.get("pattern"), minimum, errors)
    return errors
