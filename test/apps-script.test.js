import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGas } from './gas-mock.js';

const schema = JSON.parse(readFileSync(new URL('../contracts/schema.json', import.meta.url), 'utf8'));

test('Code.gs e contracts/schema.json hanno le stesse colonne', () => {
  const { ctx } = loadGas();
  const plain = x => JSON.parse(JSON.stringify(x));
  for (const [tab, def] of Object.entries(schema.tabs)) {
    assert.deepEqual(plain(ctx.SCHEMA[tab].columns), def.columns, tab);
    assert.equal(ctx.SCHEMA[tab].key, def.key, tab);
  }
  for (const [k, v] of Object.entries(ctx.ENUMS)) assert.deepEqual(plain(v), schema.enums[k], k);
});

test('setup crea i tab con intestazioni', () => {
  const { sheets } = loadGas();
  for (const t of ['db_hub', 'db_candidati', 'db_valutazioni', 'db_log', 'Startup trovate']) assert.ok(sheets.get(t), t);
  assert.ok(sheets.get('db_hub').hidden, 'i tab tecnici sono nascosti');
  assert.ok(!sheets.get('Startup trovate').hidden);
  assert.equal(sheets.get('db_hub').cells[0][0], 'hub_id');
});

test('token sbagliato rifiutato, GET solo lettura', () => {
  const { ctx, token } = loadGas();
  assert.equal(ctx.handle_({ token: 'x', action: 'ping' }, false).ok, false);
  assert.equal(ctx.handle_({ token, action: 'upsert', tab: 'db_log', key: null, rows: [] }, true).ok, false);
  assert.equal(ctx.handle_({ token, action: 'ping' }, true).ok, true);
});

test('upsert inserisce, aggiorna solo i campi passati, aggiunge colonne nuove', async () => {
  const { backend } = loadGas();
  let r = await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [{ dominio: 'a.ai', nome: 'A', stato_crawler: 'da_valutare' }, { dominio: 'b.io', nome: 'B' }] });
  assert.deepEqual([r.inserted, r.updated], [2, 0]);
  r = await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [{ dominio: 'a.ai', snowball_il: '2026-11-17' }, { dominio: 'c.eu', nome: 'C', campo_nuovo: 'x' }] });
  assert.deepEqual([r.inserted, r.updated], [1, 1]);
  const rows = (await backend('read', { tab: 'db_candidati' })).rows;
  const a = rows.find(x => x.dominio === 'a.ai');
  assert.equal(a.nome, 'A');
  assert.equal(a.stato_crawler, 'da_valutare');
  assert.equal(a.snowball_il, '2026-11-17');
  assert.equal(rows.find(x => x.dominio === 'c.eu').campo_nuovo, 'x');
});

test('stesso dominio due volte nello stesso blocco: una riga sola', async () => {
  const { backend } = loadGas();
  await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [{ dominio: 'a.ai', nome: 'A' }, { dominio: 'a.ai', settori: 'Quantum' }] });
  const rows = (await backend('read', { tab: 'db_candidati' })).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].settori, 'Quantum');
});

test('validazione: esito, voto e id dei classificatori', async () => {
  const { backend } = loadGas();
  const ok = { id: 'a.ai|x', dominio: 'a.ai', classificatore: 'x', esito: 'Qualificata', fit: 'Alto', voto: 80 };
  await backend('upsert', { tab: 'db_valutazioni', key: 'id', rows: [ok] });
  await assert.rejects(backend('upsert', { tab: 'db_valutazioni', key: 'id', rows: [{ ...ok, esito: 'Forse' }] }), /esito/);
  await assert.rejects(backend('upsert', { tab: 'db_valutazioni', key: 'id', rows: [{ ...ok, voto: 120 }] }), /voto/);
  await assert.rejects(backend('upsert', { tab: 'db_valutazioni', key: 'id', rows: [{ ...ok, id: 'a.ai' }] }), /id/);
  await assert.rejects(backend('upsert', { tab: 'db_candidati', key: 'nome', rows: [] }), /chiave/);
});

