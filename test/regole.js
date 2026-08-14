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
    return s.speed > s.baseSpeed * 2 + 5;
  }, 120, follow(g9.input, g9.game, 'ball'));
  check('la velocità resta sotto il tetto (2× quella del livello)', !overCap);

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
  const g = makeGame(def, util, 8);   // quota fantasma alta abbastanza da beccarne uno
  let ghostSeen = 0, sparita = false, riapparsa = false, ghostAtStart = 0;

  runUntil(g.game, () => {
    const s = g.game.state();
    if (s.ghost > 0) {
      if (!ghostSeen) ghostAtStart = s.ghost;
      ghostSeen = Math.max(ghostSeen, s.ghost);
      if (!s.ballVisible) sparita = true;
      if (sparita && s.ballVisible) riapparsa = true;
    }
    return sparita && riapparsa;
  }, 180, follow(g.input, g.game, 'ball'));

  check('rompere un fantasma avvia l\'effetto', ghostSeen > 0,
    'partito da ' + ghostAtStart.toFixed(1) + 's, picco ' + ghostSeen.toFixed(1) + 's');
  check('la pallina sparisce e riappare (intermittenza)', sparita && riapparsa);
  check('l\'effetto dura circa dieci secondi', ghostSeen >= 9 && ghostSeen <= 14.1,
    ghostSeen.toFixed(1) + 's');

  // e deve finire: un effetto che non scade sarebbe una partita al buio
  const g2 = makeGame(def, util, 8);
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

console.log(failures === 0 ? '\nTUTTO OK' : '\n' + failures + ' CONTROLLI FALLITI');
process.exit(failures === 0 ? 0 : 1);
