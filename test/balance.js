/* Banco di prova per la difficoltà.

   La logica dei giochi è JavaScript puro (il disegno è l'unica parte che tocca
   il canvas), quindi si può eseguire fuori dal browser: qui i giochi vengono
   caricati in una sandbox, pilotati da un giocatore simulato e fatti girare a
   tempo compresso. Serve a rispondere a domande come "al livello 1 un giocatore
   medio vince?" senza doversi mettere a giocare cento partite.

   Uso:  node test/balance.js            tutti i giochi, livelli 1..10
         node test/balance.js pong 1 5   solo pong, livelli 1..5 */

const { loadGames, makeInput, SFX } = require('./sandbox');
const { creaPilota } = require('./orda-bot');
const { creaPilota: creaPilotaRally } = require('./rally-bot');

const DT = 1 / 60;            // passo fisso di simulazione
const MAX_SECONDS = 240;      // taglio di sicurezza per partite che non finiscono
const MATCHES = 40;           // partite per livello e per profilo


/* Una partita: il bot guida, il gioco gira, si guarda come finisce. */
function playMatch(def, util, level, bot) {
  const input = makeInput();
  let score = 0;
  let outcome = null;

  const api = {
    width: def.viewport.w,
    height: def.viewport.h,
    util,
    sfx: SFX,
    input,
    level,
    score,
    addScore(n) { score = Math.max(0, score + Math.round(n || 0)); api.score = score; },
    setScore(n) { score = Math.max(0, Math.round(n || 0)); api.score = score; },
    levelComplete(o) { if (!outcome) outcome = { win: true, bonus: (o && o.bonus) || 0 }; },
    gameOver() { if (!outcome) outcome = { win: false }; }
  };

  const game = def.create(api);
  game.start(level);
  if (!game.state) throw new Error(def.id + ': serve state() per misurare la difficoltà');

  const brain = bot(api, game);
  let t = 0;
  while (!outcome && t < MAX_SECONDS) {
    brain(game.state(), DT);
    game.update(DT);
    t += DT;
  }
  return { win: !!(outcome && outcome.win), timeout: !outcome, seconds: t, score, state: game.state() };
}

/* ---------- giocatori simulati ----------
   reaction: ritardo con cui il bot "vede" la palla
   error:    quanto sbaglia la posizione
   speed:    quanto in fretta muove la mano */

const PROFILES = [
  /* Il primo profilo non tocca niente: serve a verificare un'invariante, cioè
     che stare fermi faccia perdere. Se questa colonna non è a zero il gioco si
     vince senza giocare, ed è un difetto grave quanto un livello impossibile. */
  { name: 'fermo', idle: true },
  { name: 'scarso', reaction: 0.40, error: 46, speed: 240 },
  { name: 'medio', reaction: 0.22, error: 22, speed: 340 },
  { name: 'bravo', reaction: 0.10, error: 8, speed: 480 }
];

/* Ritardo di reazione: il bot insegue la posizione di qualche istante fa. */
function delayLine(profile) {
  const buf = [];
  return function (value, dt) {
    buf.push({ v: value, t: (buf.length ? buf[buf.length - 1].t : 0) + dt });
    const now = buf[buf.length - 1].t;
    while (buf.length > 1 && now - buf[0].t > profile.reaction) buf.shift();
    return buf[0].v;
  };
}

/* Il bot muove il puntatore verso il bersaglio a velocità limitata: è così che
   un umano gioca, e mantiene confrontabili i risultati fra i giochi. */
function makeHand(api, profile, startX, startY) {
  const p = api.input.pointer;
  p.x = startX; p.y = startY; p.down = true;
  return function (tx, ty, dt) {
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = profile.speed * dt;
    if (d <= step || d === 0) { p.x = tx; p.y = ty; }
    else { p.x += dx / d * step; p.y += dy / d * step; }
  };
}

