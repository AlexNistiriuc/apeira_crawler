// Ricerca web per i crawler (non per Sage): Brave Search API.
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

export const searchEnabled = () => Boolean(process.env.SEARCH_API_KEY);

/** @returns {Promise<Array<{title:string,url:string,snippet:string}>>} */
export async function webSearch(q, { count = 8 } = {}) {
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
