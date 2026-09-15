/* ============================================================
   SC.WorldMap — pannable/zoomable world map with airports,
   great-circle routes, traffic. SC.MiniMap — in-flight nav display.
   SC.Radar — ATC-mode radar scope.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  /* ================= WORLD MAP ================= */
  var WM = SC.WorldMap = {
    cv: null, ctx: null, W: 0, H: 0,
    cx: 60, cy: 22, zoom: 1.6,      // center lon/lat + zoom
    dep: null, arr: null, t: 0,
    _drag: null, landCells: null,
    onPick: null,

    init: function (id) {
      this.cv = U.$(id); if (!this.cv) return;
      this.ctx = this.cv.getContext("2d");
      this.resize();
      var self = this;
      window.addEventListener("resize", function () { self.resize(); });
      // pan (drag) + tap-to-pick + wheel/pinch zoom
      var lastPinch = 0;
      this.cv.addEventListener("pointerdown", function (e) {
        self.cv.setPointerCapture(e.pointerId);
        self._drag = { x: e.clientX, y: e.clientY, cx: self.cx, cy: self.cy, moved: false };
      });
      this.cv.addEventListener("pointermove", function (e) {
        if (!self._drag) return;
        var dx = e.clientX - self._drag.x, dy = e.clientY - self._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) self._drag.moved = true;
        var s = self._scale();
        self.cx = U.wrap360(self._drag.cx - dx / s + 180) - 180;
        self.cy = U.clamp(self._drag.cy + dy / s, -70, 75);
      });
      this.cv.addEventListener("pointerup", function (e) {
        var wasTap = self._drag && !self._drag.moved;
        self._drag = null;
        if (wasTap) self._tap(e);
      });
      this.cv.addEventListener("wheel", function (e) {
        e.preventDefault();
        self.zoom = U.clamp(self.zoom * (e.deltaY < 0 ? 1.2 : 0.84), 1, 14);
      }, { passive: false });
      this.cv.addEventListener("touchmove", function (e) {
        if (e.touches.length === 2) {
          e.preventDefault();
          var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          if (lastPinch) self.zoom = U.clamp(self.zoom * (d / lastPinch), 1, 14);
          lastPinch = d;
        }
      }, { passive: false });
      this.cv.addEventListener("touchend", function () { lastPinch = 0; });
      this._buildLand();
    },
    resize: function () {
      if (!this.cv) return;
      var r = this.cv.getBoundingClientRect();
      this.W = Math.max(300, r.width); this.H = Math.max(300, r.height);
      this.cv.width = this.W; this.cv.height = this.H;
    },
    _scale: function () { return (this.W / 360) * this.zoom; },
    _buildLand: function () {
      this.landCells = [];
      var bm = SC.Data.WORLD_BITMAP;
      for (var r = 0; r < bm.length; r++) {
        var row = bm[r] || "";
        for (var c = 0; c < 72; c++) {
          if (row[c] === "#") this.landCells.push({ lon: -180 + (c + 0.5) * 5, lat: 90 - (r + 0.5) * 5 });
        }
      }
    },
    project: function (lon, lat) {
      var s = this._scale();
      var dLon = lon - this.cx;
      while (dLon > 180) dLon -= 360; while (dLon < -180) dLon += 360;
      return { x: this.W / 2 + dLon * s, y: this.H / 2 - (lat - this.cy) * s };
    },
    unproject: function (x, y) {
      var s = this._scale();
      var lon = this.cx + (x - this.W / 2) / s, lat = this.cy - (y - this.H / 2) / s;
      while (lon > 180) lon -= 360; while (lon < -180) lon += 360;
      return { lon: lon, lat: U.clamp(lat, -85, 85) };
    },
    _tap: function (e) {
      var r = this.cv.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var best = null, bd = 26;
      SC.Data.AIRPORTS.forEach(function (a) {
        var p = WM.project(a.lon, a.lat);
        var d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = a; }
      });
      if (best && this.onPick) this.onPick(best.code);
    },

    draw: function (dt) {
      if (!this.ctx) return;
      this.t += dt || 0.016;
      var ctx = this.ctx, W = this.W, H = this.H, self = this;
      // ocean
      var oc = ctx.createLinearGradient(0, 0, 0, H);
      oc.addColorStop(0, "#0a1830"); oc.addColorStop(0.5, "#0d2140"); oc.addColorStop(1, "#081426");
      ctx.fillStyle = oc; ctx.fillRect(0, 0, W, H);
      // graticule
      ctx.strokeStyle = "rgba(90,140,200,0.18)"; ctx.lineWidth = 1;
      ctx.font = "10px monospace"; ctx.fillStyle = "rgba(120,160,210,0.5)";
      for (var gl = -180; gl <= 180; gl += 20) {
        var p1 = this.project(gl, -80), p2 = this.project(gl, 80);
        ctx.beginPath(); ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, H); ctx.stroke();
      }
      for (var gt = -60; gt <= 80; gt += 20) {
        var q = this.project(0, gt);
        ctx.beginPath(); ctx.moveTo(0, q.y); ctx.lineTo(W, q.y); ctx.stroke();
      }
      // day/night terminator tint
      var utcH = SC.Time.simMin / 60;
      var noonLon = U.wrap360(180 - utcH * 15 + 180) - 180; // approx subsolar lon
      var grd = ctx.createLinearGradient(0, 0, W, 0);
      var nl = this.project(U.wrap360(noonLon + 180) - 180, 0).x;
      // land
      var s = this._scale(), cell = Math.max(2, 5 * s * 0.9);
      ctx.fillStyle = "#1d3a5e";
      this.landCells.forEach(function (c) {
        var p = self.project(c.lon, c.lat);
        if (p.x < -cell || p.x > W + cell || p.y < -cell || p.y > H + cell) return;
        ctx.fillRect(p.x - cell / 2, p.y - cell / 2, cell, cell);
      });
      // night shading on land (cheap: overlay on dark side)
      ctx.fillStyle = "rgba(2,6,14,0.45)";
      if (nl > 0 && nl < W) { /* keep simple: skip terminator polygon */ }
      // route
      if (this.dep && this.arr) {
        var A = SC.Data.airportByCode(this.dep), B = SC.Data.airportByCode(this.arr);
        ctx.strokeStyle = "#e8b64c"; ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]); ctx.lineDashOffset = -this.t * 22;
        ctx.beginPath();
        var prev = null;
        for (var i = 0; i <= 60; i++) {
          var g = U.greatCircle(A.lat, A.lon, B.lat, B.lon, i / 60);
          var rp = this.project(g.lon, g.lat);
          if (prev && Math.abs(rp.x - prev.x) > W / 2) { ctx.moveTo(rp.x, rp.y); }
          else if (i === 0) ctx.moveTo(rp.x, rp.y); else ctx.lineTo(rp.x, rp.y);
          prev = rp;
        }
        ctx.stroke(); ctx.setLineDash([]);
        var mid = U.greatCircle(A.lat, A.lon, B.lat, B.lon, 0.5);
        var mp = this.project(mid.lon, mid.lat);
        var km = U.haversineKm(A.lat, A.lon, B.lat, B.lon);
        ctx.fillStyle = "#f5d47e"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(U.fmtDist(this.dep === this.arr ? 0 : km), mp.x, mp.y - 10);
      }
      // AI traffic
      ctx.textAlign = "center";
      SC.Traffic.planes.forEach(function (p) {
        var pos = SC.Traffic.posOf(p), pp = self.project(pos.lon, pos.lat);
        if (pp.x < -20 || pp.x > W + 20 || pp.y < -20 || pp.y > H + 20) return;
        ctx.fillStyle = "rgba(140,200,255,0.9)";
        ctx.save(); ctx.translate(pp.x, pp.y);
        ctx.fillRect(-4, -1, 8, 2); ctx.fillRect(-1, -4, 2, 8);
        ctx.restore();
        if (self.zoom > 2.5) { ctx.fillStyle = "rgba(140,200,255,0.75)"; ctx.font = "9px monospace"; ctx.fillText(p.cs, pp.x, pp.y - 7); }
      });
      // MP players
      if (SC.MP && SC.MP.connected) {
        for (var id in SC.MP.players) {
          var pl = SC.MP.players[id];
          if (pl.lat == null) continue;
          var qp = this.project(pl.lon, pl.lat);
          ctx.fillStyle = "#3ddc84";
          ctx.save(); ctx.translate(qp.x, qp.y); ctx.rotate(U.deg2rad(pl.hdg || 0));
          ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
          ctx.restore();
          ctx.fillStyle = "#9df0c0"; ctx.font = "10px monospace";
          ctx.fillText(pl.callsign, qp.x, qp.y - 10);
        }
      }
      // airports
      SC.Data.AIRPORTS.forEach(function (a) {
        var p = self.project(a.lon, a.lat);
        if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) return;
        var isDep = self.dep === a.code, isArr = self.arr === a.code;
        ctx.beginPath(); ctx.arc(p.x, p.y, isDep || isArr ? 7 : 4, 0, 6.29);
        ctx.fillStyle = isDep ? "#3ddc84" : isArr ? "#e8b64c" : "#57b6ff";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1; ctx.stroke();
        if (self.zoom >= 1.2 || isDep || isArr) {
          ctx.fillStyle = isDep || isArr ? "#fff" : "rgba(200,220,245,0.85)";
          ctx.font = "bold " + (isDep || isArr ? 12 : 10) + "px sans-serif";
          ctx.fillText(a.code, p.x, p.y - 10);
          if (self.zoom > 3) { ctx.font = "9px sans-serif"; ctx.fillStyle = "rgba(160,190,230,0.8)"; ctx.fillText(a.city, p.x, p.y + 16); }
        }
      });
      // own position (in flight preview)
      if (SC.Flight.cur && !SC.Flight.cur.over && SC.Game.state === "flight") {
        var ll = SC.Flight.latLon(SC.Flight.cur);
        var op = this.project(ll.lon, ll.lat);
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(op.x, op.y, 5, 0, 6.29); ctx.fill();
        ctx.strokeStyle = "#e8b64c"; ctx.lineWidth = 2; ctx.stroke();
      }
      // compass rose / scale
      ctx.fillStyle = "rgba(150,190,240,0.8)"; ctx.font = "10px monospace"; ctx.textAlign = "left";
      ctx.fillText("ZOOM " + this.zoom.toFixed(1) + "×", 10, H - 10);
    }
  };

  /* ================= MINI MAP (in-flight) ================= */
  SC.MiniMap = {
    draw: function (cv, fl) {
      if (!cv || !fl) return;
      var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
      ctx.fillStyle = "#081324"; ctx.fillRect(0, 0, W, H);
      var m = fl.model;
      if (fl.sceneMode === "ENROUTE") {
        // progress + course needle
        ctx.strokeStyle = "#25406b"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(14, H / 2); ctx.lineTo(W - 14, H / 2); ctx.stroke();
        ctx.fillStyle = "#57b6ff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(fl.dep.code, 20, H / 2 - 8); ctx.fillText(fl.arr.code, W - 20, H / 2 - 8);
        var px = 14 + (W - 28) * U.clamp(fl.f, 0, 1);
        ctx.fillStyle = "#e8b64c";
        ctx.beginPath(); ctx.arc(px, H / 2, 5, 0, 6.29); ctx.fill();
        var dev = U.angDiff(fl.courseDeg, m.hdg);
        ctx.fillStyle = Math.abs(dev) > 18 ? "#ff5a5a" : "#3ddc84";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText("TRK " + String(Math.round(fl.courseDeg)).padStart(3, "0") + "°  DEV " + (dev >= 0 ? "+" : "") + Math.round(dev) + "°", W / 2, H - 12);
        // needle
        ctx.save(); ctx.translate(W / 2, 44); ctx.rotate(U.deg2rad(U.clamp(dev, -45, 45)));
        ctx.strokeStyle = "#50dcff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(0, -22); ctx.stroke();
        ctx.restore();
      } else {
        // local top-down, north-up, auto range
        var A = fl.activeF;
        var range = m.onGround ? 900 : 14000;
        function P(x, z) { return { x: W / 2 + x / range * (W / 2 - 8), y: H / 2 + z / range * (H / 2 - 8) }; }
        // runway
        var c0 = P(A.corners[0].x, A.corners[0].z), c1 = P(A.corners[1].x, A.corners[1].z),
            c2 = P(A.corners[2].x, A.corners[2].z), c3 = P(A.corners[3].x, A.corners[3].z);
        ctx.fillStyle = "#3c414c";
        ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath(); ctx.fill();
        // taxiway
        var tA = P(A.taxiA.x, A.taxiA.z), tB = P(A.taxiB.x, A.taxiB.z);
        ctx.strokeStyle = "#7c8492"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(tA.x, tA.y); ctx.lineTo(tB.x, tB.y); ctx.stroke();
        // hold + gates
        var hp = P(A.hold.x, A.hold.z);
        ctx.fillStyle = "#e8c83c"; ctx.fillRect(hp.x - 3, hp.y - 3, 6, 6);
        ctx.fillStyle = "#57b6ff";
        A.gates.forEach(function (g) { var gp = P(g.x, g.z); ctx.fillRect(gp.x - 1.5, gp.y - 1.5, 3, 3); });
        // fixes
        ctx.fillStyle = "#ff50dc"; ctx.font = "8px sans-serif"; ctx.textAlign = "center";
        for (var i = fl.fixIdx; i < fl.fixes.length; i++) {
          var fx = P(fl.fixes[i].x, fl.fixes[i].z);
          ctx.strokeStyle = "#ff50dc"; ctx.lineWidth = 1.5;
          ctx.strokeRect(fx.x - 4, fx.y - 4, 8, 8);
          ctx.fillText(fl.fixes[i].n.split(" ")[0], fx.x, fx.y - 6);
        }
        // own ship
        var op = P(m.x, m.z);
        ctx.save(); ctx.translate(op.x, op.y); ctx.rotate(U.deg2rad(m.hdg));
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#9fdcff"; ctx.font = "9px monospace"; ctx.textAlign = "left";
        ctx.fillText(A.code + " R" + SC.Airfield.rwyName(A.hdg), 6, 12);
      }
    }
  };

  /* ================= RADAR (ATC mode) ================= */
  SC.Radar = {
    draw: function (cv, room) {
      if (!cv || !room) return;
      var ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
      ctx.fillStyle = "#04140c"; ctx.fillRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 16;
      var rangeM = 22000; // 22 km scope
      function P(x, z) { return { x: cx + x / rangeM * R, y: cy + z / rangeM * R }; }
      // rings
      ctx.strokeStyle = "rgba(60,220,130,0.25)"; ctx.lineWidth = 1;
      for (var rr = 1; rr <= 3; rr++) { ctx.beginPath(); ctx.arc(cx, cy, R * rr / 3, 0, 6.29); ctx.stroke(); }
      // runway
      var A = room.field;
      function AL(x, z) { return P(x, z); }
      var r1 = AL(A.thr.x, A.thr.z), r2 = AL(A.far.x, A.far.z);
      ctx.strokeStyle = "#3ddc84"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r1.x, r1.y); ctx.lineTo(r2.x, r2.y); ctx.stroke();
      ctx.fillStyle = "#7de8a8"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      ctx.fillText(room.airport.code + " " + room.airport.rwy.name, cx, cy + R + 14);
      // sweep
      var sa = (Date.now() / 1000 * 0.9) % 6.283;
      var grd = ctx.createConicGradient ? null : null;
      ctx.strokeStyle = "rgba(60,220,130,0.5)";
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * R, cy + Math.sin(sa) * R); ctx.stroke();
      // targets
      room.targets.forEach(function (t) {
        var p = P(t.x, t.z);
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
        var sel = room.selected === t.id;
        ctx.fillStyle = sel ? "#ffd34c" : "#3ddc84";
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(U.deg2rad(t.hdg));
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
        // leader + datablock
        ctx.strokeStyle = sel ? "#ffd34c" : "rgba(61,220,132,0.7)";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 14, p.y - 14); ctx.stroke();
        ctx.fillStyle = sel ? "#ffd34c" : "#9df0c0"; ctx.font = "10px monospace"; ctx.textAlign = "left";
        ctx.fillText(t.cs, p.x + 16, p.y - 16);
        ctx.fillText(String(Math.round(t.alt / 100)).padStart(3, "0") + " " + Math.round(t.spd), p.x + 16, p.y - 4);
        if (t.cmd) { ctx.fillStyle = "#8fd0ff"; ctx.fillText("◀ " + t.cmd, p.x + 16, p.y + 10); }
      });
      // click mapping stored for ui
      cv._radarMap = { cx: cx, cy: cy, R: R, rangeM: rangeM };
    }
  };
})();
