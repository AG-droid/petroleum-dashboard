"""Compute the current state of every outlet from stored data.

This is the single place that turns raw records (readings, DSR lines, receipts, indents, licences)
into the figures people act on: stock now, days of cover, today's sales, stock variation and
automation status. The rules engine and the API both use it, so an alert and the screen that
explains it can never disagree.

All outlets are computed together with a handful of set-based queries (no per-outlet queries).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, true
from sqlalchemy.orm import Session, aliased, selectinload

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
from prahari.models.supply import INDENT_COVERING, INDENT_ON_HOLD, INDENT_REQUESTED

HISTORY_DAYS = 30
MORNING_DIP_WINDOW = timedelta(hours=3)  # a "morning dip" is taken within 3 h of the day's start
READING_LOOKBACK = timedelta(days=3)  # older readings are too stale to project from


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
    projected: bool = False  # True when not a fresh gauge reading (see ``_stock``)


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
    # Alert keys whose condition can't be judged for lack of data. The rules engine leaves those
    # alerts as they are instead of resolving them.
    unknown: set[str] = field(default_factory=set)

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


def compute_states(
    session: Session,
    settings: Settings,
    *,
    at: datetime | None = None,
    codes: Collection[str] | None = None,
) -> list[OutletState]:
    """Return the state of every outlet (or only those in ``codes``) as of ``at`` (default: now)."""
    at = at or now_utc()
    tz, start_hour = settings.tz, settings.business_day_start_hour
    today = business_date(at, tz, start_hour)
    day_start = business_day_start(today, tz, start_hour)
    first_day = today - timedelta(days=HISTORY_DAYS)

    q = select(Outlet).options(
        selectinload(Outlet.tanks),
        selectinload(Outlet.nozzles),
        selectinload(Outlet.licences),
        selectinload(Outlet.dealer),
    )
    if codes is not None:
        q = q.where(Outlet.code.in_(list(codes)))
    outlets = list(session.scalars(q.order_by(Outlet.code)))
    if not outlets:
        return []
    outlet_ids = [o.id for o in outlets]
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
        .where(
            Nozzle.outlet_id.in_(outlet_ids),
            NozzleDailySales.business_date >= first_day,
            NozzleDailySales.business_date < today,
        )
        .group_by(Nozzle.outlet_id, Nozzle.product_code, NozzleDailySales.business_date)
    ):
        daily[outlet_id][d][product] = float(litres)

    # --- latest readings: one index-backed lookup per tank / nozzle -----------------------------
    latest = _latest_tank_readings(session, list(tanks_by_id), at, at - READING_LOOKBACK)
    latest_auto = _latest_tank_readings(
        session, list(tanks_by_id), at, at - READING_LOOKBACK, SOURCE_AUTOMATION
    )
    stale = timedelta(minutes=settings.rules.automation_stale_minutes)
    requested_valid = timedelta(hours=settings.rules.requested_indent_hours)
    last_auto: dict[int, datetime] = {}
    for tank_id, r in latest_auto.items():
        oid = tanks_by_id[tank_id].outlet_id
        last_auto[oid] = max(last_auto.get(oid, r.observed_at), r.observed_at)
    # Whether any live feed is running at all (system-wide, not just for the requested outlets).
    feed_active = bool(
        session.scalar(
            select(TankReading.observed_at)
            .where(
                TankReading.source == SOURCE_AUTOMATION,
                TankReading.observed_at > at - stale,
                TankReading.observed_at <= at,
            )
            .limit(1)
        )
    )

    # --- morning dips for the variation window (first dip of each business day) ---------------
    window = settings.rules.variation_window_days
    var_start = today - timedelta(days=window)
    morning: dict[tuple[int, date], float] = {}
    for d in (var_start, today):
        s = business_day_start(d, tz, start_hour)
        for r in session.scalars(
            select(TankReading)
            .where(
                TankReading.tank_id.in_(list(tanks_by_id)),
                TankReading.source == SOURCE_DIP_REGISTER,
                TankReading.observed_at >= s,
                TankReading.observed_at < min(s + MORNING_DIP_WINDOW, at + timedelta(microseconds=1)),
            )
            .order_by(TankReading.observed_at)
        ):
            morning.setdefault((r.tank_id, d), r.volume_l)  # a later re-dip doesn't replace it

    # --- live sales today: latest totaliser minus yesterday's DSR closing ---------------------
    openings = dict(
        session.execute(
            select(NozzleDailySales.nozzle_id, NozzleDailySales.closing_l).where(
                NozzleDailySales.nozzle_id.in_(list(nozzles_by_id)),
                NozzleDailySales.business_date == today - timedelta(days=1),
            )
        )
        .tuples()
        .all()
    )
    live_tot = _latest_totalizers(session, list(nozzles_by_id), at, day_start)
    today_sales: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    today_asof: dict[int, datetime] = {}
    for nid, reading in live_tot.items():
        nozzle = nozzles_by_id[nid]
        if nid not in openings:
            continue
        today_sales[nozzle.outlet_id][nozzle.product_code] += max(0.0, reading.totalizer_l - openings[nid])
        today_asof[nozzle.outlet_id] = max(
            today_asof.get(nozzle.outlet_id, reading.observed_at), reading.observed_at
        )

    # --- supply and compliance ------------------------------------------------------------------
    indents: dict[int, list[Indent]] = defaultdict(list)
    for ind in session.scalars(
        select(Indent)
        .where(Indent.outlet_id.in_(outlet_ids), Indent.status.in_(INDENT_COVERING | {INDENT_ON_HOLD}))
        .order_by(Indent.indent_date.desc())
    ):
        # A request raised in Prahari that nobody has acted on stops counting as "fuel coming".
        if ind.status == INDENT_REQUESTED and ind.created_at < at - requested_valid:
            continue
        indents[ind.outlet_id].append(ind)
    receipts: dict[int, list[Receipt]] = defaultdict(list)
    for rc in session.scalars(
        select(Receipt)
        .where(
            Receipt.outlet_id.in_(outlet_ids),
            Receipt.received_at >= at - timedelta(days=HISTORY_DAYS),
            Receipt.received_at <= at,
        )
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
            st.last_automation_at = last_auto.get(o.id)
            fresh = st.last_automation_at is not None and st.last_automation_at > at - stale
            # With no live feed running anywhere we can't tell an outlet is offline: unknown.
            st.automation_online = fresh if feed_active else None
            if st.automation_online is None:
                st.unknown.add(f"ra:{o.code}")
        _stock(st, o, latest, days, at, settings)
        st.variation_pct = _variation(o, days, morning, st.receipts, var_start, today, tz, start_hour)
        if st.variation_pct is None:
            st.unknown.add(f"var:{o.code}")
        states.append(st)
    return states


def _latest_tank_readings(
    session: Session, tank_ids: list[int], at: datetime, since: datetime, source: str | None = None
) -> dict[int, TankReading]:
    """Newest reading per tank in ``(since, at]``, via a LATERAL ... LIMIT 1 per tank.

    Each lookup is a backward scan of the (tank_id, observed_at) primary-key index, so the cost
    doesn't grow with the number of readings stored (a live feed adds thousands per hour).
    """
    if not tank_ids:
        return {}
    cond = [TankReading.tank_id == Tank.id, TankReading.observed_at <= at, TankReading.observed_at > since]
    if source is not None:
        cond.append(TankReading.source == source)
    sub = select(TankReading).where(*cond).order_by(TankReading.observed_at.desc()).limit(1).lateral()
    reading = aliased(TankReading, sub)
    rows = session.scalars(select(reading).select_from(Tank).join(sub, true()).where(Tank.id.in_(tank_ids)))
    return {r.tank_id: r for r in rows}


def _latest_totalizers(
    session: Session, nozzle_ids: list[int], at: datetime, since: datetime
) -> dict[int, TotalizerReading]:
    """Newest totaliser reading per nozzle in ``[since, at]`` (same LATERAL pattern)."""
    if not nozzle_ids:
        return {}
    sub = (
        select(TotalizerReading)
        .where(
            TotalizerReading.nozzle_id == Nozzle.id,
            TotalizerReading.observed_at <= at,
            TotalizerReading.observed_at >= since,
        )
        .order_by(TotalizerReading.observed_at.desc())
        .limit(1)
        .lateral()
    )
    reading = aliased(TotalizerReading, sub)
    rows = session.scalars(
        select(reading).select_from(Nozzle).join(sub, true()).where(Nozzle.id.in_(nozzle_ids))
    )
    return {r.nozzle_id: r for r in rows}


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


def sales_days_between(earlier: datetime, later: datetime, tz: ZoneInfo, start_hour: int) -> float:
    """How many days' worth of sales happen between two instants, following the demand curve.

    Whole business days count as 1 each; partial days count by the hourly profile (a reading at
    06:10 and another at 12:00 the same day are ~0.35 of a day's sales apart, not 0.24).
    """
    if later <= earlier:
        return 0.0
    whole = (business_date(later, tz, start_hour) - business_date(earlier, tz, start_hour)).days
    part = sales_fraction_since(start_hour, later.astimezone(tz)) - sales_fraction_since(
        start_hour, earlier.astimezone(tz)
    )
    return max(0.0, whole + part)


def _stock(
    st: OutletState,
    o: Outlet,
    latest: dict[int, TankReading],
    days: dict[date, dict[str, float]],
    at: datetime,
    settings: Settings,
) -> None:
    """Stock per tank and product, "now".

    A fresh tank-gauge reading is used as is. Anything else (a manual dip, or a gauge that has gone
    quiet) is projected forward: minus the sales expected since it was taken, plus deliveries
    received into that tank since. Projected figures are flagged as estimates.
    """
    recent = sorted(days)[-settings.rules.cover_window_days :]
    tz, start_hour = settings.tz, settings.business_day_start_hour
    stale = timedelta(minutes=settings.rules.automation_stale_minutes)
    for t in o.tanks:
        r = latest.get(t.id)
        est, projected = None, False
        if r is not None:
            est = r.volume_l
            if not (r.source == SOURCE_AUTOMATION and at - r.observed_at <= stale):
                avg = sum(days[d].get(t.product_code, 0.0) for d in recent) / len(recent) if recent else 0.0
                share = t.capacity_kl / max(
                    sum(x.capacity_kl for x in o.tanks if x.product_code == t.product_code), 1e-9
                )
                received = sum(
                    rc.invoice_qty_kl * 1000 - rc.shortage_l
                    for rc in st.receipts
                    if rc.tank_no == t.tank_no and r.observed_at < rc.received_at <= at
                )
                sold = avg * share * sales_days_between(r.observed_at, at, tz, start_hour)
                est = min(max(0.0, r.volume_l + received - sold), t.capacity_kl * 1000)
                projected = True
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
                projected,
            )
        )
    for p in sorted({t.product_code for t in o.tanks}):
        ts = [t for t in st.tanks if t.product == p]
        known = [t.estimated_l for t in ts if t.estimated_l is not None]
        stock: float | None = sum(known) if len(known) == len(ts) else None
        avg_daily = sum(days[d].get(p, 0.0) for d in recent) / len(recent) if recent else None
        cover = stock / avg_daily if stock is not None and avg_daily else None
        if cover is None:
            st.unknown |= {f"dry:{o.code}:{p}", f"low:{o.code}:{p}"}
        st.products[p] = ProductState(
            p, stock, sum(t.capacity_l for t in ts), avg_daily, cover, estimated=any(t.projected for t in ts)
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
