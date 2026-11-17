(function() {
  'use strict';
  var $ = function(id) { return document.getElementById(id); };
  var endpoint = FUNCTION_URL + '-watch';
  var registration = null, config = null, active = false, busy = false;
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var ready = supported ? navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then(function() { return navigator.serviceWorker.ready; })
    .then(function(reg) { registration = reg; return reg; })
    .catch(function() { return null; }) : Promise.resolve(null);
  function stored() { try { return JSON.parse(localStorage.getItem('cerca-auto-push') || 'null'); } catch (_e) { return null; } }
  function save(value) { try { if (value) localStorage.setItem('cerca-auto-push', JSON.stringify(value)); else localStorage.removeItem('cerca-auto-push'); } catch (_e) {} }
  function request(action, body) {
    var info = stored();
    var headers = { Authorization: 'Bearer ' + ANON_KEY, apikey: ANON_KEY };
    if (info && info.token) headers['X-Watch-Token'] = info.token;
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(endpoint + '?action=' + action, { method: body ? 'POST' : 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function(res) { return res.json().then(function(data) { if (!res.ok) throw new Error(data.error || 'Servizio avvisi non disponibile.'); return data; }); });
  }
  function say(text, error) { $('watchStatus').textContent = text; $('watchStatus').classList.toggle('err', !!error); }
  function draw() {
    var install = ios && !standalone;
    $('watchSetup').textContent = install
      ? 'Su iPhone: apri questo sito in Safari, usa Condividi → Aggiungi alla schermata Home, poi riaprilo dalla nuova icona e attiva le notifiche.'
      : !supported ? 'Questo browser non supporta le notifiche web. Apri la webapp in un browser compatibile.'
      : Notification.permission === 'denied' ? 'Le notifiche sono bloccate. Riabilitale nelle impostazioni del dispositivo o del browser, poi riapri la webapp.'
      : active ? 'Notifiche attive su questo dispositivo. Riceverai un avviso solo per nuovi annunci o ribassi sotto la soglia.'
      : 'Tocca Attiva notifiche e consenti l’invio. Non è necessario lasciare aperta la pagina.';
    $('watchEnable').hidden = active;
    $('watchEnable').disabled = busy || install || !supported || !registration || !config || Notification.permission === 'denied';
    $('watchTest').hidden = !active;
    $('watchTest').disabled = busy;
    $('watchDisable').hidden = !active;
    $('watchDisable').disabled = busy;
    $('watchToggle').textContent = active ? 'Avvisi ✓' : 'Avvisi';
  }
  function loadRecent() {
    if (!('caches' in window)) return;
    caches.open('cerca-auto-push-v1').then(function(cache) { return cache.match(new URL('last-push', new URL('./', location.href)).href); })
      .then(function(res) { return res ? res.json() : null; })
      .then(function(data) {
        if (!data) return;
        var root = $('watchRecent'); root.replaceChildren();
        var title = document.createElement('p'); title.textContent = 'Ultimo avviso: ' + (data.title || 'Cerca auto'); root.appendChild(title);
        (data.cars || []).forEach(function(car) {
          var url; try { url = new URL(car.url); } catch (_e) { return; }
          if (url.protocol !== 'https:') return;
          var p = document.createElement('p'), a = document.createElement('a');
          a.textContent = car.label; a.href = url.href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'open';
          p.appendChild(a); root.appendChild(p);
        });
        root.hidden = false;
      }).catch(function() {});
  }
  function refresh() {
    say('Controllo le impostazioni…', false); draw(); loadRecent();
    return Promise.all([ready, request('config')]).then(function(results) {
      config = results[1];
      active = !!(config.device && config.device.enabled && supported && Notification.permission === 'granted');
      var run = config.lastRun;
      $('watchLastRun').textContent = run && run.finished_at
        ? 'Ultimo controllo: ' + new Date(run.finished_at).toLocaleString('it-IT') + ' · ' + run.cars_read + ' annunci letti' + (run.status === 'partial' ? ' · controllo parziale' : '') + (run.status === 'error' ? ' · controllo non riuscito' : '')
        : 'Il primo controllo automatico preparerà la ricerca.';
      say('', false); draw();
    }).catch(function(error) { say(error.message, true); draw(); });
  }
  $('watchToggle').addEventListener('click', function() { $('watchDialog').showModal(); refresh(); });
  $('watchClose').addEventListener('click', function() { $('watchDialog').close(); });
  $('watchEnable').addEventListener('click', function() {
    if (busy || !config || !registration || !supported) return;
    // Keep the permission request directly inside the user's tap (required by iOS).
    var permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    busy = true; say('Attivo le notifiche…', false); draw();
    permission.then(function(result) {
      if (result !== 'granted') throw new Error('Notifiche non attivate. Puoi riprovare quando vuoi.');
      return registration.pushManager.getSubscription().then(function(sub) {
        if (sub) return sub;
        var raw = atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
        var key = Uint8Array.from(raw, function(c) { return c.charCodeAt(0); });
        return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      });
    }).then(function(subscription) { return request('subscribe', { subscription: subscription.toJSON() }); })
      .then(function(info) { save(info); active = true; say('Notifiche attivate: controlli alle 10:00, 14:00 e 18:00, ora italiana.', false); })
      .catch(function(error) { say(error.message || 'Impossibile attivare le notifiche.', true); })
      .finally(function() { busy = false; draw(); });
  });
  $('watchTest').addEventListener('click', function() {
    if (busy) return; busy = true; say('Invio la notifica di prova…', false); draw();
    request('test', {}).then(function() { say('Prova inviata. Controlla le notifiche del dispositivo.', false); })
      .catch(function(error) { say(error.message, true); })
      .finally(function() { busy = false; draw(); });
  });
  $('watchDisable').addEventListener('click', function() {
    if (busy) return; busy = true; draw();
    request('unsubscribe', {}).then(function() {
      return registration ? registration.pushManager.getSubscription().then(function(sub) { return sub ? sub.unsubscribe() : true; }) : true;
    }).then(function() { save(null); active = false; say('Notifiche disattivate su questo dispositivo.', false); })
      .catch(function(error) { say(error.message, true); })
      .finally(function() { busy = false; draw(); });
  });
  if (new URLSearchParams(location.search).get('push') === '1') { $('watchDialog').showModal(); refresh(); $('go').click(); }
})();
