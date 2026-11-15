"""Operational records: alerts, file-import jobs and the audit log."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from prahari.db.base import Base

ALERT_OPEN = "open"
ALERT_ACKNOWLEDGED = "acknowledged"
ALERT_RESOLVED = "resolved"


class Alert(Base):
    """A condition raised by the rules engine.

    ``key`` identifies the condition (e.g. ``dry:GGN-104:HSD``). While a condition holds there is
    exactly one unresolved alert for its key (enforced by a partial unique index); when it clears,
    the alert is resolved and kept as history.
    """

    __tablename__ = "alert"
    __table_args__ = (
        Index("uq_alert_active_key", "key", unique=True, postgresql_where=text("status <> 'resolved'")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    rule: Mapped[str] = mapped_column(String(24))
    severity: Mapped[str] = mapped_column(String(10), doc="critical | high | medium | low")
    category: Mapped[str] = mapped_column(String(16))
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlet.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(14), default=ALERT_OPEN, index=True)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ImportJob(Base):
    """One file import: what was loaded, by whom, and which rows were rejected and why."""

    __tablename__ = "import_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16), doc="succeeded | partial | failed | skipped")
    submitted_by: Mapped[str] = mapped_column(String(80), default="system")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rows_total: Mapped[int] = mapped_column(Integer, default=0)
    rows_accepted: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, doc="First rejected rows, with reasons."
    )


class AuditLog(Base):
    """Append-only record of user-initiated changes (who did what, when)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)
