"""Importing files: the generated month loads cleanly, bad rows are reported, re-imports are safe."""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

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
