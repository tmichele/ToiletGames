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
| 🔢 **Tessere** | Rompicapo scorrevole (il «quindici») | Griglia da 3×3 (livelli 1-2) a 4×4 e 5×5, mescolamento più profondo; il tempo cresce con la griglia — un paio di minuti per il 3×3, quattro per il 4×4, oltre sei per il 5×5 |
| 🧭 **Labirinto** | Prima persona, con una mappa che si dimentica | Labirinto più grande, memoria della mappa più corta (24s al 1° livello, 10s al 10°), meno alberi, vista più corta |
| 👾 **Orda** | Sparatutto dall'alto in un dungeon di camere e corridoi: i mostri dormono finché non ti vedono | Ondate più numerose, mostri più veloci e con la vista più lunga (quindi se ne sveglia di più tutti insieme), tipi nuovi che si aggiungono ai vecchi — scattanti dal 2°, corazzati dal 3°, tiratori dal 4°, gemelli che si sdoppiano dal 7° — e un boss ogni cinque livelli |

Il **Labirinto** si gioca in prima persona con il joystick. La pianta non è mai
data: si disegna da sé in alto a destra con quello che i tuoi occhi hanno
davvero visto — un ventaglio di raggi marca le celle in vista — e **sbiadisce
col tempo**, finché quello che hai visto troppo fa non lo ricordi più. Gli altri
riferimenti sono il **numero di zona** dipinto sulle pareti (il labirinto è
diviso in nove settori, ognuno con la sua tinta), la bussola che indica dove sta
l'uscita ma non come arrivarci, e gli alberi che spuntano oltre i muri, fermi e
diversi uno dall'altro per tinta e sagoma. L'**arrivo** si vede da lontano: una
colonna di luce verde che supera i muri, e sotto la statua di pietra di un
bestione rosa addormentato — la si raggiunge per chiudere il livello. La scena è disegnata in raycasting
sul canvas 2D, senza WebGL, a 60 fps.

**Forza 4** è l'unico a due modalità: si sceglie a inizio partita fra sfida alla
CPU e due giocatori sullo stesso dispositivo, a mosse alternate. In due, il
livello sale quando vince il rosso, ed è il suo risultato a finire in classifica.

In **Mattoni** i punti seguono la mira: ogni mattone rotto senza tornare sulla
racchetta vale di più (fino a ×5), mentre ogni tocco di racchetta toglie punti e
azzera il moltiplicatore. Il muro poi non è tutto uguale: i mattoni **turbo**
(»») accelerano la pallina per il resto del livello, gli **impazziti** (?) la
rimandano a un angolo qualsiasi, i **fantasma** (◌) la fanno sparire a
intermittenza, i **corazzati** reggono due colpi. I fantasma entrano in punta di
piedi dal 5° livello — il 2,5% del muro, sparizioni da 5 secondi — e crescono
piano: sommati alla velocità sono l'effetto più duro del gioco. Valgono metà
punti in più, ma decidono che partita sarà: la velocità con cui ti ritrovi a
giocare dipende da quali mattoni hai scelto di rompere. **Pong** e **Mattoni** si giocano solo con i due tasti
sotto il campo, che si dividono tutta la larghezza disponibile; in **Air Hockey**
si trascina il dito, e il mazzuolo resta sopra il polpastrello per non finirci
sotto.

In **Orda** il campo è un **dungeon** visto dall'alto — camere aperte collegate
da corridoi — e i mostri **stanno fermi finché non ti vedono**: li vedi anche tu,
spenti e a occhi chiusi, e decidi se svegliarli. Chi si sveglia ti cerca davvero
— segue i corridoi, non attraversa i muri — e torna a dormire dopo qualche
secondo che non ti vede. Si spara da soli verso il mostro più vicino **che si ha
in vista**, quindi gli angoli contano: quello che decidi tu è dove stare.

