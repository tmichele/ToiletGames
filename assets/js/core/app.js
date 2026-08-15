/* Avvio della suite: collega DOM, motore e navigazione.
   Caricato per ultimo, quando tutti i giochi si sono registrati. */
(function () {
  'use strict';

  var el = {
    grid: document.getElementById('game-grid'),
    homeStats: document.getElementById('home-stats'),
    viewHome: document.getElementById('view-home'),
    viewGame: document.getElementById('view-game'),
    back: document.getElementById('btn-back'),
    sound: document.getElementById('btn-sound'),
    profileBtn: document.getElementById('btn-profile'),
    pause: document.getElementById('btn-pause'),
    stage: document.getElementById('stage'),
    canvas: document.getElementById('canvas'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayBody: document.getElementById('overlay-body'),
    overlayActions: document.getElementById('overlay-actions'),
    level: document.getElementById('hud-level'),
    score: document.getElementById('hud-score'),
    best: document.getElementById('hud-best'),
    scoreLabel: document.getElementById('hud-score-label'),
    board: document.getElementById('board'),
    clearBoard: document.getElementById('btn-clear-board'),
    boardBtn: document.getElementById('btn-board'),
    helpBtn: document.getElementById('btn-help'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBoard: document.getElementById('modal-board'),
    modalHelp: document.getElementById('modal-help'),
    modalClose: document.getElementById('modal-close'),
    touchControls: document.getElementById('touch-controls'),
    howto: document.getElementById('game-howto')
  };

  var current = null;        // gioco aperto
  var appenaSbloccato = 0;   // checkpoint conquistato in questa partita, da annunciare

  TG.ui.init(el);
  TG.input.init({ stage: el.stage, canvas: el.canvas, controls: el.touchControls });
  TG.engine.init({ stage: el.stage, canvas: el.canvas });

  /* ---------- navigazione ---------- */

  function goHome() {
    TG.engine.destroy();
    current = null;
    TG.ui.hideOverlay();
    TG.ui.showView('home');
    TG.ui.renderHome(openGame);
    if (location.hash !== '') history.replaceState(null, '', location.pathname + location.search);
  }

  function openGame(id) {
    var game = TG.registry.get(id);
    if (!game) { goHome(); return; }
    // il click sulla card cambia anche l'hash: senza questa guardia il
    // successivo hashchange ricaricherebbe la partita appena avviata
    if (current && current.id === id && TG.engine.getState() !== 'idle') return;
    current = game;
    appenaSbloccato = 0;
    TG.ui.showView('game');
    TG.ui.setHudLabels(game);
    TG.ui.setBest(TG.scores.best(game.id));
    TG.ui.renderBoard(game.id);
    TG.engine.load(game, 1);
    if (location.hash !== '#/g/' + id) location.hash = '#/g/' + id;
    showReadyOverlay();
  }

  function levelLine(level) {
    if (!current || !current.levelInfo) return '';
    var info = current.levelInfo(level);
    return info ? '\n' + info : '';
  }

  /* Avvia la partita dal livello indicato: 1, oppure il checkpoint sbloccato. */
  function avvia(livello) {
    TG.sfx.unlock();
    TG.ui.hideOverlay();
    if (TG.engine.getStartLevel() !== livello || TG.engine.getState() !== 'ready') {
      TG.engine.load(current, livello);
    }
    TG.engine.begin();
  }

  function showReadyOverlay() {
    var cp = TG.scores.checkpoint(current.id);
    var azioni = [{ label: 'Gioca', onClick: function () { avvia(1); } }];
    var corpo = current.tagline + levelLine(1);

    if (cp > 1) {
      azioni.push({
        label: 'Dal livello ' + cp,
        ghost: true,
        onClick: function () { avvia(cp); }
      });
      corpo += '\n🚩 Checkpoint sbloccato: puoi ripartire dal livello ' + cp +
        ' (i punti dei livelli saltati però non li prendi).';
    }

    TG.ui.showOverlay({
      title: current.icon + ' ' + current.title,
      body: corpo,
      actions: azioni
    });
  }

  function fromHash() {
    var m = /^#\/g\/([a-z0-9_-]+)$/i.exec(location.hash);
    if (m && TG.registry.get(m[1])) openGame(m[1]);
    else goHome();
  }

  /* ---------- eventi del motore ---------- */

  TG.engine.on('score', function (v) { TG.ui.setScore(v); });
  TG.engine.on('level', function (v) { TG.ui.setLevel(v); });

  /* Arrivare a un livello multiplo di 5 sblocca la ripartenza da lì: si salva
     subito, così resta anche se la partita finisce male un attimo dopo. */
  TG.engine.on('checkpoint', function (livello) {
    if (current && TG.scores.setCheckpoint(current.id, livello)) {
      appenaSbloccato = livello;
      TG.sfx.tone(660, 0.12, 'square', 0.08, 990);
    }
  });

  TG.engine.on('levelclear', function (d) {
    var body = (appenaSbloccato ? '🚩 Checkpoint: da ora puoi ripartire dal livello ' +
        appenaSbloccato + '.\n' : '') +
      (d.message ? d.message + '\n' : '') +
      (d.bonus ? 'Bonus livello: <b>+' + d.bonus + '</b>\n' : '') +
      'Punteggio: <b>' + d.score + '</b>' +
      levelLine(d.level + 1);
    TG.ui.showOverlay({
      title: 'Livello ' + d.level + ' superato',
      body: body,
      actions: [
        { label: 'Livello ' + (d.level + 1), onClick: function () { TG.ui.hideOverlay(); TG.engine.nextLevel(); } },
        { label: 'Chiudi partita', ghost: true, onClick: function () { finish(d.score, d.level, 'Partita chiusa'); } }
      ]
    });
  });

  TG.engine.on('gameover', function (d) {
    finish(d.score, d.level, d.message);
  });

  TG.engine.on('paused', function () {
    TG.ui.showOverlay({
      title: 'Pausa',
      body: 'Punteggio attuale: <b>' + TG.engine.getScore() + '</b>',
      actions: [
        { label: 'Riprendi', onClick: function () { TG.ui.hideOverlay(); TG.engine.resume(); } },
        { label: 'Ricomincia', ghost: true, onClick: function () { TG.ui.hideOverlay(); TG.engine.restart(); } },
        { label: 'Esci', ghost: true, onClick: goHome }
      ]
    });
  });

  /* Fine partita: registra il risultato e mostra il verdetto. */
  function finish(score, level, message) {
    var partenza = TG.engine.getStartLevel();
    var res = TG.scores.submit(current.id, score, level, partenza);
    var cp = TG.scores.checkpoint(current.id);
    TG.ui.setBest(TG.scores.best(current.id));
    TG.ui.renderBoard(current.id, res.entry.id);

    var body = (appenaSbloccato ? '🚩 Checkpoint sbloccato al livello ' + appenaSbloccato + '.\n' : '') +
      (message ? message + '\n' : '') +
      'Punteggio: <b>' + score + '</b> · livello <b>' + level + '</b>' +
      (partenza > 1 ? ' (partito dal ' + partenza + ')' : '') + '\n' +
      (res.isRecord ? '🏆 Nuovo record personale!' :
        (res.rank ? 'Sei ' + res.rank + '° in classifica.' : 'Niente classifica stavolta.'));

    var azioni = [
      {
        label: partenza > 1 ? 'Rigioca dal ' + partenza : 'Rigioca',
        onClick: function () { TG.ui.hideOverlay(); TG.engine.restart(); }
      }
    ];
    if (cp > 1 && cp !== partenza) {
      azioni.push({
        label: 'Dal livello ' + cp,
        ghost: true,
        onClick: function () { TG.ui.hideOverlay(); TG.engine.restart(cp); }
      });
    }
    if (partenza > 1) {
      azioni.push({
        label: 'Dal livello 1',
        ghost: true,
        onClick: function () { TG.ui.hideOverlay(); TG.engine.restart(1); }
      });
    }
    azioni.push({ label: 'Altri giochi', ghost: true, onClick: goHome });

    TG.ui.showOverlay({ title: 'Partita finita', body: body, actions: azioni });
  }

  /* ---------- comandi dell'interfaccia ---------- */

  el.back.addEventListener('click', goHome);

  /* Classifica e istruzioni: icone in alto, finestra sopra al gioco. Se si sta
     giocando si mette in pausa, che è quello che ci si aspetta aprendo un
     pannello a metà partita. */
  function apriPannello(quale) {
    if (TG.engine.getState() === 'running') TG.engine.pause();
    if (quale === 'classifica' && current) TG.ui.renderBoard(current.id);
    TG.ui.showModal(quale);
  }

  el.boardBtn.addEventListener('click', function () { apriPannello('classifica'); });
  el.helpBtn.addEventListener('click', function () { apriPannello('istruzioni'); });
  el.modalClose.addEventListener('click', function () { TG.ui.hideModal(); });
  el.modal.addEventListener('click', function (e) {
    if (e.target === el.modal) TG.ui.hideModal();   // clic fuori dalla scheda
  });

  el.pause.addEventListener('click', function () {
    var s = TG.engine.getState();
    if (s === 'running') TG.engine.pause();
    else if (s === 'paused') { TG.ui.hideOverlay(); TG.engine.resume(); }
  });

  el.clearBoard.addEventListener('click', function () {
    if (!current) return;
    if (!window.confirm('Cancellare la classifica di ' + current.title + '?')) return;
    TG.scores.clear(current.id);
    TG.ui.renderBoard(current.id);
    TG.ui.setBest(0);
  });

  el.profileBtn.addEventListener('click', function () {
    var name = window.prompt('Come ti chiami? (max 14 caratteri)', TG.profile.getName());
    if (name === null) return;
    TG.profile.setName(name);
    TG.ui.renderHomeStats();
  });

  function paintSoundBtn() {
    var on = TG.sfx.isEnabled();
    el.sound.textContent = on ? '🔊' : '🔇';
    el.sound.classList.toggle('is-off', !on);
  }

  el.sound.addEventListener('click', function () {
    TG.sfx.toggle();
    paintSoundBtn();
    if (TG.sfx.isEnabled()) TG.sfx.click();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Escape' && TG.ui.isModalOpen()) { TG.ui.hideModal(); return; }
    if (e.code === 'Escape') {
      var s = TG.engine.getState();
      if (s === 'running') TG.engine.pause();
      else if (s === 'paused') { TG.ui.hideOverlay(); TG.engine.resume(); }
    }
  });

  window.addEventListener('hashchange', fromHash);

  paintSoundBtn();
  fromHash();
})();
