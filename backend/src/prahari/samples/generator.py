"""Generate a month of realistic, *synthetic* source files for one sales area.

The files follow the layouts in :mod:`prahari.ingest.formats` and are internally consistent, so the
importers and rules can be exercised exactly as they would be with real exports:

* totalisers carry over from one day's closing to the next day's opening;
* each morning's dip = previous dip + receipts − sales − losses, converted to millimetres with the
  tank's calibration (the importer converts back, as an outlet would);
* receipts arrive when a tank has room, as whole truckloads, with density checks;
* the dashboard's storylines are reproduced (diesel order on payment hold, density failure,
  stock variation, licences about to expire, a falling-sales outlet).

The world (outlets, tanks, nozzles, history) comes from ``world.json``, exported from the
dashboard's own generator by ``tools/export_world.mjs``, so the backend and the UI describe the
same 44 outlets. All names, numbers and plates are fictional.
"""

from __future__ import annotations

import csv
import json
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from openpyxl import Workbook

from prahari.domain.calibration import dip_from_volume, standard_dimensions, volume_from_dip
from prahari.domain.products import HSD, MS, PRODUCT_NAMES
from prahari.domain.time import business_date, business_day_start
from prahari.ingest.formats import FORMATS, SAP, FileKind

WORLD_PATH = Path(__file__).with_name("world.json")
SALES_AREA_CODE = "GGN-SA"
TESTING_L_PER_NOZZLE = 5.0  # the daily 5-litre measure test, returned to the tank
# Deliveries are whole tank-truck compartments (4–5 kL each): part loads, full trucks, two trucks.
TRUCKLOADS_KL = (4, 6, 8, 9, 12, 16, 20, 24, 32, 36, 40)
DRYOUT_MORNING_COVER_DAYS = 0.95  # the dry-out story outlet's diesel at the morning dip
COVERED_MORNING_COVER_DAYS = 1.1  # the "truck on the way" story outlet's petrol
SHORTAGES_L = (0, 0, 0, 0, 0, 5, 10, 15, 25, 40)  # typical transit shortages, mostly none
LICENCE_TYPES = {"peso": "PESO", "stamp": "LM_STAMPING", "fire": "FIRE_NOC", "pcc": "PCB_CONSENT"}
DENSITY_COEFF = {MS: 0.9, HSD: 0.65}  # kg/m³ per °C (approximate thermal correction)


@dataclass
class _Receipt:
    business_date: date
    product: str
    qty_kl: float
    density_diff: float | None = None  # forced value for storylines
    at_fraction: float = 0.7  # how far through the business day it arrives
    # Litres short against the invoice. Decided while planning stock, so the dip series reflects
    # what was actually received and the books balance (it is booked on the first tank's line).
    shortage_l: float = 0.0


@dataclass
class _OutletPlan:
    """Everything generated for one outlet, before writing files."""

    world: dict[str, Any]
    sap: str
    tanks: list[dict[str, Any]]
    nozzles: list[dict[str, Any]]
    sales_l: dict[date, dict[str, float]] = field(default_factory=dict)  # product net sales per day
    stock_l: dict[date, dict[str, float]] = field(default_factory=dict)  # product stock each morning
    receipts: list[_Receipt] = field(default_factory=list)


