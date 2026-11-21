// Fatti su età dei founder e fase della startup, ricavati dai dati che raccolgono i crawler
// (ricerca Brave, registri). Funzioni pure, usate dal crawler founder e dai classificatori.
import { CRITERIA as C } from '../lib/config.js';

export const parseJson = (v, def = null) => { if (v == null || v === '') return def; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return def; } };

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const surname = n => fold(n).trim().split(/\s+/).pop();

/** Persone da cercare: CEO e CTO se il sito li indica, altrimenti i primi due founder elencati. */
export function pickPeople(founders) {
  const list = String(founders || '').split(', ').map(s => s.trim()).filter(Boolean);
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
  if (!e || e.eta == null || !/età dichiarata|anno di nascita/.test(e.tipo || '')) return null;
  const words = fold(person.nome).split(/\s+/).filter(w => w.length > 1);
  const prova = fold(e.prova);
  if (words.length < 2 || !words.every(w => prova.includes(w))) return null;
  const min = e.tipo === 'anno di nascita' ? e.eta - 1 : e.eta;
  return { nome: person.nome, ruolo: person.ruolo, min, max: e.eta, fonte: e.tipo === 'anno di nascita' ? 'anno di nascita in fonte pubblica' : 'età dichiarata in fonte pubblica', url: e.fonte || '' };
}

/** Persone del registro che sono founder: cognome tra i founder del sito; se il sito non ne elenca, tutti gli amministratori. */
export function registryFounders(reg, founders) {
  const persone = (reg?.persone || []).filter(p => p.min != null);
  const names = String(founders || '').split(', ').map(s => s.replace(/\s*\([^)]*\)\s*$/, '')).filter(Boolean);
  if (!names.length) return persone;
  const sn = new Set(names.map(surname));
  return persone.filter(p => sn.has(surname(p.nome)));
}

// ---------------------------------------------------------------- fase: notizie di funding

const FX = C.fx_to_usd || {};
const AMOUNT = /(?:(€|eur|euros?|\$|usd|£|gbp|chf)\s?(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|millions|mio|bn|billion)?\b|(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|millions|mio|bn|billion)?\s?(€|eur|euros?|usd|dollars|£|gbp|chf)\b)/gi;
const RAISE = /\b(rais(es|ed|ing)|secur(es|ed)|clos(es|ed)|lands?|landed|bags?|bagged|completes?|completed|announces?|announced|funding|financing|investment|round|backed)\b/i;
const GRANT = /\b(grant|grants|award(ed)?|prize|eic|horizon europe|exist|innosuisse|bpifrance|i-lab|i-nov|innovate uk|sbir|non-dilutive|subsid)/i;
const STAGE = [[/\bseries [a-d]\b/i, 'series'], [/(?<!pre-?)\bseed (round|funding|investment|financing)\b/i, 'seed'], [/\bpre-?seed\b/i, 'pre-seed']];

/**
 * Notizie di funding (risultati Brave filtrati) → importi e fase. Conta solo frasi che nominano la startup
 * (nome o dominio) insieme a un verbo di raccolta o a un grant: così un fondo che "raccoglie 100M" non conta.
 */
export function newsFunding(news, name, domain) {
  const out = { investimenti: [], grant: [], fase: '', inv_usd: 0, grant_usd: 0 };
  const nm = fold(name), dom = fold(domain), stem = dom.split('.')[0];
  const mentions = s => (nm.length >= 4 && s.includes(nm)) || (dom && s.includes(dom)) || (stem.length >= 5 && s.includes(stem));
  for (const n of news || []) {
    for (const sent of String(`${n.title || ''}. ${n.snippet || ''}`).split(/(?<=[.!?])\s+|\s…\s/)) {
      const f = fold(sent);
      if (!mentions(f)) continue;
      for (const [re, k] of STAGE) if (re.test(sent) && (!out.fase || k === 'series' || (k === 'seed' && out.fase === 'pre-seed'))) out.fase = k;
      const isGrant = GRANT.test(sent);
      if (!isGrant && !RAISE.test(sent)) continue;
      AMOUNT.lastIndex = 0;
      let m;
      while ((m = AMOUNT.exec(sent))) {
        const cur = (m[1] || m[6] || '').toLowerCase().replace(/^euros?$/, 'eur');
        const mult = /^(m|mn|million|millions|mio)$/i.test(m[3] || m[5] || '') ? 1e6 : /^(bn|billion)$/i.test(m[3] || m[5] || '') ? 1e9 : /^k$/i.test(m[3] || m[5] || '') ? 1e3 : 1;
        const amt = parseFloat(String(m[2] || m[4]).replace(',', '.')) * mult;
        if (!(amt >= 10000) || amt > 5e9) continue;
        const usd = Math.round(amt * (FX[cur] || 1));
        const it = { importo: `${cur.toUpperCase()} ${amt >= 1e6 ? (amt / 1e6).toFixed(1) + 'M' : Math.round(amt / 1e3) + 'k'}`, usd, url: n.url, frase: sent.trim().slice(0, 200) };
        (isGrant ? out.grant : out.investimenti).push(it);
      }
    }
  }
  out.inv_usd = Math.max(0, ...out.investimenti.map(x => x.usd));
  out.grant_usd = out.grant.reduce((s, x) => s + x.usd, 0);
  return out;
}
