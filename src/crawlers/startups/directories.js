// Adattatori per directory con anno di fondazione (EU-Startups, The Hub).
// Leggono le schede dalla più recente e si fermano al cursore del run precedente
// (salvato nella colonna "cursore" di db_hub), così ogni run legge solo le schede nuove.
import { getRaw } from '../../lib/http.js';
import { parseDetail, sitemapLocs } from '../../lib/html.js';
import { CRITERIA as C } from '../../lib/config.js';

export const DEEP_DESC = /\b(quantum|semiconductors?|chips?|photonics?|lasers?|fusion|nuclear|robot\w*|drones?|uavs?|space ?tech|satellites?|orbital|rockets?|biotech\w*|synthetic biology|proteins?|genom\w*|cell therap\w*|antibod\w*|drug discovery|neuro\w*|medtech|medical devices?|diagnostics?|batter(y|ies)|energy storage|hydrogen|electroly\w*|advanced materials|nanotech\w*|hardware|lidar|sensors?|defen[cs]e|aerospace|deep ?tech|foundation models?|llms?|large language models?|computer vision|autonomous|3d print\w*|additive manufactur\w*|lab automation|carbon capture|cleantech|climate ?tech|edge ai|embedded|microfluid\w*|bioprint\w*|wearables?|exoskeleton\w*|humanoids?)\b/i;

async function retry(url, n = 3) { for (let k = 0; k < n; k++) { const r = await getRaw(url); if (r.status === 200 && r.text) return r; } return { status: 0, text: '' }; }

async function walk(listingUrls, cursor, max, parse) {
  const found = []; let read = 0; const newCursor = listingUrls[0] || cursor;
  for (let i = 0; i < listingUrls.length && read < max; i += 6) {
    const chunk = listingUrls.slice(i, i + 6);
    const stop = chunk.indexOf(cursor);
    const todo = stop >= 0 ? chunk.slice(0, stop) : chunk;
    const rs = await Promise.all(todo.map(async u => { const r = await getRaw(u); read++; return r.status === 200 ? parse(r.text, u) : null; }));
    for (const x of rs) if (x) found.push(x);
    if (stop >= 0) break;
  }
  return { found, pages: read, cursor: newCursor };
}

const ADAPTERS = {
  async 'eu-startups'(hub, cursor, max) {
    const idx = await retry('https://www.eu-startups.com/sitemap_index.xml');
    const sms = [...idx.text.matchAll(/<loc>([^<]*wpbdp_listing-sitemap(\d*)\.xml)<\/loc>/g)].map(m => [m[1], +(m[2] || 1)]).sort((a, b) => b[1] - a[1]);
    let urls = [];
    for (const [sm] of sms.slice(0, 2)) urls = urls.concat(sitemapLocs((await retry(sm)).text).reverse());
    return walk(urls, cursor, max, (html, u) => {
      const d = parseDetail(html, u); const t = d.text;
      const fy = +((t.match(/Founded\s+(20\d\d)/) || [])[1] || 0);
      const web = ((t.match(/Website\s+(https?:\/\/\S+)/) || [])[1] || '').replace(/[).,;]+$/, '');
      const cat = (t.match(/Category\s+([A-Z][A-Za-z ]{2,30}?)\s+Business Description/) || [])[1] || '';
      const desc = (t.match(/Business Description\s+(.{10,300}?)\s+(Long Business Description|Based in|Tags)/) || [])[1] || '';
      const tags = (t.match(/Tags\s+(.{2,200}?)\s+Founded/) || [])[1] || '';
      const li = t.indexOf('Long Business Description');
      if (fy < C.min_founded_year || !web || !DEEP_DESC.test(desc + ' ' + tags + ' ' + (li >= 0 ? t.slice(li, li + 1500) : ''))) return null;
      return { url: web, name: d.h1.slice(0, 60), year: fy, descrizione: desc.slice(0, 220), hubSuffix: cat };
    });
  },

  async thehub(hub, cursor, max) {
    let urls = [];
    for (const sm of ['https://thehub.io/sitemap-startups-2.xml', 'https://thehub.io/sitemap-startups-1.xml']) urls = urls.concat(sitemapLocs((await retry(sm)).text));
    return walk(urls, cursor, max, (html, u) => {
      const d = parseDetail(html, u); const t = d.text;
      const fy = +((t.match(/Founded\s+(20\d\d)/) || [])[1] || 0);
      if (fy < C.min_founded_year) return null;
      const fund = (t.match(/Funding state\s+(.{2,30}?)\s+(Working at|Jobs|Perks|$)/) || [])[1] || '';
      if (/seed|series/i.test(fund) && !/pre-?seed/i.test(fund)) return null;
      const ind = (t.match(/Industries\s+(.{2,200}?)\s+Business model/) || [])[1] || '';
      const web = (t.match(/Website\s+([a-z0-9.-]+\.[a-z]{2,})/i) || [])[1] || '';
      if (!web || !DEEP_DESC.test(ind + ' ' + t.slice(0, 4000))) return null;
      return { url: 'https://' + web + '/', name: (d.h1 || u.split('/').pop()).slice(0, 60), year: fy, descrizione: (ind + (fund ? ' · funding: ' + fund : '')).slice(0, 220) };
    });
  },
};

export const hasAdapter = name => Object.prototype.hasOwnProperty.call(ADAPTERS, name);
export async function runAdapter(name, hub, cursor, max) { return ADAPTERS[name](hub, cursor, max); }

/** Nome dell'adattatore per un hub, dal dominio del suo URL. */
export function adapterFor(hubUrl) {
  const h = String(hubUrl || '');
  if (/eu-startups\.com/.test(h)) return 'eu-startups';
  if (/thehub\.io/.test(h)) return 'thehub';
  return null;
}
