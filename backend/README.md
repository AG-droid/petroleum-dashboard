# Prahari backend

The backend turns Prahari from a self-contained demo into a working system: it **takes in data**
from the files and feeds a sales area already produces, **stores** it with history, **works out**
each outlet's state (stock, days of cover, sales, stock variation, automation status), **raises
alerts** on its own, **records actions** (who asked for what) and **serves** the dashboard.

All data is synthetic. The file layouts are modelled on registers and MIS extracts commonly kept
at Indian retail outlets; they are not an official oil-company specification.

---

## Run it

You need **Docker** (Docker Desktop, or OrbStack on a Mac) and **git**. Nothing else.

```bash
git clone https://github.com/AG-droid/petroleum-dashboard.git
cd petroleum-dashboard
make up            # or: docker compose -f deploy/docker-compose.yml up -d --build
```

Open **http://localhost:8080**. The badge in the top bar reads **Server · demo data** when the
dashboard is using the backend. API docs are at **http://localhost:8080/api/docs**.

The first start takes a few minutes (it builds the image). It then generates a month of sample
files for today, imports them, and starts a feed that posts live tank-gauge and pump readings every
30 seconds.

| Command | What it does |
| --- | --- |
| `make up` / `make down` | Start / stop the stack (data is kept) |
| `make logs` | Follow the logs |
| `make demo-data` | Generate and import a fresh day of sample data (do this each morning; the demo day starts at 06:00 IST). On a new day it **clears** the previous day's sales, dips, deliveries and indents, including anything you uploaded or requested, so the new month is consistent. Re-running on the same day keeps everything. `make up` does the same. |
| `make reset` | Delete everything and start again |
| `make check` | Lint, strict type checks, tests and migration check |

Windows without `make`: use the `docker compose -f deploy/docker-compose.yml ...` commands shown in
the `Makefile`.

---

## Let other people try it

