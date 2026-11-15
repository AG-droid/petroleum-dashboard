"""Read endpoints for the area, outlets and alerts, plus the dashboard's snapshot/live feeds."""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import func, select, text

from prahari import __version__
from prahari.api import schemas, views
from prahari.api.deps import ActorDep, SessionDep, SettingsDep
from prahari.domain.time import business_date, now_utc
from prahari.models import Alert, Outlet
from prahari.models.ops import ALERT_RESOLVED
from prahari.rules.engine import run_rules
from prahari.services import actions
from prahari.services.state import OutletState, compute_states

router = APIRouter()


def _open_counts(session: SessionDep) -> Counter[int]:
    return Counter(
        oid
        for (oid,) in session.execute(
            select(Alert.outlet_id).where(Alert.status != ALERT_RESOLVED, Alert.outlet_id.is_not(None))
        )
    )


def _state_for(session: SessionDep, settings: SettingsDep, code: str) -> OutletState:
    """State of one outlet, computed for that outlet only."""
    if session.scalar(select(Outlet.id).where(Outlet.code == code)) is None:
        raise HTTPException(404, f"outlet {code} not found")
    return compute_states(session, settings, codes=[code])[0]


@router.get("/health", response_model=schemas.Health, tags=["system"])
def health(request: Request, session: SessionDep) -> schemas.Health:
    session.execute(text("SELECT 1"))
    return schemas.Health(
        status="ok",
        database="ok",
        version=__version__,
        outlets=session.scalar(select(func.count(Outlet.id))) or 0,
        last_rules_run=getattr(request.app.state, "last_rules_run", None),
    )


@router.get("/outlets", response_model=list[schemas.OutletSummary], tags=["outlets"])
def list_outlets(session: SessionDep, settings: SettingsDep) -> list[schemas.OutletSummary]:
    counts = _open_counts(session)
    return [views.outlet_summary(st, counts) for st in compute_states(session, settings)]


@router.get("/outlets/{code}", response_model=schemas.OutletDetail, tags=["outlets"])
def get_outlet(code: str, session: SessionDep, settings: SettingsDep) -> schemas.OutletDetail:
    return views.outlet_detail(_state_for(session, settings, code), _open_counts(session))


@router.get("/alerts", response_model=list[schemas.AlertOut], tags=["alerts"])
def list_alerts(
    session: SessionDep,
    status: str = Query("active", pattern="^(active|resolved|all)$"),
    limit: int = Query(200, ge=1, le=1000),
) -> list[schemas.AlertOut]:
    q = select(Alert).order_by(Alert.updated_at.desc()).limit(limit)
    if status == "active":
        q = q.where(Alert.status != ALERT_RESOLVED)
    elif status == "resolved":
        q = q.where(Alert.status == ALERT_RESOLVED)
    return views.alerts_out(session, list(session.scalars(q)))


@router.post("/alerts/{alert_id}/acknowledge", response_model=schemas.AlertOut, tags=["alerts"])
def acknowledge(alert_id: int, session: SessionDep, actor: ActorDep) -> schemas.AlertOut:
    try:
        alert = actions.acknowledge_alert(session, alert_id, actor)
    except actions.NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return views.alerts_out(session, [alert])[0]


@router.post(
    "/outlets/{code}/priority-indent", response_model=schemas.IndentOut, status_code=201, tags=["actions"]
)
def priority_indent(
    code: str, body: schemas.PriorityIndentIn, session: SessionDep, settings: SettingsDep, actor: ActorDep
) -> schemas.IndentOut:
    """Ask the supply team for a priority delivery. Creates a *Requested* indent and re-runs the rules."""
    st = _state_for(session, settings, code)
    product = body.product or (st.min_cover.product if st.min_cover else None)
    if product is None:
        raise HTTPException(422, "no product given and no stock data to choose one")
    today = business_date(now_utc(), settings.tz, settings.business_day_start_hour)
    try:
        indent = actions.request_priority_indent(
            session, code, actor, product=product, qty_kl=body.qty_kl, today=today, note=body.note
        )
    except actions.NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except actions.ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    run_rules(session, settings, wait=True)
    return schemas.IndentOut.model_validate(indent)


@router.post("/receipts/{receipt_id}/quality-hold", response_model=schemas.ReceiptOut, tags=["actions"])
def quality_hold(
    receipt_id: int, session: SessionDep, settings: SettingsDep, actor: ActorDep
) -> schemas.ReceiptOut:
    """Hold the tank that received this delivery and send a sample for testing."""
    try:
        receipt = actions.hold_receipt_for_testing(session, receipt_id, actor)
    except actions.NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    run_rules(session, settings, wait=True)
    return schemas.ReceiptOut.model_validate(receipt)


@router.get("/ui/snapshot", response_model=schemas.Snapshot, tags=["dashboard"])
def snapshot(session: SessionDep, settings: SettingsDep) -> schemas.Snapshot:
    """Everything the dashboard needs on load."""
    now = now_utc()
    states = compute_states(session, settings, at=now)
    counts = _open_counts(session)
    return schemas.Snapshot(
        area=views.area_out(session, states, now),
        outlets=[views.outlet_detail(s, counts) for s in states],
        alerts=views.alerts_out(session, views.active_alerts(session)),
    )


@router.get("/ui/live", response_model=schemas.Live, tags=["dashboard"])
def live(session: SessionDep, settings: SettingsDep) -> schemas.Live:
    """The fast-changing subset (stock, today's sales, alerts), for polling every few seconds."""
    now = now_utc()
    return schemas.Live(
        generated_at=now,
        outlets=[views.live_outlet(s) for s in compute_states(session, settings, at=now)],
        alerts=views.alerts_out(session, views.active_alerts(session)),
    )
