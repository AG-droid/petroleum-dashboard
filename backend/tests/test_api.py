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
    assert snap["area"]["code"] == "GGN-SA" and len(snap["area"]["boundary"]) > 3
    assert len(snap["outlets"]) == 44
    rss = next(o for o in snap["outlets"] if o["code"] == "GGN-104")
    assert rss["min_cover_product"] == "HSD" and rss["min_days_cover"] < 1.5
    assert any(i["status"] == "On hold" for i in rss["indents"])
    assert len(rss["history"]) == 30 and {t["source"] for t in rss["tanks"]} == {"dip_register"}
    keys = {a["key"] for a in snap["alerts"]}
    assert "dry:GGN-104:HSD" in keys and any(k.startswith("den:GGN-109:") for k in keys)


def test_outlet_detail_and_404(client: TestClient) -> None:
    assert client.get("/api/v1/outlets/GGN-109").json()["receipts"][0]["density_diff"] > 3
    assert client.get("/api/v1/outlets/NOPE").status_code == 404


def test_priority_indent_endpoint(client: TestClient) -> None:
    r = client.post("/api/v1/outlets/GGN-104/priority-indent", json={"note": "dry-out"})
    assert r.status_code == 201 and r.json()["product_code"] == "HSD"
    keys = {a["key"] for a in client.get("/api/v1/alerts").json()}
    assert "dry:GGN-104:HSD" not in keys and "low:GGN-104:HSD" in keys
    assert client.post("/api/v1/outlets/GGN-104/priority-indent", json={"product": "XP"}).status_code == 409


def test_quality_hold_endpoint(client: TestClient) -> None:
    rid = client.get("/api/v1/outlets/GGN-109").json()["receipts"][0]["id"]
    assert client.post(f"/api/v1/receipts/{rid}/quality-hold").json()["quality_hold"] is True
    assert not any(a["key"].startswith("den:GGN-109:") for a in client.get("/api/v1/alerts").json())


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
    auto = next(s["code"] for s in state["sites"] if s["automated"] and s["online"])
    assert {t["source"] for t in live[auto]["tanks"]} == {"automation"}
    assert live[auto]["today_l"] is not None and all(v >= 0 for v in live[auto]["today_l"].values())
    # The scripted offline outlet sends nothing, so once the feed is active it shows as offline.
    assert live["GGN-127"]["automation_online"] is False


def test_automation_rejects_unknown_references(client: TestClient) -> None:
    r = client.post(
        "/api/v1/ingest/automation",
        json={
            "snapshots": [
                {
                    "site_id": "00000000",
                    "observed_at": "2026-11-15T10:00:00+05:30",
                    "tanks": [{"tank_no": 1, "volume_l": 5}],
                }
            ]
        },
    )
    assert r.json()["rejected"] == ["00000000: unknown site"]
    bad = client.post(
        "/api/v1/ingest/automation",
        json={"snapshots": [{"site_id": "x", "observed_at": "2026-11-15T10:00:00", "tanks": []}]},
    )
    assert bad.status_code == 422  # timestamps must carry a time zone
