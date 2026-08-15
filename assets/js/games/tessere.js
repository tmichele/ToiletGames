/* Tessere — il rompicapo scorrevole (il "quindici").

   Campo quadrato, tessere numerate e una casella vuota: si fanno scorrere le
   tessere adiacenti al buco finché i numeri non tornano in ordine.

   Difficoltà: griglia più grande e mescolamento più profondo. Il tempo cresce
   con il lato della griglia — un 4×4 non è un 3×3 un po' più lungo, è un altro
   ordine di grandezza — e cala solo di poco salendo di livello.

   Il mescolamento si fa partendo dalla posizione risolta e tirando mosse legali
   a caso: così la configurazione è risolvibile per costruzione. Mescolare
   piazzando le tessere a caso produrrebbe una partita su due impossibile, e il
   giocatore non avrebbe modo di saperlo. */
(function () {
'use strict';

function config(level) {
  var n = level <= 2 ? 3 : (level <= 6 ? 4 : 5);
  var mescola = Math.min(10 + level * 6, 120);
  /* Il tempo dipende soprattutto dal lato della griglia: passare da 3×3 a 4×4
     non raddoppia la fatica, la moltiplica. Una persona che ragiona muove circa
     una tessera al secondo e ne usa molte più del minimo teorico, quindi le
     basi qui sotto sono tarate su quel passo, non sulla soluzione ottima. */
  var basePerLato = { 3: 60, 4: 115, 5: 175 }[n];
  return {
    level: level,
    n: n,
    mescola: mescola,
    tempo: Math.min(Math.max(50, basePerLato + mescola * 0.6 - level * 1.5), 210),
    puntiTessera: 10 * level
  };
}

TG.registry.register({
  id: 'tessere',
  title: 'Tessere',
  icon: '🔢',
  tagline: 'Fai scorrere i numeri finché non tornano in ordine.',
  scoreLabel: 'Punti',
  controls: 'dpad',
  viewport: { w: 360, h: 430 },
  howto: '<b>Comandi:</b> tocca una tessera adiacente alla casella vuota per ' +
    'farla scorrere, oppure usa le frecce/WASD: la freccia indica da quale lato ' +
    'arriva la tessera che entra nel buco. ' +
    'Le tessere già al loro posto diventano verdi. ' +
    'Il livello finisce quando i numeri sono in ordine con il buco in fondo a ' +
    'destra: se scade il tempo prima, la partita è finita. Il tempo concesso ' +
    'tiene conto della griglia: un minuto scarso per il 3×3, due per il 4×4, ' +
    'oltre tre per il 5×5.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': griglia ' + c.n + '×' + c.n + ', ' +
      c.mescola + ' mosse di mescolamento, ' + Math.round(c.tempo) + 's';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var TOP = 58;

    var cfg, griglia, buco, mosse, timeLeft, lato, offX, offY, migliori, ultima, risolto;

    /* La griglia è un array piatto: 0 è il buco, i numeri sono 1..n²-1. */
    function indice(r, c) { return r * cfg.n + c; }
    function riga(i) { return Math.floor(i / cfg.n); }
    function colonna(i) { return i % cfg.n; }

    function ordinata() {
      var g = [];
      for (var i = 0; i < cfg.n * cfg.n - 1; i++) g.push(i + 1);
      g.push(0);
      return g;
    }

    function vicini(i) {
      var out = [];
      var r = riga(i), c = colonna(i);
      if (r > 0) out.push(indice(r - 1, c));
      if (r < cfg.n - 1) out.push(indice(r + 1, c));
      if (c > 0) out.push(indice(r, c - 1));
      if (c < cfg.n - 1) out.push(indice(r, c + 1));
      return out;
    }

    function scambia(i, j) {
      var t = griglia[i];
      griglia[i] = griglia[j];
      griglia[j] = t;
    }

    /* Mescola tirando mosse legali: la posizione resta risolvibile.
       Si evita di annullare subito la mossa precedente, altrimenti il
       mescolamento gira su sé stesso e resta vicino alla soluzione. */
    function mescola() {
      var precedente = -1;
      for (var k = 0; k < cfg.mescola; k++) {
        var scelte = vicini(buco).filter(function (v) { return v !== precedente; });
        if (!scelte.length) scelte = vicini(buco);
        var scelto = api.util.pick(scelte);
        precedente = buco;
        scambia(buco, scelto);
        buco = scelto;
      }
      // se il caso ha restituito la griglia già in ordine, una spinta in più
      if (contaGiuste() === cfg.n * cfg.n - 1) {
        var v = api.util.pick(vicini(buco));
        scambia(buco, v);
        buco = v;
      }
    }

    function contaGiuste() {
      var n = 0;
      for (var i = 0; i < griglia.length; i++) {
        if (griglia[i] !== 0 && griglia[i] === i + 1) n++;
      }
      return n;
    }

    function inOrdine() {
      return contaGiuste() === cfg.n * cfg.n - 1 && griglia[griglia.length - 1] === 0;
    }

    function start(level) {
      cfg = config(level);
      lato = Math.min(W - 24, H - TOP - 16);
      offX = (W - lato) / 2;
      offY = TOP;
      griglia = ordinata();
      buco = griglia.length - 1;
      mescola();
      mosse = 0;
      timeLeft = cfg.tempo;
      migliori = contaGiuste();
      ultima = -1;
      risolto = false;
    }

    /* ---------- mosse ---------- */

    function muovi(i) {
      if (risolto || i < 0 || i >= griglia.length || griglia[i] === 0) return;
      if (vicini(buco).indexOf(i) < 0) {
        api.sfx.tone(150, 0.06, 'square', 0.05);   // tessera non adiacente
        return;
      }
      scambia(buco, i);
      ultima = buco;      // dove è finita la tessera mossa
      buco = i;
      mosse++;
      api.sfx.tone(420, 0.05, 'square', 0.06);

      /* Punti quando il numero di tessere a posto supera il massimo raggiunto:
         così sistemare paga, ma smontare e rimontare la stessa tessera no. */
      var giuste = contaGiuste();
      if (giuste > migliori) {
        api.addScore(cfg.puntiTessera * (giuste - migliori));
        migliori = giuste;
      }

      if (inOrdine()) {
        risolto = true;
        api.levelComplete({
          bonus: 100 * cfg.level + Math.round(timeLeft) * 4,
          message: 'Risolto in ' + mosse + ' mosse, con ' + timeLeft.toFixed(0) + 's di anticipo.'
        });
      }
    }

    /* La freccia dice da dove arriva la tessera che entra nel buco:
       "su" fa scendere quella sopra, come sui rompicapi veri. */
    function muoviDirezione(dir) {
      var r = riga(buco), c = colonna(buco);
      if (dir === 'up' && r > 0) muovi(indice(r - 1, c));
      else if (dir === 'down' && r < cfg.n - 1) muovi(indice(r + 1, c));
      else if (dir === 'left' && c > 0) muovi(indice(r, c - 1));
      else if (dir === 'right' && c < cfg.n - 1) muovi(indice(r, c + 1));
    }

    function tesseraDa(x, y) {
      if (x < offX || x > offX + lato || y < offY || y > offY + lato) return -1;
      var passo = lato / cfg.n;
      var c = Math.floor((x - offX) / passo);
      var r = Math.floor((y - offY) / passo);
      if (r < 0 || r >= cfg.n || c < 0 || c >= cfg.n) return -1;
      return indice(r, c);
    }

    function update(dt) {
      var tap;
      while ((tap = api.input.takeTap())) muovi(tesseraDa(tap.x, tap.y));
      var a;
      while ((a = api.input.take())) {
        if (a !== 'action') muoviDirezione(a);
      }
      var d;
      while ((d = api.input.takeDigit())) { /* i numeri non servono qui */ }

      if (risolto) return;
      timeLeft -= dt;
      if (timeLeft <= 0) {
        api.gameOver({
          message: contaGiuste() + ' tessere a posto su ' + (cfg.n * cfg.n - 1) + ' allo scadere.'
        });
      }
    }

    /* ---------- disegno ---------- */

    function draw(ctx) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, H);

      // tempo e mosse
      var frazione = api.util.clamp(timeLeft / cfg.tempo, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(12, 34, W - 24, 8);
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : '#38bdf8';
      ctx.fillRect(12, 34, (W - 24) * frazione, 8);

      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.fillText('a posto ' + contaGiuste() + '/' + (cfg.n * cfg.n - 1), 12, 22);
      // su livelli da minuti la sola barra non basta: serve il numero
      ctx.textAlign = 'center';
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : 'rgba(230,237,243,0.8)';
      var resti = Math.max(0, Math.ceil(timeLeft));
      ctx.fillText(Math.floor(resti / 60) + ':' + ('0' + (resti % 60)).slice(-2), W / 2, 22);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.fillText('mosse ' + mosse, W - 12, 22);

      // cornice
      ctx.fillStyle = '#0f172a';
      api.util.roundRect(ctx, offX - 6, offY - 6, lato + 12, lato + 12, 12);
      ctx.fill();

      var passo = lato / cfg.n;
      for (var i = 0; i < griglia.length; i++) {
        var v = griglia[i];
        if (v === 0) continue;
        var x = offX + colonna(i) * passo;
        var y = offY + riga(i) * passo;
        var giusta = v === i + 1;

        ctx.fillStyle = giusta ? '#166534' : '#1e293b';
        api.util.roundRect(ctx, x + 3, y + 3, passo - 6, passo - 6, 8);
        ctx.fill();

        if (i === ultima) {                       // ultima tessera mossa
          ctx.strokeStyle = 'rgba(56,189,248,0.7)';
          ctx.lineWidth = 2;
          api.util.roundRect(ctx, x + 3, y + 3, passo - 6, passo - 6, 8);
          ctx.stroke();
        }

        ctx.fillStyle = giusta ? '#bbf7d0' : '#e6edf3';
        ctx.font = 'bold ' + Math.round(passo * 0.36) + 'px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), x + passo / 2, y + passo / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      }

      // il buco: si segna appena, per dare il riferimento
      var bx = offX + colonna(buco) * passo, by = offY + riga(buco) * passo;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      api.util.roundRect(ctx, bx + 3, by + 3, passo - 6, passo - 6, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function state() {
      return {
        n: cfg.n,
        griglia: griglia.slice(),
        buco: buco,
        mosse: mosse,
        giuste: contaGiuste(),
        risolto: risolto,
        timeLeft: Math.round(timeLeft * 10) / 10,
        /* Centri delle caselle: i test toccano dove toccherebbe una persona. */
        caselle: griglia.map(function (v, i) {
          var passo = lato / cfg.n;
          return {
            i: i, valore: v,
            x: offX + colonna(i) * passo + passo / 2,
            y: offY + riga(i) * passo + passo / 2
          };
        })
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
