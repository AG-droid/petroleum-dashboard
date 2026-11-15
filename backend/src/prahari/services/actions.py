"""User actions that change data. Each one writes an audit-log entry.

These replace the dashboard's "magic" buttons with records of what was asked and by whom:
a priority indent is a *request* to the supply team, not a truck appearing out of nowhere.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from prahari.domain.time import now_utc
from prahari.models import Alert, AuditLog, Indent, Outlet, Receipt
from prahari.models.ops import ALERT_ACKNOWLEDGED, ALERT_OPEN
from prahari.models.supply import INDENT_COVERING, INDENT_ON_HOLD, INDENT_REQUESTED


class NotFoundError(LookupError):
    pass


class ConflictError(ValueError):
    pass


def _audit(
    session: Session, actor: str, action: str, entity: str, entity_id: object, **details: object
) -> None:
    session.add(
        AuditLog(actor=actor, action=action, entity=entity, entity_id=str(entity_id), details=details or None)
    )


def acknowledge_alert(session: Session, alert_id: int, actor: str) -> Alert:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise NotFoundError(f"alert {alert_id} not found")
    if alert.status == ALERT_OPEN:
        alert.status, alert.acknowledged_at = ALERT_ACKNOWLEDGED, now_utc()
        _audit(session, actor, "alert.acknowledge", "alert", alert.id, key=alert.key)
    return alert


def request_priority_indent(
    session: Session,
    outlet_code: str,
    actor: str,
    *,
    product: str,
    qty_kl: float,
    today: date,
    note: str | None = None,
) -> Indent:
    """Raise a priority indent for an outlet/product. Idempotent while one is already open."""
    outlet = session.scalar(select(Outlet).where(Outlet.code == outlet_code))
    if outlet is None:
        raise NotFoundError(f"outlet {outlet_code} not found")
    if product not in {t.product_code for t in outlet.tanks}:
        raise ConflictError(f"{outlet_code} has no {product} tank")
    existing = session.scalar(
        select(Indent).where(
            Indent.outlet_id == outlet.id, Indent.product_code == product, Indent.status.in_(INDENT_COVERING)
        )
    )
    if existing is not None:
        return existing
    seq = (session.scalar(select(func.count(Indent.id)).where(Indent.source == "prahari")) or 0) + 1
    indent = Indent(
        indent_no=f"PRH-{today:%y%m%d}-{seq:04d}",
        outlet_id=outlet.id,
        product_code=product,
        qty_kl=qty_kl,
        indent_date=today,
        status=INDENT_REQUESTED,
        is_priority=True,
        source="prahari",
    )
    session.add(indent)
    held = session.scalars(
        select(Indent).where(
            Indent.outlet_id == outlet.id, Indent.product_code == product, Indent.status == INDENT_ON_HOLD
        )
    ).all()
    session.flush()
    _audit(
        session,
        actor,
        "indent.request_priority",
        "indent",
        indent.indent_no,
        outlet=outlet_code,
        product=product,
        qty_kl=qty_kl,
        note=note,
        held_indents=[h.indent_no for h in held],
    )
    return indent


def hold_receipt_for_testing(session: Session, receipt_id: int, actor: str) -> Receipt:
    """Hold the tanks that received this delivery and send a sample for testing.

    A density failure applies to the whole delivery (one invoice), which may have been decanted
    into several tanks, so every receipt line of that invoice at the outlet is held.
    """
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise NotFoundError(f"receipt {receipt_id} not found")
    lines = session.scalars(
        select(Receipt).where(
            Receipt.outlet_id == receipt.outlet_id, Receipt.invoice_no == receipt.invoice_no
        )
    ).all()
    newly = [r for r in lines if not r.quality_hold]
    now = now_utc()
    for r in newly:
        r.quality_hold, r.quality_hold_at = True, now
    if newly:
        _audit(
            session,
            actor,
            "receipt.quality_hold",
            "receipt",
            receipt.id,
            invoice=receipt.invoice_no,
            tanks=sorted(r.tank_no for r in newly),
        )
    return receipt
