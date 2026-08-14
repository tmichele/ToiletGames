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

  fs.readdirSync(path.join(ROOT, 'assets/js/games'))
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => run(path.join('assets/js/games', f)));

  return { defs, util: ctx.TG.util };
}

/* Audio finto: qualunque metodo chiamato non fa niente. */
const SFX = new Proxy({}, { get: () => () => {} });

function makeInput() {
  return {
    pointer: { x: 0, y: 0, down: false, inside: true, moved: true },
    held: {},
    queue: [],
    press(a) { this.queue.push(a); },
    isDown(a) { return !!this.held[a]; },
    take() { return this.queue.length ? this.queue.shift() : null; },
    takeTap() { return null; },
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

module.exports = { loadGames, makeGame, makeInput, SFX, ROOT };
