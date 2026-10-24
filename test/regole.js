/* Verifica delle meccaniche che il test nel browser non riesce a raggiungere.

   Alcune regole compaiono solo a livelli avanzati (i mattoni speciali, per
   esempio, dal secondo e dal terzo livello): pilotare il browser fin lì
   richiederebbe partite intere. Qui i giochi girano nella sandbox, si mette lo
   stato nella condizione voluta e si guarda cosa succede.

   Uso:  node test/regole.js */

const fs = require('fs');
const path = require('path');
const { loadGames, loadCore, makeGame, ROOT } = require('./sandbox');
const { creaFintoFirebase } = require('./finto-firebase');
const { creaPilota: creaPilotaCane } = require('./cane-bot');

const DT = 1 / 60;
let failures = 0;

function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) failures++;
}

const { defs, util } = loadGames();

/* Fa avanzare il gioco finché la condizione è vera o scade il tempo.
   `drive` viene chiamata a ogni passo per muovere i comandi. */
function runUntil(game, cond, maxSeconds, drive) {
  let t = 0;
  while (t < (maxSeconds || 30)) {
    if (drive) drive();
    game.update(DT);
    t += DT;
    if (cond()) return true;
  }
  return false;
}

/* Giocatore perfetto a tasti: insegue la pallina. Serve a tenere viva la
   partita nei test che devono osservare una meccanica, non la difficoltà. */
function follow(input, game, key) {
  return function () {
    const s = game.state();
    const dx = s[key].x - s.paddle.x;
    input.held.left = dx < -4;
    input.held.right = dx > 4;
  };
}

/* ---------- Mattoni: mattoni speciali, combo, malus ---------- */

console.log('\n[mattoni: tipi di mattone]');
{
  const def = defs.mattoni;

  // I tipi compaiono ai livelli previsti e non prima.
  const kindsAt = (level) => {
    const seen = {};
    for (let i = 0; i < 40; i++) {          // più muri: i tipi sono casuali
      const { game } = makeGame(def, util, level);
      game.state();
      Object.keys(game.state().speciali).forEach((k) => { seen[k] = true; });
    }
    return seen;
  };
  const l1 = kindsAt(1), l3 = kindsAt(3), l6 = kindsAt(6), l11 = kindsAt(11);
  check('al livello 1 il muro è tutto normale', Object.keys(l1).length === 0, Object.keys(l1).join(','));
  check('turbo e impazziti compaiono entro il livello 3', l3.turbo && l3.matto, Object.keys(l3).join(','));
  check('i corazzati arrivano più avanti', l6.corazzato, Object.keys(l6).join(','));
  check('i fantasma non compaiono fino all\'11°', !l11.fantasma, Object.keys(l11).join(','));

  /* Il fantasma è l'effetto più duro, e non è una quota del muro ma un numero:
     uno dal 12° livello in su, zero prima. Era una probabilità per mattone, e
     una probabilità non sa contare — al 9° lo stesso 5% dava un muro con un
     fantasma e il successivo con otto. Qui si contano davvero, su tanti muri:
     una quota mascherata da tetto salterebbe fuori come una media giusta con un
     massimo sbagliato. */
  const contaFantasmi = (level) => {
    let min = Infinity, max = 0, somma = 0;
    for (let i = 0; i < 60; i++) {
      const n = makeGame(def, util, level).game.state().speciali.fantasma || 0;
      somma += n;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    return { min, max, media: somma / 60 };
  };
  const f11 = contaFantasmi(11), f12 = contaFantasmi(12), f20 = contaFantasmi(20);
  check('fino all\'11° nel muro non ce n\'è nessuno', f11.max === 0, 'al massimo ' + f11.max);
  check('dal 12° ce n\'è esattamente uno', f12.min === 1 && f12.max === 1,
    'da ' + f12.min + ' a ' + f12.max);
  check('e resta uno anche ai livelli alti', f20.min === 1 && f20.max === 1,
    'da ' + f20.min + ' a ' + f20.max + ' al 20°');

  /* Il fantasma non sta nelle ultime due file: laggiù si romperebbe spesso per
     ultimo, con la pallina che diventa invisibile a muro quasi finito. */
  {
    let inBasso = 0, muri = 0;
    for (let i = 0; i < 60; i++) {
      const g = makeGame(def, util, 14);
      const s = g.game.state();
      muri++;
      if (s.fantasmaRiga != null && s.fantasmaRiga >= s.righe - 2) inBasso++;
    }
    check('e non sta nelle due file di sotto', inBasso === 0,
      inBasso + ' muri su ' + muri + ' col fantasma in fondo');
  }

  const durata12 = makeGame(def, util, 12).game.state().ghostTime;
  const durata20 = makeGame(def, util, 20).game.state().ghostTime;
  check('le sparizioni durano meno alla prima comparsa', durata12 < durata20,
    durata12 + 's -> ' + durata20 + 's');

  /* Effetto turbo: con un giocatore che tiene la pallina in gioco, prima o poi
     cade un mattone turbo e la velocità supera quella del livello. */
  const g5 = makeGame(def, util, 5);
  let peak = 0;
  const sawTurbo = runUntil(g5.game, () => {
    const s = g5.game.state();
    peak = Math.max(peak, s.speed / s.baseSpeed);
    return s.speed > s.baseSpeed * 1.1;
  }, 90, follow(g5.input, g5.game, 'ball'));
  check('un mattone turbo accelera la pallina oltre la velocità del livello', sawTurbo,
    'picco ' + peak.toFixed(2) + '× la velocità di partenza');

  // Il tetto di velocità non si sfonda nemmeno rompendo molti turbo.
  const g9 = makeGame(def, util, 9);
  const overCap = runUntil(g9.game, () => {
    const s = g9.game.state();
    return s.speed > s.baseSpeed * 1.75;
  }, 120, follow(g9.input, g9.game, 'ball'));
  check('la velocità resta sotto il tetto del livello', !overCap);

  // Malus: il punteggio cala quando la pallina torna sulla racchetta.
  const gm = makeGame(def, util, 1);
  let prev = 0;
  const dropped = runUntil(gm.game, () => {
    const sc = gm.events.score;
    const down = sc < prev;
    prev = sc;
    return down;
  }, 90, follow(gm.input, gm.game, 'ball'));
  check('il tocco di racchetta toglie punti', dropped);

  /* Un mattone impazzito deve cambiare direzione più di quanto farebbe un
     rimbalzo normale: si confronta l'angolo prima e dopo la rottura. */
  const gc = makeGame(def, util, 6);
  let prevAngle = null, sawWildTurn = false, prevMatti = null;
  runUntil(gc.game, () => {
    const s = gc.game.state();
    const matti = s.speciali.matto || 0;
    const ang = Math.atan2(s.ball.vy, s.ball.vx);
    if (prevMatti !== null && matti < prevMatti && prevAngle !== null) {
      let d = Math.abs(ang - prevAngle);
      if (d > Math.PI) d = 2 * Math.PI - d;
      // un rimbalzo normale ribalta un asse: qui serve una deviazione che
      // non corrisponda a nessuna delle due riflessioni pulite
      if (d > 0.15 && Math.abs(d - Math.PI) > 0.15) sawWildTurn = true;
    }
    prevMatti = matti;
    prevAngle = ang;
    return sawWildTurn;
  }, 120, follow(gc.input, gc.game, 'ball'));
  check('un mattone impazzito devia la pallina di un angolo qualsiasi', sawWildTurn);

  /* Ai livelli alti la deviazione deve essere ampia: è la richiesta di rendere
     gli speciali più imprevedibili, e senza una misura resterebbe un'opinione. */
  const gw = makeGame(def, util, 10);
  let maxTurn = 0, prevA = null, prevM = null;
  runUntil(gw.game, () => {
    const s = gw.game.state();
    const matti = s.speciali.matto || 0;
    const ang = Math.atan2(s.ball.vy, s.ball.vx);
    if (prevM !== null && matti < prevM && prevA !== null) {
      let d = Math.abs(ang - prevA);
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxTurn = Math.max(maxTurn, Math.min(d, Math.PI - d) + 0);
      if (d > 1.2 && Math.abs(d - Math.PI) > 0.2) maxTurn = Math.max(maxTurn, d);
    }
    prevM = matti;
    prevA = ang;
    return maxTurn > 1.2;
  }, 150, follow(gw.input, gw.game, 'ball'));
  check('agli ultimi livelli le deviazioni superano il quarto di giro',
    maxTurn > 1.2, 'massima osservata ' + maxTurn.toFixed(2) + ' rad');
}

/* ---------- Mattoni: il mattone fantasma ---------- */

console.log('\n[mattoni: pallina a intermittenza]');
{
  const def = defs.mattoni;
  /* I fantasma sono rari per scelta: per osservarne l'effetto si gioca al
     livello 12, dove la quota è più alta, e si riprova su più partite invece
     di sperare che il primo muro ne contenga uno a tiro. */
  let ghostSeen = 0, sparita = false, riapparsa = false, ghostAtStart = 0;
  let g = null, durataLivello = 0;
  for (let tentativo = 0; tentativo < 5 && !(sparita && riapparsa); tentativo++) {
    g = makeGame(def, util, 12);
    durataLivello = g.game.state().ghostTime;
    runUntil(g.game, () => {
      const s = g.game.state();
      if (s.ghost > 0) {
        if (!ghostSeen) ghostAtStart = s.ghost;
        ghostSeen = Math.max(ghostSeen, s.ghost);
        if (!s.ballVisible) sparita = true;
        if (sparita && s.ballVisible) riapparsa = true;
      }
      return sparita && riapparsa;
    }, 150, follow(g.input, g.game, 'ball'));
  }
  check('rompere un fantasma avvia l\'effetto', ghostSeen > 0,
    'partito da ' + ghostAtStart.toFixed(1) + 's, picco ' + ghostSeen.toFixed(1) + 's');
  check('la pallina sparisce e riappare (intermittenza)', sparita && riapparsa);
  check('l\'effetto dura quanto dichiarato dal livello',
    ghostSeen >= durataLivello * 0.9 && ghostSeen <= durataLivello * 1.45,
    ghostSeen.toFixed(1) + 's su ' + durataLivello + 's dichiarati');

  // e deve finire: un effetto che non scade sarebbe una partita al buio
  const g2 = makeGame(def, util, 12);
  let visto = false;
  const scaduto = runUntil(g2.game, () => {
    const s = g2.game.state();
    if (s.ghost > 0) visto = true;
    return visto && s.ghost === 0 && s.ballVisible;
  }, 200, follow(g2.input, g2.game, 'ball'));
  check('l\'effetto scade e la pallina torna visibile', !visto || scaduto);
}

/* ---------- Pong: accorciamento delle racchette ---------- */

console.log('\n[pong: racchette che si accorciano]');
{
  const { game } = makeGame(defs.pong, util, 1);
  const before = game.state();
  runUntil(game, () => false, 25);           // 25s di gioco
  const after = game.state();
  check('la racchetta della CPU si accorcia', after.npc.w < before.npc.w,
    before.npc.w + ' -> ' + after.npc.w);
  check('anche quella del giocatore si accorcia', after.player.w < before.player.w,
    before.player.w + ' -> ' + after.player.w);
}

/* ---------- Hockey: il disco resta nel tavolo ---------- */

console.log('\n[hockey: il disco non esce dal tavolo]');
{
  const def = defs.hockey;
  let escaped = null;

  /* Il mazzuolo spinge di continuo verso lo spigolo: è la situazione in cui il
     disco finiva schiacciato fuori dal tavolo. Si controlla solo a partita in
     corso: dopo il gol decisivo il motore ferma il gioco, mentre qui gli
     aggiornamenti proseguirebbero e il disco uscirebbe legittimamente in porta. */
  for (let match = 0; match < 3 && !escaped; match++) {
    const { game, api, input, events } = makeGame(def, util, 3 + match);
    input.pointer.down = true;
    runUntil(game, () => {
      if (events.outcome) return true;             // partita finita: si ferma qui
      const p = game.state().puck;
      const fuori = p.x < 0 || p.x > api.width || p.y < -20 || p.y > api.height + 20;
      if (fuori) { escaped = p; return true; }
      return false;
    }, 60, () => {
      input.pointer.x = api.width;                 // dito premuto nello spigolo
      input.pointer.y = api.height;
    });
  }
  check('il disco non esce dalle sponde nemmeno schiacciato in un angolo',
    !escaped, escaped ? JSON.stringify(escaped) : '');
}

/* ---------- Forza 4: regole della griglia e forza della CPU ---------- */

console.log('\n[forza 4: regole]');
{
  const def = defs.forza4;

  /* Gioca una colonna toccandola come farebbe una persona, poi lascia scorrere
     il tempo necessario alla caduta del gettone. */
  function tocca(g, colonna) {
    const s = g.game.state();
    g.input.tap(s.colonne[colonna].x, s.colonne[colonna].y);
    runUntil(g.game, () => {
      const st = g.game.state();
      return st.fase !== 'gioco' || (!st.vincente && st.turno !== s.turno) || g.events.outcome;
    }, 3);
  }

  const menu = makeGame(def, util, 1);
  check('la partita si apre con la scelta della modalità', menu.game.state().fase === 'menu');
  const vociMenu = menu.game.state().menu.map((m) => m.modo).join(',');
  check('le due modalità sono offerte', vociMenu === 'cpu,duo', vociMenu);

  // due giocatori: mosse alternate sullo stesso dispositivo
  const duo = makeGame(def, util, 1);
  const m = duo.game.state().menu[1];
  duo.input.tap(m.x, m.y);
  runUntil(duo.game, () => duo.game.state().modo === 'duo', 1);
  check('la modalità in due si attiva', duo.game.state().modo === 'duo');

  const primo = duo.game.state().turno;
  tocca(duo, 6);
  check('dopo la mossa tocca all\'altro giocatore', duo.game.state().turno !== primo,
    primo + ' -> ' + duo.game.state().turno);

  // quattro in fila in orizzontale: rosso sulle colonne 0-3, giallo sopra
  const win = makeGame(def, util, 1);
  const m2 = win.game.state().menu[1];
  win.input.tap(m2.x, m2.y);
  runUntil(win.game, () => win.game.state().modo === 'duo', 1);
  [0, 0, 1, 1, 2, 2, 3].forEach((c) => { if (!win.events.outcome) tocca(win, c); });
  runUntil(win.game, () => !!win.events.outcome, 4);
  check('quattro in fila orizzontale chiude la mano', win.events.outcome === 'win',
    String(win.events.outcome));

  // colonna piena: la mossa viene rifiutata e il turno non cambia
  const full = makeGame(def, util, 1);
  const m3 = full.game.state().menu[1];
  full.input.tap(m3.x, m3.y);
  runUntil(full.game, () => full.game.state().modo === 'duo', 1);
  for (let i = 0; i < 6 && !full.events.outcome; i++) tocca(full, 0);
  const altezza = full.game.state().board[0].filter((v) => v !== 0).length;
  const turnoPrima = full.game.state().turno;
  full.input.tap(full.game.state().colonne[0].x, full.game.state().colonne[0].y);
  runUntil(full.game, () => false, 0.5);
  const dopo = full.game.state();
  check('la colonna piena non accetta altri gettoni',
    altezza === 6 && dopo.board[0].filter((v) => v !== 0).length === 6 && dopo.turno === turnoPrima,
    'altezza ' + altezza);

  /* La CPU dei livelli alti deve battere quasi sempre chi guarda una mossa
     sola: è la definizione operativa di "profondità che cresce". */
  function sceltaSuperficiale(board) {
    const COLS = 7, ROWS = 6;
    const rigaLibera = (b, c) => { for (let r = 0; r < ROWS; r++) if (b[c][r] === 0) return r; return -1; };
    const fa4 = (b, c, r, col) => {
      const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (const [dx, dy] of dirs) {
        let n = 1;
        for (const s2 of [1, -1]) {
          for (let k = 1; k < 4; k++) {
            const x = c + dx * k * s2, y = r + dy * k * s2;
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS || b[x][y] !== col) break;
            n++;
          }
        }
        if (n >= 4) return true;
      }
      return false;
    };
    const libere = [];
    for (let c = 0; c < COLS; c++) if (board[c][ROWS - 1] === 0) libere.push(c);
    for (const c of libere) { const r = rigaLibera(board, c); board[c][r] = 1; const w = fa4(board, c, r, 1); board[c][r] = 0; if (w) return c; }
    for (const c of libere) { const r = rigaLibera(board, c); board[c][r] = 2; const w = fa4(board, c, r, 2); board[c][r] = 0; if (w) return c; }
    libere.sort((x, y) => Math.abs(3 - x) - Math.abs(3 - y));
    // un po' di varietà: due avversari deterministici rigiocherebbero
    // dodici volte la stessa identica partita
    return libere[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * libere.length)];
  }

  /* Campione ampio e soglia prudente. La CPU di livello 9 vince circa il 72%
     delle mani contro questo avversario: con soglie vicine a quel valore il
     controllo fallisce una volta su cinque per pura varianza, quindi si
     verifica la tendenza ("vince nettamente più della metà"), non il numero. */
  let vinteCpu = 0, partite = 24;
  for (let n = 0; n < partite; n++) {
    const g = makeGame(def, util, 9);
    const mm = g.game.state().menu[0];
    g.input.tap(mm.x, mm.y);
    runUntil(g.game, () => {
      const st = g.game.state();
      if (g.events.outcome) return true;
      if (st.fase === 'gioco' && st.turno === 1 && st.modo === 'cpu' && !st.vincente) {
        const c = sceltaSuperficiale(st.board);
        if (c !== undefined) g.input.tap(st.colonne[c].x, st.colonne[c].y);
      }
      return false;
    }, 200);
    if (g.events.outcome === 'lose') vinteCpu++;
  }
  check('al livello 9 la CPU batte nettamente chi guarda una mossa sola',
    vinteCpu >= partite * 0.55, vinteCpu + ' vittorie su ' + partite);
}

