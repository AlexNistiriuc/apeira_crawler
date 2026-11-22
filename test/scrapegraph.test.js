import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webSearch, setSearchFetch, searchStats, provider, searchLog, snippetOf } from '../src/lib/search.js';

test('ricerca con ScrapeGraph: niente LinkedIn, snippet dal contenuto, stop a crediti finiti', async () => {
  process.env.SCRAPEGRAPH_API_KEY = 'k';
  assert.equal(provider(), 'scrapegraph');
  const calls = [];
  setSearchFetch(async (url, opt) => {
    calls.push(JSON.parse(opt.body));
    if (calls.length === 2) return new Response('{}', { status: 402 });
    return Response.json({ results: [
      { url: 'https://www.linkedin.com/company/qubo', title: 'Qubo | LinkedIn', content: '11-50 employees' },
      { url: 'https://news.example/qubo', title: 'Qubo raises', content: '# Title\n[menu](x) Qubo raised €300k in a pre-seed round. Other text.' },
    ] });
  });
  const r = await webSearch('"Qubo" funding');
  assert.equal(r.length, 1, 'risultato LinkedIn scartato');
  assert.match(r[0].snippet, /Qubo raised €300k/);
  assert.match(calls[0].query, /-site:linkedin\.com/);
  assert.deepEqual(await webSearch('x'), []);
  assert.deepEqual(await webSearch('y'), [], 'crediti finiti: nessuna altra chiamata');
  assert.equal(calls.length, 2);
  assert.ok(searchLog().ricerche_scrapegraph >= 2);
  assert.equal(searchLog().ricerche_brave, 0, 'non conta sul tetto Brave');
  delete process.env.SCRAPEGRAPH_API_KEY;
  assert.equal(snippetOf('![img](a) Hello [world](b).', 'world'), 'Hello world.');
});
