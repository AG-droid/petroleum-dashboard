"""Time-series readings. Both tables become TimescaleDB hypertables (see the initial migration).

Every reading records its ``source`` so the dashboard can say honestly where a number came from
(a manual dip at 06:00 vs. a tank gauge two minutes ago).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from prahari.db.base import Base

SOURCE_DIP_REGISTER = "dip_register"
SOURCE_AUTOMATION = "automation"


class TankReading(Base):
    """Stock in one tank at one moment, from a manual dip or the automatic tank gauge (ATG)."""

    __tablename__ = "tank_reading"

    # Hypertables need the time column in every unique constraint, hence the composite key.
    tank_id: Mapped[int] = mapped_column(ForeignKey("tank.id", ondelete="CASCADE"), primary_key=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    source: Mapped[str] = mapped_column(String(16), primary_key=True)
    volume_l: Mapped[float] = mapped_column(Float, doc="Product volume (litres), from gauge or calibration.")
    dip_mm: Mapped[float | None] = mapped_column(Float)
    water_mm: Mapped[float | None] = mapped_column(Float)
    temp_c: Mapped[float | None] = mapped_column(Float)
    density_obs: Mapped[float | None] = mapped_column(Float, doc="Observed density, kg/m³.")
    density_15: Mapped[float | None] = mapped_column(Float, doc="Density corrected to 15 °C, kg/m³.")


class TotalizerReading(Base):
    """Cumulative litres dispensed by a nozzle (the pump's 'meter'), as reported by automation."""

    __tablename__ = "totalizer_reading"

    nozzle_id: Mapped[int] = mapped_column(ForeignKey("nozzle.id", ondelete="CASCADE"), primary_key=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    totalizer_l: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_AUTOMATION)
