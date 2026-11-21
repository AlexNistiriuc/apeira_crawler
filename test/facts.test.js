import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, pickOne, ageFrom, registryCountry, franceLookup, ukLookup, setRegistryFetch } from '../src/lib/registry.js';
import { pickPeople, verifiedFromEstimate, registryFounders, newsFunding } from '../src/signals/facts.js';
import { estimateAge } from '../src/signals/age.estimate.js';
import euristico from '../src/classifiers/euristico.js';
import { pickBest } from '../src/crawlers/founders/index.js';

const TODAY = new Date(Date.UTC(2026, 10, 21));

test('registro: nomi, scelta univoca, età da anno e mese, paese', () => {
  assert.equal(normName('Qubo SAS'), 'qubo');
  assert.equal(normName('Pélican Technologies Ltd.'), 'pelican technologies');
  const items = [{ t: 'QUBO' }, { t: 'QUBO CONSULTING' }];
  assert.equal(pickOne(items, x => [x.t], 'qubo').t, 'QUBO', 'uguale vince sul prefisso');
  assert.equal(pickOne([{ t: 'Qubo A' }, { t: 'Qubo B' }], x => [x.t], 'qubo'), null, 'ambiguo: niente');
  assert.deepEqual(ageFrom(1999, 3, TODAY), { min: 27, max: 27 });
  assert.deepEqual(ageFrom(1999, 12, TODAY), { min: 26, max: 26 });
  assert.deepEqual(ageFrom(1990, null, TODAY), { min: 35, max: 36 });
  assert.equal(registryCountry({ dominio: 'qubo.fr' }), 'FR');
  assert.equal(registryCountry({ dominio: 'qubo.io', descrizione: 'Spin-off based in London' }), 'UK');
  assert.equal(registryCountry({ dominio: 'qubo.io', descrizione: 'Berlin' }), null);
});

test('registro Francia e Regno Unito con fetch finto', async () => {
  const urls = [];
  setRegistryFetch(async url => { urls.push(String(url));
    if (url.includes('recherche-entreprises')) return Response.json({ results: [{ nom_complet: 'QUBO', siren: '123456789', date_creation: '2025-02-10',
      dirigeants: [{ type_dirigeant: 'personne physique', nom: 'ROSSI', prenoms: 'Anna', date_de_naissance: '1999-03', qualite: 'Président de SAS' }] }] });
    if (url.includes('/search/companies')) return Response.json({ items: [{ title: 'QUBO LTD', company_number: '01234567', date_of_creation: '2024-06-01' }] });
    if (url.includes('/officers')) return Response.json({ items: [{ name: 'BIANCHI, Marco', officer_role: 'director', date_of_birth: { year: 1985, month: 1 } }, { name: 'OLD, Gone', officer_role: 'director', resigned_on: '2025-01-01', date_of_birth: { year: 1950, month: 1 } }] });
    if (url.includes('filing-history')) return Response.json({ items: [{ type: 'SH01', date: '2025-09-01' }, { type: 'SH02', date: '2025-10-01' }] });
    return new Response('', { status: 404 }); });
  const fr = await franceLookup('Qubo');
  assert.equal(fr.costituita, '2025-02-10');
  assert.equal(fr.persone[0].nome, 'Anna Rossi');
  assert.ok(fr.persone[0].min >= 26 && fr.persone[0].max <= 28);
  delete process.env.COMPANIES_HOUSE_KEY;
  assert.equal(await ukLookup('Qubo'), null, 'senza chiave si salta');
  process.env.COMPANIES_HOUSE_KEY = 'k'; process.env.COMPANIES_HOUSE_BASE = 'https://ch.example';
  const uk = await ukLookup('Qubo');
  delete process.env.COMPANIES_HOUSE_KEY;
  assert.equal(uk.persone.length, 1, 'dimessi esclusi');
  assert.equal(uk.persone[0].nome, 'Marco Bianchi');
  assert.deepEqual(uk.aumenti_capitale, ['2025-09-01']);
});

test('età verificata: solo dichiarata o anno di nascita con nome e cognome', () => {
  const s = t => [{ snippet: t, url: 'https://news.example/a' }];
  const p = { nome: 'Anna Rossi', ruolo: 'CEO' };
  assert.equal(verifiedFromEstimate(p, estimateAge('Anna Rossi', s('Anna Rossi, the 24-year-old founder of Qubo'), 2026)).max, 24);
  assert.equal(verifiedFromEstimate(p, estimateAge('Anna Rossi', s('Rossi, 24, founded Qubo'), 2026)), null, 'solo cognome: stima');
  assert.equal(verifiedFromEstimate(p, estimateAge('Anna Rossi', s('Anna Rossi (MSc 2023) leads Qubo'), 2026)), null, 'laurea: stima');
  assert.deepEqual(pickPeople('Anna Rossi, Luca Verdi, Ugo').map(x => x.nome), ['Anna Rossi', 'Luca Verdi']);
  assert.equal(registryFounders({ persone: [{ nome: 'Anna Rossi', min: 27 }, { nome: 'Piero Neri', min: 60 }] }, 'Anna Rossi (CEO)').length, 1, 'solo founder del sito');
  assert.equal(registryFounders({ persone: [{ nome: 'Piero Neri', min: 60 }] }, '').length, 1, 'sito senza founder: amministratori');
});

