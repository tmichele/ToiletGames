/* Forza 4 — contro la CPU o in due sullo stesso dispositivo.

   Il gioco è a turni, quindi la difficoltà non passa dai riflessi ma da quanto
   lontano guarda l'avversario: la CPU usa minimax con potatura alfa-beta, con
   profondità che cresce di livello e una probabilità di svarione che cala.

   In due giocatori si alternano le mosse sullo stesso schermo: il livello sale
   quando vince il ROSSO, che è anche il risultato registrato in classifica. */
(function () {
'use strict';

var COLS = 7, ROWS = 6;
var VUOTO = 0, ROSSO = 1, GIALLO = 2;

function config(level) {
  return {
    level: level,
    // quante mosse avanti guarda la CPU
    profondita: Math.min(1 + Math.floor(level / 1.5), 6),
    // quanto spesso gioca a caso invece di ragionare
    svarione: Math.max(0, 0.58 - level * 0.075),
    mossaPunti: 2 * level
  };
}

/* ---------- regole della griglia (pure, senza stato di gioco) ---------- */

function colonnaLibera(board, c) {
  return board[c][ROWS - 1] === VUOTO;
}

function primaRigaLibera(board, c) {
  for (var r = 0; r < ROWS; r++) if (board[c][r] === VUOTO) return r;
  return -1;
}

function mosseLegali(board) {
  var out = [];
  for (var c = 0; c < COLS; c++) if (colonnaLibera(board, c)) out.push(c);
  return out;
}

/* Restituisce le quattro caselle vincenti, oppure null. */
function lineaVincente(board, c, r) {
  var colore = board[c][r];
  if (colore === VUOTO) return null;
  var direzioni = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (var d = 0; d < direzioni.length; d++) {
    var dx = direzioni[d][0], dy = direzioni[d][1];
    var celle = [[c, r]];
    var k, x, y;
    for (k = 1; k < 4; k++) {
      x = c + dx * k; y = r + dy * k;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[x][y] !== colore) break;
      celle.push([x, y]);
    }
    for (k = 1; k < 4; k++) {
      x = c - dx * k; y = r - dy * k;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[x][y] !== colore) break;
      celle.unshift([x, y]);
    }
    if (celle.length >= 4) return celle.slice(0, 4);
  }
  return null;
}

function pieno(board) {
  return mosseLegali(board).length === 0;
}

/* ---------- valutazione e minimax ---------- */

function punteggioFinestra(finestra, io, avversario) {
  var miei = 0, suoi = 0, vuoti = 0;
  for (var i = 0; i < 4; i++) {
    if (finestra[i] === io) miei++;
    else if (finestra[i] === avversario) suoi++;
    else vuoti++;
  }
  if (miei === 4) return 100000;
  if (suoi === 4) return -100000;
  if (miei === 3 && vuoti === 1) return 60;
  if (suoi === 3 && vuoti === 1) return -80;   // chiudere vale più che aprire
  if (miei === 2 && vuoti === 2) return 8;
  if (suoi === 2 && vuoti === 2) return -8;
  return 0;
}

function valuta(board, io) {
  var avversario = io === ROSSO ? GIALLO : ROSSO;
  var punti = 0;
  var c, r, k, finestra;

  // il centro vale: da lì passano più quaterne
  for (r = 0; r < ROWS; r++) if (board[3][r] === io) punti += 6;

  for (r = 0; r < ROWS; r++) {
    for (c = 0; c < COLS; c++) {
      if (c + 3 < COLS) {
        finestra = [];
        for (k = 0; k < 4; k++) finestra.push(board[c + k][r]);
        punti += punteggioFinestra(finestra, io, avversario);
      }
      if (r + 3 < ROWS) {
        finestra = [];
        for (k = 0; k < 4; k++) finestra.push(board[c][r + k]);
        punti += punteggioFinestra(finestra, io, avversario);
      }
      if (c + 3 < COLS && r + 3 < ROWS) {
        finestra = [];
        for (k = 0; k < 4; k++) finestra.push(board[c + k][r + k]);
        punti += punteggioFinestra(finestra, io, avversario);
      }
      if (c + 3 < COLS && r - 3 >= 0) {
        finestra = [];
        for (k = 0; k < 4; k++) finestra.push(board[c + k][r - k]);
        punti += punteggioFinestra(finestra, io, avversario);
      }
    }
  }
  return punti;
}

