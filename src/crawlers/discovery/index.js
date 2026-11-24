// Scoperta continua di pool (hub): non una lista fissa, ma un ciclo che cerca, testa e impara.
//  1. domande a livelli (config/discovery.json): 0 liste di liste, 1 tipo + paese, poi 2 settore + tipo + paese
//     e 3 settore + tipo + città solo dove i pattern hanno già reso; sceglie le combinazioni migliori,
//     con una quota di esplorazione;
//  2. cerca con Brave (poche ricerche a giro, tetto mensile dedicato);
//  3. testa ogni risultato: pool forte -> attivo, pool probabile -> da_verificare (il crawler startup
//     lo legge e, se non rende, lo mette senza_resa); pagine-lista -> estrae e testa ogni pool elencato;
//  4. snowball dagli hub che rendono: link esterni a programmi, eventi, partner, anche dalle loro pagine
//     "partners / network / events / programmes", ogni hub al massimo una volta ogni 14 giorni;
//  5. registra ogni domanda in db_scoperta con livello e resa.
// Uso: npm run discovery
import { readFileSync, appendFileSync } from 'node:fs';
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { getPage } from '../../lib/http.js';
import { host, reg, bad, links, hubKey } from '../../lib/url.js';
import { now, today } from '../../lib/config.js';
import { webSearch, searchEnabled, searchStats, monthlyUsed, setMonthlyUsed, searchLog, provider, sgCredits, creditsPaused } from '../../lib/search.js';
import { VCH, JUNKHUB, HUB_OFFTOPIC, HUB_NONEU, STARTUP_ECO } from '../../signals/patterns.js';
import { hubType } from '../hubs/classify.js';

const CFG = JSON.parse(readFileSync(new URL('../../../config/discovery.json', import.meta.url), 'utf8'));
const POOL_WORDS = /(startups?|teams?|finalists?|participants?|cohorts?|portfolio|alumni|exhibitors?|winners?|batch|residents?|founders|spin-?offs?|ventures|projects|laureates|fellows)/i;
const POOL_LINK = /(accelerat|incubat|hackathon|summit|festival|award|prize|challenge|competition|programme|program|fellowship|demo-?day|venture-?lab|startup-?week|bootcamp|launchpad|science-?park|innovation-?hub|spin-?off|startup)/i;
const LIST_PAGE = /(\blist\b|\btop ?\d+|\bbest\b|directory|database|calendar|overview|ranking|guide to|\bmap of\b|\d+ (startup|accelerator|incubator|hackathon|event|competition)s)/i;
const HUB_SUBPAGE = /(partner|network|ecosystem|events?|programs?|programmes?|community|friends|initiatives|collaborations?)/i;
const NOT_POOL = /(news|blog|article|press-release|jobs|careers|wikipedia|youtube|linkedin|facebook|instagram|x\.com|twitter|eventbrite\.[a-z]+\/e\/|crunchbase|dealroom|f6s|tracxn|medium\.com|reddit|quora)/i;

export const score = s => (s.utili + 1) / (s.nuovi + 2);
const plural = t => (/s$/.test(t) ? t : t + 's');
const get = (m, k) => m[k] || { utili: 0, nuovi: 0 };

/** Tutte le domande possibili, a livelli; i livelli 2-3 solo dove il tipo (e il settore) hanno reso. */
export function candidates(used, stats) {
  const anno = CFG.anni[0], out = [];
  const push = (q, t, s, l, livello) => { if (!used.has(q)) out.push({ q, t, s, l, livello }); };
  for (const t of CFG.tipi) for (const p of CFG.paesi) {
    for (const m of CFG.modelli_liste) push(m.replace('{tipi}', plural(t)).replace('{tipo}', t).replace('{paese}', p).replace('{anno}', anno), t, '-', p, 0);
    push(`${t} ${p} ${anno}`, t, '-', p, 1);
  }
  for (const t of CFG.tipi) {
    if (get(stats.tipo, t).utili < 1) continue;                       // livello 2 solo per tipi che rendono
    for (const s of CFG.settori.filter(Boolean)) {
      for (const p of CFG.paesi) push(`${s} ${t} ${p}`, t, s, p, 2);
      // livello 3 (settore + tipo + città + anno) spento dal 23 nov 2026: rendeva pochissimo per credito speso
      if ((CFG.livello_massimo ?? 2) < 3 || get(stats.coppia, `${t}|${s}`).utili < 1) continue;
      for (const c of CFG.citta) push(`${s} ${t} ${c} ${anno}`, t, s, c, 3);
    }
  }
  return out;
}

