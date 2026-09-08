/* Pizze — consegne a domicilio a Codiverno, viste da sopra l'auto.

   Si guida in un paese vero: strade, incroci, case con il loro numero civico.
   Si esce dalla pizzeria con le pizze appena sfornate e si consegna finché
   sono calde. Il tempo non è un cronometro: è il calore, che scende da solo e
   non aspetta. Una pizza che arriva fredda chiude il turno.

   Le tre decisioni che reggono il gioco:

   - il calore di ogni pizza non è deciso a occhio. È il tempo del giro
     ideale — il percorso più breve *sulle strade*, calcolato con Dijkstra
     sul grafo del paese — moltiplicato per un margine che si stringe salendo
     di livello. In un paese con una strada sola la distanza in linea d'aria
     è una bugia, e un budget sbagliato rende un livello impossibile senza
     che si capisca perché;
   - dal quarto livello si esce con più pizze per giro. È lì che il gioco
     diventa una decisione invece di una corsa: le pizze si raffreddano tutte
     insieme, quindi conta in che ordine le consegni, e l'ordine giusto non è
     quello dell'indirizzo più vicino;
   - le pizze si raffreddano anche mentre sei fermo, comprese quelle che ti
     aspettano sul bancone. Senza questa regola, chi resta immobile dopo una
     consegna non perde mai — ed è l'invariante che la suite misura per prima.

   La scena è 3D disegnata sul canvas 2D: proiezione prospettica a mano, muri
   come scatole estruse, ordinamento del pittore. Niente WebGL, come il
   raycasting del Labirinto — così gira dove gira il resto della suite.

   La mappa sta in un file a parte (mappa-codiverno.js, generato da
   tools/mappa.js) e dichiara la propria fonte: con un export di
   OpenStreetMap è il paese vero, altrimenti è una ricostruzione. Il gioco non
   sa la differenza, e lo scrive in schermata. */
