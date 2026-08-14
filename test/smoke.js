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
  check('4 giochi in elenco', cards.length === 4, cards.length + ' trovati');
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
  let over = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    if (await page.isVisible('#overlay') && (await page.textContent('#overlay-title')).includes('finita')) { over = true; break; }
  }
  check('la CPU vince se resti fermo', over);
  check('classifica pong aggiornata', /L\d/.test(await page.textContent('#board')));
  check('HUD record allineato ai dati salvati',
    (await page.textContent('#hud-best')) === String(await page.evaluate(() => TG.scores.best('pong'))));
  await page.click('.btn:has-text("Altri giochi")');
  await sleep(200);
  check('card mostra il record', (await page.textContent('.card:has-text("Pong")')).includes('record'));

  // ---- Mattoni: lancio e perdita vite ----
  console.log('\n[mattoni]');
  await page.click('.card:has-text("Mattoni")');
  await page.click('.btn:has-text("Gioca")');
  await sleep(300);
  await page.keyboard.press('Space');
  await sleep(500);
  check('pallina lanciata', (await canvasHash()) !== 0);
  let scoreGrew = false;
  for (let i = 0; i < 25; i++) {
    await sleep(600);
    await page.keyboard.press('Space'); // rilancia dopo ogni vita persa
    if ((await page.evaluate(() => TG.engine.getScore())) >= 30) { scoreGrew = true; break; }
  }
  check('i mattoni si rompono', scoreGrew, 'punti ' + await page.evaluate(() => TG.engine.getScore()));
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

  // ---- persistenza + deep link ----
  console.log('\n[persistenza]');
  await page.goto(URL + '#/g/serpente');
  await sleep(400);
  check('deep link apre il gioco', await page.isVisible('#view-game'));
  check('titolo classifica corretto', (await page.textContent('#board-title')).includes('Serpente'));
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
