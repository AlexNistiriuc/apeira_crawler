---
name: "apeira-startup-scouting"
description: "Grade and qualify the startups found by the Apeira crawlers, twice a day, writing the results to the pool_founder_startup sheet, and check that the crawlers are healthy. Use this whenever Alex asks to evaluate, grade, qualify or review startups, run the morning or evening scouting check, look at Startup trovate, add a pool or hub, or asks how the Apeira crawler or scouting is doing, even if he doesn't name the skill."
---

# Apeira startup scouting (v9.2)

Goal: find young European deep-tech startups (founded 2025-2026, before a real pre-seed) for the
Apeira hackerhouse, and rank them so Alex can contact the best ones first.

Since v9 the work is split in three independent parts that only talk through the Google Sheet
`pool_founder_startup` (id `1MY3J2S6xg0ftZziP7lGiVTrtft2UxapE3SYDc_JDolU`, account alex@apeira.it):

- **Crawler hub** (GitHub Actions, daily): keeps the list of pools in `db_hub`.
- **Crawler startup** (GitHub Actions, every hour in runs of ~50 minutes, so almost nonstop): finds candidate sites in the pools, checks age,
  funding, sector, team and contacts, and writes every candidate with its evidence to `db_candidati`.
  It only discards what is certain; everything else is `stato_crawler = da_valutare`.
- **Classifiers** write grades to `db_valutazioni`, one row per startup and classifier.
  `euristico` runs on GitHub right after each crawler startup run. `sage` evaluates the best 30
  candidates at 12:00 and 18:30 Rome and has precedence in the visible view. **Claude is the
  `claude` classifier**: this skill, used for manual source verification and fallback.

The code is in https://github.com/AlexNistiriuc/apeira_crawler (branch `v2-sheet-db` until merged).
Column contract: `contracts/schema.json`. Classifier contract: `contracts/CLASSIFICATORI.md`.
You do not run or babysit the crawlers any more. Don't rebuild them in Chrome.

## Qualification criteria (Alex, 16 Nov 2026)

Qualify a company only when the evidence supports all of these:
- founded in 2025 or 2026;
- no substantial external lab access and no company-owned lab;
- total grants of US$1M or less;
- total outside investment of US$500k or less;
- team of five or fewer;
- every founder under 35, with teams whose founders are all under 30 ranked first.

Also wanted, used for Fit and voto rather than as hard gates: technical founders, real demand
(customers, revenue, an active pilot), a European angle, and one of these sectors: quantum,
compute/chips, biotech, fusion/energy, hardware and materials, physical AI/robotics, space,
foundation models, defence.

Evidence rules:
- Founder age only from credible public statements of age. Never infer it from career history,
  graduation year or photos. Graduation-based estimates in the evidence are hints for where to look.
- Money in its announced currency with an approximate USD value, labelled grant, equity, prize or
  unknown. "Not disclosed" is not zero.
- Lab access is one of: no evidence, shared or third-party, institutional, dedicated company lab,
  substantial established lab.
- Headcount is approximate unless a team page or filing states it. Never derive it from a LinkedIn range.
- Only publicly listed work emails, preferably a founder's. Never guess email patterns or use personal addresses.
- First-party sources first. Mark inferences as inferences.
- Investors, partners and organisations mentioned only as context are not prospects.
- Being in a VC portfolio (Seedcamp, Speedinvest, Antler, EF, HTGF, Quantonation, NATO DIANA...) means they already raised.

Outcomes:
- `Esclusa` when the evidence shows a threshold is exceeded.
- `Needs verification` when funding, lab access, team size or founder age is unknown or ambiguous.
  Never `Qualificata` by assumption. Most rows land here, mostly because founder age is rarely public.
- When sources contradict each other, say so in `motivo` and do not qualify.

## Connecting to the sheet

All reads and writes go through the sheet's web app (`apps-script/Code.gs`). Use Alex's Chrome via
Claude in Chrome, in the tab on https://example.com/ (the old crawler tab is fine). Alex stores the
web app URL and token there once, himself:
`localStorage.setItem('apeira_sheet_api', JSON.stringify({url:'.../exec', token:'...'}))`.
Never print the token, never type it into a page, never put it in a message.

Helper to define with javascript_tool at the start of each run:

