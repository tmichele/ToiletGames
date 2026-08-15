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
  controls: 'dpad',               // 'dpad' | 'lr' | 'lr-big' | 'pointer' | 'action' | 'none'
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

    function state() {            // opzionale ma consigliato: vedi «Tarare la difficoltà»
      return { /* punteggi, posizioni, tutto ciò che vuoi poter misurare */ };
    }

    return { start: start, update: update, draw: draw, state: state };
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
| `api.util` | `clamp`, `randInt`, `randFloat`, `pick`, `shuffle`, `lerp`, `circleRectHit`, `roundRect`, `opponentSpeedRatio` |
| `api.sfx` | `click`, `pick`, `hit`, `bounce`, `fail`, `tone(freq, durata, tipo, volume)` |

Il gioco **non** deve gestire pausa, ridimensionamento, ciclo di rendering,
classifica o cambio livello: sono già del motore.

## Regole per la difficoltà

Ogni gioco decide come crescere, ma la struttura è sempre la stessa: `config(level)`
restituisce i parametri, `start(level)` li applica, `levelComplete()` fa salire il
livello. Il punteggio **non** si azzera fra un livello e l'altro, quindi conviene
scalare i punti con il livello (`10 * cfg.level`) e assegnare un bonus di fine
livello: così la classifica premia chi arriva più in fondo.

## Avversari simulati

Se il gioco ha una CPU, la sua velocità si ricava da quella del giocatore con
`api.util.opponentSpeedRatio(level)`: parte al 90%, pareggia intorno al terzo
livello e arriva al 135%. Così «la CPU è veloce» significa la stessa cosa in
tutta la suite, e la difficoltà dei livelli alti non si riduce a una corsa.

Gli altri parametri (quanto legge bene la traiettoria, quanto mira lontano dal
giocatore, quanto tarda a rientrare) sono le leve vere. Due regole imparate
sbagliando:

- l'errore di mira va sorteggiato **una volta per scambio**, non a ogni
  correzione: rifacendolo di continuo la media lo annulla e l'avversario diventa
  infallibile;
- un avversario che mira oltre il proprio margine di errore sbaglia da solo:
  la mira deve usare solo lo spazio che resta dopo l'imprecisione.

## Input

- `api.input.take()` — coda delle pressioni, ognuna consumata una volta sola.
  Copre frecce, WASD, swipe sul campo e pad a schermo.
- `api.input.isDown('left')` — tasto/pulsante tenuto premuto (movimenti continui).
- `api.input.takeTap()` — tap con coordinate `{x, y}` nel sistema del viewport.
- `api.input.takeDigit()` — tasti 1-9, alternativa da tastiera ai tap.
- `api.input.pointer` — `{x, y, down}` per trascinamenti (racchette e simili).
- `api.input.stick` — `{x, y, attiva}` fra -1 e 1: la leva analogica, per i
  giochi in cui si naviga invece di scattare.

I valori di `controls` decidono i comandi a schermo: `dpad` (croce direzionale),
`lr` (sinistra/destra piccoli), `lr-big` (due tasti che si dividono tutta la
larghezza, per i giochi dove serve un bersaglio grande per il pollice),
`joystick` (leva analogica), `pointer` e `none` (nessun pulsante). Con `actionLabel` valorizzato si aggiunge
il pulsante azione.

## Tarare la difficoltà

Indovinare a occhio se il livello 1 è troppo duro non funziona: `test/balance.js`
carica i giochi fuori dal browser e li fa giocare da tre bot (scarso, medio,
bravo) per decine di partite a livello, stampando quante ne vincono.

Per misurare anche il tuo gioco servono due cose:

1. il metodo `state()` nell'istanza, che restituisce quello che il bot deve
   vedere (posizione della palla, punteggi, vite…);
2. una voce in `BOTS` dentro `test/balance.js` che, dato quello stato, muova
   `api.input` come farebbe una persona.

```
node test/balance.js miogioco 1 10
```

Una colonna che crolla da 100% a 0% fra due livelli è uno scalino, non una
progressione. E le partite marcate «infinite» sono stalli: vanno corretti nel
gioco, non tollerati nel test.

Se il gioco è **a turni** (come Forza 4), questi profili non servono: misurano
riflessi, non strategia. Meglio un controllo in `test/regole.js` che faccia
giocare l'avversario contro un giocatore-modello scritto apposta.

Se il gioco nasconde informazione al giocatore (per esempio la pallina
invisibile dei mattoni fantasma), il bot deve subirla anche lui: legge lo stato,
quindi vedrebbe tutto e la meccanica non comparirebbe nei numeri.

Attenzione a un errore facile: se l'avversario simulato ri-sorteggia il proprio
errore di mira a ogni frame, la media annulla l'errore e l'avversario diventa
infallibile. L'errore va sorteggiato una volta per scambio e tenuto.

## Verificare le meccaniche

`test/regole.js` gira sulla stessa sandbox di `balance.js` (`test/sandbox.js`) e
serve a controllare le regole che nel browser costerebbero partite intere: tutto
ciò che compare solo ai livelli alti, o che dipende da eventi rari. Se il tuo
gioco ha una meccanica del genere, esponila in `state()` e aggiungi lì il
controllo.

Un'avvertenza vista sbagliando: nella sandbox non c'è il motore, quindi dopo un
`gameOver()` il gioco continua ad aggiornarsi. I controlli vanno fermati
sull'esito, altrimenti si misura una partita che nella realtà è già finita.

## Prima di chiudere

Esegui i tre test: `node test/smoke.js` (la suite gira davvero),
`node test/regole.js` (le meccaniche fanno quello che dicono) e
`node test/balance.js` (la difficoltà è sensata). Verifica che l'elenco cresca,
che il gioco non generi errori in console e che classifiche e livelli funzionino.
