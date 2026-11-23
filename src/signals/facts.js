// Fatti su età dei founder e fase della startup, ricavati dai dati che raccolgono i crawler
// (ricerca Brave, registri). Funzioni pure, usate dal crawler founder e dai classificatori.
import { CRITERIA as C } from '../lib/config.js';

export const parseJson = (v, def = null) => { if (v == null || v === '') return def; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return def; } };

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const surname = n => fold(n).trim().split(/\s+/).pop();

/** Persone da cercare: CEO e CTO se il sito li indica, altrimenti i primi due founder elencati. */
/** Nome pulito: il vecchio crawler a volte attaccava "\nCo" (da "Co-founder") al nome. */
export const cleanName = n => String(n || '').split('\n')[0].replace(/\s+(Co|Founder|Co-?founder)$/i, '').trim();

export function pickPeople(founders) {
  const list = String(founders || '').split(', ').map(s => s.trim()).filter(Boolean).map(f => f.replace(/^([^(]*?)(\s*\(.*\))?$/, (_, n, r) => cleanName(n) + (r || '')));
  const out = [];
  for (const f of list) { const m = f.match(/^(.+?)\s*\((CEO|CTO)\)$/); if (m && !out.some(o => o.ruolo === m[2])) out.push({ nome: m[1].trim(), ruolo: m[2] }); }
  if (out.length) return out;
  return list.slice(0, 2).map(f => ({ nome: f.replace(/\s*\([^)]*\)\s*$/, '').trim(), ruolo: 'founder' })).filter(p => p.nome.split(/\s+/).length >= 2);
}

/** Quanti founder elenca il sito (almeno 1 se ce n'è qualcuno). */
export const founderCount = founders => String(founders || '').split(', ').filter(s => s.trim()).length;

/**
 * Età verificata da una stima (signals/age.estimate.js): conta solo un'età o un anno di nascita
 * dichiarati in una frase che contiene nome E cognome. Anno di laurea, studente, 30 under 30: restano stime.
 */
export function verifiedFromEstimate(person, e, year = new Date().getFullYear()) {
  if (!e || e.eta == null || e.eta < 16 || !/età dichiarata|anno di nascita/.test(e.tipo || '')) return null;
  if (/\byears? (in|of|at|with|experience)\b|\banni di\b|\bjahre (in|erfahrung)\b/i.test(e.prova || '')) return null;   // "12 years in biotech" è esperienza, non età
  const words = fold(person.nome).split(/\s+/).filter(w => w.length > 1);
  const prova = fold(e.prova);
  if (words.length < 2 || !words.every(w => prova.includes(w))) return null;
  const min = e.tipo === 'anno di nascita' ? e.eta - 1 : e.eta;
  return { nome: person.nome, ruolo: person.ruolo, min, max: e.eta, fonte: e.tipo === 'anno di nascita' ? 'anno di nascita in fonte pubblica' : 'età dichiarata in fonte pubblica', url: e.fonte || '' };
}

/** Persone del registro che sono founder: cognome tra i founder del sito; se il sito non ne elenca, tutti gli amministratori. */
export function registryFounders(reg, founders) {
  const persone = (reg?.persone || []).filter(p => p.min != null);
  const names = String(founders || '').split(', ').map(s => cleanName(s.replace(/\s*\([^)]*\)\s*$/, ''))).filter(Boolean);
  if (!names.length) return persone;
  const sn = new Set(names.map(surname));
  return persone.filter(p => sn.has(surname(p.nome)));
}

// ---------------------------------------------------------------- fase: notizie di funding

/**
 * Nome con cui cercare e riconoscere la startup. Il crawler a volte salva come nome una parola generica
 * del sito ("startup", "home"): se il nome non somiglia al dominio, si usa il dominio senza estensione.
 */
export function companyName(c) {
  const stem = fold(String(c.dominio || '').split('.')[0]).replace(/[^a-z0-9]/g, '');
  const nm = String(c.nome || '').trim(), compact = fold(nm).replace(/[^a-z0-9]/g, '');
  const first = fold(nm).split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
  if (compact && stem && (stem.includes(compact) || compact.includes(stem) || (first.length >= 3 && stem.includes(first)))) return nm;
  return stem || nm || String(c.dominio || '');
}

/**
 * Round oltre soglia confermato: il risultato contiene il dominio, oppure almeno due risultati diversi
 * riportano importi simili (entro il 30%). Un solo risultato su un nome che può avere omonimi non basta.
 */
export function confirmedOver(items, threshold) {
  const big = items.filter(x => x.usd > threshold);
  return big.some(x => x.dom || x.slug) || big.some(a => big.some(b => b.n !== a.n && Math.abs(a.usd - b.usd) <= 0.3 * Math.max(a.usd, b.usd)));
}

const FX = C.fx_to_usd || {};
const AMOUNT = /(?:(€|eur|euros?|\$|usd|£|gbp|chf)\s?(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|millions|mio|bn|billion)?\b|(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|millions|mio|bn|billion)?\s?(€|eur|euros?|usd|dollars|£|gbp|chf)\b)/gi;
const RAISE = /\b(rais(es|ed|ing)|secur(es|ed)|clos(es|ed)|lands?|landed|bags?|bagged|completes?|completed|announces?|announced|funding|financing|investment|round|backed|pre-?seed|seed|deal|investors?)\b/i;
const GRANT = /\b(grant|grants|award(ed)?|prize|eic|horizon europe|exist|innosuisse|bpifrance|i-lab|i-nov|innovate uk|sbir|non-dilutive|subsid)/i;
const FUND_ITSELF = /\b(fund|fonds|fondo)\b/i;   // "X Ventures raises $50M fund": è un fondo, non la startup
const STAGE = [[/\bseries [a-d]\b/i, 'series'], [/(?<!pre-?)\bseed (round|funding|investment|financing)\b/i, 'seed'], [/\bpre-?seed\b/i, 'pre-seed']];

