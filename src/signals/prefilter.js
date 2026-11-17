// Prefiltro del crawler. Decide solo ciò che le evidenze dicono con certezza:
// scarta chi supera chiaramente una soglia, manda tutto il resto al classificatore.
// Non assegna Fit né voti: quello è compito dei classificatori (src/classifiers).
import * as P from './patterns.js';
import { CRITERIA as C } from '../lib/config.js';

export const STATO = { DA_VALUTARE: 'da_valutare', SCARTATA: 'scartata', MORTO: 'sito_morto', RICONTROLLA: 'da_ricontrollare' };

/** Controlli senza rete, appena scoperto il candidato. null se va avanti. */
export function preCheck({ dominio, hubs, trusted, anno_dichiarato }) {
  if (!trusted && P.JUNK.test(dominio)) return 'dominio di ente, media, investitore o big tech';
  if (!trusted && P.INVD.test(dominio)) return 'dominio da investitore o acceleratore';
  if (hubs.length && hubs.every(h => P.VCH.test(h))) return 'trovata solo in portfolio di VC (ha già raccolto)';
  if (hubs.length && hubs.every(h => P.JUNKHUB.test(h))) return 'trovata solo in directory generiche';
  if (anno_dichiarato && anno_dichiarato < C.min_founded_year) return `fondata nel ${anno_dichiarato} (dichiarato dalla fonte)`;
  return null;
}

/** Dopo RDAP. null se va avanti. */
export function ageCheck({ registrato, trusted }) {
  if (!trusted && registrato && registrato !== 'n/a' && registrato < C.domain_border_from) return `dominio registrato nel ${registrato.slice(0, 4)}`;
  return null;
}

export const okDeep = s => s.deep >= 4 && s.strong >= 1 && s.neg * 2 <= s.deep;

export function statedYears(s) {
  return [...new Set([...(s.yrs || []), ...(s.evd?.fy || [])])].filter(y => y >= 2010 && y <= 2026);
}

/** Serve il controllo su archive.org? Solo se l'età non è già chiara dal sito o dal dominio. */
export function needsWayback(s, registrato) {
  if (statedYears(s).some(y => y >= C.min_founded_year)) return false;
  return !registrato || registrato === 'n/a' || registrato < C.domain_young_from;
}

/**
 * Decisione dopo la lettura del sito.
 * @returns {{stato:string, motivo:string}}
 */
export function decide({ s, alive, trusted, registrato, archivio }) {
  const no = motivo => ({ stato: STATO.SCARTATA, motivo });
  if (!alive) return { stato: STATO.MORTO, motivo: 'sito non raggiungibile o vuoto' };
  if (s.corp && !trusted) return no('azienda grande o vecchia (quotata, centinaia di dipendenti, fondata prima del 2023)');
  if (s.inv && !trusted) return no('investitore, acceleratore o incubatore');
  if (s.fund.l >= 2) return no('round già chiuso: ' + s.fund.x.join(', '));
  if (!okDeep(s)) return no(`non deep tech (punteggio ${s.deep}, parole negative ${s.neg})`);
  const ys = statedYears(s);
  if (ys.length && Math.min(...ys) < C.min_founded_year) return no(`fondata nel ${Math.min(...ys)} (dichiarato sul sito)`);
  if (s.cmin && s.cmin < C.min_founded_year) return no(`sito con © dal ${s.cmin}`);
  if (archivio && archivio !== 'mai' && +archivio.slice(0, 4) < C.wayback_old_before_year) return no(`online dal ${archivio.slice(0, 4)} (archive.org)`);
  const note = [];
  if (!ys.length) note.push('anno di fondazione non dichiarato');
  if (s.fund.l === 1) note.push('possibile pre-seed: ' + s.fund.x.join(', '));
  if (!s.eu) note.push('angolo europeo non trovato sul sito');
  return { stato: STATO.DA_VALUTARE, motivo: note.join('; ') };
}
