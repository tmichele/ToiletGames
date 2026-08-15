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
| 🧱 **Mattoni** | Breakout con combo e mattoni speciali | Più file, mattoni turbo dal 2° livello, impazziti dal 3°, corazzati dal 5°; le vite valgono per tutta la partita |
| 🏒 **Air Hockey** | Tavolo ad aria contro la CPU | Il portiere avversario copre meglio la porta, rientra più in fretta dopo il tiro, la sua porta si restringe |
| 🐹 **Talpe** | Whack a mole a tempo | Restano fuori sempre meno (1,5s al 1° livello, 0,4s al 9°) e sono più numerose; bombe dal 3°, grigie come le talpe e col grigio ogni tanto scambiato: conta solo la miccia |
| 🔴 **Forza 4** | Quattro di fila, vs CPU o in due | La CPU guarda sempre più mosse avanti (minimax) e smette di svarionare |
| 🔢 **Tessere** | Rompicapo scorrevole (il «quindici») | Griglia da 3×3 a 5×5, mescolamento più profondo, meno tempo |
| 🧭 **Labirinto** | Prima persona, con una mappa che si dimentica | Labirinto più grande, memoria della mappa più corta (24s al 1° livello, 10s al 10°), meno alberi, vista più corta |

Il **Labirinto** si gioca in prima persona con il joystick. La pianta non è mai
data: si disegna da sé in alto a destra con quello che i tuoi occhi hanno
davvero visto — un ventaglio di raggi marca le celle in vista — e **sbiadisce
col tempo**, finché quello che hai visto troppo fa non lo ricordi più. Gli altri
riferimenti sono il **numero di zona** dipinto sulle pareti (il labirinto è
diviso in nove settori, ognuno con la sua tinta), la bussola che indica dove sta
l'uscita ma non come arrivarci, e gli alberi che spuntano oltre i muri, fermi e
diversi uno dall'altro per tinta e sagoma. La scena è disegnata in raycasting
sul canvas 2D, senza WebGL, a 60 fps.

**Forza 4** è l'unico a due modalità: si sceglie a inizio partita fra sfida alla
CPU e due giocatori sullo stesso dispositivo, a mosse alternate. In due, il
livello sale quando vince il rosso, ed è il suo risultato a finire in classifica.

In **Mattoni** i punti seguono la mira: ogni mattone rotto senza tornare sulla
racchetta vale di più (fino a ×5), mentre ogni tocco di racchetta toglie punti e
azzera il moltiplicatore. Il muro poi non è tutto uguale: i mattoni **turbo**
(»») accelerano la pallina per il resto del livello, gli **impazziti** (?) la
rimandano a un angolo qualsiasi, i **fantasma** (◌) la fanno sparire a
intermittenza per dieci secondi, i **corazzati** reggono due colpi. Valgono metà
punti in più, ma decidono che partita sarà: la velocità con cui ti ritrovi a
giocare dipende da quali mattoni hai scelto di rompere. **Pong** e **Mattoni** si giocano solo con i due tasti
sotto il campo, che si dividono tutta la larghezza disponibile; in **Air Hockey**
si trascina il dito, e il mazzuolo resta sopra il polpastrello per non finirci
sotto.

Gli avversari simulati seguono una regola comune (`TG.util.opponentSpeedRatio`):
al primo livello si muovono poco sotto la tua velocità, intorno al terzo la
pareggiano, poi la superano fino al 135%. Quello che cambia negli altri livelli
è come giocano — quanto leggono bene la palla, quanto mirano lontano da te,
quanto in fretta rientrano — non solo quanto corrono.

Ogni gioco ha la **sua classifica locale** (top 10, con livello raggiunto e
nome del giocatore) e una progressione a livelli: si parte dal livello 1 e si
sale finché non si perde. Il punteggio non si azzera fra i livelli, così la
classifica misura davvero quanto lontano sei arrivato.

