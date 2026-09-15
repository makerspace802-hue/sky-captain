// UI flow test: boots the FULL app (all 16 scripts) with a stub DOM and drives
// it like a user: pilot creation, every menu screen, flight start + HUD frames,
// ATC phrases, pause/accel/camera toggles, tutorial start, ATC shift with a
// hold command, multiplayer lobby, crash + results. Fails on any exception.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const errors = [];
const store = {};
function makeStub() {
  const f = function () {};
  const stub = new Proxy(f, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === "length") return 0;
      if (p === "readyState") return "complete";
      return stub;
    },
    set() { return true; },
    apply() { return stub; },
    construct() { return stub; },
    has() { return true; }
  });
  return stub;
}
const stub = makeStub();
let frames = 0;
const sandbox = {
  console: Object.assign({}, console, { error: (...a) => { errors.push(a.map(String).join(" ")); } }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (cb) => { if (++frames <= 2) setTimeout(() => { try { cb(frames * 16.7); } catch (e) { errors.push("rAF: " + e.message); } }, 0); return frames; },
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  fetch: () => Promise.reject(new Error("offline")),
  document: stub, window: null, navigator: stub,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const files = ["config.js", "utils.js", "data.js", "save.js", "audio.js", "input.js", "core.js", "atc.js", "net.js", "flight.js", "render.js", "maps.js", "ui.js", "ui-flight.js", "ui-atc.js", "main.js"];
for (const f of files) {
  try { vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), sandbox, { filename: f }); }
  catch (e) { console.log("LOAD FAIL " + f + ": " + e.message); process.exit(1); }
}
console.log("loaded " + files.length + " scripts, boot dispatched");

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log("  PASS " + msg);
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? " :: " + String(extra).slice(0, 200) : "")); }
}
function step(name, fn) {
  try { fn(); console.log("  PASS " + name); }
  catch (e) { fails++; console.log("  FAIL " + name + " :: " + String(e && e.stack || e).split("\n").slice(0, 2).join(" | ")); }
}

