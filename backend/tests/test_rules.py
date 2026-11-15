"""Alert rules and their lifecycle: open → update/acknowledge → resolve."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

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
        "dry:990104:HSD",
        "den:990109",
        "var:990121",
        "lic:PESO:990131",
        "lic:LM_STAMPING:990118",
        "low:990114:MS",
    } <= keys
    # Nothing else is critical or high: the demo area is calm apart from its stories.
    loud = {_short(k) for k, a in _active(session).items() if a.severity in {"critical", "high"}}
    assert loud == {
        "dry:990104:HSD",
        "den:990109",
        "var:990121",
        "lic:PESO:990131",
        "lic:LM_STAMPING:990118",
    }


def test_dry_out_alert_explains_the_payment_hold(session: Session) -> None:
    alert = _active(session)["dry:990104:HSD"]
    assert alert.severity == "critical"
    assert "on hold: payment not received" in alert.detail


def test_rules_are_idempotent(session: Session, settings: Settings) -> None:
    before = {k: a.id for k, a in _active(session).items()}
    summary = run_rules(session, settings)
    assert summary.opened == summary.resolved == 0
    assert {k: a.id for k, a in _active(session).items()} == before


def test_priority_indent_turns_dry_out_into_low_stock(session: Session, settings: Settings) -> None:
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    indent, created = actions.request_priority_indent(
        session, "990104", "so-test", product="HSD", qty_kl=20, today=today, valid_for=timedelta(hours=24)
    )
    assert created
    assert indent.status == "Requested" and indent.is_priority
    run_rules(session, settings)
    active = _active(session)
    assert "dry:990104:HSD" not in active
    assert "requested" in active["low:990104:HSD"].detail
    resolved = session.scalar(
        select(Alert).where(Alert.key == "dry:990104:HSD", Alert.status == ALERT_RESOLVED)
    )
    assert resolved is not None and resolved.resolved_at is not None  # kept as history
    # Asking twice doesn't create a second indent.
    again, created = actions.request_priority_indent(
        session, "990104", "so-test", product="HSD", qty_kl=20, today=today, valid_for=timedelta(hours=24)
    )
    assert again.id == indent.id and not created
    assert session.scalar(select(AuditLog).where(AuditLog.action == "indent.request_priority")) is not None


def test_quality_hold_clears_density_alert(session: Session, settings: Settings) -> None:
    receipt_id = _density_alert(session, "990109").data["receipt_id"]  # type: ignore[index]
    actions.hold_receipt_for_testing(session, receipt_id, "so-test")
    run_rules(session, settings)
    assert not any(k.startswith("den:990109:") for k in _active(session))
    assert session.get(Receipt, receipt_id).quality_hold  # type: ignore[union-attr]


def test_acknowledged_alert_stays_acknowledged_while_condition_holds(
    session: Session, settings: Settings
) -> None:
    alert = _active(session)["var:990121"]
    actions.acknowledge_alert(session, alert.id, "so-test")
    run_rules(session, settings)
    same = _active(session)["var:990121"]
    assert same.id == alert.id and same.status == ALERT_ACKNOWLEDGED


def test_thresholds_come_from_settings(session: Session, settings: Settings) -> None:
    settings.rules.variation_pct = 5.0  # an operator relaxes the limit
    run_rules(session, settings)
    assert "var:990121" not in _active(session)


def test_each_product_is_judged_on_its_own(session: Session, settings: Settings) -> None:
    """Petrol low with a truck coming must not hide diesel running dry at the same outlet."""
    from prahari.models import Outlet, TankReading

    outlet = session.scalar(select(Outlet).where(Outlet.code == "990114"))  # petrol low, truck dispatched
    assert outlet is not None
    for tank in outlet.tanks:
        if tank.product_code == "HSD":
            for r in session.scalars(select(TankReading).where(TankReading.tank_id == tank.id)):
                r.volume_l = 50.0  # nearly empty, and no diesel indent exists
    session.flush()
    run_rules(session, settings)
    active = _active(session)
    assert "low:990114:MS" in active and "dry:990114:HSD" in active


def test_escalation_reopens_an_acknowledged_alert(session: Session, settings: Settings) -> None:
    alert = _active(session)["lic:LM_STAMPING:990101"]  # due in ~19 days: medium
    actions.acknowledge_alert(session, alert.id, "so-test")
    settings.rules.licence_urgent_days = 25  # now within the urgent window: high
    run_rules(session, settings)
    same = _active(session)["lic:LM_STAMPING:990101"]
    assert same.severity == "high" and same.status == "open"


def test_missing_data_does_not_resolve_alerts(session: Session, settings: Settings) -> None:
    """Before today's dips are imported the variation can't be measured: keep the alert, don't flap."""
    from prahari.domain.time import business_day_start
    from prahari.models import TankReading

    alert = _active(session)["var:990121"]
    actions.acknowledge_alert(session, alert.id, "so-test")
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    start = business_day_start(today, settings.tz, settings.business_day_start_hour)
    for r in session.scalars(select(TankReading).where(TankReading.observed_at >= start)):
        session.delete(r)
    session.flush()
    run_rules(session, settings)
    same = _active(session).get("var:990121")
    assert same is not None and same.id == alert.id and same.status == ALERT_ACKNOWLEDGED


