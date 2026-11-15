"""One importer per file kind: validate each row, then upsert the accepted ones.

Imports are **idempotent**: every record has a natural key (RO code + tank number, invoice +
tank, nozzle + business date, ...) and re-importing a file updates rows instead of duplicating
them. Rows that fail validation are reported with their row number and reason; the rest load.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from prahari.domain.calibration import volume_from_dip
from prahari.ingest import parse
from prahari.ingest.formats import RO, FileKind
from prahari.ingest.reader import Table
from prahari.models import (
    Dealer,
    Depot,
    Indent,
    Licence,
    Nozzle,
    NozzleDailySales,
    Outlet,
    Product,
    Receipt,
    SalesArea,
    Tank,
    TankReading,
)
from prahari.models.readings import SOURCE_DIP_REGISTER

NET_SALE_TOLERANCE_L = 1.0  # rounding slack when checking net = closing - opening - testing
LICENCE_TYPES = {"PESO", "LM_STAMPING", "FIRE_NOC", "PCB_CONSENT"}
INDENT_STATUSES = {"Pending", "On hold", "Requested", "Dispatched", "Delivered", "Cancelled"}


@dataclass
class RowError:
    row: int
    column: str | None
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {"row": self.row, "column": self.column, "message": self.message}


@dataclass
class ImportResult:
    total: int = 0
    accepted: int = 0
    errors: list[RowError] = field(default_factory=list)


class _CellError(ValueError):
    def __init__(self, column: str, message: str) -> None:
        super().__init__(message)
        self.column = column


def _get[T](values: dict[str, Any], column: str, conv: Callable[..., T], **kw: Any) -> T:
    """Convert one cell, tagging any error with its column name."""
    try:
        return conv(values.get(column), **kw)
    except ValueError as exc:
        raise _CellError(column, f"{column} {exc}") from None


class _Lookups:
    """Caches of natural key → database id, loaded once per import."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.outlets: dict[str, int] = dict(session.execute(select(Outlet.code, Outlet.id)).tuples().all())
        self.tanks = {(t.outlet_id, t.tank_no): t for t in session.scalars(select(Tank))}
        self.nozzles = {(n.outlet_id, n.nozzle_no): n for n in session.scalars(select(Nozzle))}
        self.products = set(session.scalars(select(Product.code)))

    def outlet(self, values: dict[str, Any]) -> int:
        ro = _get(values, RO, parse.ro_code)
        if ro not in self.outlets:
            raise _CellError(RO, f"{RO} {ro} is not in the outlet master (import RO_MASTER first)")
        return self.outlets[ro]

    def product(self, values: dict[str, Any], column: str = "PRODUCT") -> str:
        p = _get(values, column, parse.product)
        if p not in self.products:
            raise _CellError(column, f"{column} {p} is not set up (import SALES_AREA first)")
        return p

    def tank(self, outlet_id: int, values: dict[str, Any], product: str | None = None) -> Tank:
        no = _get(values, "TANK_NO", parse.integer, min_value=1)
        tank = self.tanks.get((outlet_id, no))
        if tank is None:
            raise _CellError("TANK_NO", f"TANK_NO {no} is not in the tank master for this outlet")
        if product and tank.product_code != product:
            raise _CellError("PRODUCT", f"PRODUCT {product} does not match tank {no} ({tank.product_code})")
        return tank

    def nozzle(self, outlet_id: int, values: dict[str, Any]) -> Nozzle:
        no = _get(values, "NOZZLE_NO", parse.integer, min_value=1)
        nozzle = self.nozzles.get((outlet_id, no))
        if nozzle is None:
            raise _CellError("NOZZLE_NO", f"NOZZLE_NO {no} is not in the nozzle master for this outlet")
        return nozzle


