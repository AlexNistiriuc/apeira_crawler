# Apeira crawler v2

Scouting di startup deep tech europee appena nate per la hackerhouse Apeira.
Il Google Sheet `pool_founder_startup` è il database. Più pezzi indipendenti lo leggono e lo
scrivono, ognuno solo nelle sue colonne:

```
   crawler hub ──────► db_hub ◄───────── crawler startup ──────► db_candidati
   (fonti nuove)       (pool)             (scopre e controlla)    (evidenze)
                                                    │                    │
                                                    ▼                    │
                                         crawler LinkedIn ───────────────┤
                                      (dipendenti, founder, età)         │
                                                                         │
                                                         classificatori (qualsiasi)
                                                         (ricevono c.li dalla black box)
                                                                         │
                                                                         ▼
                                    Startup trovate ◄──────  db_valutazioni
                                 (vista per Alex e outreach) (esito, fit, voto)
```

| pezzo | cosa fa | quando gira |
| --- | --- | --- |
| crawler hub | aggiunge pool: semi, reti di incubatori (EBN, UKSPA), snowball dai siti delle startup; poi scoperta con ricerche web e scoperta da registro | GitHub Actions, a catena |
| scoperta da registro | società costituite dal 2025 con attività deep tech e almeno un amministratore sotto 35 anni (Norvegia per codice NACE, Regno Unito per codice SIC, Francia per parole dell'attività nel BODACC, Lettonia per nome dall'open data una volta al giorno): entrano in coda con età verificate. Finlandia (PRH) per codice di attività e Belgio (open data KBO, con account: secret KBO_USER e KBO_PASSWORD, una volta al mese), senza età: entrano solo con il sito scritto nel registro. Gli hub fuori Europa (Stati Uniti, Canada, Asia...) non si aggiungono e non si leggono. Gli altri paesi europei non hanno un registro aperto con data di nascita o ricerca per data: vedi `_nota_altri_paesi` in `config/registri.json` | nel giro del crawler hub |
| crawler startup | legge i pool, trova i siti delle startup, controlla età, funding, settore, team, contatti, salva le evidenze | GitHub Actions, a catena senza sosta (giri da ~45 minuti) |
| crawler LinkedIn | per le startup Alto/Medio chiama ScrapeGraph (in pausa se `config/crediti.json` ha `pausa: true`) e ricava dipendenti, anno di fondazione, data di inizio dei founder ed età stimata dalla prima esperienza educativa; scrive `linkedin_dati`, `linkedin_fonti`, `linkedin_il` (le colonne del crawler founder restano separate) | dentro ogni classificazione (black box `ensureLinkedin`) e con `npm run linkedin` / workflow `crawler LinkedIn` |
| classificatore euristico | i criteri rigidi della v1, come base di confronto | subito dopo ogni giro del crawler startup |
| classificatore Sage | decide esito, fit e voto dopo l'euristico; completo (ricerca web + reasoning) per Fit Alto/Medio, leggero per Fit Basso | GitHub Actions, dopo ogni giro del crawler e a catena finché la coda non è vuota |
| Claude con la skill | verifica manuale delle fonti e fallback | su richiesta |

Il crawler non dà voti: scarta solo ciò che è certo (round già chiuso, fondata prima del 2025,
azienda grande, investitore, non deep tech, dominio vecchio) e passa tutto il resto ai classificatori
con le evidenze. Così si può cambiare modello di classificazione senza toccare i crawler.

In **Startup trovate** entrano le startup valutate da uno dei valutatori elencati nella proprietà di script
`VISTA_RICHIEDE` (es. `sage,claude`: basta uno dei due). Se dopo la valutazione l'euristico le esclude per fatti
nuovi (registro imprese, età verificate, notizie di round), escono subito.

