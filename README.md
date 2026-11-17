# Cerca auto

Pagina unica che legge in tempo reale gli annunci di auto usate da più siti e li filtra.

- `index.html` — la pagina (GitHub Pages). Il tasto **Cerca ora** chiama la funzione Supabase.
- `supabase/functions/cerca-auto/index.ts` — la funzione che legge i siti e restituisce un JSON unico.

## Siti letti

| Sito | Da dove |
| --- | --- |
| brumbrum.it | catalogo `/auto/usata`, tutte le pagine |
| achillecar.it | inventario del concessionario su Autoscout24 |
| Lanzocar (Cologno Monzese) | inventario su Autoscout24 |
| Little Cars 3 (Sesto San Giovanni) | inventario su Autoscout24 |
| Broker Mobility (Milano) | inventario su Autoscout24 |
| amautoccasione.it | pagina `/prodotti` del sito (prezzi validi solo con finanziamento: il prezzo senza è nel campo `cash`) |

## Aggiungere un sito

Se il concessionario pubblica su Autoscout24 basta una riga in `SOURCES`: `autoscoutDealer("Nome", "slug-della-pagina")`.

In `index.ts` scrivi una funzione che restituisce `{ cars, expected }` nel formato `Car` e aggiungila a `SOURCES`. Poi ripubblica la funzione su Supabase (progetto `cerca-auto`). La pagina mostra da sola il nuovo sito tra i filtri.

## Note

- La funzione tiene in memoria il risultato per 3 minuti, per non interrogare i siti a ogni tocco.
- Se un sito cambia struttura, la funzione lo segnala nel campo `sources[].error` e la pagina lo mostra nella riga di stato.
- brumbrum rifiuta (403) le richieste dalla regione Supabase di Zurigo: la pagina forza `eu-central-1` e in caso di errore riprova da `eu-west-3` e `eu-west-1`.
