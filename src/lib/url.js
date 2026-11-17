// Normalizzazione di URL e domini, e scarto dei domini che non possono essere startup.
import BLOCKED from '../../config/blocked-domains.js';

const TWO_LEVEL = /\.(co|org|ac|gov|com|net|ltd|plc)\.(uk|es|pt|il|nz|au|za|in|at|pl)$/;
const BAD_RE = /(\.gov(\.|$)|\.gouv\.|\.edu(\.|$)|\.ac\.[a-z]{2}$|(^|\.)uni-|universit|univ\.|college|hochschule|polimi\.it|ethz\.ch|epfl\.ch|tum\.de|kth\.se|aalto\.fi|tudelft\.nl|ucl\.ac|imperial\.ac|\.europa\.eu|bund\.de|admin\.ch|regione|comune\.|stadt|city\.|gemeente|kommune|\.mil$|cookie|consent|analytics|cdn\.|static\.|fonts\.|maps\.|apps\.apple|play\.google)/;

export function host(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\d?\./, ''); } catch { return ''; }
}

/** Dominio registrabile: sub.example.co.uk -> example.co.uk */
export function reg(h) {
  const p = h.split('.');
  return TWO_LEVEL.test(h) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

export function domainOf(u) { return reg(host(u)); }

/** true se l'host non può essere il sito di una startup */
export function bad(h) {
  if (!h || h.length < 4 || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (BAD_RE.test(h)) return true;
  const r = reg(h);
  return BLOCKED.some(b => h === b || h.endsWith('.' + b) || r === b);
}

export function normUrl(u) {
  return String(u || '').replace(/#.*$/, '').replace(/\/$/, '');
}

/** Chiave stabile di un hub: host + path senza slash finale. */
export function hubKey(u) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\d?\./, '') + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch { return ''; }
}

/** Link [testo](url) e URL nudi da un markdown. Ritorna [[testo, url], ...] */
export function links(md) {
  const out = [];
  const re = /\[([^\]]{0,140})\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(md))) out.push([m[1].replace(/!\[[^\]]*\]/g, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim(), m[2]]);
  const re2 = /(?:^|[\s(])(https?:\/\/[^\s)\]<>"'`]+)/g;
  while ((m = re2.exec(md))) out.push(['', m[1]]);
  return out;
}
