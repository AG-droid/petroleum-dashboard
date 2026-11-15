"""Map domain state to API models (kept separate so the domain never depends on the API layer)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from prahari.api import schemas
from prahari.models import Alert, Depot, Outlet, SalesArea
from prahari.models.ops import ALERT_RESOLVED
from prahari.services.state import OutletState


def alerts_out(session: Session, alerts: list[Alert]) -> list[schemas.AlertOut]:
    codes = dict(session.execute(select(Outlet.id, Outlet.code)).tuples().all())
    out = []
    for a in alerts:
        item = schemas.AlertOut.model_validate(a)
        item.outlet_code = codes.get(a.outlet_id) if a.outlet_id else None
        out.append(item)
    return out


def active_alerts(session: Session) -> list[Alert]:
    return list(
        session.scalars(select(Alert).where(Alert.status != ALERT_RESOLVED).order_by(Alert.opened_at.desc()))
    )


def _tanks(st: OutletState) -> list[schemas.TankOut]:
    return [schemas.TankOut(**t.__dict__) for t in st.tanks]


def outlet_summary(st: OutletState, open_alerts: Counter[int]) -> schemas.OutletSummary:
    o, worst = st.outlet, st.min_cover
    return schemas.OutletSummary(
        code=o.code,
        sap_code=o.sap_code,
        name=o.name,
        market_class=o.market_class,
        category=o.category,
        lat=o.lat,
        lng=o.lng,
        is_automated=o.is_automated,
        automation_online=st.automation_online,
        min_days_cover=worst.days_cover if worst else None,
        min_cover_product=worst.product if worst else None,
        variation_pct=st.variation_pct,
        open_alerts=open_alerts.get(o.id, 0),
    )


def outlet_detail(st: OutletState, open_alerts: Counter[int]) -> schemas.OutletDetail:
    o = st.outlet
    return schemas.OutletDetail(
        **outlet_summary(st, open_alerts).model_dump(),
        ownership=o.ownership,
        locality=o.locality,
        road=o.road,
        address=o.address,
        dealer_name=o.dealer.name if o.dealer else None,
        monthly_target_kl=o.monthly_target_kl,
        business_date=st.business_date,
        last_automation_at=st.last_automation_at,
        tanks=_tanks(st),
        products={k: schemas.ProductOut(**v.__dict__) for k, v in st.products.items()},
        today_l=st.today_l,
        today_as_of=st.today_as_of,
        mtd_kl=round(st.mtd_kl, 3),
        history=st.history,
        indents=[schemas.IndentOut.model_validate(i) for i in st.open_indents],
        receipts=[schemas.ReceiptOut.model_validate(r) for r in st.receipts[:10]],
        licences=[
            schemas.LicenceOut(
                licence_type=lc.licence_type, licence_no=lc.licence_no, valid_upto=lc.valid_upto, days_left=d
            )
            for lc, d in st.licences
        ],
    )


def live_outlet(st: OutletState) -> schemas.LiveOutlet:
    return schemas.LiveOutlet(
        code=st.outlet.code,
        automation_online=st.automation_online,
        tanks=_tanks(st),
        today_l=st.today_l,
        today_as_of=st.today_as_of,
    )


def area_out(session: Session, states: list[OutletState], now: datetime) -> schemas.AreaOut:
    area = session.scalar(select(SalesArea).order_by(SalesArea.id).limit(1))
    depots = [
        {"code": d.code, "name": d.name, "lat": d.lat, "lng": d.lng} for d in session.scalars(select(Depot))
    ]
    return schemas.AreaOut(
        code=area.code if area else "",
        name=area.name if area else "No sales area loaded",
        divisional_office=area.divisional_office if area else None,
        state_office=area.state_office if area else None,
        boundary=area.boundary if area else None,
        depots=depots,
        business_date=states[0].business_date if states else now.date(),
        generated_at=now,
    )
