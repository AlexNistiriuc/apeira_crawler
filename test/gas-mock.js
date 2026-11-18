// Esegue apps-script/Code.gs in Node con un finto SpreadsheetApp in memoria,
// così i test provano il vero codice del foglio-database.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? ''); out.push(row); } return out; }
  setValues(v) {
    if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error(`dimensioni errate: range ${this.nr}x${this.nc}, valori ${v.length}x${v[0]?.length}`);
    if (this.r - 1 + this.nr > this.sh.maxRows) throw new Error('oltre maxRows');
    if (this.c - 1 + this.nc > this.sh.maxCols) throw new Error('oltre maxCols');
    v.forEach((row, i) => { const R = this.r - 1 + i; this.sh.cells[R] = this.sh.cells[R] || []; row.forEach((x, j) => { this.sh.cells[R][this.c - 1 + j] = x; }); });
    return this;
  }
  setNumberFormat() { return this; } setFontWeight() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.cells = []; this.maxRows = 1000; this.maxCols = 26; }
  getLastRow() { let n = 0; this.cells.forEach((r, i) => { if (r && r.some(x => x !== '' && x != null)) n = i + 1; }); return n; }
  getLastColumn() { let n = 0; for (const r of this.cells) if (r) r.forEach((x, j) => { if (x !== '' && x != null) n = Math.max(n, j + 1); }); return n; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; } insertColumnsAfter(_, n) { this.maxCols += n; }
  setFrozenRows() {} clearContents() { this.cells = []; }
  hideSheet() { this.hidden = true; return this; } showSheet() { this.hidden = false; return this; }
}

export function loadGas() {
  const sheets = new Map(), props = new Map();
  const ss = { getSheetByName: n => sheets.get(n) || null, insertSheet: n => { const s = new Sheet(n); sheets.set(n, s); return s; }, setActiveSheet: s => { if (s.hidden) throw new Error('attivo nascosto'); ss.active = s; } };
  const ctx = {
    SpreadsheetApp: { getActive: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: { getUuid: () => 'aaaa-bbbb-cccc' },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }) }) }) },
    Logger: { log() {} },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  ctx.setup();
  const token = props.get('API_TOKEN');
  /** backend per src/lib/sheet.js */
  const backend = async (action, payload) => {
    const r = ctx.handle_(JSON.parse(JSON.stringify({ token, action, ...payload })), false);
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(JSON.stringify(r)); // via JSON come la vera web app
  };
  return { ctx, sheets, backend, token, props };
}
