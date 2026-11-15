"""Compute the current state of every outlet from stored data.

This is the single place that turns raw records (readings, DSR lines, receipts, indents, licences)
into the figures people act on: stock now, days of cover, today's sales, stock variation and
automation status. The rules engine and the API both use it, so an alert and the screen that
explains it can never disagree.

All outlets are computed together with a handful of set-based queries (no per-outlet queries).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from prahari.config import Settings
from prahari.domain.demand import sales_fraction_since
from prahari.domain.time import business_date, business_day_start, now_utc
from prahari.models import (
    Indent,
    Licence,
    Nozzle,
    NozzleDailySales,
    Outlet,
    Receipt,
    Tank,
    TankReading,
    TotalizerReading,
)
from prahari.models.readings import SOURCE_AUTOMATION, SOURCE_DIP_REGISTER
from prahari.models.supply import INDENT_COVERING, INDENT_ON_HOLD

HISTORY_DAYS = 30
MORNING_DIP_WINDOW = timedelta(hours=3)  # a "morning dip" is taken within 3 h of the day's start


@dataclass
class TankState:
    tank_no: int
    product: str
    capacity_l: float
    volume_l: float | None  # latest reading as recorded
    estimated_l: float | None  # volume now: latest reading minus expected sales since (if not live)
    as_of: datetime | None
    source: str | None
    water_mm: float | None
    temp_c: float | None


@dataclass
class ProductState:
    product: str
    stock_l: float | None
    capacity_l: float
    avg_daily_l: float | None
    days_cover: float | None
    estimated: bool  # True when stock is projected from an earlier dip rather than read live


@dataclass
class OutletState:
    outlet: Outlet
    business_date: date
    tanks: list[TankState] = field(default_factory=list)
    products: dict[str, ProductState] = field(default_factory=dict)
    today_l: dict[str, float] | None = None  # live sales so far this business day, by product
    today_as_of: datetime | None = None
    history: list[dict[str, float | str]] = field(default_factory=list)  # per day: kL by product + total
    mtd_kl: float = 0.0
    variation_pct: float | None = None
    automation_online: bool | None = None  # None = outlet is not automated
    last_automation_at: datetime | None = None
    open_indents: list[Indent] = field(default_factory=list)
    receipts: list[Receipt] = field(default_factory=list)
    licences: list[tuple[Licence, int]] = field(default_factory=list)  # (licence, days left)

    @property
    def min_cover(self) -> ProductState | None:
        rated = [p for p in self.products.values() if p.days_cover is not None]
        return min(rated, key=lambda p: p.days_cover or 0.0) if rated else None

    def covering_indent(self, product: str) -> Indent | None:
        return next(
            (i for i in self.open_indents if i.product_code == product and i.status in INDENT_COVERING), None
        )

    def held_indent(self, product: str) -> Indent | None:
        return next(
            (i for i in self.open_indents if i.product_code == product and i.status == INDENT_ON_HOLD), None
        )


def compute_states(session: Session, settings: Settings, *, at: datetime | None = None) -> list[OutletState]:
    """Return the state of every outlet as of ``at`` (default: now)."""
    at = at or now_utc()
    tz, start_hour = settings.tz, settings.business_day_start_hour
    today = business_date(at, tz, start_hour)
    day_start = business_day_start(today, tz, start_hour)
    first_day = today - timedelta(days=HISTORY_DAYS)

    outlets = list(
        session.scalars(
            select(Outlet)
            .options(
                selectinload(Outlet.tanks),
                selectinload(Outlet.nozzles),
                selectinload(Outlet.licences),
                selectinload(Outlet.dealer),
            )
            .order_by(Outlet.code)
        )
    )
    tanks_by_id: dict[int, Tank] = {t.id: t for o in outlets for t in o.tanks}
    nozzles_by_id: dict[int, Nozzle] = {n.id: n for o in outlets for n in o.nozzles}

    # --- daily sales by outlet/product/day (DSR) -----------------------------------------------
    daily: dict[int, dict[date, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    for outlet_id, product, d, litres in session.execute(
        select(
            Nozzle.outlet_id,
            Nozzle.product_code,
            NozzleDailySales.business_date,
            func.sum(NozzleDailySales.net_sale_l),
        )
        .join(Nozzle, Nozzle.id == NozzleDailySales.nozzle_id)
        .where(NozzleDailySales.business_date >= first_day, NozzleDailySales.business_date < today)
        .group_by(Nozzle.outlet_id, Nozzle.product_code, NozzleDailySales.business_date)
    ):
        daily[outlet_id][d][product] = float(litres)

    # --- latest tank reading (any source) and latest automation reading ----------------------
    latest: dict[int, TankReading] = {
        r.tank_id: r
        for r in session.scalars(
            select(TankReading)
            .where(TankReading.observed_at >= at - timedelta(days=3), TankReading.observed_at <= at)
            .distinct(TankReading.tank_id)
            .order_by(TankReading.tank_id, TankReading.observed_at.desc())
        )
    }
    last_auto: dict[int, datetime] = defaultdict(lambda: datetime.min.replace(tzinfo=at.tzinfo))
    for tank_id, ts in session.execute(
        select(TankReading.tank_id, func.max(TankReading.observed_at))
        .where(TankReading.source == SOURCE_AUTOMATION, TankReading.observed_at >= at - timedelta(days=2))
        .group_by(TankReading.tank_id)
    ):
        oid = tanks_by_id[tank_id].outlet_id
        last_auto[oid] = max(last_auto[oid], ts)
    feed_active = any(
        ts >= at - timedelta(minutes=settings.rules.automation_stale_minutes) for ts in last_auto.values()
    )

    # --- morning dips for the variation window ------------------------------------------------
    window = settings.rules.variation_window_days
    var_start = today - timedelta(days=window)
    morning: dict[tuple[int, date], float] = {}
    for d in (var_start, today):
        s = business_day_start(d, tz, start_hour)
        for r in session.scalars(
            select(TankReading).where(
                TankReading.source == SOURCE_DIP_REGISTER,
                TankReading.observed_at >= s,
                TankReading.observed_at < s + MORNING_DIP_WINDOW,
            )
        ):
            morning[(r.tank_id, d)] = r.volume_l

    # --- live sales today: latest totaliser minus yesterday's DSR closing ---------------------
    openings = {
        nid: closing
        for nid, closing in session.execute(
            select(NozzleDailySales.nozzle_id, NozzleDailySales.closing_l).where(
                NozzleDailySales.business_date == today - timedelta(days=1)
            )
        )
    }
    live_tot: dict[int, TotalizerReading] = {
        r.nozzle_id: r
        for r in session.scalars(
            select(TotalizerReading)
            .where(TotalizerReading.observed_at >= day_start, TotalizerReading.observed_at <= at)
            .distinct(TotalizerReading.nozzle_id)
            .order_by(TotalizerReading.nozzle_id, TotalizerReading.observed_at.desc())
        )
    }
    today_sales: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    today_asof: dict[int, datetime] = {}
    for nid, reading in live_tot.items():
        nozzle = nozzles_by_id.get(nid)
        if nozzle is None or nid not in openings:
            continue
        today_sales[nozzle.outlet_id][nozzle.product_code] += max(0.0, reading.totalizer_l - openings[nid])
        today_asof[nozzle.outlet_id] = max(
            today_asof.get(nozzle.outlet_id, reading.observed_at), reading.observed_at
        )

    # --- supply and compliance ------------------------------------------------------------------
    indents: dict[int, list[Indent]] = defaultdict(list)
    for ind in session.scalars(
        select(Indent)
        .where(Indent.status.in_(INDENT_COVERING | {INDENT_ON_HOLD}))
        .order_by(Indent.indent_date.desc())
    ):
        indents[ind.outlet_id].append(ind)
    receipts: dict[int, list[Receipt]] = defaultdict(list)
    for rc in session.scalars(
        select(Receipt)
        .where(Receipt.received_at >= at - timedelta(days=HISTORY_DAYS))
        .order_by(Receipt.received_at.desc())
    ):
        receipts[rc.outlet_id].append(rc)

    local_today = at.astimezone(tz).date()
    states = []
    for o in outlets:
        st = OutletState(outlet=o, business_date=today, open_indents=indents[o.id], receipts=receipts[o.id])
        days = daily[o.id]
        _history(st, days, today, first_day)
        st.licences = sorted(
            ((lc, (lc.valid_upto - local_today).days) for lc in o.licences), key=lambda x: x[1]
        )
        if o.id in today_sales:
            st.today_l = dict(today_sales[o.id])
            st.today_as_of = today_asof[o.id]
        if o.is_automated:
            seen = last_auto.get(o.id)
            st.last_automation_at = seen if seen and seen.year > 1 else None
            fresh = st.last_automation_at is not None and st.last_automation_at >= at - timedelta(
                minutes=settings.rules.automation_stale_minutes
            )
            # Without any live feed in the system we can't call an outlet offline; leave it unknown.
            st.automation_online = fresh if feed_active else None
        _stock(st, o, latest, days, at, settings)
        st.variation_pct = _variation(o, days, morning, st.receipts, var_start, today, tz, start_hour)
        states.append(st)
    return states


def _history(st: OutletState, days: dict[date, dict[str, float]], today: date, first_day: date) -> None:
    month_start = today.replace(day=1)
    d = first_day
    while d < today:
        row: dict[str, float | str] = {"date": d.isoformat()}
        total = 0.0
        for p, litres in days.get(d, {}).items():
            row[p] = round(litres / 1000, 3)
            total += litres / 1000
        row["total"] = round(total, 3)
        st.history.append(row)
        if d >= month_start:
            st.mtd_kl += total
        d += timedelta(days=1)


def _stock(
    st: OutletState,
    o: Outlet,
    latest: dict[int, TankReading],
    days: dict[date, dict[str, float]],
    at: datetime,
    settings: Settings,
) -> None:
    window = settings.rules.cover_window_days
    recent = sorted(days)[-window:]
    tz, start_hour = settings.tz, settings.business_day_start_hour
    for t in o.tanks:
        r = latest.get(t.id)
        est = None
        if r is not None:
            est = r.volume_l
            if r.source != SOURCE_AUTOMATION:
                # Project a manual dip forward by the sales expected since it was taken.
                avg = sum(days[d].get(t.product_code, 0.0) for d in recent) / len(recent) if recent else 0.0
                share = t.capacity_kl / max(
                    sum(x.capacity_kl for x in o.tanks if x.product_code == t.product_code), 1
                )
                since = sales_fraction_since(start_hour, at.astimezone(tz)) - sales_fraction_since(
                    start_hour, r.observed_at.astimezone(tz)
                )
                if business_date(r.observed_at, tz, start_hour) == st.business_date and since > 0:
                    est = max(0.0, r.volume_l - avg * share * since)
        st.tanks.append(
            TankState(
                t.tank_no,
                t.product_code,
                t.capacity_kl * 1000,
                r.volume_l if r else None,
                est,
                r.observed_at if r else None,
                r.source if r else None,
                r.water_mm if r else None,
                r.temp_c if r else None,
            )
        )
    for p in sorted({t.product_code for t in o.tanks}):
        ts = [t for t in st.tanks if t.product == p]
        known = [t.estimated_l for t in ts if t.estimated_l is not None]
        stock: float | None = sum(known) if len(known) == len(ts) else None
        avg_daily = sum(days[d].get(p, 0.0) for d in recent) / len(recent) if recent else None
        cover = stock / avg_daily if stock is not None and avg_daily else None
        st.products[p] = ProductState(
            p,
            stock,
            sum(t.capacity_l for t in ts),
            avg_daily,
            cover,
            estimated=any(t.source != SOURCE_AUTOMATION for t in ts),
        )


def _variation(
    o: Outlet,
    days: dict[date, dict[str, float]],
    morning: dict[tuple[int, date], float],
    receipts: list[Receipt],
    start: date,
    end: date,
    tz: ZoneInfo,
    start_hour: int,
) -> float | None:
    """Book-vs-physical stock loss over ``start..end`` as % of sales (positive = unexplained loss).

    book closing = opening dip + receipts (invoice − shortage) − net sales; compared with the closing dip.
    Returns the worst product, or ``None`` if a dip or a day's DSR is missing.
    """
    s, e = business_day_start(start, tz, start_hour), business_day_start(end, tz, start_hour)
    window_days = [start + timedelta(days=k) for k in range((end - start).days)]
    if any(d not in days for d in window_days):
        return None
    worst: float | None = None
    for p in {t.product_code for t in o.tanks}:
        tanks = [t for t in o.tanks if t.product_code == p]
        try:
            opening = sum(morning[(t.id, start)] for t in tanks)
            closing = sum(morning[(t.id, end)] for t in tanks)
        except KeyError:
            return None
        received = sum(
            r.invoice_qty_kl * 1000 - r.shortage_l
            for r in receipts
            if r.product_code == p and s <= r.received_at < e
        )
        sold = sum(days[d].get(p, 0.0) for d in window_days)
        if sold <= 0:
            continue
        pct = (opening + received - sold - closing) / sold * 100
        worst = pct if worst is None or pct > worst else worst
    return worst
