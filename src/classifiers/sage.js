// Classificatore Levanto Sage. Sage prende le decisioni (esito, fit e voto) in
// un'unica richiesta batch; l'euristico resta il guardrail deterministico e
// fornisce i campi di evidenza leggibili nel foglio.
//
// Uso sensato dei crediti. Sage costa poco in input, molto in output (il reasoning conta
// come output) e ogni ricerca web si paga a parte. Quindi due livelli:
//  - completo (ricerca web + reasoning) per i candidati che l'euristico giudica Fit Alto o Medio;
//  - leggero (niente ricerca, niente reasoning) per i Fit Basso. Se il leggero vede qualcosa
//    di buono (fit alto, voto >= 60, o qualificata) si rifà subito in modalità completa.
// Le escluse dall'euristico non arrivano mai a Sage (zero crediti).
// I consumi di ogni giro finiscono in db_log (statistiche.consumo).
import { CRITERIA as C } from '../lib/config.js';
import euristico from './euristico.js';

const DEFAULT_URL = 'https://sage.levanto.ai';
const MIN_QUALIFY_PROBABILITY = 0.85;
const RETRIES = 3;
const LIGHT_ESCALATE_SCORE = Number(process.env.SAGE_LIGHT_ESCALATE_SCORE || 60);
const REASONING_MODES = new Set(['off', 'auto', 'on']);
const GROUNDING_TRIGGERS = new Set(['never', 'low_confidence', 'always']);

const OUTCOME_OPTIONS = [
  { option: 'qualified', description: 'All hard gates are confirmed by public evidence; no decisive fact is missing or ambiguous.' },
  { option: 'needs_verification', description: 'No exclusion is proven, but at least one hard gate is unknown, ambiguous, contradictory, or uncertain.' },
  { option: 'excluded', description: 'The evidence proves that at least one hard-gate threshold is exceeded.' },
];

const FIT_OPTIONS = [
  { option: 'high', description: 'Strong European deep-tech fit, technical founders, real demand, very early stage, and a public work contact.' },
  { option: 'medium', description: 'Plausible but incomplete fit; demand is weak or one preferred element is missing.' },
  { option: 'low', description: 'Off-target, weakly deep-tech, non-European, too mature, or lacking convincing signals.' },
];

const FIT_TO_SHEET = { high: 'Alto', medium: 'Medio', low: 'Basso' };

// Quale soglia rigida è superata. Serve a due cose: dire ad Alex perché una startup è esclusa,
// e impedire esclusioni senza una soglia precisa (fuori target va nel fit e nel voto, non nell'esito).
const GATE_OPTIONS = [
  { option: 'none', description: 'No hard-gate threshold is proven to be exceeded.' },
  { option: 'founded_before_2025', description: 'Public evidence shows the company was founded before 2025.' },
  { option: 'investment_over_500k', description: 'Public evidence shows more than US$500k of outside investment (equity, convertible, or a priced round such as seed or Series A).' },
  { option: 'grants_over_1m', description: 'Public evidence shows more than US$1M of grants in total.' },
  { option: 'team_over_5', description: 'Public evidence shows a team of more than five people.' },
  { option: 'founder_over_34', description: 'A founder publicly states an age of 35 or more.' },
  { option: 'own_lab', description: 'Public evidence shows a company-owned lab or substantial established external lab access.' },
];
const GATE_TO_TEXT = {
  founded_before_2025: 'fondata prima del 2025',
  investment_over_500k: 'investimenti esterni oltre 500k USD',
  grants_over_1m: 'grant oltre 1M USD',
  team_over_5: 'team oltre 5 persone',
  founder_over_34: 'founder con 35 anni o più',
  own_lab: 'lab proprio o accesso a lab sostanziale',
};