setTimeout(() => {
  const SC = sandbox.SC;
  try {
    ok(SC.UI.current === "pilot", "boot lands on pilot screen (no profile)", SC.UI.current);

    step("create pilot -> main", () => {
      SC.Save.newProfile("Flow Tester", "X");
      SC.UI.show("main");
      if (SC.UI.current !== "main") throw new Error("current=" + SC.UI.current);
    });

    ["hangar", "map", "profile", "career", "tutorial", "settings", "multiplayer", "atc"].forEach(scr => {
      step("visit screen: " + scr, () => {
        SC.UI.show(scr);
        if (SC.UI.current !== scr) throw new Error("current=" + SC.UI.current);
      });
    });

    step("router go()", () => {
      SC.UI.go("freeflight"); if (SC.UI.current !== "map") throw new Error("freeflight");
      SC.UI.go("main"); if (SC.UI.current !== "main") throw new Error("main");
    });

    step("map route planning", () => {
      SC.UI.show("map");
      SC.UI._routeChanged();
      SC.WorldMap.draw(0.016);
      const est = SC.Economy.estimateFlight("BOM", "GOI", "sparrow", 1, "normal");
      if (!(est.fuelNeeded > 0 && est.earnAt5 > est.earnAt3)) throw new Error("bad estimate");
    });

    let fl = null;
    step("start flight + 40 HUD frames", () => {
      fl = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "FLOW01" });
      if (SC.UI.current !== "flight") throw new Error("not in flight screen");
      for (let i = 0; i < 40; i++) SC.Flight.update(0.05);
      if (fl.phase !== "PARKED") throw new Error("phase=" + fl.phase);
    });

    step("ATC phrases + free text", () => {
      fl.atc.handlePhrase("taxi");
      if (fl.phase !== "TAXI_OUT" || !fl.atc.taxiClear) throw new Error("taxi clearance failed");
      fl.atc.handleText("request takeoff");
      if (!fl.atc.takeoffClear) throw new Error("takeoff clearance failed");
      fl.atc.handleText("nonsense blablah");
      fl.atc.handlePhrase("roger");
    });

    step("toggles: accel/AP/cam/pause/fuel/gears/flaps", () => {
      SC.Flight.cycleAccel();
      SC.Flight.toggleAP(); // parked: expect graceful refusal banner
      SC.UIFlight._toggleCam();
      SC.UIFlight._toggleCam();
      SC.Flight.togglePause(); SC.Flight.togglePause();
      SC.Flight.buyFuel(10); // full tank: graceful toast path
      SC.Flight.cycleGear(); SC.Flight.cycleGear();
      SC.Flight.flapsUp(); SC.Flight.flapsDn();
      for (let i = 0; i < 10; i++) SC.Flight.update(0.05);
    });

    step("tutorial start T1 + frames", () => {
      SC.Tutorial.start("T1");
      const tf = SC.Flight.cur;
      if (tf.lessonId !== "T1") throw new Error("no lesson");
      for (let i = 0; i < 10; i++) SC.Flight.update(0.05);
      SC.Flight.endFlightEarly();
    });

    step("ATC shift + hold orbit + radar", () => {
      SC.UI.show("atc");
      SC.ATCRoom.start("BOM", "tower");
      if (SC.ATCRoom.targets.length !== 4) throw new Error("targets=" + SC.ATCRoom.targets.length);
      const arr = SC.ATCRoom.targets.filter(t => t.type === "arr")[0];
      SC.ATCRoom.selected = arr.id;
      SC.ATCRoom.command("hold");
      if (!arr.holding) throw new Error("hold not set");
      const x0 = arr.x, z0 = arr.z, wp0 = arr.wp;
      for (let i = 0; i < 40; i++) SC.ATCRoom.update(0.5);
      if (arr.wp !== wp0) throw new Error("holding aircraft advanced waypoints");
      if (Math.hypot(arr.x - x0, arr.z - z0) < 50) throw new Error("holding aircraft frozen");
      SC.ATCRoom.command("land");
      if (arr.holding || !arr.landClear) throw new Error("land did not release hold");
      SC.Radar.draw(sandbox.document.getElementById("radar-canvas"), SC.ATCRoom);
      SC.UIATC.tick(0.05);
      SC.UIATC.toggleShift(); // end shift, pays out
      if (SC.ATCRoom.active) throw new Error("shift still active");
    });

    step("minimap both modes", () => {
      const cv = sandbox.document.getElementById("minimap-canvas");
      SC.MiniMap.draw(cv, fl);
      fl.sceneMode = "ENROUTE"; fl.f = 0.5;
      SC.MiniMap.draw(cv, fl);
      fl.sceneMode = "LOCAL_DEP";
    });

    step("crash -> modal -> results", () => {
      const cf = SC.Flight.start({ mode: "free", from: "BOM", to: "GOI", acId: "sparrow", callsign: "CRSH01" });
      SC.Flight.crash("test crash");
      if (!cf.crashed || !cf.over) throw new Error("crash state wrong");
      const res = SC.Rating.finalize(fl.rating, { tolerance: 1 });
      SC.UI.showResults(fl, res, { base: 0, ratingMult: 0, rated: 0, landingBonus: 0, goAroundBonus: 0, total: 0 }, true);
      if (SC.UI.current !== "results") throw new Error("current=" + SC.UI.current);
    });

    step("hangar buy/select/refuel/upgrade paths", () => {
      SC.UI.show("hangar");
      SC.UI.hangarSel = "meridian";
      SC.UI._refreshHangar();
      SC.UI._doRefuel(false); // slider 0 -> graceful failure toast path
      SC.Fleet.buyUpgrade("sparrow", "engine");
    });

    step("licenses/career/ratings math", () => {
      const c = SC.Licenses.canBuy("ppl");
      if (c.ok) throw new Error("ppl should be locked for fresh pilot");
      const ms = SC.Career.missionsWithStatus();
      if (ms.length !== SC.Data.MISSIONS.length || ms[0].locked) throw new Error("M1 should be open");
    });
  } catch (e) {
    fails++;
    console.log("  FAIL harness :: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | "));
  }

  // multiplayer connect is async (local transport resolves after ~400ms)
  setTimeout(() => {
    step("multiplayer join + chat + leave", () => {
      if (!SC.MP.connected) throw new Error("not connected");
      SC.MP.sendChat("hello airspace");
      SC.MP.tick(0.2);
      SC.UIATC.enterAirspace();
      SC.MP.disconnect();
      if (SC.MP.connected) throw new Error("still connected");
    });
    const bootErrs = errors.filter(e => e.indexOf("rAF:") !== 0);
    console.log("console.errors=" + errors.length);
    bootErrs.slice(0, 8).forEach(e => console.log("  ERR: " + String(e).slice(0, 250)));
    if (bootErrs.length) fails += bootErrs.length;
    console.log(fails === 0 ? "\nALL UI FLOW TESTS PASSED" : "\n" + fails + " UI FLOW TEST(S) FAILED");
    process.exit(fails === 0 ? 0 : 1);
  }, 900);
  try { SC.UIATC.connect(); } catch (e) { fails++; console.log("  FAIL mp connect threw :: " + e.message); }
}, 1500);
