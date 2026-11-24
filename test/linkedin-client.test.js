import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { structuredSearch, setSearchFetch, searchStats, resetSearchStats, provider } from '../src/lib/search.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.SCRAPEGRAPH_API_KEY = 'sg-test';
  resetSearchStats();
});

afterEach(() => {
  setSearchFetch((...args) => originalFetch(...args));
  delete process.env.SCRAPEGRAPH_API_KEY;
  delete process.env.SEARCH_API_KEY;
});

test('senza chiave non chiama nulla', async () => {
  delete process.env.SCRAPEGRAPH_API_KEY;
  let calls = 0;
  setSearchFetch(async () => { calls++; return Response.json({}); });
  assert.equal(provider(), '');
  assert.deepEqual(await structuredSearch('q'), { json: null, results: [] });
  assert.equal(calls, 0);
});

test('search strutturata: query senza LinkedIn, prompt e schema, JSON e risultati filtrati', async () => {
  assert.equal(provider(), 'scrapegraph');
  const seen = [];
  setSearchFetch(async (url, options) => {
    seen.push({ url, options });
    return Response.json({
      json: { employees: '11-50', founded_year: 2025 },
      results: [
        { url: 'https://www.linkedin.com/company/qubo', title: 'Qubo | LinkedIn', content: '11-50 employees' },
        { url: 'https://news.example/qubo', title: 'Qubo raises', content: '# Title\n[menu](x) Qubo raised €300k in a pre-seed round. Other text.' },
      ],
      usage: { creditsUsed: 2 },
    });
  });
  const result = await structuredSearch('"Qubo" company employees', {
    numResults: 4,
    prompt: 'Extract employees and founded year',
    schema: { type: 'object', properties: { employees: { type: 'string' } } },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://v2-api.scrapegraphai.com/api/search');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.headers['SGAI-APIKEY'], 'sg-test');
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.query, '"Qubo" company employees -site:linkedin.com');
  assert.equal(body.numResults, 4);
  assert.equal(body.prompt, 'Extract employees and founded year');
  assert.deepEqual(body.schema, { type: 'object', properties: { employees: { type: 'string' } } });
  assert.deepEqual(result.json, { employees: '11-50', founded_year: 2025 });
  assert.equal(result.results.length, 1, 'risultato LinkedIn scartato');
  assert.equal(result.results[0].url, 'https://news.example/qubo');
  assert.match(result.results[0].snippet, /Qubo raised €300k/);
  assert.equal(searchStats.ricerche, 1);
  assert.equal(searchStats.scrapegraph, 1);
});

test('402: errore skip, crediti finiti, nessuna altra chiamata', async () => {
  let calls = 0;
  setSearchFetch(async () => { calls++; return new Response('{}', { status: 402 }); });
  await assert.rejects(structuredSearch('x'), error => error.skip === true);
  assert.equal(searchStats.crediti_finiti, true);
  assert.equal(calls, 1);
  await assert.rejects(structuredSearch('y'), error => error.skip === true);
  assert.equal(calls, 1, 'dopo il 402 non si richiama ScrapeGraph');
  resetSearchStats();
  assert.equal(searchStats.crediti_finiti, undefined);
});

test('401: errore fatale, il runner può fermarsi', async () => {
  setSearchFetch(async () => Response.json({ error: { message: 'invalid key' } }, { status: 401 }));
  await assert.rejects(structuredSearch('x'), error => error.fatal === true);
  assert.equal(searchStats.errori, 1);
});
