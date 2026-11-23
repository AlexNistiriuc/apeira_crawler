/**
 * Apeira scouting: API del foglio-database.
 *
 * Installazione (una volta sola, dal foglio pool_founder_startup):
 *   Estensioni > Apps Script > incolla questo file > Salva
 *   Esegui la funzione setup()  -> crea i tab db_* (nascosti), prepara Startup trovate e crea il token (lo trovi nel log)
 *   Esegui il deploy > Nuovo deployment > App web > Esegui come: me > Chi può accedere: chiunque
 *   L'URL che finisce con /exec è SHEET_API_URL, il token è SHEET_API_TOKEN.
 *
 * Tutte le richieste: POST con corpo JSON {token, action, ...}.
 * Solo lettura anche via GET: ?token=...&action=queue&classifier=claude&limit=30&rank_by=euristico
 *
 * Azioni: read, upsert, append, queue, views, ping, stage, merge.
 * stage (23 nov 2026): per agenti e Claude. Mette le righe in db_appoggio senza il lock dei crawler (niente
 * "Timeout di blocco"); merge, la vista oraria e ogni views le portano nei tab veri sotto lock.
 * stage_ e mergeStaging_ stanno nel file Appoggio.gs dello stesso progetto.
 * Il foglio è il database: i tab db_* (nascosti) sono scritti dai programmi, Startup trovate è la vista per le persone
 * e per l'agente di outreach. Le sue prime 17 colonne sono quelle della v1, nello stesso ordine.
 */

// Deve coincidere con contracts/schema.json (lo controlla test/apps-script.test.js).
var SCHEMA = {
  db_hub: { key: 'hub_id', columns: ['hub_id', 'nome', 'url', 'origine', 'tipo', 'stato', 'priorita', 'scoperto_il', 'note', 'ultimo_crawl', 'pagine_lette', 'candidati_trovati', 'candidati_da_valutare', 'cursore', 'fallimenti', 'scoperta_il'] },
  db_candidati: { key: 'dominio', columns: ['dominio', 'nome', 'sito', 'hub_origine', 'primo_visto', 'ultimo_check', 'stato_crawler', 'motivo', 'dominio_registrato', 'primo_archivio', 'anni_sul_sito', 'settori', 'punteggio_deep', 'europa', 'segnali_funding', 'email', 'linkedin_azienda', 'linkedin_persone', 'founder_nomi', 'team_stima', 'descrizione', 'domanda_reale', 'evidenze', 'pagine_lette', 'versione_crawler', 'snowball_il', 'eta_stimata', 'fonti_eta', 'eta_il', 'registro', 'eta_verificate', 'notizie_funding', 'fatti_il', 'round_notizie'] },
  db_valutazioni: { key: 'id', columns: ['id', 'dominio', 'classificatore', 'versione', 'valutato_il', 'esito', 'fit', 'voto', 'motivo', 'fondazione', 'grant', 'investimenti', 'accesso_lab', 'team', 'eta_founder', 'under30', 'domanda_reale', 'da_verificare', 'fonti', 'nota_alex', 'eta_stimata', 'fonti_eta'] },
  db_log: { key: null, columns: ['componente', 'inizio', 'fine', 'statistiche'] },
  db_scoperta: { key: 'query', columns: ['query', 'tipo', 'settore', 'luogo', 'livello', 'usata_il', 'risultati', 'hub_nuovi', 'hub_utili'] }
};
var ENUMS = {
  'db_valutazioni.esito': ['Qualificata', 'Needs verification', 'Esclusa'],
  'db_valutazioni.fit': ['Alto', 'Medio', 'Basso'],
  'db_candidati.stato_crawler': ['da_valutare', 'scartata', 'sito_morto', 'da_ricontrollare'],
  'db_hub.stato': ['attivo', 'da_verificare', 'senza_resa', 'escluso_vc', 'escluso_junk', 'irraggiungibile', 'in_pausa']
};
var VIEW_TAB = 'Startup trovate';
var OLD_TABS = ['Classifica', 'pool_founder_startup', 'Hub del crawler']; // sostituiti dai tab db_*: setup() li nasconde
var MAX_CELL = 49000;

// ---------------------------------------------------------------- ingresso

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'corpo non JSON' }); }
  return out_(handle_(body, false));
}

