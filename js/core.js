/* ============================================================
   SC core systems: Game, Economy, Fleet, Airports, Licenses,
   Career, Rating, Weather, Time. Clean modular managers behind
   tiny interfaces; all balance from Config + Data.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  /* ================= GAME ================= */
  var Game = SC.Game = {
    state: "menu",   // menu | flight | atc
    settings: null,
    P: function () { return SC.Save.profile; },
    hasProfile: function () { return SC.Save.hasProfile(); },

    init: function () {
      SC.Save.loadAll();
      this.settings = SC.Save.settings;
      SC.Weather.init();
      SC.Time.init();
    },
    difficulty: function () { return (this.settings && this.settings.difficulty) || "normal"; },
    assists: function () { return SC.Config.difficulty[this.difficulty()] || SC.Config.difficulty.normal; },

    avgRating: function () {
      var p = this.P(); if (!p || !p.ratingsCount) return 0;
      return p.ratingSum / p.ratingsCount;
    },
    highestLicense: function () {
      var p = this.P(); if (!p) return "student";
      var best = "student", br = -1;
      for (var i = 0; i < p.licenses.length; i++) {
        var r = SC.Data.licenseRank(p.licenses[i]);
        if (r > br) { br = r; best = p.licenses[i]; }
      }
      return best;
    },
    aircraftAllowed: function (acId) {
      var p = this.P(); if (!p) return false;
      if (p.aircraftOwned.indexOf(acId) < 0) return false;
      var ac = SC.Data.aircraftById(acId);
      return SC.Data.licenseRank(this.highestLicense()) >= SC.Data.licenseRank(ac.license);
    },
    addHours: function (sec) { var p = this.P(); if (p) { p.flightHours += sec / 3600; SC.Save.markDirty(); } },
    visit: function (code) {
      var p = this.P(); if (!p) return;
      if (p.airportsVisited.indexOf(code) < 0) { p.airportsVisited.push(code); SC.Save.markDirty(); }
      if (p.airportsVisited.length >= 10) SC.Career.award("world-tour");
    },
    levelTitle: function () {
      var p = this.P(); if (!p) return "—";
      if (p.flightsCompleted >= 70) return "Senior Captain";
      if (p.flightsCompleted >= 40) return "Captain";
      if (p.flightsCompleted >= 15) return "First Officer";
      if (p.flightsCompleted >= 4) return "Junior Pilot";
      return "Student Pilot";
    }
  };

  /* ================= ECONOMY ================= */
  var Economy = SC.Economy = {
    money: function () { var p = SC.Save.profile; return p ? Math.round(p.money) : 0; },
    fmt: function (v) { return U.fmtMoney(v == null ? this.money() : v); },
    canAfford: function (cost) { return this.money() >= cost; },
    spend: function (cost, reason) {
      var p = SC.Save.profile; if (!p) return false;
      cost = Math.round(cost);
      if (p.money < cost) return false;
      p.money -= cost; SC.Save.markDirty();
      return true;
    },
    add: function (amount, reason) {
      var p = SC.Save.profile; if (!p) return;
      p.money += Math.round(amount); SC.Save.markDirty();
      if (p.money >= 1000000) SC.Career.award("millionaire");
    },

    fuelPricePerUnit: function (acId, airportCode) {
      var ac = SC.Data.aircraftById(acId);
      var ap = SC.Data.airportByCode(airportCode || SC.Config.starterAirport);
      return (ac.fullRefillCost / ac.fuelCap) * (ap ? ap.fuelMult : 1);
    },

    // Full pre-flight estimate used by map + hangar.
    estimateFlight: function (fromCode, toCode, acId, missionMult, difficulty) {
      var C = SC.Config, st = SC.Fleet.effectiveStats(acId);
      var distKm = (fromCode === toCode) ? 80 :
        SC.Airports.distanceKm(fromCode, toCode);
      var enrouteSec = Math.min(C.routeMaxSec, C.routeBaseSec + distKm * C.routeSecPerKm);
      var fm = C.fuelPhaseMult, flow = st.flowCruise;
      // Phase-time model mirrors the compressed enroute profile in flight.js.
      var climbT = 200 + 0.30 * enrouteSec, cruiseT = Math.max(60, 0.45 * enrouteSec), descT = 100 + 0.20 * enrouteSec;
      var fuelNeed = (70 * fm.taxi + 45 * fm.takeoff + climbT * fm.climb +
        cruiseT * fm.cruise + descT * fm.descent +
        60 * fm.approach + 40 * fm.rollout + 70 * fm.taxi) * flow;
      fuelNeed *= (1 + C.fuelReservePct);
      var earnBase = (C.earnBase + distKm * C.earnPerKm * st.earnFactor) *
        (missionMult || 1) * (C.earnDifficultyMult[difficulty || "normal"] || 1);
      var price = this.fuelPricePerUnit(acId, fromCode);
      return {
        distanceKm: distKm, enrouteSec: enrouteSec,
        totalSec: enrouteSec + 420,
        fuelNeeded: fuelNeed, fuelCap: st.fuelCap,
        fuelOk: fuelNeed <= st.fuelCap,
        earnBase: earnBase,
        earnAt3: earnBase * C.earnRatingMult[2],
        earnAt5: earnBase * C.earnRatingMult[4],
        fuelCost: fuelNeed * price
      };
    },

    // Finalize pay after a rated flight.
    settleFlight: function (est, ratingTotal, landingScore, goArounds, crashed) {
      var C = SC.Config;
      if (crashed) return { base: 0, ratingMult: 0, rated: 0, landingBonus: 0, goAroundBonus: 0, total: 0 };
      var idx = U.clamp(Math.round(ratingTotal) - 1, 0, 4);
      var mult = C.earnRatingMult[idx];
      var rated = est.earnBase * mult;
      var landBonus = C.earnLandingBonus * (landingScore / 5);
      var gaBonus = (goArounds || 0) * C.goAroundBonus;
      var total = Math.round(rated + landBonus + gaBonus);
      this.add(total, "flight");
      return { base: Math.round(est.earnBase), ratingMult: mult, rated: Math.round(rated), landingBonus: Math.round(landBonus), goAroundBonus: Math.round(gaBonus), total: total };
    },

    applyCrashPenalty: function (acId) {
      var C = SC.Config, ac = SC.Data.aircraftById(acId);
      var cost = Math.max(C.crashRepairMin, Math.round(ac.price * C.crashRepairPct));
      var p = SC.Save.profile;
      if (p) {
        p.money = Math.max(0, p.money - cost);
        p.flightsFailed = (p.flightsFailed || 0) + 1;
        SC.Save.markDirty();
      }
      return cost;
    }
  };

  /* ================= FLEET (aircraft + upgrades + fuel) ================= */
  var Fleet = SC.Fleet = {
    ownedSpecs: function () {
      var p = SC.Save.profile; if (!p) return [];
      return p.aircraftOwned.map(function (id) { return SC.Data.aircraftById(id); });
    },
    activeId: function () {
      var p = SC.Save.profile;
      return (p && p.activeAircraft) || SC.Config.starterAircraftId;
    },
    activeSpec: function () { return SC.Data.aircraftById(this.activeId()); },

    select: function (id) {
      var p = SC.Save.profile; if (!p) return false;
      if (p.aircraftOwned.indexOf(id) < 0) return false;
      p.activeAircraft = id; SC.Save.markDirty();
      return true;
    },
    purchase: function (id) {
      var p = SC.Save.profile; if (!p) return { ok: false, reason: "No profile" };
      if (p.aircraftOwned.indexOf(id) >= 0) return { ok: false, reason: "Already owned" };
      var ac = SC.Data.aircraftById(id);
      if (SC.Data.licenseRank(Game.highestLicense()) < SC.Data.licenseRank(ac.license))
        return { ok: false, reason: "Requires " + SC.Data.licenseById(ac.license).name };
      if (!Economy.spend(ac.price, "aircraft")) return { ok: false, reason: "Not enough money" };
      p.aircraftOwned.push(id);
      p.fuelState[id] = 0;
      SC.Save.markDirty();
      if (id === "titan") SC.Career.award("titan-pilot");
      if (id === "colossus") SC.Career.award("colossus-pilot");
      return { ok: true };
    },

    // upgrades: profile.upgrades[acId][upgId] = level 0..5
    upgradeLevel: function (acId, upgId) {
      var p = SC.Save.profile;
      return (p && p.upgrades[acId] && p.upgrades[acId][upgId]) || 0;
    },
    buyUpgrade: function (acId, upgId) {
      var p = SC.Save.profile; if (!p) return { ok: false };
      var ac = SC.Data.aircraftById(acId);
      var upg = null;
      for (var i = 0; i < SC.Data.UPGRADES.length; i++) if (SC.Data.UPGRADES[i].id === upgId) upg = SC.Data.UPGRADES[i];
      if (!upg) return { ok: false };
      var lvl = this.upgradeLevel(acId, upgId);
      if (lvl >= 5) return { ok: false, reason: "Max level" };
      var cost = SC.Data.upgradeCost(ac, upg, lvl);
      if (!Economy.spend(cost, "upgrade")) return { ok: false, reason: "Not enough money" };
      if (!p.upgrades[acId]) p.upgrades[acId] = {};
      p.upgrades[acId][upgId] = lvl + 1;
      SC.Save.markDirty();
      return { ok: true, level: lvl + 1 };
    },

    effectiveStats: function (acId) {
      var ac = SC.Data.aircraftById(acId), L = function (id) { return Fleet.upgradeLevel(acId, id); };
      var tank = 1 + 0.06 * L("airframe"), burn = 1 - 0.05 * L("fuel");
      return {
        id: ac.id, name: ac.name, category: ac.category, icon: ac.icon,
        fuelCap: Math.round(ac.fuelCap * tank),
        flowCruise: ac.flowCruise * Math.max(0.6, burn),
        cruiseKmh: ac.cruiseKmh * (1 + 0.04 * L("engine")),
        maxKmh: ac.maxKmh * (1 + 0.04 * L("engine")),
        stallKmh: ac.stallKmh, vrKmh: ac.vrKmh, vappKmh: ac.vappKmh,
        rangeKm: Math.round(ac.rangeKm * tank / Math.max(0.6, burn)),
        pax: ac.pax, earnFactor: ac.earnFactor * (1 + 0.06 * L("cabin")),
        handling: Math.min(1.15, ac.handling * (1 + 0.03 * L("engine"))),
        avionics: L("avionics"), brakes: 1 + 0.12 * L("brakes"),
        desc: ac.desc, price: ac.price, license: ac.license
      };
    },

    // ---- fuel ----
    fuelOf: function (acId) {
      var p = SC.Save.profile; if (!p) return 0;
      if (p.fuelState[acId] == null) { p.fuelState[acId] = 0; }
      return p.fuelState[acId];
    },
    setFuel: function (acId, units) {
      var p = SC.Save.profile; if (!p) return;
      var cap = this.effectiveStats(acId).fuelCap;
      p.fuelState[acId] = U.clamp(units, 0, cap);
      SC.Save.markDirty();
    },
    // Partial refuel: add `units` (clamped to capacity), pay per-unit.
    addFuel: function (acId, units, airportCode) {
      units = Math.max(0, units);
      if (units <= 0.01) return { ok: false, reason: "Select an amount first" };
      var cap = this.effectiveStats(acId).fuelCap;
      var cur = this.fuelOf(acId);
      var room = cap - cur;
      if (room <= 0.01) return { ok: false, reason: "Tank is already full" };
      var add = Math.min(units, room);
      var cost = add * Economy.fuelPricePerUnit(acId, airportCode);
      if (!Economy.spend(cost, "fuel")) return { ok: false, reason: "Not enough money" };
      this.setFuel(acId, cur + add);
      return { ok: true, added: add, cost: cost, now: cur + add, cap: cap };
    }
  };

  /* ================= AIRPORTS ================= */
  var Airports = SC.Airports = {
    all: function () { return SC.Data.AIRPORTS; },
    get: function (code) { return SC.Data.airportByCode(code); },
    distanceKm: function (a, b) {
      var A = this.get(a), B = this.get(b);
      return U.haversineKm(A.lat, A.lon, B.lat, B.lon);
    },
    bearing: function (a, b) {
      var A = this.get(a), B = this.get(b);
      return U.bearingDeg(A.lat, A.lon, B.lat, B.lon);
    },
    search: function (q) {
      q = String(q || "").toLowerCase().trim();
      if (!q) return [];
      return SC.Data.AIRPORTS.filter(function (a) {
        return a.code.toLowerCase().indexOf(q) >= 0 || a.city.toLowerCase().indexOf(q) >= 0 ||
          a.name.toLowerCase().indexOf(q) >= 0 || a.country.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 8);
    }
  };

  /* ================= LICENSES ================= */
  var Licenses = SC.Licenses = {
    has: function (id) { var p = SC.Save.profile; return !!p && p.licenses.indexOf(id) >= 0; },
    canBuy: function (id) {
      var p = SC.Save.profile, L = SC.Data.licenseById(id), why = [];
      if (!p) return { ok: false, why: ["No profile"] };
      if (this.has(id)) return { ok: false, why: ["Already held"] };
      if (p.money < L.cost) why.push("Needs " + U.fmtMoney(L.cost));
      if (p.flightHours < L.hours) why.push("Needs " + L.hours + " flight hours");
      if (p.flightsCompleted < L.flights) why.push("Needs " + L.flights + " completed flights");
      if (Game.avgRating() < L.rating && L.rating > 0) why.push("Needs " + L.rating.toFixed(1) + "★ average");
      // must hold previous license
      var rank = SC.Data.licenseRank(id);
      if (rank > 0 && !this.has(SC.Data.LICENSES[rank - 1].id)) why.push("Requires " + SC.Data.LICENSES[rank - 1].name + " first");
      return { ok: why.length === 0, why: why };
    },
    buy: function (id) {
      var c = this.canBuy(id);
      if (!c.ok) return { ok: false, reason: c.why.join(" · ") };
      var L = SC.Data.licenseById(id);
      if (!Economy.spend(L.cost, "license")) return { ok: false, reason: "Not enough money" };
      SC.Save.profile.licenses.push(id);
      SC.Save.markDirty();
      return { ok: true };
    }
  };

  /* ================= CAREER / MISSIONS / ACHIEVEMENTS ================= */
  var Career = SC.Career = {
    missionById: function (id) {
      for (var i = 0; i < SC.Data.MISSIONS.length; i++) if (SC.Data.MISSIONS[i].id === id) return SC.Data.MISSIONS[i];
      return null;
    },
    missionsWithStatus: function () {
      var p = SC.Save.profile;
      return SC.Data.MISSIONS.map(function (m) {
        var done = p && p.missionsDone.indexOf(m.id) >= 0;
        var prevOk = !m.prev || (p && p.missionsDone.indexOf(m.prev) >= 0);
        var acIdx = SC.Data.AIRCRAFT.map(function (a) { return a.id; }).indexOf(m.acMin);
        return { m: m, done: done, locked: !prevOk, minAcIndex: acIdx };
      });
    },
    completeMission: function (id) {
      var p = SC.Save.profile; if (!p) return;
      if (p.missionsDone.indexOf(id) < 0) { p.missionsDone.push(id); SC.Save.markDirty(); }
    },
    award: function (id) {
      var p = SC.Save.profile; if (!p) return;
      if (p.achievements.indexOf(id) < 0) {
        p.achievements.push(id); SC.Save.markDirty();
        var a = null;
        for (var i = 0; i < SC.Data.ACHIEVEMENTS.length; i++) if (SC.Data.ACHIEVEMENTS[i].id === id) a = SC.Data.ACHIEVEMENTS[i];
        if (a && SC.UI) SC.UI.toast("🏆 Achievement: " + a.name);
      }
    }
  };

  /* ================= RATING ================= */
  var Rating = SC.Rating = {
    newSession: function () {
      return {
        takeoff: { done: false, score: 5, rotateOk: true, center: 0 },
        taxi: { maxKt: 0, holdViolation: false, score: 5 },
        nav: { maxDev: 0, offCourseSec: 0, score: 5 },
        atc: { required: 0, complied: 0, score: 5 },
        fuel: { reservePct: 1, score: 5 },
        landing: { done: false, score: 5, vsFpm: 0, centerM: 0, gearDown: false, onRunway: false },
        safety: { overspeed: false, stall: false, crash: false, violations: [], score: 5 },
        goArounds: 0
      };
    },
    _s: function (v) { return U.clamp(v, 0, 5); },

    finalize: function (s, ctx) {
      ctx = ctx || {};
      var tol = (ctx.tolerance == null ? 1 : ctx.tolerance);
      // takeoff
      var tk = 5;
      if (s.takeoff.done) { tk -= Math.min(2, s.takeoff.center / 8); if (!s.takeoff.rotateOk) tk -= 1.5; }
      s.takeoff.score = this._s(tk);
      // taxi
      var tx = 5;
      if (s.taxi.maxKt > 30 * tol) tx -= Math.min(2.5, (s.taxi.maxKt - 30 * tol) / 8);
      if (s.taxi.holdViolation) tx -= 2;
      s.taxi.score = this._s(tx);
      // navigation
      var nv = 5 - Math.min(3, s.nav.offCourseSec / 25) - Math.min(1.5, s.nav.maxDev / 40);
      s.nav.score = this._s(nv);
      // atc
      s.atc.score = s.atc.required === 0 ? 5 : this._s(s.atc.complied / s.atc.required * 5);
      // fuel
      var fl = 5;
      if (s.fuel.reservePct < 0.15) fl -= (0.15 - s.fuel.reservePct) * 20;
      if (s.fuel.reservePct <= 0.001) fl = 1;
      s.fuel.score = this._s(fl);
      // landing
      var ld = 5;
      if (s.landing.done) {
        var vs = Math.abs(s.landing.vsFpm);
        if (vs <= 150) ld = 5; else if (vs <= 300) ld = 4.4; else if (vs <= 450) ld = 3.8;
        else if (vs <= 650) ld = 3.0; else if (vs <= 900) ld = 2.0; else ld = 1.0;
        ld -= Math.min(1.5, s.landing.centerM / 12);
        if (!s.landing.gearDown) ld = Math.min(ld, 1.5);
        if (!s.landing.onRunway) ld = Math.min(ld, 2.0);
      } else ld = 2.5;
      s.landing.score = this._s(ld);
      // safety
      var sf = 5 - s.safety.violations.length * 1.2;
      if (s.safety.overspeed) sf -= 0.8;
      if (s.safety.stall) sf -= 0.8;
      if (safetyCrash(s)) sf = 1.0;
      s.safety.score = this._s(sf);
      function safetyCrash(sx) { return sx.safety.crash; }

      var W = SC.Config.ratingWeights;
      var total = (s.takeoff.score * W.takeoff + s.taxi.score * W.taxi + s.nav.score * W.navigation +
        s.atc.score * W.atc + s.fuel.score * W.fuel + s.landing.score * W.landing + s.safety.score * W.safety) /
        (W.takeoff + W.taxi + W.navigation + W.atc + W.fuel + W.landing + W.safety);
      if (s.safety.crash) total = Math.max(1, total - SC.Config.crashRatingPenalty);
      total = Math.round(total * 10) / 10;

      var tips = [];
      if (s.landing.done && Math.abs(s.landing.vsFpm) > 450) tips.push("Flare earlier: aim for touchdown under −400 fpm. Reduce descent in the last 50 ft.");
      if (s.landing.centerM > 10) tips.push("Track the centerline: small bank corrections on final keep you aligned.");
      if (!s.landing.gearDown && s.landing.done) tips.push("Always confirm GEAR DOWN before landing — a gear-up landing is dangerous.");
      if (s.taxi.maxKt > 32) tips.push("Taxi slower: keep ground speed under 30 kt, under 10 kt near gates.");
      if (s.taxi.holdViolation) tips.push("Hold short when instructed: never enter the runway without takeoff clearance.");
      if (s.atc.required > s.atc.complied) tips.push("Answer ATC: use the 📻 phrases at each phase — compliance boosts pay and rating.");
      if (s.nav.offCourseSec > 30) tips.push("Hold your assigned heading: frequent small corrections beat big late ones.");
      if (s.fuel.reservePct < 0.15) tips.push("Carry more fuel: plan a 15%+ reserve so winds and go-arounds don't strand you.");
      if (s.safety.overspeed) tips.push("Watch the red line: reduce throttle in descents to avoid overspeed.");
      if (s.safety.stall) tips.push("Keep flying speed: if the stall warning sounds, lower the nose and add power.");
      if (s.goArounds > 0) tips.push("Good call on the go-around — safe pilots go around rather than force a bad landing.");
      if (tips.length === 0) tips.push("Textbook flying, Captain. Try a longer route or a bigger aircraft next.");
      return {
        total: total,
        breakdown: [
          { k: "Takeoff", v: s.takeoff.score }, { k: "Taxi", v: s.taxi.score },
          { k: "Navigation", v: s.nav.score }, { k: "ATC", v: s.atc.score },
          { k: "Fuel", v: s.fuel.score }, { k: "Landing", v: s.landing.score },
          { k: "Safety", v: s.safety.score }
        ],
        tips: tips.slice(0, 4)
      };
    }
  };

  /* ================= WEATHER =================
     Per-airport METAR-like state. Affects flight model + visuals. */
  var Weather = SC.Weather = {
    _cache: {},
    init: function () { this._cache = {}; },
    get: function (code) {
      if (!this._cache[code]) this.randomize(code);
      return this._cache[code];
    },
    randomize: function (code) {
      var r = Math.random();
      var cond = r < 0.45 ? "clear" : r < 0.68 ? "clouds" : r < 0.80 ? "rain" : r < 0.88 ? "fog" : "storm";
      this._cache[code] = {
        cond: cond, windDir: U.randInt(0, 359), windKt: cond === "storm" ? U.randInt(15, 32) : U.randInt(2, 16),
        visKm: cond === "fog" ? U.rand(1, 4) : cond === "storm" ? U.rand(3, 7) : cond === "rain" ? U.rand(5, 12) : U.rand(15, 40),
        turb: cond === "storm" ? U.rand(0.7, 1) : cond === "rain" ? U.rand(0.3, 0.6) : U.rand(0, 0.25)
      };
      return this._cache[code];
    },
    icon: function (cond) {
      return { clear: "☀️", clouds: "⛅", rain: "🌧️", storm: "⛈️", fog: "🌫️" }[cond] || "☀️";
    },
    brief: function (code) {
      var w = this.get(code), a = SC.Data.airportByCode(code);
      return this.icon(w.cond) + " " + a.code + " " + w.cond.toUpperCase() +
        " · Wind " + w.windDir + "°/" + w.windKt + "kt · Vis " + w.visKm.toFixed(0) + "km";
    }
  };

  /* ================= TIME (day/night + acceleration) ================= */
  var Time = SC.Time = {
    simMin: 12 * 60,   // minutes since UTC midnight
    accelIdx: 0,
    init: function () {
      var n = new Date();
      this.simMin = n.getUTCHours() * 60 + n.getUTCMinutes();
      this.accelIdx = 0;
    },
    accel: function () { return SC.Config.timeAccelOptions[this.accelIdx]; },
    cycleAccel: function () {
      this.accelIdx = (this.accelIdx + 1) % SC.Config.timeAccelOptions.length;
      return this.accel();
    },
    resetAccel: function () { this.accelIdx = 0; },
    // advance clock by sim seconds; returns nothing
    advance: function (simSec) { this.simMin = (this.simMin + simSec / 60) % 1440; },
    clockStr: function () {
      var h = Math.floor(this.simMin / 60), m = Math.floor(this.simMin % 60);
      return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + " UTC";
    },
    // daylight factor 0..1 at a longitude (approx solar curve)
    daylight: function (lon) {
      var utcH = this.simMin / 60;
      var solarNoon = 12 - lon / 15;
      var ha = (utcH - solarNoon) * 15; // hour angle deg
      var c = Math.cos(U.deg2rad(ha));
      return U.clamp((c + 0.18) / 1.0, 0, 1);
    },
    sunAlt: function (lon) { // -90..90 approx
      var utcH = this.simMin / 60, ha = (utcH - (12 - lon / 15)) * 15;
      return 65 * Math.cos(U.deg2rad(ha)) - 8;
    }
  };
})();