const SCORE_LEVELS = [
  { level: 0, description: 'Esclusa con violazione netta o completamente fuori target.' },
  { level: 15, description: 'Esclusa o quasi certamente fuori target.' },
  { level: 30, description: 'Fit debole con molti problemi o dati mancanti.' },
  { level: 45, description: 'Candidata incerta e poco convincente.' },
  { level: 60, description: 'Promettente, ma restano verifiche importanti.' },
  { level: 70, description: 'Promettente con buon fit e alcune verifiche residue.' },
  { level: 80, description: 'Molto promettente, quasi qualificabile.' },
  { level: 85, description: 'Qualificata con buon fit e domanda reale.' },
  { level: 92, description: 'Qualificata, fit molto alto e segnali forti di domanda.' },
  { level: 100, description: 'Candidata eccezionale e pienamente verificata.' },
];

export function trim(value, max) {
  const s = String(value || '');
  return s.length > max ? s.slice(0, max) : s;
}

function candidateContent(c, baseline, webResearch = []) {
  const ev = c.ev || {};
  const policy = {
    founded: `${C.min_founded_year}-${C.max_founded_year}`,
    max_grants_usd: C.max_grants_usd,
    max_outside_investment_usd: C.max_outside_investment_usd,
    max_team_size: C.max_team_size,
    max_founder_age: C.max_founder_age,
    priority_if_all_founders_at_most: C.priority_founder_age,
    lab: 'no company-owned lab and no substantial established external lab',
  };
  const evidence = {
    identity: { name: c.nome, domain: c.dominio, site: c.sito, description: trim(c.descrizione, 800) },
    origin: c.hub_origine,
    sectors: c.settori || ev.tags,
    europe: c.europa || ev.eu,
    website_age: { registered: c.dominio_registrato, first_archive: c.primo_archivio, years_on_site: c.anni_sul_sito, declared_years: ev.anni_dichiarati },
    funding: { visible_signals: trim(c.segnali_funding, 1000), structured: ev.fund, amounts: ev.evd && { grants: ev.evd.g, investments: ev.evd.i } },
    lab: ev.evd && { company_owned: ev.evd.lc, shared_or_institutional: ev.evd.lx },
    team: { estimate: c.team_stima, structured: ev.ts },
    founders: {
      names: c.founder_nomi,
      ages: ev.fa && ev.fa.a,
      age_evidence: ev.fa && ev.fa.ev,
      linkedin_links_published_by_startup: trim(c.linkedin_persone, 1500),
    },
    demand: { summary: trim(c.domanda_reale, 1000), evidence: ev.dem },
    public_contact_available: Boolean(c.email || c.linkedin_persone),
    deep_tech: { score: ev.deep, negative_score: ev.neg, strong_signals: ev.strong, tags: ev.tags },
    page_extracts: { home: trim(ev.estratto_home, 3000), team: trim(ev.estratto_team, 2000) },
    deterministic_check: baseline,
    web_research: webResearch,
    sources: trim(c.pagine_lette || c.sito, 1500),
  };
  return JSON.stringify({
    evidence,
    task: 'Evaluate this startup for the Apeira pre-pre-seed European deep-tech program.',
    rules: [
      'Use only the supplied evidence. Do not assume missing facts.',
      'Not disclosed is unknown, never zero.',
      'Founder age counts only when publicly stated; estimates, photos and graduation years do not verify age.',
      'Use the supplied web research only for this exact startup. Prefer first-party pages, filings and credible press; ignore namesakes and generic startup-advice pages.',
      'LinkedIn may be checked only through public search-result snippets or LinkedIn links already published on the startup website. Never open or scrape linkedin.com.',
      'LinkedIn career history and headcount ranges are discovery hints only. They never verify founder age or exact team size.',
      'A proven threshold violation means Esclusa. Any missing or contradictory hard-gate fact means Needs verification.',
      'Real demand, technical founders, Europe and target sector affect fit and score, not the hard-gate outcome.',
    ],
    hard_gates: policy,
  });
}