Le **camere** sono il cuore del campo, e sono lì per una ragione precisa. Quando
era tutto corridoi larghi una cella la vista non superava mai l'angolo: i mostri
si incontravano in fila indiana, uno o due alla volta, e un'orda non si formava
proprio. Nelle camere invece ci si vede da lontano e ci si sveglia in gruppo — è
lo spazio in cui l'orda diventa un'orda, ed è quello che dà un senso alle armi ad
area. I mostri ci si **radunano apposta** quando compaiono, così ogni ondata ha
un posto dove sta succedendo qualcosa; uno su sei nasce comunque nei corridoi,
perché il resto del campo non diventi una passeggiata garantita. Le camere sono
circa un terzo del campo: i due terzi di corridoi sono il posto dove infilarsi
quando la stanza si riempie, e affrontarli uno per volta.

Anche sparare fa rumore e il rumore sveglia, muri compresi — il laser quasi
niente, i razzi mezzo dungeon — ed è la ragione per cui l'arma migliore non è
sempre quella giusta. I caricatori sono corti apposta: un'arma è un vantaggio a
tempo, non un miglioramento definitivo. Il livello si supera ripulendo il dungeon
prima che scada il tempo. Due dettagli non scontati: i corridoi hanno degli
**anelli** e ogni camera ha almeno due porte (in un labirinto perfetto ogni fuga
finirebbe in un vicolo cieco, e una camera con una porta sola è un vicolo cieco
grande), e le comparse sono annunciate da un cerchio rosso, sempre lontano da te
e fuori dalla tua vista.

Gli avversari simulati seguono una regola comune (`TG.util.opponentSpeedRatio`):
al primo livello si muovono poco sotto la tua velocità, intorno al terzo la
pareggiano, poi la superano fino al 135%. Quello che cambia negli altri livelli
è come giocano — quanto leggono bene la palla, quanto mirano lontano da te,
quanto in fretta rientrano — non solo quanto corrono.

Ogni gioco ha la **sua classifica locale** (top 10, con livello raggiunto e
nome del giocatore) e una progressione a livelli: si parte dal livello 1 e si
sale finché non si perde. Il punteggio non si azzera fra i livelli, così la
classifica misura davvero quanto lontano sei arrivato.

**Si riprende sempre da dove sei arrivato.** Il livello più alto raggiunto in un
gioco resta segnato 🚩: dalla partita successiva puoi scegliere se ricominciare
dal livello 1 o ripartire da lì. È un modo per non rifare ogni volta i primi
livelli, ma non è un pasto gratis — i punti dei livelli saltati non li prendi, e
la classifica segna «da 7» accanto ai risultati partiti a metà strada, così i
punteggi restano confrontabili. Il segnalibro si sposta appena si mette piede nel
livello nuovo, quindi resta anche se si perde subito dopo.

## Versione

In alto, accanto al titolo, c'è sempre il numero di release: `v1`, `v2`, e così
via. Toccandolo (o passandoci sopra) compare anche la data. Non è un vezzo: la
pagina è statica e il browser la tiene volentieri in cache, quindi capita di
guardare una copia vecchia convinti di vedere l'ultima. Il numero in barra
risponde a colpo d'occhio — se è più basso di quello appena pubblicato, quella
che si sta guardando è cache, non il sito.

Il numero sta in un posto solo, `assets/js/core/version.js`. **A ogni
pubblicazione si alza di uno e si aggiorna la data**, nello stesso commit delle
modifiche che si stanno rilasciando:

```js
TG.versione = {
  numero: 2,
  data: '2026-08-18'
};
```

Il test di fumo controlla che il numero sia in pagina e visibile anche durante
una partita, così se il segnale si rompe qualcuno se ne accorge; che sia stato
alzato, invece, resta un gesto da fare a mano.

## Uso

```
git clone https://github.com/tmichele/ToiletGames.git
open index.html            # oppure doppio click sul file
```

Funziona anche servito da un web server statico, ma non è necessario.

**Comandi:** frecce o WASD da tastiera, pad e leva a schermo da telefono,
trascinamento del dito dove serve, tasti 1-9 per i giochi a riquadri. `Esc` o il
pulsante ⏸ mettono in pausa.

