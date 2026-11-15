"""One open Prahari priority request per outlet and product (partial unique index).

Revision ID: e57d00f2a5d1
Revises: 6ef33efb73c5
Create Date: 2026-11-15 11:06:00.042210+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e57d00f2a5d1"
down_revision: str | None = "6ef33efb73c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing databases may hold duplicate open requests (before this constraint): keep the
    # newest per outlet and product, cancel the rest, then add the index.
    op.execute(
        """
        UPDATE indent SET status = 'Cancelled', hold_reason = 'Superseded by a newer request'
        WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (PARTITION BY outlet_id, product_code ORDER BY created_at DESC) AS n
                FROM indent WHERE status = 'Requested' AND source = 'prahari'
            ) ranked WHERE n > 1
        )
        """
    )
    op.create_index(
        "uq_indent_one_open_request",
        "indent",
        ["outlet_id", "product_code"],
        unique=True,
        postgresql_where=sa.text("status = 'Requested' AND source = 'prahari'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_indent_one_open_request",
        table_name="indent",
        postgresql_where=sa.text("status = 'Requested' AND source = 'prahari'"),
    )
