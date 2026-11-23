import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-mock.js';
import { setRegistryFetch, norwayLookup, czechLookup, registryCountry } from '../src/lib/registry.js';

const year = new Date().getUTCFullYear();
const roller = (people) => ({ rollegrupper: [{ type: { kode: 'STYR' }, roller: people.map(([kode, fn, en, born, extra = {}]) => ({ type: { kode, beskrivelse: kode }, person: { fodselsdato: born, navn: { fornavn: fn, etternavn: en } }, ...extra })) }] });

test('registri: paese da dominio e testo', () => {
  assert.equal(registryCountry({ dominio: 'nara.no' }), 'NO');
  assert.equal(registryCountry({ dominio: 'x.ai', descrizione: 'Space startup in Prague' }), 'CZ');
  assert.equal(registryCountry({ dominio: 'x.ai', hub_origine: 'NTNU Discovery' }), 'NO');
});

test('Norvegia: per nome, ruoli attivi con data di nascita, senza i dimessi', async () => {
  setRegistryFetch(async url => {
    url = String(url);
    if (url.includes('/enheter?navn=')) return Response.json({ _embedded: { enheter: [{ organisasjonsnummer: '931000001', navn: 'NARA AS', stiftelsesdato: '2026-02-01', hjemmeside: 'www.nara.no' }] } });
    if (url.endsWith('/enheter/931000001/roller')) return Response.json(roller([['DAGL', 'Ola', 'Nordmann', `${year - 28}-01-15`], ['MEDL', 'Kari', 'Hansen', `${year - 22}-12-01`], ['MEDL', 'Per', 'Old', '1960-01-01', { fratraadt: true }], ['REVI', 'Revisor', 'X', '1970-01-01']]));
    return new Response('', { status: 404 });
  });
  const r = await norwayLookup('Nara');
  assert.equal(r.paese, 'NO'); assert.equal(r.costituita, '2026-02-01');
  assert.deepEqual(r.persone.map(p => p.nome), ['Ola Nordmann', 'Kari Hansen']);
  assert.ok(r.persone.every(p => p.max <= 34));
});

test('Repubblica Ceca: ARES, organo statutario con data di nascita', async () => {
  setRegistryFetch(async (url, opt) => {
    url = String(url);
    if (url.endsWith('/ekonomicke-subjekty/vyhledat')) { assert.equal(JSON.parse(opt.body).obchodniJmeno, 'Malnus'); return Response.json({ ekonomickeSubjekty: [{ ico: '12345678', obchodniJmeno: 'Malnus s.r.o.', datumVzniku: '2025-05-02' }] }); }
    if (url.endsWith('/ekonomicke-subjekty-vr/12345678')) return Response.json({ zaznamy: [{ primarniZaznam: true, statutarniOrgany: [{ nazevOrganu: 'Statutární orgán', clenoveOrganu: [{ fyzickaOsoba: { jmeno: 'JAN', prijmeni: 'NOVÁK', datumNarozeni: `${year - 25}-03-10` } }, { fyzickaOsoba: { jmeno: 'Old', prijmeni: 'Gone', datumNarozeni: '1950-01-01' }, datumVymazu: '2025-09-01' }] }] }] });
    return new Response('', { status: 404 });
  });
  const r = await czechLookup('Malnus');
  assert.equal(r.paese, 'CZ'); assert.equal(r.costituita, '2025-05-02');
  assert.deepEqual(r.persone.map(p => p.nome), ['Jan Novák']);
});

test('scoperta da registro: solo società giovani con sito, segnate per non rileggerle né ripagare la ricerca', async () => {
  const gas = loadGas();
  const { setSheetBackend, read } = await import('../src/lib/sheet.js');
  setSheetBackend(gas.backend);
  delete process.env.SCRAPEGRAPH_API_KEY; delete process.env.SEARCH_API_KEY; delete process.env.COMPANIES_HOUSE_KEY;
  setRegistryFetch(async url => {
    url = String(url);
    if (url.includes('naeringskode=72.100') && url.includes('page=0')) return Response.json({ _embedded: { enheter: [
      { organisasjonsnummer: '1', navn: 'Young Labs AS', registreringsdatoEnhetsregisteret: '2025-06-01', hjemmeside: 'younglabs.no' },
      { organisasjonsnummer: '2', navn: 'Old Boys AS', registreringsdatoEnhetsregisteret: '2025-06-01', hjemmeside: 'oldboys.no' },
      { organisasjonsnummer: '3', navn: 'Nosite AS', registreringsdatoEnhetsregisteret: '2025-06-01' }] }, page: { totalPages: 1 } });
    if (url.includes('naeringskode=')) return Response.json({ _embedded: { enheter: [] }, page: { totalPages: 0 } });
    if (url.endsWith('/enheter/1/roller')) return Response.json(roller([['DAGL', 'Ola', 'Ung', `${year - 24}-01-01`]]));
    if (url.endsWith('/enheter/2/roller')) return Response.json(roller([['DAGL', 'Per', 'Gammel', `${year - 50}-01-01`]]));
    if (url.endsWith('/enheter/3/roller')) return Response.json(roller([['DAGL', 'Liv', 'Ung', `${year - 26}-01-01`]]));
    return new Response('', { status: 404 });
  });
  const { run } = await import('../src/crawlers/registri/index.js');
  const st = await run({ log: () => {} });
  assert.equal(st.societa_lette, 3); assert.equal(st.giovani, 2); assert.equal(st.nuove_in_coda, 1);
  const c = (await read('db_candidati')).find(x => x.dominio === 'younglabs.no');
  assert.equal(c.stato_crawler, 'da_ricontrollare');
  assert.equal(JSON.parse(c.eta_verificate)[0].fonte, 'registro imprese NO');
  assert.equal(JSON.parse(c.registro).costituita, '2025-06-01');
  assert.equal((await read('db_scoperta')).filter(r => r.tipo === 'registro').length, 3, 'tutte e tre segnate');
  const again = await run({ log: () => {} });
  assert.equal(again.societa_lette, 0, 'al giro dopo non si rileggono');
});
