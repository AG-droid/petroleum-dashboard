"""Live data from outlet automation: tank-gauge levels and nozzle totalisers.

Automated outlets have a forecourt controller that reads the automatic tank gauges (ATG) and the
dispensers. This module accepts batches of per-site snapshots, in a JSON shape modelled on what
such a controller (or the oil company's central automation server) could post. The demo feed in
:mod:`prahari.feed` produces exactly this payload.
"""

from __future__ import annotations

from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from prahari.models import Nozzle, Outlet, Tank, TankReading, TotalizerReading
from prahari.models.readings import SOURCE_AUTOMATION


class TankLevel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    tank_no: int = Field(ge=1)
    volume_l: float = Field(ge=0, description="Gross product volume reported by the tank gauge.")
    level_mm: float | None = Field(None, ge=0)
    water_mm: float | None = Field(None, ge=0)
    temp_c: float | None = Field(None, ge=-10, le=70)


class NozzleTotal(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    nozzle_no: int = Field(ge=1)
    totalizer_l: float = Field(ge=0)


class SiteSnapshot(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    # Only bounded here: an ID that isn't a known RO code is reported for that site alone (see
    # store_batch), so one bad site never drops the other sites' readings in the batch.
    site_id: str = Field(min_length=1, max_length=16, description="The outlet's 6-digit RO code.")
    observed_at: AwareDatetime
    tanks: list[TankLevel] = Field(default_factory=list, max_length=20)
    nozzles: list[NozzleTotal] = Field(default_factory=list, max_length=64)


class AutomationBatch(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    snapshots: list[SiteSnapshot] = Field(max_length=2000)


class BatchResult(BaseModel):
    sites_accepted: int
    tank_readings: int
    totalizer_readings: int
    rejected: list[str]


def store_batch(session: Session, batch: AutomationBatch) -> BatchResult:
    """Validate references and store readings. Unknown sites/tanks/nozzles are reported, not fatal."""
    outlets = {code: oid for code, oid in session.execute(select(Outlet.code, Outlet.id))}
    tanks = {(t.outlet_id, t.tank_no): (t.id, t.capacity_kl * 1000) for t in session.scalars(select(Tank))}
    nozzles = {(n.outlet_id, n.nozzle_no): n.id for n in session.scalars(select(Nozzle))}
    tank_rows: list[dict[str, Any]] = []
    tot_rows: list[dict[str, Any]] = []
    rejected: list[str] = []
    sites = 0
    for snap in batch.snapshots:
        oid = outlets.get(snap.site_id)
        if oid is None:
            rejected.append(f"{snap.site_id}: unknown site")
            continue
        sites += 1
        for t in snap.tanks:
            known = tanks.get((oid, t.tank_no))
            if known is None:
                rejected.append(f"{snap.site_id}: unknown tank {t.tank_no}")
                continue
            tid, capacity_l = known
            if t.volume_l > capacity_l * 1.02:  # gauges can over-read slightly; more is a fault
                rejected.append(
                    f"{snap.site_id}: tank {t.tank_no} volume {t.volume_l:.0f} L exceeds capacity"
                )
                continue
            tank_rows.append(
                {
                    "tank_id": tid,
                    "observed_at": snap.observed_at,
                    "source": SOURCE_AUTOMATION,
                    "volume_l": t.volume_l,
                    "dip_mm": t.level_mm,
                    "water_mm": t.water_mm,
                    "temp_c": t.temp_c,
                }
            )
        for n in snap.nozzles:
            nid = nozzles.get((oid, n.nozzle_no))
            if nid is None:
                rejected.append(f"{snap.site_id}: unknown nozzle {n.nozzle_no}")
                continue
            tot_rows.append(
                {
                    "nozzle_id": nid,
                    "observed_at": snap.observed_at,
                    "totalizer_l": n.totalizer_l,
                    "source": SOURCE_AUTOMATION,
                }
            )
    # Re-sending the same snapshot is harmless (same primary key → ignored). Chunked to stay well
    # under PostgreSQL's 65,535 bind-parameter limit.
    for model, rows in ((TankReading, tank_rows), (TotalizerReading, tot_rows)):
        for i in range(0, len(rows), 2000):
            session.execute(insert(model).values(rows[i : i + 2000]).on_conflict_do_nothing())
    return BatchResult(
        sites_accepted=sites,
        tank_readings=len(tank_rows),
        totalizer_readings=len(tot_rows),
        rejected=rejected[:100],
    )
