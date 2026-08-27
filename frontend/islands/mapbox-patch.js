/* Global mapbox-gl shim for pages where oilib still runs its own maps (city pages,
 * filter pages, community lot maps). Two gaps break those maps after the scrape
 * rewrites: the O'Neill style URL is swapped to stock streets-v11 (wrong look) and
 * no style we can serve carries the green map_pin sprite icon (invisible pins).
 * Fix both at the constructor: swap stock-style maps to our captured Esperanza-Common
 * JSON, and answer styleimagemissing for map_pin from /map_pin.png. oilib keeps
 * doing everything else (clusters, popups, card hover) 1:1.
 * NB: the theme injects a SECOND mapbox-gl.js at runtime whose UMD assignment
 * replaces window.mapboxgl — so we own the global via an accessor and re-wrap
 * every assignment instead of patching once. */
(function () {
  'use strict';
  var styleObj = null, waiting = [];
  fetch('/esperanza-common.json').then(function (r) { return r.json(); }).then(function (s) {
    styleObj = s;
    waiting.forEach(function (m) { m.setStyle(styleObj); });
    waiting = [];
  }).catch(function () {});

  var isStock = function (s) { return typeof s === 'string' && s.indexOf('styles/mapbox/streets-v11') !== -1; };

  function wrap(gl) {
    if (!gl || !gl.Map || gl.__espPatched) return gl;
    gl.__espPatched = true;
    var Orig = gl.Map;
    gl.Map = function (opts) {
      opts = opts || {};
      var swap = isStock(opts.style);
      if (swap) { if (styleObj) opts.style = styleObj; else delete opts.style; }
      var m = new Orig(opts);
      if (swap && !styleObj) waiting.push(m);
      m.on('styleimagemissing', function (e) {
        if (e.id !== 'map_pin' && e.id !== 'mp_pin') return;
        m.loadImage('/' + e.id + '.png', function (err, img) {
          if (!err && img && !m.hasImage(e.id)) m.addImage(e.id, img, { pixelRatio: 2.5 }); // 90x120 -> 36x48 (matches original pin/cluster ratio)
        });
      });
      return m;
    };
    gl.Map.prototype = Orig.prototype;
    for (var k in Orig) if (Object.prototype.hasOwnProperty.call(Orig, k)) gl.Map[k] = Orig[k];
    return gl;
  }

  var cur = wrap(window.mapboxgl);
  try {
    Object.defineProperty(window, 'mapboxgl', {
      configurable: true,
      get: function () { return cur; },
      set: function (v) { cur = wrap(v); },
    });
  } catch (e) { /* non-configurable global: first-load patch already applied */ }
})();
