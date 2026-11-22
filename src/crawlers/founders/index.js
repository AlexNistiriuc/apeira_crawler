// Crawler dei fatti su founder e fase. Per le startup migliori (Sage, Claude o, se non c'è altro, l'euristico
// con fit Alto o Medio) raccoglie una volta sola:
//  1. registro delle imprese (Francia e Regno Unito, gratis): data di costituzione, amministratori con anno di
//     nascita (età verificata), aumenti di capitale UK (segno di round);
//  2. età dei founder: una ricerca Brave per persona (CEO e CTO, altrimenti i primi due founder), solo per chi
//     il registro non copre. Età o anno di nascita dichiarati con nome e cognome nella frase = età verificata,
//     il resto resta una stima che serve solo a ordinare;
//  3. notizie di funding: una ricerca Brave, salvata, così Sage e Claude la riusano senza pagarla di nuovo.
// Scrive in db_candidati (registro, eta_verificate, notizie_funding, fatti_il; eta_stimata, fonti_eta, eta_il) e,
// se trova fatti che cambiano la decisione, aggiorna ultimo_check così i valutatori ripassano la startup.
// Uso: npm run founders -- [quante]   (default 100)
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { now, today } from '../../lib/config.js';
import { checkCandidate } from '../startups/check.js';
import { webSearch, searchEnabled, searchStats, monthlyUsed, setMonthlyUsed, searchLog, provider } from '../../lib/search.js';
import { registryLookup, registryStats } from '../../lib/registry.js';
import { estimateAge } from '../../signals/age.estimate.js';
import { pickPeople, verifiedFromEstimate, registryFounders, newsFunding, companyName, parseJson } from '../../signals/facts.js';

const FIT = { Alto: 0, Medio: 1, Basso: 2 };
const PREC = { sage: 0, claude: 1, euristico: 2 };
const trim = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Compatibilità: solo CEO e CTO. */
export const ceoCto = founders => pickPeople(founders).filter(p => p.ruolo !== 'founder');

/** Per ogni startup il giudizio del valutatore con la precedenza (sage, claude, euristico); fuori le escluse e l'euristico con fit Basso. */
export function pickBest(evals, n) {
  const by = {};
  for (const v of evals) {
    const p = PREC[v.classificatore];
    if (p === undefined) continue;
    if (!by[v.dominio] || p < by[v.dominio]._p) by[v.dominio] = { ...v, _p: p };
  }
  return Object.values(by).filter(v => v.esito !== 'Esclusa' && !(v.classificatore === 'euristico' && v.fit === 'Basso'))
    .sort((a, b) => (FIT[a.fit] ?? 3) - (FIT[b.fit] ?? 3) || a._p - b._p || Number(b.voto) - Number(a.voto)).slice(0, n);
}

/** Stessa ricerca e stesso filtro che usava Sage: risultati che nominano la startup. */
export async function fundingNews(c) {
  const name = companyName(c);
  const res = await webSearch(`"${name}" funding OR raises OR "pre-seed" OR seed OR grant OR award`);
  const dom = String(c.dominio || '').toLowerCase(), nm = String(name).toLowerCase();
  return res.filter(x => { const h = `${x.url} ${x.title} ${x.snippet}`.toLowerCase(); return h.includes(dom) || (nm.length > 4 && h.includes(nm)); })
    .slice(0, 6).map(x => ({ title: trim(x.title, 200), url: x.url, snippet: trim(x.snippet, 600) }));
}

/**
 * @param {number} n  quante startup al massimo (le migliori senza fatti)
 * @param {Function} log
 * @param {string[]} domini  richiesta di un valutatore: queste startup si riapprofondiscono comunque
 *   (sito intero riletto e ricerche rifatte), anche se avevano già i fatti
 */
