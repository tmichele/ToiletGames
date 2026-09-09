/* Costruisce la mappa di Codiverno (Vigonza) per il gioco delle pizze.

   Uso:  node tools/mappa.js
   Scrive assets/js/games/mappa-codiverno.js, che è dato generato: non si
   modifica a mano, si rigenera.

   Ci sono due sorgenti possibili, e il file prodotto dice sempre quale è
   stata usata (campo `fonte`, mostrato anche in gioco):

   1. `dati/codiverno.osm` — un export di OpenStreetMap. Se c'è, la mappa è
      quella vera: strade con i loro nomi, edifici con la loro sagoma, civici
      dove ci sono. Si ottiene da openstreetmap.org, riquadro attorno a
      Codiverno, «Esporta». I dati sono ODbL: l'attribuzione a OpenStreetMap
      finisce nel file e nel gioco.
   2. Nessun file — allora si genera la RICOSTRUZIONE qui sotto: una frazione
      veneta plausibile (una strada principale con la chiesa e la piazza, le
      laterali, la zona artigianale, i campi attorno), non il rilievo di
      Codiverno. È dichiarata come tale, perché una mappa inventata spacciata
      per vera è peggio di una mappa dichiaratamente finta.

   Il formato in uscita è lo stesso nei due casi, quindi il gioco non sa da
   dove viene la mappa: sono coordinate in metri, con l'origine sulla piazza,
   x verso est e y verso nord. */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const USCITA = path.join(ROOT, 'assets/js/mappe/codiverno.js');
const OSM = path.join(ROOT, 'dati/codiverno.osm');
const GEOJSON = path.join(ROOT, 'dati/codiverno.geojson');

/* Dove sta Codiverno: serve a convertire i gradi dell'export in metri e a
   dire dove si trova la mappa anche quando è ricostruita. Con un export vero
   la si prende dal nodo del paese (`place=village`), perché scriverla a mano
   significa sbagliarla — questa era fuori dal riquadro esportato di tre
   chilometri, e tutto il paese sarebbe finito a sud-est del mondo. */
let ORIGINE = { lat: 45.4758187, lon: 11.9438740 };

/* Quanto paese si tiene attorno all'origine. L'export copre due chilometri e
   mezzo di campagna con dentro tre frazioni: senza ritaglio si consegnerebbe
   a Pionca, e il turno diventerebbe un viaggio. */
const RAGGIO = 850;

/* Le strade su cui si guida. Le altre — marciapiedi, ciclabili, sentieri —
   restano fuori: un navigatore che ti manda sul percorso Nordic Walking non
   sta calcolando un percorso, sta barando. */
const GUIDABILI = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'service'];