**Checkpoint ogni 5 livelli.** Arrivare al livello 5, 10, 15… mette un
segnalibro 🚩 in quel gioco: dalla partita successiva puoi scegliere se
ricominciare dal livello 1 o ripartire dall'ultimo checkpoint. È un modo per non
rifare ogni volta i primi livelli, ma non è un pasto gratis — i punti dei livelli
saltati non li prendi, e la classifica segna «da 5» accanto ai risultati partiti
da un checkpoint, così i punteggi restano confrontabili. Il checkpoint si guadagna
appena si mette piede nel livello, quindi resta anche se si perde subito dopo.

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
  input.js                  tastiera, swipe, puntatore, pad e leva a schermo
  engine.js                 canvas, ciclo di gioco, livelli, punteggio
  ui.js                     elenco, HUD, classifica, pannelli
  app.js                    avvio e navigazione (#/g/<id>)
assets/js/games/            un file per gioco
docs/AGGIUNGERE_UN_GIOCO.md come aggiungerne uno
test/sandbox.js             esecuzione dei giochi fuori dal browser
test/smoke.js               test di fumo con Playwright
test/balance.js             banco di prova della difficoltà
test/regole.js              meccaniche difficili da raggiungere nel browser
```

La divisione è netta: il motore gestisce canvas, ciclo, pausa, livelli,
punteggio e classifica; il singolo gioco implementa solo `start`, `update` e
`draw`. Aggiungere un gioco significa scrivere un file e aggiungere una riga di
`<script>` — vedi [docs/AGGIUNGERE_UN_GIOCO.md](docs/AGGIUNGERE_UN_GIOCO.md).

## Test

```
npx playwright@1 install chromium     # una volta sola
node test/smoke.js                    # la suite gira davvero
node test/regole.js                   # le meccaniche fanno quello che dicono
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

`regole.js` usa la stessa sandbox per verificare le meccaniche che nel browser
costerebbero partite intere: che i mattoni turbo accelerino davvero la pallina
(senza sfondare il tetto di velocità), che gli impazziti la devino di un angolo
che nessun rimbalzo normale produrrebbe, che il tocco di racchetta tolga punti,
che le racchette del pong si accorcino, che il disco dell'hockey non esca dal
tavolo nemmeno se lo schiacci in uno spigolo.

Il primo profilo, «fermo», non tocca niente: serve a verificare che stare fermi
faccia perdere. Un gioco che si vince senza giocare è rotto quanto uno
impossibile, ed è successo davvero — nel pong l'avversario sbagliava così spesso
che una racchetta immobile al centro faceva da muro.

Stato attuale (percentuale di livelli vinti dal profilo indicato):

| livello | 1 | 3 | 5 | 7 | 9 |
| --- | --- | --- | --- | --- | --- |
| Pong CPU · fermo | 3% | 3% | 0% | 0% | 0% |
| Pong CPU · medio | 80% | 53% | 18% | 8% | 5% |
| Pong CPU · bravo | 98% | 98% | 88% | 78% | 40% |
| Mattoni · medio | 95% | 23% | 3% | 0% | 0% |
| Mattoni · bravo | 100% | 100% | 95% | 35% | 0% |
| Air Hockey · medio | 68% | 18% | 3% | 0% | 0% |
| Air Hockey · bravo | 98% | 85% | 25% | 0% | 0% |
| Talpe · medio | 100% | 88% | 35% | 13% | 0% |
| Talpe · bravo | 100% | 83% | 33% | 8% | 3% |

**Forza 4**, **Tessere** e **Labirinto** non compaiono qui: sono giochi di
turni, di ragionamento o di orientamento, dove profili basati su riflessi non
direbbero niente. Le loro regole stanno in `test/regole.js`, dove un pilota
automatico risolve davvero il labirinto seguendo il percorso più corto — così si
verifica insieme che l'uscita sia raggiungibile e che il tempo concesso basti. Per Forza 4, contro un giocatore
«ragionevole» simulato (chiude se può, para se deve, altrimenti sta al centro) la
CPU perde il 63% delle mani al livello 1 e ne vince il 90% al 9°. Per Tessere il
test risolve davvero il rompicapo con una ricerca in ampiezza, così la vittoria è
verificata invece che data per buona, e controlla che ogni mescolamento sia
risolvibile: mescolare piazzando le tessere a caso renderebbe impossibile una
partita su due, senza che il giocatore possa accorgersene.

Il bot simulato insegue la palla senza anticiparla e, nell'hockey, difende la
porta molto peggio di una persona: i numeri servono a confrontare i livelli fra
loro, non a promettere un risultato. Dove il gioco nasconde qualcosa all'occhio
— la pallina invisibile dei mattoni fantasma, le bombe grigie come le talpe — il
bot legge lo stato e vedrebbe tutto, quindi la difficoltà gli viene simulata a
mano: quelle righe sono stime, non misure.

## Scelte tecniche

- **Niente moduli ES**: gli script sono classici e usano il namespace `TG`,
  così la pagina funziona aperta direttamente da disco senza CORS di mezzo.
- **Un solo canvas** ridimensionato dal motore: i giochi disegnano in
  coordinate logiche fisse (`viewport`) e non si occupano di DPI o schermi.
- **Audio sintetizzato**: nessun file da caricare, tutto offline.
