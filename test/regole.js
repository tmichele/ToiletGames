/* Verifica delle meccaniche che il test nel browser non riesce a raggiungere.

   Alcune regole compaiono solo a livelli avanzati (i mattoni speciali, per
   esempio, dal secondo e dal terzo livello): pilotare il browser fin lì
   richiederebbe partite intere. Qui i giochi girano nella sandbox, si mette lo
   stato nella condizione voluta e si guarda cosa succede.

   Uso:  node test/regole.js */

const { loadGames, makeGame } = require('./sandbox');

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
  const l1 = kindsAt(1), l3 = kindsAt(3), l6 = kindsAt(6);
  check('al livello 1 il muro è tutto normale', Object.keys(l1).length === 0, Object.keys(l1).join(','));
  check('turbo e impazziti compaiono entro il livello 3', l3.turbo && l3.matto, Object.keys(l3).join(','));
  check('i fantasma non compaiono prima del livello 4', !l3.fantasma, Object.keys(l3).join(','));
  check('corazzati e fantasma arrivano più avanti', l6.corazzato && l6.fantasma, Object.keys(l6).join(','));

  /* Il fantasma è l'effetto più duro: deve entrare in punta di piedi. Si
     controlla che al quinto livello sia raro e breve, e che cresca piano. */
  const quotaFantasma = (level) => {
    let visti = 0, muri = 0;
    for (let i = 0; i < 60; i++) {
      const s = makeGame(def, util, level).game.state();
      visti += s.speciali.fantasma || 0;
      muri += s.bricks;
    }
    return visti / muri;
  };
  const q5 = quotaFantasma(5), q12 = quotaFantasma(12);
  check('al quinto livello i fantasma sono pochi', q5 > 0 && q5 < 0.06,
    (q5 * 100).toFixed(1) + '% del muro');
  check('e diventano più frequenti solo salendo', q12 > q5,
    (q5 * 100).toFixed(1) + '% -> ' + (q12 * 100).toFixed(1) + '%');

  const durata5 = makeGame(def, util, 5).game.state().ghostTime;
  const durata12 = makeGame(def, util, 12).game.state().ghostTime;
  check('anche le sparizioni durano meno all\'inizio', durata5 < durata12,
    durata5 + 's -> ' + durata12 + 's');

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

/* ---------- Orda: ondate, armi, boss ---------- */

