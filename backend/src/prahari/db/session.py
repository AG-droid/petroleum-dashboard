"""Engine and session helpers.

The API uses :func:`get_session` as a FastAPI dependency (one session per request). Scripts and
background jobs use :func:`session_scope`, which commits on success and rolls back on error.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from prahari.config import get_settings


@lru_cache
def get_engine(url: str | None = None) -> Engine:
    """Create (once per URL) a pooled engine. ``pool_pre_ping`` survives database restarts."""
    return create_engine(url or get_settings().database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def _factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts and jobs."""
    session = _factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency: a session per request, committed if the handler succeeds."""
    with session_scope() as session:
        yield session