/** Sceglie n domande: per lo più le migliori (livelli alti solo se sbloccati), a volte a caso. */
export function pickQueries(used, stats, n, rnd = Math.random) {
  const all = candidates(used, stats);
  const val = x => (score(get(stats.tipo, x.t)) + score(get(stats.settore, x.s)) + score(get(stats.luogo, x.l))) / 3 + (x.livello >= 2 ? 0.1 : 0);
  const out = [];
  while (out.length < n && all.length) {
    let i = 0;
    if (rnd() < CFG.esplorazione) i = Math.floor(rnd() * all.length);
    else { let best = -1; all.forEach((x, k) => { const v = val(x) + rnd() * 0.01; if (v > best) { best = v; i = k; } }); }
    out.push(all.splice(i, 1)[0]);
  }
  return out;
}

/** Hub fuori tema (SEO, marketing, agenzie, software house...) o che non parla di startup: non si aggiunge. */
export function offTopicHub(url, title, md = '') {
  if (HUB_OFFTOPIC.test(`${title} ${url}`)) return 'fuori tema: ' + (`${title} ${url}`.match(HUB_OFFTOPIC) || [''])[0].toLowerCase();
  if (HUB_NONEU.test(`${title} ${url}`)) return 'fuori Europa: ' + (`${title} ${url}`.match(HUB_NONEU) || [''])[0].toLowerCase();
  if (md && (String(md).match(STARTUP_ECO) || []).length < 2) return 'non parla di startup';
  return '';
}

/** Test: forte -> attivo, leggero -> da_verificare, altrimenti no. */
export function looksLikePool(url, md, title = '') {
  if (offTopicHub(url, title, md)) return { ok: false, stato: null, esterni: 0, parole: 0, fuori_tema: true };
  const own = reg(host(url));
  const ext = new Set();
  for (const [, l] of links(md)) { const h = host(l); if (h && reg(h) !== own && !bad(h)) ext.add(reg(h)); }
  const words = (String(md).match(new RegExp(POOL_WORDS.source, 'gi')) || []).length;
  const blocked = VCH.test(url) || JUNKHUB.test(url);
  const stato = blocked ? null : ext.size >= 8 && words >= 3 ? 'attivo' : ext.size >= 5 && words >= 2 ? 'da_verificare' : null;
  return { ok: !!stato, stato, esterni: ext.size, parole: words };
}

/** Link a possibili pool elencati in una pagina (pagine-lista, partner, eventi). */
export function poolLinks(url, md, all = false) {
  const own = reg(host(url)), out = new Map();
  for (const [tx, l] of links(md)) {
    const h = host(l);
    if (!h || reg(h) === own || bad(h) || NOT_POOL.test(l)) continue;
    if (!all && !POOL_LINK.test(l + ' ' + tx)) continue;
    const k = hubKey(l); if (k && !out.has(k)) out.set(k, { url: l, nome: tx });
  }
  return [...out.values()];
}

