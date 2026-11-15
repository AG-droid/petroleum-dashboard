"""Initial schema: network, readings (TimescaleDB hypertables), sales, supply and operations.

Revision ID: 6ef33efb73c5
Revises:
Create Date: 2026-11-15 10:33:58.878330+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6ef33efb73c5"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor", sa.String(length=80), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("entity", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=40), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(op.f("ix_audit_log_at"), "audit_log", ["at"], unique=False)
    op.create_table(
        "dealer",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("mobile", sa.String(length=20), nullable=True),
        sa.Column("since_year", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dealer")),
    )
    op.create_table(
        "depot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("capacity_kl", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_depot")),
        sa.UniqueConstraint("code", name=op.f("uq_depot_code")),
    )
    op.create_table(
        "import_job",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("submitted_by", sa.String(length=80), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_total", sa.Integer(), nullable=False),
        sa.Column("rows_accepted", sa.Integer(), nullable=False),
        sa.Column("rows_rejected", sa.Integer(), nullable=False),
        sa.Column("errors", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_job")),
    )
    op.create_index(op.f("ix_import_job_sha256"), "import_job", ["sha256"], unique=False)
    op.create_table(
        "product",
        sa.Column("code", sa.String(length=8), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("density_min", sa.Float(), nullable=False),
        sa.Column("density_max", sa.Float(), nullable=False),
        sa.Column("price_per_l", sa.Numeric(precision=8, scale=2, asdecimal=False), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_product")),
    )
    op.create_table(
        "sales_area",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("division", sa.String(length=120), nullable=True),
        sa.Column("state_office", sa.String(length=120), nullable=True),
        sa.Column("boundary", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sales_area")),
        sa.UniqueConstraint("code", name=op.f("uq_sales_area_code")),
    )
    op.create_table(
        "outlet",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("sap_code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sales_area_id", sa.Integer(), nullable=False),
        sa.Column("dealer_id", sa.Integer(), nullable=True),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("ownership", sa.String(length=8), nullable=False),
        sa.Column("is_ksk", sa.Boolean(), nullable=False),
        sa.Column("locality", sa.String(length=120), nullable=True),
        sa.Column("road", sa.String(length=120), nullable=True),
        sa.Column("address", sa.String(length=240), nullable=True),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("is_automated", sa.Boolean(), nullable=False),
        sa.Column("monthly_target_kl", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["dealer_id"], ["dealer.id"], name=op.f("fk_outlet_dealer_id_dealer")),
        sa.ForeignKeyConstraint(
            ["sales_area_id"], ["sales_area.id"], name=op.f("fk_outlet_sales_area_id_sales_area")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outlet")),
        sa.UniqueConstraint("code", name=op.f("uq_outlet_code")),
        sa.UniqueConstraint("sap_code", name=op.f("uq_outlet_sap_code")),
    )
    op.create_table(
        "alert",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("rule", sa.String(length=24), nullable=False),
        sa.Column("severity", sa.String(length=10), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=14), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_alert_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert")),
    )
    op.create_index(op.f("ix_alert_key"), "alert", ["key"], unique=False)
    op.create_index(op.f("ix_alert_outlet_id"), "alert", ["outlet_id"], unique=False)
    op.create_index(op.f("ix_alert_status"), "alert", ["status"], unique=False)
    op.create_index(
        "uq_alert_active_key", "alert", ["key"], unique=True, postgresql_where=sa.text("status <> 'resolved'")
    )
    op.create_table(
        "indent",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("indent_no", sa.String(length=24), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("qty_kl", sa.Float(), nullable=False),
        sa.Column("indent_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("hold_reason", sa.String(length=120), nullable=True),
        sa.Column("tt_no", sa.String(length=20), nullable=True),
        sa.Column("invoice_no", sa.String(length=24), nullable=True),
        sa.Column("is_priority", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_indent_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_code"], ["product.code"], name=op.f("fk_indent_product_code_product")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_indent")),
        sa.UniqueConstraint("indent_no", name=op.f("uq_indent_indent_no")),
    )
    op.create_index(op.f("ix_indent_outlet_id"), "indent", ["outlet_id"], unique=False)
    op.create_index(op.f("ix_indent_status"), "indent", ["status"], unique=False)
    op.create_table(
        "licence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=False),
        sa.Column("licence_type", sa.String(length=24), nullable=False),
        sa.Column("licence_no", sa.String(length=60), nullable=False),
        sa.Column("issued_on", sa.Date(), nullable=True),
        sa.Column("valid_upto", sa.Date(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_licence_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_licence")),
        sa.UniqueConstraint("outlet_id", "licence_type", name=op.f("uq_licence_outlet_id_licence_type")),
    )
    op.create_index(op.f("ix_licence_outlet_id"), "licence", ["outlet_id"], unique=False)
    op.create_table(
        "nozzle",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=False),
        sa.Column("du_no", sa.Integer(), nullable=False),
        sa.Column("nozzle_no", sa.Integer(), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("tank_no", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_nozzle_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_code"], ["product.code"], name=op.f("fk_nozzle_product_code_product")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_nozzle")),
        sa.UniqueConstraint("outlet_id", "nozzle_no", name=op.f("uq_nozzle_outlet_id_nozzle_no")),
    )
    op.create_index(op.f("ix_nozzle_outlet_id"), "nozzle", ["outlet_id"], unique=False)
    op.create_table(
        "receipt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=False),
        sa.Column("invoice_no", sa.String(length=24), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tt_no", sa.String(length=20), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("tank_no", sa.Integer(), nullable=False),
        sa.Column("invoice_qty_kl", sa.Float(), nullable=False),
        sa.Column("invoice_density_15", sa.Float(), nullable=False),
        sa.Column("observed_density_15", sa.Float(), nullable=False),
        sa.Column("dip_before_mm", sa.Float(), nullable=True),
        sa.Column("dip_after_mm", sa.Float(), nullable=True),
        sa.Column("shortage_l", sa.Float(), nullable=False),
        sa.Column("quality_hold", sa.Boolean(), nullable=False),
        sa.Column("quality_hold_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_receipt_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_code"], ["product.code"], name=op.f("fk_receipt_product_code_product")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_receipt")),
        sa.UniqueConstraint("invoice_no", "tank_no", name=op.f("uq_receipt_invoice_no_tank_no")),
    )
    op.create_index(op.f("ix_receipt_outlet_id"), "receipt", ["outlet_id"], unique=False)
    op.create_index(op.f("ix_receipt_received_at"), "receipt", ["received_at"], unique=False)
    op.create_table(
        "tank",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("outlet_id", sa.Integer(), nullable=False),
        sa.Column("tank_no", sa.Integer(), nullable=False),
        sa.Column("product_code", sa.String(length=8), nullable=False),
        sa.Column("capacity_kl", sa.Float(), nullable=False),
        sa.Column("diameter_mm", sa.Float(), nullable=False),
        sa.Column("length_mm", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["outlet_id"], ["outlet.id"], name=op.f("fk_tank_outlet_id_outlet"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["product_code"], ["product.code"], name=op.f("fk_tank_product_code_product")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tank")),
        sa.UniqueConstraint("outlet_id", "tank_no", name=op.f("uq_tank_outlet_id_tank_no")),
    )
    op.create_index(op.f("ix_tank_outlet_id"), "tank", ["outlet_id"], unique=False)
    op.create_table(
        "nozzle_daily_sales",
        sa.Column("nozzle_id", sa.Integer(), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("opening_l", sa.Float(), nullable=False),
        sa.Column("closing_l", sa.Float(), nullable=False),
        sa.Column("testing_l", sa.Float(), nullable=False),
        sa.Column("net_sale_l", sa.Float(), nullable=False),
        sa.Column("rsp", sa.Numeric(precision=8, scale=2, asdecimal=False), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=2, asdecimal=False), nullable=True),
        sa.CheckConstraint(
            "closing_l >= opening_l", name=op.f("ck_nozzle_daily_sales_closing_not_below_opening")
        ),
        sa.CheckConstraint("testing_l >= 0", name=op.f("ck_nozzle_daily_sales_testing_non_negative")),
        sa.ForeignKeyConstraint(
            ["nozzle_id"],
            ["nozzle.id"],
            name=op.f("fk_nozzle_daily_sales_nozzle_id_nozzle"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("nozzle_id", "business_date", name=op.f("pk_nozzle_daily_sales")),
    )
    op.create_index(
        op.f("ix_nozzle_daily_sales_business_date"), "nozzle_daily_sales", ["business_date"], unique=False
    )
    op.create_table(
        "tank_reading",
        sa.Column("tank_id", sa.Integer(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("volume_l", sa.Float(), nullable=False),
        sa.Column("dip_mm", sa.Float(), nullable=True),
        sa.Column("water_mm", sa.Float(), nullable=True),
        sa.Column("temp_c", sa.Float(), nullable=True),
        sa.Column("density_obs", sa.Float(), nullable=True),
        sa.Column("density_15", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["tank_id"], ["tank.id"], name=op.f("fk_tank_reading_tank_id_tank"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("tank_id", "observed_at", "source", name=op.f("pk_tank_reading")),
    )
    op.create_table(
        "totalizer_reading",
        sa.Column("nozzle_id", sa.Integer(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("totalizer_l", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(
            ["nozzle_id"],
            ["nozzle.id"],
            name=op.f("fk_totalizer_reading_nozzle_id_nozzle"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("nozzle_id", "observed_at", name=op.f("pk_totalizer_reading")),
    )

    # Time-series tables: partitioned by time in 7-day chunks.
    for table in ("tank_reading", "totalizer_reading"):
        op.execute(f"SELECT create_hypertable('{table}', by_range('observed_at', INTERVAL '7 days'))")


def downgrade() -> None:
    op.drop_table("totalizer_reading")
    op.drop_table("tank_reading")
    op.drop_index(op.f("ix_nozzle_daily_sales_business_date"), table_name="nozzle_daily_sales")
    op.drop_table("nozzle_daily_sales")
    op.drop_index(op.f("ix_tank_outlet_id"), table_name="tank")
    op.drop_table("tank")
    op.drop_index(op.f("ix_receipt_received_at"), table_name="receipt")
    op.drop_index(op.f("ix_receipt_outlet_id"), table_name="receipt")
    op.drop_table("receipt")
    op.drop_index(op.f("ix_nozzle_outlet_id"), table_name="nozzle")
    op.drop_table("nozzle")
    op.drop_index(op.f("ix_licence_outlet_id"), table_name="licence")
    op.drop_table("licence")
    op.drop_index(op.f("ix_indent_status"), table_name="indent")
    op.drop_index(op.f("ix_indent_outlet_id"), table_name="indent")
    op.drop_table("indent")
    op.drop_index("uq_alert_active_key", table_name="alert", postgresql_where=sa.text("status <> 'resolved'"))
    op.drop_index(op.f("ix_alert_status"), table_name="alert")
    op.drop_index(op.f("ix_alert_outlet_id"), table_name="alert")
    op.drop_index(op.f("ix_alert_key"), table_name="alert")
    op.drop_table("alert")
    op.drop_table("outlet")
    op.drop_table("sales_area")
    op.drop_table("product")
    op.drop_index(op.f("ix_import_job_sha256"), table_name="import_job")
    op.drop_table("import_job")
    op.drop_table("depot")
    op.drop_table("dealer")
    op.drop_index(op.f("ix_audit_log_at"), table_name="audit_log")
    op.drop_table("audit_log")
