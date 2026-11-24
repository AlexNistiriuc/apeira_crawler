// Crawler LinkedIn: una black box per gli evaluator. Dato un candidato restituisce sempre
// un oggetto `li` con dipendenti, anno di fondazione, founder, data di inizio in azienda ed
// età stimata dalla prima esperienza educativa. I dati arrivano da ScrapeGraph (ricerca web +
// estrazione), non da login o scraping diretto di linkedin.com.
//
// Uso da un evaluator (runner dei classificatori):
//   import { ensureLinkedin } from '../crawlers/linkedin/index.js';
//   const li = await ensureLinkedin(c);        // c.li = li
//
// Uso da riga di comando (crawler autonomo, solo Alto/Medio):
//   npm run linkedin -- [quante]
//
// Cache: se `linkedin_il` è recente e `linkedin_dati` inizia con `[SG]`, non si richiama ScrapeGraph.
// Scrittura: colonne dedicate `linkedin_dati`, `linkedin_fonti`, `linkedin_il`; le colonne del
// crawler founder (eta_stimata, fonti_eta, eta_il) restano intatte.
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { now, today } from '../../lib/config.js';
import { provider, structuredSearch, searchStats, resetSearchStats } from '../../lib/search.js';
import { pickPeople } from '../../signals/facts.js';
import { pickBest } from '../founders/index.js';
import { ageFromEducation, earliestStart, startYear, tenureText, band, parseYear } from '../../signals/age.linkedin.js';
import euristico from '../../classifiers/euristico.js';

const MARK = '[SG]';
const TARGET_FIT = new Set(['Alto', 'Medio']);
const DEFAULT_CACHE_DAYS = 30;

export const linkedinStats = { candidati: 0, disponibili: 0, cache: 0, non_disponibili: 0, saltati_fit: 0, errori: 0, tetti: 0, founder: 0, dipendenti: 0 };
export function resetLinkedinStats() {
  for (const k of Object.keys(linkedinStats)) linkedinStats[k] = 0;
}

const COMPANY_SCHEMA = {
  type: 'object',
  properties: {
    company_name: { type: 'string' },
    linkedin_url: { type: 'string' },
    employees: { type: ['integer', 'string'] },
    employees_range: { type: 'string' },
    founded_year: { type: ['integer', 'null'] },
    confidence: { type: 'string' },
  },
};

const FOUNDER_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    linkedin_url: { type: 'string' },
    current_company: { type: 'string' },
    role: { type: 'string' },
    start_at_company: { type: ['string', 'null'] },
    first_education: {
      type: 'object',
      properties: {
        institution: { type: ['string', 'null'] },
        degree: { type: ['string', 'null'] },
        start_year: { type: ['integer', 'null'] },
        end_year: { type: ['integer', 'null'] },
      },
    },
    confidence: { type: 'string' },
  },
};

const clean = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, max);
const splitList = value => String(value || '').split(/\s*,\s*/).filter(Boolean);
const cacheDays = () => Number(process.env.SCRAPEGRAPH_CACHE_DAYS || DEFAULT_CACHE_DAYS);
const maxFounders = () => Number(process.env.SCRAPEGRAPH_MAX_FOUNDERS || 3);
const maxStartups = () => Number(process.env.SCRAPEGRAPH_MAX_STARTUPS || 40);

function evidence(c) {
  if (c.ev && typeof c.ev === 'object') return c.ev;
  try { return c.evidenze ? JSON.parse(c.evidenze) : {}; } catch { return {}; }
}

async function fitOf(c) {
  try { return (await euristico.classify({ ...c, ev: evidence(c) })).fit; } catch { return null; }
}

function cacheText(c) {
  if (String(c.linkedin_dati || '').startsWith(MARK)) return c.linkedin_dati;
  return String(c.eta_stimata || '').startsWith(MARK) ? c.eta_stimata : '';
}

function cacheFresh(c) {
  const text = cacheText(c);
  const when = c.linkedin_il || c.eta_il;
  if (!text || !when) return false;
  const at = Date.parse(String(when).replace(' ', 'T'));
  if (!Number.isFinite(at)) return false;
  return (Date.now() - at) / 86_400_000 <= cacheDays();
}

