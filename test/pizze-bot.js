/* Pilota simulato per Pizze, condiviso da balance.js e regole.js.

   Segue la rotta che il gioco già disegna sull'asfalto: prende il punto della
   rotta un po' più avanti dell'auto, ci sterza verso, e regola il gas sulla
   curva che sta arrivando. Sotto casa rallenta, perché la consegna si fa da
   fermi (o quasi) — se passasse a cinquanta non consegnerebbe mai, e la
   colonna del bot direbbe «impossibile» di un livello che non lo è.

   Non vede niente più di chi gioca: la rotta è quella delle frecce a terra e
   della mappina, gli indirizzi sono quelli scritti nell'HUD.

   Se resta fermo contro un muro mette la retromarcia, come chiunque. */

function creaPilota(opt) {
  opt = opt || {};
  const reazione = Math.max(0.05, opt.reazione || 0.1);
  const errore = opt.errore || 0;
  const ardimento = opt.ardimento == null ? 1 : opt.ardimento;
  let attesa = 0, fermo = 0, retro = 0, sterzo = 0, gasVoluto = 0;

  return function (s, held, dt) {
    if (s.stato !== 'giro' || !s.obiettivo) { held.up = false; held.down = false; return; }
    const a = s.auto;
    const v = Math.abs(a.velocita);

    if (retro > 0) {
      retro -= dt;
      held.up = false; held.down = true; held.left = false; held.right = true;
      return;
    }
    fermo = v < 0.4 ? fermo + dt : 0;
    if (fermo > 1.2) { fermo = 0; retro = 1.1; return; }

    attesa -= dt;
    if (attesa <= 0) {
      attesa = reazione;
      const dObiettivo = Math.hypot(s.obiettivo.x - a.x, s.obiettivo.y - a.y);

      /* Dove guardare: un punto della rotta davanti a noi, tanto più lontano
         quanto più si va forte. Vicino alla meta si punta la meta, altrimenti
         si continuerebbe a inseguire il nodo della strada e si passerebbe
         davanti al cancello senza fermarsi. */
      let mira = s.obiettivo;
      if (dObiettivo > 22 && s.rotta && s.rotta.length) {
        const avanti = 9 + v * 1.1;
        for (let i = 0; i < s.rotta.length; i++) {
          const p = s.rotta[i];
          if (Math.hypot(p[0] - a.x, p[1] - a.y) > avanti) { mira = { x: p[0], y: p[1] }; break; }
          mira = { x: p[0], y: p[1] };
        }
      }

      let ang = Math.atan2(mira.y - a.y, mira.x - a.x) - a.h;
      while (ang > Math.PI) ang -= 2 * Math.PI;
      while (ang < -Math.PI) ang += 2 * Math.PI;
      ang += (Math.random() * 2 - 1) * errore / 500;
      sterzo = ang;

      /* Quanto forte: la curva che arriva la si legge sull'angolo verso il
         punto di mira, e sotto casa si arriva piano perché lì bisogna
         fermarsi. */
      let voluta = 15.5 * ardimento * (1.05 - Math.min(1, Math.abs(ang)) * 0.85);
      if (dObiettivo < 30) voluta = Math.min(voluta, 3 + dObiettivo * 0.25);
      if (dObiettivo < 12) voluta = 1.6;
      gasVoluto = Math.max(1.2, voluta);
    }

    held.left = sterzo < -0.06;
    held.right = sterzo > 0.06;
    held.up = v < gasVoluto;
    held.down = v > gasVoluto + 1.6;
  };
}

module.exports = { creaPilota };
