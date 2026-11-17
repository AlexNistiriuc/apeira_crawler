// Rimette i file del crawler in localStorage. Incollare in console sulla scheda del crawler.
// Richiede che i file siano raggiungibili via fetch (per esempio da un clone servito in locale).
const FILES = {
 "worker.js": "apeira_src",
 "boot.js": "apeira_boot",
 "export/startup-export.js": "apeira_exp",
 "export/pool-export.js": "apeira_poolexp",
 "export/hub-export.js": "apeira_hubexp",
 "snowball.js": "apeira_snow",
 "miners/eu-startups.js": "apeira_miner",
 "miners/startbase.js": "apeira_miner_sb",
 "miners/thehub.js": "apeira_miner_hub",
 "miners/sitemap.js": "apeira_miner_sm",
 "miners/hub-of-hubs.js": "apeira_miner_hoh"
};
(async () => {
 for (const [path, key] of Object.entries(FILES)) {
  const r = await fetch(path);
  localStorage.setItem(key, await r.text());
 }
 console.log('ok, ora: eval(localStorage.getItem(\'apeira_boot\')); startCrawler({hl:8,sl:30,rl:6,jl:3})');
})();
