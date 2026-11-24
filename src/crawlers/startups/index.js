// Crawler delle startup. Legge gli hub attivi da db_hub, scopre i candidati, li controlla
// e scrive ogni candidato in db_candidati. Aggiorna le statistiche degli hub letti.
// Avvio: npm run startups   (variabili: SHEET_API_URL, SHEET_API_TOKEN, opzionali JINA_KEY, RUN_MINUTES)
import { appendFileSync } from 'node:fs';
import { read, upsert, writer, logRun, TABS } from '../../lib/sheet.js';
import { host, reg, bad } from '../../lib/url.js';
import { deadlineFromNow, now, SOURCES } from '../../lib/config.js';
import { stats as httpStats, sleep, withTimeout } from '../../lib/http.js';
import { discover } from './discover.js';
import { adapterFor, runAdapter } from './directories.js';
import { checkCandidate } from './check.js';
import { STATO } from '../../signals/prefilter.js';

// undici (la fetch di Node) a volte lancia un AssertionError (assert(!this.paused)) dentro un evento
// del socket, fuori da ogni try/catch: il processo moriva e il giro andava perso. Lo ignoriamo e
// andiamo avanti (la richiesta coinvolta scade comunque per timeout). Ogni altro errore resta fatale.
const isUndiciBug = e => e && e.code === 'ERR_ASSERTION' && /undici/.test(String(e.stack));
process.on('uncaughtException', e => { if (isUndiciBug(e)) { console.warn('undici assertion ignorata:', e.message); return; } console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { if (isUndiciBug(e)) { console.warn('undici assertion ignorata (rejection)'); return; } console.error(e); process.exit(1); });

const HUB_PAR = Number(process.env.HUB_PAR || 4);
const CHECK_PAR = Number(process.env.CHECK_PAR || 16);
const RECRAWL_DAYS = Number(process.env.RECRAWL_DAYS || 7);
const MAX_HUBS = Number(process.env.MAX_HUBS || 400);
const HUB_MAX_FAILS = 3;
const RETRY_PER_RUN = Number(process.env.HUB_RETRY_PER_RUN || 15);
const CAND_TIMEOUT_MS = 240_000;      // un candidato non può tenere occupato un lavoratore per più di 4 minuti (lettura del sito intero compresa)
const HUB_TIMEOUT_MS = 8 * 60_000;    // un hub non può bloccare la scoperta per più di 8 minuti
const MAX_QUEUE = 1500;               // oltre questa coda la scoperta aspetta: inutile trovare più di quanto si riesce a controllare

export async function run({ deadline = deadlineFromNow(), log = console.log } = {}) {
  const startedAt = now();
  const st = { hub_letti: 0, scoperti: 0, nuovi: 0, controllati: 0, da_valutare: 0, scartati: 0, morti: 0, rimandati: 0 };

  const allHubs = await read(TABS.hub);
  // attivi e da_verificare (trovati dalla scoperta con un test leggero: se non rendono escono da soli)
  const hubs = allHubs.filter(h => (h.stato === 'attivo' || h.stato === 'da_verificare') && h.tipo !== 'rete');
  // irraggiungibili: un nuovo tentativo al mese, con più pazienza e Jina, invece di abbandonarli per sempre
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const retry = allHubs.filter(h => h.stato === 'irraggiungibile' && h.tipo !== 'rete' && String(h.ultimo_crawl || '').slice(0, 10) < monthAgo)
    .slice(0, RETRY_PER_RUN).map(h => ({ ...h, retry: true }));
  const known = new Map((await read(TABS.cand, { columns: ['dominio', 'hub_origine', 'stato_crawler', 'primo_visto', 'sito', 'nome'] })).map(r => [r.dominio, r]));
  log(`hub attivi ${hubs.length}, candidati già noti ${known.size}`);

  const cutoff = new Date(Date.now() - RECRAWL_DAYS * 864e5).toISOString().slice(0, 10);
  const yieldOf = h => (+h.candidati_da_valutare || 0) / Math.max(1, +h.candidati_trovati || 0);
  const due = hubs.filter(h => !h.ultimo_crawl || String(h.ultimo_crawl).slice(0, 10) < cutoff)
    .sort((a, b) => (a.ultimo_crawl ? 1 : 0) - (b.ultimo_crawl ? 1 : 0) || (+b.priorita || 0) - (+a.priorita || 0) || yieldOf(b) - yieldOf(a))
    .slice(0, MAX_HUBS).concat(retry);
  log(`hub da leggere in questo run ${due.length} (di cui ${retry.length} irraggiungibili da ritentare)`);

  const out = writer(TABS.cand, 'dominio', 200);   // blocchi grandi: ogni scrittura nel foglio ha un costo fisso
  const hubOut = writer(TABS.hub, 'hub_id', 50);
  const slowHosts = new Map();   // sito -> hub andati in timeout in questo giro
  const queue = [];                       // candidati nuovi da controllare
  const inRun = new Map();                // dominio -> candidato (dedup nel run)
  const extraHub = new Map();             // dominio noto -> nuovi hub da aggiungere a hub_origine

  // ricontrolli rimasti dal run precedente
  for (const r of known.values()) if (r.stato_crawler === STATO.RICONTROLLA) {
    const c = { dominio: r.dominio, sito: r.sito, nome: r.nome, hubs: String(r.hub_origine || '').split(', ').filter(Boolean), primo_visto: r.primo_visto };
    inRun.set(r.dominio, c); queue.push(c);
  }

  const offer = (item, hubName, trusted) => {
    const h = host(item.url); if (bad(h)) return;
    const d = reg(h);
    st.scoperti++;
    const k = known.get(d);
    if (k) {
      const hs = String(k.hub_origine || '').split(', ').filter(Boolean);
      if (!hs.includes(hubName)) { const set = extraHub.get(d) || new Set(hs); set.add(hubName); extraHub.set(d, set); }
      return;
    }
    let c = inRun.get(d);
    if (!c) { c = { dominio: d, sito: 'https://' + h + '/', nome: item.name || '', hubs: [], primo_visto: now() }; inRun.set(d, c); queue.push(c); st.nuovi++; }
    if (!c.hubs.includes(hubName)) c.hubs.push(hubName);
    if (trusted) { c.trusted = true; if (item.year) c.anno_dichiarato = item.year; if (item.descrizione) c.descrizione = item.descrizione; }
    if (item.name && !c.nome) c.nome = item.name;
  };

  let discovering = true;
  const discovery = (async () => {
    let i = 0;
    await Promise.all(Array.from({ length: HUB_PAR }, async () => {
      while (i < due.length && Date.now() < deadline) {
        while (queue.length > MAX_QUEUE && Date.now() < deadline) await sleep(2000);
        if (Date.now() >= deadline) break;
        const h = due[i++];
        const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
        // sito che va in timeout su 2 hub: gli altri suoi hub di questo giro si rimandano subito, senza aspettare 8 minuti l'uno
        if ((slowHosts.get(hostOf(h.url)) || 0) >= 2) {
          const f = (+h.fallimenti || 0) + 1;
          st.hub_scaduti = (st.hub_scaduti || 0) + 1;
          await hubOut.push({ hub_id: h.hub_id, fallimenti: f, ultimo_crawl: now(), ...(f >= HUB_MAX_FAILS ? { stato: 'irraggiungibile' } : {}) });
          continue;
        }
        try {
          const ad = adapterFor(h.url);
          const conf = SOURCES.directories.find(x => x.adapter === ad);
          const job = ad ? runAdapter(ad, h, h.cursore || '', conf?.max_pages_per_run || 400) : discover(h, { deep: /^(rete|directory)/.test(h.origine || '') || h.tipo === 'directory', slow: !!h.retry });
          const r = await withTimeout(job, HUB_TIMEOUT_MS, null);
          if (!r) {
            // tempo scaduto: conta come fallimento e va in fondo alla coda (prima restava in testa e bloccava ogni giro)
            const f = (+h.fallimenti || 0) + 1;
            st.hub_scaduti = (st.hub_scaduti || 0) + 1;
            const hs = hostOf(h.url); slowHosts.set(hs, (slowHosts.get(hs) || 0) + 1);
            log(`hub ${h.nome.slice(0, 40)}: tempo scaduto (${f}/${HUB_MAX_FAILS}), passa in fondo alla coda`);
            await hubOut.push({ hub_id: h.hub_id, fallimenti: f, ultimo_crawl: now(), ...(f >= HUB_MAX_FAILS ? { stato: 'irraggiungibile' } : {}) });
            continue;
          }
          for (const it of r.found) offer(it, h.nome, !!ad);
          st.hub_letti++;
          if (h.retry) {
            // ritentativo mensile: se risponde torna attivo, altrimenti si riprova fra un mese
            await hubOut.push(r.pages > 0 ? { hub_id: h.hub_id, stato: 'attivo', fallimenti: 0, ultimo_crawl: now(), pagine_lette: r.pages } : { hub_id: h.hub_id, ultimo_crawl: now() });
            st.ritentati = (st.ritentati || 0) + 1; if (r.pages > 0) st.recuperati = (st.recuperati || 0) + 1;
          } else if (r.pages === 0) {
            // niente letto: non aggiorna ultimo_crawl, così si riprova al prossimo run; dopo 3 fallimenti di fila si mette da parte
            const f = (+h.fallimenti || 0) + 1;
            await hubOut.push({ hub_id: h.hub_id, fallimenti: f, ...(f >= HUB_MAX_FAILS ? { stato: 'irraggiungibile', ultimo_crawl: now() } : {}) });
          } else {
            await hubOut.push({ hub_id: h.hub_id, ultimo_crawl: now(), pagine_lette: r.pages, fallimenti: 0, ...(ad ? { cursore: r.cursor } : {}) });
          }
          log(`hub ${h.nome.slice(0, 40)}: ${r.pages} pagine, ${r.found.length} link a startup`);
        } catch (e) { log(`hub ${h.nome} errore: ${e.message}`); }
      }
    }));
    discovering = false;
  })();

  const checking = Promise.all(Array.from({ length: CHECK_PAR }, async () => {
    while (Date.now() < deadline) {
      const c = queue.shift();
      if (!c) { if (!discovering) break; await sleep(500); continue; }
      try {
        const row = await withTimeout(checkCandidate(c), CAND_TIMEOUT_MS, () => ({ dominio: c.dominio, nome: c.nome, sito: c.sito, hub_origine: c.hubs.join(', '), primo_visto: c.primo_visto, ultimo_check: now(), stato_crawler: STATO.RICONTROLLA, motivo: 'controllo troppo lento, riprovo' }));
        st.controllati++;
        if (row.stato_crawler === STATO.DA_VALUTARE) st.da_valutare++;
        else if (row.stato_crawler === STATO.SCARTATA) st.scartati++;
        else if (row.stato_crawler === STATO.MORTO) st.morti++;
        else st.rimandati++;
        await out.push(row);
        if (row.stato_crawler === STATO.DA_VALUTARE) log(`da valutare ${c.dominio} [${row.settori}]`);
      } catch (e) { log(`errore su ${c.dominio}: ${e.message}`); }
    }
  }));

  await Promise.all([discovery, checking]);
  // candidati scoperti ma non controllati per fine tempo: restano da ricontrollare al prossimo run
  log(`fine tempo: ${queue.length} candidati scoperti ma non controllati, salvati come da_ricontrollare`);
  for (const c of queue) await out.push({ dominio: c.dominio, nome: c.nome, sito: c.sito, hub_origine: c.hubs.join(', '), primo_visto: c.primo_visto, ultimo_check: now(), stato_crawler: STATO.RICONTROLLA, motivo: 'non controllato per fine tempo del run' });
  st.rimandati += queue.length;
  await out.flush();

  if (extraHub.size) await upsert(TABS.cand, 'dominio', [...extraHub].map(([dominio, s]) => ({ dominio, hub_origine: [...s].join(', ') })));
  await hubOut.flush();
  await refreshHubStats(log);

  // altro lavoro: hub rimasti fuori dal tetto del giro o candidati non controllati. Se no, la catena si ferma
  // e la fa ripartire il crawler hub quando trova hub nuovi (così non gira un'ora per 3 startup).
  st.hub_da_leggere = due.length;
  st.altro_lavoro = due.length >= MAX_HUBS || st.rimandati > 0 || st.hub_letti < due.length;
  Object.assign(st, { http: httpStats });
  await logRun('crawler startup', startedAt, st);
  log('fine run', JSON.stringify(st));
  return st;
}

/** Ricalcola candidati_trovati e candidati_da_valutare di ogni hub da db_candidati. */
export async function refreshHubStats(log = console.log) {
  const hubs = await read(TABS.hub, { columns: ['hub_id', 'nome', 'stato', 'ultimo_crawl', 'candidati_trovati', 'candidati_da_valutare'] });
  const cands = await read(TABS.cand, { columns: ['hub_origine', 'stato_crawler'] });
  const n = {}, y = {};
  for (const c of cands) for (const h of String(c.hub_origine || '').split(', ').filter(Boolean)) { n[h] = (n[h] || 0) + 1; if (c.stato_crawler === STATO.DA_VALUTARE) y[h] = (y[h] || 0) + 1; }
  const rows = [];
  for (const h of hubs) {
    const row = { hub_id: h.hub_id };
    if ((n[h.nome] || 0) !== (+h.candidati_trovati || 0) || (y[h.nome] || 0) !== (+h.candidati_da_valutare || 0)) Object.assign(row, { candidati_trovati: n[h.nome] || 0, candidati_da_valutare: y[h.nome] || 0 });
    // hub "da_verificare" già letti: se hanno dato almeno una startup da valutare diventano attivi, altrimenti escono
    if (h.stato === 'da_verificare' && h.ultimo_crawl) row.stato = (y[h.nome] || 0) > 0 ? 'attivo' : 'senza_resa';
    if (Object.keys(row).length > 1) rows.push(row);
  }
  if (rows.length) await upsert(TABS.hub, 'hub_id', rows);
  log(`statistiche aggiornate su ${rows.length} hub`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // un errore imprevisto su un singolo sito non deve uccidere un giro da 45 minuti
  process.on('uncaughtException', e => console.error('errore imprevisto ignorato:', e?.message || e));
  process.on('unhandledRejection', e => console.error('promessa rifiutata ignorata:', e?.message || e));
  run().then(st => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `altro_lavoro=${st.altro_lavoro}\nhub_letti=${st.hub_letti}\n`);
    // fine esplicita: timer e connessioni rimaste aperte tenevano vivo il processo fino a 40 minuti dopo la fine del lavoro
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
