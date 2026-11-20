// Esegue un classificatore sulla coda: candidati da_valutare che quel classificatore
// non ha ancora valutato (o ha valutato prima dell'ultimo controllo del crawler).
// Uso: npm run classify -- <nome> [limite]      es. npm run classify -- euristico 2000
//
// Pensato anche per valutatori lenti e a pagamento (Sage):
//  - più candidati in parallelo (clf.parallel, default 1);
//  - scrittura nel foglio a blocchi durante il giro: un giro interrotto non butta il lavoro già pagato;
//  - un errore su un candidato non ferma il giro (il candidato resta in coda per il giro dopo);
//  - un errore "fatale" (chiave mancante o non valida, credito finito) ferma subito tutto, per non sprecare;
//  - scadenza RUN_MINUTES: smette di prendere candidati nuovi e salva;
//  - a fine giro dice se in coda ne restano (per far ripartire la catena) e aggiorna la vista.
import { appendFileSync } from 'node:fs';
import { queue, logRun, views, writer, TABS } from '../lib/sheet.js';
import { now } from '../lib/config.js';
import { validateEvaluation } from './contract.js';

export async function classifyQueue(clf, limit = 500, log = console.log, { deadline = Infinity, refreshView = false } = {}) {
  const startedAt = now();
  if (clf.init) await clf.init();
  const rows = await queue(clf.name, limit, clf.rankBy);
  const out = writer(TABS.eval, 'id', clf.writeEvery || 200);
  const st = { classificatore: clf.name, in_coda: rows.length, scritte: 0, non_valide: 0, errori: 0, saltate_per_tempo: 0, esiti: {}, fit: {} };
  let fatal = null, i = 0;

  const worker = async () => {
    while (i < rows.length && !fatal) {
      if (Date.now() >= deadline) { st.saltate_per_tempo = rows.length - i; i = rows.length; break; }
      const c = rows[i++];
      try { c.ev = c.evidenze ? JSON.parse(c.evidenze) : {}; } catch { c.ev = {}; }
      let e;
      try { e = await clf.classify(c); }
      catch (err) {
        st.errori++;
        log(`errore su ${c.dominio}: ${err.message}`);
        if (err.fatal) { fatal = err.message; }
        continue;
      }
      const full = { id: `${c.dominio}|${clf.name}`, dominio: c.dominio, classificatore: clf.name, versione: clf.version, valutato_il: now(), ...e };
      const errs = validateEvaluation(full);
      if (errs.length) { st.non_valide++; log(`valutazione non valida per ${c.dominio}: ${errs.join('; ')}`); continue; }
      st.scritte++;
      st.esiti[full.esito] = (st.esiti[full.esito] || 0) + 1;
      st.fit[full.fit] = (st.fit[full.fit] || 0) + 1;
      await out.push(full);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, clf.parallel || 1) }, worker));
  await out.flush();

  if (fatal) st.fermato_per = fatal;
  if (clf.stats) { st.consumo = clf.stats(); if (st.consumo.ricerche_brave != null) st.ricerche_brave = st.consumo.ricerche_brave; }
  // altro lavoro: la coda era piena fino al limite, o è rimasto qualcosa per tempo o errori
  st.altro_lavoro = !fatal && (rows.length >= limit || st.saltate_per_tempo > 0);
  if (refreshView && st.scritte) { try { await views(); } catch (err) { log('vista non aggiornata: ' + err.message); } }
  await logRun('classificatore ' + clf.name, startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name = 'euristico', limit = '500'] = process.argv.slice(2);
  const mod = await import(`./${name}.js`).catch(() => { console.error(`Classificatore "${name}" non trovato in src/classifiers/`); process.exit(1); });
  const minutes = Number(process.env.RUN_MINUTES || 0);
  const deadline = minutes ? Date.now() + minutes * 60_000 : Infinity;
  classifyQueue(mod.default, Number(limit), console.log, { deadline, refreshView: process.env.REFRESH_VIEW === '1' })
    .then(st => {
      // per GitHub Actions: dice al workflow se far ripartire la catena
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `altro_lavoro=${st.altro_lavoro}\nscritte=${st.scritte}\n`);
      if (st.fermato_per) { console.error('fermato: ' + st.fermato_per); process.exit(2); }
    })
    .catch(e => { console.error(e); process.exit(1); });
}