function creaRng(seme) {
  let x = seme >>> 0;
  return function () {
    x = (x + 0x6D2B79F5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- lo scheletro della ricostruzione ----------

   Le strade sono polilinee che si toccano nei punti di incrocio: gli incroci
   non si cercano, si costruiscono. Due strade che si incontrano condividono
   la stessa coppia di coordinate, e la saldatura più avanti le fonde in un
   nodo solo del grafo. È il motivo per cui questi numeri sono scritti a mano
   invece che sorteggiati: un incrocio mancato è una strada che dal navigatore
   risulta senza uscita. */
const SCHELETRO = [
  { nome: 'Via Codiverno', tipo: 'principale', larghezza: 7.5, case: 26,
    punti: [[-700, -40], [-450, -20], [-200, -5], [0, 0], [200, 10], [450, 35], [700, 25]] },
  { nome: 'Via Roma', tipo: 'secondaria', larghezza: 6.5, case: 24,
    punti: [[0, 0], [-10, 150], [-5, 330], [10, 520]] },
  { nome: 'Via Peraga', tipo: 'secondaria', larghezza: 6, case: 28,
    punti: [[-200, -5], [-215, 140], [-190, 300]] },
  { nome: 'Via Pionca', tipo: 'secondaria', larghezza: 6, case: 30,
    punti: [[-190, 300], [-90, 320], [-5, 330]] },
  { nome: 'Vicolo del Pozzo', tipo: 'vicolo', larghezza: 5, case: 22,
    punti: [[-5, 330], [140, 350], [250, 330]] },
  { nome: 'Via dei Campi', tipo: 'campagna', larghezza: 5.5, case: 70,
    punti: [[-450, -20], [-470, -200], [-450, -380]] },
  { nome: 'Via del Molino', tipo: 'secondaria', larghezza: 6, case: 40,
    punti: [[-470, -200], [-250, -215], [-40, -230], [180, -215]] },
  { nome: 'Via dell\'Artigianato', tipo: 'artigianale', larghezza: 7, case: 0,
    punti: [[200, 10], [195, -100], [180, -215]] },
  { nome: 'Via della Fornace', tipo: 'artigianale', larghezza: 6.5, case: 0,
    punti: [[180, -215], [400, -230], [560, -200]] },
  { nome: 'Via Brenta', tipo: 'campagna', larghezza: 6, case: 55,
    punti: [[450, 35], [470, 200], [500, 380]] }
];

/* Catmull-Rom: dai punti di controllo a una strada che curva. I punti di
   controllo restano nella polilinea (la curva ci passa dentro), quindi gli
   incroci costruiti sopra sopravvivono all'addolcimento. */
function addolcisci(punti, passo) {
  const out = [];
  for (let i = 0; i < punti.length - 1; i++) {
    const p0 = punti[Math.max(0, i - 1)], p1 = punti[i];
    const p2 = punti[i + 1], p3 = punti[Math.min(punti.length - 1, i + 2)];
    const lungo = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.round(lungo / passo));
    for (let k = 0; k < n; k++) {
      const s = k / n, s2 = s * s, s3 = s2 * s;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
      ]);
    }
  }
  out.push(punti[punti.length - 1].slice());
  return out;
}

