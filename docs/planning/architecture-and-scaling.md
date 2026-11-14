# Architecture & Scaling: From Forecourt Hardware to a Production Platform

Nov 14, 2026

**Short answer:** pull hardware data through the systems that already collect it, not by wiring into dispensers yourself. Grow the architecture in steps, never building ahead of real need. Build a real engineering team and process around the code, with AI as an accelerator, not the owner.

---

## 1. Hardware at the forecourt: what exists and how it talks

| Device | What it knows | Common makers (examples) | How it communicates |
| --- | --- | --- | --- |
| Dispenser / MPD (the "nozzle") | Every transaction: litres, amount, nozzle, time; totaliser readings; errors | Gilbarco Veeder-Root, Tokheim, Dover/Wayne, Midco and others | Proprietary pump protocols (current-loop or RS-485), sometimes IFSF; controlled by a forecourt controller |
| ATG (Automatic Tank Gauge) | Fuel level, volume, water level, temperature per tank; delivery detection; leak tests | Veeder-Root (TLS series), Franklin Fueling, OPW, Start Italiana and others | Serial (RS-232/485) or TCP/IP with a documented command protocol (Veeder-Root's is widely used) |
| Forecourt controller / RA box | Aggregates dispensers + ATG, pushes prices, sends data to the OMC | Supplied under OMC Retail Automation contracts | Talks to pumps and ATG locally, and to the OMC central server over VSAT/4G/broadband |
| Payment terminals (EDC/POS, UPI QR) | Payments by method, time and amount | Banks, PSPs (Paytm, PhonePe, Pine Labs etc.) | Bank/PSP back ends; settlement reports; merchant APIs |
| Truck GPS (VTS) | Location, speed, halts, geofence events | VTS vendors contracted by OMCs | Vendor cloud platform with APIs |

### The critical constraint

At oil company outlets, **the dispensers and automation equipment belong to the OMC.** Dispensers are also sealed under Legal Metrology law, and tampering with dispenser electronics is among the most serious offences under the Marketing Discipline Guidelines. Anything installed in the forecourt hazardous zone needs **PESO / explosion-proof certification**.

**So you must never splice your own hardware into a dispenser or the RA system without written OMC approval.** That would end the dealer's business and yours.

---

## 2. Five realistic ways to get the data, in order of when you'll use them

| # | Route | Data you get | Permission needed | When |
| --- | --- | --- | --- | --- |
| 1 | **Files people already have**: SO's MIS/Excel extracts, dealer registers, bank/PSP settlement reports | Sales, stock, indents, payments, daily | SO / dealer consent | POC → MVP |
| 2 | **Dealer app with smart capture**: manual entry + photo of totaliser and dip readings read automatically (OCR), density entry, tanker receipt checklist | Shift-level sales, dips, density, receipts, cash | Dealer only | MVP |
| 3 | **Payment data via PSP/bank APIs** | Real-time digital collections | Dealer (as merchant) | MVP → Pilot |
| 4 | **Read-only edge gateway on the ATG console** (serial/TCP), at approved sites | Live tank stock, deliveries, water, temperature | OMC approval (it's their equipment) | Sanctioned pilot |
| 5 | **Official OMC integration**: APIs or data feeds from the RA central server, SAP and VTS platforms | Everything, for every automated outlet, without touching a single site | Formal OMC agreement, security audit | Scale |

**Route 5 is how you actually scale.** The OMC has already wired tens of thousands of outlets. You don't install hardware at 40,000 sites. You connect to the one central system that already collects it. Routes 1–4 are how you earn the right to Route 5.

Private chains (Nayara, Jio-bp, Shell) and company-operated sites are where a hardware-level pilot may be approved fastest.

---

## 3. The edge gateway (for Route 4 and non-automated sites)

When you do get approval to collect data on site:

```
 [ATG console] --RS-232/TCP (read-only)--> [Edge gateway] --4G / broadband--> [Cloud]
                                             • polls every 1–5 min
                                             • local buffer (days) for outages
                                             • MQTT over TLS, device certificate
                                             • remote updates, health heartbeat
```

- **Hardware:** an off-the-shelf industrial IoT gateway (with 4G and serial ports, DIN-rail mounted, outside the hazardous zone, typically in the sales room next to the ATG console). Don't design your own boards early on.
- **Software:** a small agent that polls the ATG, converts readings to a standard format, buffers them locally, and publishes them securely.
- **Reality of Indian sites:** power cuts and patchy networks. Store-and-forward and timestamps taken at the device are mandatory.
- **Test bench:** buy a second-hand ATG console and use protocol simulators, so you can develop without being on a live forecourt.

---

## 4. Platform architecture

```
   SOURCES                    INGESTION                 CORE                         APPS
 ┌──────────────────┐     ┌────────────────┐     ┌──────────────────────┐    ┌──────────────────┐
 │ Excel / MIS files│ ──▶ │ File importers │     │ Operational DB       │    │ SO web dashboard │
 │ Dealer app       │ ──▶ │ REST API       │ ──▶ │ (outlets, dealers,   │ ─▶ │ Dealer mobile app│
 │ PSP / bank APIs  │ ──▶ │ Connectors     │     │  tanks, trucks …)    │    │ Alerts: WhatsApp,│
 │ Edge gateways    │ ──▶ │ MQTT broker    │ ──▶ │ Time-series store    │    │  SMS, email      │
 │ OMC SAP/RA/VTS   │ ──▶ │ Event stream   │     │ Raw data lake        │    │ APIs for OMC     │
 └──────────────────┘     └────────────────┘     │ Rules / alert engine │    │ AI copilot       │
                                                 │ Forecasting / ML     │    └──────────────────┘
                                                 └──────────────────────┘
```

### The heart of it: the ontology / entity model

This is what makes it "Gotham-like" rather than another dashboard:

- **Objects:** Depot, Truck, Trip, Outlet, Dealer, Tank, Nozzle, Product, Indent, Invoice, Delivery, Inspection, Complaint, Licence, Sales Officer, Sales Area.
- **Links:** Truck *delivers to* Outlet, Tank *belongs to* Outlet, Dealer *operates* Outlet, Inspection *found* Irregularity, etc.
- **Entity resolution:** the same outlet has a different ID in SAP, in the RA system, in VTS geofences and in the dealer app. Mapping these to a single record is unglamorous, essential work.
- **Actions:** creating an inspection task, flagging an outlet, or acknowledging an alert writes back into the model, so the platform becomes a place where work gets done.

### Rough scale numbers (estimates)

| Signal | Sum | Volume |
| --- | --- | --- |
| Dispenser transactions, one large OMC | ~40,000 outlets × ~1,000 sales/day | ~40M events/day (~500/sec average) |
| ATG readings, one large OMC | ~40,000 × 3 tanks × 1/min | ~170M readings/day (~2,000/sec) |
| Truck GPS | ~10,000+ trucks × 1 point / 30 sec | ~30M points/day |

These volumes are significant but very manageable with standard tools. This isn't a "big data" problem; it's a data integration and reliability problem.

### Grow the architecture in steps

| Stage | Users / outlets | Architecture |
| --- | --- | --- |
| POC | 1 SO, fake data | Static web app, generated data. No backend. |
| MVP | 1 SO, 5–60 outlets | One backend service (e.g. Python FastAPI) + PostgreSQL with TimescaleDB; file upload; dealer mobile web app; one cloud server in India |
| Divisional pilot | ~10 SOs, ~500 outlets | Add an MQTT broker for gateways, background job queue, role-based access, audit logs, staging + production environments |
| Regional / OMC-wide | 1,000s of users, 10,000s of outlets | Event streaming (Kafka/Redpanda), analytical warehouse (e.g. ClickHouse), Kubernetes, per-OMC isolation, high availability, disaster recovery, on-premise deployment option |

**Rule:** don't build the next stage's architecture until the current one is genuinely strained. Most startups die from complexity built too early, not from a lack of scaling.

### Deployment constraints specific to Indian PSUs

- **Data localisation:** data stays in India. Use Indian cloud regions or the OMC's own data centres; PSUs often ask for MeitY-empanelled cloud or on-premise deployment, so containerise everything from early on.
- **CERT-In rules:** logs retained for 180 days, and cyber incidents reported within 6 hours.
- **DPDP Act 2023:** consent and data protection for any personal data (dealers, staff, customers).
- **Security audit:** VAPT by a CERT-In empanelled auditor before any OMC pilot; ISO 27001 as you grow.

---

## 5. Building it as a production system (not just "AI wrote it")

You're right not to rely on me alone. AI can write a lot of good code fast, but a production system needs **people who own it**: who understand every part, review every change, get paged when it breaks, and answer to the customer's security team.

### Team, by stage

| Stage | Who you need |
| --- | --- |
| POC (now) | You + AI. Learn the domain, validate with the SO. |
| MVP | **A technical co-founder or senior full-stack engineer** who owns the codebase; a domain advisor (ex-SO or dealer) |
| Divisional pilot | + backend/data engineer, + mobile/frontend engineer, + IoT/embedded engineer (gateways), part-time DevOps |
| Scale | + SRE/DevOps, security lead, QA, data scientist (forecasting/anomalies), enterprise sales / PSU business development, customer success |

### Engineering practices to adopt from the start

- **Version control** (Git + GitHub), every change through a pull request, **reviewed by a human** before it merges.
- **Automated tests** (unit, integration, and tests on recorded real-world data) running in **CI** on every change.
- **Separate environments:** development → staging → production. Nothing goes straight to production.
- **Infrastructure as code** (e.g. Terraform) so servers are reproducible, not hand-configured.
- **Monitoring:** error tracking (Sentry), metrics and dashboards (Prometheus/Grafana), uptime alerts, data-freshness alerts ("outlet X hasn't sent data in 2 hours").
- **Data quality checks:** reject or flag impossible readings (negative stock, density out of range) before they become false alerts.
- **Backups and disaster recovery,** tested regularly.
- **Written specs and architecture decision records,** so knowledge lives in the repo, not in one head (or one AI chat).
- **Security basics:** secrets management, least-privilege access, dependency scanning, regular penetration tests.

### How to use AI well in this

- Humans decide the architecture and the specs; AI drafts the implementation and tests; humans review and own the result.
- Keep changes small and reviewable.
- Use AI for the heavy lifting: data generators, parsers for report formats, tests, documentation, protocol adapters against simulators.
- Never let AI-written code touch live hardware or production data without review and testing on the bench first.

---

## 6. Summary path

1. **Now:** POC on synthetic data (you + me).
2. **MVP:** files + dealer app; bring in a technical co-founder; set up proper engineering practices.
3. **Pilot:** ATG gateways at approved sites; security audit; small team.
4. **Scale:** official OMC integration for automated outlets; streaming architecture; on-premise option; full team.

Hardware integration at scale is a **partnership problem first and a technology problem second.**