/* ---------- Tessere: mescolamento risolvibile e vittoria ---------- */

console.log('\n[tessere: rompicapo scorrevole]');
{
  const def = defs.tessere;

  /* Criterio classico di risolvibilità del quindici: parità delle inversioni,
     corretta con la riga del buco quando il lato è pari. */
  function risolvibile(g, n) {
    const t = g.filter((v) => v !== 0);
    let inv = 0;
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) inv++;
    }
    if (n % 2 === 1) return inv % 2 === 0;
    const rigaDalBasso = n - Math.floor(g.indexOf(0) / n);
    return (rigaDalBasso % 2 === 0) ? (inv % 2 === 1) : (inv % 2 === 0);
  }

  let nonRisolvibili = 0, giaFatte = 0;
  for (const level of [1, 3, 6, 9]) {
    for (let k = 0; k < 120; k++) {
      const s = makeGame(def, util, level).game.state();
      if (!risolvibile(s.griglia, s.n)) nonRisolvibili++;
      if (s.giuste === s.n * s.n - 1) giaFatte++;
    }
  }
  check('ogni mescolamento è risolvibile', nonRisolvibili === 0,
    nonRisolvibili + ' su 480');
  check('non parte mai già risolto', giaFatte === 0, giaFatte + ' su 480');

  // una tessera non adiacente al buco non si muove
  const g1 = makeGame(def, util, 1);
  const s1 = g1.game.state();
  const lontane = s1.caselle.filter((c) => {
    const dr = Math.abs(Math.floor(c.i / s1.n) - Math.floor(s1.buco / s1.n));
    const dc = Math.abs((c.i % s1.n) - (s1.buco % s1.n));
    return c.valore !== 0 && dr + dc > 1;
  });
  g1.input.tap(lontane[0].x, lontane[0].y);
  runUntil(g1.game, () => false, 0.2);
  check('una tessera lontana dal buco non si muove',
    g1.game.state().mosse === 0 && g1.game.state().griglia.join() === s1.griglia.join());

  // una adiacente sì, e finisce nel buco
  const vicina = s1.caselle.find((c) => {
    const dr = Math.abs(Math.floor(c.i / s1.n) - Math.floor(s1.buco / s1.n));
    const dc = Math.abs((c.i % s1.n) - (s1.buco % s1.n));
    return c.valore !== 0 && dr + dc === 1;
  });
  const valoreAtteso = s1.griglia[vicina.i];
  g1.input.tap(vicina.x, vicina.y);
  runUntil(g1.game, () => false, 0.2);
  const s2 = g1.game.state();
  check('la tessera adiacente scivola nel buco',
    s2.griglia[s1.buco] === valoreAtteso && s2.buco === vicina.i && s2.mosse === 1);

  /* Risolverlo davvero: per il 3×3 basta una ricerca in ampiezza, e così si
     verifica la condizione di vittoria invece di darla per buona. */
  function risolvi(griglia, n) {
    const meta = griglia.slice().sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b)).join();
    const partenza = griglia.join();
    if (partenza === meta) return [];
    const coda = [griglia.slice()];
    const visti = new Map([[partenza, null]]);
    while (coda.length) {
      const cur = coda.shift();
      const chiave = cur.join();
      const buco = cur.indexOf(0);
      const r = Math.floor(buco / n), c = buco % n;
      const mosse = [];
      if (r > 0) mosse.push(buco - n);
      if (r < n - 1) mosse.push(buco + n);
      if (c > 0) mosse.push(buco - 1);
      if (c < n - 1) mosse.push(buco + 1);
      for (const m of mosse) {
        const next = cur.slice();
        next[buco] = next[m];
        next[m] = 0;
        const k = next.join();
        if (visti.has(k)) continue;
        visti.set(k, { da: chiave, mossa: m });
        if (k === meta) {
          const percorso = [];
          let passo = { da: chiave, mossa: m };
          let cursore = k;
          while (passo) {
            percorso.unshift(passo.mossa);
            cursore = passo.da;
            passo = visti.get(cursore);
          }
          return percorso;
        }
        coda.push(next);
      }
    }
    return null;
  }

  const gs = makeGame(def, util, 1);
  const iniziale = gs.game.state();
  const percorso = risolvi(iniziale.griglia, iniziale.n);
  check('il mescolamento del livello 1 ha una soluzione', Array.isArray(percorso),
    percorso ? percorso.length + ' mosse' : 'nessuna');
  if (percorso) {
    for (const casella of percorso) {
      if (gs.events.outcome) break;
      const st = gs.game.state();
      gs.input.tap(st.caselle[casella].x, st.caselle[casella].y);
      runUntil(gs.game, () => false, 0.05);
    }
    check('rimettere i numeri in ordine chiude il livello', gs.events.outcome === 'win',
      String(gs.events.outcome));
    check('sistemare le tessere dà punti', gs.events.score > 0, gs.events.score + ' punti');
  }

  // scaduto il tempo la partita finisce
  const gt = makeGame(def, util, 1);
  const finito = runUntil(gt.game, () => !!gt.events.outcome, 200);
  check('allo scadere del tempo la partita finisce', finito && gt.events.outcome === 'lose',
    String(gt.events.outcome));

  /* Il tempo deve crescere con il lato della griglia: un 4×4 non è un 3×3 un
     po' più lungo. Senza questo controllo un ritocco alla formula potrebbe
     rendere di nuovo impossibili i livelli grandi senza che nessuno se ne
     accorga finché non ci gioca. */
  const tempi = [1, 4, 8].map((l) => {
    const info = defs.tessere.levelInfo(l);
    return {
      lato: parseInt(info.match(/griglia (\d)/)[1], 10),
      secondi: parseInt(info.match(/(\d+)s/)[1], 10)
    };
  });
  check('il tempo cresce con la griglia',
    tempi[0].lato === 3 && tempi[1].lato === 4 && tempi[2].lato === 5 &&
    tempi[1].secondi > tempi[0].secondi * 1.5 && tempi[2].secondi > tempi[1].secondi * 1.3,
    tempi.map((t) => t.lato + '×' + t.lato + ' ' + t.secondi + 's').join(', '));

  /* E deve bastare a chi gioca bene: il risolutore muove una tessera ogni
     mezzo secondo, che è già più lento di una persona concentrata. */
  const gp = makeGame(def, util, 1);
  const percorsoTempo = risolvi(gp.game.state().griglia, gp.game.state().n);
  const sufficiente = percorsoTempo &&
    percorsoTempo.length * 0.5 < gp.game.state().timeLeft;
  check('il tempo basta a chi sa cosa fare', !!sufficiente,
    percorsoTempo ? percorsoTempo.length + ' mosse minime in ' + gp.game.state().timeLeft + 's' : '');
}

/* ---------- Labirinto: percorribilità, muri, bussola, uscita ---------- */

