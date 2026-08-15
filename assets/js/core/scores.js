/* Classifica locale per gioco (top 10) + statistiche di progresso.
   Nessun server: tutto in localStorage. */
TG.scores = (function () {
  'use strict';

  var MAX_ENTRIES = 10;

  function boardKey(gameId) { return 'board:' + gameId; }
  function statsKey(gameId) { return 'stats:' + gameId; }

  function top(gameId) {
    var list = TG.storage.get(boardKey(gameId), []);
    return Array.isArray(list) ? list : [];
  }

  function stats(gameId) {
    var s = TG.storage.get(statsKey(gameId), null);
    return s && typeof s === 'object'
      ? s
      : { plays: 0, bestScore: 0, bestLevel: 0, lastPlayed: 0, checkpoint: 0 };
  }

  /* Ripartenza: il livello più alto a cui si è arrivati in questo gioco, da cui
     si può ricominciare nelle partite successive. Si registra appena ci si
     arriva, non a fine partita, così resta anche se si perde subito dopo: chi
     è arrivato al dodici non deve rifare undici livelli per tornarci.
     (La chiave salvata si chiama ancora `checkpoint`: cambiarle nome
     cancellerebbe i progressi già in localStorage.) */
  function checkpoint(gameId) { return stats(gameId).checkpoint || 0; }

  function setCheckpoint(gameId, level) {
    var s = stats(gameId);
    if (level <= (s.checkpoint || 0)) return false;
    s.checkpoint = level;
    TG.storage.set(statsKey(gameId), s);
    return true;
  }

  function best(gameId) { return stats(gameId).bestScore || 0; }
  function bestLevel(gameId) { return stats(gameId).bestLevel || 0; }

  /* Registra la fine di una partita.
     Ritorna { rank, isRecord, entry } — rank è 1-based, 0 se fuori classifica. */
  function submit(gameId, score, level, partenza) {
    score = Math.max(0, Math.round(score || 0));
    level = Math.max(1, Math.round(level || 1));
    partenza = Math.max(1, Math.round(partenza || 1));

    var entry = {
      name: TG.profile.getName(),
      score: score,
      level: level,
      from: partenza,          // da che livello era iniziata la partita
      date: Date.now(),
      id: 'e' + Date.now() + '-' + Math.floor(Math.random() * 1000)
    };

    var list = top(gameId);
    list.push(entry);
    list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.level !== a.level) return b.level - a.level;
      return a.date - b.date; // a parità vince chi ci è arrivato prima
    });
    list = list.slice(0, MAX_ENTRIES);
    TG.storage.set(boardKey(gameId), list);

    var s = stats(gameId);
    var isRecord = score > (s.bestScore || 0);
    s.plays = (s.plays || 0) + 1;
    s.bestScore = Math.max(s.bestScore || 0, score);
    s.bestLevel = Math.max(s.bestLevel || 0, level);
    s.checkpoint = Math.max(s.checkpoint || 0, level);
    s.lastPlayed = entry.date;
    TG.storage.set(statsKey(gameId), s);

    var rank = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === entry.id) { rank = i + 1; break; }
    }
    return { rank: rank, isRecord: isRecord, entry: entry };
  }

  function clear(gameId) {
    TG.storage.remove(boardKey(gameId));
    TG.storage.remove(statsKey(gameId));
  }

  function totalPlays() {
    var n = 0;
    TG.registry.all().forEach(function (g) { n += stats(g.id).plays || 0; });
    return n;
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    checkpoint: checkpoint,
    setCheckpoint: setCheckpoint,
    top: top,
    stats: stats,
    best: best,
    bestLevel: bestLevel,
    submit: submit,
    clear: clear,
    totalPlays: totalPlays
  };
})();
