// Sola lettura: le startup da valutare viste dal crawler da una data, con la valutazione che conta
// (precedenza sage, claude, euristico). Uso: DAL=2026-11-22 node tools/export-recenti.js
import { read, TABS } from '../src/lib/sheet.js';
const dal = process.env.DAL || '2026-11-22';
const PREC = { sage: 0, claude: 1, euristico: 2 };
const cands = (await read(TABS.cand)).filter(c => c.stato_crawler === 'da_valutare' && String(c.primo_visto) >= dal);
const best = {};
for (const v of await read(TABS.eval, { columns: ['dominio', 'classificatore', 'versione', 'esito', 'fit', 'voto', 'motivo', 'da_verificare'] })) {
  const p = PREC[v.classificatore]; if (p === undefined) continue;
  if (!best[v.dominio] || p < best[v.dominio]._p) best[v.dominio] = { ...v, _p: p };
}
const out = cands.map(c => { const v = best[c.dominio] || {}; return { dominio: c.dominio, nome: c.nome, primo_visto: c.primo_visto, settori: c.settori, hub: String(c.hub_origine || '').slice(0, 120), email: c.email, founder: c.founder_nomi, fatti: c.fatti_il ? 'sì' : 'no', versione_crawler: c.versione_crawler || '', pagine_lette: c.pagine_lette ? 'sì' : 'no', versione_val: v.versione || '', valutatore: v.classificatore || '', esito: v.esito || '', fit: v.fit || '', voto: v.voto || '', motivo: String(v.motivo || '').slice(0, 300), da_verificare: v.da_verificare || '' }; });
import { writeFileSync } from 'node:fs';
writeFileSync('export.json', JSON.stringify(out));
for (const r of out) console.log('ROW ' + JSON.stringify(r));
console.log(`esportate ${out.length} startup in export.json`);

// hub scoperti dal giorno indicato, con quello che hanno reso finora
const hubs = (await read(TABS.hub)).filter(h => String(h.scoperto_il) >= dal);
for (const h of hubs) console.log('HUB ' + JSON.stringify({ nome: String(h.nome).slice(0, 80), url: h.url, origine: h.origine, tipo: h.tipo, stato: h.stato, letto: h.ultimo_crawl ? 'sì' : 'no', candidati: h.candidati_trovati, da_valutare: h.candidati_da_valutare, note: String(h.note || '').slice(0, 80) }));
console.log(`hub esportati ${hubs.length}`);
