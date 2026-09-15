/* ============================================================
   SC.UI — screen router + all menu/hangar/map/results screens.
   Flight HUD lives in ui-flight.js, MP/ATC rooms in ui-atc.js.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  var UI = SC.UI = {
    current: "main",
    mapCtx: { kind: "free", mission: null },  // free | mission | mp
    hangarSel: null,
    _bannerT: null,

    /* ---------- boot ---------- */
    init: function () {
      var self = this;
      // audio unlock on first gesture (mobile)
      function unlock() { SC.Audio.ensure(); SC.Audio.applySettings(); }
      window.addEventListener("pointerdown", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      // menu routing
      document.querySelectorAll("[data-go]").forEach(function (b) {
        b.addEventListener("click", function () { SC.Audio.click(); self.go(b.getAttribute("data-go")); });
      });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden && SC.Flight.cur && !SC.Flight.cur.over) SC.Flight.cur.paused = true;
        if (SC.UI) SC.UI.syncPause();
      });
      this._initPilot(); this._initHangar(); this._initMap(); this._initSettings();
      this._initResults(); this._initProfile();
      // pilot chip -> profile
      U.$("menu-pilot-chip").addEventListener("click", function () { self.go("profile"); });
    },

    go: function (where) {
      if (!SC.Save.hasProfile() && where !== "pilot") { this.show("pilot"); return; }
      if (where === "freeflight") { this.mapCtx = { kind: "free", mission: null }; this.show("map"); }
      else if (where === "career") this.show("career");
      else if (where === "map") { this.mapCtx = { kind: "free", mission: null }; this.show("map"); }
      else if (where === "multiplayer") this.show("multiplayer");
      else if (where === "atc") this.show("atc");
      else if (where === "tutorial") this.show("tutorial");
      else if (where === "hangar") this.show("hangar");
      else if (where === "profile") this.show("profile");
      else if (where === "settings") this.show("settings");
      else if (where === "main") this.show("main");
      else if (where === "pilot") this.show("pilot");
    },

    show: function (name) {
      document.querySelectorAll(".screen").forEach(function (s) { s.classList.add("hidden"); });
      var scr = U.$("screen-" + name);
      if (scr) { scr.classList.remove("hidden"); scr.scrollTop = 0; }
      this.current = name;
      SC.Game.state = (name === "flight") ? "flight" : (name === "atc" ? "atc" : "menu");
      if (name === "main") this._refreshMain();
      if (name === "hangar") this._refreshHangar();
      if (name === "map") this._refreshMap();
      if (name === "profile") this._refreshProfile();
      if (name === "career") this._refreshCareer();
      if (name === "tutorial") this._refreshTutorial();
      if (name === "multiplayer" && SC.UIATC) SC.UIATC.refresh();
      if (name === "atc" && SC.UIATC) SC.UIATC.refreshRoom();
      if (name === "pilot") this._refreshPilot();
      this.refreshMoney();
    },

    /* ---------- helpers ---------- */
    toast: function (msg, ms) {
      var t = U.el("div", "toast", U.escape(msg));
      U.$("toast-container").appendChild(t);
      setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, (ms || 2600) - 400);
      setTimeout(function () { t.remove(); }, ms || 2600);
    },
    modal: function (title, bodyHTML, buttons) {
      U.$("modal-title").textContent = title;
      U.$("modal-body").innerHTML = bodyHTML;
      var bb = U.$("modal-btns"); bb.innerHTML = "";
      (buttons || [{ label: "OK", primary: true }]).forEach(function (b) {
        var btn = U.el("button", "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""), U.escape(b.label));
        btn.addEventListener("click", function () {
          U.$("modal-container").classList.add("hidden");
          if (b.fn) b.fn();
        });
        bb.appendChild(btn);
      });
      U.$("modal-container").classList.remove("hidden");
    },
    refreshMoney: function () {
      var m = SC.Economy.fmt();
      ["menu-money", "hangar-money", "map-money", "career-money"].forEach(function (id) {
        var e = U.$(id); if (e) e.textContent = m;
      });
      var p = SC.Save.profile, nm = U.$("menu-pilot-name"), av = U.$("menu-avatar");
      if (p && p.pilotName) { if (nm) nm.textContent = p.pilotName + " · " + p.callsign; if (av) av.textContent = p.avatar; }
    },
    flightBanner: function (txt, kind, dur) {
      var b = U.$("flight-banner"); if (!b) return;
      b.textContent = txt;
      b.className = kind || "";
      b.classList.remove("hidden");
      if (this._bannerT) clearTimeout(this._bannerT);
      var self = this;
      this._bannerT = setTimeout(function () { b.classList.add("hidden"); }, (dur || 2.5) * 1000);
    },
    onChatMsg: function (m) {
      // mirror ATC chatter into MP/ATC room logs when relevant
      if (SC.UIATC) SC.UIATC.echo(m);
    },

    /* ---------- main ---------- */
    _refreshMain: function () {
      this.refreshMoney();
      var p = SC.Save.profile;
      U.$("menu-save-state").textContent = p ? ("💾 " + p.flightsCompleted + " flights · " + Math.round(p.flightHours * 10) / 10 + "h") : "";
    },

    /* ---------- pilot ---------- */
    _pilotAvatar: "🧑‍✈️",
    _initPilot: function () {
      var self = this, g = U.$("avatar-grid");
      SC.Data.AVATARS.forEach(function (a) {
        var d = U.el("div", "avatar", a);
        if (a === self._pilotAvatar) d.classList.add("sel");
        d.addEventListener("click", function () {
          self._pilotAvatar = a;
          g.querySelectorAll(".avatar").forEach(function (x) { x.classList.remove("sel"); });
          d.classList.add("sel"); SC.Audio.click();
        });
        g.appendChild(d);
      });
      U.$("pilot-start-money").textContent = U.fmtMoney(SC.Config.startingMoney);
      U.$("btn-create-pilot").addEventListener("click", function () {
        var name = U.$("pilot-name-input").value.trim() || "Captain";
        if (SC.Save.hasProfile()) {
          self.modal("Start over?", "This erases your current career and starts fresh with " + U.fmtMoney(SC.Config.startingMoney) + ".",
            [{ label: "CANCEL" }, {
              label: "NEW CAREER", danger: true, fn: function () {
                SC.Save.newProfile(name, self._pilotAvatar);
                self.show("main"); self.toast("Welcome aboard, " + name + "!");
              }
            }]);
        } else {
          SC.Save.newProfile(name, self._pilotAvatar);
          self.show("main"); self.toast("Welcome aboard, " + name + "! 🎓 Try TRAINING first.");
        }
      });
      U.$("btn-continue-profile").addEventListener("click", function () { self.show("main"); });
      U.$("btn-delete-profile").addEventListener("click", function () {
        self.modal("Erase career?", "All progress will be deleted.", [{ label: "CANCEL" }, {
          label: "ERASE", danger: true, fn: function () { SC.Save.eraseProfile(); self._refreshPilot(); }
        }]);
      });
    },
    _refreshPilot: function () {
      var p = SC.Save.profile, info = U.$("existing-profile-info");
      if (p && p.pilotName) {
        info.innerHTML = "<strong>" + U.escape(p.pilotName) + "</strong> · " + U.escape(p.callsign) +
          "<br>" + SC.Economy.fmt(p.money) + " · " + p.flightsCompleted + " flights · " + p.aircraftOwned.length + " aircraft";
        U.$("btn-continue-profile").disabled = false;
      } else { info.textContent = "No saved profile found."; U.$("btn-continue-profile").disabled = true; }
    },

    /* ---------- hangar ---------- */
    _initHangar: function () {
      var self = this;
      U.$("btn-buy-aircraft").addEventListener("click", function () { self._buyAircraft(); });
      U.$("btn-select-aircraft").addEventListener("click", function () {
        if (SC.Fleet.select(self.hangarSel)) { self.toast("Selected " + SC.Data.aircraftById(self.hangarSel).name); self._refreshHangar(); }
      });
      U.$("refuel-slider").addEventListener("input", function () { self._updateRefuel(); });
      U.$("btn-refuel").addEventListener("click", function () { self._doRefuel(false); });
      U.$("btn-refuel-full").addEventListener("click", function () { self._doRefuel(true); });
    },
    _refreshHangar: function () {
      var self = this, p = SC.Save.profile;
      if (!this.hangarSel) this.hangarSel = SC.Fleet.activeId();
      var list = U.$("hangar-list"); list.innerHTML = "";
      SC.Data.AIRCRAFT.forEach(function (a) {
        var owned = p.aircraftOwned.indexOf(a.id) >= 0;
        var allowed = SC.Game.aircraftAllowed(a.id);
        var d = U.el("div", "hangar-card" + (a.id === self.hangarSel ? " sel" : ""));
        d.innerHTML = "<div class='ac-icon'>" + a.icon + "</div><div><h4>" + U.escape(a.name) + "</h4><div class='muted'>" +
          U.escape(a.category) + "<br>" + (owned ? (allowed ? "✅ Ready" : "🔒 License: " + SC.Data.licenseById(a.license).name) : U.fmtMoney(a.price)) + "</div></div>";
        d.addEventListener("click", function () { self.hangarSel = a.id; SC.Audio.click(); self._refreshHangar(); });
        list.appendChild(d);
      });
      var ac = SC.Data.aircraftById(this.hangarSel), st = SC.Fleet.effectiveStats(this.hangarSel);
      var owned = p.aircraftOwned.indexOf(ac.id) >= 0;
      U.$("hangar-ac-icon").textContent = ac.icon;
      U.$("hangar-ac-name").textContent = ac.name;
      U.$("hangar-ac-class").textContent = ac.maker + " · " + ac.category + " — " + ac.desc;
      U.$("hangar-ac-owned").textContent = owned ? (SC.Fleet.activeId() === ac.id ? "● ACTIVE" : "OWNED") : U.fmtMoney(ac.price);
      var sg = U.$("hangar-ac-stats");
      sg.innerHTML = "";
      [["License", SC.Data.licenseById(ac.license).short], ["Cruise", Math.round(st.cruiseKmh) + " km/h"],
        ["Range", U.fmtDist(st.rangeKm)], ["Seats", st.pax], ["Fuel", st.fuelCap + " u"],
        ["Burn", st.flowCruise.toFixed(2) + " u/s"], ["Earning", "×" + st.earnFactor.toFixed(1)],
        ["V<sub>R</sub>", Math.round(U.kmh2kt(ac.vrKmh)) + " kt"]].forEach(function (r) {
        sg.appendChild(U.el("div", "", "<span>" + r[0] + "</span><strong>" + r[1] + "</strong>"));
      });
      var lock = U.$("hangar-ac-lock");
      if (owned && SC.Data.licenseRank(SC.Game.highestLicense()) < SC.Data.licenseRank(ac.license)) {
        lock.classList.remove("hidden");
        lock.textContent = "🔒 Requires " + SC.Data.licenseById(ac.license).name + " — earn it in PROFILE → LICENSES.";
      } else if (!owned && SC.Data.licenseRank(SC.Game.highestLicense()) < SC.Data.licenseRank(ac.license)) {
        lock.classList.remove("hidden");
        lock.textContent = "🔒 Requires " + SC.Data.licenseById(ac.license).name + " to operate.";
      } else lock.classList.add("hidden");
      U.$("btn-buy-aircraft").disabled = owned;
      U.$("btn-buy-aircraft").textContent = owned ? "OWNED" : "BUY " + U.fmtMoney(ac.price);
      U.$("btn-select-aircraft").disabled = !owned || SC.Fleet.activeId() === ac.id;
      // upgrades
      var uw = U.$("hangar-upgrades"); uw.innerHTML = "";
      if (!owned) uw.innerHTML = "<div class='muted'>Purchase this aircraft to unlock upgrades.</div>";
      SC.Data.UPGRADES.forEach(function (ug) {
        var lvl = SC.Fleet.upgradeLevel(ac.id, ug.id);
        var cost = lvl >= 5 ? null : SC.Data.upgradeCost(ac, ug, lvl);
        var row = U.el("div", "upg-row");
        var pips = "";
        for (var i = 0; i < 5; i++) pips += i < lvl ? "●" : "○";
        row.innerHTML = "<span>" + ug.icon + " <strong>" + ug.name + "</strong><br><span class='muted small'>" + ug.desc + "</span></span><span class='pips'>" + pips + "</span>";
        var b = U.el("button", "btn small" + (lvl >= 5 ? "" : " primary"), lvl >= 5 ? "MAX" : U.fmtMoney(cost));
        b.disabled = !owned || lvl >= 5;
        b.addEventListener("click", function () {
          var r = SC.Fleet.buyUpgrade(ac.id, ug.id);
          if (r.ok) { SC.Audio.cash(); self.toast(ug.icon + " " + ug.name + " → level " + r.level); }
          else self.toast("❌ " + (r.reason || "Failed"));
          self._refreshHangar(); self.refreshMoney();
        });
        row.appendChild(b); uw.appendChild(row);
      });
      // fuel panel (home airport pricing = last safe airport)
      this._updateRefuel();
      this.refreshMoney();
    },
    _buyAircraft: function () {
      var r = SC.Fleet.purchase(this.hangarSel);
      if (r.ok) { SC.Audio.cash(); this.toast("✈ " + SC.Data.aircraftById(this.hangarSel).name + " purchased!"); }
      else this.toast("❌ " + r.reason);
      this._refreshHangar(); this.refreshMoney();
    },
    _updateRefuel: function () {
      var ac = this.hangarSel || SC.Fleet.activeId();
      var st = SC.Fleet.effectiveStats(ac);
      var cur = SC.Fleet.fuelOf(ac), room = st.fuelCap - cur;
      var ap = SC.Save.profile.lastSafeAirport || SC.Config.starterAirport;
      var price = SC.Economy.fuelPricePerUnit(ac, ap);
      var pct = Number(U.$("refuel-slider").value) / 100;
      var amt = Math.round(room * pct * 10) / 10;
      var cost = Math.round(amt * price);
      U.$("hangar-fuel-bar").style.width = (st.fuelCap ? cur / st.fuelCap * 100 : 0) + "%";
      U.$("hangar-fuel-text").textContent = Math.round(cur) + " / " + st.fuelCap + " u @ " + ap + " (" + U.fmtMoney(price) + "/u)";
      U.$("refuel-amount").textContent = amt + " units";
      U.$("refuel-price").textContent = U.fmtMoney(cost);
      U.$("refuel-after").textContent = U.fmtMoney(SC.Economy.money() - cost);
      this._refuelAmt = amt; this._refuelAp = ap;
    },
    _doRefuel: function (full) {
      var ac = this.hangarSel || SC.Fleet.activeId();
      var st = SC.Fleet.effectiveStats(ac);
      var amt = full ? (st.fuelCap - SC.Fleet.fuelOf(ac)) : (this._refuelAmt || 0);
      var r = SC.Fleet.addFuel(ac, amt, this._refuelAp);
      if (r.ok) { SC.Audio.cash(); this.toast("⛽ +" + Math.round(r.added) + " fuel for " + U.fmtMoney(r.cost)); }
      else this.toast("❌ " + (r.reason || "Refuel failed"));
      U.$("refuel-slider").value = 0;
      this._refreshHangar(); this.refreshMoney();
    },

    /* ---------- world map / flight setup ---------- */
    _initMap: function () {
      var self = this;
      SC.WorldMap.init("worldmap-canvas");
      SC.WorldMap.onPick = function (code) { self._mapTap(code); };
      ["sel-departure", "sel-destination", "sel-aircraft"].forEach(function (id) {
        U.$(id).addEventListener("change", function () { self._routeChanged(); });
      });
      U.$("btn-fly").addEventListener("click", function () { self._flyPressed(); });
      U.$("btn-map-reset").addEventListener("click", function () { SC.WorldMap.zoom = 1.6; SC.WorldMap.cx = 60; SC.WorldMap.cy = 22; });
      var si = U.$("airport-search");
      si.addEventListener("input", function () {
        var box = U.$("airport-search-results"), q = si.value;
        var res = SC.Airports.search(q);
        if (!res.length) { box.classList.add("hidden"); return; }
        box.classList.remove("hidden"); box.innerHTML = "";
        res.forEach(function (a) {
          var d = U.el("div", "", "<strong>" + a.code + "</strong> " + U.escape(a.city) + " — " + U.escape(a.name) +
            " <span style='float:right'><button class='btn small' data-s='dep'>DEP</button> <button class='btn small' data-s='arr'>ARR</button></span>");
          d.querySelector("[data-s=dep]").addEventListener("click", function (ev) { ev.stopPropagation(); self._setDep(a.code); box.classList.add("hidden"); si.value = ""; });
          d.querySelector("[data-s=arr]").addEventListener("click", function (ev) { ev.stopPropagation(); self._setArr(a.code); box.classList.add("hidden"); si.value = ""; });
          box.appendChild(d);
        });
      });
    },
    _fillAirportSelect: function (sel, val) {
      sel.innerHTML = "";
      SC.Data.AIRPORTS.forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.code; o.textContent = a.code + " — " + a.city + ", " + a.country;
        sel.appendChild(o);
      });
      sel.value = val;
    },
    _refreshMap: function () {
      var p = SC.Save.profile, ctx = this.mapCtx;
      var dep = p.lastSafeAirport || SC.Config.starterAirport, arr = dep === "BOM" ? "GOI" : "BOM";
      var title = "WORLD MAP — FREE FLIGHT";
      if (ctx.kind === "mission" && ctx.mission) {
        dep = ctx.mission.from; arr = ctx.mission.to;
        title = "MISSION: " + ctx.mission.name.toUpperCase();
      } else if (ctx.kind === "mp") {
        dep = (SC.MP.me && SC.MP.me.airport) || dep;
        title = "MULTIPLAYER AIRSPACE — " + dep;
      }
      U.$("map-title").textContent = title;
      this._fillAirportSelect(U.$("sel-departure"), dep);
      this._fillAirportSelect(U.$("sel-destination"), arr);
      if (ctx.kind === "mission") { U.$("sel-departure").disabled = true; U.$("sel-destination").disabled = true; }
      else { U.$("sel-departure").disabled = ctx.kind === "mp"; U.$("sel-destination").disabled = false; }
      // aircraft options: owned only
      var sa = U.$("sel-aircraft"); sa.innerHTML = "";
      var minIdx = ctx.kind === "mission" ? SC.Data.AIRCRAFT.map(function (a) { return a.id; }).indexOf(ctx.mission.acMin) : 0;
      SC.Fleet.ownedSpecs().forEach(function (a) {
        var idx = SC.Data.AIRCRAFT.map(function (x) { return x.id; }).indexOf(a.id);
        var okLic = SC.Data.licenseRank(SC.Game.highestLicense()) >= SC.Data.licenseRank(a.license);
        var okM = idx >= minIdx;
        var o = document.createElement("option");
        o.value = a.id;
        o.textContent = a.name + (okLic ? "" : " 🔒license") + (okM ? "" : " 🔒too small") + " (" + Math.round(SC.Fleet.fuelOf(a.id)) + "⛽)";
        o.disabled = !okLic || !okM;
        sa.appendChild(o);
      });
      sa.value = SC.Fleet.activeId();
      if (sa.selectedIndex < 0) sa.selectedIndex = 0;
      SC.WorldMap.resize();
      this._routeChanged();
    },
    _mapTap: function (code) {
      var d = U.$("sel-departure"), a = U.$("sel-destination");
      if (this.mapCtx.kind === "mission") { this.toast("Mission route is fixed: " + d.value + " → " + a.value); return; }
      if (!d.value || (d.value && a.value && d.value !== a.value && this._lastTap === "arr")) { this._setDep(code); this._lastTap = "dep"; }
      else if (d.value !== code) { this._setArr(code); this._lastTap = "arr"; }
      else { this._setArr(code); this._lastTap = "arr"; }
    },
    _setDep: function (c) { U.$("sel-departure").value = c; this._routeChanged(); this.toast("Departure: " + c); },
    _setArr: function (c) { U.$("sel-destination").value = c; this._routeChanged(); this.toast("Destination: " + c); },
    _routeChanged: function () {
      var d = U.$("sel-departure").value, a = U.$("sel-destination").value, ac = U.$("sel-aircraft").value;
      SC.WorldMap.dep = d; SC.WorldMap.arr = a;
      // center between
      var A = SC.Data.airportByCode(d), B = SC.Data.airportByCode(a);
      SC.WorldMap.cx = (A.lon + B.lon) / 2; SC.WorldMap.cy = (A.lat + B.lat) / 2;
      var ctx = this.mapCtx;
      var mult = ctx.kind === "mission" ? ctx.mission.mult : 1;
      var est = SC.Economy.estimateFlight(d, a, ac, mult, SC.Game.difficulty());
      var st = SC.Fleet.effectiveStats(ac);
      var cur = SC.Fleet.fuelOf(ac);
      var ri = U.$("route-info"); ri.innerHTML = "";
      [["Distance", U.fmtDist(est.distanceKm)], ["Flight time", "~" + U.fmtTimeHMS(est.totalSec) + " (⏩ to ×8)"],
        ["Earnings", U.fmtMoney(est.earnAt3) + " – " + U.fmtMoney(est.earnAt5)], ["Fuel needed", Math.round(est.fuelNeeded) + " u"],
        ["Fuel onboard", Math.round(cur) + " / " + st.fuelCap + " u"], ["Mission bonus", "×" + mult]].forEach(function (r) {
        ri.appendChild(U.el("div", "", "<span>" + r[0] + "</span><strong>" + r[1] + "</strong>"));
      });
      var w = U.$("route-warn");
      if (est.fuelNeeded > st.fuelCap) {
        w.classList.remove("hidden");
        w.textContent = "⚠️ This route needs " + Math.round(est.fuelNeeded) + " fuel but " + st.name + " holds " + st.fuelCap + ". Choose a larger aircraft or upgrade tanks.";
        U.$("btn-fly").disabled = true;
      } else if (cur < est.fuelNeeded) {
        w.classList.remove("hidden");
        var need = Math.ceil(est.fuelNeeded - cur);
        var cost = Math.round(need * SC.Economy.fuelPricePerUnit(ac, d));
        w.innerHTML = "⛽ Short " + need + " fuel for this route. <button class='btn small primary' id='btn-quick-fuel'>REFUEL " + U.fmtMoney(cost) + "</button>";
        U.$("btn-fly").disabled = false;
        U.$("btn-quick-fuel").addEventListener("click", function () {
          var r = SC.Fleet.addFuel(ac, need, d);
          if (r.ok) { SC.Audio.cash(); UI.toast("⛽ Refueled for " + U.fmtMoney(r.cost)); }
          else UI.toast("❌ " + r.reason);
          UI._routeChanged(); UI.refreshMoney();
        });
      } else { w.classList.add("hidden"); U.$("btn-fly").disabled = false; }
      U.$("weather-brief").innerHTML = U.escape(SC.Weather.brief(d)) + "<br>" + U.escape(SC.Weather.brief(a)) +
        "<br><span class='small'>Winds aloft and visibility affect handling, fuel and rating.</span>";
      this._est = est;
    },
    _flyPressed: function () {
      var d = U.$("sel-departure").value, a = U.$("sel-destination").value, ac = U.$("sel-aircraft").value;
      if (!SC.Game.aircraftAllowed(ac)) { this.toast("🔒 Aircraft not licensed/owned"); return; }
      SC.Fleet.select(ac);
      var ctx = this.mapCtx;
      var p = SC.Save.profile;
      p.lastSafeAirport = d; SC.Save.markDirty();
      SC.Audio.ensure();
      if (ctx.kind === "mission") {
        SC.Flight.start({ mode: "mission", from: d, to: a, acId: ac, missionId: ctx.mission.id, missionMult: ctx.mission.mult, callsign: p.callsign });
      } else if (ctx.kind === "mp") {
        SC.Flight.start({ mode: "mp", from: d, to: a, acId: ac, callsign: (SC.MP.me && SC.MP.me.callsign) || p.callsign });
      } else {
        SC.Flight.start({ mode: "free", from: d, to: a, acId: ac, callsign: p.callsign });
      }
    },

    /* ---------- career / tutorial ---------- */
    _refreshCareer: function () {
      var self = this, w = U.$("mission-list"); w.innerHTML = "";
      SC.Career.missionsWithStatus().forEach(function (o) {
        var m = o.m;
        var minAc = SC.Data.aircraftById(m.acMin);
        var d = U.el("div", "mission-card" + (o.done ? " done" : "") + (o.locked ? " locked" : ""));
        d.innerHTML = "<h4>" + (o.done ? "✅ " : "") + m.id + " · " + U.escape(m.name) + "</h4>" +
          "<div class='mroute'>" + m.from + " → " + m.to + " &nbsp;·&nbsp; bonus ×" + m.mult + "</div>" +
          "<div class='mdesc'>" + U.escape(m.desc) + "</div>" +
          "<div class='mreq'>" + (o.locked ? "🔒 Complete " + m.prev + " first" : "Requires: " + U.escape(minAc.name) + " or larger") + "</div>";
        if (!o.locked) {
          var b = U.el("button", "btn primary", o.done ? "FLY AGAIN" : "FLY MISSION");
          b.style.marginTop = "10px"; b.style.width = "100%";
          b.addEventListener("click", function () {
            self.mapCtx = { kind: "mission", mission: m };
            self.show("map");
          });
          d.appendChild(b);
        }
        w.appendChild(d);
      });
    },
    _refreshTutorial: function () {
      var self = this, w = U.$("lesson-list"); w.innerHTML = "";
      var p = SC.Save.profile;
      SC.Data.LESSONS.forEach(function (L, i) {
        var done = p.lessonsDone.indexOf(L.id) >= 0;
        var prevOk = i === 0 || p.lessonsDone.indexOf(SC.Data.LESSONS[i - 1].id) >= 0;
        var d = U.el("div", "mission-card" + (done ? " done" : "") + (!prevOk ? " locked" : ""));
        d.innerHTML = "<h4>" + (done ? "✅ " : "🎓 ") + L.id + " · " + U.escape(L.name) + "</h4>" +
          "<div class='mdesc'>" + U.escape(L.desc) + " (" + L.steps.length + " steps)</div>";
        var b = U.el("button", "btn primary", done ? "REPLAY" : "START LESSON");
        b.style.marginTop = "10px"; b.style.width = "100%"; b.disabled = !prevOk;
        b.addEventListener("click", function () { SC.Audio.ensure(); SC.Tutorial.start(L.id); });
        d.appendChild(b); w.appendChild(d);
      });
    },

    /* ---------- profile ---------- */
    _initProfile: function () {},
    _refreshProfile: function () {
      var p = SC.Save.profile;
      U.$("profile-avatar").textContent = p.avatar;
      U.$("profile-name").textContent = p.pilotName + " · " + p.callsign;
      U.$("profile-level").textContent = SC.Game.levelTitle();
      var s = U.$("profile-stats"); s.innerHTML = "";
      var avg = SC.Game.avgRating();
      [["Balance", SC.Economy.fmt()], ["Flight hours", (Math.round(p.flightHours * 10) / 10) + " h"],
        ["Flights", p.flightsCompleted + " ✓ / " + p.flightsFailed + " ✗"], ["Distance", U.fmtDist(p.distanceFlownKm)],
        ["Avg rating", avg ? avg.toFixed(1) + " ★" : "—"], ["Aircraft", p.aircraftOwned.length + " owned"],
        ["Airports", p.airportsVisited.length + " visited"], ["Missions", p.missionsDone.length + " / " + SC.Data.MISSIONS.length],
        ["Best landing", p.bestLandingFpm != null ? p.bestLandingFpm + " fpm" : "—"],
        ["Home base", p.lastSafeAirport || "—"]].forEach(function (r) {
        s.appendChild(U.el("div", "", "<span>" + r[0] + "</span><strong>" + r[1] + "</strong>"));
      });
      var lw = U.$("profile-licenses"); lw.innerHTML = "";
      var self = this;
      SC.Data.LICENSES.forEach(function (L) {
        var held = SC.Licenses.has(L.id);
        var row = U.el("div", "upg-row");
        row.innerHTML = "<span><strong>" + U.escape(L.name) + "</strong> (" + L.short + ")<br><span class='muted small'>" +
          U.escape(L.desc) + (held ? "" : "<br>Needs: " + U.fmtMoney(L.cost) + " · " + L.hours + "h · " + L.flights + " flt · " + L.rating.toFixed(1) + "★") + "</span></span>";
        var b = U.el("button", "btn small" + (held ? "" : " primary"), held ? "HELD ✓" : U.fmtMoney(L.cost));
        b.disabled = held;
        if (!held) b.addEventListener("click", function () {
          var r = SC.Licenses.buy(L.id);
          if (r.ok) { SC.Audio.cash(); self.toast("🎖 " + L.name + " earned!"); }
          else self.toast("❌ " + r.reason);
          self._refreshProfile(); self.refreshMoney();
        });
        row.appendChild(b); lw.appendChild(row);
      });
      var aw = U.$("profile-achievements"); aw.innerHTML = "";
      SC.Data.ACHIEVEMENTS.forEach(function (a) {
        var got = p.achievements.indexOf(a.id) >= 0;
        aw.appendChild(U.el("span", "pill" + (got ? " got" : ""), (got ? "🏆 " : "🔒 ") + U.escape(a.name)));
      });
    },

    /* ---------- settings ---------- */
    _initSettings: function () {
      var S = SC.Save.settings, self = this;
      function bind(id, key, parse) {
        var e = U.$(id);
        if (e.type === "checkbox") e.checked = !!S[key];
        else e.value = S[key];
        e.addEventListener("change", function () {
          S[key] = e.type === "checkbox" ? e.checked : (parse ? parse(e.value) : e.value);
          SC.Save.saveNow(); SC.Audio.applySettings();
        });
      }
      bind("set-control", "control"); bind("set-invert", "invertPitch"); bind("set-rudder-keys", "rudderKeys");
      bind("set-difficulty", "difficulty"); bind("set-quality", "quality"); bind("set-camera", "cockpitCam");
      bind("set-sound", "sound"); bind("set-volume", "volume", Number); bind("set-atc-voice", "atcVoice"); bind("set-units", "units");
      U.$("btn-tilt-enable").addEventListener("click", function () { SC.Input.enableTilt(); });
      U.$("btn-save-now").addEventListener("click", function () { SC.Save.saveNow(); self.toast("💾 Saved"); });
      U.$("btn-reset-save").addEventListener("click", function () {
        self.modal("Erase everything?", "Profile + settings will be deleted.", [{ label: "CANCEL" }, {
          label: "ERASE ALL", danger: true, fn: function () { SC.Save.eraseAll(); location.reload(); }
        }]);
      });
    },

    /* ---------- results / crash ---------- */
    _fbStars: 5,
    _initResults: function () {
      var self = this;
      var fbs = U.$("fb-stars");
      fbs.addEventListener("click", function (e) {
        // star index from click x
        var r = fbs.getBoundingClientRect();
        var n = Math.ceil((e.clientX - r.left) / r.width * 5);
        self._fbStars = U.clamp(n, 1, 5);
        fbs.textContent = U.stars(self._fbStars);
      });
      U.$("btn-fb-submit").addEventListener("click", function () {
        SC.Feedback.submit(self._fbStars, U.$("fb-text").value, self._lastMeta || {});
        self.toast("🙏 Feedback saved — thank you, Captain!");
        U.$("fb-text").value = "";
      });
      U.$("btn-fb-skip").addEventListener("click", function () { self.toast("Skipped"); });
    },
    _initProfile_dup: null,

    showResults: function (fl, res, pay, crashed) {
      SC.Audio.idle();
      U.$("results-title").textContent = crashed ? "FLIGHT FAILED" : (fl.mode === "mission" ? "MISSION COMPLETE" : "FLIGHT COMPLETE");
      U.$("results-route").textContent = fl.dep.code + " → " + fl.arr.code + " · " + fl.callsign;
      U.$("results-stars").textContent = U.stars(res.total);
      U.$("results-score").textContent = res.total.toFixed(1) + " / 5 · " + fl.st.name;
      var d = U.$("results-data"); d.innerHTML = "";
      [["Flight time", U.fmtTimeHMS(fl.flightSec)], ["Distance", U.fmtDist(Math.max(fl.distFlownKm, fl.routeKm > 1 ? fl.routeKm : 60))],
        ["Fuel used", Math.round((fl.fuelStart != null ? fl.fuelStart : SC.Fleet.effectiveStats(fl.acId).fuelCap) - fl.fuel) + " u"],
        ["Fuel left", Math.round(fl.fuel) + " u"], ["Go-arounds", fl.rating.goArounds],
        ["Violations", fl.rating.safety.violations.length]].forEach(function (r) {
        d.appendChild(U.el("div", "", "<span>" + r[0] + "</span><strong>" + r[1] + "</strong>"));
      });
      var pw = U.$("results-pay"); pw.innerHTML = "";
      [["Base + distance", U.fmtMoney(pay.base)], ["Rating ×" + pay.ratingMult, U.fmtMoney(pay.rated)],
        ["Landing bonus", "+" + U.fmtMoney(pay.landingBonus)], ["Go-around bonus", "+" + U.fmtMoney(pay.goAroundBonus)],
      ].forEach(function (r) { pw.appendChild(U.el("div", "pay-row", "<span>" + r[0] + "</span><strong>" + r[1] + "</strong>")); });
      pw.appendChild(U.el("div", "pay-row total", "<span>TOTAL EARNED</span><strong class='money'>" + U.fmtMoney(pay.total) + "</strong>"));
      var bw = U.$("results-break"); bw.innerHTML = "";
      res.breakdown.forEach(function (b) {
        bw.appendChild(U.el("div", "brk-row", "<span>" + b.k + "</span><span class='stars'>" + U.stars(b.v) + "</span>"));
      });
      var tw = U.$("results-tips"); tw.innerHTML = "";
      res.tips.forEach(function (t) { tw.appendChild(U.el("div", "", U.escape(t))); });
      this._lastMeta = { from: fl.dep.code, to: fl.arr.code, ac: fl.acId, rating: res.total, mode: fl.mode };
      this.show("results");
      if (!crashed && pay.total > 0) SC.Audio.cash();
    },

    showCrash: function (fl, reason, cost, res) {
      SC.Audio.idle();
      var self = this;
      this.modal("💥 CRASHED — " + reason,
        "<div class='info-row'><span>Repair bill</span><strong class='money'>-" + U.fmtMoney(cost) + "</strong></div>" +
        "<div class='info-row'><span>Rating</span><strong>" + U.stars(res.total) + " " + res.total.toFixed(1) + "</strong></div>" +
        "<div class='info-row'><span>Respawn</span><strong>" + fl.dep.code + " " + U.escape(fl.dep.city) + " (last safe airport)</strong></div>" +
        "<p class='muted small'>Your career is intact. Fuel −25%. Study the tips on the results screen and fly again.</p>",
        [{ label: "RESULTS & TIPS", primary: true, fn: function () { self.showResults(fl, res, { base: 0, ratingMult: 0, rated: 0, landingBonus: 0, goAroundBonus: 0, total: 0 }, true); } },
         { label: "MAIN MENU", fn: function () { self.show("main"); } }]);
    },

    enterFlight: function (fl) {
      this.show("flight");
      if (SC.UIFlight) SC.UIFlight.enterFlight(fl);
      if (SC.Render) SC.Render.resize();
    },
    exitToMenu: function () {
      SC.Flight.cur = null;
      SC.Audio.idle();
      this.show("main");
    },
    syncAP: function () { if (SC.UIFlight) SC.UIFlight.syncAP(); },
    syncPause: function () { if (SC.UIFlight) SC.UIFlight.syncPause(); }
  };
})();
