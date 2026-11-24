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
| `linkedin_dati`, `linkedin_fonti`, `linkedin_il` | arricchimento LinkedIn (dipendenti, fondazione, founder, età dalla prima esperienza educativa); colonne dedicate, non sovrascrivono quelle del crawler founder |
| `evidenze` | JSON con tutto il resto (sotto) |
| `pagine_lette` | URL delle pagine lette dal crawler, per verificare |
| `eta_stimata`, `fonti_eta` | stima d'età di CEO e CTO (crawler founder): ordina, non esclude |
| `eta_verificate` | JSON `[{nome, ruolo, min, max, fonte, url}]`: età da registro imprese (FR, UK, NO, CZ) o dichiarata in una fonte con nome e cognome. Conta come verificata. Le startup arrivate dalla scoperta da registro (`hub_origine` "registro NO/UK/FR/LV/FI codice ..."; per FI l'età non c'è) le hanno già tutte |
| `registro` | JSON dal registro imprese (FR, UK, NO, CZ): `costituita`, `aumenti_capitale` (SH01 UK), `persone` con età, `url` |
| `notizie_funding` | JSON `[{title, url, snippet}]`: una ricerca Brave del crawler founder, da riusare senza ripagarla |
| `fatti_il` | data in cui il crawler founder ha raccolto questi fatti |
| `round_notizie` | riassunto dei round e grant trovati nelle notizie (es. "EUR 3.5M (aventure.vc) · pre-seed"); lo mostra la vista |

### Criterio per il fit (severo, dal 23 novembre 2026)

Viene dal report della notte degli agenti di Tommaso. Le 46 startup Alto che il foglio aveva prima,
ricontrollate con questa regola, sono scese a 2. L'età dei founder è il filtro che decide.

| fit | regola |
| --- | --- |
| `Alto` | tutte e cinque le condizioni provate da una fonte, non dedotte. 1) fondazione 2025 o 2026 verificata (registro imprese o anno dichiarato sul sito; l'indizio del dominio non basta). Se la startup non è ancora costituita va bene lo stesso: conta da quando i founder ci lavorano, verificato da una fonte (per esempio il profilo LinkedIn controllato da una persona), entro 3 anni (`max_anni_lavoro_non_costituita` in `config/criteria.json`). Il valutatore lo scrive in `fondazione` come "non costituita, ci lavorano dal 2024 (fonte)". 2) almeno un founder con età verificata (registro imprese con data di nascita o fonte esplicita con nome e cognome) sotto 35: basta uno, non servono tutti (Alex, 24 novembre 2026). 3) settore deep tech provato (sito, grant o descrizione nel registro). 4) angolo europeo. 5) nessun criterio violato (round oltre 500k, VC, team oltre 5, grant oltre 1M) |
| `Medio` | nessun criterio violato, ma fondazione, età o settore non ancora verificati |
| `Basso` | almeno un criterio violato, oppure fuori target. Un esito `Esclusa` ha sempre fit `Basso` |

Le società trovate solo nel registro (per esempio Companies House per codice SIC), senza sito,
restano `Medio` con motivo "CANDIDATO ALTO DA REGISTRO": il codice di attività lo sceglie il
founder e non prova il prodotto.

Il criterio sta in `src/classifiers/strict.js` e vale per tutti:
- l'euristico lo applica da solo (versione `1.2 (criterio severo)`);
- il runner (`src/classifiers/run.js`) lo applica a ogni classificatore prima di scrivere: un
  Alto senza tutte le prove diventa Medio con "per Alto manca: ..." nel motivo e in `da_verificare`;
- chi scrive a mano (Claude dal browser, una persona) deve seguire la stessa tabella;
- `npm run realign` (o il workflow "classificatore euristico" con `riallinea = 1`) riallinea le
  valutazioni già nel foglio dei classificatori automatici (euristico, sage), senza cancellare righe.
  Le righe `claude` non le tocca: le scrivono Claude e gli agenti dopo aver controllato le fonti, spesso
  con età da registri che il crawler non ha.

### Regole per i valutatori (Sage e Claude)
- Si valuta solo dopo il crawler founder (`fatti_il` presente). Senza fatti niente fit Alto, e anche con i fatti vale il criterio severo qui sopra.
- Si leggono sempre il testo delle pagine (`evidenze.estratto_home`, `estratto_team`) e le notizie salvate (`notizie_funding`), non solo i campi riassunti.
- "Backed by", loghi di investitori o una pagina su un database di funding con il nome della startup sono segnali di round: da verificare e fit giù; se l'importo supera la soglia, esclusa.
- Se manca un dato, lo si chiede ai crawler, non si cerca da soli sul web: workflow "crawler founder" con `domini` = elenco delle startup (rilegge tutto il sito e rifà registri, età e notizie), poi l'euristico ripassa.
- Per chi passa il prefiltro il crawler legge tutto il sito (fino a 15 pagine e 90 secondi, priorità a careers, blog/news, about, investitori): in `evidenze` ci sono `sito` (pagine lette, posizioni aperte, sito grande) e gli estratti `estratto_careers`, `estratto_blog`, `estratto_about`, `estratto_investors`, `estratto_tech`. Vanno letti.
- Ricerche web dei crawler: ScrapeGraph se c'è `SCRAPEGRAPH_API_KEY`, altrimenti Brave. Le pagine di linkedin.com non si leggono.
- Se `evidenze.sito.pagine` è 0, `evidenze.sito.motivo_zero` dice perché (sito di una pagina, in JavaScript, pagine illeggibili): in quel caso il giudizio sul sito è debole e va detto in `da_verificare`.
- Agenti e Claude scrivono con l'azione `stage` (tab `db_appoggio`, senza lock), non con `upsert`: niente più "Timeout di blocco" mentre girano i crawler. `views` unisce le righe e ricostruisce la vista; le righe rifiutate restano in `db_appoggio` con il motivo in `errore`.

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
| `under30` | `sì` solo se l'età di tutti i founder è verificata (dichiarata pubblicamente o da registro imprese) e sotto 30 |
| `fit` | vedi il criterio severo: `Alto` solo con fondazione, almeno un founder sotto 35 con età verificata, settore e angolo europeo provati |
| `domanda_reale` | clienti, pilot, ricavi trovati |
| `da_verificare` | cosa manca per qualificarla |
| `fonti` | URL usati |

`nota_alex` è di Alex: i classificatori non la scrivono.

Le regole sono in `config/criteria.json` e nella skill. In breve: si esclude solo quando
l'evidenza mostra una soglia superata; se manca un dato si mette `Needs verification`, mai
`Qualificata` per supposizione; "Not disclosed" non vale zero. Lo stesso vale per il fit: mai
`Alto` per supposizione.

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
