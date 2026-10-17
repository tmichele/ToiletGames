/* Profilo giocatore: il nome che firma i risultati.

   Da quando c'è la classifica globale il nome non è più solo un'etichetta
   locale: diventa una chiave nel database, e una chiave Firebase non può
   contenere . $ # [ ] / — perciò il nome si ripulisce qui, in un posto solo,
   e la nuvola si limita a trasformarlo in slug. Gli accenti diventano lettere
   semplici invece di essere scartati: «Niccolò» resta leggibile come
   «Niccolo», mentre buttare i caratteri non ammessi darebbe «Niccol». */
TG.profile = (function () {
  'use strict';

  var DEFAULT = 'Giocatore';
  var MAX = 14;

  /* Mappa degli accenti: la coppia maiuscola/minuscola sta nella stessa riga,
     così non serve applicare due espressioni per lettera. */
  var ACCENTI = 'àaáaâaãaäaåaèeéeêeëeìiíiîiïiòoóoôoõoöoùuúuûuüuýyÿyçcñn' +
                'ÀAÁAÂAÃAÄAÅAÈEÉEÊEËEÌIÍIÎIÏIÒOÓOÔOÕOÖOÙUÚUÛUÜUÝYÇCÑN';

  function senzaAccenti(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var k = ACCENTI.indexOf(s.charAt(i));
      out += (k >= 0 && k % 2 === 0) ? ACCENTI.charAt(k + 1) : s.charAt(i);
    }
    return out;
  }

  /* Lettere, numeri, trattino e underscore, con spazi singoli in mezzo.
     Niente di più: è lo stesso insieme che le regole del database accettano, e
     due regole che non coincidono vorrebbero dire nomi rifiutati dal server
     dopo essere stati accettati a schermo. */
  function pulisci(name) {
    return senzaAccenti(String(name == null ? '' : name))
      .replace(/[^A-Za-z0-9 _-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX)
      .trim();
  }

  function getName() {
    var n = TG.storage.get('playerName', DEFAULT);
    return (typeof n === 'string' && n.trim()) ? n.trim() : DEFAULT;
  }

  function setName(name) {
    var clean = pulisci(name);
    if (!clean) clean = DEFAULT;
    TG.storage.set('playerName', clean);
    return clean;
  }

  /* Il nome di default non è una scelta: è quello che si ha prima di
     scegliere. In classifica globale non ci va, altrimenti ci finirebbero
     dieci «Giocatore» indistinguibili. */
  function isDefault(name) { return pulisci(name).toLowerCase() === DEFAULT.toLowerCase(); }

  return { getName: getName, setName: setName, pulisci: pulisci, isDefault: isDefault, DEFAULT: DEFAULT, MAX: MAX };
})();