**Mentre giochi lo schermo è tutto campo e comandi**: niente da scorrere sotto.
La classifica 🏆 e le istruzioni ❓ del gioco aperto stanno nelle icone in alto a
destra, accanto ad audio e profilo; aprirle mette in pausa, e si chiudono con la
✕, con `Esc` o toccando fuori. In partita la barra ospita cinque bottoni più il
numero di versione: il nome della suite si riduce al 🚽 per fargli posto, così
anche su uno schermo da 320px non esce niente dal bordo. Il campo si adatta allo spazio disponibile
mantenendo le proporzioni del gioco, quindi su schermi alti o bassi cambia la
dimensione, non l'inquadratura.

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
  version.js                numero di release mostrato in barra
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
test/orda-bot.js            pilota simulato di Orda (naviga il dungeon)
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
tavolo nemmeno se lo schiacci in uno spigolo. Per Orda controlla il dungeon e
le sue regole: che ogni cella sia raggiungibile (un mostro chiuso in una sacca
renderebbe il livello impossibile da finire), che ci siano degli anelli e non
solo vicoli ciechi, che le camere ci siano davvero, siano vuote dentro e abbiano
almeno due porte l'una, che i mostri ci si radunino (senza raduno la percentuale
crollerebbe a quel terzo di campo che le camere occupano), che chi dorme non si
muova e non si svegli da solo, che nessuno attraversi i muri, che i mostri
compaiano lontano e annunciati, e che finite le munizioni si torni alla pistola
invece di restare disarmati.

Il primo profilo, «fermo», non tocca niente: serve a verificare che stare fermi
faccia perdere. Un gioco che si vince senza giocare è rotto quanto uno
impossibile, ed è successo davvero — nel pong l'avversario sbagliava così spesso
che una racchetta immobile al centro faceva da muro. In Orda il problema è
strutturale: i mostri dormono finché non li guardi, quindi restare immobili
sarebbe la strategia perfetta. È il tempo del livello a dire di no — si vince
ripulendo il labirinto, e chi non si muove non ripulisce niente.

Stato attuale (percentuale di livelli vinti dal profilo indicato):

| livello | 1 | 3 | 5 | 7 | 9 |
| --- | --- | --- | --- | --- | --- |
| Pong CPU · fermo | 3% | 3% | 0% | 0% | 0% |
| Pong CPU · medio | 80% | 53% | 18% | 8% | 5% |
| Pong CPU · bravo | 98% | 98% | 88% | 78% | 40% |
| Mattoni · medio | 95% | 25% | 0% | 0% | 0% |
| Mattoni · bravo | 100% | 100% | 100% | 20% | 0% |
| Air Hockey · medio | 68% | 18% | 3% | 0% | 0% |
| Air Hockey · bravo | 98% | 85% | 25% | 0% | 0% |
| Talpe · medio | 100% | 88% | 35% | 13% | 0% |
| Talpe · bravo | 100% | 83% | 33% | 8% | 3% |
| Orda · fermo | 0% | 0% | 0% | 0% | 0% |
| Orda · medio | 100% | 100% | 93% | 98% | 78% |
| Orda · bravo | 100% | 100% | 85% | 95% | 85% |

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

La riga di Orda va letta sapendo com'è fatto il suo bot: naviga il dungeon
calcolando le distanze in celle, quindi gira attorno all'orda con una precisione
che un pollice su un telefono non ha, e nelle camere aperte la mira automatica lo
favorisce più di quanto favorisca una persona. Il calo non è regolare perché il
5° e il 10° sono livelli col boss, più duri di quelli attorno: al 10° il profilo
medio scende al 45%. La colonna «scarso» — che decide più lentamente e affonda
meno la leva — cala prima di tutte, ed è il segno che a contare è il gioco e non
il caso.

Sui livelli col boss il rumore è alto (quaranta partite per casella, oscillazioni
di una quindicina di punti fra una misura e l'altra): le caselle del 5° e del 10°
vanno lette come ordini di grandezza, non come decimali. Il numero da guardare
resta quello della riga «fermo», che deve stare a zero ovunque, e lì il margine
non è ambiguo.

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
- **Orda gira a passo fisso e con un seme**: il tempo avanza sempre a 1/60 e il
  caso esce da un generatore seminato, quindi la partita dipende solo dal seme e
  dai comandi. Serve a poterla rigiocare identica — è quello che servirebbe per
  una sfida in cui due persone affrontano la stessa orda e si confrontano sul
  punteggio, senza server né tempo reale. Il test in `regole.js` verifica la
  proprietà: stesso seme e stessi comandi, stessa partita.
