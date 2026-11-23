// Scoperta da registro: parte dalle società, non dagli hub. Registri con data di nascita degli amministratori
// (Norvegia sempre, Regno Unito con COMPANIES_HOUSE_KEY), per codice di attività e costituite di recente.
// Una società entra in db_candidati (stato da_ricontrollare, così il crawler startup ne legge il sito) solo se:
//  - tutti gli amministratori con data di nascita hanno meno di 35 anni (almeno uno);
//  - ha un sito: dal registro o, se manca, da una ricerca (al massimo ricerche_sito_per_giro a giro).
// registro ed eta_verificate si scrivono subito: il criterio severo li legge come età verificate.
// Uso: npm run registri        (DRY=1 non scrive nel foglio, stampa solo)
import { readFileSync, appendFileSync } from 'node:fs';
import { read, upsert, logRun, TABS } from '../../lib/sheet.js';
import { now } from '../../lib/config.js';
import { CRITERIA as C } from '../../lib/config.js';
import { reg, host, bad } from '../../lib/url.js';
import { norwaySearch, norwayPeople, ukSearch, ukPeople, normName, registryStats } from '../../lib/registry.js';
import { webSearch, searchEnabled, searchLog } from '../../lib/search.js';
import { sleep } from '../../lib/http.js';

const CFG = JSON.parse(readFileSync(new URL('../../../config/registri.json', import.meta.url), 'utf8'));

