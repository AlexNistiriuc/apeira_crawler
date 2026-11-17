// Contratto di uscita di ogni classificatore (lo stesso controllo lo fa Apps Script lato foglio).
import { readFileSync } from 'node:fs';
const SCHEMA = JSON.parse(readFileSync(new URL('../../contracts/schema.json', import.meta.url), 'utf8'));
const COLS = SCHEMA.tabs.db_valutazioni.columns;
const REQUIRED = ['id', 'dominio', 'classificatore', 'versione', 'valutato_il', 'esito', 'fit', 'voto', 'motivo'];

export function validateEvaluation(e) {
  const errs = [];
  for (const k of REQUIRED) if (e[k] === undefined || e[k] === '') errs.push(`manca ${k}`);
  for (const k of Object.keys(e)) if (!COLS.includes(k)) errs.push(`colonna sconosciuta ${k}`);
  if (!SCHEMA.enums['db_valutazioni.esito'].includes(e.esito)) errs.push(`esito non valido: ${e.esito}`);
  if (!SCHEMA.enums['db_valutazioni.fit'].includes(e.fit)) errs.push(`fit non valido: ${e.fit}`);
  if (!(Number.isFinite(+e.voto) && +e.voto >= 0 && +e.voto <= 100)) errs.push(`voto fuori da 0-100: ${e.voto}`);
  if (e.id && e.dominio && e.classificatore && e.id !== `${e.dominio}|${e.classificatore}`) errs.push('id deve essere dominio|classificatore');
  return errs;
}
