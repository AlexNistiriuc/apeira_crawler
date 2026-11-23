// Crawler LinkedIn: black box per gli evaluator, cache, gate Alto/Medio, fallback Brave.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';

const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { setScrapeGraphFetch, resetScrapeGraphStats } = await import('../src/lib/scrapegraph.js');
const { setSearchFetch } = await import('../src/lib/search.js');
const {
  ensureLinkedin, composeLinkedinText, parseLinkedinText, clearLinkedinMemory,
  linkedinStats, resetLinkedinStats, run,
} = await import('../src/crawlers/linkedin/index.js');
const { run: foundersRun } = await import('../src/crawlers/founders/index.js');
const euristico = (await import('../src/classifiers/euristico.js')).default;
const { classifyQueue } = await import('../src/classifiers/run.js');

const originalFetch = globalThis.fetch;

const candidate = {
  dominio: 'qubo.ai', nome: 'Qubo', sito: 'https://qubo.ai/',
  founder_nomi: 'Anna Rossi (CEO), Marco Bianchi (CTO)',
  eta_il: '', eta_stimata: '', fonti_eta: '',
  evidenze: JSON.stringify({
    anni_dichiarati: [2025], eu: true, deep: 9, neg: 0, tags: ['Quantum'],
    dem: ['active pilot'], ts: { e: 3 }, fa: { a: [26, 30] }, evd: { g: [], i: [] },
  }),
};

function stubScrapeGraph(queries = []) {
  setScrapeGraphFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);
    if (/linkedin company/i.test(body.query)) {
      return Response.json({
        json: { company_name: 'Qubo', linkedin_url: 'https://linkedin.com/company/qubo', employees_range: '11-50', founded_year: 2025 },
        results: [{ url: 'https://linkedin.com/company/qubo', title: 'Qubo', content: '' }],
        usage: { creditsUsed: 1 },
      });
    }
    if (/"Anna Rossi"/.test(body.query)) {
      return Response.json({
        json: {
          name: 'Anna Rossi', role: 'CEO', linkedin_url: 'https://linkedin.com/in/anna',
          start_at_company: '2025-03',
          first_education: [
            { institution: 'ETH', degree: 'MSc', start_year: 2020, end_year: 2022 },
            { institution: 'Uni', degree: 'BSc', start_year: 2018, end_year: 2021 },
          ],
        },
        results: [{ url: 'https://linkedin.com/in/anna', title: 'Anna', content: '' }],
        usage: { creditsUsed: 1 },
      });
    }
    if (/"Marco Bianchi"/.test(body.query)) {
      return Response.json({
        json: {
          name: 'Marco Bianchi', role: 'CTO', linkedin_url: 'https://linkedin.com/in/marco',
          start_at_company: '2024',
          first_education: { institution: 'Politecnico', degree: 'MSc', end_year: 2020 },
        },
        results: [{ url: 'https://linkedin.com/in/marco', title: 'Marco', content: '' }],
        usage: { creditsUsed: 1 },
      });
    }
    return Response.json({ json: null, results: [] });
  });
}

function freshGas() {
  const gas = loadGas();
  setSheetBackend(gas.backend);
  return gas;
}

beforeEach(() => {
  process.env.SCRAPEGRAPH_API_KEY = 'sg-test';
  process.env.SCRAPEGRAPH_API_URL = 'https://v2-api.scrapegraphai.com/api';
  process.env.SCRAPEGRAPH_RETRY_MS = '0';
  process.env.SCRAPEGRAPH_MAX_FOUNDERS = '3';
  process.env.SCRAPEGRAPH_MAX_STARTUPS = '40';
  resetScrapeGraphStats();
  resetLinkedinStats();
  clearLinkedinMemory();
});

