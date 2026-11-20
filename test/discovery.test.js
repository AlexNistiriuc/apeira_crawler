import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';
process.env.SEARCH_API_KEY = 'k'; process.env.SEARCH_GAP_MS = '0'; process.env.NO_JINA = '1';
const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { setSearchFetch } = await import('../src/lib/search.js');
const { setFetch } = await import('../src/lib/http.js');
const { run, pickQueries, looksLikePool, score } = await import('../src/crawlers/discovery/index.js');

test('le combinazioni che rendono vengono scelte più spesso', () => {
  const stats = { tipo: { hackathon: { nuovi: 4, utili: 4 }, 'startup summit': { nuovi: 6, utili: 0 } }, settore: {}, luogo: {} };
  const qs = pickQueries(new Set(), stats, 5, () => 0.9);   // niente esplorazione
  assert.ok(qs.every(q => q.t === 'hackathon'), qs.map(q => q.q).join(' | '));
  assert.ok(score({ nuovi: 0, utili: 0 }) === 0.5);
});

test('test di pool: molti siti esterni e parole da pool', () => {
  const md = 'Our startups and teams, finalists of the cohort ' + Array.from({ length: 10 }, (_, i) => `[S${i}](https://startup${i}.ai/)`).join(' ');
  assert.equal(looksLikePool('https://hack.example/finalists', md).ok, true);
  assert.equal(looksLikePool('https://blog.example/post', 'Read our post [a](https://x.ai/)').ok, false);
});

test('giro completo: ricerca, test, nuovi hub in db_hub e domanda in db_scoperta', async () => {
  const gas = loadGas(); setSheetBackend(gas.backend);
  await upsert('db_hub', 'hub_id', [{ hub_id: 'old.eu', nome: 'Old', url: 'https://old.eu/', stato: 'attivo', candidati_da_valutare: '3' }]);
  const pool = html => new Response(`<html><head><title>Quantum Hackathon finalists</title></head><body><p>Our finalists and teams of the cohort</p>${Array.from({ length: 10 }, (_, i) => `<a href="https://team${i}.ai/">T${i}</a>`).join(' ')}<p>${'x '.repeat(400)}</p></body></html>`, { headers: { 'content-type': 'text/html' } });
  setFetch(async url => (String(url).includes('robots.txt') ? new Response('', { status: 404 }) : String(url).includes('qhack.eu') ? pool() : new Response('<html><body>nothing</body></html>', { headers: { 'content-type': 'text/html' } })));
  setSearchFetch(async () => Response.json({ web: { results: [{ title: 'QHack 2026', url: 'https://qhack.eu/finalists', description: 'finalists' }, { title: 'news', url: 'https://news.example/blog/x', description: '' }] } }));
  const st = await run({ log: () => {} });
  assert.equal(st.domande, 3);
  assert.equal(st.hub_nuovi, 1, 'lo stesso hub trovato da più domande entra una volta');
  const h = (await read('db_hub')).find(x => x.hub_id === 'qhack.eu/finalists');
  assert.match(h.origine, /^scoperta: /);
  assert.equal((await read('db_scoperta')).length, 3);
});
