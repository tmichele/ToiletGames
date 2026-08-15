/* Motore comune: canvas, ciclo di gioco, punteggio, livelli.
   Il singolo gioco pensa solo alla propria logica; avanzamento di livello,
   pausa, game over e classifica sono gestiti qui. */
TG.engine = (function () {
  'use strict';

  var MAX_DT = 0.05; // s: evita salti enormi dopo una pausa/tab in background

  var canvas = null, ctx = null, stage = null;
  var def = null, instance = null, api = null;
  var state = 'idle'; // idle | ready | running | paused | levelclear | over
  var level = 1, score = 0, livelloIniziale = 1;
  var lastTime = 0, rafId = 0;
  var view = { w: 360, h: 480 };
  var listeners = {};

  function emit(name, payload) {
    (listeners[name] || []).forEach(function (fn) { fn(payload); });
  }

  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  }

  /* ---------- dimensionamento ---------- */

  /* Il campo occupa tutto lo spazio che gli lascia la pagina, mantenendo le
     proporzioni del gioco: si sceglie il fattore che sta dentro sia in
     larghezza sia in altezza. Prima si scalava solo sulla larghezza, e su
     schermi bassi il canvas usciva dallo schermo. */
  function resize() {
    if (!canvas) return;
    var boxW = stage.clientWidth || 320;
    var boxH = stage.clientHeight || Math.round(boxW * view.h / view.w);
    var scala = Math.min(boxW / view.w, boxH / view.h);
    if (!isFinite(scala) || scala <= 0) scala = boxW / view.w;

    var cssW = Math.max(1, Math.floor(view.w * scala));
    var cssH = Math.max(1, Math.floor(view.h * scala));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var s = canvas.width / view.w;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = true;
    draw();
  }

  /* ---------- ciclo ---------- */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;
    if (state === 'running' && instance && instance.update) {
      instance.update(dt);
    }
    draw();
  }

  function draw() {
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, view.w, view.h);
    if (instance && instance.draw) instance.draw(ctx);
    ctx.restore();
  }

  function startLoop() {
    if (rafId) return;
    lastTime = window.performance.now();
    rafId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (!rafId) return;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---------- API esposta ai giochi ---------- */

  function makeApi() {
    return {
      width: view.w,
      height: view.h,
      util: TG.util,
      sfx: TG.sfx,
      input: TG.input,
      get level() { return level; },
      get score() { return score; },
      addScore: function (n) {
        score = Math.max(0, score + Math.round(n || 0));
        emit('score', score);
      },
      setScore: function (n) {
        score = Math.max(0, Math.round(n || 0));
        emit('score', score);
      },
      /* Il gioco dichiara superato il livello: il motore mette in pausa e
         mostra il riepilogo, poi si prosegue con nextLevel(). */
      levelComplete: function (opts) {
        if (state !== 'running') return;
        opts = opts || {};
        if (opts.bonus) {
          score += Math.round(opts.bonus);
          emit('score', score);
        }
        state = 'levelclear';
        TG.input.setEnabled(false);
        TG.sfx.levelUp();
        emit('levelclear', { level: level, score: score, bonus: opts.bonus || 0, message: opts.message || '' });
      },
      gameOver: function (opts) {
        if (state === 'over') return;
        opts = opts || {};
        state = 'over';
        TG.input.setEnabled(false);
        TG.sfx.fail();
        emit('gameover', { level: level, score: score, message: opts.message || '' });
      }
    };
  }

  /* ---------- controllo partita ---------- */

  function init(opts) {
    canvas = opts.canvas;
    stage = opts.stage;
    ctx = canvas.getContext('2d');
    if (window.ResizeObserver) {
      new window.ResizeObserver(resize).observe(stage);
    } else {
      window.addEventListener('resize', resize);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state === 'running') pause();
    });
  }

  /* startLevel permette di ripartire da un checkpoint sbloccato: il motore non
     sa nulla di come sia stato guadagnato, gli basta il numero. */
  function load(gameDef, startLevel) {
    destroy();
    def = gameDef;
    view = { w: def.viewport.w, h: def.viewport.h };
    level = Math.max(1, Math.round(startLevel || 1));
    livelloIniziale = level;
    score = 0;
    api = makeApi();
    api.width = view.w;
    api.height = view.h;
    TG.input.setViewport(view.w, view.h);
    TG.input.setControls(def.controls, def.actionLabel);
    instance = def.create(api);
    // start() prima di qualsiasi disegno: draw() presuppone lo stato del livello
    if (instance.start) instance.start(level);
    state = 'ready';
    emit('level', level);
    emit('score', score);
    resize();
  }

  function begin() { // dal pannello "pronto" al gioco vero
    if (state !== 'ready') return;
    state = 'running';
    TG.input.reset();
    TG.input.setEnabled(true);
    startLoop();
    emit('state', state);
  }

  function nextLevel() {
    if (state !== 'levelclear') return;
    level += 1;
    emit('level', level);
    emit('checkpoint', level);   // chi ascolta decide se è da salvare
    TG.input.reset();
    TG.input.setEnabled(true);
    if (instance.start) instance.start(level);
    state = 'running';
    lastTime = window.performance.now();
    emit('state', state);
  }

  /* Rigiocare riparte dallo stesso livello di questa partita: se sei entrato
     da un checkpoint, non ti rispedisce al livello 1 senza dirtelo. */
  function restart(startLevel) {
    if (!def) return;
    var d = def;
    load(d, startLevel == null ? livelloIniziale : startLevel);
    begin();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    TG.input.setEnabled(false);
    emit('paused');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    TG.input.reset();
    TG.input.setEnabled(true);
    lastTime = window.performance.now();
    emit('state', state);
  }

  function destroy() {
    stopLoop();
    TG.input.setEnabled(false);
    if (instance && instance.destroy) instance.destroy();
    instance = null;
    def = null;
    state = 'idle';
  }

  return {
    init: init,
    on: on,
    load: load,
    begin: begin,
    nextLevel: nextLevel,
    restart: restart,
    pause: pause,
    resume: resume,
    destroy: destroy,
    resize: resize,
    /* Stato leggibile dall'esterno: serve ai test e per tarare la difficoltà
       dalla console. I giochi possono esporre i propri dati con state(). */
    inspect: function () {
      return {
        state: state,
        level: level,
        score: score,
        game: instance && instance.state ? instance.state() : null
      };
    },
    getState: function () { return state; },
    getLevel: function () { return level; },
    getStartLevel: function () { return livelloIniziale; },
    getScore: function () { return score; },
    getGame: function () { return def; }
  };
})();
