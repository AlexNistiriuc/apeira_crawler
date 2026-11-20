import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAge, band } from '../src/signals/age.estimate.js';
import { loadGas } from './gas-mock.js';

test('stima età: dichiarata, nascita, laurea, dottorando; il cognome deve esserci', () => {
  const s = snip => [{ snippet: snip, url: 'https://x.example' }];
  assert.equal(estimateAge('Anna Rossi', s('Anna Rossi, the 24-year-old founder of Qubo'), 2026).eta, 24);
  assert.equal(estimateAge('Anna Rossi', s('Rossi was born in 1990 in Turin'), 2026).fascia, '35 o più');
  assert.equal(estimateAge('Marco Bianchi', s('Marco Bianchi holds an MSc in Physics from ETH (2022).'), 2026).eta, 28);
  assert.equal(estimateAge('Marco Bianchi', s('Bianchi is a PhD candidate at TU Delft'), 2026).fascia, 'sotto 30');
  assert.equal(estimateAge('Marco Bianchi', s('Luca Verdi, 25-year-old engineer'), 2026).eta, null, 'altra persona: niente stima');
  assert.equal(estimateAge('Anna Rossi', s('Rossi has 20 years of experience'), 2026).eta, null, 'anni di esperienza non sono età');
  assert.equal(band(31), '30-34');
});

test('crawler founder: solo CEO e CTO, una ricerca per persona, una volta sola', async () => {
  process.env.SEARCH_API_KEY = 'k'; process.env.SEARCH_GAP_MS = '0';
  const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
  const { setSearchFetch } = await import('../src/lib/search.js');
  const { run, ceoCto } = await import('../src/crawlers/founders/index.js');
  assert.deepEqual(ceoCto('Anna Rossi (CEO), Luca Verdi, Marco Bianchi (CTO)').map(p => p.ruolo), ['CEO', 'CTO']);
  const gas = loadGas(); setSheetBackend(gas.backend);
  await upsert('db_candidati', 'dominio', [{ dominio: 'qubo.ai', nome: 'Qubo', founder_nomi: 'Anna Rossi (CEO), Luca Verdi, Marco Bianchi (CTO)', stato_crawler: 'da_valutare' }]);
  await upsert('db_valutazioni', 'id', [{ id: 'qubo.ai|sage', dominio: 'qubo.ai', classificatore: 'sage', esito: 'Needs verification', fit: 'Alto', voto: 70 }]);
  const queries = [];
  setSearchFetch(async url => { const q = decodeURIComponent(new URL(url).searchParams.get('q')); queries.push(q);
    return Response.json({ web: { results: [{ title: 'Qubo team', url: 'https://uni.example/qubo', description: q.includes('Rossi') ? 'Anna Rossi (MSc 2023) leads Qubo.' : 'nothing useful' }] } }); });
  const st = await run(10, () => {});
  assert.deepEqual(queries, ['"Anna Rossi" Qubo', '"Marco Bianchi" Qubo'], 'Luca Verdi (co-founder) non cercato');
  assert.equal(st.stimate, 1);
  const c = (await read('db_candidati'))[0];
  assert.match(c.eta_stimata, /CEO Anna Rossi: sotto 30 \(anno di laurea/);
  assert.match(c.eta_stimata, /CTO Marco Bianchi: non determinabile/);
  assert.equal((await run(10, () => {})).candidate, 0, 'già stimata');
});