def _run(
    table: Table,
    build: Callable[[dict[str, Any]], dict[str, Any]],
    write: Callable[[list[dict[str, Any]]], None],
    key: list[str],
    *also_unique: list[str],
) -> ImportResult:
    """Validate every row with ``build``; pass the accepted records to ``write`` in one batch.

    ``key`` names the record fields that form the natural key. A key repeated within one file
    (e.g. a dip entered twice) is rejected as a duplicate of the earlier row: a single upsert
    statement can't touch the same row twice, and the first entry is the one on the register.
    ``also_unique`` are other unique columns checked the same way.
    """
    result = ImportResult(total=len(table.rows))
    records: list[dict[str, Any]] = []
    first_row: dict[tuple[Any, ...], int] = {}  # (key-set index, values) → first row number
    for row_no, values in table.rows:
        try:
            record = build(values)
        except _CellError as exc:
            result.errors.append(RowError(row_no, exc.column, str(exc)))
            continue
        except ValueError as exc:
            result.errors.append(RowError(row_no, None, str(exc)))
            continue
        # Blank values (e.g. an optional SAP code) never clash, as in a SQL unique column.
        ks = [
            k
            for n, fields in enumerate((key, *also_unique))
            if None not in (k := (n, *(record[f] for f in fields)))[1:]
        ]
        clash = next((first_row[k] for k in ks if k in first_row), None)
        if clash is not None:
            result.errors.append(RowError(row_no, None, f"duplicate of row {clash}"))
            continue
        for k in ks:
            first_row[k] = row_no
        records.append(record)
    if records:
        write(records)
    result.accepted = len(records)
    return result


def _upsert(session: Session, model: Any, records: list[dict[str, Any]], keys: list[str]) -> None:
    """INSERT ... ON CONFLICT (keys) DO UPDATE, in chunks."""
    for i in range(0, len(records), 1000):
        chunk = records[i : i + 1000]
        stmt = insert(model).values(chunk)
        update_cols = {c: stmt.excluded[c] for c in chunk[0] if c not in keys}
        stmt = (
            stmt.on_conflict_do_update(index_elements=keys, set_=update_cols)
            if update_cols
            else (stmt.on_conflict_do_nothing(index_elements=keys))
        )
        session.execute(stmt)


# --------------------------------------------------------------------------------------------
# Sales area (JSON): area, depots and products
# --------------------------------------------------------------------------------------------
class _ProductIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    code: str = Field(min_length=1, max_length=8)
    name: str = Field(min_length=1, max_length=60)
    unit: Literal["L", "kg"] = "L"
    price_per_l: float = Field(gt=0, lt=1000)  # ₹ per unit
    # Density bounds (kg/m³ at 15 °C) are required for liquids, where receipts are density-checked.
    density_min: float | None = Field(None, gt=600, lt=1000)
    density_max: float | None = Field(None, gt=600, lt=1000)

    @model_validator(mode="after")
    def _density(self) -> _ProductIn:
        if self.unit == "L" and (self.density_min is None or self.density_max is None):
            raise ValueError(f"{self.code}: liquid products need density_min and density_max")
        if (
            self.density_min is not None
            and self.density_max is not None
            and self.density_min > self.density_max
        ):
            raise ValueError(f"{self.code}: density_min is above density_max")
        return self


class _DepotIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=6, le=37)
    lng: float = Field(ge=68, le=98)
    capacity_kl: float | None = Field(None, ge=0)


