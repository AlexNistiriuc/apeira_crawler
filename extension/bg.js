// Legge pagine pubbliche per la scheda Apeira crawler. Nessun cookie inviato.
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.t !== 'fetch') return;
  if (!sender.url || !sender.url.startsWith('https://example.com/')) return;
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 20000);
  fetch(msg.url, {
    signal: ctl.signal,
    redirect: 'follow',
    credentials: 'omit',
    headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en,de;q=0.8,fr;q=0.7,it;q=0.6' }
  }).then(async r => {
    const ct = r.headers.get('content-type') || '';
    let t = '';
    if (/html|text|xml|json/i.test(ct) || !ct) t = (await r.text()).slice(0, 1500000);
    clearTimeout(to);
    send({ s: r.status, t, u: r.url, ct });
  }).catch(e => { clearTimeout(to); send({ s: 0, t: '', e: String(e) }); });
  return true;
});
