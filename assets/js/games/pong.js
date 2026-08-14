/* Pong — uno contro uno con un avversario simulato.
   Difficoltà: la CPU diventa più rapida e sbaglia meno la mira, la pallina
   accelera e la tua racchetta si accorcia. */
(function () {
'use strict';

var TARGET = 5; // punti per vincere il livello

function config(level) {
  return {
    level: level,
    ballSpeed: Math.min(190 + level * 16, 430),
    npcSpeed: Math.min(120 + level * 24, 360),
    npcError: Math.max(3, 48 - level * 4.5),   // px di errore di mira
    npcLag: Math.max(0.05, 0.34 - level * 0.03), // s tra una correzione e l'altra
    paddleW: Math.max(44, 86 - level * 3)
  };
}

TG.registry.register({
  id: 'pong',
  title: 'Pong CPU',
  icon: '🏓',
  tagline: 'Cinque punti contro una CPU che impara in fretta.',
  scoreLabel: 'Punti',
  controls: 'lr',
  viewport: { w: 360, h: 480 },
  howto: '<b>Comandi:</b> trascina il dito sul campo, frecce ←/→ o pad a schermo. ' +
    'Vinci il livello arrivando a ' + TARGET + ' punti prima della CPU. ' +
    'Il punto di impatto sulla racchetta decide l\'angolo di rimbalzo.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': CPU a ' + Math.round(c.npcSpeed) + ' px/s, ' +
      'racchetta ' + Math.round(c.paddleW) + ' px';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var PADDLE_H = 10, BALL_R = 6;
    var PLAYER_Y = H - 34, NPC_Y = 24;

    var cfg, player, npc, ball, myPts, cpuPts, serveTimer, npcTarget, npcTimer, shake;

    function resetBall(towardPlayer) {
      ball = {
        x: W / 2,
        y: H / 2,
        vx: api.util.randFloat(-0.5, 0.5) * cfg.ballSpeed,
        vy: (towardPlayer ? 1 : -1) * cfg.ballSpeed,
        speed: cfg.ballSpeed
      };
      serveTimer = 0.8;
    }

    function start(level) {
      cfg = config(level);
      myPts = 0;
      cpuPts = 0;
      shake = 0;
      npcTimer = 0;
      npcTarget = W / 2;
      player = { x: W / 2, w: cfg.paddleW };
      npc = { x: W / 2, w: Math.max(50, cfg.paddleW + 6) };
      resetBall(true);
    }

    function movePlayer(dt) {
      var p = api.input.pointer;
      if (p.down) {
        // il dito trascina: inseguimento morbido per non "teletrasportare"
        player.x = api.util.lerp(player.x, p.x, Math.min(1, dt * 18));
      }
      var speed = 320 * dt;
      if (api.input.isDown('left')) player.x -= speed;
      if (api.input.isDown('right')) player.x += speed;
      player.x = api.util.clamp(player.x, player.w / 2, W - player.w / 2);
    }

    function moveNpc(dt) {
      npcTimer -= dt;
      if (npcTimer <= 0) {
        npcTimer = cfg.npcLag;
        if (ball.vy < 0) {
          // la palla sale: stima dove arriverà, con un errore che cala di livello
          var t = (NPC_Y + PADDLE_H - ball.y) / ball.vy;
          var predicted = ball.x + ball.vx * t;
          // rimbalzi sulle pareti laterali, riflessi a fisarmonica
          var span = W - BALL_R * 2;
          var rel = ((predicted - BALL_R) % (span * 2) + span * 2) % (span * 2);
          predicted = BALL_R + (rel > span ? span * 2 - rel : rel);
          npcTarget = predicted + api.util.randFloat(-cfg.npcError, cfg.npcError);
        } else {
          npcTarget = W / 2 + api.util.randFloat(-40, 40); // rientra al centro
        }
      }
      var dir = npcTarget - npc.x;
      var step = cfg.npcSpeed * dt;
      npc.x += api.util.clamp(dir, -step, step);
      npc.x = api.util.clamp(npc.x, npc.w / 2, W - npc.w / 2);
    }

    function bounceOffPaddle(paddle, goingDown) {
      var offset = (ball.x - paddle.x) / (paddle.w / 2); // -1..1
      offset = api.util.clamp(offset, -1, 1);
      var angle = offset * 1.05; // max ~60°
      ball.speed = Math.min(ball.speed * 1.04, cfg.ballSpeed * 1.7);
      ball.vx = Math.sin(angle) * ball.speed;
      ball.vy = Math.cos(angle) * ball.speed * (goingDown ? 1 : -1);
      api.sfx.bounce();
    }

    function point(toPlayer) {
      shake = 0.25;
      if (toPlayer) {
        myPts++;
        api.addScore(25 * cfg.level);
        api.sfx.pick();
        if (myPts >= TARGET) {
          api.levelComplete({
            bonus: 100 * cfg.level + 20 * (TARGET - cpuPts),
            message: 'Battuta la CPU ' + myPts + '-' + cpuPts + '.'
          });
          return;
        }
      } else {
        cpuPts++;
        api.sfx.hit();
        if (cpuPts >= TARGET) {
          api.gameOver({ message: 'La CPU chiude ' + cpuPts + '-' + myPts + ' al livello ' + cfg.level + '.' });
          return;
        }
      }
      resetBall(!toPlayer);
    }

    function update(dt) {
      while (api.input.take()) { /* svuota la coda: qui contano i tasti tenuti */ }
      if (shake > 0) shake -= dt;

      movePlayer(dt);
      moveNpc(dt);

      if (serveTimer > 0) { serveTimer -= dt; return; }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); api.sfx.bounce(); }
      if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); api.sfx.bounce(); }

      // racchetta giocatore
      if (ball.vy > 0 && ball.y + BALL_R >= PLAYER_Y && ball.y - BALL_R <= PLAYER_Y + PADDLE_H) {
        if (Math.abs(ball.x - player.x) <= player.w / 2 + BALL_R) {
          ball.y = PLAYER_Y - BALL_R;
          bounceOffPaddle(player, false);
        }
      }
      // racchetta CPU
      if (ball.vy < 0 && ball.y - BALL_R <= NPC_Y + PADDLE_H && ball.y + BALL_R >= NPC_Y) {
        if (Math.abs(ball.x - npc.x) <= npc.w / 2 + BALL_R) {
          ball.y = NPC_Y + PADDLE_H + BALL_R;
          bounceOffPaddle(npc, true);
        }
      }

      if (ball.y > H + BALL_R * 2) point(false);
      else if (ball.y < -BALL_R * 2) point(true);
    }

    function draw(ctx) {
      ctx.save();
      if (shake > 0) ctx.translate(api.util.randFloat(-2, 2), api.util.randFloat(-2, 2));

      ctx.fillStyle = '#05070c';
      ctx.fillRect(-4, -4, W + 8, H + 8);

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // punteggio del set
      ctx.font = 'bold 44px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillText(cpuPts, W / 2, H / 2 - 24);
      ctx.fillText(myPts, W / 2, H / 2 + 62);

      ctx.fillStyle = '#f87171';
      api.util.roundRect(ctx, npc.x - npc.w / 2, NPC_Y, npc.w, PADDLE_H, 5);
      ctx.fill();

      ctx.fillStyle = '#4ade80';
      api.util.roundRect(ctx, player.x - player.w / 2, PLAYER_Y, player.w, PADDLE_H, 5);
      ctx.fill();

      ctx.fillStyle = serveTimer > 0 ? 'rgba(56,189,248,0.5)' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(230,237,243,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText('CPU', 8, NPC_Y - 8);
      ctx.textAlign = 'right';
      ctx.fillText('TU', W - 8, PLAYER_Y + PADDLE_H + 16);
      ctx.restore();
    }

    return { start: start, update: update, draw: draw };
  }
});

})();
