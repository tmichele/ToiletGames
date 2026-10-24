/* Tutto il DOM della suite: elenco giochi, HUD, classifica, pannelli. */
TG.ui = (function () {
  'use strict';

  var el = {};

  function init(refs) {
    el = refs;
    renderVersione();
  }

  /* La versione resta in barra anche mentre si gioca: è lì per dire a colpo
     d'occhio se la pagina caricata è l'ultima pubblicata o una copia in cache. */
  function renderVersione() {
    if (!el.version || !TG.versione) return;
    el.version.textContent = 'v' + TG.versione.numero;
    el.version.title = 'Versione ' + TG.versione.numero + ' del ' + TG.versione.data;
  }

  /* ---------- home ---------- */

  function renderHome(onPick) {
    var grid = el.grid;
    grid.innerHTML = '';
    TG.registry.all().forEach(function (game) {
      var st = TG.scores.stats(game.id);
      var card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      var statText = st.plays
        ? 'record ' + st.bestScore + ' · liv. ' + st.bestLevel
        : 'mai giocato';
      if (st.checkpoint > 1) statText += ' · 🚩' + st.checkpoint;
      card.innerHTML =
        '<span class="card__icon" aria-hidden="true">' + TG.util.escapeHtml(game.icon) + '</span>' +
        '<span class="card__title">' + TG.util.escapeHtml(game.title) + '</span>' +
        '<span class="card__tagline">' + TG.util.escapeHtml(game.tagline) + '</span>' +
        '<span class="card__stat' + (st.plays ? '' : ' is-empty') + '">' + statText + '</span>';
      card.addEventListener('click', function () { onPick(game.id); });
      grid.appendChild(card);
    });
    renderHomeStats();
  }

  function renderHomeStats() {
    var games = TG.registry.all();
    var plays = TG.scores.totalPlays();
    var bestGame = null, bestLevel = 0;
    games.forEach(function (g) {
      var lv = TG.scores.bestLevel(g.id);
      if (lv > bestLevel) { bestLevel = lv; bestGame = g; }
    });
    var lines = [
      '<p class="stats-line">Giochi disponibili: <b>' + games.length + '</b> · partite giocate: <b>' + plays + '</b></p>'
    ];
    if (bestGame) {
      lines.push('<p class="stats-line">Miglior livello raggiunto: <b>' + bestLevel +
        '</b> a <b>' + TG.util.escapeHtml(bestGame.title) + '</b></p>');
    }
    var conCheckpoint = games.filter(function (g) { return TG.scores.checkpoint(g.id) > 1; });
    if (conCheckpoint.length) {
      lines.push('<p class="stats-line">Puoi riprendere 🚩 da: <b>' +
        conCheckpoint.map(function (g) {
          return TG.util.escapeHtml(g.title) + ' liv. ' + TG.scores.checkpoint(g.id);
        }).join('</b>, <b>') + '</b></p>');
    }
    var nuv = (TG.nuvola && TG.nuvola.stato()) || { attiva: false };
    var riga = 'Giocatore: <b>' + TG.util.escapeHtml(TG.profile.getName()) + '</b>';
    if (nuv.attiva) {
      riga += nuv.nome
        ? ' · 🌍 in classifica globale' + (nuv.inAttesa ? ' <i>(un risultato in coda)</i>' : '')
        : ' · <i>🌍 prendi un nome per entrare in classifica globale</i>';
    }
    if (!TG.storage.isPersistent) riga += ' · <i>classifiche non salvabili su questo browser</i>';
    lines.push('<p class="stats-line">' + riga + '</p>');
    el.homeStats.innerHTML = lines.join('');
  }

  /* ---------- HUD ---------- */

  function setHudLabels(game) {
    el.scoreLabel.textContent = game.scoreLabel;
    el.howto.innerHTML = game.howto;
    el.modalGame = game;
  }

  function bump(node) {
    node.classList.remove('is-bump');
    void node.offsetWidth; // forza il restart dell'animazione
    node.classList.add('is-bump');
  }

  function setScore(v) { el.score.textContent = v; bump(el.score); }
  /* Niente bandierina accanto al livello: da quando ogni livello è una
     ripartenza comparirebbe sempre, e un segno sempre acceso non segnala
     niente. Il livello da cui si può ripartire si legge dove serve davvero:
     nel pannello di inizio partita e sulla card in home. */
  function setLevel(v) {
    el.level.textContent = v;
    bump(el.level);
  }
  function setBest(v) { el.best.textContent = v; }

  /* ---------- classifica ---------- */

  function rigaBoard(pos, nome, livello, punti, extra, classe) {
    var li = document.createElement('li');
    if (classe) li.className = classe;
    li.innerHTML =
      '<span class="board__rank">' + pos + '.</span>' +
      '<span class="board__name">' + TG.util.escapeHtml(nome) + '</span>' +
      (extra || '') +
      '<span class="board__lvl">L' + livello + '</span>' +
      '<span class="board__score">' + punti + '</span>';
    return li;
  }

  function vuota(ol, testo) {
    ol.innerHTML = '';
    var li = document.createElement('li');
    li.className = 'board__empty';
    li.textContent = testo;
    ol.appendChild(li);
  }

  function renderBoard(gameId, highlightId) {
    var list = TG.scores.top(gameId);
    var ol = el.board;
    ol.innerHTML = '';
    if (!list.length) {
      vuota(ol, 'Ancora nessun risultato: la prima partita entra di sicuro.');
      return;
    }
    list.forEach(function (e, i) {
      // se la partita era iniziata da un checkpoint lo si dice: i punti dei
      // livelli saltati mancano, ed è giusto poterlo leggere in classifica
      var partenza = (e.from && e.from > 1) ? '<span class="board__from">da ' + e.from + '</span>' : '';
      ol.appendChild(rigaBoard(i + 1, e.name, e.level, e.score, partenza,
        (highlightId && e.id === highlightId) ? 'is-new' : ''));
    });
  }

  /* La classifica globale arriva dalla rete, quindi ha tre stati da mostrare e
     non uno: la sto caricando, non si raggiunge, eccola. Nasconderne due
     lascerebbe un elenco vuoto a dire due cose diverse — «nessuno ha ancora
     giocato» e «la rete non va» — che è la cosa peggiore da far indovinare.
     `giro` scarta la risposta di un gioco che non è più quello aperto: aprire e
     chiudere due classifiche di fretta altrimenti mescolerebbe le righe. */
  var giro = 0;

  function renderBoardGlobale(gameId) {
    if (!el.boardGlobale) return;
    giro++;
    var mio = giro;
    var st = (TG.nuvola && TG.nuvola.stato()) || { attiva: false };

    el.boardTitGlobale.hidden = !st.attiva;
    el.boardGlobale.hidden = !st.attiva;

    if (!st.attiva) {
      el.boardStato.className = 'board__stato is-off';
      el.boardStato.textContent = 'Classifica globale non attiva su questa copia: ' +
        'i risultati restano su questo browser.';
      return;
    }

    el.boardStato.className = 'board__stato';
    el.boardStato.textContent = 'Carico la classifica…';
    vuota(el.boardGlobale, '…');

    TG.nuvola.top(gameId, function (err, righe) {
      if (mio !== giro) return;
      if (err) {
        el.boardStato.className = 'board__stato is-err';
        el.boardStato.textContent = 'Classifica globale non raggiungibile (' + err.message + '). ' +
          (st.inAttesa ? 'Il tuo risultato è in coda e riparte da solo.' : 'Qui sotto ci sei tu.');
        el.boardGlobale.hidden = true;
        return;
      }
      if (!righe.length) {
        vuota(el.boardGlobale, 'Nessuno ancora: il primo punteggio è primo per definizione.');
      } else {
        el.boardGlobale.innerHTML = '';
        righe.forEach(function (r, i) {
          var partenza = (r.da && r.da > 1) ? '<span class="board__from">da ' + r.da + '</span>' : '';
          el.boardGlobale.appendChild(
            rigaBoard(i + 1, r.nome, r.livello, r.punti, partenza, r.io ? 'is-io' : '')
          );
        });
      }
      el.boardStato.className = 'board__stato';
      el.boardStato.textContent = st.nome
        ? 'Sei in gara come ' + st.nome + (st.inAttesa ? ' · un risultato è in coda' : '')
        : 'Prendi un nome col pulsante 👤 per entrare in classifica.';
    });
  }

  /* ---------- il nome del giocatore ---------- */

  function renderNome(messaggio, classe, mostraSalta) {
    if (!el.inputNome) return;
    if (el.nomeSalta) el.nomeSalta.hidden = !mostraSalta;
    var st = (TG.nuvola && TG.nuvola.stato()) || { attiva: false, nome: '' };
    el.nomeIntro.textContent = st.attiva
      ? 'In classifica globale i nomi sono unici: questo diventa tuo e nessun ' +
        'altro può usarlo. Lettere, numeri, trattino — al massimo ' + TG.profile.MAX + '.'
      : 'Il nome firma i tuoi risultati in classifica. Resta su questo browser.';
    var attuale = st.nome || TG.profile.getName();
    el.inputNome.value = TG.profile.isDefault(attuale) ? '' : attuale;
    el.nomeStato.className = 'board__stato' + (classe ? ' ' + classe : '');
    el.nomeStato.textContent = messaggio || '';
  }

  function nomeInserito() { return el.inputNome ? el.inputNome.value : ''; }

  function nomeInAttesa(attesa) {
    if (!el.nomeOk) return;
    el.nomeOk.disabled = !!attesa;
    el.nomeOk.textContent = attesa ? 'Un attimo…' : 'Prendi questo nome';
  }

  /* ---------- overlay ---------- */

  function showOverlay(opts) {
    el.overlayTitle.textContent = opts.title || '';
    el.overlayBody.innerHTML = opts.body || '';
    el.overlayActions.innerHTML = '';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn' + (a.ghost ? ' btn--ghost' : '');
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      el.overlayActions.appendChild(b);
    });
    el.overlay.hidden = false;
    var first = el.overlayActions.querySelector('.btn');
    if (first) first.focus({ preventScroll: true });
  }

  function hideOverlay() { el.overlay.hidden = true; }

  /* ---------- finestre di classifica e istruzioni ---------- */

  var TITOLI = { classifica: 'Classifica', istruzioni: 'Come si gioca', nome: 'Il tuo nome' };

  function showModal(quale) {
    el.modalTitle.textContent = (TITOLI[quale] || '') +
      (el.modalGame && quale !== 'nome' ? ' · ' + el.modalGame.title : '');
    el.modalBoard.hidden = quale !== 'classifica';
    el.modalHelp.hidden = quale !== 'istruzioni';
    if (el.modalNome) el.modalNome.hidden = quale !== 'nome';
    el.modal.hidden = false;
    if (quale === 'nome' && el.inputNome) el.inputNome.focus({ preventScroll: true });
  }

  function hideModal() { el.modal.hidden = true; }

  function isModalOpen() { return !el.modal.hidden; }

  function showView(name) {
    el.viewHome.hidden = name !== 'home';
    el.viewGame.hidden = name !== 'game';
    el.back.hidden = name !== 'game';
    el.boardBtn.hidden = name !== 'game';
    el.helpBtn.hidden = name !== 'game';
    hideModal();
    // in partita la pagina non scorre: campo e comandi si prendono lo schermo
    document.body.classList.toggle('is-playing', name === 'game');
  }

  return {
    init: init,
    renderHome: renderHome,
    renderHomeStats: renderHomeStats,
    setHudLabels: setHudLabels,
    setScore: setScore,
    setLevel: setLevel,
    setBest: setBest,
    renderBoard: renderBoard,
    renderBoardGlobale: renderBoardGlobale,
    renderNome: renderNome,
    nomeInserito: nomeInserito,
    nomeInAttesa: nomeInAttesa,
    showOverlay: showOverlay,
    hideOverlay: hideOverlay,
    showModal: showModal,
    hideModal: hideModal,
    isModalOpen: isModalOpen,
    showView: showView
  };
})();