console.log('\n[labirinto: mappa che si dimentica]');
{
  const def = defs.labirinto;

  function bfs(s) {
    const n = s.lato, m = s.mappa;
    const k = (x, y) => y * n + x;
    const start = s.giocatore.cella;
    const coda = [[start[0], start[1]]];
    const da = new Map([[k(start[0], start[1]), null]]);
    while (coda.length) {
      const [x, y] = coda.shift();
      if (x === s.uscita[0] && y === s.uscita[1]) {
        const percorso = [];
        let cur = k(x, y), pos = [x, y];
        while (cur !== null && da.get(cur) !== null) {
          percorso.unshift(pos);
          pos = da.get(cur);
          cur = k(pos[0], pos[1]);
        }
        return percorso;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (m[k(nx, ny)] === 1 || da.has(k(nx, ny))) continue;
        da.set(k(nx, ny), [x, y]);
        coda.push([nx, ny]);
      }
    }
    return null;
  }

  let senzaUscita = 0, prove = 0;
  for (const level of [1, 3, 6, 10]) {
    for (let i = 0; i < 60; i++) {
      prove++;
      if (!bfs(makeGame(def, util, level).game.state())) senzaUscita++;
    }
  }
  check('ogni labirinto ha una strada per l\'uscita', senzaUscita === 0,
    senzaUscita + ' senza uscita su ' + prove);

  // i muri fermano: si spinge avanti contro una parete e non si passa
  const gm = makeGame(def, util, 1);
  gm.input.held.up = true;
  // prima si punta il muro alle spalle del punto di partenza
  gm.input.held.left = true;
  runUntil(gm.game, () => false, 1.5);
  gm.input.held.left = false;
  const prima = gm.game.state().giocatore;
  runUntil(gm.game, () => false, 2);
  const dopo = gm.game.state().giocatore;
  const spostamento = Math.hypot(dopo.x - prima.x, dopo.y - prima.y);
  check('dentro il labirinto non si attraversano i muri',
    dopo.x > 0.5 && dopo.y > 0.5 && dopo.x < gm.game.state().lato - 0.5,
    'posizione ' + dopo.x + ',' + dopo.y + ' (spostamento ' + spostamento.toFixed(2) + ')');

  // bussola: puntando il giocatore verso l'uscita l'ago va a zero
  const gb = makeGame(def, util, 2);
  const sb = gb.game.state();
  const angoloGiusto = Math.atan2(sb.uscita[1] + 0.5 - sb.giocatore.y,
                                  sb.uscita[0] + 0.5 - sb.giocatore.x);
  gb.input.held.right = true;
  const puntata = runUntil(gb.game, () => {
    const b = gb.game.state().bussola;
    return Math.abs(Math.atan2(Math.sin(b), Math.cos(b))) < 0.12;
  }, 8);
  gb.input.held.right = false;
  check('la bussola azzera quando guardi verso l\'uscita', puntata,
    'angolo verso l\'uscita ' + angoloGiusto.toFixed(2));

  /* Pilota automatico: segue il percorso trovato dal BFS girandosi e andando
     avanti, come farebbe una persona che sa dove andare. Serve a verificare che
     l'uscita si raggiunga davvero e che il tempo concesso basti. */
  function risolviConPilota(level) {
    const g = makeGame(def, util, level);
    const percorso = bfs(g.game.state());
    if (!percorso) return null;
    let i = 0;
    runUntil(g.game, () => !!g.events.outcome, 400, () => {
      const s = g.game.state();
      const meta = percorso[Math.min(i, percorso.length - 1)];
      const bersaglio = { x: meta[0] + 0.5, y: meta[1] + 0.5 };
      const dx = bersaglio.x - s.giocatore.x, dy = bersaglio.y - s.giocatore.y;
      if (Math.hypot(dx, dy) < 0.25) { i++; return; }
      let diff = Math.atan2(dy, dx) - s.giocatore.ang;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.input.held.left = diff < -0.12;
      g.input.held.right = diff > 0.12;
      g.input.held.up = Math.abs(diff) < 0.5;
    });
    return { esito: g.events.outcome, tempo: g.game.state().timeLeft, punti: g.events.score };
  }

  const r1 = risolviConPilota(1);
  check('seguendo il percorso si arriva all\'uscita', r1 && r1.esito === 'win',
    r1 ? r1.esito + ', ' + r1.tempo.toFixed(0) + 's avanzati' : 'nessun percorso');
  check('esplorare dà punti', r1 && r1.punti > 0, r1 ? r1.punti + ' punti' : '');

  const r8 = risolviConPilota(8);
  check('il tempo basta anche al livello 8 se non ti perdi', r8 && r8.esito === 'win',
    r8 ? r8.esito + ', ' + r8.tempo.toFixed(0) + 's avanzati' : 'nessun percorso');

  // restando fermi il tempo scade
  const gf = makeGame(def, util, 1);
  const scaduto = runUntil(gf.game, () => !!gf.events.outcome, 200);
  check('restando fermi il tempo scade', scaduto && gf.events.outcome === 'lose',
    String(gf.events.outcome));

  /* La mappa a memoria: cresce camminando e sbiadisce da sola. Le due cose
     vanno verificate insieme, altrimenti una mappa che non dimentica passerebbe
     lo stesso il controllo. */
  const gr = makeGame(def, util, 1);
  const partenza = gr.game.state().ricordate;
  gr.input.held.up = true;
  runUntil(gr.game, () => false, 6);
  gr.input.held.up = false;
  const esplorato = gr.game.state();
  check('la mappa si riempie camminando', esplorato.ricordate > partenza,
    partenza + ' -> ' + esplorato.ricordate + ' celle');

  /* Girato verso il muro e fermo: quello che non si guarda più sbiadisce.
     Si misura il totale, non il conteggio: le celle in vista restano a 1. */
  gr.input.held.right = true;
  runUntil(gr.game, () => false, 1);
  gr.input.held.right = false;
  const primaOblio = gr.game.state().ricordoTotale;
  runUntil(gr.game, () => false, 12);
  const dopoOblio = gr.game.state().ricordoTotale;
  check('quello che non guardi più lo dimentichi', dopoOblio < primaOblio,
    primaOblio + ' -> ' + dopoOblio);

  // la memoria dura meno salendo di livello
  const memorie = [1, 5, 10].map((l) => defs.labirinto.levelInfo(l));
  check('ai livelli alti si dimentica prima',
    /memoria della mappa (\d+)s/.test(memorie[0]) &&
    parseInt(memorie[0].match(/memoria della mappa (\d+)s/)[1], 10) >
    parseInt(memorie[2].match(/memoria della mappa (\d+)s/)[1], 10),
    memorie.map((m) => m.split('memoria della mappa ')[1]).join(' / '));
}

/* ---------- Orda: labirinto, mostri che dormono, armi ---------- */

