// Scoperta continua di pool (hub): non una lista fissa, ma un ciclo che cerca, testa e impara.
//  1. genera domande tipo + settore + luogo + anno (config/discovery.json), scegliendo più spesso
//     le combinazioni che hanno già portato hub utili e lasciando una quota di esplorazione;
//  2. cerca con Brave (poche ricerche a giro, tetto mensile dedicato);
//  3. segue gratis i link "pool" (eventi, programmi, partner) degli hub che rendono di più;
//  4. testa ogni pagina trovata: deve sembrare un pool (molti link a siti esterni + parole da pool);
//  5. aggiunge gli hub buoni in db_hub e registra ogni domanda in db_scoperta, con la sua resa.
// Uso: npm run discovery
import { readFileSync } from 'node:fs';
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { getPage } from '../../lib/http.js';
import { host, reg, bad, links, hubKey } from '../../lib/url.js';
import { now, today } from '../../lib/config.js';
import { webSearch, searchEnabled, searchStats, monthlyUsed, setMonthlyUsed } from '../../lib/search.js';
import { VCH, JUNKHUB } from '../../signals/patterns.js';
import { hubType } from '../hubs/classify.js';

const CFG = JSON.parse(readFileSync(new URL('../../../config/discovery.json', import.meta.url), 'utf8'));
const POOL_WORDS = /(startups?|teams?|finalists?|participants?|cohorts?|portfolio|alumni|exhibitors?|winners?|batch|residents?|founders|spin-?offs?|ventures|projects|laureates|fellows)/i;
const POOL_LINK = /(accelerat|incubat|hackathon|summit|festival|award|prize|challenge|competition|programme|program|fellowship|demo-?day|venture-?lab|startup-?week|bootcamp|launchpad|science-?park|innovation-?hub|spin-?off)/i;
const NOT_POOL = /(news|blog|article|press-release|jobs|careers|wikipedia|youtube|linkedin|facebook|instagram|x\.com|twitter|eventbrite\.[a-z]+\/e\/|crunchbase|dealroom|f6s|tracxn|medium\.com)/i;

/** Punteggio di una combinazione: media con prior (1 successo su 2 tentativi), così le nuove partono a 0,5. */
export const score = s => (s.utili + 1) / (s.nuovi + 2);

/** Sceglie n domande nuove: per lo più dalle combinazioni migliori, a volte a caso (esplorazione). */
export function pickQueries(used, stats, n, rnd = Math.random) {
  const all = [];
  for (const t of CFG.tipi) for (const s of CFG.settori) for (const l of CFG.luoghi) {
    const q = [s, t, l, CFG.anni[0]].filter(Boolean).join(' ');
    if (!used.has(q)) all.push({ q, t, s: s || '-', l });
  }
  const val = x => (score(stats.tipo[x.t] || { utili: 0, nuovi: 0 }) + score(stats.settore[x.s] || { utili: 0, nuovi: 0 }) + score(stats.luogo[x.l] || { utili: 0, nuovi: 0 })) / 3;
  const out = [];
  while (out.length < n && all.length) {
    let i;
    if (rnd() < CFG.esplorazione) i = Math.floor(rnd() * all.length);
    else { let best = -1; i = 0; all.forEach((x, k) => { const v = val(x) + rnd() * 0.01; if (v > best) { best = v; i = k; } }); }
    out.push(all.splice(i, 1)[0]);
  }
  return out;
}

/** Test: la pagina sembra un pool di startup? */
export function looksLikePool(url, md) {
  const own = reg(host(url));
  const ext = new Set();
  for (const [, l] of links(md)) { const h = host(l); if (h && reg(h) !== own && !bad(h)) ext.add(reg(h)); }
  const words = (String(md).match(new RegExp(POOL_WORDS.source, 'gi')) || []).length;
  const ok = ext.size >= 8 && words >= 3 && !VCH.test(url) && !JUNKHUB.test(url);
  return { ok, esterni: ext.size, parole: words };
}

async function testAndBuild(url, name, origine, pattern) {
  if (NOT_POOL.test(url) || bad(host(url))) return null;
  const r = await getPage(url, { jinaFallback: false });
  if (r.status !== 200 || !r.text) return null;
  const t = looksLikePool(url, r.text);
  if (!t.ok) return null;
  const title = (r.text.match(/^Title:\s*(.*)$/m) || [])[1] || name || host(url);
  return { hub_id: hubKey(url), nome: String(title).slice(0, 80), url, origine, tipo: hubType(title + ' ' + (pattern || ''), url), stato: 'attivo', priorita: '12', scoperto_il: today(), note: `test: ${t.esterni} siti esterni, ${t.parole} parole da pool` };
}

