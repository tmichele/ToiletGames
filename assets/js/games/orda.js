/* Orda — sparatutto dall'alto dentro un labirinto.

   Il campo è un labirinto 2D visto dall'alto. I mostri stanno fermi finché non
   ti vedono: li vedi anche tu, immobili nei corridoi, e decidi se svegliarli.
   Chi si sveglia ti cerca davvero — segue i corridoi, non attraversa i muri —
   e dopo qualche secondo senza vederti torna a dormire.

   Da qui vengono le due decisioni di fondo:

   - il labirinto non è perfetto, ha degli anelli. In un labirinto senza anelli
     ogni corridoio finisce in un vicolo cieco, e con l'orda alle calcagna un
     vicolo cieco è una condanna senza scampo: si sfondano un po' di muri
     apposta, così si può girare in tondo;
   - c'è un tempo per il livello. Se i mostri dormono finché non li guardi,
     restare fermi sarebbe una strategia: il tempo che scorre dice che no.

   Anche sparare fa rumore, e il rumore sveglia. Il laser è silenzioso, i razzi
   svegliano mezzo quartiere: è la ragione per cui vale la pena avere armi
   diverse invece della più forte.

   Difficoltà: labirinto uguale, mostri più numerosi e più veloci, tipi nuovi
   che si aggiungono ai vecchi, meno tempo e un boss ogni cinque livelli. La
   velocità segue la regola della suite (`opponentSpeedRatio`).

   Il tempo avanza a passi fissi e il caso esce da un generatore con un seme:
   la partita dipende solo dal seme e dai comandi, quindi si può rigiocare
   identica. È la base del duello asincrono, se un giorno lo aggiungiamo. */
