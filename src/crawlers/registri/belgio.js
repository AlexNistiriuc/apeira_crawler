// Belgio: open data della Banca-Carrefour delle Imprese (KBO/BCE), con account gratuito (secret KBO_USER, KBO_PASSWORD).
// Un file zip mensile (qualche centinaio di MB) con CSV: enterprise (data di inizio), activity (NACE),
// denomination (nome), contact (sito). Nessuna persona e nessuna età: entrano solo le imprese con il sito.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import { registryStats } from '../../lib/registry.js';

const BASE = 'https://kbopub.economie.fgov.be';

/** Divide una riga CSV con virgole e virgolette doppie. */
export function splitComma(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Legge le righe di un CSV (async iterable di stringhe) e chiama onRow con un oggetto per riga. */
export async function eachRow(lines, onRow) {
  let head = null;
  for await (const raw of lines) {
    const line = raw.replace(/^﻿/, '');
    if (!line) continue;
    const c = splitComma(line);
    if (!head) { head = c; continue; }
    const o = {}; head.forEach((h, i) => { o[h] = c[i] ?? ''; });
    onRow(o);
  }
}

/** "dd-mm-yyyy" → "yyyy-mm-dd". */
export const isoDate = d => { const m = String(d || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

/**
 * Dal contenuto dei quattro CSV alle imprese giovani con attività deep tech e sito.
 * readers: { enterprise, activity, denomination, contact } → async iterable di righe.
 */
export async function belgiumFromCsv(readers, { from, codes }) {
  const ent = new Map();
  await eachRow(readers.enterprise(), r => {
    const start = isoDate(r.StartDate);
    if (r.Status !== 'AC' || r.TypeOfEnterprise !== '2' || !start || start < from) return;
    ent.set(r.EnterpriseNumber, { paese: 'BE', numero: r.EnterpriseNumber, nome: '', costituita: start, attivita: '', sito: '', url: `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${r.EnterpriseNumber.replace(/\D/g, '')}` });
  });
  const keep = new Map();
  await eachRow(readers.activity(), r => {
    const e = ent.get(r.EntityNumber); if (!e || r.Classification !== 'MAIN') return;
    const code = String(r.NaceCode || '').replace(/\D/g, '');
    if (codes.some(c => code.startsWith(c))) { e.attivita = `NACE ${r.NaceVersion} ${code}`; keep.set(r.EntityNumber, e); }
  });
  await eachRow(readers.denomination(), r => {
    const e = keep.get(r.EntityNumber); if (!e) return;
    if (!e.nome || r.TypeOfDenomination === '001') e.nome = r.Denomination;
  });
  await eachRow(readers.contact(), r => {
    const e = keep.get(r.EntityNumber); if (e && r.ContactType === 'WEB' && !e.sito) e.sito = r.Value;
  });
  return [...keep.values()].filter(e => e.nome);
}

/** Login con i secret e URL del file zip completo più recente. */
async function latestZip(fetchImpl, user, pass) {
  const jar = new Map();
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = r => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const get = async (u, opt = {}) => { const r = await fetchImpl(u, { ...opt, redirect: 'manual', headers: { ...(opt.headers || {}), Cookie: cookies() } }); keep(r); return r; };
  const follow = async (u, opt) => { let r = await get(u, opt); for (let i = 0; i < 5 && r.status >= 300 && r.status < 400; i++) r = await get(new URL(r.headers.get('location'), BASE).href); return r; };
  await follow(`${BASE}/kbo-open-data/login?lang=en`);
  const login = await follow(`${BASE}/kbo-open-data/static/j_spring_security_check`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ j_username: user, j_password: pass }).toString() });
  const html = await login.text();
  if (/login_error/.test(login.url || '') || /j_password/.test(html)) throw new Error('login KBO rifiutato');
  const pages = [html];
  for (const p of ['/kbo-open-data/affiliation/xml/?files', '/kbo-open-data/affiliation/xml/']) { const r = await follow(BASE + p); if (r.ok) pages.push(await r.text()); }
  const links = [...new Set(pages.join('\n').match(/[^"'\s>]*KboOpenData_\d+_\d{4}_\d{2}_Full\.zip/g) || [])].sort();
  if (!links.length) throw new Error('nessun file Full.zip trovato dopo il login');
  return { url: new URL(links.at(-1), `${BASE}/kbo-open-data/affiliation/xml/`).href, cookie: cookies() };
}

/** Scarica lo zip del mese (con il login) e restituisce le imprese giovani con sito. */
export async function belgiumCompanies({ from, codes, fetchImpl = fetch, user = process.env.KBO_USER, pass = process.env.KBO_PASSWORD, file = '/tmp/kbo.zip' }) {
  if (!user || !pass) return { items: [], motivo: 'mancano KBO_USER e KBO_PASSWORD' };
  registryStats.be = (registryStats.be || 0) + 1;
  const { url, cookie } = await latestZip(fetchImpl, user, pass);
  const r = await fetchImpl(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(1200000) });
  if (!r.ok) throw new Error(`download KBO ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
  const entry = name => () => readline.createInterface({ input: spawn('unzip', ['-p', file, name]).stdout, crlfDelay: Infinity });
  const items = await belgiumFromCsv({ enterprise: entry('enterprise.csv'), activity: entry('activity.csv'), denomination: entry('denomination.csv'), contact: entry('contact.csv') }, { from, codes });
  if (existsSync(file)) unlinkSync(file);
  return { items, file: url.split('/').pop() };
}
