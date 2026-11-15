"""Test fixtures. Tests run against a real PostgreSQL + TimescaleDB (the compose ``db`` service locally,
a service container in CI), because upserts, hypertables and advisory locks are Postgres features.

A template database is migrated and seeded with generated sample data once per test session. Each
test that needs data gets a fresh copy (``CREATE DATABASE ... TEMPLATE``), which takes ~100 ms.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from prahari.config import Settings, get_settings
from prahari.db.session import get_engine, session_scope

ADMIN_URL = os.environ.get("PRAHARI_TEST_ADMIN_URL", "postgresql://prahari:prahari@localhost:5433/postgres")
TEMPLATE_DB, TEST_DB = "prahari_test_template", "prahari_test"


def _url(db: str) -> str:
    base = ADMIN_URL.rsplit("/", 1)[0].replace("postgresql://", "postgresql+psycopg://", 1)
    return f"{base}/{db}"


def _admin(sql: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(sql)  # type: ignore[arg-type]  # identifiers below are constants, not user input


def _use(db: str, monkeypatch: pytest.MonkeyPatch | None = None) -> Settings:
    """Point settings and the engine cache at database ``db``."""
    get_engine.cache_clear()
    if monkeypatch:
        monkeypatch.setenv("PRAHARI_DATABASE_URL", _url(db))
    else:
        os.environ["PRAHARI_DATABASE_URL"] = _url(db)
    os.environ.setdefault("PRAHARI_RUN_SCHEDULER", "false")
    get_settings.cache_clear()
    return get_settings()


def _dispose() -> None:
    get_engine().dispose()
    get_engine.cache_clear()


@pytest.fixture(scope="session")
def samples_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    from prahari.samples.generator import generate

    out = tmp_path_factory.mktemp("samples")
    s = get_settings()
    generate(out, as_of=datetime.now(UTC), tz=s.tz, start_hour=s.business_day_start_hour)
    return out


@pytest.fixture(scope="session")
def template_db(samples_dir: Path) -> Iterator[str]:
    """Migrated database seeded with a month of sample data, used as a template."""
    from alembic import command
    from alembic.config import Config

    from prahari.ingest.pipeline import import_paths
    from prahari.rules.engine import run_rules

    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:  # a previous run may have left it a template
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEMPLATE_DB,)).fetchone():
            conn.execute(f"ALTER DATABASE {TEMPLATE_DB} WITH IS_TEMPLATE false")  # type: ignore[arg-type]
    _admin(f"DROP DATABASE IF EXISTS {TEMPLATE_DB} WITH (FORCE)")
    _admin(f"CREATE DATABASE {TEMPLATE_DB}")
    settings = _use(TEMPLATE_DB)
    cfg = Config(str(Path(__import__("prahari").__file__).with_name("alembic.ini")))
    command.upgrade(cfg, "head")
    with session_scope() as session:
        jobs = import_paths(session, [samples_dir], settings)
        assert all(j.status == "succeeded" for j in jobs), [(j.filename, j.errors) for j in jobs if j.errors]
        run_rules(session, settings)
    _dispose()
    # TimescaleDB runs a background worker in every database; a template must have no sessions,
    # so stop new connections and end the existing ones.
    _admin(f"ALTER DATABASE {TEMPLATE_DB} WITH ALLOW_CONNECTIONS false IS_TEMPLATE true")
    _admin(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{TEMPLATE_DB}'")
    yield TEMPLATE_DB
    _admin(f"ALTER DATABASE {TEMPLATE_DB} WITH IS_TEMPLATE false")
    _admin(f"DROP DATABASE IF EXISTS {TEMPLATE_DB} WITH (FORCE)")


@pytest.fixture
def settings(template_db: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[Settings]:
    """A fresh copy of the seeded database for this test."""
    _admin(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
    _admin(f"CREATE DATABASE {TEST_DB} TEMPLATE {template_db}")
    monkeypatch.setenv("PRAHARI_RUN_SCHEDULER", "false")
    s = _use(TEST_DB, monkeypatch)
    yield s
    _dispose()


@pytest.fixture
def session(settings: Settings) -> Iterator[Session]:
    with session_scope() as s:
        yield s


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    from prahari.api.app import create_app

    with TestClient(create_app(settings), headers={"X-Prahari-User": "test-user"}) as c:
        yield c