test('coda per classificatore e vista Startup trovate con note conservate', async () => {
  const { backend, sheets } = loadGas();
  await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [
    { dominio: 'a.ai', sito: 'https://a.ai/', nome: 'A', stato_crawler: 'da_valutare', ultimo_check: '2026-11-17 10:00:00' },
    { dominio: 'b.io', sito: 'https://b.io/', nome: 'B', stato_crawler: 'da_valutare', ultimo_check: '2026-11-17 11:00:00' },
    { dominio: 'c.eu', sito: 'https://c.eu/', nome: 'C', stato_crawler: 'scartata', ultimo_check: '2026-11-17 11:00:00' },
  ] });
  let q = (await backend('queue', { classifier: 'euristico', limit: 10 })).rows;
  assert.deepEqual(q.map(x => x.dominio), ['b.io', 'a.ai']);
  await backend('upsert', { tab: 'db_valutazioni', key: 'id', rows: [
    { id: 'a.ai|euristico', dominio: 'a.ai', classificatore: 'euristico', versione: '1', valutato_il: '2026-11-17 12:00:00', esito: 'Needs verification', fit: 'Medio', voto: 40 },
    { id: 'b.io|euristico', dominio: 'b.io', classificatore: 'euristico', versione: '1', valutato_il: '2026-11-17 12:00:00', esito: 'Esclusa', fit: 'Basso', voto: 0 },
    { id: 'a.ai|claude', dominio: 'a.ai', classificatore: 'claude', versione: 's1', valutato_il: '2026-11-17 12:00:00', esito: 'Qualificata', fit: 'Alto', voto: 85, under30: 'sì' },
    { id: 'a.ai|sage', dominio: 'a.ai', classificatore: 'sage', versione: 's2', valutato_il: '2026-11-17 12:00:00', esito: 'Needs verification', fit: 'Alto', voto: 82, under30: 'sì' },
  ] });
  q = (await backend('queue', { classifier: 'euristico', limit: 10 })).rows;
  assert.equal(q.length, 0);
  // coda di claude ordinata dal giudizio euristico, senza le escluse
  const qc = (await backend('queue', { classifier: 'nuovo', limit: 10, rank_by: 'euristico' })).rows;
  assert.deepEqual(qc.map(x => [x.dominio, x.pre_esito]), [['a.ai', 'Needs verification']]);
  // il crawler ricontrolla a.ai: torna in coda
  await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [{ dominio: 'a.ai', ultimo_check: '2026-11-18 09:00:00' }] });
  q = (await backend('queue', { classifier: 'euristico', limit: 10 })).rows;
  assert.deepEqual(q.map(x => x.dominio), ['a.ai']);

  await backend('views', {});
  const cl = sheets.get('Startup trovate').cells;
  assert.equal(cl.length, 2, 'solo a.ai: b.io è Esclusa, c.eu scartata dal crawler');
  assert.equal(cl[1][cl[0].indexOf('Esito criteri rigidi')], 'Needs verification', 'vince Sage per precedenza');
  assert.match(cl[1][2], /^Da verificare:/, 'lo stato deriva dalla valutazione Sage');
  assert.deepEqual(cl[0].slice(0, 4), ['Startup', 'Sito', 'Stato', 'Fit']);
  // nota scritta a mano, poi ricostruzione
  cl[1][cl[0].indexOf('Nota Alex')] = 'chiamata fissata';
  await backend('views', {});
  assert.equal(sheets.get('Startup trovate').cells[1][cl[0].indexOf('Nota Alex')], 'chiamata fissata');
  const ev = (await backend('read', { tab: 'db_valutazioni' })).rows.find(x => x.id === 'a.ai|sage');
  assert.equal(ev.nota_alex, 'chiamata fissata');
});
