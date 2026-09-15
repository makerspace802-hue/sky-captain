// End-to-end headless flight test: scripted AI pilot flies BOM -> GOI
// gate-to-gate (taxi, takeoff, climb, enroute, approach, landing,
// taxi-in, ratings, pay), plus a crash-recovery test.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const store = {};
function makeEl() {
  return {
    children: [], style: {}, value: "", textContent: "", innerHTML: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    appendChild(c) { this.children.push(c); }, removeChild() { this.children.shift(); },
    addEventListener() {}, setPointerCapture() {},
    get firstChild() { return this.children[0]; },
    set scrollTop(v) { this._st = v; }, get scrollTop() { return this._st || 0; }
  };
}
const sandbox = {
  console, setTimeout, clearTimeout,
  window: {},
  navigator: {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: { getElementById: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl() },
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["config.js", "utils.js", "data.js", "save.js", "core.js", "flight.js", "atc.js", "net.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), sandbox, { filename: f });
}
const SC = sandbox.SC;
const U = SC.Utils;

// ---- stubs for UI/audio/input layers ----
const results = { pay: null, res: null, crashed: null, crashInfo: null };
SC.UI = {
  toast() {}, flightBanner() {}, enterFlight() {}, exitToMenu() {}, syncAP() {}, syncPause() {},
  showResults(fl, res, pay) { results.pay = pay; results.res = res; results.crashed = false; },
  showCrash(fl, reason, cost, res) { results.crashInfo = { reason, cost, res }; results.crashed = true; },
  onChatMsg() {}, refreshMoney() {}, show() {}, go() {}
};
SC.Audio = { ensure() {}, click() {}, chime() {}, atcTone() {}, warnStall() {}, warnOverspeed() {}, touchdown() {}, crash() {}, cash() {}, updateFlight() {}, idle() {}, applySettings() {} };
SC.Input = { axes: { pitch: 0, roll: 0, yaw: 0, brake: 0, thrDelta: 0 }, getAxes() { return Object.assign({}, this.axes); }, pollPad() {}, onAction() {} };

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log("  PASS " + msg);
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? " :: " + extra : "")); }
}
function setAx(pitch, roll, brake) { SC.Input.axes.pitch = pitch; SC.Input.axes.roll = roll; SC.Input.axes.brake = brake || 0; SC.Input.axes.yaw = 0; }
function brgTo(m, tx, tz) { return U.wrap360(Math.atan2(tx - m.x, -(tz - m.z)) * 180 / Math.PI); }
function steerTo(m, tx, tz, aggr) { return U.clamp(U.angDiff(m.hdg, brgTo(m, tx, tz)) / (aggr || 25), -1, 1); }
function finite(fl) {
  const m = fl.model;
  return [m.x, m.z, m.altFt, m.hdg, m.pitch, m.roll, m.iasKt, m.vsFpm, fl.f, fl.fuel].every(isFinite);
}

function stepSim(fl, h) {
  SC.Flight._step(fl, h);
  if (!fl.over) { fl.flightSec += h; SC.Time.advance(h); fl.atc.update(h); }
}

console.log("== E2E: BOM -> GOI (Sparrow, AI pilot) ==");
SC.Save.loadAll();
SC.Save.newProfile("AI Captain", "🧑‍✈️");
SC.Weather.init(); SC.Time.init(); SC.Traffic.init();
function setWx(dir, kt) {
  SC.Weather.randomize = function (code) { this._cache[code] = { cond: "clear", windDir: dir, windKt: kt, visKm: 30, turb: 0 }; return this._cache[code]; };
  SC.Weather._cache = {};
}
setWx(250, 8); // deterministic nominal day (flight 1)
const money0 = SC.Economy.money();
const fl = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "SKC101" });
fl.atc.handlePhrase("taxi");

