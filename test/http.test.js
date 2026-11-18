// Un sito che manda header e poi non chiude mai il corpo non deve bloccare il crawler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.HTTP_TIMEOUT_MS = '400';
process.env.NO_JINA = '1';
const { setFetch, getPage, getRaw, withTimeout } = await import('../src/lib/http.js');

test('corpo infinito: la lettura scade invece di restare appesa', async () => {
  setFetch(async (url, opt) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<html><body>')); opt.signal.addEventListener('abort', () => c.error(new Error('abort'))); } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  });
  const t0 = Date.now();
  const r = await getPage('https://slow.example/');
  assert.ok(Date.now() - t0 < 3000, 'deve uscire entro il timeout');
  assert.notEqual(r.status, 200);
  const r2 = await getRaw('https://slow.example/sitemap.xml');
  assert.equal(r2.status, 0);
});

test('withTimeout restituisce il ripiego', async () => {
  assert.equal(await withTimeout(new Promise(() => {}), 50, 'tardi'), 'tardi');
  assert.equal(await withTimeout(Promise.resolve(1), 50, 'tardi'), 1);
});
