/* Serpente — classico snake a griglia.
   Difficoltà: più velocità, più cibo richiesto, muri e ostacoli dal livello 3. */
(function () {
'use strict';

/* Parametri per livello, condivisi da levelInfo e dalla partita. */
function config(level) {
  return {
    level: level,
    speed: Math.min(5 + level * 0.8, 16),
    foodTarget: 4 + level,
    wrap: level <= 2,
    obstacles: level <= 2 ? 0 : Math.min((level - 2) * 2, 18)
  };
}

TG.registry.register({
  id: 'serpente',
  title: 'Serpente',
  icon: '🐍',
  tagline: 'Mangia, cresci, non morderti. E occhio ai muri.',
  scoreLabel: 'Punti',
  controls: 'dpad',
  viewport: { w: 360, h: 360 },
  howto: '<b>Comandi:</b> frecce/WASD, swipe sul campo o pad a schermo. ' +
    'Nei primi due livelli i bordi sono aperti, dal terzo uccidono e compaiono ostacoli.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.foodTarget + ' bocconi, ' +
      c.speed.toFixed(1) + ' passi/s' +
      (c.wrap ? ', bordi aperti' : ', bordi mortali') +
      (c.obstacles ? ', ' + c.obstacles + ' ostacoli' : '');
  },

  create: function (api) {
    var COLS = 15, ROWS = 15;
    var cell = api.width / COLS;

    var snake, dir, dirQueue, food, obstacles, eaten, timer, cfg, dead;

    function key(x, y) { return x + ':' + y; }

    function occupied() {
      var set = {};
      snake.forEach(function (s) { set[key(s.x, s.y)] = true; });
      obstacles.forEach(function (o) { set[key(o.x, o.y)] = true; });
      return set;
    }

    function freeCell() {
      var busy = occupied();
      var tries = 0, x, y;
      do {
        x = api.util.randInt(0, COLS - 1);
        y = api.util.randInt(0, ROWS - 1);
        tries++;
      } while (busy[key(x, y)] && tries < 400);
      return { x: x, y: y };
    }

    function spawnObstacles(n) {
      obstacles = [];
      var midRow = Math.floor(ROWS / 2);
      for (var i = 0; i < n; i++) {
        var busy = occupied();
        var x, y, tries = 0;
        do {
          x = api.util.randInt(1, COLS - 2);
          y = api.util.randInt(1, ROWS - 2);
          tries++;
        } while ((busy[key(x, y)] || y === midRow) && tries < 200);
        obstacles.push({ x: x, y: y });
      }
    }

    function start(level) {
      cfg = config(level);
      dead = false;
      eaten = 0;
      timer = 0;
      dir = { x: 1, y: 0 };
      dirQueue = [];
      var midRow = Math.floor(ROWS / 2);
      snake = [
        { x: 4, y: midRow }, { x: 3, y: midRow }, { x: 2, y: midRow }
      ];
      obstacles = [];
      spawnObstacles(cfg.obstacles);
      food = freeCell();
    }

    function queueDir(action) {
      var d = null;
      if (action === 'up') d = { x: 0, y: -1 };
      else if (action === 'down') d = { x: 0, y: 1 };
      else if (action === 'left') d = { x: -1, y: 0 };
      else if (action === 'right') d = { x: 1, y: 0 };
      if (!d) return;
      var last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
      if (d.x === -last.x && d.y === -last.y) return; // niente inversione a U
      if (d.x === last.x && d.y === last.y) return;
      if (dirQueue.length < 2) dirQueue.push(d);
    }

    function step() {
      if (dirQueue.length) dir = dirQueue.shift();

      var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        if (!cfg.wrap) return die('Sbattuto contro il muro.');
        head.x = (head.x + COLS) % COLS;
        head.y = (head.y + ROWS) % ROWS;
      }

      for (var i = 0; i < obstacles.length; i++) {
        if (obstacles[i].x === head.x && obstacles[i].y === head.y) return die('Ostacolo centrato in pieno.');
      }
      // la coda si libera nello stesso passo: l'ultimo segmento non conta
      for (var j = 0; j < snake.length - 1; j++) {
        if (snake[j].x === head.x && snake[j].y === head.y) return die('Ti sei morso da solo.');
      }

      snake.unshift(head);

      if (head.x === food.x && head.y === food.y) {
        eaten++;
        api.addScore(10 * cfg.level);
        api.sfx.pick();
        if (eaten >= cfg.foodTarget) {
          api.levelComplete({ bonus: 50 * cfg.level, message: 'Serpente lungo ' + snake.length + ' caselle.' });
          return;
        }
        food = freeCell();
      } else {
        snake.pop();
      }
    }

    function die(msg) {
      dead = true;
      api.gameOver({ message: msg });
    }

    function update(dt) {
      var a;
      while ((a = api.input.take())) queueDir(a);
      if (dead) return;
      timer += dt;
      var stepTime = 1 / cfg.speed;
      while (timer >= stepTime && !dead) {
        timer -= stepTime;
        step();
      }
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, api.width, api.height);

      // griglia
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (var i = 1; i < COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, api.height);
        ctx.moveTo(0, i * cell); ctx.lineTo(api.width, i * cell);
        ctx.stroke();
      }

      if (!cfg.wrap) {
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, api.width - 3, api.height - 3);
      }

      ctx.fillStyle = '#475569';
      obstacles.forEach(function (o) {
        api.util.roundRect(ctx, o.x * cell + 2, o.y * cell + 2, cell - 4, cell - 4, 4);
        ctx.fill();
      });

      // cibo pulsante
      var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(food.x * cell + cell / 2, food.y * cell + cell / 2, cell * (0.28 + 0.06 * pulse), 0, Math.PI * 2);
      ctx.fill();

      snake.forEach(function (s, i) {
        var t = i / Math.max(1, snake.length - 1);
        ctx.fillStyle = i === 0 ? '#4ade80' : 'rgb(' + Math.round(56 + t * 20) + ',' + Math.round(189 - t * 60) + ',' + Math.round(160 - t * 40) + ')';
        api.util.roundRect(ctx, s.x * cell + 1.5, s.y * cell + 1.5, cell - 3, cell - 3, i === 0 ? 7 : 4);
        ctx.fill();
      });

      // progresso del livello
      ctx.fillStyle = 'rgba(230,237,243,0.75)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(eaten + '/' + cfg.foodTarget, 6, 14);
    }

    return { start: start, update: update, draw: draw };
  }
});

})();
