# Cerca auto

Pagina unica che legge in tempo reale gli annunci di auto usate da più siti e li filtra.

- `index.html` — la pagina (GitHub Pages). Il tasto **Cerca ora** chiama la funzione Supabase.
- `supabase/functions/cerca-auto/index.ts` — la funzione che legge i siti e restituisce un JSON unico.

## Siti letti

- **brumbrum.it** — catalogo `/auto/usata`, tutte le pagine.
- **amautoccasione.it** — pagina `/prodotti` (prezzi validi solo con finanziamento: il prezzo senza è nel campo `cash`).
- **Concessionari su Autoscout24** — elencati nella tabella Supabase `public.dealers` (Achille Car, Lanzocar, Little Cars 3, Broker Mobility, Auto Occasioni Milano, Autonobile, STAV, Privacar...).

## Aggiungere un concessionario

Se pubblica su Autoscout24 basta una riga nella tabella `public.dealers`, senza toccare il codice:

```sql
insert into public.dealers(slug, name, place, note, pos)
values ('slug-della-pagina-autoscout24', 'Nome', 'Comune', '', 200);
```

`slug` è la parte finale di `autoscout24.it/concessionari/<slug>`; `note` è un'avvertenza mostrata su ogni sua auto; `enabled = false` lo spegne.
Per un sito diverso serve una funzione in `index.ts` che restituisce `{ cars, expected }`, da aggiungere a `own`.

## Note

- La funzione tiene in memoria il risultato per 3 minuti, per non interrogare i siti a ogni tocco.
- Se un sito cambia struttura, la funzione lo segnala nel campo `sources[].error` e la pagina lo mostra nella riga di stato.
- brumbrum rifiuta (403) le richieste dalla regione Supabase di Zurigo: la pagina forza `eu-central-1` e in caso di errore riprova da `eu-west-3` e `eu-west-1`.
