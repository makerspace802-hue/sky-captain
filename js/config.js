/* ============================================================
   SKY CAPTAIN — Central configuration / game balance.
   ALL tunable economy + sim values live here (or in data.js
   ScriptableObject-style tables). Nothing is hard-coded in systems.
   ============================================================ */
var SC = window.SC || {};
window.SC = SC;

SC.Config = {
  gameName: "Sky Captain",
  version: "1.0.0",
  currencySymbol: "$",

  // ---- Player start ----
  startingMoney: 25000,
  starterAircraftId: "sparrow",
  starterAirport: "BOM",

  // ---- Fuel design rule: 1 second of flight = 0.1 fuel (baseline).
  // Per-aircraft overrides live in SC.Data.AIRCRAFT[].flowCruise.
  baseFuelFlowPerSec: 0.1,
  // Phase multipliers applied on top of cruise flow:
  fuelPhaseMult: { parked: 0.05, taxi: 0.40, takeoff: 2.20, climb: 1.60, cruise: 1.00, descent: 0.55, approach: 0.80, rollout: 0.70 },
  fuelReservePct: 0.15,        // recommended reserve for planning
  fuelWarningPct: 0.20,        // low-fuel warning threshold
  fuelEmergencyPct: 0.08,      // emergency threshold

  // ---- Earnings ----
  earnBase: 400,               // flat per completed flight
  earnPerKm: 7.5,              // $ per km (× aircraft factor × mission mult × rating mult)
  earnLandingBonus: 600,       // smooth-landing bonus (scaled by rating)
  earnRatingMult: [0.6, 0.8, 1.0, 1.2, 1.45], // index by rounded stars-1
  earnDifficultyMult: { easy: 0.85, normal: 1.0, realistic: 1.15, expert: 1.3 },

  // ---- Costs ----
  crashRepairPct: 0.05,        // of aircraft price
  crashRepairMin: 500,
  crashRatingPenalty: 1.5,     // stars deducted from flight rating
  goAroundBonus: 150,          // safe go-around is rewarded, not punished

  // ---- Licenses: money + hours + flights + avg rating ----
  // (tables in data.js; gates enforced by LicenseManager)

  // ---- Enroute compression (keeps long-haul playable).
  // Target enroute duration scales gently with distance so LONGER
  // routes always take longer and pay more, without taking hours.
  routeBaseSec: 200,           // minimum enroute leg
  routeSecPerKm: 0.34,         // + seconds per km of great-circle distance
  routeMaxSec: 1250,           // cap so ultra-long-haul stays fun
  timeAccelOptions: [1, 2, 4, 8],

  // ---- Rating weights ----
  ratingWeights: { takeoff: 1, taxi: 0.8, navigation: 1.2, atc: 1.2, fuel: 0.8, landing: 1.6, safety: 1.8 },

  // ---- Flight model assists per difficulty ----
  difficulty: {
    easy:      { stability: 0.85, stallProtect: true,  coordAssist: 1.0, guidance: true,  tolerance: 1.6, turbulence: 0.4 },
    normal:    { stability: 0.55, stallProtect: true,  coordAssist: 0.7, guidance: true,  tolerance: 1.2, turbulence: 0.7 },
    realistic: { stability: 0.25, stallProtect: false, coordAssist: 0.3, guidance: true,  tolerance: 1.0, turbulence: 1.0 },
    expert:    { stability: 0.0,  stallProtect: false, coordAssist: 0.0, guidance: false, tolerance: 0.8, turbulence: 1.2 }
  },

  // ---- Multiplayer ----
  mp: {
    defaultTransport: "local",
    wsUrl: "",
    tickHz: 5,                 // position broadcast rate
    maxPilotsLocal: 8
  },

  // ---- Misc ----
  autosaveSec: 20,
  callsignPrefix: "SKC"
};