def test_feed_outage_keeps_automation_alerts(session: Session, settings: Settings) -> None:
    from prahari.models import Outlet, TankReading
    from prahari.models.readings import SOURCE_AUTOMATION

    now = datetime.now(UTC)
    online = session.scalar(select(Outlet).where(Outlet.code == "990101"))
    assert online is not None
    session.add(
        TankReading(
            tank_id=online.tanks[0].id,
            observed_at=now - timedelta(minutes=1),
            source=SOURCE_AUTOMATION,
            volume_l=5000,
        )
    )
    session.flush()
    run_rules(session, settings, at=now)
    assert "ra:990127" in _active(session)  # feed running, scripted outlet silent → offline
    run_rules(session, settings, at=now + timedelta(hours=5))  # the whole feed has stopped
    assert "ra:990127" in _active(session)  # unknown is not the same as fixed


def test_user_triggered_run_waits_instead_of_skipping(session: Session, settings: Settings) -> None:
    assert not run_rules(session, settings, wait=True).skipped


def test_unanswered_request_stops_covering_after_its_validity(session: Session, settings: Settings) -> None:
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    indent, _ = actions.request_priority_indent(
        session, "990104", "so-test", product="HSD", qty_kl=20, today=today, valid_for=timedelta(hours=24)
    )
    run_rules(session, settings)
    assert "low:990104:HSD" in _active(session)
    indent.created_at = datetime.now(UTC) - timedelta(hours=settings.rules.requested_indent_hours + 1)
    session.flush()
    run_rules(session, settings)
    assert "dry:990104:HSD" in _active(session)  # nobody acted on the request: back to critical


def test_unknown_keys_match_exactly_not_by_prefix(session: Session, settings: Settings) -> None:
    """An unknown 'var:99012' must not keep 'var:990121' alive (one key is a prefix of the other)."""
    from prahari.models import Outlet

    outlet = session.scalar(select(Outlet).where(Outlet.code == "990121"))
    assert outlet is not None
    stale = Alert(
        key="var:99012",
        rule="var",
        severity="high",
        category="Stock",
        outlet_id=outlet.id,
        title="t",
        detail="d",
        status="open",
    )
    session.add(stale)
    session.flush()
    settings.rules.variation_pct = 5.0  # 990121's variation is now fine
    run_rules(session, settings)
    assert "var:990121" not in _active(session)


def test_re_request_after_expiry_creates_a_new_indent(session: Session, settings: Settings) -> None:
    today = business_date(datetime.now(UTC), settings.tz, settings.business_day_start_hour)
    first, _ = actions.request_priority_indent(
        session, "990104", "so-test", product="HSD", qty_kl=20, today=today, valid_for=timedelta(hours=24)
    )
    first.created_at = datetime.now(UTC) - timedelta(hours=25)
    session.flush()
    second, created = actions.request_priority_indent(
        session, "990104", "so-test", product="HSD", qty_kl=20, today=today, valid_for=timedelta(hours=24)
    )
    session.refresh(first)
    assert created and second.id != first.id and first.status == "Cancelled"
    assert len(second.indent_no) <= 24


def test_lock_timeout_keeps_the_users_action(session: Session, settings: Settings) -> None:
    """If a rules run can't get the lock in time, the action in the same transaction still stands."""
    import psycopg

    from prahari.models import AuditLog
    from prahari.rules.engine import _LOCK_ID

    url = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(url) as other:  # another transaction holds the rules lock
        other.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_ID,))
        actions.acknowledge_alert(session, _active(session)["var:990121"].id, "so-test")
        summary = run_rules(session, settings, wait=True, lock_wait="200ms")
        assert summary.skipped
        session.flush()  # the transaction is still usable
        assert session.scalar(select(AuditLog).where(AuditLog.action == "alert.acknowledge")) is not None
