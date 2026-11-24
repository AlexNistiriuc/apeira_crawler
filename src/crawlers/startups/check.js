// Controllo di un candidato: età del dominio, lettura del sito (home, team, contatti), prefiltro.
import { getPage, getRaw, jinaBacklog } from '../../lib/http.js';
import { host, reg, links } from '../../lib/url.js';
import { emptySignals, scanPage } from '../../signals/scan.js';
import { registrationDate, firstArchive } from '../../signals/age.js';
import { preCheck, ageCheck, decide, needsWayback, STATO } from '../../signals/prefilter.js';
import { candidateRow } from './row.js';

const TEAM = /(team|about|chi-siamo|chisiamo|ueber-uns|uber-uns|über|equipe|équipe|founders|people|who-we-are|unternehmen|company|qui-sommes)/i;
const CONTACT = /(contact|kontakt|impressum|imprint|legal|mentions|note-legali)/i;

// Lettura di tutto il sito, solo per le startup che passano il prefiltro (le altre non valgono il tempo).
// Priorità alle pagine che dicono di più su team, round ed età: careers, blog/news, about, investitori.
// Tetti: SITE_MAX_PAGES pagine e SITE_BUDGET_MS di tempo; un sito con troppi link (blog enormi, shop,
// documentazione) si legge solo nelle pagine prioritarie e viene segnato "sito_grande".
const SITE_MAX_PAGES = Number(process.env.SITE_MAX_PAGES || 15);
const SITE_BUDGET_MS = Number(process.env.SITE_BUDGET_MS || 90_000);
const SITE_BIG_LINKS = 300;
const KIND = [
  ['careers', /(career|jobs?\b|join-?us|work-with-us|hiring|vacanc|karriere|stellen|lavora|carriere|emploi|recrut)/i],
  ['blog', /(blog|news|press|media|updates|stories|insights|actualit|aktuell|notizie|announc)/i],
  ['about', /(about|team|company|founders|people|who-we-are|mission|story|chi-siamo|ueber-uns|über|equipe|qui-sommes)/i],
  ['investors', /(investor|backers|funding|partners|supporters)/i],
  ['tech', /(technology|product|research|science|solution|platform|how-it-works)/i],
];
const SKIP = /(privacy|datenschutz|impressum|cookie|terms|agb|login|signin|sign-in|cart|checkout|account|\/tag\/|\/category\/|\/page\/\d|\?|\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|xml)$)/i;
// traduzioni: si salta una lingua solo se non è quella del sito (un sito tutto sotto /de/ va letto)
const LANG = /^\/(en|fr|de|it|es|nl|pt|sv|fi|da|pl|no|nb|cs)(\/|$)/i;
const langOf = l => { try { return (new URL(l).pathname.match(LANG) || [])[1]?.toLowerCase() || ''; } catch { return ''; } };

/** URL del sito dalla sitemap (anche indice di sitemap, un livello): per i siti in JavaScript senza link nel testo. */
export async function sitemapUrls(origin, isOwn, max = 80) {
  const locs = x => [...String(x || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].replace(/&amp;/g, '&'));
  const first = await getRaw(origin + '/sitemap.xml', 12000);
  if (first.status !== 200) return [];
  let urls = locs(first.text);
  if (/<sitemapindex/i.test(first.text)) {
    const subs = urls.filter(u => !/(product|image|video|tag|categor|author)/i.test(u)).slice(0, 3);
    urls = [];
    for (const u of subs) { const r = await getRaw(u, 12000); if (r.status === 200) urls.push(...locs(r.text)); if (urls.length > max * 2) break; }
  }
  return [...new Set(urls)].filter(u => isOwn(u)).slice(0, max);
}
const kindOf = (l, tx) => (KIND.find(([, re]) => re.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx)) || ['altro'])[0];
const JOB = /\b(engineer|developer|scientist|researcher|manager|intern(ship)?|lead|head of|technician|designer|sales|operations|analyst|architect|specialist|officer|ingenieur|entwickler)\b/gi;