/**
 * Notizie di funding (risultati Brave filtrati) → importi e fase. Conta solo frasi che nominano la startup
 * (nome o dominio) insieme a un verbo di raccolta o a un grant: così un fondo che "raccoglie 100M" non conta.
 */
/** La pagina è dedicata alla startup: un segmento dell'URL è il suo nome (anche con città dopo, es. saturn-dynamics-london-gb). */
export function urlIsAbout(url, name, domain) {
  const stem = fold(String(domain || '').split('.')[0]).replace(/[^a-z0-9]/g, '');
  const hy = fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let path = ''; try { path = new URL(url).pathname; } catch { return false; }
  return fold(path).split('/').some(seg => seg && (seg.replace(/-/g, '') === stem || seg === hy || (hy.length >= 5 && seg.startsWith(hy + '-'))));
}

/** Testo incollato male negli snippet ("€3.5 millionPre-Seed", "DetailsSaturn"): rimette gli spazi. */
const unglue = s => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\d)(million|billion|mn|bn)(?=[A-Za-z])/gi, '$1 $2 ').replace(/(million|billion)(?=[A-Za-z])/gi, '$1 ');

const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

export function newsFunding(news, name, domain) {
  const out = { investimenti: [], grant: [], fase: '', inv_usd: 0, grant_usd: 0, team: 0 };
  const nm = fold(name), dom = fold(domain), stem = dom.split('.')[0];
  const mentions = s => (nm.length >= 4 && s.includes(nm)) || (dom && s.includes(dom)) || (stem.length >= 5 && s.includes(stem));
  for (const [ni, n] of (news || []).entries()) {
    const hasDom = Boolean(dom) && fold(`${n.url || ''} ${n.title || ''} ${n.snippet || ''}`).includes(dom);
    const slug = urlIsAbout(n.url, name, domain);   // pagina dedicata: ogni frase parla della startup
    // il nome stesso può essere in CamelCase (DiaSense): lo si protegge prima di rimettere gli spazi
    const esc = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const raw = `${n.title || ''}. ${n.snippet || ''}`.replace(esc.length >= 3 ? new RegExp(esc, 'gi') : /$^/, m => m.replace(/([a-z])([A-Z])/g, '$1\u0001$2'));
    for (const sent of unglue(raw).replace(/\u0001/g, '').split(/(?<=[.!?])\s+|\s…\s/)) {
      const f = fold(sent);
      if (!slug && !mentions(f)) continue;
      const tm = f.match(/\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)[- ](person|people|member|strong)\b[^.]{0,15}\bteam\b|\bteam of (\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/);
      if (tm) { const v = tm[1] || tm[3]; out.team = Math.max(out.team, NUM[v] || Number(v) || 0); }
      for (const [re, k] of STAGE) if (re.test(sent) && (!out.fase || k === 'series' || (k === 'seed' && out.fase === 'pre-seed'))) out.fase = k;
      const isGrant = GRANT.test(sent);
      if (!isGrant && !RAISE.test(sent)) continue;
      if (FUND_ITSELF.test(sent)) continue;
      AMOUNT.lastIndex = 0;
      let m;
      while ((m = AMOUNT.exec(sent))) {
        const cur = (m[1] || m[6] || '').toLowerCase().replace(/^euros?$/, 'eur');
        const mult = /^(m|mn|million|millions|mio)$/i.test(m[3] || m[5] || '') ? 1e6 : /^(bn|billion)$/i.test(m[3] || m[5] || '') ? 1e9 : /^k$/i.test(m[3] || m[5] || '') ? 1e3 : 1;
        const amt = parseFloat(String(m[2] || m[4]).replace(',', '.')) * mult;
        if (!(amt >= 10000) || amt > 5e9) continue;
        const usd = Math.round(amt * (FX[cur] || 1));
        const it = { importo: `${({ '€': 'EUR', '$': 'USD', '£': 'GBP', dollars: 'USD' })[cur] || cur.toUpperCase()} ${amt >= 1e6 ? (amt / 1e6).toFixed(1) + 'M' : Math.round(amt / 1e3) + 'k'}`, usd, url: n.url, frase: sent.trim().slice(0, 200), n: ni, dom: hasDom, slug };
        (isGrant ? out.grant : out.investimenti).push(it);
      }
    }
  }
  out.inv_usd = Math.max(0, ...out.investimenti.map(x => x.usd));
  // stessi importi ripetuti in più frasi o pagine: contano una volta sola
  out.grant_usd = [...new Set(out.grant.map(x => x.usd))].reduce((s, x) => s + x, 0);
  out.top_inv = out.investimenti.reduce((a, b) => (b.usd > (a?.usd || 0) ? b : a), null);
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const seen = new Set();
  /** Riassunto per la vista: "EUR 3.5M (aventure.vc), USD 1.0M (angelsround.com) · pre-seed". */
  out.riassunto = [...out.investimenti.map(x => ({ ...x, k: 'round' })), ...out.grant.map(x => ({ ...x, k: 'grant' }))]
    .filter(x => { const k = x.importo + host(x.url); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 4).map(x => `${x.k === 'grant' ? 'grant ' : ''}${x.importo} (${host(x.url)})`).join(', ') + (out.fase ? ` · ${out.fase}` : '') + (out.team ? ` · team di ${out.team} nelle notizie` : '');
  return out;
}
