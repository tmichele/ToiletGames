/* Numero di release della suite, mostrato sempre in alto nella barra.

   Serve a rispondere a occhio alla domanda «sto guardando l'ultima versione o
   una copia vecchia?»: il browser tiene volentieri in cache index.html e gli
   script, e senza un numero in pagina non c'è modo di accorgersene.

   Si alza di uno a ogni pubblicazione, insieme alla data — vedi la sezione
   «Versione» del README. È l'unico posto in cui il numero è scritto. */
var TG = window.TG || {};
window.TG = TG;

TG.versione = {
  numero: 3,
  data: '2026-08-19'
};
