// Prova end to end senza rete: un finto web, il vero Code.gs su un finto Sheets,
// crawler hub -> crawler startup -> classificatore euristico -> vista Startup trovate.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RDAP_BASE = 'https://rdap.test/domain/';
process.env.WAYBACK_BASE = 'https://wb.test/cdx';
process.env.NO_JINA = '1';

const { loadGas } = await import('./gas-mock.js');
const { setFetch } = await import('../src/lib/http.js');
const { setSheetBackend, read, upsert } = await import('../src/lib/sheet.js');
const hubs = await import('../src/crawlers/hubs/index.js');
const startups = await import('../src/crawlers/startups/index.js');
const { classifyQueue } = await import('../src/classifiers/run.js');
const euristico = (await import('../src/classifiers/euristico.js')).default;

const pad = 'Our mission is to make this technology available to European industry. '.repeat(8);
const html = (title, body) => `<html><head><title>${title}</title></head><body>${body}<p>${pad}</p></body></html>`;
const WEB = {
  'https://hub-alpha.eu/': html('Hub Alpha incubator', '<a href="https://hub-alpha.eu/startups">Our startups</a>'),
  'https://hub-alpha.eu/startups': html('Startups', `
    <a href="https://qubo.ai/">Qubo</a> <a href="https://adsy.com/">Adsy</a> <a href="https://megacorp.de/">MegaCorp</a>
    <a href="https://seedfunded.io/">SeedFunded</a> <a href="https://www.linkedin.com/company/x">LinkedIn</a>`),
  'https://qubo.ai/': html('Qubo | quantum chips', `<p>Qubo builds quantum error correction chips and photonic qubits in Delft, Netherlands. Founded in 2025 by two PhD students.</p>
    <p>We run a pilot with a European telecom operator.</p><a href="https://qubo.ai/team">Team</a> <a href="https://qubo.ai/contact">Contact</a>
    <p>Proudly part of <a href="https://deep-incubator.ch/">Deep Incubator programme</a></p><p>© 2025 Qubo</p>`),
  'https://qubo.ai/team': html('Team', '<p>We are a team of 3 engineers.</p><p>Anna Rossi, Co-Founder</p><p>Anna (24-year-old) studied physics.</p>'),
  'https://qubo.ai/contact': html('Contact', '<p>Write to anna@qubo.ai</p>'),
  'https://adsy.com/': html('Adsy', '<p>Marketing agency: SEO, social media, influencers, e-commerce growth.</p>'),
  'https://megacorp.de/': html('MegaCorp', '<p>Semiconductors and lasers since 1950. 12,000 employees. Investor relations.</p>'),
  'https://seedfunded.io/': html('SeedFunded', '<p>Fusion energy and plasma physics. We closed our seed round of €4 million.</p>'),
};
const RDAP = { 'qubo.ai': '2025-02-10T00:00:00Z', 'adsy.com': '2012-01-01T00:00:00Z', 'seedfunded.io': '2025-01-01T00:00:00Z' };

function fakeFetch(url) {
  const u = String(url);
  if (u.startsWith('https://rdap.test/domain/')) {
    const d = u.split('/').pop();
    return Promise.resolve(RDAP[d] ? Response.json({ events: [{ eventAction: 'registration', eventDate: RDAP[d] }] }) : new Response('', { status: 404 }));
  }
  if (u.startsWith('https://wb.test/')) return Promise.resolve(Response.json([['timestamp'], ['20250301000000']]));
  const key = u.replace(/^https:\/\/www\./, 'https://');
  if (WEB[key]) { const r = new Response(WEB[key], { status: 200, headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: u }); return Promise.resolve(r); }
  return Promise.resolve(new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }));
}

