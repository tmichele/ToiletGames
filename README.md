# 🚽 ToiletGames

Suite di giochi single player che gira in una pagina HTML. Nessun server,
nessuna dipendenza, nessun build: apri `index.html` (anche con doppio click,
da `file://`) e giochi.

## Cosa c'è dentro

| Gioco | Idea | Come cresce la difficoltà |
| --- | --- | --- |
| 🐍 **Serpente** | Snake a griglia | Più velocità, più bocconi richiesti, bordi mortali e ostacoli dal livello 3 |
| 🏓 **Pong CPU** | Uno contro uno con avversario simulato | La CPU è più rapida e sbaglia meno la mira, pallina più veloce, racchetta più corta. Durante il set **entrambe** le racchette si accorciano |
| 🧠 **Memoria** | Ripeti la sequenza luminosa | Da 4 a 9 riquadri, sequenze più lunghe, riproduzione più rapida, tempo limite per tocco |
| 🧱 **Mattoni** | Breakout con combo | Più file, mattoni corazzati dal livello 5, pallina più veloce; le vite valgono per tutta la partita |
| 🏒 **Air Hockey** | Tavolo ad aria contro la CPU | Il portiere avversario copre meglio la porta, rientra più in fretta dopo il tiro, la sua porta si restringe |

In **Mattoni** i punti seguono la mira: ogni mattone rotto senza tornare sulla
racchetta vale di più (fino a ×5), mentre ogni tocco di racchetta toglie punti e
azzera il moltiplicatore. In **Pong** si gioca solo con i due tasti sotto il
campo, che si dividono tutta la larghezza disponibile.

Ogni gioco ha la **sua classifica locale** (top 10, con livello raggiunto e
nome del giocatore) e una progressione a livelli: si parte sempre dal livello 1
e si sale finché non si perde. Il punteggio non si azzera fra i livelli, così la
classifica misura davvero quanto lontano sei arrivato.

## Uso

```
git clone https://github.com/tmichele/ToiletGames.git
open index.html            # oppure doppio click sul file
```

Funziona anche servito da un web server statico, ma non è necessario.

**Comandi:** frecce o WASD da tastiera, swipe e pad a schermo da telefono,
trascinamento del dito per racchette e paletta, tasti 1-9 per i giochi a
riquadri. `Esc` o il pulsante ⏸ mettono in pausa.

I dati (classifiche, nome giocatore, audio on/off) stanno in `localStorage`:
restano sul dispositivo, non vanno da nessuna parte. Se lo storage non è
disponibile (navigazione privata) i giochi funzionano lo stesso, le classifiche
durano solo per la sessione. Il pulsante 👤 cambia il nome, «Azzera» sotto la
classifica cancella i risultati di quel gioco.

## Struttura

```
index.html                  guscio della pagina + elenco degli script
assets/css/style.css        interfaccia
assets/js/core/
  util.js                   funzioni di appoggio (random, collisioni, disegno)
  storage.js                localStorage con fallback in memoria
  sfx.js                    effetti sonori sintetizzati (WebAudio)
  profile.js                nome del giocatore
  scores.js                 classifiche e statistiche per gioco
  registry.js               registro dei giochi + contratto
  input.js                  tastiera, swipe, puntatore, pad a schermo
  engine.js                 canvas, ciclo di gioco, livelli, punteggio
  ui.js                     elenco, HUD, classifica, pannelli
  app.js                    avvio e navigazione (#/g/<id>)
assets/js/games/            un file per gioco
docs/AGGIUNGERE_UN_GIOCO.md come aggiungerne uno
test/smoke.js               test di fumo con Playwright
test/balance.js             banco di prova della difficoltà (senza browser)
```

La divisione è netta: il motore gestisce canvas, ciclo, pausa, livelli,
punteggio e classifica; il singolo gioco implementa solo `start`, `update` e
`draw`. Aggiungere un gioco significa scrivere un file e aggiungere una riga di
`<script>` — vedi [docs/AGGIUNGERE_UN_GIOCO.md](docs/AGGIUNGERE_UN_GIOCO.md).

## Test

```
npx playwright@1 install chromium     # una volta sola
node test/smoke.js                    # la suite gira davvero
node test/balance.js                  # la difficoltà è tarata
```

`smoke.js` apre la pagina da `file://` in Chromium headless e controlla elenco
dei giochi, partite reali di tutti i titoli, classifiche, avanzamento di
livello, pausa, deep link, comandi e assenza di errori in console.

`balance.js` non usa il browser: carica i giochi in una sandbox e li fa giocare
da tre giocatori simulati (scarso, medio, bravo) per decine di partite a
livello, stampando la percentuale di vittorie. Serve a rispondere con dei numeri
a «il livello 1 è troppo difficile?», che è esattamente il tipo di domanda su
cui è facile sbagliarsi a occhio. Le partite che non finiscono vengono segnalate
come «infinite»: sono stalli, e vanno corretti.

Stato attuale (giocatore «medio» simulato, percentuale di livelli vinti):

| livello | 1 | 3 | 5 | 7 | 9 |
| --- | --- | --- | --- | --- | --- |
| Pong CPU | 100% | 100% | 93% | 43% | 15% |
| Mattoni | 93% | 25% | 3% | 0% | 0% |
| Air Hockey | 70% | 20% | 18% | 3% | 0% |

Il bot simulato insegue la palla senza anticiparla, quindi un umano fa meglio:
i numeri servono a confrontare i livelli fra loro, non a promettere un risultato.

## Scelte tecniche

- **Niente moduli ES**: gli script sono classici e usano il namespace `TG`,
  così la pagina funziona aperta direttamente da disco senza CORS di mezzo.
- **Un solo canvas** ridimensionato dal motore: i giochi disegnano in
  coordinate logiche fisse (`viewport`) e non si occupano di DPI o schermi.
- **Audio sintetizzato**: nessun file da caricare, tutto offline.
