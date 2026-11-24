// Lettonia: open data del registro delle imprese (dati.ur.gov.lv), due CSV con il punto e virgola.
// register.csv: società con data di registrazione; officers.csv: amministratori con codice personale mascherato
// (GGMMAA-*****) o data di nascita. Non c'è il codice di attività: si filtra per parole nel nome.
import { latviaAge, registryStats, registryFetch } from '../../lib/registry.js';

const BASE = () => process.env.LV_BASE || 'https://dati.ur.gov.lv';

/** Divide una riga CSV con ; e virgolette doppie ("" dentro le virgolette). */
export function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Legge un CSV riga per riga (in streaming) e chiama onRow con un oggetto per riga. */
export async function eachCsvRow(url, onRow, fetchImpl = registryFetch) {
  let r;
  try { r = await fetchImpl(url, { signal: AbortSignal.timeout(900000) }); } catch { registryStats.errori++; return 0; }
  if (!r.ok) { registryStats.errori++; return 0; }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', head = null, n = 0, pending = '';
  const take = line => {
    // una riga può contenere un a capo dentro le virgolette: si accumula finché le virgolette sono pari
    pending = pending ? pending + '\n' + line : line;
    if ((pending.match(/"/g) || []).length % 2) return;
    const cells = splitCsv(pending); pending = '';
    if (!head) { head = cells.map(h => h.replace(/^﻿/, '')); return; }
    const o = {}; head.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    n++; onRow(o);
  };
  for (;;) {
    let chunk; try { chunk = await reader.read(); } catch { registryStats.errori++; break; }   // file troncato: si usa quello che c'è
    const { value, done } = chunk;
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  }
  if (buf) take(buf);
  return n;
}

/**
 * Società lettoni registrate dal giorno indicato (SIA e AS, attive), con nome che fa pensare al deep tech,
 * e i loro amministratori con età. Un solo passaggio sui due file.
 */
export async function latviaCompanies(from, nameRe, fetchImpl = registryFetch) {
  registryStats.lv++;
  const comp = new Map();
  await eachCsvRow(`${BASE()}/register/register.csv`, r => {
    if (!r.registered || r.registered < from || String(r.terminated).trim() || String(r.closed).trim()) return;   // closed è uno spazio se attiva
    if (!/^(SIA|AS)$/.test(r.type)) return;
    const nome = r.name_in_quotes || r.name || '';
    if (!nameRe.test(nome)) return;
    comp.set(r.regcode, { paese: 'LV', numero: r.regcode, nome, costituita: r.registered, sito: '', url: `https://info.ur.gov.lv/#/legal-entity/${r.regcode}`, persone: [] });
  }, fetchImpl);
  if (!comp.size) return [];
  await eachCsvRow(`${BASE()}/officers/officers.csv`, o => {
    const c = comp.get(o.at_legal_entity_registration_number);
    if (!c || o.entity_type !== 'NATURAL_PERSON') return;
    const age = latviaAge(o.latvian_identity_number_masked, o.birth_date);
    c.persone.push({ nome: o.name, ruolo: o.position || o.governing_body || 'amministratore', ...(age || { min: null, max: null }) });
  }, fetchImpl);
  return [...comp.values()];
}
