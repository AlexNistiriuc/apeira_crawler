// Trasforma segnali ed esito del prefiltro in una riga di db_candidati.
import { teamEstimate } from '../../signals/derive.js';
import { okDeep, statedYears } from '../../signals/prefilter.js';
import { VERSION, now } from '../../lib/config.js';

const j = a => (a || []).join(', ');
const cut = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** JSON sotto il limite di una cella (50k caratteri), accorciando gli estratti se serve. */
function safeJson(ev) {
  let t = JSON.stringify(ev);
  if (t.length > 45000) { ev.estratto_home = ev.estratto_home.slice(0, 800); ev.estratto_team = ''; t = JSON.stringify(ev); }
  return t.length > 45000 ? JSON.stringify({ ...ev, evd: undefined, fa: undefined }) : t;
}

/** Estratto di testo leggibile per i classificatori (senza link e markup). */
export function extract(md, n) {
  const body = (String(md || '').split('Markdown Content:')[1] || md || '');
  return cut(body.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_>`|]/g, ' '), n);
}

/**
 * @param {object} c  candidato: {dominio, sito, nome, hubs[], primo_visto?}
 * @param {object} s  segnali (signals/scan.js)
 * @param {object} x  {stato, motivo, registrato, archivio, pages[], texts:{home, team}}
 */
export function candidateRow(c, s, x) {
  const team = teamEstimate(s?.ts);
  const ev = s ? {
    v: 2,
    deep: s.deep, strong: s.strong, neg: s.neg, ok_deep: okDeep(s), tags: s.tags,
    anni_dichiarati: statedYears(s), cmin: s.cmin, eu: s.eu,
    fund: s.fund, fa: s.fa, ts: s.ts, evd: s.evd, dem: s.dem,
    estratto_home: extract(x.texts?.home, 2500),
    estratto_team: extract(x.texts?.team, 1500),
  } : null;
  return {
    dominio: c.dominio,
    nome: cut(c.nome || s?.title?.split(/[|\-–—:]/)[0] || c.dominio, 60),
    sito: c.sito,
    hub_origine: j(c.hubs),
    primo_visto: c.primo_visto || now(),
    ultimo_check: now(),
    stato_crawler: x.stato,
    motivo: x.motivo || '',
    dominio_registrato: x.registrato && x.registrato !== 'n/a' ? x.registrato : (x.registrato === 'n/a' ? 'TLD senza RDAP' : ''),
    primo_archivio: x.archivio || '',
    anni_sul_sito: s ? j(statedYears(s)) : '',
    settori: s ? j(s.tags) : '',
    punteggio_deep: s ? s.deep - s.neg : '',
    europa: s ? (s.eu || /\.(de|fr|it|es|nl|be|ch|at|se|dk|fi|no|pl|cz|pt|ie|uk|ee|lv|lt|gr|eu|hu|ro|sk|si|hr|bg|lu|is)$/.test(c.dominio) ? 'sì' : 'non trovato') : '',
    segnali_funding: s ? j(s.fund.x) : '',
    email: s ? j(s.em.filter(e => !/@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|gmx|web|libero|orange|proton|protonmail)\./.test(e))) : '',
    linkedin_azienda: s ? j(s.lco) : '',
    linkedin_persone: s ? j(s.lin) : '',
    founder_nomi: s ? j(s.fn) : '',
    team_stima: team.txt,
    descrizione: s ? cut(c.descrizione || s.desc, 300) : cut(c.descrizione, 300),
    domanda_reale: s ? cut((s.dem || []).join(' | '), 500) : '',
    evidenze: ev ? safeJson(ev) : '',
    pagine_lette: j(x.pages),
    versione_crawler: VERSION,
  };
}
