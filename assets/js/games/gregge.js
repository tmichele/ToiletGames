/* Gregge — il cane da pastore e le pecore da portare al recinto.

   Il gioco è un problema di controllo indiretto: non muovi le pecore, muovi
   quello che le spaventa. Tutta la difficoltà sta lì, e il modello delle
   pecore è la parte che la produce. Ogni pecora, a ogni passo, somma quattro
   spinte: via dal cane (forte, e solo se il cane è abbastanza vicino), verso le
   compagne che ha intorno, via da quelle troppo vicine, via dagli ostacoli. È
   il modello di Strömbom per la conduzione del gregge, e ha una conseguenza
   che non ho dovuto programmare: spingere da dietro il centro del gruppo lo fa
   avanzare, spingere da un lato lo fa girare, e arrivare addosso in mezzo lo
   spacca in due. Un gregge si conduce stando dietro, e qui è vero perché è
   geometria, non perché ci sia una regola che lo dice.

   Due cose le sanno le pecore e non il cane:

   - una pecora in panico non guarda dove va. I dirupi sono mortali per il
     gregge e innocui per il cane, che si ferma sul bordo come fa un cane vero:
     il pericolo non è cadere, è spingere il gregge dalla parte sbagliata. Il
     dirupo diventa così un muro che tu puoi usare come sponda e loro no;
   - una pecora dentro il recinto si tranquillizza e non ne esce più. Senza
     questa regola l'ultima pecora farebbe uscire le prime — il cane deve
     entrare dal cancello per spingerla dentro — e il livello finirebbe per
     logoramento invece che per bravura.

   Grafica: pixel art disegnata a mano in questo file. Gli sprite sono righe di
   caratteri con una tavolozza condivisa, convertiti una volta sola in piccole
   canvas e poi stampati con drawImage a interpolazione spenta. Niente file
   immagine (la suite si apre anche da file://, e un PNG mancante sarebbe un
   buco nero) e niente testo nel campo: i numeri sono un font 3×5 disegnato
   qui, così la barra in alto resta della stessa pasta del resto.

   La preparazione della grafica è pigra, dentro al primo draw(): nella sandbox
   dei test non esiste `document`, e i test fanno girare le partite senza mai
   disegnare un fotogramma. */
