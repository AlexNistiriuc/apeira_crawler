// Il runner con un valutatore lento e a pagamento: errori isolati, stop sui fatali, scritture a blocchi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';
const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
const { classifyQueue } = await import('../src/classifiers/run.js');

async function setup(n) {
  const gas = loadGas(); setSheetBackend(gas.backend);
  await upsert('db_candidati', 'dominio', Array.from({ length: n }, (_, i) => ({ dominio: `s${i}.ai`, sito: `https://s${i}.ai/`, nome: `S${i}`, stato_crawler: 'da_valutare', ultimo_check: '2026-11-19 10:00:00' })));
  return gas;
}
const ok = { esito: 'Needs verification', fit: 'Medio', voto: 50, motivo: 'x' };
const quiet = () => {};

test('un errore su un candidato non ferma il giro e il candidato resta in coda', async () => {
  await setup(5);
  const clf = { name: 'prova', version: '1', parallel: 2, writeEvery: 2, async classify(c) { if (c.dominio === 's2.ai') throw new Error('rete'); return ok; } };
  const st = await classifyQueue(clf, 100, quiet);
  assert.equal(st.scritte, 4); assert.equal(st.errori, 1);
  const st2 = await classifyQueue(clf, 100, quiet);
  assert.equal(st2.in_coda, 1, 's2.ai riprovato al giro dopo');
});

test('un errore fatale ferma tutto subito', async () => {
  await setup(20);
  let calls = 0;
  const clf = { name: 'prova', version: '1', parallel: 1, async classify() { calls++; throw Object.assign(new Error('credito finito'), { fatal: true }); } };
  const st = await classifyQueue(clf, 100, quiet);
  assert.equal(calls, 1);
  assert.equal(st.fermato_per, 'credito finito');
  assert.equal(st.altro_lavoro, false);
});

test('scadenza: salva quanto fatto e segnala altro lavoro', async () => {
  await setup(10);
  const clf = { name: 'prova', version: '1', parallel: 1, writeEvery: 3, async classify() { await new Promise(r => setTimeout(r, 30)); return ok; } };
  const st = await classifyQueue(clf, 100, quiet, { deadline: Date.now() + 100 });
  assert.ok(st.scritte >= 1 && st.scritte < 10);
  assert.ok(st.saltate_per_tempo > 0);
  assert.equal(st.altro_lavoro, true);
  assert.equal((await read('db_valutazioni')).length, st.scritte, 'tutto quello fatto è salvato');
});
