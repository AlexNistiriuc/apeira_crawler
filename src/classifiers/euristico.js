// Classificatore euristico: i criteri rigidi e il Fit della v1 (strict() e fitOf() dell'export),
// applicati alle evidenze salvate dal crawler. Non legge la rete. Serve come baseline
// e come confronto per qualsiasi altro modello.
import { CRITERIA as C } from '../lib/config.js';
import { teamEstimate, money, founderAgeLabel, labAccess } from '../signals/derive.js';
import { VCH } from '../signals/patterns.js';
import { parseJson, newsFunding, founderCount, companyName, confirmedOver } from '../signals/facts.js';

const usd = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k') + ' USD';
const NOT_VC = /(incubat|accelerat|universit|school|college|institut|lab\b|hub\b|program|cohort)/i;

export default {
  name: 'euristico',
  version: '1.1',

  /** @param {object} c riga di db_candidati con c.ev = evidenze già parse */
  async classify(c) {
    const ev = c.ev || {};
    const ex = [], ver = [], note = [], fonti = [];
    // fatti raccolti dal crawler founder: registro imprese, età verificate, notizie di funding
    const reg = parseJson(c.registro);
    const vAges = parseJson(c.eta_verificate, []) || [];
    const news = parseJson(c.notizie_funding, []) || [];
    const nf = newsFunding(news, companyName(c), c.dominio);

    // fondazione
    const fy = (ev.anni_dichiarati || []).filter(y => y >= 2010 && y <= 2026);
    let fond;
    if (fy.length) { const mn = Math.min(...fy); fond = `${mn} (dichiarato sul sito)`; if (mn < C.min_founded_year) ex.push(`fondata nel ${mn}`); }
    else {
      const hint = /^\d{4}/.test(c.dominio_registrato || '') ? 'dominio ' + c.dominio_registrato.slice(0, 4) : /^\d{4}/.test(c.primo_archivio || '') ? 'primo archivio web ' + c.primo_archivio.slice(0, 4) : '';
      fond = hint ? `non dichiarata, indizio ${hint}` : 'non dichiarata';
      ver.push('anno di fondazione');
    }
    if (ev.cmin && ev.cmin < C.min_founded_year) ex.push(`sito con © ${ev.cmin}`);
    const ry = Number(String(reg?.costituita || '').slice(0, 4));
    if (ry) {
      fonti.push(reg.url);
      fond = `${reg.costituita} (registro imprese ${reg.paese})` + (fy.length ? `, sul sito ${Math.min(...fy)}` : '');
      if (ry < C.min_founded_year) { ex.length = 0; ex.push(`fondata nel ${ry} (registro imprese ${reg.paese})`); }
      else {
        // il registro dice 2025 o dopo: vince su anni del sito e ©, che spesso parlano del progetto o del lab
        for (let i = ex.length - 1; i >= 0; i--) if (/^fondata nel|^sito con ©/.test(ex[i])) { note.push(ex[i] + ' ma registro ' + ry); ex.splice(i, 1); }
        const k = ver.indexOf('anno di fondazione'); if (k >= 0) ver.splice(k, 1);
        if (note.length) ver.push('anno di fondazione (sito e registro non coincidono)');
      }
    }

    // soldi
    const m = money(ev.evd);
    if (m.grantUsd > C.max_grants_usd) ex.push('grant oltre 1M USD');
    if (m.invUsd > C.max_outside_investment_usd) ex.push('investimenti oltre 500k USD');
    if ((ev.fund?.l || 0) >= 2) ex.push('round già chiuso: ' + (ev.fund.x || []).join(', '));
    let grantTxt = m.grantTxt, invTxt = m.invTxt, phaseDown = 0;
    if (nf.inv_usd > C.max_outside_investment_usd) {
      if (confirmedOver(nf.investimenti, C.max_outside_investment_usd)) ex.push(`investimenti oltre 500k USD (notizie: ${nf.top_inv.importo})`);
      else { note.push(`una notizia parla di ${nf.top_inv.importo} raccolti, da confermare che sia la stessa azienda`); ver.push('investimenti esterni (notizia da confermare)'); phaseDown++; }
    }
    if (m.grantUsd + nf.grant_usd > C.max_grants_usd && !(m.grantUsd > C.max_grants_usd)) ex.push(`grant oltre 1M USD (notizie: ${usd(m.grantUsd + nf.grant_usd)})`);
    if (nf.investimenti.length) { invTxt = `notizie: ${nf.investimenti.map(x => x.importo).join(', ')}` + (m.invTxt ? ' · sito: ' + m.invTxt : ''); fonti.push(...nf.investimenti.map(x => x.url)); }
    if (nf.grant.length) { grantTxt = `notizie: ${nf.grant.map(x => x.importo).join(', ')}` + (m.grantTxt ? ' · sito: ' + m.grantTxt : ''); fonti.push(...nf.grant.map(x => x.url)); }
    if (nf.fase === 'series') ex.push('round series già chiuso (notizie)');
    else if (nf.fase === 'seed' && !nf.investimenti.length) { note.push('notizie di un seed senza importo'); ver.push('importo del seed'); phaseDown++; }
    else if (nf.fase === 'pre-seed' && !nf.investimenti.length) { note.push('notizie di un pre-seed senza importo'); phaseDown++; }
    if (nf.investimenti.length && nf.inv_usd <= C.max_outside_investment_usd) phaseDown++;
    if (nf.team > C.max_team_size) { note.push(`team di ${nf.team} persone secondo le notizie`); ver.push('team (notizie)'); phaseDown++; }
    if (reg?.aumenti_capitale?.length) { note.push(`aumenti di capitale nel registro UK: ${reg.aumenti_capitale.slice(0, 3).join(', ')}`); phaseDown++; }
    const vcHubs = String(c.hub_origine || '').split(', ').filter(h => h && VCH.test(h) && !NOT_VC.test(h));
    if (vcHubs.length) { note.push(`in portfolio VC (${vcHubs.slice(0, 2).join(', ')}): probabilmente ha già fatto un round`); phaseDown++; }
    if (!m.hasInv && !nf.investimenti.length) ver.push('investimenti esterni');

    // lab
    const lab = labAccess(ev.evd);
    if (lab.k === 'own') ex.push('lab di proprietà');
    else if (lab.k === 'shared') ver.push('accesso lab');

    // team
    const tm = teamEstimate(ev.ts);
    if (tm.n == null) ver.push('dimensione team');
    else if (tm.n > C.max_team_size && tm.k !== 'r') ex.push(`team oltre ${C.max_team_size} (${tm.txt})`);
    else if (tm.n > C.max_team_size) ver.push('dimensione team');

    // età: conta solo se dichiarata
    const ages = ev.fa?.a || [];
    let eta, u30 = false;
    const old = vAges.filter(a => a.min > C.max_founder_age);
    const nFounders = Math.max(founderCount(c.founder_nomi), ages.length);
    if (vAges.length) fonti.push(...vAges.map(a => a.url).filter(Boolean));
    if (old.length) ex.push(`founder con ${C.max_founder_age + 1} anni o più (${old.map(a => `${a.nome}, ${a.min}${a.max !== a.min ? '-' + a.max : ''} anni, ${a.fonte}`).join('; ')})`);
    if (ages.length && Math.max(...ages) > C.max_founder_age) ex.push(`founder con ${C.max_founder_age + 1}+ anni`);
    if (vAges.length || ages.length) {
      const parts = vAges.map(a => `${a.nome} ${a.min === a.max ? a.min : a.min + '-' + a.max} (${a.fonte})`);
      if (ages.length) parts.push('sul sito: ' + ages.join(', '));
      eta = 'verificate: ' + parts.join('; ');
      const covered = vAges.length + ages.length >= Math.max(nFounders, 1);
      if (!covered) { eta += ' · altri founder non verificati'; ver.push('età founder'); }
      const maxes = [...vAges.map(a => a.max), ...ages];
      u30 = covered && Math.max(...maxes) <= C.priority_founder_age;
    } else { eta = 'non verificata · stima: ' + founderAgeLabel(ev.fa); ver.push('età founder'); }

    // domanda reale: solo un indizio, il giudizio vero richiede un modello o una persona
    const dem = (ev.dem || []).length;
    if (!dem) ver.push('domanda reale (clienti, pilot)');

    const esito = ex.length ? 'Esclusa' : ver.length ? 'Needs verification' : 'Qualificata';

    // Fit come nella v1: target pulito + punteggio deep + un contatto
    const score = (ev.deep || 0) - (ev.neg || 0);
    const contact = !!(c.email || c.linkedin_persone);
    const ageOk = ry ? ry >= C.min_founded_year : fy.some(y => y >= C.min_founded_year) || (c.dominio_registrato || '') >= C.domain_young_from || c.primo_archivio === 'mai' || +(c.primo_archivio || '0').slice(0, 4) >= C.min_founded_year - 1;
    const target = ev.eu && !(ev.fund?.l >= 1) && ageOk;
    let fit = target && score >= 6 && contact ? 'Alto' : target || (!ageOk && score >= 7) ? 'Medio' : 'Basso';
    const down = f => (f === 'Alto' ? 'Medio' : 'Basso');
    if (tm.n > C.max_team_size) { if (tm.k === 'e') fit = 'Basso'; else if (tm.k === 'li' || tm.n > 8) fit = down(fit); }
    // posizioni aperte sul sito (crawler, sito intero): con molte assunzioni il team è probabilmente oltre 5
    const jobs = +(ev.sito?.posizioni_aperte || 0);
    if (jobs >= 3) { note.push(`${jobs} posizioni aperte sul sito: team probabilmente oltre ${C.max_team_size}`); ver.push('team (posizioni aperte)'); fit = down(fit); }
    if (jobs >= 8) fit = down(fit);
    // progetto di ricerca e non startup (consorzio, Horizon, disseminazione): fit Basso finché non si chiarisce
    const siteText = [ev.estratto_home, ev.estratto_about, ev.estratto_blog, ev.estratto_tech].join(' ');
    if (/\b(consortium|consorzio|horizon (2020|europe)|grant agreement|this project has received funding|dissemination|work package|fet-?open|project partners|project coordinator)\b/i.test(siteText)) {
      note.push('il sito sembra di un progetto di ricerca, non di una startup'); ver.push('natura (progetto o startup)'); fit = 'Basso';
    }
    if (phaseDown) fit = down(fit);
    if (eta.startsWith('non verificata') && /35 o più/.test(c.eta_stimata || '')) fit = down(fit); // stima: ordina, non esclude

    const voto = Math.max(0, Math.min(100, (esito === 'Qualificata' ? 60 : esito === 'Needs verification' ? 35 : 0) + (fit === 'Alto' ? 25 : fit === 'Medio' ? 12 : 0) + Math.min(Math.max(score, 0), 15) - 8 * phaseDown - (esito === 'Esclusa' ? 100 : 0)));

    return {
      esito, fit, voto,
      motivo: (ex.length ? ex.join('; ') : ver.length ? 'da verificare: ' + ver.join(', ') : (u30 ? 'tutti i criteri, founder sotto 30' : 'tutti i criteri')) + (note.length ? ' · nota: ' + note.join('; ') : ''),
      fondazione: fond, grant: grantTxt, investimenti: invTxt, accesso_lab: lab.txt, team: tm.txt, eta_founder: eta,
      under30: u30 ? 'sì' : 'no',
      domanda_reale: dem ? 'indizi sul sito: ' + ev.dem.slice(0, 2).join(' | ').slice(0, 300) : 'nessun indizio',
      da_verificare: ver.join(', '),
      fonti: [c.pagine_lette || c.sito, ...new Set(fonti.filter(Boolean))].join(', '),
    };
  },
};