afterEach(() => {
  setScrapeGraphFetch((...args) => originalFetch(...args));
  setSearchFetch((...args) => originalFetch(...args));
  delete process.env.SCRAPEGRAPH_API_KEY;
  delete process.env.SCRAPEGRAPH_API_URL;
  delete process.env.SCRAPEGRAPH_RETRY_MS;
  delete process.env.SCRAPEGRAPH_MAX_FOUNDERS;
  delete process.env.SCRAPEGRAPH_MAX_STARTUPS;
  delete process.env.SCRAPEGRAPH_EXTRACT_FALLBACK;
  delete process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_GAP_MS;
});

test('testo deterministico e rileggibile: roundtrip compose/parse', () => {
  const text = composeLinkedinText({
    dipendenti: '11-50', fondata: 2025,
    founders: [
      { nome: 'Anna Rossi', ruolo: 'CEO', da: '2025-03', eta: 26, fascia: 'sotto 30' },
      { nome: 'Luca Verdi', ruolo: 'co-founder', da: '', eta: null, fascia: 'non determinabile' },
    ],
  }, { year: 2026, month: 11 });
  assert.equal(text, '[SG] Dipendenti: 11-50 | Fondata: 2025 | Founder: Anna Rossi (CEO) dal 2025-03 (1 anno), età ~26 (sotto 30); Luca Verdi (co-founder) dal n.d., età n.d.');
  const parsed = parseLinkedinText(text);
  assert.equal(parsed.disponibile, true);
  assert.equal(parsed.dipendenti, '11-50');
  assert.equal(parsed.fondata, 2025);
  assert.equal(parsed.founders.length, 2);
  assert.deepEqual(
    parsed.founders.map(f => [f.nome, f.ruolo, f.da, f.da_anno, f.eta, f.fascia]),
    [['Anna Rossi', 'CEO', '2025-03', 2025, 26, 'sotto 30'], ['Luca Verdi', 'co-founder', '', null, null, 'non determinabile']],
  );
  assert.equal(parseLinkedinText('niente da leggere'), null);
});

test('Fit Basso: nessuna chiamata ScrapeGraph', async () => {
  let calls = 0;
  setScrapeGraphFetch(async () => { calls++; return Response.json({}); });
  const result = await ensureLinkedin({ ...candidate }, { fit: 'Basso', write: false });
  assert.equal(result.disponibile, false);
  assert.match(result.motivo, /fit Basso/);
  assert.equal(calls, 0);
  assert.equal(linkedinStats.saltati_fit, 1);
});

test('Fit Alto: estrae dipendenti, fondazione, inizio founder ed età dalla prima educazione', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate }]);
  const queries = [];
  stubScrapeGraph(queries);
  const result = await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });

  assert.equal(result.disponibile, true);
  assert.equal(result.dipendenti, '11-50');
  assert.equal(result.fondata, 2025);
  assert.equal(result.founders.length, 2);
  assert.deepEqual(
    result.founders.map(f => [f.nome, f.ruolo, f.da, f.da_anno, f.eta, f.fascia]),
    [['Anna Rossi', 'CEO', '2025-03', 2025, 26, 'sotto 30'], ['Marco Bianchi', 'CTO', '2024', 2024, 30, '30-34']],
  );
  assert.match(result.testo, /^\[SG\] Dipendenti: 11-50 \| Fondata: 2025 \| Founder: Anna Rossi \(CEO\) dal 2025-03 \(1 anno\), età ~26 \(sotto 30\)/);
  assert.ok(queries.some(q => /linkedin company/i.test(q)));
  assert.ok(queries.some(q => /"Anna Rossi"/.test(q)));
  assert.ok(queries.some(q => /"Marco Bianchi"/.test(q)));

  const row = (await read('db_candidati'))[0];
  assert.equal(row.eta_stimata, result.testo);
  assert.match(row.fonti_eta, /linkedin\.com\/in\/anna/);
  assert.match(row.fonti_eta, /linkedin\.com\/company\/qubo/);
  assert.ok(row.eta_il, 'data di arricchimento salvata');
});

test('cache in memoria: la seconda chiamata non richiama ScrapeGraph', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate }]);
  const queries = [];
  stubScrapeGraph(queries);
  await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });
  const before = queries.length;
  const cached = await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });
  assert.equal(cached.fonte, 'cache');
  assert.equal(cached.dipendenti, '11-50');
  assert.equal(queries.length, before);
  assert.equal(linkedinStats.cache, 1);
});

