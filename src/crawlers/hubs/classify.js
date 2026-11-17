// Stato, tipo e priorità di un hub. Portato da hubScore/VCH/JUNKHUB della v1.
import { VCH, JUNKHUB } from '../../signals/patterns.js';
import { hubKey } from '../../lib/url.js';
import { today } from '../../lib/config.js';

export function hubScore(name, url) {
  const t = (name + ' ' + url).toLowerCase(); let s = 0;
  if (/(incubat|accelerat|cohort|batch|demo ?day|spin-?off|spinout|spin-?out|startups|winners|finalists|programme|program|fellows|founders|venture ?lab|launch|pioneer|venture kick|exist|grant|award|prize|challenge|hackathon|student|esa-?bic|innogrant|ignition)/.test(t)) s += 10;
  if (/(news|article|blog|press|\/20\d\d\/)/.test(t)) s -= 3;
  if (/(\.ch|\.de|\.fr|\.nl|\.se|\.dk|\.fi|\.at|\.it|\.es|\.ee|\.pl|\.uk|europe|\.eu)/.test(t)) s += 3;
  if (/(san francisco|bay area|boston|new york|chicago|pittsburgh|toronto|montreal|waterloo|los angeles|austin|seattle|san diego|singapore|tokyo|\bmit\b|stanford|berkeley|harvard|caltech)/.test(t)) s -= 8;
  return s;
}

export function hubType(name, url) {
  const t = (name + ' ' + url).toLowerCase();
  if (/(spin-?off|spinout|spin-?out|transfer|tto)/.test(t)) return 'spin-off';
  if (/(award|prize|challenge|competition|hackathon|wettbewerb|concorso)/.test(t)) return 'competizione';
  if (/(incubat|science ?park|technopark|technopol|sciencepark|bic\b|innovation cent|gründerzentrum)/.test(t)) return 'incubatore';
  if (/(accelerat|programme|program|fellowship|pioneer|kick|venture ?lab|exist)/.test(t)) return 'programma';
  if (/(directory|database|listing)/.test(t)) return 'directory';
  return 'altro';
}

/** Riga db_hub per un hub nuovo. origine: seme, directory, rete: EBN, snowball: dominio... */
export function newHubRow({ name, url, origine, tipo, note = '' }) {
  const label = name + ' ' + url;
  const stato = VCH.test(label) ? 'escluso_vc' : JUNKHUB.test(label) ? 'escluso_junk' : 'attivo';
  return { hub_id: hubKey(url), nome: name, url, origine, tipo: tipo || hubType(name, url), stato, priorita: hubScore(name, url) + (/^snowball/.test(origine) ? 7 : /^rete/.test(origine) ? 6 : 0), scoperto_il: today(), note };
}
