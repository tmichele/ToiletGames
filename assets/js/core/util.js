/* Namespace globale della suite. Niente moduli ES: così la pagina funziona
   anche aperta con doppio click (file://), senza server. */
var TG = window.TG || {};
window.TG = TG;

TG.util = (function () {
  'use strict';

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function randInt(min, max) { // estremi inclusi
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function randFloat(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  // Cerchio/rettangolo: usato da diversi giochi per le collisioni.
  function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    var nx = clamp(cx, rx, rx + rw);
    var ny = clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return {
    clamp: clamp,
    randInt: randInt,
    randFloat: randFloat,
    pick: pick,
    shuffle: shuffle,
    lerp: lerp,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    circleRectHit: circleRectHit,
    roundRect: roundRect
  };
})();
