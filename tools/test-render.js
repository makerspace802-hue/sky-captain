// Render regression test: fly a scripted BOM -> GOI and call SC.Render.draw
// with a recording canvas context at every phase. Asserts:
//   1. draw() never throws (day, night, storm, cockpit + chase cameras)
//   2. the runway polygon is actually painted while on/near the ground
//      (guards the old near-plane pop-out where the airfield vanished)
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
const fills = [];
function recordingCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p === "canvas") return t.canvas;
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return () => ({ data: [] });
      return (...a) => {};
    },
    set(t, p, v) { if (p === "fillStyle") fills.push(String(v)); t[p] = v; return true; }
  });
}
const flightCanvas = {
  width: 1280, height: 720,
  getContext: () => recordingCtx(),
  getBoundingClientRect: () => ({ width: 1280, height: 720 }),
  addEventListener() {}, style: {}
};
function byId(id) { return id === "flight-canvas" ? flightCanvas : makeEl(); }
const sandbox = {
  console, setTimeout, clearTimeout, window: {},
  navigator: {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: { getElementById: byId, querySelectorAll: () => [], createElement: () => makeEl(), addEventListener() {}, hidden: false, readyState: "complete" },
  requestAnimationFrame: () => 0,
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["config.js", "utils.js", "data.js", "save.js", "audio.js", "input.js", "core.js", "atc.js", "net.js", "flight.js", "render.js"])
  vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), sandbox, { filename: f });
const SC = sandbox.SC, U = SC.Utils;
SC.UI = { toast() {}, flightBanner() {}, enterFlight() {}, exitToMenu() {}, syncAP() {}, syncPause() {}, showResults() {}, showCrash() {}, refreshMoney() {}, onChatMsg() {} };
SC.Audio = { ensure() {}, click() {}, chime() {}, atcTone() {}, warnStall() {}, warnOverspeed() {}, touchdown() {}, crash() {}, cash() {}, updateFlight() {}, idle() {}, applySettings() {} };
SC.Input = { axes: { pitch: 0, roll: 0, yaw: 0, brake: 0, thrDelta: 0 }, getAxes() { return Object.assign({}, this.axes); }, pollPad() {}, onAction() {} };
SC.Render.init("flight-canvas");

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log("  PASS " + msg);
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? " :: " + extra : "")); }
}
function setAx(p, r, b) { SC.Input.axes.pitch = p; SC.Input.axes.roll = r; SC.Input.axes.brake = b || 0; SC.Input.axes.yaw = 0; }
function brgTo(m, tx, tz) { return U.wrap360(Math.atan2(tx - m.x, -(tz - m.z)) * 180 / Math.PI); }
function steerTo(m, tx, tz, a) { return U.clamp(U.angDiff(m.hdg, brgTo(m, tx, tz)) / (a || 25), -1, 1); }
const H = 0.05;
function stepSim(fl, h) { SC.Flight._step(fl, h); if (!fl.over) { fl.flightSec += h; SC.Time.advance(h); fl.atc.update(h); } }

console.log("== render: all phases, day/night/storm, both cameras ==");
SC.Save.loadAll();
SC.Save.newProfile("Render Bot", "X");
SC.Weather.init(); SC.Time.init(); SC.Traffic.init();
SC.Weather.randomize = function (code) { this._cache[code] = { cond: "clear", windDir: 250, windKt: 8, visKm: 30, turb: 0 }; return this._cache[code]; };
const fl = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "RND001" });
fl.atc.handlePhrase("taxi");

const sawRunway = {};
function tryDraw(tag, needRunway) {
  fills.length = 0;
  try { SC.Render.draw(fl, 0.05); }
  catch (e) { ok(false, "draw " + tag + " throws", String(e && e.message).slice(0, 160)); return; }
  ok(true, "draw " + tag);
  const hasRwy = fills.indexOf("#3c414c") >= 0 || fills.indexOf("#1a2233") >= 0;
  if (needRunway) {
    sawRunway[tag] = hasRwy;
    ok(hasRwy, "runway painted (" + tag + ")", hasRwy ? undefined : "runway poly missing from frame");
  }
}

