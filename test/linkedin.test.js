// Crawler LinkedIn: black box per gli evaluator, cache, gate Alto/Medio, colonne dedicate.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';

const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { setSearchFetch, resetSearchStats } = await import('../src/lib/search.js');
const {
  ensureLinkedin, composeLinkedinText, parseLinkedinText, clearLinkedinMemory,
  linkedinStats, resetLinkedinStats, run,
} = await import('../src/crawlers/linkedin/index.js');
const euristico = (await import('../src/classifiers/euristico.js')).default;
const { classifyQueue } = await import('../src/classifiers/run.js');

const originalFetch = globalThis.fetch;

const candidate = {
  dominio: 'qubo.ai', nome: 'Qubo', sito: 'https://qubo.ai/',
  founder_nomi: 'Anna Rossi (CEO), Marco Bianchi (CTO)',
  eta_il: '', eta_stimata: '', fonti_eta: '',
  linkedin_dati: '', linkedin_fonti: '', linkedin_il: '',
  evidenze: JSON.stringify({
    anni_dichiarati: [2025], eu: true, deep: 9, neg: 0, tags: ['Quantum'],
    dem: ['active pilot'], ts: { e: 3 }, fa: { a: [26, 30] }, evd: { g: [], i: [] },
  }),
};

function stubScrapeGraph(queries = []) {
  setSearchFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    queries.push(body.query);
    if (/company employees/i.test(body.query)) {
      return Response.json({
        json: { company_name: 'Qubo', linkedin_url: 'https://linkedin.com/company/qubo', employees_range: '11-50', founded_year: 2025 },
        results: [{ url: 'https://crunchbase.com/organization/qubo', title: 'Qubo', content: '' }],
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
        results: [{ url: 'https://ethz.ch/anna', title: 'Anna', content: '' }],
      });
    }
    if (/"Marco Bianchi"/.test(body.query)) {
      return Response.json({
        json: {
          name: 'Marco Bianchi', role: 'CTO', linkedin_url: 'https://linkedin.com/in/marco',
          start_at_company: '2024',
          first_education: { institution: 'Politecnico', degree: 'MSc', end_year: 2020 },
        },
        results: [{ url: 'https://polimi.it/marco', title: 'Marco', content: '' }],
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
  process.env.SEARCH_PAUSA = '0';
  process.env.SCRAPEGRAPH_API_KEY = 'sg-test';
  process.env.SCRAPEGRAPH_MAX_FOUNDERS = '3';
  process.env.SCRAPEGRAPH_MAX_STARTUPS = '40';
  process.env.SCRAPEGRAPH_CACHE_DAYS = '30';
  resetSearchStats();
  resetLinkedinStats();
  clearLinkedinMemory();
});

afterEach(() => {
  setSearchFetch((...args) => originalFetch(...args));
  delete process.env.SCRAPEGRAPH_API_KEY;
  delete process.env.SCRAPEGRAPH_MAX_FOUNDERS;
  delete process.env.SCRAPEGRAPH_MAX_STARTUPS;
  delete process.env.SCRAPEGRAPH_CACHE_DAYS;
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
  setSearchFetch(async () => { calls++; return Response.json({}); });
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
  assert.ok(queries.some(q => /company employees/i.test(q)));
  assert.ok(queries.some(q => /"Anna Rossi"/.test(q)));
  assert.ok(queries.some(q => /"Marco Bianchi"/.test(q)));
  assert.ok(queries.every(q => /-site:linkedin\.com/.test(q)), 'le pagine LinkedIn sono escluse dalla ricerca');

  const row = (await read('db_candidati'))[0];
  assert.equal(row.linkedin_dati, result.testo);
  assert.match(row.linkedin_fonti, /linkedin\.com\/in\/anna/);
  assert.match(row.linkedin_fonti, /linkedin\.com\/company\/qubo/);
  assert.match(row.linkedin_fonti, /crunchbase\.com/);
  assert.ok(row.linkedin_il, 'data di arricchimento salvata');
  assert.equal(row.eta_stimata, '', 'le colonne del crawler founder restano intatte');
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

test('cache nel foglio: rilegge [SG] da linkedin_dati senza richiamare ScrapeGraph', async () => {
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
  setSearchFetch(async () => Response.json({ error: { message: 'invalid key' } }, { status: 401 }));
  const result = await ensureLinkedin({ ...candidate, dominio: 'bad.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, false);
  assert.equal(result.fatal, true);
  assert.match(result.motivo, /ScrapeGraph 401/);
});

test('nessun dato trovato: disponibile false, non scrive una cache falsa', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate }]);
  setSearchFetch(async () => Response.json({ json: null, results: [] }));
  const result = await ensureLinkedin(candidate, { fit: 'Alto', write: true, year: 2026 });
  assert.equal(result.disponibile, false);
  assert.match(result.motivo, /nessun dato/);
  assert.equal((await read('db_candidati'))[0].linkedin_dati, '');
});

test('scarta omonimi e profili di altre aziende', async () => {
  freshGas();
  setSearchFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    if (/company employees/i.test(body.query)) return Response.json({ json: { employees_range: '11-50', founded_year: 2025 } });
    return Response.json({ json: { name: 'Giulia Neri', current_company: 'Altra Srl', start_at_company: '2020', first_education: { start_year: 2010 } } });
  });
  const result = await ensureLinkedin({ ...candidate, dominio: 'namesake.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, true);
  assert.equal(result.dipendenti, '11-50');
  assert.equal(result.founders.length, 0, 'il profilo di un omonimo non entra nei dati');
});

test('crediti finiti (402): la black box segnala il tetto e non insiste', async () => {
  setSearchFetch(async () => new Response('{}', { status: 402 }));
  const result = await ensureLinkedin({ ...candidate, dominio: 'credit.ai' }, { fit: 'Alto', write: false, year: 2026 });
  assert.equal(result.disponibile, false);
  assert.equal(result.tetto, true);
  assert.equal(linkedinStats.tetti, 1);
});

test('crawler autonomo: arricchisce le migliori Alto/Medio e scrive nelle colonne dedicate', async () => {
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
  const row = (await read('db_candidati'))[0];
  assert.match(row.linkedin_dati, /^\[SG\]/);
  assert.ok(row.linkedin_il);
  assert.equal(row.eta_stimata, '');
});

test('il runner forza la black box: ogni evaluator riceve c.li', async () => {
  freshGas();
  await upsert('db_candidati', 'dominio', [{ ...candidate, stato_crawler: 'da_valutare', ultimo_check: '2026-11-23 10:00:00' }]);
  const queries = [];
  stubScrapeGraph(queries);
  let seen, seenData, seenEta;
  const clf = {
    name: 'prova', version: '1', parallel: 1,
    async classify(c) {
      seen = c.li;
      seenData = c.linkedin_dati;
      seenEta = c.eta_stimata;
      return { esito: 'Needs verification', fit: 'Medio', voto: 50, motivo: 'x' };
    },
  };
  const st = await classifyQueue(clf, 10, () => {});
  assert.equal(st.scritte, 1);
  assert.ok(seen, 'c.li presente');
  assert.equal(seen.disponibile, true);
  assert.equal(seen.dipendenti, '11-50');
  assert.equal(seen.founders[0].eta, 26);
  assert.match(seenData, /^\[SG\]/, 'i dati sono anche nella colonna dedicata');
  assert.equal(seenEta, '', 'eta_stimata del crawler founder non viene sovrascritta');
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
