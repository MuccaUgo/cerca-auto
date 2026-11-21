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
Ogni controllo invia comunque una notifica ai dispositivi attivi: se non ci sono
nuovi eventi, conferma **nessuna novità** con l'ora italiana e il numero di
annunci e siti controllati. Le auto già segnalate non vengono riproposte.
Se mancano fonti, la notifica indica **controllo parziale**; un errore della
ricerca produce, se database e servizio push sono raggiungibili, un avviso
**controllo non riuscito**, senza dichiarare falsamente l'assenza di novità.
Il primo controllo e una fonte appena aggiunta preparano lo storico senza
presentare lo stock esistente come nuovo, ma inviano comunque l'esito del controllo.
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

- **AutoScout24 Lombardia** — ricerca generale, anche di privati, con prezzo
  pubblicizzato fino a 10.000 € e immatricolazione dal 2020. Le auto dei saloni
  già configurati restano associate alla loro fonte; gli ID AutoScout24 duplicati
  compaiono una sola volta. Il filtro **Venditore** separa privati e concessionari.
- **brumbrum.it** — catalogo `/auto/usata`, tutte le pagine.
- **amautoccasione.it** — pagina `/prodotti` (prezzi validi solo con finanziamento: il prezzo senza è nel campo `cash`).
- **Concessionari su Autoscout24** — elencati nella tabella Supabase `public.dealers` (Achille Car, Lanzocar, Little Cars 3, Broker Mobility, Auto Occasioni Milano, Autonobile, STAV, Privacar...).

### Copertura Lombardia e limiti

`supabase/functions/cerca-auto/lombardia.ts` costruisce la ricerca pubblica
`/lst`, pagina i risultati a 100 annunci per pagina e ricontrolla prezzo e anno
su ogni scheda. Il collegamento regionale del portale usa un raggio, non i
confini della regione: la raccolta usa 200 km dal centro proposto dal portale
(45.66667, 9.5) e accetta solo venditori italiani con CAP nei settori 20–27
o 46 (Mantova). Località mancanti o non verificabili sono escluse.

La risposta include `coverage`: pagine lette/attese, risultati della ricerca,
ID unici letti ed esclusioni geografiche. Il limite è 80 pagine e 75 secondi
per la fonte. Pagine mancanti, filtri rimossi dal portale o cambi di struttura
non vengono trattati come una raccolta completa. Il portale può modificare
l'ordine e il contenuto mentre si sfogliano le pagine: non è una garanzia di
copertura assoluta di ogni annuncio AutoScout24.

Il limite di 10.000 € / anno 2020 riguarda questa fonte aggiuntiva, anche se i
filtri della webapp vengono ampliati. È un limite sul prezzo pubblicizzato:
eventuali condizioni vengono evidenziate e non si presume un prezzo senza
finanziamento se non indicato. Non si raccolgono telefoni, vie o nomi dei
venditori privati. Per i migliori affari, i saloni vengono contati tramite
identità del venditore e i privati sono confrontati con altri privati.

Gli avvisi usano lo stesso catalogo: la nuova fonte prepara uno storico iniziale
senza notificare tutto lo stock preesistente. I saloni già configurati mantengono
il loro nome anche quando i dati provengono dalla ricerca regionale, conservando
le chiavi dello storico. Un annuncio nuovo per la webapp non implica che sia
stato appena pubblicato sul portale.

Test: `node --test tests/lombardia.test.cjs tests/deals.test.cjs`.
Il modulo `supabase/functions/cerca-auto/deals.ts`, già presente nella funzione
distribuita, viene conservato; la classifica visibile continua a usare `deals.js`.

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

## Segnalazioni sui vincoli di prezzo (17 novembre 2026)

Loconte Automobili (ID AutoScout24 `28098624`) è contrassegnato in
`applyPriceWarnings` di `lombardia.ts` su segnalazione dell'utente: finanziamento,
prezzo senza finanziamento da verificare. Non è una verifica contrattuale né
una deduzione dal simulatore di prestito pubblicitario presente sul portale.
La regola usa l'ID del venditore, non un nome simile; si applica anche dopo la
fusione dei doppioni e prevale sul badge “prezzo reale”. Non inventa un prezzo cash.

Le auto restano consultabili e selezionabili: avvertenza nella scheda e nella
copia per AI, filtro di esclusione degli annunci con avvertenze, esclusione sia
dai candidati ai migliori affari sia dal campione di confronto (anche nel
calcolo del server). Le notifiche relative a queste auto indicano condizioni
di prezzo da verificare. Gli orari e le notifiche senza novità restano attivi.
Altre segnalazioni richiedono l'identificazione del venditore e la provenienza
dell'informazione; non si attribuisce un vincolo di finanziamento per il solo
fatto che esista un calcolatore di rate.

## Collegare le offerte Subito fornite dai rivenditori

Il catalogo accetta gli annunci che un rivenditore fornisce e autorizza a usare.
La fonte compare come **Subito · stock rivenditori** quando contiene offerte
attive in Lombardia, con prezzo pubblicizzato entro 10.000 € e anno dal 2020.
La copertura riguarda esclusivamente lo stock ricevuto. I link alle schede
Subito vengono aperti dal visitatore e la scansione legge il database locale.

Applicare una volta `supabase/car-partner-stock.sql`. L'archivio è accessibile
al server e all'amministratore. Un importatore autorizzato può fare upsert in
batch su `car_partner_stock` con chiave `subito_id` e quattro campi:

