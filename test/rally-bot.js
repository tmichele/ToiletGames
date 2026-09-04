/* Pilota simulato per Rally, condiviso da balance.js e regole.js.

   Guarda avanti lungo la mezzeria — più lontano quanto più va forte — e sterza
   verso quel punto. Il gas lo decide la curva in arrivo: l'angolo fra la strada
   qui e la strada fra un attimo, con la stessa regola che il gioco usa per
   stimare il giro ideale (stimaTempo in rally.js). Non è un caso: se il tempo
   massimo viene da quella regola, un pilota che la segue deve poterlo battere,
   e questo bot è la prova che il tempo richiesto è raggiungibile e non solo
   scritto.

   Se ha mancato una porta torna a prenderla; se resta fermo col gas premuto
   (incastrato contro un albero) mette la retromarcia, come farebbe chiunque.

   Il bot vede quello che vede chi gioca: la mezzeria sta tutta nella mappina. */

function creaPilota(opt) {
  opt = opt || {};
  const reazione = Math.max(0.05, opt.reazione || 0.1);   // ogni quanto decide
  const errore = opt.errore || 0;                          // quanto sbaglia la mira (rad*400)
  const ardimento = opt.ardimento == null ? 1 : opt.ardimento;  // quanto vicino al limite spinge
  let attesa = 0, fermo = 0, retro = 0;

  return function (s, held, dt) {
    if (s.stato !== 'corsa') { held.up = false; return; }
    const v = Math.abs(s.auto.velocita);
    if (retro > 0) {
      retro -= dt;
      held.up = false; held.down = true; held.left = false; held.right = false;
      return;
    }
    fermo = v < 8 ? fermo + dt : 0;
    if (fermo > 0.8) { fermo = 0; retro = 0.9; return; }
    attesa -= dt;
    if (attesa > 0) return;
    attesa = reazione;

    const L = s.linea, a = s.auto;
    let mira = L[Math.min(L.length - 1, s.vicino + Math.round(4 + v / 14))];
    if (s.prossimaPorta < s.porte.length && s.porte[s.prossimaPorta] < s.vicino - 10) {
      mira = L[s.porte[s.prossimaPorta]];               // porta mancata: si torna
    }
    let ang = Math.atan2(mira.y - a.y, mira.x - a.x) - a.h;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    ang += (Math.random() * 2 - 1) * errore / 400;
    held.left = ang < -0.05;
    held.right = ang > 0.05;

    const j1 = Math.min(L.length - 2, s.vicino);
    const j2 = Math.min(L.length - 2, s.vicino + Math.round(10 + v / 6));
    const t1 = Math.atan2(L[j1 + 1].y - L[j1].y, L[j1 + 1].x - L[j1].x);
    const t2 = Math.atan2(L[j2 + 1].y - L[j2].y, L[j2 + 1].x - L[j2].x);
    let curva = Math.abs(t2 - t1);
    if (curva > Math.PI) curva = 2 * Math.PI - curva;
    const vDes = Math.max(70, 300 * ardimento * (1.2 - curva * 1.3));
    held.up = v < vDes;
    held.down = v > vDes + 45;
    if (Math.abs(ang) > 1.2) { held.up = v < 40; held.down = v > 60; }   // fuori rotta: piano e gira
  };
}

module.exports = { creaPilota };
