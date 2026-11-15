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
    assert over == {"990121"}
    assert all(s.variation_pct is not None for s in states)
    assert all(abs(s.variation_pct or 0) < 0.5 for s in states if s.outlet.code != "990121")


def _write_dsr(path: Path, rows: list[list[object]]) -> Path:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(FORMATS[FileKind.DSR].columns)
        w.writerows(rows)
    return path


def test_bad_rows_are_reported_and_good_rows_load(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    sap = "990101"  # the outlet's RO code: the key in every file
    good = ["01-01-2026", sap, 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000]
    rows = [
        good,
        ["01-01-2026", "999999", 1, 1, "MS", 1000, 1105, 5, 100, 100, 10000],  # unknown outlet
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

    outlet = session.scalar(select(Outlet).where(Outlet.code == "990101"))
    assert outlet is not None
    n1, n2 = [n for n in session.scalars(select(Nozzle).where(Nozzle.outlet_id == outlet.id))][:2]
    row = ["01-01-2026", outlet.code, n1.du_no, n1.nozzle_no, n1.product_code, 1000, 1105, 5, 100, 100, 1]
    other = [
        "01-01-2026",
        outlet.code,
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
    sap = "990101"  # the outlet's RO code: the key in every file
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

    outlet = session.scalar(select(Outlet).where(Outlet.code == "990101"))
    assert outlet is not None
    tank: Tank = outlet.tanks[0]
    path = tmp_path / "dip.csv"
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(FORMATS[FileKind.DIP_REGISTER].columns)
        w.writerow(
            ["01-01-2026", "06:00", outlet.code, tank.tank_no, tank.product_code, 1200, 50, 25, 830, 838]
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


def test_duplicate_codes_are_row_errors_not_internal_errors(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    p = tmp_path / "SALES_AREA.json"
    p.write_text(
        '{"kind": "sales_area", "code": "X", "name": "Test", "products": ['
        '{"code": "MS", "name": "Petrol", "price_per_l": 100, "density_min": 720, "density_max": 775},'
        '{"code": "MS", "name": "Petrol", "price_per_l": 100, "density_min": 720, "density_max": 775}]}'
    )
    job = import_file(session, p, settings)
    assert job.status == "failed" and "duplicate code" in (job.errors or [{}])[0]["message"]

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(list(FORMATS[FileKind.RO_MASTER].columns))
    base = [
        "Gurugram",
        "B-Urban",
        "DODO",
        "N",
        "Sector 1",
        "",
        "",
        28.45,
        77.03,
        "Y",
        300,
        "Test Dealer",
        "",
        2001,
    ]
    ws.append(["990901", "S-1", "One", *base])
    ws.append(["990901", "S-2", "Two", *base])  # same RO code, different SAP code
    wb.save(tmp_path / "ro.xlsx")
    job = import_file(session, tmp_path / "ro.xlsx", settings)
    assert (job.rows_accepted, job.rows_rejected) == (1, 1)
    assert (job.errors or [{}])[0]["message"] == "duplicate of row 2"


def test_ro_master_keys_on_ro_code_and_checks_class_of_market(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    """Blank SAP codes never clash; a bad RO code or class of market is a row error."""
    from openpyxl import Workbook

    def row(ro: str, market: str) -> list[object]:
        return [
            ro,
            "",
            "Outlet " + ro,
            "Gurugram",
            market,
            "DODO",
            "N",
            "Sector 1",
            "",
            "",
            28.45,
            77.03,
            "Y",
            300,
            "Test Dealer",
            "",
            2001,
        ]

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(list(FORMATS[FileKind.RO_MASTER].columns))
    ws.append(row("990801", "D2 Highway"))
    ws.append(row("990802", "c-urban"))
    ws.append(row("GGN-1", "A-Urban"))  # not a 6-digit RO code
    ws.append(row("990804", "Highway"))  # not a class of market
    wb.save(tmp_path / "ro.xlsx")
    job = import_file(session, tmp_path / "ro.xlsx", settings)
    assert (job.rows_accepted, job.rows_rejected) == (2, 2)
    errors = {e["row"]: e["message"] for e in job.errors or []}
    assert "6-digit RO code" in errors[4] and "class of market" in errors[5]
    added = {o.code: o for o in session.scalars(select(Outlet).where(Outlet.code.in_(["990801", "990802"])))}
    assert added["990801"].market_class == "D2-Highway" and added["990801"].category == "Highway"
    assert added["990802"].market_class == "C-Urban" and added["990802"].sap_code is None


def test_product_master_accepts_gases_without_density(session: Session) -> None:
    from prahari.models import Product

    units = dict(session.execute(select(Product.code, Product.unit)).tuples().all())
    assert units["CNG"] == "kg" and units["MS"] == "L"
    assert session.scalar(select(Product.density_min).where(Product.code == "CNG")) is None


def _ro_master(path: Path, rows: list[list[object]]) -> Path:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.append(list(FORMATS[FileKind.RO_MASTER].columns))
    for r in rows:
        ws.append(r)
    wb.save(path)
    return path


def _ro_row(ro: str, sap: str, market: str = "B-Urban") -> list[object]:
    return [
        ro,
        sap,
        "Outlet " + ro,
        "Gurugram",
        market,
        "DODO",
        "N",
        "Sector 1",
        "",
        "",
        28.45,
        77.03,
        "Y",
        300,
        "Test Dealer",
        "",
        2001,
    ]


def test_sap_code_clashes_are_row_errors(session: Session, settings: Settings, tmp_path: Path) -> None:
    """Same SAP code on two new rows, or one already held by another outlet: row errors only."""
    taken = session.scalar(select(Outlet.sap_code).where(Outlet.code == "990101"))
    assert taken
    path = _ro_master(
        tmp_path / "ro.xlsx",
        [_ro_row("990901", "S-9"), _ro_row("990902", "S-9"), _ro_row("990903", taken), _ro_row("990904", "")],
    )
    job = import_file(session, path, settings)
    assert (job.rows_accepted, job.rows_rejected) == (2, 2)
    errors = {e["row"]: e["message"] for e in job.errors or []}
    assert errors[3] == "duplicate of row 2" and "already belongs to RO 990101" in errors[4]


def test_ro_master_reimport_updates_the_outlet_matched_on_ro_code(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    import_file(session, _ro_master(tmp_path / "a.xlsx", [_ro_row("990905", "S-5", "C-Urban")]), settings)
    import_file(session, _ro_master(tmp_path / "b.xlsx", [_ro_row("990905", "S-6", "D2-Highway")]), settings)
    rows = list(session.scalars(select(Outlet).where(Outlet.code == "990905")))
    assert len(rows) == 1 and (rows[0].sap_code, rows[0].market_class) == ("S-6", "D2-Highway")


def test_sales_area_json_accepts_old_division_key_and_checks_densities(
    session: Session, settings: Settings, tmp_path: Path
) -> None:
    import json

    from prahari.models import SalesArea

    def doc(products: list[dict[str, object]]) -> Path:
        p = tmp_path / "SALES_AREA.json"
        p.write_text(
            json.dumps(
                {
                    "kind": "sales_area",
                    "code": "T-RSA",
                    "name": "Test RSA",
                    "division": "Test DO",
                    "products": products,
                }
            )
        )
        return p

    gas = {"code": "CNG", "name": "CNG", "unit": "kg", "price_per_l": 76}
    job = import_file(session, doc([gas]), settings)
    assert job.status == "succeeded"
    area = session.scalar(select(SalesArea).where(SalesArea.code == "T-RSA"))
    assert area is not None and area.divisional_office == "Test DO"

    for bad in (
        {"code": "MS", "name": "Petrol", "price_per_l": 95},  # liquid without density
        {"code": "MS", "name": "Petrol", "price_per_l": 95, "density_min": 770, "density_max": 730},
    ):
        job = import_file(session, doc([bad]), settings, force=True)
        assert job.status == "failed"
