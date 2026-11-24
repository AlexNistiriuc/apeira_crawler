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

test('colonna chiave rinominata: errore chiaro, e riparazione con fusione dei doppioni', async () => {
  const { backend, sheets, ctx } = loadGas();
  await backend('upsert', { tab: 'db_hub', key: 'hub_id', rows: [{ hub_id: 'a.eu', nome: 'A', stato: 'attivo' }, { hub_id: 'b.eu', nome: 'B', stato: 'attivo' }] });
  sheets.get('db_hub').cells[0][0] = 'link';            // qualcuno rinomina l'intestazione
  await assert.rejects(backend('upsert', { tab: 'db_hub', key: 'hub_id', rows: [{ hub_id: 'a.eu', ultimo_crawl: 'x' }] }), /manca la colonna chiave/);
  // simula lo stato reale: colonna hub_id ricreata in fondo e un doppione aggiunto dallo snowball
  const sh = sheets.get('db_hub'); const n = sh.cells[0].length;
  sh.cells[0][n] = 'hub_id'; sh.cells[3] = []; sh.cells[3][1] = 'snowball: b.eu'; sh.cells[3][n] = 'b.eu'; sh.cells[3][9] = '2026-11-19';
  const r = JSON.parse(JSON.stringify(ctx.riparaHub()));
  assert.deepEqual([r.prima, r.dopo, r.fusi], [3, 2, 1]);
  const rows = (await backend('read', { tab: 'db_hub' })).rows;
  assert.deepEqual(rows.map(x => x.hub_id), ['a.eu', 'b.eu']);
  assert.equal(rows[1].nome, 'B', 'tiene il nome originale');
  assert.equal(rows[1].ultimo_crawl, '2026-11-19', 'e prende i dati dal doppione');
  await backend('upsert', { tab: 'db_hub', key: 'hub_id', rows: [{ hub_id: 'a.eu', ultimo_crawl: 'ok' }] });
  assert.equal((await backend('read', { tab: 'db_hub' })).rows[0].ultimo_crawl, 'ok', 'gli aggiornamenti tornano a funzionare');
});

test('molti aggiornamenti insieme: scrittura in blocco, solo i campi passati', async () => {
  const { backend } = loadGas();
  const rows = Array.from({ length: 120 }, (_, i) => ({ dominio: `s${i}.ai`, nome: `S${i}`, stato_crawler: 'da_valutare' }));
  await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows });
  const r = await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: rows.filter((_, i) => i % 2).map(x => ({ dominio: x.dominio, hub_origine: 'H' })) });
  assert.equal(r.updated, 60);
  const all = (await backend('read', { tab: 'db_candidati' })).rows;
  assert.equal(all.length, 120);
  assert.equal(all[1].hub_origine, 'H'); assert.equal(all[1].nome, 'S1');
  assert.equal(all[2].hub_origine, ''); assert.equal(all[2].nome, 'S2', 'le righe non toccate restano uguali');
});

test('coda solo_nuove: esclude le startup importate dalla v1', async () => {
  const { backend } = loadGas();
  await backend('upsert', { tab: 'db_candidati', key: 'dominio', rows: [
    { dominio: 'vecchia.ai', stato_crawler: 'da_valutare', versione_crawler: '1 (migrata)', ultimo_check: '2026-11-17 10:00:00' },
    { dominio: 'nuova.ai', stato_crawler: 'da_valutare', versione_crawler: '2.0.0', ultimo_check: '2026-11-20 10:00:00' },
  ] });
  assert.deepEqual((await backend('queue', { classifier: 'sage', limit: 10, solo_nuove: true })).rows.map(r => r.dominio), ['nuova.ai']);
  assert.equal((await backend('queue', { classifier: 'sage', limit: 10 })).rows.length, 2, 'senza opzione: tutte');
});

test('stage senza lock in db_appoggio, poi merge nei tab veri; le righe sbagliate restano con il motivo', async () => {
  const { ctx, token, backend, sheets } = loadGas();
  const v = { id: 'a.ai|claude', dominio: 'a.ai', classificatore: 'claude', versione: 't', valutato_il: '2026-11-23 10:00:00', esito: 'Needs verification', fit: 'Medio', voto: 60, motivo: 'ok' };
  let r = ctx.handle_({ token, action: 'stage', tab: 'db_valutazioni', key: 'id', rows: [v] }, false);
  assert.equal(r.ok, true); assert.equal(r.staged, 1);
  assert.equal(ctx.handle_({ token, action: 'stage', tab: 'db_hub', key: 'hub_id', rows: [{ hub_id: 'x' }] }, false).ok, false, 'solo valutazioni e candidati');
  assert.equal(ctx.handle_({ token, action: 'stage', tab: 'db_valutazioni', key: 'id', rows: [{ ...v, fit: 'Altissimo' }] }, false).ok, false, 'formato controllato subito');
  assert.equal((await backend('read', { tab: 'db_valutazioni' })).rows.length, 0, 'non ancora nel tab vero');
  // una riga che passa il formato ma non l'upsert (chiave diversa da dominio|classificatore non arriva qui: simulo JSON rotto)
  sheets.get('db_appoggio').appendRow(['2026-11-23', 'db_valutazioni', 'id', '{rotto', '']);
  r = ctx.handle_({ token, action: 'merge' }, false);
  assert.equal(r.unite, 1); assert.equal(r.errori, 1);
  assert.equal((await backend('read', { tab: 'db_valutazioni' })).rows[0].fit, 'Medio');
  const left = (await backend('read', { tab: 'db_appoggio' })).rows;
  assert.equal(left.length, 1); assert.match(left[0].errore, /non JSON/);
});
