// Snowball: dai siti dei candidati promettenti si prendono i link a incubatori, programmi,
// competizioni. Sono pool che la startup stessa cita, quindi spesso pre-seed. Dalla v1.
import { getPage } from '../../lib/http.js';
import { host, reg, bad, links } from '../../lib/url.js';
import { JUNKHUB, VCH } from '../../signals/patterns.js';

const KW = /(incubat|accelerat|programme|program|venture-?lab|startup|innovation|founders|spin-?off|spinout|entrepreneur|launchpad|sciencepark|science-park|technopark|technopol|cluster|award|prize|challenge|competition|fellowship)/i;
const BAD = /(linkedin|twitter|x\.com|facebook|instagram|youtube|google|apple|microsoft|github|medium|wordpress|wix|squarespace|webflow|hubspot|cookie|privacy|\.gov|europa\.eu|ventures?\b|capital|invest|fund\b)/i;

/** @returns {Promise<Array<{name,url}>>} hub citati dal sito della startup */
export async function hubsCitedBy(site) {
  const r = await getPage(site, { jinaFallback: false });
  if (r.status !== 200) return [];
  const own = reg(host(site)), out = new Map();
  for (const [tx, l] of links(r.text)) {
    const h = host(l);
    if (!h || reg(h) === own || bad(h) || BAD.test(h) || JUNKHUB.test(h) || VCH.test(h)) continue;
    if (!KW.test(h + ' ' + tx)) continue;
    if (!out.has(h)) out.set(h, { name: 'snowball: ' + h, url: 'https://' + h + '/' });
  }
  return [...out.values()];
}
