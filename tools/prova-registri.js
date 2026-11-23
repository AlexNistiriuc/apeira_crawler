// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi.
const B = 'https://data.brreg.no/enhetsregisteret/api/enheter';
const codes = ['72.100', '72.110', '72.120', '26.110', '26.120', '26.300', '26.510', '26.600', '27.200', '28.990', '30.300', '21.200', '71.122', '71.129', '62.010', '62.100'];
for (const c of codes) for (const d of ['', '&fraRegistreringsdatoEnhetsregisteret=2025-01-01']) {
  const r = await fetch(`${B}?naeringskode=${c}${d}&size=1`, { headers: { Accept: 'application/json' } });
  const j = r.ok ? await r.json() : null;
  console.log('NOPROVA', c, d ? 'dal 2025' : 'tutte', r.status, j?.page?.totalElements, j?._embedded?.enheter?.[0]?.naeringskode1?.beskrivelse || '');
}
