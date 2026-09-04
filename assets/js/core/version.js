/* Numero di release della suite, mostrato sempre in alto nella barra.

   Serve a rispondere a occhio alla domanda «sto guardando l'ultima versione o
   una copia vecchia?»: il browser tiene volentieri in cache index.html e gli
   script, e senza un numero in pagina non c'è modo di accorgersene.

   Il numero non sta qui: sta nel <meta name="versione"> di index.html, che è
   anche quello che mette ?v=N in coda a ogni script e al foglio di stile. Così
   la versione in barra e i file caricati non possono dire due cose diverse —
   è successo, con una pagina nuova e un input.js vecchio in cache. Si alza
   in un posto solo, e vedi la sezione «Versione» del README. */
var TG = window.TG || {};
window.TG = TG;

TG.versione = (function () {
  var meta = document.querySelector('meta[name="versione"]');
  return {
    numero: meta ? parseInt(meta.getAttribute('content'), 10) || 0 : 0,
    data: meta ? (meta.getAttribute('data-data') || '') : ''
  };
})();