export async function run({ log = console.log, deadline = Date.now() + CFG.minuti_per_giro * 60_000 } = {}) {
  const startedAt = now();
  const st = { domande: 0, risultati: 0, testati: 0, hub_nuovi: 0, da_verificare: 0, da_liste: 0, da_hub: 0 };
  const hubs = await read(TABS.hub, { columns: ['hub_id', 'nome', 'url', 'origine', 'stato', 'candidati_trovati', 'candidati_da_valutare', 'scoperta_il', 'ultimo_crawl'] });
  const have = new Set(hubs.map(h => h.hub_id));
  const add = [];
  let tests = 0;
  const canTest = () => tests < CFG.test_per_giro && Date.now() < deadline;

  /** Legge una pagina, la testa come pool e, se è una lista, testa anche i pool elencati. */
  async function test(url, name, origine, hint, depth = 0) {
    const id = hubKey(url);
    if (!id || have.has(id) || NOT_POOL.test(url) || bad(host(url)) || !canTest()) return 0;
    tests++; st.testati++;
    const r = await getPage(url, { jinaFallback: false });
    if (r.status !== 200 || !r.text) return 0;
    const title = (r.text.match(/^Title:\s*(.*)$/m) || [])[1] || name || host(url);
    let found = 0;
    const t = looksLikePool(url, r.text, title);
    if (t.fuori_tema) st.fuori_tema = (st.fuori_tema || 0) + 1;
    if (t.ok) {
      have.add(id); found++;
      add.push({ hub_id: id, nome: String(title).slice(0, 80), url, origine, tipo: hubType(title + ' ' + (hint || ''), url), stato: t.stato, priorita: t.stato === 'attivo' ? '12' : '8', scoperto_il: today(), note: `test: ${t.esterni} siti esterni, ${t.parole} parole da pool` });
      if (t.stato === 'da_verificare') st.da_verificare++;
    }
    // pagina-lista: ogni pool elencato è un candidato (un livello solo, per non allargarsi all'infinito)
    if (depth === 0 && (LIST_PAGE.test(title + ' ' + url) || poolLinks(url, r.text).length >= 6)) {
      for (const p of poolLinks(url, r.text, LIST_PAGE.test(title)).slice(0, CFG.link_da_lista)) {
        const n = await test(p.url, p.nome, `${origine} (da lista)`, hint, 1);
        found += n; st.da_liste += n;
      }
    }
    return found;
  }

  // resa delle domande passate (hub nati da ogni domanda e quanti hanno dato startup da valutare)
  const scop = await read('db_scoperta');
  const byQ = new Map(scop.map(s => [s.query, s]));
  const yieldOf = {};
  for (const h of hubs) { const m = String(h.origine).match(/^scoperta: (.+?)( \(da lista\))?$/); if (m) { const y = yieldOf[m[1]] = yieldOf[m[1]] || { nuovi: 0, utili: 0 }; y.nuovi++; if (+h.candidati_da_valutare > 0) y.utili++; } }
  const stats = { tipo: {}, settore: {}, luogo: {}, coppia: {} };
  const updates = [];
  for (const s of scop) {
    if (s.tipo === 'registro') continue;   // società lette dalla scoperta da registro, non domande
    const y = yieldOf[s.query] || { nuovi: 0, utili: 0 };
    for (const [k, v] of [['tipo', s.tipo], ['settore', s.settore], ['luogo', s.luogo], ['coppia', `${s.tipo}|${s.settore}`]]) { const o = stats[k][v] = stats[k][v] || { nuovi: 0, utili: 0 }; o.nuovi += y.nuovi; o.utili += y.utili; }
    if (String(y.utili) !== String(s.hub_utili) || String(y.nuovi) !== String(s.hub_nuovi)) updates.push({ query: s.query, hub_nuovi: y.nuovi, hub_utili: y.utili });
  }
  st.migliori_tipi = Object.entries(stats.tipo).sort((a, b) => score(b[1]) - score(a[1])).slice(0, 5).map(([k, v]) => `${k} ${v.utili}/${v.nuovi}`);

  // 1-3. domande su Brave, con tetto mensile dedicato
  if (searchEnabled()) {
    const logRows = await read(TABS.log, { columns: ['componente', 'inizio', 'statistiche'] });
    setMonthlyUsed(monthlyUsed(logRows));
    const usedForDiscovery = monthlyUsed(logRows.filter(r => r.componente === 'scoperta hub'));
    // con ScrapeGraph nessun tetto mensile (si va finché ci sono crediti); con Brave il tetto dedicato alla scoperta
    let budget = creditsPaused() ? 0 : provider() === 'scrapegraph' ? CFG.ricerche_per_giro : Math.max(0, Math.min(CFG.ricerche_per_giro, CFG.tetto_mensile_scoperta - usedForDiscovery));
    // il crawler startup ha già tanti hub mai letti: niente ricerche nuove finché non li smaltisce (crediti risparmiati)
    const unread = hubs.filter(h => /^(attivo|da_verificare)$/.test(h.stato) && !h.ultimo_crawl).length;
    if (unread > (CFG.pausa_se_hub_da_leggere ?? 80)) { budget = 0; st.pausa = `${unread} hub ancora da leggere`; }
    // riserva per i valutatori: sotto questa soglia la scoperta non usa più crediti
    if (creditsPaused()) st.pausa = 'crediti in pausa (config/crediti.json)';
    if (budget && provider() === 'scrapegraph') { const cr = await sgCredits(); if (cr != null && cr < (CFG.riserva_crediti_valutatori ?? 5000)) { budget = 0; st.pausa = `crediti sotto la riserva per i valutatori (${cr})`; } }
    for (const p of pickQueries(new Set(byQ.keys()), stats, budget)) {
      const res = await webSearch(p.q, { count: 10 });
      st.domande++; st.risultati += res.length;
      let nuovi = 0;
      for (const x of res) nuovi += await test(x.url, x.title, `scoperta: ${p.q}`, p.t);
      st.hub_nuovi += nuovi;
      updates.push({ query: p.q, tipo: p.t, settore: p.s, luogo: p.l, livello: p.livello, usata_il: today(), risultati: res.length, hub_nuovi: nuovi, hub_utili: 0 });
      log(`[livello ${p.livello}] "${p.q}": ${res.length} risultati, ${nuovi} hub nuovi`);
    }
  }

  // 4. snowball dagli hub che rendono: link esterni a pool, anche dalle pagine partner/eventi/programmi
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const best = hubs.filter(h => +h.candidati_da_valutare > 0 && !(String(h.scoperta_il || '') >= cutoff))
    .sort((a, b) => (+b.candidati_da_valutare) - (+a.candidati_da_valutare)).slice(0, 5);
  const explored = [];
  for (const h of best) {
    if (!canTest()) break;
    explored.push({ hub_id: h.hub_id, scoperta_il: today() });
    const home = await getPage(h.url, { jinaFallback: false });
    if (home.status !== 200) continue;
    const own = reg(host(h.url));
    const pages = [home.text];
    const subs = [...new Set(links(home.text).filter(([tx, l]) => { const hh = host(l); return hh && reg(hh) === own && HUB_SUBPAGE.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx); }).map(([, l]) => l.replace(/#.*$/, '')))].slice(0, 2);
    for (const u of subs) { const r = await getPage(u, { jinaFallback: false }); if (r.status === 200) pages.push(r.text); }
    const origine = `scoperta da hub: ${h.nome}`.slice(0, 120);
    for (const md of pages) for (const p of poolLinks(h.url, md)) { if (!canTest()) break; st.da_hub += await test(p.url, p.nome, origine, p.nome, 1); }
  }

  if (add.length) await upsert(TABS.hub, 'hub_id', add);
  if (explored.length) await upsert(TABS.hub, 'hub_id', explored);
  if (updates.length) await upsert('db_scoperta', 'query', updates);
  st.hub_aggiunti = add.length;
  Object.assign(st, searchLog());
  const cr = await sgCredits(); if (cr != null) st.crediti_scrapegraph_rimasti = cr;
  await logRun('scoperta hub', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('uncaughtException', e => console.error('errore imprevisto ignorato:', e?.message || e));
  run().then(st => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `hub_nuovi=${st.hub_aggiunti}\n`);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
