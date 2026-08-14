/* Air Hockey — il tavolo ad aria compressa, contro un avversario simulato.
   Ognuno resta nella propria metà campo: il disco si colpisce di stecca
   (il "mazzuolo"), e la velocità con cui muovi la mano finisce nel disco.
   Difficoltà: la CPU si muove più in fretta, ragiona prima, la sua porta si
   restringe e il tuo mazzuolo rimpicciolisce. */
(function () {
'use strict';

var TARGET = 3;      // gol per vincere il livello: partite brevi, da cinque minuti
var STALL_LIMIT = 3; // s di disco fermo prima che il possesso cambi
var MY_GOAL = 140;   // larghezza della tua porta, fissa
var GRAB_LIFT = 44;  // px: quanto il mazzuolo sta sopra il dito, per non coprirlo
var MY_SPEED = 300;  // px/s del mazzuolo umano da tastiera: riferimento per la CPU

function config(level) {
  return {
    level: level,
    cpuSpeed: MY_SPEED * TG.util.opponentSpeedRatio(level),
    cpuLag: Math.max(0.02, 0.22 - level * 0.02),   // s fra due decisioni
    cpuError: Math.max(2, 34 - level * 3),         // px di imprecisione
    cpuAggro: Math.min(0.4 + level * 0.07, 0.95),  // quanto spesso attacca
    /* Quanto bene il portiere avversario segue il disco: sotto 1 resta
       incollato al centro e lascia scoperti gli angoli. È la leva che rende
       i primi livelli davvero abbordabili. */
    cpuGuard: Math.min(0.35 + level * 0.07, 1),
    /* Dopo aver tirato la CPU ci mette un attimo a rientrare: è la finestra
       in cui puoi ripartire in contropiede. Ai livelli alti sparisce. */
    cpuRecover: Math.max(0.1, 1.15 - level * 0.1),
    goalCpu: Math.max(100, 210 - level * 10),      // larghezza porta avversaria
    malletR: Math.max(13, 19 - level * 0.5),       // il tuo mazzuolo
    cpuR: Math.min(17 + level * 0.7, 25),          // quello della CPU, che cresce
    puckMax: Math.min(520 + level * 22, 820)
  };
}

TG.registry.register({
  id: 'hockey',
  title: 'Air Hockey',
  icon: '🏒',
  tagline: 'Disco sul tavolo ad aria: cinque gol prima della CPU.',
  scoreLabel: 'Punti',
  controls: 'none',
  viewport: { w: 360, h: 600 },
  howto: '<b>Comandi:</b> trascina il dito nella tua metà campo, oppure frecce/WASD. ' +
    'Il mazzuolo resta sopra il dito, così lo vedi mentre giochi: ' +
    'lo prendi dove sta, non salta sotto il polpastrello. ' +
    'Il mazzuolo non può superare la linea di metà campo. ' +
    'Colpisci il disco muovendo: più veloce vai, più forte parte. ' +
    'Se il disco resta fermo troppo a lungo il possesso passa all\'avversario.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': CPU al ' +
      Math.round(TG.util.opponentSpeedRatio(level) * 100) + '% della tua velocità, ' +
      'porta avversaria ' + Math.round(c.goalCpu) + ' px';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var WALL = 6;                  // spessore della sponda
    var PUCK_R = 9;
    var MID = H / 2;

    var cfg, puck, me, cpu, myGoals, cpuGoals, faceoff, stall, flashGoal;
    var cpuTimer, cpuTarget, cpuMode, cpuAim, stallRef, cpuRecoverLeft;
    var grab = null;   // scarto fra dito e mazzuolo durante il trascinamento

    /* ---------- utilità ---------- */

    function speedOf(o) { return Math.hypot(o.vx, o.vy); }

    function capPuck() {
      var s = speedOf(puck);
      if (s > cfg.puckMax) {
        puck.vx = puck.vx / s * cfg.puckMax;
        puck.vy = puck.vy / s * cfg.puckMax;
      }
    }

    function goalHalf(top) { return (top ? cfg.goalCpu : MY_GOAL) / 2; }

    function faceOff(towardPlayer) {
      puck = { x: W / 2, y: MID, vx: api.util.randFloat(-40, 40), vy: 0 };
      // piccola spinta verso chi ha subito, come la rimessa vera
      puck.vy = (towardPlayer ? 1 : -1) * 110;
      faceoff = 0.7;
      stall = 0;
      stallRef = { x: puck.x, y: puck.y };
    }

    /* Regola del gioco perso di tempo: se il disco resta fermo nella tua metà,
       il possesso passa all'avversario. Senza, un giocatore immobile bloccherebbe
       la partita per sempre, visto che i mazzuoli non superano la linea. */
    function possessionTo(toPlayer) {
      puck = {
        x: W / 2 + api.util.randFloat(-60, 60),
        y: toPlayer ? MID + 90 : MID - 90,
        vx: 0,
        vy: 0
      };
      faceoff = 0.6;
      stall = 0;
      stallRef = { x: puck.x, y: puck.y };
    }

    function start(level) {
      cfg = config(level);
      myGoals = 0;
      cpuGoals = 0;
      cpuTimer = 0;
      cpuTarget = { x: W / 2, y: 70 };
      cpuMode = 'difesa';
      cpuAim = W / 2;
      cpuRecoverLeft = 0;
      flashGoal = 0;
      me = { x: W / 2, y: H - 70, r: cfg.malletR, vx: 0, vy: 0 };
      cpu = { x: W / 2, y: 70, r: cfg.cpuR, vx: 0, vy: 0 };
      faceOff(true);
    }

    /* ---------- movimento dei mazzuoli ---------- */

    function moveMe(dt) {
      var px = me.x, py = me.y;
      var p = api.input.pointer;
      if (p.down) {
        /* Trascinamento relativo: al primo tocco si memorizza dove sta il
           mazzuolo rispetto al dito e quello scarto si mantiene. Il mazzuolo
           non salta sotto il polpastrello e resta visibile: sopra il dito di
           almeno GRAB_LIFT px, che è quanto serve per non coprirlo. */
        if (!grab) {
          grab = {
            dx: api.util.clamp(me.x - p.x, -70, 70),
            dy: Math.min(me.y - p.y, -GRAB_LIFT)
          };
        }
        me.x = api.util.lerp(me.x, p.x + grab.dx, Math.min(1, dt * 26));
        me.y = api.util.lerp(me.y, p.y + grab.dy, Math.min(1, dt * 26));
      } else {
        grab = null;
      }
      var step = MY_SPEED * dt;
      if (api.input.isDown('left')) me.x -= step;
      if (api.input.isDown('right')) me.x += step;
      if (api.input.isDown('up')) me.y -= step;
      if (api.input.isDown('down')) me.y += step;

      // resta nella propria metà, dentro le sponde
      me.x = api.util.clamp(me.x, WALL + me.r, W - WALL - me.r);
      me.y = api.util.clamp(me.y, MID + me.r, H - me.r);

      me.vx = dt > 0 ? (me.x - px) / dt : 0;
      me.vy = dt > 0 ? (me.y - py) / dt : 0;
    }

    /* IA a tre stati: difende sulla linea di porta, si porta dietro al disco,
       poi ci passa attraverso per tirare. Lo stato resta finché la situazione
       non cambia davvero: rivalutarlo a ogni battito farebbe solo tentennare
       la CPU davanti al disco. */
    function decideCpu() {
      var inCpuHalf = puck.y < MID;

      if (cpuMode === 'rientro') {
        if (cpuRecoverLeft > 0) {
          cpuTarget = { x: W / 2, y: 52 };   // torna piano, senza scattare
          return;
        }
        cpuMode = 'difesa';
      }

      if (!inCpuHalf) {
        // ha appena tirato: resta scoperta per un istante
        cpuMode = (cpuMode === 'tiro') ? 'rientro' : 'difesa';
        if (cpuMode === 'rientro') {
          cpuRecoverLeft = cfg.cpuRecover;
          cpuTarget = { x: W / 2, y: 52 };
          return;
        }
      } else if (cpuMode === 'difesa') {
        if (Math.random() < cfg.cpuAggro) {
          cpuMode = 'avvicina';
          // mira il lato di porta più lontano dal tuo mazzuolo: restare
          // immobili davanti alla porta non basta a fare il portiere
          var half = goalHalf(false);
          var side = me.x < W / 2 ? 1 : -1;
          cpuAim = W / 2 + side * half * 0.7 + api.util.randFloat(-cfg.cpuError, cfg.cpuError) * 1.5;
          cpuAim = api.util.clamp(cpuAim, W / 2 - half * 0.85, W / 2 + half * 0.85);
        }
      }

      if (cpuMode === 'difesa') {
        var t = api.util.clamp((puck.x - W / 2) / (W / 2), -1, 1);
        cpuTarget = {
          x: W / 2 + t * goalHalf(true) * cfg.cpuGuard,
          y: 52 + api.util.clamp((MID - puck.y) / MID, 0, 1) * 18
        };
      } else if (cpuMode === 'avvicina') {
        // punto dietro al disco, sulla retta disco-porta avversaria
        var dx = puck.x - cpuAim, dy = puck.y - H;
        var len = Math.hypot(dx, dy) || 1;
        cpuTarget = {
          x: puck.x + dx / len * (cpu.r + PUCK_R + 4),
          y: puck.y + dy / len * (cpu.r + PUCK_R + 4)
        };
        if (Math.hypot(cpu.x - cpuTarget.x, cpu.y - cpuTarget.y) < 16) cpuMode = 'tiro';
      }

      if (cpuMode === 'tiro') {
        // attraversa il disco puntando la porta: il colpo nasce dalla corsa
        cpuTarget = { x: cpuAim, y: H };
      }

      cpuTarget.x += api.util.randFloat(-cfg.cpuError, cfg.cpuError);
    }

    function moveCpu(dt) {
      var px = cpu.x, py = cpu.y;

      cpuTimer -= dt;
      if (cpuTimer <= 0) {
        cpuTimer = cfg.cpuLag;
        decideCpu();
      }

      if (cpuRecoverLeft > 0) cpuRecoverLeft -= dt;

      var vx = cpuTarget.x - cpu.x, vy = cpuTarget.y - cpu.y;
      var d = Math.hypot(vx, vy);
      if (d > 0.5) {
        var speed = cpuMode === 'rientro' ? cfg.cpuSpeed * 0.5 : cfg.cpuSpeed;
        var s = Math.min(speed * dt, d);
        cpu.x += vx / d * s;
        cpu.y += vy / d * s;
      }
      cpu.x = api.util.clamp(cpu.x, WALL + cpu.r, W - WALL - cpu.r);
      cpu.y = api.util.clamp(cpu.y, cpu.r, MID - cpu.r);

      cpu.vx = dt > 0 ? (cpu.x - px) / dt : 0;
      cpu.vy = dt > 0 ? (cpu.y - py) / dt : 0;
    }

    /* ---------- fisica del disco ---------- */

    function hitMallet(m) {
      var dx = puck.x - m.x, dy = puck.y - m.y;
      var dist = Math.hypot(dx, dy);
      var min = m.r + PUCK_R;
      if (dist >= min || dist === 0) return;

      var nx = dx / dist, ny = dy / dist;
      puck.x = m.x + nx * (min + 0.5);   // separa i corpi
      puck.y = m.y + ny * (min + 0.5);

      var rvx = puck.vx - m.vx, rvy = puck.vy - m.vy;
      var vn = rvx * nx + rvy * ny;
      if (vn < 0) {                      // si stanno avvicinando: rimbalzo
        var j = -1.85 * vn;
        puck.vx += j * nx;
        puck.vy += j * ny;
      }
      // la stecca in movimento trasferisce la sua spinta
      var push = m.vx * nx + m.vy * ny;
      if (push > 0) {
        puck.vx += nx * push * 0.55;
        puck.vy += ny * push * 0.55;
      }
      if (speedOf(puck) < 90) {          // niente colpi smorti
        var s = speedOf(puck) || 1;
        puck.vx = puck.vx / s * 90;
        puck.vy = puck.vy / s * 90;
      }
      capPuck();
      api.sfx.hit();
    }

    function goal(forPlayer) {
      flashGoal = 0.6;
      if (forPlayer) {
        myGoals++;
        api.addScore(30 * cfg.level);
        api.sfx.pick();
        if (myGoals >= TARGET) {
          api.levelComplete({
            bonus: 120 * cfg.level + 40 * (TARGET - cpuGoals),
            message: 'Vinta ' + myGoals + '-' + cpuGoals + '.'
          });
          return;
        }
      } else {
        cpuGoals++;
        api.sfx.fail();
        if (cpuGoals >= TARGET) {
          api.gameOver({ message: 'La CPU chiude ' + cpuGoals + '-' + myGoals + ' al livello ' + cfg.level + '.' });
          return;
        }
      }
      faceOff(!forPlayer);
    }

    /* Un passo di simulazione: mazzuoli, poi sponde e porte.
       L'ordine conta: la sponda ha sempre l'ultima parola, altrimenti un
       mazzuolo che spinge contro il bordo caccia il disco fuori dal tavolo. */
    function stepPuck(dt) {
      puck.x += puck.vx * dt;
      puck.y += puck.vy * dt;

      hitMallet(me);
      hitMallet(cpu);

      // sponde laterali
      if (puck.x < WALL + PUCK_R) {
        puck.x = WALL + PUCK_R;
        puck.vx = Math.abs(puck.vx) * 0.95;
        api.sfx.bounce();
      } else if (puck.x > W - WALL - PUCK_R) {
        puck.x = W - WALL - PUCK_R;
        puck.vx = -Math.abs(puck.vx) * 0.95;
        api.sfx.bounce();
      }

      // fondo campo: porta al centro, sponda ai lati
      if (puck.y < WALL + PUCK_R) {
        if (Math.abs(puck.x - W / 2) < goalHalf(true) - PUCK_R * 0.5) {
          if (puck.y < -PUCK_R) { goal(true); return true; }
        } else {
          puck.y = WALL + PUCK_R;
          puck.vy = Math.abs(puck.vy) * 0.95;
          api.sfx.bounce();
        }
      } else if (puck.y > H - WALL - PUCK_R) {
        if (Math.abs(puck.x - W / 2) < goalHalf(false) - PUCK_R * 0.5) {
          if (puck.y > H + PUCK_R) { goal(false); return true; }
        } else {
          puck.y = H - WALL - PUCK_R;
          puck.vy = -Math.abs(puck.vy) * 0.95;
          api.sfx.bounce();
        }
      }

      // rete di sicurezza: il disco non esce mai lateralmente
      puck.x = api.util.clamp(puck.x, WALL + PUCK_R, W - WALL - PUCK_R);
      return false;
    }

    function update(dt) {
      while (api.input.take()) { /* qui contano i tasti tenuti, non le pressioni */ }
      if (flashGoal > 0) flashGoal -= dt;

      moveMe(dt);
      moveCpu(dt);

      if (faceoff > 0) {
        faceoff -= dt;
        hitMallet(me);   // si può anticipare la rimessa
        hitMallet(cpu);
        if (faceoff > 0) return;
      }

      // attrito bassissimo: è un tavolo ad aria
      var f = Math.max(0, 1 - 0.16 * dt);
      puck.vx *= f;
      puck.vy *= f;
      if (speedOf(puck) < 4) { puck.vx = 0; puck.vy = 0; }

      // sotto-passi: a 800 px/s il disco farebbe salti più larghi di sé stesso
      var move = speedOf(puck) * dt;
      var steps = api.util.clamp(Math.ceil(move / (PUCK_R * 0.8)), 1, 8);
      for (var i = 0; i < steps; i++) {
        if (stepPuck(dt / steps)) return;
      }

      /* Disco che non va da nessuna parte: fermo, in deriva lentissima o
         schiacciato fra mazzuolo e sponda (dove continua a rimbalzare senza
         spostarsi). Si misura lo spostamento reale, non la velocità. */
      if (Math.hypot(puck.x - stallRef.x, puck.y - stallRef.y) > 20) {
        stallRef = { x: puck.x, y: puck.y };
        stall = 0;
      } else {
        stall += dt;
        if (stall > STALL_LIMIT) {
          api.sfx.click();
          possessionTo(puck.y < MID);  // se è fermo nella metà CPU tocca a te
        }
      }
    }

    /* ---------- disegno ---------- */

    function drawRink(ctx) {
      ctx.fillStyle = '#0b1622';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#1f2c3d';
      ctx.lineWidth = WALL * 2;
      ctx.strokeRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(WALL, MID); ctx.lineTo(W - WALL, MID);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W / 2, MID, 46, 0, Math.PI * 2);
      ctx.stroke();

      // aree di porta
      [true, false].forEach(function (top) {
        var half = goalHalf(top);
        ctx.beginPath();
        ctx.arc(W / 2, top ? WALL : H - WALL, half + 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.stroke();

        ctx.fillStyle = top ? 'rgba(248,113,113,0.85)' : 'rgba(74,222,128,0.85)';
        ctx.fillRect(W / 2 - half, top ? 0 : H - WALL, half * 2, WALL);
      });
    }

    function drawMallet(ctx, m, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(5,7,12,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    function draw(ctx) {
      drawRink(ctx);

      // punteggio del set, in filigrana
      ctx.font = 'bold 40px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillText(cpuGoals, W / 2, MID - 60);
      ctx.fillText(myGoals, W / 2, MID + 96);

      // dove sta il dito, così si capisce il legame con il mazzuolo
      var p = api.input.pointer;
      if (grab && p.down) {
        ctx.strokeStyle = 'rgba(74,222,128,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(me.x, me.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawMallet(ctx, cpu, '#f87171');
      drawMallet(ctx, me, '#4ade80');

      ctx.fillStyle = '#e6edf3';
      ctx.beginPath();
      ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(puck.x, puck.y, PUCK_R - 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.55)';
      ctx.fillText('CPU ' + cpuGoals + '/' + TARGET, 12, 22);
      ctx.textAlign = 'right';
      ctx.fillText('TU ' + myGoals + '/' + TARGET, W - 12, H - 14);

      if (flashGoal > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (flashGoal * 0.18).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      if (faceoff > 0) {
        ctx.textAlign = 'center';
        ctx.font = '13px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(230,237,243,0.8)';
        ctx.fillText('rimessa', W / 2, MID - 14);
      } else if (stall > STALL_LIMIT / 2) {
        // avvisa che il possesso sta per passare all'avversario
        ctx.textAlign = 'center';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(Math.ceil(STALL_LIMIT - stall) + 's', puck.x, puck.y - PUCK_R - 8);
      }
    }

    function state() {
      return {
        myGoals: myGoals, cpuGoals: cpuGoals, mode: cpuMode,
        puck: { x: Math.round(puck.x), y: Math.round(puck.y), v: Math.round(speedOf(puck)) },
        cpu: { x: Math.round(cpu.x), y: Math.round(cpu.y) },
        me: { x: Math.round(me.x), y: Math.round(me.y) },
        goalCpu: cfg.goalCpu,
        grabLift: GRAB_LIFT,
        stall: Math.round(stall * 10) / 10
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
