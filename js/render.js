/* ============================================================
   SC.Render — pseudo-3D cockpit view renderer (Canvas 2D).
   Real perspective projection of runways/taxiways/traffic from
   aircraft attitude; day/night sky, weather, guidance, cockpit.
   No external assets. Quality-scaled for mobile.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  var R = SC.Render = {
    cv: null, cx: null, W: 0, H: 0,
    stars: [], puffs: [], patches: {}, t: 0,
    shakeX: 0, shakeY: 0,

    init: function (id) {
      this.cv = U.$(id); if (!this.cv) return;
      this.cx = this.cv.getContext("2d");
      for (var i = 0; i < 140; i++) this.stars.push({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.4 });
      for (var j = 0; j < 26; j++) this.puffs.push({ x: Math.random(), y: Math.random() * 0.7, s: 40 + Math.random() * 130, v: 2 + Math.random() * 6 });
      this.resize();
      var self = this;
      window.addEventListener("resize", function () { self.resize(); });
    },
    resize: function () {
      if (!this.cv) return;
      var q = (SC.Game.settings && SC.Game.settings.quality) || "medium";
      var dpr = q === "low" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      var r = this.cv.getBoundingClientRect();
      this.W = Math.max(320, r.width); this.H = Math.max(240, r.height);
      this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
      this.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    quality: function () { return (SC.Game.settings && SC.Game.settings.quality) || "medium"; },

    /* ---------- deterministic terrain patches per airport ---------- */
    _patches: function (code) {
      if (this.patches[code]) return this.patches[code];
      var seed = 0;
      for (var i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) >>> 0;
      function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
      var arr = [], desert = (code === "DXB");
      for (var k = 0; k < 170; k++) {
        var a = rnd() * 6.283, d = 500 + rnd() * 5200;
        var w = 120 + rnd() * 420, h = 90 + rnd() * 320, rot = rnd() * 3.14;
        var g = desert ? 165 + rnd() * 40 : 70 + rnd() * 70;
        arr.push({
          x: Math.cos(a) * d, z: Math.sin(a) * d, w: w, h: h, rot: rot,
          c: desert ? "rgb(" + Math.round(g + 40) + "," + Math.round(g) + "," + Math.round(g - 60) + ")"
            : (rnd() < 0.22 ? "rgb(112,118,128)" : "rgb(" + Math.round(g - 30) + "," + Math.round(g + 20) + "," + Math.round(g - 45) + ")")
        });
      }
      this.patches[code] = arr;
      return arr;
    },

    /* ================= MAIN DRAW ================= */
    draw: function (fl, dt) {
      if (!this.cx || !fl) return;
      this.t += dt;
      var ctx = this.cx, W = this.W, H = this.H, m = fl.model;
      var ll = SC.Flight.latLon(fl);
      var dl = SC.Time.daylight(ll.lon);           // 0 night .. 1 day
      var night = dl < 0.25, dusk = dl >= 0.25 && dl < 0.55;
      var fov = fl.camChase ? 62 : 72;
      var f = (H / 2) / Math.tan(U.deg2rad(fov / 2));
      var cx0 = W / 2, cy0 = H * 0.46;

      // camera basis
      var Hh = U.deg2rad(m.hdg), P = U.deg2rad(m.pitch), Rr = U.deg2rad(m.roll);
      var cP = Math.cos(P), sP = Math.sin(P), cR = Math.cos(Rr), sR = Math.sin(Rr);
      var F = { x: Math.sin(Hh) * cP, y: sP, z: -Math.cos(Hh) * cP };
      var R0 = { x: Math.cos(Hh), y: 0, z: Math.sin(Hh) };
      var U0 = { x: -Math.sin(Hh) * sP, y: cP, z: Math.cos(Hh) * sP };
      var Rv = { x: R0.x * cR - U0.x * sR, y: R0.y * cR - U0.y * sR, z: R0.z * cR - U0.z * sR };
      var Uv = { x: U0.x * cR + R0.x * sR, y: U0.y * cR + R0.y * sR, z: U0.z * cR + R0.z * sR };
      var eye;
      if (fl.camChase) {
        eye = { x: m.x - Math.sin(Hh) * 30, y: m.altFt * 0.3048 + 8, z: m.z + Math.cos(Hh) * 30 };
      } else eye = { x: m.x, y: m.altFt * 0.3048 + (m.onGround ? 3 : 2.2), z: m.z };
      // turbulence shake
      var sh = fl.wind.turb * (m.onGround ? 0 : 1) * 6 + (fl.stalled ? 5 : 0);
      this.shakeX = (Math.random() - 0.5) * sh; this.shakeY = (Math.random() - 0.5) * sh;

      function project(x, y, z) {
        var dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
        var Xc = dx * Rv.x + dy * Rv.y + dz * Rv.z;
        var Yc = dx * Uv.x + dy * Uv.y + dz * Uv.z;
        var Zc = dx * F.x + dy * F.y + dz * F.z;
        if (Zc < 1.5) return null;
        return { x: cx0 + Xc / Zc * f + R.shakeX, y: cy0 - Yc / Zc * f + R.shakeY, z: Zc };
      }

      /* ----- sky ----- */
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      if (night) { sky.addColorStop(0, "#020409"); sky.addColorStop(0.6, "#0a1628"); sky.addColorStop(1, "#12233f"); }
      else if (dusk) { sky.addColorStop(0, "#1c2f5e"); sky.addColorStop(0.45, "#7a4a6e"); sky.addColorStop(0.62, "#e8843c"); sky.addColorStop(1, "#3a3a55"); }
      else { sky.addColorStop(0, "#1f6fd6"); sky.addColorStop(0.55, "#7db8f2"); sky.addColorStop(0.75, "#c4e0fa"); sky.addColorStop(1, "#cfe6fa"); }
      // storm darkening
      if (fl.wind.cond === "storm" || fl.wind.cond === "rain") {
        sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, night ? "#020409" : "#3a4356"); sky.addColorStop(0.6, night ? "#0a1628" : "#6b768c"); sky.addColorStop(1, night ? "#12233f" : "#9aa5b5");
      }
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

      // stars
      if (night) {
        ctx.fillStyle = "#fff";
        for (var si = 0; si < this.stars.length; si++) {
          var st = this.stars[si];
          ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(this.t * 0.7 + si));
          ctx.fillRect(st.x * W, st.y * H * 0.6, st.s, st.s);
        }
        ctx.globalAlpha = 1;
      }
      // sun / moon
      this._sunMoon(ctx, project, fl, ll, W, H, night, dusk);

      /* ----- horizon + ground ----- */
      var dip = 3.1 * Math.sqrt(Math.max(0, m.altFt * 0.3048) / 10000);
      var pitchEff = m.pitch - dip;
      ctx.save();
      ctx.translate(cx0, cy0); ctx.rotate(-U.deg2rad(m.roll)); ctx.translate(-cx0, -cy0);
      var hy = cy0 + Math.tan(U.deg2rad(U.clamp(pitchEff, -60, 60))) * f;
      var enroute = fl.sceneMode === "ENROUTE";
      var gg = ctx.createLinearGradient(0, hy, 0, H + 400);
      if (enroute) {
        if (night) { gg.addColorStop(0, "#0b1526"); gg.addColorStop(1, "#060b16"); }
        else if (dusk) { gg.addColorStop(0, "#8a6a7a"); gg.addColorStop(1, "#4a3a55"); }
        else { gg.addColorStop(0, "#e8f1fb"); gg.addColorStop(1, "#9fc0e8"); }
      } else {
        var desert = fl.activeF.code === "DXB";
        if (night) { gg.addColorStop(0, "#0a1424"); gg.addColorStop(1, "#04070e"); }
        else if (dusk) { gg.addColorStop(0, desert ? "#8a6a4a" : "#5a6a5a"); gg.addColorStop(1, desert ? "#4a3a2a" : "#2a3a2a"); }
        else { gg.addColorStop(0, desert ? "#d9bd8a" : "#8aa86a"); gg.addColorStop(1, desert ? "#b08d55" : "#5a7a4a"); }
      }
      ctx.fillStyle = gg;
      ctx.fillRect(-W, hy, W * 3, H * 3);
      // haze band at horizon
      ctx.fillStyle = night ? "rgba(20,30,55,0.5)" : "rgba(230,240,250,0.45)";
      ctx.fillRect(-W, hy - 14, W * 3, 26);
      ctx.restore();

      if (!enroute) {
        this._groundDetail(ctx, project, fl, W, H, night, dusk);
        this._airfield(ctx, project, fl, night);
        this._patternTraffic(ctx, project, fl, night);
      } else {
        this._cloudDeck(ctx, fl, W, H, hy, night, dusk);
        this._enrouteTraffic(ctx, project, fl, ll);
      }

      // guidance diamond + ILS
      this._guidance(ctx, project, fl, W, H, cx0, cy0);

      /* ----- weather overlays ----- */
      this._weatherFx(ctx, fl, W, H, night);

      /* ----- clouds (2D puffs) ----- */
      this._clouds(ctx, fl, W, H, night);

      /* ----- cockpit / chase frame ----- */
      if (!fl.camChase) this._cockpit(ctx, W, H, night);
      else this._chasePlane(ctx, cx0, cy0, m, night);

      // fog overlay by visibility
      var vis = fl.wind.visKm;
      if (vis < 12) {
        ctx.fillStyle = night ? "rgba(10,16,30," + (0.55 * (1 - vis / 12)) + ")" : "rgba(210,220,235," + (0.6 * (1 - vis / 12)) + ")";
        ctx.fillRect(0, 0, W, H);
      }
      // vignette
      var vg = ctx.createRadialGradient(cx0, cy0, H * 0.35, cx0, cy0, H * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,10,0.42)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

      // crash fire flash
      if (fl.phase === "CRASHED") {
        ctx.fillStyle = "rgba(200,40,10," + (0.25 + 0.15 * Math.sin(this.t * 9)) + ")";
        ctx.fillRect(0, 0, W, H);
      }
    },

    _sunMoon: function (ctx, project, fl, ll, W, H, night, dusk) {
      var utcH = SC.Time.simMin / 60, solarNoon = 12 - ll.lon / 15;
      var ha = (utcH - solarNoon) * 15;
      var alt = SC.Time.sunAlt(ll.lon);
      var az = U.wrap360(180 + ha);
      var rel = U.deg2rad(U.angDiff(fl.model.hdg, az));
      var e = U.deg2rad(alt);
      // project direction
      var Xc = Math.sin(rel) * Math.cos(e), Yc = Math.sin(e), Zc = Math.cos(rel) * Math.cos(e);
      if (Zc > 0.05 && alt > -8) {
        var f = (H / 2) / Math.tan(U.deg2rad(72 / 2));
        var sx = W / 2 + Xc / Zc * f, sy = H * 0.46 - Yc / Zc * f;
        if (sx > -80 && sx < W + 80 && sy > -80 && sy < H + 80) {
          var r = dusk ? 34 : 26;
          var g = ctx.createRadialGradient(sx, sy, 2, sx, sy, r * 3);
          var col = dusk ? "255,140,60" : "255,240,200";
          g.addColorStop(0, "rgba(" + col + ",0.95)"); g.addColorStop(0.25, "rgba(" + col + ",0.55)"); g.addColorStop(1, "rgba(" + col + ",0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, 6.29); ctx.fill();
          ctx.fillStyle = dusk ? "#ff9a4c" : "#fff6dd";
          ctx.beginPath(); ctx.arc(sx, sy, r * 0.7, 0, 6.29); ctx.fill();
        }
      }
      if (night) { // moon opposite-ish
        var mx = W * 0.78, my = H * 0.16;
        ctx.fillStyle = "#e8ecff"; ctx.beginPath(); ctx.arc(mx, my, 16, 0, 6.29); ctx.fill();
        ctx.fillStyle = "rgba(2,4,9,0.55)"; ctx.beginPath(); ctx.arc(mx - 6, my - 3, 13, 0, 6.29); ctx.fill();
      }
    },

    _groundDetail: function (ctx, project, fl, W, H, night) {
      var patches = this._patches(fl.activeF.code);
      var q = this.quality(), n = q === "low" ? 45 : q === "medium" ? 95 : 150;
      ctx.save();
      for (var i = 0; i < Math.min(n, patches.length); i++) {
        var p = patches[i];
        // rotate rect corners
        var cs = Math.cos(p.rot), sn = Math.sin(p.rot), hw = p.w / 2, hh = p.h / 2;
        var pts = [];
        var corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        var ok = true;
        for (var k = 0; k < 4; k++) {
          var lx = p.x + corners[k][0] * cs - corners[k][1] * sn;
          var lz = p.z + corners[k][0] * sn + corners[k][1] * cs;
          var pr = project(lx, 0.5, lz);
          if (!pr || pr.x < -300 || pr.x > W + 300 || pr.y < -200 || pr.y > H + 200) { if (!pr) { ok = false; break; } }
          pts.push(pr || { x: -9999, y: -9999 });
        }
        if (!ok) continue;
        ctx.fillStyle = night ? "rgba(16,24,40,0.9)" : p.c;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var j = 1; j < 4; j++) ctx.lineTo(pts[j].x, pts[j].y);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // city lights at night: sprinkles near airport
      if (night) {
        ctx.fillStyle = "rgba(255,200,120,0.8)";
        for (var s = 0; s < 60; s++) {
          var a = (s * 2.399) % 6.283, d = 900 + (s * 173) % 3800;
          var pr2 = project(Math.cos(a) * d, 2, Math.sin(a) * d);
          if (pr2 && pr2.x > 0 && pr2.x < W && pr2.y > 0 && pr2.y < H) ctx.fillRect(pr2.x, pr2.y, 2, 2);
        }
      }
    },

    _poly: function (ctx, project, pts3, style, stroke) {
      var pts = [];
      for (var i = 0; i < pts3.length; i++) {
        var pr = project(pts3[i][0], pts3[i][1], pts3[i][2]);
        if (!pr) return;
        pts.push(pr);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.closePath();
      if (style) { ctx.fillStyle = style; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    },

    _airfield: function (ctx, project, fl, night) {
      var A = fl.activeF;
      // infield grass
      this._poly(ctx, project, [
        [A.corners[0].x - A.perp.x * 260 - A.dir.x * 200, 0.4, A.corners[0].z - A.perp.z * 260 - A.dir.z * 200],
        [A.corners[1].x - A.perp.x * 260 + A.dir.x * 200, 0.4, A.corners[1].z - A.perp.z * 260 + A.dir.z * 200],
        [A.corners[2].x + A.perp.x * 260 + A.dir.x * 200, 0.4, A.corners[2].z + A.perp.z * 260 + A.dir.z * 200],
        [A.corners[3].x + A.perp.x * 260 - A.dir.x * 200, 0.4, A.corners[3].z + A.perp.z * 260 - A.dir.z * 200]
      ], night ? "#0d1626" : "#6f9a52");
      // apron near gates
      var g0 = A.gates[0], g1 = A.gates[A.gates.length - 1];
      this._poly(ctx, project, [
        [g0.x - A.dir.x * 130 - A.perp.x * 145, 0.6, g0.z - A.dir.z * 130 - A.perp.z * 145],
        [g1.x + A.dir.x * 130 - A.perp.x * 145, 0.6, g1.z + A.dir.z * 130 - A.perp.z * 145],
        [g1.x + A.dir.x * 130 + A.perp.x * 60, 0.6, g1.z + A.dir.z * 130 + A.perp.z * 60],
        [g0.x - A.dir.x * 130 + A.perp.x * 60, 0.6, g0.z - A.dir.z * 130 + A.perp.z * 60]
      ], night ? "#141c2e" : "#8b93a0");
      // taxiway strip
      function strip(p1, p2, wdt, y, style) {
        var dx = p2.x - p1.x, dz = p2.z - p1.z, L = Math.hypot(dx, dz);
        var nx = -dz / L * wdt / 2, nz = dx / L * wdt / 2;
        R._poly(ctx, project, [[p1.x + nx, y, p1.z + nz], [p2.x + nx, y, p2.z + nz], [p2.x - nx, y, p2.z - nz], [p1.x - nx, y, p1.z - nz]], style);
      }
      strip(A.taxiA, A.taxiB, 24, 0.7, night ? "#161e30" : "#7c8492");
      // connectors: entry->hold->lineup
      strip(A.entry, A.hold, 20, 0.7, night ? "#161e30" : "#7c8492");
      strip(A.hold, A.lineup, 20, 0.7, night ? "#161e30" : "#7c8492");
      // taxi centerline (yellow)
      ctx.strokeStyle = night ? "rgba(200,180,80,0.9)" : "#d8b93c";
      ctx.lineWidth = 2;
      var t1 = project(A.taxiA.x, 1, A.taxiA.z), t2 = project(A.taxiB.x, 1, A.taxiB.z);
      if (t1 && t2) { ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke(); }
      // taxi-to-gate guidance line (own route, cyan)
      var m = fl.model;
      if (fl.phase === "TAXI_OUT" || fl.phase === "HOLD_SHORT" || fl.phase === "TAXI_IN") {
        var tgt = fl.phase === "TAXI_IN" && fl.fixes.length ? fl.fixes[0] : A.hold;
        var a = project(m.x, 1.2, m.z), b = project((m.x + tgt.x) / 2, 1.2, (m.z + tgt.z) / 2), c = project(tgt.x, 1.2, tgt.z);
        if (a && c) {
          ctx.strokeStyle = "rgba(80,220,255,0.85)"; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y);
          if (b) ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      // hold-short bars
      var hb1 = project(A.hold.x - A.dir.x * 10, 1, A.hold.z - A.dir.z * 10);
      var hb2 = project(A.hold.x + A.dir.x * 10, 1, A.hold.z + A.dir.z * 10);
      if (hb1 && hb2) {
        ctx.strokeStyle = "#e8c83c"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(hb1.x, hb1.y); ctx.lineTo(hb2.x, hb2.y); ctx.stroke();
      }
      // runway
      this._poly(ctx, project, [
        [A.corners[0].x, 0.8, A.corners[0].z], [A.corners[1].x, 0.8, A.corners[1].z],
        [A.corners[2].x, 0.8, A.corners[2].z], [A.corners[3].x, 0.8, A.corners[3].z]
      ], night ? "#1a2233" : "#3c414c", "#e8e8e8");
      // centerline dashes
      ctx.fillStyle = night ? "#cfd6ff" : "#f2f2f2";
      for (var s = -A.len / 2 + 80; s < A.len / 2 - 40; s += 60) {
        var p1 = project(A.thr.x + A.dir.x * (s + A.len / 2) * 0 + A.dir.x * (s + A.len / 2) - A.dir.x * 0, 0, 0); // placeholder
        // compute along-point properly:
        var ax = A.thr.x + A.dir.x * (s + A.len / 2), az = A.thr.z + A.dir.z * (s + A.len / 2);
        var d1 = project(ax, 1, az), d2 = project(ax + A.dir.x * 24, 1, az + A.dir.z * 24);
        if (d1 && d2) { ctx.strokeStyle = night ? "#cfd6ff" : "#f2f2f2"; ctx.lineWidth = Math.max(1, 900 / d1.z); ctx.beginPath(); ctx.moveTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.stroke(); }
      }
      // threshold piano keys
      for (var tk = 0; tk < 2; tk++) {
        var base = tk === 0 ? A.thr : A.far, sgn = tk === 0 ? 1 : -1;
        for (var stripe = -3; stripe <= 3; stripe++) {
          if (stripe === 0) continue;
          var cxp = base.x + A.dir.x * sgn * 30 + A.perp.x * stripe * 5;
          var czp = base.z + A.dir.z * sgn * 30 + A.perp.z * stripe * 5;
          var q1 = project(cxp - A.dir.x * sgn * 12, 1, czp - A.dir.z * sgn * 12);
          var q2 = project(cxp + A.dir.x * sgn * 12, 1, czp + A.dir.z * sgn * 12);
          if (q1 && q2) { ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, 700 / q1.z); ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke(); }
        }
      }
      // runway designator
      var des = project(A.thr.x + A.dir.x * 90, 1, A.thr.z + A.dir.z * 90);
      if (des && des.z < 2500) {
        ctx.fillStyle = "#fff"; ctx.font = "bold " + Math.max(10, Math.min(46, 26000 / des.z)) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(SC.Airfield.rwyName(A.hdg), des.x, des.y);
      }
      // edge lights at night + approach flashers
      if (night) {
        for (var e = -A.len / 2; e <= A.len / 2; e += 120) {
          for (var side = -1; side <= 1; side += 2) {
            var ex = A.dir.x * e + A.perp.x * side * (A.w / 2 + 2), ez = A.dir.z * e + A.perp.z * side * (A.w / 2 + 2);
            var ep = project(ex, 1.5, ez);
            if (ep) { ctx.fillStyle = "#fff8d8"; ctx.fillRect(ep.x - 1.5, ep.y - 1.5, 3, 3); }
          }
        }
        // green threshold / red end
        var th = project(A.thr.x, 1.5, A.thr.z);
        if (th) { ctx.fillStyle = "#3ddc84"; ctx.fillRect(th.x - 6, th.y - 2, 12, 4); }
      }
      // approach light rabbits (arrival runway)
      if (fl.sceneMode === "LOCAL_ARR" || (fl.mode === "lesson" && fl.lessonId === "T4")) {
        for (var rb = 1; rb <= 8; rb++) {
          var bx = A.thr.x - A.dir.x * rb * 90, bz = A.thr.z - A.dir.z * rb * 90;
          var bp = project(bx, 2, bz);
          if (bp) {
            var seq = ((this.t * 3 | 0) + rb) % 8 === 0;
            ctx.fillStyle = seq ? "#ffffff" : "rgba(255,255,255,0.55)";
            var bs = Math.max(2, Math.min(9, 3000 / bp.z));
            ctx.fillRect(bp.x - bs / 2, bp.y - bs / 4, bs, bs / 2);
          }
        }
        // PAPI
        var papi = project(A.thr.x + A.dir.x * 220 + A.perp.x * 28, 2, A.thr.z + A.dir.z * 220 + A.perp.z * 28);
        if (papi) {
          var dThr = Math.hypot(m.x - A.thr.x, m.z - A.thr.z);
          var glide = dThr * Math.tan(U.deg2rad(3)) * 3.28084;
          var err = m.altFt - glide;
          for (var pi = 0; pi < 4; pi++) {
            ctx.fillStyle = err > (pi - 1.5) * 40 ? "#ff4444" : "#ffffff";
            ctx.beginPath(); ctx.arc(papi.x + pi * 9 - 13, papi.y, 4, 0, 6.29); ctx.fill();
          }
        }
      }
      // taxiway blue lights at night
      if (night) {
        ctx.fillStyle = "#3c78ff";
        for (var tl = 0; tl <= 10; tl++) {
          var lx = A.taxiA.x + (A.taxiB.x - A.taxiA.x) * tl / 10, lz = A.taxiA.z + (A.taxiB.z - A.taxiA.z) * tl / 10;
          var lp = project(lx, 1.5, lz);
          if (lp) ctx.fillRect(lp.x - 1.5, lp.y - 1.5, 3, 3);
        }
      }
      // terminal + tower boxes
      this._box(ctx, project, g0.x + A.perp.x * 60 - A.dir.x * 40, g0.z + A.perp.z * 60 - A.dir.z * 40, 130, 16, 40, A.hdg, night ? "#1c2740" : "#b9c2cf", night);
      this._box(ctx, project, g0.x + A.perp.x * 120 + A.dir.x * 60, g0.z + A.perp.z * 120 + A.dir.z * 60, 14, 42, 14, A.hdg, night ? "#24304a" : "#9aa5b5", night);
      // parked aircraft silhouettes at gates
      for (var gi = 0; gi < A.gates.length; gi += 3) {
        if (gi === fl.gate && fl.sceneMode === "LOCAL_DEP") continue;
        var gp2 = project(A.gates[gi].x, 3, A.gates[gi].z);
        if (gp2 && gp2.z < 1200) {
          var gs = U.clamp(9000 / gp2.z, 4, 60);
          ctx.fillStyle = night ? "#2a3a55" : "#dfe6f2";
          ctx.fillRect(gp2.x - gs / 2, gp2.y - gs / 6, gs, gs / 3);
          ctx.fillRect(gp2.x - gs / 10, gp2.y - gs / 3, gs / 5, gs / 1.5);
          if (night && ((this.t * 1.2 + gi) % 2 < 0.2)) { ctx.fillStyle = "#ff4444"; ctx.fillRect(gp2.x, gp2.y - gs / 3, 3, 3); }
        }
      }
      // windsock
      var ws = project(A.thr.x + A.perp.x * -60, 8, A.thr.z + A.perp.z * -60);
      if (ws && ws.z < 1500) {
        ctx.strokeStyle = "#ccc"; ctx.lineWidth = 2;
        var wb = project(A.thr.x + A.perp.x * -60, 0, A.thr.z + A.perp.z * -60);
        if (wb) { ctx.beginPath(); ctx.moveTo(wb.x, wb.y); ctx.lineTo(ws.x, ws.y); ctx.stroke(); }
        ctx.fillStyle = "#ff7a2c";
        ctx.fillRect(ws.x, ws.y - 3, U.clamp(300 / ws.z * fl.wind.windKt, 4, 30), 6);
      }
    },

    _box: function (ctx, project, x, z, w, h, dpt, hdg, color, night) {
      var Hr = U.deg2rad(hdg);
      var dx = Math.sin(Hr), dz = -Math.cos(Hr), px = Math.cos(Hr), pz = Math.sin(Hr);
      function corner(ax, yy, az) { return [x + dx * ax + px * az, yy, z + dz * ax + pz * az]; }
      // front face + top
      this._poly(ctx, project, [corner(-w / 2, 0, -dpt / 2), corner(w / 2, 0, -dpt / 2), corner(w / 2, h, -dpt / 2), corner(-w / 2, h, -dpt / 2)], color);
      this._poly(ctx, project, [corner(-w / 2, h, -dpt / 2), corner(w / 2, h, -dpt / 2), corner(w / 2, h, dpt / 2), corner(-w / 2, h, dpt / 2)], night ? "#2a3a58" : "#8a94a6");
      if (night) { // lit windows strip
        var w1 = project(x - w / 3, h * 0.6, z), w2 = project(x + w / 3, h * 0.6, z);
        if (w1 && w2) { ctx.strokeStyle = "rgba(255,210,130,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w1.x, w1.y); ctx.lineTo(w2.x, w2.y); ctx.stroke(); }
      }
    },

    _patternTraffic: function (ctx, project, fl, night) {
      var pat = SC.Traffic.pattern;
      if (!pat || pat.code !== fl.activeF.code) return;
      var pp = SC.Traffic.patternPos(fl.activeF.len);
      // pattern frame is runway-aligned; convert to world x/z
      var A = fl.activeF;
      var wx = A.dir.x * pp.x + A.perp.x * pp.z, wz = A.dir.z * pp.x + A.perp.z * pp.z;
      var pr = project(wx, pp.y, wz);
      if (!pr || pr.z > 6000) return;
      var s = U.clamp(6000 / pr.z, 3, 42);
      ctx.fillStyle = night ? "#cfd6ff" : "#f4f7ff";
      ctx.save(); ctx.translate(pr.x, pr.y);
      ctx.fillRect(-s / 2, -s / 8, s, s / 4);
      ctx.fillRect(-s / 8, -s / 2, s / 4, s);
      ctx.restore();
      if (((this.t * 1.4) % 1.6) < 0.15) { ctx.fillStyle = "#ff3333"; ctx.beginPath(); ctx.arc(pr.x, pr.y - s / 2, 2.5, 0, 6.29); ctx.fill(); }
      if (pr.z < 2500) {
        ctx.fillStyle = "rgba(180,220,255,0.9)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
        ctx.fillText(pat.cs, pr.x, pr.y - s / 2 - 6);
      }
    },

    _cloudDeck: function (ctx, fl, W, H, hy, night, dusk) {
      // puffy deck below horizon drifting with speed
      ctx.save();
      var n = this.quality() === "low" ? 10 : 22;
      for (var i = 0; i < n; i++) {
        var px = ((i * 197.3 + this.t * (8 + fl.model.tasKt * 0.02)) % (W + 400)) - 200;
        var py = hy + 30 + ((i * 89.7) % Math.max(60, H - hy - 40));
        var r = 40 + (i * 53) % 90;
        ctx.fillStyle = night ? "rgba(24,34,56,0.85)" : dusk ? "rgba(214,150,150,0.8)" : "rgba(255,255,255,0.85)";
        ctx.beginPath(); ctx.ellipse(px, py, r * 1.8, r * 0.5, 0, 0, 6.29); ctx.fill();
        ctx.fillStyle = night ? "rgba(14,20,36,0.5)" : "rgba(160,190,220,0.35)";
        ctx.beginPath(); ctx.ellipse(px + 20, py + 12, r * 1.5, r * 0.35, 0, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    },

    _enrouteTraffic: function (ctx, project, fl, ll) {
      var own = ll;
      ctx.font = "11px monospace"; ctx.textAlign = "center";
      var list = SC.Traffic.planes.slice(0, 6);
      for (var i = 0; i < list.length; i++) {
        var p = list[i], pos = SC.Traffic.posOf(p);
        var distKm = U.haversineKm(own.lat, own.lon, pos.lat, pos.lon);
        if (distKm > 220) continue;
        var brg = U.bearingDeg(own.lat, own.lon, pos.lat, pos.lon);
        var rel = U.deg2rad(U.angDiff(fl.model.hdg, brg));
        var dAltM = (p.altFt - fl.model.altFt) * 0.3048, dM = distKm * 1000;
        var el = Math.atan2(dAltM, dM);
        var Xc = Math.sin(rel) * Math.cos(el), Yc = Math.sin(el), Zc = Math.cos(rel) * Math.cos(el);
        if (Zc < 0.1) continue;
        var f = (this.H / 2) / Math.tan(U.deg2rad(72 / 2));
        var sx = this.W / 2 + Xc / Zc * f, sy = this.H * 0.46 - Yc / Zc * f;
        if (sx < 0 || sx > this.W || sy < 0 || sy > this.H) continue;
        var s = U.clamp(9000 / dM, 2, 14);
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx - s / 2, sy - 1, s, 2.5);
        ctx.fillStyle = "rgba(160,210,255,0.95)";
        ctx.fillText(p.cs + " " + Math.round(p.altFt / 100), sx, sy - 8);
      }
    },

    _guidance: function (ctx, project, fl, W, H, cx0, cy0) {
      var m = fl.model;
      // flight director diamond to active fix
      if (fl.fixIdx < fl.fixes.length && !m.onGround) {
        var fx = fl.fixes[fl.fixIdx];
        var fy = fx.alt != null ? fx.alt * 0.3048 : Math.max(60, m.altFt * 0.3048 * 0.5);
        var pr = project(fx.x, fy, fx.z);
        if (pr && pr.z < 30000) {
          var pulse = 10 + 3 * Math.sin(this.t * 4);
          ctx.strokeStyle = "rgba(255,80,220,0.95)"; ctx.lineWidth = 2.5;
          ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(Math.PI / 4);
          ctx.strokeRect(-pulse / 2, -pulse / 2, pulse, pulse);
          ctx.restore();
          ctx.fillStyle = "rgba(255,120,230,0.9)"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
          var dKm = Math.hypot(m.x - fx.x, m.z - fx.z) / 1000;
          ctx.fillText(fx.n + " " + dKm.toFixed(1) + "km", pr.x, pr.y - 14);
        }
      }
      // ILS cross on final
      if ((fl.phase === "FINAL" || fl.phase === "APPROACH") && !m.onGround && fl.sceneMode !== "ENROUTE") {
        var A = fl.activeF, al = A.alongLat(m.x, m.z);
        var dThr = Math.hypot(m.x - A.thr.x, m.z - A.thr.z);
        var glideFt = dThr * Math.tan(U.deg2rad(3)) * 3.28084;
        var latDev = U.clamp(al.lat / 120, -1, 1), vertDev = U.clamp((m.altFt - glideFt) / 350, -1, 1);
        var gx = cx0, gy = cy0 + 40, L = 120;
        ctx.strokeStyle = "rgba(120,200,255,0.75)"; ctx.lineWidth = 2;
        ctx.strokeRect(gx - L / 2, gy - L / 2, L, L);
        ctx.strokeStyle = "#50dcff"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(gx + latDev * L / 2, gy - 18); ctx.lineTo(gx + latDev * L / 2, gy + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx - 18, gy + vertDev * L / 2); ctx.lineTo(gx + 18, gy + vertDev * L / 2); ctx.stroke();
        ctx.fillStyle = "#9fdcff"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("ILS " + fl.arrRwy, gx, gy + L / 2 + 14);
      }
      // center flight-path marker
      ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx0, cy0, 7, 0, 6.29); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx0 - 16, cy0); ctx.lineTo(cx0 - 7, cy0); ctx.moveTo(cx0 + 7, cy0); ctx.lineTo(cx0 + 16, cy0); ctx.stroke();
    },

    _weatherFx: function (ctx, fl, W, H, night) {
      var cond = fl.wind.cond;
      if (cond === "rain" || cond === "storm") {
        var n = this.quality() === "low" ? 60 : 140;
        ctx.strokeStyle = cond === "storm" ? "rgba(180,200,230,0.5)" : "rgba(170,195,225,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var x = (i * 97.7 + this.t * 60) % W, y = (i * 57.3 + this.t * 900) % H;
          ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14);
        }
        ctx.stroke();
        if (cond === "storm" && Math.random() < 0.012) {
          ctx.fillStyle = "rgba(220,230,255,0.5)"; ctx.fillRect(0, 0, W, H);
        }
      }
      if (cond === "fog") {
        var g = ctx.createLinearGradient(0, H * 0.3, 0, H);
        g.addColorStop(0, "rgba(200,210,225,0)"); g.addColorStop(1, "rgba(200,210,225,0.55)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    },

    _clouds: function (ctx, fl, W, H, night) {
      var cover = { clear: 0.25, clouds: 0.7, rain: 0.85, storm: 1, fog: 0.4 }[fl.wind.cond] || 0.5;
      var n = Math.floor(this.puffs.length * cover * (this.quality() === "low" ? 0.5 : 1));
      ctx.save();
      for (var i = 0; i < n; i++) {
        var p = this.puffs[i];
        var x = ((p.x * W + this.t * p.v * (1 + fl.model.tasKt * 0.01) * (i % 2 ? 1 : -0.6)) % (W + 300) + W + 300) % (W + 300) - 150;
        var y = p.y * H * 0.75 + H * 0.05;
        var grd = ctx.createRadialGradient(x, y, 4, x, y, p.s);
        var base = night ? "20,28,48" : fl.wind.cond === "storm" ? "70,78,95" : "255,255,255";
        grd.addColorStop(0, "rgba(" + base + "," + (night ? 0.5 : 0.75) + ")");
        grd.addColorStop(1, "rgba(" + base + ",0)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(x, y, p.s * 1.7, p.s * 0.55, 0, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    },

    _cockpit: function (ctx, W, H, night) {
      // glareshield
      var g = ctx.createLinearGradient(0, H * 0.78, 0, H);
      g.addColorStop(0, night ? "#0c1220" : "#232b3a"); g.addColorStop(1, night ? "#05080f" : "#141a26");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, H); ctx.lineTo(0, H * 0.86); ctx.quadraticCurveTo(W * 0.5, H * 0.74, W, H * 0.86);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = night ? "#1c2942" : "#3a4356"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, H * 0.86); ctx.quadraticCurveTo(W * 0.5, H * 0.74, W, H * 0.86); ctx.stroke();
      // pillars
      ctx.fillStyle = night ? "#080c16" : "#1a2130";
      ctx.save();
      ctx.translate(W * 0.16, 0); ctx.rotate(0.1); ctx.fillRect(-14, -20, 28, H * 0.9);
      ctx.restore(); ctx.save();
      ctx.translate(W * 0.84, 0); ctx.rotate(-0.1); ctx.fillRect(-14, -20, 28, H * 0.9);
      ctx.restore();
      // standby glow strip
      ctx.fillStyle = night ? "rgba(80,160,255,0.25)" : "rgba(80,160,255,0.12)";
      ctx.fillRect(W * 0.3, H * 0.885, W * 0.4, 5);
    },

    _chasePlane: function (ctx, cx0, cy0, m, night) {
      ctx.save();
      ctx.translate(cx0, cy0 + 60); ctx.rotate(U.deg2rad(m.roll) * 0.4);
      var s = 46;
      ctx.fillStyle = night ? "#33415e" : "#e8edf5";
      ctx.beginPath(); // fuselage
      ctx.ellipse(0, 0, s * 0.16, s * 0.75, 0, 0, 6.29); ctx.fill();
      ctx.fillRect(-s * 0.95, -s * 0.08, s * 1.9, s * 0.16); // wings
      ctx.fillRect(-s * 0.3, -s * 0.72, s * 0.6, s * 0.2);   // tail
      ctx.fillStyle = "#e8b64c"; ctx.fillRect(-s * 0.1, s * 0.45, s * 0.2, s * 0.12);
      // nav lights
      var bl = (this.t % 1.2) < 0.15;
      if (bl) { ctx.fillStyle = "#ff3333"; ctx.beginPath(); ctx.arc(-s * 0.95, 0, 3, 0, 6.29); ctx.fill(); }
      ctx.fillStyle = "#3ddc84"; ctx.beginPath(); ctx.arc(s * 0.95, 0, 2.5, 0, 6.29); ctx.fill();
      ctx.restore();
    }
  };
})();