def generate(
    out_dir: Path,
    *,
    as_of: datetime,
    tz: ZoneInfo,
    start_hour: int = 6,
    days: int = 30,
    seed: int = 20261115,
    world_path: Path = WORLD_PATH,
    variation_window: int = 3,
) -> list[Path]:
    """Write the sample files into ``out_dir`` and return their paths (import order)."""
    if as_of.tzinfo is None:
        raise ValueError("as_of must be timezone-aware")
    rng = random.Random(seed)
    world = json.loads(world_path.read_text())
    today = business_date(as_of, tz, start_hour)
    bdays = [today - timedelta(days=k) for k in range(days, 0, -1)]  # complete business days
    prices = {p["key"]: float(p["price"]) for p in world["products"]}
    dens_range = {p["key"]: tuple(p["density_range"]) for p in world["products"]}
    stories = world["stories"]

    plans = []
    for i, w in enumerate(world["outlets"]):
        plan = _plan_outlet(w, f"{12100000 + (i + 1) * 137}", bdays, today, rng, stories, variation_window)
        plans.append(plan)

    out_dir.mkdir(parents=True, exist_ok=True)
    gen = _Writer(out_dir, as_of)
    files = [
        gen.sales_area(world),
        gen.ro_master(plans, rng),
        gen.tank_master(plans),
        gen.nozzle_master(plans),
        gen.licences(plans, as_of.astimezone(tz).date(), rng),
    ]
    receipts_rows, indent_rows = _receipts_and_indents(plans, tz, start_hour, rng, dens_range, stories, today)
    files.append(gen.receipts(receipts_rows, bdays[0], today))
    files.append(gen.indents(indent_rows, today))
    files += gen.dsr(plans, bdays, prices, rng)
    files += gen.dips(plans, [*bdays, today], tz, start_hour, rng, dens_range)
    gen.feed_state(plans, today, start_hour, prices)
    return files


# --------------------------------------------------------------------------------------------
# Planning: sales, stock and receipts for one outlet
# --------------------------------------------------------------------------------------------
def _plan_outlet(
    w: dict[str, Any],
    sap: str,
    bdays: list[date],
    today: date,
    rng: random.Random,
    stories: dict[str, str],
    variation_window: int,
) -> _OutletPlan:
    tanks = []
    for t in w["tanks"]:
        dia, length = standard_dimensions(t["capacity_kl"])
        tanks.append({**t, "diameter_mm": dia, "length_mm": length})
    nozzles = [{**n, "weight": rng.uniform(0.6, 1.4)} for n in w["nozzles"]]
    plan = _OutletPlan(world=w, sap=sap, tanks=tanks, nozzles=nozzles)
    products = list(w["daily_kl"])
    hist = w["history"]  # 30 rows, oldest first; the last row is "today"

    for k, d in enumerate(reversed(bdays), start=1):  # k = days before today
        row = hist[-1 - k] if k < len(hist) else hist[0]
        plan.sales_l[d] = {p: max(0.0, float(row.get(p, w["daily_kl"][p]))) * 1000 for p in products}

    # Storyline: last diesel delivery at the density outlet failed its density check.
    if w["code"] == stories["density"]:
        plan.receipts.append(_Receipt(bdays[-1], HSD, 20, density_diff=4.2, at_fraction=0.72))

    # Only the scripted outlet loses stock beyond the limit; elsewhere small, plausible losses.
    variation = (
        float(w["variation_pct"]) / 100 if w["code"] == stories["variation"] else rng.uniform(0.0, 0.0025)
    )
    for p in products:
        cap_l = sum(t["capacity_kl"] for t in tanks if t["product"] == p) * 1000
        stock = sum(t["stock_kl"] for t in tanks if t["product"] == p) * 1000
        # Supply storylines start the day with about a day's fuel, so they stay "about to run
        # dry" through the demo day instead of hitting empty in the afternoon.
        if w["code"] == stories["dryout"] and p == HSD:
            stock = w["daily_kl"][p] * 1000 * DRYOUT_MORNING_COVER_DAYS
        elif w["code"] == stories["covered"] and p == MS:
            stock = w["daily_kl"][p] * 1000 * COVERED_MORNING_COVER_DAYS
        plan.stock_l.setdefault(today, {})[p] = stock
        forced = {r.business_date: r for r in plan.receipts if r.product == p}
        for k, d in enumerate(reversed(bdays)):
            sold = plan.sales_l[d][p]
            loss_frac = variation if k < variation_window else rng.uniform(-0.0015, 0.0025)
            before = stock + sold * (1 + loss_frac)  # stock this morning if nothing was received
            if d in forced:
                before -= forced[d].qty_kl * 1000 - forced[d].shortage_l
            elif before > 0.9 * cap_l:
                qty = _truckload(before, cap_l)
                if qty:
                    short = float(rng.choice(SHORTAGES_L))
                    before -= qty * 1000 - short
                    plan.receipts.append(
                        _Receipt(d, p, qty, at_fraction=rng.uniform(0.25, 0.8), shortage_l=short)
                    )
            # No clamping: the stock series must stay exactly consistent with sales and receipts,
            # or the variation rule would (rightly) flag the difference.
            stock = before
            plan.stock_l.setdefault(d, {})[p] = stock
    return plan


