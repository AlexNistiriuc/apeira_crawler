// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi ed età, mai date di nascita.
// Uso: workflow "prova registri" (dal sandbox i registri non sono raggiungibili).
import { readFileSync } from 'node:fs';
import { norwaySearch, norwayLookup, czechLookup, ukLookup, ukSearch, ukPeople, registryStats } from '../src/lib/registry.js';
const CFG = JSON.parse(readFileSync(new URL('../config/registri.json', import.meta.url), 'utf8'));
console.log('UK chiave presente', Boolean(process.env.COMPANIES_HOUSE_KEY));
for (const n of ['Basilisk Dynamics', 'Kerova Systems', 'Ducky Drones']) { const r = await ukLookup(n); console.log('UK nome', n, '->', r ? `${r.nome} ${r.costituita} età ${r.persone.map(x => x.max).join('/')}` : 'non trovata'); }
for (const sic of CFG.uk_sic.slice(0, 3)) { const r = await ukSearch(sic, CFG.costituite_dal, 0, 20); console.log('UK SIC', sic, r.items.length, 'società (prima pagina), pagine', r.pagine); if (r.items[0]) { const p = await ukPeople(r.items[0].numero); console.log('   es.', r.items[0].nome, r.items[0].costituita, 'età', p.map(x => x.max).join('/') || 'nessuna'); } }
const no = await norwaySearch(CFG.norvegia_nace[0], CFG.costituite_dal, 0, 20); console.log('NO', CFG.norvegia_nace[0], no.items.length);
const nara = await norwayLookup('Nara'); console.log('NO Nara', nara ? nara.persone.map(x => x.max).join('/') : 'non trovata');
const cz = await czechLookup('Malnus'); console.log('CZ Malnus', cz ? cz.persone.map(x => x.max).join('/') : 'non trovata');
console.log(JSON.stringify(registryStats));
