"""HTTP API: the endpoints the dashboard and integrations use."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from prahari.config import Settings
from prahari.feed import build_batch


def test_health(client: TestClient) -> None:
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok" and body["outlets"] == 44


def test_snapshot_has_everything_the_dashboard_needs(client: TestClient) -> None:
    snap = client.get("/api/v1/ui/snapshot").json()
    assert snap["area"]["code"] == "GGN-RSA" and len(snap["area"]["boundary"]) > 3
    assert len(snap["outlets"]) == 44
    rss = next(o for o in snap["outlets"] if o["code"] == "990104")
    assert rss["min_cover_product"] == "HSD" and rss["min_days_cover"] < 1.5
    assert any(i["status"] == "On hold" for i in rss["indents"])
    assert len(rss["history"]) == 30 and {t["source"] for t in rss["tanks"]} == {"dip_register"}
    keys = {a["key"] for a in snap["alerts"]}
    assert "dry:990104:HSD" in keys and any(k.startswith("den:990109:") for k in keys)


def test_outlet_detail_and_404(client: TestClient) -> None:
    assert client.get("/api/v1/outlets/990109").json()["receipts"][0]["density_diff"] > 3
    assert client.get("/api/v1/outlets/NOPE").status_code == 404


def test_priority_indent_endpoint(client: TestClient) -> None:
    r = client.post("/api/v1/outlets/990104/priority-indent", json={"note": "dry-out"})
    assert r.status_code == 201 and r.json()["product_code"] == "HSD"
    keys = {a["key"] for a in client.get("/api/v1/alerts").json()}
    assert "dry:990104:HSD" not in keys and "low:990104:HSD" in keys
    assert client.post("/api/v1/outlets/990104/priority-indent", json={"product": "XP"}).status_code == 409


def test_quality_hold_endpoint(client: TestClient) -> None:
    rid = client.get("/api/v1/outlets/990109").json()["receipts"][0]["id"]
    assert client.post(f"/api/v1/receipts/{rid}/quality-hold").json()["quality_hold"] is True
    assert not any(a["key"].startswith("den:990109:") for a in client.get("/api/v1/alerts").json())


def test_acknowledge(client: TestClient) -> None:
    alert = client.get("/api/v1/alerts").json()[0]
    assert client.post(f"/api/v1/alerts/{alert['id']}/acknowledge").json()["status"] == "acknowledged"
    assert client.post("/api/v1/alerts/999999/acknowledge").status_code == 404


def test_upload_validation(client: TestClient, samples_dir: Path) -> None:
    assert (
        client.post("/api/v1/imports", files={"file": ("x.pdf", b"%PDF", "application/pdf")}).status_code
        == 415
    )
    licences = (samples_dir / "01_compliance" / "LICENCE_REGISTER.csv").read_bytes()
    r = client.post(
        "/api/v1/imports?force=true", files={"file": ("../../etc/LICENCE_REGISTER.csv", licences, "text/csv")}
    )
    assert r.status_code == 201
    job = r.json()
    assert job["filename"] == "LICENCE_REGISTER.csv" and job["status"] == "succeeded"  # path stripped
    assert job["submitted_by"] == "test-user"
    assert client.get(f"/api/v1/imports/{job['id']}").json()["id"] == job["id"]


def test_automation_feed_gives_live_stock_and_sales(
    client: TestClient, settings: Settings, samples_dir: Path
) -> None:
    state = json.loads((samples_dir / "feed_state.json").read_text())
    batch = build_batch(state, datetime.now(UTC), settings.tz)
    result = client.post("/api/v1/ingest/automation", json=batch).json()
    assert result["sites_accepted"] == len(batch["snapshots"]) and not result["rejected"]

    live = {o["code"]: o for o in client.get("/api/v1/ui/live").json()["outlets"]}
    auto = next(s["ro_code"] for s in state["sites"] if s["automated"] and s["online"])
    assert {t["source"] for t in live[auto]["tanks"]} == {"automation"}
    assert live[auto]["today_l"] is not None and all(v >= 0 for v in live[auto]["today_l"].values())
    # The scripted offline outlet sends nothing, so once the feed is active it shows as offline.
    assert live["990127"]["automation_online"] is False


def test_automation_rejects_unknown_references(client: TestClient) -> None:
    r = client.post(
        "/api/v1/ingest/automation",
        json={
            "snapshots": [
                {
                    "site_id": "000000",
                    "observed_at": "2026-11-15T10:00:00+05:30",
                    "tanks": [{"tank_no": 1, "volume_l": 5}],
                }
            ]
        },
    )
    assert r.json()["rejected"] == ["000000: unknown site"]
    bad = client.post(
        "/api/v1/ingest/automation",
        json={"snapshots": [{"site_id": "x", "observed_at": "2026-11-15T10:00:00", "tanks": []}]},
    )
    assert bad.status_code == 422  # timestamps must carry a time zone


def test_state_changing_requests_need_the_app_header(client: TestClient) -> None:
    """A cross-site form or no-cors fetch can't add custom headers, so it is refused (CSRF)."""
    alert = client.get("/api/v1/alerts").json()[0]
    r = client.post(f"/api/v1/alerts/{alert['id']}/acknowledge", headers={"X-Prahari-User": ""})
    assert r.status_code == 403
    assert client.get("/api/v1/alerts").json()[0]["status"] == "open"


