# Prahari: how the whole system works

Diagrams of the dashboard, the backend, how data moves through them, and how the system is
operated day to day. Each diagram has a short explanation underneath. The diagrams are written
in [Mermaid](https://mermaid.js.org/), so GitHub draws them and anyone can edit them as text.
Rendered copies are in [`img/`](img/).

All data shown by Prahari is synthetic. File layouts are *modelled on* registers and exports
common in Indian fuel retail; they are not an official oil-company specification.

| # | Diagram | Answers |
| --- | --- | --- |
| 1 | [The big picture](#1-the-big-picture) | Who uses Prahari, and where does its data come from? |
| 2 | [Two ways to run it](#2-two-ways-to-run-it) | What changes between the standalone demo and the full system? |
| 3 | [What runs on the laptop](#3-what-runs-on-the-laptop) | Which containers start, and how do they talk? |
| 4 | [Starting the system](#4-starting-the-system) | What happens, in order, when you type `make up`? |
| 5 | [Inside the backend](#5-inside-the-backend) | Which part of the code does what? |
| 6 | [Importing a file](#6-importing-a-file) | How does an Excel/CSV export become trusted data? |
| 7 | [The live feed](#7-the-live-feed) | How do tank-gauge and pump readings arrive every 30 seconds? |
| 8 | [Working out stock "now"](#8-working-out-stock-now) | How does Prahari know how much fuel is in a tank right now? |
| 9 | [The stock check (variation)](#9-the-stock-check-variation) | How is pilferage or leakage spotted? |
| 10 | [How alerts live and die](#10-how-alerts-live-and-die) | When does an alert open, update, get acknowledged, resolve? |
| 11 | [The rules](#11-the-rules) | What exactly raises each alert? |
| 12 | [Pressing "Send a truck now"](#12-pressing-send-a-truck-now) | What happens end to end when the Sales Officer acts? |
| 13 | [Inside the dashboard](#13-inside-the-dashboard) | How is the browser app put together? |
| 14 | [Present mode](#14-present-mode) | How does the guided demo drive the real screens? |
| 15 | [The data model](#15-the-data-model) | What is stored, and how is it linked? |
| 16 | [A demo day](#16-a-demo-day) | What should the presenter do, and when? |
| 17 | [Sharing it with others](#17-sharing-it-with-others) | How can a brother or tester try it? |
| 18 | [How the code is built](#18-how-the-code-is-built) | How does a change get from idea to commit? |

---

## 1. The big picture

```mermaid
flowchart LR
    subgraph People
        SO["Sales Officer<br/>(runs ~40–60 pumps)"]
        DLR["Dealer<br/>(runs one pump)"]
    end

    subgraph Sources["Where the data comes from"]
        FILES["Files the area already has<br/>outlet master · daily sales report<br/>dip register · truck receipts<br/>indent status · licence register"]
        AUTO["Outlet automation<br/>tank gauges + pump meters"]
        FUTURE["Later, with permission<br/>oil-company systems · truck GPS<br/>payments · dealer phone app"]
    end

    subgraph Prahari
        BE["Backend<br/>import · store · calculate<br/>raise alerts · record actions"]
        UI["Dashboard<br/>map · outlet pages · alerts<br/>buttons · Present mode"]
    end

    FILES -->|upload or folder import| BE
    AUTO -->|readings every 30 s| BE
    FUTURE -.->|not built yet| BE
    BE <-->|API| UI
    UI --> SO
    UI -.->|planned dealer view| DLR
```

Prahari sits between the data a sales area **already produces** and the people who act on it.
The backend turns scattered files and readings into one picture and decides what needs
attention; the dashboard shows it and lets the Sales Officer act. Dotted lines are planned,
not built.

---

## 2. Two ways to run it

```mermaid
flowchart TB
    START(["Open the dashboard"]) --> CHECK{"Is the Prahari<br/>backend reachable?<br/>(api.js checks /api/v1/ui/snapshot)"}

    CHECK -->|"No (or #demo in the URL)"| DEMO
    CHECK -->|Yes| LIVE

    subgraph DEMO["Standalone demo (no installation)"]
        D1["Everything simulated in the browser<br/>stock, sales, trucks, cameras, alerts"]
        D2["Badge: 'Demo data'"]
        D3["Run with: python3 -m http.server<br/>or poc/start.command"]
    end

    subgraph LIVE["With the backend (make up)"]
        L1["From the server: stock, today's sales,<br/>deliveries, indents, licences,<br/>automation status, supply / stock /<br/>quality / compliance alerts"]
        L2["Still simulated in the browser:<br/>truck movement, CCTV, single sales"]
        L3["Buttons call the API and are saved"]
        L4["Badge: 'Server · demo data'"]
    end
```

The same dashboard code runs both ways. Without a backend it is a self-contained demo, good for
a meeting with no setup. With the backend, the numbers come from imported files and the live
feed, and actions are recorded.

---

## 3. What runs on the laptop

```mermaid
flowchart TB
    BROWSER["Browser · http://localhost:8080"]
    DEV["Developer tools & tests · localhost:5433"]

    subgraph Docker["Docker Compose stack (deploy/docker-compose.yml)"]
        direction TB
        WEB["web · Caddy<br/>serves the dashboard files<br/>forwards /api (ingest blocked)"]
        subgraph Backend["backend image"]
            direction LR
            MIG["migrate<br/>one-shot at start:<br/>schema + today's sample data"]
            API["api · FastAPI<br/>rules scheduler every 60 s<br/>:8000 (internal only)"]
            FEED["feed<br/>demo automation feed<br/>posts every 30 s"]
        end
        DB[("db · PostgreSQL 16 + TimescaleDB")]
        VOL[["samples volume<br/>generated files + feed_state.json"]]
    end

    BROWSER -->|"pages, JS, /api/v1/*"| WEB
    WEB -->|"/api/v1/*"| API
    FEED -->|"POST /api/v1/ingest/automation"| API
    MIG -->|"migrations + imports"| DB
    API -->|"reads and writes"| DB
    MIG -->|writes| VOL
    VOL -->|"read at start"| FEED
    DEV -.-> DB
```

Five services, one command. The browser only ever talks to **web**, which serves the dashboard
files and forwards API calls. The machine-to-machine ingest endpoint is not reachable through
**web**; the feed posts straight to **api** on Docker's internal network. Ports are bound to
`127.0.0.1` unless you choose to share on your Wi-Fi.

---

## 4. Starting the system

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Make as make up
    participant DB as db
    participant Mig as migrate
    participant API as api
    participant Feed as feed
    participant Web as web

    You->>Make: make up
    Make->>DB: start, wait until healthy
    Make->>Mig: run once
    Mig->>DB: apply schema migrations (Alembic)
    Mig->>Mig: generate a month of sample files for today
    alt the data on file ends on an earlier day
        Mig->>DB: clear yesterday's generated history
    end
    Mig->>DB: import files (masters first) and run the rules
    Mig-->>Make: finished OK
    Make->>API: start, with the rules scheduler every 60 s
    API-->>Make: healthy (/api/v1/health)
    Make->>Feed: start posting readings every 30 s
    Make->>Web: start serving :8080
    You->>Web: open http://localhost:8080
```

Each service waits for the one before it to be ready. Running `make up` again on the same day is
harmless: identical files are skipped, and your requests and holds are kept.

---

## 5. Inside the backend

```mermaid
flowchart TB
    subgraph In["Getting data in · prahari.ingest"]
        FMT["formats.py<br/>column layouts of every file"]
        RD["reader.py<br/>finds the header under<br/>MIS title rows"]
        PR["parse.py<br/>dates, numbers, codes,<br/>product names"]
        IMP["importers.py<br/>validate each row,<br/>upsert, report rejects"]
        PIPE["pipeline.py<br/>detect format, order files,<br/>record an ImportJob"]
        AUT["automation.py<br/>live gauge + meter payloads"]
    end

    subgraph Core["Making sense of it"]
        DOM["domain/<br/>tank calibration · business day<br/>product names · demand curve"]
        ST["services/state.py<br/>stock now · days of cover<br/>today's sales · variation<br/>automation status"]
        RU["rules/engine.py<br/>alert rules + reconciliation"]
        ACT["services/actions.py<br/>priority request · quality hold<br/>acknowledge · audit log"]
    end

    subgraph Out["Serving it · prahari.api"]
        R1["routers/core.py<br/>outlets · alerts · actions<br/>dashboard snapshot / live"]
        R2["routers/ingest.py<br/>file upload · automation feed"]
        APP["app.py<br/>rules scheduler · error handling<br/>CORS · OpenAPI docs"]
    end

    DB[("PostgreSQL<br/>+ TimescaleDB")]

    FMT --> RD --> PIPE --> IMP
    PR --> IMP
    IMP --> DB
    AUT --> DB
    DOM --> ST
    DB --> ST --> RU --> DB
    ACT --> DB
    R1 --> ST
    R1 --> ACT
    R2 --> PIPE
    R2 --> AUT
    APP --> RU
```

A deliberate rule: **`state.py` is the only place raw records become figures** (stock, cover,
variation). The rules engine and every API response use it, so an alert and the screen that
explains it can never disagree.

---

## 6. Importing a file

```mermaid
flowchart TB
    F["An export arrives<br/>(.xlsx · .csv · sales-area .json)<br/>via upload or folder import"] --> H{"Identical file<br/>imported before?<br/>(SHA-256)"}
    H -->|yes| SKIP["Job: skipped"]
    H -->|no| DET{"Recognised header<br/>in the first 12 rows?"}
    DET -->|no| FAIL["Job: failed<br/>'no recognised header'"]
    DET -->|yes| KIND["Format detected<br/>(most specific match)"]
    KIND --> ROW["For each row"]
    ROW --> V1{"Every cell valid?<br/>dates · numbers · ranges<br/>known outlet / tank / nozzle<br/>product matches tank"}
    V1 -->|no| REJ["Row rejected,<br/>with column and reason"]
    V1 -->|yes| V2{"Same key already<br/>in this file?"}
    V2 -->|yes| DUP["Row rejected:<br/>'duplicate of row N'"]
    V2 -->|no| OK["Row accepted"]
    OK --> UP["Upsert on the natural key<br/>(re-importing never duplicates)"]
    REJ --> JOB
    DUP --> JOB
    UP --> JOB["ImportJob saved:<br/>succeeded · partial · failed<br/>with the first 200 errors"]
    JOB --> RULES["Rules re-run"]
```

Every file is checked row by row; good rows load, bad rows are reported with the reason, and
nothing is duplicated if the same data arrives twice. Examples of checks: a meter reading lower
than yesterday's, net sales that don't add up, a dip deeper than the tank, a SAP code not in the
outlet master. Water at the bottom of a tank is subtracted from the dip, because it isn't fuel.

**Import order** (masters first, because later files refer to them):

```mermaid
flowchart LR
    A["SALES_AREA.json<br/>area · depots · products"] --> B["RO_MASTER<br/>outlets · dealers"] --> C["TANK_MASTER"] --> D["NOZZLE_MASTER"]
    D --> E["LICENCE_REGISTER"] --> F["TT_RECEIPTS"] --> G["INDENT_STATUS"] --> H["DSR<br/>daily sales"] --> I["DIP_REGISTER"]
```

---

## 7. The live feed

```mermaid
sequenceDiagram
    autonumber
    participant Feed as Demo feed<br/>(stands in for outlet automation)
    participant API as API
    participant DB as Database
    participant Sch as Rules scheduler
    participant UI as Dashboard

    loop every 30 seconds
        Feed->>Feed: work out levels and meter totals for now<br/>(morning stock − sales so far, on the demand curve)
        Feed->>API: POST /ingest/automation (38 outlets)
        API->>API: check sites, tanks, nozzles, finite values,<br/>volume within tank capacity
        API->>DB: store tank and meter readings
        API-->>Feed: accepted / rejected counts
    end
    loop every 60 seconds
        Sch->>DB: compute every outlet's state, reconcile alerts
    end
    loop every 10 seconds
        UI->>API: GET /ui/live
        API-->>UI: stock, today's sales, automation status, alerts
    end
```

Real outlet automation would post the same payload. The feed skips the outlet scripted as
"automation offline", so the backend notices the silence and raises that alert by itself.
Today's sales at an automated outlet = latest meter reading − yesterday's closing meter reading.

---

## 8. Working out stock "now"

```mermaid
flowchart TB
    T["For each tank"] --> L["Latest reading in the last 3 days<br/>(one indexed lookup per tank)"]
    L --> N{"Any reading?"}
    N -->|no| UNK["Stock unknown<br/>(alerts for it are left as they are)"]
    N -->|yes| G{"Tank-gauge reading<br/>less than 2 hours old?"}
    G -->|yes| LIVE["Use it as is<br/>label: live from tank gauges"]
    G -->|"no (manual dip, or a gauge gone quiet)"| P["Project it forward"]
    P --> P1["− expected sales since the reading<br/>(7-day average × share of the day,<br/>following the hourly demand curve,<br/>across business days if needed)"]
    P1 --> P2["+ deliveries into this tank since<br/>(invoice − shortage)"]
    P2 --> P3["kept between 0 and tank capacity<br/>label: estimated"]
    LIVE --> COVER
    P3 --> COVER["Days of cover per product<br/>= stock ÷ average daily sales"]
```

Most pumps are dipped by hand once a morning, so Prahari doesn't pretend that number is still
true at 6 pm: it subtracts what has probably been sold since and adds any truck that has been
emptied into the tank. Everything projected is labelled as an estimate on screen.

**The business day** runs from the morning dip, not midnight:

```mermaid
flowchart LR
    A["06:00 IST<br/>morning dip<br/>= opening stock"] --> B["sales all day<br/>(peaks 08:00 and 18:00)"] --> C["next 06:00<br/>dip = closing stock<br/>= next day's opening"]
```

---

## 9. The stock check (variation)

```mermaid
flowchart LR
    O["Opening dip<br/>3 business days ago"] --> PLUS(("+"))
    R["Fuel received<br/>(invoice − shortage)"] --> PLUS
    PLUS --> MINUS(("−"))
    S["Net sales from the DSR<br/>(meter readings, test fuel excluded)"] --> MINUS
    MINUS --> BOOK["Book stock<br/>(what should be there)"]
    BOOK --> CMP{"Book − physical<br/>as % of sales"}
    PHYS["Closing dip today<br/>(what is there)"] --> CMP
    CMP -->|"over 0.5%"| ALERT["Alert: stock variation<br/>check for leaks, pilferage,<br/>meter error"]
    CMP -->|"within limit"| FINE["No alert"]
    CMP -->|"a dip or a day's DSR missing"| WAIT["Can't judge yet:<br/>existing alert kept"]
```

This is the classic outlet stock reconciliation, done automatically for every product at every
outlet, every minute. The 0.5% limit is an illustrative demo value, set in configuration.

---

## 10. How alerts live and die

```mermaid
stateDiagram-v2
    [*] --> Open: condition found
    Open --> Open: still true, details updated
    Open --> Acknowledged: Sales Officer acknowledges
    Acknowledged --> Acknowledged: still true, details updated
    Acknowledged --> Open: gets more severe
    Open --> Resolved: condition cleared
    Acknowledged --> Resolved: condition cleared
    Open --> Open: data missing, can't judge (kept)
    Resolved --> [*]: kept as history
```

Every condition has a stable key, for example `dry:GGN-104:HSD` (diesel at outlet GGN-104), so
the same problem never opens twice. When data is missing (the morning dip not in yet, the feed
down) an alert is **kept**, not closed, so it doesn't flap and lose its acknowledgement. Runs
are serialised with a database lock: the scheduler skips a tick if busy; a run caused by a
user's action waits up to 5 seconds and never undoes that action.

---

## 11. The rules

```mermaid
flowchart TB
    S["Outlet state<br/>(diagram 8)"] --> R1 & R2 & R3 & R4 & R5

    R1{"Supply · per product<br/>under 1.5 days of cover?"}
    R1 -->|"and nothing coming<br/>(order on hold or none)"| A1["CRITICAL · Dry-out risk"]
    R1 -->|"and an indent is pending,<br/>dispatched or requested (≤ 24 h)"| A2["LOW · Low stock, delivery coming"]

    R2{"Stock · 3-day variation<br/>over 0.5% of sales?"} -->|yes| A3["HIGH · Stock variation"]

    R3{"Quality · a delivery's density<br/>more than ±3.0 kg/m³ off invoice<br/>and not yet held?"} -->|"yes, per invoice"| A4["HIGH · Density mismatch"]

    R4{"Compliance · licence expires<br/>within 30 days?"} -->|"within 10"| A5["HIGH · Licence due"]
    R4 -->|"11 to 30"| A6["MEDIUM · Licence due"]

    R5{"Equipment · automated outlet<br/>silent for 2 h while the<br/>feed is running elsewhere?"} -->|yes| A7["HIGH · Automation offline"]
```

All thresholds are settings (`PRAHARI_RULE_*`), not code. Camera, nozzle, truck-route,
complaint and credit alerts are still produced by the dashboard's simulation; they move to the
server when real sources for them exist.

---

## 12. Pressing "Send a truck now"

```mermaid
sequenceDiagram
    autonumber
    actor SO as Sales Officer
    participant UI as Dashboard (api.js)
    participant Web as web (Caddy)
    participant API as API
    participant DB as Database
    participant Rules as Rules engine

    SO->>UI: clicks "Send a truck now" on the diesel dry-out alert
    UI->>UI: shows a simulated truck loading at the nearest depot,<br/>hides the alert optimistically
    UI->>Web: POST /outlets/GGN-104/priority-indent<br/>{product: HSD} + X-Prahari-User header
    Web->>API: forward
    API->>API: header present? (blocks cross-site requests)<br/>product valid? outlet exists?
    API->>DB: cancel this outlet's expired requests
    alt an open indent already covers diesel
        API-->>UI: 200, the existing indent
    else
        API->>DB: insert indent "Requested" (one open request per outlet and product)
        API->>DB: audit log: who, what, when, which orders were on hold
        API->>Rules: re-run now (wait ≤ 5 s for the lock)
        Rules->>DB: resolve dry:GGN-104:HSD, open low:GGN-104:HSD
        API-->>UI: 201, the new indent
    end
    UI->>API: GET /ui/snapshot
    API-->>UI: fresh state and alerts
    UI-->>SO: alert now reads "Low diesel, delivery requested"
```

The button no longer conjures a truck: it files a **request** that the supply team would act
on, recorded with who asked. If nobody acts on it within 24 hours it stops counting as "fuel
coming" and the dry-out alert returns. "Hold tank & test" works the same way, holding every tank
that received the failed delivery.

---

## 13. Inside the dashboard

```mermaid
flowchart TB
    HTML["index.html"] --> MAIN["main.js<br/>startup"]

    MAIN --> APIJS["api.js<br/>connect to backend?"]
    APIJS -->|connected| OVR["overlay server data onto<br/>the outlet objects, poll every 10 s,<br/>route buttons to the API"]

    DATA["data.js<br/>the synthetic Gurugram world<br/>44 outlets · 2 depots · 14 trucks<br/>scripted storylines · IST clock"]
    SIM["sim.js<br/>1-second tick: sales, tanks,<br/>trucks, alert rules<br/>(skips what the server owns)"]
    MAP["map.js<br/>MapLibre map, satellite,<br/>markers, layers"]
    UIJS["ui.js<br/>panels, outlet pages, views,<br/>search, toasts"]
    CCTV["cctv.js<br/>drawn camera feeds<br/>with AI-style overlays"]
    CH["charts.js"]
    TOUR["tour.js<br/>Present mode"]
    VEND["vendor/maplibre<br/>(works offline)"]

    MAIN --> SIM & UIJS & MAP
    DATA --> SIM & MAP & UIJS
    OVR --> DATA
    SIM --> UIJS
    UIJS --> CCTV & CH
    MAP --> VEND
    TOUR --> UIJS & MAP
```

Plain HTML, CSS and JavaScript, with no build step. `data.js` defines the world; `sim.js` keeps
it moving; `api.js`, when a backend is present, replaces the simulated numbers with real ones.
All times are shown in India time, whatever the viewer's time zone.

---

## 14. Present mode

```mermaid
flowchart LR
    P["Click Present<br/>(or open #tour)"] --> HERO["Story cards<br/>the problem today"]
    HERO --> MAPS["Live map and<br/>day at a glance"]
    MAPS --> OUT["Open the dry-out outlet<br/>tank levels, live sales"]
    OUT --> ACT1["Demo cursor clicks<br/>'Send a truck now'"]
    ACT1 --> TRUCK["Truck stopped off route<br/>→ 'Contact driver'"]
    TRUCK --> DEN["Density failure<br/>→ 'Hold tank'"]
    DEN --> MORE["Cameras · competition<br/>supply · performance<br/>compliance · assistant"]
    MORE --> END["What happens next<br/>how you can help · thank you"]
```

21 steps. A spotlight, caption card and demo cursor drive the **real** screens and press real
buttons, so with the backend running the actions are genuinely recorded. Keys: → next,
← back, A auto-play, Esc exit.

---

## 15. The data model

```mermaid
erDiagram
    SALES_AREA ||--o{ OUTLET : contains
    DEALER ||--o{ OUTLET : operates
    OUTLET ||--o{ TANK : has
    OUTLET ||--o{ NOZZLE : has
    OUTLET ||--o{ LICENCE : holds
    OUTLET ||--o{ INDENT : orders
    OUTLET ||--o{ RECEIPT : receives
    OUTLET ||--o{ ALERT : raises
    PRODUCT ||--o{ TANK : stores
    PRODUCT ||--o{ NOZZLE : dispenses
    TANK ||--o{ TANK_READING : "dips and gauge readings"
    NOZZLE ||--o{ TOTALIZER_READING : "live meter readings"
    NOZZLE ||--o{ NOZZLE_DAILY_SALES : "daily sales report"

    OUTLET {
        string code "GGN-104"
        string sap_code "oil company's customer code"
        string category "Highway, Urban, Rural"
        bool is_automated
    }
    TANK {
        int tank_no
        float capacity_kl
        float diameter_mm "for dip calibration"
        float length_mm
    }
    TANK_READING {
        timestamptz observed_at "hypertable"
        string source "dip_register or automation"
        float volume_l "product only, water excluded"
    }
    TOTALIZER_READING {
        timestamptz observed_at "hypertable"
        float totalizer_l
    }
    NOZZLE_DAILY_SALES {
        date business_date
        float opening_l
        float closing_l
        float net_sale_l
    }
    RECEIPT {
        string invoice_no
        float invoice_qty_kl
        float invoice_density_15
        float observed_density_15
        bool quality_hold
    }
    INDENT {
        string indent_no
        string status "Pending, On hold, Requested, Dispatched, Delivered"
        string source "import or prahari"
    }
    ALERT {
        string key "dry:GGN-104:HSD"
        string severity
        string status "open, acknowledged, resolved"
    }
```

Also stored: **depots**, **import jobs** (every file, with its rejected rows) and the
**audit log** (every user action). Readings live in TimescaleDB hypertables, which stay fast as
a live feed adds thousands of rows an hour.

---

## 16. A demo day

```mermaid
flowchart TB
    A["Morning, before the meeting<br/>make up (or make demo-data)"] --> B{"New business day<br/>since the last run?"}
    B -->|yes| C["Yesterday's generated history cleared,<br/>a fresh month imported<br/>(your earlier requests and holds go too)"]
    B -->|no| D["Nothing changes:<br/>files already imported are skipped"]
    C --> E["Check http://localhost:8080<br/>badge says 'Server · demo data'"]
    D --> E
    E --> F["During the day<br/>the feed drains tanks along the demand curve,<br/>the dry-out outlet stays 'about to run dry'"]
    F --> G["In the meeting<br/>Present (auto-play with A) or explore freely"]
    G --> H["Afterwards<br/>make down (data kept) · make reset (start clean)"]
```

The demo day starts at 06:00 IST. The scripted outlets are set up so their stories stay true all
day: the dry-out outlet starts with about a day's diesel, so it is urgent but not yet empty.

---

## 17. Sharing it with others

```mermaid
flowchart TB
    Q{"Who needs to see it?"}
    Q -->|"technical, has Docker"| C1["They clone the repo and run make up<br/>(needs the branch pushed)"]
    Q -->|"in the same room / Wi-Fi"| C2["PRAHARI_BIND=0.0.0.0 make up<br/>make lan-url → http://192.168.x.x:8080"]
    Q -->|"named people elsewhere"| C3["Tailscale: invite them,<br/>share http://your-laptop:8080"]
    Q -->|"one-off remote demo"| C4["cloudflared tunnel → temporary<br/>https://….trycloudflare.com link"]
    Q -->|"no setup at all"| C5["Standalone demo:<br/>send the repo link or a screen recording"]
    C2 & C3 & C4 --> W["No login yet: share only with people you trust,<br/>close links afterwards, keep the laptop awake"]
```

---

## 18. How the code is built

```mermaid
flowchart LR
    BR["Feature branch<br/>feature/…  fix/…"] --> IMPL["Implement in<br/>small steps"]
    IMPL --> CHK{"make check<br/>ruff · mypy strict<br/>72 tests on real DB<br/>migration drift"}
    CHK -->|fails| IMPL
    CHK -->|passes| REV["code-reviewer agent<br/>(.claude/agents)<br/>blocker · major · minor · nit"]
    REV --> FIX["Fix blockers + majors<br/>(minor/nit when cheap)"]
    FIX --> CHK2{"make check<br/>again"}
    CHK2 --> COMMIT["Commit locally<br/>one per feature or fix"]
    COMMIT -.->|"only when asked"| PUSH["Push"] -.-> CI["GitHub Actions CI<br/>same checks + image build<br/>+ dashboard syntax"]
```

The working agreement is in [`CLAUDE.md`](../../CLAUDE.md). The reviewer has already run twice on
the backend: the first pass found 2 blockers and 7 major issues, the second confirmed the fixes
and caught 3 problems the fixes had introduced. All were fixed before committing.
