// Euristiche che leggono il testo di una pagina e accumulano segnali sul candidato.
// Funzioni pure: nessuna rete, nessuno stato globale. Portate dalla v1 (analyze, fundSig,
// legalNames, fageScan, teamScan, evScan) più demandScan, nuovo, per la "domanda reale".
import * as P from './patterns.js';

export function emptySignals() {
  return {
    deep: 0, strong: 0, neg: 0, tags: [],
    yrs: [], cmin: null,
    em: [], lin: [], lco: [], fn: [],
    title: '', desc: '', eu: false,
    fund: { l: 0, x: [] },
    fa: { y: 0, s: 0, g: [], a: [], ev: [] },
    ts: { e: 0, li: [], r: 0 },
    evd: { g: [], i: [], lc: '', lx: '', fy: [] },
    dem: [],
    corp: false, inv: false,
  };
}

const uniq = (a, n) => [...new Set(a)].slice(0, n);
/** Nomi dei founder senza doppioni; "Anna Rossi (CEO)" vince su "Anna Rossi". */
function mergeNames(list, n) {
  const m = new Map();
  for (const x of list) { const name = x.replace(/\s*\((CEO|CTO)\)$/, ''); if (!m.has(name) || /\((CEO|CTO)\)$/.test(x)) m.set(name, x); }
  return [...m.values()].slice(0, n);
}
const snip = (t, i, a, b) => t.slice(Math.max(0, i - a), i + b).replace(/\s+/g, ' ').trim();

