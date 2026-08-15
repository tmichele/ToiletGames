/* Orda — sparatutto dall'alto.

   Ondate di mostri in un'arena chiusa: si scappa, si spara, si raccolgono le
   armi che cadono. La mira è automatica sul mostro più vicino — su un telefono
   la doppia leva è ingiocabile — quindi la bravura sta nel posizionarsi, nel
   decidere quando spendere le munizioni buone e nel valutare se quella cassa in
   mezzo all'orda vale il rischio.

   Difficoltà: più ondate, più mostri per ondata, tipi nuovi che si aggiungono a
   quelli vecchi (scattanti, corazzati, tiratori, gemelli) e un boss ogni cinque
   livelli. La velocità dei mostri segue la regola della suite
   (`opponentSpeedRatio`), così «veloce» significa qui quello che significa negli
   altri giochi.

   Due scelte che sembrano pignolerie e non lo sono: il tempo avanza a passi
   fissi e il caso esce da un generatore con un seme, quindi la partita dipende
   solo dal seme e dai comandi. Serve a poterla rigiocare identica — è la base
   del duello asincrono, se un giorno lo aggiungiamo. */
(function () {
'use strict';

var PASSO = 1 / 60;      // s: passo fisso di simulazione
var VITE = 3;
var VEL = 132;           // px/s del giocatore: il metro di tutto il resto
var RAGGIO = 9;
var TOP = 46;            // striscia dell'HUD, sopra l'arena

/* Le armi. La pistola non finisce mai: restare senza niente da sparare sarebbe
   una punizione senza rimedio, non una difficoltà. Le altre hanno un caricatore
   e questo è il punto — sono decisioni, non miglioramenti definitivi. */
var ARMI = {
  pistola: { nome: 'Pistola', cadenza: 0.42, danno: 1, colpi: Infinity, pallini: 1, spread: 0.03, vel: 330, colore: '#e6edf3' },
  mitra:   { nome: 'Mitra',   cadenza: 0.09, danno: 1, colpi: 130, pallini: 1, spread: 0.13, vel: 400, colore: '#fbbf24' },
  fucile:  { nome: 'Fucile',  cadenza: 0.60, danno: 1, colpi: 30,  pallini: 6, spread: 0.34, vel: 320, colore: '#fb923c' },
  laser:   { nome: 'Laser',   cadenza: 0.40, danno: 2, colpi: 40,  pallini: 1, spread: 0,    vel: 620, colore: '#38bdf8', perfora: true },
  razzi:   { nome: 'Razzi',   cadenza: 0.85, danno: 3, colpi: 16,  pallini: 1, spread: 0.03, vel: 250, colore: '#f43f5e', esplode: 48 }
};
// quello che può cadere: i doppioni sono il modo più semplice di pesare il caso
var CADUTE = ['mitra', 'mitra', 'fucile', 'fucile', 'laser', 'razzi'];

/* I mostri. `fattore` moltiplica la velocità di riferimento del livello; `da` è
   il livello dal quale compaiono: i tipi si aggiungono, non si sostituiscono,
   altrimenti quello che hai imparato al livello 3 non serve più al 4. */
var TIPI = {
  strisciante: { vita: 1, fattore: 0.50, r: 11, valore: 1, da: 1, colore: '#84a63a' },
  scattante:   { vita: 1, fattore: 0.88, r: 8,  valore: 2, da: 2, colore: '#eab308', scatti: true },
  corazzato:   { vita: 4, fattore: 0.34, r: 16, valore: 4, da: 3, colore: '#94a3b8', duro: true },
  tiratore:    { vita: 2, fattore: 0.44, r: 11, valore: 4, da: 4, colore: '#fb7185', spara: 1.8, distanza: 150 },
  gemello:     { vita: 2, fattore: 0.56, r: 14, valore: 5, da: 7, colore: '#a78bfa', divide: 2, duro: true },
  // il boss non entra nel sorteggio: arriva solo dove lo mette il livello
  boss:        { vita: 26, fattore: 0.40, r: 26, valore: 40, da: 99, colore: '#ef4444', spara: 0.8, distanza: 130, duro: true }
};

function config(level) {
  var tipi = Object.keys(TIPI).filter(function (k) { return TIPI[k].da <= level; });
  return {
    level: level,
    ondate: Math.min(2 + Math.floor(level / 3), 4),
    /* La base è alta e la salita bassa apposta: con la mira automatica, restare
       fermi a fare la torretta funziona finché i mostri arrivano col
       contagocce. L'ondata deve essere una folla fin dal primo livello — chi si
       muove la scansa lo stesso, chi non si muove no. */
    perOndata: 15 + Math.round(level * 0.5),
    velNemici: VEL * TG.util.opponentSpeedRatio(level),
    corazza: Math.floor((level - 1) / 4),        // vita in più ai mostri grossi
    vitaBoss: 22 + level * 2,
    dropChance: Math.min(0.26 + level * 0.006, 0.36),
    cuoreChance: 0.08,
    boss: level % 5 === 0,
    punti: 5 * level,
    tipi: tipi
  };
}

TG.registry.register({
  id: 'orda',
  title: 'Orda',
  icon: '👾',
  tagline: 'Ondate di mostri, armi che cadono, un\'arena sola.',
  scoreLabel: 'Punti',
  controls: 'joystick',
  viewport: { w: 360, h: 540 },
  howto: '<b>Comandi:</b> la leva (o frecce/WASD) per muoverti. <b>Si spara da ' +
    'soli</b>, sempre verso il mostro più vicino: quello che decidi tu è dove ' +
    'stare. Passa sopra le <b>casse</b> per cambiare arma — mitra, fucile, ' +
    'laser che perfora, razzi che esplodono — e sui <b>cuori</b> per una vita. ' +
    'Finite le munizioni si torna alla pistola, che non finisce mai. ' +
    'Il livello è superato quando finiscono le ondate; ogni cinque livelli ' +
    'l\'ultima porta un boss.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.ondate + ' ondate, mostri al ' +
      Math.round(c.velNemici / VEL * 100) + '% della tua velocità' +
      (c.boss ? ', con boss finale' : '');
  },

  create: function (api) {
    var W = api.width, H = api.height;

    /* Generatore con seme: due partite con lo stesso seme e gli stessi comandi
       sono la stessa partita. È mulberry32, corto e più che sufficiente qui. */
    var seme = (Math.random() * 4294967296) >>> 0;
    var rng = null;

    function creaRng(s) {
      var x = s >>> 0;
      return function () {
        x = (x + 0x6D2B79F5) >>> 0;
        var t = Math.imul(x ^ (x >>> 15), 1 | x);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function rf(a, b) { return a + rng() * (b - a); }
    function rpick(arr) { return arr[Math.floor(rng() * arr.length)]; }

    var cfg, me, vite, arma, colpi, ricarica, angolo;
    var nemici, palle, palleNemiche, casse, avvisi, scoppi, note;
    var ondata, coda, attesaSpawn, pausaOndata, uccisi, acc, finito, scossa, prossimoId;

    function start(level) {
      cfg = config(level);
      rng = creaRng(seme + level * 7919);
      me = { x: W / 2, y: (TOP + H) / 2, invuln: 1.2 };
      if (vite == null) vite = VITE;      // le vite valgono per tutta la partita
      arma = 'pistola';
      colpi = Infinity;
      ricarica = 0;
      angolo = -Math.PI / 2;
      nemici = []; palle = []; palleNemiche = []; casse = [];
      avvisi = []; scoppi = []; note = [];
      ondata = 0; coda = []; attesaSpawn = 0; pausaOndata = 0.9;
      /* Una cassa già in campo dal quarto livello: più avanti la sola pistola
         non tiene il passo dell'orda, e cominciare disarmati non è una scelta
         difficile, è solo un livello perso ad aspettare la prima caduta. */
      if (level >= 4) casse.push(cassa(W / 2, TOP + (H - TOP) * 0.28, rpick(CADUTE)));
      uccisi = 0; acc = 0; finito = false; scossa = 0; prossimoId = 1;
    }

    /* ---------- ondate ---------- */

    function sceglieTipo() {
      /* Peso inverso al valore: gli striscianti sono la massa, i tipi nuovi
         sono la sorpresa. Senza pesi il livello 7 sarebbe metà gemelli.

         E il tipo nuovo entra piano, a un terzo del suo peso, arrivando pieno
         tre livelli dopo: un tipo che compare tutto insieme fa uno scalino
         nella difficoltà, e gli scalini si vedono nei numeri di balance.js. */
      var pesi = cfg.tipi.map(function (k) {
        var esordio = Math.min(1, (cfg.level - TIPI[k].da + 1) / 3);
        return 6 / TIPI[k].valore * esordio;
      });
      var tot = 0, i;
      for (i = 0; i < pesi.length; i++) tot += pesi[i];
      var x = rng() * tot;
      for (i = 0; i < cfg.tipi.length; i++) {
        x -= pesi[i];
        if (x <= 0) return cfg.tipi[i];
      }
      return cfg.tipi[0];
    }

    function preparaOndata() {
      ondata += 1;
      var quanti = cfg.perOndata + ondata;    // le ondate crescono dentro il livello
      coda = [];
      if (cfg.boss && ondata === cfg.ondate) {
        coda.push('boss');
        quanti = Math.round(quanti / 2);
      }
      for (var i = 0; i < quanti; i++) coda.push(sceglieTipo());
      attesaSpawn = 0;
    }

    /* Comparsa sul bordo, ma mai addosso al giocatore: un mostro che spunta a
       due passi non è difficoltà, è un dado truccato. */
    function puntoBordo() {
      for (var tentativo = 0; tentativo < 20; tentativo++) {
        var p;
        var lato = Math.floor(rng() * 4);
        if (lato === 0) p = { x: rf(20, W - 20), y: TOP + 18 };
        else if (lato === 1) p = { x: rf(20, W - 20), y: H - 18 };
        else if (lato === 2) p = { x: 18, y: rf(TOP + 20, H - 20) };
        else p = { x: W - 18, y: rf(TOP + 20, H - 20) };
        if (Math.hypot(p.x - me.x, p.y - me.y) > 110) return p;
      }
      return { x: W / 2, y: TOP + 18 };
    }

    function creaNemico(tipo, x, y) {
      var t = TIPI[tipo];
      var vita = tipo === 'boss' ? cfg.vitaBoss : t.vita + (t.duro ? cfg.corazza : 0);
      nemici.push({
        id: prossimoId++, tipo: tipo, x: x, y: y, r: t.r,
        vita: vita, vitaMax: vita,
        ricarica: t.spara ? rf(0.3, t.spara) : 0,
        /* Slancio d'ingresso: entrano di corsa e poi rallentano alla loro
           andatura. Senza, la traversata del campo era un regalo — chi restava
           fermo li abbatteva tutti mentre camminavano, e stare fermi era la
           strategia migliore. La velocità di regime resta quella del tipo, così
           ai livelli alti si può ancora scappare. */
        slancio: 1.3,
        fase: rf(0.2, 0.6), attivo: true, flash: 0
      });
    }

    /* ---------- armi ---------- */

    function bersaglio() {
      var best = null, bd = Infinity;
      for (var i = 0; i < nemici.length; i++) {
        var d = Math.hypot(nemici[i].x - me.x, nemici[i].y - me.y);
        if (d < bd) { bd = d; best = nemici[i]; }
      }
      return best;
    }

    function spara() {
      var a = ARMI[arma];
      for (var i = 0; i < a.pallini; i++) {
        var ang = angolo + (a.pallini > 1 ? (i / (a.pallini - 1) - 0.5) * a.spread * 2 : 0) +
          (rng() * 2 - 1) * a.spread * 0.5;
        palle.push({
          x: me.x + Math.cos(angolo) * (RAGGIO + 4),
          y: me.y + Math.sin(angolo) * (RAGGIO + 4),
          vx: Math.cos(ang) * a.vel, vy: Math.sin(ang) * a.vel,
          danno: a.danno, perfora: !!a.perfora, esplode: a.esplode || 0,
          colore: a.colore, vita: 1.6, colpiti: []
        });
      }
      if (colpi !== Infinity) {
        colpi -= 1;
        if (colpi <= 0) {           // caricatore finito: si torna alla pistola
          arma = 'pistola';
          colpi = Infinity;
          api.sfx.tone(180, 0.12, 'square', 0.05);
        }
      }
      api.sfx.tone(arma === 'razzi' ? 120 : 620, 0.03, 'square', 0.035);
    }

    function raccogli(c) {
      if (c.tipo === 'cuore') {
        vite = Math.min(VITE + 2, vite + 1);
        nota('+1 vita', c.x, c.y, '#f87171');
      } else {
        var a = ARMI[c.arma];
        colpi = (arma === c.arma && colpi !== Infinity ? colpi : 0) + a.colpi;
        arma = c.arma;
        nota(a.nome, c.x, c.y, a.colore);
      }
      api.sfx.pick();
    }

    /* ---------- danni ---------- */

    function nota(testo, x, y, colore) {
      note.push({ testo: testo, x: x, y: y, t: 0.9, colore: colore || '#e6edf3' });
    }

    function danneggia(n, danno) {
      n.vita -= danno;
      n.flash = 0.08;
      if (n.vita > 0) return;
      var t = TIPI[n.tipo];
      var punti = cfg.punti * t.valore;
      api.addScore(punti);
      nota('+' + punti, n.x, n.y, t.colore);
      uccisi++;
      var i = nemici.indexOf(n);
      if (i >= 0) nemici.splice(i, 1);

      if (t.divide) {                       // il gemello si sdoppia morendo
        for (var k = 0; k < t.divide; k++) {
          creaNemico('strisciante', n.x + rf(-14, 14), n.y + rf(-14, 14));
          // i figli sono già dentro: niente slancio d'ingresso, sarebbe
          // un'accelerazione dal nulla in mezzo al campo
          nemici[nemici.length - 1].slancio = 0;
        }
      }
      // il boss lascia sempre qualcosa: è costato troppo per non pagare
      if (n.tipo === 'boss') casse.push(cassa(n.x, n.y, 'razzi'));
      else if (rng() < cfg.cuoreChance && vite < VITE) casse.push(cassa(n.x, n.y, null));
      else if (rng() < cfg.dropChance) casse.push(cassa(n.x, n.y, rpick(CADUTE)));
      api.sfx.hit();
    }

    function cassa(x, y, arma) {
      return {
        x: api.util.clamp(x, 16, W - 16),
        y: api.util.clamp(y, TOP + 16, H - 16),
        tipo: arma ? 'arma' : 'cuore', arma: arma, vita: 11
      };
    }

    function scoppio(x, y, raggio, danno) {
      scoppi.push({ x: x, y: y, r: raggio, t: 0.28 });
      for (var i = nemici.length - 1; i >= 0; i--) {
        var n = nemici[i];
        if (Math.hypot(n.x - x, n.y - y) < raggio + n.r) danneggia(n, danno);
      }
      api.sfx.tone(90, 0.14, 'sawtooth', 0.06);
    }

    function colpisciGiocatore(fonte) {
      if (me.invuln > 0 || finito) return;
      vite -= 1;
      me.invuln = 1.0;
      scossa = 0.35;
      api.sfx.fail();
      if (fonte) {          // il mostro rimbalza indietro: non ti mangia due volte
        var d = Math.hypot(fonte.x - me.x, fonte.y - me.y) || 1;
        fonte.x += (fonte.x - me.x) / d * 26;
        fonte.y += (fonte.y - me.y) / d * 26;
      }
      if (vite <= 0) {
        finito = true;
        api.gameOver({
          message: 'Travolto all\'ondata ' + ondata + ' di ' + cfg.ondate +
            ', dopo ' + uccisi + ' mostri.'
        });
      }
    }

    /* ---------- simulazione ---------- */

    function passo(dt) {
      var i, j, n, p, c;

      // movimento: leva analogica, oppure tasti
      var mx = 0, my = 0;
      if (api.input.stick && api.input.stick.attiva) {
        mx = api.input.stick.x; my = api.input.stick.y;
      } else {
        if (api.input.isDown('left')) mx -= 1;
        if (api.input.isDown('right')) mx += 1;
        if (api.input.isDown('up')) my -= 1;
        if (api.input.isDown('down')) my += 1;
      }
      var len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      me.x = api.util.clamp(me.x + mx * VEL * dt, RAGGIO, W - RAGGIO);
      me.y = api.util.clamp(me.y + my * VEL * dt, TOP + RAGGIO, H - RAGGIO);
      if (me.invuln > 0) me.invuln -= dt;
      if (scossa > 0) scossa -= dt;

      // mira e fuoco automatici
      var b = bersaglio();
      if (b) angolo = Math.atan2(b.y - me.y, b.x - me.x);
      ricarica -= dt;
      if (b && ricarica <= 0) { spara(); ricarica = ARMI[arma].cadenza; }

      // comparse annunciate
      for (i = avvisi.length - 1; i >= 0; i--) {
        avvisi[i].t -= dt;
        if (avvisi[i].t <= 0) {
          creaNemico(avvisi[i].tipo, avvisi[i].x, avvisi[i].y);
          avvisi.splice(i, 1);
        }
      }
      if (coda.length) {
        attesaSpawn -= dt;
        if (attesaSpawn <= 0) {
          var pos = puntoBordo();
          avvisi.push({ x: pos.x, y: pos.y, t: 0.7, tipo: coda.shift() });
          /* Comparse fitte: se escono più lentamente di quanto la pistola li
             abbatta, l'orda non arriva mai addosso e il gioco si vince da
             fermi. L'avviso resta lungo, così è fitto ma non sleale. */
          attesaSpawn = 0.18;
        }
      }

      // mostri
      for (i = 0; i < nemici.length; i++) {
        n = nemici[i];
        var t = TIPI[n.tipo];
        var dx = me.x - n.x, dy = me.y - n.y;
        var d = Math.hypot(dx, dy) || 1;
        var v = cfg.velNemici * t.fattore;
        if (n.slancio > 0) { v *= 1.8; n.slancio -= dt; }

        if (t.scatti) {              // lo scattante alterna scatti e pause
          n.fase -= dt;
          if (n.fase <= 0) { n.attivo = !n.attivo; n.fase = n.attivo ? 0.55 : 0.4; }
          if (!n.attivo) v *= 0.12;
        }
        if (t.spara) {
          n.ricarica -= dt;
          if (n.ricarica <= 0 && d < t.distanza * 1.6) {
            palleNemiche.push({
              x: n.x, y: n.y, vx: dx / d * 165, vy: dy / d * 165, vita: 3
            });
            n.ricarica = t.spara;
            api.sfx.tone(300, 0.05, 'square', 0.03);
          }
          if (d < t.distanza) v = -v * 0.5;      // tiene le distanze
        }
        n.x += dx / d * v * dt;
        n.y += dy / d * v * dt;
        if (n.flash > 0) n.flash -= dt;
        n.x = api.util.clamp(n.x, n.r, W - n.r);
        n.y = api.util.clamp(n.y, TOP + n.r, H - n.r);
        if (d < n.r + RAGGIO) colpisciGiocatore(n);
      }

      /* Spinta fra mostri: senza, si sovrappongono in un blocco unico e il
         fucile ne prende sei con un colpo. Sono poche decine, il ciclo
         quadratico non si sente. */
      for (i = 0; i < nemici.length; i++) {
        for (j = i + 1; j < nemici.length; j++) {
          var a = nemici[i], bb = nemici[j];
          var ddx = bb.x - a.x, ddy = bb.y - a.y;
          var dd = Math.hypot(ddx, ddy) || 1;
          var min = a.r + bb.r;
          if (dd < min) {
            var spinta = (min - dd) / 2;
            a.x -= ddx / dd * spinta; a.y -= ddy / dd * spinta;
            bb.x += ddx / dd * spinta; bb.y += ddy / dd * spinta;
          }
        }
      }

      // proiettili del giocatore
      for (i = palle.length - 1; i >= 0; i--) {
        p = palle[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vita -= dt;
        var fuori = p.x < 0 || p.x > W || p.y < TOP || p.y > H;
        if (fuori && p.esplode) scoppio(p.x, p.y, p.esplode, p.danno);
        if (fuori || p.vita <= 0) { palle.splice(i, 1); continue; }
        for (j = 0; j < nemici.length; j++) {
          n = nemici[j];
          if (p.colpiti.indexOf(n.id) >= 0) continue;
          if (Math.hypot(n.x - p.x, n.y - p.y) > n.r + 2) continue;
          if (p.esplode) { scoppio(p.x, p.y, p.esplode, p.danno); palle.splice(i, 1); break; }
          danneggia(n, p.danno);
          if (p.perfora) { p.colpiti.push(n.id); }   // il laser passa oltre
          else { palle.splice(i, 1); break; }
        }
      }

      // proiettili dei mostri
      for (i = palleNemiche.length - 1; i >= 0; i--) {
        p = palleNemiche[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vita -= dt;
        if (Math.hypot(p.x - me.x, p.y - me.y) < RAGGIO + 3) {
          colpisciGiocatore(null);
          palleNemiche.splice(i, 1);
          continue;
        }
        if (p.vita <= 0 || p.x < 0 || p.x > W || p.y < TOP || p.y > H) palleNemiche.splice(i, 1);
      }

      // casse per terra
      for (i = casse.length - 1; i >= 0; i--) {
        c = casse[i];
        c.vita -= dt;
        if (Math.hypot(c.x - me.x, c.y - me.y) < RAGGIO + 11) { raccogli(c); casse.splice(i, 1); continue; }
        if (c.vita <= 0) casse.splice(i, 1);
      }

      for (i = scoppi.length - 1; i >= 0; i--) { scoppi[i].t -= dt; if (scoppi[i].t <= 0) scoppi.splice(i, 1); }
      for (i = note.length - 1; i >= 0; i--) {
        note[i].t -= dt; note[i].y -= 22 * dt;
        if (note[i].t <= 0) note.splice(i, 1);
      }

      // fine ondata / fine livello
      if (!coda.length && !avvisi.length && !nemici.length) {
        pausaOndata -= dt;
        if (pausaOndata <= 0) {
          if (ondata >= cfg.ondate) {
            finito = true;
            api.levelComplete({
              bonus: 100 * cfg.level + vite * 50,
              message: uccisi + ' mostri abbattuti, ' + vite + ' vite intatte.'
            });
          } else {
            preparaOndata();
            pausaOndata = 1.2;
          }
        }
      }
    }

    /* Passo fisso: il motore consegna un dt che dipende dal monitor, qui dentro
       il tempo avanza sempre a 1/60. Serve alla ripetibilità, e per giunta
       toglie di mezzo i salti di collisione quando il telefono arranca. */
    function update(dt) {
      while (api.input.take()) { /* le pressioni non servono: si legge lo stato */ }
      while (api.input.takeTap()) { /* né i tocchi sul campo */ }
      while (api.input.takeDigit()) { /* né i numeri */ }
      if (finito) return;
      acc += dt;
      var giri = 0;
      while (acc >= PASSO && giri < 5 && !finito) { passo(PASSO); acc -= PASSO; giri++; }
      if (giri >= 5) acc = 0;   // dopo una pausa lunga il tempo perso non si recupera
    }

    /* ---------- disegno ---------- */

    function disegnaMostro(ctx, n) {
      var t = TIPI[n.tipo];
      ctx.fillStyle = n.flash > 0 ? '#fff' : t.colore;
      if (n.tipo === 'corazzato' || n.tipo === 'boss') {
        api.util.roundRect(ctx, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2, 5);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // occhi: dicono da che parte guarda, e rendono leggibile la calca
      var a = Math.atan2(me.y - n.y, me.x - n.x);
      ctx.fillStyle = 'rgba(5,7,12,0.85)';
      for (var s = -1; s <= 1; s += 2) {
        var ox = Math.cos(a) * n.r * 0.42 - Math.sin(a) * n.r * 0.34 * s;
        var oy = Math.sin(a) * n.r * 0.42 + Math.cos(a) * n.r * 0.34 * s;
        ctx.beginPath();
        ctx.arc(n.x + ox, n.y + oy, Math.max(1.5, n.r * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      if (n.vitaMax > 1) {          // barra vita solo per chi ne ha più di uno
        var w = n.r * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(n.x - n.r, n.y - n.r - 6, w, 3);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(n.x - n.r, n.y - n.r - 6, w * Math.max(0, n.vita / n.vitaMax), 3);
      }
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      if (scossa > 0) ctx.translate(rf(-2.5, 2.5) * scossa, rf(-2.5, 2.5) * scossa);

      // pavimento dell'arena
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, TOP, W, H - TOP);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (var g = 0; g < W; g += 36) {
        ctx.beginPath(); ctx.moveTo(g, TOP); ctx.lineTo(g, H); ctx.stroke();
      }
      for (var gy = TOP; gy < H; gy += 36) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      // avvisi di comparsa
      avvisi.forEach(function (a) {
        var k = 1 - a.t / 0.7;
        ctx.strokeStyle = 'rgba(248,113,113,' + (0.35 + 0.5 * k) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 6 + 12 * (1 - k), 0, Math.PI * 2);
        ctx.stroke();
      });

      // casse e cuori
      casse.forEach(function (c) {
        if (c.vita < 3 && Math.floor(c.vita * 6) % 2 === 0) return;   // lampeggia prima di sparire
        if (c.tipo === 'cuore') {
          ctx.fillStyle = '#f87171';
          ctx.font = '17px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('❤', c.x, c.y + 1);
          ctx.textBaseline = 'alphabetic';
          return;
        }
        var a = ARMI[c.arma];
        ctx.fillStyle = 'rgba(15,23,42,0.95)';
        api.util.roundRect(ctx, c.x - 10, c.y - 10, 20, 20, 5);
        ctx.fill();
        ctx.strokeStyle = a.colore;
        ctx.lineWidth = 2;
        api.util.roundRect(ctx, c.x - 10, c.y - 10, 20, 20, 5);
        ctx.stroke();
        ctx.fillStyle = a.colore;
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.nome.charAt(0), c.x, c.y + 1);
        ctx.textBaseline = 'alphabetic';
      });

      nemici.forEach(function (n) { disegnaMostro(ctx, n); });

      // proiettili
      palle.forEach(function (p) {
        ctx.strokeStyle = p.colore;
        ctx.lineWidth = p.esplode ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        ctx.stroke();
      });
      ctx.fillStyle = '#fca5a5';
      palleNemiche.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      scoppi.forEach(function (s) {
        var k = 1 - s.t / 0.28;
        ctx.strokeStyle = 'rgba(251,146,60,' + (1 - k) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.stroke();
      });

      // giocatore: lampeggia mentre è invulnerabile
      if (!(me.invuln > 0 && Math.floor(me.invuln * 12) % 2 === 0)) {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(me.x, me.y, RAGGIO, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ARMI[arma].colore;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(me.x + Math.cos(angolo) * 4, me.y + Math.sin(angolo) * 4);
        ctx.lineTo(me.x + Math.cos(angolo) * (RAGGIO + 8), me.y + Math.sin(angolo) * (RAGGIO + 8));
        ctx.stroke();
      }

      note.forEach(function (f) {
        ctx.globalAlpha = Math.max(0, f.t);
        ctx.fillStyle = f.colore;
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.testo, f.x, f.y);
        ctx.globalAlpha = 1;
      });

      ctx.restore();

      // ---- HUD ----
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, TOP);
      ctx.textAlign = 'left';
      ctx.font = '14px system-ui, sans-serif';
      var cuori = '';
      for (var v = 0; v < vite; v++) cuori += '❤';
      ctx.fillStyle = '#f87171';
      ctx.fillText(cuori || '—', 10, 20);

      ctx.font = '12px ui-monospace, monospace';
      ctx.fillStyle = ARMI[arma].colore;
      ctx.fillText(ARMI[arma].nome + (colpi === Infinity ? '  ∞' : '  ' + colpi), 10, 38);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.85)';
      ctx.fillText('ondata ' + Math.max(1, ondata) + '/' + cfg.ondate, W - 10, 20);
      var restano = nemici.length + coda.length + avvisi.length;
      ctx.fillStyle = restano ? 'rgba(230,237,243,0.6)' : '#4ade80';
      ctx.fillText(restano ? restano + ' mostri' : 'ondata pulita', W - 10, 38);
    }

    function state() {
      return {
        seme: seme,
        giocatore: { x: me.x, y: me.y, invuln: Math.max(0, me.invuln) },
        vite: vite,
        arma: arma,
        colpi: colpi === Infinity ? -1 : colpi,
        ondata: ondata,
        ondate: cfg.ondate,
        uccisi: uccisi,
        velNemici: cfg.velNemici,
        rimasti: nemici.length + coda.length + avvisi.length,
        nemici: nemici.map(function (n) {
          return { x: n.x, y: n.y, r: n.r, tipo: n.tipo, vita: n.vita };
        }),
        palleNemiche: palleNemiche.map(function (p) { return { x: p.x, y: p.y, vx: p.vx, vy: p.vy }; }),
        // gli avvisi di comparsa si vedono a schermo, quindi il bot li vede
        avvisi: avvisi.map(function (a) { return { x: a.x, y: a.y, t: a.t, tipo: a.tipo }; }),
        casse: casse.map(function (c) { return { x: c.x, y: c.y, tipo: c.tipo, arma: c.arma }; })
      };
    }

    /* Il seme si può imporre dall'esterno (va messo prima di start): lo usano i
       test per rigiocare la stessa partita, e sarebbe il perno di una sfida in
       cui due persone affrontano la stessa orda. */
    function setSeme(v) { seme = v >>> 0; }

    return { start: start, update: update, draw: draw, state: state, setSeme: setSeme };
  }
});

})();
