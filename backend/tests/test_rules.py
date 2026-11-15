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


def _short(key: str) -> str:
    """Density keys end with the invoice number, which changes with the generated data."""
    return ":".join(key.split(":")[:2]) if key.startswith("den:") else key


def _density_alert(session: Session, code: str) -> Alert:
    return next(a for k, a in _active(session).items() if k.startswith(f"den:{code}:"))


def test_storylines_raise_the_expected_alerts(session: Session) -> None:
    keys = {_short(k) for k in _active(session)}
    assert {
        "dry:GGN-104:HSD",
        "den:GGN-109",
        "var:GGN-121",
        "lic:PESO:GGN-131",
        "lic:LM_STAMPING:GGN-118",
        "low:GGN-114:MS",
    } <= keys
    # Nothing else is critical or high: the demo area is calm apart from its stories.
    loud = {_short(k) for k, a in _active(session).items() if a.severity in {"critical", "high"}}
    assert loud == {
        "dry:GGN-104:HSD",
        "den:GGN-109",
        "var:GGN-121",
        "lic:PESO:GGN-131",
        "lic:LM_STAMPING:GGN-118",
    }


def test_dry_out_alert_explains_the_payment_hold(session: Session) -> None:
    alert = _active(session)["dry:GGN-104:HSD"]
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
    assert "dry:GGN-104:HSD" not in active
    assert "requested" in active["low:GGN-104:HSD"].detail
    resolved = session.scalar(
        select(Alert).where(Alert.key == "dry:GGN-104:HSD", Alert.status == ALERT_RESOLVED)
    )
    assert resolved is not None and resolved.resolved_at is not None  # kept as history
    # Asking twice doesn't create a second indent.
    again = actions.request_priority_indent(
        session, "GGN-104", "so-test", product="HSD", qty_kl=20, today=today
    )
    assert again.id == indent.id
    assert session.scalar(select(AuditLog).where(AuditLog.action == "indent.request_priority")) is not None


def test_quality_hold_clears_density_alert(session: Session, settings: Settings) -> None:
    receipt_id = _density_alert(session, "GGN-109").data["receipt_id"]  # type: ignore[index]
    actions.hold_receipt_for_testing(session, receipt_id, "so-test")
    run_rules(session, settings)
    assert not any(k.startswith("den:GGN-109:") for k in _active(session))
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


def test_each_product_is_judged_on_its_own(session: Session, settings: Settings) -> None:
    """Petrol low with a truck coming must not hide diesel running dry at the same outlet."""
    from prahari.models import Outlet, TankReading

    outlet = session.scalar(select(Outlet).where(Outlet.code == "GGN-114"))  # petrol low, truck dispatched
    assert outlet is not None
    for tank in outlet.tanks:
        if tank.product_code == "HSD":
            for r in session.scalars(select(TankReading).where(TankReading.tank_id == tank.id)):
                r.volume_l = 50.0  # nearly empty, and no diesel indent exists
    session.flush()
    run_rules(session, settings)
    active = _active(session)
    assert "low:GGN-114:MS" in active and "dry:GGN-114:HSD" in active


def test_escalation_reopens_an_acknowledged_alert(session: Session, settings: Settings) -> None:
    alert = _active(session)["lic:LM_STAMPING:GGN-101"]  # due in ~19 days: medium
    actions.acknowledge_alert(session, alert.id, "so-test")
    settings.rules.licence_urgent_days = 25  # now within the urgent window: high
    run_rules(session, settings)
    same = _active(session)["lic:LM_STAMPING:GGN-101"]
    assert same.severity == "high" and same.status == "open"
