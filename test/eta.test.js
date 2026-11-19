import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';
process.env.SAGE_API_KEY = 'k';
const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { run, topForEstimate } = await import('../src/classifiers/eta.js');

test('solo le migliori, solo una volta, fascia per CEO e CTO', async () => {
  const gas = loadGas(); setSheetBackend(gas.backend);
  await upsert('db_candidati', 'dominio', [
    { dominio: 'a.ai', nome: 'Alpha', founder_nomi: 'Anna Rossi (CEO), Marco Bianchi (CTO)', stato_crawler: 'da_valutare' },
    { dominio: 'b.ai', nome: 'Beta', stato_crawler: 'da_valutare' },
    { dominio: 'c.ai', nome: 'Gamma', stato_crawler: 'da_valutare' },
  ]);
  const ev = (d, fit, voto, esito = 'Needs verification') => ({ id: `${d}|sage`, dominio: d, classificatore: 'sage', esito, fit, voto, motivo: 'x' });
  await upsert('db_valutazioni', 'id', [ev('a.ai', 'Alto', 70), ev('b.ai', 'Medio', 80), ev('c.ai', 'Alto', 90, 'Esclusa')]);
  assert.deepEqual(topForEstimate(await read('db_valutazioni'), 1).map(v => v.dominio), ['a.ai']);

  const calls = [];
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); calls.push(url.split('/').pop());
    assert.equal(b.reasoning, 'off');
    if (url.endsWith('/decide')) return Response.json({ grounding_meta: { sources: [
      { url: 'https://uni.example/news', title: 'Alpha founders', snippet: 'Anna Rossi (MSc 2022) and Marco Bianchi, PhD candidate, founded Alpha at a.ai' },
      { url: 'https://other.example', title: 'Unrelated', snippet: 'nothing' } ] } });
    return Response.json({ results: [{ answers: [
      { ok: true, result: { id: 'ceo', result: { chosen: 'under_30' } } },
      { ok: true, result: { id: 'cto', result: { chosen: 'unknown' } } } ] }] });
  };
  const st = await run(1, () => {});
  assert.equal(st.stimate, 1);
  assert.deepEqual(calls, ['decide', 'batch']);
  const a = (await read('db_valutazioni')).find(v => v.dominio === 'a.ai');
  assert.match(a.eta_stimata, /CEO: sotto 30; CTO: non determinabile/);
  assert.equal(a.fonti_eta, 'https://uni.example/news');
  assert.equal(a.esito, 'Needs verification', 'la stima non tocca l\'esito');
  assert.equal((await run(1, () => {})).candidati, 0, 'già stimata: niente nuove ricerche');
});
