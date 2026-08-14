/* Persistenza su localStorage con fallback in memoria: in navigazione privata
   (o con storage disabilitato) i giochi devono comunque partire. */
TG.storage = (function () {
  'use strict';

  var PREFIX = 'toiletgames:v1:';
  var memory = {};
  var available = (function () {
    try {
      var k = PREFIX + '__test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function get(key, fallback) {
    var raw;
    try {
      raw = available ? window.localStorage.getItem(PREFIX + key) : memory[key];
    } catch (e) {
      raw = memory[key];
    }
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    var raw = JSON.stringify(value);
    memory[key] = raw;
    if (!available) return;
    try {
      window.localStorage.setItem(PREFIX + key, raw);
    } catch (e) {
      // quota piena o storage negato: resta il valore in memoria
    }
  }

  function remove(key) {
    delete memory[key];
    if (!available) return;
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch (e) { /* ignora */ }
  }

  return { get: get, set: set, remove: remove, isPersistent: available };
})();
