# Prahari for dealers (proof of concept)

The dealer's side of Prahari: one place to see every outlet, know what to do next, order fuel, pay for it, track the truck and check what arrived. Like the Sales Officer dashboard, it doesn't make the dealer dig through reports. The home screen is a **ranked list of recommended actions**, each with the reason, the money at stake and a one-tap action.

Everything is **synthetic**. The demo dealer runs two outlets from the Sales Officer dashboard's world: **990104 Royal Service Station** (highway) and **990118 Aravali Petroleum** (city). The two apps show the same outlets, tanks, depots and roads.

## How to run

From the repository root:

```bash
cd poc
python3 -m http.server 8080
# open http://localhost:8080/dealer/
```

No backend and no build step. The map needs an internet connection for its tiles; everything else runs offline. It works on a phone (bottom tab bar) and on a laptop.

## What's in it

| Screen | What it does |
| --- | --- |
| **Today** | Greeting and one-line brief, the ranked **Do this now** cards, things in progress (orders, payments, claims, complaints), outlet cards, the account balance and an activity log. **Morning brief** previews the daily WhatsApp/app message. |
| **Outlets** | One card per outlet plus a side-by-side table per product: target, sold today, usable stock (dead stock excluded), ordered, on the road, cover, price and preset check, critical logs, and first and last sale. |
| **Outlet page** | Tabs: **Stock & pumps** (usable/dead stock, ullage, cover, run-dry time, tank gauges with water and temperature, nozzles with litres and flow rate, price board, latest sales). **Sales** (by hour against the 7-day average, month to date against target, 30-day trend, bill size, vehicle mix estimated from litres, payment modes). **Stock book** (opening dip + receipts − current = tank sales, against nozzle sales; printable daily report). **Integrity** (price, presets, non-selling nozzles and tanks, flow-rate variance, water, gauge status, reconciliation, dispenser events with action-taken reports). **Compliance** (renewals, inspection observations, inspection history). |
| **Orders** | Suggested orders, the supply pipeline (stock, ordered, on the road, run-dry with and without orders) and every order with its next step. **New order** starts from the suggestion, packed into whole truck compartments and limited by tank space at arrival. |
| **Pay** | Shows the dealer's collection account; the dealer pays by RTGS or NEFT from their own bank and records the UTR. The order releases once the credit lands. Prahari never moves money or asks for bank details. |
| **Track** | The truck on real roads with its ETA, the road driven and the road ahead. |
| **Receipt** | Invoice against what the tank gauge measured, allowed transit loss, density check, then confirm, or raise a shortage claim that becomes a credit note. |
| **Account** | Balance, money held for released orders, available, pending credits; payments; ledger with running balance; invoices in the oil company's register layout (CSV download). |
| **Messages** | Requests, complaints and claims with the Sales Officer, with simulated replies. |

## The demo story

At start-up, the cards say:

1. **Pay ₹10.9 lakh to release the diesel order for 990104.** Usable diesel (dead stock excluded) runs out within hours, and the order is waiting for payment. The Sales Officer dashboard shows the same order "on hold for payment".
2. **Premium petrol at 990118 is priced ₹0.50 below today's price.** The pump and presets were not updated at the 06:00 revision.
3. **Stamping at 990118 expires in 6 days.**
4. **Nozzle N5 at 990104 has sold nothing since opening.**
5. **Raise a claim: yesterday's petrol load was 85 L short.**
6. **A dispenser controller was reset overnight.** It needs an action-taken report.
7. **Water in the diesel tank, a nozzle flowing slowly, an open inspection observation, behind target.**

**Suggested walkthrough:** press **Pay** → **Fill a demo UTR** → **Record payment**, then set the clock to **300×** in the top bar. The payment is credited, the order releases, the truck loads, appears on **Track**, drives the real road and unloads. Then **Confirm the receipt**. Every other card's action works too, and the card disappears once its cause is fixed.

## Deep links

- `#view=orders` (`today`, `outlets`, `orders`, `track`, `account`, `messages`)
- `#outlet=990118&tab=integrity` (`stock`, `sales`, `book`, `integrity`, `compliance`)
- `#speed=60` starts the demo clock at 60× (`1`, `10`, `60`, `300`)

## How the recommendations work

The rules are plain and explainable. Every threshold lives in `js/config.js` (for example dead stock fraction, safety hours, transit loss, flow-rate variance, water limit, claim window), never inside a rule.

- **Run-dry time** walks forward through the hourly sales curve, using the last 7 days' average and usable stock. A plain "stock ÷ today's sales so far" overstates cover early in the day; the outlet page shows both.
- **When to order** = run-dry time − safety margin − (payment credit + depot queue + loading + drive + unloading), with the depot's loading hours and order cut-off.
- **Suggested order** = enough for the target cover at arrival, limited by tank space at arrival, packed into whole compartments, with spare compartments topped up.
- Cards are ranked by severity, deadline and money at stake. **Snooze** brings a card back after 2 hours if it still applies. **Not relevant** asks for a reason, which can later tune the rules.

## Code layout

```
poc/dealer/
├── index.html      shell (shares ../css/styles.css, ../js/data.js, roads and charts with the Sales Officer dashboard)
├── css/dealer.css  page layout, cards, phone layout, print styles
└── js/
    ├── config.js   thresholds and business constants
    ├── world.js    the demo dealer, outlets, history, orders, ledger and storyline
    ├── engine.js   simulated clock, forecasts, suggested orders, lifecycle, recommendation rules, actions (no DOM)
    ├── ui.js       shell, helpers, recommendation cards, Today and Outlets
    ├── outlet.js   the outlet page
    ├── orders.js   orders, payment, receipt, order detail, truck tracking
    ├── account.js  account and messages
    └── main.js     start-up and deep links
```

`make dealer` (part of `make check`) runs `tools/check_dealer.mjs`. It loads the engine in Node at three times of day and checks the forecasts, suggestions, payment validation, the order lifecycle, claims and the storyline.

## What would be real

In a real deployment, tank, pump and sales data would come from the oil company's automation exports or APIs. Orders would still be placed in the oil company's system, and payments made from the dealer's bank. Prahari prepares, tracks and reconciles them.
