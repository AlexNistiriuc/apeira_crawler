import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';
process.env.SEARCH_API_KEY = 'k'; process.env.SEARCH_GAP_MS = '0'; process.env.NO_JINA = '1';
const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { setSearchFetch } = await import('../src/lib/search.js');
const { setFetch } = await import('../src/lib/http.js');
const { run, candidates, pickQueries, looksLikePool, poolLinks } = await import('../src/crawlers/discovery/index.js');

const empty = { tipo: {}, settore: {}, luogo: {}, coppia: {} };

test('1. prima domande larghe (liste e tipo + paese), settore e città solo dove i pattern rendono', () => {
  const base = candidates(new Set(), empty);
  assert.ok(base.every(x => x.livello <= 1));
  assert.ok(base.some(x => x.q === 'list of hackathons in Germany'));
  const s2 = { ...empty, tipo: { hackathon: { nuovi: 2, utili: 1 } } };
  const c2 = candidates(new Set(), s2);
  assert.ok(c2.some(x => x.livello === 2 && x.t === 'hackathon'));
  assert.ok(!c2.some(x => x.livello === 3), 'livello 3 solo per coppie tipo|settore che rendono');
  const s3 = { ...s2, coppia: { 'hackathon|quantum': { nuovi: 1, utili: 1 } } };
  assert.ok(candidates(new Set(), s3).some(x => x.q === 'quantum hackathon Munich 2026'));
  assert.ok(pickQueries(new Set(), s2, 3, () => 0.9).every(x => x.t === 'hackathon'));
});

test('2-3. test a due soglie e link di una pagina-lista', () => {
  const md = n => 'Our startups, teams and finalists ' + Array.from({ length: n }, (_, i) => `[S${i}](https://startup${i}.ai/)`).join(' ');
  assert.equal(looksLikePool('https://hack.example/finalists', md(10)).stato, 'attivo');
  assert.equal(looksLikePool('https://hack.example/finalists', md(6)).stato, 'da_verificare');
  assert.equal(looksLikePool('https://blog.example/post', 'Read [a](https://x.ai/)').ok, false);
  const list = '[Accelerator A](https://a-accelerator.de/) [B Incubator](https://b.eu/incubator) [News](https://news.com/x)';
  assert.deepEqual(poolLinks('https://list.example/top', list).map(x => x.url), ['https://a-accelerator.de/', 'https://b.eu/incubator']);
});

test('giro completo: una pagina-lista porta più hub; snowball dalle pagine partner di un hub', async () => {
  const gas = loadGas(); setSheetBackend(gas.backend);
  await upsert('db_hub', 'hub_id', [{ hub_id: 'old.eu', nome: 'Old', url: 'https://old.eu/', stato: 'attivo', candidati_da_valutare: '3' }]);
  const page = (title, body) => new Response(`<html><head><title>${title}</title></head><body>${body}<p>${'x '.repeat(400)}</p></body></html>`, { headers: { 'content-type': 'text/html' } });
  const pool = name => page(`${name} finalists`, `<p>Our finalists, teams and startups</p>${Array.from({ length: 10 }, (_, i) => `<a href="https://${name}-team${i}.ai/">T${i}</a>`).join(' ')}`);
  setFetch(async u => {
    u = String(u);
    if (u.includes('robots.txt')) return new Response('', { status: 404 });
    if (u.startsWith('https://list.example')) return page('Top 3 accelerators in Germany', '<a href="https://acc-one.de/accelerator">Acc One</a> <a href="https://acc-two.de/incubator">Acc Two</a> <a href="https://acc-three.de/programme">Three</a>');
    if (u.startsWith('https://acc-')) return pool(new URL(u).hostname.split('.')[0]);
    if (u === 'https://old.eu/') return page('Old hub', '<a href="https://old.eu/partners">Our partners</a>');
    if (u.startsWith('https://old.eu/partners')) return page('Partners', '<a href="https://partner-hackathon.eu/">Partner Hackathon</a>');
    if (u.startsWith('https://partner-hackathon.eu')) return pool('ph');
    return page('nothing', 'nothing');
  });
  setSearchFetch(async () => Response.json({ web: { results: [{ title: 'Top 3 accelerators in Germany', url: 'https://list.example/top-accelerators', description: '' }] } }));
  const st = await run({ log: () => {} });
  assert.equal(st.da_liste, 3, 'i tre pool elencati sono stati testati e aggiunti');
  assert.equal(st.da_hub, 1, 'pool trovato nella pagina partner di un hub');
  const H = await read('db_hub');
  assert.ok(H.find(h => h.hub_id === 'acc-one.de/accelerator' && /\(da lista\)$/.test(h.origine)));
  assert.ok(H.find(h => h.hub_id === 'old.eu').scoperta_il, 'hub esplorato segnato');
  assert.ok(['0', '1'].includes((await read('db_scoperta'))[0].livello), 'si parte dalle domande larghe');
});

test('3. hub da_verificare: attivo se rende, senza_resa se no', async () => {
  const gas = loadGas(); setSheetBackend(gas.backend);
  const { refreshHubStats } = await import('../src/crawlers/startups/index.js');
  await upsert('db_hub', 'hub_id', [
    { hub_id: 'buono.eu', nome: 'Buono', stato: 'da_verificare', ultimo_crawl: '2026-11-21 10:00:00' },
    { hub_id: 'vuoto.eu', nome: 'Vuoto', stato: 'da_verificare', ultimo_crawl: '2026-11-21 10:00:00' },
    { hub_id: 'nuovo.eu', nome: 'Nuovo', stato: 'da_verificare' },
  ]);
  await upsert('db_candidati', 'dominio', [{ dominio: 'q.ai', hub_origine: 'Buono', stato_crawler: 'da_valutare' }, { dominio: 'z.ai', hub_origine: 'Vuoto', stato_crawler: 'scartata' }]);
  await refreshHubStats(() => {});
  const H = Object.fromEntries((await read('db_hub')).map(h => [h.hub_id, h.stato]));
  assert.deepEqual(H, { 'buono.eu': 'attivo', 'vuoto.eu': 'senza_resa', 'nuovo.eu': 'da_verificare' });
});