// ---------------------------------------------------------------- estrazione

/** La prima esperienza educativa, anche quando il modello la restituisce come lista. */
function firstEducation(value) {
  const list = Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : value && typeof value === 'object' ? [value] : [];
  if (!list.length) return null;
  const yearOf = item => parseYear(item.start_year ?? item.startYear ?? item.start ?? item.end_year ?? item.endYear ?? item.end) ?? 9999;
  return list.sort((a, b) => yearOf(a) - yearOf(b))[0];
}

const lastName = value => String(value || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';

/** Scarta omonimi e profili di altre aziende: il cognome e l'azienda devono tornare. */
function samePerson(json, person, company) {
  if (json.name && lastName(json.name) !== lastName(person.nome)) return false;
  const current = String(json.current_company || '').toLowerCase();
  if (current && company) {
    const tokens = String(company).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length >= 3);
    if (tokens.length && !tokens.some(token => current.includes(token))) return false;
  }
  return true;
}

async function linkedinCompany(c) {
  const name = c.nome || c.dominio;
  const prompt = `Find public information about "${name}" (website ${c.sito || c.dominio}). Extract the employee count or range and the founded year exactly as shown. Use public pages or search-result snippets; do not open linkedin.com. Do not guess: use an empty string or null when unknown.`;
  const response = await structuredSearch(`"${name}" company employees founded`, {
    numResults: 5,
    prompt,
    schema: COMPANY_SCHEMA,
  });
  const json = response.json || {};
  const employees = clean(json.employees_range || json.employees, 40);
  const founded = parseYear(json.founded_year);
  return {
    employees,
    founded,
    linkedin: clean(json.linkedin_url, 300),
    sources: response.results.map(result => result.url).filter(Boolean).slice(0, 4),
  };
}

async function linkedinFounder(person, c, year) {
  const company = c.nome || c.dominio;
  const prompt = `Find public information about ${person.nome}, ${person.ruolo} of ${company} (${c.sito || c.dominio}). Extract the month/year they started at this company, their role, and their FIRST (earliest) education entry with institution, degree, start year and end year. Use public pages or search-result snippets; do not open linkedin.com. Ignore namesakes and other companies. Use null when unknown.`;
  const response = await structuredSearch(`"${person.nome}" "${company}" founder`, {
    numResults: 4,
    prompt,
    schema: FOUNDER_SCHEMA,
  });
  const json = response.json || {};
  if (!samePerson(json, person, company)) return null;
  const education = firstEducation(json.first_education);
  const start = json.start_at_company || '';
  const eta = ageFromEducation(education, year);
  return {
    nome: clean(json.name || person.nome, 80),
    ruolo: clean(json.role || person.ruolo, 40),
    linkedin: clean(json.linkedin_url, 300) || response.results.find(result => /linkedin\.com\/in\//i.test(result.url))?.url || '',
    da: clean(start, 40),
    da_anno: startYear(start),
    eta,
    fascia: eta == null ? 'non determinabile' : band(eta),
    education,
    sources: response.results.map(result => result.url).filter(Boolean).slice(0, 3),
  };
}

async function enrich(c, year) {
  const people = pickPeople(c.founder_nomi).slice(0, maxFounders());
  const settle = async promise => { try { return { value: await promise }; } catch (error) { return { error }; } };
  // Azienda e founder sono indipendenti: in parallelo il tempo di parete resta quello di una chiamata.
  const [companyResult, ...founderResults] = await Promise.all([
    settle(linkedinCompany(c)),
    ...people.map(person => settle(linkedinFounder(person, c, year))),
  ]);
  let company = { employees: '', founded: null, linkedin: '', sources: [] };
  if (companyResult.error) { if (companyResult.error.fatal || companyResult.error.skip) throw companyResult.error; linkedinStats.errori++; }
  else company = companyResult.value;
  const founders = [];
  for (const result of founderResults) {
    if (result.error) { if (result.error.fatal || result.error.skip) throw result.error; linkedinStats.errori++; }
    else if (result.value) founders.push(result.value);
  }
  const useful = company.employees || company.founded || founders.some(f => f.eta != null || f.da);
  if (!useful) return null;
  const founded = company.founded || earliestStart(founders);
  const sources = [...new Set([
    company.linkedin,
    ...company.sources,
    ...founders.flatMap(f => [f.linkedin, ...f.sources]),
  ].filter(Boolean))];
  return { dipendenti: company.employees, fondata: founded, founders, fonti: sources };
}

// ---------------------------------------------------------------- testo e cache

/** Testo deterministico e rileggibile, con il prefisso che distingue la cache ScrapeGraph. */
export function composeLinkedinText(data, { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = {}) {
  const parts = [];
  if (data.dipendenti) parts.push(`Dipendenti: ${clean(data.dipendenti, 40)}`);
  if (data.fondata) parts.push(`Fondata: ${data.fondata}`);
  const founders = (data.founders || []).map(f => {
    const role = f.ruolo ? ` (${clean(f.ruolo, 40)})` : '';
    const from = f.da ? tenureText(f.da, year, month) : 'dal n.d.';
    const age = f.eta != null ? `età ~${f.eta} (${f.fascia})` : 'età n.d.';
    return `${clean(f.nome, 80)}${role} ${from}, ${age}`;
  });
  if (founders.length) parts.push(`Founder: ${founders.join('; ')}`);
  return `${MARK} ${parts.join(' | ')}`;
}

function parseFounder(text) {
  const m = String(text).match(/^(.+?)(?: \(([^)]+)\))? (dal .+), età (?:~(\d+) \(([^)]+)\)|n\.d\.)$/);
  if (!m) return null;
  const da = (m[3].match(/^dal (\S+)/) || [])[1] || '';
  return {
    nome: m[1].trim(),
    ruolo: m[2] || '',
    da: da === 'n.d.' ? '' : da,
    da_anno: startYear(da),
    eta: m[4] ? Number(m[4]) : null,
    fascia: m[5] || 'non determinabile',
    linkedin: '',
    education: null,
  };
}

