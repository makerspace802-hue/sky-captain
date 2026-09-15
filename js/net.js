/* ============================================================
   SC.Net — multiplayer transports + SC.MP session manager.
   ------------------------------------------------------------
   ARCHITECTURE (server-authoritative by design):
     Game code talks ONLY to SC.MP. SC.MP talks to an ITransport.
     ITransport implementations:
       - LocalTransport  : authoritative simulation in-page (offline).
                           Mirrors server validation rules.
       - WebSocketTransport: real backend using the JSON protocol below.
   PROTOCOL (same for both; see README § Multiplayer server spec):
     C->S {t:"hello", callsign, airport, role, ac}
     S->C {t:"welcome", id, players:[...], atc:{...}, serverTime}
     C->S {t:"pos", lat,lon,altFt,hdg,spd,phase}  (5 Hz)
     S->C {t:"pos", id, callsign, ...}            (relayed after validate)
     C->S {t:"chat", text}   S->C {t:"chat", from, text, ts}
     C->S {t:"atc", to, text} S->C {t:"atc", from, to, text, ts}
     C->S {t:"leave"}        S->C {t:"bye", id} / {t:"join", player}
   Server authority: the server validates pos (max speed/rate),
   owns ATC slot assignment and chat relay. LocalTransport applies
   the identical validation so behavior matches a real server.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  /* ---------- shared validation (runs on "server") ---------- */
  function validatePos(prev, next, dt) {
    if (!prev) return true;
    if (typeof next.lat !== "number" || Math.abs(next.lat) > 90) return false;
    if (typeof next.lon !== "number" || Math.abs(next.lon) > 180) return false;
    if (next.altFt < -200 || next.altFt > 50000) return false;
    var distKm = U.haversineKm(prev.lat, prev.lon, next.lat, next.lon);
    var maxKt = 700, maxKm = maxKt * 1.852 * dt / 3600 + 2;
    return distKm <= maxKm; // reject teleports / speed hacks
  }

  /* ---------- LocalTransport: in-page authoritative sim ---------- */
  function LocalTransport() {
    this.kind = "local";
    this._cb = null; this._connected = false;
    this._agents = []; this._me = null; this._t = 0;
    this._names = ["SKC", "AIC", "VIR", "UAE", "BAW", "JAL"];
  }
  LocalTransport.prototype.onMessage = function (cb) { this._cb = cb; };
  LocalTransport.prototype._emit = function (m) { if (this._cb) { try { this._cb(m); } catch (e) {} } };
  LocalTransport.prototype.isConnected = function () { return this._connected; };
  LocalTransport.prototype.connect = function (opts) {
    var self = this;
    return new Promise(function (res) {
      self._connected = true;
      self._me = { id: "me", callsign: opts.callsign, airport: opts.airport, role: opts.role, ac: opts.ac };
      // spawn AI pilots sharing this airspace
      self._agents = [];
      var n = 3 + Math.floor(Math.random() * 3);
      var AP = SC.Data.AIRPORTS;
      for (var i = 0; i < n; i++) {
        var a = U.pick(AP), b = U.pick(AP);
        self._agents.push({
          id: "ai-" + i, callsign: U.pick(self._names) + U.randInt(200, 899),
          from: a.code, to: b.code === a.code ? AP[(i + 5) % AP.length].code : b.code,
          f: Math.random(), altFt: U.randInt(3000, 38000), spdKt: U.randInt(250, 470),
          role: "pilot", ai: true, last: null
        });
      }
      setTimeout(function () {
        self._emit({ t: "welcome", id: "me", players: self._agents.map(function (a) {
          var p = self._agentPos(a); return { id: a.id, callsign: a.callsign, role: "pilot", ai: true, lat: p.lat, lon: p.lon, altFt: a.altFt, hdg: 0, spd: a.spdKt, phase: "CRUISE" };
        }), atc: {}, ts: Date.now() });
        res(true);
      }, 400);
    });
  };
  LocalTransport.prototype._agentPos = function (a) {
    var A = SC.Data.airportByCode(a.from), B = SC.Data.airportByCode(a.to);
    return U.greatCircle(A.lat, A.lon, B.lat, B.lon, a.f);
  };
  LocalTransport.prototype.send = function (m) {
    if (!this._connected) return;
    var self = this;
    if (m.t === "pos") {
      // authoritative validate then echo to self (as server relay would)
      if (!validatePos(this._me.last || m, m, 0.25)) return;
      this._me.last = m;
    } else if (m.t === "chat") {
      this._emit({ t: "chat", from: this._me.callsign, text: m.text, ts: Date.now() });
      // an AI pilot occasionally answers
      if (Math.random() < 0.5 && this._agents.length) {
        var a = U.pick(this._agents);
        setTimeout(function () {
          self._emit({ t: "chat", from: a.callsign, text: U.pick([
            "Roger, traffic in sight.", "Copy that, have a good flight!",
            "Wilco. See you at the gate.", "Thanks, same to you."]) , ts: Date.now() });
        }, 1200 + Math.random() * 1500);
      }
    } else if (m.t === "atc") {
      this._emit({ t: "atc", from: m.from || this._me.callsign, to: m.to || "ATC", text: m.text, ts: Date.now() });
    }
  };
  LocalTransport.prototype.tick = function (dt) {
    if (!this._connected) return;
    this._t += dt;
    var self = this;
    this._agents.forEach(function (a) {
      a.f += dt / 3600 * (a.spdKt / 9000);
      if (a.f >= 1) { a.from = a.to; a.to = U.pick(SC.Data.AIRPORTS).code; a.f = 0; }
    });
    if (this._t >= 1 / SC.Config.mp.tickHz) {
      this._t = 0;
      this._agents.forEach(function (a) {
        var p = self._agentPos(a);
        self._emit({ t: "pos", id: a.id, callsign: a.callsign, role: "pilot", ai: true, lat: p.lat, lon: p.lon, altFt: a.altFt, hdg: 0, spd: a.spdKt, phase: "CRUISE" });
      });
    }
  };
  LocalTransport.prototype.disconnect = function () { this._connected = false; };

  /* ---------- WebSocketTransport: real backend ---------- */
  function WebSocketTransport() {
    this.kind = "ws"; this._cb = null; this.ws = null;
  }
  WebSocketTransport.prototype.onMessage = function (cb) { this._cb = cb; };
  WebSocketTransport.prototype.isConnected = function () { return !!(this.ws && this.ws.readyState === 1); };
  WebSocketTransport.prototype.connect = function (opts) {
    var self = this;
    return new Promise(function (res, rej) {
      try {
        var ws = new WebSocket(opts.url);
        self.ws = ws;
        var done = false;
        ws.onopen = function () {
          ws.send(JSON.stringify({ t: "hello", callsign: opts.callsign, airport: opts.airport, role: opts.role, ac: opts.ac }));
        };
        ws.onmessage = function (ev) {
          var m = null;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (!done && (m.t === "welcome" || m.t === "hello")) { done = true; res(true); }
          if (self._cb) { try { self._cb(m); } catch (e) {} }
        };
        ws.onerror = function () { if (!done) { done = true; rej(new Error("connect-failed")); } };
        ws.onclose = function () { if (!done) { done = true; rej(new Error("connect-failed")); } if (self._cb) { try { self._cb({ t: "_closed" }); } catch (e) {} } };
        setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) {} rej(new Error("timeout")); } }, 8000);
      } catch (e) { rej(e); }
    });
  };
  WebSocketTransport.prototype.send = function (m) {
    try { if (this.isConnected()) this.ws.send(JSON.stringify(m)); } catch (e) {}
  };
  WebSocketTransport.prototype.tick = function () {};
  WebSocketTransport.prototype.disconnect = function () { try { if (this.ws) this.ws.close(); } catch (e) {} this.ws = null; };

  SC.Net = { LocalTransport: LocalTransport, WebSocketTransport: WebSocketTransport };

  /* ================= MP SESSION MANAGER ================= */
  var MP = SC.MP = {
    transport: null, connected: false, kind: "local",
    me: null, players: {}, atcSlots: { ground: null, tower: null, approach: null },
    _posT: 0, _msgCb: [],

    onMsg: function (cb) { this._msgCb.push(cb); },
    _route: function (m) {
      if (m.t === "welcome") {
        var self = this;
        (m.players || []).forEach(function (p) { self.players[p.id] = p; });
        if (m.atc) self.atcSlots = m.atc;
      } else if (m.t === "join") this.players[m.player.id] = m.player;
      else if (m.t === "bye") delete this.players[m.id];
      else if (m.t === "pos") {
        if (!this.players[m.id]) this.players[m.id] = { id: m.id, callsign: m.callsign, role: "pilot" };
        var p = this.players[m.id];
        p.lat = m.lat; p.lon = m.lon; p.altFt = m.altFt; p.hdg = m.hdg; p.spd = m.spd; p.phase = m.phase;
      } else if (m.t === "_closed") { this.connected = false; }
      this._msgCb.forEach(function (cb) { try { cb(m); } catch (e) {} });
    },

    connect: function (opts) {
      var self = this;
      this.disconnect();
      this.kind = opts.server === "ws" ? "ws" : "local";
      this.transport = this.kind === "ws" ? new WebSocketTransport() : new LocalTransport();
      this.me = { callsign: opts.callsign, airport: opts.airport, role: opts.role, ac: opts.ac };
      this.transport.onMessage(function (m) { self._route(m); });
      var p = this.transport.connect({ callsign: opts.callsign, airport: opts.airport, role: opts.role, ac: opts.ac, url: opts.url });
      return p.then(function () {
        self.connected = true;
        // claim ATC slot locally (server would arbitrate on real backend)
        if (opts.role && opts.role.indexOf("atc-") === 0) {
          var slot = opts.role.replace("atc-", "");
          self.atcSlots[slot] = opts.callsign;
        }
        return true;
      });
    },
    disconnect: function () {
      try { if (this.transport) { this.transport.send({ t: "leave" }); this.transport.disconnect(); } } catch (e) {}
      this.transport = null; this.connected = false; this.players = {};
      this.atcSlots = { ground: null, tower: null, approach: null };
    },
    tick: function (dt) { if (this.transport && this.transport.tick) this.transport.tick(dt); },

    sendPos: function (o) {
      if (!this.connected || !this.transport) return;
      this._posT += 1 / 60;
      if (this._posT < 1 / SC.Config.mp.tickHz) return;
      this._posT = 0;
      this.transport.send({ t: "pos", lat: o.lat, lon: o.lon, altFt: Math.round(o.altFt), hdg: Math.round(o.hdg), spd: Math.round(o.spd), phase: o.phase });
    },
    sendChat: function (text) {
      if (!this.connected || !this.transport) return false;
      this.transport.send({ t: "chat", text: String(text).slice(0, 140) });
      return true;
    },
    sendAtc: function (o) {
      if (!this.connected || !this.transport) return;
      this.transport.send({ t: "atc", from: o.from, to: o.to, text: String(o.text).slice(0, 140) });
    },
    releaseSlot: function (slot) { if (this.atcSlots[slot] === (this.me && this.me.callsign)) this.atcSlots[slot] = null; }
  };

  /* ================= FEEDBACK SERVICE =================
     Interface + local implementation. Swap endpoint to go live. */
  SC.Feedback = {
    endpoint: "", // e.g. "https://api.example.com/feedback" — empty = local-only
    submit: function (stars, text, meta) {
      var entry = { t: Date.now(), stars: stars, text: String(text || "").slice(0, 500), meta: meta || {} };
      SC.Save.queueFeedback(entry);
      if (this.endpoint) {
        try {
          fetch(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }).catch(function () {});
        } catch (e) {}
      }
      return true;
    }
  };
})();