(function () {
'use strict';

var PASSO = 1 / 60;

/* L'auto: numeri da utilitaria in paese, non da rally. La velocità massima è
   il metro di tutto il resto — il calore delle pizze ne discende. */
var VEL_MAX = 15.5;        // m/s ≈ 56 km/h sull'asfalto
var VEL_PRATO = 5.5;       // m/s: fuori strada si cammina
var ACCEL = 7.2;           // m/s²
var FRENO = 11;
var RETRO_MAX = 3.5;
var ATTRITO = 2.6;
var STERZO = 1.9;          // rad/s a fondo sterzo, con le gomme che tengono
var GRIP_STRADA = 6.5;
var GRIP_PRATO = 2.2;
var AUTO_L = 4.1, AUTO_W = 1.75, AUTO_R = 1.5;

var VEL_CROCIERA = 12.5;   // m/s: la media che il giro ideale dà per buona
var SOSTA = 3.5;           // s per fermarsi, scendere e consegnare
var RAGGIO_CONSEGNA = 13;  // m dal civico
var VEL_CONSEGNA = 4.5;    // m/s: sopra questa non si consegna, si passa e basta
var RAGGIO_PIZZERIA = 16;
var CONTO = 3.2;           // s di attesa al forno, dove si sceglie il colore

/* Vista: la telecamera sta dietro e sopra l'auto e guarda avanti. L'altezza è
   quella che fa vedere oltre la siepe del vicino senza diventare una mappa. */
var CAM_DIETRO = 7.4, CAM_ALTEZZA = 4.3, CAM_PITCH = 0.235;
var FOV = 1.28;            // rad ≈ 73°
var VISTA = 190;           // m: oltre, non si disegna
var ORIZZONTE = 0.40;      // dove cade la linea dell'orizzonte, in altezze schermo

var COLORI = [
  { nome: 'Rosso', tinta: '#ef4444' }, { nome: 'Blu', tinta: '#3b82f6' },
  { nome: 'Giallo', tinta: '#facc15' }, { nome: 'Verde', tinta: '#22c55e' },
  { nome: 'Bianco', tinta: '#f1f5f9' }, { nome: 'Arancio', tinta: '#f97316' },
  { nome: 'Viola', tinta: '#a855f7' }, { nome: 'Nero', tinta: '#475569' },
  { nome: 'Rosa', tinta: '#f472b6' }
];
var CHIAVE_COLORE = 'pizze:colore';
var CHIAVE_VECCHIA = 'rally:colore';   // il colore scelto quando il gioco era un rally

function config(level) {
  return {
    level: level,
    /* Cinque consegne sono il tetto, e si sale piano: un turno da nove
       durava otto minuti, e questa è una suite da cinque. La difficoltà la
       fanno il margine e quante pizze porti per volta, non la lunghezza. */
    consegne: Math.min(2 + Math.floor(level / 2), 5),
    /* Quante pizze si portano per giro. Il salto a due è il momento in cui il
       gioco cambia natura: non più «vai lì in fretta» ma «in che ordine». */
    perGiro: level < 3 ? 1 : (level < 5 ? 2 : 3),
    /* Quanto tempo in più del giro ideale dà il calore. È la leva della
       difficoltà: al primo livello si arriva con calma, al decimo bisogna
       sapere dove si va. */
    /* Il calore concesso in più rispetto al giro ideale. Scende piano: il
       calore che resta alla consegna cala liscio (36% al primo turno, 6% al
       decimo per un guidatore medio), ed è quello il vero indicatore di
       difficoltà — la percentuale di turni vinti, sopra a un margine così
       stretto, diventa testa o croce. */
    margine: Math.max(1.20, 2.1 - level * 0.09),
    puntiConsegna: 40 * level,
    bonusTurno: 120 * level
  };
}

/* ---------- il paese ---------- */

var M = null, G = null;

function mappa() {
  if (!M) M = (window.TG.mappe || {}).codiverno || null;
  return M;
}

/* Grafo delle strade e distanze: si costruisce una volta sola per partita.
   `daNodo` tiene in cache un Dijkstra intero per sorgente — sono duecento
   nodi, costa niente, e le stesse sorgenti (pizzeria, civici del turno)
   tornano a ogni ricalcolo del percorso. */
function grafo() {
  if (G) return G;
  var m = mappa();
  var adj = m.nodi.map(function () { return []; });
  m.archi.forEach(function (a) {
    var p = m.nodi[a[0]], q = m.nodi[a[1]];
    var d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    adj[a[0]].push([a[1], d]);
    adj[a[1]].push([a[0], d]);
  });
  G = { adj: adj, nodi: m.nodi, cache: {} };
  return G;
}

function nodoVicino(x, y) {
  var n = grafo().nodi, best = 0, bd = Infinity;
  for (var i = 0; i < n.length; i++) {
    var d = (n[i][0] - x) * (n[i][0] - x) + (n[i][1] - y) * (n[i][1] - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function daNodo(s) {
  var g = grafo();
  if (g.cache[s]) return g.cache[s];
  var n = g.nodi.length;
  var dist = new Float64Array(n), prec = new Int32Array(n), fatto = new Uint8Array(n);
  for (var i = 0; i < n; i++) { dist[i] = Infinity; prec[i] = -1; }
  dist[s] = 0;
  var coda = [[0, s]];
  while (coda.length) {
    /* Coda a vettore con estrazione del minimo: duecento nodi non meritano un
       heap, e il codice che si legge vale più di un microsecondo. */
    var k = 0;
    for (var j = 1; j < coda.length; j++) if (coda[j][0] < coda[k][0]) k = j;
    var cur = coda.splice(k, 1)[0], u = cur[1];
    if (fatto[u]) continue;
    fatto[u] = 1;
    var vic = g.adj[u];
    for (var e = 0; e < vic.length; e++) {
      var v = vic[e][0], nd = dist[u] + vic[e][1];
      if (nd < dist[v]) { dist[v] = nd; prec[v] = u; coda.push([nd, v]); }
    }
  }
  g.cache[s] = { dist: dist, prec: prec };
  return g.cache[s];
}

function distanzaTra(a, b) { return daNodo(a).dist[b]; }

function percorso(a, b) {
  var prec = daNodo(a).prec, out = [b], v = b, giri = 0;
  while (v !== a && prec[v] >= 0 && giri++ < 4000) { v = prec[v]; out.push(v); }
  out.reverse();
  return out;
}

/* Quanto tempo ci vuole a fare il giro, andando ogni volta alla fermata più
   vicina. È l'ordine che viene naturale, ed è quello che suggerisce il
   navigatore del gioco: il calore concesso si calcola su questo, non sul
   giro ottimo.

   La differenza conta. Con il budget calcolato sul giro migliore, chi segue
   le frecce del gioco arrivava fuori tempo — il gioco prometteva un margine
   che poi non dava, ed è il modo più sicuro di far sembrare rotto un livello.
   Calcolandolo sull'ordine più vicino-per-volta il patto è onesto: seguendo
   il navigatore ce la fai, e se trovi un giro più corto di così il calore che
   avanza diventa punti. L'ordine resta una decisione, ma non è più una
   trappola. */
function giroVicinoPerVolta(partenza, fermate) {
  var restanti = fermate.map(function (_, i) { return i; });
  var tot = 0, da = partenza, tempi = [], ordine = [];
  while (restanti.length) {
    var best = 0, bd = Infinity;
    for (var k = 0; k < restanti.length; k++) {
      var d = distanzaTra(da, fermate[restanti[k]]);
      if (d < bd) { bd = d; best = k; }
    }
    var i = restanti.splice(best, 1)[0];
    tot += bd / VEL_CROCIERA + SOSTA;
    tempi[i] = tot;
    ordine.push(i);
    da = fermate[i];
  }
  return { tot: tot, ordine: ordine, tempi: tempi };
}

function creaRng(seme) {
  var x = seme >>> 0;
  return function () {
    x = (x + 0x6D2B79F5) >>> 0;
    var t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Il turno di un livello è sempre quello: stessi indirizzi, stesso ordine.
   Un paese si impara — dove sta Via del Molino, da che parte salgono i civici
   — e imparare deve servire a qualcosa.

   Gli indirizzi non si sorteggiano e basta: si sorteggiano finché il giro
   completo (andata, fermate, ritorni al forno per il carico dopo) non è lungo
   quanto deve essere a quel livello. Prima venivano presi a caso dentro un
   raggio, e la lunghezza del turno la decideva la fortuna: il 5° usciva più
   duro del 6°, e nella tabella della difficoltà si vedeva come un dente. Così
   invece la lunghezza sale liscia, e la difficoltà resta affidata alle due
   leve che si possono spiegare — il margine di calore e quante pizze porti
   per volta. */
function lunghezzaTurno(scelti, perGiro) {
  var pizzeria = nodoVicino(mappa().pizzeria.ax, mappa().pizzeria.ay);
  var nodi = scelti.map(function (i) { return nodoVicino(i.ax, i.ay); });
  var tot = 0;
  for (var g = 0; g < nodi.length; g += perGiro) {
    var lotto = nodi.slice(g, g + perGiro);
    var da = pizzeria, restanti = lotto.slice();
    if (g > 0) tot += distanzaTra(ultimo, pizzeria);   // il rientro per il carico dopo
    while (restanti.length) {
      var best = 0, bd = Infinity;
      for (var k = 0; k < restanti.length; k++) {
        var d = distanzaTra(da, restanti[k]);
        if (d < bd) { bd = d; best = k; }
      }
      tot += bd;
      da = restanti.splice(best, 1)[0];
    }
    var ultimo = da;
  }
  return tot;
}

function turno(level) {
  var m = mappa();
  var cfg = config(level);
  var pizzeria = nodoVicino(m.pizzeria.ax, m.pizzeria.ay);
  var dPizzeria = daNodo(pizzeria).dist;

  /* Gli indirizzi si allontanano salendo di livello: al primo turno si
     consegna attorno alla piazza, più avanti ti mandano in periferia. */
  var raggio = 350 + level * 70;
  var buoni = m.indirizzi.filter(function (ind) {
    var d = dPizzeria[nodoVicino(ind.ax, ind.ay)];
    return isFinite(d) && d > 90 && d < raggio;
  });
  if (buoni.length < cfg.consegne + 2) {
    buoni = m.indirizzi.filter(function (ind) {
      return isFinite(dPizzeria[nodoVicino(ind.ax, ind.ay)]);
    });
  }

  var voluta = 500 + level * 230;      // metri di giro completo, a quel livello
  var rng = creaRng(0x1220 + level * 7919);
  var migliore = null;
  for (var tent = 0; tent < 60 && buoni.length; tent++) {
    var scelti = [], usati = {};
    for (var i = 0; i < cfg.consegne; i++) {
      for (var t = 0; t < 40; t++) {
        var ind = buoni[Math.floor(rng() * buoni.length)];
        var chiave = ind.via + '|' + ind.civico;
        if (usati[chiave]) continue;
        usati[chiave] = true;
        scelti.push(ind);
        break;
      }
    }
    if (scelti.length < cfg.consegne) break;
    var lung = lunghezzaTurno(scelti, cfg.perGiro);
    var scarto = Math.abs(lung - voluta);
    if (!migliore || scarto < migliore.scarto) migliore = { scelti: scelti, lung: lung, scarto: scarto };
    if (scarto < voluta * 0.1) break;
  }
  return migliore ? migliore.scelti : [];
}

TG.registry.register({
  id: 'pizze',
  title: 'Pizze',
  icon: '🍕',
  tagline: 'Consegne a Codiverno, finché sono calde.',
  scoreLabel: 'Punti',
  controls: 'guida',
  viewport: { w: 360, h: 480 },
  howto: '<b>Comandi:</b> il <b>volante</b> si gira prendendolo dal pomello, ' +
    '<b>GAS</b> accelera, <b>FRENO</b> frena (e da fermo fa retromarcia); da ' +
    'tastiera frecce o WASD. Si guida per le strade di <b>Codiverno</b>, ' +
    'visti da sopra l\'auto. ' +
    '<b>Si vince consegnando tutte le pizze calde:</b> ogni pizza ha la sua ' +
    'barra di calore, che scende da sola e non si ferma mai — nemmeno mentre ' +
    'sei fermo, nemmeno per quelle che ti aspettano sul bancone. Se una arriva ' +
    'fredda il turno è finito. ' +
    '<b>Per consegnare</b> fermati (o quasi) davanti al civico giusto: il ' +
    'faro di luce lo indica, le frecce sull\'asfalto ti portano lì. Poi torna ' +
    'in pizzeria per il carico dopo. Dal 4° livello ne porti due per giro, dal ' +
    '7° tre: contano i punti, ma conta soprattutto <b>in che ordine</b> le ' +
    'consegni. Fuori strada si arranca e le siepi non si attraversano. ' +
    '<b>Il colore dell\'auto</b> si sceglie mentre le pizze escono dal forno.',

  levelInfo: function (level) {
    if (!mappa()) return 'Livello ' + level;
    var cfg = config(level);
    var t = turno(level);
    var vie = {};
    t.forEach(function (i) { vie[i.via] = true; });
    return 'Turno ' + level + ': ' + cfg.consegne + ' consegne in ' +
      Object.keys(vie).length + (Object.keys(vie).length === 1 ? ' via' : ' vie') +
      ', ' + cfg.perGiro + (cfg.perGiro === 1 ? ' pizza per giro' : ' pizze per giro') +
      ', calore al ' + Math.round(cfg.margine * 100) + '% del giro ideale';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var store = window.TG && TG.storage ? TG.storage : null;
    var m = mappa();

    var cfg, auto, stato, conto, colore, volanteScattato;
    var consegne, carico, fatte, prossimoCarico, acc, finito, note, urti, scossa;
    var cam, bordi, limiti, obiettivo, rottaNodi, ricalcolo, ultimoBeep, freddaDa, ultimaConsegna;

    function leggiColore() {
      var v = store ? store.get(CHIAVE_COLORE, null) : null;
      if (v == null && store) v = store.get(CHIAVE_VECCHIA, 0);
      v = parseInt(v, 10);
      return (v >= 0 && v < COLORI.length) ? v : 0;
    }
    function scegliColore(i) {
      colore = ((i % COLORI.length) + COLORI.length) % COLORI.length;
      if (store) store.set(CHIAVE_COLORE, colore);
      api.sfx.click();
    }

    /* I bordi delle strade si calcolano una volta: gli spigoli si uniscono a
       becco di flauto (il vertice è la bisettrice fra i due tratti), perché
       con due rettangoli affiancati ogni curva mostrerebbe una tacca aperta
       sul lato esterno. */
    function preparaBordi() {
      bordi = m.strade.map(function (s) {
        var p = s.punti, sx = [], dx = [], i;
        for (i = 0; i < p.length; i++) {
          var pre = p[Math.max(0, i - 1)], post = p[Math.min(p.length - 1, i + 1)];
          var vx = post[0] - pre[0], vy = post[1] - pre[1];
          var l = Math.hypot(vx, vy) || 1;
          var nx = -vy / l, ny = vx / l;
          var mezzo = s.larghezza / 2;
          sx.push([p[i][0] + nx * mezzo, p[i][1] + ny * mezzo]);
          dx.push([p[i][0] - nx * mezzo, p[i][1] - ny * mezzo]);
        }
        return { sx: sx, dx: dx };
      });
      limiti = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      m.strade.forEach(function (s) {
        s.punti.forEach(function (p) {
          limiti.x0 = Math.min(limiti.x0, p[0]); limiti.x1 = Math.max(limiti.x1, p[0]);
          limiti.y0 = Math.min(limiti.y0, p[1]); limiti.y1 = Math.max(limiti.y1, p[1]);
        });
      });
    }

    /* ---------- turno e carichi ---------- */

    function nuovoCarico() {
      var restanti = consegne.filter(function (c) { return !c.fatta && !c.presa; });
      if (!restanti.length) return;
      var quante = Math.min(cfg.perGiro, restanti.length);
      var scelte = restanti.slice(0, quante);
      var pizzeria = nodoVicino(m.pizzeria.ax, m.pizzeria.ay);
      var qui = nodoVicino(auto.x, auto.y);
      var fermate = scelte.map(function (c) { return nodoVicino(c.ax, c.ay); });
      var giro = giroVicinoPerVolta(pizzeria, fermate);

      /* Il calore comprende il ritorno al forno: il carico è già sul bancone e
         si raffredda mentre torni a prenderlo. Se il tempo partisse dal
         momento in cui lo raccogli, restare fermi dopo una consegna sarebbe
         gratis, e il profilo «fermo» vincerebbe. */
      var rientro = distanzaTra(qui, pizzeria) / VEL_CROCIERA;
      scelte.forEach(function (c, i) {
        c.presa = true;
        c.budget = (rientro + giro.tempi[i]) * cfg.margine;
        c.calore = 1;
        c.inMano = false;      // sul bancone finché non passi a prenderle
      });
      carico = scelte;
      prossimoCarico = false;
      aggiornaObiettivo(true);
    }

    function ritira() {
      var presi = 0;
      carico.forEach(function (c) { if (!c.inMano) { c.inMano = true; presi++; } });
      if (presi) {
        api.sfx.pick();
        nota(presi === 1 ? 'Pizza presa' : presi + ' pizze prese', '#fbbf24');
        aggiornaObiettivo(true);
      }
    }

    function consegna(c) {
      /* Si annota com'è andata la consegna: a che velocità e con quanto
         calore. Serve ai test — «si consegna da fermi» va verificato
         nell'istante della consegna, e dedurlo dalla velocità del fotogramma
         prima confonde chi si è fermato contro un muro con chi è passato a
         cinquanta. */
      ultimaConsegna = { via: c.via, civico: c.civico, velocita: Math.abs(auto.velocita), calore: c.calore };
      c.fatta = true;
      c.inMano = false;
      fatte++;
      var punti = Math.round(cfg.puntiConsegna * (0.35 + 0.65 * c.calore));
      api.addScore(punti);
      nota(c.via + ' ' + c.civico + ': +' + punti, c.calore > 0.5 ? '#4ade80' : '#fbbf24');
      api.sfx.tone(880, 0.09, 'square', 0.09, 1320);
      carico = carico.filter(function (x) { return !x.fatta; });

      if (fatte >= cfg.consegne) {
        finito = true;
        var calduccio = consegne.reduce(function (a, x) { return a + (x.calorePerBonus || 0); }, 0);
        api.levelComplete({
          bonus: cfg.bonusTurno + Math.round(calduccio * 30 * cfg.level),
          message: fatte + ' consegne, ' + (urti ? urti + ' bott' + (urti === 1 ? 'a' : 'e') : 'nessuna botta') + '.'
        });
        return;
      }
      if (!carico.length) { prossimoCarico = true; nuovoCarico(); }
      else aggiornaObiettivo(true);
    }

    /* L'obiettivo è dove stai andando: la pizzeria se hai il carico da
       ritirare, altrimenti la fermata più vicina *per strada* fra quelle che
       hai in mano. Non è per forza quella suggerita: la scelta resta tua, il
       navigatore segue te. */
    function aggiornaObiettivo(subito) {
      if (!subito) { ricalcolo -= PASSO; if (ricalcolo > 0) return; }
      ricalcolo = 0.7;
      var qui = nodoVicino(auto.x, auto.y);
      var daRitirare = carico.some(function (c) { return !c.inMano; });
      if (daRitirare) {
        obiettivo = { x: m.pizzeria.ax, y: m.pizzeria.ay, faro: [m.pizzeria.x, m.pizzeria.y],
                      tipo: 'pizzeria', nome: m.pizzeria.nome };
      } else {
        var best = null, bd = Infinity;
        carico.forEach(function (c) {
          var d = distanzaTra(qui, nodoVicino(c.ax, c.ay));
          if (d < bd) { bd = d; best = c; }
        });
        if (!best) { obiettivo = null; rottaNodi = []; return; }
        obiettivo = { x: best.ax, y: best.ay, faro: [best.x, best.y], tipo: 'consegna', pizza: best };
      }
      rottaNodi = percorso(qui, nodoVicino(obiettivo.x, obiettivo.y));
    }

    function nota(testo, tinta) { note.push({ testo: testo, t: 1.6, tinta: tinta || '#e6edf3' }); }

    /* ---------- partita ---------- */

    function start(level) {
      cfg = config(level);
      preparaBordi();
      /* x,y è il civico (dove punta il faro), ax,ay è dove ci si accosta: la
         consegna si misura dall'accesso sulla strada, altrimenti chiederemmo
         all'auto di entrare in casa. */
      consegne = turno(level).map(function (ind) {
        return { via: ind.via, civico: ind.civico, x: ind.x, y: ind.y, ax: ind.ax, ay: ind.ay,
                 fatta: false, presa: false, calore: 1, budget: 60 };
      });
      /* Si parte sull'asfalto davanti alla pizzeria, col muso lungo la strada.
         Metterla «accanto al forno» a occhio la incastrava dentro il muro del
         forno stesso: la posizione di partenza si chiede al grafo, che le
         strade sa dove sono. */
      var nodoVia = nodoVicino(m.pizzeria.ax, m.pizzeria.ay);
      var g0 = grafo();
      var qui = g0.nodi[nodoVia];
      var vicini = g0.adj[nodoVia];
      var poi = vicini.length ? g0.nodi[vicini[0][0]] : [qui[0] + 1, qui[1]];
      auto = {
        x: qui[0], y: qui[1], h: Math.atan2(poi[1] - qui[1], poi[0] - qui[0]),
        vx: 0, vy: 0, sterzo: 0, gas: 0, freno: false, velocita: 0, laterale: 0, inStrada: true
      };
      cam = { x: auto.x, y: auto.y, ang: auto.h };
      stato = 'forno';
      conto = CONTO;
      ultimoBeep = 9;
      fatte = 0; carico = []; prossimoCarico = false;
      acc = 0; finito = false; note = []; urti = 0; scossa = 0;
      ricalcolo = 0; rottaNodi = []; obiettivo = null; freddaDa = null; ultimaConsegna = null;
      volanteScattato = false;
      colore = leggiColore();
      nuovoCarico();
      carico.forEach(function (c) { c.inMano = true; });   // il primo carico è già in mano
    }

    /* ---------- fisica ---------- */

    function passo(dt) {
      var sinistra = api.input.isDown('left'), destra = api.input.isDown('right');
      var gas = api.input.isDown('up'), freno = api.input.isDown('down');
      var vol = api.input.volante;

      if (stato === 'forno') {
        var az, tap, cifra;
        while ((az = api.input.take())) {
          if (az === 'left') scegliColore(colore - 1);
          else if (az === 'right') scegliColore(colore + 1);
        }
        while ((cifra = api.input.takeDigit())) { if (cifra <= COLORI.length) scegliColore(cifra - 1); }
        while ((tap = api.input.takeTap())) {
          var k = indiceColoreA(tap.x, tap.y);
          if (k >= 0) scegliColore(k);
        }
        if (vol && vol.attivo && Math.abs(vol.valore) > 0.5 && !volanteScattato) {
          scegliColore(colore + (vol.valore > 0 ? 1 : -1));
          volanteScattato = true;
        }
        if (!vol || !vol.attivo || Math.abs(vol.valore) < 0.2) volanteScattato = false;
        conto -= dt;
        var sec = Math.ceil(conto);
        if (sec < ultimoBeep && sec >= 1) { ultimoBeep = sec; api.sfx.tone(420, 0.1, 'square', 0.08); }
        if (conto <= 0) {
          stato = 'giro';
          api.sfx.tone(880, 0.3, 'square', 0.11);
          nota('Vai!', '#4ade80');
        }
        audio(gas ? 0.7 : 0.12, gas ? 0.6 : 0, 0);
        return;
      }

      while (api.input.take()) { /* in giro contano solo i tasti tenuti premuti */ }
      while (api.input.takeTap()) { }
      while (api.input.takeDigit()) { }

      var bersaglio = (vol && vol.attivo) ? vol.valore : (sinistra ? -1 : 0) + (destra ? 1 : 0);
      auto.sterzo += (bersaglio - auto.sterzo) * Math.min(1, ((vol && vol.attivo) ? 18 : 10) * dt);

      var inStrada = sullaStrada(auto.x, auto.y);
      auto.inStrada = inStrada;
      var vmax = inStrada ? VEL_MAX : VEL_PRATO;

      var c = Math.cos(auto.h), s = Math.sin(auto.h);
      var avanti = auto.vx * c + auto.vy * s;
      var lato = -auto.vx * s + auto.vy * c;

      // lo sterzo prende con la velocità: da fermi il muso non gira
      var presa = Math.min(1, Math.abs(avanti) / 3.5) * (inStrada ? 1 : 0.8);
      auto.h += auto.sterzo * STERZO * presa * dt * (avanti < 0 ? -1 : 1);
      c = Math.cos(auto.h); s = Math.sin(auto.h);

      if (gas && avanti >= -0.1) avanti += ACCEL * dt;
      else if (gas) avanti = Math.min(0, avanti + FRENO * dt);
      if (freno) {
        if (avanti > 0.3) avanti = Math.max(0, avanti - FRENO * dt);
        else avanti = Math.max(-RETRO_MAX, avanti - ACCEL * 0.7 * dt);
      }
      if (!gas && !freno) {
        var segno = avanti > 0 ? 1 : -1;
        avanti = Math.abs(avanti) < ATTRITO * dt ? 0 : avanti - segno * ATTRITO * dt;
      }
      avanti -= avanti * Math.abs(avanti) / (vmax * vmax) * ACCEL * dt;

      var grip = inStrada ? GRIP_STRADA : GRIP_PRATO;
      lato *= Math.exp(-grip * dt);

      auto.vx = c * avanti - s * lato;
      auto.vy = s * avanti + c * lato;
      auto.x += auto.vx * dt;
      auto.y += auto.vy * dt;
      auto.velocita = avanti;
      auto.laterale = lato;
      auto.freno = freno;
      auto.gas += ((gas ? 1 : 0) - auto.gas) * Math.min(1, 8 * dt);
      if (scossa > 0) scossa -= dt;

      urtaEdifici();

      // ritiro e consegne
      if (Math.hypot(auto.x - m.pizzeria.ax, auto.y - m.pizzeria.ay) < RAGGIO_PIZZERIA &&
          Math.abs(avanti) < VEL_CONSEGNA) {
        ritira();
      }
      for (var i = carico.length - 1; i >= 0; i--) {
        var pz = carico[i];
        if (!pz.inMano) continue;
        if (Math.hypot(auto.x - pz.ax, auto.y - pz.ay) < RAGGIO_CONSEGNA && Math.abs(avanti) < VEL_CONSEGNA) {
          pz.calorePerBonus = pz.calore;
          consegna(pz);
          if (finito) return;
        }
      }

      // il calore scende sempre, in mano o sul bancone
      for (var j = 0; j < carico.length; j++) {
        var p = carico[j];
        p.calore -= dt / p.budget;
        if (p.calore <= 0) {
          p.calore = 0;
          freddaDa = p;
          finito = true;
          api.sfx.tone(140, 0.5, 'sawtooth', 0.1, 60);
          api.gameOver({
            message: 'Fredda in ' + p.via + ' ' + p.civico + ', dopo ' + fatte +
              (fatte === 1 ? ' consegna' : ' consegne') + '.'
          });
          return;
        }
      }

      aggiornaObiettivo(false);

      var rapporto = Math.min(1, Math.abs(avanti) / VEL_MAX);
      var marce = [0, 0.22, 0.45, 0.72, 1.01];
      var giri = 0.3;
      for (var mi = 0; mi < marce.length - 1; mi++) {
        if (rapporto >= marce[mi] && rapporto < marce[mi + 1]) {
          giri = 0.3 + 0.7 * (rapporto - marce[mi]) / (marce[mi + 1] - marce[mi]);
        }
      }
      var slitta = Math.min(1, Math.abs(lato) / 4);
      audio(giri, auto.gas, slitta * (inStrada ? 1 : 0.4) + (!inStrada && Math.abs(avanti) > 2 ? 0.35 : 0));
    }

    function sullaStrada(x, y) {
      for (var i = 0; i < m.strade.length; i++) {
        var s = m.strade[i], p = s.punti, mezzo = s.larghezza / 2 + 0.6;
        for (var k = 1; k < p.length; k++) {
          var a = p[k - 1], b = p[k];
          if (Math.abs(x - a[0]) > 60 && Math.abs(x - b[0]) > 60) continue;
          if (Math.abs(y - a[1]) > 60 && Math.abs(y - b[1]) > 60) continue;
          if (distSegmento(x, y, a, b) < mezzo) return true;
        }
      }
      return false;
    }

    function distSegmento(x, y, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var l2 = dx * dx + dy * dy || 1;
      var t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
    }

    /* I muri fermano: si tratta l'auto come un cerchio e l'edificio come il
       suo rettangolo ruotato, si guarda nel riferimento dell'edificio dove
       cade il punto più vicino e si spinge fuori di lì. */
    function urtaEdifici() {
      for (var i = 0; i < m.edifici.length; i++) {
        var e = m.edifici[i];
        var dx = auto.x - e.x, dy = auto.y - e.y;
        if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
        var c = Math.cos(-e.rot), s = Math.sin(-e.rot);
        var lx = dx * c - dy * s, ly = dx * s + dy * c;
        var hx = e.l / 2, hy = e.w / 2;
        var px = Math.max(-hx, Math.min(hx, lx)), py = Math.max(-hy, Math.min(hy, ly));
        var ox = lx - px, oy = ly - py;
        var d = Math.hypot(ox, oy);
        if (d >= AUTO_R) continue;
        if (d < 0.0001) { ox = lx; oy = ly; d = Math.hypot(ox, oy) || 1; }
        var nx = ox / d, ny = oy / d;
        var spinta = AUTO_R - d;
        var wx = nx * c + ny * s, wy = -nx * s + ny * c;   // torna nel mondo
        auto.x += wx * spinta; auto.y += wy * spinta;
        var vn = auto.vx * wx + auto.vy * wy;
        if (vn < 0) {
          var forza = Math.min(1, -vn / 12);
          auto.vx -= vn * wx * 1.2; auto.vy -= vn * wy * 1.2;
          auto.vx *= 0.4; auto.vy *= 0.4;
          if (!auto.aContatto) {
            urti++;
            scossa = 0.2 * forza + 0.06;
            api.sfx.tone(80 + forza * 40, 0.18, 'sawtooth', 0.05 + forza * 0.07, 40);
          }
          auto.aContatto = 2;
        }
      }
      if (auto.aContatto) auto.aContatto--;
    }

    function audio(giri, gas, slitta) {
      if (api.sfx.motoreImposta) api.sfx.motoreImposta(giri, gas, slitta);
    }

    function update(dt) {
      if (finito) return;
      acc += dt;
      var giri = 0;
      while (acc >= PASSO && giri < 5 && !finito) { passo(PASSO); acc -= PASSO; giri++; }
      if (giri >= 5) acc = 0;
      for (var i = note.length - 1; i >= 0; i--) { note[i].t -= dt; if (note[i].t <= 0) note.splice(i, 1); }
    }

    function destroy() { if (api.sfx.motoreFerma) api.sfx.motoreFerma(); }

    /* ---------- 3D ---------- */

    var camState = { x: 0, y: 0, z: 0, yaw: 0, cp: 1, sp: 0 };
    var FUOCO = (W / 2) / Math.tan(FOV / 2);
    var CY = H * ORIZZONTE + FUOCO * Math.tan(CAM_PITCH);
    var VICINO = 0.6;      // piano di taglio: sotto questo si è dietro all'occhio

    function aggiornaCamera() {
      var d = auto.h - cam.ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      cam.ang += d * 0.14;
      cam.x += (auto.x - cam.x) * 0.25;
      cam.y += (auto.y - cam.y) * 0.25;
      camState.yaw = cam.ang;
      camState.x = cam.x - Math.cos(cam.ang) * CAM_DIETRO;
      camState.y = cam.y - Math.sin(cam.ang) * CAM_DIETRO;
      camState.z = CAM_ALTEZZA;
      camState.cp = Math.cos(CAM_PITCH);
      camState.sp = Math.sin(CAM_PITCH);
    }

    /* Da mondo a occhio: rotazione di imbardata, poi di beccheggio. Resta in
       coordinate di camera (destra, alto, avanti) perché il taglio sul piano
       vicino si fa qui, prima di dividere per la profondità. */
    function versoOcchio(X, Y, Z, out) {
      var dx = X - camState.x, dy = Y - camState.y, dz = Z - camState.z;
      var c = Math.cos(camState.yaw), s = Math.sin(camState.yaw);
      var zc = dx * c + dy * s;
      var xc = dx * s - dy * c;
      out[0] = xc;
      out[1] = dz * camState.cp + zc * camState.sp;
      out[2] = zc * camState.cp - dz * camState.sp;
      return out;
    }

    var tmp = [0, 0, 0];
    function occhioASchermo(p, out) {
      var k = FUOCO / p[2];
      out[0] = W / 2 + p[0] * k;
      out[1] = CY - p[1] * k;
      return out;
    }

    /* Taglio del poligono contro il piano vicino: senza, un muro che ti passa
       di fianco si ribalta a schermo quando un suo spigolo finisce dietro
       l'occhio — la profondità cambia segno e la prospettiva con lei. */
    function tagliaVicino(punti) {
      var out = [];
      for (var i = 0; i < punti.length; i++) {
        var a = punti[i], b = punti[(i + 1) % punti.length];
        var da = a[2] - VICINO, db = b[2] - VICINO;
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) {
          var t = da / (da - db);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, VICINO]);
        }
      }
      return out;
    }

    var buf = [];
    function poligono(ctx, punti3d, tinta) {
      buf.length = 0;
      for (var i = 0; i < punti3d.length; i++) {
        var p = punti3d[i];
        buf.push(versoOcchio(p[0], p[1], p[2], [0, 0, 0]));
      }
      var tagliato = tagliaVicino(buf);
      if (tagliato.length < 3) return false;
      ctx.beginPath();
      var s = [0, 0];
      for (i = 0; i < tagliato.length; i++) {
        occhioASchermo(tagliato[i], s);
        if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      ctx.closePath();
      ctx.fillStyle = tinta;
      ctx.fill();
      return true;
    }

    // quanto è girato verso di noi: serve a dare luce ai muri
    function luce(nx, ny) {
      var sole = 0.55 * (nx * 0.5 + ny * 0.75) + 0.45;
      return Math.max(0.28, Math.min(1, sole));
    }

    function tinta(base, l) {
      var r = parseInt(base.substr(1, 2), 16), g = parseInt(base.substr(3, 2), 16), b = parseInt(base.substr(5, 2), 16);
      return 'rgb(' + Math.round(r * l) + ',' + Math.round(g * l) + ',' + Math.round(b * l) + ')';
    }

    var COLORE_EDIFICIO = {
      casa: '#c8b7a2', chiesa: '#d8d2c4', campanile: '#d8d2c4',
      capannone: '#9aa3ad', pubblico: '#cbbfae', pizzeria: '#e0a46a'
    };
    var COLORE_TETTO = {
      casa: '#8d4a3a', chiesa: '#7a4436', campanile: '#7a4436',
      capannone: '#6b7480', pubblico: '#8d4a3a', pizzeria: '#a24f36'
    };

    function draw(ctx) {
      aggiornaCamera();
      var sx = 0, sy = 0;
      if (scossa > 0) { sx = (Math.random() - 0.5) * scossa * 14; sy = (Math.random() - 0.5) * scossa * 14; }
      ctx.save();
      ctx.translate(sx, sy);

      // cielo e terra: il mondo è piatto, quindi l'orizzonte è una riga
      var oriz = CY - FUOCO * Math.tan(CAM_PITCH);
      var cielo = ctx.createLinearGradient(0, 0, 0, Math.max(1, oriz));
      cielo.addColorStop(0, '#2a4a7a');
      cielo.addColorStop(1, '#8fb2cf');
      ctx.fillStyle = cielo;
      ctx.fillRect(-20, -20, W + 40, oriz + 20);
      ctx.fillStyle = '#42663c';
      ctx.fillRect(-20, oriz, W + 40, H - oriz + 40);

      disegnaStrade(ctx);
      disegnaFrecce(ctx);
      disegnaVolumi(ctx);
      disegnaAuto(ctx);
      disegnaFari(ctx);
      ctx.restore();

      disegnaHud(ctx);
      if (stato === 'forno') disegnaForno(ctx);
    }

    function vicinoAllaCamera(x, y) {
      var dx = x - camState.x, dy = y - camState.y;
      if (dx * dx + dy * dy > VISTA * VISTA) return -1;
      var c = Math.cos(camState.yaw), s = Math.sin(camState.yaw);
      var avanti = dx * c + dy * s;
      var lat = dx * s - dy * c;
      if (avanti < -30) return -1;                      // dietro le spalle
      if (Math.abs(lat) > Math.abs(avanti) * 1.5 + 60) return -1;   // fuori dal cono
      return Math.hypot(dx, dy);
    }

    function disegnaStrade(ctx) {
      for (var i = 0; i < m.strade.length; i++) {
        var s = m.strade[i], b = bordi[i];
        for (var k = 1; k < s.punti.length; k++) {
          var a = s.punti[k - 1], q = s.punti[k];
          var mx = (a[0] + q[0]) / 2, my = (a[1] + q[1]) / 2;
          if (vicinoAllaCamera(mx, my) < 0) continue;
          poligono(ctx, [
            [b.sx[k - 1][0], b.sx[k - 1][1], 0.02], [b.dx[k - 1][0], b.dx[k - 1][1], 0.02],
            [b.dx[k][0], b.dx[k][1], 0.02], [b.sx[k][0], b.sx[k][1], 0.02]
          ], '#3f4650');
        }
      }
    }

    /* Le frecce sull'asfalto: il navigatore del gioco. In un paese senza
       cartelli la mappina da sola costringe a guardare in alto a destra invece
       che davanti, e a quaranta all'ora si sbaglia l'incrocio. */
    function disegnaFrecce(ctx) {
      if (!rottaNodi || rottaNodi.length < 2 || stato !== 'giro') return;
      var g = grafo();
      var percorsa = 0;
      for (var i = 0; i < rottaNodi.length - 1 && percorsa < 110; i++) {
        var a = g.nodi[rottaNodi[i]], b = g.nodi[rottaNodi[i + 1]];
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len;
        for (var t = 4; t < len; t += 13) {
          percorsa += 13;
          if (percorsa > 110) break;
          var x = a[0] + ux * t, y = a[1] + uy * t;
          if (vicinoAllaCamera(x, y) < 0) continue;
          /* Niente frecce sotto il muso: la rotta comincia dal nodo più
             vicino, che spesso è alle spalle, e una freccia a due metri
             dall'occhio riempie mezzo schermo di verde. */
          if (Math.hypot(x - auto.x, y - auto.y) < 11) continue;
          var l = 2.4, w = 1.5;
          poligono(ctx, [
            [x + ux * l, y + uy * l, 0.05],
            [x - uy * w - ux * l * 0.2, y + ux * w - uy * l * 0.2, 0.05],
            [x - uy * w * 0.25 - ux * l, y + ux * w * 0.25 - uy * l, 0.05],
            [x + uy * w * 0.25 - ux * l, y - ux * w * 0.25 - uy * l, 0.05],
            [x + uy * w - ux * l * 0.2, y - ux * w - uy * l * 0.2, 0.05]
          ], 'rgba(74,222,128,0.55)');
        }
      }
    }

    /* Edifici e alberi: si raccolgono quelli in vista, si ordinano dal più
       lontano al più vicino e si disegnano in quell'ordine. È l'algoritmo del
       pittore — senza z-buffer, l'ordine *è* la profondità. */
    var lista = [];
    function disegnaVolumi(ctx) {
      lista.length = 0;
      var i, d;
      for (i = 0; i < m.edifici.length; i++) {
        d = vicinoAllaCamera(m.edifici[i].x, m.edifici[i].y);
        if (d >= 0) lista.push({ d: d, e: m.edifici[i], albero: false });
      }
      for (i = 0; i < m.alberi.length; i++) {
        d = vicinoAllaCamera(m.alberi[i].x, m.alberi[i].y);
        if (d >= 0) lista.push({ d: d, e: m.alberi[i], albero: true });
      }
      lista.sort(function (a, b) { return b.d - a.d; });
      for (i = 0; i < lista.length; i++) {
        if (lista[i].albero) disegnaAlbero(ctx, lista[i].e);
        else disegnaEdificio(ctx, lista[i].e);
      }
    }

    function disegnaEdificio(ctx, e) {
      var c = Math.cos(e.rot), s = Math.sin(e.rot);
      var hx = e.l / 2, hy = e.w / 2;
      var ang = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(function (p) {
        return [e.x + p[0] * c - p[1] * s, e.y + p[0] * s + p[1] * c];
      });
      var base = COLORE_EDIFICIO[e.tipo] || '#c8b7a2';
      for (var i = 0; i < 4; i++) {
        var a = ang[i], b = ang[(i + 1) % 4];
        var nx = b[1] - a[1], ny = -(b[0] - a[0]);
        var l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        // solo i muri girati verso di noi: gli altri sono coperti dai primi
        if ((camState.x - a[0]) * nx + (camState.y - a[1]) * ny <= 0) continue;
        poligono(ctx, [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], e.h], [a[0], a[1], e.h]],
          tinta(base, luce(nx, ny)));
      }
      poligono(ctx, ang.map(function (p) { return [p[0], p[1], e.h]; }),
        tinta(COLORE_TETTO[e.tipo] || '#8d4a3a', 0.95));
    }

    function disegnaAlbero(ctx, t) {
      var p = versoOcchio(t.x, t.y, 0, [0, 0, 0]);
      if (p[2] < VICINO) return;
      var base = occhioASchermo(p, [0, 0]);
      var cima = occhioASchermo(versoOcchio(t.x, t.y, t.h, [0, 0, 0]), [0, 0]);
      var k = FUOCO / p[2];
      ctx.fillStyle = '#5b4630';
      ctx.fillRect(base[0] - 0.35 * k, cima[1], 0.7 * k, base[1] - cima[1]);
      ctx.fillStyle = '#2f6b3a';
      ctx.beginPath();
      ctx.arc(cima[0], cima[1] + t.r * k * 0.4, t.r * k, 0, Math.PI * 2);
      ctx.fill();
    }

    function disegnaAuto(ctx) {
      var c = Math.cos(auto.h), s = Math.sin(auto.h);
      function pt(av, lat, alt) {
        return [auto.x + c * av - s * lat, auto.y + s * av + c * lat, alt];
      }
      var hl = AUTO_L / 2, hw = AUTO_W / 2;
      // ombra
      poligono(ctx, [pt(-hl, -hw, 0.01), pt(hl, -hw, 0.01), pt(hl, hw, 0.01), pt(-hl, hw, 0.01)], 'rgba(0,0,0,0.35)');
      var base = COLORI[colore].tinta;
      var lati = [
        [[pt(-hl, -hw, 0.25), pt(hl, -hw, 0.25), pt(hl, -hw, 1.05), pt(-hl, -hw, 1.05)], -s, c],
        [[pt(hl, hw, 0.25), pt(-hl, hw, 0.25), pt(-hl, hw, 1.05), pt(hl, hw, 1.05)], s, -c],
        [[pt(hl, -hw, 0.25), pt(hl, hw, 0.25), pt(hl, hw, 1.05), pt(hl, -hw, 1.05)], c, s],
        [[pt(-hl, hw, 0.25), pt(-hl, -hw, 0.25), pt(-hl, -hw, 1.05), pt(-hl, hw, 1.05)], -c, -s]
      ];
      lati.forEach(function (L) { poligono(ctx, L[0], tinta(base, luce(L[1], L[2]))); });
      poligono(ctx, [pt(-hl, -hw, 1.05), pt(hl, -hw, 1.05), pt(hl, hw, 1.05), pt(-hl, hw, 1.05)], tinta(base, 1));
      // il cartello della pizzeria sul tetto: si vede che auto sei
      poligono(ctx, [pt(-0.5, -0.35, 1.05), pt(0.5, -0.35, 1.05), pt(0.5, -0.35, 1.55), pt(-0.5, -0.35, 1.55)], '#f8fafc');
      poligono(ctx, [pt(0.5, 0.35, 1.05), pt(-0.5, 0.35, 1.05), pt(-0.5, 0.35, 1.55), pt(0.5, 0.35, 1.55)], '#e2e8f0');
      poligono(ctx, [pt(-0.5, -0.35, 1.55), pt(0.5, -0.35, 1.55), pt(0.5, 0.35, 1.55), pt(-0.5, 0.35, 1.55)], '#fbbf24');
      // stop
      if (auto.freno) {
        poligono(ctx, [pt(-hl - 0.02, -hw + 0.2, 0.5), pt(-hl - 0.02, -hw + 0.5, 0.5), pt(-hl - 0.02, -hw + 0.5, 0.75), pt(-hl - 0.02, -hw + 0.2, 0.75)], '#ff4444');
        poligono(ctx, [pt(-hl - 0.02, hw - 0.5, 0.5), pt(-hl - 0.02, hw - 0.2, 0.5), pt(-hl - 0.02, hw - 0.2, 0.75), pt(-hl - 0.02, hw - 0.5, 0.75)], '#ff4444');
      }
    }

    /* Il faro sulla consegna: una colonna di luce che passa sopra ai tetti.
       Si disegna per ultima e senza ordinamento apposta — deve vedersi anche
       dietro una casa, altrimenti trovare il civico diventa girare a caso. */
    function disegnaFari(ctx) {
      if (stato !== 'giro') return;
      var punti = [];
      if (obiettivo) {
        punti.push({ x: obiettivo.faro[0], y: obiettivo.faro[1],
                     tinta: obiettivo.tipo === 'pizzeria' ? '250,204,21' : '74,222,128', alta: true });
      }
      carico.forEach(function (c) {
        if (obiettivo && obiettivo.pizza === c) return;
        if (!c.inMano) return;
        punti.push({ x: c.x, y: c.y, tinta: '56,189,248', alta: false });
      });
      punti.forEach(function (p) {
        var base = versoOcchio(p.x, p.y, 0, [0, 0, 0]);
        if (base[2] < VICINO) return;
        var alt = p.alta ? 26 : 16;
        var cima = versoOcchio(p.x, p.y, alt, [0, 0, 0]);
        var b = occhioASchermo(base, [0, 0]), t = occhioASchermo(cima, [0, 0]);
        var largh = Math.max(2, 1.6 * FUOCO / base[2]);
        var g = ctx.createLinearGradient(0, t[1], 0, b[1]);
        g.addColorStop(0, 'rgba(' + p.tinta + ',0)');
        g.addColorStop(1, 'rgba(' + p.tinta + ',0.55)');
        ctx.fillStyle = g;
        ctx.fillRect(b[0] - largh / 2, t[1], largh, b[1] - t[1]);
      });
    }

    /* ---------- HUD ---------- */

    var SWATCH = 30, SWATCH_GAP = 6;
    function posizioneColore(i) {
      var tot = COLORI.length * SWATCH + (COLORI.length - 1) * SWATCH_GAP;
      return { x: (W - tot) / 2 + i * (SWATCH + SWATCH_GAP), y: H * 0.30, w: SWATCH, h: SWATCH };
    }
    function indiceColoreA(x, y) {
      for (var i = 0; i < COLORI.length; i++) {
        var p = posizioneColore(i);
        if (x >= p.x - 4 && x <= p.x + p.w + 4 && y >= p.y - 8 && y <= p.y + p.h + 8) return i;
      }
      return -1;
    }

    function disegnaHud(ctx) {
      ctx.fillStyle = 'rgba(5,7,12,0.6)';
      ctx.fillRect(0, 0, W, 52);
      ctx.textBaseline = 'alphabetic';

      // le barre di calore, una per pizza, con l'indirizzo
      var y = 14;
      carico.forEach(function (c) {
        var mio = obiettivo && obiettivo.pizza === c;
        ctx.font = (mio ? 'bold ' : '') + '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = mio ? '#f8fafc' : 'rgba(230,237,243,0.65)';
        ctx.fillText((c.inMano ? '' : '⏳ ') + c.via + ' ' + c.civico, 10, y);
        var lw = 88, lx = W - 10 - lw;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(lx, y - 8, lw, 6);
        ctx.fillStyle = c.calore > 0.5 ? '#4ade80' : (c.calore > 0.25 ? '#fbbf24' : '#f87171');
        ctx.fillRect(lx, y - 8, lw * Math.max(0, c.calore), 6);
        y += 15;
      });
      if (!carico.length) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(230,237,243,0.7)';
        ctx.fillText('Torna in pizzeria', 10, y);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = auto.inStrada ? '#e6edf3' : '#fbbf24';
      ctx.fillText(Math.round(Math.abs(auto.velocita) * 3.6) + ' km/h', 10, 46);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e6edf3';
      ctx.fillText('🍕 ' + fatte + '/' + cfg.consegne, W - 10, 46);

      disegnaMappina(ctx);

      ctx.textAlign = 'center';
      for (var i = 0; i < note.length; i++) {
        var n = note[i];
        ctx.globalAlpha = Math.min(1, n.t);
        ctx.font = 'bold ' + (n.testo === 'Vai!' ? 40 : 15) + 'px system-ui, sans-serif';
        ctx.fillStyle = n.tinta;
        ctx.fillText(n.testo, W / 2, H * 0.46 - (1.6 - n.t) * 12);
      }
      ctx.globalAlpha = 1;

      if (obiettivo && stato === 'giro') {
        var d = Math.hypot(obiettivo.x - auto.x, obiettivo.y - auto.y);
        ctx.textAlign = 'center';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(230,237,243,0.8)';
        var eti = obiettivo.tipo === 'pizzeria' ? m.pizzeria.nome
          : obiettivo.pizza.via + ' ' + obiettivo.pizza.civico;
        ctx.fillText(eti + ' · ' + Math.round(d) + ' m', W / 2, H - 8);
        if (d < RAGGIO_CONSEGNA * 2.2 && Math.abs(auto.velocita) > VEL_CONSEGNA) {
          ctx.font = 'bold 13px system-ui, sans-serif';
          ctx.fillStyle = '#fbbf24';
          ctx.fillText('rallenta per consegnare', W / 2, H - 24);
        }
      }
    }

    function disegnaMappina(ctx) {
      var L = 86, x0 = W - L - 8, y0 = 58;
      var sc = Math.min((L - 8) / (limiti.x1 - limiti.x0), (L - 8) / (limiti.y1 - limiti.y0));
      var cx = x0 + L / 2 - (limiti.x0 + limiti.x1) / 2 * sc;
      var cy = y0 + L / 2 + (limiti.y0 + limiti.y1) / 2 * sc;
      var MX = function (x) { return cx + x * sc; };
      var MY = function (y) { return cy - y * sc; };   // a nord in su, come una mappa

      ctx.fillStyle = 'rgba(5,7,12,0.6)';
      api.util.roundRect(ctx, x0, y0, L, L, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(230,237,243,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath();
      m.strade.forEach(function (s) {
        s.punti.forEach(function (p, i) {
          if (i === 0) ctx.moveTo(MX(p[0]), MY(p[1])); else ctx.lineTo(MX(p[0]), MY(p[1]));
        });
      });
      ctx.stroke();

      if (rottaNodi && rottaNodi.length > 1) {
        var g = grafo();
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
        ctx.beginPath();
        rottaNodi.forEach(function (n, i) {
          var p = g.nodi[n];
          if (i === 0) ctx.moveTo(MX(p[0]), MY(p[1])); else ctx.lineTo(MX(p[0]), MY(p[1]));
        });
        ctx.stroke();
      }

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(MX(m.pizzeria.x) - 2, MY(m.pizzeria.y) - 2, 4, 4);
      carico.forEach(function (c) {
        ctx.fillStyle = c.inMano ? '#38bdf8' : 'rgba(56,189,248,0.5)';
        ctx.beginPath(); ctx.arc(MX(c.x), MY(c.y), 2.5, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = COLORI[colore].tinta;
      ctx.beginPath(); ctx.arc(MX(auto.x), MY(auto.y), 3, 0, Math.PI * 2); ctx.fill();
    }

    function disegnaForno(ctx) {
      ctx.fillStyle = 'rgba(5,7,12,0.55)';
      api.util.roundRect(ctx, 10, 62, W - 20, H * 0.42 - 56, 10); ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('Le pizze escono dal forno', W / 2, H * 0.20);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.8)';
      ctx.fillText('Colore dell\'auto — volante, 1-9 o un tocco', W / 2, H * 0.255);
      for (var i = 0; i < COLORI.length; i++) {
        var p = posizioneColore(i);
        ctx.fillStyle = COLORI[i].tinta;
        api.util.roundRect(ctx, p.x, p.y, p.w, p.h, 6); ctx.fill();
        if (i === colore) {
          ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3;
          api.util.roundRect(ctx, p.x - 3, p.y - 3, p.w + 6, p.h + 6, 8); ctx.stroke();
        }
        ctx.fillStyle = i === 7 ? 'rgba(230,237,243,0.85)' : 'rgba(5,7,12,0.7)';
        ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
        ctx.fillText(String(i + 1), p.x + p.w / 2, p.y + p.h / 2 + 4);
      }
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = COLORI[colore].tinta;
      ctx.fillText(COLORI[colore].nome, W / 2, H * 0.30 + SWATCH + 20);
      ctx.font = 'bold 52px system-ui, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(String(Math.max(1, Math.ceil(conto))), W / 2, H * 0.60);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.6)';
      ctx.fillText(m.nome + ' (' + m.comune + ') · ' +
        (m.fonte === 'OpenStreetMap' ? '© OpenStreetMap' : 'mappa ricostruita'), W / 2, H - 10);
    }

    function state() {
      return {
        stato: stato,
        conto: Math.max(0, conto),
        auto: { x: auto.x, y: auto.y, h: auto.h, velocita: auto.velocita, laterale: auto.laterale },
        inStrada: auto.inStrada,
        colore: colore,
        fatte: fatte,
        consegne: cfg.consegne,
        perGiro: cfg.perGiro,
        urti: urti,
        pizzeria: m.pizzeria,
        fonteMappa: m.fonte,
        // la mappa si vede tutta a schermo (mappina compresa): darla ai test
        // non regala niente a nessuno, ed è l'unico modo di verificarla
        mappa: m,
        // il carico e gli indirizzi si vedono a schermo: nessun vantaggio al bot
        carico: carico.map(function (c) {
          return { via: c.via, civico: c.civico, x: c.ax, y: c.ay, calore: Math.round(c.calore * 1000) / 1000, budget: Math.round(c.budget * 10) / 10, inMano: !!c.inMano };
        }),
        obiettivo: obiettivo ? { x: obiettivo.x, y: obiettivo.y, tipo: obiettivo.tipo } : null,
        rotta: (rottaNodi || []).map(function (n) { return grafo().nodi[n]; }),
        freddaDa: freddaDa ? freddaDa.via + ' ' + freddaDa.civico : null,
        ultimaConsegna: ultimaConsegna
      };
    }

    return { start: start, update: update, draw: draw, destroy: destroy, state: state };
  }
});

})();
