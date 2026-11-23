// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi ed età, mai date di nascita.
import { norwaySearch, norwayPeople, norwayLookup, czechLookup, registryStats } from '../src/lib/registry.js';
const no = await norwaySearch('72.190', '2025-01-01', 0, 20);
console.log('NO ricerca NACE 72.190 dal 2025:', no.items.length, 'società, pagine', no.pagine, '· con sito', no.items.filter(x => x.sito).length);
for (const r of no.items.slice(0, 5)) { const p = await norwayPeople(r.numero); console.log(' ', r.nome, r.costituita, 'persone', p.length, 'età', p.map(x => x.max).join('/')); }
for (const n of ['Nara', 'Tempe Defence', 'Flamme Aerospace']) { const r = await norwayLookup(n); console.log('NO nome', n, '->', r ? `${r.nome} ${r.costituita} persone ${r.persone.length} età ${r.persone.map(x => x.max).join('/')}` : 'non trovata'); }
for (const n of ['Zenit Astronomy', 'Malnus', 'Celestia Energy']) { const r = await czechLookup(n); console.log('CZ nome', n, '->', r ? `${r.nome} ${r.costituita} persone ${r.persone.length} età ${r.persone.map(x => x.max).join('/')}` : 'non trovata'); }
console.log(JSON.stringify(registryStats));