```js
window.api = async (action, p = {}) => {
  const A = JSON.parse(localStorage.getItem('apeira_sheet_api'));
  const r = await fetch(A.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: A.token, action, ...p }) });
  return r.json();
};
'ok'
```

If `apeira_sheet_api` is missing, stop and ask Alex to set it. If Chrome is not reachable (Mac
asleep), say so in one line and stop: don't try other routes to the token.

Keep javascript_tool results small (the tool times out at ~45 s and long outputs waste budget):
map rows to the fields you need and trim text before returning it.

## Manual Claude evaluation

Budget: about 30 candidates per run. Use this flow when Alex explicitly asks for a manual review
or when the Sage classifier is unavailable.

1. **Crawler health.** Read the last rows of `db_log`:
   `(await api('read',{tab:'db_log'})).rows.slice(-8)`. Check that `crawler startup` ran in the last
   ~2 hours and `crawler hub` in the last ~26 hours, and look at the counts in `statistiche`
   (`da_valutare`, `scartati`, `rimandati`, `http.robotsBlocked`, `http.jina429`). Flag runs that
   failed, stopped running, or produced zero new candidates twice in a row. The repo is private on the free
   GitHub plan (about 2,000 Actions minutes a month): if runs stop with a billing or quota error, the minutes are
   used up. Tell Alex; don't try to work around it. Don't fix code from
   here; describe the problem to Alex.

2. **Get the queue**, ranked by the heuristic grade so the most promising come first:
   ```js
   const q = (await api('queue',{classifier:'claude',limit:30,rank_by:'euristico'})).rows;
   q.map(c => { const e = JSON.parse(c.evidenze || '{}'); return { d: c.dominio, n: c.nome, s: c.sito,
     hub: c.hub_origine, reg: c.dominio_registrato, wb: c.primo_archivio, anni: c.anni_sul_sito,
     fund: c.segnali_funding, team: c.team_stima, em: c.email, fn: c.founder_nomi, li: c.linkedin_persone,
     dem: c.domanda_reale, pre: [c.pre_esito, c.pre_fit, c.pre_voto, c.pre_motivo],
     ev: { fa: e.fa, ts: e.ts, evd: e.evd, eu: e.eu, tags: e.tags },
     home: (e.estratto_home || '').slice(0, 1200), teamtxt: (e.estratto_team || '').slice(0, 800) }; })
   ```
   If the result is too long, fetch it in slices of 10.

3. **Evaluate each candidate.** Start from the evidence; it was read from the startup's own pages
   (`pagine_lette`). Then verify what decides the outcome, cheapest first:
   - founding year, funding, team and founder ages from the startup's site and its pool's page;
   - one `web_search` for `"<name>" founders` or `"<name>" funding` when funding or age is the open
     question, and `web_fetch` on first-party or press results;
   - LinkedIn only as it appears in search result titles or on the startup's site. Never open
     linkedin.com pages.
   - If `evidenze.sito.pagine` is 0, read `evidenze.sito.motivo_zero` (one-page site, JavaScript, unreadable pages) and
     say in `da_verificare` that the site could not be read in full.
   - Startups whose `hub_origine` starts with "registro" come from company registries (Norway, UK): founding date and
     every director's age are already verified in `registro` and `eta_verificate`; what is left is the deep-tech proof.
   Spend effort where it changes the outcome: a candidate that is clearly `Esclusa` from the
   evidence needs no search. If budget runs out, write what you have as `Needs verification`.

