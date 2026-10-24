/* Classifica globale su Firebase (Realtime Database via REST).

   Perché REST e non l'SDK: la suite si apre anche con un doppio click sul
   file, non ha un passaggio di build e tutti gli script sono file singoli nel
   namespace TG. L'SDK di Firebase sono moduli ES e un bundler; il Realtime
   Database invece parla HTTP semplice — una GET per leggere la classifica, una
   PUT per scrivere la propria riga — e per l'accesso anonimo bastano due
   chiamate. Niente dipendenze, niente build, funziona anche da file://.

   Come si accende: in index.html, nel <meta name="classifica">, l'indirizzo
   del database e la chiave web del progetto. Finché sono vuoti questo modulo
   resta spento e la suite si comporta esattamente come prima — classifiche
   locali e nient'altro. Non è un ripiego: senza rete (o senza progetto) il
   gioco deve partire comunque.

   Quei due valori NON sono segreti: la chiave web di Firebase sta in chiaro in
   qualunque app Firebase ed è un identificativo di progetto, non una
   password. Quello che protegge i dati sono le regole del database
   (dati/regole-firebase.json), che è il posto giusto in cui farlo.

   Chi è chi: ogni browser ottiene un utente anonimo, cioè un `uid` stabile che
   resta nel localStorage. Il nome utente si «prende»: scrivere in nomi/<slug>
   riesce solo se nessun altro uid l'ha già preso, quindi due persone non
   possono presentarsi con lo stesso nome, e nessuno può firmare col nome di un
   altro. La riga dei punteggi è una sola per giocatore e per gioco — la sua
   migliore — perché una classifica in cui uno occupa dieci posizioni su dieci
   non mette in competizione nessuno.

   Una cosa va detta chiaramente, ed è scritta anche nel README: i punti li
   calcola il browser, quindi chi vuole falsificarli può farlo. Le regole
   controllano la forma e un tetto plausibile, non l'onestà; per quella
   servirebbe far girare i giochi su un server, che è un altro mestiere. */