const usage = { chiamate: 0, input_tokens: 0, output_tokens: 0, ricerche_web: 0, completi: 0, leggeri: 0, promossi: 0, saltati_esclusi: 0 };
function track(body, grounded) {
  usage.chiamate++;
  const u = body?.meta?.usage || body?.usage || {};
  usage.input_tokens += Number(u.input_tokens) || 0;
  usage.output_tokens += Number(u.output_tokens) || 0;
  if (grounded && body?.grounding_meta?.triggered !== false) usage.ricerche_web++;
}

function reasoningMode() {
  const mode = process.env.SAGE_REASONING || 'on';
  if (!REASONING_MODES.has(mode)) throw new Error(`SAGE_REASONING non valido: ${mode}`);
  return mode;
}

function grounding() {
  const trigger = process.env.SAGE_GROUNDING_TRIGGER || 'always';
  if (!GROUNDING_TRIGGERS.has(trigger)) throw new Error(`SAGE_GROUNDING_TRIGGER non valido: ${trigger}`);
  const confidenceFloor = Number(process.env.SAGE_GROUNDING_CONFIDENCE_FLOOR || 0.85);
  if (!Number.isFinite(confidenceFloor) || confidenceFloor < 0 || confidenceFloor > 1) {
    throw new Error('SAGE_GROUNDING_CONFIDENCE_FLOOR deve essere tra 0 e 1');
  }
  return { trigger, confidence_floor: confidenceFloor };
}

function questions(candidate) {
  const searchTarget = [candidate.nome, candidate.dominio, candidate.founder_nomi]
    .map(value => trim(value, 300)).filter(Boolean).join(' | ');
  return [
    {
      id: 'esito', kind: 'choice',
      instructions: `Search target: ${searchTarget}. Apply the hard gates exactly using the supplied website evidence and filtered web research. Which outcome is justified? Missing evidence must never produce Qualificata. LinkedIn snippets cannot prove age or exact headcount.`,
      options: OUTCOME_OPTIONS,
    },
    {
      id: 'fit', kind: 'choice',
      instructions: `Search target: ${searchTarget}. What is this startup's fit for Apeira using the supplied evidence and filtered web research? Consider European angle, target deep-tech sector, technical founders, real demand, early stage and contactability. Public LinkedIn snippets may identify founders or roles but are not authoritative evidence.`,
      options: FIT_OPTIONS,
    },
    {
      id: 'soglia', kind: 'choice',
      instructions: `Search target: ${searchTarget}. Which hard-gate threshold, if any, is proven exceeded by the supplied evidence and filtered web research? Choose none unless a specific fact proves it. Being off-target, weakly deep-tech or non-European is not a hard gate.`,
      options: GATE_OPTIONS,
    },
    {
      id: 'voto', kind: 'scale',
      instructions: `Search target: ${searchTarget}. Score this startup for outreach priority using the supplied evidence and filtered web research. Respect the rubric: qualified with strong fit is 85+, promising but unverified is 60-84, weak fit is 30-59, excluded or off-target is under 30. Treat LinkedIn snippets only as discovery hints.`,
      levels: SCORE_LEVELS,
    },
  ];
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function sageCall(path, payload) {
  const key = process.env.SAGE_API_KEY;
  if (!key) throw Object.assign(new Error('Manca SAGE_API_KEY'), { fatal: true });
  const base = (process.env.SAGE_API_URL || DEFAULT_URL).replace(/\/+$/, '');
  const timeout = Number(process.env.SAGE_TIMEOUT_MS || 30_000);
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`Sage ha risposto con dati non JSON (${response.status})`); }
      if (!response.ok) {
        const code = body?.error?.code || body?.code || `HTTP ${response.status}`;
        const err = new Error(`Sage ${code}`);
        err.retryable = response.status === 429 || response.status >= 500 || body?.error?.retryable === true;
        // chiave non valida, credito finito, accesso negato: inutile continuare a spendere tentativi
        err.fatal = [401, 402, 403].includes(response.status);
        err.status = response.status;
        throw err;
      }
      track(body, Boolean(payload.grounding));
      return body;
    } catch (error) {
      last = error;
      const retryable = !error.fatal && (error.retryable || error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError);
      if (!retryable || attempt === RETRIES) break;
      await wait(error.status === 429 ? 5000 * (attempt + 1) : 1000 * (2 ** attempt));
    }
  }
  throw last;
}

