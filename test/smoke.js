/* Test di fumo della suite: apre index.html da file:// con Chromium headless
   e verifica elenco, partite, classifiche e avanzamento di livello.

   Uso:  npx playwright@1 install chromium   (una volta sola)
         node test/smoke.js
   Con un Chromium già presente:  CHROMIUM_PATH=/percorso/chrome node test/smoke.js */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const errors = [];
let failures = 0;

function check(name, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) failures++;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL);
  await sleep(300);

  console.log('\n[home]');
  const cards = await page.$$('.card');
  check('9 giochi in elenco', cards.length === 9, cards.length + ' trovati');
  check('titoli presenti', (await page.textContent('#game-grid')).includes('Serpente'));

  const canvasHash = () => page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0;
    return h;
  });

  // ---- Serpente: si muove, il livello 1 è giocabile ----
  console.log('\n[serpente]');
  await page.click('.card:has-text("Serpente")');
  check('overlay iniziale visibile', await page.isVisible('#overlay'));
  await page.click('.btn:has-text("Gioca")');
  await sleep(200);
  check('overlay chiuso dopo Gioca', !(await page.isVisible('#overlay')));
  const h1 = await canvasHash();
  await page.keyboard.press('ArrowUp');
  await sleep(700);
  const h2 = await canvasHash();
  check('il campo si aggiorna', h1 !== h2);
  check('stato running', (await page.evaluate(() => TG.engine.getState())) === 'running');
  // punteggio: forzo qualche boccone consumando food via API interne non esposte -> verifico solo che non crashi
  await sleep(1500);
  check('nessun crash dopo 2s', (await page.evaluate(() => TG.engine.getState())) !== 'idle');

  // pausa + ripresa
  await page.click('#btn-pause');
  await sleep(150);
  check('pausa mostra overlay', await page.isVisible('#overlay'));
  await page.click('.btn:has-text("Riprendi")');
  await sleep(150);
  check('ripresa', (await page.evaluate(() => TG.engine.getState())) === 'running');
  await page.click('#btn-back');
  await sleep(200);
  check('ritorno alla home', await page.isVisible('#view-home'));

  // ---- Memoria: sequenza e game over per timeout ----
  console.log('\n[memoria]');
  await page.click('.card:has-text("Memoria")');
  await page.click('.btn:has-text("Gioca")');
  await sleep(2500);
  const phase = await page.evaluate(() => document.getElementById('canvas').toDataURL().length);
  check('canvas disegnato', phase > 1000);
  await sleep(6000); // nessun tocco -> tempo scaduto
  check('game over per timeout', (await page.textContent('#overlay-title')).includes('finita'),
    await page.textContent('#overlay-title'));
  const boardText = await page.textContent('#board');
  check('risultato in classifica', /L\d/.test(boardText), boardText.trim().slice(0, 60));

  // il tap sui riquadri viene letto: o segna punti (giusto) o chiude la partita (sbagliato)
  await page.click('.btn:has-text("Rigioca")');
  await sleep(3000);
  const box = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.4);
  await sleep(400);
  const afterTap = await page.evaluate(() => ({ s: TG.engine.getScore(), st: TG.engine.getState() }));
  check('tap sul riquadro registrato', afterTap.s > 0 || afterTap.st === 'over', JSON.stringify(afterTap));
  await page.click('#btn-back');

  // ---- Pong: la CPU segna e chiude la partita ----
  console.log('\n[pong]');
  await page.click('.card:has-text("Pong")');
  await page.click('.btn:has-text("Gioca")');
  await sleep(1000);
  check('pong parte', (await page.evaluate(() => TG.engine.getState())) === 'running');
  /* Restare fermi deve far perdere terreno. Quanto duri l'intera partita ha
     una coda lunga (a volte oltre il minuto e mezzo), quindi qui si verifica
     l'andamento; che "fermo non vinca mai" lo misura test/balance.js su
     centinaia di partite. Intanto si controlla l'accorciamento delle racchette. */
  const w0 = await page.evaluate(() => TG.engine.inspect().game);
  let g = w0, minNpcW = w0.npc.w, minMyW = w0.player.w;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const cur = await page.evaluate(() => TG.engine.getState() === 'running' ? TG.engine.inspect().game : null);
    if (!cur) break;
    g = cur;
    minNpcW = Math.min(minNpcW, cur.npc.w);
    minMyW = Math.min(minMyW, cur.player.w);
    // non basta il punteggio: serve tempo perché scatti almeno un
    // accorciamento (ogni 9,5s al primo livello), altrimenti si misura nulla
    if (cur.cpuPts >= 3 && i >= 13) break;
  }
  /* Qui si verifica solo che la CPU giochi e segni: chiedere che sia in
     vantaggio significherebbe scommettere su una singola partita, e il
     giocatore fermo vince comunque il 3% delle volte al primo livello. Che
     "fermo non vinca quasi mai" lo misura balance.js su centinaia di partite. */
  check('la CPU segna mentre resti fermo', g.cpuPts >= 2, g.myPts + '-' + g.cpuPts);
  check('la racchetta della CPU si accorcia', minNpcW < w0.npc.w, w0.npc.w + ' -> ' + minNpcW);
  check('anche la tua si accorcia', minMyW < w0.player.w, w0.player.w + ' -> ' + minMyW);
  await page.click('#btn-back');
  await sleep(200);
  check('card mostra il record', (await page.textContent('.card:has-text("Memoria")')).includes('record'));

  // ---- Mattoni: parte da sola, si gioca a tasti ----
  console.log('\n[mattoni]');
  await page.click('.card:has-text("Mattoni")');
  await page.click('.btn:has-text("Gioca")');
  check('mattoni ha due tasti grandi',
    (await page.$$('#touch-controls .bigpad__btn')).length === 2);
  check('niente pulsante LANCIA', (await page.$$('#touch-controls .action-btn')).length === 0);
  await sleep(2000);
  check('la pallina parte da sola', await page.evaluate(() => TG.engine.inspect().game.launched));
  /* Il test gioca davvero: insegue la pallina con i tasti. Lasciando la
     racchetta ferma il risultato dipendeva dalla fortuna, e infatti ogni tanto
     la pallina non la toccava mai in venti secondi. */
  const mattoniIniziali = await page.evaluate(() => TG.engine.inspect().game.bricks);
  let rotti = 0, malus = 0, premuto = null;
  for (let i = 0; i < 240; i++) {
    const s = await page.evaluate(() => TG.engine.getState() === 'running' ? TG.engine.inspect().game : null);
    if (!s) break;
    rotti = Math.max(rotti, mattoniIniziali - s.bricks);
    malus = Math.max(malus, s.malus);
    const dx = s.ball.x - s.paddle.x;
    const vuole = dx < -6 ? 'ArrowLeft' : (dx > 6 ? 'ArrowRight' : null);
    if (vuole !== premuto) {
      if (premuto) await page.keyboard.up(premuto);
      if (vuole) await page.keyboard.down(vuole);
      premuto = vuole;
    }
    if (rotti >= 3 && malus > 0) break;
    await sleep(80);
  }
  if (premuto) await page.keyboard.up(premuto);
  check('i mattoni si rompono', rotti >= 3, rotti + ' su ' + mattoniIniziali);
  check('il tocco di racchetta toglie punti', malus > 0, malus + ' punti tolti');
  await page.click('#btn-back');

  // ---- motore: avanzamento di livello e chiusura partita, con un gioco finto ----
  console.log('\n[motore]');
  await page.evaluate(() => {
    window.__cmd = null;
    TG.registry.register({
      id: 'zzztest', title: 'Test', icon: '🧪', tagline: 'gioco di prova',
      controls: 'none', viewport: { w: 200, h: 200 },
      levelInfo: function (l) { return 'prova livello ' + l; },
      create: function (api) {
        return {
          start: function () {},
          update: function () {
            if (window.__cmd === 'win') { window.__cmd = null; api.addScore(100); api.levelComplete({ bonus: 10 }); }
            if (window.__cmd === 'lose') { window.__cmd = null; api.gameOver({ message: 'fine prova' }); }
          },
          draw: function (ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 200, 200); }
        };
      }
    });
  });
  await page.evaluate(() => { location.hash = '#/g/zzztest'; });
  await sleep(300);
  check('info livello nel pannello iniziale',
    (await page.textContent('#overlay-body')).includes('prova livello 1'),
    await page.textContent('#overlay-body'));
  await page.click('.btn:has-text("Gioca")');
  await sleep(200);
  await page.evaluate(() => { window.__cmd = 'win'; });
  await sleep(400);
  check('livello superato mostra il riepilogo', (await page.textContent('#overlay-title')).includes('Livello 1 superato'));
  check('bonus sommato al punteggio', (await page.textContent('#hud-score')) === '110', await page.textContent('#hud-score'));
  await page.click('.btn:has-text("Livello 2")');
  await sleep(300);
  check('si passa al livello 2', (await page.textContent('#hud-level')) === '2');
  check('il punteggio non si azzera fra i livelli', (await page.textContent('#hud-score')) === '110');
  await page.evaluate(() => { window.__cmd = 'lose'; });
  await sleep(400);
  check('game over registrato al livello giusto', /L2/.test(await page.textContent('#board')), await page.textContent('#board'));
  check('nuovo record segnalato', (await page.textContent('#overlay-body')).includes('record'));
  await page.click('.btn:has-text("Rigioca")');
  await sleep(300);
  check('rigioca riparte dal livello 1', (await page.textContent('#hud-level')) === '1');
  check('rigioca azzera il punteggio', (await page.textContent('#hud-score')) === '0');
  await page.click('#btn-back');

  // ---- Air Hockey: la CPU segna, il disco non si incastra ----
  console.log('\n[hockey]');
  await page.goto(URL + '#/g/hockey');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  let hkGoal = false, stuck = false;
  for (let i = 0; i < 70; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => TG.engine.inspect());
    if (s.game.cpuGoals > 0 || s.game.myGoals > 0) hkGoal = true;
    if (s.game.puck.x < 0 || s.game.puck.x > 360 || s.game.puck.y < -20 || s.game.puck.y > 620) stuck = true;
    if (s.state !== 'running') break;
  }
  check('il disco resta dentro il tavolo', !stuck);
  check('la partita produce gol', hkGoal);
  check('hockey senza pad a schermo', await page.evaluate(() =>
    document.getElementById('touch-controls').hidden));

  // il mazzuolo resta sopra il dito, non ci finisce sotto.
  // Si passa dalla home: rinavigare allo stesso hash non ricarica nulla.
  await page.goto(URL);
  await sleep(200);
  await page.goto(URL + '#/g/hockey');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  const hbox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const toLogic = (cy) => (cy - hbox.y) / hbox.h * 600;
  const touchY = hbox.y + hbox.h * 0.85;
  await page.mouse.move(hbox.x + hbox.w / 2, touchY);
  await page.mouse.down();
  await page.mouse.move(hbox.x + hbox.w / 2, touchY, { steps: 3 });
  await sleep(600);
  const my = await page.evaluate(() => TG.engine.inspect().game.me.y);
  await page.mouse.up();
  check('il mazzuolo sta sopra il punto toccato', toLogic(touchY) - my > 30,
    'dito a ' + Math.round(toLogic(touchY)) + ', mazzuolo a ' + my);

  // ---- controlli del pong: due tasti larghi, niente trascinamento ----
  console.log('\n[controlli]');
  await page.goto(URL + '#/g/pong');
  await sleep(400);
  const bigBtns = await page.$$('#touch-controls .bigpad__btn');
  check('pong ha due tasti grandi', bigBtns.length === 2, bigBtns.length + ' trovati');
  const wide = await page.$eval('#touch-controls .bigpad', el => el.getBoundingClientRect().width);
  const stageW = await page.$eval('#stage', el => el.getBoundingClientRect().width);
  check('i tasti occupano tutta la larghezza', Math.abs(wide - stageW) < 2, wide + ' vs ' + stageW);
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  const before = await page.evaluate(() => TG.engine.inspect().game.player.x);
  const cbox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(cbox.x + 20, cbox.y + cbox.h - 40);
  await page.mouse.down();
  await page.mouse.move(cbox.x + 20, cbox.y + cbox.h - 40, { steps: 5 });
  await sleep(400);
  await page.mouse.up();
  const after = await page.evaluate(() => TG.engine.inspect().game.player.x);
  check('il trascinamento non muove la racchetta', Math.abs(after - before) < 3, before + ' -> ' + after);

  // ---- mattoni: combo e malus ----
  console.log('\n[combo mattoni]');
  await page.goto(URL + '#/g/mattoni');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(200);
  await page.keyboard.press('Space');
  /* Il punteggio può solo salire (mattoni) o scendere per il malus del tocco
     di racchetta: un calo fra due campioni è la prova che il malus si applica. */
  let peak = 0;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const s = await page.evaluate(() => TG.engine.inspect());
    peak = Math.max(peak, s.game.combo);
    if (s.state !== 'running') break;
  }
  check('la combo cresce rompendo i mattoni', peak >= 1, 'massimo ' + peak);

  // ---- Talpe: le talpe escono e si colpiscono col tocco ----
  console.log('\n[talpe]');
  await page.goto(URL + '#/g/talpe');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  const tbox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  let colpita = false, vista = false;
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => TG.engine.inspect());
    if (s.state !== 'running') break;
    const t = s.game.buche.find(b => b.tipo === 'talpa');
    if (t) {
      vista = true;
      await page.mouse.click(tbox.x + t.x / 360 * tbox.w, tbox.y + t.y / 420 * tbox.h);
      await sleep(150);
      if ((await page.evaluate(() => TG.engine.inspect().game.presi)) > 0) { colpita = true; break; }
    }
    await sleep(200);
  }
  check('le talpe escono dalle buche', vista);
  check('il tocco sulla talpa la prende', colpita);
  check('il tempo del livello scorre',
    (await page.evaluate(() => TG.engine.inspect().game.timeLeft)) < 42);

  // ---- Forza 4: scelta modalità, mossa e risposta della CPU ----
  console.log('\n[forza 4]');
  await page.goto(URL + '#/g/forza4');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  check('si apre la scelta della modalità',
    (await page.evaluate(() => TG.engine.inspect().game.fase)) === 'menu');
  const fbox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const toScreen = (x, y) => ({ x: fbox.x + x / 360 * fbox.w, y: fbox.y + y / 380 * fbox.h });
  // le voci del menu sono esposte con il centro: si tocca lì, come un dito
  const voce = (i) => page.evaluate((k) => TG.engine.inspect().game.menu[k], i);
  const centroCpu = await voce(0);
  const pc = toScreen(centroCpu.x, centroCpu.y);
  await page.mouse.click(pc.x, pc.y);
  await sleep(300);
  check('si sceglie la sfida contro la CPU',
    (await page.evaluate(() => TG.engine.inspect().game.modo)) === 'cpu',
    await page.evaluate(() => TG.engine.inspect().game.modo));

  const col = (await page.evaluate(() => TG.engine.inspect().game.colonne))[3];
  const pcol = toScreen(col.x, col.y);
  await page.mouse.click(pcol.x, pcol.y);
  await sleep(2000);
  const dopoMossa = await page.evaluate(() => TG.engine.inspect().game);
  const gettoni = dopoMossa.board.flat().filter(v => v !== 0).length;
  check('il gettone scende e la CPU risponde', gettoni >= 2, gettoni + ' gettoni sulla griglia');
  check('la CPU gioca con il giallo',
    dopoMossa.board.flat().filter(v => v === 2).length >= 1);

  /* 1 vs 1: toccare la seconda voce deve scegliere davvero il duo. Il tocco
     produceva anche un'azione, e l'azione confermava la voce evidenziata (la
     prima): partiva sempre la sfida contro la CPU. Si controlla la modalità e
     poi il comportamento, perché è quello che si vede giocando: dopo la mossa
     del rosso tocca a un umano, quindi la griglia deve restare ferma.
     Si ripassa dalla home: rinavigare allo stesso hash non ricarica nulla. */
  await page.goto(URL);
  await sleep(200);
  await page.goto(URL + '#/g/forza4');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  const centroDuo = await voce(1);
  const pd = toScreen(centroDuo.x, centroDuo.y);
  await page.mouse.click(pd.x, pd.y);
  await sleep(300);
  check('si sceglie il gioco in due',
    (await page.evaluate(() => TG.engine.inspect().game.modo)) === 'duo',
    await page.evaluate(() => TG.engine.inspect().game.modo));
  const colDuo = (await page.evaluate(() => TG.engine.inspect().game.colonne))[2];
  const pcd = toScreen(colDuo.x, colDuo.y);
  await page.mouse.click(pcd.x, pcd.y);
  await sleep(2000);
  const duoDopo = await page.evaluate(() => TG.engine.inspect().game);
  check('in due il tocco cala un solo gettone',
    duoDopo.board.flat().filter(v => v !== 0).length === 1,
    duoDopo.board.flat().filter(v => v !== 0).length + ' gettoni');
  check('in due la CPU non gioca: il turno resta al secondo umano',
    duoDopo.turno === 2 && duoDopo.board.flat().filter(v => v === 2).length === 0);
  // e il secondo giocatore muove dallo stesso dispositivo
  const colDuo2 = (await page.evaluate(() => TG.engine.inspect().game.colonne))[4];
  const pcd2 = toScreen(colDuo2.x, colDuo2.y);
  await page.mouse.click(pcd2.x, pcd2.y);
  await sleep(1200);
  const duoDue = await page.evaluate(() => TG.engine.inspect().game);
  check('anche il secondo giocatore muove sullo stesso schermo',
    duoDue.board.flat().filter(v => v === 2).length === 1 && duoDue.turno === 1,
    JSON.stringify({ gialli: duoDue.board.flat().filter(v => v === 2).length, turno: duoDue.turno }));

  // ---- Tessere: il tocco fa scorrere la tessera adiacente ----
  console.log('\n[tessere]');
  await page.goto(URL + '#/g/tessere');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  const st0 = await page.evaluate(() => TG.engine.inspect().game);
  check('il rompicapo parte mescolato', st0.giuste < st0.n * st0.n - 1,
    st0.giuste + ' tessere a posto su ' + (st0.n * st0.n - 1));
  const sbox = await page.$eval('#canvas', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const adiacente = st0.caselle.find(c => {
    const dr = Math.abs(Math.floor(c.i / st0.n) - Math.floor(st0.buco / st0.n));
    const dc = Math.abs((c.i % st0.n) - (st0.buco % st0.n));
    return c.valore !== 0 && dr + dc === 1;
  });
  await page.mouse.click(sbox.x + adiacente.x / 360 * sbox.w, sbox.y + adiacente.y / 430 * sbox.h);
  await sleep(300);
  const st1 = await page.evaluate(() => TG.engine.inspect().game);
  check('il tocco fa scorrere la tessera', st1.mosse === 1 && st1.buco === adiacente.i);
  await page.keyboard.press('ArrowUp');
  await sleep(200);
  const st2 = await page.evaluate(() => TG.engine.inspect().game);
  check('anche le frecce muovono le tessere', st2.mosse >= 1, st2.mosse + ' mosse');

  // ---- Labirinto: joystick, movimento, pausa ----
  console.log('\n[labirinto]');
  await page.goto(URL + '#/g/labirinto');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(400);
  check('il labirinto ha la leva analogica', (await page.$$('#touch-controls .stick')).length === 1);
  const lab0 = await page.evaluate(() => TG.engine.inspect().game);
  check('si parte lontano dall\'uscita', lab0.distanza > 3, 'distanza ' + lab0.distanza);
  check('la mappa parte da quello che vedi', lab0.ricordate > 0 && lab0.ricordate < lab0.lato * lab0.lato,
    lab0.ricordate + ' celle su ' + (lab0.lato * lab0.lato));

  const bb = await (await page.$('.stick')).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height * 0.12, { steps: 4 });
  await sleep(800);
  await page.mouse.up();
  const lab1 = await page.evaluate(() => TG.engine.inspect().game);
  const spostato = Math.hypot(lab1.giocatore.x - lab0.giocatore.x, lab1.giocatore.y - lab0.giocatore.y);
  check('la leva muove il giocatore', spostato > 0.3, 'spostamento ' + spostato.toFixed(2));
  check('la leva torna a zero quando la lasci',
    (await page.evaluate(() => TG.input.stick.x === 0 && TG.input.stick.y === 0)));
  check('camminando la mappa si allarga',
    lab1.ricordate > lab0.ricordate, lab0.ricordate + ' -> ' + lab1.ricordate + ' celle');

  // la pausa ferma davvero il gioco
  await page.click('#btn-pause');
  await sleep(150);
  check('il labirinto si mette in pausa', await page.isVisible('#overlay'));
  const inPausa = await page.evaluate(() => TG.engine.inspect().game.timeLeft);
  await sleep(1200);
  check('in pausa il tempo non scorre',
    (await page.evaluate(() => TG.engine.inspect().game.timeLeft)) === inPausa);
  await page.click('.btn:has-text("Riprendi")');
  await sleep(1000);
  check('riprendendo il tempo riparte',
    (await page.evaluate(() => TG.engine.inspect().game.timeLeft)) < inPausa);

  // ---- checkpoint ogni 5 livelli, valido per tutti i giochi ----
  console.log('\n[checkpoint]');
  /* Le sezioni precedenti ricaricano la pagina, quindi il gioco finto va
     registrato di nuovo: serve un gioco che salga di livello a comando. */
  await page.goto(URL);
  await sleep(300);
  await page.evaluate(() => {
    window.__cmd = null;
    TG.scores.clear('zzztest');
    TG.registry.register({
      id: 'zzztest', title: 'Test', icon: '🧪', tagline: 'gioco di prova',
      controls: 'none', viewport: { w: 200, h: 200 },
      create: function (api) {
        return {
          start: function () {},
          update: function () {
            if (window.__cmd === 'win') { window.__cmd = null; api.addScore(50); api.levelComplete({ bonus: 10 }); }
            if (window.__cmd === 'lose') { window.__cmd = null; api.gameOver({ message: 'fine prova' }); }
          },
          draw: function (ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 200, 200); }
        };
      }
    });
    location.hash = '#/g/zzztest';
  });
  await sleep(300);
  check('senza checkpoint si parte e basta',
    (await page.$$('#overlay-actions .btn')).length === 1);
  await page.click('.btn:has-text("Gioca")');
  await sleep(200);

  // sale fino al livello 5 vincendo quattro volte
  for (let l = 1; l <= 4; l++) {
    await page.evaluate(() => { window.__cmd = 'win'; });
    await sleep(300);
    await page.click(`.btn:has-text("Livello ${l + 1}")`);
    await sleep(250);
  }
  check('arrivato al livello 5', (await page.evaluate(() => TG.engine.getLevel())) === 5);
  check('il livello 5 è segnato come checkpoint',
    (await page.textContent('#hud-level')).includes('🚩'), await page.textContent('#hud-level'));
  check('il checkpoint è salvato', (await page.evaluate(() => TG.scores.checkpoint('zzztest'))) === 5);

  // si perde e si riparte dal checkpoint
  await page.evaluate(() => { window.__cmd = 'lose'; });
  await sleep(300);
  check('il game over propone la ripartenza dal checkpoint',
    (await page.textContent('#overlay-actions')).includes('Dal livello 5'),
    await page.textContent('#overlay-actions'));
  await page.click('.btn:has-text("Dal livello 5")');
  await sleep(300);
  check('la nuova partita parte dal livello 5',
    (await page.evaluate(() => TG.engine.getLevel())) === 5);
  check('il punteggio riparte da zero', (await page.evaluate(() => TG.engine.getScore())) === 0);

  // il checkpoint sopravvive al ricaricamento della pagina
  await page.evaluate(() => { window.__cmd = 'lose'; });
  await sleep(300);
  const boardCp = await page.textContent('#board');
  check('la classifica segnala la partenza dal checkpoint', boardCp.includes('da 5'),
    boardCp.replace(/\s+/g, ' ').slice(0, 80));
  // ricaricando davvero la pagina il checkpoint deve essere ancora lì
  await page.goto(URL);
  await sleep(300);
  check('il checkpoint sopravvive al ricaricamento',
    (await page.evaluate(() => TG.scores.checkpoint('zzztest'))) === 5);

  // ---- schermo tutto al gioco, pannelli nelle icone in alto ----
  console.log('\n[schermo e pannelli]');
  await page.goto(URL + '#/g/serpente');
  await sleep(400);
  await page.click('.btn:has-text("Gioca")');
  await sleep(400);

  const misure = await page.evaluate(() => {
    const c = document.getElementById('canvas').getBoundingClientRect();
    return {
      larghezza: Math.round(c.width), altezza: Math.round(c.height),
      fondo: Math.round(c.bottom),
      scroll: document.documentElement.scrollHeight,
      finestra: window.innerHeight,
      controlli: Math.round(document.getElementById('touch-controls').getBoundingClientRect().bottom)
    };
  });
  check('la pagina non scorre mentre giochi', misure.scroll <= misure.finestra + 1,
    misure.scroll + ' vs ' + misure.finestra);
  check('il campo sta dentro allo schermo', misure.fondo <= misure.finestra,
    'fondo canvas ' + misure.fondo);
  check('anche i comandi stanno dentro', misure.controlli <= misure.finestra + 1,
    'fondo comandi ' + misure.controlli);
  check('il campo usa lo spazio disponibile', misure.altezza > 250,
    misure.larghezza + '×' + misure.altezza);

  check('classifica e istruzioni sono icone in alto',
    (await page.isVisible('#btn-board')) && (await page.isVisible('#btn-help')));
  await page.click('#btn-board');
  await sleep(250);
  check('l\'icona apre la classifica', await page.isVisible('#modal'));
  check('la classifica sa di che gioco parla',
    (await page.textContent('#modal-title')).includes('Serpente'),
    await page.textContent('#modal-title'));
  check('aprire un pannello mette in pausa',
    (await page.evaluate(() => TG.engine.getState())) === 'paused');
  await page.click('#modal-close');
  await sleep(200);
  check('si chiude', !(await page.isVisible('#modal')));

  await page.click('#btn-help');
  await sleep(250);
  check('l\'altra icona apre le istruzioni',
    (await page.textContent('#modal-title')).includes('Come si gioca'),
    await page.textContent('#modal-title'));
  check('le istruzioni sono quelle del gioco',
    (await page.textContent('#game-howto')).includes('frecce'));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('anche Esc chiude il pannello', !(await page.isVisible('#modal')));

  await page.click('#btn-back');
  await sleep(300);
  check('in home le icone di gioco spariscono',
    !(await page.isVisible('#btn-board')) && !(await page.isVisible('#btn-help')));
  check('e la home torna a scorrere',
    !(await page.evaluate(() => document.body.classList.contains('is-playing'))));

  // ---- persistenza + deep link ----
  console.log('\n[persistenza]');
  await page.goto(URL + '#/g/serpente');
  await sleep(400);
  check('deep link apre il gioco', await page.isVisible('#view-game'));
  await page.goto(URL);
  await sleep(400);
  check('classifiche sopravvivono al reload', (await page.textContent('#game-grid')).includes('record'));
  check('statistiche home', (await page.textContent('#home-stats')).includes('partite giocate'));

  console.log('\n[console]');
  check('nessun errore JS', errors.length === 0, errors.join(' | ').slice(0, 300));

  await browser.close();
  console.log(failures === 0 ? '\nTUTTO OK' : '\n' + failures + ' CONTROLLI FALLITI');
  process.exit(failures === 0 ? 0 : 1);
})();