function ricostruisci() {
  const rng = creaRng(0xC0D1);
  const rf = (a, b) => a + rng() * (b - a);
  const strade = SCHELETRO.map((s) => ({
    nome: s.nome, tipo: s.tipo, larghezza: s.larghezza,
    passo: s.case, punti: addolcisci(s.punti, 22)
  }));

  const edifici = [];
  const indirizzi = [];

  /* Le case stanno lungo la strada, arretrate dal ciglio, girate verso di
     essa: è quello che rende leggibile una via anche a trenta all'ora. I
     numeri civici salgono lungo la via, dispari da una parte e pari
     dall'altra, come succede davvero — e il gioco ci manda a consegnare, per
     cui un civico che non segue la strada sarebbe una beffa. */
  strade.forEach((s) => {
    if (!s.passo) return;
    const civici = [1, 2];
    let percorso = 0, prossima = 30;
    for (let i = 1; i < s.punti.length; i++) {
      const a = s.punti[i - 1], b = s.punti[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      let t = 0;
      while (percorso + (len - t) > prossima) {
        t += prossima - percorso;
        percorso = 0;
        prossima = s.passo * rf(0.75, 1.35);
        const px = a[0] + ux * t, py = a[1] + uy * t;
        // niente case a cavallo di un incrocio: si lascia l'angolo libero
        const daiVertici = distanzaDaVertici(px, py, strade);
        if (daiVertici < 26) continue;
        for (const lato of [-1, 1]) {
          if (rng() < (s.tipo === 'campagna' ? 0.45 : 0.12)) continue;   // i vuoti sono campi
          const arretro = s.larghezza / 2 + rf(9, 17);
          const cx = px - uy * lato * arretro, cy = py + ux * lato * arretro;
          const lung = rf(8.5, 13), larg = rf(7.5, 11);
          const rot = Math.atan2(uy, ux) + rf(-0.05, 0.05);
          const piani = rng() < 0.28 ? 3 : 2;
          const civico = lato < 0 ? (civici[0] += 2) - 2 : (civici[1] += 2) - 2;
          edifici.push({
            x: r1(cx), y: r1(cy), l: r1(lung), w: r1(larg), rot: Math.round(rot * 1000) / 1000,
            h: r1(piani * 3 + rf(-0.4, 0.6)), tipo: 'casa', via: s.nome, civico: civico
          });
          indirizzi.push({
            via: s.nome, civico: civico,
            x: r1(px - uy * lato * (s.larghezza / 2 + 3)),   // il cancello, sul ciglio
            y: r1(py + ux * lato * (s.larghezza / 2 + 3)),
            edificio: edifici.length - 1
          });
        }
      }
      percorso += len - t;
    }
  });

  /* La piazza: chiesa con il campanile, il municipio e la pizzeria. Il
     campanile non è un vezzo — in un paese piatto è l'unico riferimento che
     si vede da lontano, e in 3D serve a capire dove si è senza guardare la
     mappina. */
  edifici.push({ x: -46, y: 44, l: 34, w: 15, rot: 0.05, h: 13, tipo: 'chiesa', nome: 'chiesa' });
  edifici.push({ x: -66, y: 54, l: 7, w: 7, rot: 0.05, h: 31, tipo: 'campanile', nome: 'campanile' });
  edifici.push({ x: 40, y: 34, l: 22, w: 14, rot: 0.02, h: 9, tipo: 'pubblico', nome: 'municipio' });
  edifici.push({ x: 30, y: -30, l: 18, w: 12, rot: 0.03, h: 7, tipo: 'pizzeria', nome: 'Pizzeria da Codiverno' });

  // i capannoni della zona artigianale: grandi, bassi, tutti uguali
  [[300, -150], [370, -160], [440, -175], [250, -175], [480, -260], [330, -270]].forEach((p, i) => {
    edifici.push({
      x: p[0], y: p[1], l: 34 + (i % 3) * 8, w: 22, rot: (i % 2) * 0.04, h: 8.5,
      tipo: 'capannone', via: i < 3 ? 'Via dell\'Artigianato' : 'Via della Fornace'
    });
  });

  /* Alberi: filari lungo le strade di campagna e macchie nei campi. Servono a
     far scorrere il mondo — un piano verde vuoto a 50 all'ora sembra fermo. */
  const alberi = [];
  strade.forEach((s) => {
    if (s.tipo !== 'campagna' && s.tipo !== 'principale') return;
    for (let i = 2; i < s.punti.length - 2; i += 2) {
      const a = s.punti[i - 1], b = s.punti[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const lato = rng() < 0.5 ? -1 : 1;
      const d = s.larghezza / 2 + rf(4, 7);
      alberi.push({ x: r1(b[0] - dy / len * lato * d), y: r1(b[1] + dx / len * lato * d), r: r1(rf(2.2, 3.6)), h: r1(rf(7, 12)) });
    }
  });
  for (let i = 0; i < 130; i++) {
    const x = rf(-780, 780), y = rf(-460, 580);
    if (vicinoAStrada(x, y, strade, 22) || vicinoAEdificio(x, y, edifici, 14)) continue;
    alberi.push({ x: r1(x), y: r1(y), r: r1(rf(2, 4)), h: r1(rf(6, 13)) });
  }

  return {
    nome: 'Codiverno', comune: 'Vigonza', provincia: 'PD',
    fonte: 'ricostruzione', origine: ORIGINE,
    strade, edifici, alberi, indirizzi,
    pizzeria: { x: 30, y: -30, nome: 'Pizzeria da Codiverno', via: 'Via Codiverno', civico: 1 }
  };
}

function distanzaDaVertici(x, y, strade) {
  let min = Infinity;
  SCHELETRO.forEach((s) => s.punti.forEach((p) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < min) min = d;
  }));
  return min;
}

