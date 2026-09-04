/* Rally — prove speciali viste dall'alto, contro il cronometro.

   Un percorso per livello, dal via all'arrivo, e un tempo massimo: si vince
   arrivando prima che scada. Niente avversari in pista — l'avversario è il
   tempo, come in un rally vero — e niente vite: si sbaglia, si perde velocità,
   si recupera.

   Tre scelte che tengono insieme il gioco:

   - il percorso di un livello è sempre quello. È generato, ma con un seme che
     dipende solo dal numero del livello: la prova speciale 4 è la stessa oggi,
     domani e dopo dieci tentativi. Un rally si impara a memoria, curva dopo
     curva, ed è quello che rende battibile un tempo che al primo passaggio
     sembra impossibile;
   - fuori strada non si muore, si striscia. L'erba frena forte e non tiene:
     tagliare una curva costa più che percorrerla. È il freno vero del gioco,
     e i tornanti hanno le porte apposta — si passano tutte, o la freccia ti
     rimanda indietro;
   - l'auto scivola. La velocità non gira con il muso: la componente laterale
     resta e si spegne con l'aderenza, tanta sull'asfalto e poca sull'erba.
     È la derapata, ed è il motivo per cui frenare prima della curva e
     accelerare in uscita è una cosa che si sente sotto il pollice.

   L'audio è metà del gioco: il motore è un suono continuo che segue i giri, con
   le marce che cambiano, lo slittamento delle gomme quando si scivola, il
   conto alla rovescia, il tonfo contro gli alberi. Sta in TG.sfx come suono
   continuo (motoreImposta), non come effetto: va rinfrescato a ogni update e si
   spegne da solo se il gioco si ferma. */
