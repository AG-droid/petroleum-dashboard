"""Oil-company vocabulary: RO code as the outlet key, class of market, RSA hierarchy, product units.

- ``outlet.category`` (Highway/Urban/Rural) becomes ``outlet.market_class`` (A-Urban … E-Rural).
  Existing rows are mapped Highway → D1-Highway, Urban → B-Urban, Rural → E-Rural; refine them
  by re-importing the RO master with its CLASS_OF_MARKET column.
- ``outlet.sap_code`` becomes optional: imports now match on ``outlet.code`` (the RO code).
- ``sales_area.division`` is renamed ``divisional_office``.
- ``product`` gains ``unit`` (L or kg) and its density bounds become optional (gases).

Note: outlet codes themselves are data, not schema. A database loaded before this change still
holds the old demo codes; reload it (``make reset``) to get RO codes.

Revision ID: 3c9a1f7e2b40
Revises: e57d00f2a5d1
Create Date: 2026-11-15 14:30:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3c9a1f7e2b40"
down_revision: str | None = "e57d00f2a5d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("outlet", sa.Column("market_class", sa.String(length=16), nullable=True))
    op.execute(
        """
        UPDATE outlet SET market_class = CASE category
            WHEN 'Highway' THEN 'D1-Highway'
            WHEN 'Rural' THEN 'E-Rural'
            ELSE 'B-Urban'
        END
        """
    )
    op.alter_column("outlet", "market_class", nullable=False)
    op.drop_column("outlet", "category")
    op.alter_column("outlet", "sap_code", existing_type=sa.String(length=16), nullable=True)

    op.alter_column("sales_area", "division", new_column_name="divisional_office")

    op.add_column("product", sa.Column("unit", sa.String(length=4), server_default="L", nullable=False))
    op.alter_column("product", "density_min", existing_type=sa.Float(), nullable=True)
    op.alter_column("product", "density_max", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    # Gas products have no density; the old schema can't hold them.
    op.execute("DELETE FROM product WHERE density_min IS NULL OR density_max IS NULL")
    op.alter_column("product", "density_max", existing_type=sa.Float(), nullable=False)
    op.alter_column("product", "density_min", existing_type=sa.Float(), nullable=False)
    op.drop_column("product", "unit")

    op.alter_column("sales_area", "divisional_office", new_column_name="division")

    op.execute("UPDATE outlet SET sap_code = code WHERE sap_code IS NULL")
    op.alter_column("outlet", "sap_code", existing_type=sa.String(length=16), nullable=False)
    op.add_column("outlet", sa.Column("category", sa.String(length=16), nullable=True))
    op.execute(
        """
        UPDATE outlet SET category = CASE
            WHEN market_class LIKE '%Highway' THEN 'Highway'
            WHEN market_class LIKE '%Rural' THEN 'Rural'
            ELSE 'Urban'
        END
        """
    )
    op.alter_column("outlet", "category", nullable=False)
    op.drop_column("outlet", "market_class")