function doGet(e) {
  return out_(handle_(e.parameter || {}, true));
}

function handle_(p, readOnly) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!token || p.token !== token) return { ok: false, error: 'token non valido' };
    var a = p.action;
    if (readOnly && ['read', 'queue', 'ping'].indexOf(a) < 0) return { ok: false, error: 'via GET solo read, queue, ping' };
    if (a === 'ping') return { ok: true, ora: new Date().toISOString() };
    if (a === 'read') return { ok: true, rows: readRows_(p.tab, asList_(p.columns), p.where) };
    if (a === 'queue') return { ok: true, rows: queue_(p.classifier, Number(p.limit || 200), p.rank_by, p.solo_nuove) };
    if (a === 'upsert') return withLock_(function () { return upsert_(p.tab, p.key, p.rows || []); });
    if (a === 'append') return withLock_(function () { return append_(p.tab, p.rows || []); });
    if (a === 'views') return withLock_(function () { var m = mergeStaging_(); var v = buildViews_(); v.appoggio = m; return v; });
    if (a === 'stage') return stage_(p.tab, p.key, p.rows || []);
    if (a === 'merge') return withLock_(function () { return mergeStaging_(); });
    return { ok: false, error: 'azione sconosciuta: ' + a };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function asList_(x) {
  if (!x) return null;
  return Array.isArray(x) ? x : String(x).split(',');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(120000);
  try { var r = fn(); r.ok = true; return r; } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- setup

function setup() {
  var ss = SpreadsheetApp.getActive();
  var view = ss.getSheetByName(VIEW_TAB) || ensureTab_(ss, VIEW_TAB, VIEW_COLUMNS);
  view.showSheet();
  ss.setActiveSheet(view);   // prima la vista attiva, poi si possono nascondere gli altri
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ensureTab_(ss, name, SCHEMA[name].columns);
    sh.hideSheet();
    // intestazioni protette: chi prova a modificarle riceve un avviso (i programmi usano i nomi delle colonne)
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === 'intestazioni') p.remove(); });
    sh.getRange(1, 1, 1, sh.getMaxColumns()).protect().setDescription('intestazioni').setWarningOnly(true);
  });
  OLD_TABS.forEach(function (n) { var sh = ss.getSheetByName(n); if (sh) sh.hideSheet(); });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (!props.getProperty('PRECEDENZA')) props.setProperty('PRECEDENZA', 'sage,claude,euristico');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'buildViews') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('buildViews').timeBased().everyHours(1).create();
  Logger.log('Token API (SHEET_API_TOKEN): ' + props.getProperty('API_TOKEN'));
}

function ensureTab_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // tutto testo: niente conversioni automatiche di date e numeri
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(sh.getMaxColumns(), cols.length)).setNumberFormat('@');
  return sh;
}

// ---------------------------------------------------------------- tabelle

function sheet_(tab) {
  if (!SCHEMA[tab] && tab !== VIEW_TAB) throw new Error('tab non ammesso: ' + tab);
  var sh = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sh) throw new Error('manca il tab ' + tab + ': esegui setup()');
  return sh;
}

function table_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr === 0) return { head: [], data: [] };
  var all = sh.getRange(1, 1, lr, lc).getValues();
  return { head: all[0].map(String), data: all.slice(1) };
}

function readRows_(tab, columns, where) {
  var t = table_(sheet_(tab));
  var idx = {};
  t.head.forEach(function (h, i) { idx[h] = i; });
  var cols = columns && columns.length ? columns.filter(function (c) { return idx[c] !== undefined; }) : t.head;
  var w = where ? (typeof where === 'string' ? JSON.parse(where) : where) : null;
  var rows = [];
  for (var r = 0; r < t.data.length; r++) {
    var row = t.data[r];
    if (w && !Object.keys(w).every(function (k) { return idx[k] !== undefined && String(row[idx[k]]) === String(w[k]); })) continue;
    var o = {};
    cols.forEach(function (c) { o[c] = String(row[idx[c]]); });
    rows.push(o);
  }
  return rows;
}