export async function run(n = 100, log = console.log, domini = []) {
  const startedAt = now();
  const st = { candidate: 0, registro_trovato: 0, persone: 0, stimate: 0, eta_verificate: 0, notizie: 0, fatti_decisivi: 0, senza_nomi: 0 };
  const search = searchEnabled();
  if (search) setMonthlyUsed(monthlyUsed(await read(TABS.log, { columns: ['inizio', 'statistiche'] })));
  else log('nessuna chiave di ricerca (SCRAPEGRAPH_API_KEY o SEARCH_API_KEY): solo registri');
  const all = await read(TABS.cand, { columns: ['dominio', 'nome', 'founder_nomi', 'descrizione', 'hub_origine', 'eta_il', 'eta_stimata', 'fatti_il', 'notizie_funding', 'round_notizie'] });
  // riassunto dei round per chi ha già le notizie salvate (nessuna ricerca): lo vede la vista e l'agente di outreach
  // si ricalcola per tutti (regole cambiate = riassunto diverso); si scrive solo dove cambia
  const back = all.filter(c => c.notizie_funding).map(c => {
    const news = parseJson(c.notizie_funding, []) || [];
    const f = newsFunding(news, companyName(c), c.dominio);
    return { dominio: c.dominio, round_notizie: f.riassunto || (news.length ? 'nessun importo' : 'nessuna notizia'), ultimo_check: now(), _old: c.round_notizie };
  }).filter(r => r.round_notizie !== r._old).map(({ _old, ...r }) => r);
  if (back.length) { await upsert(TABS.cand, 'dominio', back); st.riassunti_recuperati = back.length; }
  const cands = new Map(all.map(c => [c.dominio, c]));
  const forced = domini.map(d => cands.get(d)).filter(Boolean);
  const best = [...forced.map(c => ({ ...c, fatti_il: '', eta_il: '', _forza: true })), ...pickBest(await read(TABS.eval, { columns: ['dominio', 'classificatore', 'esito', 'fit', 'voto'] }), Infinity)
    .map(v => cands.get(v.dominio)).filter(c => c && !c.fatti_il && !domini.includes(c.dominio)).slice(0, n)];
  if (forced.length) {
    // sito intero riletto per le startup chieste dal valutatore
    const full = await read(TABS.cand, { columns: ['dominio', 'nome', 'sito', 'hub_origine', 'primo_visto'] });
    const rows = [];
    for (const c of full.filter(x => domini.includes(x.dominio))) {
      const r = await checkCandidate({ dominio: c.dominio, sito: c.sito, nome: c.nome, hubs: String(c.hub_origine || '').split(', ').filter(Boolean), primo_visto: c.primo_visto, trusted: false }).catch(() => null);
      if (r) rows.push(r);
    }
    if (rows.length) await upsert(TABS.cand, 'dominio', rows);
    st.riletti = rows.length;
  }
  st.candidate = best.length;
  const out = [];
  for (const c of best) {
    const row = { dominio: c.dominio, fatti_il: today() };
    let decisive = false;
    // 1. registro
    const reg = await registryLookup(c).catch(() => null);
    const verified = [];
    if (reg) {
      st.registro_trovato++;
      row.registro = JSON.stringify({ ...reg, persone: reg.persone.map(p => ({ nome: p.nome, ruolo: p.ruolo, min: p.min, max: p.max })) });
      for (const p of registryFounders(reg, c.founder_nomi)) verified.push({ nome: p.nome, ruolo: p.ruolo, min: p.min, max: p.max, fonte: `registro imprese ${reg.paese}`, url: reg.url });
      decisive = true;
    }
    const oldCompany = reg && reg.costituita && Number(reg.costituita.slice(0, 4)) < 2025;
    // 2. età dei founder (se il registro non le copre già e non le abbiamo già cercate)
    const covered = n2 => verified.some(v => v.nome.toLowerCase().split(' ').pop() === n2.toLowerCase().split(' ').pop());
    const people = pickPeople(c.founder_nomi).filter(p => !covered(p.nome));
    // il vecchio crawler segnava "non identificati" chi non aveva CEO o CTO: ora si riprova con i founder elencati
    const ageDone = c.eta_il && !/non identificati/.test(c.eta_stimata || '');
    if (search && !oldCompany && !ageDone) {
      if (!pickPeople(c.founder_nomi).length) { st.senza_nomi++; row.eta_il = today(); row.eta_stimata = 'CEO e CTO non identificati sul sito'; }
      else if (people.length) {
        const parts = [], fonti = [];
        for (const p of people) {
          st.persone++;
          const res = await webSearch(`"${p.nome}" ${companyName(c)}`);
          const e = estimateAge(p.nome, res);
          if (e.eta != null) st.stimate++;
          const v = verifiedFromEstimate(p, e);
          if (v) verified.push(v);
          parts.push(`${p.ruolo} ${p.nome}: ${e.fascia}${e.tipo ? ` (${e.tipo}: "${e.prova.slice(0, 120)}")` : ''}`);
          if (e.fonte) fonti.push(e.fonte);
        }
        row.eta_il = today();
        row.eta_stimata = parts.join('; ') + ' · stima da fonti pubbliche, da confermare';
        row.fonti_eta = fonti.join(', ');
      }
    }
    row.eta_verificate = JSON.stringify(verified);
    if (verified.length) { st.eta_verificate += verified.length; decisive = true; }
    // 3. notizie di funding (fase)
    if (search && !oldCompany) {
      const news = await fundingNews(c);
      row.notizie_funding = JSON.stringify(news);
      if (news.length) st.notizie++;
      const f = newsFunding(news, companyName(c), c.dominio);
      row.round_notizie = f.riassunto || (news.length ? 'nessun importo' : 'nessuna notizia');
      if (f.investimenti.length || f.grant.length || f.fase || f.team) decisive = true;
    }
    if (decisive) { st.fatti_decisivi++; row.ultimo_check = now(); }
    if (!search) delete row.fatti_il; // senza Brave si riprova al prossimo giro (i registri sono gratis)
    out.push(row);
    if (out.length >= 20) await upsert(TABS.cand, 'dominio', out.splice(0));
  }
  if (out.length) await upsert(TABS.cand, 'dominio', out);
  st.registri = { ...registryStats };
  st.ricerche = { ...searchStats };
  Object.assign(st, searchLog());
  await logRun('crawler founder', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(Number(process.argv[2] || 100), console.log, String(process.env.DOMINI || '').split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean)).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