| Campo | Contenuto |
|---|---|
| `subito_id` | ID numerico come testo, corrispondente alla scheda Subito |
| `provenance` | Provenienza del catalogo e riferimento all'autorizzazione del fornitore, per uso interno |
| `valid_until` | Scadenza della disponibilità dichiarata o del prossimo rinnovo dello stock, con fuso orario |
| `listing` | Oggetto JSON descritto sotto |

Nel JSON indicare `url`, `sellerName`, `countryCode` (“IT”), `postcode`,
`brand`, `model`, `year` e `price`. Anno e importi sono numeri interi,
senza separatori. Per il confronto aggiungere i dati disponibili: `reg`
(MM/AAAA), `ver`, `km`, `cv`, `gear`, `fuel`, `city`, `body`.
Per disponibilità usare i booleani `res` (prenotata) o `unavailable`.
`pricing` accetta `cash` per un prezzo senza vincoli dichiarato, `finance`
per un prezzo con finanziamento e `unknown` per condizioni sconosciute.
Con `finance` il campo numerico facoltativo `cash` contiene il prezzo senza
finanziamento comunicato dal venditore. Le altre condizioni vanno in `note`.

Per aggiornare un catalogo completo, importare le righe del rivenditore in
transazione. Aggiornare la scadenza solo sulle vetture confermate dal fornitore
e far scadere immediatamente quelle ritirate. Le righe scadute non vengono lette.
Un esempio di importazione parametrizzata (parametro JSON composto da un array
di righe con i quattro campi sopra):

```sql
insert into public.car_partner_stock (subito_id, listing, provenance, valid_until)
select subito_id, listing, provenance, valid_until
from jsonb_to_recordset($1::jsonb)
  as incoming(subito_id text, listing jsonb, provenance text, valid_until timestamptz)
on conflict (subito_id) do update
set listing = excluded.listing, provenance = excluded.provenance, valid_until = excluded.valid_until;
```

Per confermare che si tratta della stessa vettura su più portali, il
fornitore può indicare `autoscoutListingId` (UUID della scheda abbinata),
`vin` (telaio completo), oppure `stock` e `autoscoutSellerId`
(riferimento stock del gestionale e ID AutoScout24 dello stesso salone).
Il codice stock deve corrispondere al riferimento venditore presente su
AutoScout24. Codici ambigui e identificativi in conflitto impediscono
l'unione. I dati di identità tecnici vengono rimossi dalla risposta pubblica.

Per un possibile doppione servono lo stesso salone identificato, marca,
modello, versione, mese di immatricolazione, potenza, cambio e alimentazione.
La tolleranza sui km è l'1%, con minimo 100 e massimo 1.000 km. Le due schede
restano distinte. Le unioni confermate mantengono la chiave della scheda
originaria, i link, i prezzi e i vincoli per ciascuna offerta. Il conteggio
dello stock indica le offerte importate dalla fonte, anche quando una
confluisce nella scheda di un'altra fonte.

Test del catalogo: `node --test tests/partner-stock.test.cjs tests/lombardia.test.cjs`.

L'adattatore diretto `subito.ts` già presente sul server è conservato. Solo
in presenza di un'autorizzazione che copre l'accesso diretto al portale si
attiva `SUBITO_DIRECT_AUTHORIZED=true` sulla funzione `cerca-auto`.
Il valore predefinito è disattivato. Quando attivo, il controllo regionale
riporta pagine raccolte ed eventuali letture parziali. Una scheda letta
direttamente e presente anche nello stock del salone conta come una sola
offerta Subito. Il prezzo e le condizioni provengono dalla scheda letta
direttamente, e i dati economici discordanti ricevono un'avvertenza.
La chiave storica `Subito Lombardia|id` e quella dello stock restano
collegate allo stesso annuncio. Venditori con nome e comune coincidenti
su portali diversi possono generare un suggerimento; questo da solo non
conferma l'identità del veicolo.

### Ricerca su Subito in Lombardia

**Cerca su Subito ↗**, accanto a Ripristina, apre i risultati sul portale usando marca, testo, prezzo massimo e anno minimo. Funziona anche senza selezionare auto. Gli altri filtri si possono impostare su Subito. La ricerca esterna non importa annunci e non confronta duplicati.

### Collegare personalmente un annuncio Subito

Seleziona una sola auto, tocca **Collega Subito** e confronta venditore,
versione, immatricolazione e chilometri. Puoi cercare il modello in Lombardia
dal dialogo. Quando riconosci la vettura, inserisci il link all’annuncio e,
se vuoi, il prezzo pubblicizzato. La scheda e **Copia per AI** mostrano entrambe
le offerte. **Modifica link Subito** permette di correggere o rimuovere il collegamento.
Questo abbinamento è salvato nel browser del dispositivo. Le classifiche e gli
avvisi programmati usano le offerte acquisite dal server.

La lista mostra 60 schede per volta. I filtri, i conteggi, la classifica e
**Seleziona i risultati** lavorano sull'intero insieme filtrato.

### Esclusioni personali

In **Altri filtri**, inserisci marche intere o parole da escludere dal titolo, dalla versione e dalla carrozzeria, separate da virgole. Mahindra è esclusa di default. Le preferenze restano sul dispositivo e si applicano ai risultati e ai migliori affari. Gli avvisi programmati usano i criteri del server.