def _truckload(before_l: float, cap_l: float) -> float:
    """Smallest load that brings the morning stock back into a plausible range (0 = none fits).

    ``before_l`` is the stock there would have been without a delivery; the load must leave at
    least 10% in the tank before it arrived and fit in the tank.
    """
    loads = [q for q in TRUCKLOADS_KL if q * 1000 <= 0.9 * cap_l]
    for qty in loads:
        if 0.1 * cap_l <= before_l - qty * 1000 <= 0.85 * cap_l:
            return qty
    fitting = [q for q in loads if before_l - q * 1000 >= 0.1 * cap_l]
    return fitting[-1] if fitting else 0


def _tank_shares(plan: _OutletPlan, product: str) -> list[tuple[dict[str, Any], float]]:
    tanks = [t for t in plan.tanks if t["product"] == product]
    total = sum(t["capacity_kl"] for t in tanks)
    return [(t, t["capacity_kl"] / total) for t in tanks]


def _receipts_and_indents(
    plans: list[_OutletPlan],
    tz: ZoneInfo,
    start_hour: int,
    rng: random.Random,
    dens_range: dict[str, tuple[float, float]],
    stories: dict[str, str],
    today: date,
) -> tuple[list[list[Any]], list[list[Any]]]:
    receipts: list[list[Any]] = []
    indents: list[list[Any]] = []
    seq = 7_100_000
    for plan in plans:
        for r in sorted(plan.receipts, key=lambda x: (x.business_date, x.product)):
            seq += rng.randint(3, 40)
            inv, ind = f"INV{seq}", f"IND{seq - 2_600_000}"
            tt = _plate(rng)
            arrived = business_day_start(r.business_date, tz, start_hour) + timedelta(days=r.at_fraction)
            local = arrived.astimezone(tz)
            sold_so_far = plan.sales_l[r.business_date][r.product] * r.at_fraction
            lo, hi = dens_range[r.product]
            inv_dens = round(rng.uniform(lo + 2, hi - 2), 1)
            diff = r.density_diff if r.density_diff is not None else round(rng.gauss(0, 0.55), 1)
            for line, (tank, share) in enumerate(_tank_shares(plan, r.product)):
                qty_l = r.qty_kl * 1000 * share
                before_l = max(plan.stock_l[r.business_date][r.product] * share - sold_so_far * share, 0.0)
                after_l = min(before_l + qty_l, tank["capacity_kl"] * 1000 * 0.995)
                dia, length = tank["diameter_mm"], tank["length_mm"]
                receipts.append(
                    [
                        local.date(),
                        local.strftime("%H:%M"),
                        plan.sap,
                        inv,
                        r.business_date,
                        tt,
                        _file_product(r.product),
                        tank["tank_no"],
                        round(r.qty_kl * share, 3),
                        inv_dens,
                        round(inv_dens + diff, 1),
                        round(dip_from_volume(before_l, dia, length)),
                        round(dip_from_volume(after_l, dia, length)),
                        r.shortage_l if line == 0 else 0,
                    ]
                )
            indents.append(
                [
                    ind,
                    r.business_date - timedelta(days=1),
                    plan.sap,
                    _file_product(r.product),
                    r.qty_kl,
                    "Delivered",
                    "",
                    tt,
                    inv,
                ]
            )
        # Open indents (storylines): an order stuck on payment, and one already on the road.
        code = plan.world["code"]
        if code == stories["dryout"] and plan.world.get("pending_indent"):
            pi = plan.world["pending_indent"]
            indents.append(
                [
                    f"IND{seq - 2_599_000}",
                    today,
                    plan.sap,
                    _file_product(pi["product"]),
                    pi["qty"],
                    "On hold",
                    pi["reason"],
                    "",
                    "",
                ]
            )
        if code == stories["covered"]:
            indents.append(
                [
                    f"IND{seq - 2_598_000}",
                    today,
                    plan.sap,
                    _file_product(MS),
                    12,
                    "Dispatched",
                    "",
                    _plate(rng),
                    f"INV{seq + 1}",
                ]
            )
    return receipts, indents