/** Punteggio deep tech, anni, contatti, nomi. Era analyze() della v1. */
export function analyze(t) {
  const low = t.toLowerCase();
  let deep = 0, strong = 0; const tags = [];
  for (const [tag, w, re] of P.KW) {
    const m = low.match(new RegExp(re.source, 'g'));
    if (m) { deep += w + Math.min(new Set(m).size - 1, 2); strong++; tags.push(tag); }
  }
  deep += Math.min(new Set(low.match(new RegExp(P.MED.source, 'g')) || []).size, 3);
  const neg = new Set(low.match(new RegExp(P.NEG.source, 'g')) || []).size;

  const yrs = []; let m;
  const fr = /(founded|established|gegründet|gegruendet|fondée|fondee|fondata|fundada|since|seit|launched|incorporated)[^0-9\n]{0,20}(20[12]\d)/gi;
  while ((m = fr.exec(t))) yrs.push(+m[2]);
  let cmin = null;
  const cp = /(?:©|\(c\)|copyright)\s*(20[012]\d)(?:\s*[-–]\s*(20[0-3]\d))?/gi;
  while ((m = cp.exec(t))) if (m[2]) cmin = Math.min(cmin || 9999, +m[1]);

  const em = new Set();
  for (const e of (t.replace(/\s?\[at\]\s?|\s?\(at\)\s?/gi, '@').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [])) {
    const x = e.toLowerCase().replace(/\.$/, '');
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(x) || /(example|sentry|wixpress|domain\.com|email\.com|yourname|u003e|@2x)/.test(x)) continue;
    em.add(x);
  }
  const lin = (t.match(/linkedin\.com\/in\/[A-Za-z0-9\-_%]+/g) || []).map(x => 'https://www.' + x);
  const lco = (t.match(/linkedin\.com\/company\/[A-Za-z0-9\-_%]+/g) || []).map(x => 'https://www.' + x);

  const fn = new Set();
  const fre = /([A-ZÀ-Ý][a-zà-ÿ'\-]{1,20}(?:[ \t][A-ZÀ-Ý][a-zà-ÿ'\-]{1,25}){1,2})\s*(?:[,|\-–—:·]\s*|\n+|\s+)(Co-?\s?[Ff]ounder|CO-?FOUNDER|[Ff]ounder|FOUNDER|CEO|CTO|Chief Executive|Chief Technology|Geschäftsführer)/g;
  // il ruolo resta accanto al nome ("Anna Rossi (CEO)"): serve a stimare l'età di CEO e CTO
  const ROLE = r => /CEO|Chief Executive|Geschäftsführer/i.test(r) ? 'CEO' : /CTO|Chief Technology/i.test(r) ? 'CTO' : 'co-founder';
  const byName = new Map();
  while ((m = fre.exec(t)) && byName.size < 5) {
    const nm = m[1].trim(); if (/^(The|Our|Meet|About|Team|Contact|Join|Read|Learn|Co|Founder)\b/.test(nm)) continue;
    // titoli e ruoli scambiati per nomi (es. "Geschäftsführer Dr", "Managing Director")
    if (/\b(Geschäftsführer\w*|Gesch|Dr|Prof|Dipl|Ing|Managing|Director|Head|Board|Advisor|Officer|Chief|Partner|Gérant|Président|Amministratore|Fondatore|Gründer\w*|Vorstand|Inhaber)\b\.?/i.test(nm)) continue;
    // "Co-founder & CEO": il ruolo vero può stare subito dopo
    const r = ROLE(m[2] + ' ' + t.slice(fre.lastIndex, fre.lastIndex + 20).split('\n')[0]); const prev = byName.get(nm);
    if (!prev || prev === 'co-founder') byName.set(nm, r);
  }
  for (const [nm, r] of byName) fn.add(r === 'co-founder' ? nm : `${nm} (${r})`);

  const title = (t.match(/^Title:\s*(.*)$/m) || [])[1] || '';
  let desc = (t.match(/Markdown Content:\s*([\s\S]{0,1500})/) || [])[1] || '';
  desc = desc.replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_>`|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { deep, strong, neg, tags, yrs, cmin, em: [...em], lin, lco, fn: [...fn], title: title.slice(0, 90), desc, eu: P.EU.test(t) };
}

/** Segnali di round già chiusi. l: 0 niente, 1 pre-seed o meno di 1M, 2 seed o 1M+, 3 Series. */
export function fundSig(t) {
  let l = 0; const x = []; const T = t.slice(0, 60000);
  if (/\bseries [a-d]\b/i.test(T)) { l = 3; x.push('Series'); }
  if (/(?<!pre-?)\bseed (round|funding|investment|financing)\b/i.test(T)) { l = Math.max(l, 2); x.push('seed'); }
  if (/\bpre-?seed\b/i.test(T)) { l = Math.max(l, 1); x.push('pre-seed'); }
  // "Backed by", "Backed and advised by", "our investors": investitori dichiarati sul sito, probabile round già fatto
  if (/\b(backed (and advised )?by|our investors|investors include|funded by (?!the european|horizon|eic|the eu))/i.test(T)) { l = Math.max(l, 1); x.push('backed by'); }
  const re = /(rais\w*|secur\w*|clos\w*|funding|round|invest\w*|financ\w*)[^.\n]{0,60}?(?:([€$£])\s?(\d+(?:[.,]\d+)?)\s?(m|mn|million|mio|k|thousand|b|bn|billion)?\b|(\d+(?:[.,]\d+)?)\s?(m|mn|million|mio|k)\.?\s?(€|eur|euro|usd|\$|£|dollars|pounds|chf))/gi;
  let m;
  while ((m = re.exec(T))) {
    const v = parseFloat((m[3] || m[5]).replace(',', '.'));
    const u = (m[4] || m[6] || '').toLowerCase();
    const M = u.startsWith('b') ? v * 1000 : /^(m|mn|million|mio)$/.test(u) ? v : /^(k|thousand)$/.test(u) ? v / 1000 : v / 1e6;
    if (M >= 0.05) { x.push((m[2] || '') + v + (u || '') + (m[7] ? ' ' + m[7] : '')); l = Math.max(l, M >= 1 ? 2 : 1); }
  }
  return { l, x: uniq(x, 3) };
}

/** Nomi dei legali rappresentanti da Impressum, mentions légales ecc. */
export function legalNames(t) {
  const re = /(Geschäftsführer(?:in|innen)?|Geschaeftsfuehrer|Vertreten durch|Vertretungsberechtigte?r? Geschäftsführer|Managing Directors?|Directeur g[ée]n[ée]ral|Pr[ée]sident|G[ée]rant|Amministratore unico|Legal representative)\s*[:\-]?\s*([A-ZÄÖÜÉ][a-zäöüßéèëï\-]+(?:[ \t]+[A-ZÄÖÜÉ][a-zäöüßéèëï\-]+){1,2}(?:\s*(?:,|und|and|&|et)\s*[A-ZÄÖÜÉ][a-zäöüßéèëï\-]+(?:[ \t]+[A-ZÄÖÜÉ][a-zäöüßéèëï\-]+){1,2}){0,3})/g;
  const out = new Set(); let m;
  while ((m = re.exec(t))) for (let n of m[2].split(/\s*(?:,|und|and|&|et)\s*/)) { n = n.trim(); if (n.split(/\s+/).length >= 2 && n.length < 40) out.add(n); }
  return [...out];
}

/** Segnali di età dei founder (solo indizi; l'età vera conta solo se dichiarata). */
export function fageScan(f, t) {
  t = String(t).slice(0, 60000); let m;
  const Y = new RegExp(P.FA_Y.source, 'gi'), S = new RegExp(P.FA_S.source, 'gi'), G = new RegExp(P.FA_G.source, 'gi'), A = new RegExp(P.FA_A.source, 'gi');
  while ((m = Y.exec(t)) && f.y < 20) { f.y++; if (f.ev.length < 3) f.ev.push('+' + snip(t, m.index, 40, 60)); }
  while ((m = S.exec(t)) && f.s < 20) { f.s++; if (f.ev.length < 3) f.ev.push('-' + snip(t, m.index, 40, 60)); }
  while ((m = G.exec(t)) && f.g.length < 10) { const y = +m[2]; if (y <= 2026 && !f.g.includes(y)) f.g.push(y); }
  while ((m = A.exec(t)) && f.a.length < 6) { const a = +(m[1] || m[2]); if (a >= 16 && a <= 75 && !f.a.includes(a)) f.a.push(a); }
}

/** Dimensione del team: dichiarata, profili LinkedIn sulla pagina team, ruoli elencati. */
export function teamScan(ts, t) {
  t = String(t).slice(0, 80000);
  const cut = t.search(/\n[#* ]{0,6}(advisors?|advisory board|board of directors|our board|investors?|mentors?|our partners|backed by|supported by)\b/i);
  const tt = cut > 200 ? t.slice(0, cut) : t; let m;
  const E1 = new RegExp(P.TS_E1.source, 'gi'), E2 = new RegExp(P.TS_E2.source, 'gi'), LI = new RegExp(P.TS_LI.source, 'gi');
  while ((m = E1.exec(t))) { const n = +m[1]; if (n >= 2 && n <= 5000) ts.e = Math.max(ts.e, n); }
  while ((m = E2.exec(t))) { const n = +m[1]; if (n >= 2 && n <= 5000 && !/^(19|20)\d\d$/.test(m[1])) ts.e = Math.max(ts.e, n); }
  while ((m = LI.exec(tt))) { const s = decodeURIComponent(m[1]).toLowerCase().replace(/\/$/, ''); if (!ts.li.includes(s) && ts.li.length < 60) ts.li.push(s); }
  ts.r = Math.max(ts.r, (tt.match(new RegExp(P.TS_R.source, 'gi')) || []).length);
}

/** Evidenze per i criteri rigidi: importi vicino a parole di grant o investimento, lab, anno di fondazione. */
export function evScan(e, t) {
  t = String(t).slice(0, 80000); let m;
  const M = new RegExp(P.EV_M.source, 'gi');
  while ((m = M.exec(t)) && e.g.length + e.i.length < 12) {
    const ctx = snip(t, m.index, 90, 60);
    const cur = (m[1] || m[6] || '').toLowerCase();
    const num = parseFloat((m[2] || m[4] || '0').replace(',', '.'));
    const u = m[3] || m[5] || '';
    const mul = /^(m|mn|million|millions|mio|millionen|milioni)$/i.test(u) ? 1e6 : /^(k|thousand)$/i.test(u) ? 1e3 : 1;
    const amt = num * mul;
    if (amt < 1000 || amt > 1e10) continue;
    const it = { amt, cur, ctx: ctx.slice(0, 160) };
    if (e.g.concat(e.i).some(z => z.ctx === it.ctx)) continue;
    if (P.EV_G.test(ctx)) e.g.push(it); else if (P.EV_I.test(ctx)) e.i.push(it);
  }
  if (!e.lc) { const x = t.match(P.EV_LC); if (x) e.lc = snip(t, x.index, 40, 80); }
  if (!e.lx) { const x = t.match(P.EV_LX); if (x) e.lx = snip(t, x.index, 20, 100); }
  const F = new RegExp(P.EV_F.source, 'gi');
  while ((m = F.exec(t)) && e.fy.length < 4) { const y = +m[3]; if (!e.fy.includes(y)) e.fy.push(y); }
}

/** Domanda reale: clienti, pilot, LOI, contratti, ricavi. Solo frasi, il giudizio lo dà il classificatore. */
const DEM = /\b(pilot (project|program|programme|with|at)|paying customers?|our customers|customers? (include|such as)|letters? of intent|\bLOIs?\b|signed (a )?(contract|agreement|partnership)|deployed (at|with|in)|in production (at|with)|revenue|first (customer|order|sale)s?|commercial (partner|agreement|contract)|purchase order|waitlist of|already (used|working) (by|with)|trusted by|collaborat\w+ with)\b/gi;
export function demandScan(d, t) {
  t = String(t).slice(0, 80000); let m;
  while ((m = DEM.exec(t)) && d.length < 5) { const s = snip(t, m.index, 60, 100); if (!d.some(x => x === s)) d.push(s); }
  DEM.lastIndex = 0;
}

/**
 * Legge una pagina del sito del candidato e aggiorna i segnali.
 * @param {object} s segnali (da emptySignals)
 * @param {string} t testo in stile Jina
 * @param {{home?:boolean, legal?:boolean}} opt home=true per la home, legal=true per Impressum/contatti
 */
export function scanPage(s, t, opt = {}) {
  if (!t) return s;
  const a = analyze(t);
  s.deep = Math.max(s.deep, a.deep); s.strong = Math.max(s.strong, a.strong); s.neg = Math.max(s.neg, a.neg);
  s.tags = uniq([...s.tags, ...a.tags], 12);
  s.yrs = uniq([...s.yrs, ...a.yrs], 10);
  if (a.cmin) s.cmin = Math.min(s.cmin || 9999, a.cmin);
  s.em = uniq([...s.em, ...a.em], 6); s.lin = uniq([...s.lin, ...a.lin], 8); s.lco = uniq([...s.lco, ...a.lco], 3);
  s.fn = mergeNames([...s.fn, ...a.fn, ...(opt.legal ? legalNames(t) : [])], 6);
  if (!s.title) s.title = a.title;
  if (!s.desc) s.desc = a.desc;
  s.eu = s.eu || a.eu;
  const f = fundSig(t);
  if (f.l > s.fund.l) s.fund.l = f.l;
  s.fund.x = uniq([...s.fund.x, ...f.x], 4);
  if (opt.home && P.CORP.test(t)) s.corp = true;   // come nella v1: solo sulla home
  if (opt.home && P.INVT.test(t)) s.inv = true;
  fageScan(s.fa, t); teamScan(s.ts, t); evScan(s.evd, t); demandScan(s.dem, t);
  return s;
}
