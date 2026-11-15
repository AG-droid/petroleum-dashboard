"""Importing files: the generated month loads cleanly, bad rows are reported, re-imports are safe."""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from prahari.config import Settings
from prahari.ingest.formats import FORMATS, FileKind
from prahari.ingest.pipeline import import_file, import_paths
from prahari.models import NozzleDailySales, Outlet, Receipt, TankReading
from prahari.services.state import compute_states


def test_seeded_month_is_complete(session: Session) -> None:
    assert session.scalar(select(func.count(Outlet.id))) == 44
    days = session.scalar(select(func.count(func.distinct(NozzleDailySales.business_date))))
    assert days == 30
    assert session.scalar(select(func.count()).select_from(TankReading)) > 1000
    assert session.scalar(select(func.count(Receipt.id))) > 100


def test_generated_data_is_internally_consistent(session: Session, settings: Settings) -> None:
    """Stock books balance: only the scripted variation outlet exceeds the limit."""
    states = compute_states(session, settings)
    over = {s.outlet.code for s in states if (s.variation_pct or 0) > settings.rules.variation_pct}
    assert over == {"GGN-121"}
    assert all(s.variation_pct is not None for s in states)
    assert all(abs(s.variation_pct or 0) < 0.5 for s in states if s.outlet.code != "GGN-121")


def _write_dsr(path: Path, rows: list[list[object]]) -> Path:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(FORMATS[FileKind.DSR].columns)
        w.writerows(rows)
    return path


