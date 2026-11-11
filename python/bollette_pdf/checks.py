"""Consistency checks on the fields read from a bill.

Each check is `{code, ok, message}` and is emitted only when its inputs exist. The messages are
generic Italian sentences: they never quote values or text read from the document.
"""

from __future__ import annotations

from typing import Any


def _value(fields: dict[str, Any], name: str) -> Any:
    field = fields.get(name)
    return field.get("value") if isinstance(field, dict) else None


def _check(code: str, ok: bool, ok_message: str, ko_message: str) -> dict[str, Any]:
    return {"code": code, "ok": ok, "message": ok_message if ok else ko_message}


def run_checks(fields: dict[str, Any], items_sum: int | None) -> list[dict[str, Any]]:
    """Checks `period-order`, `due-after-issue` and `items-sum`, in this order."""
    checks = []
    start, end = _value(fields, "periodStart"), _value(fields, "periodEnd")
    if start is not None and end is not None:
        checks.append(
            _check(
                "period-order",
                start <= end,
                "Il periodo di fornitura è in ordine.",
                "Il periodo di fornitura finisce prima di cominciare.",
            )
        )
    issue, due = _value(fields, "issueDate"), _value(fields, "dueDate")
    if issue is not None and due is not None:
        checks.append(
            _check(
                "due-after-issue",
                due >= issue,
                "La scadenza non precede la data di emissione.",
                "La scadenza precede la data di emissione.",
            )
        )
    amount = _value(fields, "amount")
    if items_sum is not None and amount is not None:
        checks.append(
            _check(
                "items-sum",
                items_sum == amount,
                "La somma delle voci è uguale all'importo totale.",
                "La somma delle voci è diversa dall'importo totale.",
            )
        )
    return checks


def parts_checks(found: int, repeated: bool) -> list[dict[str, Any]]:
    """Checks of a TARI notice read with `parts`: `parts-found` and `parts-unique` (R56)."""
    return [
        _check(
            "parts-found",
            found > 0,
            "Le parti dell'avviso sono state lette.",
            "Nessuna parte dell'avviso è stata letta.",
        ),
        _check(
            "parts-unique",
            not repeated,
            "Nessuna parte dell'avviso è ripetuta.",
            "Una parte dell'avviso compare su più pagine ed è stata contata una volta.",
        ),
    ]