function validate_(tab, row) {
  Object.keys(row).forEach(function (k) {
    var en = ENUMS[tab + '.' + k];
    if (en && row[k] !== '' && row[k] != null && en.indexOf(String(row[k])) < 0) throw new Error(tab + '.' + k + ' non valido: ' + row[k]);
  });
  if (tab === 'db_valutazioni') {
    if (!row.dominio || !row.classificatore || row.id !== row.dominio + '|' + row.classificatore) throw new Error('db_valutazioni: id deve essere dominio|classificatore');
    var v = Number(row.voto);
    if (row.voto !== undefined && !(v >= 0 && v <= 100)) throw new Error('db_valutazioni: voto fuori da 0-100');
  }
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
}

/** Aggiunge in fondo le colonne che mancano (schema che cresce senza rompere i dati). */
function ensureColumns_(sh, head, names) {
  var missing = names.filter(function (n) { return head.indexOf(n) < 0; });
  if (!missing.length) return head;
  var start = head.length + 1;
  if (sh.getMaxColumns() < head.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length + missing.length - sh.getMaxColumns());
  sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
  sh.getRange(1, start, sh.getMaxRows(), missing.length).setNumberFormat('@');
  return head.concat(missing);
}

function upsert_(tab, key, rows) {
  if (!SCHEMA[tab]) throw new Error('tab non ammesso: ' + tab);
  if (key !== SCHEMA[tab].key) throw new Error('la chiave di ' + tab + ' è ' + SCHEMA[tab].key);
  var sh = sheet_(tab);
  var lr = sh.getLastRow(), lc = Math.max(sh.getLastColumn(), 1);
  var oldHead = lr ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
  var fields = {};
  rows.forEach(function (r) { validate_(tab, r); Object.keys(r).forEach(function (k) { fields[k] = 1; }); });
  // se la colonna chiave non c'è più (intestazione rinominata a mano), fermarsi: crearne una nuova
  // vuota farebbe perdere ogni aggiornamento in silenzio (è successo il 19 novembre con db_hub)
  if (lr > 0 && oldHead.indexOf(key) < 0) throw new Error('Nel tab ' + tab + ' manca la colonna chiave "' + key + '": qualcuno ha rinominato l\'intestazione. Esegui riparaChiave_() o ripristina il nome.');
  var head = ensureColumns_(sh, oldHead, Object.keys(fields));
  var idx = {};
  head.forEach(function (h, i) { idx[h] = i; });
  var ki = idx[key];
  // si legge solo la colonna chiave: con decine di migliaia di righe leggere tutto il tab a ogni scrittura è troppo lento
  var pos = {};
  if (lr > 1) sh.getRange(2, ki + 1, lr - 1, 1).getValues().forEach(function (v, r) { pos[String(v[0])] = r; });

  var inserts = [], updates = {}, updated = 0, fresh = {};
  rows.forEach(function (row) {
    var k = String(row[key] || '');
    if (!k) return;
    if (pos[k] !== undefined) {
      (updates[pos[k]] = updates[pos[k]] || []).push(row);
      updated++;
    } else if (fresh[k]) {
      Object.keys(row).forEach(function (f) { fresh[k][idx[f]] = cell_(row[f]); });
    } else {
      fresh[k] = head.map(function (h) { return cell_(row[h]); });
      inserts.push(fresh[k]);
    }
  });
  // aggiornamenti: cambiano solo i campi passati. Pochi: riga per riga. Tanti (es. migliaia di hub_origine
  // a fine giro del crawler): un'unica lettura e un'unica scrittura del blocco di righe toccate, perché
  // ogni chiamata a Sheets costa e riga per riga migliaia di aggiornamenti richiedevano decine di minuti.
  var touched = Object.keys(updates).map(Number);
  var apply = function (cur, r) {
    while (cur.length < head.length) cur.push('');
    updates[r].forEach(function (row) { Object.keys(row).forEach(function (f) { cur[idx[f]] = cell_(row[f]); }); });
  };
  if (touched.length > 50) {
    var minR = Math.min.apply(null, touched), maxR = Math.max.apply(null, touched);
    var block = sh.getRange(minR + 2, 1, maxR - minR + 1, head.length);
    var vals = block.getValues();
    touched.forEach(function (r) { apply(vals[r - minR], r); });
    block.setValues(vals);
  } else {
    touched.forEach(function (r) {
      var rng = sh.getRange(r + 2, 1, 1, head.length);
      var cur = rng.getValues()[0];
      apply(cur, r);
      rng.setValues([cur]);
    });
  }
  if (inserts.length) {
    var start = sh.getLastRow() + 1;
    if (sh.getMaxRows() < start + inserts.length) sh.insertRowsAfter(sh.getMaxRows(), start + inserts.length - sh.getMaxRows());
    sh.getRange(start, 1, inserts.length, head.length).setNumberFormat('@').setValues(inserts);
  }
  return { inserted: inserts.length, updated: updated };
}

