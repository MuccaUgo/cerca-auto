# Cerca auto

Pagina unica che legge in tempo reale gli annunci di auto usate da più siti e li filtra.

L'interfaccia mostra prezzo, anno, chilometri e modello; marca, alimentazione,
cambio e rivenditori sono nel pannello **Altri filtri**. Le auto selezionate
restano selezionate passando da un filtro all'altro e **Copia per AI** esporta
caratteristiche, link e condizioni di prezzo.

## Avvisi dalla webapp

Il pulsante **Avvisi** attiva Web Push sul dispositivo. Su iPhone/iPad occorre
aggiungere la webapp alla schermata Home e aprirla dall'icona. Il consenso è
richiesto solo quando si tocca **Attiva notifiche**; è disponibile una prova
e la disattivazione per il singolo dispositivo.

Il server controlla le fonti alle **10:00, 14:00 e 18:00 Europe/Rome** e segnala
nuovi annunci disponibili fino a **10.000 €**, immatricolati dal **2020**.
I prezzi pubblicizzati con finanziamento sono indicati come tali. Il primo
controllo crea lo storico senza notificare lo stock già esistente; una fonte
che sparisce temporaneamente non cancella lo storico.

- `manifest.webmanifest`, icone e `sw.js`: installazione e ricezione delle push.
- `notifications.js`: attivazione, prova, ultimo avviso e disattivazione.
- `supabase/functions/cerca-auto-watch/`: scansioni, deduplicazione e invio.
- `supabase/car-watch.sql`: tabelle con RLS e funzioni riservate al server.
- `supabase/car-watch-schedule.sql`: pianificazione con cambio ora automatico.

Le chiavi VAPID e il token del job sono in Supabase Vault, mai nel repository.
I nomi sono `cerca_auto_vapid` (JSON `publicKey`/`privateKey`) e
`cerca_auto_cron_secret`. `cerca_auto_anon` contiene il JWT anon pubblico del
progetto per il gateway; la scansione richiede anche il token privato.
La funzione `cerca-auto-watch` mantiene la verifica JWT attiva. Endpoint e
chiavi delle sottoscrizioni sono accessibili solo al server; il client riceve
un token per gestire esclusivamente la propria sottoscrizione.

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