function vicinoAStrada(x, y, strade, soglia) {
  for (const s of strade) {
    for (let i = 1; i < s.punti.length; i++) {
      if (distanzaSegmento(x, y, s.punti[i - 1], s.punti[i]) < soglia + s.larghezza / 2) return true;
    }
  }
  return false;
}

function vicinoAEdificio(x, y, edifici, soglia) {
  for (const e of edifici) {
    if (Math.hypot(e.x - x, e.y - y) < soglia + Math.max(e.l, e.w) / 2) return true;
  }
  return false;
}

function distanzaSegmento(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
}

/* Le strade di OSM hanno un vertice solo dove serve al disegno: un rettilineo
   di duecento metri è due punti. Per il gioco non basta — i nodi del grafo
   sono quei vertici, e ci si aggancia sopra sia il civico («il nodo più vicino
   al cancello») sia la rotta che il navigatore disegna. Con vertici ogni
   duecento metri il cancello finiva agganciato a un incrocio lontano, e le
   frecce puntavano a un punto che con la casa non c'entrava niente. Si taglia
   ogni tratto lungo in pezzi da venticinque metri: la strada resta identica,
   il grafo diventa fine. */
function suddividi(mappa) {
  const PASSO = 25;
  mappa.strade.forEach((s) => {
    const out = [s.punti[0]];
    for (let i = 1; i < s.punti.length; i++) {
      const a = s.punti[i - 1], b = s.punti[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(d / PASSO));
      for (let k = 1; k <= n; k++) {
        out.push([r1(a[0] + (b[0] - a[0]) * k / n), r1(a[1] + (b[1] - a[1]) * k / n)]);
      }
    }
    s.punti = out;
  });
}

/* Il punto di accesso: dove si accosta per consegnare, cioè il punto della
   mezzeria più vicino all'indirizzo. Non è un dettaglio — misurare la
   consegna dal centro dell'edificio significa chiedere all'auto di entrare
   nel salotto, e la pizzeria (arretrata dalla piazza) diventava
   irraggiungibile: il pilota ci girava attorno finché le pizze si gelavano. */
function accessi(mappa) {
  function suStrada(x, y) {
    let best = null;
    mappa.strade.forEach((s) => {
      for (let i = 1; i < s.punti.length; i++) {
        const a = s.punti[i - 1], b = s.punti[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy || 1;
        let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { d, x: px, y: py };
      }
    });
    return best;
  }
  mappa.indirizzi.forEach((ind) => {
    const a = suStrada(ind.x, ind.y);
    if (a) { ind.ax = r1(a.x); ind.ay = r1(a.y); }
  });
  const p = suStrada(mappa.pizzeria.x, mappa.pizzeria.y);
  if (p) { mappa.pizzeria.ax = r1(p.x); mappa.pizzeria.ay = r1(p.y); }
}

/* ---------- il grafo: nodi e archi ----------

   Il gioco ci calcola sopra il percorso più breve, e da quello ricava quanto
   tempo può restare calda una pizza. Senza grafo il tempo si deciderebbe a
   occhio sulla distanza in linea d'aria, che in un paese con una strada sola
   è una bugia. */
function grafo(mappa) {
  const nodi = [];
  const indice = new Map();
  const chiave = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);   // salda entro 50 cm

  function nodo(x, y) {
    const k = chiave(x, y);
    if (indice.has(k)) return indice.get(k);
    nodi.push([r1(x), r1(y)]);
    indice.set(k, nodi.length - 1);
    return nodi.length - 1;
  }

  const archi = [];
  mappa.strade.forEach((s, si) => {
    for (let i = 1; i < s.punti.length; i++) {
      const a = nodo(s.punti[i - 1][0], s.punti[i - 1][1]);
      const b = nodo(s.punti[i][0], s.punti[i][1]);
      if (a === b) continue;
      archi.push([a, b, si]);
    }
  });
  return { nodi, archi };
}

