// Aggiunge a mano uno o più hub in db_hub (stato attivo, priorità alta): li legge il crawler startup al giro dopo.
// Uso: HUB_URLS="https://a/,https://b/" HUB_NOMI="A,B" node tools/aggiungi-hub.js
import { read, upsert, TABS } from '../src/lib/sheet.js';
import { hubKey } from '../src/lib/url.js';
import { today } from '../src/lib/config.js';
const urls = String(process.env.HUB_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
const nomi = String(process.env.HUB_NOMI || '').split(',').map(s => s.trim());
const have = new Set((await read(TABS.hub, { columns: ['hub_id'] })).map(h => h.hub_id));
const rows = urls.map((url, i) => ({ hub_id: hubKey(url), nome: nomi[i] || new URL(url).hostname, url, origine: 'manuale', tipo: 'altro', stato: 'attivo', priorita: '20', scoperto_il: today(), note: 'aggiunto a mano da Alex' }))
  .filter(r => r.hub_id);
const nuovi = rows.filter(r => !have.has(r.hub_id));
// se c'era già, lo si rimette attivo e in cima, senza toccare le statistiche
const gia = rows.filter(r => have.has(r.hub_id)).map(r => ({ hub_id: r.hub_id, stato: 'attivo', priorita: '20', ultimo_crawl: '' }));
if (nuovi.length || gia.length) await upsert(TABS.hub, 'hub_id', [...nuovi, ...gia]);
console.log(`hub aggiunti ${nuovi.length}, già presenti rimessi in cima ${gia.length}: ${rows.map(r => r.hub_id).join(', ')}`);
