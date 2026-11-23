# Come si attacca un classificatore

Un classificatore legge i candidati che il crawler ha messo in `db_candidati` con
`stato_crawler = da_valutare` e scrive una riga per candidato in `db_valutazioni`.
Non tocca nient'altro. Possono convivere più classificatori: ognuno ha il suo nome e le sue righe.

## Ingresso

La coda la dà il foglio: azione `queue` con `classifier=<nome>`. Contiene i candidati
`da_valutare` che quel classificatore non ha ancora valutato, o che il crawler ha ricontrollato
dopo l'ultima valutazione. Ogni riga ha tutte le colonne di `db_candidati`. Le più utili:

| colonna | cosa contiene |
| --- | --- |
| `sito`, `nome`, `descrizione` | identità |
| `hub_origine` | da quali pool arriva (incubatori, programmi, directory) |
| `dominio_registrato`, `primo_archivio`, `anni_sul_sito` | età |
| `segnali_funding` | frasi su round e importi trovate sul sito |
| `email`, `linkedin_azienda`, `linkedin_persone`, `founder_nomi` | contatti pubblici |
| `team_stima`, `domanda_reale` | indizi già leggibili |
| `eta_stimata`, `fonti_eta`, `eta_il` | arricchimento LinkedIn (dipendenti, fondazione, founder, età dalla prima esperienza educativa) |
| `evidenze` | JSON con tutto il resto (sotto) |
| `pagine_lette` | URL delle pagine lette dal crawler, per verificare |

### LinkedIn obbligatorio: `c.li`

Il runner chiama `ensureLinkedin(c)` prima di ogni `classify` e mette il risultato in `c.li`.
È una black box: l'evaluator non chiama ScrapeGraph e non deve occuparsi della cache. Oggetto:

```js
c.li = {
  disponibile: true,
  fonte: 'scrapegraph' | 'cache',
  dipendenti: '11-50',
  fondata: 2025,
  founders: [{ nome, ruolo, linkedin, da: '2025-03', da_anno: 2025,
               eta: 24, fascia: 'sotto 30', education: {...} }],
  testo: '[SG] Dipendenti: 11-50 | Fondata: 2025 | Founder: ...',
  fonti: ['https://...'],
}
```

Se il Fit euristico è `Basso`, `c.li.disponibile` è `false` con `motivo: 'fit Basso'`: i dati
LinkedIn si pagano solo per Alto/Medio. Se manca la chiave o non si trova nulla, `disponibile` è
`false` e l'evaluator va avanti con le altre evidenze. `fatal: true` (chiave non valida, credito
finito) e `tetto: true` (limite per giro) dicono di non insistere. La regola resta: dipendenti e
età stimata dalla prima esperienza educativa sono **indizi**, non prove per le soglie rigide.

`evidenze` (JSON, versione 2):

```
deep, strong, neg, ok_deep, tags     punteggio deep tech e settori
anni_dichiarati, cmin                anni di fondazione dichiarati, primo anno del ©
eu                                   il sito cita un luogo europeo
fund {l, x}                          l: 0 niente, 1 pre-seed o <1M, 2 seed o 1M+, 3 Series; x: frasi
fa {y, s, g, a, ev}                  età founder: segnali giovani/senior, anni di laurea, età dichiarate, frasi
ts {e, li, r}                        team: dichiarato, profili LinkedIn sulla pagina team, ruoli
evd {g, i, lc, lx, fy}               importi vicino a grant (g) o investimenti (i) con contesto, lab proprio (lc), lab condiviso (lx), anni di fondazione
dem                                  frasi su clienti, pilot, contratti, ricavi
estratto_home, estratto_team         testo pulito delle pagine (circa 2500 e 1500 caratteri)
```

Le righe migrate dalla v1 hanno `evidenze.v = 1` e niente `dem` né `estratto_team`.

## Uscita

Una riga in `db_valutazioni`, chiave `id = dominio|classificatore`. Obbligatori:
`id, dominio, classificatore, versione, valutato_il, esito, fit, voto, motivo`.

| colonna | valori |
| --- | --- |
| `esito` | `Qualificata`, `Needs verification`, `Esclusa` |
| `fit` | `Alto`, `Medio`, `Basso` |
| `voto` | 0-100 |
| `motivo` | perché, in una frase |
| `fondazione`, `grant`, `investimenti`, `accesso_lab`, `team`, `eta_founder` | evidenza per ciascun criterio, con la fonte |
| `under30` | `sì` solo se l'età di tutti i founder è dichiarata pubblicamente e sotto 30 |
| `domanda_reale` | clienti, pilot, ricavi trovati |
| `da_verificare` | cosa manca per qualificarla |
| `fonti` | URL usati |

`nota_alex` è di Alex: i classificatori non la scrivono.

Le regole sono in `config/criteria.json` e nella skill. In breve: si esclude solo quando
l'evidenza mostra una soglia superata; se manca un dato si mette `Needs verification`, mai
`Qualificata` per supposizione; "Not disclosed" non vale zero.

Il foglio rifiuta righe con esito, fit, voto o id non validi, quindi un classificatore che
sbaglia formato non sporca i dati.

## Tre modi di attaccarne uno

1. **Codice nel repo.** Un file in `src/classifiers/<nome>.js` che esporta
   `{ name, version, async classify(candidato) }` e restituisce i campi di uscita (il runner
   aggiunge id, dominio, classificatore, versione, data). Si lancia con
   `npm run classify -- <nome>`. Esempio: `src/classifiers/euristico.js`.
2. **Claude con la skill.** Su richiesta Claude legge la coda `claude`, verifica le fonti e scrive
   righe con `classificatore = claude`. Serve come revisione manuale o fallback. Vedi `skill/`.
3. **Sage.** `src/classifiers/sage.js` invia esito, fit e voto al decision model Levanto Sage
   in due passaggi: una ricerca grounded corta sull'identità della società, filtrata sul dominio
   ufficiale, poi una richiesta batch con reasoning attivo che usa gli snippet trovati per esito,
   fit e voto. Gli URL pertinenti vengono aggiunti a `fonti`. Legge la chiave da `SAGE_API_KEY` e
   usa l'euristico come guardrail per non qualificare quando un criterio rigido manca o è già
   violato. Sage riceve anche `c.li` (crawler LinkedIn): dipendenti, anno di fondazione, data di
   inizio dei founder ed età stimata dalla prima esperienza educativa. Questi dati sono indizi,
   non prove; storia lavorativa e range di headcount non verificano età o dimensione esatta del team.
4. **Qualsiasi altro programma** (un altro modello, uno script, una persona con un form):
   chiama la web app con `queue` e `upsert` come descritto in `apps-script/Code.gs`.

La vista `Startup trovate` sceglie per ogni startup la valutazione del classificatore con più
precedenza (proprietà di script `PRECEDENZA`, oggi `sage,claude,euristico`).