**Crawler founder** (`npm run founders`, dopo l'euristico): per le startup Medio e Alto raccoglie una volta sola
registro imprese (Francia, Norvegia e Repubblica Ceca gratis; Regno Unito con il secret `COMPANIES_HOUSE_KEY`,
chiave gratuita di Companies House) e una ricerca ScrapeGraph su round e founder. Dal 23 novembre 2026 niente
ricerche per persona (rendevano 1 età su 21 ricerche; `RICERCHE_PERSONA=1` le riaccende): l'età si prende dai registri. Le età da registro o dichiarate con nome e cognome sono verificate e possono
escludere (35 anni o più); le stime ordinano soltanto. Le notizie salvate le riusano Sage e Claude senza nuove ricerche.
Portfolio VC: nota e penalità, non esclusione.

**Fermare tutto lo scouting:** Settings > Secrets and variables > Actions > Variables, crea la variabile
`SCOUTING_ATTIVO` con valore `no`. I giri in corso finiscono, i successivi non partono. Per ripartire cancellala.

I consumi di Sage di ogni giro sono in `db_log` (statistiche.consumo: chiamate, token, ricerche web, giri completi e leggeri).

## Ottimizzazioni del 23 novembre 2026

Dopo una notte in cui l'87% dei crediti ScrapeGraph era andato alla scoperta di hub, con pochi risultati:
- scoperta: niente più query di livello 3 (settore + tipo + città + anno; `livello_massimo` in `config/discovery.json`);
  gli hub fuori tema (SEO, marketing, agenzie, software house, eventi d'altro tipo) o che non parlano di startup non si
  aggiungono, e quelli già nel foglio passano a `senza_resa` senza leggerli (`HUB_OFFTOPIC` in `src/signals/patterns.js`);
- prefiltro: scuole estive, centri e gruppi di ricerca, progetti con work package e consorzi, siti personali si
  scartano come "non è una startup" (`NOSTART`, `NOSTART_DOM`);
- crawler founder: una ricerca per startup, niente ricerche per persona;
- registri con data di nascita: Norvegia (Brønnøysund) e Repubblica Ceca (ARES) oltre a Francia e Regno Unito, e la
  scoperta da registro (`npm run registri`, `config/registri.json`). Ogni società letta si segna in `db_scoperta`
  (tipo `registro`) per non rileggerla né ripagare la ricerca del suo sito. Prova delle API: workflow "prova registri";
- lettura del sito: sitemap per i siti in JavaScript o senza link nel testo, la lingua del sito non si salta più, si
  seguono i redirect a un altro dominio; se le pagine lette sono zero, `evidenze.sito.motivo_zero` dice perché;
- scritture di agenti e Claude: azione `stage` in `db_appoggio`, senza il lock dei crawler; `merge`, `views` e la vista
  oraria le portano nei tab veri. Richiede il nuovo `apps-script/Code.gs` e `apps-script/Appoggio.gs`
  incollati e ridistribuiti.
- criterio severo per il fit Alto (vedi `contracts/CLASSIFICATORI.md`).

## Struttura

```
config/criteria.json         soglie dei criteri rigidi (unico posto da cambiare)
config/sources.json          semi, reti di incubatori, directory
config/blocked-domains.js    domini che non sono mai startup
contracts/schema.json        colonne e valori ammessi di ogni tab
contracts/CLASSIFICATORI.md  come si attacca un classificatore
apps-script/Code.gs          web app che trasforma il foglio in database (read, upsert, queue, stage, merge, vista)
apps-script/Appoggio.gs      scheda di appoggio per gli stage di agenti e Claude (usata da Code.gs)
src/lib/                     rete (diretta + Jina, robots.txt), HTML, foglio, configurazione
src/lib/search.js            ricerca web (ScrapeGraph v2 o Brave) e ricerca strutturata per il crawler LinkedIn
src/signals/                 euristiche pure: settori, funding, età, team, evidenze, prefiltro
src/signals/facts.js         nomi founder, età verificate, notizie di funding (condivisi)
src/signals/age.linkedin.js  età dalla prima esperienza educativa e anzianità in azienda
src/crawlers/hubs/           crawler degli hub
src/crawlers/startups/       crawler delle startup (scoperta, directory, controllo, riga)
src/crawlers/linkedin/       crawler LinkedIn (black box `ensureLinkedin` per gli evaluator)
src/crawlers/registri/       scoperta da registro (Norvegia, Regno Unito con la chiave)
config/registri.json         codici di attività e limiti della scoperta da registro
src/classifiers/             runner, contratto di uscita, classificatori euristico e Sage
skill/                       skill di Claude per verifiche manuali e controllo salute
tools/migrate-from-chrome.js porta nel foglio i dati della v1 rimasti in Chrome
tools/export-recenti.js      esporta in sola lettura le startup da valutare recenti (workflow "esporta startup recenti")
tools/prova-registri.js      prova in sola lettura le API dei registri (workflow "prova registri")
test/                        test senza rete: euristiche, Code.gs su finto Sheets, pipeline completa
```

## Installazione

1. **Foglio.** Nel foglio `pool_founder_startup`: Estensioni > Apps Script, incolla
   `apps-script/Code.gs` e `apps-script/Appoggio.gs` (due file dello stesso progetto), salva, esegui
   `setup()`. Crea i tab `db_hub`, `db_candidati`,
   `db_valutazioni`, `db_log` (nascosti), prepara `Startup trovate`, nasconde i tab della v1 e scrive il token nel
   log di esecuzione. Poi Esegui il deployment > Nuovo deployment > App web, esegui come te,
   accesso "Chiunque". L'URL che finisce con `/exec` e il token servono a tutto il resto.
2. **Dati della v1.** Nella vecchia scheda Chrome del crawler apri la console e incolla
   `tools/migrate-from-chrome.js`. Porta hub e candidati già controllati.
3. **GitHub.** Nel repo: Settings > Secrets and variables > Actions, aggiungi
   `SHEET_API_URL`, `SHEET_API_TOKEN`, `SAGE_API_KEY`, `SCRAPEGRAPH_API_KEY` e, se ha credito,
   `JINA_KEY` e `SEARCH_API_KEY`. Le Actions partono da sole; per provarle subito:
   Actions > crawler hub > Run workflow, poi crawler startup e crawler LinkedIn.
4. **Claude.** Carica la skill da `skill/` per le verifiche manuali e il controllo della salute
   (vedi `skill/skills/apeira-startup-scouting/SKILL.md`).

In locale: `npm ci`, poi `set -a; source .env; set +a` (vedi `.env.example`) e
`npm run hubs`, `npm run startups`, `npm run classify -- euristico`, `npm run linkedin`,
`npm run founders`.

Per la valutazione Sage imposta `SAGE_API_KEY` e lancia
`npm run classify -- sage 30`. Sage valuta prima i candidati con voto euristico più alto;
usa reasoning e web grounding per tutte e tre le decisioni e conserva in `fonti` gli URL trovati.
La chiave va conservata solo nell'ambiente locale o nei GitHub Actions secrets.
`SAGE_REASONING` e `SAGE_GROUNDING_TRIGGER` permettono di cambiare i default `on` e `always`.
`SHEET_DRY_RUN=1` legge dal foglio senza scrivere. `npm test` gira senza rete.

## LinkedIn via ScrapeGraph (crawler dedicato e black box)

Le startup con Fit **Alto** o **Medio** vengono arricchite con un crawler LinkedIn dedicato. È una
black box: gli evaluator non chiamano ScrapeGraph direttamente, chiamano `ensureLinkedin(c)` e
ricevono sempre lo stesso oggetto.

```js
import { ensureLinkedin } from '../crawlers/linkedin/index.js';

const li = await ensureLinkedin(c);
// li = {
//   disponibile: true,
//   fonte: 'scrapegraph' | 'cache',
//   dipendenti: '11-50',
//   fondata: 2025,
//   founders: [{ nome, ruolo, linkedin, da: '2025-03', da_anno: 2025,
//                eta: 24, fascia: 'sotto 30', education: {...} }],
//   testo: '[SG] Dipendenti: 11-50 | Fondata: 2025 | Founder: ...',
//   fonti: ['https://...']
// }
```

Il runner dei classificatori (`src/classifiers/run.js`) la chiama **prima di ogni `classify`** e
mette il risultato in `c.li`: nessun evaluator può saltarla. Euristico e Sage leggono `c.li`; i
dati sono salvati in `linkedin_dati`/`linkedin_fonti`/`linkedin_il`, senza toccare `eta_stimata`,
`fonti_eta` e `eta_il` del crawler founder.

- Fonte: ScrapeGraph v2 `search` con prompt e schema JSON (ricerca web + estrazione in una
  chiamata), mai login o scraping diretto di linkedin.com. I dati LinkedIn restano indizi, non
  prove per le soglie rigide.
- Cosa estrae: numero di dipendenti e anno di fondazione dall'azienda; per ogni founder la data di
  inizio in azienda e la **prima esperienza educativa**. L'età è `anno corrente - inizio studi + 18`
  (oppure `anno di fine + 22/24/28` a seconda del titolo).
- Cache: `linkedin_il` recente + `linkedin_dati` che inizia con `[SG]` (default 30 giorni,
  `SCRAPEGRAPH_CACHE_DAYS`). Le colonne sono dedicate, quindi il crawler founder continua a usare
  `eta_stimata`/`fonti_eta`/`eta_il` per le sue stime e i suoi fatti.
- Tetti: `SEARCH_MAX_PER_RUN` (chiamate per processo, default 400; il workflow LinkedIn lo abbassa),
  `SCRAPEGRAPH_MAX_STARTUPS` (startup per giro, default 40),
  `SCRAPEGRAPH_MAX_FOUNDERS` (profili per startup, default 3), `SCRAPEGRAPH_RESULTS`
  (risultati per ricerca, default 5).
- Omonimi: il profilo del founder entra solo se cognome e azienda tornano; un profilo di un'altra
  persona non viene conteggiato.
- Fallback: il crawler LinkedIn non ripiega su Brave; se ScrapeGraph manca o non trova nulla,
  `c.li.disponibile` è `false` e `npm run founders` continua a usare la sua stima Brave + regole.
- Comandi: `npm run linkedin -- [quante]` (crawler autonomo) e workflow `crawler LinkedIn`
  (ogni 3 ore, spegnibile con la variabile `SCRAPEGRAPH_ATTIVO = no`).

## Regole che il codice rispetta

- LinkedIn non viene mai aperto con login o scraping diretto. I dati arrivano da ScrapeGraph
  (risultati di ricerca pubblici) e dai link pubblicati sui siti delle startup.
- Niente captcha né aggiramento di controlli anti-bot. Il crawler rispetta `robots.txt`,
  aspetta tra due richieste allo stesso sito e si presenta come `ApeiraScout/2.0`.
- Le email salvate sono solo quelle pubblicate sui siti; quelle personali (gmail, outlook...) si scartano.
- Il token del foglio, la chiave Jina e la chiave ScrapeGraph stanno solo nei secret, mai nel codice.

## Cosa è cambiato dalla v1

La v1 girava in una scheda di Chrome sul Mac, con il codice in localStorage e lo stato in
IndexedDB. La v2 è Node, gira su GitHub Actions e tiene tutto nel foglio. Le euristiche sono le
stesse (portate 1:1 in `src/signals/patterns.js` e `scan.js`), con queste differenze:

- età minima allineata ai criteri rigidi: fondazione dal 2025 (`config/criteria.json`);
- il Fit non lo decide più il crawler ma il classificatore, con il criterio severo dal 23 novembre 2026
  (Alto solo con fondazione, almeno un founder sotto 35 con età verificata, settore e angolo europeo provati; vedi
  `contracts/CLASSIFICATORI.md` e `src/classifiers/strict.js`);
- nuovo segnale di domanda reale (clienti, pilot, contratti) ed estratti di testo per i modelli;
- risolto il bug del regex `VCN` con caratteri di controllo al posto di `\b`;
- non portati: il seed da Y Combinator (sono già finanziate) e il miner di startbase.de (resa bassa).
La v1 resta nella storia git (commit `a5e97d6`).