let stage = "taxi", n = 0, stillN = 0, stuckN = 0, saidAppr = false, saidLand = false, geared = false;
const H = 0.05;
const MAX = 60000;
const vrKt = U.kmh2kt(fl.st.vrKmh);
let maxStep = 0;
while (!fl.over && n < MAX) {
  n++;
  const m = fl.model;
  if (n % 1000 === 0 && !finite(fl)) { ok(false, "model stays finite", "step " + n); break; }
  if (stage === "taxi") {
    const t = fl.depF.hold, d = Math.hypot(m.x - t.x, m.z - t.z);
    setAx(0, steerTo(m, t.x, t.z), 0);
    if (d > 60) { m.thr = 0.35; } else if (d > 26) { m.thr = 0.18; setAx(0, steerTo(m, t.x, t.z), m.gSpeedKt > 8 ? 1 : 0); }
    else { m.thr = 0; setAx(0, 0, 1); }
    if (d > 26 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.6; } else stuckN = 0;
    if (d < 26 && m.gSpeedKt < 4) { if (++stillN > 10) { stage = "lineup"; fl.atc.handlePhrase("takeoff"); console.log("  ... reached hold, cleared takeoff (step " + n + ")"); } }
    else stillN = 0;
  } else if (stage === "lineup") {
    const t = fl.depF.lineup, d = Math.hypot(m.x - t.x, m.z - t.z);
    setAx(0, steerTo(m, t.x, t.z, 18), 0);
    m.thr = d > 25 ? 0.3 : 0.18;
    if (d > 22 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.6; } else stuckN = 0;
    if (d < 14) { stage = "roll"; console.log("  ... lined up (step " + n + ")"); }
  } else if (stage === "roll") {
    var rlat = fl.depF.alongLat(m.x, m.z).lat;
    setAx(m.iasKt > vrKt * 0.98 ? 0.55 : 0, U.clamp(U.angDiff(m.hdg, fl.depHdg) / 10 - rlat / 40, -1, 1), 0);
    m.thr = 1;
    if (!m.onGround) {
      stage = "auto"; SC.Flight.toggleAP();
      fl.apTgt.hdg = fl.depHdg; fl.apTgt.alt = fl.cruiseAltFt;
      console.log("  ... airborne, AP engaged (step " + n + ")");
    }
  } else if (stage === "auto") {
    setAx(0, 0, 0); // AP flies
    if (!geared && !m.onGround && m.vsFpm > 400 && m.altFt > 300 && fl.sceneMode === "LOCAL_DEP") { geared = true; SC.Flight.cycleGear(); }
    if (fl.sceneMode === "LOCAL_ARR" && !saidAppr) { saidAppr = true; fl.atc.handlePhrase("approach"); console.log("  ... arrival airspace (step " + n + ", fuel " + fl.fuel.toFixed(1) + ")"); }
    if (fl.phase === "FINAL" && !saidLand) { saidLand = true; fl.atc.handlePhrase("landing"); console.log("  ... final, cleared to land (step " + n + ")"); }
    if (fl.phase === "ROLLOUT") { stage = "rollout"; fl.ap = false; console.log("  ... touchdown at " + Math.round(fl.rating.landing.vsFpm) + " fpm (step " + n + ")"); }
  } else if (stage === "rollout") {
    m.thr = 0;
    var olat = fl.activeF.alongLat(m.x, m.z).lat;
    setAx(0, U.clamp(U.angDiff(m.hdg, fl.arrHdg) / 10 - olat / 40, -1, 1), m.gSpeedKt > 12 ? 0.7 : 0.3);
    if (fl.phase === "TAXI_IN") { stage = "taxiin"; console.log("  ... taxiing to gate (step " + n + ")"); }
  } else if (stage === "taxiin") {
    const AF = fl.activeF, al = AF.alongLat(m.x, m.z);
    const gate = fl.fixes[0] || AF.gates[0];
    // paved routing: reposition along the runway abeam the apron, then cut to the gate
    const gA0 = -AF.len / 2 + 260 - 120, gA1 = -AF.len / 2 + 260 + (AF.gates.length - 1) * 48 + 90;
    const abeam = Math.min(Math.max(al.along, gA0 + 60), gA1 - 60);
    let t = gate;
    if (Math.abs(al.lat) < 40 && (al.along < gA0 + 40 || al.along > gA1 - 40)) t = { x: AF.dir.x * abeam, z: AF.dir.z * abeam };
    const d = Math.hypot(m.x - t.x, m.z - t.z);
    if (t !== gate && Math.abs(U.angDiff(m.hdg, brgTo(m, t.x, t.z))) > 60 && m.gSpeedKt > 8) { m.thr = 0; setAx(0, steerTo(m, t.x, t.z), 1); } // slow for the U-turn
    else {
      setAx(0, steerTo(m, t.x, t.z), 0);
      if (d > 60) m.thr = 0.35; else if (d > 26) { m.thr = 0.18; setAx(0, steerTo(m, t.x, t.z), m.gSpeedKt > 7 ? 1 : 0); }
      else if (t === gate) { m.thr = 0; setAx(0, 0, m.gSpeedKt > 1 ? 1 : 0); }
      else m.thr = 0.15;
    }
    if (d > 26 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.7; } else stuckN = 0;
  }
  stepSim(fl, H);
  maxStep = n;
  if (n % 6000 === 0) console.log("  ... step " + n + " phase=" + fl.phase + " scene=" + fl.sceneMode + " alt=" + Math.round(m.altFt) + " spd=" + Math.round(m.iasKt) + " fuel=" + fl.fuel.toFixed(1) + " f=" + fl.f.toFixed(2));
}
console.log("  ... finished at step " + maxStep + " (" + (maxStep * H).toFixed(0) + " sim-sec)");
ok(fl.over && fl.phase === "DONE", "flight completes gate-to-gate", "phase=" + fl.phase + " crashed=" + fl.crashed);
ok(!fl.crashed, "no crash on nominal flight");
if (results.res) {
  ok(results.res.total >= 3.0, "AI earns decent rating", results.res.total);
  console.log("     breakdown: " + results.res.breakdown.map(b => b.k + "=" + b.v.toFixed(1)).join(" "));
}
if (results.pay) ok(results.pay.total > 0, "flight pays out", "$" + results.pay.total);
ok(SC.Economy.money() > money0, "balance grows", money0 + " -> " + SC.Economy.money());
ok(SC.Save.profile.flightsCompleted === 1, "flight counted");
ok(fl.rating.atc.complied >= 3, "ATC compliance tracked", fl.rating.atc.complied + "/" + fl.rating.atc.required);
ok(SC.Save.profile.airportsVisited.indexOf("GOI") >= 0, "destination visited");
ok(fl.fuel > 0, "fuel reserve on arrival", fl.fuel.toFixed(1) + "u (" + Math.round(fl.fuel / fl.st.fuelCap * 100) + "%)");


