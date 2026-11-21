// GitHub rifiuta un workflow con chiavi ripetute nello stesso step (es. due "env:"): il workflow
// non parte proprio. È successo il 20 novembre con crawl-startups.yml. Questo test lo impedisce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

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
