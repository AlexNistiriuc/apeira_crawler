// Lettura del sito intero: sitemap per i siti senza link nel testo, lingua del sito, redirect a un altro dominio.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.RDAP_BASE = 'https://rdap.test/domain/';
process.env.WAYBACK_BASE = 'https://wb.test/cdx';
process.env.NO_JINA = '1';
const { setFetch } = await import('../src/lib/http.js');
const { checkCandidate } = await import('../src/crawlers/startups/check.js');

const html = (t, b) => `<html><head><title>${t}</title></head><body>${b}<p>${'Quantum photonic chips for European telecom. '.repeat(20)}</p></body></html>`;
function serve(web, redirects = {}) {
  setFetch(async url => {
    const u = String(url);
    if (u.startsWith('https://rdap.test/')) return Response.json({ events: [{ eventAction: 'registration', eventDate: '2025-03-01T00:00:00Z' }] });
    if (u.startsWith('https://wb.test/')) return Response.json([['timestamp'], ['20250301000000']]);
    const final = redirects[u] || u;
    if (web[final] == null) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    const xml = final.endsWith('.xml');
    const r = new Response(web[final], { status: 200, headers: { 'content-type': xml ? 'application/xml' : 'text/html' } });
    Object.defineProperty(r, 'url', { value: final });
    return r;
  });
}
const home = '<h1>Qubo</h1><p>Qubo builds quantum error correction chips and photonic qubits in Delft, Netherlands. Founded in 2025 by two PhD students. Pilot with a telecom operator.</p>';

test('sito senza link nel testo: le pagine arrivano dalla sitemap', async () => {
  serve({
    'https://qubo.ai/': html('Qubo', home),
    'https://qubo.ai/sitemap.xml': '<urlset><url><loc>https://qubo.ai/careers</loc></url><url><loc>https://qubo.ai/about</loc></url><url><loc>https://qubo.ai/news</loc></url></urlset>',
    'https://qubo.ai/careers': html('Careers', '<p>Quantum engineer, photonics researcher. Apply now.</p>'),
    'https://qubo.ai/about': html('About', '<p>Anna Rossi, Co-Founder and CEO.</p>'),
    'https://qubo.ai/news': html('News', '<p>We won a grant.</p>'),
  });
  const row = await checkCandidate({ dominio: 'qubo.ai', sito: 'https://qubo.ai/', nome: 'Qubo', hubs: [], primo_visto: '2026-11-23' });
  const ev = JSON.parse(row.evidenze);
  assert.equal(row.stato_crawler, 'da_valutare');
  assert.ok(ev.sito.pagine >= 3, `lette dalla sitemap ${JSON.stringify(ev.sito)}`); assert.equal(ev.sito.da_sitemap, 3);
  assert.match(ev.estratto_careers || '', /Quantum engineer/);
});

test('sito tutto sotto /de/ e redirect a un altro dominio: si legge lo stesso', async () => {
  serve({
    'https://wichtel.com/de/': html('Wichtel', home + '<a href="https://wichtel.com/de/team">Team</a> <a href="https://wichtel.com/de/karriere">Karriere</a> <a href="https://wichtel.com/de/technologie">Technologie</a> <a href="https://wichtel.com/fr/equipe">FR</a>'),
    'https://wichtel.com/de/team': html('Team', '<p>Max Muster, Gründer.</p>'),
    'https://wichtel.com/de/karriere': html('Karriere', '<p>Ingenieur gesucht.</p>'),
    'https://wichtel.com/de/technologie': html('Technologie', '<p>Neural network compression patent.</p>'),
  }, { 'https://wichtel-labs.de/': 'https://wichtel.com/de/' });
  const row = await checkCandidate({ dominio: 'wichtel-labs.de', sito: 'https://wichtel-labs.de/', nome: 'Wichtel', hubs: [], primo_visto: '2026-11-23' });
  const ev = JSON.parse(row.evidenze);
  assert.ok(ev.sito.pagine >= 2, `pagine lette ${JSON.stringify(ev.sito)}`);
  assert.doesNotMatch(row.pagine_lette, /\/fr\//, 'la traduzione francese no');
});

test('zero pagine: il motivo è scritto', async () => {
  serve({ 'https://solo.ai/': html('Solo', home) });
  const row = await checkCandidate({ dominio: 'solo.ai', sito: 'https://solo.ai/', nome: 'Solo', hubs: [], primo_visto: '2026-11-23' });
  const ev = JSON.parse(row.evidenze);
  assert.equal(ev.sito.pagine, 0); assert.match(ev.sito.motivo_zero, /una pagina o in JavaScript/, JSON.stringify(ev.sito));
});
