# Classifica globale su Firebase

La suite funziona da sola, senza niente: le classifiche restano nel browser di
chi gioca. Accendendo la classifica globale, invece, i punteggi di tutti
finiscono nello stesso posto e c'è una gara — un nome per giocatore, una riga
per gioco, la propria evidenziata in mezzo alle altre.

**Stato: accesa.** Il progetto è `toiletgames-f9ec7`, con il Realtime Database
in `europe-west1`; i due valori sono già in `index.html`. Questa pagina resta
per due motivi: dice come è stata montata (e quindi come rimontarla altrove), e
dice dove guardare quando qualcosa non va.

Quello che serve è un progetto Firebase, che va creato una volta sola. Sono
cinque minuti di console e due valori da incollare in `index.html`.

## 1. Il progetto e il database

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Aggiungi progetto**. Il nome non conta (`toiletgames` va bene), Analytics
   si può saltare. Il piano gratuito **Spark** basta e avanza: questa
   classifica muove qualche kilobyte per partita.
2. Nel menù a sinistra: **Realtime Database** → **Crea database**.
   - **Non** Firestore: è il Realtime Database che parla HTTP semplice, e la
     suite non ha un passaggio di build in cui infilare l'SDK di Firebase.
   - Posizione: `europe-west1` se si gioca da qui.
   - Regole: **modalità bloccata** (le sostituiamo al punto 3).
3. Copia l'indirizzo che compare in cima al database, nella forma
   `https://<progetto>-default-rtdb.europe-west1.firebasedatabase.app`.

## 2. L'accesso anonimo

**Authentication** → **Inizia** → **Sign-in method** → **Anonimo** → attiva.

Serve perché ogni browser riceva un'identità stabile (`uid`). È quella che
permette alle regole di dire «questa riga è tua e nessun altro la può
toccare»: senza, il database dovrebbe essere scrivibile da chiunque, e una
classifica scrivibile da chiunque dura fino al primo che la cancella. Non
chiede niente a chi gioca — nessuna email, nessuna password, nessun pulsante.

Gli account anonimi non usati si possono far cancellare da sé dopo 30 giorni
(**Authentication** → **Impostazioni** → *Pulizia utenti anonimi*). Attenzione:
chi non gioca per un mese perderebbe il nome preso. Con pochi giocatori conviene
lasciarla spenta.

## 3. Le regole

**Realtime Database** → **Regole**: incolla il contenuto di
[`dati/regole-firebase.json`](../dati/regole-firebase.json) e **pubblica**.

Sono la parte che conta davvero, perché è l'unica che il browser non può
aggirare:

| Regola | Perché |
| --- | --- |
| La radice non è leggibile né scrivibile | tutto ciò che non è previsto è vietato, non il contrario |
| `nomi/<slug>` si scrive solo se libero o già tuo | due giocatori non possono avere lo stesso nome, e nessuno può prenderlo a un altro |
| `nomi` non è leggibile | l'elenco di chi gioca non è affare di chi passa |
| `punteggi/<gioco>/<uid>` scrivibile solo se `uid` è il tuo | nessuno può modificare la riga di un altro |
| Il punteggio non può scendere | in classifica resta il meglio di ciascuno |
| Il `nome` della riga deve essere quello che hai preso | niente firme altrui |
| Campi estranei rifiutati, `punti` ≤ 10.000.000, `livello` ≤ 999 | la forma dei dati è decisa dal server |
| `punteggi/<gioco>` è leggibile da tutti, indicizzato su `punti` | la classifica si vede anche prima di avere un nome, e la ordina il database |

## 4. I due valori in pagina

In `index.html`, in cima:

```html
<meta name="classifica"
      content="https://toiletgames-default-rtdb.europe-west1.firebasedatabase.app"
      data-chiave="AIza...">
```

- `content` è l'indirizzo del punto 1.
- `data-chiave` è la **chiave web** del progetto: *Impostazioni progetto* →
  *Le tue app* → app web (`</>`) → `apiKey`.

**Non sono segreti.** La chiave web di Firebase sta in chiaro in qualunque app
Firebase: identifica il progetto, non autorizza niente. A proteggere i dati
sono le regole del punto 3, che è il posto giusto per farlo — e l'unico che
funziona, visto che tutto il resto gira nel browser di chi gioca.

Poi si alza il numero di versione (`<meta name="versione">`), si pubblica, e la
classifica globale è accesa. Finché i due valori sono vuoti resta spenta e la
suite si comporta come sempre: nessun errore, nessuna chiamata, solo le
classifiche locali.

