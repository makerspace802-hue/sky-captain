/* ============================================================
   SC.ATC — AI air-traffic control session (single-player brain).
   SC.Comms — radio/text/voice communication layer.
   SC.Traffic — ambient AI aircraft (global + local pattern).
   Multiplayer reuses the same phrase/chat protocol via SC.MP.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  /* ================= AI ATC SESSION ================= */
  SC.ATC = {
    newSession: function (flight) {
      var S = {
        flight: flight, log: [],
        expected: "taxi",            // next expected call
        taxiClear: false, takeoffClear: false, landClear: false, approachClear: false,
        warnedTaxi: false, warnedRwy: false, warnedTakeoff: false,
        greeted: false,

        cs: function () { return flight.callsign; },
        rwy: function () { return SC.Airfield.rwyName(flight.depHdg); },

        say: function (text, from) {
          var m = { t: Date.now(), who: from || (this.flight.dep.code + " TWR"), text: text, cls: "atc" };
          this.log.push(m);
          SC.Comms.renderMsg(m);
          SC.Audio.atcTone();
          SC.Comms.speak(text);
          return m;
        },
        pilot: function (text) {
          var m = { t: Date.now(), who: this.cs(), text: text, cls: "me" };
          this.log.push(m);
          SC.Comms.renderMsg(m);
          return m;
        },
        sys: function (text) {
          var m = { t: Date.now(), who: "SYS", text: text, cls: "sys" };
          this.log.push(m);
          SC.Comms.renderMsg(m);
          return m;
        },

        greet: function () {
          if (this.greeted) return;
          this.greeted = true;
          this.say(this.cs() + ", " + this.flight.dep.city + " Ground, good " + this._daypart() +
            ". Squawk 2000, QNH 1013. Advise ready to taxi.");
          this.flight.rating.atc.required++;
        },
        _daypart: function () {
          var h = Math.floor(SC.Time.simMin / 60);
          return (h < 5 || h >= 21) ? "evening" : (h < 12 ? "morning" : "afternoon");
        },

        // Pilot used a predefined phrase. Returns nothing; side-effects + replies.
        handlePhrase: function (id) {
          var F = this.flight, R = F.rating.atc;
          var label = id;
          for (var i = 0; i < SC.Data.PHRASES.length; i++) if (SC.Data.PHRASES[i].id === id) label = SC.Data.PHRASES[i].label;
          this.pilot(label + ".");
          var ph = F.phase;

          function complied(s, extraReq) {
            if (extraReq) R.required++;
            R.complied++;
          }

          if (id === "taxi") {
            if (ph === "PARKED" || ph === "TAXI_OUT" || ph === "ARRIVED_TAXI") {
              if (!this.taxiClear) { this.taxiClear = true; complied(this); }
              this.say(this.cs() + ", taxi to runway " + this.rwy() + " via taxiway A. Hold short of " + this.rwy() + ".");
              this.expected = "takeoff";
              if (ph === "PARKED") SC.Flight.setPhase("TAXI_OUT");
            } else if (ph === "TAXI_IN") {
              this.say(this.cs() + ", taxi to gate " + (F.gate + 1) + " via B. Monitor ground.");
              if (this.expected === "taxi-in") { complied(this); this.expected = null; }
            } else this.say(this.cs() + ", negative — you are airborne. Continue as cleared.");
          }
          else if (id === "departure" || id === "takeoff") {
            if (ph === "TAXI_OUT" || ph === "HOLD_SHORT" || ph === "LINEUP") {
              if (!this.takeoffClear) {
                this.takeoffClear = true; complied(this, true);
                this.say(this.cs() + ", runway " + this.rwy() + ", wind " + SC.Flight.windStr() + ", cleared for TAKEOFF.");
                SC.Flight.banner("CLEARED FOR TAKEOFF — RWY " + this.rwy(), "good");
                this.expected = null;
              } else this.say(this.cs() + ", already cleared for takeoff.");
            } else if (SC.Flight.isAirborne()) this.say(this.cs() + ", you are airborne — climb and maintain " + F.cruiseAltFt + " ft.");
            else this.say(this.cs() + ", hold position. Taxi to " + this.rwy() + " first.");
          }
          else if (id === "approach") {
            if (SC.Flight.isAirborne()) {
              if (!this.approachClear) { this.approachClear = true; complied(this, true); }
              this.say(this.cs() + ", cleared ILS approach runway " + F.arrRwy + ". Descend with the glide. Report established.");
              this.expected = "landing";
            } else this.say(this.cs() + ", negative, you are on the ground.");
          }
          else if (id === "landing") {
            if (ph === "APPROACH" || ph === "FINAL" || ph === "DESCENT" || ph === "CRUISE") {
              if (!this.landClear) { this.landClear = true; complied(this, true); }
              this.say(this.cs() + ", runway " + F.arrRwy + ", wind " + SC.Flight.windStr(true) + ", cleared to LAND.");
              SC.Flight.banner("CLEARED TO LAND — RWY " + F.arrRwy, "good");
              this.expected = null;
            } else this.say(this.cs() + ", negative. Call on approach for landing clearance.");
          }
          else if (id === "goaround") {
            F.rating.goArounds++;
            this.landClear = false;
            this.say(this.cs() + ", roger GO-AROUND. Climb " + F.cruiseAltFt + " ft, fly runway heading. You are number one for another approach.");
            SC.Flight.banner("GO-AROUND — CLIMB & REJOIN", "");
            SC.Flight.goAround();
            R.required++; R.complied++;
          }
          else if (id === "mayday") {
            this.say(this.cs() + ", MAYDAY acknowledged. All stations stand by. Cleared to land ANY runway, emergency services notified.");
            SC.Flight.banner("MAYDAY ACKNOWLEDGED — LAND ASAP", "bad");
            R.required++; R.complied++;
          }
          else if (id === "unable") this.say(this.cs() + ", roger. Advise intentions.");
          else if (id === "roger") this.say(this.cs() + ", roger.");
          else if (id === "standby") this.say(this.cs() + ", standing by.");
          if (SC.MP && SC.MP.connected) SC.MP.sendAtc({ from: F.callsign, to: "ATC", text: label });
        },

        handleText: function (text) {
          var id = SC.Comms.matchPhrase(text);
          if (id) this.handlePhrase(id);
          else {
            this.pilot(text);
            this.say(this.cs() + ", say again? Use standard phrases — try REQUEST TAXI / TAKEOFF / LANDING.");
          }
        },

        // Proactive ATC monitoring each tick.
        update: function (dt) {
          var F = this.flight;
          if (!F || F.over) return;
          // taxi without clearance
          if ((F.phase === "TAXI_OUT") && F.model.gSpeedKt > 4 && !this.taxiClear && !this.warnedTaxi) {
            this.warnedTaxi = true;
            this.say(this.cs() + ", HOLD POSITION. You are moving without taxi clearance.");
            SC.Flight.violation("Taxi without clearance");
            F.rating.taxi.holdViolation = true;
          }
          // entered runway w/o takeoff clearance
          if (F.onRunway && !SC.Flight.isAirborne() && !this.takeoffClear && !this.warnedRwy &&
              (F.phase === "TAXI_OUT" || F.phase === "HOLD_SHORT" || F.phase === "LINEUP")) {
            this.warnedRwy = true;
            this.say(this.cs() + ", you are ON THE RUNWAY without clearance. Vacate immediately or request takeoff.");
            SC.Flight.violation("Runway incursion");
            F.rating.taxi.holdViolation = true;
          }
          // airborne without clearance
          if (F.justAirborne && !this.takeoffClear && !this.warnedTakeoff) {
            this.warnedTakeoff = true;
            this.say(this.cs() + ", you departed WITHOUT clearance. Climb " + F.cruiseAltFt + " ft and expect a call from the chief pilot.");
            SC.Flight.violation("Takeoff without clearance");
          }
          // handoff after takeoff
          if (F.phase === "CLIMB" && !this._handed) {
            this._handed = true;
            var self = this;
            setTimeout(function () {
              if (!F.over) self.say(self.cs() + ", contact " + F.arr.city + " Approach on 124.5 when ready. Climb " + F.cruiseAltFt + " ft.");
            }, 2500);
          }
          // approach reminder
          if (F.phase === "APPROACH" && !this.landClear && !this._landReminded) {
            this._landReminded = true;
            this.say(this.cs() + ", " + F.arr.city + " Tower. Report established, request landing.");
            F.rating.atc.required++;
          }
          // rollout -> taxi-in
          if (F.phase === "ROLLOUT" && !this._rollout) {
            this._rollout = true;
            var s2 = this;
            setTimeout(function () {
              if (!F.over && (F.phase === "ROLLOUT" || F.phase === "TAXI_IN"))
                s2.say(s2.cs() + ", vacate next left, taxi to gate " + (F.gate + 1) + ". Welcome to " + F.arr.city + ".");
            }, 3000);
          }
        }
      };
      return S;
    }
  };

  /* ================= COMMS ================= */
  var Comms = SC.Comms = {
    _rec: null, _listening: false,

    renderMsg: function (m) {
      var U2 = SC.Utils, log = U2.$("chat-log");
      if (log && SC.Game.state === "flight") {
        var d = U2.el("div", "chat-msg " + m.cls);
        var dt = new Date(m.t);
        var ts = (dt.getHours() < 10 ? "0" : "") + dt.getHours() + ":" + (dt.getMinutes() < 10 ? "0" : "") + dt.getMinutes();
        d.innerHTML = "<span class='ts'>" + ts + "</span><span class='who'>" + U2.escape(m.who) + ":</span> " + U2.escape(m.text);
        log.appendChild(d);
        while (log.children.length > 80) log.removeChild(log.firstChild);
        U2.scrollBottom(log);
        // unread dot if chat tab hidden
        var tab = U2.$("atc-tab-chat");
        if (tab && tab.classList.contains("hidden")) { var u = U2.$("chat-unread"); if (u) u.classList.remove("hidden"); }
      }
      if (SC.UI && SC.UI.onChatMsg) SC.UI.onChatMsg(m);
    },

    matchPhrase: function (text) {
      text = String(text || "").toLowerCase();
      if (!text.trim()) return null;
      if (/mayday|emergency|pan pan/.test(text)) return "mayday";
      if (/go.?around|missed/.test(text)) return "goaround";
      if (/land/.test(text)) return "landing";
      if (/approach|final|established/.test(text)) return "approach";
      if (/take.?off|depart|line.?up/.test(text)) return /ready/.test(text) ? "departure" : "takeoff";
      if (/taxi|gate|parking/.test(text)) return "taxi";
      if (/unable|cannot|can't/.test(text)) return "unable";
      if (/stand.?by|wait/.test(text)) return "standby";
      if (/roger|wilco|copy|affirm/.test(text)) return "roger";
      return null;
    },

    speak: function (text) {
      try {
        var S = SC.Save && SC.Save.settings;
        if (!S || !S.atcVoice || !("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05; u.pitch = 0.9;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    },

    voiceSupported: function () {
      return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },
    startListening: function (onText) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return false;
      try {
        this.stopListening();
        var r = new SR();
        r.lang = "en-US"; r.interimResults = false; r.maxAlternatives = 1;
        var self = this;
        r.onresult = function (e) {
          var t = e.results[0][0].transcript;
          if (onText) onText(t);
        };
        r.onend = function () { self._listening = false; self._voiceStatus("Voice ready"); };
        r.onerror = function () { self._listening = false; self._voiceStatus("Voice error — type or use phrases"); };
        r.start();
        this._rec = r; this._listening = true;
        this._voiceStatus("● Listening… release to send");
        return true;
      } catch (e) { return false; }
    },
    stopListening: function () {
      try { if (this._rec && this._listening) this._rec.stop(); } catch (e) {}
      this._listening = false;
    },
    _voiceStatus: function (t) {
      var el = SC.Utils.$("voice-status");
      if (el) el.textContent = t;
    }
  };

  /* ================= AI TRAFFIC ================= */
  var Traffic = SC.Traffic = {
    planes: [],       // global enroute AI
    pattern: null,    // local pattern flyer at active airport
    _calls: ["AIC", "UAE", "BAW", "DLH", "JAL", "QFA", "SIA", "AFR", "AAY", "VIR"],

    init: function () {
      this.planes = [];
      var AP = SC.Data.AIRPORTS;
      for (var i = 0; i < 10; i++) {
        var a = U.pick(AP), b = U.pick(AP);
        if (a === b) b = AP[(AP.indexOf(a) + 3) % AP.length];
        this.planes.push({
          cs: U.pick(this._calls) + U.randInt(101, 989),
          from: a.code, to: b.code, f: Math.random(),
          altFt: U.randInt(280, 410) * 100, spdKt: U.randInt(380, 480),
          wob: Math.random() * 6.28
        });
      }
      this.pattern = null;
    },
    update: function (dtSimSec) {
      var self = this;
      this.planes.forEach(function (p) {
        p.f += dtSimSec / 3600 * (p.spdKt / 9000);
        if (p.f >= 1) {
          var AP = SC.Data.AIRPORTS, b = U.pick(AP);
          p.from = p.to; p.to = b.code; p.f = 0;
        }
      });
      if (this.pattern) this._updatePattern(dtSimSec);
    },
    posOf: function (p) {
      var A = SC.Data.airportByCode(p.from), B = SC.Data.airportByCode(p.to);
      return U.greatCircle(A.lat, A.lon, B.lat, B.lon, p.f);
    },
    // spawn a touch-and-go trainer in the local scene
    ensurePattern: function (airport, rwyHdg) {
      if (this.pattern && this.pattern.code === airport.code) return this.pattern;
      this.pattern = { code: airport.code, t: Math.random(), rwyHdg: rwyHdg, cs: "TRN" + U.randInt(10, 99) };
      return this.pattern;
    },
    _updatePattern: function (dt) { this.pattern.t = (this.pattern.t + dt / 150) % 1; },
    // local coords (meters, origin runway center) of pattern aircraft
    patternPos: function (rwyLen) {
      // rectangular circuit: parametrize perimeter of rectangle 1200×500m at ~250m AGL
      var t = this.pattern.t, W = rwyLen / 2 + 700, Dpt = 600, h = 220;
      var per = 2 * (2 * W + 2 * Dpt), d = t * per;
      var x, z; // x: along runway, z: lateral
      var seg = [2 * W, 2 * Dpt, 2 * W, 2 * Dpt];
      if (d < seg[0]) { x = -W + d; z = -Dpt; }
      else if ((d -= seg[0]) < seg[1]) { x = W; z = -Dpt + d; h = 220 - d / seg[1] * 200; }
      else if ((d -= seg[1]) < seg[2]) { x = W - d; z = Dpt; h = 20; }
      else { d -= seg[2]; x = -W; z = Dpt - d; h = 20 + d / seg[3] * 200; }
      return { x: x, y: h, z: z, hdg: 0 };
    }
  };
})();
