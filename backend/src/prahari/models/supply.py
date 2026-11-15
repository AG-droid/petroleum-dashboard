"""Supply: indents (orders placed with the oil company) and receipts of tank-truck deliveries."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from prahari.db.base import Base, TimestampMixin

# Indent lifecycle. "On hold" usually means the dealer's payment or credit has not cleared.
INDENT_PENDING = "Pending"
INDENT_ON_HOLD = "On hold"
INDENT_REQUESTED = "Requested"  # raised from Prahari, awaiting the supply team
INDENT_DISPATCHED = "Dispatched"
INDENT_DELIVERED = "Delivered"
INDENT_CANCELLED = "Cancelled"
# Statuses that mean "fuel is on its way or will be scheduled".
INDENT_COVERING = frozenset({INDENT_PENDING, INDENT_REQUESTED, INDENT_DISPATCHED})


class Indent(Base, TimestampMixin):
    __tablename__ = "indent"
    # At most one open Prahari request per outlet and product, enforced by the database (no double
    # clicks). Indents imported from the oil company's system are not constrained.
    __table_args__ = (
        Index(
            "uq_indent_one_open_request",
            "outlet_id",
            "product_code",
            unique=True,
            postgresql_where=text("status = 'Requested' AND source = 'prahari'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    indent_no: Mapped[str] = mapped_column(String(24), unique=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    product_code: Mapped[str] = mapped_column(ForeignKey("product.code"))
    qty_kl: Mapped[float] = mapped_column(Float)
    indent_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), index=True)
    hold_reason: Mapped[str | None] = mapped_column(String(120))
    tt_no: Mapped[str | None] = mapped_column(String(20), doc="Tank-truck registration number.")
    invoice_no: Mapped[str | None] = mapped_column(String(24))
    is_priority: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(16), default="import")


class Receipt(Base, TimestampMixin):
    """Product received into one tank from one tank-truck compartment, with its density check.

    At decantation the dealer compares the observed density (corrected to 15 °C) with the invoice;
    a large gap suggests adulteration or a mix-up, and the tank should be held for testing.
    """

    __tablename__ = "receipt"
    __table_args__ = (UniqueConstraint("invoice_no", "tank_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    outlet_id: Mapped[int] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    invoice_no: Mapped[str] = mapped_column(String(24))
    invoice_date: Mapped[date] = mapped_column(Date)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    tt_no: Mapped[str] = mapped_column(String(20))
    product_code: Mapped[str] = mapped_column(ForeignKey("product.code"))
    tank_no: Mapped[int] = mapped_column()
    invoice_qty_kl: Mapped[float] = mapped_column(Float)
    invoice_density_15: Mapped[float] = mapped_column(Float)
    observed_density_15: Mapped[float] = mapped_column(Float)
    dip_before_mm: Mapped[float | None] = mapped_column(Float)
    dip_after_mm: Mapped[float | None] = mapped_column(Float)
    shortage_l: Mapped[float] = mapped_column(Float, default=0.0)
    quality_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    quality_hold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def density_diff(self) -> float:
        return self.observed_density_15 - self.invoice_density_15