console.log('\n[orda: labirinto e risvegli]');
{
  const def = defs.orda;
  const { creaPilota } = require('./orda-bot');

  /* Il pilota è lo stesso di balance.js: dentro un labirinto muoversi è già un
     problema, e riscriverlo qui vorrebbe dire misurare due giochi diversi. */
  function guida(g, opzioni) {
    const pilota = creaPilota(opzioni || {});
    return function () { pilota(g.game.state(), g.input.stick, DT); };
  }

  const DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];

  /* Il labirinto: tutte le celle raggiungibili (un mostro chiuso in una sacca
     renderebbe il livello impossibile da finire) e con degli anelli, perché in
     un labirinto perfetto ogni fuga finisce in un vicolo cieco. */
  {
    let isolate = 0, aperture = 0, celle = 0, campioni = 0;
    for (let i = 0; i < 12; i++) {
      const s = makeGame(def, util, 1 + i).game.state();
      const G = s.griglia;
      celle = G.righe * G.cols;
      campioni++;
      const visto = [];
      for (let r = 0; r < G.righe; r++) visto.push(new Array(G.cols).fill(false));
      const coda = [{ r: 0, c: 0 }];
      visto[0][0] = true;
      for (let k = 0; k < coda.length; k++) {
        const cur = coda[k];
        for (let d = 0; d < 4; d++) {
          if (!(s.passaggi[cur.r][cur.c] & (1 << d))) continue;
          const nr = cur.r + DR[d], nc = cur.c + DC[d];
          if (nr < 0 || nr >= G.righe || nc < 0 || nc >= G.cols || visto[nr][nc]) continue;
          visto[nr][nc] = true;
          coda.push({ r: nr, c: nc });
        }
      }
      if (coda.length !== celle) isolate++;
      let porte = 0;
      for (let r = 0; r < G.righe; r++) {
        for (let c = 0; c < G.cols; c++) {
          for (let d = 0; d < 4; d++) if (s.passaggi[r][c] & (1 << d)) porte++;
        }
      }
      aperture += porte / 2;
    }
    check('ogni cella del labirinto è raggiungibile', isolate === 0,
      isolate + ' labirinti con sacche isolate');
    // un labirinto perfetto ha esattamente celle-1 passaggi: qui devono essere di più
    check('il labirinto ha degli anelli, non solo vicoli ciechi',
      aperture / campioni > celle - 1 + 8,
      Math.round(aperture / campioni) + ' passaggi contro i ' + (celle - 1) + ' di un labirinto perfetto');
  }

  /* Le camere: il campo è un dungeon, non un labirinto di soli corridoi. Sono
     lo spazio in cui l'orda si accumula, quindi devono esserci davvero, essere
     vuote dentro e avere più di un'uscita — una camera con una porta sola è un
     vicolo cieco grande, e con l'orda dentro è una condanna. */
  {
    let camere = 0, celleCamera = 0, campioni = 0, conUnaPorta = 0, muriDentro = 0;
    for (let i = 0; i < 12; i++) {
      const s = makeGame(def, util, 1 + i).game.state();
      const G = s.griglia;
      campioni++;
      camere += s.stanze.length;
      s.stanze.forEach((st) => {
        celleCamera += st.w * st.h;
        let porte = 0;
        for (let r = st.r0; r < st.r0 + st.h; r++) {
          for (let c = st.c0; c < st.c0 + st.w; c++) {
            for (let d = 0; d < 4; d++) {
              const nr = r + DR[d], nc = c + DC[d];
              const fuori = nr < st.r0 || nr >= st.r0 + st.h || nc < st.c0 || nc >= st.c0 + st.w;
              const aperto = !!(s.passaggi[r][c] & (1 << d));
              if (!fuori && !aperto) muriDentro++;          // dentro non c'è niente
              if (fuori && aperto && nr >= 0 && nc >= 0 && nr < G.righe && nc < G.cols) porte++;
            }
          }
        }
        if (porte < 2) conUnaPorta++;
      });
    }
    check('il campo ha delle camere, non solo corridoi',
      camere / campioni >= 3 && celleCamera / campioni >= 15,
      (camere / campioni).toFixed(1) + ' camere per un totale di ' +
      (celleCamera / campioni).toFixed(1) + ' celle su 108');
    check('dentro le camere non ci sono muri', muriDentro === 0, muriDentro + ' muri interni');
    check('ogni camera ha almeno due uscite', conUnaPorta === 0,
      conUnaPorta + ' camere con una porta sola');
  }

  /* E i mostri si radunano lì: sparpagliati uno per corridoio si incontrano in
     fila indiana, che è esattamente quello che le camere devono togliere. */
  {
    let inCamera = 0, totali = 0;
    for (let i = 0; i < 6; i++) {
      const g = makeGame(def, util, 3);
      // si sta fermi: i mostri appena comparsi dormono dove sono nati
      runUntil(g.game, () => g.game.state().nemici.length >= 6, 12);
      const s = g.game.state();
      const G = s.griglia;
      s.nemici.forEach((n) => {
        const c = Math.floor(n.x / G.cella), r = Math.floor((n.y - G.top) / G.cella);
        totali++;
        if (s.stanze.some((st) => r >= st.r0 && r < st.r0 + st.h && c >= st.c0 && c < st.c0 + st.w)) inCamera++;
      });
    }
    // le camere sono circa un quinto del campo: se il raduno non ci fosse, qui
    // si leggerebbe quel quinto
    check('i mostri si radunano nelle camere', totali > 0 && inCamera / totali > 0.5,
      Math.round(inCamera / totali * 100) + '% dei mostri comparsi è in una camera');
  }

  /* La regola nuova: i mostri stanno fermi finché non ti vedono. Si sta fermi
     lontano da loro e si guarda se qualcuno si muove. */
  {
    const g = makeGame(def, util, 1);
    // si aspetta che l'ondata sia comparsa, senza muoversi
    runUntil(g.game, () => g.game.state().nemici.length >= 3, 6);
    const prima = g.game.state().nemici.map((n) => ({ x: n.x, y: n.y, sveglio: n.sveglio }));
    runUntil(g.game, () => false, 4);
    const dopo = g.game.state().nemici;
    let mossi = 0, sveglioFermo = 0;
    dopo.forEach((n, i) => {
      const p = prima[i];
      if (!p || p.sveglio) return;                 // confronto solo chi dormiva
      if (Math.hypot(n.x - p.x, n.y - p.y) > 1.5 && !n.sveglio) mossi++;
      if (n.sveglio) sveglioFermo++;
    });
    check('chi dorme non si muove', mossi === 0, mossi + ' mostri addormentati spostati');
    check('e restando fermi lontano non si svegliano da soli',
      sveglioFermo <= 1, sveglioFermo + ' svegliati senza motivo');

    // andandogli incontro invece si svegliano
    const sveglia = runUntil(g.game, () => g.game.state().svegli > 0, 25,
      guida(g, { spinta: 1, reazione: 0.12, pesoCasse: 0 }));
    check('avvicinandosi si svegliano', sveglia);
  }

  // i muri fermano tutti: né il giocatore né i mostri li attraversano
  {
    const g = makeGame(def, util, 3);
    const s0 = g.game.state();
    const G = s0.griglia;
    let fuori = 0, dentroMuro = 0;
    const controlla = (x, y, r) => {
      if (x < r - 0.5 || x > G.cols * G.cella - r + 0.5) fuori++;
      if (y < G.top + r - 0.5 || y > G.top + G.righe * G.cella - r + 0.5) fuori++;
      /* Dentro un muro: si guarda il passaggio fra la cella e la vicina nella
         direzione in cui il punto sporge oltre il bordo della propria cella. */
      const c = Math.floor(x / G.cella), rr = Math.floor((y - G.top) / G.cella);
      if (c < 0 || rr < 0 || c >= G.cols || rr >= G.righe) return;
      const ox = x - (c * G.cella + G.cella / 2), oy = y - (G.top + rr * G.cella + G.cella / 2);
      const soglia = G.cella / 2 - G.muro / 2;
      if (oy < -soglia && !(s0.passaggi[rr][c] & 1)) dentroMuro++;
      if (ox > soglia && !(s0.passaggi[rr][c] & 2)) dentroMuro++;
      if (oy > soglia && !(s0.passaggi[rr][c] & 4)) dentroMuro++;
      if (ox < -soglia && !(s0.passaggi[rr][c] & 8)) dentroMuro++;
    };
    runUntil(g.game, () => false, 30, () => {
      guida(g, { spinta: 1, reazione: 0.15, pesoCasse: 1 })();
      const s = g.game.state();
      controlla(s.giocatore.x, s.giocatore.y, 8);
      s.nemici.forEach((n) => controlla(n.x, n.y, n.r));
    });
    check('nessuno finisce fuori dal labirinto', fuori === 0, fuori + ' uscite');
    check('nessuno attraversa i muri', dentroMuro === 0, dentroMuro + ' compenetrazioni');
  }

  // il livello si supera ripulendo il labirinto, e restando fermi il tempo scade
  {
    let vinte = 0;
    for (let i = 0; i < 6; i++) {
      const g = makeGame(def, util, 1);
      runUntil(g.game, () => !!g.events.outcome, 200,
        guida(g, { spinta: 1, reazione: 0.15, errore: 10, pesoCasse: 1 }));
      if (g.events.outcome === 'win') vinte++;
    }
    check('ripulendo il labirinto il livello è superato', vinte >= 5, vinte + ' su 6');

    let scadute = 0;
    for (let i = 0; i < 5; i++) {
      const g = makeGame(def, util, 1);
      runUntil(g.game, () => !!g.events.outcome, 250);
      if (g.events.outcome === 'lose') scadute++;
    }
    check('restando fermi si perde comunque', scadute === 5, scadute + ' su 5');
  }

  /* I mostri compaiono lontano e fuori dalla tua vista: comparire davanti al
     naso sarebbe un dado truccato. */
  {
    const g = makeGame(def, util, 3);
    let vicino = 0, avvisti = 0;
    const pilota = guida(g, { spinta: 1, reazione: 0.15, pesoCasse: 1 });
    runUntil(g.game, () => false, 30, () => {
      const s = g.game.state();
      pilota();
      s.avvisi.filter((a) => a.t > 0.66).forEach((a) => {
        avvisti++;
        if (Math.hypot(a.x - s.giocatore.x, a.y - s.giocatore.y) < 100) vicino++;
      });
    });
    check('ogni mostro è annunciato prima di comparire', avvisti > 8, avvisti + ' avvisi');
    check('nessuno compare addosso al giocatore', vicino === 0, vicino + ' comparse ravvicinate');
  }

  /* Le armi: si raccoglie una cassa, cambia arma, e quando il caricatore
     finisce si torna alla pistola invece di restare senza niente. */
  {
    let cambiata = null, caricatore = 0, tornatiAllaPistola = 0, disarmato = 0;
    /* Livello 8 e otto tentativi: a caricatori dimezzati un'arma si svuota in
       poco più di un terzo delle partite, e con meno prove il controllo
       diventerebbe un dado. */
    for (let i = 0; i < 8; i++) {
      const g = makeGame(def, util, 8);
      if (runUntil(g.game, () => g.game.state().arma !== 'pistola', 40,
          guida(g, { spinta: 1, reazione: 0.12, pesoCasse: 3 }))) {
        cambiata = cambiata || g.game.state().arma;
        caricatore = Math.max(caricatore, g.game.state().colpi);
      }
      // ora si evitano le casse, altrimenti si ricarica prima di restare a secco
      let vistaPistola = false;
      const pilota = guida(g, { spinta: 1, reazione: 0.12, pesoCasse: 0 });
      runUntil(g.game, () => !!g.events.outcome, 120, () => {
        pilota();
        const s = g.game.state();
        if (s.colpi === 0 || (s.colpi === -1 && s.arma !== 'pistola')) disarmato++;
        if (s.arma === 'pistola' && s.colpi === -1) vistaPistola = true;
      });
      if (vistaPistola) tornatiAllaPistola++;
    }
    check('raccogliere una cassa cambia arma', !!cambiata, String(cambiata));
    check('l\'arma raccolta ha un caricatore', caricatore > 0, caricatore + ' colpi');
    check('finite le munizioni si torna alla pistola', tornatiAllaPistola > 0,
      tornatiAllaPistola + ' partite su 8');
    check('non si resta mai disarmati', disarmato === 0, disarmato + ' istanti senza arma');
  }

  // il boss arriva ai livelli multipli di 5, e solo lì
  {
    const g = makeGame(def, util, 5);
    const boss = runUntil(g.game, () => g.game.state().nemici.some((n) => n.tipo === 'boss'),
      200, guida(g, { spinta: 1, reazione: 0.12, pesoCasse: 1 }));
    check('al livello 5 arriva il boss', boss);
    const g4 = makeGame(def, util, 4);
    let fuoriPosto = false;
    runUntil(g4.game, () => {
      if (g4.game.state().nemici.some((n) => n.tipo === 'boss')) fuoriPosto = true;
      return fuoriPosto;
    }, 120, guida(g4, { spinta: 1, reazione: 0.12, pesoCasse: 1 }));
    check('al livello 4 no', !fuoriPosto);
  }

  // i tipi si aggiungono salendo di livello, e i mostri accelerano
  {
    const tipiVisti = (level, secondi) => {
      const g = makeGame(def, util, level);
      const visti = {};
      const pilota = guida(g, { spinta: 1, reazione: 0.15, pesoCasse: 1 });
      runUntil(g.game, () => false, secondi, () => {
        pilota();
        g.game.state().nemici.forEach((n) => { visti[n.tipo] = true; });
      });
      return Object.keys(visti);
    };
    const l1 = tipiVisti(1, 15);
    const l8 = tipiVisti(8, 40);
    check('al livello 1 c\'è un solo tipo di mostro', l1.length === 1 && l1[0] === 'strisciante',
      l1.join(','));
    check('ai livelli alti i tipi convivono', l8.length >= 3, l8.join(','));
    const v = [1, 5, 10].map((l) => makeGame(def, util, l).game.state().velNemici);
    check('i mostri accelerano salendo di livello', v[0] < v[1] && v[1] < v[2],
      v.map((x) => Math.round(x)).join(' / ') + ' px/s');
    // e il tempo tiene conto di quanti sono: più mostri, più secondi
    const tempi = [1, 5, 10].map((l) => makeGame(def, util, l).game.state().timeLeft);
    check('il tempo cresce con il numero di mostri', tempi[0] < tempi[1] && tempi[1] <= tempi[2],
      tempi.join('s / ') + 's');
  }

  /* Stesso seme, stessi comandi, stessa partita: è la proprietà su cui si
     appoggerebbe un duello asincrono, e si rompe alla prima chiamata a
     Math.random() dimenticata nella logica. Qui vale anche per il labirinto. */
  {
    const traccia = (seme) => {
      const g = makeGame(def, util, 3);
      g.game.setSeme(seme);
      g.game.start(3);
      let passi = 0;
      runUntil(g.game, () => false, 12, () => {
        passi++;                                   // comandi identici e ripetibili
        g.input.stick.x = Math.sin(passi / 25);
        g.input.stick.y = Math.cos(passi / 17);
        g.input.stick.attiva = true;
      });
      const s = g.game.state();
      return s.passaggi.map((r) => r.join('')).join('|') + '#' + s.uccisi + ':' + s.rimasti +
        ':' + s.giocatore.x.toFixed(3) + ':' +
        s.nemici.map((n) => n.tipo.charAt(0) + Math.round(n.x) + ',' + Math.round(n.y)).join('/');
    };
    const a = traccia(1234), b = traccia(1234), c = traccia(999);
    check('stesso seme e stessi comandi: partita identica', a === b);
    check('seme diverso, labirinto e partita diversi', a !== c);
  }
}

/* ---------- Pizze: il paese, il calore, le consegne ---------- */

