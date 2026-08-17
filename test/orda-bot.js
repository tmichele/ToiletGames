/* Pilota simulato per Orda, condiviso da balance.js e regole.js.

   In un labirinto le spinte non bastano: sommare «scappa da lì» e «vai di là»
   dà una direzione che finisce contro un muro, e il bot resta a strofinarsi
   sull'angolo mentre l'orda arriva. Qui si ragiona per celle, come farebbe una
   persona che guarda lo schermo: si calcolano le distanze dal giocatore e dai
   mostri svegli, si sceglie la cella dove conviene essere, e si percorre il
   corridoio che ci porta.

   Il bot non vede niente di più di chi gioca: il labirinto è tutto sullo
   schermo, i mostri addormentati si vedono, e le comparse sono annunciate. */

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

function creaPilota(opt) {
  opt = opt || {};
  const spinta = opt.spinta == null ? 1 : opt.spinta;      // quanto affonda la leva
  const reazione = Math.max(0.1, opt.reazione || 0.1);     // ogni quanto decide
  const errore = opt.errore || 0;                          // quanto sbaglia a scegliere
  const pesoCasse = opt.pesoCasse == null ? 1 : opt.pesoCasse;
  /* caccia: false tiene il pilota alla larga da tutti, svegli o addormentati.
     Non serve a giocare bene — serve ai test che devono osservare cosa succede
     col passare del tempo senza che il livello finisca prima. */
  const caccia = opt.caccia !== false;
  let attesa = 0;
  let prossima = null;
  let obiettivo = null;

  return function (s, stick, dt) {
    const G = s.griglia;
    const cella = (x, y) => ({
      c: Math.min(G.cols - 1, Math.max(0, Math.floor(x / G.cella))),
      r: Math.min(G.righe - 1, Math.max(0, Math.floor((y - G.top) / G.cella)))
    });
    const centro = (r, c) => ({ x: c * G.cella + G.cella / 2, y: G.top + r * G.cella + G.cella / 2 });
    const aperto = (r, c, d) => (s.passaggi[r][c] & (1 << d)) !== 0;

    function bfs(sorgenti) {
      const dist = [];
      for (let r = 0; r < G.righe; r++) dist.push(new Array(G.cols).fill(Infinity));
      const coda = [];
      sorgenti.forEach((p) => {
        if (dist[p.r][p.c] !== 0) { dist[p.r][p.c] = 0; coda.push(p); }
      });
      for (let i = 0; i < coda.length; i++) {
        const cur = coda[i];
        for (let d = 0; d < 4; d++) {
          if (!aperto(cur.r, cur.c, d)) continue;
          const nr = cur.r + DR[d], nc = cur.c + DC[d];
          if (nr < 0 || nr >= G.righe || nc < 0 || nc >= G.cols) continue;
          if (dist[nr][nc] !== Infinity) continue;
          dist[nr][nc] = dist[cur.r][cur.c] + 1;
          coda.push({ r: nr, c: nc });
        }
      }
      return dist;
    }

    const mia = cella(s.giocatore.x, s.giocatore.y);

    attesa -= dt;
    if (attesa <= 0) {
      attesa = reazione;
      const daMe = bfs([mia]);
      const svegli = s.nemici.filter((n) => n.sveglio).map((n) => cella(n.x, n.y));
      const pericoloOra = svegli.length ? bfs(svegli) : null;
      /* Si scappa solo da chi è vicino. Tenendo conto anche dei mostri svegli
         dall'altra parte del labirinto la cella «più sicura» risultava sempre
         quella dove si è già, e il bot restava fermo a fare centro nella
         propria cella finché non scadeva il tempo. */
      const minaccia = pericoloOra && pericoloOra[mia.r][mia.c] <= 5;

      if (minaccia) {
        /* Con qualcuno alle calcagna si sceglie dove stare: lontano da loro, ma
           non dall'altra parte del labirinto — una fuga di dieci celle è tempo
           regalato, e il tempo del livello è quello che si perde. */
        const pericolo = pericoloOra;
        let meglio = null, punteggio = -Infinity;
        for (let r = 0; r < G.righe; r++) {
          for (let c = 0; c < G.cols; c++) {
            if (daMe[r][c] > 7) continue;
            let p = Math.min(pericolo[r][c], 9) * 3 - daMe[r][c] * 0.6;
            if (pesoCasse > 0) {
              s.casse.forEach((k) => {
                const kc = cella(k.x, k.y);
                if (kc.r === r && kc.c === c) p += 5 * pesoCasse;
              });
            }
            p += (Math.random() * 2 - 1) * errore / 8;
            if (p > punteggio) { punteggio = p; meglio = { r: r, c: c }; }
          }
        }
        obiettivo = meglio || mia;
      } else if (!caccia) {
        // si sta alla larga da tutti, senza andare a stanare nessuno
        const daTutti = s.nemici.length ? bfs(s.nemici.map((n) => cella(n.x, n.y))) : null;
        let meglio = mia, punteggio = -Infinity;
        for (let r = 0; r < G.righe; r++) {
          for (let c = 0; c < G.cols; c++) {
            if (daMe[r][c] > 6) continue;
            const p = daTutti ? Math.min(daTutti[r][c], 12) : -daMe[r][c];
            if (p > punteggio) { punteggio = p; meglio = { r: r, c: c }; }
          }
        }
        obiettivo = meglio;
      } else {
        /* Nessuno addosso: si va a prendere quello che serve e poi a stanare i
           mostri, perché il livello finisce solo quando il labirinto è pulito e
           il tempo scorre lo stesso. */
        let mete = [];
        if (pesoCasse > 0 && s.casse.length) mete = s.casse.map((k) => cella(k.x, k.y));
        if (!mete.length) mete = s.nemici.map((n) => cella(n.x, n.y));
        if (!mete.length && s.avvisi.length) mete = s.avvisi.map((a) => cella(a.x, a.y));
        let meglio = null, dmin = Infinity;
        mete.forEach((m) => {
          if (daMe[m.r][m.c] < dmin) { dmin = daMe[m.r][m.c]; meglio = m; }
        });
        obiettivo = meglio || mia;
      }

      // primo passo verso l'obiettivo: il vicino che ci avvicina
      const daMeta = bfs([obiettivo]);
      prossima = mia;
      let migliore = daMeta[mia.r][mia.c];
      for (let d = 0; d < 4; d++) {
        if (!aperto(mia.r, mia.c, d)) continue;
        const nr = mia.r + DR[d], nc = mia.c + DC[d];
        if (nr < 0 || nr >= G.righe || nc < 0 || nc >= G.cols) continue;
        if (daMeta[nr][nc] < migliore) { migliore = daMeta[nr][nc]; prossima = { r: nr, c: nc }; }
      }
    }

    const meta = prossima || mia;
    const p = centro(meta.r, meta.c);
    let dx = p.x - s.giocatore.x, dy = p.y - s.giocatore.y;
    /* Prima ci si mette in mezzo al corridoio, poi si percorre: tagliando in
       diagonale ci si incastra negli spigoli delle aperture. */
    if (meta.r === mia.r && Math.abs(dy) > 4) dx = 0;
    else if (meta.c === mia.c && Math.abs(dx) > 4) dy = 0;

    const len = Math.hypot(dx, dy);
    if (len < 1.5) { stick.x = 0; stick.y = 0; stick.attiva = false; return; }
    stick.x = dx / len * spinta;
    stick.y = dy / len * spinta;
    stick.attiva = true;
  };
}

module.exports = { creaPilota };
