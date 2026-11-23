// Prova in sola lettura: Lettonia con la configurazione vera. Solo conteggi.
import { readFileSync } from 'node:fs';
import { latviaCompanies } from '../src/crawlers/registri/lettonia.js';
const CFG = JSON.parse(readFileSync(new URL('../config/registri.json', import.meta.url), 'utf8'));
const lv = await latviaCompanies(CFG.costituite_dal, new RegExp(CFG.lettonia_parole_nome, 'i'), fetch);
const young = lv.filter(c => c.persone.length && c.persone.every(p => p.max != null && p.max <= 34));
console.log('LV', lv.length, 'società dal 2025 con nome deep tech,', young.length, 'con tutti gli amministratori sotto 35 ·', young.slice(0, 10).map(c => c.nome).join(' | '));
