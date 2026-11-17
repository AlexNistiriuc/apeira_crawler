// Crawler degli hub. Non cerca startup: tiene aggiornata la lista delle fonti in db_hub.
//  1. semi e directory da config/sources.json
//  2. reti di incubatori (EBN, UKSPA...) -> ogni membro diventa un hub
//  3. snowball dai candidati da valutare -> incubatori e programmi che citano
// Avvio: npm run hubs
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { hubKey } from '../../lib/url.js';
import { SOURCES, deadlineFromNow, now, today } from '../../lib/config.js';
import { pool } from '../../lib/pool.js';
import { STATO } from '../../signals/prefilter.js';
import { newHubRow } from './classify.js';
import { mineNetwork } from './networks.js';
import { hubsCitedBy } from './snowball.js';

const NETWORK_EVERY_DAYS = Number(process.env.NETWORK_EVERY_DAYS || 30);
const SNOWBALL_MAX = Number(process.env.SNOWBALL_MAX || 300);

export async function run({ deadline = deadlineFromNow(), log = console.log } = {}) {
  const startedAt = now();
  const st = { semi: 0, da_reti: 0, da_snowball: 0, reti_lette: 0, candidati_snowball: 0, errori: [] };
  const existing = new Map((await read(TABS.hub)).map(h => [h.hub_id, h]));
  const byDomain = new Set([...existing.values()].map(h => String(h.hub_id).split('/')[0]));
  const fresh = [];
  const add = (row, counter) => {
    const dom = row.hub_id.split('/')[0];
    if (!row.hub_id || existing.has(row.hub_id) || byDomain.has(dom)) return;
    existing.set(row.hub_id, row); byDomain.add(dom); fresh.push(row); st[counter]++;
  };

  for (const s of SOURCES.seed_hubs) add(newHubRow({ name: s.name, url: s.url, origine: 'seme' }), 'semi');
  for (const d of SOURCES.directories) add(newHubRow({ name: d.name, url: d.url, origine: 'directory', tipo: 'directory', note: 'adattatore ' + d.adapter }), 'semi');

  // reti di incubatori: una riga tipo=rete per ogni rete, riletta ogni NETWORK_EVERY_DAYS giorni
  const cutoff = new Date(Date.now() - NETWORK_EVERY_DAYS * 864e5).toISOString().slice(0, 10);
  const netUpdates = [];
  for (const n of SOURCES.networks) {
    if (Date.now() > deadline) break;
    const id = hubKey(n.sitemap);
    const row = existing.get(id);
    if (row && row.ultimo_crawl && String(row.ultimo_crawl).slice(0, 10) >= cutoff) continue;
    const r = await mineNetwork(n.sitemap, n.label);
    st.reti_lette++;
    if (r.error) st.errori.push(`${n.label}: ${r.error}`);
    log(`rete ${n.label}: ${r.pages} pagine membro, ${r.members.length} membri con sito`);
    for (const m of r.members) add(newHubRow({ name: m.name, url: m.url, origine: 'rete: ' + n.label }), 'da_reti');
    netUpdates.push({ hub_id: id, nome: 'Rete ' + n.label, url: n.sitemap, origine: 'rete', tipo: 'rete', stato: r.error ? 'irraggiungibile' : 'attivo', scoperto_il: row?.scoperto_il || today(), ultimo_crawl: now(), pagine_lette: r.pages, candidati_trovati: r.members.length, note: n.nota || '' });
  }

  // snowball dai candidati da valutare non ancora usati
  const cands = (await read(TABS.cand, { columns: ['dominio', 'sito', 'stato_crawler', 'snowball_il'] }))
    .filter(c => c.stato_crawler === STATO.DA_VALUTARE && !c.snowball_il).slice(0, SNOWBALL_MAX);
  const done = [];
  await pool(cands, 6, async c => {
    for (const h of await hubsCitedBy(c.sito)) add(newHubRow({ name: h.name, url: h.url, origine: 'snowball: ' + c.dominio }), 'da_snowball');
    done.push({ dominio: c.dominio, snowball_il: today() });
  }, { deadline });
  st.candidati_snowball = done.length;

  if (fresh.length) await upsert(TABS.hub, 'hub_id', fresh);
  if (netUpdates.length) await upsert(TABS.hub, 'hub_id', netUpdates);
  if (done.length) await upsert(TABS.cand, 'dominio', done);
  await logRun('crawler hub', startedAt, st);
  log('fine run', JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch(e => { console.error(e); process.exit(1); });