/* Il ritaglio taglia anche le strade, e lascia tronconi staccati dal resto:
   un paio di curve che entrano nel riquadro e non si collegano a niente. Sulla
   mappa non si vedono nemmeno, ma il navigatore ci si perde — se l'auto
   finisce lì, il percorso più breve verso casa non esiste e le frecce
   spariscono. Si tiene la componente connessa più grande e si buttano le
   altre: la mappa è un ritaglio, e un ritaglio ha un bordo. */
function potaTronconi(mappa) {
  const g = grafo(mappa);
  const adj = g.nodi.map(() => []);
  g.archi.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const comp = new Array(g.nodi.length).fill(-1);
  let nc = 0, grandi = [];
  for (let i = 0; i < g.nodi.length; i++) {
    if (comp[i] >= 0) continue;
    const q = [i]; comp[i] = nc;
    for (let k = 0; k < q.length; k++) for (const v of adj[q[k]]) if (comp[v] < 0) { comp[v] = nc; q.push(v); }
    grandi.push({ c: nc, n: q.length });
    nc++;
  }
  grandi.sort((a, b) => b.n - a.n);
  const buona = grandi[0].c;
  const chiave = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);
  const indice = new Map();
  g.nodi.forEach((n, i) => indice.set(chiave(n[0], n[1]), i));
  const dentro = (p) => {
    const i = indice.get(chiave(p[0], p[1]));
    return i != null && comp[i] === buona;
  };

  const prima = mappa.strade.length;
  mappa.strade = mappa.strade.filter((s) => s.punti.some(dentro));
  // e un indirizzo che affacciava su una strada buttata non è più servibile
  const vive = new Set(mappa.strade.map((s) => s.nome));
  mappa.indirizzi = mappa.indirizzi.filter((i) => vive.has(i.via));
  if (prima !== mappa.strade.length) {
    console.log('potati ' + (prima - mappa.strade.length) + ' tronconi staccati dalla rete');
  }
}

/* ---------- OpenStreetMap ----------

   Legge un export .osm (XML) o .geojson e ne ricava lo stesso formato della
   ricostruzione. Le vie diventano strade, gli edifici diventano edifici (la
   sagoma viene ridotta al rettangolo che la contiene meglio: il gioco disegna
   scatole, e una sagoma a L costerebbe molto per una differenza che a
   quaranta all'ora non si vede), i civici diventano indirizzi. */