console.log("== E2E flight 2: BOM -> GOI in 14kt crosswind ==");
setWx(0, 14); // strong pure crosswind for runway 08
SC.Fleet.setFuel("sparrow", SC.Fleet.effectiveStats("sparrow").fuelCap); // fresh tank
const moneyMid = SC.Economy.money();
const flB = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "SKC102" });
flB.atc.handlePhrase("taxi");

let stageB = "taxi", nB = 0, stillNB = 0, stuckNB = 0, saidApprB = false, saidLandB = false, gearedB = false;
const vrKtB = U.kmh2kt(flB.st.vrKmh);
let maxStepB = 0;
while (!flB.over && nB < MAX) {
  nB++;
  const mB = flB.model;
  if (nB % 1000 === 0 && !finite(flB)) { ok(false, "model stays finite", "step " + nB); break; }
  if (stageB === "taxi") {
    const t = flB.depF.hold, d = Math.hypot(mB.x - t.x, mB.z - t.z);
    setAx(0, steerTo(mB, t.x, t.z), 0);
    if (d > 60) { mB.thr = 0.35; } else if (d > 26) { mB.thr = 0.18; setAx(0, steerTo(mB, t.x, t.z), mB.gSpeedKt > 8 ? 1 : 0); }
    else { mB.thr = 0; setAx(0, 0, 1); }
    if (d > 26 && mB.gSpeedKt < 0.5) { if (++stuckNB > 60) mB.thr = 0.6; } else stuckNB = 0;
    if (d < 26 && mB.gSpeedKt < 4) { if (++stillNB > 10) { stageB = "lineup"; flB.atc.handlePhrase("takeoff"); console.log("  ... reached hold, cleared takeoff (step " + nB + ")"); } }
    else stillNB = 0;
  } else if (stageB === "lineup") {
    const t = flB.depF.lineup, d = Math.hypot(mB.x - t.x, mB.z - t.z);
    setAx(0, steerTo(mB, t.x, t.z, 18), 0);
    mB.thr = d > 25 ? 0.3 : 0.18;
    if (d > 22 && mB.gSpeedKt < 0.5) { if (++stuckNB > 60) mB.thr = 0.6; } else stuckNB = 0;
    if (d < 14) { stageB = "roll"; console.log("  ... lined up (step " + nB + ")"); }
  } else if (stageB === "roll") {
    var rlat = flB.depF.alongLat(mB.x, mB.z).lat;
    setAx(mB.iasKt > vrKtB * 0.98 ? 0.55 : 0, U.clamp(U.angDiff(mB.hdg, flB.depHdg) / 10 - rlat / 40, -1, 1), 0);
    mB.thr = 1;
    if (!mB.onGround) {
      stageB = "auto"; SC.Flight.toggleAP();
      flB.apTgt.hdg = flB.depHdg; flB.apTgt.alt = flB.cruiseAltFt;
      console.log("  ... airborne, AP engaged (step " + nB + ")");
    }
  } else if (stageB === "auto") {
    setAx(0, 0, 0); // AP flies
    if (!gearedB && !mB.onGround && mB.vsFpm > 400 && mB.altFt > 300 && flB.sceneMode === "LOCAL_DEP") { gearedB = true; SC.Flight.cycleGear(); }
    if (flB.sceneMode === "LOCAL_ARR" && !saidApprB) { saidApprB = true; flB.atc.handlePhrase("approach"); console.log("  ... arrival airspace (step " + nB + ", fuel " + flB.fuel.toFixed(1) + ")"); }
    if (flB.phase === "FINAL" && !saidLandB) { saidLandB = true; flB.atc.handlePhrase("landing"); console.log("  ... final, cleared to land (step " + nB + ")"); }
    if (flB.phase === "ROLLOUT") { stageB = "rollout"; flB.ap = false; console.log("  ... touchdown at " + Math.round(flB.rating.landing.vsFpm) + " fpm (step " + nB + ")"); }
  } else if (stageB === "rollout") {
    mB.thr = 0;
    var olat = flB.activeF.alongLat(mB.x, mB.z).lat;
    setAx(0, U.clamp(U.angDiff(mB.hdg, flB.arrHdg) / 10 - olat / 40, -1, 1), mB.gSpeedKt > 12 ? 0.7 : 0.3);
    if (flB.phase === "TAXI_IN") { stageB = "taxiin"; console.log("  ... taxiing to gate (step " + nB + ")"); }
  } else if (stageB === "taxiin") {
    const AFB = flB.activeF, al = AFB.alongLat(mB.x, mB.z);
    const gate = flB.fixes[0] || AFB.gates[0];
    // paved routing: reposition along the runway abeam the apron, then cut to the gate
    const gA0 = -AFB.len / 2 + 260 - 120, gA1 = -AFB.len / 2 + 260 + (AFB.gates.length - 1) * 48 + 90;
    const abeam = Math.min(Math.max(al.along, gA0 + 60), gA1 - 60);
    let t = gate;
    if (Math.abs(al.lat) < 40 && (al.along < gA0 + 40 || al.along > gA1 - 40)) t = { x: AFB.dir.x * abeam, z: AFB.dir.z * abeam };
    const d = Math.hypot(mB.x - t.x, mB.z - t.z);
    if (t !== gate && Math.abs(U.angDiff(mB.hdg, brgTo(mB, t.x, t.z))) > 60 && mB.gSpeedKt > 8) { mB.thr = 0; setAx(0, steerTo(mB, t.x, t.z), 1); } // slow for the U-turn
    else {
      setAx(0, steerTo(mB, t.x, t.z), 0);
      if (d > 60) mB.thr = 0.35; else if (d > 26) { mB.thr = 0.18; setAx(0, steerTo(mB, t.x, t.z), mB.gSpeedKt > 7 ? 1 : 0); }
      else if (t === gate) { mB.thr = 0; setAx(0, 0, mB.gSpeedKt > 1 ? 1 : 0); }
      else mB.thr = 0.15;
    }
    if (d > 26 && mB.gSpeedKt < 0.5) { if (++stuckNB > 60) mB.thr = 0.7; } else stuckNB = 0;
  }
  stepSim(flB, H);
  maxStepB = nB;
  if (nB % 6000 === 0) console.log("  ... step " + nB + " phase=" + flB.phase + " scene=" + flB.sceneMode + " alt=" + Math.round(mB.altFt) + " spd=" + Math.round(mB.iasKt) + " fuel=" + flB.fuel.toFixed(1) + " f=" + flB.f.toFixed(2));
}
console.log("  ... finished at step " + maxStepB + " (" + (maxStepB * H).toFixed(0) + " sim-sec)");
ok(flB.over && flB.phase === "DONE", "xwind flight completes gate-to-gate", "phase=" + flB.phase + " crashed=" + flB.crashed);
ok(!flB.crashed, "no crash in crosswind");
if (results.pay) ok(results.pay.total > 0, "xwind flight pays out", "$" + results.pay.total);
ok(SC.Economy.money() > moneyMid, "xwind balance grows", moneyMid + " -> " + SC.Economy.money());
ok(SC.Save.profile.flightsCompleted === 2, "xwind flight counted");
ok(flB.rating.atc.complied >= 3, "xwind ATC compliance tracked", flB.rating.atc.complied + "/" + flB.rating.atc.required);
ok(flB.fuel > 0, "xwind fuel reserve on arrival", flB.fuel.toFixed(1) + "u");

