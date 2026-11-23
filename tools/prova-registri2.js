// Prova in sola lettura: BODACC (creazioni in Francia) e varianti ARES. Solo conteggi.
const B = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
const w = encodeURIComponent(`familleavis="creation" and dateparution>="2025-06-01" and search("recherche et développement")`);
let r = await fetch(`${B}?where=${w}&limit=3`, { headers: { Accept: 'application/json' } });
let j = r.ok ? await r.json() : null;
console.log('BOPROVA', r.status, 'totale', j?.total_count, 'campi', Object.keys(j?.results?.[0] || {}).join(','));
const e = j?.results?.[0]; if (e) console.log('BOPROVA es', e.dateparution, e.registre, String(e.commercant || '').slice(0, 40), String(e.listeetablissements || e.etablissement || '').slice(0, 200));
for (const body of [{ czNace: ['7211'], pocet: 3 }, { czNace: ['72'], pocet: 3 }, { czNace: ['72110'], pravniForma: ['112'], pocet: 3 }, { obchodniJmeno: 'robot', pocet: 3 }]) {
  r = await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  j = r.ok ? await r.json() : null;
  console.log('CZPROVA', r.status, JSON.stringify(body), 'totale', j?.pocetCelkem, 'nace', JSON.stringify(j?.ekonomickeSubjekty?.[0]?.czNace || null), 'vznik', j?.ekonomickeSubjekty?.[0]?.datumVzniku, r.ok ? '' : (await r.text()).slice(0, 150));
}
for (const path of ['ekonomicke-subjekty-res/vyhledat', 'ekonomicke-subjekty-vr/vyhledat']) {
  r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ czNace: ['72110'], pocet: 3 }) });
  console.log('CZPROVA2', path, r.status, (await r.text()).slice(0, 200));
}
