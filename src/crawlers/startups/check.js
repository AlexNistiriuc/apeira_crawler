// Controllo di un candidato: età del dominio, lettura del sito (home, team, contatti), prefiltro.
import { getPage, jinaBacklog } from '../../lib/http.js';
import { host, reg, links } from '../../lib/url.js';
import { emptySignals, scanPage } from '../../signals/scan.js';
import { registrationDate, firstArchive } from '../../signals/age.js';
import { preCheck, ageCheck, decide, needsWayback, STATO } from '../../signals/prefilter.js';
import { candidateRow } from './row.js';

const TEAM = /(team|about|chi-siamo|chisiamo|ueber-uns|uber-uns|über|equipe|équipe|founders|people|who-we-are|unternehmen|company|qui-sommes)/i;
const CONTACT = /(contact|kontakt|impressum|imprint|legal|mentions|note-legali)/i;

/**
 * @param {object} c {dominio, sito, nome, hubs[], trusted, anno_dichiarato, descrizione, primo_visto}
 * @returns {Promise<object>} riga per db_candidati
 */
export async function checkCandidate(c) {
  const pre = preCheck(c);
  if (pre) return candidateRow(c, null, { stato: STATO.SCARTATA, motivo: pre, pages: [] });

  const registrato = await registrationDate(c.dominio);
  const old = ageCheck({ registrato, trusted: c.trusted });
  if (old) return candidateRow(c, null, { stato: STATO.SCARTATA, motivo: old, registrato, pages: [] });

  const s = emptySignals();
  if (c.anno_dichiarato) s.yrs.push(c.anno_dichiarato);
  const pages = [], texts = {};
  const home = await getPage(c.sito, { maxJinaBacklog: 12 });
  if (home.busy) return candidateRow(c, null, { stato: STATO.RICONTROLLA, motivo: 'lettura rimandata (coda Jina piena)', registrato, pages: [] });
  const alive = home.status === 200 && home.text.length >= 400;
  if (alive) {
    pages.push(c.sito); texts.home = home.text;
    scanPage(s, home.text, { home: true });
    const own = links(home.text).map(x => x).filter(([, l]) => { const h = host(l); return h && reg(h) === c.dominio; });
    const pick = re => { const x = own.find(([tx, l]) => re.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx)); return x && x[1]; };
    // fino a due pagine con le persone (es. /team e /about): più nomi e ruoli dei founder
    const team = pick(TEAM);
    const team2 = (own.find(([tx, l]) => l !== team && TEAM.test(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + tx)) || [])[1];
    let contact = pick(CONTACT);
    if (!contact && !s.em.length) {
      const tld = c.dominio.split('.').pop();
      contact = c.sito.replace(/\/$/, '') + (/^(de|at|ch|li)$/.test(tld) ? '/impressum' : tld === 'fr' ? '/mentions-legales' : '/contact');
    }
    for (const [u, legal] of [[team, false], [team2, false], [contact, true]]) {
      if (!u || pages.includes(u)) continue;
      const r = await getPage(u, { jinaFallback: false });
      if (r.status === 200 && r.text) { pages.push(u); if (!legal && !texts.team) texts.team = r.text; scanPage(s, r.text, { legal }); }
    }
  }
  let d = decide({ s, alive, trusted: c.trusted, registrato });
  let archivio = '';
  if (d.stato === STATO.DA_VALUTARE && !c.trusted && needsWayback(s, registrato)) {
    archivio = (await firstArchive(c.dominio)) || '';
    d = decide({ s, alive, trusted: c.trusted, registrato, archivio });
  }
  return candidateRow(c, alive ? s : null, { ...d, registrato, archivio, pages, texts });
}

export { jinaBacklog };