console.log('\n[orda: ondate e armi]');
{
  const def = defs.orda;

  /* Un giocatore che scappa e raccoglie: le stesse spinte del bot di
     balance.js, ridotte all'osso. Serve solo a tenere viva la partita mentre si
     osservano le meccaniche — la difficoltà la misura l'altro test. */
  function pilota(g, pesoCasse) {
    return function () {
      const s = g.game.state();
      let fx = 0, fy = 0;
      s.nemici.forEach((n) => {
        const dx = s.giocatore.x - n.x, dy = s.giocatore.y - n.y;
        const d = Math.max(10, Math.hypot(dx, dy) - n.r);
        fx += dx / d * (9000 / (d * d));
        fy += dy / d * (9000 / (d * d));
      });
      // pesoCasse: 0 le ignora, positivo le insegue, negativo le evita
      if (pesoCasse && s.casse.length) {
        const c = s.casse[0];
        const d = Math.hypot(c.x - s.giocatore.x, c.y - s.giocatore.y) || 1;
        fx += (c.x - s.giocatore.x) / d * pesoCasse;
        fy += (c.y - s.giocatore.y) / d * pesoCasse;
      }
      fx += 90 / Math.max(10, s.giocatore.x) - 90 / Math.max(10, 360 - s.giocatore.x);
      fy += 90 / Math.max(10, s.giocatore.y - 46) - 90 / Math.max(10, 540 - s.giocatore.y);
      const len = Math.hypot(fx, fy) || 1;
      g.input.stick.x = fx / len;
      g.input.stick.y = fy / len;
      g.input.stick.attiva = true;
    };
  }

  // il livello finisce quando finiscono le ondate, non a tempo
  let vinte = 0, ondateViste = 0;
  for (let i = 0; i < 6; i++) {
    const g = makeGame(def, util, 1);
    runUntil(g.game, () => !!g.events.outcome, 200, pilota(g, 0));
    if (g.events.outcome === 'win') vinte++;
    ondateViste = Math.max(ondateViste, g.game.state().ondata);
  }
  check('pulite tutte le ondate il livello è superato', vinte === 6, vinte + ' su 6');
  check('il livello 1 ha le ondate dichiarate', ondateViste === 2, ondateViste + ' ondate');

  /* Restando fermi si viene travolti. Si guarda al livello 6, dove non c'è
     partita: al primo livello la torretta la spunta ogni tanto (lo dice anche
     la colonna «fermo» di balance.js) e un controllo al 5% di fallimento non è
     un controllo, è un dado. */
  let perse = 0;
  for (let i = 0; i < 6; i++) {
    const g = makeGame(def, util, 6);
    runUntil(g.game, () => !!g.events.outcome, 200);
    if (g.events.outcome === 'lose') perse++;
  }
  check('restando fermi si viene travolti', perse === 6, perse + ' su 6');

  /* I mostri compaiono sul bordo e mai addosso: l'avviso è il patto con chi
     gioca, e va controllato dove sta, non solo che ci sia. */
  {
    const g = makeGame(def, util, 3);
    let vicino = 0, avvisti = 0, dentro = 0;
    const guida = pilota(g, 0);
    runUntil(g.game, () => false, 25, () => {
      const s = g.game.state();
      guida();
      /* Solo gli avvisi appena apparsi: la garanzia è sulla distanza al momento
         dell'annuncio. Se poi sei tu a camminare verso il cerchietto rosso,
         quello è affar tuo — il cerchietto si vede. */
      s.avvisi.filter((a) => a.t > 0.66).forEach((a) => {
        avvisti++;
        if (Math.hypot(a.x - s.giocatore.x, a.y - s.giocatore.y) < 100) vicino++;
        if (a.x > 30 && a.x < 330 && a.y > 76 && a.y < 510) dentro++;
      });
    });
    check('ogni mostro è annunciato prima di comparire', avvisti > 20, avvisti + ' avvisi');
    check('nessuno compare addosso al giocatore', vicino === 0, vicino + ' comparse ravvicinate');
    check('e nemmeno in mezzo al campo', dentro === 0, dentro + ' comparse interne');
  }

  /* Le armi: si raccoglie una cassa, cambia arma, e quando il caricatore
     finisce si torna alla pistola invece di restare senza niente.

     Il ritorno alla pistola si osserva su più partite: le casse cadono dove
     muore il mostro, quindi ogni tanto una finisce sotto i piedi e si ricarica
     senza volerlo. L'invariante «mai disarmati», invece, va controllata a ogni
     istante di ogni partita — è quella che conta. */
  {
    let cambiata = null, caricatore = 0, tornatiAllaPistola = 0, disarmato = 0, vive = 0;
    for (let i = 0; i < 5; i++) {
      const g = makeGame(def, util, 4);        // dal quarto livello una cassa c'è già
      if (runUntil(g.game, () => g.game.state().arma !== 'pistola', 30, pilota(g, 25))) {
        cambiata = cambiata || g.game.state().arma;
        caricatore = Math.max(caricatore, g.game.state().colpi);
      }
      // ora si evitano le casse, altrimenti si ricarica prima di restare a secco
      let vistaPistola = false;
      const guida = pilota(g, -60);
      // ci si ferma se la partita finisce: da morto non si spara, e il
      // caricatore non si svuoterebbe mai
      runUntil(g.game, () => !!g.events.outcome, 90, () => {
        guida();
        const s = g.game.state();
        if (s.colpi === 0 || (s.colpi === -1 && s.arma !== 'pistola')) disarmato++;
        if (s.arma === 'pistola' && s.colpi === -1) vistaPistola = true;
      });
      if (!g.events.outcome) vive++;
      if (vistaPistola) tornatiAllaPistola++;
    }
    check('raccogliere una cassa cambia arma', !!cambiata, String(cambiata));
    check('l\'arma raccolta ha un caricatore', caricatore > 0, caricatore + ' colpi');
    check('finite le munizioni si torna alla pistola', tornatiAllaPistola > 0,
      tornatiAllaPistola + ' partite su 5 (' + vive + ' arrivate in fondo vive)');
    check('non si resta mai disarmati', disarmato === 0, disarmato + ' istanti senza arma');
  }

  // il boss arriva ai livelli multipli di 5, e solo lì
  {
    const g = makeGame(def, util, 5);
    const boss = runUntil(g.game, () => g.game.state().nemici.some((n) => n.tipo === 'boss'),
      200, pilota(g, 25));
    check('al livello 5 arriva il boss', boss);
    const g4 = makeGame(def, util, 4);
    let bossFuoriPosto = false;
    runUntil(g4.game, () => {
      if (g4.game.state().nemici.some((n) => n.tipo === 'boss')) bossFuoriPosto = true;
      return bossFuoriPosto;
    }, 60, pilota(g4, 0));
    check('al livello 4 no', !bossFuoriPosto);
  }

  // i tipi si aggiungono salendo di livello, e i mostri accelerano
  {
    const tipiVisti = (level, secondi) => {
      const g = makeGame(def, util, level);
      const visti = {};
      const guida = pilota(g, 0);
      runUntil(g.game, () => false, secondi, () => {
        guida();
        g.game.state().nemici.forEach((n) => { visti[n.tipo] = true; });
      });
      return Object.keys(visti);
    };
    const l1 = tipiVisti(1, 12);
    const l8 = tipiVisti(8, 20);
    check('al livello 1 c\'è un solo tipo di mostro', l1.length === 1 && l1[0] === 'strisciante',
      l1.join(','));
    check('ai livelli alti i tipi convivono', l8.length >= 3, l8.join(','));
    const v = [1, 5, 10].map((l) => makeGame(def, util, l).game.state().velNemici);
    check('i mostri accelerano salendo di livello', v[0] < v[1] && v[1] < v[2],
      v.map((x) => Math.round(x)).join(' / ') + ' px/s');
  }

  /* Stesso seme, stessi comandi, stessa partita: è la proprietà su cui si
     appoggerebbe un duello asincrono, e si rompe alla prima chiamata a
     Math.random() dimenticata nella logica. */
  {
    const traccia = (seme) => {
      const g = makeGame(def, util, 3);
      g.game.setSeme(seme);
      g.game.start(3);
      let passi = 0;
      runUntil(g.game, () => false, 10, () => {
        passi++;                                   // comandi identici e ripetibili
        g.input.stick.x = Math.sin(passi / 25);
        g.input.stick.y = Math.cos(passi / 17);
        g.input.stick.attiva = true;
      });
      const s = g.game.state();
      return s.uccisi + ':' + s.rimasti + ':' + s.giocatore.x.toFixed(3) + ':' +
        s.nemici.map((n) => n.tipo.charAt(0) + Math.round(n.x) + ',' + Math.round(n.y)).join('|');
    };
    const a = traccia(1234), b = traccia(1234), c = traccia(999);
    check('stesso seme e stessi comandi: partita identica', a === b,
      a.slice(0, 40) + ' vs ' + b.slice(0, 40));
    check('seme diverso, partita diversa', a !== c, c.slice(0, 40));
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

console.log(failures === 0 ? '\nTUTTO OK' : '\n' + failures + ' CONTROLLI FALLITI');
process.exit(failures === 0 ? 0 : 1);
