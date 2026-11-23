// Prova in sola lettura: Finlandia (PRH) e Lettonia (open data) con la configurazione vera. Solo conteggi ed età.
import { readFileSync } from 'node:fs';
import { finlandSearch } from '../src/lib/registry.js';
import { latviaCompanies } from '../src/crawlers/registri/lettonia.js';
const CFG = JSON.parse(readFileSync(new URL('../config/registri.json', import.meta.url), 'utf8'));
for (const code of CFG.finlandia_codici) { const r = await finlandSearch(code, CFG.costituite_dal, 1); console.log('FI', code, r.items.length, 'società, con sito', r.items.filter(x => x.sito).length, 'pagine', r.pagine, r.items.filter(x => x.sito).slice(0, 2).map(x => `${x.nome} ${x.sito}`).join(' | ')); }
const t0 = Date.now();
const lv = await latviaCompanies(CFG.costituite_dal, new RegExp(CFG.lettonia_parole_nome, 'i'));
const young = lv.filter(c => c.persone.length && c.persone.every(p => p.max != null && p.max <= 34));
console.log('LV', lv.length, 'società dal 2025 con nome deep tech,', young.length, 'con tutti gli amministratori sotto 35 ·', Math.round((Date.now() - t0) / 1000), 's ·', young.slice(0, 8).map(c => c.nome).join(' | '));