(function () {
  'use strict';

  /* ---------- misure ---------- */

  var VIS_W = 200;           // finestra visibile, in pixel d'arte
  var VIS_H = 290;
  var TOP = 22;              // barra in alto (pecore, luce del giorno)
  var CAMPO_H = VIS_H - TOP; // altezza visibile del pascolo
  var MONTI = 28;            // fascia di monti sopra al pascolo

  var R_CANE = 3.4;          // raggi di collisione
  var R_PECORA = 3.0;

  var VEL_CANE = 58;         // px/s: il cane è la cosa più veloce in campo
  var VEL_PECORA = 44;       // px/s in fuga
  var VEL_PASCOLO = 7;       // px/s mentre brucano

  var PAURA = 38;            // entro questa distanza la pecora scappa dal cane
  var PAURA_NERA = 27;       // la pecora nera si fida di più: va avvicinata
  var GREGGE = 54;           // raggio in cui una pecora vede le compagne
  var VICINO = 9;            // sotto questa distanza si danno gomitate
  var ALLARME = 1.4;         // s di agitazione dopo l'ultimo spavento

  var PORTA = 26;            // larghezza del cancello
  var PALO = 3;              // spessore della staccionata

  /* ---------- tavolozza e sprite ----------
     Una lettera per colore, condivisa da tutti gli sprite: cambiare la
     tonalità dell'erba o del legno si fa in un posto solo. */
  var COLORI = {
    k: '#23242b', n: '#3b3f49', w: '#f2efe4', e: '#d8d2c2',
    g: '#3c8f45', G: '#2b6b34', h: '#4fa85a', t: '#6b4a28', T: '#4a321a',
    r: '#8c919b', R: '#696e78', s: '#eef4f8', y: '#e8c84a',
    b: '#8a5a2b', c: '#c9452f', o: '#e07a3a'
  };

  var SPRITE = {
    /* Pecora di tre quarti, muso a destra: corpo lanoso, testa scura, quattro
       zampe. Sei pixel di altezza sono pochi per una posa, quindi la direzione
       si legge dal ribaltamento, non dall'animazione. */
    pecora: [
      '..eee..',
      '.wwwww.',
      'wwwwwnn',
      'wwwwwkn',
      '.k.w.k.'
    ],
    /* Border collie: schiena nera, pettorina e museruola bianche, coda. */
    cane: [
      'k......k',
      '.kkkkkkk',
      'kkkkkwwn',
      '.kkkkkww',
      '.k.k.k..'
    ],
    pino: [
      '....s....',
      '...sGs...',
      '..GGGGG..',
      '.GGhGhGG.',
      '..GGGGG..',
      '.GGhGhGG.',
      'GGGGhGGGG',
      '.GGGGGGG.',
      '..GGGGG..',
      '....T....',
      '....t....',
      '...TtT...'
    ],
    roccia: [
      '..rrr...',
      '.rrrrrr.',
      'rrrRrrrr',
      'rRRrrRRr',
      '.RRRRRR.'
    ],
    cespuglio: [
      '.hhh..',
      'hhGhhh',
      'hGhhGh',
      '.TT.T.'
    ]
  };

  /* Font 3×5 per i soli caratteri che servono in campo: cifre, barra e due
     punti. Le parole stanno nei pannelli del motore, che sono HTML. */
  var CIFRE = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '010'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    '/': ['001', '001', '010', '100', '100'],
    ':': ['000', '010', '000', '010', '000'],
    '-': ['000', '000', '111', '000', '000']
  };

  /* ---------- livelli ----------
     Le leve della difficoltà sono tre, e sono quelle che il giocatore vede:
     quante pecore, quanto è grande il pascolo (cioè quanta strada vanno
     condotte) e quanto è ingombro — boschi che spaccano il gruppo e dirupi che
     se le prendono. Il tempo non è una quarta leva libera: si calcola dalle
     altre tre, altrimenti un livello col doppio delle pecore e lo stesso tempo
     non sarebbe più difficile, sarebbe impossibile. */
  function config(level) {
    var pecore = Math.min(4 + Math.floor(level * 0.8), 14);
    var scala = 1 + Math.min(level - 1, 7) * 0.105;      // 1.00 → 1.74
    var dirupi = level < 3 ? 0 : Math.min(1 + Math.floor((level - 3) / 3), 3);
    var boschi = Math.min(1 + Math.floor(level / 2), 7);
    var nere = level < 4 ? 0 : Math.min(1 + Math.floor((level - 4) / 3), 4);
    return {
      level: level,
      pecore: pecore,
      nere: nere,
      scala: scala,
      mondoW: Math.round(VIS_W * scala),
      mondoH: Math.round(CAMPO_H * scala),
      boschi: boschi,
      dirupi: dirupi,
      /* Si può perdere qualche pecora, ma non il gregge: la tolleranza cresce
         piano, e sotto al terzo livello non ci sono dirupi, quindi è zero
         perché perderne una sarebbe già colpa di nessuno. */
      tolleranza: level < 3 ? 0 : Math.min(1 + Math.floor((level - 3) / 4), 3),
      punti: 6 + level
    };
  }

  /* Tempo concesso: non una cifra a occhio, e nemmeno un conto fatto a
     tavolino. Il primo modello sommava un tempo di raduno per pecora e la
     distanza divisa per una velocità di conduzione «ragionevole», e dava
     sessantasette secondi per il primo livello quando il lavoro ne chiede
     diciannove: il tempo non era una pressione, era un soprammobile, e ci si
     accorgeva solo guardando i numeri del banco di prova (il profilo
     «scarso» vinceva tutto fino al quinto livello).

     Questa versione parte da quanto ci mette davvero a chiudere il livello chi
     gioca bene — misurato, non stimato — e lo moltiplica per un margine che si
     stringe salendo. Il lavoro vero è per pecora: ognuna va raggiunta,
     staccata dal suo cespuglio e messa dentro, e quattro secondi e due a testa
     è quello che costa. La distanza conta poco, perché il gregge si conduce
     tutto insieme: pesa un trentesimo di quello che pesa una pecora in più. */
  var COSTO_PECORA = 4.2;    // s a pecora per chi conduce bene (misurato)
  var COSTO_STRADA = 40;     // px di conduzione per secondo di lavoro utile

  function tempoConcesso(c, distanza, sparpaglio) {
    var lavoro = COSTO_PECORA * c.pecore + distanza / COSTO_STRADA + sparpaglio / 30;
    var ingombro = 1 + 0.02 * c.boschi + 0.05 * c.dirupi;
    var margine = Math.max(1.25, 1.65 - c.level * 0.04);
    return Math.round(lavoro * ingombro * margine);
  }

  /* ---------- generazione del pascolo ----------
     Con seme: due partite con lo stesso seme hanno lo stesso pascolo, ed è
     quello che permette ai test di parlare di un livello preciso. mulberry32. */
  function creaRng(seme) {
    var x = seme >>> 0;
    return function () {
      x = (x + 0x6D2B79F5) >>> 0;
      var t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dentroRett(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function distanzaRett(x, y, r) {
    var cx = Math.max(r.x, Math.min(x, r.x + r.w));
    var cy = Math.max(r.y, Math.min(y, r.y + r.h));
    return Math.hypot(x - cx, y - cy);
  }

  /* Il recinto: un quadrilatero di staccionata con un cancello sul lato che
     guarda il pascolo. Si costruisce come quattro rettangoli pieni, con quello
     del cancello spezzato in due: così la collisione è sempre cerchio contro
     rettangolo, una funzione sola per staccionate, rocce e bordi. */
  function creaRecinto(mondoW, mondoH, pecore, rng) {
    var w = Math.round(34 + 3.4 * pecore);
    var h = Math.round(30 + 2.6 * pecore);
    var angolo = Math.floor(rng() * 4);
    var x = (angolo === 0 || angolo === 3) ? 8 : mondoW - w - 8;
    var y = (angolo === 0 || angolo === 1) ? 8 : mondoH - h - 8;
    /* Il cancello guarda verso il centro del pascolo: un cancello contro il
       bordo del mondo sarebbe un cancello da cui non si entra. */
    var lato = (x + w / 2 < mondoW / 2) ? 'dx' : 'sx';
    if (Math.abs(mondoH / 2 - (y + h / 2)) > Math.abs(mondoW / 2 - (x + w / 2))) {
      lato = (y + h / 2 < mondoH / 2) ? 'basso' : 'alto';
    }

    var muri = [];
    var porta;
    function spezza(orizzontale, fisso, da, a, centro) {
      var meta = PORTA / 2;
      if (orizzontale) {
        muri.push({ x: da, y: fisso, w: (centro - meta) - da, h: PALO });
        muri.push({ x: centro + meta, y: fisso, w: a - (centro + meta), h: PALO });
        porta = { x: centro - meta, y: fisso, w: PORTA, h: PALO };
      } else {
        muri.push({ x: fisso, y: da, w: PALO, h: (centro - meta) - da });
        muri.push({ x: fisso, y: centro + meta, w: PALO, h: a - (centro + meta) });
        porta = { x: fisso, y: centro - meta, w: PALO, h: PORTA };
      }
    }

    var cx = x + w / 2, cy = y + h / 2;
    if (lato === 'alto') spezza(true, y, x, x + w, cx); else muri.push({ x: x, y: y, w: w, h: PALO });
    if (lato === 'basso') spezza(true, y + h - PALO, x, x + w, cx); else muri.push({ x: x, y: y + h - PALO, w: w, h: PALO });
    if (lato === 'sx') spezza(false, x, y, y + h, cy); else muri.push({ x: x, y: y, w: PALO, h: h });
    if (lato === 'dx') spezza(false, x + w - PALO, y, y + h, cy); else muri.push({ x: x + w - PALO, y: y, w: PALO, h: h });

    return {
      x: x, y: y, w: w, h: h, lato: lato, muri: muri, porta: porta,
      dentro: { x: x + PALO, y: y + PALO, w: w - 2 * PALO, h: h - 2 * PALO },
      /* Il punto davanti al cancello: è lì che il gregge va spinto, ed è il
         bersaglio che il navigatore e il pilota simulato usano. */
      mira: {
        x: porta.x + porta.w / 2 + (lato === 'dx' ? 16 : lato === 'sx' ? -16 : 0),
        y: porta.y + porta.h / 2 + (lato === 'basso' ? 16 : lato === 'alto' ? -16 : 0)
      }
    };
  }

  /* Un pascolo intero. Può uscire impossibile — un dirupo che taglia la strada
     al cancello, un bosco che chiude l'unico passaggio — e allora si rifà: il
     controllo è una visita a griglia dal gregge al cancello, la stessa cosa
     che nelle Pizze ha evitato gli indirizzi irraggiungibili. Qui costa meno
     che nelle Pizze e serve di più, perché un livello impossibile non si vede
     giocandolo: sembra solo difficile. */
  function generaMondo(c, seme) {
    for (var tentativo = 0; tentativo < 40; tentativo++) {
      var m = provaMondo(c, (seme + tentativo * 7919) >>> 0);
      if (m) return m;
    }
    return provaMondo(c, seme, true);   // ripiego: pascolo nudo, sempre giocabile
  }

  function provaMondo(c, seme, nudo) {
    var rng = creaRng(seme);
    var mondo = { w: c.mondoW, h: c.mondoH, seme: seme };
    var recinto = creaRecinto(mondo.w, mondo.h, c.pecore, rng);
    mondo.recinto = recinto;
    mondo.muri = recinto.muri.slice();
    mondo.alberi = [];
    mondo.dirupi = [];

    /* Il gregge parte lontano dal recinto, dalla parte opposta: la partita è
       la strada in mezzo. */
    var lontano = {
      x: recinto.x + recinto.w / 2 < mondo.w / 2 ? mondo.w * 0.78 : mondo.w * 0.22,
      y: recinto.y + recinto.h / 2 < mondo.h / 2 ? mondo.h * 0.76 : mondo.h * 0.24
    };

    function liberoPer(x, y, r) {
      if (x < r || y < r || x > mondo.w - r || y > mondo.h - r) return false;
      if (distanzaRett(x, y, recinto) < r + 14) return false;
      if (Math.hypot(x - lontano.x, y - lontano.y) < 30) return false;
      for (var i = 0; i < mondo.alberi.length; i++) {
        var a = mondo.alberi[i];
        if (Math.hypot(x - a.x, y - a.y) < a.r + r + 10) return false;
      }
      for (var j = 0; j < mondo.dirupi.length; j++) {
        if (distanzaRett(x, y, mondo.dirupi[j]) < r + 12) return false;
      }
      return true;
    }

    if (!nudo) {
      /* Dirupi: strisce che entrano nel pascolo da un bordo, come una forra.
         Non si piazzano al centro a caso perché un dirupo in mezzo al prato
         sarebbe una pozza, non un dirupo: nelle Alpi il terreno si rompe dai
         lati del pascolo. */
      for (var d = 0; d < c.dirupi; d++) {
        for (var prova = 0; prova < 24; prova++) {
          var orizz = rng() < 0.5;
          var lungo = Math.round((orizz ? mondo.w : mondo.h) * (0.3 + rng() * 0.3));
          var spesso = Math.round(16 + rng() * 14);
          var r = orizz
            ? { x: rng() < 0.5 ? 0 : mondo.w - lungo, y: Math.round(24 + rng() * (mondo.h - 48 - spesso)), w: lungo, h: spesso }
            : { x: Math.round(24 + rng() * (mondo.w - 48 - spesso)), y: rng() < 0.5 ? 0 : mondo.h - lungo, w: spesso, h: lungo };
          if (distanzaRett(recinto.mira.x, recinto.mira.y, r) < 24) continue;
          if (distanzaRett(lontano.x, lontano.y, r) < 30) continue;
          if (distanzaRett(recinto.x + recinto.w / 2, recinto.y + recinto.h / 2, r) < 26) continue;
          mondo.dirupi.push(r);
          break;
        }
      }

      /* Boschi: grappoli di pini, non alberi sparsi. Un bosco spacca il gregge
         in due, un albero solo lo fa deviare: sono due difficoltà diverse, e
         quella che il gioco promette è il bosco. Fra due tronchi restano
         sempre almeno dieci pixel, cioè il passaggio per una pecora. */
      for (var b = 0; b < c.boschi; b++) {
        var quanti = 3 + Math.floor(rng() * 5);
        var bx = 0, by = 0, trovato = false;
        for (var t = 0; t < 30 && !trovato; t++) {
          bx = 20 + rng() * (mondo.w - 40);
          by = 20 + rng() * (mondo.h - 40);
          trovato = liberoPer(bx, by, 16);
        }
        if (!trovato) continue;
        for (var q = 0; q < quanti; q++) {
          for (var p = 0; p < 16; p++) {
            var ang = rng() * Math.PI * 2;
            var rad = rng() * 20;
            var ax = bx + Math.cos(ang) * rad;
            var ay = by + Math.sin(ang) * rad;
            var raggio = 4 + rng() * 1.5;
            if (!liberoPer(ax, ay, raggio)) continue;
            mondo.alberi.push({ x: ax, y: ay, r: raggio, tipo: 'pino' });
            break;
          }
        }
      }

      /* Rocce e cespugli: ingombro minore, servono a rompere il prato vuoto.
         I cespugli non fermano nessuno (r = 0 per la collisione), stanno lì
         perché un pascolo di erba liscia non sembra un pascolo. */
      var sassi = 2 + Math.floor(rng() * 4 + c.level * 0.4);
      for (var s = 0; s < sassi; s++) {
        for (var ps = 0; ps < 20; ps++) {
          var sx = 14 + rng() * (mondo.w - 28);
          var sy = 14 + rng() * (mondo.h - 28);
          if (!liberoPer(sx, sy, 5)) continue;
          mondo.alberi.push({ x: sx, y: sy, r: 3.6, tipo: 'roccia' });
          break;
        }
      }
      mondo.cespugli = [];
      for (var cz = 0; cz < 10 + Math.round(c.scala * 8); cz++) {
        mondo.cespugli.push({ x: rng() * mondo.w, y: rng() * mondo.h, g: rng() < 0.5 });
      }
    } else {
      mondo.cespugli = [];
    }

    /* Le pecore attorno al punto lontano, sparse: lo sparpaglio cresce col
       livello perché radunare è metà del mestiere. */
    mondo.pecore = [];
    var sparse = 14 + c.level * 2.2;
    for (var i = 0; i < c.pecore; i++) {
      var px = 0, py = 0, ok = false;
      for (var pp = 0; pp < 40 && !ok; pp++) {
        px = lontano.x + (rng() * 2 - 1) * sparse;
        py = lontano.y + (rng() * 2 - 1) * sparse;
        ok = px > 6 && py > 6 && px < mondo.w - 6 && py < mondo.h - 6 &&
          distanzaRett(px, py, recinto) > 10 && !inDirupo(mondo, px, py) &&
          !suAlbero(mondo, px, py, R_PECORA);
      }
      mondo.pecore.push({
        x: px, y: py, vx: 0, vy: 0,
        nera: i < c.nere, stato: 'libera', allarme: 0, verso: 1,
        caduta: 0, meta: null, pascolo: rng() * 3
      });
    }

    mondo.cane = { x: lontano.x, y: lontano.y + 26, vx: 0, vy: 0, verso: 1, passo: 0 };
    if (inDirupo(mondo, mondo.cane.x, mondo.cane.y) || suAlbero(mondo, mondo.cane.x, mondo.cane.y, R_CANE)) {
      mondo.cane.x = lontano.x; mondo.cane.y = lontano.y;
    }

    mondo.centroPartenza = { x: lontano.x, y: lontano.y };
    mondo.sparpaglio = sparse * 2;
    mondo.distanza = Math.hypot(lontano.x - recinto.mira.x, lontano.y - recinto.mira.y);

    if (nudo) return mondo;
    return raggiungibile(mondo) ? mondo : null;
  }

  function inDirupo(mondo, x, y) {
    for (var i = 0; i < mondo.dirupi.length; i++) {
      if (dentroRett(x, y, mondo.dirupi[i])) return true;
    }
    return false;
  }

  function suAlbero(mondo, x, y, r) {
    for (var i = 0; i < mondo.alberi.length; i++) {
      var a = mondo.alberi[i];
      if (Math.hypot(x - a.x, y - a.y) < a.r + r) return true;
    }
    return false;
  }

  function suMuro(mondo, x, y, r) {
    for (var i = 0; i < mondo.muri.length; i++) {
      if (distanzaRett(x, y, mondo.muri[i]) < r) return true;
    }
    return false;
  }

  /* Visita a griglia: dal recinto si deve poter raggiungere OGNI pecora, non
     il centro del gruppo.

     La prima versione partiva dal centro e si fermava lì, e un test l'ha
     colta in fallo al sesto livello: una pecora nata in una sacca chiusa fra
     i tronchi di un bosco, con il centro del gregge tranquillamente
     raggiungibile. Il livello sarebbe stato impossibile senza sembrarlo —
     tutte dentro tranne una, e quella irraggiungibile. Una visita sola dal
     recinto risponde per tutte, e costa meno di una per pecora.

     Il passo è 3 px, cioè il raggio di una pecora: una griglia più larga
     dichiarerebbe passabile un varco in cui non ci sta. */
  function raggiungibile(mondo) {
    var passo = 3;
    var cols = Math.ceil(mondo.w / passo), righe = Math.ceil(mondo.h / passo);
    var ok = new Uint8Array(cols * righe);
    var ci, cj, x, y;
    for (cj = 0; cj < righe; cj++) {
      for (ci = 0; ci < cols; ci++) {
        x = ci * passo + passo / 2;
        y = cj * passo + passo / 2;
        ok[cj * cols + ci] = (!inDirupo(mondo, x, y) &&
          !suAlbero(mondo, x, y, R_PECORA) &&
          !suMuro(mondo, x, y, R_PECORA)) ? 1 : 0;
      }
    }
    var dentro = mondo.recinto.dentro;
    var start = indice({ x: dentro.x + dentro.w / 2, y: dentro.y + dentro.h / 2 }, passo, cols, righe);
    if (start < 0 || !ok[start]) return false;

    var visto = new Uint8Array(cols * righe);
    var coda = [start];
    visto[start] = 1;
    while (coda.length) {
      var cur = coda.pop();
      var i0 = cur % cols, j0 = (cur - i0) / cols;
      for (var v = 0; v < 4; v++) {
        var ni = i0 + [1, -1, 0, 0][v], nj = j0 + [0, 0, 1, -1][v];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= righe) continue;
        var k = nj * cols + ni;
        if (visto[k] || !ok[k]) continue;
        visto[k] = 1;
        coda.push(k);
      }
    }

    var mete = [mondo.recinto.mira, mondo.centroPartenza, mondo.cane];
    for (var mi = 0; mi < mondo.pecore.length; mi++) mete.push(mondo.pecore[mi]);
    for (var t = 0; t < mete.length; t++) {
      var im = indice(mete[t], passo, cols, righe);
      if (im < 0 || !visto[im]) return false;
    }
    return true;
  }

  function indice(p, passo, cols, righe) {
    var i = Math.floor(p.x / passo), j = Math.floor(p.y / passo);
    if (i < 0 || j < 0 || i >= cols || j >= righe) return -1;
    return j * cols + i;
  }

  /* ---------- il gioco ---------- */

  TG.registry.register({
    id: 'gregge',
    title: 'Gregge',
    icon: '🐕',
    tagline: 'Cane da pastore: porta le pecore nel recinto prima che scenda la notte.',
    scoreLabel: 'Punti',
    controls: 'joystick',
    viewport: { w: VIS_W, h: VIS_H },
    howto: '<b>Comandi:</b> la leva (o frecce/WASD) muove il cane. ' +
      'Le pecore <b>scappano da te</b> e <b>si tengono insieme</b>: non si ' +
      'guidano, si spingono. Mettiti <b>dietro al gruppo</b> rispetto al ' +
      'recinto e il gruppo avanza; mettiti <b>di fianco</b> e gira; arrivagli ' +
      'addosso in mezzo e <b>lo spacchi in due</b>. Chi si stacca va ripreso ' +
      'girandogli dietro, largo. ' +
      '<b>I dirupi</b> sono il pericolo: tu ti fermi sul bordo, loro no — una ' +
      'pecora spinta nel vuoto è persa, e oltre il numero di perdite ' +
      'consentite il livello è finito. I <b>boschi</b> non fermano le pecore, ' +
      'le dividono. Le <b>pecore nere</b> si fidano di più: vanno avvicinate ' +
      'di persona. Una pecora <b>dentro al recinto si tranquillizza</b> e non ' +
      'esce più, quindi si può lavorare con calma sulle ultime. Il livello è ' +
      'vinto quando il gregge è dentro, prima che finisca la luce.',

    levelInfo: function (level) {
      var c = config(level);
      return 'Livello ' + level + ': ' + c.pecore + ' pecore' +
        (c.nere ? ' (' + c.nere + ' nere)' : '') +
        ', pascolo ' + c.scala.toFixed(2) + '×, ' +
        (c.dirupi ? c.dirupi + (c.dirupi === 1 ? ' dirupo' : ' dirupi') : 'nessun dirupo') +
        ', puoi perderne ' + c.tolleranza;
    },

    create: function (api) {
      var c = config(1);
      var mondo = null;
      var tempo = 0, tempoTot = 0;
      var dentro = 0, perse = 0;
      var finito = false;
      var cam = { x: 0, y: 0 };
      var ultimoBau = 0;
      var tLivello = 0;

      /* ---------- avvio ---------- */

      function start(level) {
        c = config(level);
        mondo = generaMondo(c, (Math.random() * 4294967296) >>> 0);
        tempoTot = tempoConcesso(c, mondo.distanza, mondo.sparpaglio);
        tempo = tempoTot;
        dentro = 0;
        perse = 0;
        finito = false;
        tLivello = 0;
        ultimoBau = 0;
        cam.x = 0; cam.y = 0;
        aggiornaCamera(1);
      }

      /* ---------- spazio libero ---------- */

      function libero(x, y, r, bloccaDirupi) {
        if (x < r || y < r || x > mondo.w - r || y > mondo.h - r) return false;
        if (suAlbero(mondo, x, y, r)) return false;
        if (suMuro(mondo, x, y, r)) return false;
        if (bloccaDirupi && inDirupo(mondo, x, y)) return false;
        return true;
      }

      /* Movimento ad assi separati: se la x non si può fare si prova la y, e
         il risultato è che si slitta lungo i muri invece di incollarsi. È la
         lezione delle Pizze, dove azzerare tutta la velocità al contatto
         piantava l'auto negli angoli — con la differenza che qui gli ostacoli
         sono tondi e i muri pochi, quindi non serve calcolare normali. */
      function muovi(e, r, dx, dy, bloccaDirupi) {
        var px = e.x, py = e.y;
        var fermoX = false, fermoY = false;
        if (dx) {
          e.x = px + dx;
          if (!libero(e.x, e.y, r, bloccaDirupi)) { e.x = px; fermoX = true; }
        }
        if (dy) {
          e.y = py + dy;
          if (!libero(e.x, e.y, r, bloccaDirupi)) { e.y = py; fermoY = true; }
        }
        // incastrata: nessuno dei due assi ha ceduto
        return (fermoX || !dx) && (fermoY || !dy) && (dx !== 0 || dy !== 0);
      }

      /* ---------- il cane ---------- */

      function passoCane(dt) {
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
        var cane = mondo.cane;
        if (mx !== 0) cane.verso = mx > 0 ? 1 : -1;
        cane.passo += Math.hypot(mx, my) * dt * 9;     // per l'animazione delle zampe
        muovi(cane, R_CANE, mx * VEL_CANE * dt, my * VEL_CANE * dt, true);
      }

      /* ---------- le pecore ----------
         Il cuore del gioco. Le spinte si sommano come accelerazioni, non come
         posizioni: una pecora ha inerzia, e senza inerzia il gregge si
         teletrasporta attorno al cane invece di scappare. */
      function passoPecore(dt) {
        var i, j, p, q;
        var libere = [];
        for (i = 0; i < mondo.pecore.length; i++) {
          p = mondo.pecore[i];
          if (p.stato === 'libera' && !p.caduta) libere.push(p);
        }

        for (i = 0; i < mondo.pecore.length; i++) {
          p = mondo.pecore[i];
          if (p.stato === 'persa') continue;

          /* Caduta: mezzo secondo in cui la pecora sparisce nel dirupo. Serve
             a far vedere cosa è successo — un conteggio che cala senza un
             motivo visibile sembra un difetto del gioco, non un errore tuo. */
          if (p.caduta > 0) {
            p.caduta -= dt;
            p.y += 26 * dt;
            if (p.caduta <= 0) {
              p.stato = 'persa';
              perse++;
              if (perse > c.tolleranza) {
                finisci(false, 'Hai perso il gregge: ' + perse +
                  (perse === 1 ? ' pecora' : ' pecore') + ' nel dirupo.');
                return;
              }
            }
            continue;
          }

          var fx = 0, fy = 0;
          var vmax = VEL_PASCOLO;

          if (p.stato === 'recinto') {
            /* Dentro al recinto si sta tranquille: il cane non le spaventa più.
               È una regola di gioco, non una simulazione — senza, l'ultima
               pecora costerebbe le prime. */
            var d0 = mondo.recinto.dentro;
            fx += ((d0.x + d0.w / 2) - p.x) * 1.4;
            fy += ((d0.y + d0.h / 2) - p.y) * 1.4;
            vmax = VEL_PASCOLO * 0.8;
          } else {
            var paura = p.nera ? PAURA_NERA : PAURA;
            var dx = p.x - mondo.cane.x, dy = p.y - mondo.cane.y;
            var d = Math.hypot(dx, dy) || 0.001;
            if (d < paura) {
              var forza = 90 + 190 * (1 - d / paura);
              fx += dx / d * forza;
              fy += dy / d * forza;
              if (p.allarme <= 0 && tLivello - ultimoBau > 0.45) {
                api.sfx.tone(190, 0.07, 'square', 0.16, 120);   // bau
                ultimoBau = tLivello;
              }
              p.allarme = ALLARME;
              vmax = VEL_PECORA * (p.nera ? 0.92 : 1);
            }

            if (p.allarme > 0) {
              p.allarme -= dt;
              vmax = Math.max(vmax, VEL_PECORA * 0.75);
              /* Istinto di gregge: verso il centro delle compagne che vede, e
                 via da quelle addosso. Il primo tiene insieme il gruppo (ed è
                 quello che rende possibile condurlo), il secondo gli dà un
                 volume invece di ridurlo a un punto. */
              var cx = 0, cy = 0, n = 0;
              for (j = 0; j < libere.length; j++) {
                q = libere[j];
                if (q === p) continue;
                var qd = Math.hypot(q.x - p.x, q.y - p.y);
                if (qd < GREGGE) { cx += q.x; cy += q.y; n++; }
                if (qd < VICINO && qd > 0.001) {
                  fx += (p.x - q.x) / qd * 60;
                  fy += (p.y - q.y) / qd * 60;
                }
              }
              if (n) {
                cx /= n; cy /= n;
                var cd = Math.hypot(cx - p.x, cy - p.y) || 0.001;
                fx += (cx - p.x) / cd * 52;
                fy += (cy - p.y) / cd * 52;
              }
            } else {
              /* Al pascolo: due passi e una brucata. Non stanno immobili —
                 un gregge immobile si radunerebbe una volta sola e poi
                 basta — ma non vanno da nessuna parte. */
              p.pascolo -= dt;
              if (p.pascolo <= 0) {
                p.pascolo = 1.5 + Math.random() * 3;
                p.meta = { x: p.x + (Math.random() * 2 - 1) * 16, y: p.y + (Math.random() * 2 - 1) * 16 };
              }
              if (p.meta) {
                var md = Math.hypot(p.meta.x - p.x, p.meta.y - p.y) || 0.001;
                fx += (p.meta.x - p.x) / md * 14;
                fy += (p.meta.y - p.y) / md * 14;
              }
            }
          }

          /* Prudenza verso il bordo: forte mentre brucano, più debole in fuga
             (chi scappa guarda indietro). Non è questa la cosa che le salva —
             quella è il bordo che le blocca, più sotto — ma è ciò che tiene il
             gregge al pascolo lontano dalla forra invece che appoggiato. */
          if (p.stato === 'libera') {
            var pesoDirupo = p.allarme > 0 ? 30 : 55;
            for (j = 0; j < mondo.dirupi.length; j++) {
              var dr = mondo.dirupi[j];
              if (distanzaRett(p.x, p.y, dr) >= 11) continue;
              var qx = Math.max(dr.x, Math.min(p.x, dr.x + dr.w));
              var qy = Math.max(dr.y, Math.min(p.y, dr.y + dr.h));
              var ndx = p.x - qx, ndy = p.y - qy;
              var nl = Math.hypot(ndx, ndy) || 0.001;
              fx += ndx / nl * pesoDirupo;
              fy += ndy / nl * pesoDirupo;
            }
          }

          /* Il bordo del pascolo è una siepe, non un muro liscio: le pecore
             stanno larghe qualche pixel. Senza, finivano appiccicate allo
             spigolo del mondo e il cane non aveva più modo di mettersi dietro
             — misurato: un quarto delle partite perse al terzo livello era una
             pecora ferma a tre pixel dal bordo con l'orologio che scorreva.
             Una siepe morbida costa due righe e toglie l'unica geometria in cui
             il gioco non si può più giocare. */
          if (p.stato === 'libera') {
            var bordo = 9;
            if (p.x < bordo) fx += (bordo - p.x) * 7;
            if (p.y < bordo) fy += (bordo - p.y) * 7;
            if (p.x > mondo.w - bordo) fx -= (p.x - (mondo.w - bordo)) * 7;
            if (p.y > mondo.h - bordo) fy -= (p.y - (mondo.h - bordo)) * 7;
          }

          // via dagli ostacoli: valgono sempre, anche in panico
          for (j = 0; j < mondo.alberi.length; j++) {
            var a = mondo.alberi[j];
            var adx = p.x - a.x, ady = p.y - a.y;
            var ad = Math.hypot(adx, ady) || 0.001;
            if (ad < a.r + 7) {
              fx += adx / ad * 70;
              fy += ady / ad * 70;
            }
          }

          p.vx = (p.vx + fx * dt) * 0.90;
          p.vy = (p.vy + fy * dt) * 0.90;
          var vl = Math.hypot(p.vx, p.vy);
          if (vl > vmax) { p.vx = p.vx / vl * vmax; p.vy = p.vy / vl * vmax; }
          if (Math.abs(p.vx) > 2) p.verso = p.vx > 0 ? 1 : -1;

          /* Il dirupo come muro, tranne quando il cane è addosso.

             Prima il vuoto non fermava le pecore, e il risultato misurato era
             che il 96% delle cadute avveniva col cane a venti o trenta pixel:
             la spinta della fuga (fino a 190) copriva qualunque prudenza (24),
             quindi passare al largo di una forra costava una pecora a caso.
             Una perdita che non puoi né prevedere né evitare non è una
             difficoltà, è una tassa.

             Adesso una pecora in fuga tratta il bordo come una staccionata e
             corre lungo il bordo invece che oltre. Ci finisce dentro solo se il
             cane le è praticamente addosso (dodici pixel) e non le resta via
             di fuga: cioè se l'hai messa all'angolo contro il vuoto, che è una
             cosa che hai fatto tu. Il dirupo resta la difficoltà che
             prometteva — taglia il pascolo in due e nemmeno il cane lo passa —
             e smette di essere una lotteria. */
          var panico = Math.hypot(p.x - mondo.cane.x, p.y - mondo.cane.y) < 12;
          var incastrata = muovi(p, R_PECORA, p.vx * dt, p.vy * dt, !panico);

          /* Una pecora in un angolo, col cane addosso, non ha più nessuna
             direzione libera: la spinta la schiaccia contro lo spigolo e lì
             resterebbe per sempre. Una pecora vera sbuca di lato lungo il
             muro, e il livello va chiuso in un modo che esiste — un gregge
             irrecuperabile non è una difficoltà, è un vicolo cieco. Quindi
             quando entrambi gli assi sono bloccati la velocità gira di
             novanta gradi, dalla parte in cui c'è passaggio. */
          if (incastrata && p.allarme > 0) {
            var lung = Math.hypot(p.vx, p.vy);
            if (lung > 1) {
              var ax = -p.vy, ay = p.vx;
              if (!libero(p.x + ax * dt, p.y + ay * dt, R_PECORA, false)) { ax = p.vy; ay = -p.vx; }
              p.vx = ax; p.vy = ay;
              muovi(p, R_PECORA, p.vx * dt, p.vy * dt, false);
            }
          }

          // dentro al dirupo non c'è più terreno
          if (p.stato === 'libera' && inDirupo(mondo, p.x, p.y)) {
            p.caduta = 0.55;
            p.vx = 0; p.vy = 0;
            api.sfx.fail();
            continue;
          }

          // dentro al recinto: contata, e da lì non esce più
          if (p.stato === 'libera' && dentroRett(p.x, p.y, mondo.recinto.dentro)) {
            p.stato = 'recinto';
            p.allarme = 0;
            dentro++;
            api.addScore(c.punti);
            api.sfx.tone(560, 0.09, 'sawtooth', 0.13, 760);     // beee
          }
        }
      }

      /* ---------- fine del livello ---------- */

      function finisci(vinto, messaggio) {
        if (finito) return;
        finito = true;
        if (vinto) api.levelComplete({ bonus: Math.round(tempo) + 10 * c.level, message: messaggio });
        else api.gameOver({ message: messaggio });
      }

      function controllaFine() {
        if (finito) return;
        if (dentro + perse >= c.pecore && perse <= c.tolleranza) {
          finisci(true, dentro + (dentro === 1 ? ' pecora' : ' pecore') + ' al sicuro' +
            (perse ? ', ' + perse + ' nel dirupo' : ', gregge intero') + '.');
        }
      }

      /* ---------- camera ----------
         Segue il cane e si ferma ai bordi del pascolo. Arrotondata al pixel:
         una camera a coordinate frazionarie farebbe tremolare tutto il disegno,
         che in pixel art si vede subito. */
      function aggiornaCamera(k) {
        var maxx = Math.max(0, mondo.w - VIS_W);
        var maxy = Math.max(0, mondo.h - CAMPO_H);
        var tx = Math.max(0, Math.min(mondo.cane.x - VIS_W / 2, maxx));
        var ty = Math.max(0, Math.min(mondo.cane.y - CAMPO_H / 2, maxy));
        cam.x = Math.round(cam.x + (tx - cam.x) * k);
        cam.y = Math.round(cam.y + (ty - cam.y) * k);
      }

      /* ---------- ciclo ---------- */

      function update(dt) {
        if (finito || !mondo) return;
        tLivello += dt;
        tempo -= dt;
        if (tempo <= 0) {
          tempo = 0;
          finisci(false, 'È scesa la notte con ' + (c.pecore - dentro - perse) +
            ' pecore ancora fuori.');
          return;
        }
        passoCane(dt);
        passoPecore(dt);
        aggiornaCamera(Math.min(1, dt * 9));
        controllaFine();
      }

      function state() {
        return {
          mondo: { w: mondo.w, h: mondo.h },
          cane: mondo.cane,
          pecore: mondo.pecore,
          recinto: mondo.recinto,
          alberi: mondo.alberi,
          dirupi: mondo.dirupi,
          muri: mondo.muri,
          tempo: tempo,
          tempoTot: tempoTot,
          dentro: dentro,
          perse: perse,
          totale: c.pecore,
          tolleranza: c.tolleranza,
          paura: PAURA,
          velCane: VEL_CANE,
          camera: cam
        };
      }

      /* ---------- grafica ----------
         Gli sprite diventano piccole canvas una volta sola, al primo
         fotogramma: nella sandbox dei test `document` non esiste e draw() non
         viene mai chiamata, quindi la preparazione non può stare in create().
         Stampare 96 rettangoli per ogni pino a ogni fotogramma, con quaranta
         pini in campo, non sarebbe andato da nessuna parte. */
      var grafica = null;
      var terreno = null;

      function renderSprite(righe, cambi) {
        var w = righe[0].length, h = righe.length;
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var g = cv.getContext('2d');
        for (var j = 0; j < h; j++) {
          for (var i = 0; i < w; i++) {
            var ch = righe[j].charAt(i);
            if (ch === '.' || ch === ' ') continue;
            var col = (cambi && cambi[ch]) || COLORI[ch];
            if (!col) continue;
            g.fillStyle = col;
            g.fillRect(i, j, 1, 1);
          }
        }
        return cv;
      }

      function preparaGrafica() {
        if (grafica || typeof document === 'undefined') return;
        grafica = {};
        Object.keys(SPRITE).forEach(function (k) { grafica[k] = renderSprite(SPRITE[k]); });
        /* La pecora nera è lo stesso sprite con un'altra tavolozza: è il modo
           in cui si faceva, e vuol dire che correggere la posa le corregge
           tutte. */
        grafica.pecoraNera = renderSprite(SPRITE.pecora, {
          w: '#4c4c56', e: '#5e5e69', n: '#121318', k: '#0d0e12'
        });
      }

      /* Il pascolo è fermo: erba, chiazze, dirupi, staccionate e cespugli si
         disegnano una volta in una canvas grande come il mondo e poi si fa
         scorrere quella. Gli alberi no: quelli vanno ordinati insieme a cane e
         pecore, altrimenti una pecora dietro a un pino gli finirebbe davanti. */
      function preparaTerreno() {
        if (typeof document === 'undefined') return;
        if (terreno && terreno.seme === mondo.seme) return;
        var cv = document.createElement('canvas');
        cv.width = mondo.w;
        cv.height = mondo.h + MONTI;
        var g = cv.getContext('2d');
        var rng = creaRng(mondo.seme ^ 0x9e3779b9);

        // monti: la fascia sopra al pascolo, roccia e neve
        var grad = g.createLinearGradient(0, 0, 0, MONTI);
        grad.addColorStop(0, '#6d7f94');
        grad.addColorStop(1, '#49566a');
        g.fillStyle = grad;
        g.fillRect(0, 0, cv.width, MONTI);
        for (var px = -10; px < mondo.w + 10; px += 14) {
          var alt = 10 + rng() * 14;
          var larg = 9 + rng() * 9;
          g.fillStyle = '#5b6a7d';
          g.beginPath();
          g.moveTo(px - larg, MONTI);
          g.lineTo(px, MONTI - alt);
          g.lineTo(px + larg, MONTI);
          g.closePath();
          g.fill();
          g.fillStyle = COLORI.s;                 // neve sulla cima
          g.beginPath();
          g.moveTo(px - larg * 0.33, MONTI - alt * 0.62);
          g.lineTo(px, MONTI - alt);
          g.lineTo(px + larg * 0.33, MONTI - alt * 0.62);
          g.closePath();
          g.fill();
        }
        // il bordo del pascolo contro la montagna
        g.fillStyle = '#3f4a3a';
        g.fillRect(0, MONTI - 2, cv.width, 2);

        /* Erba: un fondo, chiazze piccole e ciuffi da un pixel. La prima
           versione usava lastre fino a diciotto pixel per nove, e a schermo si
           vedevano i rettangoli invece del prato — in pixel art la texture si
           fa con tanti segni piccoli e poco contrasto, non con poche macchie
           grandi. */
        g.fillStyle = '#4e9c52';
        g.fillRect(0, MONTI, mondo.w, mondo.h);
        var VERDI = ['#4a9850', '#54a158', '#46914b', '#59a75e'];
        var chiazze = Math.round(mondo.w * mondo.h / 90);
        for (var i = 0; i < chiazze; i++) {
          var cx = Math.round(rng() * mondo.w), cy = MONTI + Math.round(rng() * mondo.h);
          g.fillStyle = VERDI[Math.floor(rng() * VERDI.length)];
          g.fillRect(cx, cy, 2 + Math.round(rng() * 4), 1 + Math.round(rng() * 2));
        }
        var ciuffi = Math.round(mondo.w * mondo.h / 240);
        for (var ci = 0; ci < ciuffi; ci++) {
          var tx = Math.round(rng() * mondo.w), ty = MONTI + Math.round(rng() * mondo.h);
          g.fillStyle = rng() < 0.5 ? '#3f8a45' : '#65b069';
          g.fillRect(tx, ty, 1, 1);
          g.fillRect(tx + 1, ty - 1, 1, 1);
        }

        /* Dirupi: perché si legga un salto e non una pozza scura servono tre
           cose — il labbro di roccia illuminato sul bordo di sopra, una cornice
           chiara su tutti i lati (è l'orlo del terreno che si è rotto) e, nel
           fondo, qualche riga di pietrisco. Senza la cornice un dirupo
           verticale sembrava una striscia di catrame. */
        mondo.dirupi.forEach(function (d) {
          g.fillStyle = '#272320';
          g.fillRect(d.x, MONTI + d.y, d.w, d.h);
          g.fillStyle = '#6f675c';                       // orlo su tutti i lati
          g.fillRect(d.x, MONTI + d.y, d.w, 2);
          g.fillRect(d.x, MONTI + d.y + d.h - 2, d.w, 2);
          g.fillRect(d.x, MONTI + d.y, 2, d.h);
          g.fillRect(d.x + d.w - 2, MONTI + d.y, 2, d.h);
          g.fillStyle = '#8d8478';                       // labbro al sole
          g.fillRect(d.x, MONTI + d.y - 1, d.w, 1);
          g.fillStyle = '#4a423a';                       // parete sotto l'orlo
          g.fillRect(d.x + 2, MONTI + d.y + 2, d.w - 4, 3);
          for (var k = 0; k < d.w * d.h / 14; k++) {
            var sxx = d.x + 2 + Math.round(rng() * (d.w - 5));
            var syy = MONTI + d.y + 5 + Math.round(rng() * Math.max(1, d.h - 8));
            g.fillStyle = rng() < 0.4 ? '#3b352f' : (rng() < 0.5 ? '#1c1916' : '#554d44');
            g.fillRect(sxx, syy, 1 + Math.round(rng() * 2), 1);
          }
        });

        // cespugli e sassolini: servono a non avere un prato di vernice
        (mondo.cespugli || []).forEach(function (cz) {
          if (inDirupo(mondo, cz.x, cz.y)) return;
          g.fillStyle = cz.g ? '#3f8a45' : '#6ab06f';
          g.fillRect(Math.round(cz.x), MONTI + Math.round(cz.y), 2, 1);
          g.fillStyle = cz.g ? COLORI.y : '#e9f0f5';
          g.fillRect(Math.round(cz.x) + (cz.g ? 1 : 0), MONTI + Math.round(cz.y) - 1, 1, 1);
        });

        // il recinto: terra battuta dentro, staccionata di legno sopra
        var dd = mondo.recinto.dentro;
        g.fillStyle = '#8d7a54';
        g.fillRect(dd.x, MONTI + dd.y, dd.w, dd.h);
        for (var sp = 0; sp < dd.w * dd.h / 30; sp++) {
          g.fillStyle = rng() < 0.5 ? '#9c8a63' : '#7d6b49';
          g.fillRect(dd.x + Math.round(rng() * dd.w), MONTI + dd.y + Math.round(rng() * dd.h), 2, 1);
        }
        mondo.muri.forEach(function (m) {
          g.fillStyle = COLORI.T;
          g.fillRect(m.x, MONTI + m.y, m.w, m.h);
          g.fillStyle = COLORI.t;
          g.fillRect(m.x, MONTI + m.y, m.w, 1);
          // i pali, ogni sei pixel lungo la staccionata
          var lungo = m.w >= m.h;
          var n = Math.max(2, Math.round((lungo ? m.w : m.h) / 6));
          for (var pi = 0; pi <= n; pi++) {
            var fx = lungo ? m.x + (m.w - 1) * pi / n : m.x;
            var fy = lungo ? m.y : m.y + (m.h - 1) * pi / n;
            g.fillStyle = COLORI.b;
            g.fillRect(Math.round(fx), MONTI + Math.round(fy) - 2, 2, 4);
          }
        });
        // il cancello: due pali e nessuna traversa, così si vede che è aperto
        var po = mondo.recinto.porta;
        g.fillStyle = COLORI.b;
        g.fillRect(Math.round(po.x), MONTI + Math.round(po.y) - 2, 2, 5);
        g.fillRect(Math.round(po.x + po.w - 2), MONTI + Math.round(po.y + po.h - 3), 2, 5);

        terreno = { cv: cv, seme: mondo.seme };
      }

      function disegnaSprite(ctx, img, x, y, verso) {
        if (!img) return;
        var sx = Math.round(x - img.width / 2);
        var sy = Math.round(y - img.height + 2);     // i piedi stanno su y
        if (verso < 0) {
          ctx.save();
          ctx.translate(sx + img.width, sy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          ctx.restore();
        } else {
          ctx.drawImage(img, sx, sy);
        }
      }

      function scriviNumero(ctx, testo, x, y, colore) {
        ctx.fillStyle = colore;
        var cx = Math.round(x);
        for (var i = 0; i < testo.length; i++) {
          var glifo = CIFRE[testo.charAt(i)];
          if (!glifo) { cx += 2; continue; }
          for (var j = 0; j < 5; j++) {
            for (var k = 0; k < 3; k++) {
              if (glifo[j].charAt(k) === '1') ctx.fillRect(cx + k, Math.round(y) + j, 1, 1);
            }
          }
          cx += 4;
        }
      }

      /* La barra in alto dice due cose e nessuna a parole: quante pecore sono
         dentro su quante, e quanta luce resta. Le perdite compaiono solo nei
         livelli in cui si può perdere qualcosa, cioè da quando ci sono i
         dirupi: un contatore sempre a zero non informa, occupa. */
      function disegnaBarra(ctx) {
        ctx.fillStyle = '#121620';
        ctx.fillRect(0, 0, VIS_W, TOP);
        ctx.fillStyle = '#2a3140';
        ctx.fillRect(0, TOP - 1, VIS_W, 1);

        disegnaSprite(ctx, grafica && grafica.pecora, 10, 15, 1);
        scriviNumero(ctx, dentro + '/' + c.pecore, 17, 7, COLORI.w);

        var x = 52;
        if (c.tolleranza > 0 || perse > 0) {
          ctx.fillStyle = '#7d7368';
          ctx.fillRect(x, 8, 7, 2);
          ctx.fillStyle = '#2a2420';
          ctx.fillRect(x, 10, 7, 4);
          scriviNumero(ctx, perse + '/' + c.tolleranza, x + 10, 7,
            perse >= c.tolleranza ? COLORI.c : COLORI.e);
          x += 34;
        }

        // la luce del giorno: barra che si svuota, con il sole che cala
        var bw = VIS_W - x - 10;
        var q = Math.max(0, Math.min(1, tempo / (tempoTot || 1)));
        ctx.fillStyle = '#242a38';
        ctx.fillRect(x, 9, bw, 5);
        ctx.fillStyle = q > 0.35 ? COLORI.y : COLORI.o;
        ctx.fillRect(x, 9, Math.round(bw * q), 5);
        var sx = x + Math.round(bw * q);
        ctx.fillStyle = q > 0.35 ? '#fff3b0' : '#ffd9a0';
        ctx.fillRect(sx - 2, 7, 4, 4);
      }

      /* Segnalini al bordo: una pecora fuori inquadratura è l'unica cosa che
         il giocatore non può dedurre, e senza segnalini il pascolo grande
         diventerebbe una caccia al tesoro. Il recinto ne ha uno suo, più
         grosso, perché è la direzione in cui si sta lavorando. */
      function disegnaSegnalini(ctx) {
        function bordo(wx, wy, colore, grosso) {
          var sx = wx - cam.x, sy = wy - cam.y;
          if (sx >= 2 && sx <= VIS_W - 2 && sy >= 2 && sy <= CAMPO_H - 2) return;
          var bx = Math.max(2, Math.min(VIS_W - 3, sx));
          var by = Math.max(2, Math.min(CAMPO_H - 3, sy));
          ctx.fillStyle = colore;
          var d = grosso ? 3 : 2;
          ctx.fillRect(Math.round(bx - d / 2), Math.round(by - d / 2), d, d);
        }
        mondo.pecore.forEach(function (p) {
          if (p.stato !== 'libera' || p.caduta) return;
          bordo(p.x, p.y, p.nera ? '#8b8b96' : COLORI.w, false);
        });
        var r = mondo.recinto;
        bordo(r.x + r.w / 2, r.y + r.h / 2, COLORI.b, true);
      }

      function draw(ctx) {
        if (!mondo) return;
        preparaGrafica();
        preparaTerreno();
        ctx.imageSmoothingEnabled = false;

        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, VIS_W, VIS_H);

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, TOP, VIS_W, CAMPO_H);
        ctx.clip();
        ctx.translate(0, TOP);

        if (terreno) ctx.drawImage(terreno.cv, -cam.x, -cam.y - MONTI);

        /* Ordine del pittore sulla y: chi sta più in basso è più vicino e
           copre. È l'unica cosa che dà spessore a una vista dall'alto, e costa
           un ordinamento di cinquanta elementi. */
        var pezzi = [];
        mondo.alberi.forEach(function (a) {
          pezzi.push({ y: a.y, x: a.x, img: a.tipo === 'roccia' ? grafica && grafica.roccia : grafica && grafica.pino, verso: 1 });
        });
        mondo.pecore.forEach(function (p) {
          if (p.stato === 'persa') return;
          pezzi.push({
            y: p.y, x: p.x, verso: p.verso,
            img: p.nera ? (grafica && grafica.pecoraNera) : (grafica && grafica.pecora),
            cade: p.caduta > 0
          });
        });
        pezzi.push({ y: mondo.cane.y, x: mondo.cane.x, img: grafica && grafica.cane, verso: mondo.cane.verso, cane: true });
        pezzi.sort(function (a, b) { return a.y - b.y; });

        pezzi.forEach(function (z) {
          var x = z.x - cam.x, y = z.y - cam.y;
          if (x < -14 || y < -18 || x > VIS_W + 14 || y > CAMPO_H + 18) return;
          if (z.cade) ctx.globalAlpha = 0.5;
          // il cane alza le zampe: due fotogrammi, un pixel di scarto
          var salto = (z.cane && Math.floor(mondo.cane.passo) % 2) ? -1 : 0;
          disegnaSprite(ctx, z.img, x, y + salto, z.verso);
          ctx.globalAlpha = 1;
        });

        disegnaSegnalini(ctx);

        /* La notte: il campo si tinge di blu man mano che la luce finisce.
           È la stessa informazione della barra, detta in un modo che si vede
           senza guardare in alto — e il gioco si chiama «prima che scenda la
           notte», quindi la notte deve scendere per davvero. */
        var q = Math.max(0, Math.min(1, tempo / (tempoTot || 1)));
        if (q < 0.55) {
          ctx.fillStyle = 'rgba(26,32,74,' + (0.5 * (0.55 - q) / 0.55).toFixed(3) + ')';
          ctx.fillRect(0, 0, VIS_W, CAMPO_H);
        }
        ctx.restore();

        disegnaBarra(ctx);
      }

      return { start: start, update: update, draw: draw, state: state };
    }
  });
})();
