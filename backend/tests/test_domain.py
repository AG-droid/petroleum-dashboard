"""Pure domain logic: calibration, business dates, product aliases, cell parsing, format detection."""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from prahari.domain.calibration import dip_from_volume, standard_dimensions, volume_from_dip
from prahari.domain.demand import HOURLY, sales_fraction_since
from prahari.domain.products import HSD, MS, XP, normalise_product
from prahari.domain.time import business_date
from prahari.ingest import parse
from prahari.ingest.formats import FORMATS, FileKind, detect_kind

IST = ZoneInfo("Asia/Kolkata")


@pytest.mark.parametrize("cap", [10, 15, 20, 25, 30, 35])
def test_standard_tank_holds_its_capacity(cap: float) -> None:
    dia, length = standard_dimensions(cap)
    assert volume_from_dip(dia, dia, length) == pytest.approx(cap * 1000, rel=1e-3)
    assert volume_from_dip(dia / 2, dia, length) == pytest.approx(
        cap * 500, rel=1e-3
    )  # half height, half volume


@pytest.mark.parametrize("litres", [0, 37.5, 1234, 9999, 15000, 19950])
def test_dip_and_volume_are_inverse(litres: float) -> None:
    dia, length = standard_dimensions(20)
    assert volume_from_dip(dip_from_volume(litres, dia, length), dia, length) == pytest.approx(
        litres, abs=0.1
    )


def test_calibration_rejects_impossible_values() -> None:
    dia, length = standard_dimensions(10)
    with pytest.raises(ValueError, match="outside"):
        dip_from_volume(12_000, dia, length)
    with pytest.raises(ValueError):
        standard_dimensions(0)
    assert volume_from_dip(-5, dia, length) == 0  # clamped, not negative


def test_business_day_starts_at_morning_dip() -> None:
    before = datetime(2026, 11, 15, 5, 59, tzinfo=IST)
    after = datetime(2026, 11, 15, 6, 0, tzinfo=IST)
    assert business_date(before, IST, 6) == date(2026, 11, 14)
    assert business_date(after, IST, 6) == date(2026, 11, 15)
    assert business_date(after.astimezone(UTC), IST, 6) == date(2026, 11, 15)
    with pytest.raises(ValueError):
        business_date(datetime(2026, 11, 15, 7, 0), IST, 6)  # noqa: DTZ001 - naive on purpose


def test_demand_profile() -> None:
    assert sum(HOURLY) == pytest.approx(1.0)
    assert sales_fraction_since(6, datetime(2026, 1, 1, 6, 0)) == 0  # noqa: DTZ001
    assert sales_fraction_since(6, datetime(2026, 1, 2, 5, 59, 59)) == pytest.approx(1.0, abs=1e-3)  # noqa: DTZ001
    noon = sales_fraction_since(6, datetime(2026, 1, 1, 12, 0))  # noqa: DTZ001
    assert 0.3 < noon < 0.45


@pytest.mark.parametrize(
    ("raw", "code"), [("MS", MS), ("petrol", MS), ("High-Speed Diesel", HSD), ("PMS", XP)]
)
def test_product_aliases(raw: str, code: str) -> None:
    assert normalise_product(raw) == code


def test_unknown_product() -> None:
    with pytest.raises(ValueError, match="unknown product"):
        normalise_product("kerosene")


def test_parsers() -> None:
    assert parse.day("15-11-2026") == date(2026, 11, 15)
    assert parse.day(datetime(2026, 11, 15, 8, 0)) == date(2026, 11, 15)  # noqa: DTZ001
    assert parse.code(12100137.0) == "12100137"  # Excel stores codes as numbers
    assert parse.number("1,234.5") == 1234.5
    assert parse.yes_no("y") is True
    with pytest.raises(ValueError, match="not a date"):
        parse.day("31-02-2026")
    with pytest.raises(ValueError, match="below"):
        parse.number(-1, min_value=0)
    with pytest.raises(ValueError, match="empty"):
        parse.text("  ")


def test_every_format_is_detected_from_its_own_header() -> None:
    for kind, fmt in FORMATS.items():
        assert detect_kind(set(fmt.columns)) is kind
    assert detect_kind({"FOO", "BAR"}) is None
    # Extra columns don't matter; the most specific match wins (DSR also contains the nozzle-master columns).
    assert detect_kind(set(FORMATS[FileKind.DSR].columns) | {"REMARKS"}) is FileKind.DSR
