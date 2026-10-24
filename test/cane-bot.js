/* Pilota simulato del cane da pastore.

   Condurre un gregge non è inseguirlo: è mettersi nel punto giusto e lasciare
   che la paura faccia il lavoro. Questo bot usa la strategia classica (il
   modello di Strömbom, lo stesso che il gioco simula dalla parte delle
   pecore), che si riduce a due mosse e a una decisione:

   - RADUNARE, se il gregge è sparpagliato: si gira dietro alla pecora più
     lontana dal centro del gruppo, rispetto al centro, e la si spinge dentro;
   - CONDURRE, se il gregge è compatto: si sta dietro al centro del gruppo
     rispetto al recinto, e il gruppo avanza.

   La decisione è la soglia di sparpaglio. Senza, un bot che spinge sempre il
   centro perde per strada le pecore ai bordi, e un bot che raduna sempre non
   arriva mai al recinto.

   Due cose vanno aggiunte alla strategia da manuale, e sono quelle che un
   pastore fa senza pensarci: girare al largo invece di attraversare il gregge
   (passarci in mezzo lo spacca in due), e non farsi fermare dagli alberi.

   Lo usano test/balance.js per la difficoltà e test/regole.js per le
   meccaniche. I profili arrivano da fuori: reazione = ogni quanto decide,
   errore = quanto sbaglia il punto dove mettersi, spinta = quanto affonda la
   leva. */

