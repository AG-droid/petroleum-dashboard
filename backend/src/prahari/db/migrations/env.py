"""Alembic environment: runs migrations against the database configured in Prahari settings."""

from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

import prahari.models  # noqa: F401  (registers every table on Base.metadata)
from prahari.config import get_settings
from prahari.db.base import Base

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
target_metadata = Base.metadata
TIMESCALE_INDEXES = {"tank_reading_observed_at_idx", "totalizer_reading_observed_at_idx"}


def include_object(obj: object, name: str | None, type_: str, reflected: bool, compare_to: object) -> bool:
    """Ignore indexes TimescaleDB creates itself, so autogenerate doesn't try to drop them."""
    return not (type_ == "index" and reflected and name in TIMESCALE_INDEXES)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
