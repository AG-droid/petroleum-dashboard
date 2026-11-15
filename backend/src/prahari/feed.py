"""Demo automation feed: plays the role of outlet controllers posting tank-gauge and pump readings.

It starts from ``feed_state.json`` (written by the sample generator: this morning's stock and
yesterday's closing totalisers) and, every interval, posts what automated outlets would report
now, following the typical hourly demand curve. It talks to the backend only over HTTP, exactly as
a real integration would. Outlets marked offline in the sample world are skipped, so the
backend's "automation offline" rule has something to find.
"""

from __future__ import annotations

import json
import logging
import random
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from prahari.domain.calibration import dip_from_volume
from prahari.domain.demand import sales_fraction_since
from prahari.domain.time import business_date

log = logging.getLogger(__name__)


class StaleStateError(RuntimeError):
    """The feed state belongs to an earlier business day; regenerate the sample data."""


def build_batch(state: dict[str, Any], at: datetime, tz: ZoneInfo) -> dict[str, Any]:
    """The automation payload for every online automated site at instant ``at`` (pure function)."""
    start_hour = int(state["start_hour"])
    if business_date(at, tz, start_hour) != date.fromisoformat(state["business_date"]):
        raise StaleStateError(
            f"feed state is for business date {state['business_date']}; "
            "run `make demo-data` (or `prahari seed-demo`) to start a new day"
        )
    frac = sales_fraction_since(start_hour, at.astimezone(tz))
    snapshots = []
    for site in state["sites"]:
        if not (site["automated"] and site["online"]):
            continue
        rng = random.Random(site["ro_code"])  # per-site constant jitter: busier or quieter than average
        sold = {p: litres * frac * rng.uniform(0.92, 1.08) for p, litres in site["daily_l"].items()}
        tanks = []
        for t in site["tanks"]:
            same = [x for x in site["tanks"] if x["product"] == t["product"]]
            share = t["capacity_l"] / sum(x["capacity_l"] for x in same)
            vol = max(0.0, t["morning_l"] - sold.get(t["product"], 0.0) * share)
            tanks.append(
                {
                    "tank_no": t["tank_no"],
                    "volume_l": round(vol, 1),
                    "water_mm": t["water_mm"],
                    "level_mm": round(
                        dip_from_volume(min(vol, t["capacity_l"]), t["diameter_mm"], t["length_mm"]), 1
                    ),
                    "temp_c": round(26 + 4 * frac, 1),
                }
            )
        nozzles = []
        for n in site["nozzles"]:
            same = [x for x in site["nozzles"] if x["product"] == n["product"]]
            share = n["weight"] / sum(x["weight"] for x in same)
            nozzles.append(
                {
                    "nozzle_no": n["nozzle_no"],
                    "totalizer_l": round(n["opening_l"] + sold.get(n["product"], 0.0) * share, 2),
                }
            )
        snapshots.append(
            {"site_id": site["ro_code"], "observed_at": at.isoformat(), "tanks": tanks, "nozzles": nozzles}
        )
    return {"snapshots": snapshots}


def run(api_url: str, state_path: Path, *, tz: ZoneInfo, interval: float = 60.0, once: bool = False) -> None:
    """Post a batch every ``interval`` seconds until interrupted (or once).

    The state file is re-read whenever it changes, so regenerating the sample data for a new day
    (``make demo-data``) is picked up without restarting the feed. While the state is stale the
    feed waits instead of posting yesterday's numbers.
    """
    url = api_url.rstrip("/") + "/api/v1/ingest/automation"
    state: dict[str, Any] = {}
    mtime = -1.0
    backoff = 2.0
    with httpx.Client(timeout=30, headers={"X-Prahari-User": "automation-feed"}) as client:
        while True:
            if state_path.stat().st_mtime != mtime:
                mtime = state_path.stat().st_mtime
                state = json.loads(state_path.read_text())
                log.info("loaded feed state for business date %s", state["business_date"])
            try:
                batch = build_batch(state, datetime.now(UTC), tz)
            except StaleStateError as exc:
                if once:
                    raise
                log.warning("%s; waiting", exc)
                time.sleep(max(interval, 60))
                continue
            try:
                resp = client.post(url, json=batch)
                resp.raise_for_status()
                log.info("posted automation batch", extra=resp.json() | {"sites": len(batch["snapshots"])})
                backoff = 2.0
            except httpx.HTTPError as exc:
                log.warning("automation post failed, retrying in %.0fs: %s", backoff, exc)
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)
                continue
            if once:
                return
            time.sleep(interval)