/** Rilegge il testo scritto da `composeLinkedinText` (cache tra un giro e l'altro). */
export function parseLinkedinText(text) {
  const s = String(text || '');
  if (!s.startsWith(MARK)) return null;
  const body = s.slice(MARK.length).trim();
  const foundersPart = (body.match(/(?:^|\|) ?Founder: (.*)$/) || [])[1] || '';
  const companyPart = body.replace(/(?:^|\|) ?Founder: .*$/, '');
  const dipendenti = clean((companyPart.match(/Dipendenti: ([^|]+)/) || [])[1], 40);
  const fondata = Number((companyPart.match(/Fondata: (\d{4})/) || [])[1]) || null;
  const founders = foundersPart ? foundersPart.split('; ').map(parseFounder).filter(Boolean) : [];
  return { disponibile: true, dipendenti, fondata, founders, testo: s };
}

// ---------------------------------------------------------------- API black box

function unavailable(motivo) {
  return { disponibile: false, motivo, fatal: false, dipendenti: '', fondata: null, founders: [], testo: '', fonti: [] };
}

const MEM = new Map();
/** Solo per i test: svuota la cache in memoria del processo. */
export function clearLinkedinMemory() { MEM.clear(); }

/**
 * Garantisce i dati LinkedIn di un candidato. È la funzione che gli evaluator devono usare.
 * Restituisce sempre lo stesso oggetto: `{ disponibile, motivo?, dipendenti, fondata, founders, testo, fonti, fonte }`.
 *
 * @param {object} c riga di db_candidati
 * @param {{fit?:string, force?:boolean, write?:boolean, year?:number}} [options]
 *   fit: se assente si calcola con l'euristico; solo Alto/Medio vengono arricchiti.
 *   force: ignora il gate del fit e la cache.
 *   write: salva in db_candidati (default true).
 */
