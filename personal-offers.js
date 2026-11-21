// Collegamenti personali. La ricerca si apre soltanto al clic dell'utente.
(function (root) {
  'use strict';
  const storageKey = 'cerca-auto-subito-personale-v1';
  let cache;

  function records() {
    if (cache) return cache;
    try {
      const saved = JSON.parse(root.localStorage.getItem(storageKey) || '{}');
      cache = Object.assign(Object.create(null), saved);
    } catch (_) {
      cache = Object.create(null);
    }
    return cache;
  }

  if (root.addEventListener) root.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) cache = undefined;
  });

  function listing(link) {
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:' || url.port || url.username || url.password ||
          !['subito.it', 'www.subito.it'].includes(url.hostname)) return null;
      const match = /^\/auto\/[\w%-]+-(\d+)\.htm\/?$/i.exec(url.pathname);
      if (!match) return null;
      return { id: match[1], url: 'https://www.subito.it' + url.pathname.replace(/\/$/, '') };
    } catch (_) { return null; }
  }

  function keys(car) {
    return [car.src + '|' + car.id, ...(Array.isArray(car.aliases) ? car.aliases : [])];
  }

  function stored(car) {
    const data = records();
    for (const key of keys(car)) {
      const entry = data[key];
      if (!entry) continue;
      const ad = listing(entry.url);
      if (!ad) continue;
      const offer = { src: 'Subito (personale)', portal: 'subito', id: ad.id, url: ad.url,
        manual: true, note: 'Collegamento personale. Prezzo e condizioni da verificare.' };
      if (typeof entry.price === 'number' && Number.isSafeInteger(entry.price) && entry.price > 0) offer.price = entry.price;
      return offer;
    }
    return null;
  }

  function containsAd(car, id) {
    const offers = (car.offers || []).concat([car]);
    return offers.some(offer => typeof offer.url === 'string' && offer.url.includes('subito.it/') && listing(offer.url)?.id === id);
  }

  function get(car) {
    const offer = stored(car);
    return offer && !containsAd(car, offer.id) ? offer : null;
  }

  function save(car, link, price, allCars) {
    const entries = records();
    const ownKeys = new Set(keys(car));
    const next = Object.assign(Object.create(null), entries);
    for (const key of ownKeys) delete next[key];
    if (link !== null) {
      const ad = listing(link);
      if (!ad) throw new Error('Incolla il link completo di un annuncio Auto su subito.it.');
      if (Object.values(next).some(entry => listing(entry?.url)?.id === ad.id) ||
          allCars.some(vehicle => containsAd(vehicle, ad.id))) {
        throw new Error('Questo annuncio Subito è già presente. Controlla la scheda a cui è associato.');
      }
      const value = { url: ad.url };
      if (price !== '') {
        const amount = Number(price);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Inserisci un prezzo intero in euro superiore a zero.');
        value.price = amount;
      }
      next[car.src + '|' + car.id] = value;
    }
    try { root.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch (_) { throw new Error('Il browser non ha salvato il collegamento. Verifica lo spazio disponibile su questo dispositivo.'); }
    cache = next;
  }

  function searchUrl(car) {
    const url = new URL('https://www.subito.it/annunci-lombardia/vendita/auto/');
    const model = [car.brand, car.model].filter(Boolean).join(' ');
    if (model) url.searchParams.set('q', model);
    return url.href;
  }

  function edit(car, onChange, allCars) {
    const previous = stored(car);
    const dialog = document.createElement('dialog');
    dialog.className = 'watch-dialog';
    dialog.setAttribute('aria-labelledby', 'personalOfferTitle');
    dialog.innerHTML = `
      <form class="personal-offer-form">
        <div class="row"><h2 id="personalOfferTitle">Collega annuncio Subito</h2>
          <button type="button" class="watch-close" data-close aria-label="Chiudi">×</button></div>
        <p data-car></p>
        <a class="open" data-search target="_blank" rel="noopener noreferrer">Cerca questo modello in Lombardia ↗</a>
        <p>Confronta venditore, versione, chilometri e immatricolazione. Se è la stessa auto, incolla qui il suo annuncio.</p>
        <label class="f">Link all’annuncio Subito
          <input name="link" type="url" inputmode="url" autocapitalize="none" required placeholder="https://www.subito.it/auto/…"></label>
        <label class="f">Prezzo pubblicizzato in € (facoltativo)
          <input name="price" type="number" inputmode="numeric" min="1" step="1"></label>
        <p class="watch-hint">Il collegamento resta su questo dispositivo. Il prezzo è quello inserito da te.</p>
        <p data-error role="alert" hidden></p>
        <div class="actions"><button class="btn" type="submit">Conferma stessa auto</button>
          <button class="link" type="button" data-remove>Rimuovi collegamento</button></div>
      </form>`;
    const form = dialog.querySelector('form');
    const field = form.elements.namedItem('link');
    const amount = form.elements.namedItem('price');
    const remove = dialog.querySelector('[data-remove]');
    dialog.querySelector('[data-car]').textContent = [[car.brand, car.model, car.ver].filter(Boolean).join(' '), car.reg,
      Number(car.km) > 0 ? Number(car.km).toLocaleString('it-IT') + ' km' : '', car.sellerName || car.src].filter(Boolean).join(' · ');
    dialog.querySelector('[data-search]').href = searchUrl(car);
    field.value = previous?.url || '';
    amount.value = previous?.price || '';
    remove.hidden = !previous;
    function commit(link) {
      try { save(car, link, amount.value, allCars || [car]); }
      catch (error) {
        const message = dialog.querySelector('[data-error]');
        message.hidden = false;
        message.textContent = error.message;
        return;
      }
      dialog.close();
      onChange();
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      commit(field.value.trim());
    });
    remove.addEventListener('click', () => commit(null));
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  const api = { get, edit, searchUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = { ...api, save, listing };
  else root.PersonalOffers = api;
})(globalThis);
