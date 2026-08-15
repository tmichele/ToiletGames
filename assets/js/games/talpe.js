/* Talpe — whack a mole.
   Colpisci le talpe che spuntano dalle buche prima che rientrino, senza
   prendere le bombe. Ogni livello ha un obiettivo di talpe e un tempo per
   raggiungerlo.
   Difficoltà: talpe più rapide e più numerose, bombe dal terzo livello,
   obiettivo più alto e meno tempo. */
(function () {
'use strict';

var COLS = 3, ROWS = 3;
var STREAK_MAX = 3;     // moltiplicatore massimo per colpi consecutivi
var LIVES = 3;

function config(level) {
  return {
    level: level,
    /* Quanto resta fuori la talpa: è la leva principale della difficoltà e cala
       in fretta, da un secondo e mezzo abbondante a poco più di un terzo. */
    upTime: Math.max(0.38, 1.6 - level * 0.13),       // s in cui la talpa resta fuori
    spawnEvery: Math.max(0.35, 1.25 - level * 0.06),  // s fra due uscite
    maxUp: Math.min(1 + Math.floor(level / 2), 5),    // talpe contemporanee
    /* Anche l'uscita si accorcia: ai primi livelli la talpa spunta con calma,
       agli ultimi è già fuori prima che tu l'abbia messa a fuoco. */
    salita: Math.max(0.04, 0.18 - level * 0.015),
    bombChance: level >= 3 ? Math.min(0.10 + (level - 3) * 0.03, 0.35) : 0,
    /* Ogni tanto i due grigi sono scambiati: se il colore fosse sempre lo
       stesso diventerebbe una scorciatoia, e basterebbe imparare la tinta
       invece di guardare la miccia. */
    invertiChance: level >= 3 ? Math.min(0.12 + (level - 3) * 0.04, 0.45) : 0,
    target: 8 + level * 2,                            // talpe da prendere
    levelTime: Math.max(20, 42 - level),              // s a disposizione
    points: 10 * level,
    missMalus: 4 * level                              // colpo a vuoto
  };
}

TG.registry.register({
  id: 'talpe',
  title: 'Talpe',
  icon: '🐹',
  tagline: 'Spuntano, le colpisci, rientrano. Occhio alle bombe.',
  scoreLabel: 'Punti',
  controls: 'none',
  viewport: { w: 360, h: 420 },
  howto: '<b>Comandi:</b> tocca la buca, oppure i tasti <b>1-9</b> ' +
    '(numerati da sinistra a destra, dall\'alto in basso). ' +
    'Colpi consecutivi senza sbagliare valgono fino a ×' + STREAK_MAX + '. ' +
    'Colpire a vuoto toglie punti e azzera la serie; le <b>bombe</b> (dal terzo ' +
    'livello) costano una vita. Il livello finisce quando prendi tutte le talpe ' +
    'richieste: se scade il tempo prima, la partita è finita.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.target + ' talpe in ' + c.levelTime + 's, ' +
      'restano fuori ' + c.upTime.toFixed(2) + 's' +
      (c.bombChance ? ', bombe e colori scambiati' : '');
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var TOP = 54;                       // spazio per obiettivo e tempo
    var cellW = W / COLS;
    var cellH = (H - TOP) / ROWS;

    var cfg, holes, spawnTimer, timeLeft, presi, lives, streak, shake, floaters;

    function holeCenter(i) {
      var col = i % COLS, row = Math.floor(i / COLS);
      return { x: col * cellW + cellW / 2, y: TOP + row * cellH + cellH / 2 + 6 };
    }

    function start(level) {
      cfg = config(level);
      holes = [];
      for (var i = 0; i < COLS * ROWS; i++) holes.push({ occupante: null });
      spawnTimer = 0.4;
      timeLeft = cfg.levelTime;
      presi = 0;
      streak = 0;
      shake = 0;
      floaters = [];
      if (lives == null || level === 1) lives = LIVES;   // le vite valgono per la partita
    }

    function liberi() {
      var out = [];
      for (var i = 0; i < holes.length; i++) if (!holes[i].occupante) out.push(i);
      return out;
    }

    function occupate() {
      var n = 0;
      for (var i = 0; i < holes.length; i++) if (holes[i].occupante) n++;
      return n;
    }

    function spawn() {
      var free = liberi();
      if (!free.length || occupate() >= cfg.maxUp) return;
      var i = api.util.pick(free);
      holes[i].occupante = {
        tipo: Math.random() < cfg.bombChance ? 'bomba' : 'talpa',
        invertito: Math.random() < cfg.invertiChance,
        vita: cfg.upTime,
        eta: 0
      };
    }

    function nota(testo, i, colore) {
      var c = holeCenter(i);
      floaters.push({ text: testo, x: c.x, y: c.y - 20, t: 0.7, color: colore });
    }

    function colpisci(i) {
      if (i < 0 || i >= holes.length) return;
      var o = holes[i].occupante;

      if (!o) {                                   // colpo a vuoto
        streak = 0;
        api.addScore(-cfg.missMalus);
        nota('−' + cfg.missMalus, i, '#f87171');
        api.sfx.tone(180, 0.08, 'square', 0.06);
        return;
      }

      if (o.tipo === 'bomba') {
        holes[i].occupante = null;
        streak = 0;
        lives--;
        shake = 0.35;
        nota('💥', i, '#f87171');
        api.sfx.fail();
        if (lives <= 0) {
          api.gameOver({ message: 'Bomba di troppo al livello ' + cfg.level + '.' });
        }
        return;
      }

      holes[i].occupante = null;
      streak = Math.min(streak + 1, STREAK_MAX);
      presi++;
      var pts = cfg.points * streak;
      api.addScore(pts);
      nota('+' + pts + (streak > 1 ? ' ×' + streak : ''), i, streak > 1 ? '#fbbf24' : '#4ade80');
      api.sfx.pick();

      if (presi >= cfg.target) {
        api.levelComplete({
          bonus: 50 * cfg.level + Math.round(timeLeft) * 5,
          message: 'Obiettivo centrato con ' + timeLeft.toFixed(0) + 's di anticipo.'
        });
      }
    }

    function update(dt) {
      var tap;
      while ((tap = api.input.takeTap())) colpisci(indiceDa(tap.x, tap.y));
      var d;
      while ((d = api.input.takeDigit())) colpisci(d - 1);
      while (api.input.take()) { /* le direzioni non servono */ }

      if (shake > 0) shake -= dt;
      for (var f = floaters.length - 1; f >= 0; f--) {
        floaters[f].t -= dt;
        floaters[f].y -= 24 * dt;
        if (floaters[f].t <= 0) floaters.splice(f, 1);
      }

      timeLeft -= dt;
      if (timeLeft <= 0) {
        api.gameOver({
          message: 'Tempo scaduto: ' + presi + ' talpe su ' + cfg.target + '.'
        });
        return;
      }

      // uscite
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = cfg.spawnEvery;
        spawn();
      }

      // rientri
      for (var i = 0; i < holes.length; i++) {
        var o = holes[i].occupante;
        if (!o) continue;
        o.eta += dt;
        o.vita -= dt;
        if (o.vita <= 0) {
          holes[i].occupante = null;
          if (o.tipo === 'talpa') streak = 0;   // scappata: serie interrotta
        }
      }
    }

    function indiceDa(x, y) {
      if (y < TOP) return -1;
      var col = Math.floor(x / cellW);
      var row = Math.floor((y - TOP) / cellH);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
      return row * COLS + col;
    }

    /* ---------- disegno ---------- */

    function drawTalpa(ctx, c, o, raggio) {
      // quanto è uscita: la salita (e il rientro) accelerano con il livello
      var quota = Math.min(1, o.eta / cfg.salita, o.vita / cfg.salita);
      var r = raggio * (0.55 + 0.45 * quota);
      var y = c.y - r * 0.25 * quota;

      /* Talpe e bombe hanno quasi lo stesso grigio, e ogni tanto se lo
         scambiano: a distinguerle è la miccia, non il colore. */
      var grigioBomba = '#4b5563', grigioTalpa = '#6b7280';
      var suo = o.tipo === 'bomba' ? grigioBomba : grigioTalpa;
      var altro = o.tipo === 'bomba' ? grigioTalpa : grigioBomba;
      ctx.fillStyle = o.invertito ? altro : suo;
      ctx.beginPath();
      ctx.arc(c.x, y, r, Math.PI, 0);
      ctx.lineTo(c.x + r, y + r * 0.35);
      ctx.lineTo(c.x - r, y + r * 0.35);
      ctx.closePath();
      ctx.fill();

      if (o.tipo === 'bomba') {
        ctx.strokeStyle = '#f87171';           // miccia
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c.x, y - r);
        ctx.quadraticCurveTo(c.x + 8, y - r - 10, c.x + 14, y - r - 4);
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(c.x + 14, y - r - 4, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#0b0f18';             // occhi
        ctx.beginPath();
        ctx.arc(c.x - r * 0.32, y - r * 0.3, r * 0.11, 0, Math.PI * 2);
        ctx.arc(c.x + r * 0.32, y - r * 0.3, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9ca3af';             // muso, appena più chiaro del corpo
        ctx.beginPath();
        ctx.arc(c.x, y - r * 0.05, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function draw(ctx) {
      ctx.save();
      if (shake > 0) ctx.translate(api.util.randFloat(-3, 3), api.util.randFloat(-3, 3));

      ctx.fillStyle = '#0b1220';
      ctx.fillRect(-4, -4, W + 8, H + 8);

      // barra del tempo
      var frazione = api.util.clamp(timeLeft / cfg.levelTime, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(12, 30, W - 24, 8);
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : '#38bdf8';
      ctx.fillRect(12, 30, (W - 24) * frazione, 8);

      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.fillText('talpe ' + presi + '/' + cfg.target, 12, 20);
      ctx.textAlign = 'center';
      ctx.fillStyle = streak > 1 ? '#fbbf24' : 'rgba(230,237,243,0.5)';
      ctx.fillText(streak > 1 ? 'serie ×' + streak : '', W / 2, 20);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.fillText('vite ' + '●'.repeat(Math.max(0, lives)), W - 12, 20);

      var raggio = Math.min(cellW, cellH) * 0.3;
      for (var i = 0; i < holes.length; i++) {
        var c = holeCenter(i);

        ctx.fillStyle = '#050810';                  // buca
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + raggio * 0.35, raggio * 1.15, raggio * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.stroke();

        if (holes[i].occupante) drawTalpa(ctx, c, holes[i].occupante, raggio);

        ctx.fillStyle = 'rgba(255,255,255,0.14)';   // numero della buca
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(i + 1), c.x - cellW / 2 + 6, c.y - cellH / 2 + 14);
      }

      floaters.forEach(function (fl) {
        ctx.globalAlpha = api.util.clamp(fl.t / 0.7, 0, 1);
        ctx.fillStyle = fl.color;
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fl.text, fl.x, fl.y);
        ctx.globalAlpha = 1;
      });

      ctx.restore();
    }

    function state() {
      return {
        presi: presi, target: cfg.target, lives: lives, streak: streak,
        timeLeft: Math.round(timeLeft * 10) / 10,
        buche: holes.map(function (h, i) {
          var c = holeCenter(i);
          return {
            i: i, x: Math.round(c.x), y: Math.round(c.y),
            tipo: h.occupante ? h.occupante.tipo : null,
            invertito: h.occupante ? !!h.occupante.invertito : false,
            vita: h.occupante ? Math.round(h.occupante.vita * 100) / 100 : 0,
            eta: h.occupante ? Math.round(h.occupante.eta * 100) / 100 : 0
          };
        })
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
