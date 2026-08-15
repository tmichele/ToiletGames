/* Labirinto — vista in prima persona, senza mappa.

   La pianta dall'alto non si vede mai: per orientarsi restano i dettagli delle
   pareti e del pavimento (ogni muro ha la sua fascia colorata e il suo segno,
   sempre gli stessi in quel punto), gli alberi che spuntano oltre i muri e una
   bussola che indica dove sta l'uscita — la direzione, non la strada.

   La scena è disegnata con il raycasting sul canvas 2D: niente WebGL, quindi
   funziona ovunque funzioni il resto della suite.

   Il labirinto è generato col backtracking ricorsivo: è perfetto, cioè fra due
   punti qualsiasi esiste una strada e una sola, quindi l'uscita è sempre
   raggiungibile e non serve verificarlo a posteriori. */
(function () {
'use strict';

var FOV = Math.PI / 3;          // 60°: campo visivo che non deforma troppo
/* Muri più bassi di una cella intera, altrimenti riempiono lo schermo: nei
   corridoi si è sempre a mezzo metro da una parete e non si vedrebbe più nulla
   sopra — né cielo né alberi, che sono l'unico riferimento lontano. */
var ALTEZZA_MURO = 0.56;
var OCCHIO = ALTEZZA_MURO / 2;  // altezza dello sguardo, a metà parete
var RAGGIO = 0.22;              // ingombro del giocatore, per le collisioni

function config(level) {
  var celle = Math.min(4 + level, 11);          // celle per lato del labirinto
  return {
    level: level,
    celle: celle,
    lato: celle * 2 + 1,                        // griglia muri+corridoi
    tempo: Math.max(45, 40 + celle * 14 - level * 3),
    alberi: Math.max(4, 9 - Math.floor(level / 3)),  // meno punti di riferimento
    nebbia: Math.max(4.5, 11 - level * 0.5),    // oltre questa distanza si perde nel buio
    passo: 2.1,                                 // celle al secondo
    rotazione: 2.2                              // radianti al secondo
  };
}

TG.registry.register({
  id: 'labirinto',
  title: 'Labirinto',
  icon: '🧭',
  tagline: 'Trova l\'uscita in prima persona. Mappa non pervenuta.',
  scoreLabel: 'Punti',
  controls: 'joystick',
  viewport: { w: 360, h: 400 },
  howto: '<b>Comandi:</b> la leva sotto il campo — avanti/indietro per muoverti, ' +
    'destra/sinistra per girarti — oppure le frecce/WASD. ' +
    'Con ⏸ metti in pausa quando vuoi. ' +
    '<b>Niente mappa:</b> per orientarti hai la <b>bussola</b> in alto, che punta ' +
    'sempre verso l\'uscita ma non conosce i corridoi, gli <b>alberi</b> che si ' +
    'vedono oltre i muri (stanno fermi: sono il tuo nord) e i <b>dettagli</b> di ' +
    'pareti e pavimento, diversi zona per zona e sempre uguali a sé stessi. ' +
    'L\'uscita è la porta verde.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': labirinto ' + c.celle + '×' + c.celle + ', ' +
      Math.round(c.tempo) + 's, ' + c.alberi + ' alberi di riferimento';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var TOP = 44;                       // fascia della bussola
    var VH = H - TOP;                   // altezza della vista in prima persona
    var STRISCIA = 3;                   // px per raggio: compromesso resa/velocità

    var cfg, mappa, giocatore, uscita, alberi, timeLeft, finito, visitate, semi;

    /* ---------- generazione ---------- */

    function idx(x, y) { return y * cfg.lato + x; }
    function muro(x, y) {
      if (x < 0 || y < 0 || x >= cfg.lato || y >= cfg.lato) return true;
      return mappa[idx(x, y)] === 1;
    }

    function generaLabirinto() {
      mappa = [];
      var i;
      for (i = 0; i < cfg.lato * cfg.lato; i++) mappa.push(1);

      var pila = [{ x: 1, y: 1 }];
      mappa[idx(1, 1)] = 0;
      while (pila.length) {
        var cur = pila[pila.length - 1];
        var vicini = [];
        [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(function (d) {
          var nx = cur.x + d[0], ny = cur.y + d[1];
          if (nx > 0 && ny > 0 && nx < cfg.lato - 1 && ny < cfg.lato - 1 &&
              mappa[idx(nx, ny)] === 1) {
            vicini.push({ x: nx, y: ny, mx: cur.x + d[0] / 2, my: cur.y + d[1] / 2 });
          }
        });
        if (!vicini.length) { pila.pop(); continue; }
        var scelto = api.util.pick(vicini);
        mappa[idx(scelto.mx, scelto.my)] = 0;
        mappa[idx(scelto.x, scelto.y)] = 0;
        pila.push({ x: scelto.x, y: scelto.y });
      }
    }

    /* Semi per i dettagli: ogni muro ha una tinta e un segno fissi, ricavati
       dalle sue coordinate. Sono i riferimenti con cui ci si orienta, quindi
       devono restare identici per tutta la partita. */
    function seme(x, y) {
      var n = Math.sin(x * 127.1 + y * 311.7 + semi) * 43758.5453;
      return n - Math.floor(n);
    }

    function coloreMuro(x, y, lato) {
      var s = seme(x, y);
      var tinta = Math.floor(s * 5);
      var base = [
        [120, 113, 108], [125, 105, 90], [100, 116, 120], [118, 110, 130], [110, 120, 105]
      ][tinta];
      var ombra = lato === 1 ? 0.74 : 1;         // pareti nord/sud più scure
      return { r: base[0] * ombra, g: base[1] * ombra, b: base[2] * ombra, s: s };
    }

    function piazzaAlberi() {
      alberi = [];
      var raggio = cfg.lato * 0.75;
      for (var i = 0; i < cfg.alberi; i++) {
        var ang = (i / cfg.alberi) * Math.PI * 2 + seme(i, 7) * 0.4;
        alberi.push({
          x: cfg.lato / 2 + Math.cos(ang) * raggio,
          y: cfg.lato / 2 + Math.sin(ang) * raggio,
          /* Alti il triplo dei muri: devono sporgere da lontano, sennò non
             servono a orientarsi. */
          h: 3.4 + seme(i, 13) * 2.4,
          tinta: Math.floor(seme(i, 21) * 4),
          forma: seme(i, 31) > 0.5 ? 'conica' : 'tonda'
        });
      }
    }

    function start(level) {
      cfg = config(level);
      semi = Math.floor(Math.random() * 10000);
      generaLabirinto();

      // uscita nell'angolo opposto, marcata come porta
      uscita = { x: cfg.lato - 2, y: cfg.lato - 2 };
      mappa[idx(uscita.x, uscita.y)] = 0;

      /* Si parte guardando lungo un corridoio aperto: iniziare col naso contro
         il muro dell'angolo è solo disorientante. */
      var direzioni = [
        { dx: 1, dy: 0, ang: 0 }, { dx: 0, dy: 1, ang: Math.PI / 2 },
        { dx: -1, dy: 0, ang: Math.PI }, { dx: 0, dy: -1, ang: -Math.PI / 2 }
      ];
      var guarda = 0;
      for (var k = 0; k < direzioni.length; k++) {
        if (!muro(1 + direzioni[k].dx, 1 + direzioni[k].dy)) { guarda = direzioni[k].ang; break; }
      }
      giocatore = { x: 1.5, y: 1.5, ang: guarda };
      piazzaAlberi();
      timeLeft = cfg.tempo;
      finito = false;
      visitate = {};
      visitate['1,1'] = true;
    }

    /* ---------- movimento ---------- */

    function libero(x, y) {
      // il giocatore ha un ingombro: si controllano i quattro spigoli
      return !muro(Math.floor(x - RAGGIO), Math.floor(y - RAGGIO)) &&
             !muro(Math.floor(x + RAGGIO), Math.floor(y - RAGGIO)) &&
             !muro(Math.floor(x - RAGGIO), Math.floor(y + RAGGIO)) &&
             !muro(Math.floor(x + RAGGIO), Math.floor(y + RAGGIO));
    }

    function muovi(dt) {
      var avanti = 0, giro = 0;
      var st = api.input.stick;

      if (st && st.attiva) {
        avanti = -st.y;      // leva in su = avanti
        giro = st.x;
      }
      if (api.input.isDown('up')) avanti += 1;
      if (api.input.isDown('down')) avanti -= 1;
      if (api.input.isDown('left')) giro -= 1;
      if (api.input.isDown('right')) giro += 1;

      avanti = api.util.clamp(avanti, -1, 1);
      giro = api.util.clamp(giro, -1, 1);

      giocatore.ang += giro * cfg.rotazione * dt;

      var d = avanti * cfg.passo * dt;
      if (d !== 0) {
        var nx = giocatore.x + Math.cos(giocatore.ang) * d;
        var ny = giocatore.y + Math.sin(giocatore.ang) * d;
        // si scivola lungo i muri invece di incastrarsi
        if (libero(nx, giocatore.y)) giocatore.x = nx;
        if (libero(giocatore.x, ny)) giocatore.y = ny;
      }

      var cx = Math.floor(giocatore.x), cy = Math.floor(giocatore.y);
      var chiave = cx + ',' + cy;
      if (!visitate[chiave]) {
        visitate[chiave] = true;      // esplorare paga, girare in tondo no
        api.addScore(2 * cfg.level);
      }

      if (cx === uscita.x && cy === uscita.y && !finito) {
        finito = true;
        api.sfx.levelUp();
        api.levelComplete({
          bonus: 120 * cfg.level + Math.round(timeLeft) * 3,
          message: 'Uscita trovata con ' + timeLeft.toFixed(0) + 's di anticipo.'
        });
      }
    }

    function update(dt) {
      while (api.input.take()) { /* qui contano i tasti tenuti */ }
      if (finito) return;
      muovi(dt);
      timeLeft -= dt;
      if (timeLeft <= 0) {
        finito = true;
        api.gameOver({ message: 'Tempo scaduto dentro al labirinto.' });
      }
    }

    /* ---------- disegno ---------- */

    function ombreggia(c, dist) {
      var f = api.util.clamp(1 - dist / cfg.nebbia, 0.12, 1);
      return 'rgb(' + Math.round(c.r * f) + ',' + Math.round(c.g * f) + ',' + Math.round(c.b * f) + ')';
    }

    /* Pavimento a scacchi con qualche piastrella colorata: dà il senso del
       movimento e, soprattutto, rende diversi fra loro i corridoi. */
    function drawPavimento(ctx) {
      var orizzonte = TOP + VH / 2;
      var cosA = Math.cos(giocatore.ang), sinA = Math.sin(giocatore.ang);
      var piano = (W / 2) / Math.tan(FOV / 2);
      var passoRiga = 3, passoCol = 12;

      for (var y = orizzonte + 2; y < TOP + VH; y += passoRiga) {
        var dist = (OCCHIO * piano) / (y - orizzonte);
        if (dist > cfg.nebbia * 1.2) continue;
        var buio = api.util.clamp(1 - dist / cfg.nebbia, 0.05, 1);

        for (var x = 0; x < W; x += passoCol) {
          var cameraX = 2 * (x + passoCol / 2) / W - 1;
          var rx = cosA - sinA * Math.tan(FOV / 2) * cameraX;
          var ry = sinA + cosA * Math.tan(FOV / 2) * cameraX;
          var wx = giocatore.x + rx * dist;
          var wy = giocatore.y + ry * dist;
          var cellaX = Math.floor(wx), cellaY = Math.floor(wy);
          var s = seme(cellaX * 3 + 1, cellaY * 3 + 1);
          var scacco = ((Math.floor(wx * 2) + Math.floor(wy * 2)) % 2 + 2) % 2;
          var base = scacco ? 46 : 38;
          var r = base, g = base, b = base + 4;
          if (s > 0.86) { r = 70; g = 58; b = 40; }        // piastrella "diversa"
          ctx.fillStyle = 'rgb(' + Math.round(r * buio) + ',' + Math.round(g * buio) + ',' +
            Math.round(b * buio) + ')';
          ctx.fillRect(x, y, passoCol + 1, passoRiga + 1);
        }
      }
    }

    function drawAlberi(ctx) {
      var orizzonte = TOP + VH / 2;
      var cosA = Math.cos(giocatore.ang), sinA = Math.sin(giocatore.ang);
      var piano = (W / 2) / Math.tan(FOV / 2);

      alberi.forEach(function (a) {
        var dx = a.x - giocatore.x, dy = a.y - giocatore.y;
        // in coordinate camera: z avanti, s laterale
        var z = dx * cosA + dy * sinA;
        if (z <= 0.4) return;
        var lat = -dx * sinA + dy * cosA;
        var sx = W / 2 + (lat / z) * piano;
        if (sx < -80 || sx > W + 80) return;

        var altezza = (a.h / z) * piano;      // altezza dell'albero sullo schermo
        var largh = altezza * 0.45;
        var baseY = orizzonte + (OCCHIO / z) * piano;   // dove poggia, sul piano

        /* Ogni albero ha tinta e sagoma sue: sono i punti cardinali del
           labirinto, quindi devono distinguersi uno dall'altro anche a colpo
           d'occhio, non solo dalla posizione. */
        var verdi = ['#3f8f4e', '#2f6d3a', '#5aa15f', '#26734f'];
        ctx.fillStyle = '#3f3226';
        ctx.fillRect(sx - largh * 0.1, baseY - altezza * 0.45, largh * 0.2, altezza * 0.45);

        ctx.fillStyle = verdi[a.tinta % verdi.length];
        if (a.forma === 'conica') {
          for (var k = 0; k < 3; k++) {              // tre falde sovrapposte
            var top = altezza * (1 - k * 0.22);
            var giu = altezza * (0.62 - k * 0.2);
            ctx.beginPath();
            ctx.moveTo(sx, baseY - top);
            ctx.lineTo(sx + largh * (0.35 + k * 0.12), baseY - giu);
            ctx.lineTo(sx - largh * (0.35 + k * 0.12), baseY - giu);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          ctx.beginPath();
          ctx.arc(sx, baseY - altezza * 0.72, largh * 0.52, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx - largh * 0.32, baseY - altezza * 0.52, largh * 0.34, 0, Math.PI * 2);
          ctx.arc(sx + largh * 0.32, baseY - altezza * 0.52, largh * 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    /* Raycasting: per ogni striscia verticale si cerca il primo muro colpito
       (DDA) e se ne disegna la fetta, con il dettaglio che ne fa un posto
       riconoscibile invece di una parete qualunque. */
    function drawMuri(ctx) {
      var orizzonte = TOP + VH / 2;
      var cosA = Math.cos(giocatore.ang), sinA = Math.sin(giocatore.ang);
      var piano = (W / 2) / Math.tan(FOV / 2);

      for (var x = 0; x < W; x += STRISCIA) {
        var cameraX = 2 * (x + STRISCIA / 2) / W - 1;
        var rx = cosA - sinA * Math.tan(FOV / 2) * cameraX;
        var ry = sinA + cosA * Math.tan(FOV / 2) * cameraX;

        var mapX = Math.floor(giocatore.x), mapY = Math.floor(giocatore.y);
        var deltaX = Math.abs(1 / (rx || 1e-6)), deltaY = Math.abs(1 / (ry || 1e-6));
        var stepX, stepY, sideX, sideY;

        if (rx < 0) { stepX = -1; sideX = (giocatore.x - mapX) * deltaX; }
        else { stepX = 1; sideX = (mapX + 1 - giocatore.x) * deltaX; }
        if (ry < 0) { stepY = -1; sideY = (giocatore.y - mapY) * deltaY; }
        else { stepY = 1; sideY = (mapY + 1 - giocatore.y) * deltaY; }

        var colpito = false, lato = 0, passi = 0;
        while (!colpito && passi < 64) {
          if (sideX < sideY) { sideX += deltaX; mapX += stepX; lato = 0; }
          else { sideY += deltaY; mapY += stepY; lato = 1; }
          if (muro(mapX, mapY)) colpito = true;
          passi++;
        }
        if (!colpito) continue;

        var dist = lato === 0 ? (sideX - deltaX) : (sideY - deltaY);
        if (dist < 0.02) dist = 0.02;

        var h = (ALTEZZA_MURO / dist) * piano;
        var y0 = orizzonte - (ALTEZZA_MURO - OCCHIO) / dist * piano;
        var col = coloreMuro(mapX, mapY, lato);

        // dove il raggio ha colpito la parete: serve per i dettagli verticali
        var wallU = lato === 0
          ? giocatore.y + dist * ry
          : giocatore.x + dist * rx;
        wallU -= Math.floor(wallU);

        ctx.fillStyle = ombreggia(col, dist);
        ctx.fillRect(x, y0, STRISCIA + 1, h);

        // fascia orizzontale colorata: cambia da muro a muro
        var fascia = 0.28 + col.s * 0.35;
        ctx.fillStyle = ombreggia({
          r: col.r * 0.6 + 60 * col.s, g: col.g * 0.55, b: col.b * 0.5 + 40
        }, dist);
        ctx.fillRect(x, y0 + h * fascia, STRISCIA + 1, Math.max(1, h * 0.06));

        // segno verticale: una tacca in una posizione fissa della parete
        if (Math.abs(wallU - (0.2 + col.s * 0.6)) < 0.05) {
          ctx.fillStyle = ombreggia({ r: 210, g: 200, b: 170 }, dist);
          ctx.fillRect(x, y0 + h * 0.25, STRISCIA + 1, Math.max(1, h * 0.5));
        }

        // giunzione fra i blocchi, per non avere pareti piatte
        if (wallU < 0.03 || wallU > 0.97) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x, y0, STRISCIA + 1, h);
        }

        // la porta di uscita si riconosce da lontano
        if (mapX === uscita.x && mapY === uscita.y) {
          ctx.fillStyle = ombreggia({ r: 74, g: 222, b: 128 }, dist);
          ctx.fillRect(x, y0 + h * 0.15, STRISCIA + 1, h * 0.7);
        }
      }
    }

    function drawBussola(ctx) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, TOP);

      var dx = (uscita.x + 0.5) - giocatore.x;
      var dy = (uscita.y + 0.5) - giocatore.y;
      var angolo = Math.atan2(dy, dx) - giocatore.ang;   // relativo a dove guardi

      var cx = W / 2, cy = TOP / 2 + 2, r = 15;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // l'ago punta l'uscita; in su significa "dritto davanti a te"
      var ax = Math.sin(angolo), ay = -Math.cos(angolo);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - ax * r * 0.5, cy - ay * r * 0.5);
      ctx.lineTo(cx + ax * r * 0.85, cy + ay * r * 0.85);
      ctx.stroke();
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(cx + ax * r * 0.85, cy + ay * r * 0.85, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.75)';
      ctx.fillText('uscita ↑ = davanti', 10, TOP / 2 + 4);

      var frazione = api.util.clamp(timeLeft / cfg.tempo, 0, 1);
      ctx.textAlign = 'right';
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : 'rgba(230,237,243,0.75)';
      ctx.fillText(Math.ceil(Math.max(0, timeLeft)) + 's', W - 10, TOP / 2 + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, TOP - 3, W, 3);
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : '#38bdf8';
      ctx.fillRect(0, TOP - 3, W * frazione, 3);
    }

    function draw(ctx) {
      // cielo
      var g = ctx.createLinearGradient(0, TOP, 0, TOP + VH / 2);
      g.addColorStop(0, '#16233a');
      g.addColorStop(1, '#46586f');
      ctx.fillStyle = g;
      ctx.fillRect(0, TOP, W, VH / 2 + 1);

      // terra come fondo, poi il pavimento a scacchi sopra
      ctx.fillStyle = '#14161c';
      ctx.fillRect(0, TOP + VH / 2, W, VH / 2);
      drawPavimento(ctx);

      // gli alberi stanno oltre i muri: si disegnano prima, così le pareti li
      // coprono in basso e restano visibili solo le chiome, come deve essere
      drawAlberi(ctx);
      drawMuri(ctx);
      drawBussola(ctx);
    }

    function state() {
      var dx = (uscita.x + 0.5) - giocatore.x;
      var dy = (uscita.y + 0.5) - giocatore.y;
      return {
        lato: cfg.lato,
        mappa: mappa.slice(),
        giocatore: {
          x: Math.round(giocatore.x * 100) / 100,
          y: Math.round(giocatore.y * 100) / 100,
          ang: Math.round(giocatore.ang * 100) / 100,
          cella: [Math.floor(giocatore.x), Math.floor(giocatore.y)]
        },
        uscita: [uscita.x, uscita.y],
        bussola: Math.round((Math.atan2(dy, dx) - giocatore.ang) * 100) / 100,
        distanza: Math.round(Math.hypot(dx, dy) * 100) / 100,
        celleVisitate: Object.keys(visitate).length,
        alberi: alberi.length,
        timeLeft: Math.round(timeLeft * 10) / 10,
        finito: finito
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
