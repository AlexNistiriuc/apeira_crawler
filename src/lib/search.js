// Ricerca web per i crawler: ScrapeGraph se c'è SCRAPEGRAPH_API_KEY (scelta di Alex, 22 nov 2026), altrimenti Brave.
// ScrapeGraph (v2 /api/search) restituisce le pagine trovate col loro contenuto: se ne tiene un estratto come snippet.
// Le pagine di linkedin.com si escludono dalla ricerca e dai risultati: non si leggono pagine di LinkedIn.
// Con ScrapeGraph non c'è tetto mensile: si va finché ci sono crediti (alla prima risposta 402 si smette per il giro).
// Costa circa 5 $ ogni 1.000 ricerche, con 5 $ di credito gratuito al mese (circa 1.000 ricerche).
// Senza SEARCH_API_KEY restituisce sempre [] e chi la usa va avanti senza.
// Limite del piano: 1 richiesta al secondo; SEARCH_MAX_PER_RUN tetto di sicurezza per giro.
import { sleep } from './http.js';

const ENDPOINT = process.env.SEARCH_ENDPOINT || 'https://api.search.brave.com/res/v1/web/search';
const GAP_MS = Number(process.env.SEARCH_GAP_MS || 1100);
const MAX_PER_RUN = Number(process.env.SEARCH_MAX_PER_RUN || 400);
// Tetto mensile: il credito gratuito Brave copre circa 1.000 ricerche al mese. Superato il tetto si
// smette di cercare fino al mese dopo (Sage lavora col solo sito). Il conteggio viene da db_log.
const MONTH_CAP = Number(process.env.SEARCH_MONTH_CAP || 950);
let usedThisMonth = 0;

/** Ricerche del giro per provider, da scrivere in db_log (ricerche_brave conta per il tetto mensile di Brave). */
export function searchLog() {
  return provider() === 'scrapegraph' ? { ricerche_scrapegraph: searchStats.ricerche, ricerche_brave: 0 } : { ricerche_brave: searchStats.ricerche };
}

/** Somma le ricerche Brave del mese corrente registrate in db_log (campo ricerche_brave di ogni giro). */
export function monthlyUsed(logRows, month = new Date().toISOString().slice(0, 7)) {
  let n = 0;
  for (const r of logRows) {
    if (!String(r.inizio || '').startsWith(month)) continue;
    try { n += Number(JSON.parse(r.statistiche || '{}').ricerche_brave) || 0; } catch {}
  }
  return n;
}
/** Da chiamare a inizio giro con le righe di db_log. */
export function setMonthlyUsed(n) { usedThisMonth = n; searchStats.gia_usate_nel_mese = n; }

let chain = Promise.resolve(), last = 0;
export const searchStats = { ricerche: 0, errori: 0, saltate_tetto: 0, gia_usate_nel_mese: 0 };
let impl = (...a) => fetch(...a);
/** Solo per i test. */
export function setSearchFetch(fn) { impl = fn; }

export const provider = () => (process.env.SCRAPEGRAPH_API_KEY ? 'scrapegraph' : process.env.SEARCH_API_KEY ? 'brave' : '');
export const searchEnabled = () => Boolean(provider());
const SG_ENDPOINT = process.env.SCRAPEGRAPH_ENDPOINT || 'https://v2-api.scrapegraphai.com/api/search';
const SG_RESULTS = Number(process.env.SCRAPEGRAPH_RESULTS || 5);
let sgOut = false;   // crediti finiti: niente altre chiamate in questo giro

/** Estratto leggibile dal markdown di una pagina: niente link, immagini e menu; le frasi con le parole cercate prima. */
export function snippetOf(md, q, n = 1500) {
  const t = String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>`|]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = String(q || '').toLowerCase().replace(/"/g, '').split(/\s+|\bor\b/).filter(w => w.length >= 4 && !/^(site|and|the)/.test(w));
  const sents = t.split(/(?<=[.!?])\s+/);
  const hit = sents.filter(x => words.some(w => x.toLowerCase().includes(w)));
  const out = [...new Set([...hit, ...sents])].join(' ');
  return out.slice(0, n);
}

async function sgSearch(q, count) {
  if (sgOut) { searchStats.saltate_tetto++; return []; }
  searchStats.ricerche++;
  searchStats.scrapegraph = (searchStats.scrapegraph || 0) + 1;
  try {
    const r = await impl(SG_ENDPOINT, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', 'SGAI-APIKEY': process.env.SCRAPEGRAPH_API_KEY },
      body: JSON.stringify({ query: `${q} -site:linkedin.com`, numResults: Math.min(count, SG_RESULTS), format: 'markdown' }),
    });
    if (r.status === 402 || r.status === 403) { sgOut = true; searchStats.crediti_finiti = true; searchStats.errori++; return []; }
    if (!r.ok) { searchStats.errori++; return []; }
    const j = await r.json();
    return (j?.results || j?.data?.results || []).filter(x => !/linkedin\.com/i.test(String(x.url || '')))
      .map(x => ({ title: String(x.title || ''), url: String(x.url || ''), snippet: snippetOf(x.content || x.markdown || '', q) }));
  } catch { searchStats.errori++; return []; }
}

/** @returns {Promise<Array<{title:string,url:string,snippet:string}>>} */
export async function webSearch(q, { count = 8 } = {}) {
  if (provider() === 'scrapegraph') {
    if (searchStats.ricerche >= MAX_PER_RUN) { searchStats.saltate_tetto++; return []; }
    return sgSearch(q, count);
  }
  const key = process.env.SEARCH_API_KEY;
  if (!key) return [];
  if (searchStats.ricerche >= MAX_PER_RUN || usedThisMonth + searchStats.ricerche >= MONTH_CAP) { searchStats.saltate_tetto++; return []; }
  const slot = chain.then(async () => { const w = last + GAP_MS - Date.now(); if (w > 0) await sleep(w); last = Date.now(); });
  chain = slot.catch(() => {});
  await slot;
  searchStats.ricerche++;
  try {
    const r = await impl(`${ENDPOINT}?q=${encodeURIComponent(q)}&count=${count}&extra_snippets=true`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { searchStats.errori++; return []; }
    const j = await r.json();
    return (j?.web?.results || []).map(x => ({
      title: String(x.title || ''), url: String(x.url || ''),
      snippet: [x.description, ...(x.extra_snippets || [])].filter(Boolean).join(' … ').replace(/<[^>]+>/g, ''),
    }));
  } catch { searchStats.errori++; return []; }
}
