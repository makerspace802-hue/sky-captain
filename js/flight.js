/* ============================================================
   SC.Airfield — procedural airport geometry (runway/taxi/gates).
   SC.Flight — FlightModel physics + FlightManager phases/fuel/
               rating hooks/crash/ATC wiring/enroute compression.
   SC.Tutorial — scripted training lessons on top of FlightManager.
   Units: meters (local), feet (alt), knots (speed), degrees.
   Local frame: x = east (m), z = south (m), i.e. north = -z.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  /* ================= AIRFIELD ================= */
  SC.Airfield = {
    // useHdg: departure/landing heading actually used (into wind)
    build: function (airport, useHdg) {
      var H = U.deg2rad(useHdg), L = airport.rwy.len, W = 45;
      var dir = { x: Math.sin(H), z: -Math.cos(H) };      // along runway
      var perp = { x: Math.cos(H), z: Math.sin(H) };      // right of heading
      function P(along, lat) { return { x: dir.x * along + perp.x * lat, z: dir.z * along + perp.z * lat }; }
      var thr = P(-L / 2, 0), far = P(L / 2, 0);
      var corners = [P(-L / 2, -W / 2), P(L / 2, -W / 2), P(L / 2, W / 2), P(-L / 2, W / 2)];
      var gates = [];
      for (var i = 0; i < airport.gates; i++) gates.push(P(-L / 2 + 260 + i * 48, 165));
      var taxiA = P(-L / 2 - 120, 100), taxiB = P(L / 2 + 120, 100);
      var entry = P(-L / 2 + 40, 100);
      var hold = P(-L / 2 + 40, 58);
      var lineup = P(-L / 2 + 120, 0);
      return {
        code: airport.code, hdg: useHdg, len: L, w: W, dir: dir, perp: perp,
        thr: thr, far: far, corners: corners, gates: gates,
        taxiA: taxiA, taxiB: taxiB, entry: entry, hold: hold, lineup: lineup,
        // project local point into along/lat coords
        alongLat: function (x, z) { return { along: x * dir.x + z * dir.z, lat: x * perp.x + z * perp.z }; }
      };
    },
    pickRwyHdg: function (airport, windDir) {
      // choose runway direction with best headwind
      var h1 = airport.rwy.hdg, h2 = U.wrap360(h1 + 180);
      function score(h) { return Math.cos(U.deg2rad(U.angDiff(windDir, h))); }
      return score(h1) >= score(h2) ? h1 : h2;
    },
    rwyName: function (hdg) {
      var n = Math.round(hdg / 10); if (n === 0) n = 36; if (n === 36 && hdg > 350) n = 36;
      return (n < 10 ? "0" : "") + n;
    }
  };

  /* ================= FLIGHT MANAGER ================= */
  var F = SC.Flight = {
    cur: null,

    start: function (cfg) {
      // cfg: {mode, from, to, acId, missionId, lessonId, callsign, spawn}
      var dep = SC.Data.airportByCode(cfg.from), arr = SC.Data.airportByCode(cfg.to);
      var stats = SC.Fleet.effectiveStats(cfg.acId);
      var wDep = SC.Weather.get(dep.code), wArr = SC.Weather.get(arr.code);
      var depHdg = SC.Airfield.pickRwyHdg(dep, wDep.windDir);
      var arrHdg = SC.Airfield.pickRwyHdg(arr, wArr.windDir);
      // arrival runway: land INTO wind => heading ≈ windDir (from) direction... use pick (same logic)
      var depF = SC.Airfield.build(dep, depHdg), arrF = SC.Airfield.build(arr, arrHdg);
      var gate = U.randInt(0, dep.gates - 1);
      var fuel = SC.Fleet.fuelOf(cfg.acId);
      var cruiseKt = U.kmh2kt(stats.cruiseKmh);
      var routeKm = cfg.from === cfg.to ? 0 : U.haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
      var C = SC.Config;
      var enrouteSec = Math.min(C.routeMaxSec, C.routeBaseSec + routeKm * C.routeSecPerKm);
      // Route-adaptive cruise altitude (short routes cruise lower, like real ops).
      var typeCruise = cfg.acId === "sparrow" ? 6000 : cfg.acId === "meridian" ? 16000 : 33000;
      var cruiseAlt = routeKm < 1 ? typeCruise : Math.round(Math.min(typeCruise, 6000 + routeKm * 45) / 100) * 100;
      // Compressed enroute vertical profile: climbs/descents are expedited so
      // they fit the compressed leg time (boost scales vertical speed only).
      var rk = Math.max(routeKm, 150);
      var transAlt = Math.min(6000, cruiseAlt * 0.5);
      var climbWindow = 0.35 * enrouteSec, descWindow = 0.25 * enrouteSec;
      var climbBoost = U.clamp(((cruiseAlt - transAlt) / climbWindow * 60) / 1400, 1, 12);
      var descBoost = U.clamp(((cruiseAlt - 3400) / descWindow * 60) / 1500, 1, 12);
      var fFix = U.clamp(1 - 13 / Math.max(60, rk), 0.5, 0.995);
      var enProf = {
        fClimbEnd: 0.02 + climbWindow / enrouteSec,
        fTOD: U.clamp(fFix - descWindow / enrouteSec, 0.3, 0.96),
        fFix: fFix, climbBoost: climbBoost, descBoost: descBoost
      };
      var est = SC.Economy.estimateFlight(cfg.from, cfg.to, cfg.acId, cfg.missionMult || 1, SC.Game.difficulty());

      var fl = {
        mode: cfg.mode || "free", missionId: cfg.missionId || null, lessonId: cfg.lessonId || null,
        dep: dep, arr: arr, depF: depF, arrF: arrF, activeF: depF,
        depHdg: depHdg, arrHdg: arrHdg, arrRwy: SC.Airfield.rwyName(arrHdg),
        gate: gate, callsign: cfg.callsign || SC.Save.profile.callsign,
        acId: cfg.acId, st: stats, fuel: fuel,
        windDep: wDep, windArr: wArr, wind: wDep,
        cruiseKt: cruiseKt, cruiseAltFt: cruiseAlt,
        routeKm: routeKm, enrouteSec: enrouteSec, est: est,
        transAlt: transAlt, enProf: enProf, fuelStart: fuel,
        phase: "PARKED", sceneMode: "LOCAL_DEP",
        f: 0, courseDeg: routeKm > 1 ? U.bearingDeg(dep.lat, dep.lon, arr.lat, arr.lon) : depHdg,
        fixes: [], fixIdx: 0, over: false, crashed: false, paused: false,
        flightSec: 0, distFlownKm: 0, holdStillT: 0, offCourseT: 0,
        onRunway: false, justAirborne: false, stalled: false, oversped: false,
        ap: false, apTgt: { hdg: null, alt: null, spd: null },
        rating: SC.Rating.newSession(),
        model: null, atc: null, multiplayer: cfg.mode === "mp",
        camChase: !(SC.Game.settings && SC.Game.settings.cockpitCam),
        banT: 0, warnT: 0, touchT: 0, fuelEmptyWarned: false,
        spawnKind: (cfg.spawn && cfg.spawn.kind) || "gate"
      };
      // --- model init ---
      var m = {
        x: 0, z: 0, altFt: 0, hdg: depHdg, pitch: 0, roll: 0,
        iasKt: 0, tasKt: 0, vsFpm: 0, gSpeedKt: 0,
        thr: 0, flaps: 0, gearDown: true, gearPos: 1,
        brake: 0, onGround: true, trackDeg: depHdg
      };
      fl.model = m;
      // wind vector (TO direction) in local frame
      function windVec(w) {
        var to = U.deg2rad(U.wrap360(w.windDir + 180));
        var ms = w.windKt * 0.514444;
        return { x: Math.sin(to) * ms, z: -Math.cos(to) * ms };
      }
      fl.windVecDep = windVec(wDep); fl.windVecArr = windVec(wArr); fl.windVec = fl.windVecDep;

      // spawn placement
      var gp = depF.gates[gate];
      if (fl.spawnKind === "gate") {
        m.x = gp.x; m.z = gp.z;
        // face along taxiway toward entry
        m.hdg = U.wrap360(Math.atan2(depF.entry.x - gp.x, -(depF.entry.z - gp.z)) * 180 / Math.PI);
        fl.fixes = [{ n: "HOLD SHORT " + SC.Airfield.rwyName(depHdg), x: depF.hold.x, z: depF.hold.z, r: 30 }];
      } else if (fl.spawnKind === "hold") {
        m.x = depF.hold.x; m.z = depF.hold.z; m.hdg = depHdg;
        fl.phase = "TAXI_OUT";
        fl.fixes = [{ n: "LINE UP " + SC.Airfield.rwyName(depHdg), x: depF.lineup.x, z: depF.lineup.z, r: 30 }];
      } else if (fl.spawnKind === "airborne") {
        var sp = cfg.spawn;
        m.onGround = false; m.altFt = sp.alt; m.hdg = sp.hdg; m.iasKt = sp.spd;
        m.x = sp.x || 0; m.z = sp.z || 0; m.gearDown = false; m.gearPos = 0;
        fl.phase = "CRUISE"; fl.sceneMode = sp.enroute ? "ENROUTE" : "LOCAL_DEP";
        fl.f = sp.f || 0;
        fl.fixes = [];
      } else if (fl.spawnKind === "final") {
        // 10 km final at destination
        var A = arrF, back = 10000;
        m.x = A.thr.x - A.dir.x * back; m.z = A.thr.z - A.dir.z * back;
        m.altFt = 2600; m.hdg = arrHdg; m.iasKt = U.kmh2kt(stats.vappKmh) + 45;
        m.onGround = false; m.flaps = 1;
        fl.activeF = arrF; fl.sceneMode = "LOCAL_ARR"; fl.phase = "APPROACH"; fl.wind = wArr; fl.windVec = fl.windVecArr;
        fl.fixes = F._finalFixes(A);
      }
      fl.atc = SC.ATC.newSession(fl);
      SC.Traffic.ensurePattern(dep, depHdg);
      SC.Time.resetAccel();
      this.cur = fl;
      SC.Game.state = "flight";
      SC.Game.visit(dep.code);
      if (SC.UI && SC.UI.enterFlight) SC.UI.enterFlight(fl);
      fl.atc.greet();
      if (fl.spawnKind !== "gate") fl.atc.say(fl.callsign + ", training scenario loaded. " + (fl.spawnKind === "final" ? "You are on final — request landing." : "Fly the assigned profile."));
      return fl;
    },

    _finalFixes: function (A) {
      function pt(back, alt) { return { n: back > 8000 ? "FINAL FIX" : back > 3000 ? "FAF" : "THRESHOLD", x: A.thr.x - A.dir.x * back, z: A.thr.z - A.dir.z * back, alt: alt, r: back > 3000 ? 900 : 400 }; }
      return [pt(11000, 3200), pt(5500, 1600), pt(0, 0)];
    },
    _missedFixes: function (A) {
      var p = A.perp, d = A.dir;
      return [
        { n: "MISSED APCH — climb ahead", x: A.thr.x + d.x * 3500, z: A.thr.z + d.z * 3500, alt: 3000, r: 700 },
        { n: "DOWNWIND", x: A.thr.x - d.x * 1500 + p.x * 2600, z: A.thr.z - d.z * 1500 + p.z * 2600, alt: 2500, r: 800 },
        { n: "BASE", x: A.thr.x - d.x * 5500 + p.x * 2600, z: A.thr.z - d.z * 5500 + p.z * 2600, alt: 2000, r: 800 }
      ].concat(this._finalFixes(A));
    },

    // ---- helpers used by ATC/UI ----
    rwyName: function () { var fl = this.cur; return fl ? SC.Airfield.rwyName(fl.depHdg) : ""; },
    isAirborne: function () { var fl = this.cur; return !!fl && !fl.model.onGround; },
    setPhase: function (p) { if (this.cur) this.cur.phase = p; },
    windStr: function (arr) {
      var fl = this.cur, w = arr ? fl.windArr : fl.wind;
      return w.windDir + "°/" + w.windKt + "kt";
    },
    banner: function (txt, kind, dur) { if (SC.UI && SC.UI.flightBanner) SC.UI.flightBanner(txt, kind, dur); },
    violation: function (txt) {
      var fl = this.cur; if (!fl) return;
      fl.rating.safety.violations.push(txt);
      if (SC.UI) SC.UI.toast("⚠️ Violation: " + txt);
    },
    goAround: function () {
      var fl = this.cur; if (!fl || fl.over) return;
      fl.phase = "CLIMB"; fl.model.thr = Math.max(fl.model.thr, 0.92);
      fl.fixes = this._missedFixes(fl.activeF); fl.fixIdx = 0;
      fl.atc.landClear = false;
    },

    buyFuel: function (units) {
      var fl = this.cur; if (!fl || fl.over) return;
      if (!fl.model.onGround || fl.model.gSpeedKt > 3) { if (SC.UI) SC.UI.toast("Must be stopped on the ground"); return; }
      var code = fl.sceneMode === "LOCAL_ARR" ? fl.arr.code : fl.dep.code;
      SC.Fleet.setFuel(fl.acId, fl.fuel); // sync live state first
      var r = SC.Fleet.addFuel(fl.acId, units, code);
      if (r.ok) { fl.fuel = SC.Fleet.fuelOf(fl.acId); SC.Audio.cash(); if (SC.UI) SC.UI.toast("\u26fd +" + Math.round(r.added) + "u for " + U.fmtMoney(r.cost)); }
      else if (SC.UI) SC.UI.toast("\u274c " + (r.reason || "No fuel"));
      if (SC.UI) SC.UI.refreshMoney();
    },
    cycleGear: function () {
      var fl = this.cur; if (!fl || fl.over || fl.paused) return;
      var m = fl.model;
      if (m.onGround && m.gSpeedKt > 5) { this.banner("TOO FAST FOR GEAR", "bad"); return; }
      m.gearDown = !m.gearDown;
      if (SC.UI) SC.UI.toast(m.gearDown ? "Gear DOWN ▾" : "Gear UP ▴");
      SC.Audio.click();
    },
    flapsUp: function () { var fl = this.cur; if (fl && !fl.over && !fl.paused) { fl.model.flaps = Math.min(3, fl.model.flaps + 1); SC.Audio.click(); } },
    flapsDn: function () { var fl = this.cur; if (fl && !fl.over && !fl.paused) { fl.model.flaps = Math.max(0, fl.model.flaps - 1); SC.Audio.click(); } },
    toggleAP: function () {
      var fl = this.cur; if (!fl || fl.over || fl.paused) return;
      if (fl.model.onGround) { this.banner("AUTOPILOT AVAILABLE AIRBORNE", "bad"); return; }
      fl.ap = !fl.ap;
      if (fl.ap) { fl.apTgt.hdg = fl.model.hdg; fl.apTgt.alt = Math.round(fl.model.altFt / 100) * 100; fl.apTgt.spd = fl.model.iasKt; fl._apInt = 0; }
      this.banner(fl.ap ? "AUTOPILOT ENGAGED" : "AUTOPILOT OFF", fl.ap ? "good" : "");
      if (SC.UI && SC.UI.syncAP) SC.UI.syncAP();
    },
    cycleAccel: function () {
      var fl = this.cur; if (!fl) return 1;
      if (fl.multiplayer) { this.banner("TIME ACCEL LOCKED IN MULTIPLAYER", "bad"); return 1; }
      var a = SC.Time.cycleAccel();
      this.banner("TIME ×" + a, "");
      return a;
    },
    togglePause: function () {
      var fl = this.cur; if (!fl || fl.over) return;
      fl.paused = !fl.paused;
      if (SC.UI && SC.UI.syncPause) SC.UI.syncPause();
    },

    /* ================= MAIN UPDATE ================= */
    update: function (dtReal) {
      var fl = this.cur;
      if (!fl || fl.over || fl.paused) return;
      SC.Input.pollPad();
      var accel = fl.multiplayer ? 1 : SC.Time.accel();
      var dtSim = Math.min(dtReal, 0.1) * accel;
      var steps = Math.max(1, Math.ceil(dtSim / 0.05)), h = dtSim / steps;
      for (var i = 0; i < steps; i++) { this._step(fl, h); if (fl.over) break; }
      if (fl.over) return;
      fl.flightSec += dtSim;
      SC.Time.advance(dtSim);
      SC.Traffic.update(dtSim);
      fl.atc.update(dtSim);
      // fuel persist (throttled)
      fl._saveT = (fl._saveT || 0) + dtSim;
      if (fl._saveT > 10) { fl._saveT = 0; SC.Fleet.setFuel(fl.acId, fl.fuel); }
      // MP position broadcast
      if (fl.multiplayer && SC.MP.connected) {
        var ll = this.latLon(fl);
        SC.MP.sendPos({ lat: ll.lat, lon: ll.lon, altFt: fl.model.altFt, hdg: fl.model.hdg, spd: fl.model.gSpeedKt, phase: fl.phase });
      }
      SC.MP.tick(dtReal);
      // tutorial check
      if (fl.lessonId) SC.Tutorial.check(fl, dtSim);
      // audio
      SC.Audio.updateFlight(fl.model.thr, fl.model.iasKt, fl.model.onGround);
      // UI hud
      if (SC.UIFlight) SC.UIFlight.update(fl, dtReal);
      if (SC.Render) SC.Render.draw(fl, dtReal);
    },

    latLon: function (fl) {
      if (fl.sceneMode === "ENROUTE") {
        var p = U.greatCircle(fl.dep.lat, fl.dep.lon, fl.arr.lat, fl.arr.lon, U.clamp(fl.f, 0, 1));
        return p;
      }
      var A = fl.sceneMode === "LOCAL_ARR" ? fl.arr : fl.dep;
      return { lat: A.lat - fl.model.z / 111320, lon: A.lon + fl.model.x / (111320 * Math.cos(U.deg2rad(A.lat))) };
    },

    /* ================= PHYSICS STEP ================= */
    _step: function (fl, dt) {
      var m = fl.model, st = fl.st, assists = SC.Game.assists();
      var ax = SC.Input.getAxes();
      if (fl.uiPitch != null) { ax.pitch = fl.uiPitch; ax.roll = fl.uiRoll; }
      if (fl.ap) this._autopilot(fl, ax, dt);
      var brakeCmd = Math.max(ax.brake, fl.uiBrake ? 1 : 0);
      m.brake = brakeCmd;
      // throttle command
      if (!fl.ap) {
        if (ax.thrDelta !== 0) m.thr = U.clamp(m.thr + ax.thrDelta * 0.55 * dt, 0, 1);
        if (fl.uiThr != null) m.thr = U.clamp(fl.uiThr, 0, 1);
      }
      var fuelEmpty = fl.fuel <= 0;
      var thrEff = fuelEmpty ? 0 : m.thr;
      if (fuelEmpty && !fl.fuelEmptyWarned) {
        fl.fuelEmptyWarned = true;
        this.banner("⛽ FUEL EXHAUSTED — ENGINES OUT", "bad", 5);
        fl.atc.say(fl.callsign + ", low fuel state emergency. Nearest runway " + fl.arrRwy + ". Good luck, Captain.");
      }
      // gear transit
      var gearTgt = m.gearDown ? 1 : 0;
      m.gearPos += U.clamp(gearTgt - m.gearPos, -dt / 3, dt / 3);

      var vmaxKt = U.kmh2kt(st.maxKmh);
      var stallBase = U.kmh2kt(st.stallKmh);
      var stallS = stallBase * [1, 0.93, 0.87, 0.82][m.flaps];
      var T0 = 5 + 2 * (vmaxKt / 500);                    // full-thrust accel kt/s
      var kd = 0.5 * T0 / (vmaxKt * vmaxKt);              // drag coeff
      var dragX = 1 + m.gearPos * 0.28 + [0, 0.18, 0.32, 0.5][m.flaps];
      var wob = fl.wind.turb * assists.turbulence;

      if (m.onGround) {
        // ---- ground roll ----
        var steer = U.clamp(ax.roll + ax.yaw * 0.6, -1, 1);
        var turnRate = U.clamp(26 / (1 + m.gSpeedKt * 0.06), 2, 16) * (m.gSpeedKt > 1 ? 1 : 0); // nosewheel: nimble slow, gentle fast
        m.hdg = U.wrap360(m.hdg + steer * turnRate * dt);
        // allow rotation pitch on roll
        var vrKt = U.kmh2kt(st.vrKmh);
        if (m.iasKt > vrKt * 0.9 && m.onGround) { // rotation allowed whenever fast (rolling takeoffs too)
          m.pitch = U.clamp(m.pitch + ax.pitch * 22 * dt, 0, 15);
          m.pitch += (10 - m.pitch) * 0.1 * dt * (ax.pitch > 0.2 ? 3 : 0);
        } else m.pitch += (0 - m.pitch) * 3 * dt;
        m.roll += (0 - m.roll) * 5 * dt;
        var thrustAcc = thrEff * T0;
        var dragAcc = kd * m.iasKt * m.iasKt * dragX + 0.55 + m.iasKt * 0.065 + brakeCmd * 15 * st.brakes; // static + rolling friction
        // rough terrain off paved surfaces
        var surf = this._surface(fl);
        if (surf === "rough") {
          dragAcc += 2.5; // soft ground: slow crawl, escapable at high power
          if (m.gSpeedKt > 45) return this.crash("Runway excursion at high speed");
          if (fl.warnT <= 0) { this.banner("ROUGH TERRAIN — RETURN TO PAVEMENT", "bad", 2); fl.warnT = 4; }
        }
        m.iasKt = Math.max(0, m.iasKt + (thrustAcc - dragAcc) * dt);
        // ground speed: tires grip, so only a fraction of wind drifts the jet;
        // brakes or parked throttle hold it fully (no more wind-sailing).
        var wv = fl.windVec;
        var grip = brakeCmd > 0.3 ? 0.0 : 0.12;
        var hvx = Math.sin(U.deg2rad(m.hdg)) * m.iasKt * 0.514444 + wv.x * grip;
        var hvz = -Math.cos(U.deg2rad(m.hdg)) * m.iasKt * 0.514444 + wv.z * grip;
        if (m.iasKt < 0.5 && thrEff < 0.1) { hvx = 0; hvz = 0; } // static hold when parked
        m.gSpeedKt = Math.sqrt(hvx * hvx + hvz * hvz) * 1.94384;
        m.trackDeg = U.wrap360(Math.atan2(hvx, -hvz) * 180 / Math.PI);
        m.x += hvx * dt; m.z += hvz * dt;
        m.altFt = 0; m.vsFpm = 0; m.tasKt = m.iasKt;
        fl.distFlownKm += m.gSpeedKt * 1.852 * dt / 3600;
        // runway occupancy
        var al = fl.activeF.alongLat(m.x, m.z);
        fl.onRunway = Math.abs(al.lat) < fl.activeF.w / 2 + 3 && Math.abs(al.along) < fl.activeF.len / 2 + 60;
        // taxi speed rating
        if (fl.phase === "TAXI_OUT" || fl.phase === "TAXI_IN") {
          if (m.gSpeedKt > fl.rating.taxi.maxKt) fl.rating.taxi.maxKt = m.gSpeedKt;
        }
        // liftoff?
        if (m.onGround && m.iasKt >= vrKt * [1, 0.95, 0.9, 0.86][m.flaps] && m.pitch >= 7) {
          if (!fl.onRunway && fl.warnT <= 0) { this.violation("Off-runway takeoff"); }
          m.onGround = false; fl.justAirborne = true;
          fl.phase = "CLIMB";
          fl.rating.takeoff.done = true;
          fl.rating.takeoff.center = Math.abs(al.lat);
          fl.rating.takeoff.rotateOk = m.pitch >= 8 && m.pitch <= 18;
          this.banner("ROTATE — POSITIVE CLIMB", "good");
          fl.atc.say(fl.callsign + ", contact departure. Climb " + fl.cruiseAltFt + " ft.");
          fl.fixes = [];
          setTimeout(function () { fl.justAirborne = false; }, 4000);
        }
        // phase auto-detect: lineup / takeoff roll
        if (fl.phase === "TAXI_OUT" && fl.onRunway && m.gSpeedKt < 8) fl.phase = "HOLD_SHORT";
        if ((fl.phase === "HOLD_SHORT" || fl.phase === "LINEUP" || fl.phase === "TAXI_OUT") && thrEff > 0.85 && m.gSpeedKt > 25 && fl.onRunway) {
          fl.phase = "TAKEOFF";
          if (!fl.atc.takeoffClear && fl.warnT <= 0) { this.banner("NO TAKEOFF CLEARANCE!", "bad", 3); }
        }
        if (fl.phase === "HOLD_SHORT" && !fl.onRunway && m.gSpeedKt > 8 && thrEff > 0.5) fl.phase = "TAXI_OUT";
        // arrival: rollout -> taxi-in -> gate
        if (fl.phase === "ROLLOUT" && m.gSpeedKt < 32) {
          fl.phase = "TAXI_IN";
          var g = fl.activeF.gates[fl.gate % fl.activeF.gates.length];
          fl.fixes = [{ n: "GATE " + (fl.gate + 1), x: g.x, z: g.z, r: 30 }];
          fl.atc.expected = "taxi-in"; fl.atc.rating = fl.atc.rating; fl.rating.atc.required++;
        }
        if (fl.phase === "TAXI_IN" && fl.fixes.length) {
          var gf = fl.fixes[0], dd = Math.hypot(m.x - gf.x, m.z - gf.z);
          if (dd < 30 && m.gSpeedKt < 3 && m.thr < 0.08) {
            fl.holdStillT += dt;
            if (fl.holdStillT > 3) return this.complete();
          } else fl.holdStillT = 0;
        }
        // deadstick safety: out of fuel on taxi-in -> tow truck drags you in
        if (fl.phase === "TAXI_IN" && fl.fuel <= 0.01 && m.gSpeedKt < 1 && fl.fixes.length) {
          fl._towT = (fl._towT || 0) + dt;
          var gf2 = fl.fixes[0], bd = Math.hypot(m.x - gf2.x, m.z - gf2.z);
          if (fl._towT > 8 && bd > 12) {
            m.x += (gf2.x - m.x) / bd * 3.1 * dt; m.z += (gf2.z - m.z) / bd * 3.1 * dt;
            m.hdg = U.wrap360(Math.atan2(gf2.x - m.x, -(gf2.z - m.z)) * 180 / Math.PI);
            if (fl.warnT <= 0) { this.banner("\ud83d\ude9c TOW TO GATE \u2014 OUT OF FUEL", "", 3); fl.warnT = 6; }
          } else if (fl._towT > 8 && bd <= 12) return this.complete(); // towed into place
        } else if (fl.phase === "TAXI_IN") fl._towT = 0;
      } else {
        // ---- airborne ----
        var auth = 0.55 + 0.45 * U.clamp(m.iasKt / (stallS * 1.6), 0.25, 1); // control authority
        if (fl.stalled) auth *= 0.45;
        // pitch/roll dynamics
        var stab = assists.stability;
        m.pitch += (ax.pitch * 26 * auth * st.handling) * dt;
        m.pitch += (this._trimPitch(fl, m.iasKt, stallS) - m.pitch) * (ax.pitch === 0 ? (0.6 + stab * 2.2) : 0.25) * dt;
        m.roll += (ax.roll * 70 * auth * st.handling) * dt;
        var rollLim = SC.Game.difficulty() === "easy" ? 32 : 50;
        m.roll = U.clamp(m.roll + (0 - m.roll) * (ax.roll === 0 ? (0.8 + stab * 3) : 0.4) * dt, -rollLim, rollLim);
        m.pitch = U.clamp(m.pitch, -28, 28);
        // turbulence
        if (wob > 0.02) {
          m.pitch += (Math.random() - 0.5) * wob * 22 * dt;
          m.roll += (Math.random() - 0.5) * wob * 34 * dt;
        }
        // stall
        var stallNow = m.iasKt < stallS;
        if (stallNow && !fl.stalled) {
          fl.stalled = true; fl.rating.safety.stall = true;
          SC.Audio.warnStall();
          this.banner("⚠️ STALL — LOWER NOSE, FULL POWER", "bad", 3);
          if (assists.stallProtect) { m.pitch = Math.min(m.pitch, 2); }
        } else if (!stallNow) fl.stalled = false;
        // level pitch & vertical speed
        var level = this._levelPitch(m.iasKt, stallS);
        var fpa = m.pitch - level;
        m.tasKt = m.iasKt * (1 + m.altFt / 55000);
        m.vsFpm = m.tasKt * 101.27 * Math.sin(U.deg2rad(fpa));
        if (fl.stalled) m.vsFpm -= (stallS - m.iasKt) * 90;
        if (m.altFt < 30 && m.vsFpm < 0) m.vsFpm *= 0.85; // ground effect
        if (wob > 0.02) m.vsFpm += (Math.random() - 0.5) * wob * 900;
        // compressed-leg vertical expedition (climb/descend fits the short leg)
        if (fl.sceneMode === "ENROUTE") {
          if (fl.phase === "CLIMB" && m.vsFpm > 0) m.vsFpm *= fl.enProf.climbBoost;
          else if (fl.phase === "DESCENT" && m.vsFpm < 0) m.vsFpm *= fl.enProf.descBoost;
        }
        m.altFt += m.vsFpm / 60 * dt;
        // turn coordination + rudder
        var vms = Math.max(30, m.tasKt * 0.514444);
        var turnRad = 9.81 * Math.tan(U.deg2rad(m.roll)) / vms;
        var coord = 0.35 + 0.65 * assists.coordAssist;
        m.hdg = U.wrap360(m.hdg + (U.rad2deg(turnRad) * coord + ax.yaw * 7) * dt);
        // speed
        var thrustAcc2 = thrEff * T0 * (1 - 0.5 * m.iasKt / vmaxKt);
        var dragAcc2 = kd * m.iasKt * m.iasKt * dragX;
        var slopeAcc = -19.06 * Math.sin(U.deg2rad(fpa));
        m.iasKt = U.clamp(m.iasKt + (thrustAcc2 - dragAcc2 + slopeAcc) * dt, 0, vmaxKt * 1.35);
        // overspeed
        var vne = vmaxKt * 1.06;
        if (m.iasKt > vne && !fl.oversped) {
          fl.oversped = true; fl.rating.safety.overspeed = true;
          SC.Audio.warnOverspeed();
          this.banner("⚠️ OVERSPEED", "bad", 2.5);
        } else if (m.iasKt < vne * 0.97) fl.oversped = false;
        if (m.iasKt > vmaxKt * 1.26) return this.crash("Structural overspeed breakup");
        // flap limit
        var vfe = [1e9, U.kmh2kt(fl.st.vappKmh) + 70, U.kmh2kt(fl.st.vappKmh) + 40, U.kmh2kt(fl.st.vappKmh) + 15][m.flaps];
        if (m.iasKt > vfe && fl.warnT <= 0) { this.banner("FLAP LIMIT SPEED", "bad", 2); fl.warnT = 5; }
        // move
        var wv2 = fl.windVec;
        var ax2 = Math.sin(U.deg2rad(m.hdg)) * m.tasKt * 0.514444 + wv2.x;
        var az2 = -Math.cos(U.deg2rad(m.hdg)) * m.tasKt * 0.514444 + wv2.z;
        m.gSpeedKt = Math.sqrt(ax2 * ax2 + az2 * az2) * 1.94384;
        m.trackDeg = U.wrap360(Math.atan2(ax2, -az2) * 180 / Math.PI);
        if (fl.sceneMode === "ENROUTE") {
          // compressed progress along great circle
          var rate = (m.tasKt * 1.852) / Math.max(50, fl.routeKm) / 3600;
          var targetRate = 1 / Math.max(60, fl.enrouteSec);
          var compress = targetRate / ((fl.cruiseKt * 1.852) / Math.max(50, fl.routeKm) / 3600);
          fl.f += rate * compress * dt;
          var pos = U.greatCircle(fl.dep.lat, fl.dep.lon, fl.arr.lat, fl.arr.lon, U.clamp(fl.f, 0, 1));
          var ahead = U.greatCircle(fl.dep.lat, fl.dep.lon, fl.arr.lat, fl.arr.lon, U.clamp(fl.f + 0.01, 0, 1));
          fl.courseDeg = U.bearingDeg(pos.lat, pos.lon, ahead.lat, ahead.lon);
          fl.distFlownKm += m.tasKt * 1.852 * compress * dt / 3600;
          // nav rating
          var dev = Math.abs(U.angDiff(m.hdg, fl.courseDeg));
          if (dev > fl.rating.nav.maxDev) fl.rating.nav.maxDev = dev;
          if (dev > 18) fl.rating.nav.offCourseSec += dt;
          // TOD + arrival transition (compressed profile)
          var EP = fl.enProf;
          if (fl.f >= EP.fTOD && fl.phase === "CRUISE") {
            fl.phase = "DESCENT";
            this.banner("\u2b07 TOP OF DESCENT \u2014 BEGIN DESCENT", "", 4);
            fl.atc.say(fl.callsign + ", descend to 3,400 ft, expect ILS " + fl.arrRwy + ".");
          }
          if (fl.f >= EP.fFix && (fl.phase === "DESCENT" || fl.phase === "CRUISE")) this._arriveLocal(fl);
          if (fl.phase === "CLIMB" && (m.altFt >= fl.cruiseAltFt * 0.98 || fl.f >= EP.fClimbEnd)) {
            fl.phase = "CRUISE";
            if (m.altFt < fl.cruiseAltFt * 0.9) { m.altFt = fl.cruiseAltFt; } // level at cruise
            this.banner("CRUISE " + Math.round(fl.cruiseAltFt) + " FT", "good");
          }
        } else {
          m.x += ax2 * dt; m.z += az2 * dt;
          fl.distFlownKm += m.gSpeedKt * 1.852 * dt / 3600;
          var al2 = fl.activeF.alongLat(m.x, m.z);
          fl.onRunway = Math.abs(al2.lat) < fl.activeF.w / 2 + 3 && Math.abs(al2.along) < fl.activeF.len / 2 + 60;
          // departure -> enroute transition
          if (fl.sceneMode === "LOCAL_DEP" && fl.phase === "CLIMB" && m.altFt > fl.transAlt && fl.routeKm > 120) {
            fl.sceneMode = "ENROUTE"; fl.f = 0.02;
            this.banner("✈ ENROUTE — " + fl.dep.code + " → " + fl.arr.code + " (" + Math.round(fl.routeKm) + " km)", "", 4);
          } else if (fl.sceneMode === "LOCAL_DEP" && fl.routeKm <= 120 && fl.phase === "CLIMB" && m.altFt > 2500 && !fl._circ) {
            // pattern circuit for same-airport flights
            fl._circ = true; fl.phase = "CRUISE";
            var A = fl.activeF;
            fl.fixes = [
              { n: "CROSSWIND", x: A.thr.x + A.dir.x * 2500, z: A.thr.z + A.dir.z * 2500, alt: 2000, r: 600 },
              { n: "DOWNWIND", x: A.thr.x + A.perp.x * 2600, z: A.thr.z + A.perp.z * 2600, alt: 2000, r: 700 },
              { n: "BASE", x: A.thr.x - A.dir.x * 3500 + A.perp.x * 2600, z: A.thr.z - A.dir.z * 3500 + A.perp.z * 2600, alt: 1500, r: 700 }
            ].concat(this._finalFixes(A));
            fl.fixIdx = 0;
            this.banner("CIRCUIT — FLY DOWNWIND, THEN FINAL", "", 4);
          }
          // approach sequencing
          this._seqFixes(fl);
          if (fl.phase === "CRUISE" && fl.sceneMode === "LOCAL_ARR") fl.phase = "APPROACH";
          if (fl.phase === "APPROACH" && fl.fixIdx >= fl.fixes.length - 1) fl.phase = "FINAL";
          // touchdown?
          if (m.altFt <= 0) { m.altFt = 0; return this._touchdown(fl); }
          // terrain safety: below 400ft far from airport
          var dC = Math.hypot(m.x, m.z);
          if (m.altFt < 120 && dC > fl.activeF.len && m.vsFpm < -1200) return this.crash("Controlled flight into terrain");
        }
      }
      // ---- fuel burn (1 s ≈ 0.1 fuel baseline at cruise) ----
      var ph = this._fuelPhase(fl);
      var mult = SC.Config.fuelPhaseMult[ph] || 1;
      fl.fuel = Math.max(0, fl.fuel - st.flowCruise * mult * dt);
      var pct = fl.fuel / st.fuelCap;
      if (pct < SC.Config.fuelWarningPct && !fl._fuelWarned && !fuelEmpty) {
        fl._fuelWarned = true;
        this.banner("⛽ LOW FUEL — " + Math.round(pct * 100) + "% REMAINING", "bad", 4);
        fl.atc.say(fl.callsign + ", fuel state low. Advise intentions.");
      }
      fl.warnT = Math.max(0, fl.warnT - dt);
      // flight hours accumulate
      SC.Game.addHours(dt);
    },

    _levelPitch: function (ias, stallS) {
      return U.clamp(7 * Math.pow(stallS / Math.max(ias, 20), 2), 0.5, 14);
    },
    _trimPitch: function (fl, ias, stallS) {
      return this._levelPitch(ias, stallS) + (fl.phase === "CLIMB" ? 5 : fl.phase === "DESCENT" || fl.phase === "APPROACH" ? -2 : 0.5);
    },
    _fuelPhase: function (fl) {
      if (fl.model.onGround) {
        if (fl.phase === "TAKEOFF") return "takeoff";
        if (fl.phase === "ROLLOUT") return "rollout";
        return "taxi";
      }
      if (fl.phase === "CLIMB") return "climb";
      if (fl.phase === "CRUISE") return "cruise";
      if (fl.phase === "DESCENT") return "descent";
      return "approach";
    },
    _surface: function (fl) {
      var A = fl.activeF, al = A.alongLat(fl.model.x, fl.model.z);
      if (Math.abs(al.lat) < A.w / 2 + 6 && Math.abs(al.along) < A.len / 2 + 80) return "runway";
      if (Math.abs(al.lat - 100) < 22 && Math.abs(al.along) < A.len / 2 + 150) return "taxi";
      // paved apron box: gate row <-> taxiway, continuous pavement gate to hold
      var gA0 = -A.len / 2 + 260 - 120, gA1 = -A.len / 2 + 260 + (A.gates.length - 1) * 48 + 90;
      if (al.along > gA0 && al.along < gA1 && al.lat > 20 && al.lat < 230) return "apron";
      // taxi connectors
      if (Math.hypot(fl.model.x - A.entry.x, fl.model.z - A.entry.z) < 90) return "taxi";
      if (Math.hypot(fl.model.x - A.hold.x, fl.model.z - A.hold.z) < 60) return "taxi";
      return "rough";
    },
    _seqFixes: function (fl) {
      if (!fl.fixes.length || fl.fixIdx >= fl.fixes.length) return;
      var fx = fl.fixes[fl.fixIdx], m = fl.model;
      var d = Math.hypot(m.x - fx.x, m.z - fx.z);
      if (d < (fx.r || 500)) {
        fl.fixIdx++;
        if (fl.fixIdx < fl.fixes.length) {
          var nx = fl.fixes[fl.fixIdx];
          this.banner("➤ NEXT: " + nx.n, "", 2.5);
        }
      }
    },
    _arriveLocal: function (fl) {
      // transition ENROUTE -> destination local scene on final
      var A = fl.arrF, st = fl.st;
      fl.sceneMode = "LOCAL_ARR"; fl.activeF = A;
      fl.wind = fl.windArr; fl.windVec = fl.windVecArr;
      var back = 11500;
      fl.model.x = A.thr.x - A.dir.x * back;
      fl.model.z = A.thr.z - A.dir.z * back;
      fl.model.altFt = Math.min(fl.model.altFt, 3400);
      if (fl.model.altFt < 2200) fl.model.altFt = 3000;
      fl.model.hdg = fl.arrHdg; fl.model.pitch = -2; fl.model.roll = 0;
      fl.model.iasKt = Math.min(fl.model.iasKt, U.kmh2kt(st.vappKmh) + 60);
      fl.model.flaps = Math.max(fl.model.flaps, 1);
      fl.phase = "APPROACH";
      fl.fixes = this._finalFixes(A); fl.fixIdx = 0;
      SC.Traffic.ensurePattern(fl.arr, fl.arrHdg);
      fl.atc.say(fl.callsign + ", " + fl.arr.city + " Approach. You are 7 miles final, runway " + fl.arrRwy + ".");
      this.banner("🛬 ARRIVAL — " + fl.arr.city.toUpperCase() + " APPROACH", "good", 4);
      if (SC.UI) SC.UI.toast("Switched to " + fl.arr.code + " local airspace");
    },

    _touchdown: function (fl) {
      var m = fl.model, A = fl.activeF;
      var al = A.alongLat(m.x, m.z);
      var onRwy = Math.abs(al.lat) < A.w / 2 + 8 && al.along > -A.len / 2 - 120 && al.along < A.len / 2 + 60;
      var vs = m.vsFpm, gear = m.gearDown && m.gearPos > 0.8;
      // crash evaluation
      if (!gear) return this.crash("Gear-up landing");
      if (vs < -950) return this.crash("Hard landing — gear collapsed (" + Math.round(vs) + " fpm)");
      if (Math.abs(m.roll) > 16) return this.crash("Wingtip strike on touchdown");
      if (!onRwy && m.gSpeedKt > 60) return this.crash("Off-runway touchdown at speed");
      // safe touchdown
      m.onGround = true; m.pitch = 0; m.roll = 0; m.vsFpm = 0;
      m.thr = Math.min(m.thr, 0.15);
      fl.phase = "ROLLOUT";
      var L = fl.rating.landing;
      L.done = true; L.vsFpm = vs; L.centerM = Math.abs(al.lat); L.gearDown = gear; L.onRunway = onRwy;
      SC.Audio.touchdown();
      var q = vs > -160 ? "BUTTER — BEAUTIFUL LANDING!" : vs > -320 ? "SMOOTH TOUCHDOWN" : vs > -500 ? "FIRM LANDING" : "HARD LANDING";
      this.banner("🛬 " + q + " (" + Math.round(vs) + " FPM)", vs > -500 ? "good" : "bad", 3.5);
      var p = SC.Save.profile;
      if (p && (p.bestLandingFpm == null || vs > p.bestLandingFpm)) { p.bestLandingFpm = Math.round(vs); SC.Save.markDirty(); }
      if (vs > -150) SC.Career.award("smooth");
      // fuel reserve score
      fl.rating.fuel.reservePct = fl.fuel / fl.st.fuelCap;
      fl.atc.say(fl.callsign + ", vacate when able. Taxi to gate " + (fl.gate + 1) + ".");
    },

    _autopilot: function (fl, ax, dt) {
      var m = fl.model, st = fl.st;
      // determine targets
      var tgtHdg = fl.apTgt.hdg, tgtAlt = fl.apTgt.alt;
      // APP guidance: active on approach/final (or short-final with fixes behind us,
      // e.g. pattern circuits) — survives fix exhaustion so AP always lands.
      var A0 = fl.activeF;
      var dThr0 = Math.hypot(m.x - A0.thr.x, m.z - A0.thr.z);
      var appActive = !m.onGround && fl.sceneMode !== "ENROUTE" &&
        ((fl.phase === "FINAL" || fl.phase === "APPROACH") ||
         (fl.fixes.length > 0 && fl.fixIdx >= fl.fixes.length - 1 && dThr0 < 2500));
      if (appActive) {
        var al0 = A0.alongLat(m.x, m.z);
        // distThr: along-track distance remaining to threshold (+ before, - past).
        var distThr = -(al0.along + A0.len / 2);
        // Glide from along-track distance: dies to zero at/past the threshold,
        // so AP commits to land instead of chasing a climbing radial glide.
        tgtAlt = U.clamp(U.m2ft(Math.max(0, distThr) * Math.tan(U.deg2rad(3))), 0, 4000);
        // Wind-triangle crab: exact heading that tracks the centerline in wind.
        var wv0 = fl.windVec, V0 = Math.max(30, m.iasKt * 0.514444);
        var trkR = U.deg2rad(A0.hdg), gx0 = Math.sin(trkR), gz0 = -Math.cos(trkR);
        var wAl = gx0 * wv0.x + gz0 * wv0.z;
        var gSpd = wAl + Math.sqrt(Math.max(100, wAl * wAl - (wv0.x * wv0.x + wv0.z * wv0.z) + V0 * V0));
        var crabHdg = U.wrap360(Math.atan2(gSpd * gx0 - wv0.x, -(gSpd * gz0 - wv0.z)) * 180 / Math.PI);
        if (dThr0 < 600 && m.altFt < 80) { tgtAlt = 4; tgtHdg = crabHdg + U.clamp(-al0.lat * 0.2, -12, 12); } // auto-flare: round out + hold centerline
        else if (dThr0 < 2500 && distThr > 60) tgtHdg = crabHdg + U.clamp(U.rad2deg(Math.atan2(-al0.lat, distThr)) * 3.0, -30, 30); // localizer beam
        else if (dThr0 < 2500) tgtHdg = crabHdg;
        else if (fl.fixIdx < fl.fixes.length) {
          var fxA = fl.fixes[fl.fixIdx];
          tgtHdg = U.wrap360(Math.atan2(fxA.x - m.x, -(fxA.z - m.z)) * 180 / Math.PI);
        } else tgtHdg = crabHdg;
        if (dThr0 < 9000 && m.gearPos < 1) { m.gearDown = true; }
        if (dThr0 < 7000) m.flaps = 3; else if (dThr0 < 11000) m.flaps = Math.max(m.flaps, 2);
      }
      else if (fl.sceneMode === "ENROUTE") { tgtHdg = fl.courseDeg; tgtAlt = fl.cruiseAltFt; if (fl.phase === "DESCENT") tgtAlt = 3400; }
      else if (fl.fixIdx < fl.fixes.length && !m.onGround) {
        var fx = fl.fixes[fl.fixIdx];
        tgtHdg = U.wrap360(Math.atan2(fx.x - m.x, -(fx.z - m.z)) * 180 / Math.PI);
        if (fx.alt) tgtAlt = fx.alt;
      }
      var av = 0.6 + 0.1 * st.avionics; // avionics improves tracking
      var dh = U.angDiff(m.hdg, tgtHdg);
      var rollTgt = U.clamp(dh * 1.6, -24, 24);
      ax.roll = U.clamp((rollTgt - m.roll) / 22, -1, 1) * av;
      var dAlt = tgtAlt - m.altFt;
      fl._apInt = U.clamp((fl._apInt || 0) + U.clamp(dAlt, -150, 150) * dt, -250, 250); // integral, anti-windup
      var vsTgt = U.clamp(dAlt * 1.6 + fl._apInt * 1.2, -1400, 1400);
      var stallS = U.kmh2kt(st.stallKmh) * [1, 0.93, 0.87, 0.82][m.flaps]; // match plant: flap-corrected
      var level = this._levelPitch(Math.max(m.iasKt, stallS), stallS);
      var pitchTgt = level + U.rad2deg(Math.asin(U.clamp(vsTgt / Math.max(800, m.tasKt * 101.27), -0.35, 0.35)));
      ax.pitch = U.clamp((pitchTgt - m.pitch) / 9, -1, 1) * av;
      // speed hold
      var spdTgt = fl.phase === "FINAL" ? U.kmh2kt(st.vappKmh) + Math.min(15, fl.wind.windKt * 0.5) : fl.phase === "APPROACH" ? U.kmh2kt(st.vappKmh) + 30 : fl.phase === "CLIMB" ? U.kmh2kt(st.vrKmh) + 70 : fl.cruiseKt;
      if (appActive || (fl.sceneMode !== "ENROUTE" && m.altFt < 3000 && (fl.phase === "FINAL" || fl.phase === "APPROACH"))) spdTgt = U.kmh2kt(st.vappKmh) + Math.min(15, fl.wind.windKt * 0.5);
      m.thr = U.clamp(m.thr + U.clamp((spdTgt - m.iasKt) / 40, -1, 1) * 0.8 * dt, 0, 1);
      if (appActive && m.altFt < 50) m.thr = Math.min(m.thr, 0.08); // flare: retard to idle
      fl._apDbg = { h: Math.round(tgtHdg), a: Math.round(tgtAlt), s: Math.round(spdTgt), app: appActive ? 1 : 0 };
      ax.yaw = 0;
    },

    crash: function (reason) {
      var fl = this.cur; if (!fl || fl.over) return;
      fl.over = true; fl.crashed = true; fl.phase = "CRASHED";
      fl.rating.safety.crash = true;
      SC.Audio.crash();
      SC.Fleet.setFuel(fl.acId, fl.fuel * 0.75); // fuel lost in crash
      var cost = SC.Economy.applyCrashPenalty(fl.acId);
      var res = SC.Rating.finalize(fl.rating, { tolerance: SC.Game.assists().tolerance });
      // record failed flight stats
      var p = SC.Save.profile;
      if (p) {
        p.ratingSum += res.total; p.ratingsCount++;
        p.distanceFlownKm += fl.distFlownKm;
        SC.Save.markDirty();
      }
      SC.Save.saveNow();
      if (SC.UI && SC.UI.showCrash) SC.UI.showCrash(fl, reason, cost, res);
    },

    complete: function () {
      var fl = this.cur; if (!fl || fl.over) return;
      fl.over = true; fl.phase = "DONE";
      SC.Audio.chime();
      var res = SC.Rating.finalize(fl.rating, { tolerance: SC.Game.assists().tolerance });
      var pay = SC.Economy.settleFlight(fl.est, res.total, fl.rating.landing.score, fl.rating.goArounds, false);
      var p = SC.Save.profile;
      if (p) {
        p.flightsCompleted++;
        p.ratingSum += res.total; p.ratingsCount++;
        p.distanceFlownKm += Math.max(fl.distFlownKm, fl.routeKm > 1 ? fl.routeKm : 60);
        SC.Save.markDirty();
      }
      SC.Fleet.setFuel(fl.acId, fl.fuel);
      SC.Game.visit(fl.arr.code);
      if (fl.routeKm >= 5000) SC.Career.award("long-haul");
      if (res.total >= 5) SC.Career.award("five-star");
      if (fl.rating.atc.required > 0 && fl.rating.atc.complied >= fl.rating.atc.required) SC.Career.award("atc-pro");
      if (!p.tutorialCompleted && fl.lessonId === "T5") { /* handled by tutorial */ }
      if (p.flightsCompleted === 1) SC.Career.award("first-flight");
      if (fl.missionId) SC.Career.completeMission(fl.missionId);
      if (fl.lessonId) SC.Tutorial.lessonFlightDone(fl, res);
      SC.Save.saveNow();
      if (SC.UI && SC.UI.showResults) SC.UI.showResults(fl, res, pay, false);
    },

    endFlightEarly: function () {
      var fl = this.cur; if (!fl || fl.over) return;
      fl.over = true;
      SC.Fleet.setFuel(fl.acId, fl.fuel);
      SC.Save.saveNow();
      SC.Audio.idle();
      if (SC.UI) SC.UI.exitToMenu();
    }
  };

  /* ================= TUTORIAL ================= */
  var Tut = SC.Tutorial = {
    progress: null, // {lessonId, stepIdx, timers}

    start: function (lessonId) {
      var L = null;
      for (var i = 0; i < SC.Data.LESSONS.length; i++) if (SC.Data.LESSONS[i].id === lessonId) L = SC.Data.LESSONS[i];
      if (!L) return;
      this.progress = { lessonId: lessonId, stepIdx: 0, holdT: 0, navT: 0, altT: 0, atcN: 0 };
      var p = SC.Save.profile, acId = "sparrow";
      if (p.aircraftOwned.indexOf("sparrow") < 0) acId = p.activeAircraft;
      var base = { mode: "lesson", from: L.airport, to: L.dest || L.airport, acId: acId, lessonId: lessonId, callsign: p.callsign, missionMult: 1 };
      if (lessonId === "T1") base.spawn = { kind: "gate" };
      else if (lessonId === "T2") base.spawn = { kind: "hold" };
      else if (lessonId === "T3") base.spawn = { kind: "airborne", alt: 8000, hdg: 60, spd: 110, x: -3000, z: 2000 };
      else if (lessonId === "T4") base.spawn = { kind: "final" };
      else if (lessonId === "T5") base.spawn = { kind: "gate" };
      // ensure fuel for training
      if (SC.Fleet.fuelOf(acId) < SC.Fleet.effectiveStats(acId).fuelCap * 0.5)
        SC.Fleet.setFuel(acId, SC.Fleet.effectiveStats(acId).fuelCap * 0.8);
      SC.Flight.start(base);
      if (SC.UI) SC.UI.toast("🎓 Lesson: " + L.name);
    },

    _L: function () {
      var id = this.progress && this.progress.lessonId;
      for (var i = 0; i < SC.Data.LESSONS.length; i++) if (SC.Data.LESSONS[i].id === id) return SC.Data.LESSONS[i];
      return null;
    },
    _stepDone: function (fl) {
      var P = this.progress, L = this._L();
      SC.Audio.chime();
      P.stepIdx++; P.holdT = 0; P.navT = 0; P.altT = 0;
      if (P.stepIdx >= L.steps.length) this.completeLesson(fl);
      else if (SC.UI) SC.UI.toast("✅ " + L.steps[P.stepIdx - 1].text);
    },

    check: function (fl, dt) {
      var P = this.progress; if (!P || P.lessonId !== fl.lessonId) return;
      var L = this._L(); if (!L) return;
      if (P.stepIdx >= L.steps.length) return;
      var m = fl.model, st = L.steps[P.stepIdx], ok = false;
      var id = fl.lessonId + ":" + st.id;
      if (id === "T1:thr") ok = m.thr > 0.2 || m.gSpeedKt > 3;
      else if (id === "T1:steer") { if (P.h0 == null) P.h0 = m.hdg; var moved = Math.hypot(m.x - fl.depF.gates[fl.gate].x, m.z - fl.depF.gates[fl.gate].z); ok = moved > 12 || Math.abs(U.angDiff(P.h0, m.hdg)) > 15; }
      else if (id === "T1:brake") { if (m.thr < 0.05 && m.gSpeedKt < 3) { P.holdT += dt; ok = P.holdT > 1.5; } else P.holdT = 0; }
      else if (id === "T1:hold") { var dh = Math.hypot(m.x - fl.depF.hold.x, m.z - fl.depF.hold.z); if (dh < 30 && m.gSpeedKt < 4) { P.holdT += dt; ok = P.holdT > 2; } else P.holdT = 0; }
      else if (id === "T2:lineup") ok = fl.onRunway && m.gSpeedKt < 10;
      else if (id === "T2:power") ok = m.thr > 0.95 && (m.gSpeedKt > 40 || !m.onGround);
      else if (id === "T2:rotate") ok = !m.onGround;
      else if (id === "T2:climb") ok = !m.onGround && m.altFt > 3000;
      else if (id === "T3:hdg") { if (Math.abs(U.angDiff(m.hdg, 90)) < 10) { P.holdT += dt; ok = P.holdT > 4; } else P.holdT = 0; }
      else if (id === "T3:alt") { if (Math.abs(m.altFt - 8000) < 300) { P.altT += dt; ok = P.altT > 10; } else P.altT = 0; }
      else if (id === "T3:fuel") { if (SC.UIFlight && SC.UIFlight.fuelChecked) { ok = true; SC.UIFlight.fuelChecked = false; } }
      else if (id === "T3:nav") { if (Math.abs(U.angDiff(m.hdg, 90)) < 20) { P.navT += dt; ok = P.navT > 60; } else P.navT = 0; }
      else if (id === "T4:desc") ok = !m.onGround && m.altFt < 2500;
      else if (id === "T4:cfg") ok = m.gearDown && m.flaps >= 3;
      else if (id === "T4:align") { var al = fl.activeF.alongLat(m.x, m.z); ok = !m.onGround && Math.abs(al.lat) < 60 && m.altFt < 2000; }
      else if (id === "T4:land") ok = m.onGround && fl.phase !== "APPROACH" && fl.phase !== "FINAL";
      else if (id === "T5:atctx") ok = fl.rating.atc.complied >= 3;
      else if (id === "T5:takeoff") ok = !m.onGround && m.altFt > 5000;
      else if (id === "T5:cruise") { if (fl.phase === "CRUISE" || fl.sceneMode === "ENROUTE") { P.navT += dt; ok = P.navT > 60; } }
      else if (id === "T5:land") ok = fl.phase === "DONE" || fl.phase === "TAXI_IN" || fl.phase === "ROLLOUT";
      if (ok) this._stepDone(fl);
      if (SC.UIFlight) SC.UIFlight.tutorialBanner(L, P.stepIdx);
      // training completion for T1-T4 (no full flight needed)
      if ((fl.lessonId === "T1" || fl.lessonId === "T2" || fl.lessonId === "T3" || fl.lessonId === "T4") && P.stepIdx >= L.steps.length - 1 && ok) {
        // completed on last step via _stepDone -> completeLesson ends flight
      }
    },

    completeLesson: function (fl) {
      var L = this._L(), p = SC.Save.profile;
      var reward = { T1: 800, T2: 1200, T3: 1500, T4: 2000, T5: 3000 }[L.id] || 1000;
      if (p && p.lessonsDone.indexOf(L.id) < 0) {
        p.lessonsDone.push(L.id);
        SC.Economy.add(reward, "training");
        if (SC.UI) SC.UI.toast("🎓 Lesson complete! +" + U.fmtMoney(reward));
      }
      if (L.id === "T5" && p) p.tutorialCompleted = true;
      SC.Save.saveNow();
      // training lessons end after steps (except T5 which completes as flight)
      if (L.id !== "T5" && fl && !fl.over) {
        fl.over = true;
        SC.Fleet.setFuel(fl.acId, fl.fuel);
        setTimeout(function () {
          if (SC.UI) { SC.UI.exitToMenu(); SC.UI.show("tutorial"); SC.UI.toast("Lesson '" + L.name + "' complete"); }
        }, 1200);
        F.banner("🎓 LESSON COMPLETE — +" + U.fmtMoney(reward), "good", 3);
      }
      this.progress = null;
    },
    lessonFlightDone: function (fl, res) {
      // T5 finished as a full flight; rewards already handled in completeLesson path
      if (this.progress && this.progress.lessonId === "T5") {
        var L = this._L();
        this.completeLesson(fl);
      }
    }
  };
})();
