// Scoperta dei candidati dentro un hub. Due strade, come nella v1:
//  1. sitemap: pagine di dettaglio sotto /startups/, /portfolio/, /alumni/... e da ognuna il sito della startup;
//  2. lettura dei link: home dell'hub, pagine "portfolio/startups/cohort", paginazione, pagine di dettaglio.
import { getPage, getRaw } from '../../lib/http.js';
import { parseDetail, sitemapLocs } from '../../lib/html.js';
import { host, reg, bad, links } from '../../lib/url.js';
import { PORT, STRONGP, GENERIC } from '../../signals/patterns.js';

const SKIP = /(linkedin|twitter|x\.com|facebook|instagram|youtube|youtu\.be|google|apple\.com|microsoft|github|medium\.com|wordpress|wix|squarespace|vimeo|tiktok|eventbrite|calendly|hubspot|mailchimp|typeform|cookiebot|gstatic|cloudflare|amazonaws|w3\.org|schema\.org|creativecommons|europa\.eu|bit\.ly|t\.me|whatsapp|spotify|flickr|issuu|slideshare|xing\.com|crunchbase|dealroom|f6s|angel\.co|wellfound|pitchbook|tracxn|glassdoor|indeed|wikipedia|pinterest|substack|goo\.gl|doi\.org|saashub|producthunt|elementor|wpengine|onetrust|usercentrics|matomo|jquery|fontawesome|gravatar)/i;
const PAT = /(startup|start-up|portfolio|compan|spin|venture|alumni|member|cohort|resident|participant|founder|listing|directory|team|project|incubat|accelerat|programme|program|batch|winner|finalist|unternehmen|entreprise|impres)/i;
const DIR = /^(startups?|start-ups?|portfolio|companies|company|spin-?offs?|spin-?outs?|spinouts?|alumni|ventures|teams|members|participants|cohorts?|projects?|listings?|directory|unternehmen|entreprises|imprese|residents|founders|incubatees|winners|finalists|projekte|empresas|bedrijven|foretag|yritykset)$/i;
const DET = /\/(portfolio|companies|company|startups?|ventures|spin-?offs?|spin-?outs?|alumni|projects|teams|members|participants|cohort)\/[^/?#]{3,}\/?$/i;
const YEAR = /(?:founded|gegr.ndet|fond.e?|fondata|established|founding year|year of foundation)[^0-9]{0,25}(20[012]\d)/i;

/**
 * @returns {Promise<{found: Array<{url,name,year?}>, pages:number, via:string}>}
 */
export async function discover(hub, { maxSitemapPages = 400, deep = false, slow = false } = {}) {
  const sm = await fromSitemap(hub, maxSitemapPages);
  if (sm.found.length >= 5) return { ...sm, via: 'sitemap' };
  const lk = await fromLinks(hub, deep ? 40 : 12, slow);
  return { found: [...sm.found, ...lk.found], pages: sm.pages + lk.pages, via: 'link' };
}

async function fromSitemap(hub, max) {
  let origin; try { origin = new URL(hub.url).origin; } catch { return { found: [], pages: 0 }; }
  const hd = reg(host(hub.url));
  let locs = [], sub = [];
  for (const t of ['/sitemap_index.xml', '/sitemap.xml', '/wp-sitemap.xml']) {
    const r = await getRaw(origin + t);
    if (r.status === 200 && /<loc>/i.test(r.text)) { if (/<sitemapindex/i.test(r.text)) sub = sitemapLocs(r.text); else locs = sitemapLocs(r.text); break; }
  }
  if (sub.length) {
    const good = sub.filter(s => PAT.test(s.replace(origin, '')) && !/(post-sitemap|news|blog|event|attachment|category|tag|author|page-sitemap)/i.test(s)).slice(0, 6);
    for (const s of good) { const r = await getRaw(s); if (r.status === 200) locs.push(...sitemapLocs(r.text)); }
  }
  let pages = [...new Set(locs.filter(l => {
    try { const p = new URL(l).pathname.split('/').filter(Boolean); return p.length >= 2 && DIR.test(p[p.length - 2]) && !/\.(jpg|jpeg|png|pdf|webp|svg)$/i.test(l); } catch { return false; }
  }))].slice(0, max);
  if (pages.length < 5) return { found: [], pages: 0 };

  const per = [], cnt = {};
  for (let i = 0; i < pages.length; i += 6) {
    const rs = await Promise.all(pages.slice(i, i + 6).map(async pu => {
      const r = await getRaw(pu);
      if (r.status !== 200 || !r.text) return null;
      const d = parseDetail(r.text, pu);
      const ex = {};
      for (const l of d.links) {
        if (!l.host || reg(l.host) === hd || SKIP.test(l.host) || bad(l.host)) continue;
        ex[l.host] = Math.max(ex[l.host] || 0, /(website|visit|site web|webseite|sito|homepage|www|\.com|\.io|\.ai)/.test(l.label) ? 2 : 1);
      }
      const y = (d.text.match(YEAR) || [])[1];
      return { ex, title: d.h1, year: y ? +y : null };
    }));
    for (const x of rs) if (x) { per.push(x); for (const h in x.ex) cnt[h] = (cnt[h] || 0) + 1; }
  }
  // un dominio presente su più del 15% delle pagine è dell'hub (sponsor, partner), non della startup
  const thr = Math.max(3, per.length * 0.15);
  const found = [];
  for (const x of per) {
    const hs = Object.keys(x.ex).filter(h => cnt[h] < thr);
    let pick = hs.filter(h => x.ex[h] === 2);
    if (!pick.length) pick = hs.length <= 2 ? hs : [];
    if (pick[0]) found.push({ url: 'https://' + pick[0] + '/', name: x.title, year: x.year || undefined });
  }
  return { found, pages: per.length };
}

async function fromLinks(hub, cap0, slow = false) {
  const hr = reg(host(hub.url));
  const seen = new Set(), q = [[hub.url, 0]], found = [];
  let pages = 0, tries = 0, cap = cap0;   // pages = letture riuscite, tries = tentativi
  while (q.length && tries < cap) {
    const [u, dep] = q.shift();
    const key = u.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await getPage(u, slow ? { timeoutMs: 45000 } : {});   // ritentativo: più pazienza, Jina compreso
    tries++;
    if (r.status !== 200 || !r.text) continue;
    pages++;
    let ext = 0; const det = [];
    for (const [txt, l] of links(r.text)) {
      const h = host(l); if (!h) continue;
      if (reg(h) === hr) {
        const path = l.replace(/^https?:\/\/[^/]+/, '');
        const k = l.replace(/#.*$/, '').replace(/\/$/, '');
        if (seen.has(k)) continue;
        if (dep === 0 && (PORT.test(path) || PORT.test(txt)) && !DET.test(path)) {
          if (q.length < 20) { if (STRONGP.test(path) || STRONGP.test(txt)) q.unshift([l, 1]); else q.push([l, 1]); }
        } else if (dep <= 1 && /([?&]page=\d+|\/page\/\d+|[?&]p=\d+)/.test(path)) {
          if (q.length < 30) q.push([l, 1]);
        } else if (dep <= 1 && DET.test(path)) det.push([l, txt]);
      } else if (!bad(h)) {
        ext++;
        found.push({ url: 'https://' + h + '/', name: txt && !GENERIC.test(txt) && txt.length < 70 ? txt : '' });
      }
    }
    if (det.length >= 6 && ext < det.length) {
      const add = det.filter(x => !seen.has(x[0].replace(/#.*$/, '').replace(/\/$/, ''))).slice(0, 30);
      for (const x of add) q.push([x[0], 2]);
      cap = Math.min(45, cap + add.length);
    }
    if (dep === 0 && tries === 1 && q.length === 0 && ext < 5)
      for (const p of ['portfolio', 'startups', 'companies', 'alumni']) q.push([hub.url.replace(/\/$/, '') + '/' + p, 1]);
  }
  return { found, pages };
}
