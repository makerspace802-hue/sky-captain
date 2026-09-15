/* ============================================================
   SC.UIFlight — in-flight HUD: PFD tapes, attitude, engine,
   nav, touch stick, throttle, ATC panel, checklist, warnings.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  var PHASES = {
    PARKED: "AT GATE", TAXI_OUT: "TAXI", HOLD_SHORT: "HOLD SHORT", LINEUP: "LINE UP",
    TAKEOFF: "TAKEOFF", CLIMB: "CLIMB", CRUISE: "CRUISE", DESCENT: "DESCENT",
    APPROACH: "APPROACH", FINAL: "FINAL", ROLLOUT: "ROLLOUT", TAXI_IN: "TAXI TO GATE",
    DONE: "ARRIVED", CRASHED: "CRASHED"
  };

  var F = SC.UIFlight = {
    fuelChecked: false,
    _lastPhase: "", _lastWarn: "", _lastSpd: -1, _lastAlt: -1, _lastClock: "",
    _stickDrag: false,

    init: function () {
      var self = this;
      this._buildTapes(); this._buildPhrases();
      U.$("controls-help-body").innerHTML = SC.Input.helpHTML();
      // top buttons
      U.$("btn-accel").addEventListener("click", function () { SC.Flight.cycleAccel(); self._syncAccel(); });
      U.$("btn-ap").addEventListener("click", function () { SC.Flight.toggleAP(); });
      U.$("btn-cam").addEventListener("click", function () { self._toggleCam(); });
      U.$("btn-pause").addEventListener("click", function () { SC.Flight.togglePause(); });
      U.$("btn-endflight").addEventListener("click", function () { self._confirmEnd(); });
      // engine
      U.$("btn-gear").addEventListener("click", function () { SC.Flight.cycleGear(); });
      U.$("btn-flaps").addEventListener("click", function () { SC.Flight.flapsUp(); });
      U.$("btn-flaps-dn").addEventListener("click", function () { SC.Flight.flapsDn(); });
      var bb = U.$("btn-brake");
      bb.addEventListener("pointerdown", function (e) { e.preventDefault(); var fl = SC.Flight.cur; if (fl) fl.uiBrake = true; bb.classList.add("on"); });
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
        bb.addEventListener(ev, function () { var fl = SC.Flight.cur; if (fl) fl.uiBrake = false; bb.classList.remove("on"); });
      });
      U.$("hud-throttle").addEventListener("input", function (e) {
        var fl = SC.Flight.cur; if (fl && !fl.over) fl.model.thr = Number(e.target.value) / 100;
      });
      // fuel tap (training check + info)
      document.querySelector(".fuel-hud").addEventListener("click", function () {
        var fl = SC.Flight.cur; if (!fl) return;
        self.fuelChecked = true;
        SC.UI.toast("⛽ " + Math.round(fl.fuel) + "/" + fl.st.fuelCap + " u · burn " + fl.st.flowCruise.toFixed(2) + " u/s cruise");
      });
      // stick
      this._initStick();
      // mouse yoke
      var cv = U.$("flight-canvas");
      cv.addEventListener("pointermove", function (e) {
        var S = SC.Save.settings;
        if (!S || S.control !== "mouse") { SC.Input.mouseYoke.active = false; return; }
        var r = cv.getBoundingClientRect();
        SC.Input.mouseYoke.roll = U.clamp((e.clientX - r.left - r.width / 2) / (r.width / 2) * 1.4, -1, 1);
        SC.Input.mouseYoke.pitch = U.clamp(-(e.clientY - r.top - r.height / 2) / (r.height / 2) * 1.4, -1, 1);
        SC.Input.mouseYoke.active = true;
      });
      cv.addEventListener("pointerleave", function () { SC.Input.mouseYoke.active = false; });
      // ATC tabs
      document.querySelectorAll(".atc-tab").forEach(function (t) {
        t.addEventListener("click", function () {
          document.querySelectorAll(".atc-tab").forEach(function (x) { x.classList.remove("active"); });
          t.classList.add("active");
          ["radio", "chat", "check"].forEach(function (k) { U.$("atc-tab-" + k).classList.add("hidden"); });
          U.$("atc-tab-" + t.getAttribute("data-tab")).classList.remove("hidden");
          if (t.getAttribute("data-tab") === "chat") U.$("chat-unread").classList.add("hidden");
          SC.Audio.click();
        });
      });
      U.$("btn-atc-collapse").addEventListener("click", function () {
        var b = document.querySelector("#atc-panel .atc-body");
        b.classList.toggle("collapsed");
        U.$("btn-atc-collapse").textContent = b.classList.contains("collapsed") ? "▴" : "▾";
      });
      // chat
      function send() {
        var fl = SC.Flight.cur, inp = U.$("chat-input");
        if (!fl || fl.over) return;
        var t = inp.value.trim();
        if (t) { fl.atc.handleText(t); inp.value = ""; }
      }
      U.$("btn-chat-send").addEventListener("click", send);
      U.$("chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
      // voice (hold to talk)
      var vb = U.$("btn-voice");
      if (!SC.Comms.voiceSupported()) U.$("voice-status").textContent = "Voice N/A — use phrases/text";
      vb.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        var fl = SC.Flight.cur; if (!fl || fl.over) return;
        if (!SC.Comms.voiceSupported()) { SC.UI.toast("🎤 Voice recognition not supported in this browser"); return; }
        SC.Comms.startListening(function (text) {
          SC.UI.toast("🎤 “" + text + "”");
          fl.atc.handleText(text);
        });
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { vb.addEventListener(ev, function () { SC.Comms.stopListening(); }); });
      // pause menu
      U.$("btn-resume").addEventListener("click", function () { SC.Flight.togglePause(); });
      U.$("btn-pause-help").addEventListener("click", function () { U.$("controls-help").classList.remove("hidden"); });
      U.$("btn-pause-fuel").addEventListener("click", function () { self._fuelTruck(); });
      U.$("btn-help-close").addEventListener("click", function () { U.$("controls-help").classList.add("hidden"); });
      U.$("btn-pause-end").addEventListener("click", function () { self._confirmEnd(); });
      // input actions
      SC.Input.onAction("gear", function () { SC.Flight.cycleGear(); });
      SC.Input.onAction("flapsUp", function () { SC.Flight.flapsUp(); });
      SC.Input.onAction("flapsDn", function () { SC.Flight.flapsDn(); });
      SC.Input.onAction("flapsDnHold", function () {});
      SC.Input.onAction("autopilot", function () { SC.Flight.toggleAP(); });
      SC.Input.onAction("camera", function () { self._toggleCam(); });
      SC.Input.onAction("accel", function () { SC.Flight.cycleAccel(); self._syncAccel(); });
      SC.Input.onAction("pause", function () { SC.Flight.togglePause(); });
      SC.Input.onAction("brakeTap", function () {});
      SC.Input.onAction("thrUp", function () { var fl = SC.Flight.cur; if (fl) fl.model.thr = U.clamp(fl.model.thr + 0.08, 0, 1); });
      SC.Input.onAction("thrDn", function () { var fl = SC.Flight.cur; if (fl) fl.model.thr = U.clamp(fl.model.thr - 0.08, 0, 1); });
      SC.Input.onAction("atcPanel", function () {
        var b = document.querySelector("#atc-panel .atc-body");
        b.classList.toggle("collapsed");
      });
    },

    _buildTapes: function () {
      var sp = U.$("tape-spd"), al = U.$("tape-alt");
      for (var s = 0; s <= 650; s += 10) {
        var d = U.el("div", "", s % 20 === 0 ? String(s) : "·");
        d.dataset.v = s; sp.appendChild(d);
      }
      for (var a = 0; a <= 42000; a += 100) {
        var e = U.el("div", "", a % 500 === 0 ? String(a) : "·");
        e.dataset.v = a; al.appendChild(e);
      }
    },
    _buildPhrases: function () {
      var g = U.$("phrase-grid"); g.innerHTML = "";
      SC.Data.PHRASES.forEach(function (p) {
        var b = U.el("button", "", U.escape(p.label));
        b.addEventListener("click", function () {
          var fl = SC.Flight.cur;
          if (fl && !fl.over) fl.atc.handlePhrase(p.id);
        });
        g.appendChild(b);
      });
    },

    _initStick: function () {
      var base = U.$("stick-base"), nub = U.$("stick-nub"), self = this;
      function set(e) {
        var r = base.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        var max = r.width / 2 - 10, len = Math.hypot(dx, dy);
        if (len > max) { dx *= max / len; dy *= max / len; }
        nub.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))";
        SC.Input.stick.roll = U.clamp(dx / max, -1, 1);
        SC.Input.stick.pitch = U.clamp(-dy / max, -1, 1);
        SC.Input.stick.active = true;
      }
      function end() {
        self._stickDrag = false;
        nub.style.transform = "translate(-50%,-50%)";
        SC.Input.stick.pitch = 0; SC.Input.stick.roll = 0; SC.Input.stick.active = false;
      }
      base.addEventListener("pointerdown", function (e) { self._stickDrag = true; base.setPointerCapture(e.pointerId); set(e); });
      base.addEventListener("pointermove", function (e) { if (self._stickDrag) set(e); });
      ["pointerup", "pointercancel"].forEach(function (ev) { base.addEventListener(ev, end); });
    },

    enterFlight: function (fl) {
      U.$("chat-log").innerHTML = "";
      U.$("hud-route").textContent = fl.dep.code + " → " + fl.arr.code + " · " + fl.callsign;
      U.$("hud-throttle").value = 0;
      U.$("pause-menu").classList.add("hidden");
      U.$("controls-help").classList.add("hidden");
      U.$("tutorial-banner").classList.add("hidden");
      U.$("chat-unread").classList.add("hidden");
      document.querySelector("#atc-panel .atc-body").classList.remove("collapsed");
      this._lastPhase = ""; this._lastWarn = "";
      this.fuelChecked = false;
      // stick visibility
      var touch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
      var S = SC.Save.settings;
      U.$("stick-zone").style.display = (touch || (S && S.control === "stick")) ? "block" : "none";
      U.$("tutorial-banner").classList.toggle("hidden", !fl.lessonId);
      this._syncAccel(); this.syncAP(); this.syncPause();
      SC.UI.flightBanner(fl.dep.city + " (" + fl.dep.code + ") — GATE " + (fl.gate + 1) + " · " + fl.st.name, "", 3.5);
    },

    _toggleCam: function () {
      var fl = SC.Flight.cur; if (!fl) return;
      fl.camChase = !fl.camChase;
      SC.Save.settings.cockpitCam = !fl.camChase;
      SC.Save.saveNow();
      SC.UI.toast(fl.camChase ? "🎥 Chase camera" : "🎥 Cockpit camera");
    },
    _fuelTruck: function () {
      var fl = SC.Flight.cur; if (!fl || fl.over) return;
      if (!fl.model.onGround || fl.model.gSpeedKt > 3) { SC.UI.toast("\u26fd Fuel truck needs you stopped on the ground"); return; }
      var code = fl.sceneMode === "LOCAL_ARR" ? fl.arr.code : fl.dep.code;
      var st = fl.st, cur = Math.round(fl.fuel), room = Math.round(st.fuelCap - fl.fuel);
      if (room < 1) { SC.UI.toast("\u26fd Tank is already full"); return; }
      var ppu = SC.Economy.fuelPricePerUnit(fl.acId, code);
      function q(u) { u = Math.min(room, Math.round(u)); return { u: u, c: Math.round(u * ppu) }; }
      var a = q(st.fuelCap * 0.25), b = q(st.fuelCap * 0.5), c = q(room);
      SC.UI.modal("\u26fd Fuel truck @ " + code,
        "<div class='info-row'><span>Onboard</span><strong>" + cur + " / " + st.fuelCap + " u</strong></div>" +
        "<div class='info-row'><span>Price</span><strong>" + U.fmtMoney(ppu) + " / unit</strong></div>" +
        "<div class='info-row'><span>Balance</span><strong class='money'>" + SC.Economy.fmt() + "</strong></div>",
        [{ label: "+" + a.u + "u " + U.fmtMoney(a.c), fn: function () { SC.Flight.buyFuel(a.u); } },
         { label: "+" + b.u + "u " + U.fmtMoney(b.c), fn: function () { SC.Flight.buyFuel(b.u); } },
         { label: "FILL " + U.fmtMoney(c.c), primary: true, fn: function () { SC.Flight.buyFuel(c.u); } },
         { label: "CANCEL" }]);
    },
    _confirmEnd: function () {
      var fl = SC.Flight.cur; if (!fl || fl.over) return;
      SC.UI.modal("End flight?", "Incomplete flights earn no pay. Fuel state is kept.",
        [{ label: "KEEP FLYING", primary: true }, { label: "END FLIGHT", danger: true, fn: function () { SC.Flight.endFlightEarly(); } }]);
    },
    _syncAccel: function () {
      var a = SC.Flight.cur && SC.Flight.cur.multiplayer ? 1 : SC.Time.accel();
      U.$("hud-accel").textContent = a + "×";
      var l = U.$("hud-accel-label"); if (l) l.textContent = a + "×";
      U.$("btn-accel").classList.toggle("on", a > 1);
    },
    syncAP: function () {
      var fl = SC.Flight.cur;
      U.$("btn-ap").classList.toggle("on", !!(fl && fl.ap));
    },
    syncPause: function () {
      var fl = SC.Flight.cur;
      U.$("pause-menu").classList.toggle("hidden", !(fl && fl.paused));
      U.$("btn-pause").textContent = fl && fl.paused ? "▶" : "⏸";
    },

    tutorialBanner: function (L, idx) {
      var b = U.$("tutorial-banner");
      if (!L || idx >= L.steps.length) { b.classList.add("hidden"); return; }
      b.classList.remove("hidden");
      var st = L.steps[idx];
      U.$("tutorial-step-text").innerHTML = "<strong>" + U.escape(st.text) + "</strong><br><span class='muted small'>💡 " + U.escape(st.hint) + "</span>";
      U.$("tutorial-progress").textContent = L.id + " · Step " + (idx + 1) + "/" + L.steps.length + " · " + L.name;
    },

    /* ---------- per-frame HUD ---------- */
    update: function (fl, dt) {
      var m = fl.model;
      // top
      if (this._lastPhase !== fl.phase) {
        this._lastPhase = fl.phase;
        U.$("hud-phase").textContent = PHASES[fl.phase] || fl.phase;
      }
      var clk = SC.Time.clockStr();
      if (clk !== this._lastClock) { this._lastClock = clk; U.$("hud-clock").textContent = clk; }
      this._syncAccel();
      // PFD numbers
      U.$("v-ias").textContent = Math.round(fl.model.onGround ? m.gSpeedKt : m.iasKt);
      U.$("v-alt").textContent = Math.round(m.altFt);
      U.$("v-hdg").textContent = String(Math.round(m.hdg)).padStart(3, "0");
      U.$("v-vs").textContent = (m.vsFpm >= 0 ? "+" : "") + Math.round(m.vsFpm);
      U.$("v-thr").textContent = Math.round(m.thr * 100);
      U.$("v-flp").textContent = ["0", "1", "2", "F"][m.flaps];
      U.$("v-gear").textContent = m.gearPos > 0.8 ? "DN" : m.gearPos < 0.2 ? "UP" : "..";
      U.$("v-gear").style.color = m.gearDown ? "#3ddc84" : "#ffb020";
      // tapes
      this._tape(U.$("tape-spd"), m.onGround ? m.gSpeedKt : m.iasKt, 10, "_lastSpd");
      this._tape(U.$("tape-alt"), m.altFt, 100, "_lastAlt");
      this._attitude(m);
      // fuel
      var pct = fl.fuel / fl.st.fuelCap;
      var bar = U.$("hud-fuel-bar");
      bar.style.width = (U.clamp(pct, 0, 1) * 100) + "%";
      bar.style.background = pct > 0.5 ? "" : pct > 0.2 ? "linear-gradient(90deg,#8a6a10,#ffb020)" : "linear-gradient(90deg,#7e1b1b,#ff5a5a)";
      U.$("hud-fuel-text").textContent = "⛽ " + Math.round(fl.fuel) + "/" + fl.st.fuelCap + " (" + Math.round(pct * 100) + "%)";
      // nav
      var remKm, prog;
      if (fl.sceneMode === "ENROUTE") { remKm = (1 - fl.f) * fl.routeKm; prog = fl.f; }
      else if (fl.sceneMode === "LOCAL_ARR") {
        var dT = Math.hypot(m.x - fl.activeF.thr.x, m.z - fl.activeF.thr.z) / 1000;
        remKm = dT; prog = U.clamp(1 - dT / 15, 0.9, 1);
      } else { remKm = fl.routeKm || 8; prog = m.onGround ? 0 : 0.05; }
      U.$("v-dist").textContent = U.fmtDist(remKm);
      U.$("v-ete").textContent = m.gSpeedKt > 25 ? U.fmtTimeHMS(remKm / (m.gSpeedKt * 1.852) * 3600) : "—";
      U.$("v-prog").textContent = Math.round(U.clamp(prog, 0, 1) * 100) + "%";
      SC.MiniMap.draw(U.$("minimap-canvas"), fl);
      // engine buttons
      U.$("btn-gear").className = "ebtn" + (m.gearDown ? " on" : "");
      U.$("btn-flaps").className = "ebtn" + (m.flaps > 0 ? " on" : "");
      var sl = U.$("hud-throttle");
      if (document.activeElement !== sl) sl.value = Math.round(m.thr * 100);
      // warnings
      this._warnings(fl, m);
      // checklist
      this._checklist(fl, m);
    },

    _tape: function (strip, val, step, lastKey) {
      var win = strip.parentElement, center = win.clientHeight / 2;
      var idx = U.clamp(Math.round(val / step), 0, Math.max(0, strip.children.length - 1));
      strip.style.transform = "translateY(" + (center - idx * 22 - 11) + "px)";
      if (this[lastKey] !== idx) {
        if (strip.children[this[lastKey]]) strip.children[this[lastKey]].classList.remove("cur");
        if (strip.children[idx]) strip.children[idx].classList.add("cur");
        this[lastKey] = idx;
      }
    },

    _attitude: function (m) {
      var cv = U.$("att-canvas"); if (!cv) return;
      var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
      ctx.fillStyle = "#2f7fe0"; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(-U.deg2rad(m.roll));
      var py = U.deg2rad(m.pitch) * 120;
      ctx.fillStyle = "#7a5230"; ctx.fillRect(-W, py, W * 2, H * 2);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-W, py); ctx.lineTo(W, py); ctx.stroke();
      // pitch ladder
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
      for (var p = -20; p <= 20; p += 10) {
        if (p === 0) continue;
        var yy = py - U.deg2rad(p) * 120;
        ctx.beginPath(); ctx.moveTo(-22, yy); ctx.lineTo(22, yy); ctx.stroke();
      }
      ctx.restore();
      // fixed wings
      ctx.strokeStyle = "#ffd34c"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18, H / 2); ctx.lineTo(58, H / 2); ctx.lineTo(58, H / 2 + 8);
      ctx.moveTo(W - 18, H / 2); ctx.lineTo(W - 58, H / 2); ctx.lineTo(W - 58, H / 2 + 8); ctx.stroke();
      ctx.fillStyle = "#ffd34c"; ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, 6.29); ctx.fill();
      // bank arc
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 52, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    },

    _warnings: function (fl, m) {
      var w = [];
      if (fl.stalled) w.push(["STALL", "red"]);
      if (m.iasKt > U.kmh2kt(fl.st.maxKmh) * 1.06 && !m.onGround) w.push(["OVERSPEED", "red"]);
      var pct = fl.fuel / fl.st.fuelCap;
      if (pct <= 0) w.push(["FUEL EMPTY", "red"]);
      else if (pct < SC.Config.fuelEmergencyPct) w.push(["FUEL EMERGENCY", "red"]);
      else if (pct < SC.Config.fuelWarningPct) w.push(["LOW FUEL", "amber"]);
      if ((fl.phase === "FINAL" || fl.phase === "APPROACH") && !m.onGround && m.altFt < 900 && (!m.gearDown || m.gearPos < 0.8)) w.push(["GEAR UP", "red"]);
      if (!m.onGround && m.altFt < 600 && m.vsFpm < -1800 && fl.sceneMode !== "ENROUTE") w.push(["⚠ PULL UP", "red"]);
      if (fl.phase === "TAKEOFF" && !fl.atc.takeoffClear && m.gSpeedKt > 60) w.push(["NO TAKEOFF CLEARANCE", "amber"]);
      var key = w.map(function (x) { return x[0]; }).join("|");
      if (key === this._lastWarn) return;
      this._lastWarn = key;
      var box = U.$("hud-warnings"); box.innerHTML = "";
      w.forEach(function (x) {
        box.appendChild(U.el("div", x[1] === "red" ? "warn-flash" : "warn-amber", U.escape(x[0])));
      });
    },

    _checklist: function (fl, m) {
      var items = [
        ["Fuel sufficient", fl.fuel > fl.st.fuelCap * 0.1],
        ["Takeoff clearance", fl.atc.takeoffClear],
        ["Clean up (gear/flaps)", fl.phase === "CLIMB" || fl.phase === "CRUISE" ? (m.gearPos < 0.2 && m.flaps === 0) : null],
        ["Landing clearance", fl.atc.landClear],
        ["Landing config (gear+flaps)", (fl.phase === "APPROACH" || fl.phase === "FINAL") ? (m.gearDown && m.flaps >= 2) : null],
        ["On centerline", fl.phase === "FINAL" && !m.onGround ? Math.abs(fl.activeF.alongLat(m.x, m.z).lat) < 40 : null]
      ];
      var box = U.$("checklist");
      var html = items.map(function (it) {
        if (it[1] === null) return "<div class='chk'>○ " + it[0] + " <span class='muted'>—</span></div>";
        return "<div class='chk" + (it[1] ? " done" : "") + "'>" + (it[1] ? "✓ " : "○ ") + it[0] + "</div>";
      }).join("");
      if (box._h !== html) { box._h = html; box.innerHTML = html; }
    }
  };
})();
