// Età del dominio: data di registrazione da RDAP, prima cattura su archive.org.
import { getJson, sleep } from '../lib/http.js';

const RDAP = process.env.RDAP_BASE || 'https://rdap.org/domain/';
const WAYBACK = process.env.WAYBACK_BASE || 'https://web.archive.org/cdx/search/cdx';
// ccTLD senza RDAP utile: per questi contano gli anni sul sito e archive.org.
export const NO_RDAP = /\.(de|ch|li|eu|es|it|at|se|dk|is|gr|hu|ro|bg|hr|ee|lv|lt|pl|cz|sk|si|pt|lu|tr|il|fi|no|be|nl|ie|ua|by|rs|ba|mk|al|me|md|cy|mt)$/;

let rLast = 0, wLast = 0;
const failTld = {}, okTld = {};

/** @returns {Promise<string|null|'n/a'>} data YYYY-MM-DD, null se sconosciuta, 'n/a' se il TLD non ha RDAP */
export async function registrationDate(domain) {
  const tld = domain.split('.').pop();
  if (NO_RDAP.test(domain) || (failTld[tld] >= 3 && !okTld[tld])) return 'n/a';
  for (let a = 0; a < 3; a++) {
    const w = rLast + 300 - Date.now(); if (w > 0) await sleep(w); rLast = Date.now();
    const r = await getJson(RDAP + domain);
    if (r.status === 429) { await sleep(15000); continue; }
    if (r.status === 0) { failTld[tld] = (failTld[tld] || 0) + 1; await sleep(2000); continue; }
    if (r.status !== 200) return null;
    const ev = (r.json.events || []).find(e => /registration/i.test(e.eventAction));
    if (!ev) return null;
    okTld[tld] = 1;
    return ev.eventDate.slice(0, 10);
  }
  return null;
}

/** Prima cattura su archive.org. @returns {Promise<string|'mai'|null>} YYYY-MM-DD, 'mai' se mai archiviato, null se non disponibile */
export async function firstArchive(domain) {
  for (let a = 0; a < 2; a++) {
    const w = wLast + 1600 - Date.now(); if (w > 0) await sleep(w); wLast = Date.now();
    const r = await getJson(`${WAYBACK}?url=${encodeURIComponent(domain)}&output=json&limit=1&fl=timestamp`, 20000);
    if (r.status === 429) { await sleep(90000); continue; }
    if (r.status !== 200) return null;
    const row = (r.json || [])[1];
    if (!row) return 'mai';
    const ts = String(row[0]);
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  }
  return null;
}
