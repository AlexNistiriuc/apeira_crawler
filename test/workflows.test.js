// GitHub rifiuta un workflow con chiavi ripetute nello stesso step (es. due "env:"): il workflow
// non parte proprio. È successo il 20 novembre con crawl-startups.yml. Questo test lo impedisce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

test('crawler LinkedIn esiste e i classificatori ricevono SCRAPEGRAPH_API_KEY', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const text = name => readFileSync(new URL(name, dir), 'utf8');
  const linkedin = text('crawl-linkedin.yml');
  assert.match(linkedin, /npm run linkedin/);
  assert.match(linkedin, /SCRAPEGRAPH_API_KEY/);
  assert.match(linkedin, /SCRAPEGRAPH_MAX_PER_RUN/);
  for (const file of ['crawl-startups.yml', 'classify-sage.yml', 'classify.yml']) {
    const workflow = text(file);
    assert.match(workflow, /SCRAPEGRAPH_API_KEY/, `${file}: manca la chiave ScrapeGraph`);
    assert.match(workflow, /npm run (classify|founders)/, `${file}: manca il passo che arricchisce`);
  }
});

test('nessuna chiave ripetuta negli step dei workflow', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const lines = readFileSync(new URL(f, dir), 'utf8').split('\n');
    let seen = new Set();
    for (const l of lines) {
      if (/^\s*- /.test(l)) seen = new Set();                          // nuovo step
      const m = l.match(/^(\s{8})([a-z-]+):/);                         // chiave dello step (8 spazi)
      const first = l.match(/^\s{6}- ([a-z-]+):/);
      const k = m ? m[2] : first ? first[1] : null;
      if (!k) continue;
      assert.ok(!seen.has(k), `${f}: chiave "${k}" ripetuta nello stesso step`);
      seen.add(k);
    }
  }
});
