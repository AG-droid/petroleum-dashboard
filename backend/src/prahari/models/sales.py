"""Daily sales report (DSR): opening and closing totaliser per nozzle per business day."""

from __future__ import annotations

from datetime import date

from sqlalchemy import CheckConstraint, Date, Float, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from prahari.db.base import Base


class NozzleDailySales(Base):
    """One DSR line: ``net_sale_l = closing_l - opening_l - testing_l``.

    The daily test fuel goes back into the tank, so it is not a sale.
    """

    __tablename__ = "nozzle_daily_sales"
    __table_args__ = (
        CheckConstraint("closing_l >= opening_l", name="closing_not_below_opening"),
        CheckConstraint("testing_l >= 0", name="testing_non_negative"),
    )

    nozzle_id: Mapped[int] = mapped_column(ForeignKey("nozzle.id", ondelete="CASCADE"), primary_key=True)
    business_date: Mapped[date] = mapped_column(Date, primary_key=True, index=True)
    opening_l: Mapped[float] = mapped_column(Float)
    closing_l: Mapped[float] = mapped_column(Float)
    testing_l: Mapped[float] = mapped_column(Float, default=0.0)
    net_sale_l: Mapped[float] = mapped_column(Float)
    rsp: Mapped[float | None] = mapped_column(
        Numeric(8, 2, asdecimal=False), doc="Retail selling price that day, ₹/L."
    )
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2, asdecimal=False))
