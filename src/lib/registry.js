// Registri delle imprese con API pubbliche e gratuite. Danno la data di costituzione, gli amministratori
// con l'anno (o mese e anno) di nascita e, nel Regno Unito, gli aumenti di capitale (SH01), segnale di round.
// Un anno di nascita da un registro ufficiale conta come età verificata (decisione di Alex, 21 nov 2026).
// Si salva solo l'età calcolata, mai la data di nascita.
//  - Francia: recherche-entreprises.api.gouv.fr, senza chiave.
//  - Regno Unito: Companies House, chiave gratuita in COMPANIES_HOUSE_KEY (senza chiave si salta).
//  - Norvegia: Brønnøysund (data.brreg.no), senza chiave: ruoli con data di nascita completa.
//  - Repubblica Ceca: ARES (ares.gov.cz), senza chiave: organo statutario con data di nascita.
import { sleep } from './http.js';

let impl = (...a) => fetch(...a);
/** Solo per i test. */
export function setRegistryFetch(fn) { impl = fn; }
export const registryStats = { fr: 0, uk: 0, no: 0, cz: 0, trovate: 0, errori: 0 };

const LEGAL = /\b(sas|sasu|sarl|sa|eurl|sci|ltd|limited|plc|llp|gmbh|ug|bv|ab|oy|srl|spa|inc|corp|co|company|as|asa|s r o|sro|a s)\b\.?/gi;

/** Nome confrontabile: minuscolo, senza accenti, senza forma giuridica né punteggiatura. */
export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const title = s => String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, x => x.toUpperCase()).trim();

/** Età da anno e mese di nascita (mese facoltativo): {min, max}, uguali se il mese è noto. */
export function ageFrom(year, month, today = new Date()) {
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  if (!year) return { min: null, max: null };
  if (month) { const a = y - year - (m < month ? 1 : 0); return { min: a, max: a }; }
  return { min: y - year - 1, max: y - year };
}

/** Un solo risultato col nome giusto: uguale, oppure che inizia col nome (es. "Qubo Technologies"). Se ambiguo, nessuno. */
export function pickOne(items, namesOf, want) {
  if (!want || want.length < 3) return null;
  const ex = (items || []).filter(x => namesOf(x).some(n => n && normName(n) === want));
  if (ex.length === 1) return ex[0];
  if (ex.length > 1) return null;
  const pa = (items || []).filter(x => namesOf(x).some(n => n && normName(n).startsWith(want + ' ')));
  return pa.length === 1 ? pa[0] : null;
}

/** Paese del registro da interrogare, dal dominio o dai testi. 'FR', 'UK', 'NO', 'CZ' o null. */
export function registryCountry(c) {
  const d = String(c.dominio || '').toLowerCase(), t = `${c.descrizione || ''} ${c.hub_origine || ''}`;
  if (/\.fr$/.test(d)) return 'FR';
  if (/\.uk$/.test(d)) return 'UK';
  if (/\.no$/.test(d)) return 'NO';
  if (/\.cz$/.test(d)) return 'CZ';
  if (/\b(norway|norwegian|norge|oslo|trondheim|bergen|stavanger|tromsø|tromso|ntnu)\b/i.test(t)) return 'NO';
  if (/\b(czech|czechia|česk|praha|prague|brno|ostrava|plzeň|plzen|esa bic czech)\b/i.test(t)) return 'CZ';
  if (/\b(france|french|paris|lyon|toulouse|grenoble|marseille|bordeaux|nantes|lille|saclay|sophia antipolis|station f)\b/i.test(t)) return 'FR';
  if (/\b(united kingdom|uk|london|cambridge|oxford|edinburgh|manchester|bristol|glasgow|imperial college|ucl)\b/i.test(t)) return 'UK';
  return null;
}

async function getJson(url, headers = {}) {
  try {
    const r = await impl(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { if (r.status !== 404) registryStats.errori++; return null; }
    return await r.json();
  } catch { registryStats.errori++; return null; }
}

/** Francia. @returns {Promise<null|{paese,numero,nome,costituita,aumenti_capitale,persone,url}>} */
export async function franceLookup(name) {
  registryStats.fr++;
  const j = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(name)}&per_page=10`);
  const hit = pickOne(j?.results, r => [r.nom_complet, r.nom_raison_sociale, r.sigle], normName(name));
  if (!hit) return null;
  registryStats.trovate++;
  const persone = (hit.dirigeants || []).filter(d => d.type_dirigeant !== 'personne morale' && (d.date_de_naissance || d.annee_de_naissance)).map(d => {
    const [y, m] = String(d.date_de_naissance || d.annee_de_naissance).split('-').map(Number);
    return { nome: title(`${d.prenoms || ''} ${d.nom || ''}`), ruolo: d.qualite || 'dirigente', ...ageFrom(y, m) };
  });
  return { paese: 'FR', numero: hit.siren, nome: hit.nom_complet, costituita: hit.date_creation || '', aumenti_capitale: [], persone, url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${hit.siren}` };
}