## Spegnerla, del tutto o per una volta

Svuotando i due attributi del `<meta name="classifica">` la classifica globale
si spegne per tutti e restano quelle locali. Per spegnerla **solo nella propria
scheda** si apre la pagina con `?classifica=off`: niente nome da scegliere,
niente chiamate, niente righe scritte. Lo usa anche il test di fumo, che gira
sulla pagina vera e non deve sporcare la classifica di chi gioca.

E se prendere il nome fallisce per colpa del server — accesso anonimo non
attivo, regole non pubblicate, rete assente — il pannello offre «Gioca senza
classifica globale»: la suite funziona benissimo da sola, e un intoppo lassù
non deve bloccarla quaggiù.

## Come si comporta

- **Il nome si prende una volta.** Al primo avvio la suite lo chiede, prima di
  giocare: un risultato senza nome resterebbe fuori classifica, e sarebbe una
  partita buttata. Se è occupato lo dice e si può riprovare. Il nome resta su
  quel browser; cambiandolo, la riga già in classifica si aggiorna.
- **In classifica va il tuo meglio.** Una riga per giocatore e per gioco: una
  classifica dove uno occupa dieci posizioni su dieci non mette in competizione
  nessuno. Un punteggio più basso non parte nemmeno.
- **Senza rete si gioca uguale.** Il risultato locale è salvato prima di
  qualunque chiamata; quello per la classifica globale resta in coda e parte da
  solo al caricamento successivo o quando la scheda torna in primo piano. In
  coda resta solo il migliore per gioco.
- **Browser diversi, giocatori diversi.** L'identità è l'utente anonimo, che
  sta in quel browser: lo stesso nome sul telefono e sul computer sono due
  giocatori, e il secondo troverà il nome occupato. È il prezzo di non chiedere
  una password a nessuno.

## Se qualcosa non va

Il pannello 🏆 dice sempre in che stato è la parte in rete, e l'errore che
riporta è quello di Firebase, non una frase generica. I casi che capitano:

| Cosa si legge | Cosa manca |
| --- | --- |
| `Permission denied` scrivendo | le regole del punto 3 non sono state pubblicate |
| Errore prendendo il nome, su un progetto nuovo | l'accesso anonimo (punto 2) non è attivo |
| `API key not valid` | `data-chiave` non è la chiave web del progetto |
| Non raggiungibile, sempre | l'indirizzo in `content` ha la regione sbagliata: deve essere quello che la console mostra in cima al database |
| `Index not defined` leggendo | nelle regole manca `".indexOn": "punti"` — c'è in quelle di `dati/regole-firebase.json` |

Una cosa non ho potuto verificarla da qui: **che il browser non blocchi le
chiamate per CORS.** La rete di questo ambiente non raggiunge gli host di
Google (403 di policy), quindi i test girano contro un Firebase finto che
applica le stesse regole — tutta la logica è provata, la stretta di mano col
server vero no. Non dovrebbe esserci problema (sono le stesse chiamate che fa
l'SDK ufficiale dalla pagina, e gli endpoint REST rispondono con
`Access-Control-Allow-Origin`), ma se alla prima prova la console del browser
parlasse di CORS, quello è il punto da guardare — non le regole.

## Quello che questa classifica non è

**I punti li calcola il browser, quindi si possono falsificare.** Chi apre la
console del browser può chiamare `TG.nuvola.invia` con il numero che vuole; le
regole controllano la forma e un tetto, non l'onestà. Per impedirlo davvero
servirebbe far girare i giochi su un server e fidarsi solo di lui, che è un
altro progetto — e per una classifica fra amici il rimedio sta nel cancellare
la riga, non nel riscrivere l'architettura.

Per cancellare una riga: **Realtime Database** → **Dati** → si apre
`punteggi/<gioco>/<uid>` e si elimina il nodo. Il nome resta preso in `nomi/`;
eliminando anche quello, torna libero.

## Costi

Sul piano Spark: 1 GB di archivio e 10 GB di traffico al mese, gratis. Una riga
di classifica sono circa 80 byte e una partita è una scrittura; leggere una
classifica sono dieci righe. Con dieci giocatori che fanno dieci partite al
giorno si resta nell'ordine dei megabyte all'anno — qualunque numero
realistico qui sta dentro, e il piano gratuito non addebita: se mai si
superasse, smetterebbe di rispondere, e la suite tornerebbe alle classifiche
locali senza rompersi.
