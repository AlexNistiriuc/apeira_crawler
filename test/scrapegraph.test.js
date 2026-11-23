import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  search, extract, scrapegraphEnabled, setScrapeGraphFetch, scrapeGraphStats, resetScrapeGraphStats,
} from '../src/lib/scrapegraph.js';

const originalFetch = globalThis.fetch;
let seen = [];

beforeEach(() => {
  process.env.SCRAPEGRAPH_API_KEY = 'sg-test';
  process.env.SCRAPEGRAPH_API_URL = 'https://v2-api.scrapegraphai.com/api';
  process.env.SCRAPEGRAPH_RETRY_MS = '0';
  resetScrapeGraphStats();
  seen = [];
});

afterEach(() => {
  setScrapeGraphFetch((...args) => originalFetch(...args));
  delete process.env.SCRAPEGRAPH_API_KEY;
  delete process.env.SCRAPEGRAPH_API_URL;
  delete process.env.SCRAPEGRAPH_RETRY_MS;
  delete process.env.SCRAPEGRAPH_MAX_PER_RUN;
});

test('senza chiave il client è spento e search fallisce in modo fatale', async () => {
  delete process.env.SCRAPEGRAPH_API_KEY;
  assert.equal(scrapegraphEnabled(), false);
  await assert.rejects(search('q'), error => error.fatal === true && /SCRAPEGRAPH_API_KEY/.test(error.message));
});

test('search: URL, header SGAI-APIKEY, body e risposta strutturata', async () => {
  setScrapeGraphFetch(async (url, options) => {
    seen.push({ url, options });
    return Response.json({
      json: { employees: '11-50', founded_year: 2025 },
      results: [{ title: 'Qubo', url: 'https://linkedin.com/company/qubo', content: '11-50 employees' }],
      usage: { promptTokens: 10, completionTokens: 5, creditsUsed: 2 },
    });
  });
  const result = await search('"Qubo" linkedin company', {
    numResults: 4,
    prompt: 'Extract employees and founded year',
    schema: { type: 'object', properties: { employees: { type: 'string' } } },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://v2-api.scrapegraphai.com/api/search');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.headers['SGAI-APIKEY'], 'sg-test');
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.query, '"Qubo" linkedin company');
  assert.equal(body.numResults, 4);
  assert.equal(body.prompt, 'Extract employees and founded year');
  assert.deepEqual(body.schema, { type: 'object', properties: { employees: { type: 'string' } } });
  assert.deepEqual(result.json, { employees: '11-50', founded_year: 2025 });
  assert.equal(result.results[0].url, 'https://linkedin.com/company/qubo');
  assert.equal(scrapeGraphStats.crediti, 2);
  assert.equal(scrapeGraphStats.chiamate, 1);
});

test('extract: URL e prompt, risposta json e fonte', async () => {
  setScrapeGraphFetch(async (url, options) => {
    seen.push({ url, options });
    return Response.json({ json: { title: 'Qubo' }, usage: { promptTokens: 3 } });
  });
  const result = await extract('https://qubo.ai/about', { prompt: 'Extract the title', mode: 'reader' });
  assert.equal(seen[0].url, 'https://v2-api.scrapegraphai.com/api/extract');
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.url, 'https://qubo.ai/about');
  assert.equal(body.prompt, 'Extract the title');
  assert.equal(body.mode, 'reader');
  assert.deepEqual(result.json, { title: 'Qubo' });
  assert.deepEqual(result.sources, ['https://qubo.ai/about']);
});

test('401 è fatale: un solo tentativo, nessuna spesa ulteriore', async () => {
  let calls = 0;
  setScrapeGraphFetch(async () => {
    calls++;
    return Response.json({ error: { message: 'invalid key' } }, { status: 401 });
  });
  await assert.rejects(search('q'), error => error.fatal === true && /invalid key/.test(error.message));
  assert.equal(calls, 1);
  assert.equal(scrapeGraphStats.errori, 1);
});

test('500 è ritentato e poi riesce', async () => {
  let calls = 0;
  setScrapeGraphFetch(async () => {
    calls++;
    if (calls === 1) return Response.json({ error: { message: 'boom' } }, { status: 500 });
    return Response.json({ json: { ok: true }, results: [] });
  });
  const result = await search('q');
  assert.equal(calls, 2);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(scrapeGraphStats.errori, 0);
});

test('tetto per giro: nessuna chiamata pagata oltre il limite', async () => {
  process.env.SCRAPEGRAPH_MAX_PER_RUN = '0';
  let calls = 0;
  setScrapeGraphFetch(async () => { calls++; return Response.json({}); });
  await assert.rejects(search('q'), error => error.skip === true && /tetto/.test(error.message));
  assert.equal(calls, 0);
  assert.equal(scrapeGraphStats.saltate_tetto, 1);
});

test('risposta non JSON: errore leggibile', async () => {
  setScrapeGraphFetch(async () => new Response('<html>nope</html>', { status: 200 }));
  await assert.rejects(search('q'), /non JSON/);
});