function copia(board) {
  var out = [];
  for (var c = 0; c < COLS; c++) out.push(board[c].slice());
  return out;
}

function minimax(board, profondita, alfa, beta, tocca, io) {
  var legali = mosseLegali(board);
  if (!legali.length) return { punti: 0, mossa: -1 };

  var i, c, r, b, ris;
  // vittoria immediata: si chiude subito, senza scendere oltre
  for (i = 0; i < legali.length; i++) {
    c = legali[i];
    r = primaRigaLibera(board, c);
    board[c][r] = tocca;
    var vinta = lineaVincente(board, c, r);
    board[c][r] = VUOTO;
    if (vinta) {
      return { punti: (tocca === io ? 100000 : -100000) + profondita, mossa: c };
    }
  }
  if (profondita <= 0) return { punti: valuta(board, io), mossa: legali[0] };

  // le colonne centrali per prime: la potatura taglia molto di più
  legali.sort(function (a, b2) { return Math.abs(3 - a) - Math.abs(3 - b2); });

  var miglioreMossa = legali[0];
  if (tocca === io) {
    var max = -Infinity;
    var pari = [];
    for (i = 0; i < legali.length; i++) {
      c = legali[i];
      b = copia(board);
      b[c][primaRigaLibera(b, c)] = tocca;
      ris = minimax(b, profondita - 1, alfa, beta, tocca === ROSSO ? GIALLO : ROSSO, io);
      if (ris.punti > max) { max = ris.punti; miglioreMossa = c; pari = [c]; }
      else if (ris.punti === max) pari.push(c);
      alfa = Math.max(alfa, max);
      if (alfa >= beta) break;
    }
    /* Fra mosse che valgono uguale si sceglie a caso: altrimenti contro lo
       stesso avversario la CPU rigiocherebbe sempre la stessa identica partita. */
    if (pari.length > 1) miglioreMossa = api_pick(pari);
    return { punti: max, mossa: miglioreMossa };
  }
  var min = Infinity;
  for (i = 0; i < legali.length; i++) {
    c = legali[i];
    b = copia(board);
    b[c][primaRigaLibera(b, c)] = tocca;
    ris = minimax(b, profondita - 1, alfa, beta, tocca === ROSSO ? GIALLO : ROSSO, io);
    if (ris.punti < min) { min = ris.punti; miglioreMossa = c; }
    beta = Math.min(beta, min);
    if (alfa >= beta) break;
  }
  return { punti: min, mossa: miglioreMossa };
}

function mossaCpu(board, cfg) {
  var legali = mosseLegali(board);
  if (!legali.length) return -1;
  if (Math.random() < cfg.svarione) return api_pick(legali);
  return minimax(board, cfg.profondita, -Infinity, Infinity, GIALLO, GIALLO).mossa;
}

function api_pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- il gioco ---------- */

