/* Tutto il DOM della suite: elenco giochi, HUD, classifica, pannelli. */
TG.ui = (function () {
  'use strict';

  var el = {};

  function init(refs) { el = refs; }

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
      lines.push('<p class="stats-line">Checkpoint 🚩 sbloccati: <b>' +
        conCheckpoint.map(function (g) {
          return TG.util.escapeHtml(g.title) + ' liv. ' + TG.scores.checkpoint(g.id);
        }).join('</b>, <b>') + '</b></p>');
    }
    lines.push('<p class="stats-line">Giocatore: <b>' + TG.util.escapeHtml(TG.profile.getName()) + '</b>' +
      (TG.storage.isPersistent ? '' : ' · <i>classifiche non salvabili su questo browser</i>') + '</p>');
    el.homeStats.innerHTML = lines.join('');
  }

  /* ---------- HUD ---------- */

  function setHudLabels(game) {
    el.scoreLabel.textContent = game.scoreLabel;
    el.boardTitle.textContent = 'Classifica · ' + game.title;
    el.howto.innerHTML = game.howto;
  }

  function bump(node) {
    node.classList.remove('is-bump');
    void node.offsetWidth; // forza il restart dell'animazione
    node.classList.add('is-bump');
  }

  function setScore(v) { el.score.textContent = v; bump(el.score); }
  /* Il livello multiplo di 5 è un checkpoint: si segna con la bandierina,
     così mentre giochi sai di aver messo il segnalibro. */
  function setLevel(v) {
    el.level.textContent = v + (v % TG.scores.CHECKPOINT_OGNI === 0 ? ' 🚩' : '');
    bump(el.level);
  }
  function setBest(v) { el.best.textContent = v; }

  /* ---------- classifica ---------- */

  function renderBoard(gameId, highlightId) {
    var list = TG.scores.top(gameId);
    var ol = el.board;
    ol.innerHTML = '';
    if (!list.length) {
      var li = document.createElement('li');
      li.className = 'board__empty';
      li.textContent = 'Ancora nessun risultato: la prima partita entra di sicuro.';
      ol.appendChild(li);
      return;
    }
    list.forEach(function (e, i) {
      var li = document.createElement('li');
      if (highlightId && e.id === highlightId) li.className = 'is-new';
      // se la partita era iniziata da un checkpoint lo si dice: i punti dei
      // livelli saltati mancano, ed è giusto poterlo leggere in classifica
      var partenza = (e.from && e.from > 1) ? '<span class="board__from">da ' + e.from + '</span>' : '';
      li.innerHTML =
        '<span class="board__rank">' + (i + 1) + '.</span>' +
        '<span class="board__name">' + TG.util.escapeHtml(e.name) + '</span>' +
        partenza +
        '<span class="board__lvl">L' + e.level + '</span>' +
        '<span class="board__score">' + e.score + '</span>';
      ol.appendChild(li);
    });
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

  function showView(name) {
    el.viewHome.hidden = name !== 'home';
    el.viewGame.hidden = name !== 'game';
    el.back.hidden = name !== 'game';
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
    showOverlay: showOverlay,
    hideOverlay: hideOverlay,
    showView: showView
  };
})();
