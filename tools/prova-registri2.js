// Prova in sola lettura: filtri di ricerca dei registri francese (recherche-entreprises) e ceco (ARES). Solo conteggi.
const FR = 'https://recherche-entreprises.api.gouv.fr/search';
for (const q of ['activite_principale=72.19Z&per_page=5', 'activite_principale=72.19Z&per_page=5&date_creation_min=2025-01-01', 'activite_principale=72.19Z&per_page=5&date_creation=2025', 'q=robotique&per_page=5&date_creation_min=2025-01-01', 'section_activite_principale=M&activite_principale=72.19Z&per_page=5&etat_administratif=A']) {
  const r = await fetch(`${FR}?${q}`, { headers: { Accept: 'application/json' } });
  const j = r.ok ? await r.json() : null;
  const e = j?.results?.[0];
  console.log('FRPROVA', r.status, q, 'totale', j?.total_results, 'es. creazione', e?.date_creation, 'dirigenti', (e?.dirigeants || []).length, 'campi dirigente', Object.keys(e?.dirigeants?.[0] || {}).join(','), r.ok ? '' : (await r.text()).slice(0, 150));
}
const CZ = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat';
for (const body of [{ czNace: ['72110'], pocet: 5 }, { czNace: ['721'], pocet: 5 }, { czNace: ['72110'], pocet: 5, razeni: ['-DATUM_VZNIKU'] }, { czNace: ['72190'], pocet: 5, datumVznikuOd: '2025-01-01' }]) {
  const r = await fetch(CZ, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = r.ok ? await r.json() : null;
  console.log('CZPROVA', r.status, JSON.stringify(body), 'totale', j?.pocetCelkem, 'date', (j?.ekonomickeSubjekty || []).map(x => x.datumVzniku).join(' '), r.ok ? '' : (await r.text()).slice(0, 200));
}
// Estonia: open data del registro (solo per vedere se risponde e che campi ha)
const ee = await fetch('https://ariregister.rik.ee/est/api/autocomplete?q=robot', { headers: { Accept: 'application/json' } });
console.log('EEPROVA', ee.status, (await ee.text()).slice(0, 200));
