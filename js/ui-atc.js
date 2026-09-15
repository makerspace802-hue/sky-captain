/* ============================================================
   SC.UIATC — multiplayer lobby UI + playable ATC room (SC.ATCRoom).
   The ATC room drives scripted AI traffic that obeys your commands;
   the same command protocol rides SC.MP when connected.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  function ts() {
    var d = new Date();
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }
  function addLog(boxId, who, text, cls) {
    var box = U.$(boxId); if (!box) return;
    var d = U.el("div", "chat-msg " + (cls || ""));
    d.innerHTML = "<span class='ts'>" + ts() + "</span><span class='who'>" + U.escape(who) + ":</span> " + U.escape(text);
    box.appendChild(d);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    U.scrollBottom(box);
  }

  /* ================= PLAYABLE ATC ROOM ================= */
  var ATCRoom = SC.ATCRoom = {
    airport: null, field: null, position: "tower",
    targets: [], selected: null, active: false,
    handled: 0, ga: 0, _seq: 1, _spawnT: 0, _stripT: 0,

    start: function (code, position) {
      this.stop();
      this.airport = SC.Data.airportByCode(code);
      this.position = position;
      var w = SC.Weather.get(code);
      this.field = SC.Airfield.build(this.airport, SC.Airfield.pickRwyHdg(this.airport, w.windDir));
      this.targets = []; this.selected = null; this.active = true;
      this.handled = 0; this.ga = 0; this._seq = 1;
      for (var i = 0; i < 4; i++) this._spawn(i % 2 === 0 ? "arr" : "dep", true);
      addLog("atc-chat-log", "SYS", position.toUpperCase() + " position open at " + code + ". " + this.targets.length + " aircraft on frequency.", "sys");
      SC.Audio.chime();
    },
    stop: function () { this.active = false; this.targets = []; this.selected = null; },

    _cs: function () {
      var pre = U.pick(["SKC", "AIC", "VIR", "UAE", "BAW", "JAL", "QFA"]);
      return pre + (100 + (this._seq++) * 7 + U.randInt(0, 40));
    },
    _spawn: function (type, stagger) {
      var A = this.field, id = U.uid("t");
      if (type === "arr") {
        var back = stagger ? 9000 + this.targets.length * 3500 : 19000;
        this.targets.push({
          id: id, cs: this._cs(), type: "arr",
          x: A.thr.x - A.dir.x * back, z: A.thr.z - A.dir.z * back,
          alt: Math.min(5200, back * 0.28), spd: 190, hdg: A.hdg,
          landClear: false, cmd: "INBOUND", wp: 0,
          wps: this._arrWps(A)
        });
      } else {
        var g = U.pick(A.gates);
        this.targets.push({
          id: id, cs: this._cs(), type: "dep",
          x: g.x, z: g.z, alt: 0, spd: 0, hdg: A.hdg,
          taxiClear: false, takeoffClear: false, holding: true, cmd: "AT GATE", wp: 0,
          wps: [{ x: A.hold.x, z: A.hold.z, alt: 0, spd: 18, n: "HOLD" },
                { x: A.lineup.x, z: A.lineup.z, alt: 0, spd: 12, n: "LINE UP" },
                { x: A.thr.x + A.dir.x * (A.len / 2 + 1500), z: A.thr.z + A.dir.z * (A.len / 2 + 1500), alt: 1200, spd: 220, n: "CLIMB" },
                { x: A.thr.x + A.dir.x * 16000, z: A.thr.z + A.dir.z * 16000, alt: 6000, spd: 300, n: "DEPART" }]
        });
      }
    },
    _arrWps: function (A) {
      return [
        { x: A.thr.x - A.dir.x * 5500, z: A.thr.z - A.dir.z * 5500, alt: 1600, spd: 170, n: "FAF" },
        { x: A.thr.x + A.dir.x * 300, z: A.thr.z + A.dir.z * 300, alt: 0, spd: 135, n: "THR" },
        { x: A.thr.x + A.dir.x * 1800, z: A.thr.z + A.dir.z * 1800, alt: 0, spd: 30, n: "EXIT" }
      ];
    },
    _missedWps: function (A) {
      return [
        { x: A.thr.x + A.dir.x * 4000, z: A.thr.z + A.dir.z * 4000, alt: 3000, spd: 200, n: "G/A CLIMB" },
        { x: A.thr.x - A.dir.x * 2000 + A.perp.x * 4000, z: A.thr.z - A.dir.z * 2000 + A.perp.z * 4000, alt: 3000, spd: 200, n: "DOWNWIND" },
        { x: A.thr.x - A.dir.x * 9000 + A.perp.x * 4000, z: A.thr.z - A.dir.z * 9000 + A.perp.z * 4000, alt: 2600, spd: 190, n: "BASE" }
      ].concat(this._arrWps(A));
    },

    update: function (dt) {
      if (!this.active) return;
      var self = this, A = this.field;
      this._spawnT += dt;
      if (this._spawnT > 14 && this.targets.length < 7) { this._spawnT = 0; this._spawn(Math.random() < 0.5 ? "arr" : "dep", false); }
      var done = [];
      this.targets.forEach(function (t) {
        var wp = t.wps[t.wp];
        // departure gating
        if (t.type === "dep") {
          if (t.wp === 0 && !t.taxiClear) { t.spd = 0; t.cmd = t.holding ? "HOLDING" : "AT GATE"; return; }
          if (t.wp === 1 && !t.takeoffClear) {
            // roll to lineup then wait
            self._flyTo(t, wp, dt, true);
            if (Math.hypot(t.x - wp.x, t.z - wp.z) < 60) { t.spd = 0; t.cmd = "LINED UP — AWAIT T/O"; }
            return;
          }
        }
        // arrival gate: must be cleared by FAF
        if (t.type === "arr" && t.wp >= 1 && !t.landClear && t.alt < 2000) {
          t.wps = self._missedWps(A); t.wp = 0; t.cmd = "GOING AROUND";
          self.ga++;
          addLog("atc-chat-log", t.cs, "Going around — no landing clearance.", "me");
          addLog("atc-chat-log", "YOU", t.cs + ", roger go-around. Fly published missed approach.", "atc");
        }
        if (!wp) { done.push(t); return; }
        self._flyTo(t, wp, dt, false);
        var d = Math.hypot(t.x - wp.x, t.z - wp.z);
        var close = wp.alt === 0 && t.alt === 0 ? 120 : 500;
        if (d < close && Math.abs(t.alt - wp.alt) < 400) {
          t.wp++;
          if (t.wp >= t.wps.length) {
            done.push(t); self.handled++;
            addLog("atc-chat-log", "SYS", t.cs + (t.type === "arr" ? " landed. Welcome in. " : " airborne, contact departure. ") + "(" + self.handled + " handled)", "sys");
          } else if (t.type === "arr" && t.wp === 1 && !t.landClear) {
            t.cmd = "FINAL — NEEDS CLEARANCE";
          }
        }
      });
      done.forEach(function (t) {
        self.targets = self.targets.filter(function (x) { return x.id !== t.id; });
        if (self.selected === t.id) self.selected = null;
      });
      this._stripT += dt;
      if (this._stripT > 0.6) { this._stripT = 0; SC.UIATC.renderStrips(); }
    },
    _flyTo: function (t, wp, dt, ground) {
      var dx = wp.x - t.x, dz = wp.z - t.z, d = Math.hypot(dx, dz) || 1;
      var want = U.wrap360(Math.atan2(dx, -dz) * 180 / Math.PI);
      var dh = U.angDiff(t.hdg, want);
      t.hdg = U.wrap360(t.hdg + U.clamp(dh, -25 * dt, 25 * dt));
      var spdTgt = wp.spd;
      if (t.type === "dep" && t.wp >= 2 && t.takeoffClear) spdTgt = wp.spd; // roll/climb
      t.spd += U.clamp(spdTgt - t.spd, -40 * dt, 25 * dt);
      var v = t.spd * 0.514444;
      t.x += Math.sin(U.deg2rad(t.hdg)) * v * dt;
      t.z += -Math.cos(U.deg2rad(t.hdg)) * v * dt;
      t.alt += U.clamp(wp.alt - t.alt, -1600 * dt, 1400 * dt);
      if (t.alt < 0) t.alt = 0;
      if (!ground) t.cmd = (t.type === "arr" ? (t.landClear ? "CLEARED LAND " : "") : "") + (wp.n || "");
    },

    command: function (cmdId) {
      var t = null, self = this;
      this.targets.forEach(function (x) { if (x.id === self.selected) t = x; });
      if (!t) { SC.UI.toast("Select a target first"); return; }
      var you = "YOU (" + this.position.toUpperCase() + ")";
      function say(atcTxt, readback) {
        addLog("atc-chat-log", you, t.cs + ", " + atcTxt, "atc");
        SC.Audio.atcTone();
        setTimeout(function () { addLog("atc-chat-log", t.cs, readback + ", " + t.cs + ".", "me"); }, 900 + Math.random() * 800);
        SC.Comms.speak(t.cs + ", " + atcTxt);
        if (SC.MP.connected) SC.MP.sendAtc({ from: you, to: t.cs, text: atcTxt });
      }
      if (cmdId === "land" && t.type === "arr") { t.landClear = true; t.cmd = "CLEARED LAND"; say("runway " + SC.Airfield.rwyName(this.field.hdg) + ", cleared to land.", "Cleared to land"); }
      else if (cmdId === "goaround" && t.type === "arr") { t.landClear = false; t.wps = this._missedWps(this.field); t.wp = 0; say("go around, fly published missed approach.", "Going around"); }
      else if (cmdId === "hold" && t.type === "arr") { t.cmd = "HOLDING"; say("hold present position, expect further clearance.", "Holding"); }
      else if (cmdId === "taxi" && t.type === "dep") { t.taxiClear = true; t.holding = false; say("taxi to runway " + SC.Airfield.rwyName(this.field.hdg) + ", hold short.", "Taxi, wilco"); }
      else if (cmdId === "takeoff" && t.type === "dep") { t.taxiClear = true; t.takeoffClear = true; t.holding = false; say("runway " + SC.Airfield.rwyName(this.field.hdg) + ", cleared for takeoff.", "Cleared for takeoff"); }
      else if (cmdId === "holdpos" && t.type === "dep") { t.holding = true; t.takeoffClear = false; say("hold position.", "Holding position"); }
      else SC.UI.toast("Not applicable to " + t.cs);
      SC.UIATC.renderStrips();
    }
  };

  /* ================= UI ================= */
  var MA = SC.UIATC = {
    _wired: false,

    init: function () {
      if (this._wired) return; this._wired = true;
      var self = this;
      // MP screen
      var mpa = U.$("mp-airport");
      SC.Data.AIRPORTS.forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.code; o.textContent = a.code + " — " + a.city;
        mpa.appendChild(o);
      });
      U.$("mp-server").addEventListener("change", function (e) {
        U.$("mp-ws-url").classList.toggle("hidden", e.target.value !== "ws");
      });
      U.$("btn-mp-connect").addEventListener("click", function () { self.connect(); });
      U.$("btn-mp-leave").addEventListener("click", function () { SC.MP.disconnect(); self.refresh(); SC.UI.toast("Left airspace"); });
      U.$("btn-mp-chat").addEventListener("click", function () { self.sendChat(); });
      U.$("mp-chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") self.sendChat(); });
      U.$("btn-mp-fly").addEventListener("click", function () { self.enterAirspace(); });
      SC.MP.onMsg(function (m) { self._onMp(m); });
      // ATC screen
      var ata = U.$("atc-airport");
      SC.Data.AIRPORTS.forEach(function (a) {
        var o = document.createElement("option");
        o.value = a.code; o.textContent = a.code + " — " + a.city + ", " + a.country;
        ata.appendChild(o);
      });
      U.$("btn-atc-start").addEventListener("click", function () { self.toggleShift(); });
      U.$("btn-atc-send").addEventListener("click", function () { self.sendFreq(); });
      U.$("atc-chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") self.sendFreq(); });
      var rc = U.$("radar-canvas");
      rc.addEventListener("click", function (e) { self._radarClick(e); });
    },

    /* ----- multiplayer ----- */
    refresh: function () {
      var p = SC.Save.profile;
      if (p && !U.$("mp-callsign").value) U.$("mp-callsign").value = p.callsign;
      U.$("mp-airport").value = (SC.MP.me && SC.MP.me.airport) || p.lastSafeAirport || "BOM";
      var pill = U.$("mp-conn");
      if (SC.MP.connected) {
        pill.textContent = SC.MP.kind === "ws" ? "● ONLINE" : "● LOCAL SIM";
        pill.style.borderColor = "#3ddc84"; pill.style.color = "#3ddc84";
      } else { pill.textContent = "OFFLINE"; pill.style.borderColor = ""; pill.style.color = ""; }
      this._renderPlayers(); this._renderSlots();
    },
    connect: function () {
      var self = this;
      var cs = (U.$("mp-callsign").value.trim() || "SKC101").toUpperCase().slice(0, 10);
      U.$("mp-callsign").value = cs;
      var opts = {
        callsign: cs, airport: U.$("mp-airport").value, role: U.$("mp-role").value,
        ac: SC.Fleet.activeId(), server: U.$("mp-server").value, url: U.$("mp-ws-url").value.trim()
      };
      if (opts.server === "ws" && !opts.url) { SC.UI.toast("Enter a WebSocket server URL (wss://…), or use Local simulation"); return; }
      SC.UI.toast("Connecting…");
      SC.MP.connect(opts).then(function () {
        self.refresh();
        addLog("mp-chat-log", "SYS", cs + " joined " + opts.airport + " airspace as " + opts.role + ".", "sys");
        SC.UI.toast(SC.MP.kind === "ws" ? "● Connected to server" : "● Local airspace ready (offline-capable)");
      }).catch(function () {
        // honest fallback: real server failed -> local sim
        SC.UI.toast("⚠️ Server unreachable — falling back to local airspace sim");
        opts.server = "local"; U.$("mp-server").value = "local"; U.$("mp-ws-url").classList.add("hidden");
        SC.MP.connect(opts).then(function () { self.refresh(); });
      });
    },
    _onMp: function (m) {
      if (m.t === "chat") addLog("mp-chat-log", m.from, m.text, m.from === (SC.MP.me && SC.MP.me.callsign) ? "me" : "");
      else if (m.t === "atc") addLog("mp-chat-log", m.from + "→" + m.to, m.text, "atc");
      else if (m.t === "join") { addLog("mp-chat-log", "SYS", m.player.callsign + " joined.", "sys"); this._renderPlayers(); }
      else if (m.t === "bye") { this._renderPlayers(); }
      else if (m.t === "pos" || m.t === "welcome") this._renderPlayers();
      else if (m.t === "_closed" && SC.MP.connected === false) this.refresh();
    },
    echo: function (m) {
      // flight ATC chatter mirrored into MP log when flying online
      if (SC.MP.connected && m.cls === "me") addLog("mp-chat-log", m.who, m.text, "me");
    },
    sendChat: function () {
      var inp = U.$("mp-chat-input"), t = inp.value.trim();
      if (!t) return;
      if (!SC.MP.connected) { SC.UI.toast("Join airspace first"); return; }
      SC.MP.sendChat(t);
      if (SC.MP.kind === "ws") addLog("mp-chat-log", SC.MP.me.callsign, t, "me");
      inp.value = "";
    },
    _renderPlayers: function () {
      var box = U.$("mp-players"); box.innerHTML = "";
      var n = 0;
      function row(cs, role, sub, me) {
        n++;
        box.appendChild(U.el("div", "prow", "<span><strong>" + U.escape(cs) + "</strong>" + (me ? " (you)" : "") + "<br><span class='muted small'>" + U.escape(sub || "") + "</span></span><span class='pill'>" + U.escape(role) + "</span>"));
      }
      if (SC.MP.connected && SC.MP.me) row(SC.MP.me.callsign, SC.MP.me.role, "at " + SC.MP.me.airport, true);
      for (var id in SC.MP.players) {
        var pl = SC.MP.players[id];
        row(pl.callsign, pl.role || "pilot", (pl.altFt != null ? Math.round(pl.altFt) + "ft · " + Math.round(pl.spd || 0) + "kt · " : "") + (pl.phase || ""));
      }
      if (!n) box.innerHTML = "<div class='muted'>Airspace empty. Join to see traffic.</div>";
      U.$("mp-count").textContent = n;
    },
    _renderSlots: function () {
      var box = U.$("mp-atc-slots"); box.innerHTML = "";
      var self = this;
      [["ground", "Ground"], ["tower", "Tower"], ["approach", "Approach"]].forEach(function (s) {
        var occ = SC.MP.atcSlots[s[0]];
        var d = U.el("div", "prow", "<span><strong>" + s[1] + "</strong><br><span class='muted small'>" + (occ ? U.escape(occ) : "vacant") + "</span></span>");
        var b = U.el("button", "btn small", occ ? "RELEASE" : "CLAIM");
        b.addEventListener("click", function () {
          if (!SC.MP.connected) { SC.UI.toast("Join airspace first"); return; }
          if (occ) SC.MP.releaseSlot(s[0]);
          else SC.MP.atcSlots[s[0]] = SC.MP.me.callsign;
          self._renderSlots();
        });
        d.appendChild(b); box.appendChild(d);
      });
      [["departure", "Departure"], ["center", "Center"]].forEach(function (s) {
        box.appendChild(U.el("div", "prow", "<span><strong>" + s[1] + "</strong><br><span class='muted small'>unlocks with server update</span></span><span class='pill'>SOON</span>"));
      });
    },
    enterAirspace: function () {
      if (!SC.MP.connected) { SC.UI.toast("Join the airspace first (JOIN AIRSPACE)"); return; }
      var role = SC.MP.me.role;
      if (role === "pilot") { SC.UI.mapCtx = { kind: "mp", mission: null }; SC.UI.show("map"); }
      else {
        U.$("atc-airport").value = SC.MP.me.airport;
        U.$("atc-position").value = role.replace("atc-", "");
        SC.UI.show("atc");
        SC.UI.toast("You are " + role.replace("atc-", "").toUpperCase() + " at " + SC.MP.me.airport + " — START SHIFT");
      }
    },

    /* ----- ATC room ----- */
    refreshRoom: function () {
      var rc = U.$("radar-canvas");
      var r = rc.getBoundingClientRect();
      rc.width = Math.max(300, r.width); rc.height = Math.max(300, r.height || 420);
      U.$("atc-title").textContent = "ATC — " + U.$("atc-position").selectedOptions[0].textContent.toUpperCase();
      U.$("atc-airport-label").textContent = U.$("atc-airport").value;
      if (ATCRoom.active) {
        U.$("btn-atc-start").textContent = "END SHIFT (" + ATCRoom.handled + " handled)";
        this.renderStrips(); this.renderCommands();
      } else {
        U.$("btn-atc-start").textContent = "START SHIFT";
        var ctx = rc.getContext("2d");
        ctx.fillStyle = "#04140c"; ctx.fillRect(0, 0, rc.width, rc.height);
        ctx.fillStyle = "#3ddc84"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("Select position & airport, then START SHIFT", rc.width / 2, rc.height / 2);
      }
    },
    toggleShift: function () {
      if (ATCRoom.active) {
        var pay = ATCRoom.handled * 150;
        if (pay > 0) SC.Economy.add(pay, "atc");
        if (ATCRoom.handled >= 3) SC.Career.award("controller");
        addLog("atc-chat-log", "SYS", "Shift over. " + ATCRoom.handled + " handled, " + ATCRoom.ga + " go-arounds. Pay " + U.fmtMoney(pay) + ".", "sys");
        SC.UI.toast("🎙 Shift complete: +" + U.fmtMoney(pay));
        ATCRoom.stop();
        this.refreshRoom(); SC.UI.refreshMoney();
      } else {
        ATCRoom.start(U.$("atc-airport").value, U.$("atc-position").value);
        this.refreshRoom(); this.renderCommands();
      }
    },
    renderStrips: function () {
      if (!ATCRoom.active) return;
      var box = U.$("atc-strips"); box.innerHTML = "";
      U.$("btn-atc-start").textContent = "END SHIFT (" + ATCRoom.handled + " handled)";
      ATCRoom.targets.forEach(function (t) {
        var d = U.el("div", "strip" + (ATCRoom.selected === t.id ? " sel" : ""),
          "<strong>" + U.escape(t.cs) + "</strong> " + (t.type === "arr" ? "⬇ ARR" : "⬆ DEP") +
          " · " + Math.round(t.alt) + "ft · " + Math.round(t.spd) + "kt<br><span class='muted'>" + U.escape(t.cmd || "") + "</span>");
        d.addEventListener("click", function () { ATCRoom.selected = t.id; MA.renderStrips(); MA.renderCommands(); SC.Audio.click(); });
        box.appendChild(d);
      });
      if (!ATCRoom.targets.length) box.innerHTML = "<div class='muted'>No traffic…</div>";
    },
    renderCommands: function () {
      var box = U.$("atc-commands"); box.innerHTML = "";
      var t = null;
      ATCRoom.targets.forEach(function (x) { if (x.id === ATCRoom.selected) t = x; });
      U.$("atc-selected").textContent = t ? t.cs : "—";
      if (!t) { box.innerHTML = "<div class='muted'>Select a target on radar or strips.</div>"; return; }
      var cmds = t.type === "arr"
        ? [["land", "🛬 CLEARED TO LAND"], ["goaround", "↗ GO AROUND"], ["hold", "⏸ HOLD"]]
        : [["taxi", "🚕 TAXI TO RWY"], ["takeoff", "🛫 CLEARED TAKEOFF"], ["holdpos", "⏸ HOLD POSITION"]];
      cmds.forEach(function (c) {
        var b = U.el("button", "btn small primary", c[1]);
        b.addEventListener("click", function () { ATCRoom.command(c[0]); });
        box.appendChild(b);
      });
    },
    sendFreq: function () {
      var inp = U.$("atc-chat-input"), t = inp.value.trim();
      if (!t) return;
      addLog("atc-chat-log", "YOU", t, "atc");
      if (SC.MP.connected) SC.MP.sendAtc({ from: "YOU-ATC", to: "ALL", text: t });
      inp.value = "";
    },
    _radarClick: function (e) {
      if (!ATCRoom.active) return;
      var rc = U.$("radar-canvas"), map = rc._radarMap;
      if (!map) return;
      var r = rc.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var lx = (x - map.cx) / map.R * map.rangeM, lz = (y - map.cy) / map.R * map.rangeM;
      var best = null, bd = 1500;
      ATCRoom.targets.forEach(function (t) {
        var d = Math.hypot(t.x - lx, t.z - lz);
        if (d < bd) { bd = d; best = t; }
      });
      if (best) { ATCRoom.selected = best.id; this.renderStrips(); this.renderCommands(); SC.Audio.click(); }
    },
    tick: function (dt) {
      if (SC.UI.current !== "atc") return;
      if (!ATCRoom.active) return;
      ATCRoom.update(Math.min(dt, 0.1) * 2); // 2× scope speed for lively shifts
      var rc = U.$("radar-canvas");
      if (rc.width < 10) this.refreshRoom();
      SC.Radar.draw(rc, ATCRoom);
    }
  };
  var MA = SC.UIATC;
})();
