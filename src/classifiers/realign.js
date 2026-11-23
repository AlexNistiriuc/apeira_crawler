// Riallinea le valutazioni già scritte al criterio severo (strict.js), per tutti i classificatori.
// Non cancella righe: Alto senza prove → Medio (con cosa manca nel motivo), Esclusa → fit Basso.
// Uso: npm run realign            (DRY=1 per vedere solo i conteggi)
import { read, upsert, views, logRun, TABS } from '../lib/sheet.js';
import { now } from '../lib/config.js';
import { applyStrict } from './strict.js';

export async function realign({ dry = false, log = console.log } = {}) {
  const startedAt = now();
  const evals = await read(TABS.eval);
  const cands = new Map((await read(TABS.cand)).map(c => [c.dominio, c]));
  const st = { valutazioni: evals.length, alto_prima: 0, alto_dopo: 0, declassate: 0, esclusa_a_basso: 0, per_classificatore: {} };
  const changed = [];
  for (const e of evals) {
    if (e.fit === 'Alto') st.alto_prima++;
    if (e.fit !== 'Alto' && !(e.esito === 'Esclusa' && e.fit !== 'Basso')) continue;
    const c = cands.get(e.dominio);
    if (!c) { if (e.fit === 'Alto') st.alto_dopo++; continue; }
    const { _cambiata, ...out } = applyStrict(e, c);
    if (out.fit === 'Alto') st.alto_dopo++;
    if (!_cambiata) continue;
    if (e.fit === 'Alto') { st.declassate++; st.per_classificatore[e.classificatore] = (st.per_classificatore[e.classificatore] || 0) + 1; }
    else st.esclusa_a_basso++;
    changed.push(out);
  }
  if (!dry && changed.length) { await upsert(TABS.eval, 'id', changed); await views(); }
  if (!dry) await logRun('riallineamento criterio severo', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  realign({ dry: process.env.DRY === '1' }).catch(e => { console.error(e); process.exit(1); });
}