let stage = "taxi", n = 0, stillN = 0, stuckN = 0, saidAppr = false, saidLand = false, geared = false;
const MAX = 60000, vrKt = U.kmh2kt(fl.st.vrKmh);
let lastPh = "";
tryDraw("PARKED-at-gate", true);
while (!fl.over && n < MAX) {
  n++;
  const m = fl.model;
  if (fl.phase !== lastPh) {
    const ground = m.onGround && fl.sceneMode !== "ENROUTE";
    tryDraw("phase:" + fl.phase, ground || fl.phase === "FINAL" || fl.phase === "APPROACH");
    lastPh = fl.phase;
  }
  if (stage === "taxi") {
    const t = fl.depF.hold, d = Math.hypot(m.x - t.x, m.z - t.z);
    setAx(0, steerTo(m, t.x, t.z), 0);
    if (d > 60) m.thr = 0.35; else if (d > 26) { m.thr = 0.18; setAx(0, steerTo(m, t.x, t.z), m.gSpeedKt > 8 ? 1 : 0); }
    else { m.thr = 0; setAx(0, 0, 1); }
    if (d > 26 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.6; } else stuckN = 0;
    if (d < 26 && m.gSpeedKt < 4) { if (++stillN > 10) { stage = "lineup"; fl.atc.handlePhrase("takeoff"); } } else stillN = 0;
  } else if (stage === "lineup") {
    const t = fl.depF.lineup, d = Math.hypot(m.x - t.x, m.z - t.z);
    setAx(0, steerTo(m, t.x, t.z, 18), 0);
    m.thr = d > 25 ? 0.3 : 0.18;
    if (d > 22 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.6; } else stuckN = 0;
    if (d < 14) stage = "roll";
  } else if (stage === "roll") {
    var rlat = fl.depF.alongLat(m.x, m.z).lat;
    setAx(m.iasKt > vrKt * 0.98 ? 0.55 : 0, U.clamp(U.angDiff(m.hdg, fl.depHdg) / 10 - rlat / 40, -1, 1), 0);
    m.thr = 1;
    if (!m.onGround) { stage = "auto"; SC.Flight.toggleAP(); fl.apTgt.hdg = fl.depHdg; fl.apTgt.alt = fl.cruiseAltFt; }
  } else if (stage === "auto") {
    setAx(0, 0, 0);
    if (!geared && !m.onGround && m.vsFpm > 400 && m.altFt > 300 && fl.sceneMode === "LOCAL_DEP") { geared = true; SC.Flight.cycleGear(); }
    if (fl.sceneMode === "LOCAL_ARR" && !saidAppr) { saidAppr = true; fl.atc.handlePhrase("approach"); }
    if (fl.phase === "FINAL" && !saidLand) { saidLand = true; fl.atc.handlePhrase("landing"); }
    if (fl.phase === "ROLLOUT") { stage = "rollout"; fl.ap = false; }
    if (fl.phase === "FINAL" && n % 1500 === 0) tryDraw("FINAL@" + n, true);
  } else if (stage === "rollout") {
    m.thr = 0;
    var olat = fl.activeF.alongLat(m.x, m.z).lat;
    setAx(0, U.clamp(U.angDiff(m.hdg, fl.arrHdg) / 10 - olat / 40, -1, 1), m.gSpeedKt > 12 ? 0.7 : 0.3);
    if (fl.phase === "TAXI_IN") stage = "taxiin";
  } else if (stage === "taxiin") {
    const AF = fl.activeF, al = AF.alongLat(m.x, m.z);
    const gate = fl.fixes[0] || AF.gates[0];
    const gA0 = -AF.len / 2 + 260 - 120, gA1 = -AF.len / 2 + 260 + (AF.gates.length - 1) * 48 + 90;
    const abeam = Math.min(Math.max(al.along, gA0 + 60), gA1 - 60);
    let t = gate;
    if (Math.abs(al.lat) < 40 && (al.along < gA0 + 40 || al.along > gA1 - 40)) t = { x: AF.dir.x * abeam, z: AF.dir.z * abeam };
    const d = Math.hypot(m.x - t.x, m.z - t.z);
    if (t !== gate && Math.abs(U.angDiff(m.hdg, brgTo(m, t.x, t.z))) > 60 && m.gSpeedKt > 8) { m.thr = 0; setAx(0, steerTo(m, t.x, t.z), 1); }
    else {
      setAx(0, steerTo(m, t.x, t.z), 0);
      if (d > 60) m.thr = 0.35; else if (d > 26) { m.thr = 0.18; setAx(0, steerTo(m, t.x, t.z), m.gSpeedKt > 7 ? 1 : 0); }
      else if (t === gate) { m.thr = 0; setAx(0, 0, m.gSpeedKt > 1 ? 1 : 0); }
      else m.thr = 0.15;
    }
    if (d > 26 && m.gSpeedKt < 0.5) { if (++stuckN > 60) m.thr = 0.7; } else stuckN = 0;
  }
  stepSim(fl, H);
}
// weather/camera extremes at the final state
SC.Time.simMin = 30;
fl.wind = { cond: "storm", windDir: 250, windKt: 28, visKm: 5, turb: 0.9 };
fl.camChase = true;
tryDraw("NIGHT-STORM-CHASE", false);
fl.camChase = false;
tryDraw("NIGHT-STORM-COCKPIT", false);

console.log(fails === 0 ? "\nALL RENDER TESTS PASSED" : "\n" + fails + " RENDER TEST(S) FAILED");
process.exit(fails === 0 ? 0 : 1);
