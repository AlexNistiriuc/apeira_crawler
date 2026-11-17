// Ponte tra la pagina example.com e il service worker dell'estensione.
document.documentElement.setAttribute('data-apeira-proxy', '1');
window.addEventListener('message', e => {
  if (e.source !== window || !e.data || !e.data.apeiraReq) return;
  const { id, url } = e.data.apeiraReq;
  try {
    chrome.runtime.sendMessage({ t: 'fetch', url }, res => {
      window.postMessage({ apeiraRes: Object.assign({ id }, res || { s: 0, t: '' }) }, '*');
    });
  } catch (err) {
    window.postMessage({ apeiraRes: { id, s: 0, t: '', e: String(err) } }, '*');
  }
});
