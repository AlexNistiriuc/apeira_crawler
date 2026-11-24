// Scoperta da registro: parte dalle società, non dagli hub. Registri con data di nascita degli amministratori
// (Norvegia e Francia sempre, Regno Unito con COMPANIES_HOUSE_KEY), per codice di attività e costituite di recente.
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
import { norwaySearch, norwayPeople, ukSearch, ukPeople, franceSearch, francePeople, finlandSearch, normName, registryStats } from '../../lib/registry.js';
import { latviaCompanies } from './lettonia.js';
import { belgiumCompanies } from './belgio.js';
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
  const quota = CFG.quota_per_paese || {};
  const usate = {}, cercate = {};
  const quotaOk = paese => (usate[paese] || 0) < (quota[paese]?.societa ?? Infinity);

  async function consider(r, people, codice, { senzaEta = false, ignoraBudget = false } = {}) {
    if (seenReg.has(key(r))) return;
    if (!ignoraBudget && !quotaOk(r.paese)) return;
    st.societa_lette++; if (!ignoraBudget) budget--; usate[r.paese] = (usate[r.paese] || 0) + 1;
    seenReg.add(key(r));
    const mark = esito => seenRows.push({ query: key(r), tipo: 'registro', settore: codice, luogo: r.paese, livello: 'registro', usata_il: now().slice(0, 10), risultati: 1, hub_nuovi: esito === 'in coda' ? 1 : 0, hub_utili: 0 });
    const persone = senzaEta ? [] : await people(r.numero);
    if (!senzaEta && !allYoung(persone)) return mark(persone.length ? 'amministratori 35+' : 'senza età');
    if (!senzaEta) st.giovani++;
    let dom = siteDomain(r.sito);
    // registri senza età (Finlandia): niente ricerca del sito, si prende solo quello scritto nel registro
    if (!dom && !senzaEta && searchEnabled() && st.ricerche_sito < CFG.ricerche_sito_per_giro && (cercate[r.paese] || 0) < (quota[r.paese]?.ricerche_sito ?? Infinity)) {
      st.ricerche_sito++; cercate[r.paese] = (cercate[r.paese] || 0) + 1;
      const paese = { UK: 'UK', NO: 'Norway', FR: 'France', LV: 'Latvia', FI: 'Finland' }[r.paese] || '';
      dom = siteFromResults(r.nome, await webSearch(`"${r.nome.replace(/\b(ltd|limited|as|sas|sasu|sarl)\b\.?/gi, '').trim()}" ${paese}`, { count: 5 }));
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
      stato_crawler: 'da_ricontrollare', motivo: `dal registro ${r.paese}: costituita ${r.costituita}` + (senzaEta ? ', età non nel registro' : `, amministratori sotto ${C.max_founder_age + 1} anni`),
      founder_nomi: persone.map(p => p.nome).join(', '),
      registro: JSON.stringify(registro),
      ...(senzaEta ? {} : { eta_verificate: JSON.stringify(persone.map(p => ({ nome: p.nome, ruolo: p.ruolo, min: p.min, max: p.max, fonte, url: registro.url }))) }),
    });
    st.nuove_in_coda++;
    st.per_codice[codice] = (st.per_codice[codice] || 0) + 1;
    log(`in coda ${dom} (${r.nome}, ${r.paese}, ${r.costituita}, età ${persone.map(p => p.max).join('/')})`);
  }

  // Norvegia: API aperta
  for (const nace of CFG.norvegia_nace) for (let p = 0; p < CFG.pagine_per_codice && budget > 0 && quotaOk('NO'); p++) {
    const { items, pagine } = await norwaySearch(nace, CFG.costituite_dal, p);
    for (const r of items) { if (budget <= 0) break; await consider(r, norwayPeople, `NACE ${nace}`); await sleep(150); }
    if (p + 1 >= pagine) break;
  }
  // Regno Unito: solo con la chiave di Companies House
  if (process.env.COMPANIES_HOUSE_KEY) for (const sic of CFG.uk_sic) for (let p = 0; p < CFG.pagine_per_codice && budget > 0 && quotaOk('UK'); p++) {
    const { items, pagine } = await ukSearch(sic, CFG.costituite_dal, p * 100);
    for (const r of items) { if (budget <= 0) break; await consider(r, ukPeople, `SIC ${sic}`); await sleep(300); }
    if (p + 1 >= pagine) break;
  } else st.uk = 'saltato: manca COMPANIES_HOUSE_KEY';
  // Francia: creazioni nel BODACC per parola dell'attività, età dei dirigenti dal registro (anno e mese)
  for (const kw of CFG.francia_parole || []) for (let p = 0; p < CFG.pagine_per_codice && budget > 0 && quotaOk('FR'); p++) {
    const { items, pagine } = await franceSearch(kw, CFG.costituite_dal, p * 100);
    for (const r of items) {
      if (budget <= 0) break;
      if (CFG.francia_escludi && new RegExp(CFG.francia_escludi, 'i').test(`${r.nome} ${r.attivita}`)) continue;
      await consider(r, francePeople, `FR "${kw}"`); await sleep(250);
    }
    if (p + 1 >= pagine) break;
  }

  // Finlandia: registro senza età; entrano solo le società con il sito scritto nel registro
  for (const code of CFG.finlandia_codici || []) for (let p = 1; p <= CFG.pagine_per_codice && budget > 0 && quotaOk('FI'); p++) {
    const { items, pagine } = await finlandSearch(code, CFG.costituite_dal, p);
    for (const r of items) { if (budget <= 0) break; if (!r.sito) continue; await consider(r, null, `FI ${code}`, { senzaEta: true }); }
    if (p >= pagine) break;
  }
  // Lettonia: due file grandi (circa 170 MB), una volta al giorno; età dal codice personale, nome deep tech
  const lvKey = `registro LV giorno ${now().slice(0, 10)}`;
  if (CFG.lettonia_parole_nome && !seenReg.has(lvKey) && budget > 0) {
    const list = await latviaCompanies(CFG.costituite_dal, new RegExp(CFG.lettonia_parole_nome, 'i'));
    st.lettonia_societa = list.length;
    for (const r of list) { if (budget <= 0) break; const persone = r.persone; await consider(r, async () => persone, 'LV nome'); }
    seenRows.push({ query: lvKey, tipo: 'registro', settore: 'LV', luogo: 'LV', livello: 'registro', usata_il: now().slice(0, 10), risultati: list.length, hub_nuovi: 0, hub_utili: 0 });
  }

  // Belgio: zip mensile dell'open data KBO (serve l'account), una volta al mese; niente età, solo imprese col sito
  const beKey = `registro BE mese ${now().slice(0, 7)}`;
  const beErr = `registro BE errore ${now().slice(0, 10)}`;   // dopo un errore si riprova il giorno dopo (niente login a raffica)
  if (process.env.KBO_USER && process.env.KBO_PASSWORD && !seenReg.has(beKey) && !seenReg.has(beErr)) {
    try {
      const { items, file } = await belgiumCompanies({ from: CFG.costituite_dal, codes: CFG.belgio_nace || [] });
      st.belgio = { file, imprese: items.length, con_sito: items.filter(x => x.sito).length };
      for (const r of items) { if (!r.sito) continue; await consider(r, null, `BE ${r.attivita}`, { senzaEta: true, ignoraBudget: true }); }
      seenRows.push({ query: beKey, tipo: 'registro', settore: 'BE', luogo: 'BE', livello: 'registro', usata_il: now().slice(0, 10), risultati: items.length, hub_nuovi: 0, hub_utili: 0 });
    } catch (e) {
      st.belgio = 'errore: ' + e.message;
      seenRows.push({ query: beErr, tipo: 'registro', settore: 'BE', luogo: 'BE', livello: 'registro', usata_il: now().slice(0, 10), risultati: 0, hub_nuovi: 0, hub_utili: 0 });
    }
  }

  if (!dry && out.length) await upsert(TABS.cand, 'dominio', out);
  if (!dry && seenRows.length) await upsert('db_scoperta', 'query', seenRows);
  st.per_paese = { societa: usate, ricerche_sito: cercate };
  st.registri = { ...registryStats };
  Object.assign(st, searchLog());
  if (!dry) await logRun('scoperta da registro', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(st => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `nuove=${st.nuove_in_coda}\n`); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
