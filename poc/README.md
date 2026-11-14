# PRAHARI — Retail Network Command (Proof of Concept)

A clickable, live-simulated command dashboard for an oil company **Sales Officer**, set in the **Gurugram Sales Area**. Every outlet, dealer, tanker, number and camera feed is **synthetic**: generated from a fixed seed, so it looks the same on every load.

## How to run

**Easiest:** double-click `start.command` (macOS). It starts a local server and opens the browser.

**Or from a terminal:**

```bash
cd poc            # from the repository root
python3 -m http.server 8080
# then open http://localhost:8080
```

An internet connection is needed for the satellite imagery, map library and fonts. Best viewed in Chrome at 1440 px width or more.

## What's in it

| Area | What it shows |
| --- | --- |
| **Ops map** (home) | Satellite / dark basemap of the sales area with 3D tilt. 44 outlets colour-coded by health, 2 supply points, 14 tank trucks moving live along their routes, sales-area boundary. Optional layers: competitor outlets, sales heatmap, 3D volume columns. |
| **Area panel** | Today's sales vs plan, month-to-date vs target, network health, dry-out risks, truck status, compliance due. Auto-generated *Priority actions* and a live, filterable alert feed (supply, stock, quality, security, compliance, equipment, commercial). |
| **Outlet 360** (click any outlet) | Health score, live sales by product, tank gauges with days of cover, nozzle status, live transactions, CCTV, sales trends vs target, local market share, deliveries and density checks, stock variation, licences and inspections, complaints, dealer credit and field notes. Context actions: priority dispatch, hold tank, ping automation, call dealer, schedule inspection. |
| **Supply** | Every tank truck with route, load, progress and ETA; a replenishment watchlist; supply-point status. |
| **CCTV** | Camera wall with simulated forecourt, entry (ANPR), decantation bay and cash-room feeds, an AI-vision overlay (vehicle and person detection, queue length, number plates) and an AI event stream. |
| **Comply** | Upcoming licence and stamping renewals, open irregularities, and an inspection planner. |
| **Analytics** | Area sales vs target, weakest outlets, product mix, estimated market share, performance by category. |
| **Copilot** | Ask questions in plain English ("which outlets may dry out?", "tell me about Maa Fuel Point"). Answers are computed from the live data. This is a rule-based prototype, not an LLM yet. |
| **Search** | `⌘K` / `Ctrl+K` to jump to any outlet, tank truck, depot or view. |

## Suggested 5-minute demo script

1. **Open on the map.** The view flies in from India to Gurugram. Point out the live trucks, health colours and the ticker at the bottom.
2. **Priority actions.** Click the dry-out risk outlet. Show the diesel tank at about 0.5 days, the indent held for payment, then press **⚡ Priority dispatch** and watch the alert resolve into "tanker en route".
3. **Security story.** Click the halted tank truck in Priority actions: off-route for 47 min, seals unverified. Press **Contact driver & resume**.
4. **Quality.** Open the outlet with a density mismatch, go to the Supply tab and use **Hold tank & sample**.
5. **CCTV.** Open the CCTV wall: AI boxes, number plates, offline cameras. Click a feed to enlarge it.
6. **Competition.** Turn on *Competitor outlets*, then open Maa Fuel Point: volume down about 20% after a new competitor opened.
7. **Copilot.** Ask "Summarise my area right now".

## Deep links (handy for demos)

- `http://localhost:8080/#outlet=GGN-104`: open an outlet directly (add `&tab=cameras|sales|supply|compliance|dealer`)
- `http://localhost:8080/#view=surveillance`: open a view (`outlets`, `logistics`, `surveillance`, `compliance`, `analytics`, `copilot`)

## Code layout

```
poc/
├── index.html        layout shell
├── css/styles.css    theme and components
└── js/
    ├── data.js       synthetic data generator (outlets, tanks, trucks, competitors, scripted storylines)
    ├── sim.js        1-second live simulation + alert rules engine + UI actions
    ├── map.js        MapLibre map, markers, layers
    ├── cctv.js       procedurally drawn CCTV feeds with AI overlay
    ├── charts.js     small canvas charts
    ├── ui.js         panels, views, outlet 360, copilot, search
    └── main.js       startup
```

No build step and no backend: plain HTML/CSS/JS. Third-party: MapLibre GL JS (map rendering), Esri World Imagery and reference tiles (basemaps), Google Fonts.

## What's simulated vs. what would be real

Everything here is simulated. In a real pilot the data would come from the SO's existing MIS/Excel extracts, a dealer app, and later, with OMC approval, ATG, Retail Automation and VTS feeds. See [`docs/planning/architecture-and-scaling.md`](../docs/planning/architecture-and-scaling.md).
