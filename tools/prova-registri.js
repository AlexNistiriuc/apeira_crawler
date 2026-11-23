// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi.
const B = 'https://data.brreg.no/enhetsregisteret/api/enheter';
for (const q of ['naeringskode=72.190&size=1', 'naeringskode=72.19&size=1', 'naeringskode=72.190&fraRegistreringsdatoEnhetsregisteret=2025-01-01&size=1', 'naeringskode=72.190&fraStiftelsesdato=2025-01-01&size=1', 'naeringskode=72.190&fraRegistreringsdatoEnhetsregisteret=2025-01-01&tilRegistreringsdatoEnhetsregisteret=2026-12-31&size=1', 'navn=Nara&size=1']) {
  const r = await fetch(`${B}?${q}`, { headers: { Accept: 'application/json' } });
  const j = r.ok ? await r.json() : null;
  console.log('NOPROVA', r.status, q, 'totale', j?.page?.totalElements, 'esempio', JSON.stringify(j?._embedded?.enheter?.[0]?.naeringskode1 || null), j?._embedded?.enheter?.[0]?.registreringsdatoEnhetsregisteret, j?._embedded?.enheter?.[0]?.stiftelsesdato);
}
