# Cerca auto

Pagina unica che legge in tempo reale gli annunci di auto usate da più siti e li filtra.

- `index.html` — la pagina (GitHub Pages). Il tasto **Cerca ora** chiama la funzione Supabase.
- `supabase/functions/cerca-auto/index.ts` — la funzione che legge i siti e restituisce un JSON unico.

## Siti letti

| Sito | Da dove |
| --- | --- |
| brumbrum.it | catalogo `/auto/usata`, tutte le pagine |
| achillecar.it | inventario del concessionario su Autoscout24 |

## Aggiungere un sito

In `index.ts` scrivi una funzione che restituisce `{ cars, expected }` nel formato `Car` e aggiungila a `SOURCES`. Poi ripubblica la funzione su Supabase (progetto `cerca-auto`). Nella pagina aggiungi il nome del sito ai chip "Sito".

## Note

- La funzione tiene in memoria il risultato per 3 minuti, per non interrogare i siti a ogni tocco.
- Se un sito cambia struttura, la funzione lo segnala nel campo `sources[].error` e la pagina lo mostra nella riga di stato.