function append_(tab, rows) {
  if (!SCHEMA[tab] || SCHEMA[tab].key) throw new Error('append solo su tab senza chiave (db_log)');
  var sh = sheet_(tab);
  var head = table_(sh).head;
  if (!rows.length) return { inserted: 0 };
  var vals = rows.map(function (r) { return head.map(function (h) { return cell_(r[h]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, vals.length, head.length).setNumberFormat('@').setValues(vals);
  return { inserted: vals.length };
}

/**
 * Candidati da_valutare senza valutazione di quel classificatore, o valutati prima dell'ultimo controllo.
 * rank_by (facoltativo): nome di un altro classificatore. Mette prima i candidati con il suo voto più alto,
 * salta quelli che lui ha escluso e aggiunge a ogni riga il suo giudizio (pre_esito, pre_fit, pre_voto, pre_motivo).
 * solo_nuove (facoltativo): esclude le startup importate dalla v1 (versione_crawler "1 (migrata)").
 */
function queue_(classifier, limit, rankBy, onlyNew) {
  if (!classifier) throw new Error('serve classifier');
  var done = {}, pre = {};
  readRows_('db_valutazioni', ['dominio', 'classificatore', 'valutato_il', 'esito', 'fit', 'voto', 'motivo']).forEach(function (v) {
    if (v.classificatore === classifier) done[v.dominio] = v.valutato_il;
    if (rankBy && v.classificatore === rankBy) pre[v.dominio] = v;
  });
  var rows = readRows_('db_candidati', null, { stato_crawler: 'da_valutare' }).filter(function (c) {
    // solo_nuove: solo le startup trovate dal crawler v2, non quelle importate dalla v1
    if (onlyNew && onlyNew !== 'false' && String(c.versione_crawler).indexOf('migrata') >= 0) return false;
    if (rankBy && pre[c.dominio] && pre[c.dominio].esito === 'Esclusa') return false;
    return done[c.dominio] === undefined || String(done[c.dominio]) < String(c.ultimo_check);
  });
  if (rankBy) rows.forEach(function (c) {
    var v = pre[c.dominio];
    c.pre_esito = v ? v.esito : ''; c.pre_fit = v ? v.fit : ''; c.pre_voto = v ? v.voto : ''; c.pre_motivo = v ? v.motivo : '';
  });
  rows.sort(function (a, b) {
    var d = rankBy ? (Number(b.pre_voto) || -1) - (Number(a.pre_voto) || -1) : 0;
    return d || String(b.ultimo_check).localeCompare(String(a.ultimo_check));
  });
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------- vista per le persone

var VIEW_COLUMNS = [
  // le 17 colonne della v1, stesso ordine: le usa l'agente di outreach
  'Startup', 'Sito', 'Stato', 'Fit', 'Funding rilevato sul sito', 'Settori', 'Europa', 'Dominio registrato', 'Anni citati sul sito',
  'Email', 'LinkedIn azienda', 'LinkedIn founder', 'Founder (nomi)', 'Età founder (stima)', 'Pool di provenienza', 'Link pool', 'Descrizione',
  // nuove, dalla valutazione
  'Esito criteri rigidi', 'Voto', 'Motivo', 'Valutata da', 'Fondazione', 'Grant', 'Investimenti esterni', 'Accesso lab', 'Team',
  'Domanda reale', 'Da verificare', 'Nota Alex', 'Età CEO/CTO (stima)', 'Fonti età', 'Round nelle notizie'];

/**
 * Ricostruisce il tab Startup trovate: una riga per startup non esclusa, con la valutazione del classificatore che ha la precedenza
 * (proprietà PRECEDENZA, default "sage,claude,euristico"). Con VISTA_RICHIEDE (es. "sage,claude") entrano solo le startup
 * già valutate da almeno uno di quei classificatori: basta un valutatore. Se l'euristico ha escluso la startup dopo
 * quella valutazione (fatti nuovi dal crawler founder, es. registro imprese), la startup esce subito. Gira ogni ora. Le note in colonna "Nota Alex" si conservano.
 */
/** Stima d'età di CEO e CTO: più "sotto 30" sale, "35 o più" scende. Serve solo a ordinare. */
function ageRank_(x) {
  var t = String((x.c && x.c.eta_stimata) || (x.v && x.v.eta_stimata) || '');
  return (t.match(/sotto 30/g) || []).length - (t.match(/35 o più/g) || []).length;
}

function buildViews() {
  return withLock_(function () { var m = mergeStaging_(); var v = buildViews_(); v.appoggio = m; return v; });
}

function buildViews_() {
  var props = PropertiesService.getScriptProperties();
  var configured = props.getProperty('PRECEDENZA') || 'sage,claude,euristico';
  var order = configured.split(',');
  if (order.indexOf('sage') < 0) order.unshift('sage'); // migra automaticamente la vecchia precedenza
  // VISTA_RICHIEDE: in Startup trovate entrano solo le startup valutate da uno di questi classificatori,
  // separati da virgola (es. "sage,claude": basta uno dei due). Vuoto = qualunque valutatore.
  var required = String(props.getProperty('VISTA_RICHIEDE') || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  var best = {}, heur = {};
  readRows_('db_valutazioni', null).forEach(function (v) {
    if (v.classificatore === 'euristico') heur[v.dominio] = v;
    if (required.length && required.indexOf(v.classificatore) < 0) return;
    var p = order.indexOf(v.classificatore); if (p < 0) p = order.length;
    var cur = best[v.dominio];
    if (!cur || p < cur._p) { v._p = p; best[v.dominio] = v; }
  });
  var rank = { 'Qualificata': 0, 'Needs verification': 1 }, frank = { Alto: 0, Medio: 1, Basso: 2 };
  var CCOLS = ['dominio', 'nome', 'sito', 'settori', 'europa', 'email', 'linkedin_azienda', 'linkedin_persone', 'founder_nomi', 'hub_origine', 'descrizione', 'stato_crawler', 'segnali_funding', 'dominio_registrato', 'primo_archivio', 'anni_sul_sito', 'eta_stimata', 'fonti_eta', 'round_notizie'];
  var hubUrl = {};
  readRows_('db_hub', ['nome', 'url']).forEach(function (h) { hubUrl[h.nome] = h.url; });
  var rows = readRows_('db_candidati', CCOLS, { stato_crawler: 'da_valutare' }).map(function (c) {
    return { c: c, v: best[c.dominio] };
  }).filter(function (x) {
    if (!x.v || x.v.esito === 'Esclusa') return false;
    var h = heur[x.c.dominio];   // fatti nuovi: l'euristico ha escluso dopo il valutatore
    return !(h && h.esito === 'Esclusa' && String(h.valutato_il) > String(x.v.valutato_il));
  });
  rows.sort(function (a, b) {
    var ra = rank[a.v.esito] * 2 + (a.v.under30 === 'sì' ? 0 : 1), rb = rank[b.v.esito] * 2 + (b.v.under30 === 'sì' ? 0 : 1);
    return ra - rb || frank[a.v.fit] - frank[b.v.fit] || ageRank_(b) - ageRank_(a) || Number(b.v.voto) - Number(a.v.voto);
  });
  var sh = SpreadsheetApp.getActive().getSheetByName(VIEW_TAB) || ensureTab_(SpreadsheetApp.getActive(), VIEW_TAB, VIEW_COLUMNS);
  // le note scritte a mano nella vista vengono salvate in db_valutazioni.nota_alex prima di ricostruire
  var notes = {}, old = table_(sh), si = old.head.indexOf('Sito'), ni = old.head.indexOf('Nota Alex');
  if (si >= 0 && ni >= 0) old.data.forEach(function (r) { if (String(r[ni]).trim()) notes[String(r[si])] = String(r[ni]); });
  var save = [];
  rows.forEach(function (x) {
    var n = notes[x.c.sito];
    if (n && n !== x.v.nota_alex) { x.v.nota_alex = n; save.push({ id: x.v.id, dominio: x.v.dominio, classificatore: x.v.classificatore, nota_alex: n }); }
  });
  if (save.length) upsert_('db_valutazioni', 'id', save);
  var vals = rows.map(function (x) {
    var c = x.c, v = x.v;
    var hubs = String(c.hub_origine || '').split(', ').filter(String);
    var stato = v.esito === 'Qualificata' ? 'Target' : 'Da verificare: ' + (v.da_verificare || v.motivo);
    var dom = c.dominio_registrato ? 'registrato ' + c.dominio_registrato : (c.primo_archivio ? 'primo archivio web ' + c.primo_archivio : '');
    return [c.nome, c.sito, stato, v.fit, c.segnali_funding || 'nessuno', c.settori, c.europa, dom, c.anni_sul_sito,
      c.email, c.linkedin_azienda, c.linkedin_persone, c.founder_nomi, v.eta_founder, hubs.join(' ; '),
      hubs.map(function (h) { return hubUrl[h] || ''; }).filter(String).join(' ; '), c.descrizione,
      v.esito, v.voto, v.motivo, v.classificatore + ' ' + v.versione, v.fondazione, v.grant, v.investimenti, v.accesso_lab, v.team,
      v.domanda_reale, v.da_verificare, v.nota_alex, c.eta_stimata || v.eta_stimata, c.fonti_eta || v.fonti_eta, c.round_notizie || ''].map(cell_);
  });
  sh.clearContents();
  if (sh.getMaxColumns() < VIEW_COLUMNS.length) sh.insertColumnsAfter(sh.getMaxColumns(), VIEW_COLUMNS.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, VIEW_COLUMNS.length).setValues([VIEW_COLUMNS]).setFontWeight('bold');
  if (vals.length) {
    if (sh.getMaxRows() < vals.length + 1) sh.insertRowsAfter(sh.getMaxRows(), vals.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, vals.length, VIEW_COLUMNS.length).setValues(vals);
  }
  return { righe: vals.length };
}

// ---------------------------------------------------------------- manutenzione

/**
 * Ripara un tab la cui colonna chiave è stata rinominata (es. db_hub: "hub_id" diventato "link").
 * Copia la chiave dalla colonna rinominata, fonde i doppioni creati nel frattempo, rimette lo schema.
 * Prima fa una copia di sicurezza nascosta del tab. Da eseguire a mano dall'editor.
 */
function riparaChiave_(tab, oldName) {
  tab = tab || 'db_hub'; oldName = oldName || 'link';
  var key = SCHEMA[tab].key;
  var lock = LockService.getScriptLock(); lock.waitLock(120000);
  try {
    var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(tab);
    var backup = sh.copyTo(ss).setName(tab + '_backup_' + Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMdd_HHmm'));
    backup.hideSheet();
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var all = sh.getRange(1, 1, lr, lc).getValues(), head = all[0].map(String);
    var li = head.indexOf(oldName), hi = head.lastIndexOf(key);
    if (li < 0) throw new Error('colonna "' + oldName + '" non trovata in ' + tab);
    var rows = all.slice(1).map(function (r) {
      var k = hi >= 0 ? String(r[hi]) : '';
      r[li] = k || String(r[li]);
      if (hi >= 0) r.splice(hi, 1);
      return r;
    });
    head[li] = key; if (hi >= 0) head.splice(hi, 1);
    var byKey = {}, out = [], merged = 0;
    rows.forEach(function (r) {
      var k = String(r[li]);
      if (!k) { out.push(r); return; }
      if (byKey[k] === undefined) { byKey[k] = out.length; out.push(r); return; }
      var t = out[byKey[k]]; merged++;
      for (var c = 0; c < head.length; c++) if (!String(t[c]) && String(r[c])) t[c] = r[c];
    });
    sh.clearContents();
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    if (out.length) sh.getRange(2, 1, out.length, head.length).setNumberFormat('@').setValues(out);
    Logger.log(tab + ': righe prima ' + rows.length + ', dopo ' + out.length + ', doppioni fusi ' + merged + ', copia di sicurezza ' + backup.getName());
    return { prima: rows.length, dopo: out.length, fusi: merged, backup: backup.getName() };
  } finally { lock.releaseLock(); }
}

/** Da eseguire dall'editor: ripara db_hub. */
function riparaHub() { return riparaChiave_('db_hub', 'link'); }
