# Cerca auto

Pagina unica che legge in tempo reale gli annunci di auto usate da più siti e li filtra.

L'interfaccia mostra prezzo, anno, chilometri e modello; marca, alimentazione,
cambio e rivenditori sono nel pannello **Altri filtri**. Le auto selezionate
restano selezionate passando da un filtro all'altro e **Copia per AI** esporta
caratteristiche, link e condizioni di prezzo.

## Migliori affari

Il riquadro richiudibile **Migliori affari** mostra fino a tre opportunità nei
filtri attivi. **Ordina per convenienza** e l'ordinamento **Migliori affari**
portano le auto segnalate in cima alla lista. Ogni segnalazione spiega la
differenza rispetto ai confronti, la loro mediana e il numero di annunci e
venditori. Se il campione non basta, il riquadro lo dice senza forzare risultati.

L'algoritmo locale in `deals.js` usa tutti gli annunci dell'ultima ricerca,
prima dei filtri, e non il campo `deal` eventualmente restituito dal server:

1. Raggruppa stessa marca/modello, alimentazione e cambio; distingue cabrio,
   trazione integrale e tipologie ibride quando esplicite. Richiede potenza
   entro il 15%, dati essenziali validi e un link HTTP(S).
2. Per ogni candidata sceglie auto dello stesso anno o al massimo due anni
   più vecchie, con chilometraggio uguale o fino a 40.000 km maggiore. Non
   mette la candidata a confronto con auto più nuove o con meno chilometri.
3. Elimina URL duplicati, tiene i tre confronti più vicini per venditore e
   richiede almeno tre confronti di almeno due venditori diversi.
4. Usa la mediana dei prezzi di questi confronti. La candidata deve costare
   almeno il 5% e 500 € in meno; scarti oltre il 35% vengono esclusi perché
   troppo anomali per una segnalazione automatica.
5. Usa il prezzo senza finanziamento (`cash`) quando noto. Un `cash` non
   valido non viene sostituito con quello promozionale. Nell'ordinamento
   Migliori affari anche il filtro di budget usa questo prezzo.
6. Ordina per vantaggio percentuale, sottraendo 2 punti ai prezzi promozionali
   con cash noto e 4 quando i vincoli non sono verificati. A parità usa la
   differenza in euro, il prezzo e un identificatore stabile.

Prenotate, annunci con avvertenze, veicoli commerciali/van o a due posti,
chilometri zero e dati essenziali mancanti sono esclusi sia dalle candidate
sia dai confronti. I limiti sono in `RULES`. I ribassi pubblicizzati, da soli,
non migliorano il punteggio. Il calcolo viene aggiornato a ogni ricerca;
cambiare filtri non altera il campione di riferimento.

È una stima relativa agli annunci raccolti, non una quotazione ufficiale né
una verifica meccanica. Generazione, allestimento, manutenzione, incidenti,
garanzia e costi aggiuntivi non sono verificati dall'algoritmo. I prezzi senza
vincoli restano dichiarazioni dei venditori.

Test: `node --test tests/deals.test.cjs` (nessuna dipendenza aggiuntiva).

## Avvisi dalla webapp

Il pulsante **Avvisi** attiva Web Push sul dispositivo. Su iPhone/iPad occorre
aggiungere la webapp alla schermata Home e aprirla dall'icona. Il consenso è
richiesto solo quando si tocca **Attiva notifiche**; è disponibile una prova
e la disattivazione per il singolo dispositivo.

Il server controlla le fonti alle **10:00, 14:00 e 18:00 Europe/Rome** e segnala
nuovi annunci disponibili fino a **10.000 €**, immatricolati dal **2020**, e le
auto già in elenco che scendono sotto i 10.000 € (con il prezzo precedente).
Ogni auto viene segnalata una sola volta per dispositivo. La soglia e l'anno sono
in `WATCH`, in `supabase/functions/cerca-auto-watch/helpers.ts`.
I prezzi pubblicizzati con finanziamento sono indicati come tali. Il primo
controllo crea lo storico senza notificare lo stock già esistente; una fonte
che sparisce temporaneamente non cancella lo storico.

- `manifest.webmanifest`, icone e `sw.js`: installazione e ricezione delle push.
- `notifications.js`: attivazione, prova, ultimo avviso e disattivazione.
- `supabase/functions/cerca-auto-watch/`: scansioni, deduplicazione e invio.
- `supabase/car-watch.sql`: tabelle con RLS e funzioni riservate al server.
- `supabase/car-watch-schedule.sql`: pianificazione con cambio ora automatico.
- `supabase/car-watch-price-drops.sql`: colonne aggiunte per gli avvisi sui ribassi.
- `tests/watch_test.ts`: prova locale della funzione avvisi con database, catalogo
  e servizio push finti: `deno run --allow-all tests/watch_test.ts`.

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
