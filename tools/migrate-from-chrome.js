// Migrazione una tantum dalla v1 (Chrome) al foglio-database.
// Da incollare nella console della vecchia scheda "Apeira crawler" (https://example.com/),
// dove vivono IndexedDB apeira_crawler e localStorage apeira_hubs.
// Chiede URL e token della web app e scrive db_hub e db_candidati a blocchi.
//
// Cosa porta:
//  - tutti gli hub (con il loro nome, così hub_origine dei candidati resta collegato);
//    ultimo_crawl resta vuoto, quindi la v2 li rilegge tutti al primo giro;
//  - i candidati già controllati: target/maybe -> da_valutare, reject/old -> scartata, dead -> sito_morto.
//    Quelli mai controllati (new, young, border, nordap) non vengono portati: la v2 li ritrova rileggendo gli hub.
(async () => {
  const API = prompt('URL della web app (finisce con /exec)');
  const TOKEN = prompt('Token API');
  if (!API || !TOKEN) return console.log('annullato');

  const call = async (action, payload) => {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: TOKEN, action, ...payload }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j;
  };
  const upsertAll = async (tab, key, rows, n = 300) => {
    for (let i = 0; i < rows.length; i += n) {
      await call('upsert', { tab, key, rows: rows.slice(i, i + n) });
      console.log(tab, Math.min(i + n, rows.length), '/', rows.length);
    }
  };

  const S = await new Promise((res, rej) => {
    const o = indexedDB.open('apeira_crawler');
    o.onsuccess = () => { const g = o.result.transaction('kv', 'readonly').objectStore('kv').get('state'); g.onsuccess = () => res(JSON.parse(g.result)); g.onerror = rej; };
    o.onerror = rej;
  });

  // ---- hub
  const VCH = /(htgf|gr[uü]nderfonds|\/portfolio|quantonation|seedcamp|speedinvest|antler|entrepreneur first|joinef|balderton|atomico|lakestar|earlybird|nato diana|ventures?|capital|\bvc\b|partners|\bfund|invest|^VC: )/i;
  const JUNK = /(saashub|producthunt|betalist|crunchbase|f6s\.com|wellfound|dealroom|reuters|nature\.com|prnewswire)/i;
  const hubKey = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\d?\./, '') + x.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return ''; } };
  const origine = n => /^AUTO: /.test(n) ? 'snowball (v1)' : /^NEW: /.test(n) ? 'rete o nuovo (v1)' : /^SM: /.test(n) ? 'sitemap (v1)' : 'v1';
  const tipo = t => /(spin-?off|spinout|transfer)/i.test(t) ? 'spin-off' : /(award|prize|challenge|competition|hackathon)/i.test(t) ? 'competizione' : /(incubat|science ?park|technopark|bic\b)/i.test(t) ? 'incubatore' : /(accelerat|programme|program|fellowship|pioneer|kick|venture ?lab|exist)/i.test(t) ? 'programma' : 'altro';
  const team = ts => !ts ? '' : ts.e ? ts.e + ' (dichiarato sul sito)' : (ts.li || []).length >= 2 ? ts.li.length + ' (profili LinkedIn sulla pagina team)' : ts.r >= 2 ? '~' + Math.max(1, Math.round(ts.r / 1.6)) + ' (ruoli elencati sul sito)' : 'n.d.';
  const hubs = JSON.parse(localStorage.getItem('apeira_hubs') || '[]').concat(S.xh || []);
  const seen = new Set(), hubRows = [];
  for (const h of hubs) {
    const id = hubKey(h.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const lab = h.name + ' ' + h.url;
    hubRows.push({ hub_id: id, nome: h.name, url: h.url, origine: origine(h.name), tipo: tipo(lab), stato: VCH.test(lab) ? 'escluso_vc' : JUNK.test(lab) ? 'escluso_junk' : 'attivo', priorita: /^(NEW|AUTO): /.test(h.name) ? '6' : '0', scoperto_il: new Date().toISOString().slice(0, 10), note: 'migrato dalla v1' });
  }

  // ---- candidati
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const why = c => c.corp ? 'azienda grande o vecchia (v1)' : c.inv ? 'investitore o acceleratore (v1)' : c.vcp ? 'trovata solo in portfolio di VC (v1)' : c.junk ? 'trovata solo in directory generiche (v1)'
    : c.oldwb ? 'online prima del 2022 (archive.org, v1)' : c.fl >= 2 ? 'round già chiuso: ' + (c.fx || '') : c.st === 'old' ? 'dominio registrato nel ' + String(c.cr || '').slice(0, 4) : 'scartata dalla v1';
  const MAP = { target: 'da_valutare', maybe: 'da_valutare', reject: 'scartata', old: 'scartata', dead: 'sito_morto' };
  const rows = [];
  for (const c of Object.values(S.cands)) {
    const stato = MAP[c.st];
    if (!stato) continue;
    const full = stato === 'da_valutare';
    const ev = full ? {
      v: 1, deep: c.deep || 0, strong: c.strong || 0, neg: c.neg || 0, tags: c.tags || [],
      anni_dichiarati: [...new Set([...(c.yrs || []), ...((c.evd || {}).fy || [])])].filter(y => y >= 2010 && y <= 2026),
      cmin: c.cmin || null, eu: !!c.eu, fund: { l: c.fl || 0, x: String(c.fx || '').split(', ').filter(Boolean) },
      fa: c.fa || null, ts: c.ts || null, evd: c.evd || null, dem: [], estratto_home: c.desc || '', estratto_team: '',
    } : null;
    rows.push({
      dominio: c.d, nome: (c.n || c.d).slice(0, 60), sito: c.u, hub_origine: (c.hubs || []).join(', '),
      primo_visto: now, ultimo_check: now, stato_crawler: stato, motivo: full ? (c.st === 'maybe' ? 'età non confermata (v1)' : '') : why(c),
      dominio_registrato: c.cr || '', primo_archivio: c.wbFirst || '', anni_sul_sito: (c.yrs || []).join(', '), settori: (c.tags || []).join(', '),
      punteggio_deep: full ? (c.deep || 0) - (c.neg || 0) : '', europa: full ? (c.eu ? 'sì' : 'non trovato') : '', segnali_funding: c.fx || '',
      email: (c.em || []).join(', '), linkedin_azienda: (c.lco || []).join(', '), linkedin_persone: (c.lin || []).concat(c.lf || []).join(', '),
      founder_nomi: (c.fn || []).join(', '), team_stima: team(c.ts), descrizione: (c.desc || c.ycDesc || '').slice(0, 300), domanda_reale: '',
      evidenze: ev ? JSON.stringify(ev) : '', pagine_lette: c.u, versione_crawler: '1 (migrata)',
    });
  }
  console.log('hub', hubRows.length, 'candidati', rows.length);
  await upsertAll('db_hub', 'hub_id', hubRows);
  await upsertAll('db_candidati', 'dominio', rows);
  console.log('migrazione finita');
})();
