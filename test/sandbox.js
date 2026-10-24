/* Esecuzione dei giochi fuori dal browser.

   La logica dei giochi non tocca il DOM (solo draw() usa il canvas, e nessuno
   qui lo chiama), quindi si può caricare tutto in una sandbox e farla girare a
   tempo compresso. Lo usano test/balance.js per la difficoltà e test/regole.js
   per le meccaniche. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* Carica util.js e tutti i giochi, restituendo le definizioni registrate. */
function loadGames() {
  const ctx = { console, Math, Date, JSON, isNaN, parseInt, parseFloat };
  ctx.window = ctx;
  vm.createContext(ctx);

  const run = (rel) => vm.runInContext(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel }
  );

  run('assets/js/core/util.js');

  const defs = {};
  ctx.TG.registry = { register: (def) => { defs[def.id] = def; } };

  /* Le mappe sono dati, non giochi: si caricano prima, perché un gioco che
     ne usa una la cerca già pronta. */
  const mappe = path.join(ROOT, 'assets/js/mappe');
  if (fs.existsSync(mappe)) {
    fs.readdirSync(mappe).filter((f) => f.endsWith('.js'))
      .forEach((f) => run(path.join('assets/js/mappe', f)));
  }

  fs.readdirSync(path.join(ROOT, 'assets/js/games'))
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => run(path.join('assets/js/games', f)));

  return { defs, util: ctx.TG.util };
}

/* Carica i moduli di base (storage, profilo, classifica globale, punteggi) in
   una sandbox con un localStorage e un fetch finti. Serve ai test della
   classifica globale: quella parte non tocca il canvas, tocca la rete, e
   provarla nel browser vorrebbe dire un vero progetto Firebase per ogni
   esecuzione. `fetch` lo passa il chiamante — di solito il Firebase finto. */
function loadCore(opzioni) {
  const o = opzioni || {};
  const memoria = {};
  const ctx = {
    console, Math, Date, JSON, isNaN, parseInt, parseFloat, String, Number,
    Object, Array, Error, RegExp, Boolean, Promise, setTimeout, clearTimeout,
    encodeURIComponent, decodeURIComponent, AbortController,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(memoria, k) ? memoria[k] : null),
      setItem: (k, v) => { memoria[k] = String(v); },
      removeItem: (k) => { delete memoria[k]; }
    },
    fetch: o.fetch || null,
    // `false` va passato com'è: è il modo di provare l'interruttore
    TG_CLASSIFICA: (o.classifica === undefined ? null : o.classifica)
  };
  ctx.window = ctx;
  vm.createContext(ctx);

  const run = (rel) => vm.runInContext(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel }
  );

  run('assets/js/core/util.js');
  ctx.TG.versione = { numero: o.versione || 0, data: '' };
  run('assets/js/core/storage.js');
  run('assets/js/core/profile.js');
  run('assets/js/core/nuvola.js');
  run('assets/js/core/registry.js');
  run('assets/js/core/scores.js');
  return { TG: ctx.TG, memoria: memoria, ctx: ctx };
}

/* Audio finto: qualunque metodo chiamato non fa niente. */
const SFX = new Proxy({}, { get: () => () => {} });

function makeInput() {
  return {
    pointer: { x: 0, y: 0, down: false, inside: true, moved: true },
    stick: { x: 0, y: 0, attiva: false },
    held: {},
    queue: [],
    taps: [],
    press(a) { this.queue.push(a); },
    tap(x, y) { this.taps.push({ x: x, y: y }); },
    isDown(a) { return !!this.held[a]; },
    take() { return this.queue.length ? this.queue.shift() : null; },
    takeTap() { return this.taps.length ? this.taps.shift() : null; },
    takeDigit() { return null; },
    reset() {}
  };
}

/* Istanzia un gioco con un motore finto. `events` raccoglie ciò che il gioco
   comunica al motore, così i test possono verificarlo. */
function makeGame(def, util, level) {
  const input = makeInput();
  const events = { score: 0, outcome: null, bonus: 0 };

  const api = {
    width: def.viewport.w,
    height: def.viewport.h,
    util,
    sfx: SFX,
    input,
    level,
    score: 0,
    addScore(n) {
      events.score = Math.max(0, events.score + Math.round(n || 0));
      api.score = events.score;
    },
    setScore(n) { events.score = Math.max(0, Math.round(n || 0)); api.score = events.score; },
    levelComplete(o) {
      if (!events.outcome) { events.outcome = 'win'; events.bonus = (o && o.bonus) || 0; }
    },
    gameOver() { if (!events.outcome) events.outcome = 'lose'; }
  };

  const game = def.create(api);
  game.start(level);
  return { game, api, input, events };
}

module.exports = { loadGames, loadCore, makeGame, makeInput, SFX, ROOT };