def test_bad_rows_are_reported_and_good_rows_load(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    sap = session.scalar(select(Outlet.sap_code).where(Outlet.code == "GGN-101"))
    good = ["01-01-2026", sap, 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000]
    rows = [
        good,
        ["01-01-2026", "99999999", 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000],  # unknown outlet
        ["01-01-2026", sap, 1, 1, "MS", 1105, 1000, 5, 100, 100, 10000],  # meter went backwards
        ["01-01-2026", sap, 1, 1, "MS", 1000, 1105, 5, 90, 100, 10000],  # net doesn't add up
        ["32-01-2026", sap, 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000],  # not a date
    ]
    job = import_file(session, _write_dsr(tmp_path / "dsr.csv", rows), settings)
    assert (job.kind, job.status, job.rows_accepted, job.rows_rejected) == ("dsr", "partial", 1, 4)
    messages = {e["row"]: e["message"] for e in job.errors or []}
    assert "not in the outlet master" in messages[3]
    assert "below OPENING_TOTALIZER" in messages[4]
    assert "NET_SALE_LTRS" in messages[5]
    assert "not a date" in messages[6]


def test_unrecognised_file_fails_cleanly(session: Session, settings: Settings, tmp_path: Path) -> None:
    p = tmp_path / "notes.csv"
    p.write_text("hello,world\n1,2\n")
    job = import_file(session, p, settings)
    assert job.status == "failed"
    assert "no recognised header" in (job.errors or [{}])[0]["message"]


def test_reimport_is_skipped_or_idempotent(
    session: Session, settings: Settings, samples_dir: Path, tmp_path: Path
) -> None:
    dsr = sorted((samples_dir / "03_sales").glob("DSR_*.xlsx"))[-1]
    before = session.scalar(select(func.count()).select_from(NozzleDailySales))
    assert import_file(session, dsr, settings).status == "skipped"  # identical file already loaded
    copy = shutil.copy(dsr, tmp_path / "again.xlsx")
    assert import_file(session, Path(copy), settings, force=True).status == "succeeded"
    assert (
        session.scalar(select(func.count()).select_from(NozzleDailySales)) == before
    )  # upserted, not duplicated


def test_directory_import_orders_masters_first(
    session: Session, settings: Settings, samples_dir: Path
) -> None:
    jobs = import_paths(session, [samples_dir], settings, force=True)
    kinds = [j.kind for j in jobs]
    assert kinds[:4] == ["sales_area", "ro_master", "tank_master", "nozzle_master"]
    assert all(j.status == "succeeded" for j in jobs)


def test_duplicate_key_in_one_file_is_a_row_error(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    from prahari.models import Nozzle

    outlet = session.scalar(select(Outlet).where(Outlet.code == "GGN-101"))
    assert outlet is not None
    n1, n2 = [n for n in session.scalars(select(Nozzle).where(Nozzle.outlet_id == outlet.id))][:2]
    row = ["01-01-2026", outlet.sap_code, n1.du_no, n1.nozzle_no, n1.product_code, 1000, 1105, 5, 100, 100, 1]
    other = [
        "01-01-2026",
        outlet.sap_code,
        n2.du_no,
        n2.nozzle_no,
        n2.product_code,
        2000,
        2105,
        5,
        100,
        100,
        1,
    ]
    job = import_file(session, _write_dsr(tmp_path / "dup.csv", [row, other, row]), settings)
    assert (job.status, job.rows_accepted, job.rows_rejected) == ("partial", 2, 1)
    assert (job.errors or [{}])[0]["message"] == "duplicate of row 2"


def test_overlong_codes_and_infinite_numbers_are_row_errors(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    sap = session.scalar(select(Outlet.sap_code).where(Outlet.code == "GGN-101"))
    rows = [
        ["01-01-2026", "1" * 20, 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000],
        ["01-01-2026", sap, 1, 1, "MS", "inf", "inf", 5, 0, 100, 10000],
    ]
    job = import_file(session, _write_dsr(tmp_path / "bad.csv", rows), settings)
    messages = [e["message"] for e in job.errors or []]
    assert job.rows_rejected == 2
    assert "longer than 16" in messages[0] and "finite" in messages[1]


def test_water_is_not_counted_as_product(session: Session, settings: Settings, tmp_path: Path) -> None:
    from prahari.domain.calibration import volume_from_dip
    from prahari.models import Tank

    outlet = session.scalar(select(Outlet).where(Outlet.code == "GGN-101"))
    assert outlet is not None
    tank: Tank = outlet.tanks[0]
    path = tmp_path / "dip.csv"
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(FORMATS[FileKind.DIP_REGISTER].columns)
        w.writerow(
            ["01-01-2026", "06:00", outlet.sap_code, tank.tank_no, tank.product_code, 1200, 50, 25, 830, 838]
        )
    assert import_file(session, path, settings).status == "succeeded"
    reading = session.scalar(
        select(TankReading).where(TankReading.tank_id == tank.id).order_by(TankReading.observed_at)
    )
    full = volume_from_dip(1200, tank.diameter_mm, tank.length_mm)
    water = volume_from_dip(50, tank.diameter_mm, tank.length_mm)
    assert reading is not None and reading.volume_l == pytest.approx(full - water, abs=0.1)


def test_sales_area_json_is_validated(session: Session, settings: Settings, tmp_path: Path) -> None:
    p = tmp_path / "SALES_AREA.json"
    p.write_text(
        '{"kind": "sales_area", "code": "X", "name": "Test", "products": [{"code": "TOO-LONG-CODE"}]}'
    )
    job = import_file(session, p, settings)
    assert job.status == "failed" and job.rows_rejected >= 1
    assert any(e["column"] and e["column"].startswith("products.0") for e in job.errors or [])


def test_new_demo_day_clears_generated_history(session: Session, settings: Settings) -> None:
    from datetime import UTC, datetime, timedelta

    from prahari.domain.time import business_date
    from prahari.models import Indent
    from prahari.samples.reset import start_new_demo_day_if_needed

    yesterday = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour) - timedelta(
        days=1
    )
    assert not start_new_demo_day_if_needed(session, yesterday)  # same day: keep everything
    assert session.scalar(select(func.count()).select_from(NozzleDailySales))
    assert start_new_demo_day_if_needed(session, yesterday + timedelta(days=1))
    for model in (NozzleDailySales, Receipt, Indent):
        assert session.scalar(select(func.count()).select_from(model)) == 0
    assert session.scalar(select(func.count(Outlet.id))) == 44  # masters stay
