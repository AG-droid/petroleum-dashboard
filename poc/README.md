# Prahari: Sales Officer dashboard (proof of concept)

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
| **Map** (home) | Neutral dark map of the sales area that switches to satellite when you zoom into an outlet, with 3D tilt. 44 outlets coloured by status, 2 supply points, 14 tank trucks moving live, sales-area boundary. Extra layers under **Layers**: competitor outlets, sales heatmap, 3D volume columns. |
| **Area panel** | Four headline numbers, then tabs for **Priorities** (urgent items in plain English with one-click actions), **All alerts** (filterable by category) and **Activity** (dispatches, deliveries, incidents). |
| **Outlet panel** (click any outlet) | A one-line summary of the outlet's main issue, key numbers, and tabs for tanks and pumps, sales, supply and density checks, cameras, compliance, and the dealer's account and notes. Context actions: *Send a truck now*, *Hold tank & test*, *Reconnect automation*, *Call dealer*, *Schedule visit*. |
| **Supply & trucks** | Every tank truck with destination, load, progress and arrival time; outlets running lowest on fuel; supply-point status. |
| **Cameras** | Camera wall with simulated forecourt, entry (number plates), unloading bay and cash-room feeds, optional AI detection boxes and a detections feed. |
| **Compliance** | Upcoming licence and stamping renewals, open findings, and an inspection plan. |
| **Performance** | Area sales vs target, outlets furthest behind, sales by fuel, estimated market share, performance by outlet type. |
| **Assistant** | Ask questions in plain English ("which outlets may run dry?", "how is Maa Fuel Point doing?"). Answers are computed from the live data. Rule-based prototype, not an LLM yet. |
| **Search** | `⌘K` / `Ctrl+K` to jump to any outlet, truck, depot or view. |
| **Present mode** | Click **Present** (or open `#tour`) for a guided demo that drives the live dashboard: story cards, spotlight, captions and a demo cursor. `→` next, `←` back, `A` auto-play, `Esc` exit. |

## Suggested 5-minute demo script

1. **Open on the map.** The view flies in from India to Gurugram. Point out the four headline numbers and the moving trucks.
2. **Prevent a dry-out.** In *Priorities*, Royal Service Station's diesel runs out in about 13 hours and the order is on hold for payment. Press **Send a truck now**.
3. **Security.** Truck HR55 CF 6475 has stopped off route for 47 min with seals unverified. Press **Contact driver**.
4. **Quality.** Krishna Filling Station's last diesel delivery failed the density check. Press **Hold tank & test**.
5. **Zoom in.** Click any outlet to fly down to it in satellite 3D.
6. **Cameras.** Open the camera wall: detection boxes, number plates, an offline camera. Click a feed to enlarge it.
7. **Competition.** Turn on *Competitor outlets* under Layers, then open Maa Fuel Point: sales down about 20% after a new competitor opened.
8. **Assistant.** Ask "Summarise my area".

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
