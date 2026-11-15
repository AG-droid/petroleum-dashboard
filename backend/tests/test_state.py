"""Outlet state: how stock "now" is worked out from readings, deliveries and expected sales."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from prahari.config import Settings
from prahari.domain.time import business_date, business_day_start
from prahari.models import Outlet, Receipt, TankReading
from prahari.models.readings import SOURCE_AUTOMATION, SOURCE_DIP_REGISTER
from prahari.services.state import compute_states, sales_days_between


def _today_start(settings: Settings) -> datetime:
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    return business_day_start(today, settings.tz, settings.business_day_start_hour)


def _manual_outlet(session: Session) -> Outlet:
    outlet = session.scalar(
        select(Outlet).where(Outlet.is_automated.is_(False)).order_by(Outlet.code).limit(1)
    )
    assert outlet is not None
    return outlet


def _tank(state, tank_no):  # type: ignore[no-untyped-def]
    return next(t for t in state.tanks if t.tank_no == tank_no)


def test_sales_days_follow_the_demand_curve(settings: Settings) -> None:
    start = _today_start(settings)
    tz, h = settings.tz, settings.business_day_start_hour
    assert sales_days_between(start, start + timedelta(days=1), tz, h) == pytest.approx(1.0)
    assert sales_days_between(start, start + timedelta(hours=6), tz, h) == pytest.approx(0.35, abs=0.05)
    assert sales_days_between(start + timedelta(hours=1), start, tz, h) == 0.0


def test_dip_is_projected_forward_and_flagged(session: Session, settings: Settings) -> None:
    outlet = _manual_outlet(session)
    noon = _today_start(settings) + timedelta(hours=6)
    (st,) = compute_states(session, settings, at=noon, codes=[outlet.code])
    tank = st.tanks[0]
    assert tank.source == SOURCE_DIP_REGISTER and tank.projected
    assert tank.estimated_l is not None and tank.volume_l is not None
    assert tank.estimated_l < tank.volume_l  # sales since the morning dip are taken off
    assert all(p.estimated for p in st.products.values())


def test_delivery_after_the_dip_is_added(session: Session, settings: Settings) -> None:
    outlet = _manual_outlet(session)
    noon = _today_start(settings) + timedelta(hours=6)
    (before,) = compute_states(session, settings, at=noon, codes=[outlet.code])
    t = outlet.tanks[0]
    session.add(
        Receipt(
            outlet_id=outlet.id,
            invoice_no="INV-TEST-1",
            invoice_date=noon.date(),
            received_at=noon - timedelta(hours=1),
            tt_no="HR99 TT 0001",
            product_code=t.product_code,
            tank_no=t.tank_no,
            invoice_qty_kl=4,
            invoice_density_15=830,
            observed_density_15=830.5,
            shortage_l=10,
        )
    )
    session.flush()
    (after,) = compute_states(session, settings, at=noon, codes=[outlet.code])
    gained = _tank(after, t.tank_no).estimated_l - _tank(before, t.tank_no).estimated_l
    cap_room = t.capacity_kl * 1000 - _tank(before, t.tank_no).estimated_l
    assert gained == pytest.approx(min(4000 - 10, cap_room), abs=1)


def test_before_todays_dip_yesterdays_dip_is_projected_across_the_day(
    session: Session, settings: Settings
) -> None:
    outlet = _manual_outlet(session)
    just_before = _today_start(settings) - timedelta(minutes=1)  # still yesterday's business day
    (st,) = compute_states(session, settings, at=just_before, codes=[outlet.code])
    tank = st.tanks[0]
    product = st.products[tank.product]
    assert tank.volume_l is not None and tank.estimated_l is not None and product.avg_daily_l
    # Roughly a whole day's sales (this tank's share) have gone since yesterday's 06:00 dip,
    # and any delivery since then has been added.
    assert tank.as_of is not None
    received = sum(
        r.invoice_qty_kl * 1000 - r.shortage_l
        for r in st.receipts
        if r.tank_no == tank.tank_no and tank.as_of < r.received_at <= just_before
    )
    share = tank.capacity_l / product.capacity_l
    expected = min(max(0.0, tank.volume_l + received - product.avg_daily_l * share), tank.capacity_l)
    assert tank.estimated_l == pytest.approx(expected, rel=0.08, abs=200)


def test_quiet_tank_gauge_is_projected_not_trusted(session: Session, settings: Settings) -> None:
    outlet = session.scalar(select(Outlet).where(Outlet.code == "990101"))
    assert outlet is not None and outlet.is_automated
    t = outlet.tanks[0]
    noon = _today_start(settings) + timedelta(hours=6)
    gauge_at = noon - timedelta(hours=4)  # older than the 120-minute freshness limit
    session.add(TankReading(tank_id=t.id, observed_at=gauge_at, source=SOURCE_AUTOMATION, volume_l=5000))
    session.flush()
    (st,) = compute_states(session, settings, at=noon, codes=[outlet.code])
    tank = _tank(st, t.tank_no)
    assert tank.source == SOURCE_AUTOMATION and tank.projected
    assert tank.estimated_l is not None and tank.estimated_l < 5000
    # A fresh gauge reading is used exactly as reported.
    session.add(
        TankReading(
            tank_id=t.id, observed_at=noon - timedelta(minutes=5), source=SOURCE_AUTOMATION, volume_l=4800
        )
    )
    session.flush()
    (st,) = compute_states(session, settings, at=noon, codes=[outlet.code])
    assert _tank(st, t.tank_no).estimated_l == 4800 and not _tank(st, t.tank_no).projected
