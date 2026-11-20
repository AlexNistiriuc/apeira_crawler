// Crawler dei founder: stima l'età di CEO e CTO delle startup migliori con ricerca web + regole.
// Niente Sage. Una ricerca per persona ("Nome Cognome" + azienda), fatti espliciti estratti
// dall'algoritmo in signals/age.estimate.js. Risultato in db_candidati (eta_stimata, fonti_eta, eta_il),
// una volta sola per startup. Serve solo a ordinare Startup trovate.
// Uso: npm run founders -- [quante]   (default 100)
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { now, today } from '../../lib/config.js';
import { webSearch, searchEnabled, searchStats, monthlyUsed, setMonthlyUsed } from '../../lib/search.js';
import { estimateAge } from '../../signals/age.estimate.js';

const FIT = { Alto: 0, Medio: 1, Basso: 2 };

/** CEO e CTO dai nomi del crawler ("Anna Rossi (CEO), Marco Bianchi (CTO)"). */
export function ceoCto(founders) {
  const out = [];
  for (const f of String(founders || '').split(', ')) {
    const m = f.match(/^(.+?)\s*\((CEO|CTO)\)$/);
    if (m && !out.some(o => o.ruolo === m[2])) out.push({ nome: m[1].trim(), ruolo: m[2] });
  }
  return out;
}

/** Le migliori secondo Sage (quindi startup nuove), non escluse, per fit e voto. */
export function pickBest(evals, n) {
  const by = {};
  for (const v of evals) if (v.esito !== 'Esclusa' && v.classificatore === 'sage') by[v.dominio] = v;
  return Object.values(by).sort((a, b) => (FIT[a.fit] ?? 3) - (FIT[b.fit] ?? 3) || Number(b.voto) - Number(a.voto)).slice(0, n);
}

export async function run(n = 100, log = console.log) {
  const startedAt = now();
  const st = { candidate: 0, persone: 0, stimate: 0, senza_nomi: 0 };
  if (!searchEnabled()) { log('SEARCH_API_KEY mancante: stima età saltata'); st.saltato = 'manca SEARCH_API_KEY'; await logRun('crawler founder', startedAt, st); return st; }
  setMonthlyUsed(monthlyUsed(await read(TABS.log, { columns: ['inizio', 'statistiche'] })));
  const cands = new Map((await read(TABS.cand, { columns: ['dominio', 'nome', 'founder_nomi', 'eta_il'] })).map(c => [c.dominio, c]));
  const best = pickBest(await read(TABS.eval, { columns: ['dominio', 'classificatore', 'esito', 'fit', 'voto'] }), n)
    .map(v => cands.get(v.dominio)).filter(c => c && !c.eta_il);
  st.candidate = best.length;
  const out = [];
  for (const c of best) {
    const people = ceoCto(c.founder_nomi);
    if (!people.length) { st.senza_nomi++; out.push({ dominio: c.dominio, eta_il: today(), eta_stimata: 'CEO e CTO non identificati sul sito' }); continue; }
    const parts = [], fonti = [];
    for (const p of people) {
      st.persone++;
      const res = await webSearch(`"${p.nome}" ${c.nome || c.dominio}`);
      const e = estimateAge(p.nome, res);
      if (e.eta != null) st.stimate++;
      parts.push(`${p.ruolo} ${p.nome}: ${e.fascia}${e.tipo ? ` (${e.tipo}: "${e.prova.slice(0, 120)}")` : ''}`);
      if (e.fonte) fonti.push(e.fonte);
    }
    out.push({ dominio: c.dominio, eta_il: today(), eta_stimata: parts.join('; ') + ' · stima da fonti pubbliche, da confermare', fonti_eta: fonti.join(', ') });
    if (out.length >= 20) await upsert(TABS.cand, 'dominio', out.splice(0));
  }
  if (out.length) await upsert(TABS.cand, 'dominio', out);
  st.ricerche = { ...searchStats };
  st.ricerche_brave = searchStats.ricerche;
  await logRun('crawler founder', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(Number(process.argv[2] || 100)).catch(e => { console.error(e); process.exit(1); });
}
