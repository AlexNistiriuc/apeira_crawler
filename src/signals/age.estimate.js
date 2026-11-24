// Stima dell'età di una persona da frammenti di testo pubblici (risultati di ricerca, pagine del sito).
// Algoritmo, non modello: cerca fatti espliciti vicino al nome e li converte in un'età approssimativa.
// Ordine di affidabilità: età dichiarata > anno di nascita > anno di laurea > stato (studente/dottorando).
// È una STIMA per ordinare: non verifica nulla e non deve mai escludere nessuno. Mai da foto.

const DEGREE = [
  [/\b(b\.?sc|bachelor|ba|beng|laurea triennale|licence)\b/i, 22],
  [/\b(m\.?sc|master'?s?|meng|mba|laurea magistrale|diplom(-ingenieur)?|msc)\b/i, 24],
  [/\b(ph\.?\s?d|doctorate|dottorato|doctoral)\b/i, 28],
];

export function band(age) {
  if (age == null || !Number.isFinite(age)) return 'non determinabile';
  return age < 30 ? 'sotto 30' : age < 35 ? '30-34' : '35 o più';
}

/** Frasi del testo che parlano della persona (contengono il cognome). */
function aroundName(text, name) {
  const surname = String(name).trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return [];
  const re = new RegExp(`[^.!?\\n]{0,220}\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.!?\\n]{0,220}`, 'gi');
  return String(text).match(re) || [];
}

/**
 * @param {string} name  nome e cognome
 * @param {Array<{snippet:string,url?:string,title?:string}>} sources
 * @param {number} year  anno corrente
 * @returns {{eta:number|null, fascia:string, prova:string, fonte:string, tipo:string}}
 */
export function estimateAge(name, sources, year = new Date().getFullYear()) {
  const found = [];
  for (const s of sources) {
    for (const sent of aroundName(`${s.title || ''}. ${s.snippet || ''}`, name)) {
      let m;
      if ((m = sent.match(/\b([1-6]\d)[- ]year[- ]old\b/i)) || (m = sent.match(/\b(?:aged?|età|alter)\s*:?\s*([1-6]\d)\b/i)) || (m = sent.match(/\b([1-6]\d)\s*(?:anni|jahre|ans|years)\s+(?:old|alt|d'età|di età)\b/i)))
        if (+m[1] >= 16) found.push({ rank: 0, eta: +m[1], tipo: 'età dichiarata', prova: sent, fonte: s.url });
      if ((m = sent.match(/\b(?:born|nato|nata|geboren|né|née)\b[^0-9]{0,15}(19[5-9]\d|200\d)\b/i)))
        found.push({ rank: 1, eta: year - +m[1], tipo: 'anno di nascita', prova: sent, fonte: s.url });
      for (const [re, at] of DEGREE) {
        const d = sent.match(new RegExp(`${re.source}[^0-9]{0,80}?(19[89]\\d|20[0-2]\\d)|(19[89]\\d|20[0-2]\\d)[^0-9]{0,40}?${re.source}`, 'i'));
        if (d) { const y = +(d.find((x, i) => i > 0 && /^(19|20)\d\d$/.test(x || ''))); if (y && y <= year) found.push({ rank: 2, eta: year - y + at, tipo: 'anno di laurea', prova: sent, fonte: s.url }); }
      }
      if (/\b(ph\.?\s?d\.?\s?(student|candidate)|doctoral (student|candidate)|dottorand[oa]|master'?s student|studente|undergraduate)\b/i.test(sent))
        found.push({ rank: 3, eta: 26, tipo: 'studente o dottorando', prova: sent, fonte: s.url });
      if (/\b30 under 30\b/i.test(sent)) found.push({ rank: 3, eta: 28, tipo: 'lista 30 under 30', prova: sent, fonte: s.url });
    }
  }
  if (!found.length) return { eta: null, fascia: 'non determinabile', prova: '', fonte: '', tipo: '' };
  found.sort((a, b) => a.rank - b.rank);
  const best = found[0];
  return { eta: best.eta, fascia: band(best.eta), prova: best.prova.replace(/\s+/g, ' ').trim().slice(0, 200), fonte: best.fonte || '', tipo: best.tipo };
}
