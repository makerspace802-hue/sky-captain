/* ============================================================
   SC.Input — unified input: keyboard (+remappable), mouse yoke,
   virtual stick, tilt, gamepad. Flight systems read axes/buttons;
   they never touch DOM events directly.
   Axes: pitch +1 = pull back (climb), roll +1 = right bank.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};

  var DEFAULT_KEYS = {
    throttleUp: "KeyW", throttleDn: "KeyS",
    pitchUp: "ArrowUp", pitchDn: "ArrowDown",
    rollL: "ArrowLeft", rollR: "ArrowRight",
    rudderL: "KeyA", rudderR: "KeyD",
    gear: "KeyG", flapsUp: "KeyF", flapsDn: "KeyV",
    brake: "KeyB", brakeAlt: "Space",
    autopilot: "KeyP", camera: "KeyC", accel: "KeyT",
    pause: "Escape", atcPanel: "KeyM"
  };

  var I = SC.Input = {
    keys: DEFAULT_KEYS,
    down: {},            // code -> bool
    stick: { pitch: 0, roll: 0, active: false },
    mouseYoke: { pitch: 0, roll: 0, active: false },
    tilt: { pitch: 0, roll: 0, active: false },
    pad: { pitch: 0, roll: 0, yaw: 0, connected: false },
    _actions: {},        // name -> [callbacks]
    _padPrev: {},
    tiltEnabled: false,
    _tiltBase: { beta: null, gamma: null },

    init: function () {
      var self = this;
      window.addEventListener("keydown", function (e) {
        if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
        self.down[e.code] = true;
        self._edge(e.code);
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
      });
      window.addEventListener("keyup", function (e) { self.down[e.code] = false; });
      window.addEventListener("blur", function () { self.down = {}; });
      window.addEventListener("deviceorientation", function (e) { self._onTilt(e); });
      window.addEventListener("gamepadconnected", function () { self.pad.connected = true; });
      window.addEventListener("gamepaddisconnected", function () { self.pad.connected = false; });
    },

    isDown: function (code) { return !!this.down[code]; },
    onAction: function (name, fn) {
      if (!this._actions[name]) this._actions[name] = [];
      this._actions[name].push(fn);
    },
    fire: function (name, arg) {
      var a = this._actions[name];
      if (a) for (var i = 0; i < a.length; i++) { try { a[i](arg); } catch (e) {} }
    },
    _edge: function (code) {
      var K = this.keys;
      if (code === K.gear) this.fire("gear");
      else if (code === K.flapsUp) this.fire("flapsUp");
      else if (code === K.flapsDn) this.fire("flapsDn");
      else if (code === K.autopilot) this.fire("autopilot");
      else if (code === K.camera) this.fire("camera");
      else if (code === K.accel) this.fire("accel");
      else if (code === K.pause) this.fire("pause");
      else if (code === K.atcPanel) this.fire("atcPanel");
    },

    // ---- tilt ----
    enableTilt: function () {
      var self = this;
      function req() {
        self.tiltEnabled = true;
        self._tiltBase.beta = null; self._tiltBase.gamma = null;
        SC.UI.toast("Tilt enabled — hold device level to calibrate");
      }
      try {
        if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === "function") {
          window.DeviceOrientationEvent.requestPermission().then(function (r) { if (r === "granted") req(); }).catch(function () {});
        } else req();
      } catch (e) { req(); }
    },
    _onTilt: function (e) {
      if (!this.tiltEnabled || e.beta == null) return;
      var S = SC.Save && SC.Save.settings;
      if (!S || S.control !== "tilt") { this.tilt.active = false; return; }
      if (this._tiltBase.beta == null) { this._tiltBase.beta = e.beta; this._tiltBase.gamma = e.gamma; }
      var inv = S.invertPitch ? -1 : 1;
      this.tilt.roll = SC.Utils.clamp((e.gamma - this._tiltBase.gamma) / 25, -1, 1);
      this.tilt.pitch = SC.Utils.clamp(-(e.beta - this._tiltBase.beta) / 25 * inv, -1, 1);
      this.tilt.active = true;
    },

    // ---- gamepad poll (call each frame) ----
    pollPad: function () {
      this.pad.pitch = 0; this.pad.roll = 0; this.pad.yaw = 0;
      var gps = null;
      try { gps = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) {}
      if (!gps) return;
      var gp = null;
      for (var i = 0; i < gps.length; i++) if (gps[i] && gps[i].connected) { gp = gps[i]; break; }
      if (!gp) return;
      this.pad.connected = true;
      var dz = function (v) { return Math.abs(v) < 0.12 ? 0 : v; };
      this.pad.roll = dz(gp.axes[0] || 0);
      this.pad.pitch = -dz(gp.axes[1] || 0);
      this.pad.yaw = dz(gp.axes[2] || 0);
      var b = gp.buttons.map(function (x) { return x.pressed; });
      function edge(idx, name) {
        if (b[idx] && !I._padPrev[idx]) I.fire(name);
        I._padPrev[idx] = b[idx];
      }
      edge(0, "brakeTap");   // A
      edge(2, "flapsUp");    // X
      edge(3, "gear");       // Y
      edge(9, "pause");      // Start
      edge(4, "thrDn"); edge(5, "thrUp"); // LB/RB throttle nudge
      if (b[1]) this.down.__padBrake = true; else delete this.down.__padBrake; // B = brake hold
      if (b[6]) this.fire("flapsDnHold");
    },

    // ---- combined axes (priority: stick > tilt > mouse > pad > keys) ----
    getAxes: function () {
      var K = this.keys, out = { pitch: 0, roll: 0, yaw: 0, brake: 0, thrDelta: 0 };
      var S = (SC.Save && SC.Save.settings) || {};
      var inv = S.invertPitch ? -1 : 1;
      if (this.stick.active) { out.pitch = this.stick.pitch * inv; out.roll = this.stick.roll; }
      else if (S.control === "tilt" && this.tilt.active) { out.pitch = this.tilt.pitch; out.roll = this.tilt.roll; }
      else if (S.control === "mouse" && this.mouseYoke.active) { out.pitch = this.mouseYoke.pitch * inv; out.roll = this.mouseYoke.roll; }
      else if (this.pad.connected && (this.pad.pitch || this.pad.roll)) { out.pitch = this.pad.pitch * inv; out.roll = this.pad.roll; }
      else {
        if (this.down[K.pitchUp]) out.pitch += 1;
        if (this.down[K.pitchDn]) out.pitch -= 1;
        if (this.down[K.rollR] || (!S.rudderKeys && this.down[K.rudderR])) out.roll += 1;
        if (this.down[K.rollL] || (!S.rudderKeys && this.down[K.rudderL])) out.roll -= 1;
        out.pitch *= inv;
      }
      if (S.rudderKeys !== false && this.down[K.rudderR]) out.yaw += 1;
      if (S.rudderKeys !== false && this.down[K.rudderL]) out.yaw -= 1;
      if (this.down.__padBrake || this.down[K.brake] || this.down[K.brakeAlt]) out.brake = 1;
      if (this.down[K.throttleUp]) out.thrDelta += 1;
      if (this.down[K.throttleDn]) out.thrDelta -= 1;
      var U = SC.Utils;
      out.pitch = U.clamp(out.pitch, -1, 1); out.roll = U.clamp(out.roll, -1, 1); out.yaw = U.clamp(out.yaw, -1, 1);
      return out;
    },

    helpHTML: function () {
      return "<div class='info-row'><span>W / S</span><strong>Throttle up / down</strong></div>" +
        "<div class='info-row'><span>↑ / ↓</span><strong>Pitch (climb / descend)</strong></div>" +
        "<div class='info-row'><span>← / →</span><strong>Roll / ground steering</strong></div>" +
        "<div class='info-row'><span>A / D</span><strong>Rudder (yaw)</strong></div>" +
        "<div class='info-row'><span>G</span><strong>Landing gear</strong></div>" +
        "<div class='info-row'><span>F / V</span><strong>Flaps extend / retract</strong></div>" +
        "<div class='info-row'><span>B or Space (hold)</span><strong>Brakes</strong></div>" +
        "<div class='info-row'><span>P</span><strong>Autopilot</strong></div>" +
        "<div class='info-row'><span>T</span><strong>Time acceleration</strong></div>" +
        "<div class='info-row'><span>C</span><strong>Camera (cockpit/chase)</strong></div>" +
        "<div class='info-row'><span>M</span><strong>ATC panel</strong></div>" +
        "<div class='info-row'><span>Gamepad</span><strong>Left stick fly · LB/RB throttle · Y gear · X flaps · B brake</strong></div>" +
        "<div class='info-row'><span>Touch</span><strong>Stick + throttle slider + buttons</strong></div>";
    }
  };
})();