test('pipeline completa', async () => {
  const gas = loadGas();
  setSheetBackend(gas.backend);
  setFetch(fakeFetch);
  const quiet = () => {};
  const deadline = Date.now() + 60_000;

  await upsert('db_hub', 'hub_id', [{ hub_id: 'hub-alpha.eu', nome: 'Hub Alpha', url: 'https://hub-alpha.eu/', origine: 'manuale', tipo: 'incubatore', stato: 'attivo', priorita: '20' }]);

  // 1. crawler hub: aggiunge semi e directory, le reti non rispondono (finto web)
  const h1 = await hubs.run({ deadline, log: quiet });
  assert.ok(h1.semi > 0);
  assert.equal(h1.errori.length, 2);

  // 2. crawler startup
  const st = await startups.run({ deadline, log: quiet });
  const C = Object.fromEntries((await read('db_candidati')).map(r => [r.dominio, r]));
  assert.equal(C['qubo.ai'].stato_crawler, 'da_valutare', C['qubo.ai'].motivo);
  assert.equal(C['qubo.ai'].hub_origine, 'Hub Alpha');
  assert.match(C['qubo.ai'].email, /anna@qubo\.ai/);
  assert.match(C['qubo.ai'].team_stima, /^3/);
  assert.match(C['adsy.com'].motivo, /dominio registrato nel 2012/);
  assert.match(C['megacorp.de'].motivo, /azienda grande/);
  assert.match(C['seedfunded.io'].motivo, /round già chiuso/);
  assert.ok(!C['linkedin.com']);
  const ev = JSON.parse(C['qubo.ai'].evidenze);
  assert.deepEqual(ev.anni_dichiarati, [2025]);
  assert.ok(ev.estratto_home.includes('quantum error correction'));
  assert.equal(st.da_valutare, 1);

  const H = Object.fromEntries((await read('db_hub')).map(r => [r.hub_id, r]));
  assert.equal(H['hub-alpha.eu'].candidati_da_valutare, '1');
  assert.ok(H['hub-alpha.eu'].ultimo_crawl);
  assert.equal(H['yesdelft.com'].stato, 'attivo', 'un fallimento non basta per scartare un hub');
  assert.equal(H['yesdelft.com'].fallimenti, '1');

  // 3. secondo giro del crawler hub: snowball dal sito di Qubo
  const h2 = await hubs.run({ deadline, log: quiet });
  assert.equal(h2.da_snowball, 1);
  const H2 = (await read('db_hub')).find(r => r.hub_id === 'deep-incubator.ch');
  assert.equal(H2.origine, 'snowball: qubo.ai');
  assert.equal((await read('db_candidati')).find(r => r.dominio === 'qubo.ai').snowball_il.length, 10);

  // 4. un secondo run del crawler startup non ricontrolla niente
  const st2 = await startups.run({ deadline, log: quiet });
  assert.equal(st2.nuovi, 0);

  // 5. classificatore euristico e vista
  const c1 = await classifyQueue(euristico, 100, quiet);
  assert.equal(c1.scritte, 1);
  const v = (await read('db_valutazioni'))[0];
  assert.equal(v.id, 'qubo.ai|euristico');
  assert.equal(v.esito, 'Needs verification');
  assert.match(v.eta_founder, /24/);
  assert.equal(v.under30, 'sì');
  assert.equal((await classifyQueue(euristico, 100, quiet)).in_coda, 0, 'già valutata');
  await gas.backend('views', {});
  const cl = gas.sheets.get('Startup trovate').cells;
  assert.equal(cl.length, 2);
  assert.equal(cl[1][0], 'Qubo');
  const log = await read('db_log');
  assert.equal(log.length, 6);

  // terzo fallimento di fila: l'hub irraggiungibile si mette da parte
  await startups.run({ deadline, log: quiet });
  const y = (await read('db_hub')).find(r => r.hub_id === 'yesdelft.com');
  assert.equal(y.stato, 'irraggiungibile');
  assert.equal((await read('db_hub')).find(r => r.hub_id === 'hub-alpha.eu').fallimenti, '0');
});