test('notizie di funding: importi della startup, non di altri', () => {
  const n = [{ url: 'https://n.example/1', title: 'Qubo raises €2M seed round', snippet: 'Paris-based Qubo has raised €2M in a seed round led by X.' },
    { url: 'https://n.example/2', title: 'Big Fund closes $100M', snippet: 'Big Fund raised $100M. Portfolio includes many startups.' }];
  const f = newsFunding(n, 'Qubo', 'qubo.fr');
  assert.equal(f.inv_usd, 2200000);
  assert.equal(f.fase, 'seed');
  assert.equal(f.investimenti.every(x => x.usd < 1e7), true, 'il fondo non conta');
  const g = newsFunding([{ url: 'u', title: 'Qubo wins EIC grant of €2.5 million', snippet: '' }], 'Qubo', 'qubo.fr');
  assert.equal(g.grant_usd, 2750000);
  assert.equal(newsFunding([{ url: 'u', title: 'Qubo joins pre-seed programme', snippet: '' }], 'Qubo', 'qubo.fr').fase, 'pre-seed');
});

const base = { dominio: 'qubo.fr', nome: 'Qubo', founder_nomi: 'Anna Rossi (CEO)', email: 'hi@qubo.fr', ev: { anni_dichiarati: [2025], eu: true, deep: 8, ts: {}, dem: ['pilot'] } };

test('euristico: registro, età verificate, notizie, portfolio VC', async () => {
  const old = await euristico.classify({ ...base, registro: JSON.stringify({ paese: 'FR', costituita: '2021-04-01', persone: [], aumenti_capitale: [], url: 'https://reg/1' }) });
  assert.equal(old.esito, 'Esclusa');
  assert.match(old.motivo, /fondata nel 2021 \(registro imprese FR\)/);
  const a35 = await euristico.classify({ ...base, eta_verificate: JSON.stringify([{ nome: 'Anna Rossi', min: 36, max: 37, fonte: 'registro imprese FR', url: 'https://reg/1' }]) });
  assert.equal(a35.esito, 'Esclusa');
  assert.match(a35.motivo, /35 anni o più/);
  const young = await euristico.classify({ ...base, eta_verificate: JSON.stringify([{ nome: 'Anna Rossi', min: 26, max: 27, fonte: 'registro imprese FR', url: 'https://reg/1' }]) });
  assert.equal(young.under30, 'sì');
  assert.doesNotMatch(young.da_verificare, /età founder/);
  assert.match(young.fonti, /reg\/1/);
  const big = await euristico.classify({ ...base, notizie_funding: JSON.stringify([{ url: 'https://qubo.fr/news', title: 'Qubo raises €2M', snippet: '' }]) });
  assert.equal(big.esito, 'Esclusa');
  const plain = await euristico.classify(base);
  const vc = await euristico.classify({ ...base, hub_origine: 'Seedcamp portfolio, Station F' });
  assert.notEqual(vc.esito, 'Esclusa', 'portfolio VC non esclude');
  assert.match(vc.motivo, /probabilmente ha già fatto un round/);
  assert.ok(vc.voto < plain.voto, 'portfolio VC penalizza');
});

test('crawler founder: con Sage spento lavora sulle migliori dell euristico', () => {
  const best = pickBest([
    { dominio: 'a', classificatore: 'euristico', esito: 'Needs verification', fit: 'Alto', voto: 50 },
    { dominio: 'b', classificatore: 'euristico', esito: 'Needs verification', fit: 'Basso', voto: 40 },
    { dominio: 'c', classificatore: 'euristico', esito: 'Esclusa', fit: 'Alto', voto: 0 },
    { dominio: 'd', classificatore: 'euristico', esito: 'Needs verification', fit: 'Basso', voto: 30 },
    { dominio: 'd', classificatore: 'claude', esito: 'Needs verification', fit: 'Medio', voto: 60 },
  ], 10);
  assert.deepEqual(best.map(v => v.dominio), ['a', 'd']);
});

test('notizie: nome generico, fondi omonimi, conferma del round', async () => {
  const { companyName, confirmedOver } = await import('../src/signals/facts.js');
  assert.equal(companyName({ nome: 'startup', dominio: 'collimatehealth.com' }), 'collimatehealth');
  assert.equal(companyName({ nome: 'Kova Labs', dominio: 'kovahq.com' }), 'Kova Labs');
  assert.equal(companyName({ nome: 'Elea & Lili', dominio: 'elealili.com' }), 'Elea & Lili');
  const fund = newsFunding([{ url: 'u', title: 'Stratos Ventures raises $50M for early-stage defense fund', snippet: '' }], 'Stratos', 'stratos.software');
  assert.equal(fund.inv_usd, 0, 'un fondo che raccoglie non è la startup');
  const two = newsFunding([{ url: 'a', title: 'Iris Labs raises $20 million from Flagship', snippet: '' }, { url: 'b', title: 'IRIS Lab raised $2.9 million in seed round', snippet: '' }], 'Iris Lab', 'irislab.io');
  assert.equal(confirmedOver(two.investimenti, 500000), false, 'due importi diversi: possibili omonimi');
  const same = newsFunding([{ url: 'a', title: 'Gobano raises €3M pre-seed', snippet: '' }, { url: 'b', title: 'Gobano Robotics raised a €3M pre-seed round', snippet: '' }], 'Gobano Robotics', 'gobano.ai');
  assert.equal(confirmedOver(same.investimenti, 500000), true);
  const g = newsFunding([{ url: 'a', title: 'DiaSense grant. Total Funding Raised $6.44M grant', snippet: 'DiaSense wins grant of $6.44M' }], 'DiaSense', 'diasense.dk');
  assert.equal(g.grant_usd, 6440000, 'importo ripetuto conta una volta');
});

test('euristico: una sola notizia senza dominio non esclude, abbassa e chiede conferma', async () => {
  const one = await euristico.classify({ ...base, notizie_funding: JSON.stringify([{ url: 'https://n/1', title: 'Qubo raises €2M', snippet: '' }]) });
  assert.equal(one.esito, 'Needs verification');
  assert.match(one.motivo, /da confermare che sia la stessa azienda/);
});