def test_priority_indent_accepts_common_product_names(client: TestClient) -> None:
    first = client.post("/api/v1/outlets/990104/priority-indent", json={"product": "diesel"})
    assert first.status_code == 201 and first.json()["product_code"] == "HSD"
    again = client.post("/api/v1/outlets/990104/priority-indent", json={"product": "HSD"})
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert client.post("/api/v1/outlets/990104/priority-indent", json={"product": "FOO"}).status_code == 422


def test_upload_size_limit(client: TestClient, settings: Settings) -> None:
    settings.max_upload_mb = 1
    big = b"x" * (1024 * 1024 + 10)
    assert client.post("/api/v1/imports", files={"file": ("big.csv", big, "text/csv")}).status_code == 413


def test_dashboard_dispatch_picks_the_product_with_nothing_coming(client: TestClient) -> None:
    """990114: petrol is low but a truck is dispatched; make diesel run dry too → diesel is requested."""
    from sqlalchemy import select

    from prahari.db.session import session_scope
    from prahari.models import Outlet, TankReading

    with session_scope() as s:
        outlet = s.scalar(select(Outlet).where(Outlet.code == "990114"))
        assert outlet is not None
        for tank in outlet.tanks:
            if tank.product_code == "HSD":
                for r in s.scalars(select(TankReading).where(TankReading.tank_id == tank.id)):
                    r.volume_l = 20.0
    r = client.post("/api/v1/outlets/990114/priority-indent", json={})
    assert r.status_code == 201 and r.json()["product_code"] == "HSD"


def test_automation_rejects_infinity_and_overfull_tanks(client: TestClient) -> None:
    sap = client.get("/api/v1/outlets/990101").json()["code"]
    snap = {
        "site_id": sap,
        "observed_at": "2026-11-15T10:00:00+05:30",
        "tanks": [{"tank_no": 1, "volume_l": 1.0}],
    }
    snap["tanks"][0]["volume_l"] = float("inf")
    body = json.dumps({"snapshots": [snap]})  # serialised as the non-standard token Infinity
    r = client.post("/api/v1/ingest/automation", content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    over = client.post(
        "/api/v1/ingest/automation",
        json={
            "snapshots": [
                {
                    "site_id": sap,
                    "observed_at": "2026-11-15T10:00:00+05:30",
                    "tanks": [{"tank_no": 1, "volume_l": 1e7}],
                }
            ]
        },
    )
    assert "exceeds capacity" in over.json()["rejected"][0]
