/* Effetti sonori sintetizzati con WebAudio: nessun file audio da caricare,
   quindi funziona anche offline / da file://. */
TG.sfx = (function () {
  'use strict';

  var ctx = null;
  var enabled = TG.storage.get('sound', true);

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // I browser sbloccano l'audio solo dopo un gesto dell'utente.
  function unlock() {
    var c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }

  function tone(freq, duration, type, volume, slideTo) {
    if (!enabled) return;
    var c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    var t0 = c.currentTime;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume == null ? 0.12 : volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /* ---------- motore: un suono continuo, non un effetto ----------

     Gli effetti sopra sono colpi: parte un oscillatore e muore da solo. Il
     motore di un'auto invece va tenuto acceso e cambiato di giri sessanta
     volte al secondo — serve un nodo che resta vivo fra un update e l'altro.

     Chi lo usa non lo spegne: lo *rinfresca*. Ogni chiamata a motoreImposta
     segna l'ora; se per un terzo di secondo nessuno lo chiama, un guardiano lo
     spegne da solo. È l'unico modo per non lasciarlo a rombare in pausa, sul
     riepilogo di fine livello o quando si torna all'elenco: il gioco non viene
     avvertito di nessuna di quelle tre cose, e un motore che continua a
     girare sopra a un menù è il difetto che si nota per primo. */
  var motore = null;
  var GUARDIA_MS = 350;

  function accendiMotore(c) {
    var t0 = c.currentTime;
    /* Due oscillatori a un'ottava di distanza: la sega dà il ringhio, la
       quadra sotto dà il corpo. Il passa-basso toglie la fischiata digitale e
       si apre con i giri, come farebbe uno scarico. */
    var sega = c.createOscillator(); sega.type = 'sawtooth';
    var quadra = c.createOscillator(); quadra.type = 'square';
    var filtro = c.createBiquadFilter(); filtro.type = 'lowpass'; filtro.Q.value = 2;
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    sega.connect(filtro); quadra.connect(filtro);
    filtro.connect(gain).connect(c.destination);
    sega.start(t0); quadra.start(t0);

    // slittamento: rumore bianco in un passa-banda, aperto solo quando serve
    var righe = c.sampleRate;
    var buf = c.createBuffer(1, righe, righe);
    var dati = buf.getChannelData(0);
    for (var i = 0; i < righe; i++) dati[i] = Math.random() * 2 - 1;
    var rumore = c.createBufferSource(); rumore.buffer = buf; rumore.loop = true;
    var banda = c.createBiquadFilter(); banda.type = 'bandpass';
    banda.frequency.value = 900; banda.Q.value = 0.6;
    var gainRumore = c.createGain();
    gainRumore.gain.setValueAtTime(0.0001, t0);
    rumore.connect(banda).connect(gainRumore).connect(c.destination);
    rumore.start(t0);

    motore = {
      sega: sega, quadra: quadra, filtro: filtro, gain: gain,
      rumore: rumore, gainRumore: gainRumore,
      ultimo: Date.now(),
      guardia: window.setInterval(function () {
        if (Date.now() - motore.ultimo > GUARDIA_MS) motoreFerma();
      }, 120)
    };
  }

  /* giri 0..1 (dal minimo al fuorigiri), gas 0..1 (quanto è aperto), slitta
     0..1 (quanto le gomme stanno strusciando). */
  function motoreImposta(giri, gas, slitta) {
    if (!enabled) { if (motore) motoreFerma(); return; }
    var c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    if (!motore) accendiMotore(c);
    motore.ultimo = Date.now();
    var t = c.currentTime;
    giri = Math.max(0, Math.min(1, giri || 0));
    gas = Math.max(0, Math.min(1, gas || 0));
    slitta = Math.max(0, Math.min(1, slitta || 0));
    var f = 48 + giri * 190;
    motore.sega.frequency.setTargetAtTime(f, t, 0.03);
    motore.quadra.frequency.setTargetAtTime(f / 2, t, 0.03);
    motore.filtro.frequency.setTargetAtTime(240 + giri * 1500 + gas * 500, t, 0.04);
    // a gas chiuso il motore cala di volume ma non sparisce: si sente frenare
    motore.gain.gain.setTargetAtTime(0.028 + gas * 0.05 + giri * 0.015, t, 0.05);
    motore.gainRumore.gain.setTargetAtTime(slitta * 0.11, t, 0.04);
  }

  function motoreFerma() {
    if (!motore) return;
    var m = motore;
    motore = null;
    window.clearInterval(m.guardia);
    try {
      var c = ensureCtx();
      var t = c.currentTime;
      m.gain.gain.setTargetAtTime(0.0001, t, 0.06);
      m.gainRumore.gain.setTargetAtTime(0.0001, t, 0.06);
      m.sega.stop(t + 0.4); m.quadra.stop(t + 0.4); m.rumore.stop(t + 0.4);
    } catch (e) { /* contesto già chiuso: non c'è niente da spegnere */ }
  }

  function isEnabled() { return enabled; }

  function setEnabled(v) {
    enabled = !!v;
    TG.storage.set('sound', enabled);
    if (enabled) unlock();
    else motoreFerma();
  }

  return {
    unlock: unlock,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); return enabled; },
    tone: tone,
    motoreImposta: motoreImposta,
    motoreFerma: motoreFerma,
    click: function () { tone(440, 0.05, 'square', 0.07); },
    pick: function () { tone(880, 0.08, 'square', 0.1, 1320); },
    hit: function () { tone(220, 0.06, 'triangle', 0.12); },
    bounce: function () { tone(600, 0.04, 'sine', 0.1); },
    fail: function () { tone(300, 0.35, 'sawtooth', 0.12, 80); },
    levelUp: function () {
      tone(523, 0.1, 'square', 0.1);
      window.setTimeout(function () { tone(659, 0.1, 'square', 0.1); }, 110);
      window.setTimeout(function () { tone(784, 0.22, 'square', 0.1); }, 220);
    }
  };
})();
