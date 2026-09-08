# Mappe da OpenStreetMap

Qui dentro va l'export di OpenStreetMap del paese, e da qui
`node tools/mappa.js` costruisce `assets/js/mappe/codiverno.js`, cioè la mappa
su cui si guida nel gioco delle **Pizze**.

## Come si prende

1. apri [openstreetmap.org](https://www.openstreetmap.org/) e inquadra
   **Codiverno** (Vigonza, PD);
2. «Esporta» → «Seleziona manualmente un'altra area» attorno alla frazione;
3. scarica e salva il file qui come **`codiverno.osm`**;
4. `node tools/mappa.js`.

Lo strumento dirà `mappa da dati/codiverno.osm`, e da quel momento strade, nomi
e numeri civici sono quelli veri. Il file generato si marca da solo come
`fonte: OpenStreetMap` e porta l'attribuzione ODbL, che il gioco mostra in
schermata sotto il conto alla rovescia.

## Se il file non c'è

Non succede niente di male: `tools/mappa.js` genera una **ricostruzione** — una
frazione veneta plausibile, dichiarata come tale nel file e in gioco. Serve a
non lasciare il gioco senza mondo, non a fingere di conoscere Codiverno.

Il file `.osm` non è in repository: è dato altrui (ODbL) e pesa, mentre la
mappa generata è piccola e basta a sé.