test('cache nel foglio: rilegge [SG] da eta_stimata senza richiamare ScrapeGraph', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate }]);
  const queries = [];
  stubScrapeGraph(queries);
  const first = await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });
  clearLinkedinMemory();
  const row = (await read('db_candidati'))[0];
  const before = queries.length;
  const cached = await ensureLinkedin({ ...candidate, ...row }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(cached.fonte, 'cache');
  assert.equal(cached.dipendenti, '11-50');
  assert.equal(cached.founders[0].eta, 26);
  assert.equal(cached.fondata, first.fondata);
  assert.equal(queries.length, before);
});

test('errore fatale di ScrapeGraph: disponibile false e fatal true', async () => {
  freshGas();
  setScrapeGraphFetch(async () => Response.json({ error: { message: 'invalid key' } }, { status: 401 }));
  const result = await ensureLinkedin({ ...candidate, dominio: 'bad.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, false);
  assert.equal(result.fatal, true);
  assert.match(result.motivo, /invalid key/);
});

test('nessun dato trovato: disponibile false, non scrive una cache falsa', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate }]);
  setScrapeGraphFetch(async () => Response.json({ json: null, results: [] }));
  const result = await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });
  assert.equal(result.disponibile, false);
  assert.match(result.motivo, /nessun dato/);
  assert.equal((await read('db_candidati'))[0].eta_stimata, '');
});

test('scarta omonimi e profili di altre aziende', async () => {
  freshGas();
  setScrapeGraphFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    if (/linkedin company/i.test(body.query)) return Response.json({ json: { employees_range: '11-50', founded_year: 2025 } });
    return Response.json({ json: { name: 'Giulia Neri', current_company: 'Altra Srl', start_at_company: '2020', first_education: { start_year: 2010 } } });
  });
  const result = await ensureLinkedin({ ...candidate, dominio: 'namesake.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, true);
  assert.equal(result.dipendenti, '11-50');
  assert.equal(result.founders.length, 0, 'il profilo di un omonimo non entra nei dati');
});

test('search senza JSON: con SCRAPEGRAPH_EXTRACT_FALLBACK=1 prova extract su una pagina non-LinkedIn', async () => {
  process.env.SCRAPEGRAPH_EXTRACT_FALLBACK = '1';
  freshGas();
  const calls = [];
  setScrapeGraphFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(new URL(url).pathname);
    if (url.endsWith('/extract')) return Response.json({ json: { employees_range: '11-50', founded_year: 2025 } });
    return Response.json({ json: null, results: [{ url: 'https://crunchbase.com/qubo', title: 'Qubo', content: '' }] });
  });
  const result = await ensureLinkedin({ ...candidate, dominio: 'extract.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, true);
  assert.equal(result.dipendenti, '11-50');
  assert.equal(result.fondata, 2025);
  assert.ok(calls.includes('/api/extract'));
});

test('crawler autonomo: arricchisce le migliori Alto/Medio e scrive nel foglio', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate, stato_crawler: 'da_valutare' }]);
  await upsert('db_valutazioni', 'id', [{
    id: 'qubo.ai|sage', dominio: 'qubo.ai', classificatore: 'sage', versione: '1',
    valutato_il: '2026-11-23 10:00:00', esito: 'Needs verification', fit: 'Alto', voto: 80,
  }]);
  const queries = [];
  stubScrapeGraph(queries);
  const st = await run(10, () => {});
  assert.equal(st.candidate, 1);
  assert.equal(st.disponibili, 1);
  assert.equal(st.dipendenti, 1);
  assert.equal(st.founder, 2);
  assert.match((await read('db_candidati'))[0].eta_stimata, /^\[SG\]/);
});

