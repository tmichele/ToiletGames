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
var STERZO_MAX = 0.62;     // rad: angolo massimo delle ruote anteriori
var PASSO_AUTO = 2.5;      // m fra gli assi: con lo sterzo decide il raggio
var GRIP_STRADA = 26;      // m/s²: forza laterale che le gomme reggono
var GRIP_PRATO = 9;
var AUTO_L = 4.1, AUTO_W = 1.75, AUTO_R = 1.5;

var VEL_CROCIERA = 9;      // m/s: usata solo quando una rotta non esiste
/* Il giro ideale è un'auto che non sbaglia niente: nessuna esitazione a un
   incrocio, nessuna manovra, nessuna frenata di troppo. Chi guida davvero ci
   mette di più, e la differenza è misurabile — il pilota simulato, che pure
   conosce la strada a memoria, impiega in media un terzo in più di quanto dice
   il modello. Il calore si concede su quel tempo lì, non su quello teorico:
   altrimenti «margine 2×» vorrebbe dire in realtà «1,5×», e il numero scritto
   nella schermata del livello sarebbe una bugia. */
var ATTRITO_REALE = 1.65;
var SOSTA = 3.5;           // s per fermarsi, scendere e consegnare
var RAGGIO_CONSEGNA = 13;  // m dal civico
var VEL_CONSEGNA = 4.5;    // m/s: sopra questa non si consegna, si passa e basta
var RAGGIO_PIZZERIA = 16;
var CONTO = 3.2;           // s di attesa al forno, dove si sceglie il colore

/* Semafori e traffico. Il paese non è vuoto: qualche auto gira, e agli
   incroci grossi c'è il semaforo. Non sono decorazione — il rosso costa
   secondi, e i secondi sono calore. Passare col rosso si può, ed è come nella
   vita: rischi la fiancata di chi ha verde, e se ti va bene resta la multa. */
var SEM_CICLO = 36;        // s: 15 verde, 3 giallo, per ciascuno dei due assi
var SEM_QUANTI = 5;        // incroci semaforizzati in tutto il paese
var SEM_DISTANZA = 170;    // m minimi fra un semaforo e l'altro
var SEM_STOP = 6;          // m prima dell'incrocio dove ci si ferma
/* Sette auto, non dodici. Con dodici il paese sembrava vivo e si guidava in
   colonna: chi consegna resta dietro a chi passeggia, e in una via a una
   corsia non si sorpassa. Sette bastano a incontrarne una a ogni due incroci,
   che è quello che succede a Codiverno di sera. */
var TRAFFICO = 7;          // auto in circolazione attorno a te
var TRAFFICO_VICINO = 340; // m: oltre, l'auto viene rimessa in circolo vicino
var TRAFFICO_VEL = 11;     // m/s: come va la gente del posto
var CORSIA = 1.7;          // m a destra della mezzeria: la propria corsia
var SEM_ATTESA = 7;        // s che un semaforo costa, in media, sul giro ideale
var MULTA = 30;            // punti per livello, se passi col rosso

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
       calore che resta alla consegna cala liscio, ed è quello il vero
       indicatore di difficoltà — la percentuale di turni vinti, sopra a un
       margine così stretto, diventa testa o croce.

       Il margine si conta sul tempo *realistico* (il giro ideale già
       corretto da ATTRITO_REALE), non su quello teorico: «calore al 130%»
       vuol dire davvero un terzo di tempo in più di quanto ci mette chi la
       strada la sa. */
    margine: Math.max(1.05, 1.6 - level * 0.06),
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

/* Quanto ci mette un'auto a percorrere una rotta. Non è la distanza divisa per
   una velocità media: è un giro ideale calcolato sulla forma della strada, con
   la velocità che ogni curva permette e poi due passate — avanti per
   l'accelerazione, indietro per la frenata — perché a un incrocio non ci si
   arriva a cinquanta e non si riparte a cinquanta.

   La stima piatta funzionava sul paese ricostruito, tutto rettilinei lunghi, e
   si è rotta il giorno in cui è arrivata la mappa vera: fra le curve di Via
   Monte Grappa il pilota teneva sette metri al secondo contro i dodici e mezzo
   dati per buoni, e ogni consegna arrivava fredda. Il tempo concesso deve
   venire dalla strada che c'è, non da una media decisa a tavolino. */
