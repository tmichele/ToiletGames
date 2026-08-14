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

  function isEnabled() { return enabled; }

  function setEnabled(v) {
    enabled = !!v;
    TG.storage.set('sound', enabled);
    if (enabled) unlock();
  }

  return {
    unlock: unlock,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); return enabled; },
    tone: tone,
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
