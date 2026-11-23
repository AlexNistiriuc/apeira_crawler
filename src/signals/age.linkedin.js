// Calcolo dell'età e dell'anzianità dai dati LinkedIn letti dal crawler LinkedIn.
// Regola di Alex: l'età si stima dalla PRIMA esperienza educativa (inizio studi + 18 anni),
// oppure dall'anno di fine studi con l'offset tipico del titolo. È una stima per ordinare:
// non è una dichiarazione pubblica e non deve mai escludere una startup da sola.
import { band } from './age.estimate.js';

const DEGREE_OFFSET = [
  [/\b(ph\.?\s?d|doctorate|dottorato|doctoral)\b/i, 28],
  [/\b(m\.?sc|master'?s?|m\.?\s?eng|mba|laurea magistrale|diplom)\b/i, 24],
  [/\b(b\.?sc|bachelor|ba|b\.?\s?eng|laurea triennale|licence)\b/i, 22],
];

export function parseYear(value) {
  const m = String(value ?? '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  gen: 1, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, dic: 12,
};

/** "2025-03", "Mar 2025", "since 2024" → {year, month|null}. */
export function parseStart(value) {
  const s = String(value ?? '');
  const year = parseYear(s);
  if (!year) return null;
  const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|gen|mag|giu|lug|ago|set|ott|dic)/i);
  if (named) return { year, month: MONTHS[named[1].toLowerCase()] };
  const month = s.match(/(?:^|[^\d])(0?[1-9]|1[0-2])(?:[^\d]|$)/);
  return { year, month: month ? Number(month[1]) : null };
}

/**
 * Età stimata dalla prima esperienza educativa.
 * - anno di inizio studi: anno corrente - inizio + 18
 * - solo anno di fine: anno corrente - fine + offset del titolo (22/24/28)
 * @param {object|null} education {start_year, end_year, degree, institution}
 * @param {number} year anno corrente
 * @returns {number|null}
 */
export function ageFromEducation(education, year = new Date().getFullYear()) {
  if (!education || typeof education !== 'object') return null;
  const start = parseYear(education.start_year ?? education.startYear ?? education.start);
  const end = parseYear(education.end_year ?? education.endYear ?? education.end);
  const degree = String(education.degree || education.qualification || '');
  let age = null;
  if (start) age = year - start + 18;
  else if (end) {
    const offset = DEGREE_OFFSET.find(([re]) => re.test(degree));
    age = year - end + (offset ? offset[1] : 22);
  }
  if (age == null || !Number.isFinite(age) || age < 16 || age > 80) return null;
  return Math.round(age);
}

/** Anno in cui il founder ha iniziato a lavorare nella startup, normalizzato. */
export function startYear(start) {
  const p = parseStart(start);
  return p ? p.year : null;
}

/** Inizio più antico tra i founder: è l'indizio migliore per l'anno di fondazione. */
export function earliestStart(founders) {
  const years = (founders || []).map(f => startYear(f.start_at_company ?? f.da)).filter(y => y != null);
  return years.length ? Math.min(...years) : null;
}

/** Testo leggibile: "dal 2025-03 (1 anno)". */
export function tenureText(start, year = new Date().getFullYear(), nowMonth = new Date().getMonth() + 1) {
  const p = parseStart(start);
  if (!p) return '';
  let years = year - p.year;
  if (p.month && nowMonth < p.month) years--;
  if (years < 0) years = 0;
  const label = `${p.year}${p.month ? '-' + String(p.month).padStart(2, '0') : ''}`;
  return `dal ${label} (${years === 0 ? 'meno di 1 anno' : years === 1 ? '1 anno' : years + ' anni'})`;
}

export { band };
