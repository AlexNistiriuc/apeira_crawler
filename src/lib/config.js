import { readFileSync } from 'node:fs';
const load = p => JSON.parse(readFileSync(new URL('../../config/' + p, import.meta.url), 'utf8'));
export const CRITERIA = load('criteria.json');
export const SOURCES = load('sources.json');
export const VERSION = '2.0.0';
/** Minuti di lavoro per run (le Action hanno un limite, meglio fermarsi prima e salvare). */
export const RUN_MINUTES = Number(process.env.RUN_MINUTES || 50);
export const deadlineFromNow = () => Date.now() + RUN_MINUTES * 60_000;
export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
