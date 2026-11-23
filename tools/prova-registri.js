// Prova in sola lettura delle API dei registri (non scrive nel foglio). Stampa solo conteggi.
const B = 'https://data.brreg.no/enhetsregisteret/api/enheter';
for (const n of ['Flamme Aerospace', 'Space Exploration Lab', 'Aligned Robotics', 'Rubedo Bioscience', 'Hyrden', 'Norse Robotics']) {
  const r = await fetch(`${B}?navn=${encodeURIComponent(n)}&size=1`, { headers: { Accept: 'application/json' } });
  const e = (await r.json())?._embedded?.enheter?.[0];
  console.log('NOPROVA', n, e?.naeringskode1?.kode, e?.naeringskode1?.beskrivelse, '|', e?.naeringskode2?.kode || '');
}