async function sageBatch(content, candidate, reasoning = reasoningMode()) {
  return sageCall('/decide/batch', {
    reasoning,
    requests: [{ content, questions: questions(candidate) }],
  });
}

async function sageResearch(candidate) {
  const webSearch = grounding();
  if (webSearch.trigger === 'never') return { evidence: [], sources: [] };
  const name = candidate.nome || candidate.dominio;
  const content = [
    `Company: ${name}.`,
    `Domain: ${candidate.dominio}.`,
    candidate.founder_nomi ? `Founders: ${trim(candidate.founder_nomi, 300)}.` : '',
    trim(candidate.descrizione, 500),
  ].filter(Boolean).join(' ');
  const body = await sageCall('/decide', {
    content,
    question: {
      id: 'company_identity', kind: 'yesno',
      instructions: `Search specifically for ${name} at ${candidate.dominio}. Does credible public evidence refer to this exact company? Ignore namesakes and generic startup advice.`,
    },
    reasoning: 'off',
    grounding: webSearch,
  });
  const domain = String(candidate.dominio || '').toLowerCase();
  const relevant = (body?.grounding_meta?.sources || []).filter(source => {
    const haystack = [source?.url, source?.title, source?.snippet].join(' ').toLowerCase();
    return domain && haystack.includes(domain);
  }).slice(0, 8);
  return {
    evidence: relevant.map(source => ({
      title: trim(source.title, 200),
      url: source.url,
      snippet: trim(source.snippet, 1500),
    })),
    sources: relevant.map(source => source.url).filter(url => /^https?:\/\//i.test(url || '')),
  };
}

function answerMap(body) {
  const answers = body?.results?.[0]?.answers;
  if (!Array.isArray(answers) || answers.length < 3) throw new Error('Risposta Sage incompleta');
  const map = {};
  for (const answer of answers) {
    if (!answer?.ok) throw new Error(`Decisione Sage fallita: ${answer?.error?.code || answer?.error || 'errore sconosciuto'}`);
    const decision = answer.result;
    if (decision?.id) map[decision.id] = decision.result;
  }
  if (!map.esito || !map.fit || !map.voto) throw new Error('Risposta Sage senza esito, fit o voto');
  return { decisions: map, sources: groundingSources(body) };
}

function groundingSources(body) {
  const sources = [];
  const add = source => {
    const url = typeof source === 'string' ? source : source?.url || source?.link || source?.uri;
    if (/^https?:\/\//i.test(url || '') && !sources.includes(url)) sources.push(url);
  };
  const metas = [body?.grounding_meta, body?.meta?.grounding_meta, body?.meta?.grounding];
  for (const answer of body?.results?.flatMap(result => result?.answers || []) || []) {
    metas.push(answer?.grounding_meta, answer?.result?.grounding_meta,
      answer?.result?.meta?.grounding_meta, answer?.result?.meta?.grounding);
  }
  for (const meta of metas) for (const source of meta?.sources || []) add(source);
  return sources;
}

function mergeSources(existing, grounded) {
  return [...new Set([
    ...String(existing || '').split(/\s*,\s*/).filter(Boolean),
    ...grounded,
  ])].join(', ');
}

function safeOutcome(sage, baseline, gate) {
  if (baseline.esito === 'Esclusa') return 'Esclusa';
  // un'esclusione di Sage vale solo se indica una soglia precisa
  if (sage.chosen === 'excluded') return gate && gate !== 'none' ? 'Esclusa' : 'Needs verification';
  if (sage.chosen !== 'qualified') return 'Needs verification';
  const min = Number(process.env.SAGE_MIN_QUALIFY_PROBABILITY || MIN_QUALIFY_PROBABILITY);
  if (baseline.esito !== 'Qualificata' || !Number.isFinite(sage.probability) || sage.probability < min) return 'Needs verification';
  return 'Qualificata';
}

function safeScore(expectation, esito) {
  let score = Math.round(Number(expectation));
  if (!Number.isFinite(score)) throw new Error('Sage non ha restituito un voto valido');
  score = Math.max(0, Math.min(100, score));
  if (esito === 'Esclusa') score = Math.min(score, 29);
  if (esito === 'Qualificata') score = Math.max(score, 85);
  if (esito === 'Needs verification') score = Math.min(score, 84);   // rubrica: 85+ solo per le qualificate
  return score;
}

const NO_RESEARCH = { evidence: [], sources: [] };

async function decideOnce(c, baseline, full) {
  const research = full ? await sageResearch(c) : NO_RESEARCH;
  const response = answerMap(await sageBatch(candidateContent(c, baseline, research.evidence), c, full ? reasoningMode() : 'off'));
  return { research, response };
}

function wantsFull(baseline) {
  if (process.env.SAGE_TIERING === 'off') return true;
  return baseline.fit === 'Alto' || baseline.fit === 'Medio';
}

function promising(sage) {
  return sage.esito.chosen === 'qualified' || sage.fit.chosen === 'high' || Number(sage.voto.expectation) >= LIGHT_ESCALATE_SCORE;
}

export default {
  name: 'sage',
  version: 'sage-2-v8',
  rankBy: 'euristico',
  parallel: Number(process.env.SAGE_PARALLEL || 3),
  writeEvery: 10,
  stats: () => ({ ...usage }),

  async classify(c) {
    const baseline = await euristico.classify(c);
    // esclusa con prove certe dall'euristico: Sage non cambierebbe l'esito, non si spende niente
    if (baseline.esito === 'Esclusa') { usage.saltati_esclusi++; return { ...baseline, versione: this.version + ' (solo euristico)' }; }

    let full = wantsFull(baseline);
    let { research, response } = await decideOnce(c, baseline, full);
    if (!full) {
      usage.leggeri++;
      if (promising(response.decisions)) {
        usage.promossi++;
        full = true;
        ({ research, response } = await decideOnce(c, baseline, true));
      }
    }
    if (full) usage.completi++;

    const sage = response.decisions;
    const gate = sage.soglia?.chosen;
    const esito = safeOutcome(sage.esito, baseline, gate);
    const fit = FIT_TO_SHEET[sage.fit.chosen] || baseline.fit;
    const voto = safeScore(sage.voto.expectation, esito);
    const downgraded = sage.esito.chosen === 'qualified' && esito !== 'Qualificata';
    const sageExcluded = esito === 'Esclusa' && baseline.esito !== 'Esclusa';
    const unprovenExclusion = sage.esito.chosen === 'excluded' && esito !== 'Esclusa';
    const reason = baseline.motivo || 'valutazione sulle evidenze disponibili';
    return {
      ...baseline,
      versione: `${this.version} ${full ? 'completo' : 'leggero'}`,
      esito,
      fit,
      voto,
      motivo: downgraded
        ? `Sage non qualifica senza verifica completa; ${reason}`
        : sageExcluded ? `Sage: ${GATE_TO_TEXT[gate] || 'soglia rigida superata'} (vedi fonti)`
        : unprovenExclusion ? `Sage tende a escludere ma senza una soglia precisa; ${reason}` : reason,
      da_verificare: esito === 'Needs verification' && !baseline.da_verificare
        ? 'decisione Sage non abbastanza certa'
        : baseline.da_verificare,
      fonti: mergeSources(baseline.fonti, [...research.sources, ...response.sources]),
    };
  },
};
