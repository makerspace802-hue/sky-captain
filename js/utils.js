/* ============================================================
   SC.Utils — math, geo, formatting, DOM helpers.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils = {};

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.deg2rad = function (d) { return d * Math.PI / 180; };
  U.rad2deg = function (r) { return r * 180 / Math.PI; };
  U.wrap360 = function (d) { d = d % 360; return d < 0 ? d + 360 : d; };
  // shortest signed angle difference a->b in degrees (-180..180)
  U.angDiff = function (a, b) { var d = U.wrap360(b - a); return d > 180 ? d - 360 : d; };
  U.rand = function (a, b) { return a + Math.random() * (b - a); };
  U.randInt = function (a, b) { return Math.floor(U.rand(a, b + 1)); };
  U.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  U.uid = function (p) { return (p || "id") + "-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); };

  // ---- geo ----
  var R_KM = 6371;
  U.haversineKm = function (lat1, lon1, lat2, lon2) {
    var dLa = U.deg2rad(lat2 - lat1), dLo = U.deg2rad(lon2 - lon1);
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(U.deg2rad(lat1)) * Math.cos(U.deg2rad(lat2)) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R_KM * Math.asin(Math.sqrt(a));
  };
  U.bearingDeg = function (lat1, lon1, lat2, lon2) {
    var dLo = U.deg2rad(lon2 - lon1);
    var y = Math.sin(dLo) * Math.cos(U.deg2rad(lat2));
    var x = Math.cos(U.deg2rad(lat1)) * Math.sin(U.deg2rad(lat2)) -
      Math.sin(U.deg2rad(lat1)) * Math.cos(U.deg2rad(lat2)) * Math.cos(dLo);
    return U.wrap360(U.rad2deg(Math.atan2(y, x)));
  };
  // great-circle interpolation, f in 0..1
  U.greatCircle = function (lat1, lon1, lat2, lon2, f) {
    var p1 = U.deg2rad(lat1), p2 = U.deg2rad(lat2), l1 = U.deg2rad(lon1), l2 = U.deg2rad(lon2);
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2)));
    if (d < 1e-9) return { lat: lat1, lon: lon1 };
    var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    var z = A * Math.sin(p1) + B * Math.sin(p2);
    return { lat: U.rad2deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: U.rad2deg(Math.atan2(y, x)) };
  };

  // ---- units ----
  U.kmh2kt = function (v) { return v * 0.539957; };
  U.kt2kmh = function (v) { return v * 1.852; };
  U.m2ft = function (v) { return v * 3.28084; };
  U.ft2m = function (v) { return v * 0.3048; };
  U.km2nm = function (v) { return v * 0.539957; };
  U.m2nm = function (v) { return v / 1852; };

  // ---- formatting ----
  U.fmtMoney = function (v) {
    var sym = (SC.Config && SC.Config.currencySymbol) || "$";
    var neg = v < 0; v = Math.abs(Math.round(v));
    return (neg ? "-" : "") + sym + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };
  U.fmtNum = function (v, dec) {
    v = Number(v); if (!isFinite(v)) return "—";
    return v.toLocaleString("en-US", { maximumFractionDigits: dec == null ? 0 : dec, minimumFractionDigits: dec == null ? 0 : dec });
  };
  U.fmtTimeHMS = function (sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + "h " + (m < 10 ? "0" : "") + m + "m";
    if (m > 0) return m + "m " + (s < 10 ? "0" : "") + s + "s";
    return s + "s";
  };
  U.fmtClockUTC = function (date) {
    date = date || new Date();
    var h = date.getUTCHours(), m = date.getUTCMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + " UTC";
  };
  U.fmtDist = function (km) {
    var units = "km";
    try { units = (SC.Game && SC.Game.settings && SC.Game.settings.units) || "km"; } catch (e) {}
    if (units === "nm") return U.fmtNum(U.km2nm(km), 0) + " nm";
    return U.fmtNum(km, 0) + " km";
  };
  U.stars = function (score) {
    score = U.clamp(score, 0, 5);
    var full = Math.round(score), s = "";
    for (var i = 0; i < 5; i++) s += i < full ? "★" : "☆";
    return s;
  };

  // ---- DOM ----
  U.$ = function (id) { return document.getElementById(id); };
  U.on = function (el, ev, fn) { if (el) el.addEventListener(ev, fn, false); };
  U.el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  U.escape = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  U.scrollBottom = function (el) { if (el) el.scrollTop = el.scrollHeight; };
})();
