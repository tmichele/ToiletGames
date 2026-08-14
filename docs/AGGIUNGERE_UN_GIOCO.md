# Aggiungere un gioco

Servono due passaggi: un file in `assets/js/games/` e una riga in `index.html`.
Niente build, niente dipendenze.

## 1. Il file del gioco

Crea `assets/js/games/miogioco.js` partendo da questo scheletro:

```js
(function () {
'use strict';

/* Tutti i parametri che cambiano con il livello stanno qui, così sia la
   partita sia la schermata iniziale leggono gli stessi numeri. */
function config(level) {
  return {
    level: level,
    velocita: 100 + level * 20,
    bersagli: 3 + level
  };
}

TG.registry.register({
  id: 'miogioco',                 // chiave stabile: classifica e link #/g/miogioco
  title: 'Il mio gioco',
  icon: '🎲',
  tagline: 'Una riga che spiega il gioco nella card.',
  scoreLabel: 'Punti',            // etichetta nell'HUD
  controls: 'dpad',               // 'dpad' | 'lr' | 'pointer' | 'action' | 'none'
  actionLabel: '',                // se valorizzato aggiunge il pulsante azione
  viewport: { w: 360, h: 480 },   // coordinate logiche: il canvas si adatta da solo
  howto: '<b>Comandi:</b> frecce o swipe.',

  levelInfo: function (level) {   // opzionale, mostrato prima di ogni livello
    return 'Livello ' + level + ': ' + config(level).bersagli + ' bersagli';
  },

  create: function (api) {
    var cfg, stato;

    function start(level) {       // chiamata a ogni livello, anche al primo
      cfg = config(level);
      stato = { /* ... */ };
    }

    function update(dt) {         // dt in secondi, già limitato dal motore
      var azione;
      while ((azione = api.input.take())) {
        // 'up' | 'down' | 'left' | 'right' | 'action'
      }
      // ...logica...
    }

    function draw(ctx) {          // disegna in coordinate del viewport
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, api.width, api.height);
    }

    return { start: start, update: update, draw: draw };
  }
});

})();
```

L'IIFE che avvolge tutto non è decorativa: senza, funzioni come `config`
finirebbero nello spazio globale e i giochi si sovrascriverebbero a vicenda.

## 2. Registrarlo nella pagina

In `index.html`, nella sezione dei giochi:

```html
<script src="assets/js/games/miogioco.js"></script>
```

Lo script va **prima** di `assets/js/core/app.js`, che legge il registro già
popolato. Il gioco compare nell'elenco da solo, con card, classifica e
statistiche.

## L'oggetto `api`

| Voce | Cosa fa |
| --- | --- |
| `api.width`, `api.height` | dimensioni logiche del campo |
| `api.level`, `api.score` | livello e punteggio correnti |
| `api.addScore(n)` | somma punti (aggiorna l'HUD) |
| `api.setScore(n)` | imposta il punteggio |
| `api.levelComplete({bonus, message})` | livello superato: il motore mostra il riepilogo e passa al successivo |
| `api.gameOver({message})` | partita finita: il motore salva il risultato in classifica |
| `api.input` | `take()`, `takeTap()`, `takeDigit()`, `isDown(azione)`, `pointer` |
| `api.util` | `clamp`, `randInt`, `randFloat`, `pick`, `shuffle`, `lerp`, `circleRectHit`, `roundRect` |
| `api.sfx` | `click`, `pick`, `hit`, `bounce`, `fail`, `tone(freq, durata, tipo, volume)` |

Il gioco **non** deve gestire pausa, ridimensionamento, ciclo di rendering,
classifica o cambio livello: sono già del motore.

## Regole per la difficoltà

Ogni gioco decide come crescere, ma la struttura è sempre la stessa: `config(level)`
restituisce i parametri, `start(level)` li applica, `levelComplete()` fa salire il
livello. Il punteggio **non** si azzera fra un livello e l'altro, quindi conviene
scalare i punti con il livello (`10 * cfg.level`) e assegnare un bonus di fine
livello: così la classifica premia chi arriva più in fondo.

## Input

- `api.input.take()` — coda delle pressioni, ognuna consumata una volta sola.
  Copre frecce, WASD, swipe sul campo e pad a schermo.
- `api.input.isDown('left')` — tasto/pulsante tenuto premuto (movimenti continui).
- `api.input.takeTap()` — tap con coordinate `{x, y}` nel sistema del viewport.
- `api.input.takeDigit()` — tasti 1-9, alternativa da tastiera ai tap.
- `api.input.pointer` — `{x, y, down}` per trascinamenti (racchette e simili).

## Prima di chiudere

Esegui il test di fumo: `node test/smoke.js`. Verifica che l'elenco cresca, che
il gioco non generi errori in console e che classifiche e livelli funzionino.