class _SalesAreaIn(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=120)
    # "division" is the field's older name, still accepted.
    divisional_office: str | None = Field(
        None, max_length=120, validation_alias=AliasChoices("divisional_office", "division")
    )
    state_office: str | None = Field(None, max_length=120)
    boundary: list[list[float]] | None = None
    products: list[_ProductIn] = Field(default_factory=list)
    depots: list[_DepotIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_codes(self) -> _SalesAreaIn:
        for name, items in (("products", self.products), ("depots", self.depots)):
            codes = [i.code for i in items]
            dupes = sorted({c for c in codes if codes.count(c) > 1})
            if dupes:
                raise ValueError(f"{name}: duplicate code(s) {', '.join(dupes)}")
        return self


def import_sales_area(session: Session, path: Path) -> ImportResult:
    """Sales area profile (JSON): the area, its depots and products. Validated as a whole."""
    try:
        doc = _SalesAreaIn.model_validate_json(path.read_bytes())
    except ValidationError as exc:
        errors = [RowError(0, ".".join(map(str, e["loc"])) or None, e["msg"]) for e in exc.errors()[:50]]
        return ImportResult(total=1, errors=errors)
    _upsert(
        session,
        SalesArea,
        [doc.model_dump(include={"code", "name", "divisional_office", "state_office", "boundary"})],
        ["code"],
    )
    if doc.products:
        _upsert(session, Product, [p.model_dump() for p in doc.products], ["code"])
    if doc.depots:
        _upsert(session, Depot, [d.model_dump() for d in doc.depots], ["code"])
    n = 1 + len(doc.products) + len(doc.depots)
    return ImportResult(total=n, accepted=n)


# --------------------------------------------------------------------------------------------
# Masters
# --------------------------------------------------------------------------------------------
def import_ro_master(session: Session, table: Table) -> ImportResult:
    areas = list(session.scalars(select(SalesArea)))
    if not areas:
        return ImportResult(total=len(table.rows), errors=[RowError(0, None, "import SALES_AREA.json first")])
    existing = {o.code: o for o in session.scalars(select(Outlet))}
    # The SAP code is unique too: a code already held by another outlet is a row error, not a
    # database error that would reject the whole file.
    sap_owner = {o.sap_code: o.code for o in existing.values() if o.sap_code}

    def area_id(values: dict[str, Any]) -> int:
        name = _get(values, "SALES_AREA", parse.text).lower()
        for a in areas:
            if a.code.lower() == name or a.name.lower().startswith(name):
                return a.id
        raise _CellError("SALES_AREA", f"SALES_AREA {name!r} is not a known sales area")

    def build(v: dict[str, Any]) -> dict[str, Any]:
        ownership = _get(v, "RO_TYPE", parse.text).upper()
        if ownership not in {"DODO", "CODO", "COCO"}:
            raise _CellError("RO_TYPE", f"RO_TYPE {ownership!r} must be DODO, CODO or COCO")
        code = _get(v, RO, parse.ro_code)
        sap = _get(v, "SAP_CUST_CODE", parse.optional_code, max_len=16)
        if sap and sap_owner.get(sap, code) != code:
            raise _CellError("SAP_CUST_CODE", f"SAP_CUST_CODE {sap} already belongs to RO {sap_owner[sap]}")
        return {
            "code": code,
            "sap_code": sap,
            "name": _get(v, "RO_NAME", parse.text, max_len=120),
            "sales_area_id": area_id(v),
            "market_class": _get(v, "CLASS_OF_MARKET", parse.market_class),
            "ownership": ownership,
            "is_ksk": _get(v, "KSK", parse.yes_no),
            "locality": _get(v, "LOCATION", parse.optional_text),
            "road": _get(v, "HIGHWAY_ROAD", parse.optional_text),
            "address": _get(v, "ADDRESS", parse.optional_text),
            "lat": _get(v, "LATITUDE", parse.number, min_value=6, max_value=37),  # India's bounding box
            "lng": _get(v, "LONGITUDE", parse.number, min_value=68, max_value=98),
            "is_automated": _get(v, "AUTOMATED", parse.yes_no),
            "monthly_target_kl": _get(v, "MONTHLY_TARGET_KL", parse.number, min_value=0),
            "_dealer": {
                "name": _get(v, "DEALER_NAME", parse.text, max_len=120),
                "mobile": _get(v, "DEALER_MOBILE", parse.optional_text, max_len=20),
                "since_year": _get(v, "DEALER_SINCE", parse.integer, min_value=1950),
            },
        }

    def write(records: list[dict[str, Any]]) -> None:
        for r in records:
            dealer_data = r.pop("_dealer")
            outlet = existing.get(r["code"])
            if outlet is None:
                outlet = Outlet(**r)
                session.add(outlet)
            else:
                for k, val in r.items():
                    setattr(outlet, k, val)
            if outlet.dealer is None:
                outlet.dealer = Dealer(**dealer_data)
            else:
                for k, val in dealer_data.items():
                    setattr(outlet.dealer, k, val)
        session.flush()

    return _run(table, build, write, ["code"], ["sap_code"])  # both are unique columns


def import_tank_master(session: Session, table: Table) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        return {
            "outlet_id": lk.outlet(v),
            "tank_no": _get(v, "TANK_NO", parse.integer, min_value=1),
            "product_code": lk.product(v),
            "capacity_kl": _get(v, "CAPACITY_KL", parse.number, min_value=1, max_value=100),
            "diameter_mm": _get(v, "DIAMETER_MM", parse.number, min_value=500, max_value=5000),
            "length_mm": _get(v, "LENGTH_MM", parse.number, min_value=500, max_value=20000),
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, Tank, rs, ["outlet_id", "tank_no"]),
        ["outlet_id", "tank_no"],
    )