TG.nuvola = (function () {
  'use strict';

  var TIMEOUT = 8000;          // oltre questo una richiesta è persa, non attesa
  var QUANTI = 10;             // righe di classifica globale
  var MARGINE_TOKEN = 60000;   // si rinnova un minuto prima della scadenza
  var TETTO_PUNTI = 10000000;  // oltre è per forza spazzatura (vedi le regole)
  var PROVA = '__prova';       // collezione vuota usata per capire se si può leggere

  /* ---------- configurazione ---------- */

  /* Interruttore: `?classifica=off` nell'indirizzo (o window.TG_CLASSIFICA a
     false) spegne la classifica globale per quella scheda. Serve a due cose —
     aprire la pagina per provarla senza entrare in classifica e senza che
     venga chiesto un nome, e far girare il test di fumo sulla pagina vera
     senza scrivere nel database vero. Senza un interruttore del genere,
     l'unico modo di provare la suite «da spenta» sarebbe svuotare il meta,
     cioè modificare il sito. */
  function spenta() {
    try {
      if (window.TG_CLASSIFICA === false) return true;
      var q = (typeof location !== 'undefined' && location.search) || '';
      return /[?&]classifica=(off|no|0)(&|$)/.test(q);
    } catch (e) {
      return false;
    }
  }

  /* Due sorgenti: l'oggetto window.TG_CLASSIFICA, se qualcuno vuole puntare a
     un altro database senza toccare la pagina (lo usa il test di fumo con un
     Firebase finto), altrimenti il meta di index.html. */
  function leggiConfig() {
    if (spenta()) return null;
    var c = window.TG_CLASSIFICA;
    if (c && c.url && c.chiave) {
      return { url: String(c.url).replace(/\/+$/, ''), chiave: String(c.chiave) };
    }
    var meta = (typeof document !== 'undefined' && document.querySelector)
      ? document.querySelector('meta[name="classifica"]') : null;
    if (!meta) return null;
    var url = (meta.getAttribute('content') || '').trim().replace(/\/+$/, '');
    var chiave = (meta.getAttribute('data-chiave') || '').trim();
    if (!url || !chiave) return null;
    return { url: url, chiave: chiave };
  }

  var cfg = leggiConfig();
  var sessione = null;      // { uid, token, scade, refresh }
  var inEntrata = null;     // callback in attesa, per non creare due utenti
  var ultimoErrore = '';

  function attiva() { return !!cfg; }

  /* ---------- nome utente ---------- */

  /* Lo slug è il nome in minuscolo con gli spazi diventati trattini, e basta:
     la pulizia vera (accenti, caratteri non ammessi, lunghezza) la fa
     TG.profile.pulisci, che è lo stesso insieme di caratteri che accettano le
     regole del database. Devono coincidere a una lettera, perché la regola che
     impedisce di firmare col nome di un altro ricalcola lo slug dal nome con
     le sole funzioni che Firebase ha — toLowerCase e replace — e se qui
     facessimo qualcosa in più ogni nome con uno spazio verrebbe rifiutato dal
     server dopo essere stato accettato a schermo. */
  function slug(nome) {
    return TG.profile.pulisci(nome).toLowerCase().replace(/ /g, '-');
  }

  function nomePreso() { return TG.storage.get('nuvola:nome', '') || ''; }

  /* ---------- chiamate ---------- */

  /* Gli errori di Firebase arrivano in codice: CONFIGURATION_NOT_FOUND,
     Permission denied, API key not valid. A chi gioca non dicono niente, e a
     chi ha montato il progetto dicono qualcosa solo dopo una ricerca. Qui
     diventano la frase che indica il rimedio, con il codice originale fra
     parentesi per chi deve cercarlo davvero.

     Non è una decorazione: CONFIGURATION_NOT_FOUND, il primo errore comparso
     accendendo la classifica per davvero, vuol dire una cosa sola — in
     Authentication non è mai stato premuto «Inizia» — e il messaggio crudo
     lascia a indovinare fra la chiave, l'indirizzo e le regole. */
  var SPIEGAZIONI = [
    [/CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/,
      'l\'accesso anonimo non è attivo sul progetto Firebase ' +
      '(Authentication → Inizia → Metodo di accesso → Anonimo)'],
    [/API key not valid|API_KEY_INVALID|INVALID_API_KEY|keyInvalid/,
      'la chiave web del progetto non è quella giusta'],
    [/Index not defined|indexOn/,
      'nelle regole del database manca l\'indice ".indexOn": "punti"'],
    [/TOKEN_EXPIRED|USER_DISABLED|INVALID_REFRESH_TOKEN|INVALID_ID_TOKEN/,
      'la sessione anonima non vale più: ricarica la pagina'],
    [/Permission denied/,
      'il database ha rifiutato l\'operazione: controlla di aver pubblicato le regole'],
    [/404|Not Found/,
      'l\'indirizzo del database non risponde: controlla la regione']
  ];

  function spiega(grezzo) {
    for (var i = 0; i < SPIEGAZIONI.length; i++) {
      if (SPIEGAZIONI[i][0].test(grezzo)) return SPIEGAZIONI[i][1] + ' (' + grezzo + ')';
    }
    return grezzo;
  }

  function erroreDa(stato, dati, testo) {
    var m = (dati && dati.error && (dati.error.message || dati.error)) || testo || ('HTTP ' + stato);
    var grezzo = String(m);
    var e = new Error(spiega(grezzo));
    e.stato = stato;
    e.codice = grezzo;
    return e;
  }

  /* fetch con un tetto di tempo: una richiesta che non torna non deve lasciare
     l'interfaccia in «sto caricando» per sempre. */
  function chiama(url, opzioni, cb) {
    if (typeof window.fetch !== 'function') { cb(new Error('questo browser non sa fare richieste')); return; }
    var chiuso = false;
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var o = opzioni || {};
    if (ctrl) o.signal = ctrl.signal;
    var timer = setTimeout(function () {
      if (chiuso) return;
      chiuso = true;
      if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignora */ } }
      cb(new Error('tempo scaduto'));
    }, TIMEOUT);
    function fine(err, dati) {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      cb(err, dati);
    }
    try {
      window.fetch(url, o).then(function (r) {
        return r.text().then(function (t) {
          var dati = null;
          try { dati = t ? JSON.parse(t) : null; } catch (e) { dati = null; }
          return { ok: r.ok, stato: r.status, dati: dati, testo: t };
        });
      }).then(function (r) {
        if (!r.ok) fine(erroreDa(r.stato, r.dati, r.testo));
        else fine(null, r.dati);
      }, function (e) {
        fine(e instanceof Error ? e : new Error(String(e)));
      });
    } catch (e) {
      fine(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function postJson(url, corpo, cb) {
    chiama(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    }, cb);
  }

  /* ---------- utente anonimo ---------- */

  function salvaSessione(s) {
    sessione = s;
    TG.storage.set('nuvola:sessione', s);
  }

  function usaRisposta(d, cb) {
    var token = d && (d.idToken || d.id_token);
    var uid = d && (d.localId || d.user_id);
    var refresh = d && (d.refreshToken || d.refresh_token);
    var durata = parseInt((d && (d.expiresIn || d.expires_in)) || 3600, 10) * 1000;
    if (!token || !uid) { cb(new Error('risposta di accesso incompleta')); return; }
    salvaSessione({ uid: uid, token: token, refresh: refresh || '', scade: Date.now() + durata });
    cb(null, sessione);
  }

  /* Accesso: si riusa la sessione in corso, poi il refresh token salvato, e
     solo se non c'è niente si crea un utente anonimo nuovo. L'ordine conta: un
     utente nuovo a ogni ricarica significa perdere il nome preso e la propria
     riga in classifica. */
  function entra(cb) {
    if (!cfg) { cb(new Error('classifica globale non configurata')); return; }
    if (sessione && sessione.token && sessione.scade > Date.now() + MARGINE_TOKEN) {
      cb(null, sessione);
      return;
    }
    if (inEntrata) { inEntrata.push(cb); return; }   // una sola richiesta per volta
    inEntrata = [cb];

    function finito(err, s) {
      var attesa = inEntrata;
      inEntrata = null;
      if (err) ultimoErrore = err.message;
      attesa.forEach(function (f) { f(err, s); });
    }

    if (!sessione) sessione = TG.storage.get('nuvola:sessione', null) || null;

    if (sessione && sessione.refresh) {
      postJson(
        'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.chiave),
        { grant_type: 'refresh_token', refresh_token: sessione.refresh },
        function (err, d) {
          if (!err) { usaRisposta(d, finito); return; }
          // il refresh token può essere stato revocato: si riparte da zero,
          // perdendo il nome preso ma non la possibilità di giocare
          sessione = null;
          TG.storage.remove('nuvola:sessione');
          anonimo(finito);
        }
      );
      return;
    }
    anonimo(finito);
  }

  function anonimo(cb) {
    postJson(
      'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(cfg.chiave),
      { returnSecureToken: true },
      function (err, d) {
        if (err) { cb(err); return; }
        usaRisposta(d, cb);
      }
    );
  }

  /* ---------- indirizzi del database ---------- */

  function nodo(percorso, token, query) {
    var u = cfg.url + '/' + percorso + '.json';
    var parti = [];
    if (token) parti.push('auth=' + encodeURIComponent(token));
    if (query) parti.push(query);
    return parti.length ? u + '?' + parti.join('&') : u;
  }

  /* ---------- prendere il nome ---------- */

  /* Riesce solo se lo slug è libero o già nostro: è la regola del database a
     dirlo, non un controllo qui — un controllo qui lo aggirerebbe chiunque, e
     fra il controllo e la scrittura ci sarebbe comunque una corsa. */
  function prendiNome(nome, cb) {
    cb = cb || function () {};
    var pulito = TG.profile.pulisci(nome);
    var s = slug(pulito);
    if (!s) { cb(new Error('scegli un nome con lettere o numeri')); return; }
    if (TG.profile.isDefault(pulito)) {
      cb(new Error('«' + TG.profile.DEFAULT + '» è il nome di tutti: scegline uno tuo'));
      return;
    }
    TG.profile.setName(pulito);
    if (!cfg) { cb(null, pulito); return; }  // senza nuvola il nome locale basta

    entra(function (err, ses) {
      if (err) { cb(err); return; }
      chiama(nodo('nomi/' + s, ses.token), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ses.uid)
      }, function (err2) {
        if (err2) {
          /* Un 403 scrivendo il nome vuol dire due cose opposte: lo slug è di
             un altro (e allora basta cambiarlo), oppure le regole non sono mai
             state pubblicate e il database rifiuta tutto (e allora cambiare
             nome non servirà mai). Dirlo a caso manderebbe chi gioca a
             provarne venti. La differenza si misura: la classifica è
             pubblicamente leggibile *per regola*, quindi se non si riesce
             nemmeno a leggerla il problema sono le regole. */
          if (err2.stato === 401 || err2.stato === 403) {
            chiama(nodo('punteggi/' + PROVA, null, null), { method: 'GET' }, function (err3) {
              if (err3 && (err3.stato === 401 || err3.stato === 403)) {
                cb(new Error('le regole del database non sono state pubblicate: ' +
                  'il database rifiuta anche di farsi leggere'));
                return;
              }
              var e = new Error('«' + pulito + '» è già di un altro giocatore: scegline un altro');
              e.preso = true;
              cb(e);
            });
            return;
          }
          cb(err2);
          return;
        }
        TG.storage.set('nuvola:nome', pulito);
        TG.storage.set('nuvola:slug', s);
        rinominaRighe(pulito);
        svuotaCoda();
        cb(null, pulito);
      });
    });
  }

  /* Cambiando nome le righe già in classifica porterebbero il vecchio fino
     alla prossima partita migliore: si aggiornano subito, una PATCH per gioco
     in cui si è già scritto qualcosa. */
  function rinominaRighe(nome) {
    var miei = TG.storage.get('nuvola:inviati', {}) || {};
    Object.keys(miei).forEach(function (gioco) {
      entra(function (err, ses) {
        if (err) return;
        chiama(nodo('punteggi/' + gioco + '/' + ses.uid, ses.token), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome: nome })
        }, function () { /* se non riesce, si sistema alla prossima partita */ });
      });
    });
  }

  /* ---------- invio dei risultati ---------- */

  /* In classifica globale va solo il proprio meglio: un punteggio più basso non
     si invia nemmeno (e la regola del database lo rifiuterebbe comunque). */
  function mioMeglio(gioco) {
    var miei = TG.storage.get('nuvola:inviati', {}) || {};
    return miei[gioco] || 0;
  }

  function segnaInviato(gioco, punti) {
    var miei = TG.storage.get('nuvola:inviati', {}) || {};
    if (punti > (miei[gioco] || 0)) {
      miei[gioco] = punti;
      TG.storage.set('nuvola:inviati', miei);
    }
  }

  function coda() {
    var c = TG.storage.get('nuvola:coda', {});
    return (c && typeof c === 'object') ? c : {};
  }

  /* La coda tiene una voce per gioco, la migliore: senza rete si gioca anche
     venti partite, e venti PUT in fila sulla stessa riga sarebbero diciannove
     chiamate buttate. */
  function accoda(gioco, voce) {
    var c = coda();
    if (!c[gioco] || voce.punti > c[gioco].punti) c[gioco] = voce;
    TG.storage.set('nuvola:coda', c);
  }

  function togliDaCoda(gioco, punti) {
    var c = coda();
    if (c[gioco] && c[gioco].punti <= punti) {
      delete c[gioco];
      TG.storage.set('nuvola:coda', c);
    }
  }

  function inAttesa() { return Object.keys(coda()).length; }

  function invia(gioco, dati) {
    if (!cfg) return 'spenta';
    var nome = nomePreso();
    if (!nome) return 'senza-nome';          // prima si prende il nome
    var punti = Math.max(0, Math.round((dati && dati.punti) || 0));
    if (punti > TETTO_PUNTI) return 'assurdo';
    if (punti <= mioMeglio(gioco)) return 'non-record';

    var voce = {
      nome: nome,
      punti: punti,
      livello: Math.max(1, Math.min(999, Math.round((dati && dati.livello) || 1))),
      da: Math.max(1, Math.min(999, Math.round((dati && dati.da) || 1))),
      quando: Date.now(),
      v: (TG.versione && TG.versione.numero) || 0
    };
    accoda(gioco, voce);
    svuotaCoda();
    return 'in-corso';
  }

  /* Svuota la coda: una riga per gioco, e quel che non parte resta in coda per
     il prossimo tentativo. Si richiama al caricamento della pagina e quando la
     scheda torna in primo piano, che è quando la rete di solito è tornata. */
  function svuotaCoda(cb) {
    cb = cb || function () {};
    if (!cfg) { cb(new Error('classifica globale non configurata')); return; }
    var c = coda();
    var giochi = Object.keys(c);
    if (!giochi.length) { cb(null, 0); return; }
    if (!nomePreso()) { cb(new Error('nome non ancora preso')); return; }

    entra(function (err, ses) {
      if (err) { cb(err); return; }
      var restano = giochi.length;
      var fatti = 0;
      giochi.forEach(function (gioco) {
        var voce = c[gioco];
        chiama(nodo('punteggi/' + gioco + '/' + ses.uid, ses.token), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(voce)
        }, function (err2) {
          if (!err2) {
            fatti++;
            segnaInviato(gioco, voce.punti);
            togliDaCoda(gioco, voce.punti);
          } else if (err2.stato === 401 || err2.stato === 403) {
            /* La regola rifiuta un punteggio non migliore di quello già in
               classifica: insistere non cambierebbe niente, la voce esce dalla
               coda. */
            togliDaCoda(gioco, voce.punti);
            ultimoErrore = err2.message;
          } else {
            ultimoErrore = err2.message;
          }
          if (--restano === 0) cb(null, fatti);
        });
      });
    });
  }

  /* ---------- lettura della classifica ---------- */

  /* La lettura è pubblica: nessun token, così la classifica compare anche
     prima di aver preso un nome. Ordinare e tagliare lo fa il database
     (orderBy + limitToLast, con l'indice dichiarato nelle regole), altrimenti
     scaricheremmo tutti i giocatori per mostrarne dieci. */
  function top(gioco, cb) {
    if (!cfg) { cb(new Error('classifica globale non configurata')); return; }
    var q = 'orderBy=' + encodeURIComponent('"punti"') + '&limitToLast=' + QUANTI;
    chiama(nodo('punteggi/' + gioco, null, q), { method: 'GET' }, function (err, d) {
      if (err) { ultimoErrore = err.message; cb(err); return; }
      cb(null, ordina(d, mioUid()));
    });
  }

  /* Firebase restituisce un oggetto uid -> riga: l'ordine delle chiavi non è
     garantito, quindi si riordina qui con lo stesso criterio della classifica
     locale (punti, poi livello, poi chi è arrivato prima). */
  function ordina(mappa, uid) {
    var righe = [];
    if (mappa && typeof mappa === 'object') {
      Object.keys(mappa).forEach(function (k) {
        var r = mappa[k];
        if (!r || typeof r !== 'object') return;
        righe.push({
          uid: k,
          nome: String(r.nome || '?').slice(0, 14),
          punti: Math.max(0, Math.round(r.punti || 0)),
          livello: Math.max(1, Math.round(r.livello || 1)),
          da: Math.max(1, Math.round(r.da || 1)),
          quando: r.quando || 0,
          io: !!uid && k === uid
        });
      });
    }
    righe.sort(function (a, b) {
      if (b.punti !== a.punti) return b.punti - a.punti;
      if (b.livello !== a.livello) return b.livello - a.livello;
      return (a.quando || 0) - (b.quando || 0);
    });
    return righe.slice(0, QUANTI);
  }

  function mioUid() {
    if (sessione && sessione.uid) return sessione.uid;
    var s = TG.storage.get('nuvola:sessione', null);
    return (s && s.uid) || '';
  }

  /* ---------- stato per l'interfaccia ---------- */

  function stato() {
    return {
      attiva: attiva(),
      nome: nomePreso(),
      uid: mioUid(),
      inAttesa: inAttesa(),
      errore: ultimoErrore
    };
  }

  /* Al caricamento si prova a svuotare la coda, e si riprova quando la scheda
     torna visibile: chi ha finito una partita in metropolitana la vede salire
     in classifica appena riemerge, senza doverne giocare un'altra. */
  function avvio() {
    if (!cfg) return;
    if (inAttesa()) svuotaCoda();
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && inAttesa()) svuotaCoda();
      });
    }
  }

  return {
    attiva: attiva,
    stato: stato,
    nome: nomePreso,
    slug: slug,
    prendiNome: prendiNome,
    invia: invia,
    sincronizza: svuotaCoda,
    top: top,
    ordina: ordina,
    inAttesa: inAttesa,
    avvio: avvio,
    QUANTI: QUANTI,
    TETTO_PUNTI: TETTO_PUNTI
  };
})();
