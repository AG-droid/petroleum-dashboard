"""Alert rules and their lifecycle: open → update/acknowledge → resolve."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from prahari.config import Settings
from prahari.domain.time import business_date
from prahari.models import Alert, AuditLog, Receipt
from prahari.models.ops import ALERT_ACKNOWLEDGED, ALERT_RESOLVED
from prahari.rules.engine import run_rules
from prahari.services import actions


def _active(session: Session) -> dict[str, Alert]:
    return {a.key: a for a in session.scalars(select(Alert).where(Alert.status != ALERT_RESOLVED))}


def test_storylines_raise_the_expected_alerts(session: Session) -> None:
    keys = set(_active(session))
    assert {
        "dry:GGN-104",
        "den:GGN-109",
        "var:GGN-121",
        "lic:PESO:GGN-131",
        "lic:LM_STAMPING:GGN-118",
        "low:GGN-114",
    } <= keys
    # Nothing else is critical or high: the demo area is calm apart from its stories.
    loud = {k for k, a in _active(session).items() if a.severity in {"critical", "high"}}
    assert loud == {
        "dry:GGN-104",
        "den:GGN-109",
        "var:GGN-121",
        "lic:PESO:GGN-131",
        "lic:LM_STAMPING:GGN-118",
    }


def test_dry_out_alert_explains_the_payment_hold(session: Session) -> None:
    alert = _active(session)["dry:GGN-104"]
    assert alert.severity == "critical"
    assert "on hold: payment not received" in alert.detail


def test_rules_are_idempotent(session: Session, settings: Settings) -> None:
    before = {k: a.id for k, a in _active(session).items()}
    summary = run_rules(session, settings)
    assert summary.opened == summary.resolved == 0
    assert {k: a.id for k, a in _active(session).items()} == before


def test_priority_indent_turns_dry_out_into_low_stock(session: Session, settings: Settings) -> None:
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    indent = actions.request_priority_indent(
        session, "GGN-104", "so-test", product="HSD", qty_kl=20, today=today
    )
    assert indent.status == "Requested" and indent.is_priority
    run_rules(session, settings)
    active = _active(session)
    assert "dry:GGN-104" not in active
    assert "requested" in active["low:GGN-104"].detail
    resolved = session.scalar(select(Alert).where(Alert.key == "dry:GGN-104", Alert.status == ALERT_RESOLVED))
    assert resolved is not None and resolved.resolved_at is not None  # kept as history
    # Asking twice doesn't create a second indent.
    again = actions.request_priority_indent(
        session, "GGN-104", "so-test", product="HSD", qty_kl=20, today=today
    )
    assert again.id == indent.id
    assert session.scalar(select(AuditLog).where(AuditLog.action == "indent.request_priority")) is not None


def test_quality_hold_clears_density_alert(session: Session, settings: Settings) -> None:
    receipt_id = _active(session)["den:GGN-109"].data["receipt_id"]  # type: ignore[index]
    actions.hold_receipt_for_testing(session, receipt_id, "so-test")
    run_rules(session, settings)
    assert "den:GGN-109" not in _active(session)
    assert session.get(Receipt, receipt_id).quality_hold  # type: ignore[union-attr]


def test_acknowledged_alert_stays_acknowledged_while_condition_holds(
    session: Session, settings: Settings
) -> None:
    alert = _active(session)["var:GGN-121"]
    actions.acknowledge_alert(session, alert.id, "so-test")
    run_rules(session, settings)
    same = _active(session)["var:GGN-121"]
    assert same.id == alert.id and same.status == ALERT_ACKNOWLEDGED


def test_thresholds_come_from_settings(session: Session, settings: Settings) -> None:
    settings.rules.variation_pct = 5.0  # an operator relaxes the limit
    run_rules(session, settings)
    assert "var:GGN-121" not in _active(session)
