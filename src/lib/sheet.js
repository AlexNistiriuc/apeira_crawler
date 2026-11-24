// Client del foglio-database. Parla con la web app Apps Script in apps-script/Code.gs.
// Variabili d'ambiente: SHEET_API_URL (URL /exec della web app) e SHEET_API_TOKEN.
// Con SHEET_DRY_RUN=1 non scrive nulla e stampa cosa scriverebbe (utile in locale).

export const TABS = { hub: 'db_hub', cand: 'db_candidati', eval: 'db_valutazioni', log: 'db_log' };

let impl = null;
/** Solo per i test: sostituisce il backend (vedi test/fake-sheet.js). */
export function setSheetBackend(b) { impl = b; }

async function call(action, payload = {}) {
  if (impl) return impl(action, payload);
  const url = process.env.SHEET_API_URL, token = process.env.SHEET_API_TOKEN;
  if (!url || !token) throw new Error('Mancano SHEET_API_URL o SHEET_API_TOKEN');
  if (process.env.SHEET_DRY_RUN === '1' && !['read', 'keys', 'queue'].includes(action)) {
    console.log('[dry-run]', action, payload.tab, (payload.rows || []).length, 'righe');
    return { ok: true, dry: true };
  }
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, action, ...payload }) });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch { throw new Error('risposta non JSON: ' + txt.slice(0, 200)); }
      if (!j.ok) throw new Error(j.error || 'errore sconosciuto');
      return j;
    } catch (e) {
      if (a === 3) throw e;
      await new Promise(r => setTimeout(r, 3000 * (a + 1)));
    }
  }
}

/** Tutte le righe di un tab come oggetti. columns limita i campi restituiti. */
export async function read(tab, { columns, where } = {}) {
  return (await call('read', { tab, columns, where })).rows || [];
}

/** Insert o update per chiave. Aggiorna solo i campi passati, aggiunge colonne nuove se servono. */
export async function upsert(tab, key, rows, batch = 200) {
  let ins = 0, upd = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const r = await call('upsert', { tab, key, rows: rows.slice(i, i + batch) });
    ins += r.inserted || 0; upd += r.updated || 0;
  }
  return { inserted: ins, updated: upd };
}

/** Scrittura senza lock per agenti e Claude: va in db_appoggio e la unisce merge (o la vista oraria). */
export async function stage(tab, key, rows) { return call('stage', { tab, key, rows }); }
export async function merge() { return call('merge', {}); }

export async function append(tab, rows) { return call('append', { tab, rows }); }

/** Ricostruisce subito la vista Startup trovate (di solito lo fa Apps Script ogni ora). */
export async function views() { return call('views', {}); }

/** Candidati che un classificatore non ha ancora valutato (o valutato prima dell'ultimo controllo). */
export async function queue(classifier, limit = 200, rank_by, solo_nuove = false) {
  return (await call('queue', { classifier, limit, rank_by, solo_nuove })).rows || [];
}

/** Scrive una riga nel tab di log a fine run. */
export async function logRun(component, startedAt, stats) {
  try {
    await append(TABS.log, [{ componente: component, inizio: startedAt, fine: new Date().toISOString().slice(0, 19).replace('T', ' '), statistiche: JSON.stringify(stats) }]);
  } catch (e) { console.error('log non scritto:', e.message); }
}

/**
 * Buffer che accumula righe e le scrive a blocchi, così un run interrotto non perde tutto.
 */
export function writer(tab, key, every = 50) {
  let buf = [];
  const flush = async () => { if (!buf.length) return; const b = buf; buf = []; await upsert(tab, key, b); };
  return { push: async row => { buf.push(row); if (buf.length >= every) await flush(); }, flush };
}