4. **Write the grades**, all in one call, with `stage` (since 23 Nov 2026): rows go to `db_appoggio` without the
   crawlers' lock, so writes no longer fail with "Timeout di blocco"; step 5 merges them. If `stage` answers
   "azione sconosciuta", the sheet still runs the old Apps Script: use `upsert` and retry on lock timeouts.
   ```js
   await api('stage', { tab: 'db_valutazioni', key: 'id', rows: [ {
     id: 'qubo.ai|claude', dominio: 'qubo.ai', classificatore: 'claude', versione: 'skill-v9',
     valutato_il: '2026-11-18 08:40:00',
     esito: 'Needs verification', fit: 'Medio', voto: 62,
     motivo: 'quantum, fondata 2025, pilot con un operatore telecom; età dei founder non pubblica',
     fondazione: '2025 (dichiarato su qubo.ai/about)', grant: 'Not disclosed', investimenti: 'Not disclosed',
     accesso_lab: 'shared or third-party: TU Delft cleanroom', team: '3 (dichiarato sul sito)',
     eta_founder: 'non verificata', under30: 'no', domanda_reale: 'pilot con operatore telecom europeo',
     da_verificare: 'età verificata di ogni founder, investimenti', fonti: 'https://qubo.ai/about, https://...' } ] })
   ```
   Field meanings and allowed values are in `contracts/CLASSIFICATORI.md`. In short:
   - `esito`: `Qualificata` / `Needs verification` / `Esclusa`.
   - `fit`: `Alto` / `Medio` / `Basso`, with the strict rule (since 23 Nov 2026, `src/classifiers/strict.js`).
     `Alto` only when all five are proven by a source, not inferred: founded 2025 or 2026 (registry or year
     stated on the site, a domain date is not enough), or, if not yet incorporated, the founders have worked on it
     for at most 3 years, proven by a source such as a LinkedIn profile checked by a person (write `fondazione` as
     "non costituita, ci lavorano dal 2024 (fonte)"); age of EVERY founder verified (registry birth date or an
     explicit source naming the person) and under 35; deep-tech sector proven (site, grant or registry
     description); European angle; no hard criterion violated. `Medio` when nothing is violated but founding,
     age or sector is unverified. `Basso` when a criterion is violated or off-target; `Esclusa` is always `Basso`.
     A registry-only company without a site stays `Medio` with motivo "CANDIDATO ALTO DA REGISTRO".
   - `voto` 0-100. Calibrate as follows: 85+ qualified with strong demand and a strict Alto; 70-84 strict Alto still to verify; 50-69 Medio;
     30-49 weak fit; under 30 excluded or off-target.
   - `under30`: `sì` only when every founder's age under 30 is publicly stated.
   - Never write `nota_alex`.
   The sheet rejects invalid rows. If it answers `ok:false`, fix the row and retry.

5. **Merge and refresh the view**: `await api('views')`. It first merges `db_appoggio` into the real tabs (rows it
   rejects stay there with the reason in `errore`: check `(await api('read',{tab:'db_appoggio'})).rows`), then rebuilds the `Startup trovate` tab, the only visible one, which the apeira-outreach skill reads (its first 17 columns are the v1 ones; Stato is "Target" only for Qualificata). Classifier precedence is
   `sage`, then `claude`, then `euristico`.

6. **Update Alex in Italian**, short, no em dashes and no colons in prose. Cover:
   - how many you graded and how they split;
   - the 3 best new ones with the reason, plus founder email if public;
   - crawler health in one line;
   - anything that needs him, for example a Jina key without credit or a pool that keeps failing.

## Other tasks

- **Add a pool by hand.** Upsert a row in `db_hub` with these fields:
  - `hub_id`: host plus path, lowercase, no `www.`, no trailing slash;
  - `nome`, `url`;
  - `origine: 'manuale'`, `stato: 'attivo'`, `priorita: '20'`.

  The crawler startup reads it in its next run. Prefer pre-seed sources: university incubators and
  spin-off lists, student competitions, grants (EXIST, Venture Kick, ETH Pioneer), fellowships,
  demo days. Avoid VC portfolios.
- **Pause a pool**: set its `stato` to `in_pausa`.
- **Change thresholds**: edit `config/criteria.json` in the repo and the criteria section above.
  Both must agree.
- **A new classifier** (another model or script): see `contracts/CLASSIFICATORI.md`. To let it win
  over Claude in the view, change the script property `PRECEDENZA` in Apps Script.
- **Alex asks how it is going**: read `db_log` and count `db_valutazioni` by `classificatore` and `esito`.
  The components in `db_log` are `crawler startup`, `crawler hub`, `scoperta hub`, `scoperta da registro`,
  `crawler founder` and the classifiers. ScrapeGraph credits left are in `statistiche.crediti_scrapegraph_rimasti`;
  credits go to discovery searches, one funding search per Medio/Alto startup and, for registry discovery, one
  search to find the site of a young company that has none in the registry.
- **Stop everything**: disable the crawler workflows on GitHub, or set the repository variable `SCOUTING_ATTIVO` to `no`.

## Rules

- Never browse or scrape LinkedIn. Never bypass captchas or anti-bot checks.
- Never print or retype the sheet token or the Jina key.
- Don't delete rows from `db_*` tabs. To discard, use `stato` (hubs) or a grade (startups).
- Write to Alex in Italian, concise.
