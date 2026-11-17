// Letture derivate dalle evidenze, condivise da crawler (colonne leggibili) e classificatori.
import { CRITERIA as C } from '../lib/config.js';

/** Team: dichiarato, altrimenti profili LinkedIn sulla pagina team, altrimenti ruoli/1.6. */
export function teamEstimate(ts) {
  if (!ts) return { n: null, txt: 'n.d.', k: null };
  if (ts.e) return { n: ts.e, txt: `${ts.e} (dichiarato sul sito)`, k: 'e' };
  const li = (ts.li || []).length;
  if (li >= 2) return { n: li, txt: `${li} (profili LinkedIn sulla pagina team)`, k: 'li' };
  if (ts.r >= 2) { const n = Math.max(1, Math.round(ts.r / 1.6)); return { n, txt: `~${n} (ruoli elencati sul sito)`, k: 'r' }; }
  return { n: null, txt: 'n.d.', k: null };
}

const usd = x => x.amt * (C.fx_to_usd[x.cur] || 1);
const fmt = x => `${(x.cur || '').toUpperCase().replace('EUROS', 'EUR').replace('EURO', 'EUR')} ${x.amt >= 1e6 ? (x.amt / 1e6).toFixed(1) + 'M' : Math.round(x.amt / 1e3) + 'k'}`;

export function money(evd) {
  const g = evd?.g || [], i = evd?.i || [];
  const gU = g.reduce((s, x) => s + usd(x), 0), iU = i.reduce((s, x) => s + usd(x), 0);
  return {
    grantUsd: gU, invUsd: iU, hasGrant: g.length > 0, hasInv: i.length > 0,
    grantTxt: g.length ? `${g.map(fmt).join(' + ')} (grant/premi, ~USD ${(gU / 1e6).toFixed(2)}M)` : 'Not disclosed',
    invTxt: i.length ? `${i.map(fmt).join(' + ')} (investimento o non chiaro, ~USD ${(iU / 1e6).toFixed(2)}M)` : 'Not disclosed',
  };
}

const STRONG_SENIOR = /(\b[2-4]\d\+?\s?(years|yrs|anni|jahre|ans)\b|serial (entrepreneur|founder)|former (ceo|cto|coo|cfo|vp|vice president|managing director|head of|director|partner)|ex[- ](ceo|cto|coo|vp|director)|previously (founded|co-?founded|led|built)|exits?\b|exited|veteran|seasoned)/i;
const PROF = /(professor|prof\. dr)/i;

/** Stima (non verifica) dell'età dei founder dagli indizi del sito. */
export function founderAgeLabel(fa) {
  if (!fa) return 'n.d.';
  const ev = fa.ev || [];
  const sev = ev.filter(x => x[0] === '-').map(x => x.slice(1));
  const yev = ev.filter(x => x[0] === '+').map(x => x.slice(1));
  const year = new Date().getFullYear();
  const ages = [...(fa.a || []), ...(fa.g || []).map(g => year - (g - 24))];
  const young = fa.y > 0 || ages.some(a => a < 30);
  const strong = sev.some(x => STRONG_SENIOR.test(x)), prof = sev.some(x => PROF.test(x));
  const senior = strong || ages.some(a => a >= 40);
  const range = ages.length ? ` (età stimata ${Math.min(...ages)}-${Math.max(...ages)})` : '';
  const ex = (yev[0] || sev[0] || '').slice(0, 110);
  let lab = 'n.d.';
  if (young && senior) lab = 'Misti'; else if (young && prof) lab = 'Giovani (<30) con prof. nel team';
  else if (young) lab = 'Giovani (<30)'; else if (senior) lab = 'Senior (40+)'; else if (prof) lab = 'Spin-off accademico (prof. nel team)';
  return lab + range + (ex ? ` · "${ex}"` : '');
}

/** Lab: proprio, istituzionale/condiviso, nessuna evidenza. */
export function labAccess(evd) {
  if (evd?.lc) return { k: 'own', txt: 'lab proprio: ' + evd.lc.slice(0, 90) };
  if (evd?.lx) return { k: 'shared', txt: 'accesso istituzionale o condiviso: ' + evd.lx.slice(0, 90) };
  return { k: 'none', txt: 'nessuna evidenza' };
}
