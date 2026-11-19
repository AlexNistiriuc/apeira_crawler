// Esegue un classificatore sulla coda: candidati da_valutare che quel classificatore
// non ha ancora valutato (o ha valutato prima dell'ultimo controllo del crawler).
// Uso: npm run classify -- <nome> [limite]      es. npm run classify -- euristico 2000
import { queue, upsert, logRun, TABS } from '../lib/sheet.js';
import { now } from '../lib/config.js';
import { validateEvaluation } from './contract.js';

export async function classifyQueue(clf, limit = 500, log = console.log) {
  const startedAt = now();
  const rows = await queue(clf.name, limit, clf.rankBy);
  const out = []; let bad = 0;
  for (const c of rows) {
    try { c.ev = c.evidenze ? JSON.parse(c.evidenze) : {}; } catch { c.ev = {}; }
    const e = await clf.classify(c);
    const full = { id: `${c.dominio}|${clf.name}`, dominio: c.dominio, classificatore: clf.name, versione: clf.version, valutato_il: now(), ...e };
    const errs = validateEvaluation(full);
    if (errs.length) { bad++; log(`valutazione non valida per ${c.dominio}: ${errs.join('; ')}`); continue; }
    out.push(full);
  }
  if (out.length) await upsert(TABS.eval, 'id', out);
  const st = { classificatore: clf.name, in_coda: rows.length, scritte: out.length, non_valide: bad, esiti: count(out, 'esito'), fit: count(out, 'fit') };
  await logRun('classificatore ' + clf.name, startedAt, st);
  log(JSON.stringify(st));
  return st;
}
const count = (a, k) => a.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name = 'euristico', limit = '500'] = process.argv.slice(2);
  const mod = await import(`./${name}.js`).catch(() => { console.error(`Classificatore "${name}" non trovato in src/classifiers/`); process.exit(1); });
  classifyQueue(mod.default, Number(limit)).catch(e => { console.error(e); process.exit(1); });
}
