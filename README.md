# Apeira crawler v2

Scouting di startup deep tech europee appena nate per la hackerhouse Apeira.
Il Google Sheet `pool_founder_startup` è il database. Tre pezzi indipendenti lo leggono e lo
scrivono, ognuno solo nelle sue colonne:

```
   crawler hub ──────► db_hub ◄───────── crawler startup ──────► db_candidati
   (fonti nuove)       (pool)             (scopre e controlla)    (evidenze)
                                                                       │
                                                         classificatori (qualsiasi)
                                                                       │
                                                                       ▼
                                    Startup trovate ◄──────  db_valutazioni
                                 (vista per Alex e outreach) (esito, fit, voto)
```

| pezzo | cosa fa | quando gira |
| --- | --- | --- |
| crawler hub | aggiunge pool: semi, reti di incubatori (EBN, UKSPA), snowball dai siti delle startup | GitHub Actions, ogni giorno alle 05:00 |
| crawler startup | legge i pool, trova i siti delle startup, controlla età, funding, settore, team, contatti, salva le evidenze | GitHub Actions, ogni 3 ore |
| classificatore euristico | i criteri rigidi della v1, come base di confronto | GitHub Actions, 08:00 e 18:00 |
| Claude con la skill | la valutazione vera, con verifica delle fonti | 08:30 e 18:30, attività programmata |

Il crawler non dà voti: scarta solo ciò che è certo (round già chiuso, fondata prima del 2025,
azienda grande, investitore, non deep tech, dominio vecchio) e passa tutto il resto ai classificatori
con le evidenze. Così si può cambiare modello di classificazione senza toccare i crawler.

## Struttura

```
config/criteria.json         soglie dei criteri rigidi (unico posto da cambiare)
config/sources.json          semi, reti di incubatori, directory
config/blocked-domains.js    domini che non sono mai startup
contracts/schema.json        colonne e valori ammessi di ogni tab
contracts/CLASSIFICATORI.md  come si attacca un classificatore
apps-script/Code.gs          web app che trasforma il foglio in database (read, upsert, queue, vista)
src/lib/                     rete (diretta + Jina, robots.txt), HTML, foglio, configurazione
src/signals/                 euristiche pure: settori, funding, età, team, evidenze, prefiltro
src/crawlers/hubs/           crawler degli hub
src/crawlers/startups/       crawler delle startup (scoperta, directory, controllo, riga)
src/classifiers/             runner, contratto di uscita, classificatore euristico
skill/                       skill di Claude per valutare due volte al giorno
tools/migrate-from-chrome.js porta nel foglio i dati della v1 rimasti in Chrome
test/                        test senza rete: euristiche, Code.gs su finto Sheets, pipeline completa
```

## Installazione

1. **Foglio.** Nel foglio `pool_founder_startup`: Estensioni > Apps Script, incolla
   `apps-script/Code.gs`, salva, esegui `setup()`. Crea i tab `db_hub`, `db_candidati`,
   `db_valutazioni`, `db_log` (nascosti), prepara `Startup trovate`, nasconde i tab della v1 e scrive il token nel
   log di esecuzione. Poi Esegui il deployment > Nuovo deployment > App web, esegui come te,
   accesso "Chiunque". L'URL che finisce con `/exec` e il token servono a tutto il resto.
2. **Dati della v1.** Nella vecchia scheda Chrome del crawler apri la console e incolla
   `tools/migrate-from-chrome.js`. Porta hub e candidati già controllati.
3. **GitHub.** Nel repo: Settings > Secrets and variables > Actions, aggiungi
   `SHEET_API_URL`, `SHEET_API_TOKEN` e, se ha credito, `JINA_KEY`. Le Actions partono da sole;
   per provarle subito: Actions > crawler hub > Run workflow, poi crawler startup.
4. **Claude.** Carica la skill da `skill/` e programma la valutazione due volte al giorno
   (vedi `skill/skills/apeira-startup-scouting/SKILL.md`).

In locale: `npm ci`, poi `set -a; source .env; set +a` (vedi `.env.example`) e
`npm run hubs`, `npm run startups`, `npm run classify -- euristico`.
`SHEET_DRY_RUN=1` legge dal foglio senza scrivere. `npm test` gira senza rete.

## Regole che il codice rispetta

- LinkedIn non viene mai letto. I link LinkedIn arrivano solo dai siti delle startup.
- Niente captcha né aggiramento di controlli anti-bot. Il crawler rispetta `robots.txt`,
  aspetta tra due richieste allo stesso sito e si presenta come `ApeiraScout/2.0`.
- Le email salvate sono solo quelle pubblicate sui siti; quelle personali (gmail, outlook...) si scartano.
- Il token del foglio e la chiave Jina stanno solo nei secret, mai nel codice.

## Cosa è cambiato dalla v1

La v1 girava in una scheda di Chrome sul Mac, con il codice in localStorage e lo stato in
IndexedDB. La v2 è Node, gira su GitHub Actions e tiene tutto nel foglio. Le euristiche sono le
stesse (portate 1:1 in `src/signals/patterns.js` e `scan.js`), con queste differenze:

- età minima allineata ai criteri rigidi: fondazione dal 2025 (`config/criteria.json`);
- il Fit non lo decide più il crawler ma il classificatore;
- nuovo segnale di domanda reale (clienti, pilot, contratti) ed estratti di testo per i modelli;
- risolto il bug del regex `VCN` con caratteri di controllo al posto di `\b`;
- non portati: il seed da Y Combinator (sono già finanziate) e il miner di startbase.de (resa bassa).
La v1 resta nella storia git (commit `a5e97d6`).