console.log('\n[pizze: consegne a Codiverno]');
{
  const def = defs.pizze;
  const { creaPilota } = require('./pizze-bot');
  const guida = (g, opt) => {
    const p = creaPilota(opt || {});
    return () => p(g.game.state(), g.input.held, DT);
  };
  const CONTO = 3.2;
  const dopoIlVia = (g) => runUntil(g.game, () => g.game.state().stato === 'giro', CONTO + 1);
  const mappa = () => makeGame(def, util, 1).api && global.__mappa;

  /* Il paese: tutte le strade in una rete sola, e ogni civico accostabile
     *dalla strada*. Un indirizzo raggiungibile solo attraversando i campi
     sarebbe una consegna che il gioco chiede e non concede. */
  {
    const s = makeGame(def, util, 1).game.state();
    const m = s.mappa;
    const DR = [];
    // le strade si toccano nei nodi: si visita il grafo dalla pizzeria
    const adj = m.nodi.map(() => []);
    m.archi.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
    const vicino = (x, y) => {
      let b = 0, bd = Infinity;
      m.nodi.forEach((n, i) => { const d = Math.hypot(n[0] - x, n[1] - y); if (d < bd) { bd = d; b = i; } });
      return b;
    };
    const visto = new Array(m.nodi.length).fill(false);
    const q = [vicino(m.pizzeria.ax, m.pizzeria.ay)];
    visto[q[0]] = true;
    for (let i = 0; i < q.length; i++) for (const n of adj[q[i]]) if (!visto[n]) { visto[n] = true; q.push(n); }
    check('tutte le strade del paese sono collegate', q.length === m.nodi.length,
      q.length + ' nodi su ' + m.nodi.length);

    let irraggiungibili = 0, fuoriStrada = 0;
    m.indirizzi.forEach((ind) => {
      if (!visto[vicino(ind.ax, ind.ay)]) irraggiungibili++;
      // il punto di accosto deve stare sull'asfalto, non in mezzo al prato
      let d = Infinity;
      m.strade.forEach((st) => {
        for (let i = 1; i < st.punti.length; i++) {
          const a = st.punti[i - 1], b = st.punti[i];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy || 1;
          let t = ((ind.ax - a[0]) * dx + (ind.ay - a[1]) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          d = Math.min(d, Math.hypot(ind.ax - (a[0] + dx * t), ind.ay - (a[1] + dy * t)));
        }
      });
      if (d > 1) fuoriStrada++;
    });
    check('ogni civico è raggiungibile per strada', irraggiungibili === 0, irraggiungibili + ' isolati');
    check('e ci si accosta stando sull\'asfalto', fuoriStrada === 0, fuoriStrada + ' accessi fuori strada');
    check('la mappa dichiara la propria fonte', !!m.fonte, m.fonte);
  }

  /* Lo stesso turno è sempre lo stesso: un paese si impara, e imparare deve
     servire. Turni diversi sono diversi, altrimenti non si salirebbe. */
  {
    const a = makeGame(def, util, 5).game.state().carico;
    const b = makeGame(def, util, 5).game.state().carico;
    const c = makeGame(def, util, 6).game.state().carico;
    const eti = (x) => x.map((p) => p.via + ' ' + p.civico).join(', ');
    check('lo stesso turno ha sempre gli stessi indirizzi', eti(a) === eti(b), eti(a));
    check('turni diversi, indirizzi diversi', eti(a) !== eti(c));
  }

  /* Il verso dello sterzo. Sembra troppo ovvio da verificare, ed è
     esattamente per questo che è passato inosservato fino a che qualcuno non
     ha giocato: tenendo «destra» l'auto girava a sinistra. `h` è in
     convenzione antioraria (x a est, y a nord), mentre la destra dello
     schermo è il versore (sin h, −cos h), che gira in senso orario: sommare
     invece di sottrarre invertiva tutto. Qui si misura la sola cosa che
     conta, cioè da che parte va il muso rispetto alla destra di chi guida. */
  {
    const versoDestra = (tasto) => {
      const g = makeGame(def, util, 1);
      dopoIlVia(g);
      g.input.held.up = true;
      runUntil(g.game, () => false, 1.2);         // prima si prende velocità
      const h0 = g.game.state().auto.h;
      g.input.held[tasto] = true;
      runUntil(g.game, () => false, 1);
      const h1 = g.game.state().auto.h;
      // componente della nuova direzione lungo la destra di prima
      return Math.cos(h1) * Math.sin(h0) - Math.sin(h1) * Math.cos(h0);
    };
    const d = versoDestra('right'), sx = versoDestra('left');
    check('tenendo ▶ l\'auto gira a destra', d > 0.2, d.toFixed(2));
    check('e tenendo ◀ gira a sinistra', sx < -0.2, sx.toFixed(2));
  }

  /* Il paese è vivo: semafori che si alternano e traffico che gira. Sono le
     due cose che rendono il tempo di percorrenza una faccenda di guida e non
     di sola distanza, quindi vanno verificate come regole, non guardate. */
  {
    const g = makeGame(def, util, 1);
    dopoIlVia(g);
    const s0 = g.game.state();
    check('agli incroci grossi ci sono i semafori', s0.semafori.length >= 3, s0.semafori.length + ' incroci');

    // in un ciclo intero entrambi gli assi devono avere il verde
    const visti = {};
    runUntil(g.game, () => false, 40, () => {
      const s = g.game.state();
      if (s.semafori.length) visti[s.semafori[0].verde] = true;
    });
    check('e si alternano da soli', visti[0] && visti[1], Object.keys(visti).join(' e '));

    // il traffico gira, e tiene la destra invece della mezzeria
    const prima = g.game.state().traffico.map((v) => ({ x: v.x, y: v.y }));
    runUntil(g.game, () => false, 6);
    const dopo = g.game.state().traffico;
    let mosse = 0;
    dopo.forEach((v, i) => { if (prima[i] && Math.hypot(v.x - prima[i].x, v.y - prima[i].y) > 5) mosse++; });
    check('il traffico circola', dopo.length >= 4 && mosse >= dopo.length - 2,
      mosse + ' auto su ' + dopo.length + ' si sono mosse in sei secondi');

    /* La destra si misura sulla mezzeria: il grafo è la riga bianca, e chi ci
       viaggia sopra prende in pieno il primo che arriva in senso opposto. */
    const m = g.game.state().mappa;
    let aDestra = 0, contate = 0;
    dopo.forEach((v) => {
      let best = null;
      m.strade.forEach((st) => {
        for (let i = 1; i < st.punti.length; i++) {
          const a = st.punti[i - 1], b = st.punti[i];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy || 1;
          let t = ((v.x - a[0]) * dx + (v.y - a[1]) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(v.x - (a[0] + dx * t), v.y - (a[1] + dy * t));
          if (!best || d < best.d) best = { d, a, b, px: a[0] + dx * t, py: a[1] + dy * t };
        }
      });
      if (!best || best.d < 0.4) return;      // in mezzo a un incrocio non si sa dire
      contate++;
      // da che parte sta rispetto al proprio verso di marcia
      const lato = Math.cos(v.h) * (v.y - best.py) - Math.sin(v.h) * (v.x - best.px);
      if (lato < 0) aDestra++;
    });
    check('e tiene la destra', contate === 0 || aDestra >= contate - 1,
      aDestra + ' su ' + contate + ' nella propria corsia');
  }

  /* Il rosso ferma anche loro: prima o poi qualcuno resta fermo sotto un
     semaforo. Se non succedesse, il rosso sarebbe una decorazione e passarci
     non costerebbe niente a nessuno. */
  {
    const g = makeGame(def, util, 1);
    dopoIlVia(g);
    let fermaAlRosso = false;
    runUntil(g.game, () => fermaAlRosso, 80, () => {
      const s = g.game.state();
      s.traffico.forEach((v) => {
        if (v.vel > 1.2) return;
        s.semafori.forEach((sem) => {
          if (Math.hypot(sem.x - v.x, sem.y - v.y) < 14) fermaAlRosso = true;
        });
      });
    });
    check('il traffico si ferma ai semafori', fermaAlRosso);
  }

  /* Il calore è il tempo del gioco: scende sempre, anche da fermi. Senza
     questa regola restare immobili sarebbe gratis. */
  {
    const g = makeGame(def, util, 1);
    dopoIlVia(g);
    const prima = g.game.state().carico[0].calore;
    runUntil(g.game, () => false, 5);
    const dopo = g.game.state().carico[0].calore;
    check('il calore scende anche stando fermi', dopo < prima - 0.02,
      Math.round(prima * 100) + '% -> ' + Math.round(dopo * 100) + '%');

    const f = makeGame(def, util, 1);
    const perso = runUntil(f.game, () => !!f.events.outcome, 300);
    check('e restando fermi il turno si perde', perso && f.events.outcome === 'lose',
      f.game.state().freddaDa || '');
  }

  /* Non si consegna passando: bisogna accostare. Si guida sul percorso vero
     — puntare il civico in linea d'aria, in un paese, vuol dire entrare nel
     giardino del vicino e non arrivarci mai — ma senza mai alzare il piede.
     Fermarsi contro un muro vale come fermarsi: il test guarda la velocità
     nell'istante della consegna, non le intenzioni di chi guidava. */
  {
    const g = makeGame(def, util, 1);
    dopoIlVia(g);
    const pilota = guida(g, { reazione: 0.1, errore: 8, ardimento: 1 });
    let passatoVeloce = false, consegneVeloci = 0, consegne = 0, fattePrec = 0;
    runUntil(g.game, () => false, 60, () => {
      const s = g.game.state();
      if (s.fatte > fattePrec) {
        fattePrec = s.fatte;
        consegne++;
        if (s.ultimaConsegna && s.ultimaConsegna.velocita > 4.6) consegneVeloci++;
      }
      pilota();
      g.input.held.up = true;          // gas sempre schiacciato
      g.input.held.down = false;
      if (!s.obiettivo) return;
      const d = Math.hypot(s.obiettivo.x - s.auto.x, s.obiettivo.y - s.auto.y);
      if (d < 12 && Math.abs(s.auto.velocita) > 6) passatoVeloce = true;
    });
    check('si passa sotto casa a tutta velocità senza consegnare',
      passatoVeloce && consegneVeloci === 0,
      passatoVeloce ? consegne + ' consegne, ' + consegneVeloci + ' in corsa' : 'non ci è arrivato');
  }

  /* Il patto del gioco: seguendo il navigatore si arriva in tempo. Il budget
     è calcolato sul giro «alla fermata più vicina», che è quello che il gioco
     stesso suggerisce — se non bastasse, il gioco prometterebbe un margine
     che non dà. */
  {
    const g = makeGame(def, util, 1);
    const pilota = guida(g, { reazione: 0.1, errore: 8, ardimento: 1 });
    /* Qui le consegne avvengono davvero, quindi è qui che si controlla a che
       velocità: la regola «si consegna da fermi» va misurata sulle consegne
       vere, non su un giro in cui non ne succede nessuna. */
    let veloci = 0, viste = 0;
    const vinto = runUntil(g.game, () => !!g.events.outcome, 300, () => {
      const prima = g.game.state();
      pilota();
      // il passo lo fa runUntil subito dopo: si confronta al giro successivo
      if (prima.fatte > viste) {
        viste = prima.fatte;
        if (prima.ultimaConsegna && prima.ultimaConsegna.velocita > 4.6) veloci++;
      }
    });
    const s = g.game.state();
    check('seguendo il navigatore il primo turno si chiude', vinto && g.events.outcome === 'win',
      s.fatte + '/' + s.consegne + (s.freddaDa ? ' — fredda in ' + s.freddaDa : ''));
    check('e ogni consegna avviene al passo d\'uomo', veloci === 0, viste + ' consegne, ' + veloci + ' in corsa');

    const g8 = makeGame(def, util, 8);
    const v8 = runUntil(g8.game, () => !!g8.events.outcome, 420, guida(g8, { reazione: 0.1, errore: 8, ardimento: 1 }));
    check('e anche l\'ottavo, partendo da lì', v8 && g8.events.outcome === 'win',
      g8.game.state().fatte + '/' + g8.game.state().consegne);
  }

  /* Le pizze del carico dopo si raffreddano sul bancone mentre torni a
     prenderle: è il motivo per cui il tempo del giro comprende il rientro. */
  {
    const g = makeGame(def, util, 3);
    const pilota = guida(g, { reazione: 0.1, errore: 8, ardimento: 1 });
    // si consegna il primo carico, poi ci si ferma e si guarda il bancone
    const consegnato = runUntil(g.game, () => g.game.state().carico.some((c) => !c.inMano), 200, pilota);
    if (consegnato) {
      const prima = g.game.state().carico.filter((c) => !c.inMano)[0].calore;
      runUntil(g.game, () => false, 6);
      const bancone = g.game.state().carico.filter((c) => !c.inMano)[0];
      check('le pizze in attesa si raffreddano sul bancone',
        bancone && bancone.calore < prima - 0.02,
        Math.round(prima * 100) + '% -> ' + Math.round((bancone ? bancone.calore : 0) * 100) + '%');
    } else {
      check('le pizze in attesa si raffreddano sul bancone', false, 'nessun carico in attesa osservato');
    }
  }
}

/* ---------- ripartenza: partire da un livello qualsiasi ---------- */

console.log('\n[ripartenza: partenza da livello alto]');
{
  /* Si riprende dal livello più alto raggiunto, quindi una partita può
     cominciare da un livello qualsiasi: start(level) non può dare per scontato
     di essere passato dai precedenti. I livelli provati non sono tondi apposta —
     con la vecchia regola dei multipli di 5 il 7 non capitava mai. */
  const problemi = [];
  [2, 3, 7, 10, 13].forEach((livello) => {
    Object.keys(defs).forEach((id) => {
      try {
        const g = makeGame(defs[id], util, livello);
        for (let i = 0; i < 180; i++) g.game.update(DT);   // tre secondi
        const s = g.game.state ? g.game.state() : null;
        if (s && s.lives != null && s.lives <= 0) problemi.push(id + ' L' + livello + ': parte senza vite');
        if (s && s.timeLeft != null && s.timeLeft <= 0) problemi.push(id + ' L' + livello + ': parte senza tempo');
      } catch (e) {
        problemi.push(id + ' L' + livello + ': ' + e.message);
      }
    });
  });
  check('tutti i giochi partono da un livello qualsiasi, non solo dal primo',
    problemi.length === 0, problemi.join(' | '));

  // e dal livello 1 restano identici a prima
  const daUno = [];
  Object.keys(defs).forEach((id) => {
    try {
      const g = makeGame(defs[id], util, 1);
      for (let i = 0; i < 60; i++) g.game.update(DT);
    } catch (e) {
      daUno.push(id + ': ' + e.message);
    }
  });
  check('e naturalmente anche dal livello 1', daUno.length === 0, daUno.join(' | '));
}

/* ---------- Gregge: il pascolo e il mestiere del cane ---------- */

/* Le pecore non si comandano, si spingono: tutto quello che il gioco promette
   è una conseguenza di quel modello, quindi va verificato che le conseguenze
   ci siano davvero — che il gregge si tenga insieme, che spingendoci in mezzo
   si spacchi, che il dirupo sia un muro per il cane e un pericolo per loro.
   Nel browser niente di questo si raggiungerebbe: servirebbero partite
   intere condotte col joystick. */

/* Un punto di prato libero: niente alberi, dirupi, staccionate o recinto entro
   il raggio chiesto. Le prime versioni di queste prove mettevano la pecora al
   centro del pascolo e via, e qualche volta il centro del pascolo era dentro a
   un pino: la pecora non poteva muoversi e il test dichiarava che non scappava
   dal cane. Una prova che dipende da dove è caduto un albero non misura il
   gioco, misura il seme. */
function pratoLibero(s, raggio) {
  let migliore = null, miglioreSpazio = -1;
  for (let j = 0; j < 14; j++) {
    for (let i = 0; i < 14; i++) {
      const x = 12 + (s.mondo.w - 24) * i / 13;
      const y = 12 + (s.mondo.h - 24) * j / 13;
      let spazio = Math.min(x, y, s.mondo.w - x, s.mondo.h - y);
      s.alberi.forEach((a) => { spazio = Math.min(spazio, Math.hypot(x - a.x, y - a.y) - a.r); });
      const rett = s.dirupi.concat(s.muri, [s.recinto]);
      rett.forEach((r) => {
        const cx = Math.max(r.x, Math.min(x, r.x + r.w));
        const cy = Math.max(r.y, Math.min(y, r.y + r.h));
        spazio = Math.min(spazio, Math.hypot(x - cx, y - cy));
      });
      if (spazio > miglioreSpazio) { miglioreSpazio = spazio; migliore = { x: x, y: y }; }
      if (miglioreSpazio >= raggio) return migliore;
    }
  }
  return migliore;
}

/* Ferma la brucatura: al pascolo le pecore fanno due passi a caso, e su
   finestre brevi quel rumore vale quanto il segnale che si vuole misurare. */
function nonBrucare(s) {
  s.pecore.forEach((p) => { p.pascolo = 999; p.meta = null; });
}

/* Parcheggia le pecore che non interessano nell'angolo più lontano dal
   recinto. Serve perché queste prove isolano una pecora alla volta, e le altre
   devono stare fuori dai piedi — ma «fuori dai piedi» non è un punto fisso: in
   un pascolo col recinto nell'angolo in alto a sinistra, le pecore parcheggiate
   a 14,14 finivano dentro al recinto e venivano contate. Il test misurava
   allora una cosa che non aveva chiesto. */
function parcheggia(s, tranne) {
  const lontano = {
    x: s.recinto.x + s.recinto.w / 2 < s.mondo.w / 2 ? s.mondo.w - 14 : 14,
    y: s.recinto.y + s.recinto.h / 2 < s.mondo.h / 2 ? s.mondo.h - 14 : 14
  };
  let n = 0;
  s.pecore.forEach((q) => {
    if (q === tranne) return;
    q.x = lontano.x + (n % 3) * 4 * (lontano.x > s.mondo.w / 2 ? -1 : 1);
    q.y = lontano.y + Math.floor(n / 3) * 4 * (lontano.y > s.mondo.h / 2 ? -1 : 1);
    q.vx = 0; q.vy = 0;
    n++;
  });
}

console.log('\n[gregge: il pascolo generato]');
{
  const def = defs.gregge;

  /* Percorribilità, controllata da fuori e per ogni pecora: dal punto dove
     nasce ognuna deve esistere una strada fino al recinto, larga abbastanza
     per una pecora. Il gioco ha un suo controllo e rigenera i pascoli che non
     lo passano; questo è un secondo parere scritto in modo diverso (griglia
     più fitta, partenza da ogni pecora e non dal centro del gruppo), perché
     due copie dello stesso errore non si accorgerebbero di niente. */
  function stradaEsiste(s, da, a, raggio) {
    const passo = 3;
    const cols = Math.ceil(s.mondo.w / passo), righe = Math.ceil(s.mondo.h / passo);
    const idx = (i, j) => j * cols + i;
    const libero = (x, y) => {
      if (x < raggio || y < raggio || x > s.mondo.w - raggio || y > s.mondo.h - raggio) return false;
      for (const d of s.dirupi) {
        if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return false;
      }
      for (const a2 of s.alberi) if (Math.hypot(x - a2.x, y - a2.y) < a2.r + raggio) return false;
      for (const m of s.muri) {
        const cx = Math.max(m.x, Math.min(x, m.x + m.w));
        const cy = Math.max(m.y, Math.min(y, m.y + m.h));
        if (Math.hypot(x - cx, y - cy) < raggio) return false;
      }
      return true;
    };
    const cella = (p) => [Math.max(0, Math.min(cols - 1, Math.floor(p.x / passo))),
      Math.max(0, Math.min(righe - 1, Math.floor(p.y / passo)))];
    const [si, sj] = cella(da), [ti, tj] = cella(a);
    const visto = new Uint8Array(cols * righe);
    const coda = [[si, sj]];
    visto[idx(si, sj)] = 1;
    while (coda.length) {
      const [i, j] = coda.pop();
      if (i === ti && j === tj) return true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= righe) continue;
        if (visto[idx(ni, nj)]) continue;
        visto[idx(ni, nj)] = 1;
        if (!libero(ni * passo + passo / 2, nj * passo + passo / 2)) continue;
        coda.push([ni, nj]);
      }
    }
    return false;
  }

  const chiusi = [];
  for (let lv = 1; lv <= 10; lv++) {
    for (let k = 0; k < 6; k++) {
      const g = makeGame(def, util, lv);
      const s = g.game.state();
      const d = s.recinto.dentro;
      const meta = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
      for (const p of s.pecore) {
        if (!stradaEsiste(s, p, meta, 3)) { chiusi.push('L' + lv); break; }
      }
    }
  }
  check('dal gregge al recinto c\'è sempre una strada', chiusi.length === 0, chiusi.join(' '));

  // il cancello non deve essere ostruito: è l'unico passaggio del recinto
  const ostruiti = [];
  for (let lv = 1; lv <= 10; lv++) {
    for (let k = 0; k < 6; k++) {
      const s = makeGame(def, util, lv).game.state();
      const po = s.recinto.porta;
      const cx = po.x + po.w / 2, cy = po.y + po.h / 2;
      s.alberi.forEach((a) => {
        if (Math.hypot(a.x - cx, a.y - cy) < a.r + 8) ostruiti.push('L' + lv);
      });
      s.dirupi.forEach((d) => {
        const qx = Math.max(d.x, Math.min(cx, d.x + d.w));
        const qy = Math.max(d.y, Math.min(cy, d.y + d.h));
        if (Math.hypot(cx - qx, cy - qy) < 12) ostruiti.push('L' + lv);
      });
    }
  }
  check('e il cancello è sempre libero', ostruiti.length === 0, ostruiti.slice(0, 6).join(' '));

  // il tempo concesso deve crescere col lavoro, non essere una cifra fissa
  const tempoMedio = (lv) => {
    let t = 0;
    for (let k = 0; k < 8; k++) t += makeGame(def, util, lv).game.state().tempoTot;
    return t / 8;
  };
  const t1 = tempoMedio(1), t5 = tempoMedio(5), t10 = tempoMedio(10);
  check('il tempo concesso cresce col livello', t1 < t5 && t5 < t10,
    [t1, t5, t10].map((x) => Math.round(x)).join(' < '));
}

