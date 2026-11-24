// Prova in sola lettura: Belgio, scarica il file completo più recente e conta le imprese che entrerebbero.
import { readFileSync } from 'node:fs';
import { belgiumCompanies } from '../src/crawlers/registri/belgio.js';
const CFG = JSON.parse(readFileSync(new URL('../config/registri.json', import.meta.url), 'utf8'));
const t0 = Date.now();
const { items, file } = await belgiumCompanies({ from: CFG.costituite_dal, codes: CFG.belgio_nace });
const s = items.filter(x => x.sito);
console.log('BE', file, items.length, 'imprese dal 2025 con NACE deep tech,', s.length, 'con sito ·', Math.round((Date.now() - t0) / 1000), 's ·', s.slice(0, 10).map(x => `${x.nome} (${x.sito})`).join(' | '));
