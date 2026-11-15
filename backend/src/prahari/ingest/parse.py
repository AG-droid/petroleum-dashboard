"""Typed cell converters. Each raises ``ValueError`` with a message fit for an import report."""

from __future__ import annotations

import math
from datetime import date, datetime, time
from typing import Any

from prahari.domain.products import normalise_product

_DATE_FORMATS = ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%b-%Y")


def text(v: Any, *, required: bool = True, max_len: int = 240) -> str:
    s = "" if v is None else str(v).strip()
    if required and not s:
        raise ValueError("is empty")
    if len(s) > max_len:
        raise ValueError(f"longer than {max_len} characters")
    return s


def optional_text(v: Any, max_len: int = 240) -> str | None:
    return text(v, required=False, max_len=max_len) or None


def number(v: Any, *, min_value: float | None = None, max_value: float | None = None) -> float:
    if v is None or (isinstance(v, str) and not v.strip()):
        raise ValueError("is empty")
    try:
        x = float(str(v).replace(",", "")) if isinstance(v, str) else float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{v!r} is not a number") from None
    if not math.isfinite(x):  # NaN, inf
        raise ValueError("is not a finite number")
    if min_value is not None and x < min_value:
        raise ValueError(f"{x:g} is below {min_value:g}")
    if max_value is not None and x > max_value:
        raise ValueError(f"{x:g} is above {max_value:g}")
    return x


def integer(v: Any, *, min_value: int | None = None) -> int:
    x = number(v)
    if x != int(x):
        raise ValueError(f"{x:g} is not a whole number")
    if min_value is not None and x < min_value:
        raise ValueError(f"{int(x)} is below {min_value}")
    return int(x)


def code(v: Any, *, max_len: int = 24) -> str:
    """Identifiers such as SAP codes: Excel may store them as numbers (12100137.0)."""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return text(v, max_len=max_len)


def day(v: Any) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = text(v)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()  # noqa: DTZ007 - a calendar date, no time zone
        except ValueError:
            continue
    raise ValueError(f"{s!r} is not a date (expected DD-MM-YYYY)")


def clock(v: Any) -> time:
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, time):
        return v
    s = text(v)
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p"):
        try:
            return datetime.strptime(s, fmt).time()  # noqa: DTZ007
        except ValueError:
            continue
    raise ValueError(f"{s!r} is not a time (expected HH:MM)")


def yes_no(v: Any) -> bool:
    s = text(v).upper()
    if s in {"Y", "YES", "TRUE", "1"}:
        return True
    if s in {"N", "NO", "FALSE", "0"}:
        return False
    raise ValueError(f"{s!r} is not Y or N")


def product(v: Any) -> str:
    return normalise_product(text(v))