const BOTS = {
  /* Il pong si gioca solo a tasti: il bot li tiene premuti come farebbe un
     pollice, quindi la sua velocità è quella della racchetta, non della mano. */
  pong: (profile) => (api, game) => {
    const delay = delayLine(profile);
    const err = (Math.random() * 2 - 1) * profile.error;
    return function (s, dt) {
      const target = delay(s.ball.x, dt) + err;
      const dx = target - s.player.x;
      api.input.held.left = dx < -6;
      api.input.held.right = dx > 6;
    };
  },

  /* Anche i mattoni si giocano a tasti. Quando la pallina è invisibile (mattone
     fantasma) il bot non la vede: continua verso l'ultima posizione nota, come
     farebbe una persona. Senza questo, l'effetto non comparirebbe nei numeri. */
  mattoni: (profile) => (api, game) => {
    const delay = delayLine(profile);
    const err = (Math.random() * 2 - 1) * profile.error;
    let lastSeen = api.width / 2;
    return function (s, dt) {
      if (s.ballVisible !== false) lastSeen = s.ball.x;
      const target = delay(lastSeen, dt) + err;
      const dx = target - s.paddle.x;
      api.input.held.left = dx < -6;
      api.input.held.right = dx > 6;
    };
  },

  /* Le talpe si giocano a tocchi: il bot ne dà uno ogni tanto (la sua "mano") e
     vede solo quelle fuori da abbastanza tempo (la sua reazione).

     Talpe e bombe sono grigie uguali, distinguibili solo dalla miccia: il bot
     legge lo stato e le distinguerebbe sempre, quindi la confusione va simulata
     a mano. È una stima, non una misura: serve solo perché i numeri non
     descrivano un gioco più facile di quello vero. */
  talpe: (profile) => (api, game) => {
    const tapEvery = 0.55 - profile.speed / 1600;
    const sbagliaBuca = profile.error / 200;
    const confondeBomba = profile.error / 120;
    let attesa = 0;
    return function (s, dt) {
      attesa -= dt;
      if (attesa > 0) return;
      const viste = s.buche.filter((b) => b.tipo && b.eta >= profile.reaction);
      if (!viste.length) return;
      const talpe = viste.filter((b) => b.tipo === 'talpa');
      const bombe = viste.filter((b) => b.tipo === 'bomba');
      let scelta;
      if (Math.random() < sbagliaBuca) {
        scelta = viste[Math.floor(Math.random() * viste.length)];    // buca sbagliata
      } else if (bombe.length &&
                 Math.random() < confondeBomba * (bombe[0].invertito ? 2 : 1)) {
        scelta = bombe[0];               // scambiata per talpa: più facile se invertita
      } else if (talpe.length) {
        scelta = talpe[0];
      } else {
        return;                                                      // solo bombe: aspetta
      }
      api.input.tap(scelta.x, scelta.y);
      attesa = tapEvery;
    };
  },

  /* In Orda si spara da soli: l'unica cosa che il bot decide è dove stare.
     Dentro un labirinto la decisione non è una direzione ma una cella, quindi
     il pilota sta in test/orda-bot.js e ragiona per corridoi. La prima versione
     sommava spinte di allontanamento come negli altri giochi: nel campo aperto
     funzionava, fra i muri restava a strofinarsi sugli spigoli.

     La reazione diventa l'intervallo fra due decisioni, l'errore la tendenza a
     scegliere una cella peggiore, la velocità quanto affonda la leva. */
  orda: (profile) => (api, game) => {
    const pilota = creaPilota({
      spinta: Math.min(1, profile.speed / 400),
      reazione: Math.max(0.12, profile.reaction),
      errore: profile.error,
      pesoCasse: 1
    });
    return function (s, dt) { pilota(s, api.input.stick, dt); };
  },

  /* Il pilota del rally sta in test/rally-bot.js, condiviso con regole.js:
     segue la stessa regola con cui il gioco stima il giro ideale, quindi il
     tempo massimo è battibile per costruzione. La reazione è l'intervallo fra
     due decisioni, l'errore fa sbagliare la mira, la velocità della mano
     diventa l'ardimento: quanto vicino al limite dell'auto si spinge. */
  rally: (profile) => (api, game) => {
    const pilota = creaPilotaRally({
      reazione: profile.reaction,
      errore: profile.error,
      ardimento: 0.55 + 0.45 * (profile.speed - 240) / 240
    });
    return function (s, dt) { pilota(s, api.input.held, dt); };
  },

  /* Il bot dell'hockey ragiona come la CPU: si mette dietro al disco e poi ci
     passa attraverso verso la porta avversaria; altrimenti torna a coprire. */
  hockey: (profile) => (api, game) => {
    const mid = api.height / 2;
    // il mazzuolo sta sopra il dito: il bot punta più in basso per compensare
    const lift = (game.state().grabLift || 0);
    const hand = (tx, ty, dt) => rawHand(tx, ty + lift, dt);
    const rawHand = makeHand(api, profile, api.width / 2, api.height - 70 + lift);
    const delay = delayLine(profile);
    const err = (Math.random() * 2 - 1) * profile.error;
    let charging = false;
    return function (s, dt) {
      const px = delay(s.puck.x, dt) + err;
      const py = s.puck.y;
      const p = api.input.pointer;
      if (py > mid + 6) {
        // mira il lato di porta lasciato scoperto dal portiere avversario
        const half = s.goalCpu / 2;
        const aim = api.width / 2 + (s.cpu.x < api.width / 2 ? 1 : -1) * half * 0.7;
        const dx = px - aim, dy = py - 0;          // dalla porta avversaria al disco
        const len = Math.hypot(dx, dy) || 1;
        const behind = { x: px + dx / len * 26, y: py + dy / len * 26 };
        if (!charging && Math.hypot(p.x - behind.x, p.y - behind.y) < 18) charging = true;
        if (charging) hand(aim, 0, dt);            // attraversa il disco e tira
        else hand(behind.x, behind.y, dt);
      } else {
        charging = false;
        hand(api.width / 2 + (px - api.width / 2) * 0.6, api.height - 60, dt);
      }
    };
  }
};

