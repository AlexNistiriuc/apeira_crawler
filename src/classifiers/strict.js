// Criterio severo per il fit Alto (23 nov 2026, dal report degli agenti di Tommaso).
// Alto solo se tutte e cinque le condizioni sono provate da una fonte, non dedotte:
//  1. fondazione 2025 o 2026 verificata (registro imprese o anno dichiarato sul sito);
//  2. età di ogni founder verificata (registro imprese o fonte esplicita con nome) e sotto 35;
//  3. settore deep tech provato (testo del sito con punteggio deep pieno);
//  4. angolo europeo (luogo europeo sul sito o registro europeo);
//  5. nessun criterio violato (questo lo controlla chi chiama: esclusioni e segnali di round).
// Medio = nessun criterio violato ma fondazione, età o settore non verificati.
// Basso = almeno un criterio violato, o fuori target.
// Lo usano l'euristico e il runner (guardia per ogni classificatore) e il riallineamento del foglio.
import { CRITERIA as C } from '../lib/config.js';
import { parseJson, founderCount } from '../signals/facts.js';

export const DEEP_MIN = 6;

/** @returns {{ok:boolean, manca:string[]}} cosa manca a un candidato (riga di db_candidati) per essere Alto */
export function strictAlto(c) {
  let ev = c.ev;
  if (!ev) { try { ev = c.evidenze ? JSON.parse(c.evidenze) : {}; } catch { ev = {}; } }
  const manca = [];
  const reg = parseJson(c.registro);
  const vAges = (parseJson(c.eta_verificate, []) || []).filter(a => Number.isFinite(+a.max));
  const inRange = y => y >= C.min_founded_year && y <= C.max_founded_year;

  // 1. fondazione
  const ry = Number(String(reg?.costituita || '').slice(0, 4));
  const fy = (ev.anni_dichiarati || []).filter(y => y >= 2010 && y <= 2030);
  const siteYear = fy.length ? Math.min(...fy) : 0;
  const oldCopyright = ev.cmin && ev.cmin < C.min_founded_year;
  const foundedOk = ry ? inRange(ry) : siteYear ? inRange(siteYear) && !oldCopyright : false;
  if (!foundedOk) manca.push(ry || siteYear ? 'fondazione 2025-2026 (fonte in conflitto)' : 'fondazione verificata');

  // 2. età di tutti i founder
  const siteAges = (ev.fa?.a || []).map(Number).filter(Number.isFinite);
  const nFounders = Math.max(founderCount(c.founder_nomi), siteAges.length, 1);
  const maxes = [...vAges.map(a => +a.max), ...siteAges];
  const covered = vAges.length + siteAges.length >= nFounders;
  if (!maxes.length || !covered) manca.push('età verificata di ogni founder');
  else if (Math.max(...maxes) > C.max_founder_age) manca.push(`founder sotto ${C.max_founder_age + 1} anni`);

  // 3. settore deep tech
  const score = (ev.deep || 0) - (ev.neg || 0);
  if (score < DEEP_MIN) manca.push('settore deep tech provato');

  // 4. angolo europeo
  if (!(ev.eu || reg?.paese)) manca.push('angolo europeo');

  return { ok: manca.length === 0, manca };
}

/**
 * Guardia comune: applica il criterio a una valutazione già fatta (di qualsiasi classificatore).
 * Esclusa → fit Basso; Alto senza tutte le prove → Medio, con cosa manca nel motivo e in da_verificare.
 * @returns {object} la valutazione corretta (nuovo oggetto) e `_cambiata` se è stata toccata
 */
export function applyStrict(e, c) {
  const out = { ...e };
  if (out.esito === 'Esclusa' && out.fit !== 'Basso') { out.fit = 'Basso'; out._cambiata = true; }
  if (out.fit === 'Alto') {
    const s = strictAlto(c);
    if (!s.ok) {
      out.fit = 'Medio';
      out.voto = Math.min(Number(out.voto) || 0, 69);
      const nota = 'per Alto manca: ' + s.manca.join(', ');
      if (!String(out.motivo || '').includes('per Alto manca')) out.motivo = `${out.motivo || ''} · ${nota}`.replace(/^ · /, '');
      const dv = String(out.da_verificare || '');
      out.da_verificare = [dv, ...s.manca.filter(m => !dv.includes(m))].filter(Boolean).join(', ');
      if (out.esito === 'Qualificata') out.esito = 'Needs verification';
      out._cambiata = true;
    }
  }
  return out;
}
