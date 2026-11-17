// Reti di incubatori (hub-of-hubs, es. EBN, UKSPA): dalla sitemap delle pagine membro
// si ricava il sito di ogni membro, che diventa un hub. Portato da mineHoH della v1.
import { getRaw } from '../../lib/http.js';
import { parseDetail, sitemapLocs } from '../../lib/html.js';

const SK = /(linkedin|twitter|x\.com|facebook|instagram|youtube|google|apple|microsoft|europa\.eu|wordpress|vimeo|flickr|issuu|t\.me|whatsapp|mailchimp|eventbrite|cookiebot|gstatic|w3\.org|schema\.org)/i;

/** @returns {Promise<{pages:number, members:Array<{name,url}>}>} */
export async function mineNetwork(sitemapUrl, label, maxPages = 600) {
  const own = new URL(sitemapUrl).hostname.replace(/^www\./, '');
  const r = await getRaw(sitemapUrl);
  if (r.status !== 200) return { pages: 0, members: [], error: 'sitemap non raggiungibile (' + r.status + ')' };
  const pages = sitemapLocs(r.text).slice(0, maxPages);
  const per = [], cnt = {};
  for (let i = 0; i < pages.length; i += 6) {
    const rs = await Promise.all(pages.slice(i, i + 6).map(async pu => {
      const x = await getRaw(pu); if (x.status !== 200) return null;
      const d = parseDetail(x.text, pu);
      const ex = [...new Set(d.links.filter(l => l.host && !l.host.endsWith(own) && !SK.test(l.host)).map(l => new URL(l.url).origin))];
      return { t: d.h1.slice(0, 60), ex };
    }));
    for (const x of rs) if (x) { per.push(x); for (const o of x.ex) cnt[o] = (cnt[o] || 0) + 1; }
  }
  const thr = Math.max(3, per.length * 0.1);
  const members = [];
  for (const x of per) {
    const o = x.ex.filter(o => cnt[o] < thr);
    if (o.length >= 1 && o.length <= 3) members.push({ name: `${label}: ${x.t || new URL(o[0]).hostname}`, url: o[0] + '/' });
  }
  return { pages: per.length, members };
}
