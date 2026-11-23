const r = await fetch('https://avoindata.prh.fi/opendata-ytj-api/v3/companies?registrationDateStart=2025-01-01&mainBusinessLine=72', { headers: { Accept: 'application/json' } });
const j = await r.json();
const c = j.companies[0];
console.log('FIK', Object.keys(c).join(','));
console.log('FIW', JSON.stringify(c.website || null), JSON.stringify(c.companyForms?.[0] || null).slice(0, 200), JSON.stringify(c.registrationDate || c.businessId));
console.log('FIN', j.companies.filter(x => x.website?.url).length, 'con sito su', j.companies.length, 'totale', j.totalResults);
for (const code of ['26', '28', '30', '21', '27', '32']) { const q = await (await fetch(`https://avoindata.prh.fi/opendata-ytj-api/v3/companies?registrationDateStart=2025-01-01&mainBusinessLine=${code}`, { headers: { Accept: 'application/json' } })).json(); console.log('FIC', code, q.totalResults); }
