/* Input unificato: tastiera, swipe, puntatore e pulsanti a schermo.
   I giochi leggono sempre le stesse azioni: up/down/left/right/action. */
TG.input = (function () {
  'use strict';

  var ACTIONS = ['up', 'down', 'left', 'right', 'action'];
  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    Space: 'action', Enter: 'action'
  };
  var SWIPE_MIN = 24;      // px minimi per considerare uno swipe
  var QUEUE_MAX = 8;

  var down = {};
  var queue = [];
  var tapQueue = [];  // tap con coordinate logiche, per i giochi "a bersaglio"
  var digitQueue = []; // tasti 1-9, alternativa da tastiera ai tap
  var pointer = { x: 0, y: 0, down: false, inside: false, moved: false };

  var stageEl = null, canvasEl = null, controlsEl = null;
  var viewport = { w: 360, h: 480 };
  var touchStart = null;
  var enabled = false;

  function press(action) {
    if (ACTIONS.indexOf(action) < 0) return;
    down[action] = true;
    queue.push(action);
    if (queue.length > QUEUE_MAX) queue.shift();
  }

  function release(action) { down[action] = false; }

  function onKeyDown(e) {
    if (!enabled) return;
    var digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit && !e.repeat) {
      digitQueue.push(parseInt(digit[2], 10));
      if (digitQueue.length > QUEUE_MAX) digitQueue.shift();
    }
    var a = KEYMAP[e.code];
    if (!a) return;
    // Evita lo scroll della pagina con frecce/spazio mentre si gioca.
    e.preventDefault();
    if (e.repeat) return;
    press(a);
  }

  function onKeyUp(e) {
    var a = KEYMAP[e.code];
    if (a) release(a);
  }

  function toLogical(clientX, clientY) {
    var r = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - r.left) / r.width * viewport.w,
      y: (clientY - r.top) / r.height * viewport.h
    };
  }

  function onPointerDown(e) {
    if (!enabled) return;
    stageEl.setPointerCapture && stageEl.setPointerCapture(e.pointerId);
    var p = toLogical(e.clientX, e.clientY);
    pointer.x = p.x; pointer.y = p.y;
    pointer.down = true; pointer.inside = true; pointer.moved = false;
    touchStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  function onPointerMove(e) {
    if (!enabled) return;
    var p = toLogical(e.clientX, e.clientY);
    pointer.x = p.x; pointer.y = p.y;
    pointer.inside = true;
    if (touchStart) {
      var dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) pointer.moved = true;
    }
  }

  function onPointerUp(e) {
    if (!enabled) return;
    pointer.down = false;
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x;
    var dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
      var p = toLogical(e.clientX, e.clientY); // tap
      tapQueue.push({ x: p.x, y: p.y });
      if (tapQueue.length > QUEUE_MAX) tapQueue.shift();
      press('action');
      release('action');
      return;
    }
    var dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    press(dir);
    release(dir);
  }

  function bindHold(el, action) {
    var start = function (e) { e.preventDefault(); press(action); };
    var end = function (e) { e.preventDefault(); release(action); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  }

  function padButton(dir, label) {
    var b = document.createElement('button');
    b.className = 'pad__btn';
    b.dataset.dir = dir;
    b.textContent = label;
    b.setAttribute('aria-label', dir);
    bindHold(b, dir);
    return b;
  }

  /* Costruisce i comandi a schermo adatti al gioco corrente. */
  function setControls(kind, actionLabel) {
    if (!controlsEl) return;
    controlsEl.innerHTML = '';
    controlsEl.className = 'touch-controls';
    if (kind === 'none' || kind === 'pointer') { controlsEl.hidden = true; return; }
    controlsEl.hidden = false;

    if (kind === 'dpad' || kind === 'lr') {
      var pad = document.createElement('div');
      pad.className = 'pad';
      if (kind === 'dpad') {
        pad.appendChild(padButton('up', '▲'));
        pad.appendChild(padButton('left', '◀'));
        pad.appendChild(padButton('right', '▶'));
        pad.appendChild(padButton('down', '▼'));
      } else {
        controlsEl.classList.add('touch-controls--lr');
        pad.appendChild(padButton('left', '◀'));
        pad.appendChild(padButton('right', '▶'));
      }
      controlsEl.appendChild(pad);
    }

    // il pulsante azione compare solo se il gioco ne dichiara l'etichetta
    if (kind === 'action' || actionLabel) {
      var a = document.createElement('button');
      a.className = 'action-btn';
      a.textContent = actionLabel || 'OK';
      bindHold(a, 'action');
      controlsEl.appendChild(a);
    }
  }

  function init(opts) {
    stageEl = opts.stage;
    canvasEl = opts.canvas;
    controlsEl = opts.controls;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    stageEl.addEventListener('pointerdown', onPointerDown);
    stageEl.addEventListener('pointermove', onPointerMove);
    stageEl.addEventListener('pointerup', onPointerUp);
    stageEl.addEventListener('pointercancel', function () {
      pointer.down = false; touchStart = null;
    });
    stageEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function reset() {
    down = {};
    queue.length = 0;
    tapQueue.length = 0;
    digitQueue.length = 0;
    pointer.down = false;
    touchStart = null;
  }

  return {
    init: init,
    setControls: setControls,
    setViewport: function (w, h) { viewport = { w: w, h: h }; },
    setEnabled: function (v) { enabled = !!v; if (!enabled) reset(); },
    reset: reset,
    isDown: function (a) { return !!down[a]; },
    /* Coda degli input "premuti": ogni azione viene consumata una sola volta. */
    take: function () { return queue.length ? queue.shift() : null; },
    peekAll: function () { var q = queue.slice(); queue.length = 0; return q; },
    /* Tap sul campo, con coordinate nel sistema del gioco: {x, y} oppure null. */
    takeTap: function () { return tapQueue.length ? tapQueue.shift() : null; },
    /* Tasti 1-9: alternativa da tastiera ai tap. */
    takeDigit: function () { return digitQueue.length ? digitQueue.shift() : null; },
    pointer: pointer
  };
})();
