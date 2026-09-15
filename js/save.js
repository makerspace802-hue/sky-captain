/* ============================================================
   SC.Save — CENTRALIZED persistence. The ONLY module that touches
   localStorage. All other systems go through Save.profile / settings.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};

  var KEY_PROFILE = "skycap.profile.v1";
  var KEY_SETTINGS = "skycap.settings.v1";
  var KEY_FEEDBACK = "skycap.feedback.v1";

  function defaultProfile() {
    return {
      version: 1,
      pilotName: "", avatar: "🧑‍✈️", callsign: "SKC101",
      money: SC.Config.startingMoney,
      licenses: ["student"],
      activeLicense: "student",
      aircraftOwned: [SC.Config.starterAircraftId],
      activeAircraft: SC.Config.starterAircraftId,
      fuelState: {},            // aircraftId -> fuel units
      upgrades: {},             // aircraftId -> {upgId: level}
      flightHours: 0, flightsCompleted: 0, flightsFailed: 0,
      distanceFlownKm: 0, ratingSum: 0, ratingsCount: 0,
      airportsVisited: [], missionsDone: [], lessonsDone: [],
      achievements: [], tutorialCompleted: false,
      lastSafeAirport: SC.Config.starterAirport,
      bestLandingFpm: null,
      createdAt: Date.now()
    };
  }

  function defaultSettings() {
    return {
      control: "stick", invertPitch: false, rudderKeys: true,
      difficulty: "normal", quality: "medium", cockpitCam: true,
      sound: true, volume: 70, atcVoice: true, units: "km",
      tiltCalBeta: null, tiltCalGamma: null
    };
  }

  var Save = SC.Save = {
    profile: null,
    settings: null,
    _dirtyT: 0,

    loadAll: function () {
      this.settings = this._read(KEY_SETTINGS, defaultSettings());
      this.profile = this._read(KEY_PROFILE, null);
      if (this.profile && this.profile.version !== 1) this.profile = this._migrate(this.profile);
      return { profile: this.profile, settings: this.settings };
    },
    hasProfile: function () { return !!(this.profile && this.profile.pilotName); },

    newProfile: function (name, avatar) {
      var p = defaultProfile();
      p.pilotName = String(name || "Captain").slice(0, 20) || "Captain";
      p.avatar = avatar || "🧑‍✈️";
      p.callsign = SC.Config.callsignPrefix + (100 + Math.floor(Math.random() * 800));
      var acId = SC.Config.starterAircraftId;
      var ac = SC.Data.aircraftById(acId);
      p.fuelState[acId] = ac.fuelCap; // full tank to start
      p.airportsVisited = [SC.Config.starterAirport];
      this.profile = p;
      this.saveNow();
      return p;
    },

    saveNow: function () {
      try {
        if (this.profile) localStorage.setItem(KEY_PROFILE, JSON.stringify(this.profile));
        if (this.settings) localStorage.setItem(KEY_SETTINGS, JSON.stringify(this.settings));
      } catch (e) { /* storage full/blocked: game still runs */ }
      this._dirtyT = 0;
    },
    markDirty: function () { this._dirtyT = 0.001; },
    // call every frame with dt; autosaves periodically when dirty
    tick: function (dt) {
      if (this._dirtyT > 0) {
        this._dirtyT += dt;
        if (this._dirtyT >= SC.Config.autosaveSec) this.saveNow();
      }
    },

    eraseProfile: function () {
      try { localStorage.removeItem(KEY_PROFILE); } catch (e) {}
      this.profile = null;
    },

    // ---- feedback queue (synced later by FeedbackService) ----
    queueFeedback: function (entry) {
      var q = this._read(KEY_FEEDBACK, []);
      q.push(entry);
      try { localStorage.setItem(KEY_FEEDBACK, JSON.stringify(q)); } catch (e) {}
    },
    readFeedback: function () { return this._read(KEY_FEEDBACK, []); },

    _read: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return JSON.parse(JSON.stringify(fallback));
        var v = JSON.parse(raw);
        if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
          for (var k in fallback) if (!(k in v)) v[k] = fallback[k];
        }
        return v;
      } catch (e) { return JSON.parse(JSON.stringify(fallback)); }
    },
    _migrate: function (p) { p.version = 1; return p; }
  };
})();
