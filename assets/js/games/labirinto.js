/* Labirinto — vista in prima persona, con una mappa che si dimentica.

   La pianta non è mai data: si disegna da sé mentre cammini, con quello che i
   tuoi occhi hanno davvero visto, e sbiadisce col passare del tempo. Gli altri
   riferimenti sono il numero di zona dipinto sulle pareti (il labirinto è
   diviso in nove settori), gli alberi che spuntano oltre i muri e una bussola
   che indica dove sta l'uscita — la direzione, non la strada.

   La scena è disegnata con il raycasting sul canvas 2D: niente WebGL, quindi
   funziona ovunque funzioni il resto della suite.

   Il labirinto è generato col backtracking ricorsivo: è perfetto, cioè fra due
   punti qualsiasi esiste una strada e una sola, quindi l'uscita è sempre
   raggiungibile e non serve verificarlo a posteriori. */
(function () {
'use strict';

var FOV = Math.PI / 2.3;        // ~78°: campo largo, si vede molto più ai lati
/* Muri più bassi di una cella intera, altrimenti riempiono lo schermo: nei
   corridoi si è sempre a mezzo metro da una parete e non si vedrebbe più nulla
   sopra — né cielo né alberi, che sono l'unico riferimento lontano. */
var ALTEZZA_MURO = 0.56;
var OCCHIO = ALTEZZA_MURO / 2;  // altezza dello sguardo, a metà parete
var RAGGIO = 0.22;              // ingombro del giocatore, per le collisioni
var RAGGI_MEMORIA = 26;         // raggi del ventaglio che alimenta la mappa
var MAPPA_PX = 104;             // lato della mappina in alto a destra


function config(level) {
  var celle = Math.min(4 + level, 11);          // celle per lato del labirinto
  return {
    level: level,
    celle: celle,
    lato: celle * 2 + 1,                        // griglia muri+corridoi
    tempo: Math.max(45, 40 + celle * 14 - level * 3),
    /* Quanto dura il ricordo di una cella già vista: la mappa si disegna
       camminando e sbiadisce da sola, quindi girare a vuoto non basta più —
       bisogna ricordarsi la strada mentre la si percorre. */
    memoria: Math.max(8, 26 - level * 1.6),
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
    '<b>La mappa te la fai tu:</b> in alto a destra compare quello che vedi ' +
    'mentre cammini, ma <b>sbiadisce col tempo</b> — quello che hai visto troppo ' +
    'tempo fa lo dimentichi, e ai livelli alti dura pochi secondi. ' +
    'Per orientarti hai anche la <b>bussola</b>, che punta verso l\'uscita ma non ' +
    'conosce i corridoi, gli <b>alberi</b> che si vedono oltre i muri (stanno ' +
    'fermi: sono il tuo nord) e il <b>numero di zona</b> dipinto sulle pareti: il ' +
    'labirinto è diviso in nove settori, da 1 in alto a sinistra a 9 in basso a ' +
    'destra. L\'uscita è la porta verde.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': labirinto ' + c.celle + '×' + c.celle + ', ' +
      Math.round(c.tempo) + 's, ' + c.alberi + ' alberi di riferimento, ' +
      'memoria della mappa ' + Math.round(c.memoria) + 's';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var TOP = 44;                       // fascia della bussola
    var VH = H - TOP;                   // altezza della vista in prima persona
    var STRISCIA = 3;                   // px per raggio: compromesso resa/velocità

    var cfg, mappa, giocatore, uscita, alberi, timeLeft, finito, visitate, semi;
    var ricordo;      // per cella: 1 appena vista, 0 dimenticata

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

    /* Il labirinto è diviso in nove settori: ogni muro porta dipinto il numero
       del proprio, così si capisce in che parte del labirinto ci si trova senza
       bisogno di ricordarsi le singole pareti. */
    function zona(x, y) {
      var q = Math.floor(x / (cfg.lato / 3));
      var r = Math.floor(y / (cfg.lato / 3));
      return api.util.clamp(r, 0, 2) * 3 + api.util.clamp(q, 0, 2) + 1;
    }

    /* Ogni zona ha la sua tinta dominante: entrando in un settore diverso te ne
       accorgi dal colore delle pareti prima ancora di leggerne il numero. */
    var TINTE_ZONA = [
      [138, 104, 84], [96, 118, 140], [120, 126, 92],
      [132, 100, 122], [110, 118, 122], [140, 124, 88],
      [92, 128, 118], [118, 108, 148], [128, 112, 100]
    ];

    function coloreMuro(x, y, lato) {
      var s = seme(x, y);
      var base = TINTE_ZONA[(zona(x, y) - 1) % TINTE_ZONA.length];
      // variazione da muro a muro, dentro la tinta della zona
      var v = 0.86 + s * 0.28;
      var ombra = (lato === 1 ? 0.74 : 1) * v;   // pareti nord/sud più scure
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
      ricordo = [];
      for (var m = 0; m < cfg.lato * cfg.lato; m++) ricordo.push(0);
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

    /* La mappa ricorda quello che si è visto, non solo dove si è passati: si
       tira un ventaglio di raggi e si marcano le celle attraversate. */
    function aggiornaRicordo() {
      var i, k;
      for (i = 0; i < RAGGI_MEMORIA; i++) {
        var ang = giocatore.ang - FOV / 2 + (i / (RAGGI_MEMORIA - 1)) * FOV;
        var dx = Math.cos(ang), dy = Math.sin(ang);
        var x = giocatore.x, y = giocatore.y;
        var passi = Math.ceil(cfg.nebbia * 4);
        for (k = 0; k < passi; k++) {
          x += dx * 0.25;
          y += dy * 0.25;
          var cx = Math.floor(x), cy = Math.floor(y);
          if (cx < 0 || cy < 0 || cx >= cfg.lato || cy >= cfg.lato) break;
          ricordo[idx(cx, cy)] = 1;
          if (muro(cx, cy)) break;          // oltre il muro non si vede
        }
      }
      // anche la cella sotto i piedi e le adiacenti, che si toccano con mano
      var px = Math.floor(giocatore.x), py = Math.floor(giocatore.y);
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var qx = px + d[0], qy = py + d[1];
        if (qx >= 0 && qy >= 0 && qx < cfg.lato && qy < cfg.lato) ricordo[idx(qx, qy)] = 1;
      });
    }

    function sbiadisci(dt) {
      var calo = dt / cfg.memoria;
      for (var i = 0; i < ricordo.length; i++) {
        if (ricordo[i] > 0) ricordo[i] = Math.max(0, ricordo[i] - calo);
      }
    }

    function update(dt) {
      while (api.input.take()) { /* qui contano i tasti tenuti */ }
      if (finito) return;
      muovi(dt);
      sbiadisci(dt);
      aggiornaRicordo();
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
      /* Mentre si tirano i raggi si tiene nota di ogni parete vista e di quanto
         spazio occupa sullo schermo: serve dopo, per scriverci sopra il numero
         di zona come un'etichetta vera invece che a strisce (a strisce esce
         specchiata e illeggibile, perché la parete la si vede da un lato o
         dall'altro). */
      var facce = {};
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

        var chiaveFaccia = mapX + ',' + mapY + ',' + lato;
        var f = facce[chiaveFaccia];
        if (!f) facce[chiaveFaccia] = f = {
          x0: x, x1: x, y0: y0, h: h, dist: dist, zona: zona(mapX, mapY)
        };
        f.x1 = x + STRISCIA;
        if (dist < f.dist) { f.dist = dist; f.y0 = y0; f.h = h; }

        ctx.fillStyle = ombreggia(col, dist);
        ctx.fillRect(x, y0, STRISCIA + 1, h);

        // fascia orizzontale colorata: cambia da muro a muro
        var fascia = 0.28 + col.s * 0.35;
        ctx.fillStyle = ombreggia({
          r: col.r * 0.6 + 60 * col.s, g: col.g * 0.55, b: col.b * 0.5 + 40
        }, dist);
        ctx.fillRect(x, y0 + h * fascia, STRISCIA + 1, Math.max(1, h * 0.06));

        /* Numero della zona dipinto sul muro: si disegna a strisce come tutto
           il resto, leggendo la colonna giusta della cifra 3×5. */

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

      disegnaNumeriZona(ctx, facce);
    }

    /* Il numero della zona, dipinto al centro di ogni parete abbastanza larga
       da poterlo leggere. Il ritaglio impedisce che sconfini sulla parete
       accanto quando due facce si toccano sullo schermo. */
    function disegnaNumeriZona(ctx, facce) {
      Object.keys(facce).forEach(function (k) {
        var f = facce[k];
        var largh = f.x1 - f.x0;
        if (largh < 16 || f.dist > cfg.nebbia * 0.9) return;

        var dim = api.util.clamp(Math.min(f.h * 0.26, largh * 0.6), 9, 46);
        var cx = (f.x0 + f.x1) / 2;
        var cy = f.y0 + f.h * 0.45;
        var buio = api.util.clamp(1 - f.dist / cfg.nebbia, 0.25, 1);

        ctx.save();
        ctx.beginPath();
        ctx.rect(f.x0, f.y0, largh, f.h);
        ctx.clip();

        ctx.fillStyle = 'rgba(18,20,26,' + (0.5 * buio).toFixed(2) + ')';
        api.util.roundRect(ctx, cx - dim * 0.45, cy - dim * 0.62, dim * 0.9, dim * 1.24, dim * 0.16);
        ctx.fill();

        ctx.fillStyle = 'rgba(240,236,220,' + buio.toFixed(2) + ')';
        ctx.font = 'bold ' + Math.round(dim) + 'px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(f.zona), cx, cy + 1);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      });
    }

    /* Mappa a memoria: compare camminando e sbiadisce da sola. Non è un aiuto
       gratuito — è quello che ricordi, e dura poco. */
    function drawMappa(ctx) {
      var passo = MAPPA_PX / cfg.lato;
      var ox = W - MAPPA_PX - 8, oy = TOP + 8;

      ctx.fillStyle = 'rgba(5,7,12,0.55)';
      api.util.roundRect(ctx, ox - 4, oy - 4, MAPPA_PX + 8, MAPPA_PX + 8, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      api.util.roundRect(ctx, ox - 4, oy - 4, MAPPA_PX + 8, MAPPA_PX + 8, 8);
      ctx.stroke();

      for (var y = 0; y < cfg.lato; y++) {
        for (var x = 0; x < cfg.lato; x++) {
          var q = ricordo[idx(x, y)];
          if (q <= 0.02) continue;
          var px = ox + x * passo, py = oy + y * passo;
          if (muro(x, y)) ctx.fillStyle = 'rgba(120,134,158,' + (q * 0.75).toFixed(2) + ')';
          else ctx.fillStyle = 'rgba(56,189,248,' + (q * 0.30).toFixed(2) + ')';
          ctx.fillRect(px, py, Math.ceil(passo), Math.ceil(passo));
        }
      }

      // l'uscita si segna solo se te la ricordi
      if (ricordo[idx(uscita.x, uscita.y)] > 0.02) {
        ctx.fillStyle = 'rgba(74,222,128,' + ricordo[idx(uscita.x, uscita.y)].toFixed(2) + ')';
        ctx.fillRect(ox + uscita.x * passo, oy + uscita.y * passo,
          Math.ceil(passo), Math.ceil(passo));
      }

      // dove sei e dove guardi: questo non si dimentica
      var gx = ox + giocatore.x * passo, gy = oy + giocatore.y * passo;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(gx + Math.cos(giocatore.ang) * passo * 1.1,
                 gy + Math.sin(giocatore.ang) * passo * 1.1);
      ctx.lineTo(gx + Math.cos(giocatore.ang + 2.5) * passo * 0.7,
                 gy + Math.sin(giocatore.ang + 2.5) * passo * 0.7);
      ctx.lineTo(gx + Math.cos(giocatore.ang - 2.5) * passo * 0.7,
                 gy + Math.sin(giocatore.ang - 2.5) * passo * 0.7);
      ctx.closePath();
      ctx.fill();

      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.45)';
      ctx.fillText('zona ' + zona(Math.floor(giocatore.x), Math.floor(giocatore.y)),
        ox, oy + MAPPA_PX + 12);
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
      drawMappa(ctx);
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
        ricordate: ricordo.reduce(function (n, q) { return n + (q > 0.02 ? 1 : 0); }, 0),
        ricordoTotale: Math.round(ricordo.reduce(function (a, b) { return a + b; }, 0) * 100) / 100,
        zona: zona(Math.floor(giocatore.x), Math.floor(giocatore.y)),
        alberi: alberi.length,
        timeLeft: Math.round(timeLeft * 10) / 10,
        finito: finito
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
