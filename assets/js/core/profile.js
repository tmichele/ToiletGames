/* Profilo giocatore: serve solo a firmare le voci di classifica. */
TG.profile = (function () {
  'use strict';

  var DEFAULT = 'Giocatore';

  function getName() {
    var n = TG.storage.get('playerName', DEFAULT);
    return (typeof n === 'string' && n.trim()) ? n.trim() : DEFAULT;
  }

  function setName(name) {
    var clean = String(name == null ? '' : name).trim().slice(0, 14);
    if (!clean) clean = DEFAULT;
    TG.storage.set('playerName', clean);
    return clean;
  }

  return { getName: getName, setName: setName, DEFAULT: DEFAULT };
})();
