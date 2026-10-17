/* Un Firebase finto, con le regole vere dentro.

   Serve a due test diversi — test/regole.js nella sandbox e test/smoke.js nel
   browser — quindi è un file solo che si lascia usare da entrambi: in Node si
   richiede, nel browser il suo testo viene iniettato nella pagina prima degli
   script della suite.

   La parte che conta non è il finto database: è che qui dentro ci sono le
   stesse regole di dati/regole-firebase.json — chi può scrivere quale riga, il
   nome che deve essere tuo, il punteggio che non può scendere, i campi
   estranei rifiutati. Un finto permissivo direbbe solo che il client sa fare
   una PUT; così invece dice se client e regole combaciano, e il difetto tipico
   di questa integrazione è proprio lì: il nome che il client trasforma in slug
   in un modo e le regole in un altro, con il server che rifiuta quello che a
   schermo era stato accettato. */
function creaFintoFirebase(opzioni) {
  'use strict';
  var o = opzioni || {};
  var URL_DB = (o.url || 'https://finto-db.test').replace(/\/+$/, '');
  var CHIAVE = o.chiave || 'chiave-finta';
  var dati = o.dati || { nomi: {}, punteggi: {} };
  var sessioni = {};          // token -> uid
  var refresh = {};           // refresh token -> uid
  var contatore = 0;
  var chiamate = [];
  var stato = { guasto: !!o.guasto };

  /* Lo stesso slug delle regole: minuscolo, spazi in trattini. Nient'altro —
     le regole di Firebase hanno solo toLowerCase e replace, e se il client
     facesse di più il server rifiuterebbe. */
  function slugDiNome(nome) { return String(nome).toLowerCase().split(' ').join('-'); }

  function risposta(stato_, corpo) {
    return Promise.resolve({
      ok: stato_ >= 200 && stato_ < 300,
      status: stato_,
      text: function () { return Promise.resolve(corpo === undefined ? '' : JSON.stringify(corpo)); }
    });
  }

  function errore(stato_, messaggio) {
    return risposta(stato_, { error: { code: stato_, message: messaggio } });
  }

  function nuovoUtente() {
    contatore++;
    var uid = 'uid' + contatore;
    var tok = 'tok' + contatore + '-' + Math.floor(Math.random() * 1e6);
    var ref = 'ref' + contatore;
    sessioni[tok] = uid;
    refresh[ref] = uid;
    return { idToken: tok, refreshToken: ref, localId: uid, expiresIn: '3600' };
  }

  function query(url) {
    var i = url.indexOf('?');
    var q = {};
    if (i < 0) return q;
    url.slice(i + 1).split('&').forEach(function (p) {
      var kv = p.split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    });
    return q;
  }

  /* Le validazioni dei campi, una per una come nelle regole. */
  function campiValidi(riga) {
    var ammessi = { nome: 1, punti: 1, livello: 1, da: 1, quando: 1, v: 1 };
    var chiavi = Object.keys(riga);
    for (var i = 0; i < chiavi.length; i++) if (!ammessi[chiavi[i]]) return 'campo estraneo: ' + chiavi[i];
    if (riga.nome === undefined || riga.punti === undefined || riga.livello === undefined) return 'campi obbligatori mancanti';
    if (typeof riga.nome !== 'string' || !/^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/.test(riga.nome) || riga.nome.length > 14) return 'nome non valido';
    if (typeof riga.punti !== 'number' || riga.punti < 0 || riga.punti > 10000000) return 'punti fuori scala';
    if (typeof riga.livello !== 'number' || riga.livello < 1 || riga.livello > 999) return 'livello fuori scala';
    if (riga.da !== undefined && (typeof riga.da !== 'number' || riga.da < 1 || riga.da > 999)) return 'partenza fuori scala';
    if (riga.quando !== undefined && typeof riga.quando !== 'number') return 'data non valida';
    if (riga.v !== undefined && typeof riga.v !== 'number') return 'versione non valida';
    return '';
  }

  function scriviPunteggio(gioco, uid, riga, auth, unisci) {
    if (!auth) return errore(401, 'Permission denied');
    if (auth !== uid) return errore(403, 'Permission denied');
    var vecchia = (dati.punteggi[gioco] || {})[uid] || null;
    var finale = {};
    if (unisci && vecchia) Object.keys(vecchia).forEach(function (k) { finale[k] = vecchia[k]; });
    Object.keys(riga).forEach(function (k) { finale[k] = riga[k]; });

    var problema = campiValidi(finale);
    if (problema) return errore(400, problema);
    if (dati.nomi[slugDiNome(finale.nome)] !== uid) return errore(403, 'Permission denied: nome non tuo');
    if (vecchia && finale.punti < vecchia.punti) return errore(403, 'Permission denied: punteggio in calo');

    if (!dati.punteggi[gioco]) dati.punteggi[gioco] = {};
    dati.punteggi[gioco][uid] = finale;
    return risposta(200, finale);
  }

  function leggiTop(gioco, q) {
    var righe = dati.punteggi[gioco] || {};
    var chiavi = Object.keys(righe);
    if (q.orderBy === '"punti"') {
      chiavi.sort(function (a, b) { return righe[a].punti - righe[b].punti; });
      var n = parseInt(q.limitToLast || '0', 10);
      /* limitToLast dà le ultime N in ordine crescente, e Firebase le
         restituisce come oggetto: l'ordine delle chiavi non è un contratto, ed
         è il client che deve riordinare. Il finto le consegna dal più basso al
         più alto proprio per non far passare un client che si fida. */
      if (n > 0) chiavi = chiavi.slice(Math.max(0, chiavi.length - n));
    }
    var fuori = {};
    chiavi.forEach(function (k) { fuori[k] = righe[k]; });
    return risposta(200, chiavi.length ? fuori : null);
  }

  function fetchFinto(url, opt) {
    url = String(url);
    opt = opt || {};
    var metodo = (opt.method || 'GET').toUpperCase();
    chiamate.push(metodo + ' ' + url);
    if (stato.guasto) return Promise.reject(new Error('rete finta giù'));

    var corpo = null;
    if (opt.body) { try { corpo = JSON.parse(opt.body); } catch (e) { corpo = null; } }
    var q = query(url);

    if (url.indexOf('identitytoolkit.googleapis.com') >= 0) {
      if (q.key !== CHIAVE) return errore(400, 'API key not valid');
      return risposta(200, nuovoUtente());
    }
    if (url.indexOf('securetoken.googleapis.com') >= 0) {
      if (q.key !== CHIAVE) return errore(400, 'API key not valid');
      var uid = corpo && refresh[corpo.refresh_token];
      if (!uid) return errore(400, 'TOKEN_EXPIRED');
      var tok = 'tok-r' + (++contatore);
      sessioni[tok] = uid;
      return risposta(200, { id_token: tok, refresh_token: corpo.refresh_token, user_id: uid, expires_in: '3600' });
    }
    if (url.indexOf(URL_DB) !== 0) return errore(404, 'non previsto dal finto: ' + url);

    var percorso = url.slice(URL_DB.length).split('?')[0].replace(/^\/+/, '').replace(/\.json$/, '');
    var parti = percorso.split('/');
    var auth = q.auth ? sessioni[q.auth] : null;
    if (q.auth && !auth) return errore(401, 'Auth token is invalid');

    if (parti[0] === 'nomi' && parti.length === 2 && (metodo === 'PUT' || metodo === 'PATCH')) {
      if (!auth) return errore(401, 'Permission denied');
      var preso = dati.nomi[parti[1]];
      if (preso && preso !== auth) return errore(403, 'Permission denied');
      if (corpo !== auth) return errore(400, 'il nodo deve contenere il proprio uid');
      dati.nomi[parti[1]] = auth;
      return risposta(200, auth);
    }
    if (parti[0] === 'punteggi' && parti.length === 3 && (metodo === 'PUT' || metodo === 'PATCH')) {
      return scriviPunteggio(parti[1], parti[2], corpo || {}, auth, metodo === 'PATCH');
    }
    if (parti[0] === 'punteggi' && parti.length === 2 && metodo === 'GET') {
      return leggiTop(parti[1], q);
    }
    return errore(403, 'Permission denied');
  }

  return {
    fetch: fetchFinto,
    dati: dati,
    chiamate: chiamate,
    url: URL_DB,
    chiave: CHIAVE,
    guasto: function (v) { stato.guasto = !!v; },
    slug: slugDiNome
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { creaFintoFirebase: creaFintoFirebase };