/** Pagine in più del sito oltre a home, team e contatti. Restituisce gli estratti per tipo e qualche numero. */
async function deepRead(c, s, own, pages, texts, isOwn = l => { const h = host(l); return h && reg(h) === c.dominio; }) {
  const t0 = Date.now();
  const big = own.length > SITE_BIG_LINKS;
  const seen = new Set(pages.map(u => u.replace(/[#].*$/, '').replace(/\/$/, '')));
  // lingua del sito: quella della home o, se la home non ne ha, la più frequente nei link (o nessuna)
  const homeLang = langOf(pages[0] || c.sito);
  const okLang = l => { const x = langOf(l); return !x || x === homeLang || x === 'en'; };
  const toQueue = list => list.map(([tx, l]) => [tx, l.split('#')[0]]).filter(([, l]) => l && !SKIP.test(l) && okLang(l)).map(([tx, l]) => ({ l, k: kindOf(l, tx) }));
  let queue = toQueue(own);
  const fresh = () => queue.filter(q => !seen.has(q.l.replace(/\/$/, ''))).length;
  let viaSitemap = 0;
  // siti in JavaScript o di una pagina sola: i link nel testo mancano, si prova la sitemap
  if (fresh() < 3) {
    const origin = (() => { try { return new URL(pages[0] || c.sito).origin; } catch { return ''; } })();
    const urls = origin ? await sitemapUrls(origin, isOwn) : [];
    const add = toQueue(urls.map(u => ['', u]));
    viaSitemap = add.length; queue.push(...add);
  }
  const rank = k => ({ careers: 0, blog: 1, investors: 2, about: 3, tech: 4, altro: 9 })[k];
  const out = { lette: 0, grande: big, posizioni: 0, per_tipo: {}, link_interni: own.length, da_sitemap: viaSitemap, fallite: 0 };
  // righe che compaiono già in home (menu, footer, cookie): si tolgono dagli estratti delle altre pagine
  const norm = x => x.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>`|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const common = new Set(String(texts.home || '').split('\n').map(norm).filter(x => x.length > 2));
  const ownText = t => String(t || '').split('\n').filter(l => { const n = norm(l); return n.length > 2 && !common.has(n); }).join('\n');
  const CAP = { careers: 3, blog: 4, investors: 2, about: 3, tech: 2, altro: 3 };   // varietà: non tutto il budget su un tipo
  let jina = 3;   // siti in JavaScript: le prime pagine importanti anche via Jina
  const max = big ? Math.min(8, SITE_MAX_PAGES) : SITE_MAX_PAGES;
  while (queue.length && out.lette < max && Date.now() - t0 < SITE_BUDGET_MS) {
    queue.sort((a, b) => rank(a.k) - rank(b.k));
    const { l, k } = queue.shift();
    const key = l.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    if (big && k === 'altro') continue;
    if ((out.per_tipo[k] || 0) >= CAP[k]) continue;
    const useJina = jina > 0 && k !== 'altro';
    const r = await getPage(l, { jinaFallback: useJina, maxJinaBacklog: 12, timeoutMs: 15000 });
    if (useJina && r.via === 'jina') jina--;
    if (r.status !== 200 || !r.text) { out.fallite++; continue; }
    out.lette++; pages.push(l);
    scanPage(s, r.text, {});
    texts[k] = ((texts[k] || '') + '\n' + ownText(r.text)).slice(0, 20000);
    out.per_tipo[k] = (out.per_tipo[k] || 0) + 1;
    if (k === 'careers') out.posizioni = Math.max(out.posizioni, new Set((r.text.match(JOB) || []).map(x => x.toLowerCase())).size + Math.max(0, (r.text.match(/\b(apply|bewerben|candidati|postuler)\b/gi) || []).length - 1));
    // un livello in più: link del sito trovati in questa pagina (utile per articoli del blog e singole posizioni)
    if (!big && (k === 'blog' || k === 'careers')) {
      for (const [tx, ll] of links(r.text)) { const u = ll.split('#')[0]; if (u && isOwn(u) && !SKIP.test(u) && okLang(u)) queue.push({ l: u, k: kindOf(u, tx) === 'altro' ? k : kindOf(u, tx) }); }
    }
  }
  out.secondi = Math.round((Date.now() - t0) / 1000);
  // perché zero pagine: lo si scrive, così chi valuta sa se il sito è di una pagina sola o illeggibile
  if (!out.lette) out.motivo_zero = out.fallite ? `${out.fallite} pagine non leggibili (JavaScript o blocchi)` : 'nessuna pagina interna oltre a home, team e contatti, e nessuna sitemap (sito di una pagina o in JavaScript)';
  return out;
}

/**
 * @param {object} c {dominio, sito, nome, hubs[], trusted, anno_dichiarato, descrizione, primo_visto}
 * @returns {Promise<object>} riga per db_candidati
 */
export async function checkCandidate(c) {
  const pre = preCheck(c);
  if (pre) return candidateRow(c, null, { stato: STATO.SCARTATA, motivo: pre, pages: [] });

  const registrato = await registrationDate(c.dominio);
  const old = ageCheck({ registrato, trusted: c.trusted });
  if (old) return candidateRow(c, null, { stato: STATO.SCARTATA, motivo: old, registrato, pages: [] });

  const s = emptySignals();
  if (c.anno_dichiarato) s.yrs.push(c.anno_dichiarato);
  const pages = [], texts = {};
  const home = await getPage(c.sito, { maxJinaBacklog: 12 });
  if (home.busy) return candidateRow(c, null, { stato: STATO.RICONTROLLA, motivo: 'lettura rimandata (coda Jina piena)', registrato, pages: [] });
  const alive = home.status === 200 && home.text.length >= 400;
  if (alive) {
    pages.push(c.sito); texts.home = home.text;
    scanPage(s, home.text, { home: true });
    // dominio finale dopo i redirect (es. x.eu che porta a x.com): anche i suoi link sono del sito
    const finalDom = (() => { try { return reg(new URL(home.finalUrl || c.sito).hostname); } catch { return c.dominio; } })();
    var isOwn = l => { const h = host(l); return !!h && (reg(h) === c.dominio || reg(h) === finalDom); };
    if (home.finalUrl && home.finalUrl !== c.sito) pages[0] = home.finalUrl;
    const own = links(home.text).filter(([, l]) => isOwn(l));
    const pick = re => { const x = own.find(([tx, l]) => re.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx)); return x && x[1]; };
    // fino a due pagine con le persone (es. /team e /about): più nomi e ruoli dei founder
    const team = pick(TEAM);
    const team2 = (own.find(([tx, l]) => l !== team && TEAM.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx)) || [])[1];
    let contact = pick(CONTACT);
    if (!contact && !s.em.length) {
      const tld = c.dominio.split('.').pop();
      contact = c.sito.replace(/\/$/, '') + (/^(de|at|ch|li)$/.test(tld) ? '/impressum' : tld === 'fr' ? '/mentions-legales' : '/contact');
    }
    for (const [u, legal] of [[team, false], [team2, false], [contact, true]]) {
      if (!u || pages.includes(u)) continue;
      const r = await getPage(u, { jinaFallback: false });
      if (r.status === 200 && r.text) { pages.push(u); if (!legal && !texts.team) texts.team = r.text; scanPage(s, r.text, { legal }); }
    }
  }
  let d = decide({ s, alive, trusted: c.trusted, registrato });
  let sito = null;
  if (alive && d.stato === STATO.DA_VALUTARE) {
    const own = links(home.text).filter(([, l]) => isOwn(l));
    sito = await deepRead(c, s, own, pages, texts, isOwn);
    d = decide({ s, alive, trusted: c.trusted, registrato });
  }
  let archivio = '';
  if (d.stato === STATO.DA_VALUTARE && !c.trusted && needsWayback(s, registrato)) {
    archivio = (await firstArchive(c.dominio)) || '';
    d = decide({ s, alive, trusted: c.trusted, registrato, archivio });
  }
  return candidateRow(c, alive ? s : null, { ...d, registrato, archivio, pages, texts, sito });
}

export { jinaBacklog };