def _plate(rng: random.Random) -> str:
    """A fictional tank-truck registration (series 'HR99 TT' is not a real allotment)."""
    return f"HR99 TT {rng.randint(1000, 9999)}"


def _file_product(code: str) -> str:
    """How exports label products (premium petrol appears as 'PMS', not our internal 'XP')."""
    return {"XP": "PMS"}.get(code, code)


# --------------------------------------------------------------------------------------------
# Writing files
# --------------------------------------------------------------------------------------------
class _Writer:
    def __init__(self, root: Path, as_of: datetime) -> None:
        self.root = root
        self.stamp = as_of.strftime("%d-%m-%Y %H:%M")

    def _path(self, sub: str, name: str) -> Path:
        p = self.root / sub / name
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def _xlsx(self, path: Path, kind: FileKind, rows: list[list[Any]]) -> Path:
        """MIS-style workbook: a two-line title block, a blank row, then the header."""
        fmt = FORMATS[kind]
        wb = Workbook()
        ws = wb.active
        assert ws is not None
        ws.title = kind.value.upper()
        ws.append([f"Gurugram Sales Area: {fmt.title}"])
        ws.append([f"Generated {self.stamp} · SYNTHETIC DEMO DATA"])
        ws.append([])
        ws.append(list(fmt.columns))
        for r in rows:
            ws.append(r)
        wb.save(path)
        return path

    def _csv(self, path: Path, kind: FileKind, rows: list[list[Any]]) -> Path:
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(FORMATS[kind].columns)
            for r in rows:
                w.writerow([v.strftime("%d-%m-%Y") if isinstance(v, date) else v for v in r])
        return path

    def sales_area(self, world: dict[str, Any]) -> Path:
        path = self._path("00_master", "SALES_AREA.json")
        doc = {
            "kind": FileKind.SALES_AREA.value,
            "code": SALES_AREA_CODE,
            "name": world["meta"]["salesArea"],
            "division": world["meta"]["division"],
            "state_office": world["meta"]["state"],
            "boundary": world["area"],
            "depots": [
                {
                    "code": d["id"],
                    "name": d["name"],
                    "lat": d["lat"],
                    "lng": d["lng"],
                    "capacity_kl": d["capacity_kl"],
                }
                for d in world["depots"]
            ],
            "products": [
                {
                    "code": p["key"],
                    "name": PRODUCT_NAMES.get(p["key"], p["name"]),
                    "price_per_l": p["price"],
                    "density_min": p["density_range"][0],
                    "density_max": p["density_range"][1],
                }
                for p in world["products"]
            ],
        }
        path.write_text(json.dumps(doc, indent=1) + "\n")
        return path

    def ro_master(self, plans: list[_OutletPlan], rng: random.Random) -> Path:
        rows = []
        for p in plans:
            w = p.world
            rows.append(
                [
                    p.sap,
                    w["code"],
                    w["name"],
                    "Gurugram",
                    w["category"],
                    w["type"],
                    "Y" if w["ksk"] else "N",
                    w["locality"],
                    w["road"],
                    w["address"],
                    round(w["lat"], 6),
                    round(w["lng"], 6),
                    "Y" if w["automated"] else "N",
                    round(w["target_month_kl"], 1),
                    w["dealer"]["name"],
                    f"+91 99999 {rng.randint(10000, 99999)}",
                    w["dealer"]["since"],
                ]
            )
        return self._xlsx(self._path("00_master", "RO_MASTER.xlsx"), FileKind.RO_MASTER, rows)

    def tank_master(self, plans: list[_OutletPlan]) -> Path:
        rows = [
            [
                p.sap,
                t["tank_no"],
                _file_product(t["product"]),
                t["capacity_kl"],
                t["diameter_mm"],
                t["length_mm"],
            ]
            for p in plans
            for t in p.tanks
        ]
        return self._xlsx(self._path("00_master", "TANK_MASTER.xlsx"), FileKind.TANK_MASTER, rows)

    def nozzle_master(self, plans: list[_OutletPlan]) -> Path:
        rows = []
        for p in plans:
            for n in p.nozzles:
                tank = next(t for t in p.tanks if t["product"] == n["product"])
                rows.append([p.sap, n["du_no"], n["nozzle_no"], _file_product(n["product"]), tank["tank_no"]])
        return self._csv(self._path("00_master", "NOZZLE_MASTER.csv"), FileKind.NOZZLE_MASTER, rows)

    def licences(self, plans: list[_OutletPlan], today: date, rng: random.Random) -> Path:
        rows = []
        for p in plans:
            for key, ltype in LICENCE_TYPES.items():
                valid = today + timedelta(days=round(p.world["licences"][key]["due_in_days"]))
                issued = valid - timedelta(days=365 * rng.randint(1, 5))
                rows.append(
                    [p.sap, ltype, f"{ltype}/HR/{issued.year}/{rng.randint(10000, 99999)}", issued, valid]
                )
        return self._csv(self._path("01_compliance", "LICENCE_REGISTER.csv"), FileKind.LICENCE_REGISTER, rows)

    def receipts(self, rows: list[list[Any]], first: date, today: date) -> Path:
        name = f"TT_RECEIPTS_{first:%Y%m%d}_{today:%Y%m%d}.xlsx"
        return self._xlsx(self._path("02_supply", name), FileKind.TT_RECEIPTS, rows)

    def indents(self, rows: list[list[Any]], today: date) -> Path:
        return self._csv(
            self._path("02_supply", f"INDENT_STATUS_{today:%Y%m%d}.csv"), FileKind.INDENT_STATUS, rows
        )

    def dsr(
        self, plans: list[_OutletPlan], bdays: list[date], prices: dict[str, float], rng: random.Random
    ) -> list[Path]:
        # Walk totalisers backwards from today's reading so the last closing equals the world value.
        closing = {(p.sap, n["nozzle_no"]): float(n["totalizer_l"]) for p in plans for n in p.nozzles}
        per_day: dict[date, list[list[Any]]] = defaultdict(list)
        for d in reversed(bdays):
            for p in plans:
                for prod, sold in p.sales_l[d].items():
                    nz = [n for n in p.nozzles if n["product"] == prod]
                    weights = [n["weight"] * rng.uniform(0.85, 1.15) for n in nz]
                    total_w = sum(weights)
                    for n, wt in zip(nz, weights, strict=True):
                        net = round(sold * wt / total_w, 2)
                        close = closing[(p.sap, n["nozzle_no"])]
                        opening = round(close - net - TESTING_L_PER_NOZZLE, 2)
                        per_day[d].append(
                            [
                                d,
                                p.sap,
                                n["du_no"],
                                n["nozzle_no"],
                                _file_product(prod),
                                opening,
                                round(close, 2),
                                TESTING_L_PER_NOZZLE,
                                net,
                                prices[prod],
                                round(net * prices[prod], 2),
                            ]
                        )
                        closing[(p.sap, n["nozzle_no"])] = opening
        return [
            self._xlsx(self._path("03_sales", f"DSR_{d:%Y%m%d}.xlsx"), FileKind.DSR, per_day[d])
            for d in bdays
        ]

    def dips(
        self,
        plans: list[_OutletPlan],
        dates: list[date],
        tz: ZoneInfo,
        start_hour: int,
        rng: random.Random,
        dens_range: dict[str, tuple[float, float]],
    ) -> list[Path]:
        out = []
        for d in dates:
            rows = []
            for p in plans:
                # Today's dip is stamped at the start of the day so it is never "in the future"
                # relative to the moment the data is generated (or a test runs).
                late = 0 if d == dates[-1] else rng.randint(0, 25)
                at = business_day_start(d, tz, start_hour) + timedelta(minutes=late)
                for prod, stock in p.stock_l[d].items():
                    for tank, share in _tank_shares(p, prod):
                        vol = min(stock * share, tank["capacity_kl"] * 1000)
                        dia, length = tank["diameter_mm"], tank["length_mm"]
                        water = max(0, round(tank["water_mm"] + rng.uniform(-2, 2)))
                        # The rod reads product + water; the importer subtracts the water again.
                        # 0.1 mm, as tank gauges report: whole-mm rounding alone can swing the variation
                        # of a low-volume product by ~0.4% over 3 days.
                        dip = round(
                            dip_from_volume(vol + volume_from_dip(water, dia, length), dia, length), 1
                        )
                        temp = round(rng.uniform(22, 33), 1)
                        lo, hi = dens_range[prod]
                        d15 = round(rng.uniform(lo + 3, hi - 3), 1)
                        obs = round(d15 - DENSITY_COEFF.get(prod, 0.9) * (temp - 15), 1)
                        rows.append(
                            [
                                at.date(),
                                at.strftime("%H:%M"),
                                p.sap,
                                tank["tank_no"],
                                _file_product(prod),
                                dip,
                                water,
                                temp,
                                obs,
                                d15,
                            ]
                        )
            out.append(
                self._csv(self._path("04_stock", f"DIP_REGISTER_{d:%Y%m%d}.csv"), FileKind.DIP_REGISTER, rows)
            )
        return out

    def feed_state(
        self, plans: list[_OutletPlan], today: date, start_hour: int, prices: dict[str, float]
    ) -> Path:
        """Starting point for the live automation feed (``prahari feed``); not an import file."""
        sites = []
        for p in plans:
            w = p.world
            sites.append(
                {
                    "sap_code": p.sap,
                    "code": w["code"],
                    "automated": w["automated"],
                    "online": w["automation_online"],
                    "daily_l": {k: v * 1000 for k, v in w["daily_kl"].items()},
                    "tanks": [
                        {
                            "tank_no": t["tank_no"],
                            "product": t["product"],
                            "capacity_l": t["capacity_kl"] * 1000,
                            "diameter_mm": t["diameter_mm"],
                            "length_mm": t["length_mm"],
                            "morning_l": p.stock_l[today][t["product"]] * share,
                            "water_mm": t["water_mm"],
                        }
                        for prod in p.stock_l[today]
                        for t, share in _tank_shares(p, prod)
                    ],
                    "nozzles": [
                        {
                            "du_no": n["du_no"],
                            "nozzle_no": n["nozzle_no"],
                            "product": n["product"],
                            "weight": n["weight"],
                            "opening_l": float(n["totalizer_l"]),
                        }
                        for n in p.nozzles
                    ],
                }
            )
        path = self.root / "feed_state.json"
        path.write_text(
            json.dumps(
                {
                    "business_date": today.isoformat(),
                    "start_hour": start_hour,
                    "prices": prices,
                    "sites": sites,
                },
                indent=1,
            )
            + "\n"
        )
        return path


__all__ = ["SALES_AREA_CODE", "SAP", "WORLD_PATH", "generate"]
