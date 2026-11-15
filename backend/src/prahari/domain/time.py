"""Business-day arithmetic.

A pump's business day runs from the morning dip (e.g. 06:00 IST) to the next morning dip, not
midnight to midnight. The DSR for business date *d* covers ``d 06:00 → d+1 06:00`` and the dip
taken at ``d 06:00`` is that day's opening stock.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def now_utc() -> datetime:
    return datetime.now(UTC)


def business_date(at: datetime, tz: ZoneInfo, start_hour: int) -> date:
    """The business date that the instant ``at`` (timezone-aware) falls in."""
    if at.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return (at.astimezone(tz) - timedelta(hours=start_hour)).date()


def business_day_start(d: date, tz: ZoneInfo, start_hour: int) -> datetime:
    """The instant business date ``d`` begins (aware, in ``tz``)."""
    return datetime.combine(d, time(hour=start_hour), tzinfo=tz)


def fraction_of_business_day(at: datetime, tz: ZoneInfo, start_hour: int) -> float:
    """How far through its business day ``at`` is, 0..1 (by clock time, not by sales)."""
    start = business_day_start(business_date(at, tz, start_hour), tz, start_hour)
    return min(1.0, max(0.0, (at - start).total_seconds() / 86400))