console.log("== crash recovery ==");
const fails0 = SC.Save.profile.flightsFailed || 0;
const money1 = SC.Economy.money();
const fl2 = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "SKC103", spawn: { kind: "airborne", alt: 4000, hdg: 90, spd: 150, x: 0, z: -6000 } });
let n2 = 0;
while (!fl2.over && n2 < 4000) { n2++; fl2.model.thr = 0; setAx(-1, 0, 0); stepSim(fl2, H); }
ok(fl2.over && fl2.crashed, "dive ends in crash", "phase=" + fl2.phase);
ok(results.crashed === true && results.crashInfo && results.crashInfo.cost > 0, "crash penalty applied", JSON.stringify(results.crashInfo && { reason: results.crashInfo.reason, cost: results.crashInfo.cost }));
ok((SC.Save.profile.flightsFailed || 0) === fails0 + 1, "failure counted, career intact");
ok(SC.Economy.money() < money1, "repair bill deducted", money1 + " -> " + SC.Economy.money());
ok(SC.Save.profile.aircraftOwned.indexOf("sparrow") >= 0, "aircraft retained after crash");

console.log(fails === 0 ? "\nALL E2E TESTS PASSED" : "\n" + fails + " E2E TEST(S) FAILED");
process.exit(fails === 0 ? 0 : 1);
