// Headless logic tests for Sky Captain core systems.
// Stubs browser globals, loads pure-logic scripts, asserts design rules.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const store = {};
const sandbox = {
  console, setTimeout, clearTimeout,
  window: {},
  navigator: {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) },
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["config.js", "utils.js", "data.js", "save.js", "core.js", "flight.js", "atc.js", "net.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), sandbox, { filename: f });
}
const SC = sandbox.SC;
const U = SC.Utils;
let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log("  PASS " + msg);
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? " :: " + extra : "")); }
}

console.log("== geo ==");
const dBG = U.haversineKm(19.09, 72.865, 15.38, 73.831);
ok(dBG > 380 && dBG < 480, "BOM-GOI distance ~420km", dBG.toFixed(1));
const dLJ = U.haversineKm(51.47, -0.454, 40.641, -73.778);
ok(dLJ > 5200 && dLJ < 5900, "LHR-JFK ~5500km", dLJ.toFixed(0));
ok(Math.abs(U.angDiff(350, 10) - 20) < 1e-9, "angDiff wrap");
const gc = U.greatCircle(0, 0, 0, 90, 0.5);
ok(Math.abs(gc.lat) < 1 && Math.abs(gc.lon - 45) < 1, "greatCircle midpoint");

console.log("== profile/economy ==");
SC.Save.loadAll();
SC.Save.newProfile("Test Pilot", "🧑‍✈️");
ok(SC.Save.profile.money === SC.Config.startingMoney, "starting money " + SC.Config.startingMoney);
ok(SC.Economy.money() === 25000, "Economy.money reads profile");
ok(SC.Economy.spend(30000, "x") === false, "cannot overspend");
ok(SC.Economy.spend(5000, "x") === true && SC.Economy.money() === 20000, "spend deducts");
SC.Economy.add(1000, "x");
ok(SC.Economy.money() === 21000, "add credits");
ok(U.fmtMoney(25000) === "$25,000", "money format", U.fmtMoney(25000));

console.log("== fuel design rule ==");
const sparrow = SC.Data.aircraftById("sparrow");
ok(Math.abs(sparrow.flowCruise - 0.1) < 1e-9, "1s = 0.1 fuel baseline (Sparrow)");
ok(SC.Config.baseFuelFlowPerSec === 0.1, "config baseline 0.1");
// endurance sanity: sparrow tank 100u, short hop must fit
const estShort = SC.Economy.estimateFlight("BOM", "GOI", "sparrow", 1, "normal");
ok(estShort.fuelOk, "Sparrow can fly BOM-GOI", "need=" + estShort.fuelNeeded.toFixed(1));
const estLong = SC.Economy.estimateFlight("BOM", "GOI", "sparrow", 1, "normal");
ok(estLong.earnAt5 > estLong.earnAt3 && estLong.earnAt3 > 0, "earnings scale with rating", JSON.stringify({ b: estLong.earnBase, e3: estLong.earnAt3, e5: estLong.earnAt5 }));

console.log("== longer flight = more money ==");
const e1 = SC.Economy.estimateFlight("LHR", "CDG", "metro", 1, "normal");
const e2 = SC.Economy.estimateFlight("LHR", "JFK", "aurora", 1, "normal");
ok(e1.distanceKm < e2.distanceKm, "route distances differ", e1.distanceKm.toFixed(0) + " vs " + e2.distanceKm.toFixed(0));
ok(e1.enrouteSec < e2.enrouteSec, "longer route takes longer", e1.enrouteSec.toFixed(0) + "s vs " + e2.enrouteSec.toFixed(0) + "s");
// same aircraft comparison for fairness:
const e1b = SC.Economy.estimateFlight("LHR", "CDG", "aurora", 1, "normal");
ok(e2.earnAt3 > e1b.earnAt3, "longer route pays more (same aircraft)", e1b.earnAt3.toFixed(0) + " vs " + e2.earnAt3.toFixed(0));

