"""Response and request models. These define the public API contract (see ``/api/docs``)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from prahari.domain.products import normalise_product


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Health(BaseModel):
    status: str
    database: str
    version: str
    outlets: int
    last_rules_run: datetime | None


class TankOut(BaseModel):
    tank_no: int
    product: str
    capacity_l: float
    volume_l: float | None = Field(description="Latest reading as recorded.")
    estimated_l: float | None = Field(description="Volume now; projected from a dip if not read live.")
    as_of: datetime | None
    source: str | None
    water_mm: float | None
    temp_c: float | None
    projected: bool = Field(description="True when estimated_l is projected (manual dip or quiet gauge).")


class ProductOut(BaseModel):
    product: str
    stock_l: float | None
    capacity_l: float
    avg_daily_l: float | None
    days_cover: float | None
    estimated: bool


class IndentOut(_Out):
    id: int
    indent_no: str
    product_code: str
    qty_kl: float
    indent_date: date
    status: str
    hold_reason: str | None
    tt_no: str | None
    is_priority: bool


class ReceiptOut(_Out):
    id: int
    invoice_no: str
    received_at: datetime
    tt_no: str
    product_code: str
    tank_no: int
    invoice_qty_kl: float
    invoice_density_15: float
    observed_density_15: float
    density_diff: float
    shortage_l: float
    quality_hold: bool


class LicenceOut(BaseModel):
    licence_type: str
    licence_no: str
    valid_upto: date
    days_left: int


class OutletSummary(BaseModel):
    code: str
    sap_code: str
    name: str
    category: str
    lat: float
    lng: float
    is_automated: bool
    automation_online: bool | None
    min_days_cover: float | None
    min_cover_product: str | None
    variation_pct: float | None
    open_alerts: int


class OutletDetail(OutletSummary):
    ownership: str
    locality: str | None
    road: str | None
    address: str | None
    dealer_name: str | None
    monthly_target_kl: float | None
    business_date: date
    last_automation_at: datetime | None
    tanks: list[TankOut]
    products: dict[str, ProductOut]
    today_l: dict[str, float] | None
    today_as_of: datetime | None
    mtd_kl: float
    history: list[dict[str, Any]]
    indents: list[IndentOut]
    receipts: list[ReceiptOut]
    licences: list[LicenceOut]


class AlertOut(_Out):
    id: int
    key: str
    rule: str
    severity: str
    category: str
    outlet_code: str | None = None
    title: str
    detail: str
    status: str
    data: dict[str, Any] | None
    opened_at: datetime
    updated_at: datetime
    acknowledged_at: datetime | None
    resolved_at: datetime | None


class ImportJobOut(_Out):
    id: int
    kind: str
    filename: str
    status: str
    submitted_by: str
    started_at: datetime
    finished_at: datetime | None
    rows_total: int
    rows_accepted: int
    rows_rejected: int
    errors: list[dict[str, Any]] | None


class AreaOut(BaseModel):
    code: str
    name: str
    division: str | None
    boundary: list[list[float]] | None
    depots: list[dict[str, Any]]
    business_date: date
    generated_at: datetime


class Snapshot(BaseModel):
    """Everything the dashboard needs in one call."""

    area: AreaOut
    outlets: list[OutletDetail]
    alerts: list[AlertOut]


class LiveOutlet(BaseModel):
    code: str
    automation_online: bool | None
    tanks: list[TankOut]
    today_l: dict[str, float] | None
    today_as_of: datetime | None


class Live(BaseModel):
    """The fast-changing subset, for polling."""

    generated_at: datetime
    outlets: list[LiveOutlet]
    alerts: list[AlertOut]


class PriorityIndentIn(BaseModel):
    product: str | None = Field(
        None,
        description="MS, HSD, XP or a common name (petrol, diesel). Defaults to the least-covered product.",
    )
    qty_kl: float = Field(20, gt=0, le=40)
    note: str | None = Field(None, max_length=240)

    @field_validator("product")
    @classmethod
    def _known_product(cls, v: str | None) -> str | None:
        return normalise_product(v) if v is not None else None  # ValueError → 422