var cacheTempo = {};
var nodoSemaforico = {};     // nodo -> true, riempita quando si piazzano i semafori
function tempoPercorso(a, b) {
  var chiave = a + '>' + b;
  if (cacheTempo[chiave] != null) return cacheTempo[chiave];
  var nodi = percorso(a, b);
  var t;
  if (nodi.length < 2) {
    t = distanzaTra(a, b) / VEL_CROCIERA;
  } else {
    var g = grafo(), i;
    var p = nodi.map(function (n) { return g.nodi[n]; });
    var ds = [], v = [];
    for (i = 0; i < p.length - 1; i++) ds.push(Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]));
    for (i = 0; i < p.length; i++) {
      var curva = 0;
      if (i > 0 && i < p.length - 1) {
        var a1 = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]);
        var a2 = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
        curva = Math.abs(a2 - a1);
        if (curva > Math.PI) curva = 2 * Math.PI - curva;
      }
      v.push(Math.max(3, Math.min(VEL_MAX, VEL_MAX * (1.15 - curva * 0.95))));
    }
    v[0] = Math.min(v[0], 4);                       // si parte da fermi
    v[v.length - 1] = Math.min(v[v.length - 1], 4); // e ci si ferma
    for (i = 1; i < v.length; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * ACCEL * ds[i - 1]));
    for (i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * FRENO * ds[i]));
    t = 0;
    for (i = 0; i < ds.length; i++) t += ds[i] / Math.max(2, (v[i] + v[i + 1]) / 2);
    t *= ATTRITO_REALE;
    /* Ogni semaforo sul percorso è tempo che nessuna guida può recuperare: in
       media mezzo ciclo di rosso più il rallentamento. Prometterne il calore
       senza contarli vorrebbe dire far perdere il turno a chi si ferma col
       rosso — cioè a chi fa la cosa giusta. */
    for (i = 0; i < nodi.length; i++) if (nodoSemaforico[nodi[i]]) t += SEM_ATTESA;
  }
  cacheTempo[chiave] = t;
  return t;
}

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
    tot += tempoPercorso(da, fermate[i]) + SOSTA;
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
  howto: '<b>Comandi:</b> ◀ ▶ sterzano, <b>GAS</b> accelera, <b>FRENO</b> frena ' +
    '(e da fermo fa retromarcia); da tastiera frecce o WASD. Si guida per le ' +
    'strade di <b>Codiverno</b>, visti da sopra l\'auto. ' +
    '<b>Si vince consegnando tutte le pizze calde:</b> ogni pizza ha la sua ' +
    'barra di calore, che scende da sola e non si ferma mai — nemmeno mentre ' +
    'sei fermo, nemmeno per quelle che ti aspettano sul bancone. Se una arriva ' +
    'fredda il turno è finito. ' +
    '<b>Per consegnare</b> fermati (o quasi) davanti al civico giusto: il ' +
    'faro di luce lo indica, le frecce sull\'asfalto ti portano lì. Poi torna ' +
    'in pizzeria per il carico dopo. Dal 4° livello ne porti due per giro, dal ' +
    '7° tre: contano i punti, ma conta soprattutto <b>in che ordine</b> le ' +
    'consegni. Fuori strada si arranca e le case non si attraversano. ' +
    '<b>Il paese è vivo:</b> qualche auto gira, e ai semafori il rosso va ' +
    'aspettato — il tempo per farlo è già compreso nel calore. Passarci ' +
    'costa una multa, e la fiancata di chi ha verde. ' +
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

    var cfg, auto, stato, conto, colore;
    var consegne, carico, fatte, prossimoCarico, acc, finito, note, urti, scossa;
    var cam, bordi, limiti, obiettivo, rottaNodi, ricalcolo, ultimoBeep, freddaDa, ultimaConsegna;
    var semafori, traffico, tempoSem, ultimoIncrocio, multe, davanti;

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

    /* ---------- semafori ----------

       Si mettono agli incroci veri (tre strade o più), distanti fra loro, e
       ognuno divide le strade che ci arrivano in due assi secondo la
       direzione: chi arriva da nord-sud ha verde quando chi arriva da est-ovest
       ha rosso. Sono sempre gli stessi incroci, partita dopo partita — un
       paese si impara anche così. */
    function preparaSemafori() {
      var g = grafo();
      var grado = g.nodi.map(function () { return 0; });
      g.adj.forEach(function (v, i) { grado[i] = v.length; });
      var candidati = [];
      nodoSemaforico = {};
      cacheTempo = {};      // i tempi cambiano con i semafori: si ricalcolano
      for (var i = 0; i < g.nodi.length; i++) if (grado[i] >= 3) candidati.push(i);
      // dai più «grossi» ai più piccoli, tenendo le distanze
      candidati.sort(function (a, b) { return grado[b] - grado[a] || a - b; });
      semafori = [];
      candidati.forEach(function (n) {
        if (semafori.length >= SEM_QUANTI) return;
        var p = g.nodi[n];
        for (var k = 0; k < semafori.length; k++) {
          if (Math.hypot(semafori[k].x - p[0], semafori[k].y - p[1]) < SEM_DISTANZA) return;
        }
        var assi = {};
        g.adj[n].forEach(function (e) {
          var q = g.nodi[e[0]];
          var ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
          assi[e[0]] = ((Math.round(ang / (Math.PI / 2)) % 2) + 2) % 2;
        });
        semafori.push({ n: n, x: p[0], y: p[1], assi: assi });
        nodoSemaforico[n] = true;
      });
    }

    function faseSemaforo() {
      var f = tempoSem % SEM_CICLO;
      if (f < 15) return { verde: 0, giallo: false };
      if (f < 18) return { verde: 0, giallo: true };
      if (f < 33) return { verde: 1, giallo: false };
      return { verde: 1, giallo: true };
    }

    // verde per chi arriva al semaforo `sem` provenendo dal nodo `da`
    function verdePer(sem, da) {
      var asse = sem.assi[da];
      if (asse == null) return true;
      var f = faseSemaforo();
      return f.verde === asse;
    }

    function semaforoAl(nodo) {
      for (var i = 0; i < semafori.length; i++) if (semafori[i].n === nodo) return semafori[i];
      return null;
    }

    /* ---------- traffico ----------

       Ogni auto vive su un arco del grafo e cammina verso il nodo in fondo;
       arrivata, ne sceglie un altro che non sia quello da cui è venuta. Frena
       per il rosso, per chi ha davanti e per te. Quelle che si allontanano
       troppo vengono rimesse in circolo vicino al giocatore: tenere in vita
       tutto il paese costerebbe senza che nessuno lo veda. */
    function nuovaAuto(vicinoA) {
      var g = grafo();
      for (var t = 0; t < 60; t++) {
        var arco = g.archi ? null : null;
        var a = Math.floor(rngTraffico() * g.nodi.length);
        if (!g.adj[a].length) continue;
        var b = g.adj[a][Math.floor(rngTraffico() * g.adj[a].length)][0];
        var p = g.nodi[a];
        var d = Math.hypot(p[0] - vicinoA.x, p[1] - vicinoA.y);
        if (d < 90 || d > 260) continue;
        return {
          a: a, b: b, t: rngTraffico() * 0.6, vel: TRAFFICO_VEL * 0.6,
          colore: COLORI[Math.floor(rngTraffico() * COLORI.length)].tinta,
          freno: false, x: p[0], y: p[1], h: 0, sterzo: 0
        };
      }
      return null;
    }

    var semeTraffico = 0;
    function rngTraffico() {
      semeTraffico = (semeTraffico + 0x6D2B79F5) >>> 0;
      var x = Math.imul(semeTraffico ^ (semeTraffico >>> 15), 1 | semeTraffico);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    }

    function passoTraffico(dt) {
      var g = grafo();
      tempoSem += dt;

      // rimpiazzo di chi si è allontanato
      for (var i = traffico.length - 1; i >= 0; i--) {
        if (Math.hypot(traffico[i].x - auto.x, traffico[i].y - auto.y) > TRAFFICO_VICINO) traffico.splice(i, 1);
      }
      while (traffico.length < TRAFFICO) {
        var nuova = nuovaAuto(auto);
        if (!nuova) break;
        traffico.push(nuova);
      }

      for (i = 0; i < traffico.length; i++) {
        var v = traffico[i];
        var pa = g.nodi[v.a], pb = g.nodi[v.b];
        var len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
        var restanti = (1 - v.t) * len;

        var voluta = TRAFFICO_VEL;
        // il rosso in fondo all'arco
        var sem = semaforoAl(v.b);
        if (sem && !verdePer(sem, v.a) && restanti < 45) {
          voluta = Math.max(0, (restanti - SEM_STOP) * 0.55);
        }
        // chi ha davanti sullo stesso arco, e il giocatore
        for (var j = 0; j < traffico.length; j++) {
          var w = traffico[j];
          if (j === i || w.a !== v.a || w.b !== v.b || w.t <= v.t) continue;
          var gap = (w.t - v.t) * len;
          if (gap < 16) voluta = Math.min(voluta, Math.max(0, (gap - 7) * 0.9));
        }
        var dxG = auto.x - v.x, dyG = auto.y - v.y;
        var avantiG = dxG * Math.cos(v.h) + dyG * Math.sin(v.h);
        var latG = Math.abs(-dxG * Math.sin(v.h) + dyG * Math.cos(v.h));
        // frena per il giocatore solo se ce l'ha davvero nella propria corsia
        if (avantiG > 0 && avantiG < 15 && latG < 2.2) voluta = Math.min(voluta, Math.max(0, (avantiG - 5) * 0.9));

        /* Chi non è fermo a un rosso non si pianta mai del tutto: un'auto
           immobile in mezzo alla via, in un paese senza sorpassi, è un muro —
           e dietro ci resta chiunque, per sempre. */
        if (!(sem && !verdePer(sem, v.a) && restanti < 45)) voluta = Math.max(voluta, 1.6);
        v.freno = voluta < v.vel - 0.4;
        v.vel += (voluta - v.vel) * Math.min(1, (v.freno ? 5 : 2.2) * dt);
        v.vel = Math.max(0, v.vel);
        v.t += (v.vel * dt) / len;

        if (v.t >= 1) {
          var scelte = g.adj[v.b].filter(function (e) { return e[0] !== v.a; });
          if (!scelte.length) scelte = g.adj[v.b];
          var prossimo = scelte.length ? scelte[Math.floor(rngTraffico() * scelte.length)][0] : v.a;
          v.a = v.b; v.b = prossimo; v.t = 0;
          pa = g.nodi[v.a]; pb = g.nodi[v.b];
          len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
        }
        /* Si tiene la destra. Il grafo è la mezzeria: senza scostamento tutti
           viaggiano sulla riga bianca, e ogni incrocio con chi arriva in senso
           opposto è un frontale — il pilota simulato raccoglieva ventiquattro
           botte a turno senza aver sbagliato niente. */
        var lx = pb[0] - pa[0], ly = pb[1] - pa[1];
        var ll = Math.hypot(lx, ly) || 1;
        var destraX = ly / ll * CORSIA, destraY = -lx / ll * CORSIA;
        v.x = pa[0] + lx * v.t + destraX;
        v.y = pa[1] + ly * v.t + destraY;
        var hNuovo = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
        var dh = hNuovo - v.h;
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        v.h += dh * Math.min(1, 8 * dt);
        v.sterzo = Math.max(-1, Math.min(1, dh * 2));

        // botta con il giocatore: due lamiere, non due punti
        var d = Math.hypot(v.x - auto.x, v.y - auto.y);
        if (d < 3.4 && d > 0.01) {
          var nx = (auto.x - v.x) / d, ny = (auto.y - v.y) / d;
          var spinta = (3.4 - d);
          auto.x += nx * spinta * 0.8; auto.y += ny * spinta * 0.8;
          v.x -= nx * spinta * 0.2; v.y -= ny * spinta * 0.2;
          var vn = auto.vx * nx + auto.vy * ny;
          if (vn < 0) {
            auto.vx -= vn * nx * 1.4; auto.vy -= vn * ny * 1.4;
            auto.vx *= 0.6; auto.vy *= 0.6;
            v.vel *= 0.4;
            if (!auto.aContattoAuto) {
              urti++;
              scossa = 0.3;
              api.sfx.tone(300, 0.35, 'square', 0.09, 180);   // il clacson
            }
            // un secondo di grazia: strusciare lungo una fiancata è una botta sola
            auto.aContattoAuto = 60;
          }
        }
      }
      if (auto.aContattoAuto) auto.aContattoAuto--;
    }

    /* Cosa c'è davanti a te entro cinquanta metri: un rosso o una coda. Lo
       vede chi guida guardando la strada, e lo espone lo stato — è quello che
       permette al pilota simulato di fermarsi al semaforo invece di prendere
       la fiancata di chi ha verde. */
    function guardaAvanti() {
      var g = grafo();
      var c = Math.cos(auto.h), s = Math.sin(auto.h);
      var best = null;
      semafori.forEach(function (sem) {
        var dx = sem.x - auto.x, dy = sem.y - auto.y;
        var av = dx * c + dy * s, lat = Math.abs(-dx * s + dy * c);
        /* Il rosso conta solo finché si è *prima* della linea. Chi è già
           dentro l'incrocio lo sgombera: segnalarglielo lo inchiodava in mezzo
           alle strisce, con la linea alle spalle e il gas a zero — fermo lì
           finché le pizze si gelavano. */
        if (av < SEM_STOP - 1 || av > 55 || lat > 12) return;
        // da dove ci si arriva: il vicino del semaforo più allineato con noi
        var daNodoVicino = null, meglio = -Infinity;
        Object.keys(sem.assi).forEach(function (k) {
          var q = g.nodi[k];
          var vx = sem.x - q[0], vy = sem.y - q[1];
          var l = Math.hypot(vx, vy) || 1;
          var all = (vx / l) * c + (vy / l) * s;
          if (all > meglio) { meglio = all; daNodoVicino = k; }
        });
        if (!verdePer(sem, daNodoVicino) && (!best || av < best.distanza)) {
          best = { tipo: 'semaforo', distanza: av - SEM_STOP, x: sem.x, y: sem.y };
        }
      });
      traffico.forEach(function (v) {
        var dx = v.x - auto.x, dy = v.y - auto.y;
        var av = dx * c + dy * s, lat = Math.abs(-dx * s + dy * c);
        if (av < 0 || av > 45 || lat > 2.6) return;
        /* Solo chi va nella nostra stessa direzione: dietro a chi ci viene
           incontro non ci si accoda, gli si passa a fianco. Contando anche i
           contromano il pilota si fermava davanti a un'auto che si fermava a
           sua volta per lui — due che si cedono il passo all'infinito, e il
           turno finiva senza una consegna e senza una botta. */
        if (Math.cos(v.h) * c + Math.sin(v.h) * s < 0.3) return;
        if (!best || av - 5 < best.distanza) best = { tipo: 'auto', distanza: av - 5, x: v.x, y: v.y };
      });
      davanti = best;
    }

    /* La multa: si prende passando l'incrocio col rosso a velocità di marcia.
       Non chiude il turno — la punizione vera è la fiancata di chi arriva —
       ma toglie punti, e i punti sono la classifica. */
    function controllaRosso() {
      var g = grafo();
      for (var i = 0; i < semafori.length; i++) {
        var sem = semafori[i];
        var d = Math.hypot(sem.x - auto.x, sem.y - auto.y);
        if (d > 7 || Math.abs(auto.velocita) < 2) continue;
        if (ultimoIncrocio === sem.n) return;
        var c = Math.cos(auto.h), s = Math.sin(auto.h);
        var daNodoVicino = null, meglio = -Infinity;
        Object.keys(sem.assi).forEach(function (k) {
          var q = g.nodi[k];
          var vx = sem.x - q[0], vy = sem.y - q[1];
          var l = Math.hypot(vx, vy) || 1;
          var all = (vx / l) * c + (vy / l) * s;
          if (all > meglio) { meglio = all; daNodoVicino = k; }
        });
        ultimoIncrocio = sem.n;
        if (!verdePer(sem, daNodoVicino)) {
          multe++;
          api.addScore(-MULTA * cfg.level);
          nota('Col rosso: −' + (MULTA * cfg.level), '#f87171');
          api.sfx.tone(200, 0.3, 'sawtooth', 0.08, 120);
        }
        return;
      }
      // usciti dall'incrocio, si può prendere la prossima multa
      var vicino = false;
      for (i = 0; i < semafori.length; i++) {
        if (Math.hypot(semafori[i].x - auto.x, semafori[i].y - auto.y) < 12) vicino = true;
      }
      if (!vicino) ultimoIncrocio = null;
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
      var rientro = tempoPercorso(qui, pizzeria);
      scelte.forEach(function (c, i) {
        c.presa = true;
        c.budget = (rientro + giro.tempi[i]) * cfg.margine;
        c.calore = 1;
        c.inMano = false;      // sul bancone finché non passi a prenderle
        c.ordine = giro.ordine.indexOf(i);
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
        /* Il navigatore segue *l'ordine su cui è stato calcolato il calore*,
           non la fermata più vicina a dove sei adesso. Sembrava più naturale
           mandare sempre alla più vicina, ma è un ordine diverso da quello del
           budget: con tre pizze in macchina l'ultima aspettava un giro in più
           di quello che le era stato concesso, e arrivava fredda seguendo le
           indicazioni del gioco stesso. Deviare resta permesso — le consegne
           si contano per vicinanza, non per obbedienza. */
        var best = null;
        carico.forEach(function (c) {
          if (!best || (c.ordine || 0) < (best.ordine || 0)) best = c;
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
        vx: 0, vy: 0, sterzo: 0, gas: 0, freno: false, velocita: 0, laterale: 0,
        inStrada: true, carico: 1, slittamento: 0
      };
      cam = { x: auto.x, y: auto.y, ang: auto.h };
      stato = 'forno';
      conto = CONTO;
      ultimoBeep = 9;
      fatte = 0; carico = []; prossimoCarico = false;
      acc = 0; finito = false; note = []; urti = 0; scossa = 0;
      ricalcolo = 0; rottaNodi = []; obiettivo = null; freddaDa = null; ultimaConsegna = null;
      /* Il paese vive: i semafori sono sempre gli stessi incroci, il traffico
         riparte da zero a ogni turno con lo stesso seme, quindi anche le auto
         che incontri sono le stesse — un turno si può imparare. */
      preparaSemafori();
      semeTraffico = 0x7A4F;
      tempoSem = 0;
      traffico = [];
      ultimoIncrocio = null; multe = 0; davanti = null;
      colore = leggiColore();
      nuovoCarico();
      carico.forEach(function (c) { c.inMano = true; });   // il primo carico è già in mano
    }

    /* ---------- fisica ---------- */

    function passo(dt) {
      var sinistra = api.input.isDown('left'), destra = api.input.isDown('right');
      var gas = api.input.isDown('up'), freno = api.input.isDown('down');

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
        conto -= dt;
        var sec = Math.ceil(conto);
        if (sec < ultimoBeep && sec >= 1) { ultimoBeep = sec; api.sfx.tone(420, 0.1, 'square', 0.08); }
        if (conto <= 0) {
          stato = 'giro';
          api.sfx.tone(880, 0.3, 'square', 0.11);
          nota('Vai!', '#4ade80');
        }
        passoTraffico(dt);
        audio(gas ? 0.7 : 0.12, gas ? 0.6 : 0, 0);
        return;
      }

      while (api.input.take()) { /* in giro contano solo i tasti tenuti premuti */ }
      while (api.input.takeTap()) { }
      while (api.input.takeDigit()) { }

      /* Lo sterzo non scatta, si gira: i due tasti danno tutto o niente e
         questa è la molla che ci mette in mezzo una frazione di secondo —
         senza, a cinquanta all'ora ogni tocco manderebbe l'auto di traverso. */
      var bersaglio = (sinistra ? -1 : 0) + (destra ? 1 : 0);
      auto.sterzo += (bersaglio - auto.sterzo) * Math.min(1, 10 * dt);

      var inStrada = sullaStrada(auto.x, auto.y);
      auto.inStrada = inStrada;
      var vmax = inStrada ? VEL_MAX : VEL_PRATO;

      var c = Math.cos(auto.h), s = Math.sin(auto.h);
      var avanti = auto.vx * c + auto.vy * s;
      var lato = -auto.vx * s + auto.vy * c;

      /* Modello a bicicletta, al posto di «giro il muso di tanto al secondo».
         L'angolo delle ruote decide la rotazione attraverso il passo:
         ω = v·tan(δ)/passo. Da quella riga sola vengono gratis tre cose che
         prima andavano finte a mano — da fermi non si gira, in retromarcia si
         gira dall'altra parte, e più si va forte più il raggio si allarga a
         parità di sterzo.

         Lo sterzo massimo cala con la velocità: a cinquanta all'ora nessuno
         gira a fondo corsa, e senza questo l'auto faceva perni impossibili.

         Il segno è meno, e non è un dettaglio: `h` è l'angolo con la
         convenzione di sempre (x a est, y a nord, angoli in senso
         antiorario), mentre la destra dello schermo è il versore
         (sin h, −cos h), che è orario. Sommando invece di sottrarre,
         tenendo «destra» l'auto girava a sinistra. */
      var presa = inStrada ? 1 : 0.72;
      var sterzoMax = STERZO_MAX * (1 - 0.5 * Math.min(1, Math.abs(avanti) / VEL_MAX));
      var delta = auto.sterzo * sterzoMax * presa;
      auto.h -= (avanti * Math.tan(delta) / PASSO_AUTO) * dt;
      c = Math.cos(auto.h); s = Math.sin(auto.h);

      /* Trasferimento di carico: in frenata il muso si abbassa e l'avantreno
         morde, in accelerazione si alleggerisce. È il motivo per cui in un
         tornante si entra frenando e si esce di gas — e adesso il gioco lo
         premia invece di ignorarlo. */
      auto.carico += ((freno ? 1.3 : (gas ? 0.82 : 1)) - auto.carico) * Math.min(1, 6 * dt);

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

      /* Aderenza laterale che *satura*: le gomme reggono fino a un tetto di
         forza, oltre quello scivolano. Con lo smorzamento esponenziale di
         prima l'auto era sulle rotaie a qualunque velocità — non derapava mai,
         e arrivare in curva piano o forte era lo stesso. */
      var grip = (inStrada ? GRIP_STRADA : GRIP_PRATO) * auto.carico;
      var richiesta = Math.abs(lato) / Math.max(dt, 0.001);
      lato -= (lato > 0 ? 1 : -1) * Math.min(richiesta, grip) * dt;
      auto.slittamento = Math.min(1, Math.max(0, (richiesta - grip) / 55));

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
      passoTraffico(dt);
      controllaRosso();
      guardaAvanti();

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
      audio(giri, auto.gas, auto.slittamento * (inStrada ? 1 : 0.5) +
        (!inStrada && Math.abs(avanti) > 2 ? 0.35 : 0));
    }

    function sullaStrada(x, y) {
      for (var i = 0; i < m.strade.length; i++) {
        /* Un metro e mezzo di tolleranza oltre l'asfalto: in paese la
           banchina si usa, e chiedere di stare al centimetro dentro la riga
           in curva vorrebbe dire arrancare per metà del percorso. */
        var s = m.strade[i], p = s.punti, mezzo = s.larghezza / 2 + 1.5;
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
          /* Si toglie la sola componente contro il muro: l'auto scivola lungo
             la parete invece di incollarcisi. Prima ogni fotogramma di
             contatto tagliava il 60% della velocità, e in un angolo fra due
             case l'auto restava piantata anche a gas aperto — trappola vera,
             non difficoltà. Una botta forte costa lo stesso. */
          auto.vx -= vn * wx; auto.vy -= vn * wy;
          if (forza > 0.25) { auto.vx *= 0.55; auto.vy *= 0.55; }
          else { auto.vx *= 0.94; auto.vy *= 0.94; }
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
        if (d >= 0) lista.push({ d: d, e: m.alberi[i], tipo: 'albero' });
      }
      for (i = 0; i < traffico.length; i++) {
        d = vicinoAllaCamera(traffico[i].x, traffico[i].y);
        if (d >= 0) lista.push({ d: d, e: traffico[i], tipo: 'auto' });
      }
      for (i = 0; i < semafori.length; i++) {
        d = vicinoAllaCamera(semafori[i].x, semafori[i].y);
        if (d >= 0) lista.push({ d: d, e: semafori[i], tipo: 'semaforo' });
      }
      lista.sort(function (a, b) { return b.d - a.d; });
      for (i = 0; i < lista.length; i++) {
        var el = lista[i];
        if (el.tipo === 'albero') disegnaAlbero(ctx, el.e);
        else if (el.tipo === 'auto') disegnaVeicolo(ctx, el.e);
        else if (el.tipo === 'semaforo') disegnaSemaforo(ctx, el.e);
        else disegnaEdificio(ctx, el.e);
      }
    }

    /* Una scatola nel mondo: i quattro muri girati verso di noi e il tetto.
       La usano gli edifici, i pezzi dell'auto, i pali dei semafori — tutto
       quello che in questo gioco è tridimensionale è una scatola. */
    function scatola(ctx, cx, cy, cz, l, w, alt, rot, tinta, tintaTetto, dettagli) {
      var c = Math.cos(rot), s = Math.sin(rot);
      var hx = l / 2, hy = w / 2;
      var ang = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(function (p) {
        return [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c];
      });
      for (var i = 0; i < 4; i++) {
        var a = ang[i], b = ang[(i + 1) % 4];
        var nx = b[1] - a[1], ny = -(b[0] - a[0]);
        var ln = Math.hypot(nx, ny) || 1;
        nx /= ln; ny /= ln;
        // solo i muri girati verso di noi: gli altri sono coperti dai primi
        if ((camState.x - a[0]) * nx + (camState.y - a[1]) * ny <= 0) continue;
        poligono(ctx, [[a[0], a[1], cz], [b[0], b[1], cz], [b[0], b[1], cz + alt], [a[0], a[1], cz + alt]],
          tinta(nx, ny));
        if (dettagli) dettagli(ctx, a, b, nx, ny, ln, i);
      }
      if (tintaTetto) {
        poligono(ctx, ang.map(function (p) { return [p[0], p[1], cz + alt]; }), tintaTetto);
      }
      return ang;
    }

    /* Porte e finestre. Un paese di scatole lisce sembra un plastico: bastano
       due file di finestre e una porta perché diventi una casa, e il costo è
       qualche rettangolo in più solo sugli edifici vicini — da lontano non si
       distinguerebbero comunque, e sarebbero solo fotogrammi buttati. */
    function aperture(e, base) {
      return function (ctx, a, b, nx, ny, muro) {
        if (vicinoAllaCamera(e.x, e.y) > 90) return;
        var piani = Math.max(1, Math.min(4, Math.round(e.h / 3.2)));
        var quante = Math.max(1, Math.min(6, Math.floor(muro / 3.2)));
        var passo = muro / quante;
        var ux = (b[0] - a[0]) / muro, uy = (b[1] - a[1]) / muro;
        // il vetro sporge di pochi centimetri, altrimenti sparisce dentro al muro
        var ox = nx * 0.06, oy = ny * 0.06;
        for (var p = 0; p < piani; p++) {
          var z0 = 0.9 + p * (e.h / piani) * 0.92;
          var z1 = z0 + Math.min(1.3, (e.h / piani) * 0.42);
          if (z1 > e.h - 0.25) break;
          for (var k = 0; k < quante; k++) {
            var t0 = (k + 0.32) * passo, t1 = (k + 0.68) * passo;
            poligono(ctx, [
              [a[0] + ux * t0 + ox, a[1] + uy * t0 + oy, z0],
              [a[0] + ux * t1 + ox, a[1] + uy * t1 + oy, z0],
              [a[0] + ux * t1 + ox, a[1] + uy * t1 + oy, z1],
              [a[0] + ux * t0 + ox, a[1] + uy * t0 + oy, z1]
            ], p === 0 && e.tipo === 'pizzeria' ? '#ffd27f' : '#26405e');
          }
        }
        // la porta sta sul muro che guarda la strada: il generatore ci dice quale
        if (e.pax == null) return;
        if ((e.pax - a[0]) * nx + (e.pay - a[1]) * ny <= 0) return;
        var mx = muro / 2;
        poligono(ctx, [
          [a[0] + ux * (mx - 0.55) + ox, a[1] + uy * (mx - 0.55) + oy, 0],
          [a[0] + ux * (mx + 0.55) + ox, a[1] + uy * (mx + 0.55) + oy, 0],
          [a[0] + ux * (mx + 0.55) + ox, a[1] + uy * (mx + 0.55) + oy, 2.1],
          [a[0] + ux * (mx - 0.55) + ox, a[1] + uy * (mx - 0.55) + oy, 2.1]
        ], base === 'pizzeria' ? '#7c2d12' : '#5b4636');
      };
    }

    function disegnaEdificio(ctx, e) {
      var base = COLORE_EDIFICIO[e.tipo] || '#c8b7a2';
      scatola(ctx, e.x, e.y, 0, e.l, e.w, e.h, e.rot,
        function (nx, ny) { return tinta(base, luce(nx, ny)); },
        tinta(COLORE_TETTO[e.tipo] || '#8d4a3a', 0.95),
        aperture(e, e.tipo));
      // gronda: un tetto che sporge dà spessore al volume, e costa un poligono
      if (vicinoAllaCamera(e.x, e.y) < 110 && e.tipo !== 'capannone') {
        scatola(ctx, e.x, e.y, e.h, e.l + 0.9, e.w + 0.9, 0.28, e.rot,
          function () { return tinta(COLORE_TETTO[e.tipo] || '#8d4a3a', 0.75); },
          tinta(COLORE_TETTO[e.tipo] || '#8d4a3a', 1));
      }
    }

    /* Il semaforo: palo e testata con le tre luci, una per ciascun asse così
       chi arriva da qualunque parte vede la sua. La luce accesa è piena, le
       altre spente ma visibili — un semaforo con una lampada sola non si
       legge, e a quaranta all'ora bisogna capirlo in mezzo secondo. */
    function disegnaSemaforo(ctx, sem) {
      var f = faseSemaforo();
      var g = grafo();
      var vicini = Object.keys(sem.assi);
      for (var k = 0; k < vicini.length && k < 4; k++) {
        var q = g.nodi[vicini[k]];
        var ang = Math.atan2(q[1] - sem.y, q[0] - sem.x);
        // il palo sta sul bordo destro di chi arriva da quella direzione
        var px = sem.x + Math.cos(ang) * 7 + Math.cos(ang - Math.PI / 2) * 4.5;
        var py = sem.y + Math.sin(ang) * 7 + Math.sin(ang - Math.PI / 2) * 4.5;
        scatola(ctx, px, py, 0, 0.22, 0.22, 3.1, 0, function () { return '#3a4150'; }, '#3a4150');
        scatola(ctx, px, py, 3.1, 0.5, 0.5, 1.5, ang, function () { return '#1a1f28'; }, '#12161d');
        var asse = sem.assi[vicini[k]];
        var verde = f.verde === asse && !f.giallo;
        var giallo = f.verde === asse && f.giallo;
        var luci = [verde ? '#111' : '#7f1d1d', giallo ? '#fbbf24' : '#4a3a12', verde ? '#4ade80' : '#12361f'];
        for (var l = 0; l < 3; l++) {
          var z = 4.25 - l * 0.42;
          var ox = Math.cos(ang) * 0.27, oy = Math.sin(ang) * 0.27;
          poligono(ctx, [
            [px + ox - Math.cos(ang - Math.PI / 2) * 0.16, py + oy - Math.sin(ang - Math.PI / 2) * 0.16, z],
            [px + ox + Math.cos(ang - Math.PI / 2) * 0.16, py + oy + Math.sin(ang - Math.PI / 2) * 0.16, z],
            [px + ox + Math.cos(ang - Math.PI / 2) * 0.16, py + oy + Math.sin(ang - Math.PI / 2) * 0.16, z + 0.3],
            [px + ox - Math.cos(ang - Math.PI / 2) * 0.16, py + oy - Math.sin(ang - Math.PI / 2) * 0.16, z + 0.3]
          ], luci[l]);
        }
      }
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

    /* Un'auto vera invece di un parallelepipedo: telaio, abitacolo arretrato
       con i vetri, quattro ruote (le anteriori girano con lo sterzo), fari,
       stop che si accendono in frenata. È lo stesso disegno per l'auto delle
       pizze e per quelle del traffico — cambia il colore e l'insegna sul
       tetto. */
    function disegnaVeicolo(ctx, v) {
      var c = Math.cos(v.h), s = Math.sin(v.h);
      function pt(av, lat, alt) {
        return [v.x + c * av - s * lat, v.y + s * av + c * lat, alt];
      }
      var base = v.colore;
      var hl = AUTO_L / 2, hw = AUTO_W / 2;

      // ombra a terra
      poligono(ctx, [pt(-hl, -hw, 0.01), pt(hl, -hw, 0.01), pt(hl, hw, 0.01), pt(-hl, hw, 0.01)], 'rgba(0,0,0,0.32)');

      // ruote: le anteriori sterzano, e si vede
      var sterzo = (v.sterzo || 0) * 0.5;
      [[1.25, 1], [1.25, -1], [-1.3, 1], [-1.3, -1]].forEach(function (r) {
        var davanti = r[0] > 0;
        var wx = v.x + c * r[0] - s * (r[1] * (hw - 0.12));
        var wy = v.y + s * r[0] + c * (r[1] * (hw - 0.12));
        scatola(ctx, wx, wy, 0, 0.66, 0.24, 0.62, v.h + (davanti ? sterzo : 0),
          function () { return '#15181f'; }, '#23262e');
      });

      // telaio e abitacolo
      scatola(ctx, v.x, v.y, 0.34, AUTO_L, AUTO_W, 0.62, v.h,
        function (nx, ny) { return tinta(base, luce(nx, ny)); }, tinta(base, 1));
      var ax = v.x - c * 0.25, ay = v.y - s * 0.25;
      scatola(ctx, ax, ay, 0.96, AUTO_L * 0.5, AUTO_W - 0.22, 0.5, v.h,
        function (nx, ny) { return tinta(base, luce(nx, ny) * 0.92); }, tinta(base, 0.85));

      // vetri: parabrezza, lunotto e i due laterali
      var vetro = 'rgba(150,200,235,0.85)';
      poligono(ctx, [pt(0.78, -0.72, 1.02), pt(0.78, 0.72, 1.02), pt(0.5, 0.66, 1.42), pt(0.5, -0.66, 1.42)], vetro);
      poligono(ctx, [pt(-1.3, 0.72, 1.02), pt(-1.3, -0.72, 1.02), pt(-1.05, -0.66, 1.42), pt(-1.05, 0.66, 1.42)], 'rgba(120,170,205,0.8)');
      for (var lato = -1; lato <= 1; lato += 2) {
        poligono(ctx, [pt(0.7, lato * 0.78, 1.06), pt(-1.2, lato * 0.78, 1.06),
                       pt(-1.05, lato * 0.72, 1.4), pt(0.55, lato * 0.72, 1.4)],
          lato > 0 ? 'rgba(130,180,215,0.7)' : 'rgba(110,160,195,0.7)');
      }

      // fari e stop
      poligono(ctx, [pt(hl + 0.01, -0.72, 0.5), pt(hl + 0.01, -0.36, 0.5), pt(hl + 0.01, -0.36, 0.76), pt(hl + 0.01, -0.72, 0.76)], '#fff7d6');
      poligono(ctx, [pt(hl + 0.01, 0.36, 0.5), pt(hl + 0.01, 0.72, 0.5), pt(hl + 0.01, 0.72, 0.76), pt(hl + 0.01, 0.36, 0.76)], '#fff7d6');
      var stop = v.freno ? '#ff3b30' : '#8e1b16';
      poligono(ctx, [pt(-hl - 0.01, -0.72, 0.5), pt(-hl - 0.01, -0.36, 0.5), pt(-hl - 0.01, -0.36, 0.76), pt(-hl - 0.01, -0.72, 0.76)], stop);
      poligono(ctx, [pt(-hl - 0.01, 0.36, 0.5), pt(-hl - 0.01, 0.72, 0.5), pt(-hl - 0.01, 0.72, 0.76), pt(-hl - 0.01, 0.36, 0.76)], stop);

      // l'insegna sul tetto: la porta solo chi consegna
      if (v.insegna) {
        scatola(ctx, ax, ay, 1.46, 1.15, 0.42, 0.42, v.h,
          function () { return '#f8fafc'; }, '#fbbf24');
      }
    }

    function disegnaAuto(ctx) {
      disegnaVeicolo(ctx, { x: auto.x, y: auto.y, h: auto.h, colore: COLORI[colore].tinta,
        freno: auto.freno, sterzo: auto.sterzo, insegna: true });
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
      ctx.fillText('Colore dell\'auto — ◀ ▶, 1-9 o un tocco', W / 2, H * 0.255);
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
      /* Fonte e civici, scritti ogni volta che si parte. Le strade sono vere,
         i numeri quasi mai: dirlo costa una riga e vale più di un README che
         nessuno apre. */
      ctx.fillText(m.nome + ' (' + m.comune + ') · ' +
        (m.fonte === 'OpenStreetMap' ? '© OpenStreetMap' : 'mappa ricostruita'), W / 2, H - 22);
      if (m.civici) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(230,237,243,0.45)';
        ctx.fillText('civici ' + m.civici, W / 2, H - 9);
      }
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
        // quello che vede chi guida: un rosso o una coda entro cinquanta metri
        davanti: davanti ? { tipo: davanti.tipo, distanza: Math.round(davanti.distanza * 10) / 10 } : null,
        multe: multe,
        semafori: semafori.map(function (x) {
          var f = faseSemaforo();
          return { x: x.x, y: x.y, verde: f.verde, giallo: f.giallo };
        }),
        traffico: traffico.map(function (v) {
          return { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, h: v.h, vel: Math.round(v.vel * 10) / 10 };
        }),
        rotta: (rottaNodi || []).map(function (n) { return grafo().nodi[n]; }),
        freddaDa: freddaDa ? freddaDa.via + ' ' + freddaDa.civico : null,
        ultimaConsegna: ultimaConsegna
      };
    }

    return { start: start, update: update, draw: draw, destroy: destroy, state: state };
  }
});

})();