export async function run({ log = console.log } = {}) {
  const startedAt = now();
  const st = { domande: 0, risultati: 0, testati: 0, hub_nuovi: 0, da_link: 0 };
  const hubs = await read(TABS.hub, { columns: ['hub_id', 'nome', 'url', 'origine', 'candidati_trovati', 'candidati_da_valutare'] });
  const have = new Set(hubs.map(h => h.hub_id));
  const add = [];
  const keep = row => { if (row && row.hub_id && !have.has(row.hub_id)) { have.add(row.hub_id); add.push(row); return true; } return false; };

  // resa delle domande passate: hub nati da ogni domanda e quanti hanno dato startup da valutare
  const scop = await read('db_scoperta');
  const byQ = new Map(scop.map(s => [s.query, s]));
  const yieldOf = {};
  for (const h of hubs) { const m = String(h.origine).match(/^scoperta: (.+)$/); if (m) { const y = yieldOf[m[1]] = yieldOf[m[1]] || { nuovi: 0, utili: 0 }; y.nuovi++; if (+h.candidati_da_valutare > 0) y.utili++; } }
  const stats = { tipo: {}, settore: {}, luogo: {} };
  const updates = [];
  for (const s of scop) {
    const y = yieldOf[s.query] || { nuovi: 0, utili: 0 };
    for (const [k, v] of [['tipo', s.tipo], ['settore', s.settore], ['luogo', s.luogo]]) { const o = stats[k][v] = stats[k][v] || { nuovi: 0, utili: 0 }; o.nuovi += y.nuovi; o.utili += y.utili; }
    if (String(y.utili) !== String(s.hub_utili)) updates.push({ query: s.query, hub_utili: y.utili });
  }
  st.migliori_tipi = Object.entries(stats.tipo).sort((a, b) => score(b[1]) - score(a[1])).slice(0, 5).map(([k, v]) => `${k} ${v.utili}/${v.nuovi}`);

  // 1-2. domande su Brave, con tetto mensile dedicato alla scoperta
  if (searchEnabled()) {
    const logRows = await read(TABS.log, { columns: ['componente', 'inizio', 'statistiche'] });
    setMonthlyUsed(monthlyUsed(logRows));
    const usedForDiscovery = monthlyUsed(logRows.filter(r => r.componente === 'scoperta hub'));
    const budget = Math.max(0, Math.min(CFG.ricerche_per_giro, CFG.tetto_mensile_scoperta - usedForDiscovery));
    for (const p of pickQueries(new Set(byQ.keys()), stats, budget)) {
      const res = await webSearch(p.q, { count: 10 });
      st.domande++; st.risultati += res.length;
      let nuovi = 0;
      for (const x of res) { st.testati++; if (keep(await testAndBuild(x.url, x.title, `scoperta: ${p.q}`, p.t))) nuovi++; }
      st.hub_nuovi += nuovi;
      updates.push({ query: p.q, tipo: p.t, settore: p.s, luogo: p.l, usata_il: today(), risultati: res.length, hub_nuovi: nuovi, hub_utili: 0 });
      log(`"${p.q}": ${res.length} risultati, ${nuovi} hub nuovi`);
    }
  }

  // 3. gratis: link a eventi, programmi e partner dagli hub che rendono di più
  const best = hubs.filter(h => +h.candidati_da_valutare > 0).sort((a, b) => (+b.candidati_da_valutare) - (+a.candidati_da_valutare)).slice(0, 25);
  let checked = 0;
  for (const h of best) {
    if (checked >= CFG.link_da_hub_per_giro) break;
    const r = await getPage(h.url, { jinaFallback: false });
    if (r.status !== 200) continue;
    const own = reg(host(h.url));
    for (const [tx, l] of links(r.text)) {
      if (checked >= CFG.link_da_hub_per_giro) break;
      const hh = host(l); if (!hh || reg(hh) === own || !POOL_LINK.test(l + ' ' + tx)) continue;
      if (have.has(hubKey(l))) continue;
      checked++; st.testati++;
      if (keep(await testAndBuild(l, tx, `scoperta da hub: ${h.nome}`.slice(0, 120), tx))) st.da_link++;
    }
  }

  if (add.length) await upsert(TABS.hub, 'hub_id', add);
  if (updates.length) await upsert('db_scoperta', 'query', updates);
  st.ricerche_brave = searchStats.ricerche;
  await logRun('scoperta hub', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('uncaughtException', e => console.error('errore imprevisto ignorato:', e?.message || e));
  run().catch(e => { console.error(e); process.exit(1); });
}
