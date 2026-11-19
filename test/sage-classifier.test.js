import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const sage = (await import('../src/classifiers/sage.js')).default;
const originalFetch = globalThis.fetch;
const originalKey = process.env.SAGE_API_KEY;
let responseBody;
let researchBody;
let requestBody;

beforeEach(() => {
  process.env.SAGE_API_KEY = 'test-key';
  researchBody = null;
  requestBody = null;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    if (url === 'https://sage.levanto.ai/decide') {
      researchBody = body;
      return Response.json({
        id: 'company_identity', result: { answer: 'yes', probability: 0.99 },
        grounding_meta: { triggered: true, sources: [
          { title: 'Qubo funding', url: 'https://example.com/qubo-funding', snippet: 'Qubo at qubo.ai raised EUR 200k.' },
          { title: 'Other Qubo', url: 'https://irrelevant.example/qubo', snippet: 'A namesake without the official domain.' },
        ] },
      });
    }
    assert.equal(url, 'https://sage.levanto.ai/decide/batch');
    requestBody = body;
    return Response.json(responseBody);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.SAGE_API_KEY;
  else process.env.SAGE_API_KEY = originalKey;
});

function sageResponse(outcome, probability, fit = 'high', score = 88, sources = []) {
  return {
    results: [{ answers: [
      { ok: true, result: {
        id: 'esito', kind: 'choice', result: { chosen: outcome, probability },
        grounding_meta: { triggered: sources.length > 0, sources },
      } },
      { ok: true, result: { id: 'fit', kind: 'choice', result: { chosen: fit, probability: 0.9 } } },
      { ok: true, result: { id: 'voto', kind: 'scale', result: { expectation: score, confidence: 0.8 } } },
    ] }],
  };
}

const candidate = {
  dominio: 'qubo.ai', nome: 'Qubo', sito: 'https://qubo.ai/', settori: 'Quantum', europa: 'sì',
  dominio_registrato: '2025-02-10', primo_archivio: '2025-03-01', anni_sul_sito: '2025',
  team_stima: '3 (dichiarato sul sito)', email: 'founder@qubo.ai', pagine_lette: 'https://qubo.ai/about',
  linkedin_persone: 'https://www.linkedin.com/in/qubo-founder',
  ev: {
    anni_dichiarati: [2025], eu: true, deep: 9, neg: 0, tags: ['Quantum'], dem: ['active pilot'],
    ts: { e: 3 }, fa: { a: [24, 27], ev: ['public ages'] },
    evd: { g: [{ amt: 100000, cur: 'eur' }], i: [{ amt: 200000, cur: 'eur' }] },
    estratto_home: 'Founded in 2025. We run an active pilot.',
  },
};

test('Sage ricerca la società, filtra le fonti e poi decide in batch', async () => {
  responseBody = sageResponse('qualified', 0.94, 'high', 91.6);
  const result = await sage.classify(candidate);
  assert.equal(result.esito, 'Qualificata');
  assert.equal(result.fit, 'Alto');
  assert.equal(result.voto, 92);
  assert.match(researchBody.content, /^Company: Qubo\. Domain: qubo\.ai\./);
  assert.deepEqual(researchBody.grounding, { trigger: 'always', confidence_floor: 0.85 });
  assert.equal(requestBody.reasoning, 'on');
  assert.deepEqual(requestBody.requests[0].questions.map(q => q.id), ['esito', 'fit', 'voto']);
  for (const question of requestBody.requests[0].questions) {
    assert.equal(question.grounding, undefined);
  }
  assert.match(requestBody.requests[0].content, /linkedin\.com\/in\/qubo-founder/);
  assert.match(requestBody.requests[0].content, /Qubo at qubo\.ai raised EUR 200k/);
  assert.doesNotMatch(requestBody.requests[0].content, /irrelevant\.example/);
  assert.match(requestBody.requests[0].content, /Never open or scrape linkedin\.com/);
  assert.match(requestBody.requests[0].questions[0].instructions, /LinkedIn snippets cannot prove age or exact headcount/);
  for (const question of requestBody.requests[0].questions) assert.match(question.instructions, /Search target: Qubo \| qubo\.ai/);
  assert.match(result.fonti, /https:\/\/example\.com\/qubo-funding/);
  assert.doesNotMatch(result.fonti, /irrelevant\.example/);
  assert.doesNotMatch(requestBody.requests[0].content, /founder@qubo\.ai/);
});

test('una qualifica Sage incerta viene declassata a Needs verification', async () => {
  responseBody = sageResponse('qualified', 0.7, 'high', 90);
  const result = await sage.classify(candidate);
  assert.equal(result.esito, 'Needs verification');
  assert.match(result.motivo, /non qualifica senza verifica completa/);
});

test('un criterio rigido mancante impedisce la qualifica', async () => {
  responseBody = sageResponse('qualified', 0.99, 'high', 95);
  const incomplete = { ...candidate, ev: { ...candidate.ev, fa: { a: [] } } };
  const result = await sage.classify(incomplete);
  assert.equal(result.esito, 'Needs verification');
  assert.match(result.da_verificare, /età founder/);
});

// ---- uso dei crediti ----

const weak = {
  dominio: 'weak.io', nome: 'Weak', sito: 'https://weak.io/', settori: 'Robotics/Physical AI', europa: 'non trovato',
  ev: { anni_dichiarati: [], eu: false, deep: 4, neg: 1, tags: ['Robotics/Physical AI'], dem: [], ts: {}, fa: { a: [] }, evd: { g: [], i: [] }, estratto_home: 'Robots.' },
};

test('Fit Basso: modalità leggera, niente ricerca web e niente reasoning', async () => {
  responseBody = sageResponse('needs_verification', 0.8, 'low', 35);
  const result = await sage.classify(weak);
  assert.equal(researchBody, null, 'nessuna ricerca web pagata');
  assert.equal(requestBody.reasoning, 'off');
  assert.match(result.versione, /leggero/);
});

test('Fit Basso ma Sage vede qualcosa di buono: si rifà in modalità completa', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push([url, JSON.parse(options.body).reasoning]); return orig(url, options); };
  responseBody = sageResponse('needs_verification', 0.8, 'high', 72);
  const result = await sage.classify(weak);
  assert.deepEqual(calls.map(c => c[0].split('/').pop()), ['batch', 'decide', 'batch']);
  assert.equal(calls[2][1], 'on');
  assert.match(result.versione, /completo/);
});

test('esclusa dall\'euristico: Sage non viene chiamato', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('non doveva chiamare'); };
  const old = { ...candidate, ev: { ...candidate.ev, anni_dichiarati: [2019] } };
  const result = await sage.classify(old);
  assert.equal(called, false);
  assert.equal(result.esito, 'Esclusa');
});

test('credito finito o chiave non valida: errore fatale, niente nuovi tentativi', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return Response.json({ error: { code: 'insufficient_credit' } }, { status: 402 }); };
  await assert.rejects(sage.classify(candidate), e => e.fatal === true);
  assert.equal(n, 1);
});

test('i consumi vengono contati', () => {
  const s = sage.stats();
  assert.ok(s.chiamate > 0);
  assert.ok(s.leggeri >= 2 && s.promossi >= 1 && s.saltati_esclusi >= 1);
});
