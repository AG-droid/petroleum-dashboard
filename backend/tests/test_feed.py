"""The demo automation feed (pure; no database)."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from prahari.domain.time import business_day_start
from prahari.feed import StaleStateError, build_batch

IST = ZoneInfo("Asia/Kolkata")


def _state(samples_dir: Path) -> dict[str, Any]:
    return json.loads((samples_dir / "feed_state.json").read_text())


def test_batch_follows_the_day(samples_dir: Path) -> None:
    state = _state(samples_dir)
    start = business_day_start(date.fromisoformat(state["business_date"]), IST, state["start_hour"])
    morning = build_batch(state, start + timedelta(minutes=1), IST)["snapshots"]
    evening = build_batch(state, start + timedelta(hours=14), IST)["snapshots"]
    site_m, site_e = morning[0], evening[0]
    assert sum(t["volume_l"] for t in site_e["tanks"]) < sum(t["volume_l"] for t in site_m["tanks"])
    assert sum(n["totalizer_l"] for n in site_e["nozzles"]) > sum(n["totalizer_l"] for n in site_m["nozzles"])
    assert all(t["volume_l"] >= 0 for s in evening for t in s["tanks"])


def test_offline_and_manual_sites_are_not_fed(samples_dir: Path) -> None:
    state = _state(samples_dir)
    at = business_day_start(date.fromisoformat(state["business_date"]), IST, state["start_hour"]) + timedelta(
        hours=3
    )
    fed = {s["site_id"] for s in build_batch(state, at, IST)["snapshots"]}
    expected = {s["ro_code"] for s in state["sites"] if s["automated"] and s["online"]}
    assert fed == expected and len(fed) < len(state["sites"])


def test_stale_state_is_refused(samples_dir: Path) -> None:
    state = _state(samples_dir)
    tomorrow = business_day_start(
        date.fromisoformat(state["business_date"]), IST, state["start_hour"]
    ) + timedelta(days=1)
    with pytest.raises(StaleStateError, match="make demo-data"):
        build_batch(state, tomorrow, IST)
