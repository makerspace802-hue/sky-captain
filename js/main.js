/* ============================================================
   SC.Main — bootstrap, loading, master game loop.
   ============================================================ */
(function () {
  "use strict";
  var SC = window.SC = window.SC || {};
  var U = SC.Utils;

  var Main = SC.Main = {
    _last: 0,

    boot: function () {
      var fill = U.$("load-fill"), txt = U.$("load-text"), p = 5;
      function step(to, label, fn) {
        return new Promise(function (res) {
          setTimeout(function () {
            try { if (fn) fn(); } catch (e) { console.error(e); }
            p = to; fill.style.width = p + "%"; txt.textContent = label;
            res();
          }, 60);
        });
      }
      var self = this;
      step(15, "Loading pilot records…", function () { SC.Game.init(); })
        .then(function () { return step(35, "Calibrating instruments…", function () { SC.Input.init(); }); })
        .then(function () { return step(55, "Building interface…", function () { SC.UI.init(); SC.UIFlight.init(); SC.UIATC.init(); }); })
        .then(function () { return step(75, "Spawning world traffic…", function () { SC.Traffic.init(); SC.Render.init("flight-canvas"); }); })
        .then(function () { return step(92, "Contacting tower…", function () { SC.WorldMap.draw(0.016); }); })
        .then(function () {
          return step(100, "Ready for departure ✈", function () {
            self._last = performance.now();
            requestAnimationFrame(function (t) { self.loop(t); });
            setTimeout(function () {
              U.$("loading-overlay").style.display = "none";
              SC.UI.show(SC.Save.hasProfile() ? "main" : "pilot");
            }, 250);
          });
        });
    },

    loop: function (t) {
      requestAnimationFrame(this.loop.bind(this));
      var dt = Math.min(0.1, (t - this._last) / 1000 || 0.016);
      this._last = t;
      try {
        SC.Save.tick(dt);
        if (SC.Game.state === "flight" && SC.Flight.cur) {
          SC.Flight.update(dt);
        } else {
          if (!SC.MP.connected) { /* lobby idle */ }
          SC.MP.tick(dt);
          if (SC.UI.current === "map") { SC.Traffic.update(dt * 10); SC.WorldMap.draw(dt); }
          else if (SC.UI.current === "multiplayer") { SC.Traffic.update(dt * 10); }
          else if (SC.UI.current === "atc") { SC.UIATC.tick(dt); }
        }
      } catch (e) { console.error(e); }
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { Main.boot(); });
  else Main.boot();
})();