export async function ensureLinkedin(c, { fit, force = false, write = true, year = new Date().getFullYear() } = {}) {
  const targetFit = fit || (force ? 'Alto' : await fitOf(c));
  if (!force && !TARGET_FIT.has(targetFit)) {
    linkedinStats.saltati_fit++;
    return unavailable(`fit ${targetFit || 'non determinato'}`);
  }
  if (!force) {
    if (c.dominio && MEM.has(c.dominio)) {
      linkedinStats.cache++;
      return { ...MEM.get(c.dominio), fonte: 'cache' };
    }
    if (cacheFresh(c)) {
      const parsed = parseLinkedinText(cacheText(c));
      if (parsed) {
        parsed.fonti = splitList(c.linkedin_fonti || c.fonti_eta);
        parsed.fonte = 'cache';
        if (c.dominio) MEM.set(c.dominio, parsed);
        linkedinStats.cache++;
        return parsed;
      }
    }
  }
  if (provider() !== 'scrapegraph') {
    linkedinStats.non_disponibili++;
    return unavailable('SCRAPEGRAPH_API_KEY mancante');
  }

  linkedinStats.candidati++;
  let data;
  try { data = await enrich(c, year); }
  catch (error) {
    if (error.skip) { linkedinStats.tetti++; return { ...unavailable('tetto ScrapeGraph per giro raggiunto'), tetto: true }; }
    linkedinStats.errori++;
    return { ...unavailable(`ScrapeGraph: ${error.message}`), fatal: Boolean(error.fatal) };
  }
  if (!data) {
    linkedinStats.non_disponibili++;
    return unavailable('nessun dato LinkedIn trovato');
  }
  const result = {
    disponibile: true,
    ...data,
    testo: composeLinkedinText(data, { year }),
    fonti: data.fonti,
    fonte: 'scrapegraph',
  };
  if (c.dominio) MEM.set(c.dominio, result);
  linkedinStats.disponibili++;
  linkedinStats.founder += result.founders.length;
  if (result.dipendenti) linkedinStats.dipendenti++;
  if (write && c.dominio) {
    await upsert(TABS.cand, 'dominio', [{
      dominio: c.dominio,
      linkedin_dati: result.testo,
      linkedin_fonti: result.fonti.join(', '),
      linkedin_il: today(),
    }]);
  }
  return result;
}

/** Crawler autonomo: arricchisce le migliori Alto/Medio non ancora fatte. */
export async function run(n = 100, log = console.log) {
  const startedAt = now();
  resetLinkedinStats();
  resetSearchStats();
  const st = { candidate: 0, disponibili: 0, cache: 0, non_disponibili: 0, saltati_fit: 0, errori: 0, founder: 0, dipendenti: 0 };
  if (provider() !== 'scrapegraph') {
    log('SCRAPEGRAPH_API_KEY mancante: crawler LinkedIn saltato');
    st.saltato = 'manca SCRAPEGRAPH_API_KEY';
    await logRun('crawler linkedin', startedAt, st);
    return st;
  }
  const cands = new Map((await read(TABS.cand, {
    columns: ['dominio', 'nome', 'sito', 'founder_nomi', 'linkedin_dati', 'linkedin_fonti', 'linkedin_il', 'eta_il', 'eta_stimata', 'fonti_eta', 'evidenze'],
  })).map(c => [c.dominio, c]));
  const best = pickBest(await read(TABS.eval, { columns: ['dominio', 'classificatore', 'esito', 'fit', 'voto'] }), n)
    .map(v => ({ ...cands.get(v.dominio), _fit: v.fit }))
    .filter(c => c && c.dominio)
    .slice(0, maxStartups());
  st.candidate = best.length;
  for (const c of best) await ensureLinkedin(c, { fit: c._fit, write: true });
  Object.assign(st, {
    candidati_arricchiti: linkedinStats.candidati,
    disponibili: linkedinStats.disponibili,
    cache: linkedinStats.cache,
    non_disponibili: linkedinStats.non_disponibili,
    saltati_fit: linkedinStats.saltati_fit,
    errori: linkedinStats.errori,
    founder: linkedinStats.founder,
    dipendenti: linkedinStats.dipendenti,
    scrapegraph: { ...searchStats },
  });
  await logRun('crawler linkedin', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(Number(process.argv[2] || 100)).catch(error => { console.error(error); process.exit(1); });
}
