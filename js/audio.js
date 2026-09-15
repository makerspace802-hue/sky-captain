/* ============================================================
   SC.Audio — procedural WebAudio: engine, wind, warnings, chimes.
   Zero external assets. Created lazily on first user gesture.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};

  var A = SC.Audio = {
    ctx: null, master: null, engOsc: null, engOsc2: null, engGain: null,
    windSrc: null, windGain: null, started: false,

    ensure: function () {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return true; }
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._vol();
        this.master.connect(this.ctx.destination);
        this._buildEngine(); this._buildWind();
        this.started = true;
        return true;
      } catch (e) { return false; }
    },
    _vol: function () {
      var s = SC.Save && SC.Save.settings;
      if (!s || !s.sound) return 0;
      return (s.volume == null ? 70 : s.volume) / 100 * 0.9;
    },
    applySettings: function () {
      if (this.master) this.master.gain.value = this._vol();
    },

    _buildEngine: function () {
      var c = this.ctx;
      this.engGain = c.createGain(); this.engGain.gain.value = 0.0;
      var filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 420;
      this.engOsc = c.createOscillator(); this.engOsc.type = "sawtooth"; this.engOsc.frequency.value = 55;
      this.engOsc2 = c.createOscillator(); this.engOsc2.type = "square"; this.engOsc2.frequency.value = 28;
      var g2 = c.createGain(); g2.gain.value = 0.4;
      this.engOsc.connect(filt); this.engOsc2.connect(g2); g2.connect(filt);
      filt.connect(this.engGain); this.engGain.connect(this.master);
      this.engOsc.start(); this.engOsc2.start();
    },
    _buildWind: function () {
      var c = this.ctx, len = c.sampleRate * 2;
      var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.windSrc = c.createBufferSource(); this.windSrc.buffer = buf; this.windSrc.loop = true;
      var f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 600; f.Q.value = 0.6;
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      this.windSrc.connect(f); f.connect(this.windGain); this.windGain.connect(this.master);
      this.windSrc.start();
    },

    // per-frame: throttle 0..1, iasKt, onGround
    updateFlight: function (throttle, iasKt, onGround) {
      if (!this.ctx || !this.started) return;
      var t = this.ctx.currentTime;
      var rpm = 0.25 + throttle * 0.75;
      this.engOsc.frequency.setTargetAtTime(40 + rpm * 90, t, 0.1);
      this.engOsc2.frequency.setTargetAtTime(20 + rpm * 45, t, 0.1);
      this.engGain.gain.setTargetAtTime(0.05 + throttle * 0.16, t, 0.1);
      this.windGain.gain.setTargetAtTime(Math.min(0.22, iasKt / 400 * 0.22) * (onGround ? 0.4 : 1), t, 0.2);
    },
    idle: function () {
      if (!this.ctx || !this.started) return;
      var t = this.ctx.currentTime;
      this.engGain.gain.setTargetAtTime(0.02, t, 0.3);
      this.windGain.gain.setTargetAtTime(0, t, 0.3);
    },

    _blip: function (freq, dur, type, vol, when) {
      if (!this.ctx) return;
      var c = this.ctx, t = c.currentTime + (when || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    },
    click: function () { this.ensure(); this._blip(700, 0.08, "square", 0.08); },
    chime: function () { this.ensure(); this._blip(880, 0.25, "sine", 0.2); this._blip(1320, 0.35, "sine", 0.18, 0.18); },
    atcTone: function () { this.ensure(); this._blip(1040, 0.12, "sine", 0.15); this._blip(780, 0.14, "sine", 0.15, 0.12); },
    warnStall: function () { this.ensure(); for (var i = 0; i < 3; i++) this._blip(440, 0.12, "square", 0.16, i * 0.16); },
    warnOverspeed: function () { this.ensure(); for (var i = 0; i < 2; i++) this._blip(980, 0.1, "square", 0.14, i * 0.14); },
    touchdown: function () { this.ensure(); this._blip(120, 0.25, "sine", 0.35); },
    crash: function () {
      this.ensure();
      if (!this.ctx) return;
      var c = this.ctx, t = c.currentTime, len = c.sampleRate * 0.7;
      var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      var s = c.createBufferSource(); s.buffer = buf;
      var g = c.createGain(); g.gain.value = 0.5;
      s.connect(g); g.connect(this.master); s.start(t);
      this._blip(70, 0.6, "sine", 0.4);
    },
    cash: function () { this.ensure(); this._blip(1200, 0.1, "sine", 0.16); this._blip(1600, 0.18, "sine", 0.16, 0.09); }
  };
})();
