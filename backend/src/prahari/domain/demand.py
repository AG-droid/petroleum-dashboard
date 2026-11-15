"""Typical demand profile: share of a day's fuel sales in each clock hour.

Same profile as the dashboard's in-browser simulator.
"""

from __future__ import annotations

from datetime import datetime

_RAW = (
    0.012,
    0.008,
    0.006,
    0.006,
    0.009,
    0.02,
    0.036,
    0.056,
    0.066,
    0.062,
    0.057,
    0.054,
    0.052,
    0.05,
    0.05,
    0.053,
    0.059,
    0.066,
    0.068,
    0.06,
    0.048,
    0.038,
    0.03,
    0.02,
)
HOURLY: tuple[float, ...] = tuple(v / sum(_RAW) for v in _RAW)


def sales_fraction_since(start_hour: int, local: datetime) -> float:
    """Fraction of a business day's sales made between ``start_hour``:00 and ``local`` (local time)."""
    elapsed_h = (local.hour - start_hour) % 24 + local.minute / 60 + local.second / 3600
    total, h = 0.0, start_hour
    while elapsed_h > 0:
        step = min(1.0, elapsed_h)
        total += HOURLY[h % 24] * step
        elapsed_h -= step
        h += 1
    return min(total, 1.0)
