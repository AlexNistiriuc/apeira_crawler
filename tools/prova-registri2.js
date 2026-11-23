import { eachCsvRow } from '../src/crawlers/registri/lettonia.js';
const types = {}, closed = {}; let n = 0, recent = 0; const sample = [];
await eachCsvRow('https://dati.ur.gov.lv/register/register.csv', r => { n++; if (r.registered >= '2025-01-01') { recent++; types[r.type] = (types[r.type] || 0) + 1; closed[`${r.terminated ? 'T' : '-'}${r.closed || '-'}`] = (closed[`${r.terminated ? 'T' : '-'}${r.closed || '-'}`] || 0) + 1; if (sample.length < 3 && r.type === 'SIA') sample.push(JSON.stringify(r).slice(0, 300)); } }, fetch);
console.log('LVD righe', n, 'dal 2025', recent, JSON.stringify(types), JSON.stringify(closed));
for (const s of sample) console.log('LVD es', s);