(function () {
'use strict';

var PASSO = 1 / 60;        // s: passo fisso di simulazione

/* L'auto, in px e secondi. VEL_MAX è il metro di tutto: la velocità richiesta
   dal cronometro cresce verso questo numero, mai oltre. */
var VEL_MAX = 300;         // px/s sull'asfalto, a gas aperto
var ACCEL = 240;           // px/s²
var FRENO = 520;
var RETRO_MAX = 70;        // in retromarcia si va piano: serve a togliersi da un albero
var ATTRITO = 40;          // decelerazione a gas chiuso
var STERZO = 2.6;          // rad/s con lo sterzo tutto girato e le gomme che tengono
var GRIP_STRADA = 7.5;     // quanto in fretta si spegne lo scivolamento laterale
var GRIP_ERBA = 2.0;
var ERBA_VEL = 120;        // sull'erba si cammina, non si corre
var AUTO_L = 24, AUTO_W = 13, AUTO_R = 11;

var PASSO_TRACCIATO = 90;  // px fra due punti di controllo del percorso
var SUDDIVISIONI = 10;     // campioni fra due punti di controllo (~9 px)
var PORTA_OGNI = 44;       // campioni fra una porta e l'altra (~400 px)
var CONTO = 3.4;           // s di conto alla rovescia, con la scelta del colore

/* I colori dell'auto. Il numero è quello che si preme da tastiera. */
var COLORI = [
  { nome: 'Rosso',   tinta: '#ef4444' },
  { nome: 'Blu',     tinta: '#3b82f6' },
  { nome: 'Giallo',  tinta: '#facc15' },
  { nome: 'Verde',   tinta: '#22c55e' },
  { nome: 'Bianco',  tinta: '#f1f5f9' },
  { nome: 'Arancio', tinta: '#f97316' },
  { nome: 'Viola',   tinta: '#a855f7' },
  { nome: 'Nero',    tinta: '#475569' },
  { nome: 'Rosa',    tinta: '#f472b6' }
];
var CHIAVE_COLORE = 'rally:colore';

/* La difficoltà è tutta qui: percorsi più lunghi e più tortuosi, strada più
   stretta, più alberi a bordo pista, e soprattutto una velocità media richiesta
   che sale. Il tempo massimo non è deciso a occhio: è la lunghezza del percorso
   divisa per quella velocità, così un livello lungo il doppio ha il doppio del
   tempo e la difficoltà sta nella velocità, non nella lunghezza. */
function config(level) {
  return {
    level: level,
    tratti: Math.min(22 + level * 3, 70),              // punti di controllo
    larghezza: Math.max(42, 68 - level * 2.4),          // strada, in px
    sterzata: Math.min(0.45 + level * 0.035, 0.85),     // rad massimi fra due tratti
    alberi: 0.9 + level * 0.12,                         // per tratto
    /* Quanto tempo in più rispetto a un giro ideale: al primo livello quasi
       il doppio, poi si stringe. È la leva vera della difficoltà. */
    margine: Math.max(1.06, 1.62 - level * 0.06),
    puntiPorta: 10 * level,
    bonusArrivo: 100 * level
  };
}

/* ---------- generazione del percorso ----------
   Fuori da create() perché serve anche a levelInfo, che deve dire il tempo
   massimo prima che la partita cominci. È deterministica: stesso livello,
   stesso percorso. */

function creaRng(s) {
  var x = s >>> 0;
  return function () {
    x = (x + 0x6D2B79F5) >>> 0;
    var t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generaPercorso(level) {
  var cfg = config(level);
  var rng = creaRng(0x5EED0000 + level * 7919);
  function rf(a, b) { return a + rng() * (b - a); }

  /* Punti di controllo: una passeggiata con inerzia di curvatura. Il tratto
     nuovo deve stare lontano da tutto il resto del percorso, altrimenti due
     pezzi di strada si sovrappongono e il gioco non sa più dove sei. Se non
     c'è verso, si torna indietro di un passo e si riprova. */
  var pti = [{ x: 0, y: 0 }];
  var dir = -Math.PI / 2, curva = 0;
  var distMin = cfg.larghezza * 2.4;
  var giri = 0;

  // spazio libero attorno a un punto: la distanza dal resto del percorso
  function spazio(p, esclusi) {
    var min = Infinity;
    for (var i = 0; i < pti.length - esclusi; i++) {
      var d = Math.hypot(pti[i].x - p.x, pti[i].y - p.y);
      if (d < min) min = d;
    }
    return min;
  }

  /* A ogni passo si guardano più direzioni e si scarta chi finirebbe addosso
     al percorso già fatto. Fra quelle buone, una volta su due si prende la più
     larga: senza questa preferenza la passeggiata si chiude in una sacca e
     resta a tornare indietro, e i livelli alti uscivano corti della metà. */
  while (pti.length < cfg.tratti + 1 && giri++ < 3000) {
    var u = pti[pti.length - 1];
    var buone = [];
    for (var t = 0; t < 9; t++) {
      var delta = t === 0
        ? curva * 0.6 + rf(-cfg.sterzata, cfg.sterzata) * 0.5
        : rf(-cfg.sterzata, cfg.sterzata);
      var d2 = dir + delta;
      var p = { x: u.x + Math.cos(d2) * PASSO_TRACCIATO, y: u.y + Math.sin(d2) * PASSO_TRACCIATO };
      var sp = spazio(p, 2);
      if (sp >= distMin) buone.push({ p: p, dir: d2, delta: delta, sp: sp });
    }
    if (buone.length) {
      var scelta;
      if (rng() < 0.5) {
        scelta = buone[0];
        for (var b = 1; b < buone.length; b++) if (buone[b].sp > scelta.sp) scelta = buone[b];
      } else {
        scelta = buone[Math.floor(rng() * buone.length)];
      }
      pti.push(scelta.p); dir = scelta.dir; curva = scelta.delta;
    } else if (pti.length > 2) {          // vicolo cieco: si torna indietro
      pti.pop();
      var a = pti[pti.length - 1], c0 = pti[pti.length - 2];
      dir = Math.atan2(a.y - c0.y, a.x - c0.x);
      curva = 0;
    }
  }

  /* Catmull-Rom: dai punti di controllo a una linea morbida, campionata fitta.
     È la linea di mezzeria; la strada è una striscia attorno. */
  var linea = [];
  for (var i = 0; i < pti.length - 1; i++) {
    var p0 = pti[Math.max(0, i - 1)], p1 = pti[i], p2 = pti[i + 1], p3 = pti[Math.min(pti.length - 1, i + 2)];
    for (var k = 0; k < SUDDIVISIONI; k++) {
      var s = k / SUDDIVISIONI, s2 = s * s, s3 = s2 * s;
      linea.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3)
      });
    }
  }
  linea.push({ x: pti[pti.length - 1].x, y: pti[pti.length - 1].y });

  var lunghezza = 0;
  for (i = 1; i < linea.length; i++) lunghezza += Math.hypot(linea[i].x - linea[i - 1].x, linea[i].y - linea[i - 1].y);

  // porte: una ogni tanto, e l'ultima è l'arrivo
  var porte = [];
  for (i = PORTA_OGNI; i < linea.length - PORTA_OGNI / 2; i += PORTA_OGNI) porte.push(i);
  porte.push(linea.length - 3);

  /* Alberi a bordo strada: mai sull'asfalto, mai uno sopra l'altro, e mai
     vicino al via. Servono a due cose: a far sentire la velocità (un prato
     vuoto non scorre) e a punire chi taglia le curve con troppa fiducia. */
  var alberi = [];
  var meta = cfg.larghezza / 2;
  function liberoDaStrada(x, y, r) {
    for (var j = 0; j < linea.length; j++) {
      if (Math.hypot(linea[j].x - x, linea[j].y - y) < meta + r + 6) return false;
    }
    return true;
  }
  var quanti = Math.round(cfg.alberi * cfg.tratti);
  for (var n = 0; n < quanti * 4 && alberi.length < quanti; n++) {
    var idx = Math.floor(rf(8, linea.length - 2));
    var a1 = linea[idx], b1 = linea[idx + 1];
    var tx = b1.x - a1.x, ty = b1.y - a1.y, tl = Math.hypot(tx, ty) || 1;
    var lato = rng() < 0.5 ? -1 : 1;
    // mai a filo dell'asfalto: un albero a un passo dal bordo punisce anche
    // una ruota sull'erba, e non è quello il patto — l'erba frena, l'albero ferma
    var dist = meta + 28 + rf(0, 120);
    var r = rf(9, 15);
    var ax = a1.x + (-ty / tl) * lato * dist, ay = a1.y + (tx / tl) * lato * dist;
    if (!liberoDaStrada(ax, ay, r)) continue;
    var sovrapposto = false;
    for (var m = 0; m < alberi.length; m++) {
      if (Math.hypot(alberi[m].x - ax, alberi[m].y - ay) < alberi[m].r + r + 6) { sovrapposto = true; break; }
    }
    if (sovrapposto) continue;
    alberi.push({ x: ax, y: ay, r: r, tono: rng() });
  }

  /* Il tempo massimo non viene dalla lunghezza ma da un giro ideale: quanto
     ci metterebbe un'auto che frena il giusto prima di ogni curva. Dividere
     la lunghezza per una velocità media premiava i percorsi dritti e
     condannava quelli tortuosi — allo stesso livello un tracciato si vinceva
     con dieci secondi di margine e quello dopo era impossibile. Così invece
     il margine è una scelta di livello, e il tracciato può essere quello che
     è. */
  var tempoIdeale = stimaTempo(linea);
  var tempoMax = Math.round(tempoIdeale * cfg.margine + 1);

  return {
    cfg: cfg, linea: linea, porte: porte, alberi: alberi,
    lunghezza: lunghezza, tempoIdeale: tempoIdeale, tempoMax: tempoMax, larghezza: cfg.larghezza
  };
}

/* Profilo di velocità lungo la mezzeria: in ogni punto la velocità che la
   curva permette, poi due passate — avanti per l'accelerazione, indietro per
   la frenata — così non si chiede all'auto di fermarsi in un metro. Il tempo
   è la somma dei tratti divisi per la velocità. Le stesse regole le usa il
   pilota simulato di test/balance.js: è il modo per essere sicuri che il
   tempo richiesto sia raggiungibile e non solo scritto. */
function stimaTempo(linea) {
  var n = linea.length, i;
  var ds = [], v = [];
  for (i = 0; i < n - 1; i++) ds.push(Math.hypot(linea[i + 1].x - linea[i].x, linea[i + 1].y - linea[i].y));
  for (i = 0; i < n; i++) {
    var j1 = Math.min(n - 2, i), j2 = Math.min(n - 2, i + 30);
    var t1 = Math.atan2(linea[j1 + 1].y - linea[j1].y, linea[j1 + 1].x - linea[j1].x);
    var t2 = Math.atan2(linea[j2 + 1].y - linea[j2].y, linea[j2 + 1].x - linea[j2].x);
    var curva = Math.abs(t2 - t1);
    if (curva > Math.PI) curva = 2 * Math.PI - curva;
    v.push(Math.max(70, Math.min(VEL_MAX, VEL_MAX * (1.2 - curva * 1.3))));
  }
  v[0] = 0;
  for (i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * ACCEL * 0.8 * ds[i - 1]));
  for (i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * FRENO * 0.8 * ds[i]));
  var t = 0;
  for (i = 0; i < n - 1; i++) t += ds[i] / Math.max(20, (v[i] + v[i + 1]) / 2);
  return t;
}

