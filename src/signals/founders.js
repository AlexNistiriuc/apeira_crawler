// Parsing condiviso dei nomi founder e scelta delle startup migliori.
// Vive fuori dai crawler così il crawler LinkedIn e quello founder non si importano a vicenda.

export const FIT = { Alto: 0, Medio: 1, Basso: 2 };

/** CEO e CTO dai nomi del crawler ("Anna Rossi (CEO), Marco Bianchi (CTO)"). */
export function ceoCto(founders) {
  const out = [];
  for (const f of String(founders || '').split(', ')) {
    const m = f.match(/^(.+?)\s*\((CEO|CTO)\)$/);
    if (m && !out.some(o => o.ruolo === m[2])) out.push({ nome: m[1].trim(), ruolo: m[2] });
  }
  return out;
}

/**
 * Tutti i founder trovati dal crawler, con ruolo quando c'è.
 * "Anna Rossi (CEO), Marco Bianchi (CTO), Luca Verdi" → CEO, CTO, co-founder.
 * I nomi legali senza nome e cognome vengono scartati.
 */
export function founderPeople(founders) {
  const out = [];
  for (const part of String(founders || '').split(', ')) {
    const m = part.match(/^(.+?)\s*\((CEO|CTO)\)$/);
    const nome = (m ? m[1] : part).trim();
    if (!nome || nome.split(/\s+/).length < 2 || out.some(p => p.nome === nome)) continue;
    out.push({ nome, ruolo: m ? m[2] : 'co-founder' });
  }
  return out;
}

/** Le migliori secondo Sage o Claude (startup nuove), non escluse, per fit e voto. */
export function pickBest(evals, n) {
  const by = {};
  for (const v of evals) if (v.esito !== 'Esclusa' && (v.classificatore === 'sage' || (v.classificatore === 'claude' && !by[v.dominio]))) by[v.dominio] = v;
  return Object.values(by).sort((a, b) => (FIT[a.fit] ?? 3) - (FIT[b.fit] ?? 3) || Number(b.voto) - Number(a.voto)).slice(0, n);
}
