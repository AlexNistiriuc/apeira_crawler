// Prova che il foglio abbia lo script nuovo (azione merge della scheda di appoggio). Non scrive righe.
import { merge } from '../src/lib/sheet.js';
try { console.log('PROVA merge', JSON.stringify(await merge())); } catch (e) { console.log('PROVA errore', e.message); }
