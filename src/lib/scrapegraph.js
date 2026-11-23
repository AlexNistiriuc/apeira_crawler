// Client ScrapeGraphAI v2 (https://docs.scrapegraphai.com). Serve al crawler founder per
// leggere, tramite i risultati di ricerca, il numero di dipendenti della startup e i profili
// LinkedIn dei founder: data di inizio in azienda e prima esperienza educativa.
//
// Scelta deliberata: si usa `search` (ricerca web + estrazione strutturata in una chiamata),
// non l'apertura diretta di linkedin.com. LinkedIn resta una fonte-indizio, non una prova.
//
// Senza SCRAPEGRAPH_API_KEY il client è spento e chi lo usa deve avere un fallback.
// Tetto per giro (SCRAPEGRAPH_MAX_PER_RUN) per non bruciare crediti se il crawler riparte.
const DEFAULT_URL = 'https://v2-api.scrapegraphai.com/api';
const RETRIES = 2;

let impl = (...a) => fetch(...a);
/** Solo per i test: sostituisce fetch. */
export function setScrapeGraphFetch(fn) { impl = fn; }

export const scrapeGraphStats = { chiamate: 0, errori: 0, saltate_tetto: 0, crediti: 0 };
/** Solo per i test. */
export function resetScrapeGraphStats() {
  scrapeGraphStats.chiamate = 0;
  scrapeGraphStats.errori = 0;
  scrapeGraphStats.saltate_tetto = 0;
  scrapeGraphStats.crediti = 0;
}

export const scrapegraphEnabled = () => Boolean(process.env.SCRAPEGRAPH_API_KEY);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function endpoint() {
  return (process.env.SCRAPEGRAPH_API_URL || DEFAULT_URL).replace(/\/+$/, '');
}

function maxPerRun() {
  return Number(process.env.SCRAPEGRAPH_MAX_PER_RUN || 120);
}

function retryMs(attempt) {
  const base = Number(process.env.SCRAPEGRAPH_RETRY_MS ?? 1000);
  return base * (2 ** attempt);
}

async function call(path, payload) {
  const key = process.env.SCRAPEGRAPH_API_KEY;
  if (!key) throw Object.assign(new Error('Manca SCRAPEGRAPH_API_KEY'), { fatal: true });
  if (scrapeGraphStats.chiamate >= maxPerRun()) {
    scrapeGraphStats.saltate_tetto++;
    throw Object.assign(new Error('tetto ScrapeGraph per giro raggiunto'), { skip: true });
  }
  const timeout = Number(process.env.SCRAPEGRAPH_TIMEOUT_MS || 30000);
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      scrapeGraphStats.chiamate++;
      const response = await impl(`${endpoint()}${path}`, {
        method: 'POST',
        headers: { 'SGAI-APIKEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`ScrapeGraph ha risposto con dati non JSON (${response.status})`); }
      if (!response.ok) {
        const detail = body?.error?.message || body?.message || body?.detail || `HTTP ${response.status}`;
        const err = new Error(`ScrapeGraph ${detail}`);
        err.retryable = response.status === 429 || response.status >= 500;
        // chiave non valida, credito finito, accesso negato: inutile continuare a spendere tentativi
        err.fatal = [401, 402, 403].includes(response.status);
        err.status = response.status;
        throw err;
      }
      const usage = body?.usage || {};
      scrapeGraphStats.crediti += Number(usage.creditsUsed ?? usage.credits_used ?? 0) || 0;
      return body;
    } catch (error) {
      last = error;
      if (error.skip) throw error;
      const retryable = !error.fatal && (error.retryable || error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError);
      if (!retryable || attempt === RETRIES) break;
      await wait(retryMs(attempt));
    }
  }
  scrapeGraphStats.errori++;
  throw last;
}

/**
 * Ricerca web + estrazione strutturata in una sola chiamata.
 * @returns {Promise<{json:object|null, results:Array<{title:string,url:string,content:string}>, usage:object}>}
 */
export async function search(query, { numResults = 5, prompt, schema, timeRange } = {}) {
  const body = await call('/search', {
    query,
    numResults,
    ...(prompt ? { prompt } : {}),
    ...(schema ? { schema } : {}),
    ...(timeRange ? { timeRange } : {}),
  });
  return {
    json: body?.json ?? null,
    results: (body?.results || []).map(result => ({
      title: String(result?.title || ''),
      url: String(result?.url || ''),
      content: String(result?.content || ''),
    })),
    usage: body?.usage || {},
  };
}

/**
 * Estrazione strutturata da una singola pagina. Usata solo come ripiego quando `search`
 * non restituisce JSON e c'è un URL non-LinkedIn su cui vale la pena leggere.
 * @returns {Promise<{json:object|null, usage:object, sources:string[]}>}
 */
export async function extract(url, { prompt, schema, mode } = {}) {
  const body = await call('/extract', {
    url,
    prompt,
    ...(schema ? { schema } : {}),
    ...(mode ? { mode } : {}),
  });
  return { json: body?.json ?? null, usage: body?.usage || {}, sources: [url] };
}
