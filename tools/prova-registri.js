// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi ed età, mai date di nascita.
// Uso: workflow "prova registri" (dal sandbox i registri non sono raggiungibili).
import { readFileSync } from 'node:fs';
import { norwaySearch, norwayPeople, norwayLookup, czechLookup, registryStats } from '../src/lib/registry.js';
const CFG = JSON.parse(readFileSync(new URL('../config/registri.json', import.meta.url), 'utf8'));
for (const nace of CFG.norvegia_nace) { const r = await norwaySearch(nace, CFG.costituite_dal, 0, 100); console.log('NO', nace, r.items.length, 'società (prima pagina), con sito', r.items.filter(x => x.sito).length, 'pagine', r.pagine); }
const first = (await norwaySearch(CFG.norvegia_nace[0], CFG.costituite_dal, 0, 5)).items;
for (const r of first) { const p = await norwayPeople(r.numero); console.log('  ', r.nome, r.costituita, 'età', p.map(x => x.max).join('/') || 'nessuna'); }
for (const n of ['Nara', 'Tempe Defence']) { const r = await norwayLookup(n); console.log('NO nome', n, '->', r ? `${r.nome} ${r.costituita} età ${r.persone.map(x => x.max).join('/')}` : 'non trovata'); }
for (const n of ['Zenit Astronomy', 'Malnus']) { const r = await czechLookup(n); console.log('CZ nome', n, '->', r ? `${r.nome} ${r.costituita} età ${r.persone.map(x => x.max).join('/')}` : 'non trovata'); }
console.log(JSON.stringify(registryStats));
