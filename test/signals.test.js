import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html2md } from '../src/lib/html.js';
import { links, reg, bad, hubKey } from '../src/lib/url.js';
import { emptySignals, scanPage, fundSig } from '../src/signals/scan.js';
import { decide, preCheck, okDeep, STATO } from '../src/signals/prefilter.js';
import { teamEstimate, money } from '../src/signals/derive.js';
import { parseRobots } from '../src/lib/http.js';

const page = (body, title = 'X') => html2md(`<html><head><title>${title}</title></head><body>${body}</body></html>`, 'https://x.ai/');

test('html2md produce testo in stile Jina con link assoluti', () => {
  const t = page('<p>Hello <a href="/team">Team</a></p>');
  assert.match(t, /^Title: X/);
  assert.match(t, /\[Team\]\(https:\/\/x\.ai\/team\)/);
  assert.deepEqual(links(t)[0], ['Team', 'https://x.ai/team']);
});

test('domini: registrabile e scarti', () => {
  assert.equal(reg('app.foo.co.uk'), 'foo.co.uk');
  assert.ok(bad('linkedin.com')); assert.ok(bad('tum.de')); assert.ok(!bad('qubitlabs.ai'));
  assert.equal(hubKey('https://www.YesDelft.com/startups/'), 'yesdelft.com/startups');
});

test('startup quantum giovane: passa al classificatore', () => {
  const s = emptySignals();
  scanPage(s, page(`<h1>Qubo</h1><p>Qubo builds quantum error correction chips and photonic qubits in Delft, Netherlands. Founded in 2025 by two PhD students.</p>
    <p>We are running a pilot with a European telecom operator. Contact: hello@qubo.ai</p><p>© 2025 Qubo</p>`), { home: true });
  assert.ok(okDeep(s));
  assert.deepEqual(s.evd.fy, [2025]);
  assert.ok(s.fa.y >= 1, 'segnale di founder giovani');
  assert.ok(s.dem.length >= 1, 'segnale di domanda reale');
  assert.deepEqual(s.em, ['hello@qubo.ai']);
  assert.equal(decide({ s, alive: true, registrato: '2025-03-01' }).stato, STATO.DA_VALUTARE);
});

test('scarti certi: seed, fondazione vecchia, marketing, grande azienda', () => {
  const mk = (b, opt = { home: true }) => scanPage(emptySignals(), page(b), opt);
  let s = mk('<p>Quantum sensors and lasers. We closed our seed round of €3 million led by X.</p>');
  assert.match(decide({ s, alive: true }).motivo, /round già chiuso/);
  s = mk('<p>Robotics and drones for agriculture. Founded in 2019.</p>');
  assert.match(decide({ s, alive: true }).motivo, /fondata/);
  s = mk('<p>Marketing agency for e-commerce, SEO, social media and influencers.</p>');
  assert.match(decide({ s, alive: true }).motivo, /non deep tech/);
  s = mk('<p>Semiconductors and photonic chips. Over 1,200 employees in 30 countries. Investor relations.</p>');
  assert.match(decide({ s, alive: true }).motivo, /azienda grande/);
  assert.equal(decide({ s: emptySignals(), alive: false }).stato, STATO.MORTO);
});

test('prefiltro senza rete', () => {
  assert.match(preCheck({ dominio: 'acme-ventures.com', hubs: ['x'] }), /investitore/);
  assert.match(preCheck({ dominio: 'foo.ai', hubs: ['Seedcamp portfolio'] }), /portfolio di VC/);
  assert.match(preCheck({ dominio: 'foo.ai', hubs: ['x'], anno_dichiarato: 2023 }), /2023/);
  assert.equal(preCheck({ dominio: 'foo.ai', hubs: ['YES!Delft'] }), null);
});

test('fundSig e soldi', () => {
  assert.equal(fundSig('We raised $300k pre-seed').l, 1);
  assert.equal(fundSig('Series A of $10M').l, 3);
  const s = scanPage(emptySignals(), page('<p>We won an EIC grant of €2.5 million for our fusion magnets.</p>'));
  const m = money(s.evd);
  assert.ok(m.grantUsd > 2.5e6);
});

test('team: dichiarato, LinkedIn, ruoli; advisor esclusi', () => {
  const s = emptySignals();
  scanPage(s, page(`<p>We are a team of 4 engineers.</p>`));
  assert.equal(teamEstimate(s.ts).n, 4);
  const s2 = emptySignals();
  scanPage(s2, page(`<p>${'We build robotic hands for labs. '.repeat(10)}</p><p>Founders</p><a href="https://linkedin.com/in/anna">A</a><a href="https://linkedin.com/in/bob">B</a>
    <h2>Advisors</h2><a href="https://linkedin.com/in/carl">C</a>`));
  assert.equal(teamEstimate(s2.ts).n, 2);
});

test('team: non confonde la dimensione dei clienti con quella della startup', () => {
  const s = emptySignals();
  scanPage(s, page('<p>Was früher ab 100 Mitarbeitern begann, rechnet sich heute für 12.</p>'));
  assert.equal(teamEstimate(s.ts).n, null);

  const explicit = emptySignals();
  scanPage(explicit, page('<p>We employ 4 engineers.</p>'));
  assert.equal(teamEstimate(explicit.ts).n, 4);
});

test('lab proprio richiede evidenza esplicita di proprietà', () => {
  const customer = scanPage(emptySignals(), page('<p>Control robots in your cleanroom through our state-of-the-art facility software.</p>'));
  assert.equal(customer.evd.lc, '', 'la facility del cliente non è un lab proprio');
  const owned = scanPage(emptySignals(), page('<p>We test the hardware in our state-of-the-art laboratory.</p>'));
  assert.match(owned.evd.lc, /our state-of-the-art laboratory/i);
});

test('robots.txt', () => {
  const r = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /');
  assert.deepEqual(r, ['/private']);
});

test('nomi dei founder con ruolo CEO/CTO', () => {
  const s = scanPage(emptySignals(), page(`<p>${'We build quantum sensors. '.repeat(5)}</p><p>Anna Rossi, CEO</p><p>Marco Bianchi | CTO</p><p>Luca Verdi, Co-Founder</p>`));
  assert.ok(s.fn.includes('Anna Rossi (CEO)'), s.fn.join('; '));
  assert.ok(s.fn.includes('Marco Bianchi (CTO)'));
  assert.ok(s.fn.includes('Luca Verdi'));
});