/** Regno Unito. Senza COMPANIES_HOUSE_KEY restituisce null. */
export async function ukLookup(name) {
  const key = process.env.COMPANIES_HOUSE_KEY;
  if (!key) return null;
  registryStats.uk++;
  const auth = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  const base = process.env.COMPANIES_HOUSE_BASE || 'https://api.company-information.service.gov.uk';
  const s = await getJson(`${base}/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`, auth);
  const hit = pickOne(s?.items, x => [x.title], normName(name));
  if (!hit) return null;
  registryStats.trovate++;
  const n = hit.company_number;
  await sleep(250);
  const off = await getJson(`${base}/company/${n}/officers?items_per_page=35`, auth);
  await sleep(250);
  const cap = await getJson(`${base}/company/${n}/filing-history?category=capital&items_per_page=25`, auth);
  const ukName = s2 => { const [last, first] = String(s2).split(','); return title(`${first || ''} ${last || ''}`); };
  const persone = (off?.items || []).filter(o => !o.resigned_on && /director/i.test(o.officer_role || '') && o.date_of_birth?.year)
    .map(o => ({ nome: ukName(o.name), ruolo: o.officer_role, ...ageFrom(o.date_of_birth.year, o.date_of_birth.month) }));
  const aumenti = (cap?.items || []).filter(f => /^SH01/i.test(f.type || '')).map(f => f.date).filter(Boolean);
  return { paese: 'UK', numero: n, nome: hit.title, costituita: hit.date_of_creation || '', aumenti_capitale: aumenti, persone, url: `https://find-and-update.company-information.service.gov.uk/company/${n}` };
}

const NO_BASE = () => process.env.BRREG_BASE || 'https://data.brreg.no/enhetsregisteret/api';
const NO_ROLES = /^(DAGL|LEDE|NEST|MEDL|INNH|DTPR|DTSO|KOMP)$/;   // daglig leder, styreleder, nestleder, styremedlem, innehaver, deltakere

/** Persone di un'impresa norvegese (ruoli attivi con data di nascita). */
export async function norwayPeople(orgnr) {
  const j = await getJson(`${NO_BASE()}/enheter/${orgnr}/roller`);
  const out = [], seen = new Set();
  for (const g of j?.rollegrupper || []) for (const r of g.roller || []) {
    const p = r.person; if (!p || r.fratraadt || p.erDoed || !NO_ROLES.test(r.type?.kode || '')) continue;
    const [y, m] = String(p.fodselsdato || '').split('-').map(Number); if (!y) continue;
    const nome = title([p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn].filter(Boolean).join(' '));
    if (seen.has(nome)) continue; seen.add(nome);
    out.push({ nome, ruolo: r.type?.beskrivelse || r.type?.kode || 'ruolo', ...ageFrom(y, m) });
  }
  return out;
}

const noRow = (e, persone) => ({ paese: 'NO', numero: e.organisasjonsnummer, nome: e.navn, costituita: e.stiftelsesdato || e.registreringsdatoEnhetsregisteret || '', aumenti_capitale: [], persone, attivita: e.naeringskode1 ? `${e.naeringskode1.kode} ${e.naeringskode1.beskrivelse || ''}`.trim() : '', sito: e.hjemmeside || '', url: `https://virksomhet.brreg.no/nb/oppslag/enheter/${e.organisasjonsnummer}` });

/** Norvegia, per nome. */
export async function norwayLookup(name) {
  registryStats.no++;
  const j = await getJson(`${NO_BASE()}/enheter?navn=${encodeURIComponent(name)}&size=10`);
  const hit = pickOne(j?._embedded?.enheter, e => [e.navn], normName(name));
  if (!hit) return null;
  registryStats.trovate++;
  await sleep(200);
  return noRow(hit, await norwayPeople(hit.organisasjonsnummer));
}

