// Lettura delle pagine: diretta (rispettando robots.txt, con timeout e cortesia per host),
// con ripiego su Jina Reader quando la pagina è vuota (siti in JS) o bloccata.
import { html2md } from './html.js';

const UA = 'Mozilla/5.0 (compatible; ApeiraScout/2.0; +https://apeira.it)';
const JINA = process.env.JINA_BASE || 'https://r.jina.ai/';
const JINA_KEY = process.env.JINA_KEY || '';
const HOST_GAP_MS = 700;      // pausa minima tra due richieste allo stesso host
const HOST_PAR = 2;           // richieste contemporanee massime per host
const MAX_BYTES = 3_000_000;

let fetchImpl = globalThis.fetch;
/** Solo per i test: sostituisce fetch. */
export function setFetch(fn) { fetchImpl = fn; }

export const stats = { direct: 0, directFail: 0, jina: 0, jina429: 0, robotsBlocked: 0 };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tfetch(url, opts = {}, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetchImpl(url, { redirect: 'follow', ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

// ---------- cortesia per host ----------
const H = new Map();
async function hostSlot(h) {
  let s = H.get(h);
  if (!s) H.set(h, s = { act: 0, last: 0 });
  while (s.act >= HOST_PAR || Date.now() - s.last < HOST_GAP_MS) await sleep(120);
  s.act++; s.last = Date.now();
  return () => { s.act--; };
}

// ---------- robots.txt ----------
const ROBOTS = new Map();
async function allowed(u) {
  let x; try { x = new URL(u); } catch { return false; }
  const key = x.origin;
  if (!ROBOTS.has(key)) {
    ROBOTS.set(key, (async () => {
      try {
        const r = await tfetch(key + '/robots.txt', { headers: { 'User-Agent': UA } }, 8000);
        if (r.status !== 200) return [];
        return parseRobots(await r.text());
      } catch { return []; }
    })());
  }
  const rules = await ROBOTS.get(key);
  const path = x.pathname + x.search;
  return !rules.some(p => p && path.startsWith(p));
}
export function parseRobots(txt) {
  const out = []; let applies = false, sawRule = false;
  for (const line of String(txt).split(/\r?\n/)) {
    const l = line.replace(/#.*$/, '').trim(); if (!l) continue;
    const [k, ...rest] = l.split(':'); const v = rest.join(':').trim(); const key = k.toLowerCase();
    if (key === 'user-agent') { if (sawRule) { applies = false; sawRule = false; } if (v === '*' || /apeirascout/i.test(v)) applies = true; }
    else if (key === 'disallow') { sawRule = true; if (applies && v) out.push(v.replace(/\*.*$/, '')); }
    else if (key === 'allow') sawRule = true;
  }
  return out;
}

// ---------- Jina ----------
let jChain = Promise.resolve(), jLast = 0;
const JGAP = JINA_KEY ? 400 : 3100;
function jinaSlot() {
  const p = jChain.then(async () => { const w = jLast + JGAP - Date.now(); if (w > 0) await sleep(w); jLast = Date.now(); });
  jChain = p.catch(() => {});
  return p;
}
let jinaQueued = 0;
export const jinaBacklog = () => jinaQueued;
export async function viaJina(url) {
  if (process.env.NO_JINA === '1') return { status: 0, text: '' };
  jinaQueued++;
  try {
    for (let a = 0; a < 3; a++) {
      await jinaSlot();
      try {
        const r = await tfetch(JINA + url, { headers: { Accept: 'text/plain', 'X-Timeout': '25', 'X-Retain-Images': 'none', ...(JINA_KEY ? { Authorization: 'Bearer ' + JINA_KEY } : {}) } }, 50000);
        stats.jina++;
        if (r.status === 429) { stats.jina429++; await sleep(20000 * (a + 1)); continue; }
        return { status: r.status, text: r.status === 200 ? await r.text() : '' };
      } catch { await sleep(4000); }
    }
    return { status: 0, text: '' };
  } finally { jinaQueued--; }
}

/**
 * Legge una pagina e la restituisce come testo in stile Jina.
 * @returns {{status:number, text:string, via:'direct'|'jina'|'none', finalUrl?:string}}
 */
export async function getPage(url, { jinaFallback = true, maxJinaBacklog = Infinity } = {}) {
  let h; try { h = new URL(url).hostname; } catch { return { status: 0, text: '', via: 'none' }; }
  if (!(await allowed(url))) { stats.robotsBlocked++; return { status: 403, text: '', via: 'none', robots: true }; }
  const done = await hostSlot(h);
  let status = 0;
  try {
    const r = await tfetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en,it;q=0.8,de;q=0.6,fr;q=0.5' } });
    status = r.status;
    const ct = r.headers.get('content-type') || '';
    if (r.ok && /html|xml|text\/plain/.test(ct)) {
      const raw = (await r.text()).slice(0, MAX_BYTES);
      const md = html2md(raw, r.url || url);
      stats.direct++;
      if (md.length >= 600) return { status: 200, text: md, via: 'direct', finalUrl: r.url || url };
    }
    if (status === 404 || status === 410) return { status, text: '', via: 'direct' };
  } catch { /* rete o timeout: si prova Jina */ }
  finally { done(); }
  stats.directFail++;
  if (!jinaFallback) return { status: status || 0, text: '', via: 'none' };
  if (jinaQueued >= maxJinaBacklog) return { status: status || 0, text: '', via: 'none', busy: true };
  const j = await viaJina(url);
  return { status: j.status, text: j.text, via: 'jina' };
}

/** Testo grezzo (sitemap, JSON, robots): solo lettura diretta. */
export async function getRaw(url, ms = 20000) {
  let h; try { h = new URL(url).hostname; } catch { return { status: 0, text: '' }; }
  const done = await hostSlot(h);
  try {
    const r = await tfetch(url, { headers: { 'User-Agent': UA } }, ms);
    return { status: r.status, text: r.ok ? (await r.text()).slice(0, MAX_BYTES) : '', finalUrl: r.url };
  } catch { return { status: 0, text: '' }; }
  finally { done(); }
}

/** JSON da API pubbliche (RDAP, archive.org) con timeout. */
export async function getJson(url, ms = 15000) {
  try {
    const r = await tfetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, ms);
    if (r.status !== 200) return { status: r.status, json: null };
    return { status: 200, json: await r.json() };
  } catch { return { status: 0, json: null }; }
}
