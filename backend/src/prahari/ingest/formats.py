"""Column layouts of the source files Prahari accepts.

These layouts are *modelled on* the registers and MIS extracts commonly kept at Indian retail
outlets and sales-area offices (outlet master, daily sales report, dip register, tank-truck
receipts, indent status, licence register). They are **not** an official oil-company
specification: when real exports are available, adapt the column names here and the importers
keep working.

Both the dummy-data generator (:mod:`prahari.samples.generator`) and the importers
(:mod:`prahari.ingest.importers`) use these definitions, so they cannot drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class FileKind(StrEnum):
    SALES_AREA = "sales_area"
    RO_MASTER = "ro_master"
    TANK_MASTER = "tank_master"
    NOZZLE_MASTER = "nozzle_master"
    LICENCE_REGISTER = "licence_register"
    TT_RECEIPTS = "tt_receipts"
    INDENT_STATUS = "indent_status"
    DSR = "dsr"
    DIP_REGISTER = "dip_register"


@dataclass(frozen=True)
class FileFormat:
    kind: FileKind
    title: str
    columns: tuple[str, ...]  # in file order; all are required
    description: str


# The outlet's 6-digit RO code: the join key in every file, as in the oil company's own MIS.
RO = "RO_CODE"

FORMATS: dict[FileKind, FileFormat] = {
    f.kind: f
    for f in (
        FileFormat(
            FileKind.RO_MASTER,
            "Retail outlet master",
            (
                RO,
                "SAP_CUST_CODE",  # SAP sold-to code if different from the RO code; may be blank
                "RO_NAME",
                "SALES_AREA",
                "CLASS_OF_MARKET",  # A-Urban, B-Urban, C-Urban, D1-Highway, D2-Highway, E-Rural
                "RO_TYPE",
                "KSK",
                "LOCATION",
                "HIGHWAY_ROAD",
                "ADDRESS",
                "LATITUDE",
                "LONGITUDE",
                "AUTOMATED",
                "MONTHLY_TARGET_KL",
                "DEALER_NAME",
                "DEALER_MOBILE",
                "DEALER_SINCE",
            ),
            "One row per outlet in the sales area, with its dealer.",
        ),
        FileFormat(
            FileKind.TANK_MASTER,
            "Tank master",
            (RO, "TANK_NO", "PRODUCT", "CAPACITY_KL", "DIAMETER_MM", "LENGTH_MM"),
            "Underground tanks and the dimensions used for dip calibration.",
        ),
        FileFormat(
            FileKind.NOZZLE_MASTER,
            "Nozzle master",
            (RO, "DU_NO", "NOZZLE_NO", "PRODUCT", "TANK_NO"),
            "Dispensing units and nozzles, and the tank each nozzle draws from.",
        ),
        FileFormat(
            FileKind.LICENCE_REGISTER,
            "Statutory licence register",
            (RO, "LICENCE_TYPE", "LICENCE_NO", "ISSUED_ON", "VALID_UPTO"),
            "PESO storage licence, Legal Metrology stamping, fire NOC, pollution consent.",
        ),
        FileFormat(
            FileKind.TT_RECEIPTS,
            "Tank-truck receipt register",
            (
                "RECEIPT_DATE",
                "RECEIPT_TIME",
                RO,
                "INVOICE_NO",
                "INVOICE_DATE",
                "TT_NO",
                "PRODUCT",
                "TANK_NO",
                "INVOICE_QTY_KL",
                "INVOICE_DENSITY_15C",
                "OBS_DENSITY_15C",
                "DIP_BEFORE_MM",
                "DIP_AFTER_MM",
                "SHORTAGE_LTRS",
            ),
            "One row per compartment decanted, with the density check against the invoice.",
        ),
        FileFormat(
            FileKind.INDENT_STATUS,
            "Indent status report",
            (
                "INDENT_NO",
                "INDENT_DATE",
                RO,
                "PRODUCT",
                "QTY_KL",
                "STATUS",
                "HOLD_REASON",
                "TT_NO",
                "INVOICE_NO",
            ),
            "Orders placed by dealers and where each one stands.",
        ),
        FileFormat(
            FileKind.DSR,
            "Daily sales report (DSR)",
            (
                "BUSINESS_DATE",
                RO,
                "DU_NO",
                "NOZZLE_NO",
                "PRODUCT",
                "OPENING_TOTALIZER",
                "CLOSING_TOTALIZER",
                "TESTING_LTRS",
                "NET_SALE_LTRS",
                "RSP",
                "AMOUNT",
            ),
            "Totaliser readings per nozzle per business day. Net sale excludes the daily 5-litre test.",
        ),
        FileFormat(
            FileKind.DIP_REGISTER,
            "Dip / stock register",
            (
                "DATE",
                "TIME",
                RO,
                "TANK_NO",
                "PRODUCT",
                "DIP_MM",
                "WATER_MM",
                "TEMP_C",
                "OBS_DENSITY",
                "DENSITY_15C",
            ),
            "Manual dip readings. Volume is derived from the tank's calibration, as at the outlet.",
        ),
    )
}


def detect_kind(header: set[str]) -> FileKind | None:
    """Return the most specific format whose columns are all present in ``header``."""
    matches = [f for f in FORMATS.values() if set(f.columns) <= header]
    return max(matches, key=lambda f: len(f.columns)).kind if matches else None