TG.registry.register({
  id: 'rally',
  title: 'Rally',
  icon: '🏁',
  tagline: 'Prove speciali contro il cronometro. L\'erba non perdona.',
  scoreLabel: 'Punti',
  controls: 'guida',
  viewport: { w: 360, h: 480 },
  howto: '<b>Comandi:</b> il <b>volante</b> si gira prendendolo dal pomello — ' +
    'mezzo giro è mezza sterzata, lasciato torna dritto — <b>GAS</b> accelera, ' +
    '<b>FRENO</b> frena (e da fermo fa retromarcia); da tastiera frecce o WASD. ' +
    'L\'auto sta in basso e punta sempre in alto: quello che vedi davanti è la ' +
    'strada che arriva. ' +
    '<b>Si vince arrivando prima che scada il tempo</b>: la barra in alto è il ' +
    'cronometro. Il percorso è una striscia d\'asfalto in un prato — <b>fuori ' +
    'strada si striscia</b> e le gomme non tengono, quindi tagliare una curva ' +
    'costa più che farla. Le <b>porte</b> bianche vanno passate tutte, in ' +
    'ordine: se ne salti una la freccia ti rimanda indietro. L\'auto scivola: ' +
    'frena <i>prima</i> della curva, accelera <i>in uscita</i>. Gli alberi ' +
    'sono duri. <b>Il colore dell\'auto</b> lo scegli durante il conto alla ' +
    'rovescia: un giro di volante, i tasti 1-9 o un tocco sul colore. Resta salvato. ' +
    'Ogni prova speciale è sempre la stessa: imparala.',

  levelInfo: function (level) {
    var p = generaPercorso(level);
    return 'Prova speciale ' + level + ': ' + Math.round(p.lunghezza / 10) / 10 + ' m di strada, ' +
      p.porte.length + ' porte, tempo massimo ' + p.tempoMax + 's' +
      ' (media richiesta ' + Math.round(p.lunghezza / p.tempoMax * 0.6) + ' km/h)';
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var store = (typeof TG !== 'undefined' && TG.storage) ? TG.storage : null;

    var cfg, percorso, linea, meta;
    var auto, stato, conto, tempo, prossimaPorta, vicino, controlloGlobale;
    var acc, finito, strisce, scossa, note, fuoriStrada, urti, colore, ultimoBeep;
    var contatto, volanteScattato;
    var cam;

    function leggiColore() {
      var v = store ? store.get(CHIAVE_COLORE, 0) : 0;
      v = parseInt(v, 10);
      return (v >= 0 && v < COLORI.length) ? v : 0;
    }
    function scegliColore(i) {
      colore = ((i % COLORI.length) + COLORI.length) % COLORI.length;
      if (store) store.set(CHIAVE_COLORE, colore);
      api.sfx.click();
    }

    /* ---------- partita ---------- */

    function start(level) {
      cfg = config(level);
      percorso = generaPercorso(level);
      linea = percorso.linea;
      meta = percorso.larghezza / 2;
      var a = linea[3], b = linea[4];
      auto = {
        x: a.x, y: a.y, h: Math.atan2(b.y - a.y, b.x - a.x),
        vx: 0, vy: 0, sterzo: 0, gas: 0, freno: false, velocita: 0, laterale: 0, inStrada: true
      };
      cam = { x: auto.x, y: auto.y, ang: auto.h };
      stato = 'conto';
      conto = CONTO;
      ultimoBeep = 4;
      tempo = percorso.tempoMax;
      prossimaPorta = 0;
      vicino = 3;
      controlloGlobale = 0;
      acc = 0; finito = false; scossa = 0;
      strisce = []; note = []; fuoriStrada = 0; urti = 0; contatto = false; volanteScattato = false;
      colore = leggiColore();
    }

    /* ---------- percorso: dove sono ---------- */

    /* Il campione di mezzeria più vicino. Si cerca attorno all'ultimo trovato,
       perché l'auto non salta; e ogni mezzo secondo su tutta la linea, per non
       restare agganciati a un pezzo di strada sbagliato dopo un taglio. */
    function aggiornaVicino(dt) {
      controlloGlobale -= dt;
      var da = vicino - 25, a = vicino + 45;
      if (controlloGlobale <= 0) { da = 0; a = linea.length - 1; controlloGlobale = 0.5; }
      da = Math.max(0, da); a = Math.min(linea.length - 1, a);
      var best = vicino, bd = Infinity;
      for (var i = da; i <= a; i++) {
        var d = Math.hypot(linea[i].x - auto.x, linea[i].y - auto.y);
        if (d < bd) { bd = d; best = i; }
      }
      vicino = best;
      return bd;
    }

    /* ---------- fisica ---------- */

    function passo(dt) {
      var sinistra = api.input.isDown('left'), destra = api.input.isDown('right');
      var gas = api.input.isDown('up'), freno = api.input.isDown('down');

      if (stato === 'conto') {
        /* Durante il conto alla rovescia ◀ ▶ scelgono il colore: l'auto è ferma
           e lo sterzo non serve a niente. Anche i numeri e un tocco sui colori. */
        var az, tap, cifra;
        while ((az = api.input.take())) {
          if (az === 'left') scegliColore(colore - 1);
          else if (az === 'right') scegliColore(colore + 1);
        }
        // anche il volante: girato oltre metà corsa cambia colore, una volta per giro
        var vc = api.input.volante;
        if (vc && vc.attivo && Math.abs(vc.valore) > 0.5 && !volanteScattato) {
          scegliColore(colore + (vc.valore > 0 ? 1 : -1));
          volanteScattato = true;
        }
        if (!vc || !vc.attivo || Math.abs(vc.valore) < 0.2) volanteScattato = false;
        while ((cifra = api.input.takeDigit())) { if (cifra <= COLORI.length) scegliColore(cifra - 1); }
        while ((tap = api.input.takeTap())) {
          var k = indiceColoreA(tap.x, tap.y);
          if (k >= 0) scegliColore(k);
        }
        conto -= dt;
        var sec = Math.ceil(conto);
        if (sec < ultimoBeep && sec >= 1) { ultimoBeep = sec; api.sfx.tone(440, 0.12, 'square', 0.1); }
        if (conto <= 0) {
          stato = 'corsa';
          api.sfx.tone(880, 0.35, 'square', 0.12);
          nota('VIA!', '#4ade80');
        }
        auto.gas = gas ? 0.7 : 0;      // si può sgasare da fermi: il motore lo dice
        audio(gas ? 0.75 : 0.12, auto.gas, 0);
        return;
      }

      while (api.input.take()) { /* in corsa contano solo i tasti tenuti premuti */ }
      while (api.input.takeTap()) { /* e i tocchi sul campo non fanno niente */ }
      while (api.input.takeDigit()) { /* nemmeno i numeri */ }

      /* Sterzo: dal volante a schermo è analogico — mezzo volante è mezza
         sterzata — e si segue subito; dai tasti è tutto o niente, e si ammorbidisce
         perché uno scatto secco a 300 px/s manderebbe l'auto di traverso. */
      var vol = api.input.volante;
      var bersaglioSterzo = (vol && vol.attivo) ? vol.valore : (sinistra ? -1 : 0) + (destra ? 1 : 0);
      auto.sterzo += (bersaglioSterzo - auto.sterzo) * Math.min(1, ((vol && vol.attivo) ? 18 : 10) * dt);

      var distanza = aggiornaVicino(dt);
      var inStrada = distanza <= meta + 3;
      auto.inStrada = inStrada;
      if (!inStrada) fuoriStrada += dt;

      /* Componenti della velocità nel riferimento dell'auto: avanti e di lato.
         Lo sterzo gira il muso; la velocità resta dov'era e la sua parte
         laterale si spegne con l'aderenza. È tutta qui la derapata. */
      var avanti = auto.vx * Math.cos(auto.h) + auto.vy * Math.sin(auto.h);
      var rapporto = Math.min(1, Math.abs(avanti) / VEL_MAX);
      // lo sterzo prende con la velocità e si ammorbidisce a fondo corsa
      var presa = Math.min(1, Math.abs(avanti) / 80) * (1 - 0.3 * rapporto) * (inStrada ? 1 : 0.75);
      auto.h += auto.sterzo * STERZO * presa * dt * (avanti < 0 ? -1 : 1);

      var c = Math.cos(auto.h), s = Math.sin(auto.h);
      avanti = auto.vx * c + auto.vy * s;
      var lato = -auto.vx * s + auto.vy * c;

      // pedali
      if (gas && avanti >= -1) avanti += ACCEL * dt;
      else if (gas) avanti = Math.min(0, avanti + FRENO * dt);        // in retro il gas frena
      if (freno) {
        if (avanti > 6) avanti = Math.max(0, avanti - FRENO * dt);
        else avanti = Math.max(-RETRO_MAX, avanti - 110 * dt);       // retromarcia
      }
      if (!gas && !freno) {
        var segno = avanti > 0 ? 1 : -1;
        avanti = Math.abs(avanti) < ATTRITO * dt ? 0 : avanti - segno * ATTRITO * dt;
      }
      // resistenza: cresce col quadrato, così a gas aperto si ferma a VEL_MAX
      avanti -= avanti * Math.abs(avanti) / (VEL_MAX * VEL_MAX) * ACCEL * dt;
      if (!inStrada) avanti -= avanti * Math.abs(avanti) / (ERBA_VEL * ERBA_VEL) * ACCEL * dt;

      // aderenza laterale
      var grip = inStrada ? GRIP_STRADA * (1 - 0.35 * rapporto) : GRIP_ERBA;
      lato *= Math.exp(-grip * dt);

      auto.vx = c * avanti - s * lato;
      auto.vy = s * avanti + c * lato;
      auto.x += auto.vx * dt;
      auto.y += auto.vy * dt;
      auto.velocita = avanti;
      auto.laterale = lato;
      auto.freno = freno;
      auto.gas += ((gas ? 1 : 0) - auto.gas) * Math.min(1, 8 * dt);

      // strisce di gomma: quando si scivola o si frena forte sull'asfalto
      var slitta = Math.min(1, Math.abs(lato) / 90);
      if (inStrada && (slitta > 0.35 || (freno && avanti > 130))) {
        for (var w = -1; w <= 1; w += 2) {
          var rx = auto.x - c * AUTO_L * 0.35 - s * w * AUTO_W * 0.4;
          var ry = auto.y - s * AUTO_L * 0.35 + c * w * AUTO_W * 0.4;
          strisce.push({ x: rx, y: ry, x2: rx - auto.vx * dt, y2: ry - auto.vy * dt });
        }
        if (strisce.length > 700) strisce.splice(0, 2);
      }

      urtaAlberi();

      // porte: si passa quella giusta, nel suo intorno, con l'auto sulla strada
      if (prossimaPorta < percorso.porte.length) {
        var g = percorso.porte[prossimaPorta];
        if (vicino >= g && vicino <= g + 8 && distanza <= meta + 14) {
          prossimaPorta++;
          api.addScore(cfg.puntiPorta);
          if (prossimaPorta === percorso.porte.length) {
            arrivo();
            return;
          }
          api.sfx.tone(988, 0.08, 'square', 0.08, 1320);
          nota('porta ' + prossimaPorta + '/' + percorso.porte.length, '#e6edf3');
        }
      }

      tempo -= dt;
      if (tempo <= 0) {
        tempo = 0;
        finito = true;
        api.gameOver({
          message: 'Tempo scaduto a ' + (percorso.porte.length - prossimaPorta) +
            ' porte dall\'arrivo, con ' + Math.round(fuoriStrada) + 's passati sull\'erba.'
        });
        return;
      }

      // motore: le marce sono finte ma si sentono — i giri salgono e ricadono
      var marce = [0, 0.2, 0.42, 0.68, 1.01];
      var giri = 0.3;
      for (var mi = 0; mi < marce.length - 1; mi++) {
        if (rapporto >= marce[mi] && rapporto < marce[mi + 1]) {
          giri = 0.3 + 0.7 * (rapporto - marce[mi]) / (marce[mi + 1] - marce[mi]);
        }
      }
      if (avanti < 0) giri = 0.35;
      var rumoreGomme = slitta * (inStrada ? 1 : 0.5) +
        (!inStrada && Math.abs(avanti) > 50 ? 0.4 : 0) +
        (freno && avanti > 120 && inStrada ? 0.45 : 0);
      audio(giri, auto.gas, rumoreGomme);
      if (scossa > 0) scossa -= dt;
    }

    function arrivo() {
      finito = true;
      var resto = Math.max(0, tempo);
      var bonus = cfg.bonusArrivo + Math.round(resto) * 4 * cfg.level;
      api.sfx.tone(660, 0.12, 'square', 0.1, 990);
      api.levelComplete({
        bonus: bonus,
        message: 'Arrivo con ' + resto.toFixed(1) + 's di margine su ' + percorso.tempoMax + 's' +
          (urti ? ', ' + urti + (urti === 1 ? ' albero preso' : ' alberi presi') : ', senza toccare niente') + '.'
      });
    }

    function urtaAlberi() {
      var al = percorso.alberi;
      var colpito = false;
      for (var i = 0; i < al.length; i++) {
        var t = al[i];
        var dx = auto.x - t.x, dy = auto.y - t.y;
        var d = Math.hypot(dx, dy);
        var min = AUTO_R + t.r;
        if (d >= min || d === 0) continue;
        var nx = dx / d, ny = dy / d;
        auto.x = t.x + nx * min;
        auto.y = t.y + ny * min;
        var vn = auto.vx * nx + auto.vy * ny;
        if (vn < 0) {
          var forza = Math.min(1, -vn / 220);
          auto.vx -= 1.4 * vn * nx;
          auto.vy -= 1.4 * vn * ny;
          auto.vx *= 0.5; auto.vy *= 0.5;
          colpito = true;
          // un urto è un urto, non un fotogramma: si conta quando si entra in
          // contatto, e strusciare o restare incastrati fra due tronchi non
          // fa salire il numero
          if (!contatto) {
            urti++;
            scossa = 0.25 * forza + 0.08;
            api.sfx.tone(90 + forza * 40, 0.16, 'sawtooth', 0.06 + forza * 0.08, 40);
          }
        }
      }
      contatto = colpito;
    }

    function audio(giri, gas, slitta) {
      if (api.sfx.motoreImposta) api.sfx.motoreImposta(giri, gas, slitta);
    }

    function nota(testo, tinta) {
      note.push({ testo: testo, t: 1.1, tinta: tinta });
    }

    /* Passo fisso: la fisica non deve dipendere dal monitor, e con un dt lungo
       (telefono che arranca) l'auto entrerebbe negli alberi. */
    function update(dt) {
      if (finito) return;
      acc += dt;
      var giri = 0;
      while (acc >= PASSO && giri < 5 && !finito) { passo(PASSO); acc -= PASSO; giri++; }
      if (giri >= 5) acc = 0;
      for (var i = note.length - 1; i >= 0; i--) { note[i].t -= dt; if (note[i].t <= 0) note.splice(i, 1); }
    }

    function destroy() {
      if (api.sfx.motoreFerma) api.sfx.motoreFerma();
    }

    /* ---------- disegno ---------- */

    var SWATCH = 30, SWATCH_GAP = 6;
    var AUTO_Y = 0.72;          // dove sta l'auto sullo schermo: in basso, si guarda avanti
    function posizioneColore(i) {
      var tot = COLORI.length * SWATCH + (COLORI.length - 1) * SWATCH_GAP;
      return { x: (W - tot) / 2 + i * (SWATCH + SWATCH_GAP), y: H * 0.23, w: SWATCH, h: SWATCH };
    }

    /* Da coordinate del mondo a coordinate dello schermo, con la camera
       corrente: serve a chi disegna sopra la scena (frecce, avvisi). */
    function aSchermo(x, y) {
      var th = -(cam.ang + Math.PI / 2), c = Math.cos(th), sn = Math.sin(th);
      var dx = x - cam.x, dy = y - cam.y;
      return { x: W / 2 + dx * c - dy * sn, y: H * AUTO_Y + dx * sn + dy * c };
    }
    function indiceColoreA(x, y) {
      for (var i = 0; i < COLORI.length; i++) {
        var p = posizioneColore(i);
        if (x >= p.x - 4 && x <= p.x + p.w + 4 && y >= p.y - 8 && y <= p.y + p.h + 8) return i;
      }
      return -1;
    }

    function hash(a, b) {
      var h = (a * 374761393 + b * 668265263) | 0;
      h = (h ^ (h >> 13)) * 1274126177 | 0;
      return ((h ^ (h >> 16)) >>> 0) / 4294967296;
    }

    function draw(ctx) {
      /* La camera è agganciata al muso: l'auto sta in basso e punta sempre in
         alto, il mondo ruota attorno. Con la camera fissa a nord l'auto stava
         al centro e andando verso il basso si vedeva solo la strada già fatta —
         e in un rally quello che serve è la curva che arriva. La rotazione è
         smorzata, così nelle curve il mondo gira un attimo dopo il muso e si
         sente la sterzata. */
      var mx = auto.x + Math.cos(auto.h) * 30, my = auto.y + Math.sin(auto.h) * 30;
      cam.x += (mx - cam.x) * 0.15;
      cam.y += (my - cam.y) * 0.15;
      var dAng = auto.h - cam.ang;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      cam.ang += dAng * 0.12;

      ctx.fillStyle = '#1f3d28';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      var sx = 0, sy = 0;
      if (scossa > 0) { sx = (Math.random() - 0.5) * scossa * 30; sy = (Math.random() - 0.5) * scossa * 30; }
      ctx.translate(W / 2 + sx, H * AUTO_Y + sy);
      ctx.rotate(-(cam.ang + Math.PI / 2));
      ctx.translate(-cam.x, -cam.y);

      // prato, con macchie che lo fanno scorrere: il mondo ruota, quindi il
      // riquadro da coprire è il cerchio che contiene lo schermo
      var R = Math.hypot(W, H) * 0.75;
      var T = 56;
      var x0 = Math.floor((cam.x - R) / T), x1 = Math.floor((cam.x + R) / T);
      var y0 = Math.floor((cam.y - R) / T), y1 = Math.floor((cam.y + R) / T);
      ctx.fillStyle = '#1a3423';
      for (var tx = x0; tx <= x1; tx++) {
        for (var ty = y0; ty <= y1; ty++) {
          var r1 = hash(tx, ty), r2 = hash(ty, tx + 7);
          ctx.beginPath();
          ctx.arc(tx * T + r1 * T, ty * T + r2 * T, 5 + r1 * 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // strada: bordo di ghiaia e asfalto sopra, solo il pezzo in vista
      var da = Math.max(0, vicino - 90), a = Math.min(linea.length - 1, vicino + 90);
      var i;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(linea[da].x, linea[da].y);
      for (i = da + 1; i <= a; i++) ctx.lineTo(linea[i].x, linea[i].y);
      ctx.strokeStyle = '#6b6a4e'; ctx.lineWidth = percorso.larghezza + 10; ctx.stroke();
      ctx.strokeStyle = '#3e4553'; ctx.lineWidth = percorso.larghezza; ctx.stroke();

      // strisce di gomma
      ctx.strokeStyle = 'rgba(15,15,18,0.4)'; ctx.lineWidth = 3; ctx.lineCap = 'butt';
      ctx.beginPath();
      for (i = 0; i < strisce.length; i++) {
        var st = strisce[i];
        if (Math.abs(st.x - cam.x) > R || Math.abs(st.y - cam.y) > R) continue;
        ctx.moveTo(st.x, st.y); ctx.lineTo(st.x2, st.y2);
      }
      ctx.stroke();

      // porte: una riga bianca; l'arrivo a scacchi; la prossima è più viva
      for (i = 0; i < percorso.porte.length; i++) {
        var g = percorso.porte[i];
        if (g < da || g > a) continue;
        var p1 = linea[g], p2 = linea[Math.min(linea.length - 1, g + 1)];
        var dx = p2.x - p1.x, dy = p2.y - p1.y, dl = Math.hypot(dx, dy) || 1;
        var nx = -dy / dl * meta, ny = dx / dl * meta;
        var ultima = i === percorso.porte.length - 1;
        if (ultima) {
          ctx.save();
          ctx.translate(p1.x, p1.y);
          ctx.rotate(Math.atan2(dy, dx));
          for (var q = 0; q < 2; q++) {
            for (var kq = 0; kq < 8; kq++) {
              ctx.fillStyle = (q + kq) % 2 ? '#f1f5f9' : '#111827';
              ctx.fillRect(q * 6 - 6, -meta + kq * (meta * 2 / 8), 6, meta * 2 / 8);
            }
          }
          ctx.restore();
        } else {
          ctx.strokeStyle = i < prossimaPorta ? 'rgba(241,245,249,0.25)' : (i === prossimaPorta ? '#f8fafc' : 'rgba(241,245,249,0.6)');
          ctx.lineWidth = i === prossimaPorta ? 4 : 2;
          ctx.beginPath(); ctx.moveTo(p1.x - nx, p1.y - ny); ctx.lineTo(p1.x + nx, p1.y + ny); ctx.stroke();
        }
      }

      // alberi
      var al = percorso.alberi;
      for (i = 0; i < al.length; i++) {
        var t = al[i];
        if (Math.abs(t.x - cam.x) > R || Math.abs(t.y - cam.y) > R) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.arc(t.x + 4, t.y + 5, t.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.tono < 0.5 ? '#2d6a3e' : '#35804a';
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45, 0, Math.PI * 2); ctx.fill();
      }

      disegnaAuto(ctx);
      ctx.restore();

      disegnaHud(ctx);
      if (stato === 'conto') disegnaConto(ctx);
    }

    function disegnaAuto(ctx) {
      ctx.save();
      ctx.translate(auto.x, auto.y);
      ctx.rotate(auto.h);
      // ombra
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      api.util.roundRect(ctx, -AUTO_L / 2 + 2, -AUTO_W / 2 + 3, AUTO_L, AUTO_W, 3); ctx.fill();
      // gomme: le anteriori girano con lo sterzo
      ctx.fillStyle = '#0f172a';
      for (var w = -1; w <= 1; w += 2) {
        ctx.fillRect(-AUTO_L / 2 + 2, w * AUTO_W / 2 - 2, 6, 4);
        ctx.save();
        ctx.translate(AUTO_L / 2 - 5, w * AUTO_W / 2);
        ctx.rotate(auto.sterzo * 0.45);
        ctx.fillRect(-3, -2, 6, 4);
        ctx.restore();
      }
      // carrozzeria
      var tinta = COLORI[colore].tinta;
      ctx.fillStyle = tinta;
      api.util.roundRect(ctx, -AUTO_L / 2, -AUTO_W / 2 + 1, AUTO_L, AUTO_W - 2, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      api.util.roundRect(ctx, -AUTO_L / 2 + 5, -AUTO_W / 2 + 3, AUTO_L - 12, AUTO_W - 6, 2); ctx.fill();
      // parabrezza e lunotto
      ctx.fillStyle = '#bae6fd';
      ctx.fillRect(AUTO_L / 2 - 9, -AUTO_W / 2 + 3, 3, AUTO_W - 6);
      ctx.fillStyle = 'rgba(186,230,253,0.6)';
      ctx.fillRect(-AUTO_L / 2 + 5, -AUTO_W / 2 + 3, 2, AUTO_W - 6);
      // fari e stop
      ctx.fillStyle = '#fef9c3';
      ctx.fillRect(AUTO_L / 2 - 1, -AUTO_W / 2 + 2, 2, 3);
      ctx.fillRect(AUTO_L / 2 - 1, AUTO_W / 2 - 5, 2, 3);
      ctx.fillStyle = auto.freno ? '#ff3b3b' : '#7f1d1d';
      ctx.fillRect(-AUTO_L / 2 - 1, -AUTO_W / 2 + 2, 2, 3);
      ctx.fillRect(-AUTO_L / 2 - 1, AUTO_W / 2 - 5, 2, 3);
      ctx.restore();
    }

    function disegnaHud(ctx) {
      // fascia in alto: cronometro, velocità, porte
      ctx.fillStyle = 'rgba(5,7,12,0.55)';
      ctx.fillRect(0, 0, W, 50);
      var frazione = api.util.clamp(tempo / percorso.tempoMax, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(10, 42, W - 20, 4);
      ctx.fillStyle = frazione < 0.2 ? '#f87171' : '#38bdf8';
      ctx.fillRect(10, 42, (W - 20) * frazione, 4);

      ctx.font = 'bold 22px ' + 'ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = tempo < 10 && stato === 'corsa' ? '#f87171' : '#e6edf3';
      ctx.fillText(tempo.toFixed(1) + 's', 10, 28);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText('max ' + percorso.tempoMax + 's', 10, 39);

      ctx.textAlign = 'center';
      ctx.font = 'bold 16px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = auto.inStrada ? '#e6edf3' : '#fbbf24';
      ctx.fillText(Math.round(Math.abs(auto.velocita) * 0.6) + ' km/h', W / 2, 24);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.7)';
      ctx.fillText(auto.inStrada ? 'asfalto' : 'ERBA', W / 2, 38);

      ctx.textAlign = 'right';
      ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#e6edf3';
      ctx.fillText('porte ' + prossimaPorta + '/' + percorso.porte.length, W - 10, 22);

      disegnaMappa(ctx);
      disegnaFreccia(ctx);

      // avvisi
      ctx.textAlign = 'center';
      for (var i = 0; i < note.length; i++) {
        var n = note[i];
        ctx.globalAlpha = Math.min(1, n.t);
        ctx.font = 'bold ' + (n.testo === 'VIA!' ? 42 : 18) + 'px system-ui, sans-serif';
        ctx.fillStyle = n.tinta;
        ctx.fillText(n.testo, W / 2, H * 0.5 - (1.1 - n.t) * 20);
      }
      ctx.globalAlpha = 1;
    }

    /* La mappina: tutto il percorso in un riquadro, con l'auto, la porta da
       prendere e l'arrivo. È l'unica cosa che un pilota di rally ha davvero —
       le note del navigatore — e qui ne fa le veci. */
    function disegnaMappa(ctx) {
      var L = 78, m = 6, x0 = W - L - 8, y0 = 56;
      var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, i;
      for (i = 0; i < linea.length; i++) {
        minx = Math.min(minx, linea[i].x); maxx = Math.max(maxx, linea[i].x);
        miny = Math.min(miny, linea[i].y); maxy = Math.max(maxy, linea[i].y);
      }
      var sc = Math.min((L - m * 2) / Math.max(1, maxx - minx), (L - m * 2) / Math.max(1, maxy - miny));
      var cx = x0 + L / 2 - (minx + maxx) / 2 * sc, cy = y0 + L / 2 - (miny + maxy) / 2 * sc;
      ctx.fillStyle = 'rgba(5,7,12,0.55)';
      api.util.roundRect(ctx, x0, y0, L, L, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(230,237,243,0.5)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (i = 0; i < linea.length; i += 3) {
        var px = cx + linea[i].x * sc, py = cy + linea[i].y * sc;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (prossimaPorta < percorso.porte.length) {
        var g = linea[percorso.porte[prossimaPorta]];
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(cx + g.x * sc, cy + g.y * sc, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      var fine = linea[linea.length - 3];
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(cx + fine.x * sc - 2, cy + fine.y * sc - 2, 4, 4);
      ctx.fillStyle = COLORI[colore].tinta;
      ctx.beginPath(); ctx.arc(cx + auto.x * sc, cy + auto.y * sc, 3, 0, Math.PI * 2); ctx.fill();
    }

    /* La freccia verso la prossima porta: sta attorno all'auto e si vede solo
       quando serve, cioè quando la porta è fuori dallo schermo o alle spalle. */
    function disegnaFreccia(ctx) {
      if (prossimaPorta >= percorso.porte.length || stato !== 'corsa') return;
      var g = linea[percorso.porte[prossimaPorta]];
      var dx = g.x - auto.x, dy = g.y - auto.y;
      var d = Math.hypot(dx, dy);
      var ps = aSchermo(g.x, g.y);
      var fuori = ps.x < 10 || ps.x > W - 10 || ps.y < 55 || ps.y > H - 10;
      var indietro = (dx * Math.cos(auto.h) + dy * Math.sin(auto.h)) < 0 && d > 60;
      if (!fuori && !indietro) return;
      var pa = aSchermo(auto.x, auto.y);
      var ang = Math.atan2(ps.y - pa.y, ps.x - pa.x);
      ctx.save();
      ctx.translate(pa.x, pa.y);
      ctx.rotate(ang);
      ctx.translate(34, 0);
      ctx.fillStyle = indietro ? '#f87171' : '#fbbf24';
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-2, 0); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function disegnaConto(ctx) {
      ctx.fillStyle = 'rgba(5,7,12,0.5)';
      api.util.roundRect(ctx, 10, 56, W - 20, H * 0.38 - 50, 10); ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.85)';
      ctx.fillText('Colore dell\'auto — volante, 1-9 o un tocco', W / 2, H * 0.17);
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
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = COLORI[colore].tinta;
      ctx.fillText(COLORI[colore].nome, W / 2, H * 0.23 + SWATCH + 22);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(230,237,243,0.75)';
      ctx.fillText('Al via: GAS e tieni la strada', W / 2, H * 0.23 + SWATCH + 42);

      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(String(Math.max(1, Math.ceil(conto))), W / 2, H * 0.56);
    }

    function state() {
      return {
        stato: stato,
        auto: { x: auto.x, y: auto.y, h: auto.h, vx: auto.vx, vy: auto.vy, velocita: auto.velocita, laterale: auto.laterale },
        inStrada: auto.inStrada,
        colore: colore,
        conto: Math.max(0, conto),
        tempo: Math.round(tempo * 10) / 10,
        tempoMax: percorso.tempoMax,
        tempoIdeale: Math.round(percorso.tempoIdeale * 10) / 10,
        lunghezza: Math.round(percorso.lunghezza),
        larghezza: percorso.larghezza,
        porte: percorso.porte,
        prossimaPorta: prossimaPorta,
        vicino: vicino,
        fuoriStrada: Math.round(fuoriStrada * 10) / 10,
        urti: urti,
        // il percorso e gli alberi si vedono tutti (mappina + campo): il bot
        // non sa niente di più di chi gioca. Sono riferimenti, non copie.
        linea: linea,
        alberi: percorso.alberi
      };
    }

    return { start: start, update: update, draw: draw, destroy: destroy, state: state };
  }
});

})();