/** Dominio del sito dal campo del registro ("www.x.no", "https://x.no/"). */
export function siteDomain(s) {
  const t = String(s || '').trim(); if (!t) return '';
  const h = host(/^https?:\/\//i.test(t) ? t : 'https://' + t);
  return h && !bad(h) ? reg(h) : '';
}

/** Tutti giovani: almeno una persona con età nota e nessuna oltre il limite. */
export const allYoung = persone => persone.length > 0 && persone.every(p => p.max != null && p.max <= C.max_founder_age);

/** Il sito trovato con una ricerca è della società se il dominio contiene una parola distintiva del nome. */
export function siteFromResults(name, results) {
  const words = normName(name).split(' ').filter(w => w.length >= 4 && !/^(technolog|systems?|labs?|industries|solutions?|group|holding|research|international)/.test(w));
  if (!words.length) return '';
  for (const r of results || []) {
    const h = host(r.url); if (!h || bad(h) || /linkedin|facebook|crunchbase|companieshouse|company-information|find-and-update|endole|opencorporates|dnb\.com|proff|brreg|purehelp|bizstats|zoominfo|pitchbook|tracxn/i.test(h)) continue;
    const d = reg(h).split('.')[0].replace(/-/g, '');
    if (words.some(w => d.includes(w))) return reg(h);
  }
  return '';
}

export async function run({ log = console.log, dry = process.env.DRY === '1' } = {}) {
  const startedAt = now();
  const st = { societa_lette: 0, giovani: 0, con_sito: 0, siti_da_ricerca: 0, nuove_in_coda: 0, gia_note: 0, ricerche_sito: 0, per_codice: {} };
  const known = new Set(dry ? [] : (await read(TABS.cand, { columns: ['dominio'] })).map(r => r.dominio));
  // ogni società letta si segna in db_scoperta (tipo registro), giovane o no, con o senza sito: non si rilegge
  // e soprattutto non si ripaga la ricerca del sito al giro dopo
  const seenReg = new Set(dry ? [] : (await read('db_scoperta', { columns: ['query', 'tipo'] })).filter(r => r.tipo === 'registro').map(r => r.query));
  const key = r => `registro ${r.paese} ${r.numero}`;
  const out = [], seenRows = [];
  let budget = CFG.max_societa_per_giro;

  async function consider(r, people, codice) {
    if (seenReg.has(key(r))) return;
    st.societa_lette++; budget--;
    seenReg.add(key(r));
    const mark = esito => seenRows.push({ query: key(r), tipo: 'registro', settore: codice, luogo: r.paese, livello: 'registro', usata_il: now().slice(0, 10), risultati: 1, hub_nuovi: esito === 'in coda' ? 1 : 0, hub_utili: 0 });
    const persone = await people(r.numero);
    if (!allYoung(persone)) return mark(persone.length ? 'amministratori 35+' : 'senza età');
    st.giovani++;
    let dom = siteDomain(r.sito);
    if (!dom && searchEnabled() && st.ricerche_sito < CFG.ricerche_sito_per_giro) {
      st.ricerche_sito++;
      dom = siteFromResults(r.nome, await webSearch(`"${r.nome.replace(/\b(ltd|limited|as)\b\.?/gi, '').trim()}" ${r.paese === 'UK' ? 'UK' : 'Norway'}`, { count: 5 }));
      if (dom) st.siti_da_ricerca++;
    }
    if (!dom) return mark('senza sito');
    st.con_sito++;
    if (known.has(dom)) { st.gia_note++; return mark('già nota'); }
    known.add(dom); mark('in coda');
    const fonte = `registro imprese ${r.paese}`;
    const registro = { paese: r.paese, numero: r.numero, nome: r.nome, costituita: r.costituita, aumenti_capitale: [], persone: persone.map(p => ({ nome: p.nome, ruolo: p.ruolo, min: p.min, max: p.max })), url: r.url || (r.paese === 'UK' ? `https://find-and-update.company-information.service.gov.uk/company/${r.numero}` : '') };
    out.push({
      dominio: dom, nome: r.nome, sito: `https://${dom}/`, hub_origine: `registro ${r.paese} codice ${codice}`, primo_visto: now(), ultimo_check: now(),
      stato_crawler: 'da_ricontrollare', motivo: `dal registro ${r.paese}: costituita ${r.costituita}, amministratori sotto ${C.max_founder_age + 1} anni`,
      founder_nomi: persone.map(p => p.nome).join(', '),
      registro: JSON.stringify(registro),
      eta_verificate: JSON.stringify(persone.map(p => ({ nome: p.nome, ruolo: p.ruolo, min: p.min, max: p.max, fonte, url: registro.url }))),
    });
    st.nuove_in_coda++;
    st.per_codice[codice] = (st.per_codice[codice] || 0) + 1;
    log(`in coda ${dom} (${r.nome}, ${r.paese}, ${r.costituita}, età ${persone.map(p => p.max).join('/')})`);
  }

  // Norvegia: API aperta
  for (const nace of CFG.norvegia_nace) for (let p = 0; p < CFG.pagine_per_codice && budget > 0; p++) {
    const { items, pagine } = await norwaySearch(nace, CFG.costituite_dal, p);
    for (const r of items) { if (budget <= 0) break; await consider(r, norwayPeople, `NACE ${nace}`); await sleep(150); }
    if (p + 1 >= pagine) break;
  }
  // Regno Unito: solo con la chiave di Companies House
  if (process.env.COMPANIES_HOUSE_KEY) for (const sic of CFG.uk_sic) for (let p = 0; p < CFG.pagine_per_codice && budget > 0; p++) {
    const { items, pagine } = await ukSearch(sic, CFG.costituite_dal, p * 100);
    for (const r of items) { if (budget <= 0) break; await consider(r, ukPeople, `SIC ${sic}`); await sleep(300); }
    if (p + 1 >= pagine) break;
  } else st.uk = 'saltato: manca COMPANIES_HOUSE_KEY';

  if (!dry && out.length) await upsert(TABS.cand, 'dominio', out);
  if (!dry && seenRows.length) await upsert('db_scoperta', 'query', seenRows);
  st.registri = { ...registryStats };
  Object.assign(st, searchLog());
  if (!dry) await logRun('scoperta da registro', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(st => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `nuove=${st.nuove_in_coda}\n`); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