def import_nozzle_master(session: Session, table: Table) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        outlet_id = lk.outlet(v)
        product = lk.product(v)
        tank = lk.tank(outlet_id, v, product)
        return {
            "outlet_id": outlet_id,
            "du_no": _get(v, "DU_NO", parse.integer, min_value=1),
            "nozzle_no": _get(v, "NOZZLE_NO", parse.integer, min_value=1),
            "product_code": product,
            "tank_no": tank.tank_no,
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, Nozzle, rs, ["outlet_id", "nozzle_no"]),
        ["outlet_id", "nozzle_no"],
    )


def import_licences(session: Session, table: Table) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        ltype = _get(v, "LICENCE_TYPE", parse.text).upper()
        if ltype not in LICENCE_TYPES:
            raise _CellError("LICENCE_TYPE", f"LICENCE_TYPE {ltype!r} must be one of {sorted(LICENCE_TYPES)}")
        issued = _get(v, "ISSUED_ON", parse.day)
        valid = _get(v, "VALID_UPTO", parse.day)
        if valid < issued:
            raise _CellError("VALID_UPTO", "VALID_UPTO is before ISSUED_ON")
        return {
            "outlet_id": lk.outlet(v),
            "licence_type": ltype,
            "licence_no": _get(v, "LICENCE_NO", parse.text, max_len=60),
            "issued_on": issued,
            "valid_upto": valid,
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, Licence, rs, ["outlet_id", "licence_type"]),
        ["outlet_id", "licence_type"],
    )


# --------------------------------------------------------------------------------------------
# Supply
# --------------------------------------------------------------------------------------------
def import_receipts(session: Session, table: Table, tz: ZoneInfo) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        outlet_id = lk.outlet(v)
        product = lk.product(v)
        tank = lk.tank(outlet_id, v, product)
        received = datetime.combine(
            _get(v, "RECEIPT_DATE", parse.day), _get(v, "RECEIPT_TIME", parse.clock), tzinfo=tz
        )
        return {
            "outlet_id": outlet_id,
            "invoice_no": _get(v, "INVOICE_NO", parse.code),
            "invoice_date": _get(v, "INVOICE_DATE", parse.day),
            "received_at": received,
            "tt_no": _get(v, "TT_NO", parse.text, max_len=20),
            "product_code": product,
            "tank_no": tank.tank_no,
            "invoice_qty_kl": _get(v, "INVOICE_QTY_KL", parse.number, min_value=0.1, max_value=60),
            "invoice_density_15": _get(v, "INVOICE_DENSITY_15C", parse.number, min_value=650, max_value=900),
            "observed_density_15": _get(v, "OBS_DENSITY_15C", parse.number, min_value=650, max_value=900),
            "dip_before_mm": _get(v, "DIP_BEFORE_MM", parse.number, min_value=0, max_value=tank.diameter_mm),
            "dip_after_mm": _get(v, "DIP_AFTER_MM", parse.number, min_value=0, max_value=tank.diameter_mm),
            "shortage_l": _get(v, "SHORTAGE_LTRS", parse.number, min_value=0),
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, Receipt, rs, ["invoice_no", "tank_no"]),
        ["invoice_no", "tank_no"],
    )


def import_indents(session: Session, table: Table) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        status = _get(v, "STATUS", parse.text).capitalize()
        if status not in INDENT_STATUSES:
            raise _CellError("STATUS", f"STATUS {status!r} must be one of {sorted(INDENT_STATUSES)}")
        return {
            "indent_no": _get(v, "INDENT_NO", parse.code),
            "indent_date": _get(v, "INDENT_DATE", parse.day),
            "outlet_id": lk.outlet(v),
            "product_code": lk.product(v),
            "qty_kl": _get(v, "QTY_KL", parse.number, min_value=1, max_value=60),
            "status": status,
            "hold_reason": _get(v, "HOLD_REASON", parse.optional_text, max_len=120),
            "tt_no": _get(v, "TT_NO", parse.optional_text, max_len=20),
            "invoice_no": _get(v, "INVOICE_NO", parse.optional_text, max_len=24),
            "source": "import",
        }

    return _run(table, build, lambda rs: _upsert(session, Indent, rs, ["indent_no"]), ["indent_no"])