TG.registry.register({
  id: 'forza4',
  title: 'Forza 4',
  icon: '🔴',
  tagline: 'Quattro di fila, contro la CPU o contro chi ti sta accanto.',
  scoreLabel: 'Punti',
  controls: 'lr',
  actionLabel: 'GIOCA',
  viewport: { w: 360, h: 380 },
  howto: '<b>Comandi:</b> tocca la colonna, oppure ◀ ▶ e GIOCA, le frecce ←/→ ' +
    'con spazio, o i tasti <b>1-7</b>. ' +
    'A inizio partita scegli se sfidare la <b>CPU</b> o giocare <b>in due</b> ' +
    'sullo stesso dispositivo, a mosse alternate. ' +
    'Vinci la mano per salire di livello: la CPU guarda sempre più mosse avanti. ' +
    'In due giocatori la classifica registra i risultati del <b>rosso</b>.',

  levelInfo: function (level) {
    var c = config(level);
    return 'Livello ' + level + ': la CPU guarda ' + c.profondita +
      (c.profondita === 1 ? ' mossa' : ' mosse') + ' avanti' +
      (c.svarione > 0.05 ? ', ma ogni tanto svaria' : ', senza sbagliare un colpo');
  },

  create: function (api) {
    var W = api.width, H = api.height;
    var TOP = 52;                       // riga del cursore e messaggi
    var cell = Math.min((W - 16) / COLS, (H - TOP - 12) / ROWS);
    var boardW = cell * COLS, boardH = cell * ROWS;
    var offX = (W - boardW) / 2, offY = TOP;

    var cfg, board, fase, turno, cursore, vincente, caduta, attesaCpu, modo, messaggio, menuSel;

    function nuovaGriglia() {
      board = [];
      for (var c = 0; c < COLS; c++) {
        var col = [];
        for (var r = 0; r < ROWS; r++) col.push(VUOTO);
        board.push(col);
      }
    }

    function start(level) {
      cfg = config(level);
      nuovaGriglia();
      cursore = 3;
      menuSel = 0;
      vincente = null;
      caduta = null;
      attesaCpu = 0;
      messaggio = '';
      turno = ROSSO;
      // la modalità si sceglie una volta, alla prima mano della partita
      fase = modo ? 'gioco' : 'menu';
    }

    function centro(c, r) {
      return {
        x: offX + c * cell + cell / 2,
        y: offY + (ROWS - 1 - r) * cell + cell / 2
      };
    }

    function colonnaDa(x) {
      var c = Math.floor((x - offX) / cell);
      return (c >= 0 && c < COLS) ? c : -1;
    }

    /* ---------- mosse ---------- */

    function gioca(c) {
      if (fase !== 'gioco' || caduta || c < 0 || c >= COLS) return;
      if (!colonnaLibera(board, c)) {
        api.sfx.tone(160, 0.1, 'square', 0.06);
        messaggio = 'Colonna piena';
        return;
      }
      messaggio = '';
      var r = primaRigaLibera(board, c);
      var arrivo = centro(c, r);
      caduta = {
        c: c, r: r, colore: turno,
        y: offY - cell / 2,          // parte da sopra la griglia
        yFine: arrivo.y,
        v: 0
      };
      api.sfx.tone(turno === ROSSO ? 520 : 420, 0.06, 'square', 0.07);
    }

    function posa() {
      var c = caduta.c, r = caduta.r, colore = caduta.colore;
      board[c][r] = colore;
      caduta = null;
      api.sfx.hit();

      if (colore === ROSSO) api.addScore(cfg.mossaPunti);

      var linea = lineaVincente(board, c, r);
      if (linea) {
        vincente = linea;
        fase = 'fine';
        attesaCpu = 1.1;              // riusato come pausa prima del verdetto
        return;
      }
      if (pieno(board)) {
        fase = 'fine';
        vincente = null;
        attesaCpu = 1.1;
        return;
      }
      turno = turno === ROSSO ? GIALLO : ROSSO;
      if (modo === 'cpu' && turno === GIALLO) attesaCpu = 0.45;
    }

    function chiudiMano() {
      if (vincente) {
        var colore = board[vincente[0][0]][vincente[0][1]];
        if (colore === ROSSO) {
          var vuote = 0;
          for (var c = 0; c < COLS; c++) {
            for (var r = 0; r < ROWS; r++) if (board[c][r] === VUOTO) vuote++;
          }
          api.levelComplete({
            bonus: 100 * cfg.level + vuote * 4,
            message: modo === 'cpu'
              ? 'Quattro di fila prima della CPU.'
              : 'Il rosso chiude la mano.'
          });
        } else {
          api.gameOver({
            message: modo === 'cpu'
              ? 'La CPU ha fatto quattro di fila al livello ' + cfg.level + '.'
              : 'Il giallo ha vinto la mano.'
          });
        }
        return;
      }
      // pareggio: si rigioca la stessa mano, senza premi né penalità
      messaggio = 'Pareggio: si rigioca';
      nuovaGriglia();
      vincente = null;
      turno = ROSSO;
      fase = 'gioco';
    }

    /* ---------- menu della modalità ---------- */

    function bottoni() {
      var w = W - 60, h = 62;
      return [
        { x: 30, y: 120, w: w, h: h, modo: 'cpu', testo: 'Sfida la CPU', sotto: 'un giocatore' },
        { x: 30, y: 200, w: w, h: h, modo: 'duo', testo: 'In due', sotto: 'stesso dispositivo, a turno' }
      ];
    }

    function scegli(m) {
      modo = m;
      fase = 'gioco';
      api.sfx.click();
    }

    function update(dt) {
      var tap, azione, d;

      /* La scelta si legge una volta sola: appena `scegli` cambia fase si esce,
         altrimenti un secondo input arrivato nello stesso frame sovrascrive la
         modalità appena scelta. */
      if (fase === 'menu') {
        while (fase === 'menu' && (tap = api.input.takeTap())) {
          bottoni().forEach(function (b) {
            if (tap.x >= b.x && tap.x <= b.x + b.w && tap.y >= b.y && tap.y <= b.y + b.h) scegli(b.modo);
          });
        }
        while (fase === 'menu' && (d = api.input.takeDigit())) {
          if (d === 1) scegli('cpu');
          if (d === 2) scegli('duo');
        }
        while (fase === 'menu' && (azione = api.input.take())) {
          if (azione === 'left') menuSel = 0;
          if (azione === 'right') menuSel = 1;
          if (azione === 'action') scegli(menuSel === 1 ? 'duo' : 'cpu');
        }
        return;
      }

      // in attesa: caduta in corso, turno della CPU o pausa di fine mano
      while ((tap = api.input.takeTap())) {
        if (fase === 'gioco' && (modo === 'duo' || turno === ROSSO)) gioca(colonnaDa(tap.x));
      }
      while ((d = api.input.takeDigit())) {
        if (fase === 'gioco' && (modo === 'duo' || turno === ROSSO) && d <= COLS) gioca(d - 1);
      }
      while ((azione = api.input.take())) {
        if (azione === 'left') cursore = Math.max(0, cursore - 1);
        else if (azione === 'right') cursore = Math.min(COLS - 1, cursore + 1);
        else if (azione === 'action' && fase === 'gioco' && (modo === 'duo' || turno === ROSSO)) {
          gioca(cursore);
        }
      }

      if (caduta) {
        caduta.v += 2600 * dt;
        caduta.y += caduta.v * dt;
        if (caduta.y >= caduta.yFine) posa();
        return;
      }

      if (fase === 'fine') {
        attesaCpu -= dt;
        if (attesaCpu <= 0) chiudiMano();
        return;
      }

      if (modo === 'cpu' && turno === GIALLO) {
        attesaCpu -= dt;
        if (attesaCpu <= 0) gioca(mossaCpu(board, cfg));
      }
    }

    /* ---------- disegno ---------- */

    function colore(v) {
      return v === ROSSO ? '#f87171' : (v === GIALLO ? '#fbbf24' : '#0b1220');
    }

    function drawMenu(ctx) {
      ctx.fillStyle = '#e6edf3';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Come vuoi giocare?', W / 2, 80);

      bottoni().forEach(function (b, i) {
        var attivo = menuSel === i;
        ctx.fillStyle = attivo ? 'rgba(74,222,128,0.14)' : 'rgba(255,255,255,0.05)';
        api.util.roundRect(ctx, b.x, b.y, b.w, b.h, 12);
        ctx.fill();
        ctx.strokeStyle = attivo ? '#4ade80' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 2;
        api.util.roundRect(ctx, b.x, b.y, b.w, b.h, 12);
        ctx.stroke();

        ctx.fillStyle = '#e6edf3';
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.fillText((i + 1) + '. ' + b.testo, W / 2, b.y + 27);
        ctx.fillStyle = 'rgba(230,237,243,0.55)';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(b.sotto, W / 2, b.y + 46);
      });

      ctx.fillStyle = 'rgba(230,237,243,0.5)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('tocca, oppure tasti 1 e 2', W / 2, 292);
    }

    function draw(ctx) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, W, H);

      if (fase === 'menu') { drawMenu(ctx); return; }

      // intestazione: di chi è il turno
      ctx.font = '13px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(230,237,243,0.75)';
      var etichetta;
      if (fase === 'fine') etichetta = vincente ? 'quattro di fila!' : 'griglia piena';
      else if (modo === 'cpu') etichetta = turno === ROSSO ? 'tocca a te' : 'pensa la CPU…';
      else etichetta = turno === ROSSO ? 'tocca al rosso' : 'tocca al giallo';
      ctx.fillText(etichetta, 12, 20);

      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(230,237,243,0.45)';
      ctx.fillText(modo === 'cpu' ? 'vs CPU' : 'due giocatori', W - 12, 20);

      if (messaggio) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(messaggio, W / 2, 20);
      }

      // cursore sopra la colonna scelta
      if (fase === 'gioco' && !caduta) {
        var cx = offX + cursore * cell + cell / 2;
        ctx.fillStyle = colore(turno);
        ctx.beginPath();
        ctx.arc(cx, TOP - 16, cell * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // griglia
      ctx.fillStyle = '#1e40af';
      api.util.roundRect(ctx, offX - 6, offY - 6, boardW + 12, boardH + 12, 12);
      ctx.fill();

      for (var c = 0; c < COLS; c++) {
        for (var r = 0; r < ROWS; r++) {
          var p = centro(c, r);
          ctx.fillStyle = colore(board[c][r]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, cell * 0.38, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // gettone in caduta
      if (caduta) {
        var pc = centro(caduta.c, 0);
        ctx.fillStyle = colore(caduta.colore);
        ctx.beginPath();
        ctx.arc(pc.x, caduta.y, cell * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }

      // quaterna vincente evidenziata
      if (vincente) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 3;
        vincente.forEach(function (cella) {
          var p = centro(cella[0], cella[1]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, cell * 0.42, 0, Math.PI * 2);
          ctx.stroke();
        });
      }

      // numeri di colonna, per i tasti 1-7
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (var i = 0; i < COLS; i++) {
        ctx.fillText(String(i + 1), offX + i * cell + cell / 2, offY + boardH + 14);
      }
    }

    function state() {
      return {
        modo: modo || null,
        fase: fase,
        turno: turno,
        cursore: cursore,
        board: board ? board.map(function (col) { return col.slice(); }) : null,
        vincente: vincente,
        piena: board ? pieno(board) : false,
        /* Geometria, così i test possono toccare dove toccherebbe una persona
           invece di richiedere comandi di debug dentro al gioco. */
        colonne: (function () {
          var out = [];
          for (var c = 0; c < COLS; c++) out.push({ c: c, x: offX + c * cell + cell / 2, y: offY + 20 });
          return out;
        })(),
        menu: bottoni().map(function (b) {
          return { modo: b.modo, x: b.x + b.w / 2, y: b.y + b.h / 2 };
        })
      };
    }

    return { start: start, update: update, draw: draw, state: state };
  }
});

})();