test('il runner forza la black box: ogni evaluator riceve c.li', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate, stato_crawler: 'da_valutare', ultimo_check: '2026-11-23 10:00:00' }]);
  const queries = [];
  stubScrapeGraph(queries);
  let seen, seenAge;
  const clf = {
    name: 'prova', version: '1', parallel: 1,
    async classify(c) { seen = c.li; seenAge = c.eta_stimata; return { esito: 'Needs verification', fit: 'Medio', voto: 50, motivo: 'x' }; },
  };
  const st = await classifyQueue(clf, 10, () => {});
  assert.equal(st.scritte, 1);
  assert.ok(seen, 'c.li presente');
  assert.equal(seen.disponibile, true);
  assert.equal(seen.dipendenti, '11-50');
  assert.equal(seen.founders[0].eta, 26);
  assert.match(seenAge, /^\[SG\]/, 'anche le colonne in memoria sono aggiornate');
  assert.equal(st.linkedin.disponibili, 1);
});

test('euristico legge c.li: team, fondazione ed età LinkedIn finiscono nella valutazione', async () => {
  const result = await euristico.classify({
    ...candidate, ev: JSON.parse(candidate.evidenze),
    li: {
      disponibile: true, dipendenti: '11-50', fondata: 2025,
      founders: [{ nome: 'Anna Rossi', ruolo: 'CEO', da: '2025-03', eta: 26, fascia: 'sotto 30' }],
    },
  });
  assert.match(result.team, /LinkedIn 11-50/);
  assert.match(result.fondazione, /LinkedIn: 2025/);
  assert.match(result.eta_founder, /LinkedIn: Anna Rossi \(CEO\): ~26 \(sotto 30\), dal 2025-03/);
  assert.equal(result.under30, 'no', 'la stima LinkedIn non verifica under30');
});

test('founders usa ScrapeGraph e non Brave quando i dati LinkedIn ci sono', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate, stato_crawler: 'da_valutare' }]);
  await upsert('db_valutazioni', 'id', [{
    id: 'qubo.ai|sage', dominio: 'qubo.ai', classificatore: 'sage', versione: '1',
    valutato_il: '2026-11-23 10:00:00', esito: 'Needs verification', fit: 'Alto', voto: 80,
  }]);
  const queries = [];
  stubScrapeGraph(queries);
  let brave = 0;
  setSearchFetch(async () => { brave++; return Response.json({ web: { results: [] } }); });
  const st = await foundersRun(10, () => {});
  assert.equal(st.linkedin, 1);
  assert.equal(st.fallback_brave, 0);
  assert.equal(brave, 0);
  const row = (await read('db_candidati'))[0];
  assert.match(row.eta_stimata, /^\[SG\] Dipendenti: 11-50/);
  assert.match(row.fonti_eta, /dati LinkedIn via ScrapeGraph/);
  assert.equal(parseLinkedinText(row.eta_stimata).founders.length, 2, 'la cache del crawler founder resta rileggibile');
});

test('founders ripiega su Brave quando ScrapeGraph non trova nulla', async () => {
  process.env.SEARCH_API_KEY = 'k';
  process.env.SEARCH_GAP_MS = '0';
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate, stato_crawler: 'da_valutare' }]);
  await upsert('db_valutazioni', 'id', [{
    id: 'qubo.ai|sage', dominio: 'qubo.ai', classificatore: 'sage', versione: '1',
    valutato_il: '2026-11-23 10:00:00', esito: 'Needs verification', fit: 'Alto', voto: 80,
  }]);
  setScrapeGraphFetch(async () => Response.json({ json: null, results: [] }));
  let brave = 0;
  setSearchFetch(async () => {
    brave++;
    return Response.json({ web: { results: [{ title: 'Qubo team', url: 'https://uni.example/qubo', description: 'Anna Rossi (MSc 2023) leads Qubo.' }] } });
  });
  const st = await foundersRun(10, () => {});
  assert.equal(st.linkedin, 0);
  assert.equal(st.fallback_brave, 1);
  assert.equal(brave, 2, 'CEO e CTO cercati su Brave');
  assert.match((await read('db_candidati'))[0].eta_stimata, /CEO Anna Rossi: sotto 30/);
});
