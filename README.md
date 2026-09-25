# Math Notes

Un quaderno di calcolo matematico personale, interamente statico e adatto a GitHub Pages.

## Cosa fa

- Crea più pagine e le salva nel browser (`localStorage`).
- Definisci variabili e riutilizzale nelle righe successive: `r = 3`, `A = π × r²`.
- Scrivi con simboli naturali: `π`, `√`, `×`, `÷`, potenze e funzioni come `log`, `ln`, `sin` e `cos`.
- Inserisci operatori dalla barra superiore.
- Esporta e reimporta tutte le note in un file JSON.
- Funziona senza backend: dopo il primo caricamento della libreria di calcolo, i dati restano sul dispositivo.

## Pubblicazione con GitHub Pages

In GitHub: **Settings → Pages → Deploy from a branch → `main` → `/(root)`**. Il sito sarà disponibile all'indirizzo:

`https://rik-p.github.io/MathNotesApp/`

## Sviluppo

Non sono necessari pacchetti né build step: apri `index.html` in un browser oppure avvia un server statico nella cartella del progetto.

La libreria [math.js](https://mathjs.org/) viene caricata da CDN per valutare le espressioni.