# --------------------------------------------------------------------------------------------
# Sales and stock
# --------------------------------------------------------------------------------------------
def import_dsr(session: Session, table: Table) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        outlet_id = lk.outlet(v)
        nozzle = lk.nozzle(outlet_id, v)
        product = lk.product(v)
        if product != nozzle.product_code:
            raise _CellError(
                "PRODUCT",
                f"PRODUCT {product} does not match nozzle {nozzle.nozzle_no} ({nozzle.product_code})",
            )
        opening = _get(v, "OPENING_TOTALIZER", parse.number, min_value=0)
        closing = _get(v, "CLOSING_TOTALIZER", parse.number, min_value=0)
        testing = _get(v, "TESTING_LTRS", parse.number, min_value=0, max_value=50)
        net = _get(v, "NET_SALE_LTRS", parse.number, min_value=0)
        if closing < opening:
            raise _CellError(
                "CLOSING_TOTALIZER", "CLOSING_TOTALIZER is below OPENING_TOTALIZER (meter reset?)"
            )
        if abs((closing - opening - testing) - net) > NET_SALE_TOLERANCE_L:
            raise _CellError(
                "NET_SALE_LTRS",
                f"NET_SALE_LTRS {net:g} ≠ closing − opening − testing ({closing - opening - testing:.2f})",
            )
        return {
            "nozzle_id": nozzle.id,
            "business_date": _get(v, "BUSINESS_DATE", parse.day),
            "opening_l": opening,
            "closing_l": closing,
            "testing_l": testing,
            "net_sale_l": net,
            "rsp": _get(v, "RSP", parse.number, min_value=0),
            "amount": _get(v, "AMOUNT", parse.number, min_value=0),
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, NozzleDailySales, rs, ["nozzle_id", "business_date"]),
        ["nozzle_id", "business_date"],
    )


def import_dips(session: Session, table: Table, tz: ZoneInfo) -> ImportResult:
    lk = _Lookups(session)

    def build(v: dict[str, Any]) -> dict[str, Any]:
        outlet_id = lk.outlet(v)
        tank = lk.tank(outlet_id, v, lk.product(v))
        # The dip rod measures the total liquid height; water at the bottom is not saleable product.
        dip = _get(v, "DIP_MM", parse.number, min_value=0, max_value=tank.diameter_mm)
        water = _get(v, "WATER_MM", parse.number, min_value=0, max_value=dip)
        product_l = volume_from_dip(dip, tank.diameter_mm, tank.length_mm) - volume_from_dip(
            water, tank.diameter_mm, tank.length_mm
        )
        return {
            "tank_id": tank.id,
            "observed_at": datetime.combine(
                _get(v, "DATE", parse.day), _get(v, "TIME", parse.clock), tzinfo=tz
            ),
            "source": SOURCE_DIP_REGISTER,
            "dip_mm": dip,
            "volume_l": round(product_l, 1),
            "water_mm": water,
            "temp_c": _get(v, "TEMP_C", parse.number, min_value=-5, max_value=60),
            "density_obs": _get(v, "OBS_DENSITY", parse.number, min_value=650, max_value=900),
            "density_15": _get(v, "DENSITY_15C", parse.number, min_value=650, max_value=900),
        }

    return _run(
        table,
        build,
        lambda rs: _upsert(session, TankReading, rs, ["tank_id", "observed_at", "source"]),
        ["tank_id", "observed_at", "source"],
    )


# Order matters: masters before the records that reference them.
IMPORT_ORDER: tuple[FileKind, ...] = (
    FileKind.SALES_AREA,
    FileKind.RO_MASTER,
    FileKind.TANK_MASTER,
    FileKind.NOZZLE_MASTER,
    FileKind.LICENCE_REGISTER,
    FileKind.TT_RECEIPTS,
    FileKind.INDENT_STATUS,
    FileKind.DSR,
    FileKind.DIP_REGISTER,
)
