/* Mattoni — breakout a livelli.
   Difficoltà: più file di mattoni, mattoni corazzati dal livello 4, pallina
   più veloce e racchetta più corta. Le vite restano fra un livello e l'altro. */
(function () {
'use strict';

var COLS = 7;
var ROW_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#22d3ee', '#c084fc'];
var COMBO_MAX = 5;    // oltre questo il moltiplicatore non cresce più

function config(level) {
  return {
    level: level,
    rows: Math.min(3 + Math.floor((level - 1) / 2), 7),
    /* La pallina deve arrivare a superare la racchetta: finché resta più
       lenta, chi la insegue bene non sbaglia mai e i livelli alti non sfidano
       nessuno. Oltre il livello 10 va più veloce di quanto tu possa scorrere. */
    ballSpeed: Math.min(170 + level * 18, 560),
    paddleW: Math.max(52, 92 - level * 2.5),
    armored: level >= 5 ? Math.min(0.12 + (level - 5) * 0.07, 0.55) : 0, // quota di mattoni a 2 colpi
    extraLifeEvery: 3,
    brickPoints: 10 * level,
    paddleMalus: 5 * level,  // costo di ogni ritorno sulla racchetta
    handSpeed: Math.min(400 + level * 10, 520)  // quanto scorre la racchetta
  };
}

TG.registry.register({
  id: 'mattoni',
  title: 'Mattoni',
  icon: '🧱',
  tagline: 'Sfonda il muro. Tre vite, e non si ricaricano spesso.',
  scoreLabel: 'Punti',
  controls: 'lr-big',
  viewport: { w: 360, h: 480 },
  howto: '<b>Comandi:</b> i due tasti ◀ ▶ sotto il campo, oppure le frecce ←/→. ' +
    'La pallina parte da sola dopo un secondo, o subito se muovi la racchetta. ' +
    'Le vite valgono per tutta la partita: ne guadagni una ogni 3 livelli. ' +
    'I mattoni scuri reggono due colpi. ' +
    '<b>Combo:</b> ogni mattone rotto senza tornare sulla racchetta vale di più ' +
    '(fino a ×' + COMBO_MAX + '), mentre <b>ogni tocco di racchetta toglie punti</b> ' +
    'e azzera il moltiplicatore. Conviene mirare e far lavorare i rimbalzi.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.rows + ' file, pallina a ' +
      Math.round(c.ballSpeed) + ' px/s' + (c.armored ? ', mattoni corazzati' : '') +
      ' · mattone ' + c.brickPoints + ' pt, tocco di racchetta −' + c.paddleMalus;
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var PADDLE_Y = H - 30, PADDLE_H = 10, BALL_R = 5;
    var TOP = 46, BRICK_H = 18, GAP = 4;

    var cfg, paddle, ball, bricks, lives, launched, blink, stall, combo, floaters, autoLaunch;

    /* Riporta la pallina alla velocità del livello evitando traiettorie
       quasi orizzontali, che produrrebbero scambi infiniti. */
    function normalizeBall() {
      var mag = Math.hypot(ball.vx, ball.vy) || 1;
      var minVy = ball.speed * 0.35;
      ball.vx = ball.vx / mag * ball.speed;
      ball.vy = ball.vy / mag * ball.speed;
      if (Math.abs(ball.vy) < minVy) {
        ball.vy = (ball.vy < 0 ? -1 : 1) * minVy;
        var vx2 = ball.speed * ball.speed - ball.vy * ball.vy;
        ball.vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, vx2));
      }
    }

    function buildBricks() {
      bricks = [];
      var bw = (W - GAP * (COLS + 1)) / COLS;
      for (var r = 0; r < cfg.rows; r++) {
        for (var c = 0; c < COLS; c++) {
          var hard = cfg.armored > 0 && Math.random() < cfg.armored;
          bricks.push({
            x: GAP + c * (bw + GAP),
            y: TOP + r * (BRICK_H + GAP),
            w: bw,
            h: BRICK_H,
            hp: hard ? 2 : 1,
            color: ROW_COLORS[r % ROW_COLORS.length],
            alive: true
          });
        }
      }
    }

    function resetBall() {
      launched = false;
      autoLaunch = 1.2;   // niente pulsante: parte da sola
      ball = { x: paddle.x, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, speed: cfg.ballSpeed };
    }

    function launch() {
      if (launched) return;
      launched = true;
      var angle = api.util.randFloat(-0.5, 0.5);
      ball.vx = Math.sin(angle) * ball.speed;
      ball.vy = -Math.cos(angle) * ball.speed;
      api.sfx.bounce();
    }

    function start(level) {
      var prev = cfg;
      cfg = config(level);
      if (!prev) lives = 3;
      else if (level % cfg.extraLifeEvery === 1 && level > 1) lives = Math.min(lives + 1, 5);
      blink = 0;
      stall = 0;
      combo = 0;
      floaters = [];
      paddle = { x: W / 2, w: cfg.paddleW };
      buildBricks();
      resetBall();
    }

    function loseLife() {
      lives--;
      api.sfx.fail();
      if (lives <= 0) {
        api.gameOver({ message: 'Finite le vite al livello ' + cfg.level + '.' });
        return;
      }
      blink = 0.5;
      resetBall();
    }

    function remaining() {
      var n = 0;
      for (var i = 0; i < bricks.length; i++) if (bricks[i].alive) n++;
      return n;
    }

    function hitBrick(b) {
      b.hp--;
      stall = 0;
      if (b.hp <= 0) {
        b.alive = false;
        combo++;
        var mult = Math.min(combo, COMBO_MAX);
        var pts = cfg.brickPoints * mult;
        api.addScore(pts);
        floaters.push({
          text: '+' + pts + (mult > 1 ? ' \u00d7' + mult : ''),
          x: b.x + b.w / 2, y: b.y, t: 0.7, color: mult > 1 ? '#fbbf24' : '#4ade80'
        });
        api.sfx.pick();
        if (remaining() === 0) {
          api.levelComplete({
            bonus: 100 * cfg.level + 50 * lives,
            message: 'Muro abbattuto con ' + lives + (lives === 1 ? ' vita' : ' vite') + '.'
          });
          return true;
        }
      } else {
        api.sfx.hit();
      }
      return false;
    }

    function collideBricks() {
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;
        if (!api.util.circleRectHit(ball.x, ball.y, BALL_R, b.x, b.y, b.w, b.h)) continue;

        // il lato colpito decide l'asse da invertire
        var prevX = ball.x - ball.vx * 0.016;
        var prevY = ball.y - ball.vy * 0.016;
        var fromSide = prevX < b.x || prevX > b.x + b.w;
        var fromTop = prevY < b.y || prevY > b.y + b.h;
        if (fromTop || !fromSide) ball.vy = -ball.vy;
        if (fromSide) ball.vx = -ball.vx;

        // spinge fuori la pallina per non incastrarla nel mattone
        ball.x += ball.vx * 0.016;
        ball.y += ball.vy * 0.016;
        return hitBrick(b);
      }
      return false;
    }

    function update(dt) {
      var a;
      while ((a = api.input.take())) { if (a === 'action') launch(); }
      if (blink > 0) blink -= dt;

      for (var f = floaters.length - 1; f >= 0; f--) {
        floaters[f].t -= dt;
        floaters[f].y -= 26 * dt;
        if (floaters[f].t <= 0) floaters.splice(f, 1);
      }

      /* Solo tasti, come nel pong: col dito sullo schermo la racchetta
         seguirebbe il polpastrello e mirare non sarebbe più una scelta. */
      var speed = cfg.handSpeed * dt;
      var moving = api.input.isDown('left') || api.input.isDown('right');
      if (api.input.isDown('left')) paddle.x -= speed;
      if (api.input.isDown('right')) paddle.x += speed;
      paddle.x = api.util.clamp(paddle.x, paddle.w / 2, W - paddle.w / 2);

      if (!launched) {
        autoLaunch -= dt;
        if (autoLaunch <= 0 || moving) launch();
        ball.x = paddle.x;
        ball.y = PADDLE_Y - BALL_R - 1;
        return;
      }

      // se per un po' non cade un mattone la traiettoria si è chiusa in un
      // ciclo: una piccola deviazione la rompe
      stall += dt;
      if (stall > 6) {
        stall = 3;
        ball.vx += api.util.randFloat(-60, 60);
        normalizeBall();
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); api.sfx.bounce(); }
      if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); api.sfx.bounce(); }
      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); api.sfx.bounce(); }

      if (collideBricks()) return;

      if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y - BALL_R <= PADDLE_Y + PADDLE_H) {
        if (Math.abs(ball.x - paddle.x) <= paddle.w / 2 + BALL_R) {
          var offset = api.util.clamp((ball.x - paddle.x) / (paddle.w / 2), -1, 1);
          var angle = offset * 1.1 + api.util.randFloat(-0.05, 0.05);
          ball.speed = Math.min(ball.speed * 1.02, cfg.ballSpeed * 1.5);
          ball.vx = Math.sin(angle) * ball.speed;
          ball.vy = -Math.cos(angle) * ball.speed;
          ball.y = PADDLE_Y - BALL_R;
          api.sfx.bounce();
          /* Ogni ritorno sulla racchetta costa: così conviene mirare e
             incatenare più mattoni per volo invece di palleggiare a caso. */
          if (cfg.paddleMalus > 0) {
            api.addScore(-cfg.paddleMalus);
            floaters.push({
              text: '\u2212' + cfg.paddleMalus, x: paddle.x, y: PADDLE_Y - 10,
              t: 0.7, color: '#f87171'
            });
          }
          combo = 0;
        }
      }

      if (ball.y > H + BALL_R * 2) loseLife();
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      bricks.forEach(function (b) {
        if (!b.alive) return;
        ctx.fillStyle = b.hp > 1 ? '#3f4a5c' : b.color;
        api.util.roundRect(ctx, b.x, b.y, b.w, b.h, 4);
        ctx.fill();
        if (b.hp > 1) {
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1.5;
          api.util.roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 3);
          ctx.stroke();
        }
      });

      ctx.fillStyle = blink > 0 && Math.floor(blink * 10) % 2 === 0 ? '#f87171' : '#4ade80';
      api.util.roundRect(ctx, paddle.x - paddle.w / 2, PADDLE_Y, paddle.w, PADDLE_H, 5);
      ctx.fill();

      ctx.fillStyle = '#e6edf3';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText('vite ' + '●'.repeat(Math.max(0, lives)), 8, 18);
      ctx.textAlign = 'right';
      ctx.fillText('mattoni ' + remaining(), W - 8, 18);

      if (combo > 1) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillText('combo \u00d7' + Math.min(combo, COMBO_MAX), W / 2, 18);
      }

      floaters.forEach(function (fl) {
        ctx.globalAlpha = api.util.clamp(fl.t / 0.7, 0, 1);
        ctx.fillStyle = fl.color;
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fl.text, fl.x, fl.y);
        ctx.globalAlpha = 1;
      });

      if (!launched) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(230,237,243,0.75)';
        ctx.fillText('parte fra ' + Math.max(0, autoLaunch).toFixed(1) + 's', W / 2, PADDLE_Y - 24);
      }
    }

    function state() {
      return {
        lives: lives, bricks: remaining(), combo: combo, launched: launched,
        ball: { x: Math.round(ball.x), y: Math.round(ball.y), vx: ball.vx, vy: ball.vy },
        paddle: { x: Math.round(paddle.x), w: Math.round(paddle.w) }
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