console.log("== fleet/fuel ops ==");
ok(SC.Fleet.fuelOf("sparrow") === SC.Fleet.effectiveStats("sparrow").fuelCap, "starter tank full");
let r = SC.Fleet.addFuel("sparrow", 10, "BOM");
ok(r.ok === false, "cannot overfill full tank");
SC.Fleet.setFuel("sparrow", 40);
r = SC.Fleet.addFuel("sparrow", 20, "BOM");
ok(r.ok && Math.abs(SC.Fleet.fuelOf("sparrow") - 60) < 1e-9, "partial refuel 40+20=60", JSON.stringify(r));
ok(r.cost > 0, "partial refuel charges", r.cost);
const ppu = SC.Economy.fuelPricePerUnit("sparrow", "BOM");
ok(Math.abs(ppu - sparrow.fullRefillCost / sparrow.fuelCap) < 1e-9, "price/unit derived from full-refill cost", ppu);
const ppuDXB = SC.Economy.fuelPricePerUnit("sparrow", "DXB");
ok(ppuDXB < ppu, "DXB fuel cheaper (mult 0.9)");

console.log("== licenses/upgrades ==");
ok(SC.Data.licenseRank("super") === 5, "license ranks");
ok(SC.Licenses.canBuy("ppl").ok === false, "PPL blocked (hours/flights)", SC.Licenses.canBuy("ppl").why.join(";"));
const upgCost = SC.Data.upgradeCost(sparrow, SC.Data.UPGRADES[0], 0);
ok(upgCost === 2000, "base upgrade cost", upgCost);
const titan = SC.Data.aircraftById("titan");
ok(SC.Data.upgradeCost(titan, SC.Data.UPGRADES[0], 0) > upgCost, "big aircraft upgrades cost more");
let bu = SC.Fleet.buyUpgrade("sparrow", "engine");
ok(bu.ok && bu.level === 1, "buy upgrade L1");
ok(SC.Fleet.effectiveStats("sparrow").cruiseKmh > sparrow.cruiseKmh, "engine upgrade improves speed");

console.log("== rating ==");
let s = SC.Rating.newSession();
s.takeoff.done = true; s.takeoff.center = 2; s.takeoff.rotateOk = true;
s.taxi.maxKt = 18; s.nav.offCourseSec = 5; s.nav.maxDev = 8;
s.atc.required = 4; s.atc.complied = 4; s.fuel.reservePct = 0.3;
s.landing.done = true; s.landing.vsFpm = -140; s.landing.centerM = 4; s.landing.gearDown = true; s.landing.onRunway = true;
let res = SC.Rating.finalize(s, { tolerance: 1.2 });
ok(res.total >= 4.8, "perfect flight ~5 stars", res.total);
ok(res.tips.length > 0, "tips provided");
s = SC.Rating.newSession();
s.safety.crash = true; s.landing.done = false;
res = SC.Rating.finalize(s, { tolerance: 1 });
ok(res.total <= 2.5, "crash tanks rating", res.total);

console.log("== airfield geometry ==");
const ap = SC.Data.airportByCode("BOM");
const F = SC.Airfield.build(ap, 90);
const al = F.alongLat(F.thr.x, F.thr.z);
ok(Math.abs(al.along + ap.rwy.len / 2) < 1e-6 && Math.abs(al.lat) < 1e-6, "threshold coords", JSON.stringify(al));
ok(F.gates.length === ap.gates, "gate count matches");
ok(SC.Airfield.rwyName(90) === "09" && SC.Airfield.rwyName(273) === "27", "runway names");
const hdg = SC.Airfield.pickRwyHdg(ap, 270);
ok(hdg === 270 || hdg === 90, "runway picker returns valid hdg", hdg);

console.log("== time/weather ==");
SC.Time.init();
const dlNoon = SC.Time.daylight(0);
ok(dlNoon >= 0 && dlNoon <= 1, "daylight in range", dlNoon);
SC.Weather.init();
const w = SC.Weather.get("BOM");
ok(w.windKt >= 0 && w.visKm > 0 && w.cond, "weather generated", JSON.stringify(w));

console.log("== multiplayer local transport ==");
(async () => {
  const T = new SC.Net.LocalTransport();
  let welcomed = false;
  T.onMessage(m => { if (m.t === "welcome") welcomed = true; });
  await T.connect({ callsign: "SKC101", airport: "BOM", role: "pilot", ac: "sparrow" });
  ok(welcomed && T.isConnected(), "local transport welcome");
  T.tick(0.5);
  T.disconnect();
  ok(!T.isConnected(), "disconnect works");

  console.log(fails === 0 ? "\nALL TESTS PASSED" : "\n" + fails + " TEST(S) FAILED");
  process.exit(fails === 0 ? 0 : 1);
})();
