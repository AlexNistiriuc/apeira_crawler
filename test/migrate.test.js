// La migrazione dalla v1 gira nel browser: qui la eseguiamo con finti indexedDB/localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGas } from './gas-mock.js';

test('migrazione dalla v1', async () => {
  const gas = loadGas();
  const state = { xh: [{ name: 'AUTO: incub.ch', url: 'https://incub.ch/' }], cands: {
    'qubo.ai': { d: 'qubo.ai', u: 'https://qubo.ai/', n: 'Qubo', hubs: ['YES!Delft'], st: 'target', deep: 9, neg: 0, tags: ['Quantum'], eu: true, ts: { e: 3, li: [], r: 0 }, evd: { g: [], i: [], fy: [2025] } },
    'old.com': { d: 'old.com', u: 'https://old.com/', hubs: ['YES!Delft'], st: 'old', cr: '2011-05-01' },
    'vc.com': { d: 'vc.com', u: 'https://vc.com/', hubs: ['x'], st: 'reject', inv: 1 },
    'new.io': { d: 'new.io', u: 'https://new.io/', hubs: ['x'], st: 'young' },
  } };
  let done;
  const finished = new Promise(r => { done = r; });
  const ctx = {
    console: { log: (...a) => { if (String(a[0]).includes('finita')) done(); } },
    prompt: q => (/URL/.test(q) ? 'https://api.test/exec' : gas.token),
    localStorage: { getItem: () => JSON.stringify([{ name: 'YES!Delft', url: 'https://www.yesdelft.com/' }, { name: 'Seedcamp portfolio', url: 'https://seedcamp.com/portfolio' }]) },
    indexedDB: { open: () => { const o = {}; setTimeout(() => { o.result = { transaction: () => ({ objectStore: () => ({ get: () => { const g = {}; setTimeout(() => { g.result = JSON.stringify(state); g.onsuccess(); }); return g; } }) }) }; o.onsuccess(); }); return o; } },
    fetch: async (url, opt) => { const b = JSON.parse(opt.body); const r = gas.ctx.handle_(b, false); return { json: async () => JSON.parse(JSON.stringify(r)) }; },
    URL, JSON, Date, Object, String, Math, Set, Promise, setTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../tools/migrate-from-chrome.js', import.meta.url), 'utf8'), ctx);
  await finished;
  const read = async tab => JSON.parse(JSON.stringify(gas.ctx.handle_({ token: gas.token, action: 'read', tab }, false))).rows;
  const H = Object.fromEntries((await read('db_hub')).map(h => [h.hub_id, h]));
  assert.equal(H['yesdelft.com'].stato, 'attivo');
  assert.equal(H['seedcamp.com/portfolio'].stato, 'escluso_vc');
  assert.equal(H['incub.ch'].origine, 'snowball (v1)');
  const C = Object.fromEntries((await read('db_candidati')).map(c => [c.dominio, c]));
  assert.equal(C['qubo.ai'].stato_crawler, 'da_valutare');
  assert.equal(C['qubo.ai'].team_stima, '3 (dichiarato sul sito)');
  assert.deepEqual(JSON.parse(C['qubo.ai'].evidenze).anni_dichiarati, [2025]);
  assert.equal(C['old.com'].motivo, 'dominio registrato nel 2011');
  assert.match(C['vc.com'].motivo, /investitore/);
  assert.ok(!C['new.io'], 'i non controllati non si portano');
});
