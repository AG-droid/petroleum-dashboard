"""Alert rules and their reconciliation with the ``alert`` table.

Each rule looks at :class:`~prahari.services.state.OutletState` and returns the alerts that
*should* be open right now. :func:`run_rules` then reconciles that with the database:

* a condition seen for the first time opens a new alert;
* a condition that still holds updates its alert (an acknowledged alert stays acknowledged);
* an alert whose condition has cleared is resolved and kept as history.

Keys are stable (``dry:GGN-104``, ``lic:PESO:GGN-131`` ...) so the same condition never opens twice.
Runs are serialised with a PostgreSQL advisory lock, so several API workers can't race.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from prahari.config import RuleThresholds, Settings
from prahari.domain.products import PRODUCT_NAMES
from prahari.domain.time import now_utc
from prahari.models import Alert
from prahari.models.ops import ALERT_OPEN, ALERT_RESOLVED
from prahari.services.state import OutletState, compute_states

log = logging.getLogger(__name__)
_LOCK_ID = 7_301_104  # arbitrary, unique to the rules engine
LICENCE_LABELS = {
    "PESO": "PESO storage licence",
    "LM_STAMPING": "Legal Metrology stamping",
    "FIRE_NOC": "Fire NOC",
    "PCB_CONSENT": "Pollution control consent",
}


@dataclass(frozen=True)
class AlertSpec:
    key: str
    rule: str
    severity: str
    category: str
    outlet_id: int | None
    title: str
    detail: str
    data: dict[str, Any] = field(default_factory=dict)


def _hours(days: float) -> str:
    h = days * 24
    if h < 1.5:
        return "less than 2 hours"
    return f"about {round(h)} hours" if h < 36 else f"about {days:.1f} days"


# --------------------------------------------------------------------------------------------
# Rules: each takes one outlet's state and the thresholds and yields AlertSpecs
# --------------------------------------------------------------------------------------------
def rule_supply(st: OutletState, th: RuleThresholds) -> Iterable[AlertSpec]:
    """Dry-out risk (no fuel coming) or low stock with fuel on its way."""
    worst = st.min_cover
    if worst is None or worst.days_cover is None or worst.days_cover >= th.dry_out_days:
        return
    o, p = st.outlet, worst.product
    name = PRODUCT_NAMES.get(p, p)
    stock_kl = (worst.stock_l or 0) / 1000
    data = {
        "product": p,
        "days_cover": round(worst.days_cover, 2),
        "stock_l": round(worst.stock_l or 0),
        "estimated": worst.estimated,
    }
    covering = st.covering_indent(p)
    if covering is None:
        held = st.held_indent(p)
        reason = (
            f" The order is on hold: {held.hold_reason.lower()}."
            if held and held.hold_reason
            else (" The order is on hold." if held else " No order has been placed.")
        )
        yield AlertSpec(
            f"dry:{o.code}",
            "dry",
            "critical",
            "Supply",
            o.id,
            f"Dry-out risk: {name} at {o.name}",
            f"{_hours(worst.days_cover)} of {name.lower()} left ({stock_kl:.1f} kL).{reason}",
            {**data, "held_indent": held.indent_no if held else None},
        )
    else:
        yield AlertSpec(
            f"low:{o.code}",
            "low",
            "low",
            "Supply",
            o.id,
            f"Low {name.lower()} at {o.name}, delivery {covering.status.lower()}",
            f"{_hours(worst.days_cover)} left ({stock_kl:.1f} kL). Indent {covering.indent_no} "
            f"for {covering.qty_kl:g} kL is {covering.status.lower()}"
            f"{' on ' + covering.tt_no if covering.tt_no else ''}.",
            {**data, "indent": covering.indent_no},
        )


def rule_variation(st: OutletState, th: RuleThresholds) -> Iterable[AlertSpec]:
    v = st.variation_pct
    if v is not None and v > th.variation_pct:
        o = st.outlet
        yield AlertSpec(
            f"var:{o.code}",
            "var",
            "high",
            "Stock",
            o.id,
            f"Stock variation {v:.2f}% at {o.name}",
            f"Book stock is above the physical dip by {v:.2f}% of sales over the last "
            f"{th.variation_window_days} days (limit {th.variation_pct:.2f}%). "
            "Check for leakage, pilferage or meter error.",
            {"variation_pct": round(v, 3)},
        )


def rule_density(st: OutletState, th: RuleThresholds) -> Iterable[AlertSpec]:
    o = st.outlet
    flagged = [r for r in st.receipts if abs(r.density_diff) > th.density_tolerance and not r.quality_hold]
    if flagged:
        r = flagged[0]  # newest first
        name = PRODUCT_NAMES.get(r.product_code, r.product_code).lower()
        yield AlertSpec(
            f"den:{o.code}",
            "den",
            "high",
            "Quality",
            o.id,
            f"Density mismatch on {name} receipt at {o.name}",
            f"Invoice {r.invoice_no} (tank {r.tank_no}): observed vs invoice density at 15 °C "
            f"{r.density_diff:+.1f} kg/m³ (tolerance ±{th.density_tolerance:.1f}). "
            "Recommend holding the tank and sending a sample for testing.",
            {"receipt_id": r.id, "invoice_no": r.invoice_no, "density_diff": round(r.density_diff, 2)},
        )


def rule_licences(st: OutletState, th: RuleThresholds) -> Iterable[AlertSpec]:
    o = st.outlet
    for lc, days_left in st.licences:
        if days_left > th.licence_warn_days:
            continue
        label = LICENCE_LABELS.get(lc.licence_type, lc.licence_type)
        when = f"expired {-days_left} days ago" if days_left < 0 else f"due in {days_left} days"
        yield AlertSpec(
            f"lic:{lc.licence_type}:{o.code}",
            "lic",
            "high" if days_left <= th.licence_urgent_days else "medium",
            "Compliance",
            o.id,
            f"{label} {when} at {o.name}",
            f"Valid until {lc.valid_upto:%d %b %Y} ({lc.licence_no}). Dealer to submit renewal documents.",
            {"licence_type": lc.licence_type, "days_left": days_left},
        )


def rule_automation(st: OutletState, th: RuleThresholds) -> Iterable[AlertSpec]:
    o = st.outlet
    if st.automation_online is False:
        yield AlertSpec(
            f"ra:{o.code}",
            "ra",
            "high",
            "Equipment",
            o.id,
            f"Automation offline at {o.name}",
            f"No tank-gauge or pump data for over {th.automation_stale_minutes} minutes. "
            "Stock and sales figures are from the last manual dip.",
            {"last_seen": st.last_automation_at.isoformat() if st.last_automation_at else None},
        )


RULES: tuple[Callable[[OutletState, RuleThresholds], Iterable[AlertSpec]], ...] = (
    rule_supply,
    rule_variation,
    rule_density,
    rule_licences,
    rule_automation,
)
OWNED_RULES = frozenset({"dry", "low", "var", "den", "lic", "ra"})


def evaluate(states: list[OutletState], th: RuleThresholds) -> list[AlertSpec]:
    return [spec for st in states for rule in RULES for spec in rule(st, th)]


@dataclass
class RunSummary:
    opened: int = 0
    updated: int = 0
    resolved: int = 0
    skipped: bool = False


def run_rules(session: Session, settings: Settings, *, at: datetime | None = None) -> RunSummary:
    """Evaluate all rules and reconcile the alert table. Caller commits."""
    if not session.scalar(text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": _LOCK_ID}):
        log.info("rules engine already running elsewhere; skipping this run")
        return RunSummary(skipped=True)
    now = at or now_utc()
    specs = {s.key: s for s in evaluate(compute_states(session, settings, at=now), settings.rules)}
    active = {a.key: a for a in session.scalars(select(Alert).where(Alert.status != ALERT_RESOLVED))}
    summary = RunSummary()
    for key, spec in specs.items():
        alert = active.get(key)
        if alert is None:
            session.add(
                Alert(
                    key=key,
                    rule=spec.rule,
                    severity=spec.severity,
                    category=spec.category,
                    outlet_id=spec.outlet_id,
                    title=spec.title,
                    detail=spec.detail,
                    data=spec.data,
                    status=ALERT_OPEN,
                    opened_at=now,
                    updated_at=now,
                )
            )
            summary.opened += 1
        elif (alert.title, alert.detail, alert.severity, alert.data) != (
            spec.title,
            spec.detail,
            spec.severity,
            spec.data,
        ):
            alert.title, alert.detail, alert.severity, alert.data = (
                spec.title,
                spec.detail,
                spec.severity,
                spec.data,
            )
            alert.updated_at = now
            summary.updated += 1
    for key, alert in active.items():
        if key not in specs and alert.rule in OWNED_RULES:
            alert.status, alert.resolved_at, alert.updated_at = ALERT_RESOLVED, now, now
            summary.resolved += 1
    session.flush()
    if summary.opened or summary.resolved:
        log.info(
            "rules run",
            extra={"opened": summary.opened, "updated": summary.updated, "resolved": summary.resolved},
        )
    return summary
