import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strictAlto, applyStrict } from '../src/classifiers/strict.js';
import euristico from '../src/classifiers/euristico.js';

const base = {
  dominio: 'qubo.ai', nome: 'Qubo', sito: 'https://qubo.ai/', founder_nomi: 'Anna Rossi (CEO), Marco Bianchi (CTO)',
  dominio_registrato: '2025-02-10', fatti_il: '2026-11-21',
  registro: JSON.stringify({ paese: 'UK', costituita: '2025-03-04', url: 'https://find-and-update.company-information.service.gov.uk/company/1' }),
  eta_verificate: JSON.stringify([
    { nome: 'Anna Rossi', min: 26, max: 27, fonte: 'registro imprese UK' },
    { nome: 'Marco Bianchi', min: 29, max: 30, fonte: 'registro imprese UK' },
  ]),
  ev: { anni_dichiarati: [2025], eu: true, deep: 9, neg: 0, tags: ['Quantum'], dem: ['pilot'], ts: { e: 2 }, fa: {}, evd: {} },
};

test('criterio severo: tutte le prove presenti, Alto', () => {
  assert.deepEqual(strictAlto(base), { ok: true, manca: [] });
});

test('criterio severo: età di un solo founder su due, niente Alto', () => {
  const c = { ...base, eta_verificate: JSON.stringify([{ nome: 'Anna Rossi', min: 26, max: 27 }]) };
  assert.deepEqual(strictAlto(c).manca, ['età verificata di ogni founder']);
});

test('criterio severo: fondazione solo da indizio del dominio non basta', () => {
  const c = { ...base, registro: '', ev: { ...base.ev, anni_dichiarati: [] } };
  assert.ok(strictAlto(c).manca.includes('fondazione verificata'));
});

test('criterio severo: settore debole e fuori Europa', () => {
  const c = { ...base, registro: '', ev: { ...base.ev, deep: 3, eu: false } };
  const m = strictAlto(c).manca;
  assert.ok(m.includes('settore deep tech provato') && m.includes('angolo europeo'));
});

test('guardia comune: Alto senza prove diventa Medio, Esclusa diventa Basso', () => {
  const c = { ...base, eta_verificate: '' };
  const e = applyStrict({ esito: 'Qualificata', fit: 'Alto', voto: 90, motivo: 'ok' }, c);
  assert.equal(e.fit, 'Medio');
  assert.equal(e.esito, 'Needs verification');
  assert.ok(e.voto <= 69);
  assert.match(e.motivo, /per Alto manca: età verificata di ogni founder/);
  assert.equal(applyStrict({ esito: 'Esclusa', fit: 'Medio', voto: 0, motivo: 'x' }, base).fit, 'Basso');
  assert.equal(applyStrict({ esito: 'Needs verification', fit: 'Alto', voto: 80, motivo: 'x' }, base)._cambiata, undefined);
});

test('euristico: Alto solo con le prove, senza età dei founder resta Medio', async () => {
  const ok = await euristico.classify(base);
  assert.equal(ok.fit, 'Alto');
  const ko = await euristico.classify({ ...base, eta_verificate: '' });
  assert.equal(ko.fit, 'Medio');
  assert.match(ko.motivo, /per Alto manca: età verificata di ogni founder/);
});

test('riallineamento: declassa gli Alto senza prove di ogni classificatore, non tocca gli altri', async () => {
  const { loadGas } = await import('./gas-mock.js');
  const { setSheetBackend, upsert, read } = await import('../src/lib/sheet.js');
  const { realign } = await import('../src/classifiers/realign.js');
  const gas = loadGas(); setSheetBackend(gas.backend);
  const { ev, ...row } = base;
  await upsert('db_candidati', 'dominio', [
    { ...row, evidenze: JSON.stringify(ev), stato_crawler: 'da_valutare' },
    { ...row, dominio: 'nofacts.ai', eta_verificate: '', evidenze: JSON.stringify(ev), stato_crawler: 'da_valutare' },
  ]);
  const ev0 = { versione: 't', valutato_il: '2026-11-22 10:00:00', esito: 'Needs verification', voto: 80, motivo: 'ok' };
  await upsert('db_valutazioni', 'id', [
    { ...ev0, id: 'qubo.ai|claude', dominio: 'qubo.ai', classificatore: 'claude', fit: 'Alto' },
    { ...ev0, id: 'nofacts.ai|claude', dominio: 'nofacts.ai', classificatore: 'claude', fit: 'Alto' },
    { ...ev0, id: 'nofacts.ai|euristico', dominio: 'nofacts.ai', classificatore: 'euristico', fit: 'Medio', esito: 'Esclusa', voto: 0 },
  ]);
  const st = await realign({ log: () => {} });
  assert.equal(st.alto_prima, 2); assert.equal(st.alto_dopo, 1); assert.equal(st.declassate, 1); assert.equal(st.esclusa_a_basso, 1);
  const by = Object.fromEntries((await read('db_valutazioni')).map(r => [r.id, r]));
  assert.equal(by['qubo.ai|claude'].fit, 'Alto');
  assert.equal(by['nofacts.ai|claude'].fit, 'Medio');
  assert.equal(by['nofacts.ai|euristico'].fit, 'Basso');
});
