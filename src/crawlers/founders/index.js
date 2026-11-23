// Crawler dei founder: arricchisce le startup migliori (Alto/Medio) con i dati LinkedIn del
// crawler dedicato (dipendenti, anno di fondazione, data di inizio dei founder, età dalla prima
// esperienza educativa). Se ScrapeGraph non è configurato o non trova nulla, ripiega sulla stima
// Brave + regole già esistente. Scrive in db_candidati (eta_stimata, fonti_eta, eta_il), una volta
// sola per startup. I dati restano leggibili agli evaluator (Sage legge c.eta_stimata).
// Uso: npm run founders -- [quante]   (default 100)
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { now, today } from '../../lib/config.js';
import { webSearch, searchEnabled, searchStats, monthlyUsed, setMonthlyUsed } from '../../lib/search.js';
import { estimateAge } from '../../signals/age.estimate.js';
import { ceoCto, pickBest } from '../../signals/founders.js';
import { ensureLinkedin, linkedinStats, resetLinkedinStats } from '../linkedin/index.js';

export { ceoCto, pickBest };

export async function run(n = 100, log = console.log) {
  const startedAt = now();
  resetLinkedinStats();
  const st = { candidate: 0, persone: 0, stimate: 0, senza_nomi: 0, linkedin: 0, fallback_brave: 0 };
  if (!searchEnabled() && !process.env.SCRAPEGRAPH_API_KEY) {
    log('SEARCH_API_KEY e SCRAPEGRAPH_API_KEY mancanti: stima età saltata');
    st.saltato = 'mancano SEARCH_API_KEY e SCRAPEGRAPH_API_KEY';
    await logRun('crawler founder', startedAt, st);
    return st;
  }
  if (searchEnabled()) setMonthlyUsed(monthlyUsed(await read(TABS.log, { columns: ['inizio', 'statistiche'] })));
  const cands = new Map((await read(TABS.cand, {
    columns: ['dominio', 'nome', 'sito', 'founder_nomi', 'eta_il', 'eta_stimata', 'fonti_eta'],
  })).map(c => [c.dominio, c]));
  const best = pickBest(await read(TABS.eval, { columns: ['dominio', 'classificatore', 'esito', 'fit', 'voto'] }), n)
    .map(v => ({ ...cands.get(v.dominio), _fit: v.fit }))
    .filter(c => c && c.dominio && !c.eta_il);
  st.candidate = best.length;
  const out = [];
  const maxStartups = Number(process.env.SCRAPEGRAPH_MAX_STARTUPS || 40);
  let scrapegraphDown = false, scrapegraphUsed = 0;

  for (const c of best) {
    if (!scrapegraphDown && scrapegraphUsed < maxStartups) {
      const li = await ensureLinkedin(c, { fit: c._fit, write: false });
      if (li.fatal || li.tetto) scrapegraphDown = true;
      if (li.disponibile) {
        scrapegraphUsed++;
        st.linkedin++;
        out.push({
          dominio: c.dominio,
          eta_il: today(),
          eta_stimata: li.testo,
          fonti_eta: [li.fonti.join(', '), 'dati LinkedIn via ScrapeGraph, da confermare'].filter(Boolean).join(', '),
        });
        if (out.length >= 20) await upsert(TABS.cand, 'dominio', out.splice(0));
        continue;
      }
    }

    const people = ceoCto(c.founder_nomi);
    if (!people.length) { st.senza_nomi++; out.push({ dominio: c.dominio, eta_il: today(), eta_stimata: 'CEO e CTO non identificati sul sito' }); continue; }
    st.fallback_brave++;
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
  st.linkedin_stats = { ...linkedinStats };
  await logRun('crawler founder', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(Number(process.argv[2] || 100)).catch(e => { console.error(e); process.exit(1); });
}