/** Norvegia, per codice di attività (NACE) e data di registrazione: per la scoperta da registro. */
export async function norwaySearch(nace, from, page = 0, size = 100) {
  registryStats.no++;
  const j = await getJson(`${NO_BASE()}/enheter?naeringskode=${encodeURIComponent(nace)}&fraRegistreringsdatoEnhetsregisteret=${from}&size=${size}&page=${page}`);
  return { items: (j?._embedded?.enheter || []).map(e => noRow(e, null)), pagine: j?.page?.totalPages ?? 0 };
}

const CZ_BASE = () => process.env.ARES_BASE || 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest';

/** Persone dell'organo statutario di un'impresa ceca (registro commerciale), con data di nascita. */
export async function czechPeople(ico) {
  const j = await getJson(`${CZ_BASE()}/ekonomicke-subjekty-vr/${ico}`);
  const zaz = (j?.zaznamy || []).find(z => z.primarniZaznam) || (j?.zaznamy || [])[0];
  const out = [], seen = new Set();
  for (const org of zaz?.statutarniOrgany || []) for (const c of org.clenoveOrganu || []) {
    const f = c.fyzickaOsoba; if (!f || c.datumVymazu) continue;
    const [y, m] = String(f.datumNarozeni || '').split('-').map(Number); if (!y) continue;
    const nome = title(`${f.jmeno || ''} ${f.prijmeni || ''}`);
    if (seen.has(nome)) continue; seen.add(nome);
    out.push({ nome, ruolo: c.clenstvi?.funkce?.nazev || org.nazevOrganu || 'statutární orgán', ...ageFrom(y, m) });
  }
  return out;
}

/** Repubblica Ceca, per nome. */
export async function czechLookup(name) {
  registryStats.cz++;
  let j = null;
  try {
    const r = await impl(`${CZ_BASE()}/ekonomicke-subjekty/vyhledat`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ obchodniJmeno: name, pocet: 10, start: 0 }), signal: AbortSignal.timeout(15000) });
    if (r.ok) j = await r.json(); else if (r.status !== 404) registryStats.errori++;
  } catch { registryStats.errori++; }
  const hit = pickOne(j?.ekonomickeSubjekty, x => [x.obchodniJmeno], normName(name));
  if (!hit) return null;
  registryStats.trovate++;
  await sleep(200);
  return { paese: 'CZ', numero: hit.ico, nome: hit.obchodniJmeno, costituita: hit.datumVzniku || '', aumenti_capitale: [], persone: await czechPeople(hit.ico), url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${hit.ico}` };
}

/** Regno Unito, per codice SIC e data di costituzione (advanced search): per la scoperta da registro. */
export async function ukSearch(sic, from, start = 0, size = 100) {
  const key = process.env.COMPANIES_HOUSE_KEY;
  if (!key) return { items: [], pagine: 0 };
  registryStats.uk++;
  const auth = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  const base = process.env.COMPANIES_HOUSE_BASE || 'https://api.company-information.service.gov.uk';
  const j = await getJson(`${base}/advanced-search/companies?sic_codes=${sic}&incorporated_from=${from}&company_status=active&size=${size}&start_index=${start}`, auth);
  return { items: (j?.items || []).map(x => ({ paese: 'UK', numero: x.company_number, nome: x.company_name, costituita: x.date_of_creation || '', attivita: (x.sic_codes || []).join('/'), sito: '' })), pagine: Math.ceil((j?.hits || 0) / size) };
}

/** Amministratori UK con età (per la scoperta da registro). */
export async function ukPeople(n) {
  const key = process.env.COMPANIES_HOUSE_KEY;
  if (!key) return [];
  const auth = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  const base = process.env.COMPANIES_HOUSE_BASE || 'https://api.company-information.service.gov.uk';
  const ukName = s2 => { const [last, first] = String(s2).split(','); return title(`${first || ''} ${last || ''}`); };
  const off = await getJson(`${base}/company/${n}/officers?items_per_page=35`, auth);
  return (off?.items || []).filter(o => !o.resigned_on && /director/i.test(o.officer_role || '') && o.date_of_birth?.year)
    .map(o => ({ nome: ukName(o.name), ruolo: o.officer_role, ...ageFrom(o.date_of_birth.year, o.date_of_birth.month) }));
}

export async function registryLookup(c) {
  const country = registryCountry(c);
  const name = c.nome || String(c.dominio || '').split('.')[0];
  if (country === 'FR') return franceLookup(name);
  if (country === 'UK') return ukLookup(name);
  if (country === 'NO') return norwayLookup(name);
  if (country === 'CZ') return czechLookup(name);
  return null;
}