function creaPilota(opzioni) {
  var o = opzioni || {};
  var reazione = Math.max(0.08, o.reazione || 0.18);
  var errore = o.errore || 0;
  var spinta = Math.max(0.3, Math.min(1, o.spinta === undefined ? 1 : o.spinta));

  var attesa = 0;
  var meta = null;          // dove voglio mettermi, in coordinate mondo
  var jitter = { x: 0, y: 0 };

  function libere(s) {
    return s.pecore.filter(function (p) { return p.stato === 'libera' && !p.caduta; });
  }

  /* ---------- la strada da far fare al gregge ----------
     Spingere il gregge in linea retta verso il recinto funziona su un prato
     vuoto e perde pecore appena c'è un dirupo in mezzo: la retta passa sul
     bordo, le pecore in panico non guardano dove vanno e qualcuna va giù. Un
     pastore scegli la strada; questo bot la cerca su una griglia grossolana,
     tenendosi larghe dai dirupi, e spinge il gregge verso il prossimo punto
     della strada invece che verso il recinto. Il bersaglio finale resta il
     cancello: cambia solo la direzione in cui si spinge, un pezzo per volta.

     Il margine dai dirupi si allenta se non c'è strada con quello pieno: fra
     passare stretti e non passare, un pastore passa stretto. */
  var PASSO = 6;

  function trovaRotta(s, da, a) {
    var cols = Math.max(1, Math.ceil(s.mondo.w / PASSO));
    var righe = Math.max(1, Math.ceil(s.mondo.h / PASSO));

    function prova(margine) {
      var ok = new Uint8Array(cols * righe);
      for (var j = 0; j < righe; j++) {
        for (var i = 0; i < cols; i++) {
          var x = i * PASSO + PASSO / 2, y = j * PASSO + PASSO / 2;
          ok[j * cols + i] = passabile(s, x, y, margine) ? 1 : 0;
        }
      }
      var si = Math.min(cols - 1, Math.max(0, Math.floor(da.x / PASSO)));
      var sj = Math.min(righe - 1, Math.max(0, Math.floor(da.y / PASSO)));
      var ti = Math.min(cols - 1, Math.max(0, Math.floor(a.x / PASSO)));
      var tj = Math.min(righe - 1, Math.max(0, Math.floor(a.y / PASSO)));
      var start = sj * cols + si, fine = tj * cols + ti;
      if (!ok[start] || !ok[fine]) return null;
      var prec = new Int32Array(cols * righe).fill(-1);
      var visto = new Uint8Array(cols * righe);
      var coda = [start];
      visto[start] = 1;
      var testa = 0;
      while (testa < coda.length) {
        var cur = coda[testa++];
        if (cur === fine) break;
        var ci = cur % cols, cj = (cur - ci) / cols;
        for (var v = 0; v < 4; v++) {
          var ni = ci + [1, -1, 0, 0][v], nj = cj + [0, 0, 1, -1][v];
          if (ni < 0 || nj < 0 || ni >= cols || nj >= righe) continue;
          var k = nj * cols + ni;
          if (visto[k] || !ok[k]) continue;
          visto[k] = 1;
          prec[k] = cur;
          coda.push(k);
        }
      }
      if (!visto[fine]) return null;
      var punti = [];
      for (var c = fine; c >= 0; c = prec[c]) {
        var pi = c % cols, pj = (c - pi) / cols;
        punti.push({ x: pi * PASSO + PASSO / 2, y: pj * PASSO + PASSO / 2 });
        if (c === start) break;
      }
      return punti.reverse();
    }

    return prova(9) || prova(4) || prova(0);
  }

  function passabile(s, x, y, margine) {
    if (x < 3 || y < 3 || x > s.mondo.w - 3 || y > s.mondo.h - 3) return false;
    var i;
    for (i = 0; i < s.dirupi.length; i++) {
      if (distanzaRett(x, y, s.dirupi[i]) < margine) return false;
    }
    for (i = 0; i < s.alberi.length; i++) {
      var a = s.alberi[i];
      if (Math.hypot(x - a.x, y - a.y) < a.r + 4) return false;
    }
    for (i = 0; i < s.muri.length; i++) {
      if (distanzaRett(x, y, s.muri[i]) < 3) return false;
    }
    return true;
  }

  function distanzaRett(x, y, r) {
    var cx = Math.max(r.x, Math.min(x, r.x + r.w));
    var cy = Math.max(r.y, Math.min(y, r.y + r.h));
    return Math.hypot(x - cx, y - cy);
  }

  /* Il prossimo punto della strada, una quarantina di pixel avanti: più vicino
     e il gregge zigzaga dietro a ogni cella, più lontano e la strada torna a
     essere la retta che si voleva evitare. */
  function prossimoPunto(rotta, da, avanti) {
    if (!rotta || !rotta.length) return null;
    var i, migliore = 0, dmin = Infinity;
    for (i = 0; i < rotta.length; i++) {
      var d = Math.hypot(rotta[i].x - da.x, rotta[i].y - da.y);
      if (d < dmin) { dmin = d; migliore = i; }
    }
    for (i = migliore; i < rotta.length; i++) {
      if (Math.hypot(rotta[i].x - da.x, rotta[i].y - da.y) >= avanti) return rotta[i];
    }
    return rotta[rotta.length - 1];
  }

  var rotta = null;
  var rottaDa = null;

  var modo = null;          // 'raduno' | 'conduzione'
  var presa = null;         // la pecora che sto radunando

  function decidi(s) {
    var gregge = libere(s);
    if (!gregge.length) return null;

    var cx = 0, cy = 0;
    gregge.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= gregge.length; cy /= gregge.length;

    /* Il bersaglio è il punto davanti al cancello finché il gregge è lontano,
       e il centro del recinto quando ci è arrivato: senza il secondo passaggio
       il gregge si ferma sulla soglia, che è esattamente dove un gregge si
       ferma davvero. */
    var dentro = s.recinto.dentro;
    var mira = s.recinto.mira;
    var vicino = Math.hypot(cx - mira.x, cy - mira.y) < 34;
    var finale = vicino
      ? { x: dentro.x + dentro.w / 2, y: dentro.y + dentro.h / 2 }
      : mira;

    /* La strada si ricalcola solo quando il gregge si è spostato davvero: una
       visita della griglia a ogni decisione costerebbe più di tutto il resto
       del bot insieme, e la strada non cambia perché il gregge ha fatto due
       passi. */
    if (s.dirupi.length) {
      if (!rotta || !rottaDa || Math.hypot(cx - rottaDa.x, cy - rottaDa.y) > 16) {
        rotta = trovaRotta(s, { x: cx, y: cy }, finale);
        rottaDa = { x: cx, y: cy };
      }
    } else {
      rotta = null;
    }
    var tappa = prossimoPunto(rotta, { x: cx, y: cy }, 42);
    var bersaglio = tappa || finale;

    var dietro = 24;

    /* Il punto da cui spingere: dietro alla pecora rispetto a dove la voglio
       mandare. Non sempre quel punto esiste — dentro la staccionata, dentro un
       dirupo, fuori dal pascolo — e la prima versione del bot in quei casi si
       piazzava il più vicino possibile e spingeva contro il muro. È così che
       perdeva i livelli bassi: una pecora appoggiata alla staccionata del
       recinto, il cane fermo di fuori a schiacciarla contro le tavole, e
       l'orologio che finiva.

       Un pastore in quel caso non spinge da dove vorrebbe, spinge da dove può:
       si gira attorno alla pecora fino a trovare un posto dove stare, purché
       la spinta che ne esce la porti ancora verso il bersaglio. Qui è un giro
       di prova a quindici gradi per volta. */
    function dietroA(p, verso) {
      var rx = p.x - verso.x, ry = p.y - verso.y;
      var rl = Math.hypot(rx, ry) || 1;
      var base = Math.atan2(ry, rx);
      var vx = -rx / rl, vy = -ry / rl;        // dove deve andare la pecora
      for (var k = 0; k < 9; k++) {
        for (var lato = (k === 0 ? 1 : -1); lato <= 1; lato += 2) {
          var ang = base + lato * k * 0.26;
          var px = p.x + Math.cos(ang) * dietro;
          var py = p.y + Math.sin(ang) * dietro;
          if (!passabile(s, px, py, 3)) continue;
          var sx = (p.x - px) / dietro, sy = (p.y - py) / dietro;
          if (sx * vx + sy * vy < 0.15) continue;   // spingerebbe dalla parte sbagliata
          return { x: px, y: py };
        }
      }
      return { x: p.x + rx / rl * dietro, y: p.y + ry / rl * dietro };
    }

    /* Con due pecore o meno il raduno non ha senso: il «centro del gruppo» sta
       in mezzo alle due, ognuna è a turno la più lontana, e il cane fa la
       spola fra loro senza spingere niente verso il recinto. Era proprio
       questo il modo in cui il bot perdeva i livelli facili: due pecore
       rimaste e cinquanta secondi a rimbalzare. Sotto le tre si conduce una
       pecora per volta, la più lontana dal recinto. */
    if (gregge.length <= 2) {
      var sola = gregge[0];
      gregge.forEach(function (p) {
        if (Math.hypot(p.x - bersaglio.x, p.y - bersaglio.y) >
            Math.hypot(sola.x - bersaglio.x, sola.y - bersaglio.y)) sola = p;
      });
      modo = 'conduzione';
      presa = null;
      var m1 = dietroA(sola, bersaglio);
      m1.modo = 'conduzione';
      return m1;
    }

    // sparpaglio: la pecora più lontana dal centro del gruppo
    var fuori = null, maxd = 0;
    gregge.forEach(function (p) {
      var d = Math.hypot(p.x - cx, p.y - cy);
      if (d > maxd) { maxd = d; fuori = p; }
    });

    /* Soglia: cresce col numero di pecore, perché dieci pecore occupano più
       prato di tre anche quando sono compatte. */
    var soglia = 13 + 5.2 * Math.sqrt(gregge.length);

    /* Isteresi: una volta scelta la pecora da riprendere la si riprende fino
       in fondo. Ridecidere a ogni colpo d'occhio fa cambiare bersaglio prima
       di aver concluso qualcosa, e il cane gira a vuoto. */
    if (modo === 'raduno' && presa && gregge.indexOf(presa) >= 0 &&
        Math.hypot(presa.x - cx, presa.y - cy) > soglia * 0.6) {
      var m2 = dietroA(presa, { x: cx, y: cy });
      m2.modo = 'raduno';
      return m2;
    }

    if (maxd > soglia && fuori) {
      modo = 'raduno';
      presa = fuori;
      var m3 = dietroA(fuori, { x: cx, y: cy });
      m3.modo = 'raduno';
      return m3;
    }

    modo = 'conduzione';
    presa = null;
    var m4 = dietroA({ x: cx, y: cy }, bersaglio);
    m4.modo = 'conduzione';
    return m4;
  }

  return function (s, stick, dt) {
    attesa -= dt;
    if (attesa <= 0 || !meta) {
      attesa = reazione;
      meta = decidi(s);
      jitter.x = (Math.random() * 2 - 1) * errore * 0.5;
      jitter.y = (Math.random() * 2 - 1) * errore * 0.5;
    }
    if (!meta) { stick.x = 0; stick.y = 0; stick.attiva = false; return; }

    var cane = s.cane;
    var tx = meta.x + jitter.x, ty = meta.y + jitter.y;
    var dx = tx - cane.x, dy = ty - cane.y;
    var d = Math.hypot(dx, dy) || 0.001;
    var vx = dx / d, vy = dy / d;

    /* Girare al largo: se per arrivare al punto devo passare addosso a una
       pecora, aggiungo una componente perpendicolare e le passo di fianco.
       Attraversare il gregge lo spacca in due — è una regola del gioco, non un
       difetto — e un bot che tira sempre in linea retta spende la partita a
       ricucire quello che ha appena rotto. La perpendicolare si calcola sulla
       direzione di partenza, non su quella già corretta, altrimenti ogni
       pecora piega la correzione della precedente. */
    var dirx = vx, diry = vy;
    libere(s).forEach(function (p) {
      var px = p.x - cane.x, py = p.y - cane.y;
      var pd = Math.hypot(px, py) || 0.001;
      if (pd > 20) return;
      if ((px * dirx + py * diry) / pd < 0.3) return;      // non è sulla mia strada
      var lato = (-diry * px + dirx * py) > 0 ? -1 : 1;    // scarto dall'altra parte
      var peso = 0.9 * (1 - pd / 20);
      vx += -diry * lato * peso;
      vy += dirx * lato * peso;
    });

    // via dagli alberi e dal bordo dei dirupi: non fermano la strategia, ma
    // fermano il cane, e un cane incastrato non conduce niente
    (s.alberi || []).forEach(function (a) {
      var ax = cane.x - a.x, ay = cane.y - a.y;
      var ad = Math.hypot(ax, ay) || 0.001;
      if (ad < a.r + 11) {
        vx += ax / ad * (1 - ad / (a.r + 11)) * 1.6;
        vy += ay / ad * (1 - ad / (a.r + 11)) * 1.6;
      }
    });
    (s.dirupi || []).forEach(function (r) {
      var qx = Math.max(r.x, Math.min(cane.x, r.x + r.w));
      var qy = Math.max(r.y, Math.min(cane.y, r.y + r.h));
      var ddx = cane.x - qx, ddy = cane.y - qy;
      var dd = Math.hypot(ddx, ddy);
      if (dd < 7) {
        var nl = dd || 0.001;
        vx += ddx / nl * 1.2;
        vy += ddy / nl * 1.2;
      }
    });

    var l = Math.hypot(vx, vy) || 1;
    stick.x = vx / l * spinta;
    stick.y = vy / l * spinta;
    stick.attiva = true;
  };
}

module.exports = { creaPilota: creaPilota };
