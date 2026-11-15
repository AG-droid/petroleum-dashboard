/* =====================================================================
   PRAHARI for dealers — thresholds and business constants
   Every number a recommendation depends on lives here, never inside a rule, so it can be
   tuned (and later served by the backend's RuleThresholds) without touching the logic.
   Values are realistic placeholders for the demo, not an oil company's official figures.
   ===================================================================== */
(function () {
  'use strict';
  window.DCFG = Object.freeze({
    // ---------- Stock and forecasting ----------
    // Dead stock: fuel below the suction pipe that can never be dispensed. Run-dry forecasts use
    // usable stock (stock minus dead stock). Real values come from each tank's calibration chart.
    deadStockFraction: 0.06,
    forecastDays: 7, // sales forecast = average of the last N full days, shaped by the hourly curve
    forecastStepMin: 15, // resolution of the run-dry projection
    lookaheadHours: 72, // projections stop here
    targetCoverDays: 4, // a suggested order aims to leave this many days of usable stock
    safetyHours: 4, // order early enough to arrive this long before a tank runs dry
    ullageReserveFraction: 0.03, // never plan to fill a tank above 97 % (thermal expansion)

    // ---------- Supply chain timings (simulated minutes) ----------
    paymentCreditMin: 20, // RTGS/NEFT credit showing in the oil company's account
    paymentLateMin: 90, // a payment not credited after this is worth chasing
    depotQueueMin: 45, // from order release to the truck starting to load
    loadingMin: 35,
    unloadingMin: 30,
    depotOpenHour: 6, // loading window at the supply point (IST)
    depotCloseHour: 22,
    indentCutoffHour: 15, // orders released after this load the next morning
    soReplyMin: 12, // the Sales Officer's simulated reply time to a request

    // ---------- Trucks ----------
    // Each compartment carries one product and is filled completely.
    trucks: [
      { kl: 12, compartments: [4, 4, 4] },
      { kl: 20, compartments: [5, 5, 5, 5] },
    ],

    // ---------- Money ----------
    // Dealer purchase price = today's retail selling price (RSP) minus the dealer margin (₹/L).
    dealerMarginPerL: { MS: 3.9, HSD: 2.6, XP: 4.6 },
    rtgsMinInr: 200000, // RTGS is for ₹2 lakh and above; NEFT has no minimum
    // Unique transaction reference (UTR) shapes: RTGS 22 characters, NEFT 16, both starting with
    // the sending bank's 4-letter code.
    utrPatterns: { RTGS: /^[A-Z]{4}R[A-Z0-9]{17}$/, NEFT: /^[A-Z]{4}[A-Z0-9]{12}$/ },
    // The oil company's collection account for this dealer (fictional: DEMO is not a bank code).
    collection: { name: 'Prahari Demo Oil Co. – dealer collections', account: '9901 0442 0000 7316', ifsc: 'DEMO0000001', bank: 'Demo Bank, Gurugram' },

    // ---------- Receipts ----------
    transitLossFraction: 0.0015, // shortage allowed on a delivery (0.15 %) before a claim
    densityToleranceKgM3: 3, // observed vs invoice density at 15 °C
    claimWindowHours: 48, // claims must be raised within this long after unloading

    // ---------- Integrity checks ----------
    nilSellingHours: 3, // a nozzle silent this long after opening while its peers sell
    nilPeerMinL: 200, // ...and the same-product nozzles average at least this many litres
    flowVariancePct: 10, // a nozzle this much slower than its peers needs calibration
    variationPct: 0.5, // permissible gap between tank sales and nozzle sales (% of sales)
    waterMaxMm: 25, // water at the tank bottom above this needs draining
    atgStaleMin: 30, // a tank gauge silent this long makes cover figures unreliable
    openingHour: 6, // business day starts with the morning dip

    // ---------- Commercial ----------
    targetWarnRatio: 0.92, // month-to-date below 92 % of target
    complianceWarnDays: 30,
    complianceUrgentDays: 7,

    // ---------- Vehicle classes inferred from litres per sale ----------
    vehicleClasses: [
      { label: '2/3-wheeler', maxL: 5 },
      { label: 'Car', maxL: 40 },
      { label: 'SUV / LCV', maxL: 65 },
      { label: 'Bulk / HCV', maxL: Infinity },
    ],
    ticketSlabsInr: [100, 200, 500, 1000, 2000, 3000, 7500, 13500, Infinity],

    // ---------- Data refresh (how often each source reaches us, simulated minutes) ----------
    refresh: { atg: 5, sales: 3, orders: 10, invoices: 120 },
  });
})();
