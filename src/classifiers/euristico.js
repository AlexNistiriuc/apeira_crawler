// Classificatore euristico: i criteri rigidi e il Fit della v1 (strict() e fitOf() dell'export),
// applicati alle evidenze salvate dal crawler. Non legge la rete. Serve come baseline
// e come confronto per qualsiasi altro modello.
import { CRITERIA as C } from '../lib/config.js';
import { teamEstimate, money, founderAgeLabel, labAccess } from '../signals/derive.js';

export default {
  name: 'euristico',
  version: '1.0',

  /** @param {object} c riga di db_candidati con c.ev = evidenze già parse */
  async classify(c) {
    const ev = c.ev || {};
    const ex = [], ver = [];

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

    // soldi
    const m = money(ev.evd);
    if (m.grantUsd > C.max_grants_usd) ex.push('grant oltre 1M USD');
    if (m.invUsd > C.max_outside_investment_usd) ex.push('investimenti oltre 500k USD');
    if ((ev.fund?.l || 0) >= 2) ex.push('round già chiuso: ' + (ev.fund.x || []).join(', '));
    if (!m.hasInv) ver.push('investimenti esterni');

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
    let eta;
    if (ages.length) { eta = 'età dichiarate sul sito: ' + ages.join(', '); if (Math.max(...ages) > C.max_founder_age) ex.push(`founder con ${C.max_founder_age + 1}+ anni`); }
    else { eta = 'non verificata · stima: ' + founderAgeLabel(ev.fa); ver.push('età founder'); }
    const u30 = ages.length > 0 && Math.max(...ages) <= C.priority_founder_age;

    // domanda reale: solo un indizio, il giudizio vero richiede un modello o una persona
    const dem = (ev.dem || []).length;
    if (!dem) ver.push('domanda reale (clienti, pilot)');

    const esito = ex.length ? 'Esclusa' : ver.length ? 'Needs verification' : 'Qualificata';

    // Fit come nella v1: target pulito + punteggio deep + un contatto
    const score = (ev.deep || 0) - (ev.neg || 0);
    const contact = !!(c.email || c.linkedin_persone);
    const ageOk = fy.some(y => y >= C.min_founded_year) || (c.dominio_registrato || '') >= C.domain_young_from || c.primo_archivio === 'mai' || +(c.primo_archivio || '0').slice(0, 4) >= C.min_founded_year - 1;
    const target = ev.eu && !(ev.fund?.l >= 1) && ageOk;
    let fit = target && score >= 6 && contact ? 'Alto' : target || (!ageOk && score >= 7) ? 'Medio' : 'Basso';
    const down = f => (f === 'Alto' ? 'Medio' : 'Basso');
    if (tm.n > C.max_team_size) { if (tm.k === 'e') fit = 'Basso'; else if (tm.k === 'li' || tm.n > 8) fit = down(fit); }

    const voto = Math.max(0, Math.min(100, (esito === 'Qualificata' ? 60 : esito === 'Needs verification' ? 35 : 0) + (fit === 'Alto' ? 25 : fit === 'Medio' ? 12 : 0) + Math.min(Math.max(score, 0), 15) - (esito === 'Esclusa' ? 100 : 0)));

    return {
      esito, fit, voto,
      motivo: ex.length ? ex.join('; ') : ver.length ? 'da verificare: ' + ver.join(', ') : (u30 ? 'tutti i criteri, founder sotto 30' : 'tutti i criteri'),
      fondazione: fond, grant: m.grantTxt, investimenti: m.invTxt, accesso_lab: lab.txt, team: tm.txt, eta_founder: eta,
      under30: u30 ? 'sì' : 'no',
      domanda_reale: dem ? 'indizi sul sito: ' + ev.dem.slice(0, 2).join(' | ').slice(0, 300) : 'nessun indizio',
      da_verificare: ver.join(', '),
      fonti: c.pagine_lette || c.sito,
    };
  },
};
