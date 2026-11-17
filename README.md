# Apeira crawler

Crawler di scouting per startup deep tech europee appena nate. Gira interamente dentro Chrome
sul Mac, in una scheda aperta su una pagina vuota, e scrive i risultati nel foglio
"Startup trovate".

## Cosa cerca

- fondata nel 2025 o 2026
- nessun lab proprio e nessun accesso esterno sostanziale a un lab
- grant fino a 1M USD, investimenti esterni fino a 500k USD
- team di 5 persone o meno
- tutti i founder sotto i 35 anni, prima quelli sotto i 30
- settori: quantum, chip e compute, biotech, fusione ed energia, robotica e physical AI,
  spazio, difesa, modelli foundation, materiali e hardware
- angolo europeo

Chi supera una soglia viene escluso. Chi ha dati mancanti finisce in "Needs verification",
mai qualificato per supposizione. "Not disclosed" non vale zero.

## Pezzi

| file | cosa fa |
| --- | --- |
| `src/worker.js` | il crawler. Gira in un Web Worker. Code di hub, siti, età dominio, archive.org, founder, team, evidenze |
| `src/boot.js` | avvio, ponte verso l'estensione, watchdog, riavvio automatico dei miner |
| `src/miners/sitemap.js` | legge le sitemap degli hub e ne estrae i siti delle singole startup |
| `src/miners/hub-of-hubs.js` | da una rete di incubatori (EBN, UKSPA) ricava i singoli incubatori come nuovi hub |
| `src/miners/eu-startups.js` | directory EU-Startups, filtrata su anno di fondazione |
| `src/miners/thehub.js` | directory nordica thehub.io, filtra anche sul funding |
| `src/miners/startbase.js` | directory tedesca startbase.de |
| `src/snowball.js` | dai siti delle startup trovate estrae nuovi incubatori e programmi |
| `src/export/startup-export.js` | tabella finale con grading e criteri rigidi, da incollare nel foglio |
| `src/export/pool-export.js` | rigenera il tab dei pool |
| `src/export/hub-export.js` | rigenera il tab degli hub |
| `extension/` | estensione Chrome che legge le pagine (senza cookie) aggirando il limite CORS |
| `history.json` | storico delle misurazioni |

## Come si avvia

1. Carica `extension/` da `chrome://extensions` con "Load unpacked".
2. Apri una scheda su una pagina vuota e incolla in console `src/install.js`, che rimette
   tutti i file in localStorage.
3. Poi:

```js
eval(localStorage.getItem('apeira_boot'));
startCrawler({ hl: 8, sl: 30, rl: 6, jl: 3 });
```

Deve rispondere `proxy ON`. Se risponde `proxy OFF` ricarica la scheda.
`hl` sono i loop sugli hub, `sl` i loop sui siti in lettura diretta, `rl` i loop sull'età
del dominio, `jl` i loop su Jina.

## Note

- Lo stato (candidati, stati, contatti) vive in IndexedDB `apeira_crawler`, non in questo repo.
- La lista degli hub vive in localStorage `apeira_hubs` e non è inclusa.
- La chiave Jina non è inclusa. Senza chiave Jina va a circa una richiesta ogni 3 secondi.
- LinkedIn non viene mai letto dal crawler.
- Bug noto: in `src/miners/sitemap.js` il regex `VCN` contiene due caratteri di controllo
  al posto di `\b`, quindi non matcha "vc" come parola isolata.
