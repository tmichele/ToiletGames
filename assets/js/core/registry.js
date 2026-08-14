/* Elenco dei giochi disponibili.

   Ogni gioco si registra da solo con TG.registry.register({...}):

   {
     id:        'serpente',            // chiave stabile: usata per classifica e URL
     title:     'Serpente',
     icon:      '🐍',
     tagline:   'Frase breve mostrata nella card',
     scoreLabel:'Punti',               // etichetta HUD (opzionale)
     controls:  'dpad'|'lr'|'pointer'|'action'|'none',
     actionLabel: 'LANCIA',            // se presente, aggiunge il pulsante azione
     howto:     'Testo con <b>tag</b> ammessi, mostrato sotto la classifica',
     viewport:  { w: 360, h: 480 },    // coordinate logiche del canvas
     levelInfo: function (level) { return 'Velocità +20%'; },  // opzionale
     create:    function (api) { return { start, update, draw, destroy }; }
   }

   L'istanza restituita da create() deve esporre:
     start(level)   preparare/azzerare lo stato per il livello indicato
     update(dt)     dt in secondi (già limitato dal motore)
     draw(ctx)      disegnare in coordinate logiche (viewport)
     destroy()      opzionale: liberare timer/listener propri
     state()        opzionale: dati interni per test e taratura,
                    leggibili con TG.engine.inspect().game

   Comunicazione verso il motore tramite l'oggetto `api` (vedi engine.js). */
TG.registry = (function () {
  'use strict';

  var games = [];
  var byId = {};

  function register(def) {
    if (!def || !def.id || typeof def.create !== 'function') {
      console.error('[ToiletGames] definizione di gioco non valida', def);
      return;
    }
    if (byId[def.id]) {
      console.error('[ToiletGames] id gioco duplicato: ' + def.id);
      return;
    }
    var game = {
      id: def.id,
      title: def.title || def.id,
      icon: def.icon || '🎮',
      tagline: def.tagline || '',
      scoreLabel: def.scoreLabel || 'Punti',
      controls: def.controls || 'dpad',
      actionLabel: def.actionLabel || '',
      howto: def.howto || '',
      viewport: def.viewport || { w: 360, h: 480 },
      levelInfo: typeof def.levelInfo === 'function' ? def.levelInfo : null,
      create: def.create
    };
    games.push(game);
    byId[game.id] = game;
  }

  return {
    register: register,
    all: function () { return games.slice(); },
    get: function (id) { return byId[id] || null; },
    count: function () { return games.length; }
  };
})();