(function () {
'use strict';

var PASSO = 1 / 60;      // s: passo fisso di simulazione
var VITE = 3;
var VEL = 142;           // px/s del giocatore: il metro di tutto il resto
var RAGGIO = 8;
var TOP = 60;            // striscia dell'HUD, sopra il labirinto
var CELLA = 40;          // lato della cella
var MURO = 6;            // spessore dei muri: il corridoio libero è CELLA - MURO
var COLS = 9, RIGHE = 12;
var VICOLI_APERTI = 0.75;  // quota di vicoli ciechi sfondati: servono gli anelli

/* Le armi. La pistola non finisce mai: restare senza niente da sparare sarebbe
   una punizione senza rimedio, non una difficoltà. `rumore` è il raggio entro
   cui lo sparo sveglia i mostri, muri compresi — il suono passa.

   I caricatori sono corti apposta. Con la prima taratura (130 colpi di mitra)
   un'arma raccolta durava tutto il livello: su quattordici partite provate se
   n'è svuotata una, e «scegliere quando spendere le munizioni buone» era una
   frase, non una decisione. Dimezzati, l'arma è un vantaggio a tempo. */
var ARMI = {
  pistola: { nome: 'Pistola', cadenza: 0.42, danno: 1, colpi: Infinity, pallini: 1, spread: 0.03, vel: 330, rumore: 95, colore: '#e6edf3' },
  mitra:   { nome: 'Mitra',   cadenza: 0.09, danno: 1, colpi: 60, pallini: 1, spread: 0.13, vel: 400, rumore: 120, colore: '#fbbf24' },
  fucile:  { nome: 'Fucile',  cadenza: 0.60, danno: 1, colpi: 15,  pallini: 6, spread: 0.34, vel: 320, rumore: 150, colore: '#fb923c' },
  laser:   { nome: 'Laser',   cadenza: 0.40, danno: 2, colpi: 20,  pallini: 1, spread: 0,    vel: 620, rumore: 45,  colore: '#38bdf8', perfora: true },
  razzi:   { nome: 'Razzi',   cadenza: 0.85, danno: 3, colpi: 8,   pallini: 1, spread: 0.03, vel: 250, rumore: 210, colore: '#f43f5e', esplode: 42 }
};
// quello che può cadere: i doppioni sono il modo più semplice di pesare il caso
var CADUTE = ['mitra', 'mitra', 'fucile', 'fucile', 'laser', 'razzi'];

/* I mostri. `fattore` moltiplica la velocità di riferimento del livello, `vista`
   è quanto lontano ti notano (in linea d'aria e senza muri in mezzo), `da` è il
   livello dal quale compaiono: i tipi si aggiungono, non si sostituiscono.
   I raggi stanno tutti sotto il corridoio libero, altrimenti resterebbero
   incastrati fra due muri. */
var TIPI = {
  strisciante: { vita: 1, fattore: 0.72, r: 9,  vista: 165, valore: 1, da: 1, colore: '#84a63a' },
  scattante:   { vita: 1, fattore: 1.05, r: 7,  vista: 205, valore: 2, da: 2, colore: '#eab308', scatti: true },
  corazzato:   { vita: 4, fattore: 0.48, r: 12, vista: 140, valore: 4, da: 3, colore: '#94a3b8', duro: true },
  tiratore:    { vita: 2, fattore: 0.55, r: 9,  vista: 215, valore: 4, da: 4, colore: '#fb7185', spara: 1.8, distanza: 130 },
  gemello:     { vita: 2, fattore: 0.78, r: 11, vista: 175, valore: 5, da: 7, colore: '#a78bfa', divide: 2, duro: true },
  // il boss non entra nel sorteggio: arriva solo dove lo mette il livello
  boss:        { vita: 22, fattore: 0.50, r: 14, vista: 230, valore: 40, da: 99, colore: '#ef4444', spara: 0.85, distanza: 120, duro: true }
};

/* Quanti mostri in tutto: le ondate crescono di uno l'una dopo l'altra. */
function totaleMostri(level) {
  var ondate = Math.min(2 + Math.floor(level / 4), 3);
  var per = 4 + Math.round(level * 0.5);
  return ondate * per + ondate * (ondate + 1) / 2;
}

function config(level) {
  var tipi = Object.keys(TIPI).filter(function (k) { return TIPI[k].da <= level; });
  return {
    level: level,
    ondate: Math.min(2 + Math.floor(level / 4), 3),
    perOndata: 4 + Math.round(level * 0.5),
    velNemici: VEL * TG.util.opponentSpeedRatio(level),
    corazza: Math.floor((level - 1) / 4),        // vita in più ai mostri grossi
    /* Salendo di livello i mostri notano da più lontano: è la leva che fa
       crescere l'orda che ti sta addosso *insieme*, invece di allungare il
       livello aggiungendo mostri da cercare uno per uno. */
    vista: 1 + level * 0.055,
    vitaBoss: 22 + level * 2,
    /* Il tempo è la pressione del gioco: senza, con i mostri che dormono si
       potrebbe pulire il labirinto con tutta calma. Va commisurato a quanti
       mostri ci sono da trovare, non deciso a occhio: un livello con il doppio
       dei mostri e lo stesso tempo non è più difficile, è impossibile. */
    /* Il boss è una spugna: senza secondi in più il livello con il boss non è
       più difficile degli altri, è solo una corsa persa contro l'orologio. */
    tempo: Math.round(38 + 3.3 * totaleMostri(level)) + (level % 5 === 0 ? 25 : 0),
    dropChance: Math.min(0.26 + level * 0.006, 0.36),
    cuoreChance: Math.max(0.03, 0.10 - level * 0.006),
    boss: level % 5 === 0,
    punti: 5 * level,
    tipi: tipi
  };
}

TG.registry.register({
  id: 'orda',
  title: 'Orda',
  icon: '👾',
  tagline: 'Labirinto pieno di mostri: dormono finché non li guardi.',
  scoreLabel: 'Punti',
  controls: 'joystick',
  viewport: { w: COLS * CELLA, h: TOP + RIGHE * CELLA },
  howto: '<b>Comandi:</b> la leva (o frecce/WASD) per muoverti nel labirinto. ' +
    '<b>Si spara da soli</b>, sempre verso il mostro più vicino che hai in ' +
    'vista. I mostri <b>stanno fermi finché non ti vedono</b>: li riconosci ' +
    'perché sono spenti e a occhi chiusi. Una volta svegli ti inseguono per i ' +
    'corridoi, e tornano a dormire se ti perdono di vista. Anche <b>sparare fa ' +
    'rumore</b> e sveglia chi è vicino: il laser quasi niente, i razzi mezzo ' +
    'labirinto. Passa sopra le <b>casse</b> per cambiare arma e sui <b>cuori</b> ' +
    'per una vita. Il livello è superato quando il labirinto è ripulito, prima ' +
    'che scada il tempo. Ogni cinque livelli arriva un boss.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': ' + c.ondate + ' ondate in ' + c.tempo + 's, ' +
      'mostri al ' + Math.round(c.velNemici / VEL * 100) + '% della tua velocità' +
      (c.boss ? ', con boss finale' : '');
  },

  create: function (api) {
    var W = api.width, H = api.height;

    /* Generatore con seme: due partite con lo stesso seme e gli stessi comandi
       sono la stessa partita, labirinto compreso. È mulberry32. */
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
    function ri(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
    function rpick(arr) { return arr[Math.floor(rng() * arr.length)]; }

    var cfg, me, vite, arma, colpi, ricarica, angolo, timeLeft;
    var nord, ovest, campo;          // labirinto e mappa delle distanze
    var nemici, palle, palleNemiche, casse, avvisi, scoppi, note;
    var ondata, coda, attesaSpawn, pausaOndata, uccisi, acc, finito, scossa;
    var prossimoId, ricalcolo;

    /* ---------- labirinto ---------- */

    function cellaDi(x, y) {
      return {
        c: api.util.clamp(Math.floor(x / CELLA), 0, COLS - 1),
        r: api.util.clamp(Math.floor((y - TOP) / CELLA), 0, RIGHE - 1)
      };
    }
    function centro(r, c) {
      return { x: c * CELLA + CELLA / 2, y: TOP + r * CELLA + CELLA / 2 };
    }
    function dentroGriglia(r, c) { return r >= 0 && r < RIGHE && c >= 0 && c < COLS; }

    /* Muro fra la cella e il suo vicino, per direzione: 0 nord, 1 est, 2 sud,
       3 ovest. I muri stanno in due tabelle (nord e ovest), così ogni muro
       esiste una volta sola e non ci si ritrova con due verità sullo stesso
       tratto. */
    function chiuso(r, c, dir) {
      if (dir === 0) return nord[r][c];
      if (dir === 2) return nord[r + 1][c];
      if (dir === 3) return ovest[r][c];
      return ovest[r][c + 1];
    }
    function apri(r, c, dir) {
      if (dir === 0) nord[r][c] = false;
      else if (dir === 2) nord[r + 1][c] = false;
      else if (dir === 3) ovest[r][c] = false;
      else ovest[r][c + 1] = false;
    }
    var DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];

    function generaLabirinto() {
      var r, c;
      nord = []; ovest = [];
      for (r = 0; r <= RIGHE; r++) {
        nord.push([]);
        for (c = 0; c < COLS; c++) nord[r].push(true);
      }
      for (r = 0; r < RIGHE; r++) {
        ovest.push([]);
        for (c = 0; c <= COLS; c++) ovest[r].push(true);
      }

      // scavo all'indietro: labirinto perfetto, ogni cella raggiungibile
      var visto = [];
      for (r = 0; r < RIGHE; r++) { visto.push([]); for (c = 0; c < COLS; c++) visto[r].push(false); }
      var pila = [{ r: ri(0, RIGHE - 1), c: ri(0, COLS - 1) }];
      visto[pila[0].r][pila[0].c] = true;
      while (pila.length) {
        var cur = pila[pila.length - 1];
        var scelte = [];
        for (var d = 0; d < 4; d++) {
          var nr = cur.r + DR[d], nc = cur.c + DC[d];
          if (dentroGriglia(nr, nc) && !visto[nr][nc]) scelte.push(d);
        }
        if (!scelte.length) { pila.pop(); continue; }
        var dir = rpick(scelte);
        apri(cur.r, cur.c, dir);
        var pr = cur.r + DR[dir], pc = cur.c + DC[dir];
        visto[pr][pc] = true;
        pila.push({ r: pr, c: pc });
      }

      /* Sfondamento dei vicoli ciechi: un labirinto perfetto è una trappola
         quando qualcosa ti insegue, perché ogni fuga finisce contro un muro.
         Aprendo i vicoli si formano anelli e si può girare in tondo. */
      for (r = 0; r < RIGHE; r++) {
        for (c = 0; c < COLS; c++) {
          var aperte = [], chiuse = [];
          for (var k = 0; k < 4; k++) {
            var vr = r + DR[k], vc = c + DC[k];
            if (!dentroGriglia(vr, vc)) continue;
            (chiuso(r, c, k) ? chiuse : aperte).push(k);
          }
          if (aperte.length === 1 && chiuse.length && rng() < VICOLI_APERTI) {
            apri(r, c, rpick(chiuse));
          }
        }
      }
    }

    /* I muri come rettangoli, per le collisioni. Si guardano solo quelli
       attorno al punto: sono al massimo una dozzina, non tutta la griglia. */
    function muriVicini(x, y, out) {
      out.length = 0;
      var cel = cellaDi(x, y);
      for (var r = cel.r - 1; r <= cel.r + 2; r++) {
        for (var c = cel.c - 1; c <= cel.c + 2; c++) {
          if (c < 0 || c >= COLS || r < 0 || r > RIGHE) continue;
          if (nord[r][c]) {
            out.push({ x: c * CELLA - MURO / 2, y: TOP + r * CELLA - MURO / 2,
                       w: CELLA + MURO, h: MURO });
          }
        }
      }
      for (r = cel.r - 1; r <= cel.r + 1; r++) {
        for (c = cel.c - 1; c <= cel.c + 2; c++) {
          if (r < 0 || r >= RIGHE || c < 0 || c > COLS) continue;
          if (ovest[r][c]) {
            out.push({ x: c * CELLA - MURO / 2, y: TOP + r * CELLA - MURO / 2,
                       w: MURO, h: CELLA + MURO });
          }
        }
      }
      return out;
    }

    var bufferMuri = [];

    function dentroMuro(x, y) {
      if (x < 0 || x > W || y < TOP || y > H) return true;
      var muri = muriVicini(x, y, bufferMuri);
      for (var i = 0; i < muri.length; i++) {
        var m = muri[i];
        if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return true;
      }
      return false;
    }

    /* Sposta il cerchio fuori dai muri che sta toccando. Si risolve due volte:
       negli angoli un solo passaggio lascia il cerchio dentro l'altro muro. */
    function staccaDaiMuri(e, raggio) {
      for (var giro = 0; giro < 2; giro++) {
        var muri = muriVicini(e.x, e.y, bufferMuri);
        for (var i = 0; i < muri.length; i++) {
          var m = muri[i];
          var px = api.util.clamp(e.x, m.x, m.x + m.w);
          var py = api.util.clamp(e.y, m.y, m.y + m.h);
          var dx = e.x - px, dy = e.y - py;
          var d = Math.hypot(dx, dy);
          if (d >= raggio) continue;
          if (d < 0.0001) {                 // centro esattamente dentro il muro
            dx = e.x - (m.x + m.w / 2);
            dy = e.y - (m.y + m.h / 2);
            d = Math.hypot(dx, dy) || 1;
          }
          e.x += dx / d * (raggio - d);
          e.y += dy / d * (raggio - d);
        }
      }
      e.x = api.util.clamp(e.x, raggio, W - raggio);
      e.y = api.util.clamp(e.y, TOP + raggio, H - raggio);
    }

    /* Linea di vista: si campiona il segmento. Con corridoi da 34 px un passo
       da 4 px non lascia passare uno sguardo attraverso uno spigolo. */
    function liberoTra(x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      var d = Math.hypot(dx, dy);
      var passi = Math.ceil(d / 4);
      for (var i = 1; i < passi; i++) {
        if (dentroMuro(x1 + dx * i / passi, y1 + dy * i / passi)) return false;
      }
      return true;
    }

    /* Mappa delle distanze dal giocatore, in celle: i mostri svegli la
       scendono. Senza, inseguirebbero in linea d'aria e resterebbero appiccicati
       ai muri come mosche alla finestra. */
    function ricalcolaCampo() {
      var r, c;
      campo = [];
      for (r = 0; r < RIGHE; r++) {
        campo.push([]);
        for (c = 0; c < COLS; c++) campo[r].push(-1);
      }
      var pc = cellaDi(me.x, me.y);
      campo[pc.r][pc.c] = 0;
      var coda2 = [pc], testa = 0;
      while (testa < coda2.length) {
        var cur = coda2[testa++];
        for (var d = 0; d < 4; d++) {
          if (chiuso(cur.r, cur.c, d)) continue;
          var nr = cur.r + DR[d], nc = cur.c + DC[d];
          if (!dentroGriglia(nr, nc) || campo[nr][nc] >= 0) continue;
          campo[nr][nc] = campo[cur.r][cur.c] + 1;
          coda2.push({ r: nr, c: nc });
        }
      }
    }

    /* ---------- partita ---------- */

    function start(level) {
      cfg = config(level);
      rng = creaRng(seme + level * 7919);
      generaLabirinto();
      var partenza = centro(RIGHE - 1, Math.floor(COLS / 2));
      me = { x: partenza.x, y: partenza.y, invuln: 1.2 };
      if (vite == null) vite = VITE;      // le vite valgono per tutta la partita
      arma = 'pistola';
      colpi = Infinity;
      ricarica = 0;
      angolo = -Math.PI / 2;
      timeLeft = cfg.tempo;
      nemici = []; palle = []; palleNemiche = []; casse = [];
      avvisi = []; scoppi = []; note = [];
      ondata = 0; coda = []; attesaSpawn = 0; pausaOndata = 0.5;
      uccisi = 0; acc = 0; finito = false; scossa = 0; prossimoId = 1;
      ricalcolo = 0;
      ricalcolaCampo();
      /* Una cassa già in campo dal quarto livello: più avanti la sola pistola
         non tiene il passo, e cominciare disarmati non è una scelta difficile,
         è solo tempo perso ad aspettare la prima caduta. */
      if (level >= 4) {
        var p = centro(RIGHE - 1, Math.floor(COLS / 2) === 0 ? 1 : 0);
        casse.push(cassa(p.x, p.y, rpick(CADUTE)));
      }
    }

    /* ---------- ondate ---------- */

    function sceglieTipo() {
      /* Peso inverso al valore: gli striscianti sono la massa, i tipi nuovi
         sono la sorpresa. E il tipo nuovo entra piano, a un terzo del suo peso,
         arrivando pieno tre livelli dopo: un tipo che compare tutto insieme fa
         uno scalino nella difficoltà, e gli scalini si vedono in balance.js. */
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
      var quanti = cfg.perOndata + ondata;
      coda = [];
      if (cfg.boss && ondata === cfg.ondate) {
        coda.push('boss');
        quanti = Math.round(quanti / 2);
        // contro il boss serve qualcosa di meglio della pistola: una cassa
        // compare vicino a te quando arriva
        var vicina = cellaDi(me.x, me.y);
        var p = centro(vicina.r, vicina.c);
        casse.push(cassa(p.x, p.y, rpick(['laser', 'razzi', 'mitra'])));
      }
      for (var i = 0; i < quanti; i++) coda.push(sceglieTipo());
      attesaSpawn = 0;
    }

    /* Un mostro compare in una cella lontana e fuori dalla tua vista: comparire
       davanti al naso sarebbe un dado truccato, e comparire dove stai guardando
       toglierebbe il senso ai mostri che dormono. */
    function cellaLontana() {
      var migliori = [];
      for (var r = 0; r < RIGHE; r++) {
        for (var c = 0; c < COLS; c++) {
          if (campo[r][c] < 4) continue;
          var p = centro(r, c);
          if (Math.hypot(p.x - me.x, p.y - me.y) < 110) continue;
          if (liberoTra(p.x, p.y, me.x, me.y)) continue;   // te lo vedresti nascere
          migliori.push({ r: r, c: c });
        }
      }
      if (!migliori.length) {                 // labirinto piccolo o giocatore in mezzo
        for (r = 0; r < RIGHE; r++) {
          for (c = 0; c < COLS; c++) if (campo[r][c] >= 3) migliori.push({ r: r, c: c });
        }
      }
      if (!migliori.length) return { r: 0, c: 0 };
      return rpick(migliori);
    }

    function creaNemico(tipo, x, y) {
      var t = TIPI[tipo];
      var vita = tipo === 'boss' ? cfg.vitaBoss : t.vita + (t.duro ? cfg.corazza : 0);
      var n = {
        id: prossimoId++, tipo: tipo, x: x, y: y, r: t.r,
        vita: vita, vitaMax: vita,
        sveglio: false, allarme: 0, memoria: 0, controllo: rf(0, 0.12),
        ricarica: t.spara ? rf(0.3, t.spara) : 0,
        fase: rf(0.2, 0.6), attivo: true, flash: 0
      };
      staccaDaiMuri(n, n.r);
      nemici.push(n);
      return n;
    }

    function risveglia(n) {
      if (n.sveglio) { n.memoria = 4; return; }
      n.sveglio = true;
      n.memoria = 4;                 // secondi di caccia dopo averti perso
      n.allarme = 0.7;
      api.sfx.tone(220, 0.05, 'square', 0.03);
    }

    function svegliaVicini(x, y, raggio) {
      for (var i = 0; i < nemici.length; i++) {
        var n = nemici[i];
        if (n.sveglio) continue;
        // il rumore passa i muri: è suono, non vista
        if (Math.hypot(n.x - x, n.y - y) < raggio) risveglia(n);
      }
    }

    /* ---------- armi ---------- */

    function bersaglio() {
      /* Si spara a quello che si vede: sparare attraverso i muri sarebbe
         comodo e assurdo, e toglierebbe ogni valore agli angoli. */
      var best = null, bd = Infinity;
      for (var i = 0; i < nemici.length; i++) {
        var d = Math.hypot(nemici[i].x - me.x, nemici[i].y - me.y);
        if (d >= bd) continue;
        if (!liberoTra(me.x, me.y, nemici[i].x, nemici[i].y)) continue;
        bd = d; best = nemici[i];
      }
      return best;
    }

    function spara() {
      var a = ARMI[arma];
      for (var i = 0; i < a.pallini; i++) {
        var ang = angolo + (a.pallini > 1 ? (i / (a.pallini - 1) - 0.5) * a.spread * 2 : 0) +
          (rng() * 2 - 1) * a.spread * 0.5;
        palle.push({
          x: me.x + Math.cos(angolo) * (RAGGIO + 2),
          y: me.y + Math.sin(angolo) * (RAGGIO + 2),
          vx: Math.cos(ang) * a.vel, vy: Math.sin(ang) * a.vel,
          danno: a.danno, perfora: !!a.perfora, esplode: a.esplode || 0,
          colore: a.colore, vita: 1.6, colpiti: []
        });
      }
      svegliaVicini(me.x, me.y, a.rumore);
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
      risveglia(n);                 // svegliarsi sparati è il minimo
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
          var figlio = creaNemico('strisciante', n.x + rf(-10, 10), n.y + rf(-10, 10));
          risveglia(figlio);                // nascono già arrabbiati
        }
      }
      // il boss lascia sempre qualcosa: è costato troppo per non pagare
      if (n.tipo === 'boss') casse.push(cassa(n.x, n.y, 'razzi'));
      else if (rng() < cfg.cuoreChance && vite < VITE) casse.push(cassa(n.x, n.y, null));
      else if (rng() < cfg.dropChance) casse.push(cassa(n.x, n.y, rpick(CADUTE)));
      api.sfx.hit();
    }

    // `quale` null = cuore. Il nome non è `arma` di proposito: quella è la
    // variabile dell'arma in mano, e ombreggiarla qui sarebbe un invito al bug.
    function cassa(x, y, quale) {
      var c = {
        x: api.util.clamp(x, 14, W - 14),
        y: api.util.clamp(y, TOP + 14, H - 14),
        tipo: quale ? 'arma' : 'cuore', arma: quale, vita: 14
      };
      staccaDaiMuri(c, 9);         // mai dentro un muro: sarebbe irraggiungibile
      return c;
    }

    function scoppio(x, y, raggio, danno) {
      scoppi.push({ x: x, y: y, r: raggio, t: 0.28 });
      for (var i = nemici.length - 1; i >= 0; i--) {
        var n = nemici[i];
        // l'esplosione non gira l'angolo
        if (Math.hypot(n.x - x, n.y - y) < raggio + n.r && liberoTra(x, y, n.x, n.y)) {
          danneggia(n, danno);
        }
      }
      svegliaVicini(x, y, raggio * 2.5);
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
        fonte.x += (fonte.x - me.x) / d * 22;
        fonte.y += (fonte.y - me.y) / d * 22;
        staccaDaiMuri(fonte, fonte.r);
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
      me.x += mx * VEL * dt;
      me.y += my * VEL * dt;
      staccaDaiMuri(me, RAGGIO);
      if (me.invuln > 0) me.invuln -= dt;
      if (scossa > 0) scossa -= dt;

      ricalcolo -= dt;
      if (ricalcolo <= 0) { ricalcolaCampo(); ricalcolo = 0.25; }

      // mira e fuoco automatici, solo su ciò che si vede
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
          var cel = cellaLontana();
          var pos = centro(cel.r, cel.c);
          avvisi.push({ x: pos.x, y: pos.y, t: 0.7, tipo: coda.shift() });
          attesaSpawn = 0.2;
        }
      }

      // mostri
      for (i = 0; i < nemici.length; i++) {
        n = nemici[i];
        var t = TIPI[n.tipo];
        var dx = me.x - n.x, dy = me.y - n.y;
        var d = Math.hypot(dx, dy) || 1;
        if (n.flash > 0) n.flash -= dt;
        if (n.allarme > 0) n.allarme -= dt;

        /* Vista: si controlla qualche volta al secondo, non a ogni fotogramma.
           Sessanta linee di vista per venti mostri sarebbero sprecate, e il
           ritardo di un decimo di secondo non lo nota nessuno. */
        n.controllo -= dt;
        if (n.controllo <= 0) {
          n.controllo = 0.12;
          if (d < t.vista * cfg.vista && liberoTra(n.x, n.y, me.x, me.y)) risveglia(n);
        }
        if (d < 30) risveglia(n);        // addosso ti sente comunque

        if (!n.sveglio) continue;        // chi dorme non si muove e non spara

        n.memoria -= dt;
        if (n.memoria <= 0) { n.sveglio = false; continue; }

        var v = cfg.velNemici * t.fattore;
        if (t.scatti) {                  // lo scattante alterna scatti e pause
          n.fase -= dt;
          if (n.fase <= 0) { n.attivo = !n.attivo; n.fase = n.attivo ? 0.55 : 0.4; }
          if (!n.attivo) v *= 0.12;
        }

        var vede = d < t.vista * cfg.vista && liberoTra(n.x, n.y, me.x, me.y);
        if (t.spara && vede) {
          n.ricarica -= dt;
          if (n.ricarica <= 0) {
            /* Anche i colpi viaggiano più in fretta salendo: in un corridoio
               un proiettile lento si scansa camminando, ed è l'unica minaccia
               che non si risolve scappando. */
            var vp = 130 * TG.util.opponentSpeedRatio(cfg.level) * 1.2;
            palleNemiche.push({ x: n.x, y: n.y, vx: dx / d * vp, vy: dy / d * vp, vita: 3 });
            n.ricarica = t.spara;
            api.sfx.tone(300, 0.05, 'square', 0.03);
          }
        }

        // dove andare: la cella vicina più vicina al giocatore
        var mira = { x: me.x, y: me.y };
        var cel2 = cellaDi(n.x, n.y);
        var mio = campo[cel2.r][cel2.c];
        if (mio > 0) {
          for (var dd = 0; dd < 4; dd++) {
            if (chiuso(cel2.r, cel2.c, dd)) continue;
            var vr = cel2.r + DR[dd], vc = cel2.c + DC[dd];
            if (!dentroGriglia(vr, vc) || campo[vr][vc] !== mio - 1) continue;
            mira = centro(vr, vc);
            break;
          }
        }
        var mdx = mira.x - n.x, mdy = mira.y - n.y;
        var md = Math.hypot(mdx, mdy) || 1;
        // il tiratore, quando ti vede da lontano, resta dov'è e spara
        if (!(t.spara && vede && d < t.distanza)) {
          n.x += mdx / md * v * dt;
          n.y += mdy / md * v * dt;
        }
        staccaDaiMuri(n, n.r);
        if (d < n.r + RAGGIO) colpisciGiocatore(n);
      }

      /* Spinta fra mostri: senza, si sovrappongono in un blocco unico e il
         fucile ne prende sei con un colpo. Sono poche decine, il ciclo
         quadratico non si sente. */
      for (i = 0; i < nemici.length; i++) {
        for (j = i + 1; j < nemici.length; j++) {
          var a = nemici[i], bb = nemici[j];
          if (!a.sveglio && !bb.sveglio) continue;
          var ddx = bb.x - a.x, ddy = bb.y - a.y;
          var dd2 = Math.hypot(ddx, ddy) || 1;
          var min = a.r + bb.r;
          if (dd2 < min) {
            var spinta = (min - dd2) / 2;
            a.x -= ddx / dd2 * spinta; a.y -= ddy / dd2 * spinta;
            bb.x += ddx / dd2 * spinta; bb.y += ddy / dd2 * spinta;
            staccaDaiMuri(a, a.r);
            staccaDaiMuri(bb, bb.r);
          }
        }
      }

      // proiettili del giocatore: i muri li fermano
      for (i = palle.length - 1; i >= 0; i--) {
        p = palle[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vita -= dt;
        if (dentroMuro(p.x, p.y) || p.vita <= 0) {
          if (p.esplode && p.vita > 0) scoppio(p.x, p.y, p.esplode, p.danno);
          palle.splice(i, 1);
          continue;
        }
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
        if (p.vita <= 0 || dentroMuro(p.x, p.y)) palleNemiche.splice(i, 1);
      }

      // casse per terra
      for (i = casse.length - 1; i >= 0; i--) {
        c = casse[i];
        c.vita -= dt;
        if (Math.hypot(c.x - me.x, c.y - me.y) < RAGGIO + 10) { raccogli(c); casse.splice(i, 1); continue; }
        if (c.vita <= 0) casse.splice(i, 1);
      }

      for (i = scoppi.length - 1; i >= 0; i--) { scoppi[i].t -= dt; if (scoppi[i].t <= 0) scoppi.splice(i, 1); }
      for (i = note.length - 1; i >= 0; i--) {
        note[i].t -= dt; note[i].y -= 22 * dt;
        if (note[i].t <= 0) note.splice(i, 1);
      }

      /* Qui c'era un «finale»: negli ultimi trenta secondi si svegliava tutto
         il labirinto, per non lasciare la coda del livello a una caccia al
         mostro rimasto in un angolo. Tolto, perché rompeva la regola più
         importante della suite: con la mira automatica e i mostri che ti
         vengono incontro, restare immobili diventava una strategia vincente —
         e infatti il profilo «fermo» ha cominciato a vincere il livello 1. La
         coda si accorcia guardando la mappa, non aspettando. */

      // il tempo scorre: è quello che impedisce di aspettare in un angolo
      timeLeft -= dt;
      if (timeLeft <= 0) {
        finito = true;
        api.gameOver({
          message: 'Tempo scaduto con ' + (nemici.length + coda.length) +
            ' mostri ancora nel labirinto.'
        });
        return;
      }

      // fine ondata / fine livello
      if (!coda.length && !avvisi.length && !nemici.length) {
        pausaOndata -= dt;
        if (pausaOndata <= 0) {
          if (ondata >= cfg.ondate) {
            finito = true;
            api.levelComplete({
              bonus: 100 * cfg.level + vite * 50 + Math.round(timeLeft) * 2,
              message: uccisi + ' mostri ripuliti, con ' + timeLeft.toFixed(0) + 's di anticipo.'
            });
          } else {
            preparaOndata();
            pausaOndata = 1;
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

    function disegnaLabirinto(ctx) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, TOP, W, H - TOP);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (var c = 1; c < COLS; c++) {
        ctx.beginPath(); ctx.moveTo(c * CELLA, TOP); ctx.lineTo(c * CELLA, H); ctx.stroke();
      }
      for (var r = 1; r < RIGHE; r++) {
        ctx.beginPath();
        ctx.moveTo(0, TOP + r * CELLA); ctx.lineTo(W, TOP + r * CELLA); ctx.stroke();
      }

      ctx.fillStyle = '#334155';
      for (r = 0; r <= RIGHE; r++) {
        for (c = 0; c < COLS; c++) {
          if (!nord[r][c]) continue;
          api.util.roundRect(ctx, c * CELLA - MURO / 2, TOP + r * CELLA - MURO / 2,
            CELLA + MURO, MURO, 2);
          ctx.fill();
        }
      }
      for (r = 0; r < RIGHE; r++) {
        for (c = 0; c <= COLS; c++) {
          if (!ovest[r][c]) continue;
          api.util.roundRect(ctx, c * CELLA - MURO / 2, TOP + r * CELLA - MURO / 2,
            MURO, CELLA + MURO, 2);
          ctx.fill();
        }
      }
    }

    function disegnaMostro(ctx, n) {
      var t = TIPI[n.tipo];
      ctx.globalAlpha = n.sveglio ? 1 : 0.55;      // chi dorme è spento
      ctx.fillStyle = n.flash > 0 ? '#fff' : t.colore;
      if (n.tipo === 'corazzato' || n.tipo === 'boss') {
        api.util.roundRect(ctx, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2, 4);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      var a = Math.atan2(me.y - n.y, me.x - n.x);
      ctx.strokeStyle = 'rgba(5,7,12,0.85)';
      ctx.fillStyle = 'rgba(5,7,12,0.85)';
      ctx.lineWidth = 1.5;
      for (var s = -1; s <= 1; s += 2) {
        var ox = Math.cos(a) * n.r * 0.42 - Math.sin(a) * n.r * 0.34 * s;
        var oy = Math.sin(a) * n.r * 0.42 + Math.cos(a) * n.r * 0.34 * s;
        if (n.sveglio) {                            // occhi aperti
          ctx.beginPath();
          ctx.arc(n.x + ox, n.y + oy, Math.max(1.4, n.r * 0.18), 0, Math.PI * 2);
          ctx.fill();
        } else {                                    // occhi chiusi: una lineetta
          ctx.beginPath();
          ctx.moveTo(n.x + ox - 2.5, n.y + oy);
          ctx.lineTo(n.x + ox + 2.5, n.y + oy);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (n.allarme > 0) {                          // il punto esclamativo di chi ti ha visto
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', n.x, n.y - n.r - 4);
      }
      if (n.vitaMax > 1) {
        var w = n.r * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(n.x - n.r, n.y - n.r - 6, w, 3);
        ctx.fillStyle = n.sveglio ? '#4ade80' : 'rgba(74,222,128,0.5)';
        ctx.fillRect(n.x - n.r, n.y - n.r - 6, w * Math.max(0, n.vita / n.vitaMax), 3);
      }
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      if (scossa > 0) ctx.translate(rf(-2.5, 2.5) * scossa, rf(-2.5, 2.5) * scossa);

      disegnaLabirinto(ctx);

      avvisi.forEach(function (a) {
        var k = 1 - a.t / 0.7;
        ctx.strokeStyle = 'rgba(248,113,113,' + (0.35 + 0.5 * k) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 5 + 10 * (1 - k), 0, Math.PI * 2);
        ctx.stroke();
      });

      casse.forEach(function (c) {
        if (c.vita < 3 && Math.floor(c.vita * 6) % 2 === 0) return;   // lampeggia prima di sparire
        if (c.tipo === 'cuore') {
          ctx.fillStyle = '#f87171';
          ctx.font = '15px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('❤', c.x, c.y + 1);
          ctx.textBaseline = 'alphabetic';
          return;
        }
        var a = ARMI[c.arma];
        ctx.fillStyle = 'rgba(15,23,42,0.95)';
        api.util.roundRect(ctx, c.x - 9, c.y - 9, 18, 18, 4);
        ctx.fill();
        ctx.strokeStyle = a.colore;
        ctx.lineWidth = 2;
        api.util.roundRect(ctx, c.x - 9, c.y - 9, 18, 18, 4);
        ctx.stroke();
        ctx.fillStyle = a.colore;
        ctx.font = 'bold 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.nome.charAt(0), c.x, c.y + 1);
        ctx.textBaseline = 'alphabetic';
      });

      nemici.forEach(function (n) { disegnaMostro(ctx, n); });

      palle.forEach(function (p) {
        ctx.strokeStyle = p.colore;
        ctx.lineWidth = p.esplode ? 4 : 2.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        ctx.stroke();
      });
      ctx.fillStyle = '#fca5a5';
      palleNemiche.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
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
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(me.x + Math.cos(angolo) * 3, me.y + Math.sin(angolo) * 3);
        ctx.lineTo(me.x + Math.cos(angolo) * (RAGGIO + 7), me.y + Math.sin(angolo) * (RAGGIO + 7));
        ctx.stroke();
      }

      note.forEach(function (f) {
        ctx.globalAlpha = Math.max(0, f.t);
        ctx.fillStyle = f.colore;
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.testo, f.x, f.y);
        ctx.globalAlpha = 1;
      });

      ctx.restore();

      // ---- HUD ----
      ctx.fillStyle = '#05070c';
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
      var svegli = nemici.filter(function (n) { return n.sveglio; }).length;
      ctx.fillStyle = svegli ? '#f87171' : 'rgba(230,237,243,0.6)';
      ctx.fillText(restano ? restano + ' mostri · ' + svegli + ' svegli' : 'ondata pulita', W - 10, 38);

      // barra del tempo
      var frazione = api.util.clamp(timeLeft / cfg.tempo, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(10, TOP - 12, W - 20, 5);
      ctx.fillStyle = frazione < 0.25 ? '#f87171' : '#38bdf8';
      ctx.fillRect(10, TOP - 12, (W - 20) * frazione, 5);
    }

    function state() {
      /* Il labirinto sta tutto sullo schermo, quindi darlo qui non regala
         niente a nessuno: i test e i bot vedono quello che vedi tu. `passaggi`
         è una maschera per cella — bit 0 nord, 1 est, 2 sud, 3 ovest. */
      var passaggi = [];
      for (var r = 0; r < RIGHE; r++) {
        var riga = [];
        for (var c = 0; c < COLS; c++) {
          var m = 0;
          for (var d = 0; d < 4; d++) if (!chiuso(r, c, d)) m |= (1 << d);
          riga.push(m);
        }
        passaggi.push(riga);
      }
      return {
        seme: seme,
        griglia: { cols: COLS, righe: RIGHE, cella: CELLA, top: TOP, muro: MURO },
        passaggi: passaggi,
        giocatore: { x: me.x, y: me.y, invuln: Math.max(0, me.invuln) },
        vite: vite,
        arma: arma,
        colpi: colpi === Infinity ? -1 : colpi,
        ondata: ondata,
        ondate: cfg.ondate,
        uccisi: uccisi,
        velNemici: cfg.velNemici,
        timeLeft: Math.round(timeLeft * 10) / 10,
        rimasti: nemici.length + coda.length + avvisi.length,
        svegli: nemici.filter(function (n) { return n.sveglio; }).length,
        nemici: nemici.map(function (n) {
          return { x: n.x, y: n.y, r: n.r, tipo: n.tipo, vita: n.vita, sveglio: n.sveglio };
        }),
        palleNemiche: palleNemiche.map(function (p) { return { x: p.x, y: p.y, vx: p.vx, vy: p.vy }; }),
        // gli avvisi di comparsa si vedono a schermo, quindi il bot li vede
        avvisi: avvisi.map(function (a) { return { x: a.x, y: a.y, t: a.t, tipo: a.tipo }; }),
        casse: casse.map(function (c) { return { x: c.x, y: c.y, tipo: c.tipo, arma: c.arma }; })
      };
    }

    /* Il seme si può imporre dall'esterno (va messo prima di start): lo usano i
       test per rigiocare la stessa partita, e sarebbe il perno di una sfida in
       cui due persone affrontano lo stesso labirinto. */
    function setSeme(v) { seme = v >>> 0; }

    return { start: start, update: update, draw: draw, state: state, setSeme: setSeme };
  }
});

})();
