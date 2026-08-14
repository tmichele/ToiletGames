/* Pong — uno contro uno con un avversario simulato.
   Difficoltà: la CPU diventa più rapida e sbaglia meno la mira, la pallina
   accelera e la tua racchetta si accorcia. */
(function () {
'use strict';

var TARGET = 5; // punti per vincere il livello

var SHRINK_FLOOR = 34;  // px: sotto questa misura le racchette non scendono

function config(level) {
  var npcW = Math.min(46 + level * 4, 84);
  /* L'errore di lettura va misurato in "mezze racchette": se scende sotto la
     metà della racchetta, la CPU para comunque e diventa infallibile di colpo.
     Tenendolo sopra 1 l'avversario sbaglia sempre qualcosa, e la difficoltà
     arriva da velocità e prontezza invece che dall'infallibilità. */
  var errFactor = Math.max(1.1, 2.6 - level * 0.18);
  return {
    level: level,
    ballSpeed: Math.min(180 + level * 13, 380),
    npcSpeed: Math.min(110 + level * 24, 350),
    npcW: npcW,
    npcError: npcW / 2 * errFactor,
    npcLag: Math.max(0.06, 0.40 - level * 0.035), // s tra una correzione e l'altra
    paddleW: Math.max(56, 92 - level * 2.5),      // la tua
    handSpeed: Math.min(400 + level * 10, 520),   // quanto scorre la racchetta
    shrinkEvery: Math.max(4, 10 - level * 0.5),   // s fra due accorciamenti
    shrinkStep: 4                                 // px persi ogni volta, per entrambi
  };
}

TG.registry.register({
  id: 'pong',
  title: 'Pong CPU',
  icon: '🏓',
  tagline: 'Cinque punti contro una CPU che impara in fretta.',
  scoreLabel: 'Punti',
  controls: 'lr-big',
  viewport: { w: 360, h: 480 },
  howto: '<b>Comandi:</b> i due tasti ◀ ▶ sotto il campo, oppure le frecce ←/→. ' +
    'Vinci il livello arrivando a ' + TARGET + ' punti prima della CPU. ' +
    'Il punto di impatto sulla racchetta decide l\'angolo di rimbalzo: ' +
    'colpire di lato manda la palla di traverso. ' +
    'Ogni pochi secondi <b>entrambe</b> le racchette si accorciano, quindi ' +
    'tirarla per le lunghe non conviene a nessuno dei due.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': CPU a ' + Math.round(c.npcSpeed) + ' px/s, ' +
      'racchetta ' + Math.round(c.paddleW) + ' px, ' +
      'si accorcia ogni ' + c.shrinkEvery.toFixed(0) + 's';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var PADDLE_H = 10, BALL_R = 6;
    var PLAYER_Y = H - 34, NPC_Y = 24;

    var cfg, player, npc, ball, myPts, cpuPts, serveTimer, npcTarget, npcTimer, shake;
    var npcTracking, npcBias, shrinkTimer, shrinkFlash;

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
      npcTracking = false;
      npcBias = 0;
      shrinkTimer = cfg.shrinkEvery;
      shrinkFlash = 0;
      player = { x: W / 2, w: cfg.paddleW };
      npc = { x: W / 2, w: cfg.npcW };
      resetBall(true);
    }

    /* Solo tasti: niente trascinamento del dito. Col touch la racchetta
       seguirebbe il polpastrello all'istante e il gioco perderebbe il suo
       nocciolo, cioè arrivare in tempo. */
    function movePlayer(dt) {
      var speed = cfg.handSpeed * dt;
      if (api.input.isDown('left')) player.x -= speed;
      if (api.input.isDown('right')) player.x += speed;
      player.x = api.util.clamp(player.x, player.w / 2, W - player.w / 2);
    }

    /* Le racchette si accorciano man mano, per tutti e due: uno scambio
       infinito diventa via via impossibile da tenere. */
    function shrinkPaddles(dt) {
      shrinkTimer -= dt;
      if (shrinkTimer > 0) return;
      shrinkTimer = cfg.shrinkEvery;
      var floorPlayer = Math.min(SHRINK_FLOOR, cfg.paddleW);
      var floorNpc = Math.min(SHRINK_FLOOR, cfg.npcW);
      if (player.w <= floorPlayer && npc.w <= floorNpc) return;
      player.w = Math.max(floorPlayer, player.w - cfg.shrinkStep);
      npc.w = Math.max(floorNpc, npc.w - cfg.shrinkStep);
      shrinkFlash = 0.4;
      api.sfx.tone(320, 0.12, 'triangle', 0.08, 220);
    }

    function moveNpc(dt) {
      /* L'errore di lettura si sorteggia UNA volta per scambio, quando la palla
         parte verso la CPU, e resta lo stesso fino al rimbalzo. Se lo si
         ri-sorteggiasse a ogni correzione, la media tenderebbe alla posizione
         esatta e l'avversario non sbaglierebbe mai un colpo. */
      var goingUp = ball.vy < 0;
      if (goingUp && !npcTracking) {
        npcTracking = true;
        npcBias = api.util.randFloat(-cfg.npcError, cfg.npcError);
      } else if (!goingUp) {
        npcTracking = false;
      }

      npcTimer -= dt;
      if (npcTimer <= 0) {
        npcTimer = cfg.npcLag;
        if (goingUp) {
          // la palla sale: stima dove arriverà, con l'errore di questo scambio
          var t = (NPC_Y + PADDLE_H - ball.y) / ball.vy;
          var predicted = ball.x + ball.vx * t;
          // rimbalzi sulle pareti laterali, riflessi a fisarmonica
          var span = W - BALL_R * 2;
          var rel = ((predicted - BALL_R) % (span * 2) + span * 2) % (span * 2);
          predicted = BALL_R + (rel > span ? span * 2 - rel : rel);
          npcTarget = predicted + npcBias;
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
      if (shrinkFlash > 0) shrinkFlash -= dt;

      if (serveTimer > 0) { serveTimer -= dt; return; }
      shrinkPaddles(dt);   // scorre solo a palla in gioco, non durante la rimessa

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

    function state() {
      return {
        myPts: myPts, cpuPts: cpuPts,
        ball: { x: Math.round(ball.x), y: Math.round(ball.y), vy: Math.round(ball.vy) },
        player: { x: Math.round(player.x), w: Math.round(player.w) },
        npc: { x: Math.round(npc.x), w: Math.round(npc.w) },
        serving: serveTimer > 0,
        shrink: Math.round(shrinkTimer * 10) / 10
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