function daOsm(testo) {
  var m;
  /* Prima passata: le coordinate dei nodi, ancora in gradi — l'origine non si
     conosce finché non si trova il paese. */
  const gradi = new Map();
  const reNodo = /<node[^>]*\bid=["'](\d+)["'][^>]*\blat=["']([-\d.]+)["'][^>]*\blon=["']([-\d.]+)["']/g;
  while ((m = reNodo.exec(testo))) gradi.set(m[1], { lat: +m[2], lon: +m[3] });

  // i nodi con tag: il paese, i civici sparsi, i locali
  const conTag = [];
  const reNodoTag = /<node\b[^>]*\bid=["'](\d+)["'][^>]*>([\s\S]*?)<\/node>/g;
  while ((m = reNodoTag.exec(testo))) {
    const g = gradi.get(m[1]);
    if (g) conTag.push({ id: m[1], g: g, tag: leggiTag(m[2]) });
  }
  const paese = conTag.find((n) => n.tag.place && (n.tag.name || '').toLowerCase() === 'codiverno');
  if (paese) ORIGINE = { lat: paese.g.lat, lon: paese.g.lon };

  const nodi = new Map();
  gradi.forEach((g, id) => nodi.set(id, proietta(g.lat, g.lon)));
  const dentro = (p) => Math.hypot(p.x, p.y) <= RAGGIO;

  const strade = [], edifici = [];
  const reWay = /<way\b[^>]*>([\s\S]*?)<\/way>/g;
  while ((m = reWay.exec(testo))) {
    const corpo = m[1];
    const tag = leggiTag(corpo);
    const rif = [...corpo.matchAll(/<nd\s+ref=["'](\d+)["']/g)].map((x) => nodi.get(x[1])).filter(Boolean);
    if (rif.length < 2) continue;

    if (tag.highway && GUIDABILI.indexOf(tag.highway) >= 0) {
      /* Si tiene la strada se almeno un pezzo tocca il paese, e si taglia via
         il resto: una via che esce dal ritaglio finirebbe in un nodo senza
         uscita dove il navigatore manda e poi non sa tornare. */
      const dentroQualcosa = rif.some(dentro);
      if (!dentroQualcosa) continue;
      let pezzo = [];
      const chiudi = () => {
        if (pezzo.length >= 2) {
          strade.push({
            nome: tag.name || (tag.highway === 'service' ? 'strada privata' : 'strada senza nome'),
            tipo: tag.highway === 'residential' || tag.highway === 'living_street' ? 'secondaria'
              : (tag.highway === 'service' ? 'vicolo' : 'principale'),
            /* Larghezza dell'asfalto. OSM dà la carreggiata reale, che in un
               paese veneto scende anche a tre metri e mezzo: giusto sulla
               carta, impraticabile in gioco — con l'auto larga meno di due
               metri restava un metro di margine per lato, e il pilota passava
               metà del tempo nell'erba a cinque metri al secondo. Si tiene il
               massimo fra il dato e un minimo giocabile. */
            larghezza: Math.max(+tag.width || 0,
              tag.highway === 'service' ? 5.5 : (tag.highway === 'residential' || tag.highway === 'living_street' ? 7 : 8)),
            punti: pezzo.map((p) => [r1(p.x), r1(p.y)])
          });
        }
        pezzo = [];
      };
      rif.forEach((p, i) => {
        if (dentro(p)) pezzo.push(p);
        else {
          // un punto oltre il bordo si tiene comunque, per non troncare a metà
          if (pezzo.length) { pezzo.push(p); chiudi(); }
        }
        if (i === rif.length - 1) chiudi();
      });
    } else if (tag.building) {
      const sc = scatola(rif);
      if (!dentro({ x: sc.x, y: sc.y })) continue;
      const piani = +tag['building:levels'] || (tag.building === 'church' ? 4 : 2);
      sc.h = r1(+tag.height || piani * 3.2);
      sc.tipo = tag.building === 'church' || tag.amenity === 'place_of_worship' ? 'chiesa'
        : (tag.building === 'industrial' || tag.building === 'warehouse' ? 'capannone'
          : (tag.amenity === 'restaurant' || tag.amenity === 'fast_food' || tag.amenity === 'pub' ? 'pizzeria'
            : (tag.building === 'public' || tag.amenity === 'school' ? 'pubblico' : 'casa')));
      if (tag.name) sc.nome = tag.name;
      if (tag['addr:housenumber']) { sc.civico = tag['addr:housenumber']; sc.via = tag['addr:street'] || ''; }
      edifici.push(sc);
    }
  }

  /* I campanili: in OSM sono spesso una parte a sé della chiesa, e comunque
     l'altezza non c'è quasi mai. Una chiesa alta tre piani non si vede da
     lontano, e in un paese piatto il campanile è l'unico riferimento. */
  edifici.forEach((e) => { if (e.tipo === 'chiesa') e.h = Math.max(e.h, 16); });

  const indirizzi = numeraCivici(strade, edifici, conTag, nodi);
  const pizzeria = scegliPizzeria(edifici, conTag);

  return {
    nome: 'Codiverno', comune: 'Vigonza', provincia: 'PD',
    fonte: 'OpenStreetMap', attribuzione: '© contributori OpenStreetMap, ODbL',
    civici: indirizzi.some((i) => i.reale) ? 'da OpenStreetMap dove ci sono, altrimenti numerati lungo la via'
      : 'numerati dal generatore lungo la via (nell\'export non ce ne sono)',
    origine: ORIGINE, strade, edifici, alberi: [], indirizzi, pizzeria
  };
}

/* I numeri civici. L'export di Codiverno ne contiene due in tutto, e un gioco
   di consegne senza indirizzi non è un gioco: si numerano gli edifici lungo la
   via a cui affacciano, dispari da una parte e pari dall'altra, come si fa
   davvero. Sono numeri inventati su strade vere, e il file lo dichiara nel
   campo `civici` — che il gioco mostra. Dove il civico c'è, vince quello. */
function numeraCivici(strade, edifici, conTag, nodi) {
  const perVia = new Map();
  edifici.forEach((e, i) => {
    if (e.tipo === 'capannone' && !e.nome) return;
    let best = null;
    strade.forEach((s, si) => {
      if (s.nome === 'strada senza nome' || s.nome === 'strada privata') return;
      for (let k = 1; k < s.punti.length; k++) {
        const a = s.punti[k - 1], b = s.punti[k];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy || 1;
        let t = ((e.x - a[0]) * dx + (e.y - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const d = Math.hypot(e.x - px, e.y - py);
        // da che parte della strada sta: decide pari o dispari
        const lato = Math.sign((b[0] - a[0]) * (e.y - a[1]) - (b[1] - a[1]) * (e.x - a[0])) || 1;
        if (!best || d < best.d) best = { d, si, nome: s.nome, lato, lungo: k + t, ax: px, ay: py };
      }
    });
    // una casa a sessanta metri dalla strada più vicina è un capanno in mezzo
    // ai campi: non ci si consegna la pizza
    if (!best || best.d > 60) return;
    if (!perVia.has(best.nome)) perVia.set(best.nome, []);
    perVia.get(best.nome).push({ e, i, best });
  });

  const indirizzi = [];
  perVia.forEach((lista, nome) => {
    lista.sort((a, b) => a.best.lungo - b.best.lungo);
    const prossimo = { '-1': 1, '1': 2 };
    lista.forEach((v) => {
      const chiave = String(v.best.lato);
      const eraReale = v.e.civico != null;
      const civico = eraReale ? v.e.civico : prossimo[chiave];
      if (!eraReale) prossimo[chiave] += 2;
      v.e.civico = civico;
      v.e.via = nome;
      indirizzi.push({
        via: nome, civico: civico, x: v.e.x, y: v.e.y,
        ax: r1(v.best.ax), ay: r1(v.best.ay), edificio: v.i, reale: eraReale
      });
    });
  });
  return indirizzi;
}

/* La pizzeria: se nell'export c'è un locale che ci somiglia si usa quello, con
   il suo nome vero. Altrimenti la si apre nell'edificio più centrale — un
   paese senza pizzeria non si può consegnare. */
function scegliPizzeria(edifici, conTag) {
  const locale = edifici.find((e) => e.tipo === 'pizzeria');
  if (locale) {
    return { x: locale.x, y: locale.y, nome: locale.nome || 'Pizzeria', via: locale.via || '', civico: locale.civico || '' };
  }
  let best = null;
  edifici.forEach((e) => {
    if (e.tipo === 'capannone') return;
    const d = Math.hypot(e.x, e.y);
    if (!best || d < best.d) best = { d, e };
  });
  const e = best.e;
  e.tipo = 'pizzeria';
  e.nome = 'Pizzeria di Codiverno';
  return { x: e.x, y: e.y, nome: e.nome, via: e.via || '', civico: e.civico || '' };
}

function leggiTag(corpo) {
  const t = {};
  for (const m of corpo.matchAll(/<tag\s+k=["']([^"']+)["']\s+v=["']([^"']*)["']/g)) t[m[1]] = m[2];
  return t;
}

/* Da gradi a metri, piano tangente sull'origine: su un paese di un chilometro
   la curvatura della Terra vale centimetri, quindi non serve una proiezione
   vera. */
function proietta(lat, lon) {
  const R = 6378137;
  return {
    x: (lon - ORIGINE.lon) * Math.PI / 180 * R * Math.cos(ORIGINE.lat * Math.PI / 180),
    y: (lat - ORIGINE.lat) * Math.PI / 180 * R
  };
}

/* Il rettangolo che meglio contiene una sagoma: si prova a ruotarlo di grado
   in grado e si tiene quello di area minima. È il «minimum bounding
   rectangle» povero, e su una pianta di casa dà il risultato giusto. */
function scatola(punti) {
  let best = null;
  for (let g = 0; g < 90; g += 3) {
    const a = g * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    punti.forEach((p) => {
      const X = p.x * c + p.y * s, Y = -p.x * s + p.y * c;
      minx = Math.min(minx, X); maxx = Math.max(maxx, X);
      miny = Math.min(miny, Y); maxy = Math.max(maxy, Y);
    });
    const area = (maxx - minx) * (maxy - miny);
    if (!best || area < best.area) best = { area, a, minx, maxx, miny, maxy, c, s };
  }
  const cx = (best.minx + best.maxx) / 2, cy = (best.miny + best.maxy) / 2;
  return {
    x: r1(cx * best.c - cy * best.s), y: r1(cx * best.s + cy * best.c),
    l: r1(best.maxx - best.minx), w: r1(best.maxy - best.miny),
    rot: Math.round(best.a * 1000) / 1000, h: 6, tipo: 'casa'
  };
}

/* ---------- scrittura ---------- */

function main() {
  let mappa;
  if (fs.existsSync(OSM)) {
    mappa = daOsm(fs.readFileSync(OSM, 'utf8'));
    console.log('mappa da ' + path.relative(ROOT, OSM));
  } else if (fs.existsSync(GEOJSON)) {
    console.error('GeoJSON non ancora supportato: esporta in .osm da openstreetmap.org');
    process.exit(1);
  } else {
    mappa = ricostruisci();
    console.log('nessun export in dati/: mappa RICOSTRUITA (non è il rilievo di Codiverno)');
  }

  suddividi(mappa);
  /* Prima si pota, poi si calcolano gli accessi: al contrario un civico
     restava accostato a un troncone appena buttato via, e il punto di consegna
     finiva in mezzo ai campi. */
  potaTronconi(mappa);
  accessi(mappa);
  const g = grafo(mappa);
  mappa.nodi = g.nodi;
  mappa.archi = g.archi;

  const testata = '/* Mappa di ' + mappa.nome + ' (' + mappa.comune + ') — GENERATO da tools/mappa.js.\n' +
    '   Non si modifica a mano: si rigenera con `node tools/mappa.js`.\n' +
    '   Fonte: ' + mappa.fonte + (mappa.attribuzione ? ' — ' + mappa.attribuzione : '') + '.\n' +
    '   Coordinate in metri, origine sulla piazza, x a est e y a nord. */\n';

  const corpo = 'var TG = window.TG || {};\nwindow.TG = TG;\nTG.mappe = TG.mappe || {};\n\n' +
    'TG.mappe.codiverno = ' + JSON.stringify(mappa) + ';\n';

  fs.writeFileSync(USCITA, testata + corpo);
  console.log('strade ' + mappa.strade.length + ', edifici ' + mappa.edifici.length +
    ', alberi ' + mappa.alberi.length + ', indirizzi ' + mappa.indirizzi.length +
    ', nodi ' + mappa.nodi.length + ', archi ' + mappa.archi.length);
  console.log('scritto ' + path.relative(ROOT, USCITA) + ' (' + Math.round(fs.statSync(USCITA).size / 1024) + ' KB)');
}

main();
