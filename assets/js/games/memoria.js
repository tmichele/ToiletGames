/* Memoria — ripeti la sequenza luminosa (stile Simon).
   Difficoltà: più tasti, sequenze più lunghe, riproduzione più rapida e
   tempo limite per ogni tocco. */
(function () {
'use strict';

var COLORS = ['#4ade80', '#38bdf8', '#fbbf24', '#f87171', '#c084fc', '#22d3ee', '#fb923c', '#a3e635', '#f472b6'];
var TONES = [262, 330, 392, 440, 523, 587, 659, 698, 784];

function config(level) {
  var pads = level <= 2 ? 4 : (level <= 4 ? 6 : 9);
  return {
    level: level,
    pads: pads,
    cols: pads === 4 ? 2 : 3,
    rows: pads === 4 ? 2 : (pads === 6 ? 2 : 3),
    target: 3 + level,                                  // lunghezza da raggiungere
    onTime: Math.max(0.16, 0.5 - level * 0.03),         // durata di ogni lampeggio
    gap: Math.max(0.06, 0.18 - level * 0.012),
    tapTimeout: Math.max(1.1, 3.2 - level * 0.18)       // s a disposizione per tocco
  };
}

TG.registry.register({
  id: 'memoria',
  title: 'Memoria',
  icon: '🧠',
  tagline: 'Guarda la sequenza e rifalla. Ogni giro se ne aggiunge una.',
  scoreLabel: 'Punti',
  controls: 'none',
  viewport: { w: 360, h: 360 },
  howto: '<b>Comandi:</b> tocca i riquadri, oppure usa i tasti <b>1-9</b> ' +
    '(numerati da sinistra a destra, dall\'alto in basso). ' +
    'Dal livello 3 i riquadri diventano 6, dal 5 sono 9.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.pads + ' riquadri, sequenza fino a ' +
      c.target + ', ' + c.tapTimeout.toFixed(1) + 's per tocco';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var PAD = 14;

    var cfg, seq, phase, cursor, timer, litIndex, playIndex, tapClock, flash;

    function padRect(i) {
      var gw = (W - PAD * (cfg.cols + 1)) / cfg.cols;
      var gh = (H - 30 - PAD * (cfg.rows + 1)) / cfg.rows;
      var col = i % cfg.cols, row = Math.floor(i / cfg.cols);
      return {
        x: PAD + col * (gw + PAD),
        y: 30 + PAD + row * (gh + PAD),
        w: gw,
        h: gh
      };
    }

    function addStep() {
      seq.push(api.util.randInt(0, cfg.pads - 1));
    }

    function startWatch() {
      phase = 'watch';
      playIndex = -1;
      litIndex = -1;
      timer = 0.45; // pausa prima di partire
    }

    function start(level) {
      cfg = config(level);
      seq = [];
      flash = null;
      addStep();
      addStep();
      addStep();
      cursor = 0;
      startWatch();
    }

    function lightPad(i) {
      litIndex = i;
      api.sfx.tone(TONES[i % TONES.length], 0.2, 'sine', 0.11);
    }

    function roundComplete() {
      api.addScore(10 * cfg.level);
      if (seq.length >= cfg.target) {
        api.levelComplete({
          bonus: 60 * cfg.level,
          message: 'Sequenza di ' + seq.length + ' ripetuta senza sbagliare.'
        });
        return;
      }
      addStep();
      cursor = 0;
      startWatch();
    }

    function fail(msg) {
      phase = 'ko';
      api.gameOver({ message: msg });
    }

    function handleTap(i) {
      if (phase !== 'input' || i < 0 || i >= cfg.pads) return;
      flash = { index: i, t: 0.18, ok: seq[cursor] === i };
      if (seq[cursor] !== i) {
        api.sfx.tone(140, 0.3, 'sawtooth', 0.12);
        fail('Sbagliato al tocco ' + (cursor + 1) + ' di ' + seq.length + '.');
        return;
      }
      api.sfx.tone(TONES[i % TONES.length], 0.15, 'sine', 0.11);
      api.addScore(2 * cfg.level);
      cursor++;
      tapClock = cfg.tapTimeout;
      if (cursor >= seq.length) roundComplete();
    }

    function hitTest(x, y) {
      for (var i = 0; i < cfg.pads; i++) {
        var r = padRect(i);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
      }
      return -1;
    }

    function update(dt) {
      if (flash) {
        flash.t -= dt;
        if (flash.t <= 0) flash = null;
      }

      if (phase === 'watch') {
        timer -= dt;
        if (timer > 0) return;
        if (litIndex >= 0) {           // spegni e passa alla pausa
          litIndex = -1;
          timer = cfg.gap;
          if (playIndex >= seq.length - 1) {
            phase = 'input';
            cursor = 0;
            tapClock = cfg.tapTimeout + 0.6;
            api.input.reset();
          }
          return;
        }
        playIndex++;
        if (playIndex < seq.length) {
          lightPad(seq[playIndex]);
          timer = cfg.onTime;
        }
        return;
      }

      if (phase !== 'input') return;

      var tap;
      while ((tap = api.input.takeTap())) handleTap(hitTest(tap.x, tap.y));
      var d;
      while ((d = api.input.takeDigit())) handleTap(d - 1);
      while (api.input.take()) { /* le direzioni non servono qui */ }

      if (phase === 'input') {
        tapClock -= dt;
        if (tapClock <= 0) fail('Tempo scaduto al tocco ' + (cursor + 1) + '.');
      }
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText('sequenza ' + seq.length + '/' + cfg.target, 8, 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = phase === 'watch' ? '#38bdf8' : '#4ade80';
      ctx.fillText(phase === 'watch' ? 'GUARDA' : (phase === 'input' ? 'RIPETI ' + cursor + '/' + seq.length : ''), W - 8, 18);

      for (var i = 0; i < cfg.pads; i++) {
        var r = padRect(i);
        var lit = (litIndex === i) || (flash && flash.index === i);
        ctx.globalAlpha = lit ? 1 : 0.32;
        ctx.fillStyle = flash && flash.index === i && !flash.ok ? '#ffffff' : COLORS[i % COLORS.length];
        api.util.roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (lit) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 2;
          api.util.roundRect(ctx, r.x, r.y, r.w, r.h, 12);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(5,7,12,0.55)';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(String(i + 1), r.x + 8, r.y + 20);
      }

      // barra del tempo residuo per il tocco
      if (phase === 'input') {
        var w = api.util.clamp(tapClock / (cfg.tapTimeout + 0.6), 0, 1) * W;
        ctx.fillStyle = tapClock < 1 ? '#f87171' : 'rgba(74,222,128,0.7)';
        ctx.fillRect(0, H - 4, w, 4);
      }
    }

    return { start: start, update: update, draw: draw };
  }
});

})();
