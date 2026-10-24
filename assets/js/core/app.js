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
    boardGlobale: document.getElementById('board-globale'),
    boardStato: document.getElementById('board-stato'),
    boardTitGlobale: document.getElementById('board-tit-globale'),
    clearBoard: document.getElementById('btn-clear-board'),
    boardBtn: document.getElementById('btn-board'),
    helpBtn: document.getElementById('btn-help'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBoard: document.getElementById('modal-board'),
    modalHelp: document.getElementById('modal-help'),
    modalClose: document.getElementById('modal-close'),
    modalNome: document.getElementById('modal-nome'),
    nomeIntro: document.getElementById('nome-intro'),
    formNome: document.getElementById('form-nome'),
    inputNome: document.getElementById('input-nome'),
    nomeOk: document.getElementById('btn-nome-ok'),
    nomeStato: document.getElementById('nome-stato'),
    nomeSalta: document.getElementById('btn-nome-salta'),
    touchControls: document.getElementById('touch-controls'),
    howto: document.getElementById('game-howto'),
    version: document.getElementById('app-version')
  };

  var current = null;        // gioco aperto
  var dopoNome = null;       // cosa si stava facendo quando è servito il nome
  var rinunciato = false;    // si gioca senza classifica globale (per questa visita)

  TG.ui.init(el);
  // la coda dei risultati non spediti riparte da sola, se c'è qualcosa in coda
  TG.nuvola.avvio();
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

  /* ---------- il nome del giocatore ---------- */

  /* Con la classifica globale accesa il nome non è un vezzo: è la firma sotto
     i punteggi, e deve essere unico. Si chiede prima della prima partita —
     non dopo, perché un risultato arrivato senza nome resterebbe fuori
     classifica e sarebbe già una partita buttata. */
  function serveNome() {
    return TG.nuvola.attiva() && !TG.nuvola.nome() && !rinunciato;
  }

  function apriNome(messaggio, poi) {
    dopoNome = poi || null;
    if (TG.engine.getState() === 'running') TG.engine.pause();
    TG.ui.renderNome(messaggio || '', '', false);
    TG.ui.nomeInAttesa(false);
    TG.ui.showModal('nome');
  }

  function confermaNome() {
    var scritto = TG.ui.nomeInserito();
    TG.ui.nomeInAttesa(true);
    TG.ui.renderNome('Prendo il nome…');
    TG.nuvola.prendiNome(scritto, function (err, nome) {
      TG.ui.nomeInAttesa(false);
      if (err) {
        /* Due errori diversi. «Questo nome è di un altro» è una cosa che il
           giocatore può correggere, e si riscrive. Tutto il resto — rete giù,
           accesso anonimo non attivo, regole non pubblicate — non dipende da
           lui, e in quel caso deve poter giocare lo stesso: compare la via
           d'uscita, perché un intoppo sul server non può lasciare la suite
           bloccata su un pannello. */
        TG.ui.renderNome(err.message, err.preso ? 'is-warn' : 'is-err', !err.preso);
        if (el.inputNome) { el.inputNome.value = scritto; el.inputNome.focus(); }
        return;
      }
      TG.ui.hideModal();
      TG.ui.renderHomeStats();
      if (current) TG.ui.renderBoard(current.id);
      var poi = dopoNome;
      dopoNome = null;
      if (poi) poi(nome);
    });
  }

  /* Avvia la partita dal livello indicato: 1, oppure quello a cui eri arrivato. */
  function avvia(livello) {
    if (serveNome()) {
      apriNome('Prima di giocare: in classifica globale serve un nome tuo.',
        function () { avvia(livello); });
      return;
    }
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
      corpo += '\n🚩 Sei arrivato al livello ' + cp + ': puoi ripartire da lì ' +
        '(i punti dei livelli saltati però non li prendi).';
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

  /* Ogni livello raggiunto è una ripartenza: si salva subito, così resta anche
     se la partita finisce male un attimo dopo. Non si annuncia — succede a ogni
     livello, e un avviso ripetuto ogni volta è solo rumore. */
  TG.engine.on('checkpoint', function (livello) {
    if (current) TG.scores.setCheckpoint(current.id, livello);
  });

  TG.engine.on('levelclear', function (d) {
    var body =
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

    /* Che fine ha fatto il risultato in classifica globale si dice qui, in una
       riga: «inviato» quando parte, e il motivo quando non parte. Un invio che
       fallisce in silenzio farebbe sospettare la classifica, non la rete. */
    var globale = '';
    /* «In viaggio» e non «spedito»: l'invio è appena partito e la risposta
       arriverà dopo questo pannello. Se la rete non c'è, il risultato resta in
       coda e parte da solo — in viaggio è vero in entrambi i casi, spedito
       no. */
    if (res.nuvola === 'in-corso') globale = '\n🌍 Risultato in viaggio verso la classifica globale.';
    else if (res.nuvola === 'senza-nome') globale = '\n🌍 Per la classifica globale ti serve un nome (pulsante 👤).';
    else if (res.nuvola === 'non-record') globale = '\n🌍 In classifica globale resta il tuo record, che è più alto.';

    var body =
      (message ? message + '\n' : '') +
      'Punteggio: <b>' + score + '</b> · livello <b>' + level + '</b>' +
      (partenza > 1 ? ' (partito dal ' + partenza + ')' : '') + '\n' +
      (res.isRecord ? '🏆 Nuovo record personale!' :
        (res.rank ? 'Sei ' + res.rank + '° in classifica.' : 'Niente classifica stavolta.')) +
      globale;

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
    if (quale === 'classifica' && current) {
      TG.ui.renderBoard(current.id);
      TG.ui.renderBoardGlobale(current.id);
    }
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

  /* Il nome si cambia in un pannello, non più con window.prompt: prendere un
     nome in classifica globale può rispondere «è già di un altro», e una
     finestrella del browser non ha un posto dove scriverlo. */
  el.profileBtn.addEventListener('click', function () { apriNome(''); });

  el.formNome.addEventListener('submit', function (e) {
    e.preventDefault();
    confermaNome();
  });

  el.nomeSalta.addEventListener('click', function () {
    rinunciato = true;
    TG.ui.hideModal();
    TG.ui.renderHomeStats();
    var poi = dopoNome;
    dopoNome = null;
    if (poi) poi(TG.profile.getName());
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

  /* Appena aperta la pagina: se la classifica globale c'è e il nome no, si
     chiede subito. È l'unico momento in cui non interrompe niente. */
  if (serveNome()) apriNome('Benvenuto: scegli il nome con cui comparire in classifica.');
})();
