// Stima dell'età di CEO e CTO, solo per le startup migliori secondo Sage.
// È una STIMA per ordinare Startup trovate, non un criterio di esclusione: l'età vera
// si conferma con i founder nell'outreach.
//
// Per ogni startup: una ricerca web Sage su CEO e CTO (formazione, anno di laurea, età dichiarata,
// studente o dottorando), poi una decisione senza reasoning con la fascia d'età di ciascuno.
// Mai da foto. LinkedIn solo come frammento nei risultati di ricerca, mai aprendo linkedin.com.
// Uso: npm run eta -- [quante]     (default 100: le prime N per fit e voto, una volta sola ciascuna)
import { appendFileSync } from 'node:fs';
import { read, upsert, logRun, TABS } from '../lib/sheet.js';
import { now } from '../lib/config.js';
import sage, { sageCall, trim } from './sage.js';

const BANDS = [
  { option: 'under_30', description: 'Explicit public facts show this person is under 30: stated age or birth year, graduation from a first degree in 2018 or later, current student or PhD candidate, or a youth list such as 30 under 30.' },
  { option: '30_34', description: 'Explicit public facts show this person is 30 to 34, for example a first degree completed between 2013 and 2017.' },
  { option: '35_plus', description: 'Explicit public facts show this person is 35 or older, for example a first degree completed before 2013, or more than 12 years of professional experience.' },
  { option: 'unknown', description: 'No usable public fact about this person, the person cannot be identified with confidence, or the company has no such role.' },
];
const TXT = { under_30: 'sotto 30', '30_34': '30-34', '35_plus': '35 o più', unknown: 'non determinabile' };
const FIT = { Alto: 0, Medio: 1, Basso: 2 };

/** Le prime n startup per fit e voto tra quelle valutate da Sage e non escluse. */
export function topForEstimate(evals, n) {
  return evals.filter(v => v.classificatore === 'sage' && v.esito !== 'Esclusa')
    .sort((a, b) => (FIT[a.fit] ?? 3) - (FIT[b.fit] ?? 3) || Number(b.voto) - Number(a.voto))
    .slice(0, n);
}

function rolesHint(founders) {
  return String(founders || '').split(', ').filter(Boolean).join('; ') || 'unknown';
}

export async function estimate(c) {
  const name = c.nome || c.dominio, dom = String(c.dominio || '').toLowerCase();
  const people = rolesHint(c.founder_nomi);
  const research = await sageCall('/decide', {
    content: `Company: ${name}. Domain: ${dom}. Known founders (role in brackets when known): ${people}. ${trim(c.descrizione, 300)}`,
    question: {
      id: 'people', kind: 'yesno',
      instructions: `Search for the CEO and the CTO of ${name} (${dom}): university, degree and graduation year, PhD or student status, stated age, youth awards. Is there credible public information about them?`,
    },
    reasoning: 'off',
    grounding: { trigger: 'always', confidence_floor: 0.85 },
  });
  const keys = [dom, String(name).toLowerCase(), ...String(c.founder_nomi || '').split(', ').map(f => f.replace(/\s*\(.*\)$/, '').split(' ').pop().toLowerCase())]
    .filter(k => k && k.length > 3);
  const snippets = (research?.grounding_meta?.sources || []).filter(s => {
    const h = [s?.url, s?.title, s?.snippet].join(' ').toLowerCase();
    return keys.some(k => h.includes(k));
  }).slice(0, 8).map(s => ({ title: trim(s.title, 200), url: s.url, snippet: trim(s.snippet, 1200) }));

  const rules = 'Estimate only from explicit public facts in the snippets or founder list. Never use photos or appearance. LinkedIn snippets from search results may show education and are hints. If the role holder cannot be identified, answer unknown.';
  const body = await sageCall('/decide/batch', {
    reasoning: 'off',
    requests: [{
      content: JSON.stringify({ company: name, domain: dom, known_founders: people, snippets, rules }),
      questions: [
        { id: 'ceo', kind: 'choice', instructions: `Age band of the CEO of ${name}. ${rules}`, options: BANDS },
        { id: 'cto', kind: 'choice', instructions: `Age band of the CTO of ${name}. ${rules}`, options: BANDS },
      ],
    }],
  });
  const ans = {};
  for (const a of body?.results?.[0]?.answers || []) if (a?.ok && a.result?.id) ans[a.result.id] = a.result.result?.chosen;
  const ceo = TXT[ans.ceo] || TXT.unknown, cto = TXT[ans.cto] || TXT.unknown;
  return {
    eta_stimata: `CEO: ${ceo}; CTO: ${cto} (stima da fonti pubbliche, da confermare con i founder)`,
    fonti_eta: snippets.map(s => s.url).filter(u => /^https?:\/\//.test(u || '')).join(', '),
  };
}

export async function run(n = 100, log = console.log) {
  const startedAt = now();
  const evals = await read(TABS.eval);
  const top = topForEstimate(evals, n).filter(v => !v.eta_stimata);
  const cands = new Map((await read(TABS.cand, { columns: ['dominio', 'nome', 'founder_nomi', 'descrizione'] })).map(c => [c.dominio, c]));
  const st = { candidati: top.length, stimate: 0, errori: 0 };
  const out = [];
  let i = 0, fatal = null;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (i < top.length && !fatal) {
      const v = top[i++]; const c = cands.get(v.dominio) || { dominio: v.dominio };
      try { out.push({ id: v.id, dominio: v.dominio, classificatore: 'sage', ...(await estimate(c)) }); st.stimate++; }
      catch (e) { st.errori++; log(`errore su ${v.dominio}: ${e.message}`); if (e.fatal) fatal = e.message; }
      if (out.length >= 10) await upsert(TABS.eval, 'id', out.splice(0));
    }
  }));
  if (out.length) await upsert(TABS.eval, 'id', out);
  if (fatal) st.fermato_per = fatal;
  st.consumo = sage.stats();
  await logRun('stima età CEO/CTO', startedAt, st);
  log(JSON.stringify(st));
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(Number(process.argv[2] || 100)).then(st => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `stimate=${st.stimate}\n`);
    if (st.fermato_per) process.exit(2);
  }).catch(e => { console.error(e); process.exit(1); });
}
