"""The physical network: sales areas, depots, dealers, outlets, tanks, nozzles and licences."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from prahari.db.base import Base, TimestampMixin


class Product(Base):
    """A fuel grade. ``code`` is our canonical code (MS = petrol, HSD = diesel, XP = premium petrol)."""

    __tablename__ = "product"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    density_min: Mapped[float] = mapped_column(Float, doc="Typical density at 15 °C, kg/m³ (lower bound).")
    density_max: Mapped[float] = mapped_column(Float)
    price_per_l: Mapped[float] = mapped_column(
        Numeric(8, 2, asdecimal=False), doc="Retail selling price, ₹/litre (demo)."
    )


class SalesArea(Base, TimestampMixin):
    __tablename__ = "sales_area"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    division: Mapped[str | None] = mapped_column(String(120))
    state_office: Mapped[str | None] = mapped_column(String(120))
    # Polygon as [[lng, lat], ...]. Moves to PostGIS when spatial queries are needed.
    boundary: Mapped[list[list[float]] | None] = mapped_column(JSON)

    outlets: Mapped[list[Outlet]] = relationship(back_populates="sales_area")


class Depot(Base, TimestampMixin):
    """A supply terminal or depot that loads tank trucks."""

    __tablename__ = "depot"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    capacity_kl: Mapped[float | None] = mapped_column(Float)


class Dealer(Base, TimestampMixin):
    """The dealer who operates an outlet. Contact details are personal data (DPDP Act): restrict access."""

    __tablename__ = "dealer"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    mobile: Mapped[str | None] = mapped_column(String(20))
    since_year: Mapped[int | None] = mapped_column(Integer)

    outlets: Mapped[list[Outlet]] = relationship(back_populates="dealer")


class Outlet(Base, TimestampMixin):
    """A retail outlet (petrol pump).

    ``code`` is the short reference used in the dashboard (e.g. ``GGN-104``); ``sap_code`` is the
    oil company's customer code that appears in its exports. Imports match on ``sap_code``.
    """

    __tablename__ = "outlet"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    sap_code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    sales_area_id: Mapped[int] = mapped_column(ForeignKey("sales_area.id"))
    dealer_id: Mapped[int | None] = mapped_column(ForeignKey("dealer.id"))
    category: Mapped[str] = mapped_column(String(16), doc="Highway | Urban | Rural")
    ownership: Mapped[str] = mapped_column(String(8), doc="DODO | CODO | COCO")
    is_ksk: Mapped[bool] = mapped_column(Boolean, default=False, doc="Kisan Seva Kendra (rural format).")
    locality: Mapped[str | None] = mapped_column(String(120))
    road: Mapped[str | None] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(240))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    is_automated: Mapped[bool] = mapped_column(Boolean, default=False, doc="Has tank gauges + automation.")
    monthly_target_kl: Mapped[float | None] = mapped_column(Float)

    sales_area: Mapped[SalesArea] = relationship(back_populates="outlets")
    dealer: Mapped[Dealer | None] = relationship(back_populates="outlets")
    tanks: Mapped[list[Tank]] = relationship(back_populates="outlet", order_by="Tank.tank_no")
    nozzles: Mapped[list[Nozzle]] = relationship(back_populates="outlet", order_by="Nozzle.nozzle_no")
    licences: Mapped[list[Licence]] = relationship(back_populates="outlet")


class Tank(Base, TimestampMixin):
    """An underground storage tank. Diameter and length drive the dip-to-volume calibration."""

    __tablename__ = "tank"
    __table_args__ = (UniqueConstraint("outlet_id", "tank_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    tank_no: Mapped[int] = mapped_column(Integer)
    product_code: Mapped[str] = mapped_column(ForeignKey("product.code"))
    capacity_kl: Mapped[float] = mapped_column(Float)
    diameter_mm: Mapped[float] = mapped_column(Float)
    length_mm: Mapped[float] = mapped_column(Float)

    outlet: Mapped[Outlet] = relationship(back_populates="tanks")


class Nozzle(Base, TimestampMixin):
    """A dispensing nozzle on a dispensing unit (DU), drawing from one tank."""

    __tablename__ = "nozzle"
    __table_args__ = (UniqueConstraint("outlet_id", "nozzle_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    du_no: Mapped[int] = mapped_column(Integer)
    nozzle_no: Mapped[int] = mapped_column(Integer)
    product_code: Mapped[str] = mapped_column(ForeignKey("product.code"))
    tank_no: Mapped[int | None] = mapped_column(Integer)

    outlet: Mapped[Outlet] = relationship(back_populates="nozzles")


class Licence(Base, TimestampMixin):
    """A statutory licence or certificate with an expiry date (PESO, stamping, fire NOC, pollution)."""

    __tablename__ = "licence"
    __table_args__ = (UniqueConstraint("outlet_id", "licence_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    licence_type: Mapped[str] = mapped_column(String(24), doc="PESO | LM_STAMPING | FIRE_NOC | PCB_CONSENT")
    licence_no: Mapped[str] = mapped_column(String(60))
    issued_on: Mapped[date | None] = mapped_column(Date)
    valid_upto: Mapped[date] = mapped_column(Date)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    outlet: Mapped[Outlet] = relationship(back_populates="licences")