/* ---------- esecuzione ---------- */

function main() {
  const { defs, util } = loadGames();
  const only = process.argv[2];
  const from = parseInt(process.argv[3], 10) || 1;
  const to = parseInt(process.argv[4], 10) || 10;

  const ids = Object.keys(BOTS).filter((id) => (!only || id === only) && defs[id]);
  if (!ids.length) {
    console.error('Nessun gioco da provare. Disponibili: ' + Object.keys(BOTS).join(', '));
    process.exit(1);
  }

  ids.forEach((id) => {
    const def = defs[id];
    console.log('\n=== ' + def.title + ' (' + MATCHES + ' partite per casella) ===');
    console.log('livello  ' + PROFILES.map((p) => p.name.padEnd(14)).join('') + 'note');

    for (let level = from; level <= to; level++) {
      const cells = [];
      let timeouts = 0;
      let seconds = 0;
      PROFILES.forEach((profile) => {
        let wins = 0;
        const maker = profile.idle ? () => () => () => {} : BOTS[id];
        for (let i = 0; i < MATCHES; i++) {
          const r = playMatch(def, util, level, maker(profile));
          if (r.win) wins++;
          if (r.timeout) timeouts++;
          seconds += r.seconds;
        }
        const pct = Math.round(wins / MATCHES * 100);
        cells.push((pct + '% vinte').padEnd(14));
      });
      const avg = (seconds / (MATCHES * PROFILES.length)).toFixed(0);
      console.log(
        String(level).padEnd(9) + cells.join('') +
        (timeouts ? timeouts + ' partite infinite! ' : '') + '~' + avg + 's a partita'
      );
    }
  });

  console.log('\nLettura: la colonna "fermo" deve stare a 0% ovunque (chi non gioca');
  console.log('non vince), al livello 1 un giocatore medio dovrebbe vincere quasi');
  console.log('sempre, e la percentuale deve calare salendo di livello. Le "partite');
  console.log('infinite" sono stalli: vanno corretti, non tollerati.');
}

main();
