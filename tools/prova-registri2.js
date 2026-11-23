// Prova in sola lettura di altri registri europei: Finlandia (PRH), Italia (startup innovative), Estonia, Lettonia. Solo conteggi e intestazioni.
const show = async (tag, url, opt = {}) => {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json, text/csv, */*' }, ...opt, signal: AbortSignal.timeout(30000) });
    const ct = r.headers.get('content-type') || '', len = r.headers.get('content-length') || '?';
    let head = '';
    if (!opt.method || opt.method === 'GET') { const reader = r.body.getReader(); const { value } = await reader.read(); head = new TextDecoder().decode(value || new Uint8Array()).slice(0, 400).replace(/\s+/g, ' '); reader.cancel(); }
    console.log(tag, r.status, ct, 'bytes', len, '|', head);
  } catch (e) { console.log(tag, 'errore', e.message); }
};
await show('FI1', 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies?registrationDateStart=2025-01-01&mainBusinessLine=72');
await show('FI2', 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies?registrationDateStart=2025-06-01&mainBusinessLine=72110');
await show('IT1', 'https://startup.registroimprese.it/isin/report?fileId=startup.zip', { method: 'HEAD' });
await show('IT2', 'https://startup.registroimprese.it/isin/static/startup/index.html?slideJump=33');
await show('EE1', 'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip', { method: 'HEAD' });
await show('EE2', 'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__kaardile_kantud_isikud.json.zip', { method: 'HEAD' });
await show('LV1', 'https://dati.ur.gov.lv/register/register.csv');
await show('LV2', 'https://dati.ur.gov.lv/officers/officers.csv');
await show('LV3', 'https://data.gov.lv/dati/api/3/action/package_search?q=amatpersonas');
await show('DK1', 'https://cvrapi.dk/api?search=robot&country=dk');
await show('BE1', 'https://kbopub.economie.fgov.be/kbo-open-data/login');
await show('CH1', 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1/company/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name: 'robot', activeOnly: true }) });