console.log('\n[gregge: come si muovono le pecore]');
{
  const def = defs.gregge;

  /* Una pecora sola, il cane a sedici pixel: deve scappare dalla parte
     opposta. È la regola su cui si regge tutto il resto. */
  {
    const g = makeGame(def, util, 1);
    const s = g.game.state();
    const p = s.pecore[0];
    const posto = pratoLibero(s, 26);
    p.x = posto.x; p.y = posto.y; p.vx = 0; p.vy = 0;
    parcheggia(s, p);
    nonBrucare(s);
    s.cane.x = p.x - 16; s.cane.y = p.y;
    const prima = Math.hypot(p.x - s.cane.x, p.y - s.cane.y);
    const x0 = p.x;
    for (let i = 0; i < 45; i++) g.game.update(DT);
    check('la pecora scappa dal cane',
      Math.hypot(p.x - s.cane.x, p.y - s.cane.y) > prima + 3 && p.x > x0,
      'da ' + Math.round(prima) + ' a ' + Math.round(Math.hypot(p.x - s.cane.x, p.y - s.cane.y)) + ' px');
  }

  /* Il cane lontano non spaventa nessuno: senza questa soglia il gregge
     sarebbe comandabile da mezzo pascolo e non ci sarebbe mestiere. */
  {
    const g = makeGame(def, util, 1);
    const s = g.game.state();
    const p = s.pecore[0];
    const posto2 = pratoLibero(s, 26);
    p.x = posto2.x; p.y = posto2.y; p.vx = 0; p.vy = 0;
    parcheggia(s, p);
    s.cane.x = p.x - 70; s.cane.y = p.y;
    const x0 = p.x, y0 = p.y;
    for (let i = 0; i < 60; i++) g.game.update(DT);
    check('da lontano il cane non le sposta', Math.hypot(p.x - x0, p.y - y0) < 8,
      Math.round(Math.hypot(p.x - x0, p.y - y0)) + ' px di deriva al pascolo');
  }

  /* Istinto di gregge: spaventate, si avvicinano fra loro. Il gioco si può
     giocare solo per questo — altrimenti ogni pecora sarebbe un problema a
     sé, dieci volte. */
  {
    const g = makeGame(def, util, 5);
    const s = g.game.state();
    const libere = s.pecore;
    const centro = pratoLibero(s, 46);
    libere.forEach((p, i) => {
      p.x = centro.x + (i % 3) * 26 - 26;
      p.y = centro.y + Math.floor(i / 3) * 26 - 26;
      p.vx = 0; p.vy = 0;
    });
    const sparpaglio = () => {
      const l = libere.filter((p) => p.stato === 'libera');
      const cx = l.reduce((a, p) => a + p.x, 0) / l.length;
      const cy = l.reduce((a, p) => a + p.y, 0) / l.length;
      return Math.max(...l.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    };
    const prima = sparpaglio();
    for (let i = 0; i < 90; i++) {
      // il cane gira attorno al gruppo, a distanza di spavento
      const ang = i * 0.05;
      s.cane.x = centro.x + Math.cos(ang) * 46;
      s.cane.y = centro.y + Math.sin(ang) * 46;
      g.game.update(DT);
    }
    check('spaventate si stringono insieme', sparpaglio() < prima - 2,
      'sparpaglio da ' + Math.round(prima) + ' a ' + Math.round(sparpaglio()) + ' px');
  }

  /* E la promessa scritta nelle istruzioni: arrivargli addosso in mezzo
     spacca il gruppo in due. Se questa non vale, il gioco mente. */
  {
    const g = makeGame(def, util, 6);
    const s = g.game.state();
    const n = s.pecore.length;
    const fila = pratoLibero(s, 52);
    s.pecore.forEach((p, i) => {
      p.x = fila.x + (i - (n - 1) / 2) * 9;
      p.y = fila.y;
      p.vx = 0; p.vy = 0;
    });
    nonBrucare(s);
    s.cane.x = fila.x; s.cane.y = fila.y + 34;
    /* Il cane attraversa la fila e tira dritto. Si guarda il buco più largo
       durante tutta la carica e quello alla fine: la prima versione guardava
       solo l'ultimo istante dopo poco più di un secondo, quando il cane era
       ancora dentro al gruppo e lo stava aprendo — misurava il momento
       sbagliato e dichiarava che il gregge non si spaccava. */
    let buco = 0, finale = 0;
    for (let i = 0; i < 150; i++) {
      s.cane.y -= 30 * DT;
      g.game.update(DT);
      const xs = s.pecore.filter((p) => p.stato === 'libera').map((p) => p.x).sort((a, b) => a - b);
      finale = 0;
      for (let k = 1; k < xs.length; k++) finale = Math.max(finale, xs[k] - xs[k - 1]);
      buco = Math.max(buco, finale);
    }
    check('arrivandogli in mezzo il gregge si spacca in due', buco > 24,
      'buco di ' + Math.round(buco) + ' px nel gruppo');
    /* E le due metà non si ricuciono da sole: se si richiudessero appena
       passato il cane, spaccare il gregge non costerebbe niente e la frase
       nelle istruzioni sarebbe un modo di dire. */
    check('e le due metà restano separate', finale > 20,
      'dopo il passaggio il buco è ancora di ' + Math.round(finale) + ' px');
  }

  /* La pecora nera si fida di più: alla stessa distanza la bianca è già
     partita e lei non si muove.

     Il confronto va fatto di ciascuna con sé stessa, non una con l'altra: nel
     punto in cui le si mette c'è sempre qualcosa — un albero a dodici pixel,
     il bordo del pascolo — che le sposta un poco comunque, e la prima
     versione di questa prova leggeva quello spostamento come paura. Misurare
     la stessa pecora col cane vicino e col cane lontano toglie di mezzo il
     terreno: resta solo la differenza che fa il cane. */
  {
    const def2 = defs.gregge;
    const g = makeGame(def2, util, 7);
    const s = g.game.state();
    const nera = s.pecore.find((p) => p.nera);
    const bianca = s.pecore.find((p) => !p.nera);
    check('ai livelli alti ci sono pecore nere', !!nera);
    if (nera && bianca) {
      const mossa = (p, distanza) => {
        const posto = pratoLibero(s, 30);
        p.x = posto.x; p.y = posto.y; p.vx = 0; p.vy = 0;
        parcheggia(s, p);
        nonBrucare(s);
        const x0 = p.x, y0 = p.y;
        for (let i = 0; i < 72; i++) {
          s.cane.x = p.x - distanza; s.cane.y = p.y;
          g.game.update(DT);
        }
        return Math.hypot(p.x - x0, p.y - y0);
      };
      // 33 px sta fra le due soglie: dentro la paura della bianca, fuori da
      // quella della nera. A 120 px nessuna delle due deve sentire niente.
      const biancaVicino = mossa(bianca, 33);
      const biancaLontano = mossa(bianca, 120);
      const neraVicino = mossa(nera, 33);
      const neraLontano = mossa(nera, 120);
      check('a 33 px la pecora bianca è già partita',
        biancaVicino > biancaLontano + 6,
        'col cane a 33 px ' + biancaVicino.toFixed(1) + ' px, a 120 px ' + biancaLontano.toFixed(1) + ' px');
      check('la nera a quella distanza non si muove',
        neraVicino < neraLontano + 3,
        'col cane a 33 px ' + neraVicino.toFixed(1) + ' px, a 120 px ' + neraLontano.toFixed(1) + ' px');
      // ...ma avvicinandosi scappa anche lei, altrimenti sarebbe inamovibile
      const neraAddosso = mossa(nera, 18);
      check('e avvicinandosi scappa anche lei', neraAddosso > neraVicino + 6,
        'col cane a 18 px ' + neraAddosso.toFixed(1) + ' px');
    }
  }
}

console.log('\n[gregge: recinto e dirupi]');
{
  const def = defs.gregge;

  /* Dentro al recinto si sta tranquille: il cane che entra non le fa uscire.
     Senza questa regola l'ultima pecora costerebbe le prime, e il livello si
     chiuderebbe per logoramento. */
  {
    const g = makeGame(def, util, 2);
    const s = g.game.state();
    const d = s.recinto.dentro;
    const p = s.pecore[0];
    parcheggia(s, p);
    p.x = d.x + d.w / 2; p.y = d.y + d.h / 2;
    g.game.update(DT);
    check('una pecora nel recinto viene contata', g.game.state().dentro === 1 && p.stato === 'recinto',
      p.stato + ', dentro ' + g.game.state().dentro);
    for (let i = 0; i < 180; i++) {
      s.cane.x = p.x + 4; s.cane.y = p.y + 4;   // il cane le sta addosso, dentro
      g.game.update(DT);
    }
    const ancoraDentro = p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h;
    check('e non esce più, nemmeno col cane addosso', ancoraDentro && p.stato === 'recinto',
      Math.round(p.x) + ',' + Math.round(p.y) + ' in ' + JSON.stringify({ x: d.x, y: d.y, w: d.w, h: d.h }));
  }

  /* Il cane non cade: si ferma sul bordo come fa un cane vero. Se cadesse, il
     dirupo sarebbe un pericolo per chi gioca invece di uno strumento da usare
     come sponda. */
  {
    const g = makeGame(def, util, 8);
    const s = g.game.state();
    check('ai livelli alti ci sono dirupi', s.dirupi.length > 0, s.dirupi.length + ' dirupi');
    /* Il lato da cui avvicinarsi non è sempre lo stesso: i dirupi entrano nel
       pascolo da un bordo, quindi quello contro il bordo del mondo non ha
       prato davanti. Si prova da tutti e quattro i lati e si usa il primo
       che ha terreno — prima si partiva sempre da sinistra, e con una forra
       attaccata al bordo sinistro il cane nasceva dentro al vuoto e la prova
       falliva senza che ci fosse niente di rotto. */
    const d = s.dirupi[0];
    const lati = [
      { x: d.x - 8, y: d.y + d.h / 2, vx: 1, vy: 0 },
      { x: d.x + d.w + 8, y: d.y + d.h / 2, vx: -1, vy: 0 },
      { x: d.x + d.w / 2, y: d.y - 8, vx: 0, vy: 1 },
      { x: d.x + d.w / 2, y: d.y + d.h + 8, vx: 0, vy: -1 }
    ].filter((l) => l.x > 6 && l.y > 6 && l.x < s.mondo.w - 6 && l.y < s.mondo.h - 6 &&
      !s.dirupi.some((r) => l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h) &&
      !s.alberi.some((a) => Math.hypot(l.x - a.x, l.y - a.y) < a.r + 5));
    check('il dirupo ha del prato su almeno un lato', lati.length > 0);
    if (lati.length) {
      const l = lati[0];
      s.cane.x = l.x; s.cane.y = l.y;
      g.input.stick.x = l.vx; g.input.stick.y = l.vy; g.input.stick.attiva = true;
      for (let i = 0; i < 150; i++) g.game.update(DT);
      const dentroDirupo = s.cane.x >= d.x && s.cane.x <= d.x + d.w &&
        s.cane.y >= d.y && s.cane.y <= d.y + d.h;
      check('il cane si ferma sul bordo del dirupo', !dentroDirupo,
        'cane a ' + Math.round(s.cane.x) + ',' + Math.round(s.cane.y) +
        ' dirupo x' + d.x + '-' + (d.x + d.w) + ' y' + d.y + '-' + (d.y + d.h));
      g.input.stick.attiva = false; g.input.stick.x = 0; g.input.stick.y = 0;
    }
  }

  /* Una pecora in fuga lungo il bordo non deve cadere: il dirupo per lei è una
     staccionata. Era il difetto peggiore della prima versione — il 96% delle
     cadute misurate avveniva col cane a venti o trenta pixel, cioè passando al
     largo, e perdere una pecora senza poterci fare niente non è difficoltà. */
  {
    const def2 = defs.gregge;
    let provata = false, caduta = false;
    for (let k = 0; k < 10 && !provata; k++) {
      const g = makeGame(def2, util, 8);
      const s = g.game.state();
      if (!s.dirupi.length) continue;
      const d = s.dirupi[0];
      if (d.y < 30) continue;
      const p = s.pecore[0];
      parcheggia(s, p);
      p.x = d.x + d.w / 2; p.y = d.y - 8;         // appena sopra il bordo
      p.vx = 0; p.vy = 0;
      provata = true;
      for (let i = 0; i < 120; i++) {
        s.cane.x = p.x; s.cane.y = p.y - 24;      // spinge verso il vuoto, da lontano
        g.game.update(DT);
        if (p.caduta > 0 || p.stato === 'persa') caduta = true;
      }
    }
    check('una pecora spinta da lontano corre lungo il bordo, non ci casca',
      provata && !caduta, provata ? (caduta ? 'è caduta' : 'salva') : 'nessun dirupo adatto');
  }

  /* Ma all'angolo contro il vuoto ci finisce, ed è una cosa che ha fatto chi
     gioca: dodici pixel sono il cane addosso. */
  {
    const def2 = defs.gregge;
    let provata = false, caduta = false;
    for (let k = 0; k < 10 && !provata; k++) {
      const g = makeGame(def2, util, 8);
      const s = g.game.state();
      if (!s.dirupi.length) continue;
      const d = s.dirupi[0];
      if (d.y < 30) continue;
      const p = s.pecore[0];
      parcheggia(s, p);
      p.x = d.x + d.w / 2; p.y = d.y - 4;
      p.vx = 0; p.vy = 0;
      provata = true;
      for (let i = 0; i < 120; i++) {
        s.cane.x = p.x; s.cane.y = p.y - 7;       // addosso, senza via di scampo
        g.game.update(DT);
        if (p.caduta > 0 || p.stato === 'persa') caduta = true;
      }
    }
    check('schiacciata contro il vuoto, invece, cade', provata && caduta,
      provata ? (caduta ? 'caduta' : 'non cade nemmeno addosso') : 'nessun dirupo adatto');
  }

  /* Oltre la tolleranza il livello è finito: è l'altra condizione di
     sconfitta, e deve essere immediata, non un conteggio che si scopre alla
     fine. */
  {
    const g = makeGame(def, util, 3);
    const s = g.game.state();
    check('al terzo livello si può perdere una pecora sola', s.tolleranza === 1, 'tolleranza ' + s.tolleranza);
    const d = s.dirupi[0];
    if (d) {
      s.pecore[0].x = d.x + d.w / 2; s.pecore[0].y = d.y + d.h / 2;
      for (let i = 0; i < 60; i++) g.game.update(DT);
      check('la prima perdita non chiude la partita', !g.events.outcome && g.game.state().perse === 1,
        'perse ' + g.game.state().perse + ', esito ' + g.events.outcome);
      s.pecore[1].x = d.x + d.w / 2; s.pecore[1].y = d.y + d.h / 2;
      for (let i = 0; i < 60; i++) g.game.update(DT);
      check('la seconda sì', g.events.outcome === 'lose', String(g.events.outcome));
    }
  }
}

console.log('\n[gregge: il mestiere]');
{
  const def = defs.gregge;

  /* Stare fermi deve far perdere: le pecore brucano, non si avviano al
     recinto da sole. È la stessa invariante della colonna «fermo» del banco di
     prova, verificata qui una volta per tutte. */
  {
    const g = makeGame(def, util, 1);
    const s0 = g.game.state();
    let t = 0;
    while (!g.events.outcome && t < s0.tempoTot + 5) { g.game.update(DT); t += DT; }
    check('stando fermi scende la notte e si perde',
      g.events.outcome === 'lose' && g.game.state().dentro === 0,
      'esito ' + g.events.outcome + ', dentro ' + g.game.state().dentro);
  }

  /* E il pilota simulato deve chiudere il primo livello quasi sempre e
     l'ottavo spesso: se non ci riesce lui con la strategia giusta, il livello
     non è difficile, è rotto. */
  function partite(lv, quante) {
    let vinte = 0;
    for (let m = 0; m < quante; m++) {
      const g = makeGame(def, util, lv);
      const pilota = creaPilotaCane({ reazione: 0.14, errore: 6, spinta: 1 });
      let t = 0;
      while (!g.events.outcome && t < 300) {
        pilota(g.game.state(), g.input.stick, DT);
        g.game.update(DT);
        t += DT;
      }
      if (g.events.outcome === 'win') vinte++;
    }
    return vinte;
  }
  /* Le soglie sono larghe di proposito: servono a distinguere «il livello si
     chiude» da «il livello è rotto», non a rimisurare la difficoltà — quella la
     fa test/balance.js con quaranta partite per casella. Con otto partite e una
     soglia a sette, una percentuale vera del 95% faceva fallire il test una
     volta su venti: un test che suona l'allarme a caso è peggio di un test in
     meno, perché insegna a ignorarlo. */
  const v1 = partite(1, 12);
  check('il pilota chiude il primo livello', v1 >= 9, v1 + '/12');
  const v8 = partite(8, 12);
  check('e l\'ottavo almeno un terzo delle volte', v8 >= 4, v8 + '/12');
}

/* ---------- classifica globale (Firebase finto, regole vere) ---------- */

/* Questa parte non si può provare nel browser: vorrebbe dire un progetto
   Firebase vero per ogni esecuzione dei test, e scrivere in una classifica
   pubblica a ogni `node test/regole.js`. Gira invece contro il Firebase finto
   di test/finto-firebase.js, che applica le stesse regole del database — ed è
   lì il valore: fa fallire un client che calcola lo slug del nome in modo
   diverso da come lo ricalcolano le regole, che è il difetto classico di
   questo tipo di integrazione. */

function attendi(ms) { return new Promise((r) => setTimeout(r, ms || 20)); }
function chiama(f, ...args) {
  return new Promise((r) => f(...args, (err, val) => r({ err, val })));
}

/* Un «browser» nuovo: storage proprio, utente anonimo proprio, lo stesso
   database finto. È così che si prova che due persone non possono prendere lo
   stesso nome. */
function browser(finto, versione) {
  return loadCore({
    fetch: finto.fetch,
    classifica: { url: finto.url, chiave: finto.chiave },
    versione: versione || 10
  }).TG;
}

async function provaClassificaGlobale() {
  console.log('\n[classifica globale: spenta]');
  {
    const TG = loadCore({}).TG;                   // nessuna configurazione
    check('senza configurazione la classifica globale è spenta', TG.nuvola.attiva() === false);
    const res = TG.scores.submit('serpente', 120, 3, 1);
    check('e la classifica locale funziona come sempre',
      res.rank === 1 && TG.scores.top('serpente').length === 1 && res.nuvola === 'spenta',
      JSON.stringify({ rank: res.rank, nuvola: res.nuvola }));
    const nome = TG.profile.setName('Niccolò!!');
    check('il nome resta usabile anche senza nuvola', nome === 'Niccolo', nome);

    /* L'interruttore: con la classifica configurata per davvero, c'è un modo
       di aprire la pagina senza entrarci — serve a chi vuole solo giocare e
       al test di fumo, che altrimenti scriverebbe nella classifica vera a
       ogni esecuzione. */
    const finto = creaFintoFirebase({});
    const spento = loadCore({ fetch: finto.fetch, classifica: false }).TG;
    check('l\'interruttore spegne la classifica globale anche se è configurata',
      spento.nuvola.attiva() === false && spento.nuvola.invia('pong', { punti: 10, livello: 1 }) === 'spenta');
  }

  console.log('\n[classifica globale: il nome si prende]');
  {
    const finto = creaFintoFirebase({});
    const uno = browser(finto);
    const r1 = await chiama(uno.nuvola.prendiNome, 'Teo');
    check('il primo prende il nome', !r1.err && r1.val === 'Teo', (r1.err && r1.err.message) || r1.val);
    check('e resta scritto su questo browser', uno.nuvola.nome() === 'Teo', uno.nuvola.nome());

    const due = browser(finto);
    const r2 = await chiama(due.nuvola.prendiNome, 'teo');
    check('un altro giocatore non può prendere lo stesso nome',
      !!r2.err && r2.err.preso === true, (r2.err && r2.err.message) || 'nessun errore');
    const r3 = await chiama(due.nuvola.prendiNome, 'Teo 2');
    check('ma uno libero sì', !r3.err && r3.val === 'Teo 2', (r3.err && r3.err.message) || r3.val);

    /* Lo slug del client e quello delle regole devono coincidere a una
       lettera: se non coincidono il server rifiuta il punteggio di chiunque
       abbia un nome con uno spazio o un accento, dopo averlo accettato a
       schermo. */
    const tre = browser(finto);
    const r4 = await chiama(tre.nuvola.prendiNome, 'Niccolò Rossi');
    check('accenti e spazi passano la pulizia', !r4.err && r4.val === 'Niccolo Rossi',
      (r4.err && r4.err.message) || r4.val);
    tre.nuvola.invia('serpente', { punti: 90, livello: 2, da: 1 });
    await attendi(30);
    const righe = finto.dati.punteggi.serpente || {};
    const scritta = Object.keys(righe).map((k) => righe[k]).filter((r) => r.nome === 'Niccolo Rossi');
    check('e il punteggio di un nome con lo spazio viene accettato dalle regole',
      scritta.length === 1 && scritta[0].punti === 90, JSON.stringify(righe));

    const r5 = await chiama(uno.nuvola.prendiNome, 'Giocatore');
    check('il nome di default non si può prendere', !!r5.err, (r5.err && r5.err.message) || 'accettato');
  }

  console.log('\n[classifica globale: cosa ci finisce]');
  {
    const finto = creaFintoFirebase({});
    const TG = browser(finto);
    check('senza nome non si invia niente', TG.nuvola.invia('pong', { punti: 50, livello: 1 }) === 'senza-nome');
    await chiama(TG.nuvola.prendiNome, 'Teo');

    TG.nuvola.invia('pong', { punti: 100, livello: 2, da: 1 });
    await attendi(30);
    check('il primo risultato va in classifica',
      (finto.dati.punteggi.pong || {}).uid1.punti === 100, JSON.stringify(finto.dati.punteggi.pong));

    check('un risultato peggiore non si invia nemmeno',
      TG.nuvola.invia('pong', { punti: 60, livello: 1, da: 1 }) === 'non-record');
    TG.nuvola.invia('pong', { punti: 300, livello: 5, da: 1 });
    await attendi(30);
    const righe = finto.dati.punteggi.pong;
    check('uno migliore sostituisce il proprio',
      Object.keys(righe).length === 1 && righe.uid1.punti === 300 && righe.uid1.livello === 5,
      JSON.stringify(righe));
    check('una riga per giocatore, non una per partita', Object.keys(righe).length === 1);
    check('un punteggio assurdo non parte', TG.nuvola.invia('pong', { punti: 99999999, livello: 2 }) === 'assurdo');
  }

  console.log('\n[classifica globale: la rete che non c\'è]');
  {
    const finto = creaFintoFirebase({});
    const TG = browser(finto);
    await chiama(TG.nuvola.prendiNome, 'Teo');

    finto.guasto(true);
    TG.nuvola.invia('talpe', { punti: 100, livello: 2, da: 1 });
    await attendi(30);
    TG.nuvola.invia('talpe', { punti: 400, livello: 4, da: 1 });
    TG.nuvola.invia('talpe', { punti: 250, livello: 3, da: 1 });
    await attendi(30);
    check('con la rete giù il risultato resta in coda', TG.nuvola.inAttesa() === 1, TG.nuvola.inAttesa() + ' in coda');
    check('e in coda ci sta solo il migliore', !finto.dati.punteggi.talpe);

    finto.guasto(false);
    const r = await chiama(TG.nuvola.sincronizza);
    await attendi(30);
    check('tornata la rete il risultato parte da solo',
      !r.err && (finto.dati.punteggi.talpe || {}).uid1.punti === 400,
      JSON.stringify(finto.dati.punteggi.talpe || {}));
    check('e la coda si svuota', TG.nuvola.inAttesa() === 0, TG.nuvola.inAttesa() + ' in coda');

    /* Una partita finita senza rete deve comunque essere registrata in locale:
       la classifica globale è un extra, non una condizione per giocare. */
    finto.guasto(true);
    const res = TG.scores.submit('talpe', 500, 5, 1);
    check('la partita si registra in locale anche con la rete giù',
      res.rank === 1 && res.nuvola === 'in-corso', JSON.stringify({ rank: res.rank, nuvola: res.nuvola }));
    finto.guasto(false);
  }

  console.log('\n[classifica globale: la lettura]');
  {
    const finto = creaFintoFirebase({});
    const TG = browser(finto);
    await chiama(TG.nuvola.prendiNome, 'Teo');
    // dodici avversari già in classifica, con punteggi mescolati
    finto.dati.punteggi.hockey = {};
    for (let i = 1; i <= 12; i++) {
      finto.dati.nomi['gente-' + i] = 'altro' + i;
      finto.dati.punteggi.hockey['altro' + i] = {
        nome: 'gente ' + i, punti: (i * 37) % 500, livello: 1 + (i % 9), da: 1, quando: 1000 + i, v: 10
      };
    }
    TG.nuvola.invia('hockey', { punti: 260, livello: 6, da: 1 });
    await attendi(30);

    const r = await chiama(TG.nuvola.top, 'hockey');
    const righe = r.val || [];
    check('la classifica arriva senza errori', !r.err, r.err && r.err.message);
    check('sono dieci righe, non tutte', righe.length === 10, righe.length + ' righe su 13');
    const ordinate = righe.every((x, i) => i === 0 || righe[i - 1].punti >= x.punti);
    check('ordinate dal punteggio più alto', ordinate, righe.map((x) => x.punti).join(' '));
    const io = righe.filter((x) => x.io);
    check('la propria riga è segnata', io.length === 1 && io[0].nome === 'Teo',
      JSON.stringify(io.map((x) => x.nome)));
    const tutti = Object.keys(finto.dati.punteggi.hockey).map((k) => finto.dati.punteggi.hockey[k].punti);
    const soglia = tutti.sort((a, b) => b - a)[9];
    check('e chi sta sotto la decima posizione resta fuori',
      righe.every((x) => x.punti >= soglia), 'soglia ' + soglia);
  }

  console.log('\n[classifica globale: cambiare nome]');
  {
    const finto = creaFintoFirebase({});
    const TG = browser(finto);
    await chiama(TG.nuvola.prendiNome, 'Teo');
    TG.nuvola.invia('tessere', { punti: 100, livello: 2, da: 1 });
    await attendi(30);
    const r = await chiama(TG.nuvola.prendiNome, 'Michele');
    await attendi(40);
    check('cambiando nome la riga già in classifica si aggiorna',
      !r.err && (finto.dati.punteggi.tessere || {}).uid1.nome === 'Michele',
      JSON.stringify(finto.dati.punteggi.tessere || {}));
  }

  console.log('\n[classifica globale: le regole del database]');
  {
    const testo = fs.readFileSync(path.join(ROOT, 'dati/regole-firebase.json'), 'utf8');
    let regole = null;
    try { regole = JSON.parse(testo).rules; } catch (e) { /* lo dice il check qui sotto */ }
    check('il file delle regole è JSON valido', !!regole);
    if (regole) {
      check('la radice non è leggibile né scrivibile',
        regole['.read'] === false && regole['.write'] === false);
      const riga = regole.punteggi.$gioco.$uid;
      check('nessuno può scrivere la riga di un altro',
        riga['.write'].indexOf('auth.uid === $uid') >= 0 && riga['.write'].indexOf('auth != null') >= 0,
        riga['.write']);
      check('il punteggio non può scendere',
        riga['.write'].indexOf("newData.child('punti').val() >= data.child('punti').val()") >= 0);
      check('e non si firma col nome di un altro',
        riga['.validate'].indexOf("root.child('nomi')") >= 0 && riga['.validate'].indexOf('auth.uid') >= 0,
        riga['.validate']);
      check('i campi estranei sono rifiutati',
        riga.$altro['.validate'] === false || riga.$altro['.validate'] === 'false',
        String(riga.$altro['.validate']));
      check('la classifica è leggibile da tutti e indicizzata sui punti',
        regole.punteggi.$gioco['.read'] === true && regole.punteggi.$gioco['.indexOn'] === 'punti');
      check('i nomi presi non sono elencabili da fuori', regole.nomi.$slug['.read'] === false);
      check('e un nome si prende solo se libero o già proprio',
        regole.nomi.$slug['.write'].indexOf('!data.exists() || data.val() === auth.uid') >= 0,
        regole.nomi.$slug['.write']);
    }
  }
}

/* I controlli della nuvola sono asincroni: il riepilogo aspetta anche loro,
   altrimenti il processo uscirebbe «TUTTO OK» prima di averli fatti. */
provaClassificaGlobale().then(function () {
  console.log(failures === 0 ? '\nTUTTO OK' : '\n' + failures + ' CONTROLLI FALLITI');
  process.exit(failures === 0 ? 0 : 1);
}, function (e) {
  console.log('  FAIL la prova della classifica globale è andata in errore — ' + e.message);
  console.log('\n' + (failures + 1) + ' CONTROLLI FALLITI');
  process.exit(1);
});
