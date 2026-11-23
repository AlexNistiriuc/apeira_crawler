/**
 * Appoggio.gs (23 nov 2026): file a parte nello stesso progetto Apps Script di Code.gs.
 * Scheda db_appoggio per le scritture di agenti e Claude senza il lock dei crawler.
 * Si aggiunge come file nuovo, così Code.gs (e le funzioni aggiunte a mano, come importaFonti) resta com'è.
 */
SCHEMA.db_appoggio = { key: null, columns: ['ricevuto_il', 'tab', 'chiave', 'riga', 'errore'] };
var STAGE_TABS = ['db_valutazioni', 'db_candidati'];   // cosa si può scrivere passando da db_appoggio

/**
 * Scrittura senza lock (agenti, Claude): le righe vanno in db_appoggio, una per riga, e si controllano subito
 * nel formato. Il lock non serve: appendRow su un tab che nessun altro riscrive.
 */
function stage_(tab, key, rows) {
  if (STAGE_TABS.indexOf(tab) < 0) throw new Error('stage solo su ' + STAGE_TABS.join(', '));
  if (key !== SCHEMA[tab].key) throw new Error('la chiave di ' + tab + ' è ' + SCHEMA[tab].key);
  rows.forEach(function (r) { validate_(tab, r); if (!r[key]) throw new Error('manca ' + key); });
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('db_appoggio') || ensureTab_(ss, 'db_appoggio', SCHEMA.db_appoggio.columns);
  var ts = new Date().toISOString();
  rows.forEach(function (r) { sh.appendRow([ts, tab, key, cell_(r), '']); });
  return { ok: true, staged: rows.length };
}

/** Porta le righe di db_appoggio nei tab veri (da chiamare sotto lock). Le righe con errore restano, con il motivo. */
function mergeStaging_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('db_appoggio');
  if (!sh || sh.getLastRow() < 2) return { unite: 0, errori: 0 };
  var t = table_(sh), H = {};
  t.head.forEach(function (h, i) { H[h] = i; });
  var groups = {}, keep = [], unite = 0;
  t.data.forEach(function (r) {
    if (String(r[H.errore] || '')) { keep.push(r); return; }
    var g = r[H.tab] + '|' + r[H.chiave];
    try { (groups[g] = groups[g] || { tab: String(r[H.tab]), key: String(r[H.chiave]), rows: [], raw: [] }).rows.push(JSON.parse(String(r[H.riga]))); groups[g].raw.push(r); }
    catch (e) { r[H.errore] = 'riga non JSON'; keep.push(r); }
  });
  Object.keys(groups).forEach(function (g) {
    var G = groups[g];
    try { upsert_(G.tab, G.key, G.rows); unite += G.rows.length; }
    catch (e) {
      // un gruppo rifiutato: si riprova riga per riga, così una riga sbagliata non blocca le altre
      G.rows.forEach(function (row, i) {
        try { upsert_(G.tab, G.key, [row]); unite++; }
        catch (e2) { var r = G.raw[i]; r[H.errore] = String(e2 && e2.message || e2).slice(0, 300); keep.push(r); }
      });
    }
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, t.head.length).setValues([t.head]);
  if (keep.length) sh.getRange(2, 1, keep.length, t.head.length).setValues(keep.map(function (r) { return t.head.map(function (_, i) { return r[i] === undefined ? '' : r[i]; }); }));
  return { unite: unite, errori: keep.length };
}

