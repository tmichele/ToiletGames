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
  let dove = null, fermoDa = 0;

  return function (s, held, dt) {
    if (s.stato !== 'giro' || !s.obiettivo) { held.up = false; held.down = false; return; }
    const a = s.auto;
    const v = Math.abs(a.velocita);

    if (retro > 0) {
      retro -= dt;
      held.up = false; held.down = true; held.left = false; held.right = true;
      return;
    }
    /* Incastrato non vuol dire fermo. Contro un muro l'auto continua ad avere
       velocità — il motore spinge, il muro respinge — e la posizione non
       cambia di un metro: guardando il tachimetro il pilota non se ne
       accorgeva e restava lì finché le pizze si gelavano. Si guarda quanta
       strada ha fatto davvero. */
    if (!dove) dove = { x: a.x, y: a.y, t: 0 };
    dove.t += dt;
    if (dove.t > 1) {
      if (Math.hypot(a.x - dove.x, a.y - dove.y) < 2.5) fermoDa += dove.t;
      else fermoDa = 0;
      dove = { x: a.x, y: a.y, t: 0 };
    }
    fermo = v < 0.4 ? fermo + dt : 0;
    if (fermo > 1.2 || fermoDa > 1.5) { fermo = 0; fermoDa = 0; retro = 1.2; return; }

    attesa -= dt;
    if (attesa <= 0) {
      attesa = reazione;
      /* Dove guardare: un punto della rotta davanti a noi, tanto più lontano
         quanto più si va forte. Vicino alla meta si punta la meta, altrimenti
         si continuerebbe a inseguire il nodo della strada e si passerebbe
         davanti al cancello senza fermarsi. */
      /* Dove guardare: si parte dal punto della rotta più vicino all'auto e si
         cammina *in avanti* lungo la rotta finché non si è abbastanza lontani.

         Prima si prendeva «il primo nodo oltre la distanza di mira», scorrendo
         la rotta dall'inizio: ma la rotta comincia dal nodo più vicino, che
         spesso sta alle spalle, e in un paese con le vie corte quel nodo era
         già oltre la soglia. Il pilota puntava dietro di sé, girava, e ricadeva
         nel campo — al primo turno passava i tre quarti del tempo nell'erba. */
      let mira = s.obiettivo;
      const dObiettivo = Math.hypot(s.obiettivo.x - a.x, s.obiettivo.y - a.y);
      if (dObiettivo > 22 && s.rotta && s.rotta.length) {
        let i0 = 0, d0 = Infinity;
        for (let i = 0; i < s.rotta.length; i++) {
          const d = Math.hypot(s.rotta[i][0] - a.x, s.rotta[i][1] - a.y);
          if (d < d0) { d0 = d; i0 = i; }
        }
        const avanti = 8 + v * 0.9;
        let percorsa = d0;
        mira = { x: s.rotta[i0][0], y: s.rotta[i0][1] };
        for (let i = i0 + 1; i < s.rotta.length; i++) {
          const p = s.rotta[i], q = s.rotta[i - 1];
          percorsa += Math.hypot(p[0] - q[0], p[1] - q[1]);
          mira = { x: p[0], y: p[1] };
          if (percorsa >= avanti) break;
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

    /* `sterzo` è l'angolo dal muso al punto di mira, in convenzione
       antioraria. La destra dello schermo è il versore (sin h, −cos h), che
       gira in senso orario: un bersaglio ad angolo positivo sta a sinistra.
       Sbagliare questo segno fa guidare il bot al contrario, ed è quello che
       è successo il giorno in cui il verso dello sterzo è stato corretto nel
       gioco senza correggerlo qui. */
    held.left = sterzo > 0.06;
    held.right = sterzo < -0.06;
    held.up = v < gasVoluto;
    held.down = v > gasVoluto + 1.6;
  };
}

module.exports = { creaPilota };