| Option | Who it suits | How |
| --- | --- | --- |
| **Clone and run** | Your brother, technical testers | They follow *Run it* above on their own machine. Nothing is shared from your laptop. |
| **Same Wi-Fi** | Someone in the room | `PRAHARI_BIND=0.0.0.0 make up`, then `make lan-url` prints an address like `http://192.168.1.20:8080` to give them. Your laptop must stay awake. |
| **Private link over the internet** | Named testers elsewhere | Install [Tailscale](https://tailscale.com) on your laptop and theirs, invite them to your tailnet, and share `http://<your-laptop>:8080`. Only invited people can reach it. |
| **Temporary public link** | A one-off remote demo | With [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) installed: `cloudflared tunnel --url http://localhost:8080` prints an `https://….trycloudflare.com` address. Stop it (Ctrl+C) after the demo. |

**Before using either internet option, know that there is no login yet.** Anyone with the
address can see the dashboard and press its buttons (which create indents, holds and
acknowledgements in your local database). The data is synthetic, so the risk is low, but share
links only with people you trust and close them afterwards. Logins and roles are the next
milestone.

---

## How it works

```
 sample files (OMC-style)          live automation feed
 xlsx / csv / json                 (tank gauges + pump totalisers)
        │                                    │
        ▼  POST /api/v1/imports              ▼  POST /api/v1/ingest/automation
 ┌──────────────────────────────────────────────────────────────┐
 │ importers: detect format → validate every row → upsert       │
 │            (idempotent; rejected rows reported with reasons)  │
 │ state service: stock now, days of cover, today's sales,      │
 │            book-vs-physical variation, automation status      │
 │ rules engine (every 60 s): open / update / resolve alerts    │
 │ actions: priority indent requests, quality holds, acks       │
 │            → each one written to the audit log                │
 └──────────────────────────────────────────────────────────────┘
        │  PostgreSQL 16 + TimescaleDB (readings are hypertables)
        ▼
  GET /api/v1/ui/snapshot  +  GET /api/v1/ui/live (polled)  →  dashboard
```

| Module | Responsibility |
| --- | --- |
| `prahari.ingest.formats` | Column layouts of every accepted file |
| `prahari.ingest.importers`, `pipeline` | Validation, upserts, import jobs |
| `prahari.ingest.automation` | Live tank-gauge / totaliser payloads |
| `prahari.services.state` | The only place raw records become outlet state |
| `prahari.rules.engine` | Alert rules + reconciliation with the alert table |
| `prahari.services.actions` | User actions, each audited |
| `prahari.api` | FastAPI app, routers, response models |
| `prahari.samples.generator` | Consistent synthetic month of source files |
| `prahari.feed` | Demo automation feed (talks to the API over HTTP only) |
| `prahari.domain` | Pure logic: tank calibration, business days, products |

### The sample data

`make up` (or `prahari seed-demo`) generates, for the 44 Gurugram outlets shown in the dashboard:

| File | Contents |
| --- | --- |
| `00_master/SALES_AREA.json` | Sales area, boundary, depots, products |
| `00_master/RO_MASTER.xlsx` | Outlets (SAP customer code, category, location, dealer) |
| `00_master/TANK_MASTER.xlsx` | Tanks with dimensions for dip calibration |
| `00_master/NOZZLE_MASTER.csv` | Dispensing units and nozzles |
| `01_compliance/LICENCE_REGISTER.csv` | PESO, stamping, fire NOC, pollution consent with expiry dates |
| `02_supply/TT_RECEIPTS_*.xlsx` | Tank-truck deliveries per tank, with density checks |
| `02_supply/INDENT_STATUS_*.csv` | Orders and their status (incl. one on payment hold) |
| `03_sales/DSR_*.xlsx` | Daily sales report: opening/closing totaliser per nozzle |
| `04_stock/DIP_REGISTER_*.csv` | Morning dips (mm) per tank; volume comes from calibration |

The month is internally consistent (totalisers carry over; stock = previous dip + receipts − sales −
losses), so the variation rule only fires where the story says it should. The column layouts are
in `src/prahari/ingest/formats.py`; when real exports are available, adapt them there.

### Storylines (same as the dashboard)

| Outlet | What the backend finds |
| --- | --- |
| GGN-104 Royal Service Station | Diesel about to run out, order on payment hold → **critical**. "Send a truck now" raises a priority indent and it drops to low |
| GGN-109 Krishna Filling Station | Last diesel delivery +4.2 kg/m³ against the invoice → **high**. "Hold tank" holds every tank it went into |
| GGN-121 Cyber Fuel Centre | Book-vs-physical stock variation above 0.5% over 3 days |
| GGN-131 / GGN-118 | PESO licence / stamping due within 10 days |
| GGN-114 Gurukul Fuels | Low petrol, but a truck is dispatched → low |
| GGN-127 Gurukul Auto Fuels | Automation sends nothing → "automation offline" once the feed is running |

---

## Develop

```bash
make dev      # native Python 3.12 environment via uv (backend/.venv)
make db       # just the database, on localhost:5433
make check    # ruff, mypy --strict, pytest (against a real TimescaleDB), alembic check
```

CLI (`uv run prahari --help` inside `backend/`): `db-upgrade`, `generate-samples`, `import <files|dirs>`,
`rules`, `seed-demo`, `feed`, `serve`.

Configuration is through `PRAHARI_*` environment variables (see `src/prahari/config.py`), including
every rule threshold (`PRAHARI_RULE_VARIATION_PCT`, `PRAHARI_RULE_DRY_OUT_DAYS`, …).

Working agreement (branches, review agent, commits) is in [`../CLAUDE.md`](../CLAUDE.md).

### Not built yet (by design)

Logins and roles · the task list behind every request · notifications (email/WhatsApp) · the
AI assistant on real data · real hardware or oil-company system connections. See the planning notes.
